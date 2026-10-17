# Catalog Redesign & Quote List — Change Report

Date: 2026-10-16. Based on the approved design draft. Tested on the local emulators; **not deployed**.

## Public site
* **Brand spotlight hero:**
  * With no brand selected, it shows the catalog title and text from Website settings, a "Live price list · updated <date>" badge (the date the public price list was last rebuilt), and a picture strip of products.
  * Choosing a brand, from a chip or the ‹ › arrows, switches it to that brand's headline, subtitle and banner, with "Brand spotlight · N of M".
  * A faint brand name sits in the background on desktop.
* **Floating search card:**
  * Search by model, SKU or name.
  * Live item count for the current brand.
  * Download price list (PDF) for the current brand or for all brands.
* **Brand chips** with product counts, in the order set in Admin → Brands & categories, plus an Offers chip.
* **Category, sort and in-stock filters** sit underneath, with active-filter tags and a Reset button.
* **Product list:**
  * Rows are grouped by category, with headings and counts. Each category shows 8 rows, then a "Show all N" button; categories load 10 at a time.
  * Any sort other than "Featured" shows one flat list.
  * Clicking a row **opens it in place** with:
    * a larger image and the datasheet link;
    * key specifications;
    * the price box: quantity, **Add to quote list** and Enquire on WhatsApp;
    * a link to the full product page, still at `/product/<id>`.
* **Quote list:**
  * Visitors add products with quantities, from opened rows or from product pages.
  * A "Quote list" item in the header shows a count, and a floating bar on every page leads to `/quote`.
  * On `/quote`:
    * change quantities, remove items, or clear the list;
    * see the list total, with items that have no price marked "on request";
    * choose the branch and contact, using the details from Admin → Contacts;
    * optionally add name, company, phone and notes;
    * **Send on WhatsApp** (to that contact's number), **Send by email**, or **Copy request text**.
  * The list is stored only in the visitor's browser. Nothing is saved on the server or sent until the visitor taps WhatsApp or email.
  * For very long lists, the email link would be too long, so the page asks the visitor to copy the text instead.
* **Project pricing / branches strip** above the footer, linking to the Contact page.
* **Removed:** the old grid/price-list view switch. The new rows replace both.

## Admin
* Admin → Brands & categories → **Brand spotlight**: per brand, an optional headline, optional subtitle and an optional banner upload. Banners must be PNG, JPEG or WebP, checked by file content, at least 600 px wide and up to 5 MB.
* Brand renames now **keep** these fields. Before, a rename rewrote the whole brand record.

## Security
* Brand documents are restricted to `name`, `order`, `headline` (≤ 120 characters), `subtitle` (≤ 300) and `bannerPath`. A banner must sit inside that brand's own Storage folder. Only administrators can write them.
* The quote list involves no server writes and no new public data.

## Tests
* Unit tests **45/45**. New: add/merge/limits, totals, message text, WhatsApp/email links, damaged stored data.
* Rules tests **40/40**. New: brand spotlight fields and banner path.
* Python tests 5/5.
* Typecheck, build, and `npm audit --omit=dev` (0 vulnerabilities).
* Browser checks:
  * Opening a row; quantities; adding to the quote list. The header badge, floating bar and "In quote × N" tag all update.
  * `/quote` totals, branch list, WhatsApp link to the Jeddah number with the full message, and the email link.
  * Spotlight headline set in admin and shown publicly.
  * 375 px mobile layout with no sideways scrolling.
  * No console errors.

## Files
* **New:**
  * `src/lib/quote.ts`, `src/lib/quoteStore.tsx`
  * `src/components/CatalogRow.tsx`
  * `src/pages/QuotePage.tsx`, `src/pages/admin/BrandSpotlightEditor.tsx`
  * `src/catalog.css`
  * `tests/unit/quote.test.ts`
* **Modified:**
  * `src/pages/Catalog.tsx` (rewritten)
  * `src/components/Layout.tsx` (Quote list link and floating bar)
  * `src/components/ProductCard.tsx` (unused list row removed)
  * `src/pages/ProductPage.tsx` (Add to quote list button)
  * `src/pages/admin/Taxonomy.tsx`
  * `src/lib/products.ts`, `src/lib/catalogIndex.ts` (updated date)
  * `src/types.ts`, `src/App.tsx`, `src/main.tsx`
  * `firestore.rules`, `tests/rules/firestore.rules.test.ts`
* **Backup:** `backups/code-before-redesign/`

## Price-drop tags (added 2026-10-16)
* When an administrator **lowers** a selling price, the product records the price it replaced (`previousPrice`) and the server time (`priceChangedAt`).
* For **30 days** the catalog shows a green **PRICE ↓ N%** tag, with the old price struck through, in:
  * the catalog rows;
  * the product page;
  * related-product cards.
* A **PRICE DROPS** chip filters to these products.
* No tag is shown for price increases, changes under 1 %, items without a price, or products with an active offer (the offer is shown instead).
* **Honesty rule:** Firestore rules accept a `previousPrice` only if it equals the price stored before the change, together with the server time. A drop therefore can't be invented, and a tag can't be added without a real price change. Administrators can remove a tag early with "Remove tag" on the product page. Clearing a tag is recorded in the audit history.
* Admin:
  * The product editor explains that saving a lower price will show the tag, and shows any active tag with its end date.
  * The Products list has a "Price-drop tag showing" filter.
* Tests:
  * Unit 49/49 (the tag window, rounding, offers taking priority, how saves record history).
  * Rules 44/44 (the real previous price is required, a fake previous price or date is rejected, a tag can't be added without a price change, removal is allowed, new products start with no history).
* Prices set by the PDF import script before this change have no history, so they show no tags. Tags appear from the next price reduction onwards.

## Wide-screen layout (added 2026-10-17)
Screens **1,600 px and wider** get a three-column catalog; narrower screens keep the layout above. It switches live when the window is resized.
* **Header:**
  * The catalog search moves into the header and is always visible.
  * The header uses the full width.
* **Top band:**
  * A shorter title area: the live badge, then either the brand spotlight headline or the home title.
  * Next to it, a 4-photo strip or the brand banner.
* **Left column (filters, stays in place while scrolling):**
  * Brand list with counts.
  * Offers, Price drops and In stock checkboxes.
  * PDF price list download.
  * Request a quotation.
* **Middle column:**
  * Product count, category and sort.
  * Category sections with column headings: Model · Product · Availability · Price.
  * Every row has **+ Add to quote** (it shows "✓ In quote × N" once added). Clicking a row still opens its specifications.
* **Right column (quote list, stays in place while scrolling):**
  * Items, with quantity +/−, remove, and the line total.
  * List total.
  * **Review & send to a branch**.
  * Project pricing note.
* The floating quote bar is hidden on this layout, since the column replaces it.
* **Files:**
  * New: `src/components/QuoteColumn.tsx`, `src/lib/useMedia.ts`, `src/wide.css`.
  * Modified: `src/pages/Catalog.tsx`, `src/components/CatalogRow.tsx`, `src/components/Layout.tsx` (header slot, `wide` and `hideQuoteBar` options), `src/main.tsx`.
* **Backup:** `backups/code-before-wide/`.
* **Checked at 1920 px:**
  * Column headings line up exactly with the row cells.
  * Header search filters the list.
  * The brand list switches the brand.
  * Rows open in place.
  * Add to quote updates the right column.
  * Below 1,600 px the standard layout returns.
  * No console errors.
  * Tests: unit 49/49, rules 44/44.
  * The build passes.

## Layout setting and visitor switch (added 2026-10-17)
Admin → Website settings → **Page content** → "Catalog layout on wide screens". Changes go live on **Save and publish** (no redeploy). Visitors pick up the new setting on their next page load.
* **Layout:**
  * *Automatic* (default): the wide three-column layout on screens at least the chosen width; the standard layout elsewhere.
  * *Standard everywhere*: the centred layout with the brand spotlight on every screen. The wide layout is never used.
* **Use the wide layout on screens at least…** (Automatic only): 1,440 px, 1,600 px (default, recommended) or 1,920 px.
* **Let visitors switch between Wide and Standard** (Automatic only, off by default):
  * Shows a small "Layout: Wide | Standard" switch above the products, only on screens wide enough for the wide layout.
  * Each visitor's choice is kept in their own browser only (`localStorage` key `wu-catalog-layout`). It is never sent to the server.
  * Phones, tablets and narrower screens always get the standard layout and never see the switch.
* Settings saved before this change have none of these fields. They behave as Automatic, 1,600 px, switch off, which matches the previous behaviour exactly.
* **Validation:** the browser form and the Firestore rules (`validCatalogSettings`) both accept only `auto`/`standard`, the widths 1440/1600/1920, and a true/false switch. The rules change goes live with the next `firebase deploy --only firestore:rules`.
* **Files:**
  * `src/lib/siteConfig.ts`: fields, defaults, validation.
  * `src/pages/admin/Settings.tsx`: the `Choice` select and the controls.
  * `src/pages/Catalog.tsx`: layout decision and switch.
  * `src/catalog.css`: switch styles.
  * `src/lib/useMedia.ts`: the fixed `WIDE_QUERY` was removed.
  * `firestore.rules`.
  * Tests: `tests/unit/siteConfig.test.ts`, `tests/rules/firestore.rules.test.ts`.
* **Backup:** `backups/code-before-layout-setting/`.
* **Checked on the emulators:**
  * Defaults give wide at 1,700 px.
  * Standard gives the centred layout at 1,700 px.
  * Automatic with 1,440 px gives wide at 1,500 px.
  * At 1,300 px the layout is standard with no switch.
  * With the switch on, Standard and Wide both work and the choice survives a reload.
  * Publishing from the admin page is accepted by the rules and recorded in the change history.
  * Tests: unit 52/52, rules 44/44, python 5/5.
  * The build passes.
