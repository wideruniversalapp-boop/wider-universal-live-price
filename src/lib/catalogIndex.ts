/**
 * Compact public catalog index.
 *
 * The public catalog needs only a few fields per product for search, filtering and the
 * product grid. Instead of reading every product document on each visit (~1,300 reads,
 * ~1.8 MB), visitors read `catalogIndex/meta` plus a few `catalogIndex/part-N` documents.
 *
 * The index is rebuilt from the full product list whenever an administrator's dashboard
 * sees a change (AdminLayout) and by the CLI scripts after bulk writes. If it is missing
 * or unreadable, the catalog falls back to querying `products` directly.
 */
import { collection, doc, getDoc, getDocs, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type { Product } from '../types';
import { buildIndex, hashIndex, INDEX_PART_SIZE, type IndexItem } from './catalogIndexCore';
import { buildSearchText } from './format';

export { buildIndex, hashIndex, toIndexItem, type IndexItem } from './catalogIndexCore';

export function fromIndexItem(i: IndexItem): Product {
  const p: Product = {
    id: i.id, sku: i.sku, model: i.model, name: i.name, brand: i.brand, category: i.category, subcategory: '',
    description: '', features: [], specs: [], imageUrl: i.imageUrl, imagePath: null, datasheetUrl: '', sourceUrl: '',
    price: i.price, offerPrice: i.offerPrice,
    offerStart: i.offerStart != null ? Timestamp.fromMillis(i.offerStart) : null,
    offerEnd: i.offerEnd != null ? Timestamp.fromMillis(i.offerEnd) : null,
    offerText: '', previousPrice: i.previousPrice ?? null,
    priceChangedAt: i.priceChangedAt != null ? Timestamp.fromMillis(i.priceChangedAt) : null,
    stockStatus: i.stockStatus, stockQty: null, status: 'published', searchText: '', sortOrder: i.sortOrder,
  };
  p.searchText = buildSearchText(p);
  return p;
}

export async function fetchIndexedCatalog(): Promise<Product[] | null> {
  const meta = await getDoc(doc(db, 'catalogIndex', 'meta'));
  if (!meta.exists()) return null;
  const parts = meta.data().parts as number;
  const snaps = await Promise.all(Array.from({ length: parts }, (_, i) => getDoc(doc(db, 'catalogIndex', `part-${i}`))));
  if (snaps.some((s) => !s.exists() || s.data().hash !== meta.data().hash)) return null; // mid-rewrite: fall back
  lastIndexUpdatedAt = typeof meta.data().updatedAt === 'number' ? meta.data().updatedAt : null;
  return snaps.flatMap((s) => (s.data()!.items as IndexItem[]).map(fromIndexItem));
}

/** When the public price list was last rebuilt (set by fetchIndexedCatalog). */
export let lastIndexUpdatedAt: number | null = null;

export async function currentIndexHash(): Promise<string | null> {
  const meta = await getDoc(doc(db, 'catalogIndex', 'meta'));
  return meta.exists() ? (meta.data().hash as string) : null;
}

/** Admin only (enforced by rules). Rewrites all parts and the meta document in one batch. */
export async function publishIndex(products: Product[]): Promise<{ written: boolean; count: number }> {
  const items = buildIndex(products);
  const hash = hashIndex(items);
  if ((await currentIndexHash()) === hash) return { written: false, count: items.length };
  const parts = Math.max(1, Math.ceil(items.length / INDEX_PART_SIZE));
  const batch = writeBatch(db);
  for (let i = 0; i < parts; i++) {
    batch.set(doc(db, 'catalogIndex', `part-${i}`), { hash, items: items.slice(i * INDEX_PART_SIZE, (i + 1) * INDEX_PART_SIZE) });
  }
  // remove parts left over from a larger previous index
  const existing = await getDocs(collection(db, 'catalogIndex'));
  existing.docs
    .filter((d) => d.id.startsWith('part-') && Number(d.id.slice(5)) >= parts)
    .forEach((d) => batch.delete(d.ref));
  batch.set(doc(db, 'catalogIndex', 'meta'), { hash, parts, count: items.length, updatedAt: Date.now() });
  await batch.commit();
  return { written: true, count: items.length };
}
