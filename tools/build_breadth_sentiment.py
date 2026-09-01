"""Build the historical breadth-sentiment seed CSV from public archives.

The 4:15pm collector only started storing sentiment on 2026-01-02, so the
Monitor's reconstructed (pre-2026) rows have no AAII / NAAIM / put-call / CNN
Fear&Greed. This tool gathers what is publicly available and writes ONE seed file
    api/data/breadth_sentiment_history.csv   (columns: date,key,value)
keyed by the exact metric names the Monitor uses, scaled to match the collector
(AAII in percentage points, F&G rounded 0-100, put/call + NAAIM as-is). The
web app seeds it into `breadth_sentiment_history` on boot (idempotent), and the
deep-history merge overlays it onto reconstructed rows.

Sources (all free / no key), verified 2026-08-31:
  AAII   https://www.aaii.com/files/surveys/sentiment.xls        (weekly, 1987+)
  CBOE   .../equitypcarchive.csv + equitypc.csv (cdn.cboe.com)   (daily, 2003-2019; frozen)
  CNN    raw.githubusercontent.com/whit3rabbit/fear-greed-data   (daily, 2011+)
  NAAIM  https://index.naaim.org/embeddable/table                (weekly, recent ~2.5yr only;
         full 2006+ history needs a free Nasdaq Data Link key — NAAIM/NAAIM)

Run:  python tools/build_breadth_sentiment.py            (fetches live)
      python tools/build_breadth_sentiment.py --local    (uses ./_senttmp/*)
Only rows dated before the collector floor are kept (the live collector owns 2026+).
"""
from __future__ import annotations

import csv
import io
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "api", "data", "breadth_sentiment_history.csv")
LOCAL = os.path.join(ROOT, "_senttmp")
COLLECTOR_FLOOR = "2026-01-02"     # keep only rows strictly before this
_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

USE_LOCAL = "--local" in sys.argv


def _get_bytes(url: str, local_name: str, headers: dict | None = None) -> bytes:
    lp = os.path.join(LOCAL, local_name)
    if USE_LOCAL and os.path.exists(lp):
        with open(lp, "rb") as f:
            return f.read()
    req = urllib.request.Request(url, headers={"User-Agent": _UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    try:
        os.makedirs(LOCAL, exist_ok=True)
        with open(lp, "wb") as f:
            f.write(data)
    except Exception:
        pass
    return data


def _iso(m: int, d: int, y: int) -> str:
    return f"{y:04d}-{m:02d}-{d:02d}"


def _mdy_to_iso(s: str) -> str | None:
    s = (s or "").strip()
    mm = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", s)
    if not mm:
        return None
    m, d, y = int(mm.group(1)), int(mm.group(2)), int(mm.group(3))
    if y < 100:
        y += 2000 if y < 50 else 1900
    return _iso(m, d, y)


# ── AAII ──────────────────────────────────────────────────────────────────────
def parse_aaii(rows_out: list) -> int:
    import xlrd
    data = _get_bytes("https://www.aaii.com/files/surveys/sentiment.xls", "aaii.xls")
    wb = xlrd.open_workbook(file_contents=data)
    sh = wb.sheet_by_name("SENTIMENT")
    n = 0
    for r in range(5, sh.nrows):
        v0 = sh.cell_value(r, 0)
        if not isinstance(v0, float):    # trailing "Count 'YY" rows have a text col0
            continue
        try:
            dt = xlrd.xldate.xldate_as_datetime(v0, wb.datemode)
        except Exception:
            continue
        iso = dt.strftime("%Y-%m-%d")
        if iso >= COLLECTOR_FLOOR:
            continue
        bulls, neutral, bears, spread = (sh.cell_value(r, c) for c in (1, 2, 3, 6))
        for key, val in (("aaii_bulls", bulls), ("aaii_neutral", neutral),
                         ("aaii_bears", bears), ("aaii_spread", spread)):
            if isinstance(val, (int, float)) and val != "":
                rows_out.append((iso, key, round(val * 100, 1)))   # fraction → percent
                n += 1
    return n


# ── CBOE equity put/call (archive 2003-2012 + main 2006-2019, main wins overlap) ──
def parse_cboe(rows_out: list) -> int:
    pc: dict[str, float] = {}
    for url, name in (
        ("https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/equitypcarchive.csv", "cboe_equity_archive.csv"),
        ("https://cdn.cboe.com/resources/options/volume_and_call_put_ratios/equitypc.csv", "cboe_equity_main.csv"),
    ):
        text = _get_bytes(url, name).decode("latin-1")
        for line in text.splitlines()[3:]:          # first 3 lines are disclaimer + banner + header
            cols = [c.strip() for c in line.split(",")]
            if len(cols) < 5:
                continue
            iso = _mdy_to_iso(cols[0])
            if not iso or iso >= COLLECTOR_FLOOR:
                continue
            try:
                ratio = float(cols[4])
            except ValueError:
                continue
            pc[iso] = ratio                          # later file (main) overwrites overlap
    for iso, v in pc.items():
        rows_out.append((iso, "cboe_putcall", round(v, 2)))
    return len(pc)


# ── CNN Fear & Greed (2011+, reconstructed mirror) ────────────────────────────
def parse_cnn(rows_out: list) -> int:
    text = _get_bytes("https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv",
                      "cnn_fg.csv").decode("utf-8", "replace")
    n = 0
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 2 or row[0] == "Date":
            continue
        iso = row[0].strip()
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", iso) or iso >= COLLECTOR_FLOOR:
            continue
        try:
            rows_out.append((iso, "cnn_fear_greed", int(round(float(row[1])))))
            n += 1
        except ValueError:
            continue
    return n


# ── NAAIM (recent free HTML table only; full 2006+ history is key-gated) ──────
def parse_naaim(rows_out: list) -> int:
    try:
        html = _get_bytes("https://index.naaim.org/embeddable/table", "naaim_table.html").decode("utf-8", "replace")
    except Exception as e:
        print(f"  NAAIM: fetch failed ({e}); skipping (full history needs a Nasdaq Data Link key)")
        return 0
    n = 0
    # rows look like: <td>05/27/2026</td><td>98.39</td>... — first cell date, second = NAAIM number
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S | re.I):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S | re.I)
        if len(cells) < 2:
            continue
        iso = _mdy_to_iso(re.sub(r"<[^>]+>", "", cells[0]).strip())
        if not iso or iso >= COLLECTOR_FLOOR:
            continue
        try:
            val = float(re.sub(r"[^0-9.\-]", "", re.sub(r"<[^>]+>", "", cells[1])))
        except ValueError:
            continue
        rows_out.append((iso, "naaim", round(val, 2)))
        n += 1
    return n


def main() -> None:
    rows: list = []
    print("AAII  :", parse_aaii(rows), "readings")
    print("CBOE  :", parse_cboe(rows), "sessions")
    print("CNN   :", parse_cnn(rows), "sessions")
    print("NAAIM :", parse_naaim(rows), "weeks (recent free window only)")
    # De-dupe on (date,key) — last wins — then sort.
    dedup = {(d, k): v for (d, k, v) in rows}
    ordered = sorted(dedup.items(), key=lambda kv: (kv[0][0], kv[0][1]))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["date", "key", "value"])
        for (d, k), v in ordered:
            w.writerow([d, k, v])
    dmin = ordered[0][0][0] if ordered else "—"
    dmax = ordered[-1][0][0] if ordered else "—"
    print(f"\nwrote {len(ordered)} rows to {OUT}  (dates {dmin} -> {dmax})")


if __name__ == "__main__":
    main()
