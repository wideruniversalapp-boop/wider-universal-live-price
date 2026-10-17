import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, filterProducts } from '../../src/lib/catalogFilter';
import { activeOffer, buildSearchText, effectivePrice, formatSar, normalizeSku } from '../../src/lib/format';
import { buildPriceList } from '../../src/lib/pdf';
import { DEFAULT_SITE_CONFIG as DEFAULT_SETTINGS } from '../../src/lib/siteConfig';
import { product, ts } from './fixtures';

const withSearch = (p: ReturnType<typeof product>) => ({ ...p, searchText: buildSearchText(p) });

const catalog = [
  withSearch(product({ id: '1', sku: 'DH-SD5A825MA-HNR', model: 'DH-SD5A825MA-HNR', name: '8MP PTZ Camera', brand: 'Dahua', category: 'PTZ', price: 3636 })),
  withSearch(product({ id: '2', sku: 'AJAX-HUB2', model: 'Hub 2', name: 'Control panel', brand: 'Ajax', category: 'Hubs', price: 900, offerPrice: 800 })),
  withSearch(product({ id: '3', sku: 'IMOU-A1', model: 'IPC-A22EP', name: 'Indoor WiFi camera', brand: 'Imou', category: 'WiFi', price: null, stockStatus: 'out_of_stock' })),
];

describe('catalog filtering', () => {
  it('searches by model, SKU and name terms', () => {
    expect(filterProducts(catalog, { ...EMPTY_FILTER, q: 'sd5a825' }).map((p) => p.id)).toEqual(['1']);
    expect(filterProducts(catalog, { ...EMPTY_FILTER, q: 'wifi camera' }).map((p) => p.id)).toEqual(['3']);
    expect(filterProducts(catalog, { ...EMPTY_FILTER, q: 'ajax hub2' }).map((p) => p.id)).toEqual(['2']);
  });

  it('filters by brand, category, offers and stock', () => {
    expect(filterProducts(catalog, { ...EMPTY_FILTER, brand: 'Ajax' }).map((p) => p.id)).toEqual(['2']);
    expect(filterProducts(catalog, { ...EMPTY_FILTER, category: 'PTZ' }).map((p) => p.id)).toEqual(['1']);
    expect(filterProducts(catalog, { ...EMPTY_FILTER, offersOnly: true }).map((p) => p.id)).toEqual(['2']);
    expect(filterProducts(catalog, { ...EMPTY_FILTER, inStockOnly: true }).map((p) => p.id)).toEqual(['2', '1']);
  });

  it('sorts by effective price with "on request" last, and alphabetically', () => {
    expect(filterProducts(catalog, { ...EMPTY_FILTER, sort: 'price-asc' }).map((p) => p.id)).toEqual(['2', '1', '3']);
    expect(filterProducts(catalog, { ...EMPTY_FILTER, sort: 'price-desc' }).map((p) => p.id)).toEqual(['1', '2', '3']);
    expect(filterProducts(catalog, { ...EMPTY_FILTER, sort: 'name-asc' }).map((p) => p.name)).toEqual(['8MP PTZ Camera', 'Control panel', 'Indoor WiFi camera']);
  });
});

describe('offers and formatting', () => {
  it('honours offer date windows', () => {
    const now = new Date('2026-10-15T12:00:00Z');
    const base = product({ price: 100, offerPrice: 80 });
    expect(activeOffer(base, now)).toBe(true);
    expect(activeOffer({ ...base, offerStart: ts('2026-10-20T00:00:00Z') }, now)).toBe(false);
    expect(activeOffer({ ...base, offerEnd: ts('2026-10-01T00:00:00Z') }, now)).toBe(false);
    expect(activeOffer({ ...base, offerPrice: 120 }, now)).toBe(false);
    expect(effectivePrice(base, now)).toBe(80);
  });

  it('formats SAR and normalizes SKUs without altering characters', () => {
    expect(formatSar(null)).toBe('Price on request');
    expect(formatSar(1250)).toContain('1,250');
    expect(normalizeSku(' dh-ipc hfw/2441 ')).toBe('DH-IPCHFW/2441');
  });
});

describe('PDF price list', () => {
  it('includes published products and selling prices only', () => {
    const pdf = buildPriceList(
      [...catalog, product({ id: '9', sku: 'HIDDEN-1', model: 'HIDDEN-1', status: 'draft', price: 1 })],
      DEFAULT_SETTINGS,
      { includeStock: true, includeFeatures: false },
    );
    const text = new TextDecoder('latin1').decode(pdf.output('arraybuffer'));
    expect(text).toContain('DH-SD5A825MA-HNR');
    expect(text).toContain('3,636.00');
    expect(text).toContain('On request');
    expect(text).toContain('WIDER UNIVERSAL TRADING COMPANY');
    expect(text).not.toContain('HIDDEN-1');
    expect(text).toContain('Page 1 of');
  });

  it('filters by category', () => {
    const pdf = buildPriceList(catalog, DEFAULT_SETTINGS, { includeStock: false, includeFeatures: false, categories: ['Hubs'] });
    const text = new TextDecoder('latin1').decode(pdf.output('arraybuffer'));
    expect(text).toContain('Hub 2');
    expect(text).not.toContain('DH-SD5A825MA-HNR');
  });
});
