"""Study -- find a real chart for every chart word (Vocabulary V.02).

WHY
---
The owner's ruling (2026-10-19): vocabulary items show the thing on a real
chart drawn by the firm's own renderer, not a text description. A chart
word like "coiled" needs a date on a real stock where the firm's OWN
definition of coiled is true. This script finds those dates. It never
decides what a word means: every rule below is the screener's formula from
`app/src/components/chart/engine/ast/conceptVocabulary.json`, re-stated
over raw bars so it can run against history (the screener only keeps
tonight's row). The owner reviews every example on the review screen.

WHAT IT DOES
------------
For each concept, walk the daily bars of a candidate list and record the
dates where the rule fires, spaced out so one stock does not supply the
whole set. Output is JSON: `[{concept, sym, asof, ts}]`. The generator
(`gen_terms.py`) turns each into an item carrying a `bars` SPEC, and the
import route resolves the bars on the pod (get_bars_before only).

HOW TO RUN (on the web pod, from PowerShell; it only READS bars.db)
-------------------------------------------------------------------
  railway ssh --service web -- /opt/venv/bin/python scripts/study/find_term_examples.py > docs/study/terms/examples.json
  python scripts/study/find_term_examples.py --self-test       # the rules on synthetic bars, no DB

The pure rules are unit-tested in tests/test_study_find_term_examples.py.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
from datetime import date
from typing import Callable

try:
    REPO = pathlib.Path(__file__).resolve().parents[2]
except (NameError, IndexError):         # piped into python on the pod (__file__ is "<stdin>"): cwd is the repo root
    REPO = pathlib.Path(os.getcwd())
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

# Candidates are only where we LOOK; the rule decides. Liquid, well-known
# names a member will recognise on a chart (the fixtures' eight mega-caps
# plus the names the desk talks about most).
CANDIDATES = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "NFLX",
    "AMD", "AVGO", "CRWD", "PLTR", "SMCI", "ARM", "COIN", "HOOD", "SHOP", "UBER",
    "NOW", "PANW", "ANET", "VRT", "APP", "MSTR", "RKLB", "IONQ", "HIMS", "SOFI",
    "CELH", "ELF", "DUOL", "AXON", "TTD", "DDOG", "SNOW", "NET", "ZS", "MDB",
    "LLY", "NVO", "COST", "WMT", "CMG", "DECK", "ONON", "CAVA", "SPOT", "ROKU",
    "BA", "DIS", "NKE", "INTC", "PYPL", "SQ", "RIVN", "LCID", "PTON", "ZM",
    "SPY", "QQQ", "IWM",
]

Bar = dict  # {t, o, h, l, c, v}


def _sma(vals: list[float], n: int) -> float | None:
    if len(vals) < n:
        return None
    return sum(vals[-n:]) / n


def _ema(vals: list[float], n: int) -> float | None:
    if len(vals) < n:
        return None
    k = 2.0 / (n + 1)
    e = sum(vals[:n]) / n
    for v in vals[n:]:
        e = e + k * (v - e)
    return e


def _closes(bars: list[Bar], i: int) -> list[float]:
    return [b["c"] for b in bars[: i + 1]]


# ── the rules (each is the screener's formula, over bars up to and including index i) ──

def trending(bars, i):
    c = _closes(bars, i)
    s20, s50, s200 = _sma(c, 20), _sma(c, 50), _sma(c, 200)
    if s200 is None:
        return False
    p20 = _sma(c[:-5], 20)
    return c[-1] > s20 > s50 > s200 and p20 is not None and s20 > p20


def in_a_downtrend(bars, i):
    c = _closes(bars, i)
    s20, s50, s200 = _sma(c, 20), _sma(c, 50), _sma(c, 200)
    if s200 is None:
        return False
    return c[-1] < s20 < s50 < s200


def coiled(bars, i):
    """tight_consolidation: coefficient of variation of the last ten closes under 2.5%."""
    c = _closes(bars, i)
    if len(c) < 10:
        return False
    last = c[-10:]
    m = sum(last) / 10
    if m <= 0:
        return False
    sd = (sum((x - m) ** 2 for x in last) / 10) ** 0.5
    return sd / m < 0.025


def _swing_lows(bars: list[Bar], i: int, wing: int = 2, lookback: int = 60) -> list[float]:
    lo = max(0, i - lookback)
    out = []
    for j in range(lo + wing, i - wing + 1):
        l = bars[j]["l"]
        if all(l < bars[j - k]["l"] for k in range(1, wing + 1)) and all(l < bars[j + k]["l"] for k in range(1, wing + 1)):
            out.append(l)
    return out


def higher_lows(bars, i):
    """higher_lows_run >= 3: the last three swing lows each above the one before."""
    sl = _swing_lows(bars, i)
    return len(sl) >= 3 and sl[-1] > sl[-2] > sl[-3]


def inside_day(bars, i):
    if i < 1:
        return False
    a, b = bars[i - 1], bars[i]
    return b["h"] < a["h"] and b["l"] > a["l"]


def _gap_pct(bars, i):
    if i < 1 or bars[i - 1]["c"] <= 0:
        return 0.0
    return (bars[i]["o"] - bars[i - 1]["c"]) / bars[i - 1]["c"] * 100


def gapping_up(bars, i):
    return _gap_pct(bars, i) >= 3


def gapping_down(bars, i):
    return _gap_pct(bars, i) <= -3


def heavy_volume(bars, i):
    """vol_ratio >= 2 against the symbol's own 20-day average (prior bars)."""
    if i < 20:
        return False
    avg = sum(b["v"] for b in bars[i - 20:i]) / 20
    return avg > 0 and bars[i]["v"] / avg >= 2


def near_its_highs(bars, i):
    """dist_52w_high_pct >= -5: within 5% of the 252-bar high, not a new high today."""
    if i < 252:
        return False
    hi = max(b["h"] for b in bars[i - 251: i + 1])
    return hi > 0 and (bars[i]["c"] - hi) / hi * 100 >= -5 and bars[i]["h"] < hi


def at_new_highs(bars, i):
    if i < 252:
        return False
    return bars[i]["h"] >= max(b["h"] for b in bars[i - 251: i])


def at_the_20_ema(bars, i):
    """pct_vs_ema20 in [-2, 2], the 20 EMA rising, above the 50 SMA (the shipped screen)."""
    c = _closes(bars, i)
    e, s50 = _ema(c, 20), _sma(c, 50)
    if e is None or s50 is None:
        return False
    ep = _ema(c[:-5], 20)
    pct = (c[-1] - e) / e * 100
    return -2 <= pct <= 2 and ep is not None and e > ep and c[-1] > s50


def _pullback_depth(bars, i, lookback=60):
    if i < lookback:
        return None
    hi = max(b["h"] for b in bars[i - lookback: i + 1])
    return (hi - bars[i]["c"]) / hi * 100 if hi > 0 else None


def _intermediate_uptrend(bars, i):
    """The pullback has somewhere to pull back FROM: close above the 50 SMA and the 50 above the 200."""
    c = _closes(bars, i)
    s50, s200 = _sma(c, 50), _sma(c, 200)
    return s200 is not None and c[-1] > s50 > s200


def shallow_pullback(bars, i):
    """pullback_depth_pct <= 5 (and at least 1, so a bar at the high is not a pullback), inside an uptrend."""
    d = _pullback_depth(bars, i)
    return d is not None and 1.0 <= d <= 5 and _intermediate_uptrend(bars, i)


def deep_pullback(bars, i):
    d = _pullback_depth(bars, i)
    return d is not None and d >= 20


RULES: dict[str, Callable] = {
    "trending": trending,
    "in a downtrend": in_a_downtrend,
    "coiled": coiled,
    "higher lows": higher_lows,
    "inside day": inside_day,
    "gapping up": gapping_up,
    "gapping down": gapping_down,
    "heavy volume": heavy_volume,
    "near its highs": near_its_highs,
    "at new highs": at_new_highs,
    "at the 20 ema": at_the_20_ema,
    "shallow pullback": shallow_pullback,
    "deep pullback": deep_pullback,
}


def key_to_iso(ts: int) -> str:
    s = str(int(ts))
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def rows_to_bars(rows) -> list[Bar]:
    return [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "v": float(r[5])}
            for r in rows]


def scan(bars_by_sym: dict[str, list[Bar]], *, per_concept: int = 6, per_sym: int = 1,
         min_gap_bars: int = 40, warmup: int = 260, rules: dict[str, Callable] | None = None) -> list[dict]:
    """Walk every candidate's bars once per rule, newest first, and keep up to
    `per_concept` examples per rule with at most `per_sym` per symbol, each
    at least `min_gap_bars` apart. Deterministic: candidates in the order
    given, dates newest first."""
    rules = rules or RULES
    out: list[dict] = []
    for concept, fn in rules.items():
        found: list[dict] = []
        for sym, bars in bars_by_sym.items():
            taken = 0
            last_i = None
            for i in range(len(bars) - 1, warmup - 1, -1):
                if taken >= per_sym:
                    break
                if last_i is not None and last_i - i < min_gap_bars:
                    continue
                if fn(bars, i):
                    found.append({"concept": concept, "sym": sym, "asof": key_to_iso(bars[i]["t"]), "ts": bars[i]["t"]})
                    taken += 1
                    last_i = i
            if len(found) >= per_concept:
                break
        out.extend(found[:per_concept])
    return out


def _synthetic(kind: str, n: int = 320) -> list[Bar]:
    """Bars that make exactly one rule true on the last bar, for --self-test."""
    import math
    bars = []
    for i in range(n):
        base = 100 + i * 0.3 if kind != "down" else 200 - i * 0.3
        wob = math.sin(i / 3.0) * 0.4
        o = base + wob
        c = base + wob + 0.2
        h = max(o, c) + 0.5
        l = min(o, c) - 0.5
        bars.append({"t": 20240101 + i, "o": o, "h": h, "l": l, "c": c, "v": 1000})
    return bars


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Find real-chart examples for the chart words.")
    ap.add_argument("--self-test", action="store_true", help="run the rules on synthetic bars; no database")
    ap.add_argument("--per-concept", type=int, default=6)
    ap.add_argument("--bars", type=int, default=700, help="daily bars of history per candidate")
    ap.add_argument("--only", action="append", default=[], help="concept name (repeatable)")
    args = ap.parse_args(argv)
    if args.self_test:
        up, down = _synthetic("up"), _synthetic("down")
        print(json.dumps({"trending(up)": trending(up, len(up) - 1), "downtrend(down)": in_a_downtrend(down, len(down) - 1),
                          "downtrend(up)": in_a_downtrend(up, len(up) - 1)}))
        return 0
    from api.services import bars_sqlite  # noqa: E402  (pod only)
    today = int(date.today().strftime("%Y%m%d"))
    bars_by_sym = {}
    for sym in CANDIDATES:
        rows = bars_sqlite.get_bars_before(sym, "D", args.bars, today)
        if len(rows) >= 300:
            bars_by_sym[sym] = rows_to_bars(rows)
    rules = {k: v for k, v in RULES.items() if not args.only or k in args.only}
    found = scan(bars_by_sym, per_concept=args.per_concept, rules=rules)
    print(json.dumps({"generated": date.today().isoformat(), "candidates": len(bars_by_sym),
                      "examples": found}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
