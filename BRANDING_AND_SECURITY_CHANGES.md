# Branding, Content Management & Security — Change Report

Date: 2026-10-15. Tested against the local Firebase Emulator Suite. **Not deployed.**

## 1. What was found

| Area | Before |
|---|---|
| Logo | Placeholder "W" monogram (`public/logo-mark.svg`) and a drawn "WU" box in the PDF. |
| Company details | Hard-coded in `src/lib/format.ts` (`COMPANY`, `DEFAULT_SETTINGS`), with partial overrides in `settings/public` (8 fields). |
| Header / footer / page texts | Hard-coded in `Layout.tsx` and `Catalog.tsx`. |
| PDF | Branding passed from `settings/public`, text only. |
| Admin settings page | 8 plain fields, no validation, no history. |

Security gaps found:
* `settings/public` could be written by any administrator with **any fields** (no schema).
* `settings/{other}` allowed administrators to read and write **arbitrary** settings documents.
* Logo uploads accepted GIF up to 5 MB and allowed overwriting existing files.
* Admin sessions persisted indefinitely in the browser (local persistence), with no inactivity timeout.
* A revoked admin claim took effect only on the next hourly token refresh or page reload.
* No Content-Security-Policy header.

## 2. Changes

### Logo (official artwork from the conversation)
* `public/brand/wider-universal-logo-original.webp`: the uploaded file, unchanged.
* `public/brand/wider-universal-emblem.png`: lossless crop of the globe lockup. No scaling or recolouring.
* `public/brand/wider-universal-emblem-320.webp`: downscaled web version (18 KB). Used in the header and footer.
* `public/brand/wider-universal-wordmark.png`: lossless crop of the Arabic/English wordmark. Available as a logo choice.
* `public/brand/favicon-64.png`: favicon.
* The uploaded artwork has a white, not transparent, background. Logos are therefore placed on white tiles in the navy footer and admin sidebar.
* **Please send the original vector/PNG master**: the provided file is an 84 KB WebP, about 1,200 px. It is sharp on screen and in PDFs, but a master file is better for print.

### Central configuration: `settings/site`
* One published Firestore document drives the header, footer, page texts, contact details, catalog stock display and PDF branding.
* Schema: see `src/lib/siteConfig.ts`. Sections: `company`, `contact`, `header`, `footer`, `pages`, `catalog`, `pdf`, plus `version`, `updatedAt`, `updatedBy`, `updatedByEmail`, `lastChangeId`.
* Header and footer read only this document (plus the 11-document `brands` list for footer brand links), never the product catalog.
* Missing or damaged fields fall back to defaults field by field (`normalizeSiteConfig`), so a bad document cannot break the public site.
* Legacy `settings/public` values are still read as a fallback.

### Header
* Official logo, company name (hidden on phones; the logo itself carries the name), and the configurable navigation links.
* **"Main Website" → https://wideruniversal.com/**, opens in a new tab with `rel="noopener noreferrer"`.
* WhatsApp button and product search.
* Mobile menu: search, links, Main Website and WhatsApp, with 40 px touch targets.

### Footer
* Logo, company name, description, **Main Website link**, contact details and section text.
* Configurable footer links and brand links. Optional social links (none configured; I didn't invent any).
* Copyright with `{year}`.

### Admin → Website settings (`/admin/settings`)

Tabs:
* **Company branding**: name, tagline, description, main website URL, logo upload/preview, alt text.
* **Header**: visibility toggles, labels, navigation links.
* **Footer**: description, links, brand list, copyright, social links.
* **Page content**: hero, catalog intro, about section, stock display.
* **Contact information**.
* **PDF branding**: logo on/off, title, tagline, contact/website on/off, footer text, sample PDF.
* **Change history**: who, when and which fields. "Load this version" and "Load version before this change".
* **Security & access**: current admin, the admin list, provisioning instructions, and recommendations.

Editing behaviour:
* Inline validation with character counters.
* **Save and publish** writes the config and its audit record in one atomic batch. **Cancel** asks for confirmation. **Restore defaults** asks for confirmation and loads into the editor only.
* Live header/footer preview.
* Unsaved-changes guard on admin navigation and when closing the tab.
* Validation errors block publishing, and the last valid configuration stays live.
* Text only: HTML tags are rejected, and React escapes everything rendered.
* Links must be `https://…`, a same-site path (`/…`) or a section (`#…`). They are re-checked when rendered, and unsafe links are not shown.

### Logo upload
* Only administrators can upload.
* Accepted: PNG, JPEG or WebP, checked by **file signature**, decoded before upload, at least 64×64 px, under 2 MB. No SVG.
* Files are saved to `branding/logo-<timestamp>.<ext>`. The live logo changes only after **Save and publish**.
* A failed upload leaves the current logo unchanged.
* Storage rules repeat the type, size and name checks and forbid overwriting.
* If a logo image fails to load on the site, the bundled logo is shown instead, then the company name.

### PDF price list (`src/lib/pdf.ts`)
* Uses the published `settings/site` on every generation, from both the public download and the admin generator.
* Every page has a header with the **real logo image** (aspect ratio preserved), company name, tagline, contact line, clickable website URL, title and generation date.
* Every page has a footer with the configurable footer text, "Page X of Y", and the company name with the website link.
* Rows are not split across pages, and long text wraps.
* If the uploaded logo can't be fetched (Storage CORS not configured), the bundled official logo is used and the admin sees a warning.
* Prices come from public `products` only. Source and reference prices are never passed to the generator.

### Security fixes
| Fix | Where |
|---|---|
| `settings/site` is schema-validated server-side (keys, types, lengths, https main website URL, logo path pattern, phone/WhatsApp/email patterns). It must be written together with a `settingsHistory` record by the same admin at the same server time, and cannot be deleted. | `firestore.rules` |
| `settingsHistory` is admin-read and append-only. | `firestore.rules` |
| `settings/public` is restricted to its 8 known fields. Every other `settings/*` document is denied. | `firestore.rules` |
| Logo uploads: PNG/JPEG/WebP only, under 2 MB, fixed name pattern, create-only (no overwrite), admin only. | `storage.rules` |
| Admin session ends when the browser closes (session persistence), after 30 minutes of inactivity, or on sign-out. The admin claim is re-checked every 10 minutes. | `Login.tsx`, `AdminLayout.tsx`, `auth.tsx` |
| `Content-Security-Policy-Report-Only` and `Permissions-Policy` headers. | `firebase.json` |

Unchanged and verified:
* The custom-claim admin model: roles are granted only by `scripts/set-admin.ts` with the Admin SDK, and there is no public registration.
* Product and price rules and their audit trail.

Note on rules size:
* Firestore rules may evaluate at most 1,000 expressions per request, so individual navigation and social link URLs are not checked one by one in the rules.
* The rules do check the link list type and size, and they fully pattern-check the main website URL, logo path and contact fields.
* Link URLs are validated by the editor and checked again at render time, where unsafe links are never displayed.

## 3. Test results

| Suite | Result |
|---|---|
| TypeScript | Pass |
| Unit tests | **31 / 31**. New: config validation (URLs, HTML, lengths, contacts, logo path, link counts), normalisation and fallback, copyright, PDF branding on every page of a multipage export, settings-driven PDF content and toggles, PDF without a logo. |
| Rules tests | **34 / 34**. New: settings publish only by an admin with an audit record, anonymous and non-admin writes denied, 12 invalid configurations rejected, no deletion, other settings documents closed, history private and append-only, legacy doc restricted, logo upload type/size/name/overwrite rules, anonymous and non-admin upload and delete denied. |
| Python tests | 5 / 5 |
| Production build, `npm audit --omit=dev` | Pass, 0 vulnerabilities. No keys or credentials in `dist/`. |

Browser checks (emulators, full catalog):

| Check | Result |
|---|---|
| Header and footer logo | Displayed, with alt text. |
| Main Website links | Both point to `https://wideruniversal.com/` with `target=_blank` and `rel="noopener noreferrer"`. |
| Validation | Invalid URL (`http://…`) shows an inline error and blocks saving. HTML in the title is rejected. |
| Valid edit | Tagline and title published, visible on the public site after reload. Stored as version 2 with a history record. Then restored with "Load version before this change". |
| Public NJOY PDF | 1 page, logo image, tagline, contact details, clickable website link, correct price (1,812.30). |
| Admin sample PDF with an uploaded logo | The uploaded image was embedded at its own aspect ratio (1114×332 → 600×179). |
| Multipage PDF (140 products) | 13 pages. Header, logo and website on every page; "Page X of 13" footer; no overlaps (checked visually). |
| Logo upload validation | Fake PNG (text) and a 63×64 image rejected with messages, live logo unchanged. Valid upload previewed. Cancel restored the live logo. |
| Unsaved changes | Admin navigation is blocked while there are unsaved changes and allowed once clean. |
| Direct unauthenticated API calls (live emulator) | `settings/site` write 403, product price write 403, `settingsHistory` read 403, logo upload 403. |
| Mobile (375 px) | No header overlap, menu holds search, links, Main Website and WhatsApp, no horizontal overflow, footer stacks. |
| Regression | Search, filters, price list and grid views, product pages, catalog index, import/export and price editing unchanged. Prices unchanged. |

Not tested: deployment to a real Firebase project, Storage CORS in production, and enforcing (not report-only) CSP.

## 4. Files

| Change | Files |
|---|---|
| New | `src/lib/siteConfig.ts`, `src/lib/siteConfigStore.tsx`, `src/lib/unsaved.ts`, `tests/unit/siteConfig.test.ts`, `public/brand/*` (5 files), `storage.cors.json`, this report |
| Modified | `src/components/Layout.tsx`, `src/lib/pdf.ts`, `src/lib/auth.tsx`, `src/lib/format.ts`, `src/lib/products.ts`, `src/types.ts`, `src/main.tsx`, `src/styles.css`, `src/pages/Catalog.tsx`, `src/pages/ProductPage.tsx`, `src/pages/admin/{AdminLayout,Login,PriceListAdmin,Settings}.tsx`, `firestore.rules`, `storage.rules`, `firebase.json`, `index.html`, `tests/rules/*.test.ts`, `tests/unit/catalog.test.ts`, `DEPLOYMENT.md`, `README.md`, `TEST_REPORT.md` |
| Removed code | `PublicSettings` type, `DEFAULT_SETTINGS`, `fetchSettings()`, all replaced by the site config |

Backups from before this change:
* Code: `backups/code-before-branding/`
* Database: `backups/firestore-emulator-2026-10-15T12-59-28-216Z.json`

No product, price or stock data was modified.

## 5. Deployment steps (when approved)

1. `npm run deploy:staging`. This deploys the app, `firestore.rules`, `storage.rules` and the indexes.
2. Configure Storage CORS so PDFs can embed uploaded logos. Edit the origins in `storage.cors.json`, then run:

   ```bash
   gcloud storage buckets update gs://<bucket> --cors-file=storage.cors.json
   ```
3. Sign in to `/admin/settings` and click **Save and publish** once. This creates `settings/site`; until then, defaults and the legacy values are used.
4. Check the browser console on staging for CSP report-only violations. If there are none, rename `Content-Security-Policy-Report-Only` to `Content-Security-Policy` in `firebase.json`.
5. Firebase console → Authentication:
   * Disable sign-up.
   * Enable email enumeration protection.
   * Enable multi-factor authentication (requires Identity Platform) for administrators.
6. Repeat on production.
