import { describe, expect, it } from 'vitest';
import { addItem, buildMessage, clampQty, MAX_ITEMS, mailtoQuote, parseStored, removeItem, setQty, shorten, totals, whatsappTo, type QuoteItem } from '../../src/lib/quote';

const cam = { id: 'a', model: 'IPC-S2VN-5M0WR', sku: 'IPC-S2VN-5M0WR', name: 'Pan & tilt camera', brand: 'Imou', unitPrice: 175 };
const ups = { id: 'b', model: 'NJOY CADU 1 KVA', sku: 'NJOYCADU1KVA', name: 'UPS Cadu 1000 VA', brand: 'NJOY', unitPrice: null };

describe('quote list', () => {
  it('adds, merges quantities, updates, removes and totals', () => {
    let l: QuoteItem[] = [];
    l = addItem(l, cam, 2);
    l = addItem(l, cam, 3);
    l = addItem(l, ups);
    expect(l.map((i) => [i.id, i.qty])).toEqual([['a', 5], ['b', 1]]);
    l = setQty(l, 'b', 0);
    expect(l[1].qty).toBe(1);
    expect(totals(l)).toEqual({ units: 6, priced: 875, onRequest: 1 });
    l = removeItem(l, 'a');
    expect(l.map((i) => i.id)).toEqual(['b']);
  });

  it('clamps quantities and caps the list size', () => {
    expect([clampQty(0), clampQty(-5), clampQty(2.6), clampQty(1e9), clampQty(NaN)]).toEqual([1, 1, 3, 9999, 1]);
    let l: QuoteItem[] = [];
    for (let i = 0; i < MAX_ITEMS + 5; i++) l = addItem(l, { ...cam, id: `p${i}` });
    expect(l).toHaveLength(MAX_ITEMS);
  });

  it('builds a readable request with prices, on-request items and optional details', () => {
    const l = addItem(addItem([], cam, 2), ups);
    const msg = buildMessage(l, { name: 'Ali', company: 'ACME', phone: '', notes: 'Deliver to Riyadh' }, 'Riyadh Branch', 'WIDER UNIVERSAL TRADING COMPANY');
    expect(msg).toContain('Quotation request — WIDER UNIVERSAL TRADING COMPANY (Riyadh Branch)');
    expect(msg).toContain('1. IPC-S2VN-5M0WR — Imou — Pan & tilt camera × 2 (list SAR 175 each)');
    expect(msg).toContain('2. NJOY CADU 1 KVA [NJOYCADU1KVA] — NJOY — UPS Cadu 1000 VA × 1 (price on request)');
    expect(msg).toContain('Items: 2 · Units: 3 · List total: SAR 350 + items on request');
    expect(msg).toContain('Name: Ali\nCompany: ACME');
    expect(msg).not.toContain('Phone:');
    expect(msg).toContain('Notes: Deliver to Riyadh');
  });

  it('shortens long product names in the message', () => {
    expect(shorten('x'.repeat(100))).toHaveLength(70);
    expect(shorten('short')).toBe('short');
  });

  it('builds WhatsApp and email links to the chosen contact', () => {
    expect(whatsappTo('+966 51 121 1028', 'Hi & bye')).toBe('https://wa.me/966511211028?text=Hi%20%26%20bye');
    expect(whatsappTo('12', 'x')).toBeNull();
    expect(mailtoQuote('Salesjeddah@wideruniversal.com', 'Quotation request', 'a\nb')).toBe('mailto:Salesjeddah@wideruniversal.com?subject=Quotation%20request&body=a%0Ab');
  });

  it('reads stored lists defensively', () => {
    expect(parseStored(null)).toEqual([]);
    expect(parseStored('not json')).toEqual([]);
    expect(parseStored('{"a":1}')).toEqual([]);
    const l = parseStored(JSON.stringify([{ id: 'a', model: 'M', qty: '7', unitPrice: -1 }, { bad: true }, null]));
    expect(l).toEqual([{ id: 'a', model: 'M', sku: '', name: '', brand: '', unitPrice: null, qty: 7 }]);
  });
});
