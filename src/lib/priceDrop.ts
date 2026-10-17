/**
 * Price-drop tags.
 *
 * When an administrator lowers a product's selling price, the product records the price
 * it replaced (`previousPrice`) and when (`priceChangedAt`). For PRICE_DROP_DAYS the
 * catalog shows "↓ N%" with the old price struck through. Firestore rules only accept a
 * `previousPrice` equal to the price actually stored before the change, so a drop cannot
 * be invented. Offers (temporary promotions) take precedence over drop tags.
 */

export const PRICE_DROP_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

interface TimeLike {
  toMillis(): number;
}

export interface PriceFields {
  price: number | null;
  previousPrice: number | null;
  priceChangedAt: TimeLike | null;
}

export interface PriceDrop {
  previous: number;
  pct: number;
  until: Date;
}

/** The drop to show, or null (no drop, too small, expired, or not yet saved). */
export function priceDrop(p: PriceFields, now = new Date(), offerActive = false): PriceDrop | null {
  if (offerActive || p.price == null || p.previousPrice == null || !p.priceChangedAt) return null;
  if (!(p.previousPrice > p.price)) return null;
  const at = p.priceChangedAt.toMillis();
  if (!Number.isFinite(at)) return null;
  const until = at + PRICE_DROP_DAYS * DAY;
  if (now.getTime() > until || now.getTime() < at - DAY) return null;
  const pct = Math.round(((p.previousPrice - p.price) / p.previousPrice) * 100);
  if (pct < 1) return null;
  return { previous: p.previousPrice, pct, until: new Date(until) };
}

/**
 * How the drop fields change on save.
 *  - price changed  → previousPrice = the old price, priceChangedAt = "now" (server time)
 *  - price unchanged → keep both (an administrator may clear the tag: previousPrice = null)
 *  - new product     → no history
 */
export function nextPriceFields<T>(
  before: { price: number | null; previousPrice: number | null; priceChangedAt: T | null } | null,
  after: { price: number | null; previousPrice: number | null; priceChangedAt: T | null },
  now: T,
): { previousPrice: number | null; priceChangedAt: T | null } {
  if (!before) return { previousPrice: null, priceChangedAt: null };
  if (before.price !== after.price) return { previousPrice: before.price, priceChangedAt: now };
  return { previousPrice: after.previousPrice === null ? null : before.previousPrice, priceChangedAt: before.priceChangedAt };
}
