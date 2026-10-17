import type { Product } from '../../types';

/** Fields an administrator should complete before a product is fully ready for sale. */
export function missingInfo(p: Product): string[] {
  const out: string[] = [];
  if (!p.model) out.push('model');
  if (p.price == null) out.push('selling price');
  if (!p.imageUrl) out.push('image');
  if (!p.category) out.push('category');
  if (!p.description && !p.features.length) out.push('description');
  return out;
}
