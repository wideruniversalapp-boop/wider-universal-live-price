"""
Simat Security reference catalog extraction pipeline.

Source: the public Cloud Firestore database that backs
https://simatsecurity-live-price.web.app/ . The reference website itself
queries `products` anonymously with:

    query(collection(db, "products"), orderBy("displayOrder"), limit(1500), startAfter(cursor))

This script issues the same anonymous, read-only query through the Firestore
REST API (no credentials, no authentication bypass), paginates with a cursor
until a page returns fewer than PAGE_SIZE rows, and then performs an
independent unordered collection listing to reconcile the count (documents
missing `displayOrder` would never appear on the website and are reported
separately).

Outputs (written next to this file, under ./output):
    extracted_products.json      cleaned records + raw source values
    extracted_products.csv       flat view of the same records
    extraction_errors.csv        per-record problems
    extraction_report.md         counts, reconciliation, field coverage
    raw/products_raw.jsonl       untouched Firestore documents (images stripped)
    images/<docId>.<ext>         decoded product images (embedded base64 in source)
    brands.json, settings.json   auxiliary public collections

Reruns are idempotent: records are keyed by the Firestore document ID and
images are only rewritten when their hash changes.
"""

from __future__ import annotations

import base64
import csv
import datetime as dt
import hashlib
import json
import re
import sys
import time
from pathlib import Path

import requests

PROJECT = "simatsecurity-live-price"
API_KEY = "AIzaSyC-eksQeg1-Z55CnS5x_224HZ_1ILVG3u0"  # public web key from /__/firebase/init.json
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents"
SITE = "https://simatsecurity-live-price.web.app/"
PAGE_SIZE = 200  # the site uses 1500; smaller pages keep responses (with base64 images) manageable

HERE = Path(__file__).resolve().parent
OUT = HERE / "output"
IMG = OUT / "images"
RAW = OUT / "raw"

session = requests.Session()
session.headers["User-Agent"] = "WiderUniversal-catalog-audit/1.0 (+sales@theuniversaltrading.com)"


# ---------------------------------------------------------------- Firestore value decoding
def decode_value(v: dict):
    if "stringValue" in v:
        return v["stringValue"]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "booleanValue" in v:
        return v["booleanValue"]
    if "nullValue" in v:
        return None
    if "timestampValue" in v:
        return v["timestampValue"]
    if "mapValue" in v:
        return {k: decode_value(x) for k, x in v["mapValue"].get("fields", {}).items()}
    if "arrayValue" in v:
        return [decode_value(x) for x in v["arrayValue"].get("values", [])]
    if "referenceValue" in v:
        return v["referenceValue"]
    if "geoPointValue" in v:
        return v["geoPointValue"]
    if "bytesValue" in v:
        return v["bytesValue"]
    return v


def decode_doc(doc: dict) -> dict:
    return {
        "id": doc["name"].rsplit("/", 1)[-1],
        "createTime": doc.get("createTime"),
        "updateTime": doc.get("updateTime"),
        "fields": {k: decode_value(v) for k, v in doc.get("fields", {}).items()},
    }


def request(method: str, url: str, **kw):
    for attempt in range(5):
        r = session.request(method, url, params={"key": API_KEY}, timeout=120, **kw)
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(2 ** attempt)
            continue
        raise RuntimeError(f"{method} {url} -> HTTP {r.status_code}: {r.text[:300]}")
    raise RuntimeError(f"{method} {url} failed after retries")


# ---------------------------------------------------------------- extraction passes
def ordered_pass() -> list[dict]:
    """Replicates the website query: orderBy displayOrder, cursor pagination."""
    docs: list[dict] = []
    cursor = None
    page = 0
    while True:
        q = {
            "from": [{"collectionId": "products"}],
            "orderBy": [
                {"field": {"fieldPath": "displayOrder"}, "direction": "ASCENDING"},
                {"field": {"fieldPath": "__name__"}, "direction": "ASCENDING"},
            ],
            "limit": PAGE_SIZE,
        }
        if cursor:
            q["startAt"] = {"values": cursor, "before": False}
        rows = request("POST", f"{BASE}:runQuery", json={"structuredQuery": q})
        batch = [r["document"] for r in rows if "document" in r]
        page += 1
        print(f"  ordered page {page}: {len(batch)} docs", file=sys.stderr)
        docs.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        last = batch[-1]
        cursor = [last["fields"]["displayOrder"], {"referenceValue": last["name"]}]
    return docs


def list_pass(collection: str, mask: list[str] | None = None) -> list[dict]:
    """Unordered listing of every document ID (used for reconciliation)."""
    docs, token = [], None
    while True:
        params = {"pageSize": 300}
        if token:
            params["pageToken"] = token
        url = f"{BASE}/{collection}"
        if mask:
            url += "?" + "&".join(f"mask.fieldPaths={m}" for m in mask)
        r = session.get(url, params={**params, "key": API_KEY}, timeout=120)
        r.raise_for_status()
        j = r.json()
        docs.extend(j.get("documents", []))
        token = j.get("nextPageToken")
        if not token:
            break
    return docs


# ---------------------------------------------------------------- normalisation
DATA_URI = re.compile(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.*)$", re.S)
EXT = {"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg"}


def save_image(doc_id: str, field: str, value: str, errors: list) -> dict | None:
    if not value:
        return None
    if value.startswith("http"):
        return {"source": field, "url": value}
    m = DATA_URI.match(value)
    if not m:
        errors.append((doc_id, field, "unrecognised image value", value[:60]))
        return None
    mime, b64 = m.groups()
    try:
        data = base64.b64decode(b64)
    except Exception as e:  # noqa: BLE001
        errors.append((doc_id, field, f"base64 decode failed: {e}", ""))
        return None
    digest = hashlib.sha256(data).hexdigest()
    suffix = "" if field == "imageBase64" else f"_{field}"
    name = f"{doc_id}{suffix}.{EXT.get(mime, 'bin')}"
    path = IMG / name
    if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        path.write_bytes(data)
    return {"source": field, "file": f"images/{name}", "mime": mime, "bytes": len(data), "sha256": digest}


def norm_sku(model: str) -> str:
    """Matching key only. The exact model string is preserved separately."""
    return re.sub(r"\s+", "", (model or "")).upper()


BULLET = re.compile(r"^\s*(?:[>*•●▪◦·\-–]\s*)+")


def parse_description(desc: str) -> tuple[str, list[str]]:
    """Source descriptions use '>', '*', '•' or '-' bullet lines; split them out without rewording."""
    if not desc:
        return "", []
    lines = [l.rstrip() for l in desc.replace("\r", "").split("\n") if l.strip()]
    bullets = [BULLET.sub("", l).strip() for l in lines if BULLET.match(l)]
    bullets = [b for b in bullets if b]
    intro = "\n".join(l.strip() for l in lines if not BULLET.match(l)).strip()
    return intro, bullets


def build_record(d: dict, extracted_at: str, errors: list, reachable_on_site: bool) -> dict:
    f = d["fields"]
    raw = {k: v for k, v in f.items() if not (isinstance(v, str) and v.startswith("data:image"))}
    images = []
    for k, v in f.items():
        if isinstance(v, str) and (v.startswith("data:image") or (k.lower().startswith("image") and v.startswith("http"))):
            img = save_image(d["id"], k, v, errors)
            if img:
                images.append(img)
    intro, bullets = parse_description(f.get("description", ""))
    price = f.get("currentPrice")
    discount = f.get("discount") or 0
    computed_regular = round(price / (1 - discount / 100)) if isinstance(price, (int, float)) and discount and discount < 100 else None
    model = f.get("model")
    rec = {
        "source_id": d["id"],
        "product_name": f.get("productName"),
        "brand": f.get("brand"),
        "manufacturer": f.get("brand"),  # source has no separate manufacturer field
        "model": model,
        "sku_normalized": norm_sku(model) if model else None,
        "category": f.get("category"),
        "subcategory": f.get("subcategory"),
        "short_description": intro or None,
        "full_description": f.get("description"),
        "spec_bullets": bullets,
        "spec_source": "source:description" if bullets else None,
        "images": images,
        "source_price": price,
        "source_old_price": f.get("oldPrice"),
        "source_price_change": f.get("priceChange"),
        "source_discount_pct": discount or None,
        "source_regular_price_computed": computed_regular,
        "source_offer_description": f.get("offerDescription"),
        "source_currency": "SAR",
        "source_visibility": f.get("visibility"),
        "source_display_order": f.get("displayOrder"),
        "source_stock_status": f.get("stockStatus", f.get("inStock", "NOT PUBLISHED")),
        "source_url": SITE,
        "source_doc_path": f"products/{d['id']}",
        "source_create_time": d.get("createTime"),
        "source_update_time": d.get("updateTime"),
        "reachable_on_site": reachable_on_site,
        "extracted_at": extracted_at,
        "raw_fields": raw,
    }
    if not model:
        errors.append((d["id"], "model", "missing model number", ""))
    if not isinstance(price, (int, float)) or price <= 0:
        errors.append((d["id"], "currentPrice", "missing or non-positive price", str(price)))
    if not images:
        errors.append((d["id"], "image", "no image", ""))
    return rec


CSV_COLS = [
    "source_id", "product_name", "brand", "model", "sku_normalized", "category", "subcategory",
    "short_description", "spec_bullets", "image_files", "source_price", "source_old_price",
    "source_discount_pct", "source_regular_price_computed", "source_offer_description", "source_currency",
    "source_visibility", "source_stock_status", "source_display_order", "reachable_on_site",
    "source_update_time", "source_url", "extracted_at",
]


def main():
    OUT.mkdir(exist_ok=True)
    IMG.mkdir(exist_ok=True)
    RAW.mkdir(exist_ok=True)
    extracted_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    print("Pass 1: website-equivalent ordered query", file=sys.stderr)
    ordered = ordered_pass()
    print("Pass 2: full collection listing (IDs only)", file=sys.stderr)
    listed = list_pass("products", mask=["displayOrder"])
    listed_ids = {d["name"].rsplit("/", 1)[-1] for d in listed}
    ordered_ids = [d["name"].rsplit("/", 1)[-1] for d in ordered]
    ordered_set = set(ordered_ids)
    missing_from_site = sorted(listed_ids - ordered_set)

    extra = []
    for mid in missing_from_site:
        extra.append(request("GET", f"{BASE}/products/{mid}"))

    errors: list = []
    records = []
    seen = set()
    with open(RAW / "products_raw.jsonl", "w", encoding="utf-8") as raw_f:
        for doc, on_site in [(d, True) for d in ordered] + [(d, False) for d in extra]:
            d = decode_doc(doc)
            if d["id"] in seen:
                errors.append((d["id"], "id", "duplicate document returned by pagination", ""))
                continue
            seen.add(d["id"])
            stripped = {**d, "fields": {k: (v[:40] + "...<base64 stripped>" if isinstance(v, str) and v.startswith("data:image") else v) for k, v in d["fields"].items()}}
            raw_f.write(json.dumps(stripped, ensure_ascii=False) + "\n")
            records.append(build_record(d, extracted_at, errors, on_site))

    # duplicate model detection (flag only, never merge)
    by_sku: dict[str, list[str]] = {}
    for r in records:
        if r["sku_normalized"]:
            by_sku.setdefault(r["sku_normalized"], []).append(r["source_id"])
    dup_skus = {k: v for k, v in by_sku.items() if len(v) > 1}
    for k, ids in dup_skus.items():
        for i in ids:
            errors.append((i, "model", "model shared with other source records", ";".join(x for x in ids if x != i)))

    # auxiliary public collections
    brands = [decode_doc(b) for b in list_pass("brands")]
    for b in brands:
        for k, v in list(b["fields"].items()):
            if isinstance(v, str) and v.startswith("data:image"):
                img = save_image("brand_" + b["id"], k, v, errors)
                b["fields"][k] = img
    (OUT / "brands.json").write_text(json.dumps(brands, ensure_ascii=False, indent=1), encoding="utf-8")
    settings = {}
    for sid in ("global", "contacts"):
        try:
            settings[sid] = decode_doc(request("GET", f"{BASE}/settings/{sid}"))["fields"]
        except Exception as e:  # noqa: BLE001
            settings[sid] = {"error": str(e)}
    (OUT / "settings.json").write_text(json.dumps(settings, ensure_ascii=False, indent=1), encoding="utf-8")

    (OUT / "extracted_products.json").write_text(
        json.dumps({"extracted_at": extracted_at, "source": SITE, "count": len(records), "products": records}, ensure_ascii=False, indent=1),
        encoding="utf-8",
    )
    with open(OUT / "extracted_products.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_COLS, extrasaction="ignore")
        w.writeheader()
        for r in records:
            row = dict(r)
            row["spec_bullets"] = " | ".join(r["spec_bullets"])
            row["image_files"] = ";".join(i.get("file") or i.get("url") for i in r["images"])
            w.writerow(row)
    with open(OUT / "extraction_errors.csv", "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["source_id", "field", "problem", "detail"])
        w.writerows(errors)

    summary = {
        "extracted_at": extracted_at,
        "ordered_query_count": len(ordered),
        "collection_listing_count": len(listed_ids),
        "not_reachable_via_site_query": missing_from_site,
        "records_written": len(records),
        "duplicate_model_groups": dup_skus,
        "brands": len(brands),
        "errors": len(errors),
    }
    (OUT / "extraction_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps({k: (v if not isinstance(v, (list, dict)) else len(v)) for k, v in summary.items()}, indent=1))


if __name__ == "__main__":
    main()
