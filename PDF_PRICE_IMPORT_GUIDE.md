# PDF Price Import Guide

How to load prices from a new set of price-list PDFs into the catalog safely. The process never creates products,
never overwrites an existing Wider Universal selling price, and changes nothing except prices and admin-only reference
fields.

## Requirements

* Python 3.10+ with `pip install -r extraction/requirements.txt`
* Node 20+ (`npm install` done)
* For the emulator: `npm run emulators` running. For a live project: a service-account key **outside the repository** and
  `GOOGLE_APPLICATION_CREDENTIALS` pointing to it.

Below, `TARGET` means `--emulator --project demo-wider` for local testing, or `--project <project-id>` for a live project.

## Steps

### 1. Put the PDFs in one folder

Use a fresh folder, e.g. `data/pdf_sources/2026-11-01/`. Duplicate files with identical text are detected and skipped
automatically.

### 2. Back up the database

```bash
npm run backup -- TARGET
```

Note the printed file name, e.g. `backups/firestore-…json`.

### 3. Extract and match (read-only)

```bash
python extraction/pdf_prices.py --pdf-dir data/pdf_sources/2026-11-01 --snapshot backups/<backup-file>.json
```

Outputs go to `data/pdf_price_import/` (move the previous run's files elsewhere first if you want to keep them).

Check before going on:

| Check | Where |
|---|---|
| `extracted_rows` equals `declared_products` for every PDF, with no `COUNT_MISMATCH` / `ROW_NUMBER_MISSING` | console output, `pdf_extraction_errors.csv` |
| Price problems (`PRICE_FORMAT_UNRECOGNISED`, `PRICE_NOT_POSITIVE`, `MULTIPLE_PRICES_IN_CELL`, `PRICE_CELL_TEXT_DISAGREES`) | `pdf_extraction_errors.csv` |
| Rows not matched or needing review | `unmatched_products.csv` |
| Proposed changes and warnings (`differs from catalog snapshot source price`, existing selling price) | `price_update_preview.csv` |

### 4. Dry run

```bash
npm run pdf:apply -- TARGET --set-selling-price
```

This prints how many reference prices and selling prices would be written, and how many existing prices would be kept.

### 5. Apply

Choose one:

* **Reference prices only** (admin-only `productSources.pdfListPrice`; nothing public changes):

```bash
npm run pdf:apply -- TARGET --apply
```

* **Also publish as selling prices**: sets `products.price` = PDF price only where the selling price is empty:

```bash
npm run pdf:apply -- TARGET --apply --set-selling-price
```

The script records an import job and an audit change set for every product, then rebuilds the public catalog index.

### 6. Verify

* Admin → **Import / export**: the new "PDF" job and its review rows.
* Admin → product page → **Source & verification**: PDF price, file, page, row and match status.
* Public site: search a few models and compare with the PDF.
* Admin → **Dashboard → Check public catalog index**.

### 7. Undo

* Admin → Import / export → **Revert** on the PDF job restores the previous selling prices. It does not touch reference fields.
* Full rollback: `npm run restore -- TARGET --file backups/<backup-file>.json`.

## Matching rules

| Status | Meaning | Applied? |
|---|---|---|
| `EXACT_MATCH` | Exact SKU, or exact model number, and the PDF brand equals the product brand (spaces and case ignored; punctuation kept) | Yes |
| `VERIFIED_MATCH` | Model repeated in the PDF but pairing is price-safe; model punctuation differs but brand and description agree; or a unique model prefix where the PDF font dropped a suffix and the catalog source price agrees | Yes |
| `REVIEW_REQUIRED` | Brand differs, several products share the model, fuzzy suggestion only, unusable price, or PDF shows a rounded value of a fractional catalog price | No |
| `NO_MATCH` | No product found | No |
| `DUPLICATE_PDF_RECORD` | Model repeated in the PDF and the rows cannot be paired safely | No |

Variants are never merged. `IPC-HFW2441S-S` and `IPC-HFW2441S-S2`, for example, are different keys.

## Adapting to a different PDF layout

`extraction/pdf_prices.py` assumes the table layout `# | IMAGE | MODEL | DESCRIPTION | PRICE`, prices formatted as
`SAR 1,234[.56]`, and price text styled bold in colour `#0EA5E9` (`PRICE_COLOR`). For another supplier's layout,
adjust:

* `PRICE_COLOR` / `styled_price_spans()`: how the price text is recognised (or rely on cell text only).
* The `cells[idx:idx + 5]` column mapping in `extract_pdf()`.
* `PRICE_RE`: if prices use another currency label or a comma decimal separator. Do not guess: unknown formats are reported, never converted.
* The header patterns that detect banner and header rows.

Run `python -m unittest discover -s tests/python` after any change.
