import { describe, expect, it } from 'vitest';
import { buildIndex, hashIndex } from '../../src/lib/catalogIndexCore';
import { splitFeatures } from '../../src/lib/format';
import { product, ts } from './fixtures';

describe('catalog index', () => {
  const items = [
    product({ id: 'b', status: 'published', price: 10, offerStart: ts('2026-10-01T00:00:00Z') }),
    product({ id: 'a', status: 'published', price: null }),
    product({ id: 'c', status: 'draft' }),
    product({ id: 'd', status: 'archived' }),
  ];

  it('contains only published products, public fields only, in a stable order', () => {
    const idx = buildIndex(items);
    expect(idx.map((i) => i.id)).toEqual(['a', 'b']);
    expect(Object.keys(idx[0]).sort()).toEqual(
      ['brand', 'category', 'id', 'imageUrl', 'model', 'name', 'offerEnd', 'offerPrice', 'offerStart', 'previousPrice', 'price', 'priceChangedAt', 'sku', 'sortOrder', 'stockStatus'].sort(),
    );
    expect(idx[1].offerStart).toBe(Date.parse('2026-10-01T00:00:00Z'));
  });

  it('hash changes only when public data changes', () => {
    const h1 = hashIndex(buildIndex(items));
    expect(hashIndex(buildIndex([...items].reverse()))).toBe(h1);
    expect(hashIndex(buildIndex(items.map((p) => (p.id === 'c' ? { ...p, price: 5 } : p))))).toBe(h1); // draft change
    expect(hashIndex(buildIndex(items.map((p) => (p.id === 'b' ? { ...p, price: 11 } : p))))).not.toBe(h1);
  });
});

describe('splitFeatures', () => {
  it('turns "Label: value" lines into spec rows and keeps other lines as features', () => {
    expect(splitFeatures(['Resolution: 8MP', 'IP67 weatherproof', 'Screen：7 inch', 'See https://x.y'])).toEqual({
      rows: [{ label: 'Resolution', value: '8MP' }, { label: 'Screen', value: '7 inch' }],
      bullets: ['IP67 weatherproof', 'See https://x.y'],
    });
  });
});
