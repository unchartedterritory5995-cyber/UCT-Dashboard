"""One-shot generator: turns the two *additional* tabs of the firm's "Uncharted
Education" workbook into api/services/education_extra_seed.py (SEED_VIDEOS_EXTRA,
consumed by education_service.ensure_default_videos() alongside SEED_VIDEOS and
SEED_VIDEOS_CHANNEL).

The workbook has three tabs:
  - "Uncharted Education" -> tools/gen_education_seed.py (already imported)
  - "Interviews"          -> guest interviews            (THIS generator)
  - "Mental Game"         -> trading-psychology series   (THIS generator)

Run:  python tools/gen_education_extra_seed.py <path-to-uncharted-education.xlsx>

Reads the .xlsx directly with the stdlib only (no openpyxl dependency), so it is
re-runnable on any machine. Rows without an extractable YouTube id are skipped +
reported. Deterministic + idempotent at the service layer (dedupe by youtube_id).
"""
from __future__ import annotations

import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime

# Categories. "Interviews" already exists on the Videos tab; "The Mental Game"
# is a new dedicated section for the firm's recurring trading-psychology series.
# Mirror both in app/src/pages/desk/VideosSection.jsx CATEGORY_ORDER.
INTERVIEWS = "Interviews"
MENTAL_GAME = "The Mental Game"

_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

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
    s = s.replace("20205", "2025")  # mirror the sheet typo fix in the sibling gen
    for fmt in ("%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return datetime.max  # unknown date sorts last


# A date embedded in a Mental Game session title, e.g. "Mental Game 2/21/23" or
# "Mental Game (4/4/23)".
_TITLE_DATE = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{2,4})")


def date_from_title(title: str):
    m = _TITLE_DATE.search(title or "")
    if not m:
        return datetime.max
    mm, dd, yy = m.groups()
    if len(yy) == 2:
        yy = "20" + yy
    try:
        return datetime(int(yy), int(mm), int(dd))
    except ValueError:
        return datetime.max


def clean_title(raw: str) -> str:
    return re.sub(r"\s+", " ", (raw or "").strip())


def clean_desc(raw: str) -> str:
    lines = [ln.rstrip() for ln in (raw or "").strip().splitlines()]
    return "\n".join(ln for ln in lines if ln is not None).strip()


# ---- minimal stdlib .xlsx reader -------------------------------------------

def _read_xlsx(path: str) -> dict[str, list[list[str]]]:
    """Return {sheet_name: [ [cell, ...], ... ]} for every tab. Values only."""
    z = zipfile.ZipFile(path)
    sst: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.iter(_NS + "si"):
            sst.append("".join(t.text or "" for t in si.iter(_NS + "t")))

    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    relmap = {x.get("Id"): x.get("Target") for x in rels}

    def col_to_num(ref: str) -> int:
        letters = re.match(r"[A-Z]+", ref).group()
        n = 0
        for ch in letters:
            n = n * 26 + (ord(ch) - 64)
        return n

    out: dict[str, list[list[str]]] = {}
    for s in wb.iter(_NS + "sheet"):
        name = s.get("name")
        target = relmap[s.get(_RNS + "id")]
        if not target.startswith("xl/"):
            target = "xl/" + target
        ws = ET.fromstring(z.read(target))
        rows: list[list[str]] = []
        for row in ws.iter(_NS + "row"):
            cells: dict[int, str] = {}
            for c in row.iter(_NS + "c"):
                t = c.get("t")
                v = c.find(_NS + "v")
                istr = c.find(_NS + "is")
                val = ""
                if t == "s" and v is not None:
                    val = sst[int(v.text)]
                elif t == "inlineStr" and istr is not None:
                    val = "".join(x.text or "" for x in istr.iter(_NS + "t"))
                elif v is not None:
                    val = v.text or ""
                cells[col_to_num(c.get("r"))] = val
            if cells:
                width = max(cells)
                rows.append([cells.get(i + 1, "") for i in range(width)])
        # drop fully-empty rows
        rows = [r for r in rows if any((x or "").strip() for x in r)]
        out[name] = rows
    return out


# ---- per-tab parsers --------------------------------------------------------

def parse_interviews(rows: list[list[str]]):
    """Interviews tab: Discord Post Date | Interviewee | YouTube Link | Discord Link.
    Title = first line of Interviewee; description = remaining lines (handles/creds)."""
    items = []
    for i, r in enumerate(rows[1:], start=1):  # skip header
        r = r + [""] * (4 - len(r))
        date_raw, who, yt_link = r[0], r[1], r[2]
        yt = extract_youtube_id(yt_link)
        if not yt:
            continue
        who_lines = [ln.strip() for ln in (who or "").splitlines() if ln.strip()]
        title = clean_title(who_lines[0]) if who_lines else "Interview"
        desc = "\n".join(who_lines[1:]).strip()
        items.append({
            "youtube_id": yt,
            "title": title,
            "description": desc,
            "category": INTERVIEWS,
            "_date": parse_date(date_raw),
            "_idx": i,
        })
    return items


def parse_mental_game(rows: list[list[str]]):
    """Mental Game tab: Session Title | Summary | YouTube Link.
    Date parsed from the session title (e.g. "Mental Game 2/21/23")."""
    items = []
    for i, r in enumerate(rows[1:], start=1):  # skip header
        r = r + [""] * (3 - len(r))
        title_raw, summary, yt_link = r[0], r[1], r[2]
        yt = extract_youtube_id(yt_link)
        if not yt:
            continue
        title = clean_title(title_raw) or "The Mental Game"
        items.append({
            "youtube_id": yt,
            "title": title,
            "description": clean_desc(summary),
            "category": MENTAL_GAME,
            "_date": date_from_title(title_raw),
            "_idx": i,
        })
    return items


def main():
    if len(sys.argv) < 2:
        print("usage: python tools/gen_education_extra_seed.py <uncharted-education.xlsx>")
        sys.exit(1)
    sheets = _read_xlsx(sys.argv[1])

    raw = []
    skipped_tabs = []
    if "Interviews" in sheets:
        raw += parse_interviews(sheets["Interviews"])
    else:
        skipped_tabs.append("Interviews")
    if "Mental Game" in sheets:
        raw += parse_mental_game(sheets["Mental Game"])
    else:
        skipped_tabs.append("Mental Game")

    # dedupe by youtube id (keep first occurrence)
    seen: dict[str, dict] = {}
    for v in raw:
        seen.setdefault(v["youtube_id"], v)

    # sort_order within each category: chronological then sheet order.
    by_cat: dict[str, list] = {}
    for v in seen.values():
        by_cat.setdefault(v["category"], []).append(v)
    out = []
    for cat in (INTERVIEWS, MENTAL_GAME):
        vids = by_cat.get(cat, [])
        vids.sort(key=lambda v: (v["_date"], v["_idx"]))
        for order, v in enumerate(vids):
            out.append({
                "youtube_id": v["youtube_id"],
                "title": v["title"],
                "description": v["description"],
                "category": cat,
                "sort_order": order,
            })

    _emit(out, by_cat, skipped_tabs)


def _py(s) -> str:
    return repr(s)


def _emit(videos, by_cat, skipped_tabs):
    lines = [
        '"""Seed library (extra tabs) for The Desk -> Videos.',
        "",
        'Generated by tools/gen_education_extra_seed.py from the "Interviews" and',
        '"Mental Game" tabs of the firm\'s "Uncharted Education" workbook. Consumed',
        "by education_service.ensure_default_videos() alongside SEED_VIDEOS and",
        "SEED_VIDEOS_CHANNEL. Idempotent: inserts only youtube_ids not already",
        "present. Do NOT hand-edit; re-run the generator to refresh.",
        '"""',
        "from __future__ import annotations",
        "",
        "SEED_VIDEOS_EXTRA: list[dict] = [",
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

    dst = "api/services/education_extra_seed.py"
    with open(dst, "w", encoding="utf-8") as f:
        f.write(text)

    print(f"Wrote {dst}: {len(videos)} videos")
    print("Per-category counts:")
    for cat in (INTERVIEWS, MENTAL_GAME):
        print(f"  {len(by_cat.get(cat, [])):>3}  {cat}")
    if skipped_tabs:
        print(f"WARNING: tabs not found in workbook: {skipped_tabs}")


if __name__ == "__main__":
    main()
