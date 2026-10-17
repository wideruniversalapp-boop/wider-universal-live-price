import type { Timestamp } from 'firebase/firestore';

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'on_request';
export type ProductStatus = 'published' | 'draft' | 'archived';

export interface Spec {
  label: string;
  value: string;
  source?: string;
  sourceUrl?: string;
}

/** Public catalog record (collection `products`). Contains Wider Universal prices only. */
export interface Product {
  id: string;
  sku: string;
  model: string;
  name: string;
  brand: string;
  category: string;
  subcategory: string;
  description: string;
  features: string[];
  specs: Spec[];
  imageUrl: string | null;
  imagePath: string | null;
  datasheetUrl: string;
  /** Optional internal reference link (not shown publicly). */
  sourceUrl: string;
  price: number | null;
  offerPrice: number | null;
  offerStart: Timestamp | null;
  offerEnd: Timestamp | null;
  offerText: string;
  /** Selling price before the last price change (set automatically; see lib/priceDrop.ts). */
  previousPrice: number | null;
  priceChangedAt: Timestamp | null;
  stockStatus: StockStatus;
  stockQty: number | null;
  status: ProductStatus;
  searchText: string;
  sortOrder: number;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  updatedBy?: string;
  lastChangeId?: string;
}

export type ProductInput = Omit<Product, 'id' | 'searchText' | 'createdAt' | 'updatedAt' | 'updatedBy' | 'lastChangeId'>;

/** Admin-only reference data from the extracted source catalog (collection `productSources`). */
export interface ProductSource {
  system: string;
  docId: string;
  url: string;
  price: number | null;
  currency: string;
  discountPct: number | null;
  regularPriceComputed: number | null;
  offerDescription: string | null;
  category: string;
  subcategory: string;
  brand: string;
  modelExact: string;
  updateTime: string;
  extractedAt: string;
  verification: string;
  issues: string[];
  reviewNotes?: string;
  reviewedBy?: string;
  reviewedAt?: Timestamp;
  /** Price read from a supplied PDF price list (see extraction/pdf_prices.py). */
  pdfListPrice?: number;
  pdfPriceText?: string;
  pdfFile?: string;
  pdfPage?: number;
  pdfRow?: number;
  pdfModel?: string;
  pdfMatchStatus?: string;
  pdfMatchMethod?: string;
  pdfImportJobId?: string;
  pdfImportedAt?: Timestamp;
}

export interface Brand {
  id: string;
  name: string;
  order: number;
  /** Brand spotlight on the catalog home (all optional). */
  headline?: string;
  subtitle?: string;
  /** Storage path under brands/<id>/ of an uploaded banner image. */
  bannerPath?: string;
}

export interface Category {
  id: string;
  name: string;
  order: number;
}

export interface FieldChange {
  productId: string;
  sku: string;
  field: string;
  from: unknown;
  to: unknown;
}

export interface ChangeSet {
  id: string;
  by: string;
  byEmail: string;
  at: Timestamp;
  reason: 'manual' | 'import' | 'bulk' | 'revert' | 'create';
  importJobId?: string | null;
  productIds: string[];
  changes: FieldChange[];
}

export interface ImportJob {
  id: string;
  by: string;
  byEmail: string;
  fileName: string;
  createdAt: Timestamp;
  status: 'committing' | 'completed' | 'failed' | 'reverted';
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { row: number; sku: string; message: string }[];
  changeSetIds: string[];
  type?: 'spreadsheet' | 'pdf-price';
  referenceOnly?: boolean;
  /** PDF imports: rows that were not applied and need a person to check them. */
  review?: { status: string; model: string; priceText: string; file: string; page: number; row: number; productId: string; warnings: string }[];
}
