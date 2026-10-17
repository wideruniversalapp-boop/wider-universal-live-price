# Reconciliation

Extraction timestamp: 2026-10-15T10:10:50+00:00

| Source | Source Count | Extracted Count | Unique Records | Duplicate Records | Missing Fields | Status |
|---|---|---|---|---|---|---|
| Firestore `products` (website query, orderBy displayOrder) | 1291 (full collection listing) | 1291 | 1291 | 4 (shared model, flagged not merged) | 6 records flagged | RECONCILED |
| Firestore `brands` | 5 | 5 | 5 | 0 | n/a | RECONCILED |

Distinct normalized model numbers: 1287

## Validation findings (records affected)

| Check | Records |
|---|---|
| CATEGORY_IS_IMPORT_ARTEFACT | 649 |
| DUPLICATE_MODEL_CONFLICTING | 6 |
| DUPLICATE_MODEL_IDENTICAL | 2 |
| MODEL_WHITESPACE_TRIMMED | 14 |
| NO_IMAGE | 181 |
| NO_STRUCTURED_FEATURES | 753 |
| VISIBILITY_FIELD_ABSENT | 206 |

## Records by brand

| Brand | Records |
|---|---|
| Dahua | 700 |
| Ajax | 200 |
| DAHUA WISSUALRAM-FIRE ALARM SYSTEM | 126 |
| Imou | 83 |
| YLI | 80 |
| Fyber | 28 |
| STARLINK | 26 |
| Legrand | 20 |
| ITC | 11 |
| NJOY | 9 |
| OTHER PRODUCTS | 8 |
