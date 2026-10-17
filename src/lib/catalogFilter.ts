import type { Product } from '../types';
import { activeOffer, effectivePrice, productPriceDrop } from './format';

export type SortKey = 'relevance' | 'price-asc' | 'price-desc' | 'name-asc' | 'name-desc' | 'model-asc';

export interface CatalogFilter {
  q: string;
  brand: string;
  category: string;
  offersOnly: boolean;
  dropsOnly?: boolean;
  inStockOnly: boolean;
  sort: SortKey;
}

export const EMPTY_FILTER: CatalogFilter = { q: '', brand: '', category: '', offersOnly: false, inStockOnly: false, sort: 'relevance' };

/** Client-side search: every term must appear in name, model, SKU, brand or category. */
export function filterProducts(products: Product[], f: CatalogFilter): Product[] {
  const terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const compactQ = f.q.replace(/\s+/g, '').toLowerCase();
  let out = products.filter((p) => {
    if (f.brand && p.brand !== f.brand) return false;
    if (f.category && p.category !== f.category) return false;
    if (f.offersOnly && !activeOffer(p)) return false;
    if (f.dropsOnly && !productPriceDrop(p)) return false;
    if (f.inStockOnly && !(p.stockStatus === 'in_stock' || p.stockStatus === 'low_stock')) return false;
    if (!terms.length) return true;
    const hay = p.searchText || `${p.name} ${p.model} ${p.sku} ${p.brand}`.toLowerCase();
    return terms.every((t) => hay.includes(t)) || p.sku.toLowerCase().includes(compactQ);
  });
  const byPrice = (dir: 1 | -1) => (a: Product, b: Product) => {
    const pa = effectivePrice(a);
    const pb = effectivePrice(b);
    if (pa == null && pb == null) return 0;
    if (pa == null) return 1; // "price on request" always last
    if (pb == null) return -1;
    return (pa - pb) * dir;
  };
  switch (f.sort) {
    case 'price-asc': out = [...out].sort(byPrice(1)); break;
    case 'price-desc': out = [...out].sort(byPrice(-1)); break;
    case 'name-asc': out = [...out].sort((a, b) => a.name.localeCompare(b.name)); break;
    case 'name-desc': out = [...out].sort((a, b) => b.name.localeCompare(a.name)); break;
    case 'model-asc': out = [...out].sort((a, b) => a.model.localeCompare(b.model)); break;
    default: {
      if (terms.length) {
        const q = compactQ;
        const score = (p: Product) => (p.sku.toLowerCase() === q || p.model.toLowerCase() === q ? 0 : p.model.toLowerCase().startsWith(q) ? 1 : 2);
        out = [...out].sort((a, b) => score(a) - score(b) || a.sortOrder - b.sortOrder);
      } else {
        out = [...out].sort((a, b) => a.sortOrder - b.sortOrder || a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model));
      }
    }
  }
  return out;
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
