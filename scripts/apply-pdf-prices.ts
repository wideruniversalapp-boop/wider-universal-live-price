/**
 * Applies data/pdf_price_import/price_update_plan.json (made by extraction/pdf_prices.py).
 *
 *   npx tsx scripts/apply-pdf-prices.ts --emulator --project demo-wider                 (dry run, prints counts)
 *   npx tsx scripts/apply-pdf-prices.ts --emulator --project demo-wider --apply         (reference prices only)
 *   npx tsx scripts/apply-pdf-prices.ts --emulator --project demo-wider --apply --set-selling-price
 *
 * Always (with --apply): writes the PDF price and its provenance to the admin-only
 * `productSources/{id}` document (pdfListPrice, pdfPriceText, pdfFile, pdfPage, pdfRow, ...).
 *
 * With --set-selling-price: additionally sets the public Wider Universal selling price
 * `products.price` = PDF price, ONLY for products whose selling price is currently empty.
 * Existing selling prices, offers, stock, specifications, images, categories and
 * descriptions are never changed. Every product change is recorded in `priceHistory`
 * and the import appears under Admin → Import / export with a Revert button.
 *
 * Only EXACT_MATCH and VERIFIED_MATCH rows are in the plan; review rows are never applied.
 * Take a backup first: npx tsx scripts/backup-products.ts ...
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { arg, flag, initAdmin } from './admin-init';
import { rebuildCatalogIndex } from './catalog-index';

interface PlanRow {
  productId: string;
  pdfListPrice: number;
  pdfPriceText: string;
  pdfFile: string;
  pdfPage: number;
  pdfRow: number;
  pdfModel: string;
  matchStatus: string;
  matchMethod: string;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BY = 'pdf-import-script';

async function main() {
  initAdmin();
  const apply = flag('apply');
  const setSelling = flag('set-selling-price');
  const planPath = arg('plan') ?? path.join(root, 'data', 'pdf_price_import', 'price_update_plan.json');
  const plan = JSON.parse(readFileSync(planPath, 'utf8')) as { generated_at: string; pdfs: { file: string }[]; updates: PlanRow[]; review?: unknown[] };
  const rows = plan.updates.filter((u) => u.matchStatus === 'EXACT_MATCH' || u.matchStatus === 'VERIFIED_MATCH');
  const db = getFirestore();

  // Re-read current state: the plan may be older than the database.
  const products = new Map<string, FirebaseFirestore.DocumentData>();
  for (let i = 0; i < rows.length; i += 300) {
    const snaps = await db.getAll(...rows.slice(i, i + 300).map((r) => db.doc(`products/${r.productId}`)));
    snaps.forEach((s) => s.exists && products.set(s.id, s.data()!));
  }
  const missing = rows.filter((r) => !products.has(r.productId));
  const priceTargets = setSelling ? rows.filter((r) => products.has(r.productId) && products.get(r.productId)!.price == null) : [];
  const keptExisting = setSelling ? rows.filter((r) => products.get(r.productId)?.price != null) : [];
  console.log(`plan rows: ${rows.length}; products missing now: ${missing.length}`);
  console.log(`reference price updates (productSources): ${rows.length - missing.length}`);
  if (setSelling) console.log(`selling prices to set (currently empty): ${priceTargets.length}; existing selling prices kept: ${keptExisting.length}`);
  if (!apply) {
    console.log('dry run — pass --apply to write');
    return;
  }

  const job = db.collection('importJobs').doc();
  await job.set({
    by: BY,
    byEmail: 'PDF price import',
    type: 'pdf-price',
    fileName: plan.pdfs.map((p) => p.file).join(', '),
    createdAt: FieldValue.serverTimestamp(),
    status: 'committing',
    created: 0,
    updated: priceTargets.length,
    skipped: rows.length - priceTargets.length,
    failed: 0,
    errors: missing.map((m) => ({ row: m.pdfRow, sku: m.pdfModel, message: `product ${m.productId} no longer exists` })),
    changeSetIds: [],
    referenceOnly: !setSelling,
    review: plan.review ?? [],
  });

  // 1. admin-only reference fields
  const live = rows.filter((r) => products.has(r.productId));
  for (let i = 0; i < live.length; i += 400) {
    const batch = db.batch();
    for (const r of live.slice(i, i + 400)) {
      batch.set(
        db.doc(`productSources/${r.productId}`),
        {
          pdfListPrice: r.pdfListPrice,
          pdfPriceText: r.pdfPriceText,
          pdfFile: r.pdfFile,
          pdfPage: r.pdfPage,
          pdfRow: r.pdfRow,
          pdfModel: r.pdfModel,
          pdfMatchStatus: r.matchStatus,
          pdfMatchMethod: r.matchMethod,
          pdfImportJobId: job.id,
          pdfImportedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  // 2. optional public selling prices (empty ones only), audited, with recovery snapshot
  const changeSetIds: string[] = [];
  for (let i = 0; i < priceTargets.length; i += 150) {
    const chunk = priceTargets.slice(i, i + 150);
    const before = chunk.map((r) => ({ id: r.productId, before: products.get(r.productId) }));
    await job.collection('chunks').add({ items: before });
    const batch = db.batch();
    const hist = db.collection('priceHistory').doc();
    batch.set(hist, {
      by: BY,
      byEmail: 'PDF price import',
      at: FieldValue.serverTimestamp(),
      reason: 'import',
      importJobId: job.id,
      productIds: chunk.map((r) => r.productId),
      changes: chunk.map((r) => ({
        productId: r.productId,
        sku: products.get(r.productId)!.sku,
        field: 'price',
        from: null,
        to: r.pdfListPrice,
        source: `${r.pdfFile} p.${r.pdfPage} #${r.pdfRow} "${r.pdfPriceText}"`,
      })),
    });
    for (const r of chunk) {
      batch.update(db.doc(`products/${r.productId}`), {
        price: r.pdfListPrice,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: BY,
        lastChangeId: hist.id,
      });
    }
    await batch.commit();
    changeSetIds.push(hist.id);
  }
  await job.update({ status: setSelling ? 'completed' : 'reference-only', changeSetIds });
  const idx = await rebuildCatalogIndex();
  console.log(`catalog index: ${idx.count} products in ${idx.parts} part(s)`);
  console.log(`done: job ${job.id}; reference prices ${live.length}; selling prices set ${priceTargets.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
