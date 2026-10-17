/**
 * Initial catalog migration: loads data/catalog_import.json (produced by
 * extraction/reconcile.py) into Firestore and uploads product images to Storage.
 *
 *   npm run seed:emulator
 *   npm run seed -- --project <id> --bucket <bucket>          (production / staging)
 *   options: --dry-run  --skip-images  --limit <n>
 *
 * Price separation: the source catalog price is written ONLY to the admin-only
 * `productSources` collection. Public `products` start with no selling price
 * ("price on request") and stock "on_request" until administrators set them.
 *
 * Re-running is safe: existing products keep every administrator-managed field;
 * only `productSources` is refreshed and missing images are filled in.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue, getFirestore, type WriteBatch } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { arg, flag, initAdmin } from './admin-init';
import { rebuildCatalogIndex } from './catalog-index';

interface SeedProduct {
  id: string;
  sku: string;
  model: string;
  name: string;
  brand: string;
  category: string;
  subcategory: string;
  description: string;
  features: string[];
  specs: unknown[];
  imageFile: string | null;
  datasheetUrl: string;
  source: Record<string, unknown>;
  verification: string;
  issues: string[];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function slug(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item';
}

async function pool<T>(items: T[], size: number, fn: (t: T, i: number) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    }),
  );
}

async function main() {
  const { emulator, projectId, bucket } = initAdmin();
  const dry = flag('dry-run');
  const skipImages = flag('skip-images');
  const max = Number(arg('limit') ?? Infinity);
  if (!skipImages && !bucket) throw new Error('Pass --bucket <name> (or --skip-images)');

  const data = JSON.parse(readFileSync(path.join(root, 'data', 'catalog_import.json'), 'utf8')) as { products: SeedProduct[] };
  const items = data.products.slice(0, max);
  console.log(`${emulator ? 'EMULATOR' : 'LIVE'} project=${projectId} bucket=${bucket ?? '-'} products=${items.length}${dry ? ' (dry run)' : ''}`);

  // SKUs must be unique in the catalog; the model number is preserved exactly.
  const seen = new Map<string, number>();
  for (const p of items) {
    const n = (seen.get(p.sku) ?? 0) + 1;
    seen.set(p.sku, n);
    if (n > 1) {
      p.issues = [...p.issues, `SKU_SUFFIXED_DUPLICATE_${n}`];
      p.sku = `${p.sku}-DUP${n}`;
      p.verification = 'REQUIRES VERIFICATION';
    }
  }

  const db = getFirestore();
  const existing = new Map<string, FirebaseFirestore.DocumentData>();
  for (let i = 0; i < items.length; i += 300) {
    const refs = items.slice(i, i + 300).map((p) => db.doc(`products/${p.id}`));
    (await db.getAll(...refs)).forEach((s) => s.exists && existing.set(s.id, s.data()!));
  }
  console.log(`existing products: ${existing.size}`);

  // ---- images
  const imageUrls = new Map<string, { url: string; path: string }>();
  if (!skipImages) {
    const b = getStorage().bucket(bucket);
    const host = emulator ? `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}` : 'https://firebasestorage.googleapis.com';
    const todo = items.filter((p) => p.imageFile && !existing.get(p.id)?.imageUrl);
    let done = 0;
    await pool(todo, 12, async (p) => {
      const file = path.join(root, 'extraction', 'output', p.imageFile!);
      if (!existsSync(file)) return console.warn(`missing image file ${file}`);
      const ext = path.extname(file).slice(1).toLowerCase();
      const dest = `products/${p.id}/source.${ext}`;
      const token = randomUUID();
      if (!dry) {
        await b.upload(file, {
          destination: dest,
          metadata: { contentType: MIME[ext] ?? 'application/octet-stream', cacheControl: 'public,max-age=31536000', metadata: { firebaseStorageDownloadTokens: token } },
        });
      }
      imageUrls.set(p.id, { path: dest, url: `${host}/v0/b/${bucket}/o/${encodeURIComponent(dest)}?alt=media&token=${token}` });
      if (++done % 100 === 0) console.log(`  images ${done}/${todo.length}`);
    });
    console.log(`images uploaded: ${imageUrls.size}`);
  }

  // ---- products, sources, audit
  let created = 0;
  let refreshed = 0;
  const batches: WriteBatch[] = [];
  for (let i = 0; i < items.length; i += 200) {
    const chunk = items.slice(i, i + 200);
    const batch = db.batch();
    const hist = db.collection('priceHistory').doc();
    const touched: string[] = [];
    const changes: unknown[] = [];
    chunk.forEach((p, j) => {
      const img = imageUrls.get(p.id);
      const prev = existing.get(p.id);
      const searchText = [p.name, p.model, p.sku, p.brand, p.category].join(' ').toLowerCase();
      if (!prev) {
        batch.set(db.doc(`products/${p.id}`), {
          sku: p.sku, model: p.model, name: p.name, brand: p.brand, category: p.category, subcategory: p.subcategory,
          description: p.description, features: p.features, specs: p.specs,
          imageUrl: img?.url ?? null, imagePath: img?.path ?? null, datasheetUrl: p.datasheetUrl, sourceUrl: '',
          price: null, offerPrice: null, offerStart: null, offerEnd: null, offerText: '', previousPrice: null, priceChangedAt: null,
          stockStatus: 'on_request', stockQty: null,
          status: p.verification === 'OK' ? 'published' : 'draft',
          searchText, sortOrder: i + j,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), updatedBy: 'seed-script', lastChangeId: hist.id,
        });
        touched.push(p.id);
        changes.push({ productId: p.id, sku: p.sku, field: '(created by migration)', from: null, to: null });
        created++;
      } else if (img && !prev.imageUrl) {
        batch.update(db.doc(`products/${p.id}`), { imageUrl: img.url, imagePath: img.path, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'seed-script' });
      }
      batch.set(
        db.doc(`productSources/${p.id}`),
        { ...p.source, verification: p.verification, issues: p.issues },
        { mergeFields: Object.keys(p.source).concat(prev ? [] : ['verification', 'issues']) },
      );
      refreshed++;
    });
    if (touched.length) {
      batch.set(hist, { by: 'seed-script', byEmail: 'migration', at: FieldValue.serverTimestamp(), reason: 'create', importJobId: null, productIds: touched, changes });
    }
    batches.push(batch);
  }

  // ---- taxonomy + settings
  const tax = db.batch();
  const brandNames = [...new Set(items.map((p) => p.brand))].sort();
  const catNames = [...new Set(items.map((p) => p.category))].filter(Boolean).sort();
  brandNames.forEach((name, i) => tax.set(db.doc(`brands/${slug(name)}`), { name, order: i }, { merge: true }));
  catNames.forEach((name, i) => tax.set(db.doc(`categories/${slug(name)}`), { name, order: i }, { merge: true }));
  const settingsRef = db.doc('settings/public');
  if (!(await settingsRef.get()).exists) {
    tax.set(settingsRef, {
      companyName: 'WIDER UNIVERSAL TRADING COMPANY',
      phone: '+966 55 482 2231',
      whatsapp: '966554822231',
      email: 'sales@theuniversaltrading.com',
      address: 'Riyadh, Saudi Arabia',
      showStock: true,
      lowStockThreshold: 5,
      priceListNote: 'Prices in SAR and subject to change without notice. Contact our sales team for project pricing.',
    });
  }

  if (dry) {
    console.log(`dry run: would create ${created}, refresh ${refreshed} sources, ${brandNames.length} brands, ${catNames.length} categories`);
    return;
  }
  for (const b of batches) await b.commit();
  await tax.commit();
  const idx = await rebuildCatalogIndex();
  console.log(`catalog index: ${idx.count} products in ${idx.parts} part(s)`);
  console.log(`done: created ${created} products, refreshed ${refreshed} source records, ${brandNames.length} brands, ${catNames.length} categories`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
