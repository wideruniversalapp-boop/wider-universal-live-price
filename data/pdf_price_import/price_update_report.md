# PDF Price Update Report

Date: 2026-10-15. Database: **local Firebase emulator (`demo-wider`)**. Nothing has been deployed to a live project.

## 1. Source files

12 files were supplied. Two YLI files (`…YLI_Price_List_2026-10-15.pdf` and `… (1).pdf`) have identical text, so one was skipped as a duplicate. **11 PDFs, 69 pages** were processed (copies kept in `data/pdf_sources/`).

| PDF | Pages | Products declared in header | Rows extracted |
|---|---|---|---|
| Ajax | 10 | 200 | 200 |
| Dahua | 33 | 700 | 700 |
| DAHUA WISSUALRAM fire alarm | 9 | 126 | 126 |
| Fyber | 2 | 28 | 28 |
| Imou | 4 | 83 | 83 |
| ITC | 1 | 11 | 11 |
| Legrand | 2 | 20 | 20 |
| NJOY | 1 | 9 | 9 |
| OTHER PRODUCTS | 1 | 8 | 8 |
| STARLINK | 2 | 26 | 26 |
| YLI | 4 | 80 | 80 |
| **Total** | **69** | **1,291** | **1,291** |

The PDFs contain **1,291** products, not the ~1,209 mentioned in the request. Row numbers in every file run from 1 to N without gaps or repeats.

## 2. PDF structure and extraction method

* All pages have a text layer, so no OCR was needed. Each page holds one table: `# | IMAGE | MODEL | DESCRIPTION | PRICE`, with section header rows (e.g. "DAHUA VIDEO INTERCOM").
* There is one price column, always in the form `SAR 1,234`, in whole riyals. There is no second currency, no promotional or struck-through price, and no unit-of-sale column.
* Tables are read with PyMuPDF. On pages 2+ the page banner overlaps the table, so rows are anchored on the row-number cell.
* **Prices** come from the bold blue price text (Helvetica-Bold 8.5 pt, #0EA5E9) inside the price cell and are cross-checked against the cell text.
  * For 1,275 rows the two readings agree exactly.
  * For 16 rows a long description overflows into the price cell and garbles the cell text. Only the styled-span reading is usable there. All 16 equal the catalog source prices (table below).
* Model numbers wrapped across lines are joined. One model cell (Dahua p.3 #47) is double-byte encoded. The NUL characters were removed, and the full-width "（POE）" suffix does not survive in the PDF text.

| Page / row | Model | Price recovered | Catalog source price |
|---|---|---|---|
| Dahua p.14 #292 | IPC-HDW2841T-AS | 366 | 366 |
| Dahua p.15 #327 | IPC-HFW3849T1-AS-PV-PRO | 1,158 | 1,158 |
| Dahua p.15 #331 | IPC-HDW3849H-AS-PV | 672 | 672 |
| Dahua p.16 #332 | IPC-HDW3549H-AS-PV | 662 | 662 |
| Dahua p.16 #334 | IPC-HFW3549T1-AS-PV | 732 | 732 |
| Dahua p.25 #537 / #539 | HAC-ME1500E-LED / HAC-ME1500B-LED | 110 / 110 | 110 / 110 |
| Dahua p.29 #624–626 | DH-PFM880E / DH-PFM881E / DH-PFM885-I | 2,017 / 1,076 / 592 | same |
| Dahua p.30 #635, 639, 642, 647 | DH-PFS4226-24GT-360, DH-PFS4218-16GT-240, DH-PFS3009-8ET-65, DH-PFS3006-4ET-36 | 1,358 / 1,096 / 161 / 109 | same |
| Dahua p.32 #691 | DHI-LM43-F400 | 1,968 | 1,968 |
| Imou p.2 #23 | IPC-K7FN-5H0WE | 185 | 185 |

## 3. Results

| Measure | Count |
|---|---|
| Product records extracted | 1,291 |
| Unique (model, brand) keys | 1,286; 5 models are listed twice |
| Records with a valid price | 1,290 |
| Unreadable or invalid prices | 1 (`SLF-06` shows "SAR 0") |
| **EXACT_MATCH** (SKU or model + brand) | 1,279 |
| **VERIFIED_MATCH** | 10 |
| REVIEW_REQUIRED | 2 |
| NO_MATCH | 0 |
| DUPLICATE_PDF_RECORD (left unresolved) | 0 |
| PDF prices different from the catalog source data (matched rows) | 0 |

The 10 VERIFIED_MATCH rows come from 5 models that appear twice:
* **4 models** are also duplicated on the website. Each pair has the same PDF price on both rows, or a price that identifies its record uniquely.
* **DHI-ASI1201M-MEP** appears once as is and once for the "（POE）" variant, whose suffix the PDF font dropped. Both rows are SAR 380, which matches the catalog data for both products.

### Rows not applied (`unmatched_products.csv`)

| PDF row | Model | PDF price | Reason | Suggested action |
|---|---|---|---|---|
| STARLINK p.1 #5 | SL59-100 | SAR 70 | The PDF rounds to whole riyals. Catalog data has **70.20**, which is a 40 % promotional price (regular 117). | Decide on the price and offer, then set it on the product page. |
| STARLINK p.1 #6 | SLF-06 | SAR 0 | Not a valid price. Catalog data has **0.45**, which the PDF rounds down to 0. | Confirm the unit price and enter it manually. |

## 4. What was changed

Backups were taken before any write:
* `backups/firestore-emulator-2026-10-15T11-06-06-740Z.json`, before the work started.
* `backups/firestore-emulator-2026-10-15T12-19-40-933Z.json`, immediately before applying prices.

Restore with `npm run restore -- --emulator --project demo-wider --file <backup>`.

You chose to publish the PDF prices as Wider Universal prices ("Publish as our prices").

| Field | Records |
|---|---|
| `products.price` (public Wider Universal selling price) set from the PDF, only where it was empty | **1,278** |
| Existing selling prices left unchanged (set earlier by an administrator) | 11 |
| `productSources.pdfListPrice`, `pdfPriceText`, `pdfFile`, `pdfPage`, `pdfRow`, `pdfModel`, `pdfMatchStatus`, `pdfMatchMethod`, `pdfImportJobId`, `pdfImportedAt` (admin-only) | 1,289 |
| `priceHistory` change sets (one entry per product: `price` null → PDF price, with file/page/row) | 9 sets / 1,278 entries |
| `importJobs/qtrOGbajMVW7JhautNaJ` (type `pdf-price`): summary, review rows, pre-change snapshot for **Revert** | 1 |
| `catalogIndex/*` (public catalog index) rebuilt | 1,284 published products |

Verification after the write, comparing the backup taken just before with the database afterwards:
* 1,278 prices equal the planned PDF values exactly.
* 11 existing prices are unchanged.
* All 1,289 reference fields are correct.
* **0 unexpected changes** in stock status, stock quantity, specifications, features, images, categories, descriptions, names, models, SKUs, visibility or offers.

### Published / priced counts

| | Count |
|---|---|
| Products in the database | 1,292 (1,291 catalog + 1 archived test product) |
| Published | 1,284 |
| Published **with** a selling price | 1,282 |
| Published **without** a price (shown as "Request a quotation") | 2: SLF-06 and SL59-100 above |
| Draft (flagged duplicates) with a price set | 7 |

Spot checks on the public site against the PDF:
* DH-SD5A425MB-HNR: SAR 2,020 (Dahua p.1 #16).
* DH-SD5A425MA-HNR: SAR 2,714 (p.1 #19).
* NJOY BLADER 1 KVA: kept at SAR 1,812.30, the existing admin price. The PDF shows 1,726.

## 5. Points for the business to decide

1. **Promotional prices.** The PDF shows one price per product, and for three products the source catalog marks that price as a 40 % discount. These are now regular selling prices:
   * SL-B10W: PDF 182, source regular 303.
   * M8-NVR: PDF 297, source regular 495. The source offer applies only to purchases of 5 or more.
   * SL59-100: in review.

   If these should be shown as offers instead, enter the regular price and an offer price on each product page.
2. **Source of the prices.** The PDFs are Simat Security's own price lists. Publishing them makes Wider Universal's prices identical to Simat's. They can be changed at any time, individually, by spreadsheet import, or with the "Price from source" bulk action (with a markup %).
3. **The 11 products that kept their existing prices** were priced by administrators before this import, e.g. the NJOY range at source + 5 %. Review them if the PDF should win.
4. **VAT.** The PDFs do not say whether prices include VAT. The site does not state it either. Add a note in Admin → Settings → price list note once confirmed.

## 6. Output files

All files are in `data/pdf_price_import/`:

| File | Content |
|---|---|
| `pdf_products_extracted.csv` / `.json` | Every PDF row: file, page, row, section, model (joined and raw), description, price text, numeric price, price source, cell text |
| `price_match_report.csv` | Every PDF row with its match status, method, matched product, and warnings |
| `price_update_preview.csv` | The 1,289 proposed changes: website vs PDF name/model, extracted price, target field, current values, page reference, and warnings |
| `unmatched_products.csv` | The 2 review rows |
| `pdf_extraction_errors.csv` | 1 row ("SAR 0") |
| `price_update_plan.json` | Machine-readable plan used by `scripts/apply-pdf-prices.ts` |
| `summary.json` | Counts |
