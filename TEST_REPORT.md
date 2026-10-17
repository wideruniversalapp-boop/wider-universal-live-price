# Test Report

Date: 2026-10-15. Environment: Windows 11, Node 21.5, Java 17, firebase-tools 13.35.1, Firebase Emulator Suite
(Auth, Firestore, Storage). **No production or staging deployment was performed** (no Firebase project available).

## Summary

| Area | Result |
|---|---|
| TypeScript typecheck (`tsc --noEmit`) | Pass |
| Unit tests (`npm test`) | **17 / 17 pass** |
| Security rules tests (`npm run test:rules`) | **22 / 22 pass** (18 Firestore, 4 Storage) |
| Production build (`vite build`) | Pass |
| `npm audit --omit=dev` (runtime dependencies) | 0 vulnerabilities |
| Migration of full dataset into emulator | 1,291 products, 1,291 source records, 1,110 images, 11 brands, 100 categories in ~20 s |
| Migration rerun (idempotency) | 0 created, 0 images re-uploaded, sources refreshed |
| `npm run verify:emulator` | OK — database matches `data/catalog_import.json` |
| Built bundle scanned for private keys, emulator credentials, source branding | None found |

## Data tests

| Check | Result |
|---|---|
| Extraction count vs. source | 1,291 extracted = 1,291 in full collection listing = 1,291 via website query (RECONCILED) |
| Cross-check with the live site counter | Site shows "700 Items Found" for Dahua; dataset has 700 Dahua records |
| Unique records | 1,291 unique document IDs; 1,287 distinct model numbers |
| SKU integrity | 4 model numbers shared by 2 records each. Flagged, not merged; 7 records held as draft; second record of each pair gets SKU suffix `-DUP2` (model number unchanged) |
| Prices | 1,291 / 1,291 positive SAR source prices; 3 discounted; 0 promo > regular |
| Images | 1,110 decoded and uploaded; 181 have no image in source; 0 broken files |
| Specification sources | All feature lines come from source descriptions (`source:description`); 0 manufacturer-enriched |
| Imported vs. cleaned dataset | Exact match on IDs, model, name, brand, image presence, source price; no source price fields on public documents |

Source data problems found (kept as-is, visible to admins): category values that are spreadsheet artefacts on 649
records; some items filed under another brand's subcategory (e.g. NJOY UPS units under "IMOU Video Door Phone",
Ajax accessories under Imou/Legrand/Dahua fire alarm); 14 model numbers with stray whitespace.

## Functional tests (browser, against emulators with the full dataset)

| Test | Result |
|---|---|
| Catalog loads all published products (1,284) | Pass — first cards rendered ~1.6 s after navigation (dev build, local emulator) |
| Search by model (`dh-ipc` → 76), by words (`4mp bullet` → 7), by SKU, no-match empty state | Pass |
| Brand chips, category select, offers filter, in-stock filter, sort by price/name/model | Pass (unit + browser) |
| Load more (48 per page) | Pass |
| Product page: model/SKU/category, price on request, features list, specs empty-state, WhatsApp link with model and SKU | Pass |
| Unpublished product URL | Shows "not available" (rules deny read) |
| Admin sign-in (emulator account), dashboard live counts | Pass — 1,284 active, 7 draft, 1,284 without selling price |
| Edit price 349 / offer 319 / stock in stock | Pass — saved through rules; history shows admin, field, from, to; public card shows −9% badge |
| CSV import preview: 1 update, 1 create, duplicate-in-file, bad number, missing SKU | Pass — correct actions and row errors |
| Import commit | Pass — "1 created, 1 updated, 0 unchanged, 3 failed"; public site reflects new price/stock immediately |
| Import revert | Pass — updated product restored to 349/319/in stock, created product archived |
| Bulk "Price from source +5%" on 9 NJOY products | Pass — prices set from admin-only source data, audited |
| PDF price list (all published) | Pass — 71 pages, 1,284 products, company header, page numbers, offer column; generated in ~8 s in the browser |
| Mobile (375 px) | Pass — no horizontal scroll, 2-column grid, collapsible menu |

Not exercised in the browser: image upload from the edit page (covered by Storage rules tests), Excel (.xlsx) upload
(same code path as CSV after parsing), taxonomy rename, non-admin "Access denied" screen (enforced by rules tests).

## Security tests (rules emulator)

| Scenario | Result |
|---|---|
| Anonymous read of published product / filtered query | Allowed |
| Anonymous read of draft product, unfiltered product list | Denied |
| Read of `productSources` (source prices), `priceHistory`, `importJobs`, other users by non-admin | Denied |
| Product create/update/delete by anonymous or signed-in non-admin, even with a forged change set | Denied |
| User writing their own `users` doc to grant a role | Denied |
| Token with `admin: "true"` (string) or `role: admin` | Denied |
| Admin price/stock change without change set, with change set by another uid, or change set not listing the product | Denied |
| Admin audited change; audited 200-product batch | Allowed |
| Invalid data: offer ≥ price, negative price, unknown stock status, unknown status, extra field (`sourcePrice`), spoofed `updatedBy` | Denied |
| Update/delete or back-dated create of `priceHistory` | Denied |
| `productSources` edits other than review fields | Denied |
| Storage: public read of product image; read outside public folders | Allowed / Denied |
| Storage: upload by anonymous or non-admin; admin upload of HTML, >5 MB, or outside allowed folders | Denied |
| Storage: admin PNG upload | Allowed |

## Known gaps

* Manufacturer specification enrichment not performed (see `data/extraction_report.md`).
* No staging/production deployment; production performance (CDN, network latency) not measured.
* No end-to-end browser test automation is checked in; browser tests above were run interactively.

## Update — PDF price import and UI revision (2026-10-15, afternoon)

| Check | Result |
|---|---|
| TypeScript typecheck | Pass |
| Unit tests | **20 / 20** (added: catalog index contents/hash, spec splitting) |
| Python tests (`npm run test:python`) | **5 / 5** (price parsing incl. rejected formats, matching keys, NJOY regression) |
| Rules tests | **23 / 23** (added: `catalogIndex` public read, admin-only shape-checked writes) |
| Production build, `npm audit --omit=dev` | Pass, 0 vulnerabilities |
| PDF extraction | 1,291 / 1,291 rows (declared = extracted in all 11 PDFs); 1,290 valid prices |
| Price cross-check | 1,289 matched PDF prices equal the catalog source data; 16 rows recovered from garbled cells all equal |
| Apply verification (before/after backups) | 1,278 prices set exactly; 11 existing prices kept; 0 unintended field changes |
| Public catalog | Loads from index in ~0.9 s (dev, emulator); search `SD5A425` → 2 results with PDF prices 2,020 / 2,714 |
| Admin → public propagation | Stock change on a product appeared in the public index within seconds; restored afterwards |
| Mobile 375 px | No horizontal overflow; price-list rows have no text overlap (40 rows checked) |
| Browser console | No application errors |

See `data/pdf_price_import/price_update_report.md` for the full figures.

## Update — branding, website settings and admin security (2026-10-15, evening)

Unit **31/31**, rules **34/34**, Python **5/5**, typecheck and production build pass, 0 runtime vulnerabilities.
Browser and PDF checks are listed in `BRANDING_AND_SECURITY_CHANGES.md` §3.

## Update — contact page, contact management and header (2026-10-15, night)

Unit **39/39**, rules **38/38**, Python **5/5**, typecheck and build pass. Details in `CONTACT_PAGE_CHANGES.md`.

## Pre-deployment test pass (2026-10-17)

A full pass on the **production build**, before the first Firebase deployment. Everything ran on the local
emulators. The emulator data was backed up first and restored afterwards, and all test accounts and test products were removed.

| Area | Result |
|---|---|
| Typecheck, unit, rules, Python | Pass: unit **52/52**, rules **44/44**, Python **5/5** |
| `npm audit --omit=dev` (website code) | 0 vulnerabilities. The 26 warnings in `npm audit` are in development tools only (firebase-tools, vitest, vite), which are not part of the website. |
| Database indexes | Every app query reviewed: all are single-field or covered by `firestore.indexes.json`. |
| Hosting | Every route (`/`, `/product/…`, `/contact`, `/quote`, `/admin/…`, unknown paths) is served correctly. Config files and `.env` files are not published. |
| Production bundle | No passwords, test accounts or emulator settings included. No source maps. |
| Public catalog | 1,286 published products. Every brand chip count matches its list. Search by model, partial text, extra spaces and "no results" all work. HTML/script typed into search is shown as text, never run. |
| Product rows and pages | Opening a row in place, images, specifications, WhatsApp links, unknown product IDs, and odd characters in addresses all work. |
| Quote list | Add, quantity limits (1 to 9,999), remove, branch choice, WhatsApp/email text with special characters, and damaged browser storage (recovers cleanly) all work. |
| PDF price list | All brands (2.1 MB) and a single brand (Fyber, 0.26 MB) generate from the public site and from admin. |
| Layouts | Phone 375 px, tablet 768 px, desktop 1366 px and 1920 px: no sideways scrolling. The phone menu works. |
| Security (live probes) | **45/45** attacks blocked, as an anonymous visitor and as a signed-in non-admin. Tested: reading source prices, history, import jobs, users or draft products; writing products, prices, settings, contacts, catalog index, history, brands, other collections, image and logo uploads; and granting yourself admin. |
| Admin sign-in | Wrong password and unknown email give the same message, so it doesn't reveal which accounts exist. Non-admin accounts see "Access denied". Sign-out locks every admin page. |
| Admin write cycle | On a throwaway QA product: create, validation (offer must be below the price), price drop and tag, offer with dates, the public catalog updating within seconds, HTML in a name shown as text, CSV import with 3 bad rows rejected, commit, revert (the older PDF import untouched), CSV and Excel export (no source prices; formula injection neutralised), audit history, and deletion. |
| Content-Security-Policy | Enforced (not report-only) on every public and admin page, including PDF generation: **0 violations**. It is safe to switch the CSP to enforced after the staging check. |
| Accessibility basics | Every image has alt text, every button has a name, every field has a label, and each page has one heading. |

### Problems found and fixed

1. **Deploying without Firebase settings would publish a blank site.** The build succeeds with empty settings but fails in the browser. The new `scripts/check-deploy-env.mjs` runs first in `npm run deploy:staging` and `deploy:production`, and stops the deploy when `.env.<target>` is incomplete, still points at the emulators or the `demo-` project, or does not match `.firebaserc`.
2. **Visitors could keep an old version after a redeploy.** `index.html` could be cached by browsers. `firebase.json` now sends `Cache-Control: no-cache` for pages; the hashed `/assets/` files stay cached for a year.
3. **An open tab could fail after a redeploy.** It might ask for a code file that no longer exists. `src/main.tsx` now reloads once to the new version, and a guard prevents reload loops.
4. **The 404 page had no header or footer.** It now uses the normal site layout and its own title.
5. **The browser tab title went stale after visiting some pages.** The catalog, quote, admin sign-in and admin pages now set and restore their titles.
6. **The header search box had the same ID twice.** It appears in both the desktop and mobile menus. Each copy now gets its own ID, so screen readers link each one to its label.

### Notes (no change needed)

* A 2-day-old local emulator slowed every database write to about 20 seconds. After a restart, writes took 0.1 to 0.6 seconds. This affects only the local test tools, not the hosted site.
* The Firebase Hosting emulator does not apply custom headers. The headers were checked separately by a local server that applies `firebase.json` exactly.
* Turning on both the Offers and Price drops chips shows only products that match both (currently none). Products with an active offer show the offer instead of a price-drop tag.
* An offer whose end date has already passed can be saved. It simply isn't shown.
* Firebase Auth allows public sign-up by default. Such accounts get no access (tested), but turn sign-up off as listed in DEPLOYMENT.md (A3).
* Backups from this pass: `backups/code-before-testing/` (code) and `backups/emulator-before-testing/` (data).
