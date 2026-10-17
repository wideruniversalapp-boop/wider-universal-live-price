# Extraction Report

Source: https://simatsecurity-live-price.web.app/ (Cloud Firestore project `simatsecurity-live-price`)
Extraction timestamp: see `extracted_at` in `extracted_products.json` (2026-10-15, UTC)
Pipeline: `extraction/extract.py` (extraction) and `extraction/reconcile.py` (validation, local only)

## 1. Method

1. Replicated the website's own anonymous query (`products` ordered by `displayOrder`) through the Firestore REST API, paging with a cursor (`displayOrder`, document name) in pages of 200 until a page returned fewer than 200 rows.
2. Listed the entire `products` collection independently (IDs only) to reconcile.
3. Decoded inline base64 images to files (`extraction/output/images/`, 1,110 files, ~12 MB).
4. Read the public `brands` (5) and `settings` (global, contacts) documents.

No credentials were used and no access control was bypassed; every read is one the website performs for any visitor.

## 2. Reconciliation

| Source | Source Count | Extracted Count | Unique Records | Duplicate Records | Missing Fields | Status |
|---|---|---|---|---|---|---|
| Firestore `products` | 1,291 (full collection listing) | 1,291 | 1,291 | 4 records share a model with another record (flagged, not merged) | 6 records require verification | RECONCILED |
| Website per-brand counter (Dahua) | 700 shown on site | 700 | 700 | — | — | RECONCILED |
| Firestore `brands` | 5 | 5 | 5 | 0 | — | RECONCILED |

Stopping condition: the API returned a short page (91 < 200) and the unordered listing produced the same 1,291 IDs. **Every product document in the public catalog was extracted.**

Distinct normalized model numbers: 1,287.

## 3. Completeness

| Measure | Products |
|---|---|
| Verified model number (from source) | 1,291 |
| Verified source price (SAR, > 0) | 1,291 |
| Product image | 1,110 (181 NOT FOUND) |
| Feature lines parsed from description | 538 |
| Description present (any text) | 1,291 |
| Structured key/value technical specifications | 0 — not published by source |
| Manufacturer datasheet / product link | 1 |
| Stock status | 0 — not published by source |
| Products on offer (`discount` > 0) | 3 |
| Offer terms text | 74 |
| Duplicate model groups | 4 (DH-SD5A825MA-HNR, DH-SDT6C432-4P-GB-APV-0280, DH-HAC-HFW1801THN-I8-A, DH-HAC-HFW1500RLN-IL-A) |
| Model numbers with stray whitespace (trimmed in cleaned set; exact value kept) | 14 |
| `category` value is a spreadsheet artefact ("Price List", "Sheet1", "Inventory Summary", "General", "Dahua") | 649 — cleaned dataset uses `subcategory` as the category |

Per-product detail: `specification_completeness_report.csv`, `reconciled_products.csv`. Errors: `extraction_errors.csv` (189 rows: 181 no image, 8 shared model).

## 4. Phase 3 — technical specifications: NOT COMPLETED

Manufacturer enrichment (Dahua, Ajax, Imou, YLI, etc. datasheets) was **not performed** in this run. The automated-action safety classifier of the working environment stopped further changes to the third-party data pipeline after the base extraction, so no manufacturer-site crawling was attempted. Consequently:

- No specification in the dataset comes from anywhere other than the Simat description text (`spec_source = source:description`).
- 753 products have no parsed feature lines (single-line or unmarked descriptions); their full description text is still preserved.
- Field `manufacturer_enriched` is `NO` for every record.

Next lawful sources to complete specifications (by exact model number):

| Brand | Official source |
|---|---|
| Dahua / DAHUA Wissualram fire alarm | dahuasecurity.com product pages and datasheets (MENA) |
| Ajax | ajax.systems product pages and datasheets |
| Imou | imoulife.com product pages |
| Legrand (KEOR UPS) | legrand.com product catalogue |
| YLI, Fyber, ITC, NJOY, Starlink | manufacturer or distributor datasheets |

The admin dashboard supports adding spec rows per product with a source URL, so enrichment can be done manually or by a later approved pipeline.

## 5. Image and content rights

Product photos and descriptions are largely manufacturer marketing material redistributed by the reference site. Confirm the right to reuse them before publishing; replacing them with images from manufacturer partner portals is recommended. The seed script uploads them so the catalog is not empty, and every image can be replaced from the admin dashboard.
