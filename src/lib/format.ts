import type { Product, Spec, StockStatus } from '../types';
import { priceDrop } from './priceDrop';

export const COMPANY = {
  name: 'WIDER UNIVERSAL TRADING COMPANY',
  shortName: 'Wider Universal',
  location: 'Riyadh, Saudi Arabia',
  phone: '+966 55 482 2231',
  whatsapp: '966554822231',
  email: 'sales@theuniversaltrading.com',
};

const sar = new Intl.NumberFormat('en-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 2 });

export function formatSar(v: number | null | undefined): string {
  return v == null ? 'Price on request' : sar.format(v).replace(/ /g, ' ');
}

export const STOCK_LABELS: Record<StockStatus, string> = {
  in_stock: 'In stock',
  low_stock: 'Low stock',
  out_of_stock: 'Out of stock',
  on_request: 'Available on request',
};

/** An offer is active when an offer price exists and today falls inside the optional date window. */
export function activeOffer(p: Pick<Product, 'offerPrice' | 'price' | 'offerStart' | 'offerEnd'>, now = new Date()): boolean {
  if (p.offerPrice == null || p.price == null || p.offerPrice >= p.price) return false;
  if (p.offerStart && p.offerStart.toDate() > now) return false;
  if (p.offerEnd && p.offerEnd.toDate() < now) return false;
  return true;
}

export function effectivePrice(p: Product, now = new Date()): number | null {
  return activeOffer(p, now) ? p.offerPrice : p.price;
}

export function discountPct(p: Product): number | null {
  if (!activeOffer(p) || !p.price || p.offerPrice == null) return null;
  return Math.round((1 - p.offerPrice / p.price) * 100);
}

export function normalizeSku(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, '').toUpperCase();
}

export function buildSearchText(p: Pick<Product, 'name' | 'model' | 'sku' | 'brand' | 'category' | 'subcategory'>): string {
  return [p.name, p.model, p.sku, p.brand, p.category, p.subcategory].filter(Boolean).join(' ').toLowerCase();
}

export function whatsappLink(number: string, text: string): string {
  return `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

export function slugId(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'item';
}

/**
 * Feature lines written as "Label: value" become specification rows; the rest stay as
 * a bullet list. Text is shown as published — nothing is reworded or inferred.
 */
export function splitFeatures(features: string[]): { rows: Spec[]; bullets: string[] } {
  const rows: Spec[] = [];
  const bullets: string[] = [];
  for (const f of features) {
    const m = f.match(/^([^:：]{2,40})[:：]\s*(.+)$/);
    if (m && !m[2].startsWith('//')) rows.push({ label: m[1].trim(), value: m[2].trim() }); // skip URLs
    else bullets.push(f);
  }
  return { rows, bullets };
}

/** Price-drop tag for a product (null when there is none to show). */
export function productPriceDrop(p: Product, now = new Date()) {
  return priceDrop(p, now, activeOffer(p, now));
}
