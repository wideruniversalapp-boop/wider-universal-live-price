import { describe, expect, it } from 'vitest';
import { nextPriceFields, priceDrop, PRICE_DROP_DAYS } from '../../src/lib/priceDrop';

const at = (iso: string) => ({ toMillis: () => Date.parse(iso) });
const now = new Date('2026-10-16T12:00:00Z');

describe('priceDrop', () => {
  it('shows a rounded percentage and the previous price within the window', () => {
    const d = priceDrop({ price: 92, previousPrice: 100, priceChangedAt: at('2026-10-10T00:00:00Z') }, now);
    expect(d?.pct).toBe(8);
    expect(d?.previous).toBe(100);
    expect(d?.until.toISOString()).toBe(new Date(Date.parse('2026-10-10T00:00:00Z') + PRICE_DROP_DAYS * 864e5).toISOString());
  });

  it('shows nothing for increases, unchanged prices, tiny drops, expired tags, missing data or active offers', () => {
    const recent = at('2026-10-15T00:00:00Z');
    expect(priceDrop({ price: 110, previousPrice: 100, priceChangedAt: recent }, now)).toBeNull();
    expect(priceDrop({ price: 100, previousPrice: 100, priceChangedAt: recent }, now)).toBeNull();
    expect(priceDrop({ price: 99.7, previousPrice: 100, priceChangedAt: recent }, now)).toBeNull();
    expect(priceDrop({ price: 80, previousPrice: 100, priceChangedAt: at('2026-08-01T00:00:00Z') }, now)).toBeNull();
    expect(priceDrop({ price: 80, previousPrice: null, priceChangedAt: recent }, now)).toBeNull();
    expect(priceDrop({ price: null, previousPrice: 100, priceChangedAt: recent }, now)).toBeNull();
    expect(priceDrop({ price: 80, previousPrice: 100, priceChangedAt: null }, now)).toBeNull();
    expect(priceDrop({ price: 80, previousPrice: 100, priceChangedAt: recent }, now, true)).toBeNull();
  });
});

describe('nextPriceFields', () => {
  const T = 'SERVER_TIME';
  it('records the replaced price when the price changes', () => {
    expect(nextPriceFields({ price: 100, previousPrice: null, priceChangedAt: null }, { price: 92, previousPrice: null, priceChangedAt: null }, T)).toEqual({ previousPrice: 100, priceChangedAt: T });
    expect(nextPriceFields({ price: 92, previousPrice: 100, priceChangedAt: 'old' }, { price: 95, previousPrice: 100, priceChangedAt: 'old' }, T)).toEqual({ previousPrice: 92, priceChangedAt: T });
    expect(nextPriceFields({ price: null, previousPrice: null, priceChangedAt: null }, { price: 50, previousPrice: null, priceChangedAt: null }, T)).toEqual({ previousPrice: null, priceChangedAt: T });
  });
  it('keeps history on other edits, allows clearing, and starts empty for new products', () => {
    expect(nextPriceFields({ price: 92, previousPrice: 100, priceChangedAt: 'old' }, { price: 92, previousPrice: 100, priceChangedAt: 'old' }, T)).toEqual({ previousPrice: 100, priceChangedAt: 'old' });
    expect(nextPriceFields({ price: 92, previousPrice: 100, priceChangedAt: 'old' }, { price: 92, previousPrice: null, priceChangedAt: 'old' }, T)).toEqual({ previousPrice: null, priceChangedAt: 'old' });
    // a forged previousPrice in the form is ignored: the stored value is kept
    expect(nextPriceFields({ price: 92, previousPrice: 100, priceChangedAt: 'old' }, { price: 92, previousPrice: 500, priceChangedAt: 'old' }, T)).toEqual({ previousPrice: 100, priceChangedAt: 'old' });
    expect(nextPriceFields(null, { price: 92, previousPrice: 500, priceChangedAt: 'x' }, T)).toEqual({ previousPrice: null, priceChangedAt: null });
  });
});
