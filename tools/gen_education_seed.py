"""One-shot generator: turns the firm's "Uncharted Education" workshop sheet
(Post Date · Workshop Title · Description · YouTube Link · Discord Link) into
api/services/education_seed.py (SEED_VIDEOS, consumed by
education_service.ensure_default_videos()).

Run:  python tools/gen_education_seed.py <path-to-csv>

Category assignment is hand-curated per row (CATEGORY_BY_INDEX, 1-based to match
the sheet order). Rows without an extractable YouTube id are skipped + reported.
Re-runnable: overwrites education_seed.py deterministically.
"""
from __future__ import annotations

import csv
import re
import sys
from datetime import datetime

# 9 curated categories = the on-page sections of the Videos tab, ordered as a
# learning path (Mindset first → Guest sessions last). Mirror order in
# app/src/pages/desk/VideosSection.jsx CATEGORY_ORDER.
MINDSET = "Mindset & Psychology"
MARKET = "Market Analysis & Breadth"
SETUPS = "Setups & Strategies"
TECH = "Technical Analysis & Relative Strength"
RISK = "Risk & Trade Management"
SCAN = "Scanning, Watchlists & Stock Selection"
FLOW = "Options & Flow"
WORKSHOP = "Workshops & Fireside Chats"
GUEST = "Interviews"

# 1-based row index (sheet order) -> category.
CATEGORY_BY_INDEX: dict[int, str] = {
    1: MINDSET, 2: RISK, 3: MARKET, 4: SETUPS, 5: SCAN, 6: RISK, 7: SCAN,
    8: FLOW, 9: SETUPS, 10: MARKET, 11: MARKET, 12: MARKET, 13: MARKET,
    14: MINDSET, 15: MARKET, 16: MARKET, 17: MARKET, 18: TECH, 19: SCAN,
    20: SETUPS, 21: MINDSET, 22: MARKET, 23: MARKET, 24: MINDSET, 25: SETUPS,
    26: RISK, 27: MINDSET, 28: RISK, 29: RISK, 30: MARKET, 31: MINDSET,
    32: TECH, 33: SETUPS, 34: MARKET, 35: RISK, 36: MINDSET, 37: MARKET,
    38: MARKET, 39: MINDSET, 40: SETUPS, 41: MINDSET, 42: RISK, 43: FLOW,
    44: MINDSET, 45: MINDSET, 46: SETUPS, 47: MINDSET, 48: RISK, 49: MARKET,
    50: SETUPS, 51: MARKET, 52: MARKET, 53: MARKET, 54: SETUPS, 55: RISK,
    56: SETUPS, 57: SETUPS, 58: MARKET, 59: GUEST, 60: RISK, 61: MARKET,
    62: SCAN, 63: SCAN, 64: GUEST, 65: RISK, 66: WORKSHOP, 67: WORKSHOP,
    68: SETUPS, 69: FLOW, 70: GUEST, 71: SETUPS, 72: SCAN, 73: WORKSHOP,
    74: SCAN, 75: WORKSHOP, 76: WORKSHOP, 77: WORKSHOP, 78: WORKSHOP,
    79: WORKSHOP, 80: WORKSHOP, 81: WORKSHOP, 82: WORKSHOP, 83: WORKSHOP,
    84: WORKSHOP, 85: SETUPS, 86: WORKSHOP, 87: WORKSHOP, 88: WORKSHOP,
    89: WORKSHOP, 90: WORKSHOP, 91: WORKSHOP, 92: WORKSHOP, 93: WORKSHOP,
    94: WORKSHOP, 95: FLOW, 96: WORKSHOP, 97: WORKSHOP, 98: FLOW, 99: FLOW,
    100: FLOW, 101: MARKET, 102: TECH, 103: FLOW, 104: FLOW, 105: WORKSHOP,
    106: FLOW, 107: WORKSHOP, 108: WORKSHOP, 109: FLOW, 110: FLOW, 111: FLOW,
    112: FLOW, 113: FLOW, 114: FLOW, 115: SCAN, 116: FLOW, 117: FLOW,
    118: TECH, 119: FLOW, 120: TECH, 121: SETUPS, 122: FLOW, 123: FLOW,
    124: TECH, 125: MARKET, 126: SETUPS, 127: FLOW, 128: SETUPS, 129: FLOW,
    130: GUEST, 131: SCAN, 132: TECH, 133: SETUPS, 134: WORKSHOP, 135: TECH,
    136: TECH, 137: GUEST, 138: WORKSHOP, 139: SETUPS, 140: MINDSET,
    141: GUEST, 142: GUEST,
}

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YT_URL_PATTERNS = (
    re.compile(r"(?:youtube\.com/watch\?(?:.*&)?v=)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtu\.be/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/embed/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/shorts/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/live/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube\.com/watch/)([A-Za-z0-9_-]{11})"),
    re.compile(r"(?:youtube-nocookie\.com/embed/)([A-Za-z0-9_-]{11})"),
)


def extract_youtube_id(raw: str):
    s = (raw or "").strip()
    if not s:
        return None
    if _YT_ID.match(s):
        return s
    for pat in _YT_URL_PATTERNS:
        m = pat.search(s)
        if m:
            return m.group(1)
    return None


def parse_date(raw: str):
    s = (raw or "").strip()
    # Sheet has a typo "2/5/20205"; normalise obvious 5-digit years.
    s = s.replace("20205", "2025")
    for fmt in ("%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return datetime.max  # unknown date sorts last


def clean_title(raw: str) -> str:
    # Collapse internal newlines/whitespace; sheet has multi-line titles.
    return re.sub(r"\s+", " ", (raw or "").strip())


def clean_desc(raw: str) -> str:
    # Keep line breaks (bullet lists) but trim trailing whitespace per line.
    lines = [ln.rstrip() for ln in (raw or "").strip().splitlines()]
    return "\n".join(ln for ln in lines if ln is not None).strip()


def main():
    if len(sys.argv) < 2:
        print("usage: python tools/gen_education_seed.py <csv>")
        sys.exit(1)
    csv_path = sys.argv[1]
    with open(csv_path, encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    seen: dict[str, dict] = {}
    skipped: list[str] = []
    for i, r in enumerate(rows, start=1):
        yt = extract_youtube_id(r.get("YouTube Link") or "")
        title = clean_title(r.get("Workshop Title") or "")
        if not yt:
            skipped.append(f"  #{i}: {title[:70]} (link={ (r.get('YouTube Link') or '').strip()[:50] })")
            continue
        cat = CATEGORY_BY_INDEX.get(i, MARKET)
        if yt in seen:
            continue  # dedupe by youtube id (keep first occurrence)
        seen[yt] = {
            "youtube_id": yt,
            "title": title,
            "description": clean_desc(r.get("Description") or ""),
            "category": cat,
            "_date": parse_date(r.get("Post Date") or ""),
            "_idx": i,
        }

    # sort_order within a category: chronological (post date, then sheet order).
    by_cat: dict[str, list] = {}
    for v in seen.values():
        by_cat.setdefault(v["category"], []).append(v)
    out: list[dict] = []
    for cat, vids in by_cat.items():
        vids.sort(key=lambda v: (v["_date"], v["_idx"]))
        for order, v in enumerate(vids):
            out.append({
                "youtube_id": v["youtube_id"],
                "title": v["title"],
                "description": v["description"],
                "category": cat,
                "sort_order": order,
            })

    # Stable file order: category order, then sort_order.
    cat_order = [MINDSET, MARKET, SETUPS, TECH, RISK, SCAN, FLOW, WORKSHOP, GUEST]
    out.sort(key=lambda v: (cat_order.index(v["category"]), v["sort_order"]))

    _emit(out, len(rows), skipped, by_cat)


def _py(s: str) -> str:
    return repr(s)


def _emit(videos, total_rows, skipped, by_cat):
    lines = [
        '"""Seed library for The Desk → Videos ("Educational Videos").',
        "",
        "Generated by tools/gen_education_seed.py from the firm's \"Uncharted",
        "Education\" workshop sheet. Consumed by",
        "education_service.ensure_default_videos(), which inserts any video whose",
        "youtube_id is not already present (idempotent; never clobbers admin edits).",
        "",
        "Each video carries one curated category = its section in the Videos tab.",
        "Do NOT hand-edit; re-run the generator to refresh.",
        '"""',
        "from __future__ import annotations",
        "",
        "SEED_VIDEOS: list[dict] = [",
    ]
    for v in videos:
        lines.append("    {")
        lines.append(f"        \"youtube_id\": {_py(v['youtube_id'])},")
        lines.append(f"        \"title\": {_py(v['title'])},")
        lines.append(f"        \"description\": {_py(v['description'])},")
        lines.append(f"        \"category\": {_py(v['category'])},")
        lines.append(f"        \"sort_order\": {v['sort_order']},")
        lines.append("    },")
    lines.append("]")
    lines.append("")
    text = "\n".join(lines)

    dst = "api/services/education_seed.py"
    with open(dst, "w", encoding="utf-8") as f:
        f.write(text)

    print(f"Wrote {dst}: {len(videos)} videos (from {total_rows} sheet rows)")
    print("Per-category counts:")
    for cat in [MINDSET, MARKET, SETUPS, TECH, RISK, SCAN, FLOW, WORKSHOP, GUEST]:
        print(f"  {len(by_cat.get(cat, [])):>3}  {cat}")
    if skipped:
        print(f"\nSkipped {len(skipped)} rows with no extractable YouTube id:")
        for s in skipped:
            print(s)


if __name__ == "__main__":
    main()
