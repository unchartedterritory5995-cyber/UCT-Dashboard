"""UCT RS split, unit U6 (engineering map projects/rs-split-handoff-2026-11-09/
engineering-map.md §(a) U6, §(d)): the two SHARED golden fixtures for the maths
behind the `rsPhases` and `rsVsEma` chart definitions.

    tests/fixtures/indicators/rs_phases_spy.json   compute_rs_phases_columns
    tests/fixtures/indicators/rs_vs_ema_spy.json   compute_rs_vs_ema_columns

Both are built from ONE deterministic synthetic series (`build_series`: a
seeded random walk shaped into five regimes, so both phases, the no-phase
stretch, the warm-ups and one benchmark gap are all on the table), and each
`expected` column is the Python function's own output. This file REGENERATES
the series and the columns on every run and compares them to the committed
bytes at 1e-9, so a change to the maths (or to the series builder) is a red
test here, and the JS lane (`rsPhasesDef.test.js`, `rsVsEmaDef.test.js`)
reads the same files as its contract for the wire columns.

⛔ Regeneration is a reviewed commit, never a fix:

    C:/Users/pgosz/uct-venv/Scripts/python.exe tests/test_rs_split_golden.py --write

rewrites both files from the functions as they stand, which is exactly how a
real regression would be turned into a green build. Run it only when the
formula changes ON PURPOSE, and say so in the commit.
"""
from __future__ import annotations

import json
import pathlib
import random
import sys
from datetime import datetime, timezone

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.services import relative_strength as rsm  # noqa: E402
from tests.test_indicator_golden import _close, load_case  # noqa: E402

FIX = ROOT / "tests" / "fixtures" / "indicators"
REL_TOL = 1e-9
SEED = 20261109
N = 220
#: The one stock bar the benchmark does not carry (a halted benchmark day):
#: every column is None there and the averages skip it, never restart.
GAP_INDEX = 150

#: Five regimes of 44 bars: (stock drift, benchmark drift) per bar, in log terms.
#: 1 and 2 are the two shaded phases (RS up while the market falls, and the
#: reverse); 0, 3 and 4 move together or barely move, so no phase holds.
REGIMES = [(0.0005, 0.0004), (0.006, -0.004), (-0.005, 0.004), (-0.003, -0.003), (0.0002, 0.0001)]
STOCK_VOL, BENCH_VOL = 0.012, 0.006
T0 = int(datetime(2026, 1, 5, tzinfo=timezone.utc).timestamp())
DAY = 86400


def _bar(t: int, prev_close: float, close: float, rnd: random.Random, spread: float) -> dict:
    o = round(prev_close, 4)
    c = round(close, 4)
    h = round(max(o, c) * (1 + abs(rnd.gauss(0, spread))), 4)
    l = round(min(o, c) * (1 - abs(rnd.gauss(0, spread))), 4)
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": int(500_000 * rnd.uniform(0.7, 1.4))}


def build_series(seed: int = SEED, n: int = N) -> tuple[list[dict], list[dict]]:
    """The stock and the benchmark, aligned by `t`, the benchmark missing one bar.
    Byte-for-byte reproducible: one `random.Random(seed)`, draws in a fixed order."""
    rnd = random.Random(seed)
    stock, bench = [], []
    cs, cb = 100.0, 400.0
    per_regime = n // len(REGIMES)
    for i in range(n):
        ds, db = REGIMES[min(i // per_regime, len(REGIMES) - 1)]
        ns = cs * pow(2.718281828459045, ds + rnd.gauss(0, STOCK_VOL))
        nb = cb * pow(2.718281828459045, db + rnd.gauss(0, BENCH_VOL))
        t = T0 + i * DAY
        stock.append(_bar(t, cs, ns, rnd, 0.004))
        bench.append(_bar(t, cb, nb, rnd, 0.002))
        cs, cb = round(ns, 4), round(nb, 4)
    del bench[GAP_INDEX]
    return stock, bench


def build_case(name: str) -> dict:
    stock, bench = build_series()
    if name == "rs_phases_spy":
        short, long = rsm.DEFAULT_PHASES_SHORT, rsm.DEFAULT_PHASES_LONG
        cols = rsm.compute_rs_phases_columns(stock, bench, short, long)
        return {
            "case": name, "kind": "rs_phases",
            "note": ("UCT RS Phases (RS split U6, 2026-11-09): compute_rs_phases_columns over a seeded "
                     "synthetic daily series of 220 stock bars in five regimes (quiet up; RS up while the "
                     "benchmark falls; RS down while it rises; both down; flat) and 219 benchmark bars "
                     f"(stock index {GAP_INDEX} has no benchmark bar: None in every column, skipped by the "
                     "averages). phase is 1 / 0 / null, divergence the clamped z-score (warm-up: EMA_long "
                     "seeds at index 9, 63 valid spreads to index 71). rsTrend / benchTrend are the two "
                     "EMA-ratio trends the readout prints; the wire carries phase and divergence only. "
                     "Regenerated and compared by tests/test_rs_split_golden.py; read by the JS lane's "
                     "rsPhasesDef.test.js."),
            "params": {"short": short, "long": long, "sigma_window": rsm.PHASES_SIGMA_WINDOW,
                       "z_clamp": rsm.PHASES_Z_CLAMP},
            "relTol": REL_TOL, "bars": stock, "benchmarkBars": bench,
            "expected": {k: list(cols[k]) for k in rsm.RS_PHASES_COLUMNS},
        }
    if name == "rs_vs_ema_spy":
        ema, fast, slow = rsm.DEFAULT_VS_EMA_LENGTH, rsm.DEFAULT_VS_EMA_FAST, rsm.DEFAULT_VS_EMA_SLOW
        cols = rsm.compute_rs_vs_ema_columns(stock, bench, ema, fast, slow)
        return {
            "case": name, "kind": "rs_vs_ema",
            "note": ("UCT RS vs 21 EMA (RS split U6, 2026-11-09): compute_rs_vs_ema_columns over the SAME "
                     "seeded series as rs_phases_spy (one series, two fixtures). dist = 100 * (R / EMA_21(R) "
                     "- 1), null until the 21 EMA seeds at index 20; fast = EMA_3(dist) from index 22; slow "
                     f"= EMA_13(dist) from index 32; stock index {GAP_INDEX} has no benchmark bar and is "
                     "None in every column. dist at the newest ratio bar IS the RS line readout's "
                     "legend.pctFromMa (tests/test_rs_vs_ema_math.py). Regenerated and compared by "
                     "tests/test_rs_split_golden.py; read by the JS lane's rsVsEmaDef.test.js."),
            "params": {"ema": ema, "fast": fast, "slow": slow},
            "relTol": REL_TOL, "bars": stock, "benchmarkBars": bench,
            "expected": {k: list(cols[k]) for k in rsm.RS_VS_EMA_COLUMNS},
        }
    raise KeyError(name)


CASES = ("rs_phases_spy", "rs_vs_ema_spy")


def write_cases() -> None:
    for name in CASES:
        (FIX / f"{name}.json").write_bytes(
            (json.dumps(build_case(name), indent=2, ensure_ascii=True) + "\n").encode("ascii"))


# ── the fixtures reproduce ────────────────────────────────────────────────────

@pytest.mark.parametrize("name", CASES)
def test_the_series_and_every_column_regenerate_to_the_committed_bytes(name):
    case = load_case(name)
    fresh = build_case(name)
    assert case["case"] == name and case["kind"] == fresh["kind"]
    assert case["params"] == fresh["params"] and case["relTol"] == REL_TOL
    assert case["bars"] == fresh["bars"], "the synthetic stock series moved"
    assert case["benchmarkBars"] == fresh["benchmarkBars"], "the synthetic benchmark series moved"
    assert set(case["expected"]) == set(fresh["expected"]), "the column set drifted"
    for col, exp in case["expected"].items():
        got = fresh["expected"][col]
        assert len(got) == len(exp) == len(case["bars"]), f"{name}.{col} not aligned to bars"
        for i, (g, e) in enumerate(zip(got, exp)):
            assert _close(g, e, REL_TOL), f"{name}.{col}[{i}]: {g!r} != {e!r}"


def test_the_two_fixtures_share_one_series():
    a, b = load_case("rs_phases_spy"), load_case("rs_vs_ema_spy")
    assert a["bars"] == b["bars"] and a["benchmarkBars"] == b["benchmarkBars"]
    assert len(a["bars"]) == N and len(a["benchmarkBars"]) == N - 1
    bench_t = {bar["t"] for bar in a["benchmarkBars"]}
    assert [i for i, bar in enumerate(a["bars"]) if bar["t"] not in bench_t] == [GAP_INDEX]


# ── the shapes the JS definitions rely on ─────────────────────────────────────

def test_phases_has_both_phases_a_no_phase_stretch_and_the_stated_warm_ups():
    exp = load_case("rs_phases_spy")["expected"]
    phase, z = exp["phase"], exp["divergence"]
    assert set(phase) == {None, 0.0, 1.0}, "both phases and the unpainted case must be on the table"
    assert phase.count(1.0) >= 10 and phase.count(0.0) >= 10, "each phase holds for a real stretch"
    assert exp["rsTrend"][:9] == [None] * 9 and exp["rsTrend"][9] is not None, "EMA_10 seeds at index 9"
    assert z[:71] == [None] * 71 and z[71] is not None, "63 valid spreads from index 9 end at index 71"
    assert all(v is None or -3.0 <= v <= 3.0 for v in z), "the z-score is clamped at ±3"
    assert any(v is not None and abs(v) > 1.5 for v in z), "the shaped regimes produce a real divergence"
    for col in exp.values():
        assert col[GAP_INDEX] is None, "a bar the benchmark lacks is None in every column"
    for key in ("rsTrend", "benchTrend", "divergence"):   # `phase` may be None there by meaning
        assert exp[key][GAP_INDEX + 1] is not None, f"{key}: the next bar is computed, not restarted"


def test_vs_ema_seeds_where_the_averages_do_and_is_signed_both_ways():
    exp = load_case("rs_vs_ema_spy")["expected"]
    assert exp["dist"][:20] == [None] * 20 and exp["dist"][20] is not None
    assert exp["fast"][:22] == [None] * 22 and exp["fast"][22] is not None
    assert exp["slow"][:32] == [None] * 32 and exp["slow"][32] is not None
    assert any(v is not None and v > 1.0 for v in exp["dist"]) and any(v is not None and v < -1.0 for v in exp["dist"]), \
        "the histogram must cross zero so colorMode 'sign' has both colours to show"
    for col in exp.values():
        assert col[GAP_INDEX] is None and col[GAP_INDEX + 1] is not None


def test_the_defaults_the_fixtures_were_built_with_are_the_rows_defaults():
    from api.services.signature import registry_defs as rd
    phases = load_case("rs_phases_spy")["params"]
    by_key = {i["key"]: i for i in next(d for d in rd.RS_SPLIT_DEFS if d["id"] == "rsPhases")["inputs"]}
    assert (phases["short"], phases["long"]) == (by_key["shortEma"]["default"], by_key["longEma"]["default"])
    vs = load_case("rs_vs_ema_spy")["params"]
    assert vs == {"ema": rsm.DEFAULT_MA_LENGTH, "fast": 3, "slow": 13}


if __name__ == "__main__":
    if "--write" not in sys.argv:
        sys.exit("usage: python tests/test_rs_split_golden.py --write   (a reviewed regeneration, never a fix)")
    write_cases()
    print("wrote", ", ".join(CASES))
