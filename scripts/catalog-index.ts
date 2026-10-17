/**
 * Rebuilds the public catalog index (catalogIndex/*) with the Admin SDK.
 * Called by seed.ts and apply-pdf-prices.ts after bulk writes; can also be run alone:
 *
 *   npx tsx scripts/catalog-index.ts --emulator --project demo-wider
 */
import { pathToFileURL } from 'node:url';
import { getFirestore } from 'firebase-admin/firestore';
import { buildIndex, hashIndex, INDEX_PART_SIZE } from '../src/lib/catalogIndexCore';
import type { Product } from '../src/types';
import { initAdmin } from './admin-init';

export async function rebuildCatalogIndex(): Promise<{ written: boolean; count: number; parts: number }> {
  const db = getFirestore();
  const snap = await db.collection('products').where('status', '==', 'published').get();
  const products = snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id, sku: x.sku ?? '', model: x.model ?? '', name: x.name ?? '', brand: x.brand ?? '', category: x.category ?? '',
      price: typeof x.price === 'number' ? x.price : null, offerPrice: typeof x.offerPrice === 'number' ? x.offerPrice : null,
      offerStart: x.offerStart ?? null, offerEnd: x.offerEnd ?? null,
      previousPrice: typeof x.previousPrice === 'number' ? x.previousPrice : null, priceChangedAt: x.priceChangedAt ?? null, stockStatus: x.stockStatus ?? 'on_request',
      imageUrl: x.imageUrl ?? null, sortOrder: typeof x.sortOrder === 'number' ? x.sortOrder : 0, status: 'published',
    } as unknown as Product;
  });
  const items = buildIndex(products);
  const hash = hashIndex(items);
  const meta = await db.doc('catalogIndex/meta').get();
  const parts = Math.max(1, Math.ceil(items.length / INDEX_PART_SIZE));
  if (meta.exists && meta.data()!.hash === hash) return { written: false, count: items.length, parts };
  const batch = db.batch();
  for (let i = 0; i < parts; i++) {
    batch.set(db.doc(`catalogIndex/part-${i}`), { hash, items: items.slice(i * INDEX_PART_SIZE, (i + 1) * INDEX_PART_SIZE) });
  }
  (await db.collection('catalogIndex').get()).docs
    .filter((d) => d.id.startsWith('part-') && Number(d.id.slice(5)) >= parts)
    .forEach((d) => batch.delete(d.ref));
  batch.set(db.doc('catalogIndex/meta'), { hash, parts, count: items.length, updatedAt: Date.now() });
  await batch.commit();
  return { written: true, count: items.length, parts };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  initAdmin();
  rebuildCatalogIndex()
    .then((r) => console.log(`catalog index: ${r.written ? 'rewritten' : 'already current'} (${r.count} products, ${r.parts} parts)`))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
