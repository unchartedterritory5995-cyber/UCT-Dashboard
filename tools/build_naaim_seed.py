"""Build the versioned NAAIM historical seed from NAAIM's own PUBLIC table.

    python tools/build_naaim_seed.py            # fetch live
    python tools/build_naaim_seed.py --local    # reuse ./_naaimtmp/table.html

Writes `api/data/naaim_history.csv` (columns: observed_on,value), merging whatever the
public table currently carries with whatever the file already had — the table is a
ROLLING WINDOW, so each run can only add to the front and the file is the accumulating
record.

⛔⛔ NO PAYWALL IS CROSSED AND NONE MAY BE. `https://index.naaim.org/embeddable/table` is
the widget NAAIM publish for anyone to embed: no key, no login, no access control. It
carries a rolling ~2.5-year window on roughly a three-month delay, which is exactly what
NAAIM chose to make public after moving the live index to a subscription on 2026-08-01.
This tool must never be pointed at a subscriber endpoint, and the POC's licensing
position is recorded on the `SENT:NAAIM` registry row: free data is "for tracking only",
and a commercial UCT product needs the Program Partner tier ($1,500/yr), which grants an
API key and explicitly permits redistribution with attribution.

⚠️ THE DATES ARE SURVEY WEDNESDAYS. NAAIM's table is keyed on the observation week, not
the publication day, which is why `naaim_store` can store them with `date_inferred=0`.
"""
from __future__ import annotations

import csv
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

OUT = os.path.join(ROOT, "api", "data", "naaim_history.csv")
LOCAL = os.path.join(ROOT, "_naaimtmp")
URL = "https://index.naaim.org/embeddable/table"
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/140.0 Safari/537.36")

#: NAAIM's published scale. ⛔ NOT `0..200` — the live collector's gate is that, and it
#: silently discards the negative readings the index exists to capture.
LO, HI = -200.0, 200.0

_ROW = re.compile(
    r"<td[^>]*>\s*(\d{2})/(\d{2})/(\d{4})\s*</td>\s*<td[^>]*>\s*(-?[\d.]+)\s*</td>",
    re.I | re.S)


def fetch(use_local: bool) -> str:
    cache = os.path.join(LOCAL, "table.html")
    if use_local and os.path.exists(cache):
        with open(cache, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    req = urllib.request.Request(URL, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode("utf-8", "replace")
    try:
        os.makedirs(LOCAL, exist_ok=True)
        with open(cache, "w", encoding="utf-8") as f:
            f.write(text)
    except Exception:
        pass
    return text


def parse(html: str) -> dict:
    """`{observed_on: value}` from the public table.

    ⚠️ PAIRS A DATE CELL WITH THE VERY NEXT NUMERIC CELL rather than indexing a column,
    because the table also carries the bearish/bullish quartile columns and their order
    has changed before. The mean exposure is the first number after the date.
    """
    out = {}
    for m in _ROW.finditer(html):
        mm, dd, yy, val = m.groups()
        try:
            v = float(val)
        except ValueError:
            continue
        if not (LO <= v <= HI):
            continue
        out[f"{int(yy):04d}-{int(mm):02d}-{int(dd):02d}"] = v
    return out


def load_existing() -> dict:
    out = {}
    if not os.path.exists(OUT):
        return out
    with open(OUT, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(l for l in f if not l.startswith("#")):
            try:
                out[r["observed_on"]] = float(r["value"])
            except (KeyError, ValueError):
                continue
    return out


def load_legacy_sentiment_seed() -> dict:
    """The `naaim` rows already in `api/data/breadth_sentiment_history.csv`.

    ⭐ REUSED RATHER THAN RE-FETCHED. Those rows were built by
    `tools/build_breadth_sentiment.py` from this same public table, so folding them in
    extends the record backwards with identical provenance — and it means this file is
    a superset of what production already ships rather than a competing history.
    """
    path = os.path.join(ROOT, "api", "data", "breadth_sentiment_history.csv")
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("key") == "naaim":
                try:
                    out[r["date"]] = float(r["value"])
                except (KeyError, ValueError):
                    continue
    return out


HEADER = (
    "# NAAIM Exposure Index - historical seed for the Market Indicators POC.\n"
    "#\n"
    "# Source: https://index.naaim.org/embeddable/table - NAAIM's own PUBLIC embeddable\n"
    "# widget. No key, no login, no access control. It carries a rolling ~2.5-year window\n"
    "# on roughly a three-month delay, which is what NAAIM chose to leave public after\n"
    "# moving the live index to a subscription on 2026-08-01. Rows before that window are\n"
    "# carried forward from api/data/breadth_sentiment_history.csv, which production\n"
    "# already ships and which was built from the same public table.\n"
    "#\n"
    "# observed_on is the SURVEY WEDNESDAY. Publication is the following Thursday; the\n"
    "# knowledge date is derived by naaim_store, not stored here.\n"
    "#\n"
    "# LICENSING: NAAIM publish this data 'for use in tracking only' and require express\n"
    "# permission for commercial use. This seed is a private proof of concept. A\n"
    "# commercial UCT product needs the NAAIM Program Partner tier, which grants API\n"
    "# access and permits redistribution with the attribution line\n"
    "# 'Source: NAAIM Exposure Index(R) (National Association of Active Investment\n"
    "# Managers)'. Swapping to it changes naaim_store's INPUT and nothing above it.\n"
)


def main(argv) -> int:
    use_local = "--local" in argv
    merged = load_legacy_sentiment_seed()
    before_legacy = len(merged)
    merged.update(load_existing())
    try:
        fresh = parse(fetch(use_local))
    except Exception as e:
        print(f"public table fetch/parse failed: {e}")
        fresh = {}
    merged.update(fresh)
    if not merged:
        print("nothing to write")
        return 1
    rows = sorted(merged.items())
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        f.write(HEADER)
        w = csv.writer(f)
        w.writerow(["observed_on", "value"])
        for d, v in rows:
            w.writerow([d, f"{v:g}"])
    print(f"legacy sentiment seed : {before_legacy} weeks")
    print(f"public table now      : {len(fresh)} weeks")
    print(f"merged -> {OUT}")
    print(f"  {len(rows)} weeks, {rows[0][0]} .. {rows[-1][0]}")
    neg = [d for d, v in rows if v < 0]
    print(f"  negative readings: {len(neg)}" + (f" (first {neg[0]})" if neg else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
