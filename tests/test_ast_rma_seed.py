"""RMA-SEED (NUMBER PENDING) -- ``ta.rma``'s seed is the exactly rounded sum / n, the PYTHON lane held to the bit.

Pine's ``ta.rma`` seeds with ``ta.sma(src, length)``, and TradingView's ``ta.sma`` is the exactly rounded window
sum (SMA-EXACT). The first capture separating that from a left-to-right seed is our own committed probe
``vw-bi-dmi-{spy,rddt}-1d-2026-11-19``: its ``ta.dmi`` legs are ``ta.rma`` bodies (W1-W4 read 0 on every bar),
and three of its six ADX seeds part the two seeds (U3 on SPY bar 30 and RDDT bar 30, U4 on SPY bar 33);
TradingView's value is the exactly rounded one at all three. The JS lanes are held to the same doubles by
``app/src/components/chart/engine/ast/rmaSeedDmi.test.js``
(``docs/pine/evidence/2026-11-20-rma-seed-dmi/EVIDENCE.md``).
"""
import json
import math
import sys
from pathlib import Path

import pytest

from api.services import ast_interpret
from api.services.indicator_compute import compute_rsi_raw
from api.services import pine_compare as pc

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT / "tools") not in sys.path:
    sys.path.insert(0, str(ROOT / "tools"))
import ast_conformance as ac  # noqa: E402

HARNESS = ROOT / "tests" / "fixtures" / "vendor" / "harness"
RDDT_SR = HARNESS / "support-and-resistance-5f95e90f-rddt-1d-2026-11-13.json"


def _capture(sym):
    cap = json.loads((HARNESS / f"vw-bi-dmi-{sym}-1d-2026-11-19.json").read_text(encoding="utf-8"))
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in cap["bars"]["rows"]]
    fields = cap["plotValues"]["fields"]
    tv = {}
    for p in cap["study"]["plots"]:
        at = fields.index(p["id"])
        tv[p["title"]] = [r[at] for r in cap["plotValues"]["rows"]]
    return bars, tv


def _na(v):
    return v is None or (isinstance(v, float) and math.isnan(v))


def _adx_source(bars, di_len):
    """``|plus - minus| / (sum == 0 ? 1 : sum)`` of TradingView's DMI body, written out here (never imported)."""
    n = len(bars)

    def rma(src, length):
        out = [math.nan] * n
        prev = math.nan
        vals = []
        for i, v in enumerate(src):
            if not math.isfinite(v):
                continue
            if math.isnan(prev):
                vals.append(v)
                if len(vals) == length:
                    prev = math.fsum(vals) / length
                    out[i] = prev
            else:
                prev = (prev * (length - 1) + v) / length
                out[i] = prev
        return out

    up = [math.nan] + [bars[i]["h"] - bars[i - 1]["h"] for i in range(1, n)]
    down = [math.nan] + [-(bars[i]["l"] - bars[i - 1]["l"]) for i in range(1, n)]

    def dm(x, y):
        return [math.nan if math.isnan(x[i]) else (x[i] if pc.pine_gt(x[i], y[i]) and pc.pine_gt(x[i], 0) else 0.0)
                for i in range(n)]

    tr = [math.nan] + [max(bars[i]["h"] - bars[i]["l"], abs(bars[i]["h"] - bars[i - 1]["c"]),
                           abs(bars[i]["l"] - bars[i - 1]["c"])) for i in range(1, n)]
    trr = rma(tr, di_len)

    def di(move):
        r = rma(move, di_len)
        out, last = [], math.nan
        for i in range(n):
            v = math.nan if math.isnan(r[i]) or math.isnan(trr[i]) or trr[i] == 0 else 100 * r[i] / trr[i]
            if not math.isnan(v):
                last = v
            out.append(last)
        return out

    plus, minus = di(dm(up, down)), di(dm(down, up))
    return [math.nan if math.isnan(p) or math.isnan(m) else abs(p - m) / (1 if pc.pine_eq(p + m, 0) else p + m)
            for p, m in zip(plus, minus)]


SEPARATING = [("spy", "U3_adx_17_14", 30, 17, 14), ("rddt", "U3_adx_17_14", 30, 17, 14), ("spy", "U4_adx_14_20", 33, 14, 20)]


def test_rma_seed_mean_is_the_exactly_rounded_sum_over_its_length():
    xs = [0.1, 0.2, 0.3, 1e16, -1e16, 0.7]
    assert ast_interpret._rma_seed_mean(xs) == math.fsum(xs) / 6
    total = 0.0
    for v in xs:
        total += v
    assert ast_interpret._rma_seed_mean(xs) != total / 6


@pytest.mark.parametrize("sym,title,bar,di_len,adx_len", SEPARATING)
def test_the_python_rma_draws_tradingviews_adx_at_every_separating_seed_and_every_bar(sym, title, bar, di_len, adx_len):
    bars, tv = _capture(sym)
    x = _adx_source(bars, di_len)
    col = [None if _na(v) else 100 * v for v in ast_interpret._rma_col(x, adx_len)]
    assert col[bar] == tv[title][bar], (bar, col[bar], tv[title][bar])
    assert tv[title][bar - 1] is None  # the seed bar
    # every bar, by value (na equal to na only)
    assert [i for i, (a, b) in enumerate(zip(col, tv[title])) if a != b] == []
    # ⛔ and a left-to-right seed misses there (the rail can fail)
    vals = [v for v in x if math.isfinite(v)][:adx_len]
    total = 0.0
    for v in vals:
        total += v
    assert 100 * (total / adx_len) != tv[title][bar]


def test_pine_rsi_seeds_with_it_and_the_native_rsi_keeps_its_running_sum():
    xs = [100, 100.1, 100.3, 100.6, 101, 1e15, 101.2, 101.9, 102.5, 101, 103.3, 103.1, 104.4, 104.2, 105, 104.7, 106, 107]
    pine = compute_rsi_raw(xs, 14, seed_mean=ast_interpret._rma_seed_mean)
    native = compute_rsi_raw(xs, 14)
    assert pine != native  # the fixture separates the two seeds
    got = ast_interpret.FN_PINE["rsi"](xs, 14)
    assert [None if _na(v) else v for v in got] == pine
    plain = ast_interpret.FN["rsi"](xs, 14)
    assert [None if _na(v) else v for v in plain] == native


@pytest.mark.skipif(not ac.js_lane_available(), reason="no JS lane")
def test_js_and_python_agree_bit_for_bit_where_the_seeds_part():
    rows = json.loads(RDDT_SR.read_text(encoding="utf-8"))["bars"]["rows"]
    bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]
    closes = [b["c"] for b in bars[:14]]
    total = 0.0
    for v in closes:
        total += v
    assert math.fsum(closes) / 14 != total / 14  # rma(close, 14)'s seed parts the two on these bars
    S = {"type": "series", "name": "close"}
    cases = [
        {"id": "rma_close_14", "ast": {"type": "call", "name": "rma", "args": [S, {"type": "num", "value": 14}]}},
        {"id": "atr_pine_14", "ast": {"type": "call", "name": "atrPine", "args": [
            {"type": "series", "name": "high"}, {"type": "series", "name": "low"}, S, {"type": "num", "value": 14}]}},
    ]
    js = ac.run_js(cases, bars)
    py = ac.run_py(cases, bars)
    for c in cases:
        assert len(js[c["id"]]) == len(py[c["id"]]) == len(bars)
        diff = [i for i, (a, b) in enumerate(zip(js[c["id"]], py[c["id"]])) if not (a == b or (a is None and b is None))]
        assert diff == [], (c["id"], diff[:5])
    assert py["rma_close_14"][13] == math.fsum(closes) / 14
