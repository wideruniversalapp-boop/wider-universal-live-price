/**
 * Visitor quote list ("request a quotation" basket).
 *
 * Kept only in the visitor's own browser (localStorage) — nothing is stored on the server.
 * The visitor sends the list to a branch contact by WhatsApp or email; the message is built
 * here from the items and the optional details they typed.
 */
import { telHref } from './contacts';

export interface QuoteItem {
  id: string;
  model: string;
  sku: string;
  name: string;
  brand: string;
  /** Unit price shown when added (offer price if an offer was active); null = on request. */
  unitPrice: number | null;
  qty: number;
}

export interface QuoteCustomer {
  name: string;
  company: string;
  phone: string;
  notes: string;
}

export const MAX_ITEMS = 60;
export const MAX_QTY = 9999;

export function clampQty(q: number): number {
  if (!Number.isFinite(q)) return 1;
  return Math.min(MAX_QTY, Math.max(1, Math.round(q)));
}

export function addItem(list: QuoteItem[], item: Omit<QuoteItem, 'qty'>, qty = 1): QuoteItem[] {
  const existing = list.find((i) => i.id === item.id);
  if (existing) return list.map((i) => (i.id === item.id ? { ...i, ...item, qty: clampQty(i.qty + qty) } : i));
  if (list.length >= MAX_ITEMS) return list;
  return [...list, { ...item, qty: clampQty(qty) }];
}

export function setQty(list: QuoteItem[], id: string, qty: number): QuoteItem[] {
  return list.map((i) => (i.id === id ? { ...i, qty: clampQty(qty) } : i));
}

export function removeItem(list: QuoteItem[], id: string): QuoteItem[] {
  return list.filter((i) => i.id !== id);
}

export function totals(list: QuoteItem[]): { units: number; priced: number; onRequest: number } {
  return {
    units: list.reduce((n, i) => n + i.qty, 0),
    priced: Math.round(list.reduce((n, i) => n + (i.unitPrice ?? 0) * i.qty, 0) * 100) / 100,
    onRequest: list.filter((i) => i.unitPrice == null).length,
  };
}

/** Product names can be long marketing text; keep each message line readable. */
export const shorten = (s: string, max = 70) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

const sar = (v: number) => `SAR ${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** Plain-text quotation request used for WhatsApp and email. */
export function buildMessage(list: QuoteItem[], customer: QuoteCustomer, branchName: string, companyName: string): string {
  const t = totals(list);
  const lines = [
    `Quotation request — ${companyName}${branchName ? ` (${branchName})` : ''}`,
    '',
    ...list.map((i, n) => `${n + 1}. ${i.model}${i.sku && i.sku !== i.model ? ` [${i.sku}]` : ''} — ${i.brand} — ${shorten(i.name)} × ${i.qty}${i.unitPrice != null ? ` (list ${sar(i.unitPrice)} each)` : ' (price on request)'}`),
    '',
    `Items: ${list.length} · Units: ${t.units}${t.priced ? ` · List total: ${sar(t.priced)}${t.onRequest ? ' + items on request' : ''}` : ''}`,
  ];
  const who = [
    customer.name && `Name: ${customer.name}`,
    customer.company && `Company: ${customer.company}`,
    customer.phone && `Phone: ${customer.phone}`,
  ].filter(Boolean) as string[];
  if (who.length) lines.push('', ...who);
  if (customer.notes.trim()) lines.push('', `Notes: ${customer.notes.trim()}`);
  return lines.join('\n');
}

/** wa.me link for a phone number such as "+966 51 121 1028". */
export function whatsappTo(phone: string, text: string): string | null {
  const digits = telHref(phone).replace(/^tel:\+?/, '');
  return digits.length >= 8 ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

/** Many mail apps truncate very long mailto links; above this the page offers "Copy" instead. */
export const MAILTO_SAFE_LENGTH = 1800;

export function mailtoQuote(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Defensive parse of the stored list. */
export function parseStored(raw: string | null): QuoteItem[] {
  try {
    const v = JSON.parse(raw ?? '[]');
    if (!Array.isArray(v)) return [];
    return v
      .filter((i) => i && typeof i.id === 'string' && typeof i.model === 'string')
      .slice(0, MAX_ITEMS)
      .map((i) => ({
        id: i.id,
        model: String(i.model).slice(0, 120),
        sku: String(i.sku ?? '').slice(0, 120),
        name: String(i.name ?? '').slice(0, 300),
        brand: String(i.brand ?? '').slice(0, 120),
        unitPrice: typeof i.unitPrice === 'number' && i.unitPrice >= 0 ? i.unitPrice : null,
        qty: clampQty(Number(i.qty)),
      }));
  } catch {
    return [];
  }
}
