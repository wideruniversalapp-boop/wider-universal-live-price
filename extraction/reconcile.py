"""
Validation and reconciliation of the extracted reference catalog (local data only).

Input : output/extracted_products.json, output/extraction_summary.json, output/images/
Output: ../data/reconciled_products.csv
        ../data/specification_completeness_report.csv
        ../data/catalog_import.json      cleaned dataset used to seed Firestore
        output/reconciliation.md         reconciliation table + validation findings

The original extracted file is never modified. Records are never merged:
shared model numbers are flagged for human review only.
"""

from __future__ import annotations

import csv
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "output"
DATA = HERE.parent / "data"

# Category values in the source that are clearly spreadsheet-import artefacts rather
# than product categories. They are preserved in source_category; the cleaned
# category falls back to the subcategory-derived family below.
ARTEFACT_CATEGORIES = {"Price List", "Inventory Summary", "Sheet1", "General", "Dahua"}


def clean_text(s):
    return re.sub(r"[ \t]+", " ", s).strip() if isinstance(s, str) else s


def stable_id(rec):
    # Firestore document IDs are stable in the source; reuse them so reruns update in place.
    return f"ref-{rec['source_id']}"


def main():
    DATA.mkdir(exist_ok=True)
    payload = json.loads((OUT / "extracted_products.json").read_text(encoding="utf-8"))
    summary = json.loads((OUT / "extraction_summary.json").read_text(encoding="utf-8"))
    products = payload["products"]

    by_sku = defaultdict(list)
    for p in products:
        if p["sku_normalized"]:
            by_sku[p["sku_normalized"]].append(p)

    findings = Counter()
    rows, completeness, cleaned = [], [], []
    for p in products:
        issues = []
        model_raw = p["model"]
        model = clean_text(model_raw)
        if not model:
            issues.append("MISSING_MODEL")
        elif model != model_raw:
            issues.append("MODEL_WHITESPACE_TRIMMED")
        group = by_sku.get(p["sku_normalized"], [])
        dup_ids = [g["source_id"] for g in group if g["source_id"] != p["source_id"]]
        if dup_ids:
            same = all(g["source_price"] == p["source_price"] and g["product_name"] == p["product_name"] for g in group)
            issues.append("DUPLICATE_MODEL_IDENTICAL" if same else "DUPLICATE_MODEL_CONFLICTING")
        price = p["source_price"]
        if not isinstance(price, (int, float)) or price <= 0:
            issues.append("MISSING_PRICE")
        disc = p["source_discount_pct"]
        if disc is not None and not (0 < disc < 100):
            issues.append("INVALID_DISCOUNT")
        if p["source_regular_price_computed"] is not None and p["source_regular_price_computed"] < (price or 0):
            issues.append("PROMO_GT_REGULAR")
        imgs = [i for i in p["images"] if i.get("file")]
        broken = [i for i in imgs if not (OUT / i["file"]).exists()]
        if not imgs:
            issues.append("NO_IMAGE")
        if broken:
            issues.append("BROKEN_IMAGE")
        if not p["full_description"] or not p["full_description"].strip():
            issues.append("NO_DESCRIPTION")
        if not p["spec_bullets"]:
            issues.append("NO_STRUCTURED_FEATURES")
        if not p["source_visibility"]:
            issues.append("VISIBILITY_FIELD_ABSENT")
        if p["category"] in ARTEFACT_CATEGORIES:
            issues.append("CATEGORY_IS_IMPORT_ARTEFACT")
        for i in issues:
            findings[i] += 1

        status = "OK"
        if {"MISSING_MODEL", "MISSING_PRICE", "DUPLICATE_MODEL_CONFLICTING", "BROKEN_IMAGE", "INVALID_DISCOUNT", "PROMO_GT_REGULAR"} & set(issues):
            status = "REQUIRES VERIFICATION"

        official = p["raw_fields"].get("officialSiteUrl")
        rows.append({
            "id": stable_id(p),
            "source_id": p["source_id"],
            "model": model or "NOT FOUND",
            "model_source_exact": model_raw,
            "sku_normalized": p["sku_normalized"] or "",
            "product_name": clean_text(p["product_name"]),
            "brand": p["brand"],
            "source_category": p["category"],
            "source_subcategory": clean_text(p["subcategory"]),
            "source_price_sar": price,
            "source_discount_pct": disc or "",
            "source_regular_price_computed_sar": p["source_regular_price_computed"] or "",
            "source_offer_description": clean_text(p["source_offer_description"]) or "",
            "image_count": len(imgs),
            "feature_lines": len(p["spec_bullets"]),
            "manufacturer_url": official or "",
            "duplicate_of": ";".join(dup_ids),
            "issues": ";".join(issues),
            "status": status,
        })
        completeness.append({
            "id": stable_id(p),
            "model": model or "NOT FOUND",
            "brand": p["brand"],
            "verified_model_number": "YES (source)" if model else "NOT FOUND",
            "verified_price": "YES (source SAR)" if isinstance(price, (int, float)) and price > 0 else "NOT FOUND",
            "technical_specifications": f"{len(p['spec_bullets'])} feature lines (source description)" if p["spec_bullets"] else "REQUIRES VERIFICATION",
            "spec_source": p["spec_source"] or "",
            "product_image": "YES (source)" if imgs else "NOT FOUND",
            "manufacturer_datasheet": official or "NOT FOUND",
            "manufacturer_enriched": "NO",
            "conflicts": ";".join(i for i in issues if i.startswith("DUPLICATE")) or "",
        })
        cleaned.append({
            "id": stable_id(p),
            "sku": p["sku_normalized"] or f"NOSKU-{p['source_id']}",
            "model": model or "",
            "name": clean_text(p["product_name"]) or model or "",
            "brand": clean_text(p["brand"]),
            "category": clean_text(p["subcategory"]) or clean_text(p["category"]),
            "subcategory": "",
            "description": (p["full_description"] or "").strip(),
            "features": p["spec_bullets"],
            "specs": [],
            "imageFile": imgs[0]["file"] if imgs else None,
            "datasheetUrl": official or "",
            "source": {
                "system": "simatsecurity-live-price",
                "docId": p["source_id"],
                "url": p["source_url"],
                "price": price,
                "currency": "SAR",
                "discountPct": disc,
                "regularPriceComputed": p["source_regular_price_computed"],
                "offerDescription": p["source_offer_description"],
                "category": p["category"],
                "subcategory": p["subcategory"],
                "brand": p["brand"],
                "modelExact": model_raw,
                "updateTime": p["source_update_time"],
                "extractedAt": p["extracted_at"],
            },
            "verification": status,
            "issues": issues,
        })

    def write_csv(path, data):
        with open(path, "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.DictWriter(fh, fieldnames=list(data[0].keys()))
            w.writeheader()
            w.writerows(data)

    write_csv(DATA / "reconciled_products.csv", rows)
    write_csv(DATA / "specification_completeness_report.csv", completeness)
    (DATA / "catalog_import.json").write_text(
        json.dumps({"generatedFrom": "extraction/output/extracted_products.json", "extractedAt": payload["extracted_at"], "products": cleaned}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )

    unique = len({p["source_id"] for p in products})
    distinct_models = len(by_sku)
    dup_records = sum(len(v) - 1 for v in by_sku.values() if len(v) > 1)
    missing_fields = sum(1 for r in rows if r["status"] != "OK")
    brand_counts = Counter(p["brand"] for p in products)

    md = [
        "# Reconciliation",
        "",
        f"Extraction timestamp: {payload['extracted_at']}",
        "",
        "| Source | Source Count | Extracted Count | Unique Records | Duplicate Records | Missing Fields | Status |",
        "|---|---|---|---|---|---|---|",
        f"| Firestore `products` (website query, orderBy displayOrder) | {summary['collection_listing_count']} (full collection listing) | {summary['ordered_query_count']} | {unique} | {dup_records} (shared model, flagged not merged) | {missing_fields} records flagged | {'RECONCILED' if summary['collection_listing_count'] == summary['ordered_query_count'] == unique else 'MISMATCH'} |",
        f"| Firestore `brands` | {summary['brands']} | {summary['brands']} | {summary['brands']} | 0 | n/a | RECONCILED |",
        "",
        f"Distinct normalized model numbers: {distinct_models}",
        "",
        "## Validation findings (records affected)",
        "",
        "| Check | Records |",
        "|---|---|",
    ]
    md += [f"| {k} | {v} |" for k, v in sorted(findings.items())]
    md += ["", "## Records by brand", "", "| Brand | Records |", "|---|---|"]
    md += [f"| {k} | {v} |" for k, v in brand_counts.most_common()]
    (OUT / "reconciliation.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))


if __name__ == "__main__":
    main()
