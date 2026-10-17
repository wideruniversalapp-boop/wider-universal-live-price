/**
 * Spreadsheet import planning. Pure functions only (no Firebase), so they are unit-tested
 * in tests/unit/importer.test.ts.
 *
 * Rules:
 *  - Rows are matched to existing products by normalized SKU (whitespace removed, upper-case).
 *  - Blank cells never overwrite existing values.
 *  - New products need sku, name and brand.
 *  - A SKU appearing twice in the file, or matching more than one existing product, is an error.
 *  - Rows that change nothing are skipped.
 */
import type { Product, ProductInput, ProductStatus, Spec, StockStatus } from '../types';
import { normalizeSku, slugId } from './format';

export const TEMPLATE_COLUMNS = [
  'sku', 'name', 'brand', 'model', 'category', 'subcategory', 'description', 'specifications',
  'price_sar', 'offer_price_sar', 'stock_status', 'stock_quantity', 'image_url', 'source_url',
  'datasheet_url', 'active',
] as const;

export type ImportRow = Record<string, unknown>;

export interface PlannedRow {
  row: number; // 1-based spreadsheet row number including header (first data row = 2)
  sku: string;
  action: 'create' | 'update' | 'skip' | 'error';
  errors: string[];
  id?: string;
  before?: Product | null;
  after?: ProductInput;
  changedFields: string[];
}

export interface ImportPlan {
  rows: PlannedRow[];
  counts: { create: number; update: number; skip: number; error: number };
  unknownColumns: string[];
  missingColumns: string[];
}

const STOCK_ALIASES: Record<string, StockStatus> = {
  in_stock: 'in_stock', 'in stock': 'in_stock', instock: 'in_stock', available: 'in_stock', yes: 'in_stock',
  low_stock: 'low_stock', 'low stock': 'low_stock', low: 'low_stock', limited: 'low_stock',
  out_of_stock: 'out_of_stock', 'out of stock': 'out_of_stock', outofstock: 'out_of_stock', no: 'out_of_stock', unavailable: 'out_of_stock',
  on_request: 'on_request', 'on request': 'on_request', request: 'on_request', 'available on request': 'on_request',
};

function cell(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function parseNumber(raw: string, field: string, errors: string[], integer = false): number | undefined {
  const cleaned = raw.replace(/,/g, '').replace(/^SAR\s*/i, '');
  const n = Number(cleaned);
  if (cleaned === '' || !Number.isFinite(n)) {
    errors.push(`${field}: "${raw}" is not a number`);
    return undefined;
  }
  if (n < 0) {
    errors.push(`${field}: must not be negative`);
    return undefined;
  }
  if (integer && !Number.isInteger(n)) {
    errors.push(`${field}: must be a whole number`);
    return undefined;
  }
  return Math.round(n * 100) / 100;
}

function parseBool(raw: string, errors: string[]): boolean | undefined {
  const v = raw.toLowerCase();
  if (['true', 'yes', 'y', '1', 'active', 'published'].includes(v)) return true;
  if (['false', 'no', 'n', '0', 'inactive', 'draft', 'hidden'].includes(v)) return false;
  errors.push(`active: "${raw}" must be true/false`);
  return undefined;
}

function parseUrl(raw: string, field: string, errors: string[]): string | undefined {
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' || u.protocol === 'http:') return raw;
  } catch {
    /* fallthrough */
  }
  errors.push(`${field}: "${raw}" is not a valid http(s) URL`);
  return undefined;
}

/** "Label: value" pairs separated by new lines, semicolons or " | ". */
export function parseSpecifications(raw: string): Spec[] {
  return raw
    .split(/\r?\n|;|\s\|\s/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':');
      return i > 0
        ? { label: s.slice(0, i).trim(), value: s.slice(i + 1).trim(), source: 'import' }
        : { label: '', value: s, source: 'import' };
    });
}

export function formatSpecifications(specs: Spec[]): string {
  return specs.map((s) => (s.label ? `${s.label}: ${s.value}` : s.value)).join('; ');
}

export function blankProduct(sku: string): ProductInput {
  return {
    sku, model: '', name: '', brand: '', category: '', subcategory: '', description: '',
    features: [], specs: [], imageUrl: null, imagePath: null, datasheetUrl: '', sourceUrl: '',
    price: null, offerPrice: null, offerStart: null, offerEnd: null, offerText: '', previousPrice: null, priceChangedAt: null,
    stockStatus: 'on_request', stockQty: null, status: 'draft', sortOrder: 0,
  };
}

export function newProductId(sku: string, taken: Set<string>): string {
  const base = `p-${slugId(sku)}`;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

export function planImport(rawRows: ImportRow[], existing: Product[]): ImportPlan {
  const headers = new Set<string>();
  rawRows.forEach((r) => Object.keys(r).forEach((k) => headers.add(k.trim().toLowerCase())));
  const known = new Set<string>(TEMPLATE_COLUMNS);
  const unknownColumns = [...headers].filter((h) => !known.has(h));
  const missingColumns = rawRows.length && !headers.has('sku') ? ['sku'] : [];

  const bySku = new Map<string, Product[]>();
  for (const p of existing) {
    const k = normalizeSku(p.sku);
    bySku.set(k, [...(bySku.get(k) ?? []), p]);
  }
  const takenIds = new Set(existing.map((p) => p.id));
  const seenInFile = new Map<string, number>();
  const rows: PlannedRow[] = [];

  rawRows.forEach((raw, idx) => {
    const r: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) r[k.trim().toLowerCase()] = cell(v);
    const rowNo = idx + 2;
    const errors: string[] = [];
    const skuRaw = r.sku ?? '';
    const sku = normalizeSku(skuRaw);

    if (Object.values(r).every((v) => v === '')) return; // fully blank line
    if (!sku) {
      rows.push({ row: rowNo, sku: '', action: 'error', errors: ['sku is required'], changedFields: [] });
      return;
    }
    if (seenInFile.has(sku)) {
      rows.push({ row: rowNo, sku, action: 'error', errors: [`duplicate SKU in file (first seen on row ${seenInFile.get(sku)})`], changedFields: [] });
      return;
    }
    seenInFile.set(sku, rowNo);

    const matches = bySku.get(sku) ?? [];
    if (matches.length > 1) {
      rows.push({ row: rowNo, sku, action: 'error', errors: [`SKU matches ${matches.length} existing products (${matches.map((m) => m.id).join(', ')}); resolve the duplicate first`], changedFields: [] });
      return;
    }
    const before = matches[0] ?? null;
    const base: ProductInput = before ? { ...stripMeta(before) } : blankProduct(sku);
    const next: ProductInput = { ...base, features: [...base.features], specs: [...base.specs] };

    const text = (col: string, key: keyof ProductInput) => {
      if (r[col]) (next as unknown as Record<string, unknown>)[key] = r[col];
    };
    text('name', 'name');
    text('brand', 'brand');
    text('model', 'model');
    text('category', 'category');
    text('subcategory', 'subcategory');
    text('description', 'description');
    if (r.specifications) next.specs = parseSpecifications(r.specifications);
    if (r.price_sar) {
      const v = parseNumber(r.price_sar, 'price_sar', errors);
      if (v !== undefined) next.price = v;
    }
    if (r.offer_price_sar) {
      const v = parseNumber(r.offer_price_sar, 'offer_price_sar', errors);
      if (v !== undefined) next.offerPrice = v === 0 ? null : v; // 0 clears an offer
    }
    if (r.stock_status) {
      const s = STOCK_ALIASES[r.stock_status.toLowerCase()];
      if (s) next.stockStatus = s;
      else errors.push(`stock_status: "${r.stock_status}" must be one of in_stock, low_stock, out_of_stock, on_request`);
    }
    if (r.stock_quantity) {
      const v = parseNumber(r.stock_quantity, 'stock_quantity', errors, true);
      if (v !== undefined) next.stockQty = v;
    }
    if (r.image_url) {
      const u = parseUrl(r.image_url, 'image_url', errors);
      if (u) {
        next.imageUrl = u;
        next.imagePath = null;
      }
    }
    if (r.source_url) {
      const u = parseUrl(r.source_url, 'source_url', errors);
      if (u) next.sourceUrl = u;
    }
    if (r.datasheet_url) {
      const u = parseUrl(r.datasheet_url, 'datasheet_url', errors);
      if (u) next.datasheetUrl = u;
    }
    if (r.active) {
      const b = parseBool(r.active, errors);
      if (b !== undefined) next.status = (b ? 'published' : before?.status === 'archived' ? 'archived' : 'draft') as ProductStatus;
    }

    if (!before) {
      if (!next.name) errors.push('name is required for new products');
      if (!next.brand) errors.push('brand is required for new products');
      next.model = next.model || skuRaw.trim();
    }
    if (next.offerPrice != null && next.price != null && next.offerPrice >= next.price) {
      errors.push(`offer_price_sar (${next.offerPrice}) must be lower than price_sar (${next.price})`);
    }
    if (next.offerPrice != null && next.price == null) errors.push('offer_price_sar requires a price_sar');

    if (errors.length) {
      rows.push({ row: rowNo, sku, action: 'error', errors, changedFields: [] });
      return;
    }
    const changedFields = before
      ? (Object.keys(next) as (keyof ProductInput)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(base[k]))
      : ['(new product)'];
    if (before && changedFields.length === 0) {
      rows.push({ row: rowNo, sku, action: 'skip', errors: [], id: before.id, before, after: next, changedFields });
      return;
    }
    rows.push({
      row: rowNo,
      sku,
      action: before ? 'update' : 'create',
      errors: [],
      id: before ? before.id : newProductId(sku, takenIds),
      before,
      after: next,
      changedFields: changedFields as string[],
    });
  });

  const counts = { create: 0, update: 0, skip: 0, error: 0 };
  rows.forEach((r) => counts[r.action]++);
  return { rows, counts, unknownColumns, missingColumns };
}

function stripMeta(p: Product): ProductInput {
  const { id: _i, searchText: _s, createdAt: _c, updatedAt: _u, updatedBy: _b, lastChangeId: _l, ...rest } = p;
  return rest;
}

export function productToRow(p: Product): Record<(typeof TEMPLATE_COLUMNS)[number], string | number> {
  return {
    sku: p.sku,
    name: p.name,
    brand: p.brand,
    model: p.model,
    category: p.category,
    subcategory: p.subcategory,
    description: p.description,
    specifications: formatSpecifications(p.specs),
    price_sar: p.price ?? '',
    offer_price_sar: p.offerPrice ?? '',
    stock_status: p.stockStatus,
    stock_quantity: p.stockQty ?? '',
    image_url: p.imageUrl ?? '',
    source_url: p.sourceUrl,
    datasheet_url: p.datasheetUrl,
    active: p.status === 'published' ? 'true' : 'false',
  };
}
