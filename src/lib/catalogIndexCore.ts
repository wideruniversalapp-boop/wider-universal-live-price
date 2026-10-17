/**
 * Firebase-free part of the public catalog index (shared by the web app and CLI scripts).
 * See catalogIndex.ts for how the index is stored and read.
 */
import type { Product, StockStatus } from '../types';

export interface IndexItem {
  id: string;
  sku: string;
  model: string;
  name: string;
  brand: string;
  category: string;
  price: number | null;
  offerPrice: number | null;
  offerStart: number | null;
  offerEnd: number | null;
  previousPrice: number | null;
  priceChangedAt: number | null;
  stockStatus: StockStatus;
  imageUrl: string | null;
  sortOrder: number;
}

export const INDEX_PART_SIZE = 700; // ~300 KB per document, well under the 1 MB limit

export function toIndexItem(p: Product): IndexItem {
  return {
    id: p.id,
    sku: p.sku,
    model: p.model,
    name: p.name,
    brand: p.brand,
    category: p.category,
    price: p.price,
    offerPrice: p.offerPrice,
    offerStart: p.offerStart ? p.offerStart.toMillis() : null,
    offerEnd: p.offerEnd ? p.offerEnd.toMillis() : null,
    previousPrice: p.previousPrice ?? null,
    priceChangedAt: p.priceChangedAt ? p.priceChangedAt.toMillis() : null,
    stockStatus: p.stockStatus,
    imageUrl: p.imageUrl,
    sortOrder: p.sortOrder,
  };
}

/** Index items for published products, in a stable order. */
export function buildIndex(products: Product[]): IndexItem[] {
  return products
    .filter((p) => p.status === 'published')
    .map(toIndexItem)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** FNV-1a hash of the serialised index; used to skip unnecessary rewrites. */
export function hashIndex(items: IndexItem[]): string {
  const s = JSON.stringify(items);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + s.length.toString(16);
}
