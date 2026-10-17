"""
PDF price-list extraction and product matching.

Usage:
    python extraction/pdf_prices.py --pdf-dir data/pdf_sources --snapshot backups/<firestore-backup>.json

Inputs
    --pdf-dir    folder of price-list PDFs (text-based, one table per page:
                 # | IMAGE | MODEL | DESCRIPTION | PRICE, with section header rows)
    --snapshot   database backup from scripts/backup-products.ts (products + productSources)

Outputs (data/pdf_price_import/)
    pdf_products_extracted.csv / .json   every product row read from the PDFs
    pdf_extraction_errors.csv            unreadable / ambiguous rows and count mismatches
    price_match_report.csv               every PDF row with its match status
    price_update_preview.csv             proposed field changes for matched products
    unmatched_products.csv               rows needing manual review (REVIEW_REQUIRED, NO_MATCH, DUPLICATE_PDF_RECORD)
    price_update_plan.json               machine-readable plan consumed by scripts/apply-pdf-prices.ts
    summary.json                         counts used in price_update_report.md

Nothing in the database is changed by this script.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import difflib
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "pdf_price_import"

PRICE_RE = re.compile(r"^\s*SAR\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)(\.[0-9]{1,2})?\s*$")
ANY_AMOUNT_RE = re.compile(r"SAR\s*[0-9][0-9,]*(?:\.[0-9]+)?")
DASHES = dict.fromkeys(map(ord, "‐‑‒–—−­"), "-")


def norm_key(s: str) -> str:
    """Matching key: NFKC, unified dashes, no whitespace, upper-case. Punctuation kept."""
    s = unicodedata.normalize("NFKC", s or "").translate(DASHES)
    return re.sub(r"\s+", "", s).upper()


def loose_key(s: str) -> str:
    """Looser key for VERIFIED/REVIEW matching only: also drops - _ . / and parentheses."""
    return re.sub(r"[-_./()]", "", norm_key(s))


def norm_brand(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


def file_sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


# ------------------------------------------------------------------ extraction
def parse_price(text: str):
    """Returns (value, problem). Accepts 'SAR 1,250', 'SAR 1250', 'SAR 1,250.50'. Never guesses."""
    t = (text or "").replace("\n", " ").strip()
    if not t:
        return None, "PRICE_EMPTY"
    amounts = ANY_AMOUNT_RE.findall(t)
    if len(amounts) > 1:
        return None, "MULTIPLE_PRICES_IN_CELL"
    m = PRICE_RE.match(t)
    if not m:
        return None, "PRICE_FORMAT_UNRECOGNISED"
    value = float(m.group(1).replace(",", "") + (m.group(2) or ""))
    if value <= 0:
        return None, "PRICE_NOT_POSITIVE"
    return (int(value) if value.is_integer() else value), None


PRICE_COLOR = 0x0EA5E9  # price text in the source PDFs: Helvetica-Bold 8.5pt, sky blue


_span_cache: dict = {}


def styled_price_spans(page, bbox) -> list[str]:
    """Text of bold, price-coloured spans inside the price cell (ignores overflowing description text)."""
    if not bbox:
        return []
    key = (page.parent.name, page.number)
    if key not in _span_cache:
        spans = []
        for b in page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT)["blocks"]:
            for line in b.get("lines", []):
                for sp in line["spans"]:
                    if sp["color"] == PRICE_COLOR and "Bold" in sp["font"] and sp["text"].strip():
                        spans.append((pymupdf.Rect(sp["bbox"]), sp["text"].strip()))
        _span_cache[key] = spans
    cell = pymupdf.Rect(bbox)
    return [t for r, t in _span_cache[key] if cell.contains(pymupdf.Point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2))]


def extract_pdf(path: Path, errors: list) -> tuple[list[dict], dict]:
    doc = pymupdf.open(path)
    first = doc[0].get_text()
    title = first.split("\n", 1)[0].strip()
    m = re.search(r"(\d+)\s+Products", first)
    declared = int(m.group(1)) if m else None
    brand_label = re.sub(r"\s+SOLUTIONS CATALOG$", "", title, flags=re.I).strip()
    rows: list[dict] = []
    section = ""
    for pno in range(doc.page_count):
        page = doc[pno]
        tables = page.find_tables().tables
        if not tables:
            errors.append({"file": path.name, "page": pno + 1, "row_no": "", "problem": "NO_TABLE_ON_PAGE", "detail": ""})
            continue
        for t in tables:
            for k, raw_cells in enumerate(t.extract()):
                # Some cells are double-byte encoded (NUL between characters); the NULs carry no text.
                cells = [(c or "").replace("\x00", "") for c in raw_cells]
                filled = [c.strip() for c in cells if c and c.strip()]
                if not filled:
                    continue
                joined = " ".join(filled)
                # Page banner / repeated column header (on later pages the banner overlaps the table).
                if "#" in filled[0].split("\n") or "DESCRIPTION" in joined or re.search(r"CATALOG|\d+\s+P\S*Products|PPrRodICuEcts", joined):
                    continue
                # Product row: anchor on the first cell that is a bare row number; the four
                # following cells are image, model, description, price.
                idx = next((i for i, c in enumerate(cells) if c.strip().isdigit()), None)
                if idx is None:
                    if len(filled) == 1 and not ANY_AMOUNT_RE.search(joined):
                        section = filled[0].replace("\n", " ").strip()
                    else:
                        errors.append({"file": path.name, "page": pno + 1, "row_no": "", "problem": "UNRECOGNISED_ROW", "detail": " | ".join(filled)[:200]})
                    continue
                first_cell = cells[idx].strip()
                if len(cells) < idx + 5:
                    errors.append({"file": path.name, "page": pno + 1, "row_no": first_cell, "problem": "TOO_FEW_COLUMNS", "detail": " | ".join(filled)})
                    continue
                cells = cells[idx:idx + 5]
                model_lines = [l.strip() for l in cells[2].split("\n") if l.strip()]
                cell_text = cells[4].replace("\n", " ").strip()
                styled = styled_price_spans(page, t.rows[k].cells[idx + 4])
                price_source = "styled-span"
                if styled:
                    price_text = " / ".join(styled)
                else:
                    price_text, price_source = cell_text, "cell-text"
                price, problem = parse_price(price_text)
                if not problem and price_source == "styled-span":
                    cell_price, cell_problem = parse_price(cell_text)
                    if cell_problem:
                        price_source = "styled-span (cell text garbled by overflowing description)"
                    elif cell_price != price:
                        problem = "PRICE_CELL_TEXT_DISAGREES"
                rec = {
                    "pdf_file": path.name,
                    "pdf_page": pno + 1,
                    "row_no": int(first_cell),
                    "pdf_brand_label": brand_label,
                    "pdf_section": section,
                    "model_raw": cells[2],
                    "model_joined": "".join(model_lines),
                    "model_key": norm_key("".join(model_lines)),
                    "description": " ".join(l.strip() for l in cells[3].split("\n")).strip(),
                    "price_text": price_text,
                    "price_sar": price,
                    "currency": "SAR" if price_text.upper().startswith("SAR") else "",
                    "price_problem": problem or "",
                    "price_source": price_source,
                    "price_cell_text": cell_text,
                    "unit": "",
                }
                if problem:
                    errors.append({"file": path.name, "page": pno + 1, "row_no": first_cell, "problem": problem, "detail": price_text})
                if not rec["model_key"]:
                    errors.append({"file": path.name, "page": pno + 1, "row_no": first_cell, "problem": "MODEL_EMPTY", "detail": ""})
                rows.append(rec)
    nums = sorted(r["row_no"] for r in rows)
    expected = list(range(1, (declared or (nums[-1] if nums else 0)) + 1))
    missing = sorted(set(expected) - set(nums))
    dup_nums = [n for n, c in Counter(nums).items() if c > 1]
    if declared is not None and len(rows) != declared:
        errors.append({"file": path.name, "page": "", "row_no": "", "problem": "COUNT_MISMATCH", "detail": f"declared {declared}, extracted {len(rows)}"})
    for n in missing:
        errors.append({"file": path.name, "page": "", "row_no": n, "problem": "ROW_NUMBER_MISSING", "detail": ""})
    for n in dup_nums:
        errors.append({"file": path.name, "page": "", "row_no": n, "problem": "ROW_NUMBER_REPEATED", "detail": ""})
    meta = {"file": path.name, "sha256": file_sha(path), "pages": doc.page_count, "title": title, "brand_label": brand_label,
            "declared_products": declared, "extracted_rows": len(rows), "missing_row_numbers": missing,
            "created": doc.metadata.get("creationDate")}
    return rows, meta


# ------------------------------------------------------------------ matching
def load_snapshot(path: Path):
    snap = json.loads(path.read_text(encoding="utf-8"))["collections"]
    products = [{"id": k, **v} for k, v in snap["products"].items()]
    sources = snap["productSources"]
    return products, sources


def text_similarity(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, (a or "").lower(), (b or "").lower()).ratio()


def match_rows(rows: list[dict], products: list[dict], sources: dict) -> None:
    by_key = defaultdict(list)
    by_loose = defaultdict(list)
    by_sku = defaultdict(list)
    for p in products:
        if p.get("status") == "archived":
            continue
        by_key[norm_key(p.get("model", ""))].append(p)
        by_loose[loose_key(p.get("model", ""))].append(p)
        by_sku[norm_key(p.get("sku", ""))].append(p)

    pdf_key_count = Counter((r["model_key"], norm_brand(r["pdf_brand_label"])) for r in rows)

    for r in rows:
        r.update({"match_status": "", "match_method": "", "product_id": "", "db_model": "", "db_sku": "", "db_name": "",
                  "db_brand": "", "db_status": "", "warnings": []})
        if r["price_problem"] or not r["model_key"]:
            r["match_status"] = "REVIEW_REQUIRED"
            r["warnings"].append("unreadable price or model")
            continue
        bkey = norm_brand(r["pdf_brand_label"])
        same_brand = lambda c: norm_brand(c.get("brand", "")) == bkey  # noqa: E731

        cands, method = by_sku.get(r["model_key"], []), "exact SKU"
        if not cands:
            cands, method = by_key.get(r["model_key"], []), "exact model"
        if len(cands) > 1:
            branded = [c for c in cands if same_brand(c)]
            if branded:
                cands, method = branded, method + " + brand"

        n_pdf = pdf_key_count[(r["model_key"], bkey)]
        if n_pdf > 1:
            # The same model appears more than once in this brand's PDF and (usually) on as many
            # website records. Pair them only when the pairing cannot change the price applied.
            siblings = [x for x in rows if x["model_key"] == r["model_key"] and norm_brand(x["pdf_brand_label"]) == bkey]
            sib_prices = {x["price_sar"] for x in siblings}
            # Candidates by model (not SKU: duplicate website records carry a suffixed SKU), plus
            # same-brand models that only extend this one with a suffix the PDF font dropped.
            cands = [c for c in by_key.get(r["model_key"], []) if same_brand(c)]
            cands += [c for c in products if same_brand(c) and c.get("status") != "archived"
                      and norm_key(c.get("model", "")).startswith(r["model_key"]) and norm_key(c.get("model", "")) != r["model_key"]
                      and sources.get(c["id"], {}).get("price") in sib_prices]
            method = "exact model + brand"
            if len(cands) == n_pdf and len(sib_prices) == 1:
                ordered = sorted(cands, key=lambda c: (c.get("sortOrder", 0), c["id"]))
                cands = [ordered[sorted(siblings, key=lambda x: (x["pdf_page"], x["row_no"])).index(r)]]
                method = method + "; duplicate model, identical price on every PDF row, paired by catalog order"
                r["warnings"].append(f"model appears {n_pdf}x in PDF with the same price")
            elif len(cands) == n_pdf and len(sib_prices) == n_pdf:
                by_price = [c for c in cands if sources.get(c["id"], {}).get("price") == r["price_sar"]]
                if len(by_price) == 1:
                    cands = by_price
                    method = method + "; duplicate model, paired by unique catalog source price"
                    r["warnings"].append(f"model appears {n_pdf}x in PDF with different prices")
                else:
                    r["match_status"] = "DUPLICATE_PDF_RECORD"
                    r["warnings"].append(f"model appears {n_pdf}x in PDF; cannot pair to {', '.join(c['id'] for c in cands)}")
                    continue
            else:
                r["match_status"] = "DUPLICATE_PDF_RECORD"
                r["warnings"].append(f"model appears {n_pdf}x in PDF; {len(cands)} website records")
                continue

        if len(cands) == 1:
            c = cands[0]
            r["product_id"] = c["id"]
            if same_brand(c):
                r["match_status"] = "VERIFIED_MATCH" if "duplicate model" in method else "EXACT_MATCH"
                r["match_method"] = method
            else:
                r["match_status"], r["match_method"] = "REVIEW_REQUIRED", method + " (brand differs)"
                r["warnings"].append(f"PDF brand {r['pdf_brand_label']} vs product brand {c.get('brand')}")
        elif len(cands) > 1:
            r["match_status"] = "REVIEW_REQUIRED"
            r["warnings"].append(f"{len(cands)} products share this model: {', '.join(c['id'] for c in cands)}")
        else:
            loose = [c for c in by_loose.get(loose_key(r["model_joined"]), []) if same_brand(c)]
            # PDF fonts sometimes drop non-Latin characters (e.g. a full-width "（POE）" suffix):
            # accept a unique same-brand model that starts with the PDF model only if the catalog
            # source price also agrees.
            prefix = [c for c in products if same_brand(c) and c.get("status") != "archived"
                      and norm_key(c.get("model", "")).startswith(r["model_key"]) and norm_key(c.get("model", "")) != r["model_key"]]
            if len(loose) == 1 and text_similarity(loose[0].get("name", ""), r["description"]) >= 0.6:
                c = loose[0]
                r["product_id"], r["match_status"], r["match_method"] = c["id"], "VERIFIED_MATCH", "model ignoring punctuation + brand + description"
                r["warnings"].append(f"model punctuation differs: PDF {r['model_joined']} vs {c.get('model')}")
            elif len(prefix) == 1 and len(r["model_key"]) >= 8 and sources.get(prefix[0]["id"], {}).get("price") == r["price_sar"]:
                c = prefix[0]
                r["product_id"], r["match_status"], r["match_method"] = c["id"], "VERIFIED_MATCH", "unique model prefix + brand + same catalog source price"
                r["warnings"].append(f"PDF model {r['model_joined']} is missing a suffix present on the website ({c.get('model')})")
            else:
                # suggestion only — never applied automatically
                pool = [p for p in products if same_brand(p)]
                best = max(pool, key=lambda p: difflib.SequenceMatcher(None, r["model_key"], norm_key(p.get("model", ""))).ratio(), default=None)
                score = difflib.SequenceMatcher(None, r["model_key"], norm_key(best.get("model", ""))).ratio() if best else 0
                if best and score >= 0.85:
                    r["match_status"] = "REVIEW_REQUIRED"
                    r["match_method"] = f"fuzzy model suggestion ({score:.2f})"
                    r["product_id"] = best["id"]
                    r["warnings"].append("fuzzy suggestion only; verify variant before applying")
                else:
                    r["match_status"] = "NO_MATCH"
        if r["product_id"]:
            c = next(p for p in products if p["id"] == r["product_id"])
            r.update({"db_model": c.get("model", ""), "db_sku": c.get("sku", ""), "db_name": c.get("name", ""),
                      "db_brand": c.get("brand", ""), "db_status": c.get("status", "")})

    # one product must not receive two PDF prices
    claimed = defaultdict(list)
    for r in rows:
        if r["match_status"] in ("EXACT_MATCH", "VERIFIED_MATCH"):
            claimed[r["product_id"]].append(r)
    for pid, rs in claimed.items():
        if len(rs) > 1:
            for r in rs:
                r["match_status"] = "REVIEW_REQUIRED"
                r["warnings"].append(f"product {pid} matched by {len(rs)} PDF rows")

    # The PDFs print whole riyals. When the catalog data holds a fractional price that rounds to
    # the PDF value, the PDF figure is less precise: send to review instead of applying it.
    for r in rows:
        sp = sources.get(r["product_id"], {}).get("price") if r["product_id"] else None
        if r["match_status"] in ("EXACT_MATCH", "VERIFIED_MATCH") and isinstance(sp, float) and not sp.is_integer() and round(sp) == r["price_sar"]:
            r["match_status"] = "REVIEW_REQUIRED"
            r["warnings"].append(f"PDF shows a rounded price; catalog source data has {sp}")
        if r["price_problem"] == "PRICE_NOT_POSITIVE" and isinstance(sp, (int, float)) and 0 < sp < 0.5:
            r["warnings"].append(f"PDF shows SAR 0; catalog source data has {sp} (rounded down in the PDF)")
        if r["price_problem"] == "PRICE_NOT_POSITIVE" and not r["product_id"]:
            # still identify the product so the reviewer can find it
            hits = [p for p in products if norm_key(p.get("model", "")) == r["model_key"]]
            if len(hits) == 1:
                p = hits[0]
                sp = sources.get(p["id"], {}).get("price")
                r.update({"product_id": p["id"], "db_model": p.get("model", ""), "db_sku": p.get("sku", ""), "db_name": p.get("name", ""),
                          "db_brand": p.get("brand", ""), "db_status": p.get("status", ""), "match_method": "exact model (price unusable)"})
                if isinstance(sp, (int, float)) and 0 < sp < 0.5:
                    r["warnings"].append(f"PDF shows SAR 0; catalog source data has {sp} (rounded down in the PDF)")


# ------------------------------------------------------------------ outputs
def write_csv(path: Path, rows: list[dict], cols: list[str]):
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("; ".join(v) if isinstance(v, list) else v) for k, v in r.items()})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", default=str(ROOT / "data" / "pdf_sources"))
    ap.add_argument("--snapshot", required=True)
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    extracted_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    pdfs = sorted(Path(args.pdf_dir).glob("*.pdf"))
    errors: list[dict] = []
    rows: list[dict] = []
    metas = []
    seen_text = {}
    for p in pdfs:
        text_hash = hashlib.sha256("".join(pg.get_text() for pg in pymupdf.open(p)).encode()).hexdigest()
        if text_hash in seen_text:
            errors.append({"file": p.name, "page": "", "row_no": "", "problem": "DUPLICATE_PDF_FILE", "detail": f"same text as {seen_text[text_hash]}; skipped"})
            continue
        seen_text[text_hash] = p.name
        r, meta = extract_pdf(p, errors)
        rows.extend(r)
        metas.append(meta)
        print(f"{meta['file']}: {meta['pages']} pages, declared {meta['declared_products']}, extracted {meta['extracted_rows']}", file=sys.stderr)

    products, sources = load_snapshot(Path(args.snapshot))
    match_rows(rows, products, sources)

    # preview of proposed changes (stored as admin-only PDF reference price)
    by_id = {p["id"]: p for p in products}
    preview = []
    for r in rows:
        if r["match_status"] not in ("EXACT_MATCH", "VERIFIED_MATCH"):
            continue
        p = by_id[r["product_id"]]
        s = sources.get(p["id"], {})
        warn = list(r["warnings"])
        if s.get("price") is not None and s.get("price") != r["price_sar"]:
            warn.append(f"differs from catalog snapshot source price {s.get('price')}")
        if p.get("price") is not None:
            warn.append(f"product already has a Wider Universal selling price {p.get('price')} (not changed)")
        preview.append({
            "product_id": p["id"], "website_name": p.get("name"), "website_model": p.get("model"), "website_sku": p.get("sku"),
            "website_brand": p.get("brand"), "website_status": p.get("status"),
            "pdf_name_or_description": r["description"], "pdf_model": r["model_joined"], "pdf_price_text": r["price_text"],
            "extracted_price_sar": r["price_sar"], "target_field": "productSources.pdfListPrice",
            "current_target_value": s.get("pdfListPrice", ""), "current_selling_price": p.get("price"),
            "pdf_file": r["pdf_file"], "pdf_page": r["pdf_page"], "pdf_row": r["row_no"],
            "match_status": r["match_status"], "match_method": r["match_method"], "warnings": warn,
        })

    cols_extract = ["pdf_file", "pdf_page", "row_no", "pdf_brand_label", "pdf_section", "model_joined", "model_raw", "description",
                    "price_text", "price_sar", "currency", "unit", "price_source", "price_cell_text", "price_problem"]
    write_csv(OUT / "pdf_products_extracted.csv", rows, cols_extract)
    (OUT / "pdf_products_extracted.json").write_text(json.dumps({"extracted_at": extracted_at, "files": metas,
        "records": [{k: r[k] for k in cols_extract} for r in rows]}, ensure_ascii=False, indent=1), encoding="utf-8")
    write_csv(OUT / "pdf_extraction_errors.csv", errors, ["file", "page", "row_no", "problem", "detail"])
    cols_match = ["match_status", "match_method", "pdf_file", "pdf_page", "row_no", "pdf_brand_label", "model_joined", "description",
                  "price_text", "price_sar", "product_id", "db_model", "db_sku", "db_name", "db_brand", "db_status", "warnings"]
    write_csv(OUT / "price_match_report.csv", rows, cols_match)
    write_csv(OUT / "unmatched_products.csv", [r for r in rows if r["match_status"] not in ("EXACT_MATCH", "VERIFIED_MATCH")], cols_match)
    if preview:
        write_csv(OUT / "price_update_preview.csv", preview, list(preview[0].keys()))
    (OUT / "price_update_plan.json").write_text(json.dumps({
        "generated_at": extracted_at, "snapshot": str(Path(args.snapshot).name), "pdfs": metas,
        "updates": [{"productId": u["product_id"], "pdfListPrice": u["extracted_price_sar"], "pdfPriceText": u["pdf_price_text"],
                     "pdfFile": u["pdf_file"], "pdfPage": u["pdf_page"], "pdfRow": u["pdf_row"], "pdfModel": u["pdf_model"],
                     "matchStatus": u["match_status"], "matchMethod": u["match_method"], "currentSellingPrice": u["current_selling_price"]}
                    for u in preview],
        "review": [{"status": r["match_status"], "model": r["model_joined"], "priceText": r["price_text"], "file": r["pdf_file"],
                    "page": r["pdf_page"], "row": r["row_no"], "productId": r["product_id"], "warnings": "; ".join(r["warnings"])}
                   for r in rows if r["match_status"] not in ("EXACT_MATCH", "VERIFIED_MATCH")],
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    status = Counter(r["match_status"] for r in rows)
    matched_ids = {u["product_id"] for u in preview}
    unmatched_db = [p for p in products if p["id"] not in matched_ids and p.get("status") != "archived"]
    summary = {
        "extracted_at": extracted_at,
        "pdf_files_received": len(pdfs), "pdf_files_processed": len(metas), "pages": sum(m["pages"] for m in metas),
        "declared_products": sum(m["declared_products"] or 0 for m in metas), "extracted_rows": len(rows),
        "unique_model_keys": len({(r["model_key"], norm_brand(r["pdf_brand_label"])) for r in rows}),
        "valid_prices": sum(1 for r in rows if r["price_sar"] is not None),
        "match_status": dict(status), "planned_updates": len(preview),
        "price_differs_from_snapshot": sum(1 for u in preview if any("differs from catalog snapshot" in w for w in u["warnings"])),
        "existing_selling_price_present": sum(1 for u in preview if u["current_selling_price"] is not None),
        "website_products_without_pdf_price": [{"id": p["id"], "model": p.get("model"), "brand": p.get("brand"), "status": p.get("status")} for p in unmatched_db],
        "errors": dict(Counter(e["problem"] for e in errors)),
    }
    (OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "website_products_without_pdf_price"}, indent=1))
    print("website products without a PDF price:", len(unmatched_db))


if __name__ == "__main__":
    main()
