# Reference Website Audit — simatsecurity-live-price.web.app

Audit date: 2026-10-15
Auditor: automated inspection (HTTP fetch of public HTML/JS, in-app browser, anonymous Firestore REST reads)

Status labels: **VERIFIED** (observed directly), **PARTIALLY VERIFIED** (observed indirectly or incompletely), **NOT VERIFIED** (not confirmed).

## 1. Architecture

| Finding | Status | Evidence |
|---|---|---|
| Next.js (App Router, Turbopack build) static export hosted on Firebase Hosting | VERIFIED | `/_next/static/chunks/*` assets, `/__/firebase/init.json` served by Hosting |
| Firebase project `simatsecurity-live-price` (Firestore, Auth, Storage bucket configured) | VERIFIED | `/__/firebase/init.json` |
| No Realtime Database in use (`databaseURL` empty) | VERIFIED | `init.json` |
| Product data is read client-side from Cloud Firestore collection `products` | VERIFIED | JS bundle: `query(collection(db,"products"), orderBy("displayOrder"), limit(1500))` with `startAfter(cursor)` for Load More |
| Brand banners from collection `brands` | VERIFIED | JS bundle + anonymous read returned 5 docs |
| Site settings from `settings/global` and contact list from `settings/contacts` (realtime `onSnapshot`) | VERIFIED | JS bundle + anonymous read |
| A page-view counter document `analytics/total` exists | PARTIALLY VERIFIED | Referenced in bundle; not read (not needed) |
| Product images are stored inline in Firestore as base64 data URIs (`imageBase64`), not in Storage | VERIFIED | Field contents of returned documents |
| No public REST API, sitemap, JSON feed, CSV export or per-product URL | VERIFIED (for what was inspected) | Products open as expandable rows on one page; no product routes found |

Security note: the Firebase web API key is a public identifier, not a credential. Access was limited to what the Firestore Security Rules already allow anonymous visitors to read — exactly the reads the website performs for every visitor. No authentication, admin pages, or restricted paths were accessed or probed.

## 2. Website features

| Feature | Status | Notes |
|---|---|---|
| Brand hero banner carousel per brand | VERIFIED | e.g. "Dahua Solutions" |
| Search by model or product name | VERIFIED | Search box "Search by model or product name..." |
| Brand tabs (Dahua, Imou, Dahua Wissualram Fire Alarm, Fyber, ITC, Legrand, NJOY, Other Products, Starlink, YLI, Ajax) | VERIFIED | Brand filter row |
| "Offers" tab | VERIFIED | Visible tab; offers are products with `discount` > 0 |
| Item counter per brand ("700 Items Found" for Dahua) | VERIFIED | Matches extracted count for Dahua (700) |
| Load More pagination (page size 1500, cursor on `displayOrder`) | VERIFIED | Bundle code |
| Product rows: model badge, brand, name, price in SAR; expand for description | VERIFIED | Screenshot |
| Discount display: struck "was" price = `currentPrice / (1 - discount/100)`, `-N%` badge, green offer box from `offerDescription` | VERIFIED | Bundle code. The regular price is **computed**, not stored |
| Downloadable PDF price list ("Download Price List (PDF)") generated client-side | PARTIALLY VERIFIED | Button present; jsPDF-style code in bundle; file not downloaded |
| Regional contacts with call / WhatsApp links | VERIFIED | Page text |
| `/admin/login` (Firebase Auth) | VERIFIED (link only) | Not accessed |
| Mobile layout (hamburger menu, mobile banners `/banners/mobile/*`) | PARTIALLY VERIFIED | Markup only |
| Maintenance mode banner controlled by `settings/global.maintenanceMode` | VERIFIED | Bundle + settings doc |

## 3. Extraction method that works

| Method | Result |
|---|---|
| Anonymous Firestore `runQuery` replicating the site query (`orderBy displayOrder`, cursor pagination, page size 200) | **Works** — 1,291 documents in 7 pages, stops when page < page size |
| Anonymous unordered collection listing (IDs only) for reconciliation | **Works** — 1,291 IDs; 0 documents missing from the site query |
| HTML scraping / browser automation | Not needed (data source available directly) |
| Downloadable PDF | Not used (generated client-side from the same data) |

Pipeline: `extraction/extract.py` (rerunnable, keyed by Firestore doc ID; images rewritten only when hash changes).

**Complete catalog accessible: VERIFIED.** The ordered query (what the website shows) and the full collection listing both return 1,291 records, and the per-brand count shown on the site (Dahua 700) matches.

## 4. Product fields

| Source field | Present in | Meaning |
|---|---|---|
| `model` | 1291 | Model number (exact; 14 have leading/trailing spaces) |
| `productName` | 1291 | Name / headline |
| `description` | 1291 | Free text; feature lines with `>`, `*`, `•` bullets on 538 records |
| `brand` | 1291 | 11 distinct values |
| `category` / `subcategory` | 1291 | Category often a spreadsheet artefact ("Price List", "Sheet1", "Inventory Summary"); subcategory carries the real family |
| `currentPrice` | 1291 | Displayed price in SAR (already discounted when `discount` set) |
| `oldPrice`, `priceChange` | 1291 / 1004 | Previous price and delta (price-change tracking) |
| `discount` | 613 (non-zero on 3) | Discount %; only 3 products currently on offer |
| `offerDescription` | 74 | Offer terms text |
| `imageBase64` | 1110 with image, 181 empty | Inline product image |
| `officialSiteUrl` | 80 (non-empty on 1) | Manufacturer product page |
| `visibility` | 1085 (`public`), 206 absent | All 1,291 are returned by the public site query |
| `displayOrder`, `orderIndex`, `updatedAt`, `highlighted`, `id` | various | Ordering / housekeeping |

## 5. Fields requiring additional research

| Field | Status |
|---|---|
| Structured technical specifications (key/value) | NOT AVAILABLE in source — only free-text feature lines. Requires manufacturer datasheets |
| Datasheet URLs | 1 manufacturer link only; 1,290 records REQUIRE VERIFICATION |
| Stock / availability | NOT PUBLISHED by source |
| Manufacturer (separate from brand) | NOT PUBLISHED; brand used |
| Additional images | NOT PUBLISHED (single image max) |
| Per-product URLs | NOT PUBLISHED (single-page app) |

## 6. Known limitations

1. Specifications are marketing feature lines, not normalized spec tables. Manufacturer enrichment (Phase 3) was **not performed**; see `extraction/output/extraction_report.md` for the reason and the next lawful source.
2. 181 products have no image in the source.
3. 4 model numbers appear on two records each (6 conflicting on price/name, 2 identical) — flagged, not merged.
4. Product photos and descriptions are largely manufacturer marketing material redistributed by Simat. Before publishing them on the Wider Universal site, confirm usage rights (preferably source images from the manufacturers' partner portals).
5. Source prices are Simat's selling prices. They are stored only as reference data (`source.price`) and are never displayed publicly by the Wider Universal site.
