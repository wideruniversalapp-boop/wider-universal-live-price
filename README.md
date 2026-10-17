# Wider Universal Trading Company — Product Catalog

Public product catalog, administrator dashboard, spreadsheet import/export and PDF price list for
**WIDER UNIVERSAL TRADING COMPANY** (Riyadh, Saudi Arabia). React + TypeScript (Vite) on Firebase
Hosting, Authentication, Cloud Firestore and Cloud Storage.

| Deliverable | Location |
|---|---|
| Reference website audit | [REFERENCE_AUDIT.md](REFERENCE_AUDIT.md) |
| Extracted catalog (raw + cleaned) | [data/extracted_products.json](data/extracted_products.json), [data/extracted_products.csv](data/extracted_products.csv) |
| Extraction report / errors | [data/extraction_report.md](data/extraction_report.md), [data/extraction_errors.csv](data/extraction_errors.csv) |
| Reconciliation | [data/reconciled_products.csv](data/reconciled_products.csv), [extraction/output/reconciliation.md](extraction/output/reconciliation.md) |
| Specification completeness | [data/specification_completeness_report.csv](data/specification_completeness_report.csv) |
| Seed dataset for Firestore | [data/catalog_import.json](data/catalog_import.json) + `extraction/output/images/` |
| Extraction pipeline | [extraction/extract.py](extraction/extract.py), [extraction/reconcile.py](extraction/reconcile.py) |
| Website and admin source | [src/](src/) |
| Security rules and indexes | [firestore.rules](firestore.rules), [storage.rules](storage.rules), [firestore.indexes.json](firestore.indexes.json) |
| Migration / admin scripts | [scripts/](scripts/) |
| Automated tests | [tests/](tests/) — results in [TEST_REPORT.md](TEST_REPORT.md) |
| Deployment, domain, backups | [DEPLOYMENT.md](DEPLOYMENT.md) |
| PDF price import (2026-10-15 run) | [data/pdf_price_import/price_update_report.md](data/pdf_price_import/price_update_report.md) |
| Repeating a PDF price import | [PDF_PRICE_IMPORT_GUIDE.md](PDF_PRICE_IMPORT_GUIDE.md) |
| Branding, website settings & security changes | [BRANDING_AND_SECURITY_CHANGES.md](BRANDING_AND_SECURITY_CHANGES.md) |
| Contact page, contact management & header | [CONTACT_PAGE_CHANGES.md](CONTACT_PAGE_CHANGES.md) |
| Catalog redesign & quote list | [CATALOG_REDESIGN_CHANGES.md](CATALOG_REDESIGN_CHANGES.md) |
| Guide and user manual (non-technical) | [Documentation/Wider_Universal_Website_Guide.md](Documentation/Wider_Universal_Website_Guide.md) and [PDF](Documentation/Wider_Universal_Website_Guide.pdf) |

## Architecture

```
Browser (React SPA, Firebase Hosting)
  ├─ public pages  ── read ──▶ Firestore products (status == "published"), settings/public, brands, categories
  │                            Storage products/** (images)
  └─ /admin        ── read/write (custom claim admin == true) ──▶ products, productSources, priceHistory,
                                                                   importJobs, settings, brands, categories, Storage
Admin SDK scripts (your machine / CI, service account) ──▶ seed catalog, grant/revoke admin claim, verify import
```

Collections:

| Collection | Purpose | Public read |
|---|---|---|
| `products` | Catalog records with **Wider Universal** selling price, offer, stock, visibility | only `status == "published"` |
| `productSources` | Reference data from the extracted source (source price, exact model, issues, verification) | no |
| `priceHistory` | Append-only change sets: who, when, field, from, to | no |
| `importJobs` (+ `chunks`) | Import summaries and pre-import snapshots for revert | no |
| `catalogIndex` (`meta`, `part-N`) | Compact copy of published products' public fields for the catalog page (3 reads per visit instead of ~1,300) | yes |
| `brands`, `categories` | Names and display order | yes |
| `settings/site` | Published branding, header, footer, page texts, contact and PDF settings (edited in Admin → Website settings) | yes |
| `contactDirectory/published` | Branches and sales contacts for the public /contact page (edited in Admin → Contacts) | yes |
| `settingsHistory` | Append-only audit trail of website settings and contact changes | no |
| `settings/public` | Legacy company details (read as fallback only) | yes |
| `users` | Admin profile mirror (written only by `scripts/set-admin.ts`) | own doc only |

### Price separation

* Source prices (from the reference site) are stored **only** in `productSources`, which the public cannot read.
* Public `products.price` / `offerPrice` are Wider Universal prices. The migration leaves them empty, so every product
  shows **"Price on request"** until an administrator sets prices — individually, by spreadsheet import, or with the
  bulk action *Price from source…* (explicit, per selection, with a markup %, and fully audited).
* The PDF generator only receives `products` records, so it cannot print source prices.

### Public catalog index

The catalog page reads `catalogIndex/meta` plus 2 part documents (~550 KB in total) instead of every product document.
The admin dashboard rebuilds the index automatically a moment after any product change (it compares a hash first),
the seed and PDF-import scripts rebuild it after bulk writes, and `npm run index:rebuild -- …` or
Dashboard → *Check public catalog index* rebuild it on demand. If the index is missing or mid-update, the catalog
falls back to querying `products` directly. Product detail pages always read the full product document.

### Security model

* Administrator = Firebase Auth user whose ID token has the custom claim `admin: true`. The claim is set only by
  `scripts/set-admin.ts` (Admin SDK). There is no sign-up page and no client path to obtain the claim.
* Firestore and Storage rules enforce it; the `/admin` route guard is only a convenience.
* Every write that changes price, offer, offer dates, stock status or quantity must be committed in the same batch as a
  `priceHistory` document by the same administrator at the same server time; the rules verify this with `getAfter()`.
* History is append-only (no update/delete).
* Product documents are schema-validated by the rules (allowed keys, types, offer < price, enum values).

## Local development

Requirements: Node.js 20+, Java 11+ (Firestore emulator), Python 3.10+ (extraction only).

```bash
npm install
```

```bash
npm run emulators
```

In a second terminal, load the catalog and create a local administrator (emulator only):

```bash
npm run seed:emulator
```

```bash
ADMIN_PASSWORD='choose-a-local-password' npm run set-admin -- --emulator --project demo-wider --email admin@wider-universal.test --create
```

Then start the app (uses `.env.development.local`, which points at the emulators):

```bash
npm run dev
```

Open http://localhost:5173 (catalog) and http://localhost:5173/admin (dashboard). Emulator UI: http://localhost:4000.

## Tests

```bash
npm run test:all
```

* `npm test` — unit tests (import planning/validation, search/filter/sort, offers, PDF content).
* `npm run test:rules` — Firestore and Storage security rules in the emulators.
* `npm run verify:emulator` — compares the seeded database with `data/catalog_import.json`.

## Administrator guide

| Task | Where |
|---|---|
| Dashboard counts (active, in stock, low, out, offers, missing info) | `/admin` |
| Find / filter / bulk publish, unpublish, archive, set stock, clear offers, set prices from source, export selection | `/admin/products` |
| Edit a product (SKU, model, specs table, features, prices, offer dates, stock, visibility, image upload, delete) | `/admin/products/:id` |
| Review source data and mark verification status | product page → *Source & verification* |
| Brands and categories (add, rename across products, reorder, delete unused) | `/admin/taxonomy` |
| Spreadsheet template, upload, preview, commit, history, revert, full export | `/admin/import` |
| PDF price list (all, or chosen brands/categories; availability; features) | `/admin/price-list` |
| Audit trail | `/admin/history` |
| Branding, logo, header, footer, page texts, contact details, PDF branding, settings history, access overview | `/admin/settings` |
| Branch contacts on the Contact page (add/edit/hide/reorder branches and people) | `/admin/contacts` |

Import columns: `sku, name, brand, model, category, subcategory, description, specifications, price_sar,
offer_price_sar, stock_status, stock_quantity, image_url, source_url, datasheet_url, active`. Matching is by normalized
SKU; blank cells keep existing values; duplicate or ambiguous SKUs are rejected row by row.

## Re-running the extraction

`npm run extract` re-runs `extraction/extract.py` (reads the reference site's public catalog) and
`extraction/reconcile.py`. Then `npm run seed -- …` adds new products and refreshes `productSources` without touching
administrator-managed fields. Review the reference site's terms before re-running, and see
[data/extraction_report.md](data/extraction_report.md) for content-rights notes.

## Logo and website content

The official logo is in `public/brand/`. Company details, logo, header, footer, page texts and PDF branding are edited in
**Admin → Website settings** and stored in `settings/site`; no code change or redeploy is needed. A replacement logo
can be uploaded there (PNG/JPEG/WebP, max 2 MB).
