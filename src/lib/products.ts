import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { Brand, Category, ChangeSet, FieldChange, Product, ProductInput, ProductSource } from '../types';
import { buildSearchText } from './format';
import { nextPriceFields } from './priceDrop';

/** Fields whose changes are recorded in the audit trail. Must match firestore.rules. */
export const TRACKED_FIELDS = ['price', 'offerPrice', 'offerStart', 'offerEnd', 'stockStatus', 'stockQty', 'previousPrice'] as const;
/** Every editable field compared when building change sets. */
const COMPARED_FIELDS: (keyof ProductInput)[] = [
  'sku', 'model', 'name', 'brand', 'category', 'subcategory', 'description', 'features', 'specs',
  'imageUrl', 'imagePath', 'datasheetUrl', 'sourceUrl', 'price', 'offerPrice', 'offerStart', 'offerEnd',
  'offerText', 'previousPrice', 'stockStatus', 'stockQty', 'status', 'sortOrder',
];
/** Products per batch: one change-set doc + N product writes stays below Firestore's 500-write batch limit. */
export const BATCH_PRODUCTS = 200;

export function toProduct(id: string, d: DocumentData): Product {
  return {
    id,
    sku: d.sku ?? '',
    model: d.model ?? '',
    name: d.name ?? '',
    brand: d.brand ?? '',
    category: d.category ?? '',
    subcategory: d.subcategory ?? '',
    description: d.description ?? '',
    features: Array.isArray(d.features) ? d.features : [],
    specs: Array.isArray(d.specs) ? d.specs : [],
    imageUrl: d.imageUrl ?? null,
    imagePath: d.imagePath ?? null,
    datasheetUrl: d.datasheetUrl ?? '',
    sourceUrl: d.sourceUrl ?? '',
    price: typeof d.price === 'number' ? d.price : null,
    offerPrice: typeof d.offerPrice === 'number' ? d.offerPrice : null,
    offerStart: d.offerStart ?? null,
    offerEnd: d.offerEnd ?? null,
    offerText: d.offerText ?? '',
    previousPrice: typeof d.previousPrice === 'number' ? d.previousPrice : null,
    priceChangedAt: d.priceChangedAt ?? null,
    stockStatus: d.stockStatus ?? 'on_request',
    stockQty: typeof d.stockQty === 'number' ? d.stockQty : null,
    status: d.status ?? 'draft',
    searchText: d.searchText ?? '',
    sortOrder: typeof d.sortOrder === 'number' ? d.sortOrder : 0,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    updatedBy: d.updatedBy,
    lastChangeId: d.lastChangeId,
  };
}

// ---------------------------------------------------------------- public reads
export async function fetchPublishedProducts(): Promise<Product[]> {
  const snap = await getDocs(query(collection(db, 'products'), where('status', '==', 'published')));
  return snap.docs.map((d) => toProduct(d.id, d.data()));
}

export async function fetchProduct(id: string): Promise<Product | null> {
  const snap = await getDoc(doc(db, 'products', id));
  return snap.exists() ? toProduct(snap.id, snap.data()) : null;
}

export async function fetchBrands(): Promise<Brand[]> {
  const snap = await getDocs(query(collection(db, 'brands'), orderBy('order')));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      id: d.id,
      name: x.name,
      order: x.order ?? 0,
      headline: typeof x.headline === 'string' ? x.headline : '',
      subtitle: typeof x.subtitle === 'string' ? x.subtitle : '',
      bannerPath: typeof x.bannerPath === 'string' && /^brands\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(x.bannerPath) ? x.bannerPath : '',
    };
  });
}

export async function fetchCategories(): Promise<Category[]> {
  const snap = await getDocs(query(collection(db, 'categories'), orderBy('order')));
  return snap.docs.map((d) => ({ id: d.id, name: d.data().name, order: d.data().order ?? 0 }));
}

// ---------------------------------------------------------------- admin reads
export function watchAllProducts(cb: (p: Product[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'products'),
    (snap) => cb(snap.docs.map((d) => toProduct(d.id, d.data()))),
    onError,
  );
}

export async function fetchSource(id: string): Promise<ProductSource | null> {
  const snap = await getDoc(doc(db, 'productSources', id));
  return snap.exists() ? (snap.data() as ProductSource) : null;
}

export async function fetchAllSources(): Promise<Map<string, ProductSource>> {
  const snap = await getDocs(collection(db, 'productSources'));
  return new Map(snap.docs.map((d) => [d.id, d.data() as ProductSource]));
}

export async function fetchHistory(productId: string, max = 50): Promise<ChangeSet[]> {
  const snap = await getDocs(
    query(collection(db, 'priceHistory'), where('productIds', 'array-contains', productId), orderBy('at', 'desc'), limit(max)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as Omit<ChangeSet, 'id'>) }));
}

export async function fetchRecentHistory(max = 100): Promise<ChangeSet[]> {
  const snap = await getDocs(query(collection(db, 'priceHistory'), orderBy('at', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data({ serverTimestamps: 'estimate' }) as Omit<ChangeSet, 'id'>) }));
}

// ---------------------------------------------------------------- writes
function comparable(v: unknown): string {
  if (v && typeof v === 'object' && 'toMillis' in (v as object)) return `ts:${(v as { toMillis(): number }).toMillis()}`;
  return JSON.stringify(v ?? null);
}

function auditValue(v: unknown): unknown {
  if (v && typeof v === 'object' && 'toDate' in (v as object)) return (v as { toDate(): Date }).toDate().toISOString();
  if (Array.isArray(v) || (v && typeof v === 'object')) return JSON.stringify(v).slice(0, 1000);
  return v ?? null;
}

export function diffProduct(productId: string, before: Partial<ProductInput> | null, after: ProductInput): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of COMPARED_FIELDS) {
    const a = before ? before[f] : undefined;
    const b = after[f];
    if (comparable(a) !== comparable(b)) {
      out.push({ productId, sku: after.sku, field: f, from: auditValue(a), to: auditValue(b) });
    }
  }
  return out;
}

export interface ProductWrite {
  id: string;
  before: Product | null;
  after: ProductInput;
}

/**
 * Writes products together with an audit change-set, in batches. Each batch writes one
 * `priceHistory` document listing every product it touches; each product points at it via
 * `lastChangeId`, which the security rules verify.
 */
export async function commitProductWrites(
  writes: ProductWrite[],
  reason: ChangeSet['reason'],
  importJobId: string | null = null,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const changeSetIds: string[] = [];
  const effective = writes
    .map((w) => ({ ...w, changes: diffProduct(w.id, w.before, w.after) }))
    .filter((w) => w.before === null || w.changes.length > 0);

  for (let i = 0; i < effective.length; i += BATCH_PRODUCTS) {
    const chunk = effective.slice(i, i + BATCH_PRODUCTS);
    const batch = writeBatch(db);
    const histRef = doc(collection(db, 'priceHistory'));
    batch.set(histRef, {
      by: user.uid,
      byEmail: user.email ?? '',
      at: serverTimestamp(),
      reason,
      importJobId,
      productIds: chunk.map((w) => w.id),
      changes: chunk.flatMap((w) => w.changes),
    });
    for (const w of chunk) {
      const drop = nextPriceFields(w.before, w.after, serverTimestamp() as unknown as Timestamp);
      const data = {
        ...w.after,
        previousPrice: drop.previousPrice,
        priceChangedAt: drop.priceChangedAt,
        searchText: buildSearchText(w.after),
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        lastChangeId: histRef.id,
        ...(w.before ? {} : { createdAt: serverTimestamp() }),
      };
      const ref = doc(db, 'products', w.id);
      if (w.before) batch.update(ref, data);
      else batch.set(ref, data);
    }
    await batch.commit();
    changeSetIds.push(histRef.id);
    onProgress?.(Math.min(i + chunk.length, effective.length), effective.length);
  }
  return changeSetIds;
}

export function productToInput(p: Product): ProductInput {
  const { id: _id, searchText: _s, createdAt: _c, updatedAt: _u, updatedBy: _b, lastChangeId: _l, ...rest } = p;
  return rest;
}

export async function deleteProduct(id: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(db, 'products', id));
  await batch.commit();
}
