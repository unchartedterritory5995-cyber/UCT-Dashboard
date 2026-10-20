"""Study -- find a real chart for every candle name (Foundations F3, image-first).

WHY
---
Owner rulings 2026-10-19 on the candle segment: "Fix + draw the candle" and
"include images in most if not all of these examples". A candle item shows
the shape on a REAL chart drawn by the firm's own renderer, found by the
firm's OWN candle grammar (api/services/screener/candle_catalog.py through
candles.single_candle), never drawn by hand and never a third-party image.
This script finds the dates. It decides nothing about what a candle is: the
catalog's classify_shape / relation detectors are the only authority, called
exactly as the screener calls them. The owner reviews every example on the
review screen with the chart showing.

WHAT IT DOES
------------
For each candidate symbol, walk the daily bars newest first; at each bar run
`single_candle` on the trailing WINDOW bars (the screener's own call) and
record every catalog key it matched, spaced out so one stock never supplies
the whole set. Output JSON: `{generated, candidates, examples: [{key, sym,
asof, ts, bars, trend}]}`. `gen_candles.py` turns each into an item carrying
a `bars` SPEC (sym / tf / asof / window / forward); the import route resolves
the bars on the pod (get_bars_before only, B3).

HOW TO RUN (on the web pod, from PowerShell; it only READS bars.db)
-------------------------------------------------------------------
  railway ssh --service web -- /opt/venv/bin/python scripts/study/find_candle_examples.py > docs/study/terms/candle_examples.json
  python scripts/study/find_candle_examples.py --self-test       # synthetic bars, no DB

The scan is unit-tested in tests/test_study_find_candle_examples.py.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from datetime import date

try:
    REPO = pathlib.Path(__file__).resolve().parents[2]
except (NameError, IndexError):         # piped into python on the pod (__file__ is "<stdin>"): cwd is the repo root
    REPO = pathlib.Path(os.getcwd())
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from api.services.screener import candle_catalog as cat  # noqa: E402
from api.services.screener.candles import single_candle  # noqa: E402

# Candidates are only where we LOOK; the grammar decides. The same list the
# chart-word finder uses (liquid names a member recognises on a chart).
from scripts.study.find_term_examples import CANDIDATES, key_to_iso, rows_to_bars  # noqa: E402

Bar = dict
WINDOW = 60          # bars handed to single_candle: >= MIN_HISTORY + the trend anchor's 40
WARMUP = WINDOW      # never name a bar without a full window behind it


def names_at(bars: list[Bar], i: int, window: int = WINDOW) -> tuple[list[str], str | None]:
    """The catalog keys the screener would publish for bar `i`, and the trend
    the rendered pattern was judged against. [] when the bar has no shape."""
    if i + 1 < window:
        return [], None
    res = single_candle(bars[i + 1 - window:i + 1])
    if res.get("candle_type") in (None, "none"):
        return [], None
    keys = [k for k in cat.decode_matches(res.get("candle_matches") or "") if k in cat.BY_KEY]
    if not keys:
        keys = [res["candle_type"]]
    return keys, res.get("candle_trend")


def hits(bars_by_sym: dict[str, list[Bar]], *, window: int = WINDOW) -> dict[str, list[tuple]]:
    """ONE pass of the screener's grammar per bar: {sym: [(i, keys, trend), ...]}
    newest first. Everything below selects from this; nothing re-runs it."""
    out: dict[str, list[tuple]] = {}
    for sym, bars in bars_by_sym.items():
        rows = []
        for i in range(len(bars) - 1, window - 1, -1):
            keys, trend = names_at(bars, i, window)
            if keys:
                rows.append((i, keys, trend))
        out[sym] = rows
    return out


def scan(bars_by_sym: dict[str, list[Bar]], *, per_key: int = 4, per_sym: int = 1,
         min_gap_bars: int = 30, window: int = WINDOW, keys: set | None = None) -> list[dict]:
    """Up to `per_key` examples per catalog key, at most `per_sym` of one key
    per symbol, each at least `min_gap_bars` apart, dates newest first.
    Deterministic, and SPREAD: each key starts its walk at a different
    candidate (rotated by the key), so the first four names on the list do not
    supply every chart the owner sees."""
    want = {p.key for p in cat.ALL_PATTERNS} if keys is None else set(keys)
    by_sym = hits(bars_by_sym, window=window)
    syms = list(by_sym)
    out: list[dict] = []
    for n, key in enumerate(sorted(want)):
        found: list[dict] = []
        start = sum(ord(ch) for ch in key) % max(len(syms), 1)
        for sym in syms[start:] + syms[:start]:
            taken = 0
            last_i = None
            for i, matched, trend in by_sym[sym]:
                if taken >= per_sym or len(found) >= per_key:
                    break
                if key not in matched:
                    continue
                if last_i is not None and last_i - i < min_gap_bars:
                    continue
                bars = bars_by_sym[sym]
                found.append({"key": key, "sym": sym, "asof": key_to_iso(bars[i]["t"]), "ts": bars[i]["t"],
                              "bars": cat.BY_KEY[key].bars, "trend": trend})
                taken += 1
                last_i = i
            if len(found) >= per_key:
                break
        out.extend(found[:per_key])
    return out


def _synthetic(n: int = 120) -> list[Bar]:
    """A gentle decline that ends in a long-lower-wick bar (a hammer-shaped
    bar after a decline), for --self-test and the unit test's control."""
    bars = []
    for i in range(n):
        base = 200 - i * 0.6
        o, c = base + 0.2, base - 0.3
        bars.append({"t": 20240101 + i, "o": o, "h": max(o, c) + 0.4, "l": min(o, c) - 0.4, "c": c, "v": 1000})
    last = bars[-1]
    base = last["c"]
    bars[-1] = {"t": last["t"], "o": base + 0.1, "h": base + 0.3, "l": base - 2.6, "c": base + 0.2, "v": 1000}
    return bars


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Find real-chart examples for every candle name.")
    ap.add_argument("--self-test", action="store_true", help="run the scan on synthetic bars; no database")
    ap.add_argument("--per-key", type=int, default=4)
    ap.add_argument("--bars", type=int, default=700, help="daily bars of history per candidate")
    ap.add_argument("--only", action="append", default=[], help="catalog key (repeatable)")
    args = ap.parse_args(argv)
    if args.self_test:
        bars = _synthetic()
        print(json.dumps({"last_bar": names_at(bars, len(bars) - 1), "found": scan({"SYN": bars}, per_key=1)[:5]}))
        return 0
    from api.services import bars_sqlite  # noqa: E402  (pod only)
    today = int(date.today().strftime("%Y%m%d"))
    bars_by_sym = {}
    for sym in CANDIDATES:
        rows = bars_sqlite.get_bars_before(sym, "D", args.bars, today)
        if len(rows) >= 300:
            bars_by_sym[sym] = rows_to_bars(rows)
    keys = set(args.only) if args.only else None
    found = scan(bars_by_sym, per_key=args.per_key, keys=keys)
    print(json.dumps({"generated": date.today().isoformat(), "candidates": len(bars_by_sym), "window": WINDOW,
                      "examples": found}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
