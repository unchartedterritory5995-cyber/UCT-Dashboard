"""UCT RS Phase 3, unit 3-06: the `rsLine` provider at `compute.rev` 4.

Engineering map 2026-11-08 §2 "3-06 Provider v4" (decisions D2, D4, D6). Every
v4 behaviour below applies only when the INSTALLED row is v4
(`registry_defs._rs_line_row(True, True)`, i.e. `RS_V3_ENABLED` on top of
`RS_V2_ENABLED`); the flag-off control at the end proves the v3 envelope and
cache key did not move by one byte.

* the view blanking table (`_RS_VIEW_FAMILIES`) and the legacy `showMansfield`
  mapping (D2);
* the three blocks on the shared golden fixtures (`rs_rrg`, `rs_clenow`,
  `rs_vars`, the same files `test_rs_phase3_math.py` pins the maths with);
* the picked anchor (D6): picked, default, and every unusable date;
* the custom benchmark states (D4) and the router's warm path;
* the cache key and the member copy rules.

Hermetic like the rest of the RS suites: the provider suite's own fixtures
(`_hermetic_reads`: no industry map, no rating table, an empty evidence dir),
an injected bar reader, a stubbed cache. No network, never `C:\\data`.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import re

import pytest

from api.routers import signature as sig
from api.services import relative_strength as rsmod
from api.services import rs_benchmarks as rb
from api.services.signature import registry_defs as rd
from api.services.signature import rs_provider as rsp
from tests.test_rs_columns_provider import (  # noqa: F401 - fixtures are used by name
    _bars, _fetcher, _hermetic_reads, _load_fixture, _long_daily, _no_cache, v2_row,
)

V4_COLUMNS = (tuple(rsmod.PHASE1_COLUMNS) + tuple(rd.RS_PHASE2A_WIRE_COLUMNS)
              + tuple(rd.RS_PHASE3_WIRE_COLUMNS) + tuple(rd.RS_RATING_WIRE_COLUMNS))
EVENT_COLUMNS = ("rsNH", "rsNHpartial", "pxNH", "rsNHbeforePx", "rsNHred", "rsNL", "gor", "rog",
                 "mansfieldCrossUp", "mansfieldCrossDown")
ONE_BARS = re.compile(r"\b1[ \u00a0](bars|sessions|weeks|months|red days)\b")
#: U+00A0 (3-14): a v4 summary holds each number to its label or unit.
NB = "\u00a0"
TODAY = _dt.date(2026, 11, 7)


@pytest.fixture
def v4_row(monkeypatch):
    """Install the v4 row and the V2 flag for one test (the import-time state
    is restored by monkeypatch). The cache never hits and never keeps."""
    row = rd._rs_line_row(True, True)
    monkeypatch.setitem(rd._BY_ID, "rsLine", row)
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    monkeypatch.setattr(rsp, "_rs_data_generation", lambda now=None: "r-|e-")
    monkeypatch.setattr(rb, "_custom_warmed", {})
    _no_cache(monkeypatch)
    return row


def _weekdays(n, start=_dt.date(2023, 1, 2)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d += _dt.timedelta(days=1)
    return out


def _arith_series(n, start, drift, vol, seed):
    """A seeded random walk built with ARITHMETIC ONLY (an LCG, no libm), on
    weekday YYYYMMDD keys (the store's daily encoding), so a digest of what
    the provider makes of it does not depend on a platform's `exp` / `log`."""
    x, c, out = seed, float(start), []
    for t in _weekdays(n):
        x = (1103515245 * x + 12345) % 2147483648
        step = ((x % 20001) - 10000) / 10000.0 * vol
        o = c
        c = max(1.0, c * (1.0 + drift + step))
        out.append({"t": t, "o": o, "h": max(o, c) * 1.004, "l": min(o, c) * 0.996, "c": c, "v": 1000})
    return out


def _arith_store(n=900):
    return {"NVDA": _arith_series(n, 100.0, 0.0012, 0.03, 11), "SPY": _arith_series(n, 400.0, 0.0004, 0.012, 23),
            "RSP": _arith_series(n, 150.0, 0.0003, 0.013, 37), "XLK": _arith_series(n, 200.0, 0.0006, 0.016, 41),
            "SMH": _arith_series(n, 250.0, 0.0008, 0.02, 53)}


def _lane(monkeypatch, store, sym="NVDA", tf="D", inputs=None, *, honour_count=True):
    """`sig._rs_line_provider` over ``store`` (a fetcher that returns the last
    ``count`` bars, as `bars_sqlite.get_bars` does) with the warm spied."""
    warmed: list = []
    monkeypatch.setattr(sig, "_rs_warm_bars", lambda t, tf_: warmed.append((t, tf_)))

    def fetch(s, tf_, count):
        rows = store.get(s.upper(), [])
        return list(rows[-count:]) if honour_count else list(rows)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", fetch)
    env = sig._rs_line_provider(sym, tf, dict(inputs or {}))
    env["_warmed"] = warmed
    return env


def _nonnull(col):
    return sum(1 for v in col if v is not None)


# ── the row switch ───────────────────────────────────────────────────────────

def test_the_v4_envelope_carries_exactly_the_v4_wire_columns_and_the_three_blocks(v4_row, monkeypatch):
    env = _lane(monkeypatch, _arith_store())
    assert set(env["columns"]) == set(V4_COLUMNS)
    wired = rd.wire_columns("rsLine", env["columns"])         # the exact-match contract
    assert sorted(wired) == sorted(V4_COLUMNS)
    p = env["payload"]
    assert p["state"] == "ok"
    for block in ("rotation", "quality", "vars"):
        assert p[block]["reason"] is None and p[block]["summary"], (block, p[block])
    assert p["inputs"]["view"] == "ratio"
    assert {"view", "customBenchmark", "rrgRatioLength", "rrgMomentumLength", "clenowWindow",
            "clenowGapPct", "atrLength", "varsLookback", "anchorDate"} <= set(p["inputs"])


# ── the view blanking table (D2) ─────────────────────────────────────────────

FAMILIES = {
    "ratio": ("rsLine", "rsMa", "rsAbove", "dotNH"),
    "mansfield": ("mansfield",),
    "rotation": ("rsRatio", "rsMomentum"),
    "quality": ("clenowScore",),
    "vars": ("vars", "varsMa"),
}


@pytest.mark.parametrize("view", list(FAMILIES))
def test_each_view_keeps_its_own_family_and_blanks_every_other(view, v4_row, monkeypatch):
    env = _lane(monkeypatch, _arith_store(), inputs={"view": view})
    cols = env["columns"]
    assert env["payload"]["inputs"]["view"] == view
    for k in FAMILIES[view]:
        assert _nonnull(cols[k]) > (0 if k.startswith("dot") else 100), (view, k)
    for other, keys in rsp._RS_VIEW_FAMILIES.items():
        if other == view:
            continue
        for k in keys:
            assert all(v is None for v in cols[k]), (view, other, k)
    # the readout's scalars are read before the blanking: every block answers
    for block in ("rotation", "quality", "vars"):
        assert env["payload"][block]["reason"] is None, (view, block)
    assert env["payload"]["mansfield"]["value"] is not None
    assert env["payload"]["legend"]["lastValue"] is not None


def test_event_columns_are_never_blanked_by_a_view(v4_row, monkeypatch):
    store = _arith_store()
    seen = {view: _lane(monkeypatch, store, inputs={"view": view, "showNewLow": True})["columns"]
            for view in FAMILIES}
    for k in EVENT_COLUMNS:
        assert len({json.dumps(c[k]) for c in seen.values()}) == 1, k
    assert any(_nonnull(seen["ratio"][k]) for k in EVENT_COLUMNS)


def test_the_view_table_covers_every_view_and_every_phase3_wire_column():
    assert set(rsp._RS_VIEW_FAMILIES) == set(rd.RS_VIEWS)
    owned = [k for keys in rsp._RS_VIEW_FAMILIES.values() for k in keys]
    assert len(owned) == len(set(owned)), "a column belongs to one family"
    assert set(rd.RS_PHASE3_WIRE_COLUMNS) <= set(owned)
    assert not set(owned) & set(EVENT_COLUMNS)
    assert rsp._RS_VIEW_FAMILIES["ratio"] == rsp._RS_MANSFIELD_VIEW_BLANKS


def test_the_ratio_and_mansfield_views_draw_what_v3_drew(v4_row, monkeypatch):
    """Ratio and Mansfield keep their v3 meaning: the v4 wire for the 2a
    columns equals the v3 wire for the same toggles, column for column."""
    store = _arith_store()
    v4 = {view: _lane(monkeypatch, store, inputs={"view": view})["columns"] for view in ("ratio", "mansfield")}
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(True))
    v3 = {"ratio": _lane(monkeypatch, store)["columns"],
          "mansfield": _lane(monkeypatch, store, inputs={"showMansfield": True})["columns"]}
    for view in v4:
        for k in v3[view]:
            assert v4[view][k] == v3[view][k], (view, k)


@pytest.mark.parametrize("inputs, want", [
    ({"showMansfield": True}, "mansfield"),
    # unit 3-08b: a SENT view always wins over the legacy switch
    ({"showMansfield": True, "view": "ratio"}, "ratio"),
    ({"showMansfield": True, "view": "rotation"}, "rotation"),
    ({"showMansfield": False, "view": "mansfield"}, "mansfield"),
    ({"view": "VARS"}, "vars"),
    ({"view": "nonsense"}, "ratio"),
    ({}, "ratio"),
])
def test_the_legacy_showMansfield_maps_to_the_mansfield_view(inputs, want, v4_row, monkeypatch):
    env = _lane(monkeypatch, _arith_store(300), inputs=inputs)
    assert env["payload"]["inputs"]["view"] == want


# ── the legacy switch through the route (unit 3-08b) ─────────────────────────
#
# One rule: `showMansfield: true` maps onto `view: "mansfield"` ONLY when the
# request sent no `view`. `resolve_inputs` is where "sent" and "defaulted" can
# still be told apart, so the three cases go through it (as `serve` does).

def _routed(monkeypatch, store, raw):
    resolved = rd.resolve_inputs("rsLine", raw)
    return resolved, _lane(monkeypatch, store, inputs=resolved)


def test_a_saved_trend_instance_draws_mansfield_through_the_route(v4_row, monkeypatch):
    """A v3 Trend instance (showMansfield true, no view): the row's mapping
    resolves the Reading to mansfield, and the pane draws the Mansfield line."""
    resolved, env = _routed(monkeypatch, _arith_store(), {"benchmark": "SPY", "showMansfield": True})
    assert resolved["view"] == "mansfield" and resolved["showMansfield"] is True
    assert env["payload"]["inputs"]["view"] == "mansfield"
    assert _nonnull(env["columns"]["mansfield"]) > 100 and all(v is None for v in env["columns"]["rsLine"])


def test_a_sent_ratio_view_wins_over_the_legacy_switch_through_the_route(v4_row, monkeypatch):
    """A member who switched a Trend instance back to the RS line by hand sends
    showMansfield true AND view ratio: the RS line draws, not Mansfield."""
    resolved, env = _routed(monkeypatch, _arith_store(),
                            {"benchmark": "SPY", "showMansfield": True, "view": "ratio"})
    assert resolved["view"] == "ratio"
    assert env["payload"]["inputs"]["view"] == "ratio"
    assert _nonnull(env["columns"]["rsLine"]) > 100 and all(v is None for v in env["columns"]["mansfield"])


def test_no_legacy_switch_through_the_route_is_the_default_reading(v4_row, monkeypatch):
    for raw in ({"benchmark": "SPY"}, {"benchmark": "SPY", "showMansfield": False}):
        resolved, env = _routed(monkeypatch, _arith_store(), raw)
        assert resolved["view"] == "ratio", raw
        assert env["payload"]["inputs"]["view"] == "ratio", raw


def test_the_mapping_reads_a_wire_bool_and_none_means_not_sent(v4_row):
    assert rd.resolve_inputs("rsLine", {"showMansfield": "true"})["view"] == "mansfield"
    assert rd.resolve_inputs("rsLine", {"showMansfield": True, "view": None})["view"] == "mansfield"
    assert rd.resolve_inputs("rsLine", {"showMansfield": True, "view": "vars"})["view"] == "vars"
    # idempotent: resolving a resolved map changes nothing
    once = rd.resolve_inputs("rsLine", {"showMansfield": True})
    assert rd.resolve_inputs("rsLine", once) == once
    # the raw request is never written to
    raw = {"showMansfield": True}
    rd.resolve_inputs("rsLine", raw)
    assert raw == {"showMansfield": True}


def test_the_v4_row_declares_the_mapping_and_the_v3_row_does_not():
    v4 = {i["key"]: i for i in rd._rs_line_row(True, True)["inputs"]}
    v3 = {i["key"]: i for i in rd._rs_line_row(True)["inputs"]}
    assert v4["showMansfield"]["mapsTo"] == {"when": True, "key": "view", "value": "mansfield"}
    assert "mapsTo" not in v3["showMansfield"] and "view" not in v3
    # and it is the JS definition's declaration, read from nativeRegistry.js
    import pathlib
    js = (pathlib.Path(__file__).resolve().parents[1]
          / "app/src/components/chart/engine/nativeRegistry.js").read_text(encoding="utf-8")
    assert "mapsTo: { when: true, key: 'view', value: 'mansfield' }" in js


@pytest.mark.parametrize("mapsTo, why", [
    ({"when": True, "key": "view"}, "exactly"),
    ({"when": True, "key": "nope", "value": "mansfield"}, "not another declared input"),
    ({"when": True, "key": "showMansfield", "value": True}, "not another declared input"),
    ({"when": False, "key": "view", "value": "mansfield"}, "when"),
    ({"when": "yes", "key": "view", "value": "mansfield"}, "when"),
    ({"when": True, "key": "view", "value": "mansfeld"}, "value"),
    ({"when": True, "key": "view", "value": "ratio"}, "value"),
])
def test_a_malformed_mapping_refuses_the_row(mapsTo, why):
    row = rd._rs_line_row(True, True)
    for spec in row["inputs"]:
        if spec["key"] == "showMansfield":
            spec["mapsTo"] = mapsTo
    with pytest.raises(ValueError, match=why):
        rd._checked_legacy_maps(row)


# ── rotation (the rs_rrg fixture, weekly) ────────────────────────────────────

def test_rotation_columns_and_block_on_the_shared_rrg_fixture(v4_row, monkeypatch):
    case = _load_fixture("rs_rrg")
    store = {"NVDA": case["bars"], "SPY": case["benchmarkBars"]}
    env = _lane(monkeypatch, store, tf="W", inputs={"view": "rotation"})
    exp = case["expected"]
    for k in ("rsRatio", "rsMomentum"):
        got = env["columns"][k]
        assert len(got) == len(exp[k])
        for i, (g, e) in enumerate(zip(got, exp[k])):
            assert (g is None) == (e is None), (k, i)
            if e is not None:
                assert abs(g - e) <= 5e-5, (k, i, g, e)
    q = [c for c in exp["quadrant"]]
    last = max(i for i, c in enumerate(q) if c is not None)
    run = 0
    for c in reversed([c for c in q[:last + 1] if c is not None]):
        if c != q[last]:
            break
        run += 1
    rot = env["payload"]["rotation"]
    name = case["quadrantNames"][q[last] - 1]
    assert rot["quadrant"] == name and rot["inQuadrantBars"] == run
    assert rot["ratio"] == round(exp["rsRatio"][last], 2) and rot["momentum"] == round(exp["rsMomentum"][last], 2)
    assert rot["summary"] == f"{name}, {run}{NB}week{'s' if run != 1 else ''}"
    assert rot["reason"] is None and rot["stale"] is False


def test_rotation_block_pure_cases():
    names = rsmod.RRG_QUADRANT_NAMES
    rr = {"rsRatio": [None, 101.0, 102.0, None, 103.0, 104.0],
          "rsMomentum": [None, 99.0, 101.0, None, 101.5, 102.0],
          "quadrant": [None, 2, 1, None, 1, 1]}
    out = rsp._rs_rotation(rr, [20261102, 20261103, 20261104, 20261105, 20261106, 20261109], 10, 5,
                           "session", lambda: 0)
    assert out["quadrant"] == names[0] and out["inQuadrantBars"] == 3, "a gap bar is skipped, not a break"
    assert out["summary"] == f"Leading, 3{NB}sessions"
    # read before the newest bar (a benchmark gap): it says when
    rr2 = {k: v[:-1] + [None] for k, v in rr.items()}
    out = rsp._rs_rotation(rr2, [20261102, 20261103, 20261104, 20261105, 20261106, 20261109], 10, 5,
                           "week", lambda: 0)
    assert out["summary"] == f"Leading, 2{NB}weeks · as of Nov{NB}6" and out["stale"] is True
    one = rsp._rs_rotation({"rsRatio": [99.0], "rsMomentum": [101.0], "quadrant": [4]}, [20261109], 10, 5,
                           "week", lambda: 0)
    assert one["summary"] == f"Improving, 1{NB}week"
    none = rsp._rs_rotation({"rsRatio": [None] * 3, "rsMomentum": [None] * 3, "quadrant": [None] * 3},
                            [1, 2, 3], 10, 5, "week", lambda: 3)
    assert none["quadrant"] is None and none["reason"] == f"needs 14{NB}weeks of both (has 3)"
    assert none["summary"] == none["reason"]


def test_rotation_is_blank_on_intraday_and_reads_weekly(v4_row, monkeypatch):
    store = _arith_store(400)
    env = _lane(monkeypatch, store, tf="5", inputs={"view": "rotation"})
    assert all(v is None for v in env["columns"]["rsRatio"] + env["columns"]["rsMomentum"])
    assert env["payload"]["rotation"]["reason"] == "not read on intraday charts"
    assert env["payload"]["quality"]["reason"] == "daily charts only"
    assert env["payload"]["vars"]["reason"] is None, "VARS is a unit-free ATR sum, read on every timeframe"
    assert all(v is None for v in env["columns"]["dotClenowGap"])
    wk = _lane(monkeypatch, store, tf="W", inputs={"view": "rotation"})
    assert wk["payload"]["rotation"]["summary"].split(", ")[1].endswith(("week", "weeks"))
    assert wk["payload"]["quality"]["reason"] == "daily charts only"


# ── quality (the rs_clenow fixture, daily) ───────────────────────────────────

def _clenow_store():
    case = _load_fixture("rs_clenow")
    bench = [{"t": b["t"], "o": 400.0, "h": 401.0, "l": 399.0, "c": 400.0 + 0.1 * i, "v": 1}
             for i, b in enumerate(case["bars"])]
    return case, {"NVDA": case["bars"], "SPY": bench}


def test_quality_column_dot_and_block_on_the_shared_clenow_fixture(v4_row, monkeypatch):
    case, store = _clenow_store()
    p = case["params"]
    env = _lane(monkeypatch, store, inputs={"view": "quality", "clenowWindow": p["window"],
                                             "clenowGapPct": p["gap_pct"]})
    exp = case["expected"]
    got = env["columns"]["clenowScore"]
    for i, (g, e) in enumerate(zip(got, exp["clenowScore"])):
        assert (g is None) == (e is None), i
        if e is not None:
            assert abs(g - e) <= 5e-5, (i, g, e)
    # The gap dot marks the gap SESSION (bar 60: +17.0%), on the score line.
    # Bar 25's move is exactly 15.0%, which is not over 15 (strict), so no dot.
    dots = {i: v for i, v in enumerate(env["columns"]["dotClenowGap"]) if v is not None}
    assert list(dots) == [60] and dots[60] == got[60]
    q = env["payload"]["quality"]
    assert q["score"] == round(exp["clenowScore"][-1], 4)
    assert q["annualPct"] == round(exp["clenowAnnual"][-1] * 100.0, 1)
    assert q["r2"] == round(exp["clenowR2"][-1], 4)
    assert q["gap"] is False and q["window"] == 20 and q["gapPct"] == 15.0
    # ⭐ 3-14: the readout wrapped between "R²" and "0.09" (a plain space); each
    # number is held to its label now.
    assert q["summary"] == f"Score{NB}0.00, 3% a year, R²{NB}0.00, no gap over{NB}15%"
    # bar 78's window still holds the bar-60 gap
    at78 = rsp._rs_quality(case["bars"][:79], 20, 15.0)
    assert at78["gap"] is True and at78["summary"].endswith(f"has a gap over{NB}15%")
    assert at78["score"] == round(exp["clenowScore"][78], 4)


def test_quality_block_equals_the_full_column_on_every_view(v4_row, monkeypatch):
    store = _arith_store()
    on = _lane(monkeypatch, store, inputs={"view": "quality"})
    off = _lane(monkeypatch, store, inputs={"view": "ratio"})
    assert on["payload"]["quality"] == off["payload"]["quality"]
    assert on["payload"]["quality"]["score"] == round(on["columns"]["clenowScore"][-1], 4)


def test_quality_summary_patterns_and_reasons():
    rising = _bars([100.0 * (1.003 ** i) for i in range(120)])
    q = rsp._rs_quality(rising, 90, 15.0)
    assert re.fullmatch(r"Score\u00a0\d+\.\d\d, [\d,]+% a year, R²\u00a01\.00, no gap over\u00a015%", q["summary"]), q
    assert q["r2"] == 1.0 and q["annualPct"] > 100
    assert rsp._rs_quality(rising[:40], 90, 15.0)["reason"] == f"needs 90{NB}sessions (has 40)"
    flat = rsp._rs_quality(_bars([50.0] * 95), 90, 12.5)
    assert flat["reason"] == f"the price was flat over the last 90{NB}sessions" and flat["gapPct"] == 12.5
    falling = rsp._rs_quality(_bars([100.0 * (0.995 ** i) for i in range(95)]), 90, 12.5)
    assert falling["summary"].startswith(f"Score{NB}-") and "% a year" in falling["summary"]
    assert falling["summary"].endswith(f"no gap over{NB}12.5%")
    assert rsp._rs_fixed(-0.0004, 2) == "0.00" and rsp._rs_signed(-0.04) == "0.0"


# ── VARS (the rs_vars fixture, daily) ────────────────────────────────────────

def test_vars_column_and_block_on_the_shared_vars_fixture(v4_row, monkeypatch):
    case = _load_fixture("rs_vars")
    p = case["params"]
    store = {"NVDA": case["bars"], "SPY": case["benchmarkBars"]}
    env = _lane(monkeypatch, store, inputs={"view": "vars", "atrLength": p["atr_length"],
                                             "varsLookback": p["lookback"]})
    exp = case["expected"]["vars"]
    got = env["columns"]["vars"]
    for i, (g, e) in enumerate(zip(got, exp)):
        assert (g is None) == (e is None), i
        if e is not None:
            assert abs(g - e) <= 5e-5, (i, g, e)
    # the chart's average is the product's 50 bars (the fixture pins its own 5)
    want = rsmod.vars_columns(case["bars"], case["benchmarkBars"], p["atr_length"], p["lookback"],
                              rsmod.DEFAULT_VARS_MA_LENGTH)
    v = env["payload"]["vars"]
    assert v["value"] == round(exp[-1], 4) and v["maLength"] == 50 and v["lookback"] == p["lookback"]
    code = want["varsState"][-1]
    if code:
        assert v["state"] == code and v["stateWord"] == ("Strong, rising", "Strong, fading",
                                                         "Weak, improving", "Weak, falling")[code - 1]
        assert v["summary"].startswith(f"{v['stateWord']}: +2.6 against SPY, ")
    else:
        assert v["summary"].startswith(f"+2.6 against SPY; its 50-session average needs 50{NB}readings")


def test_vars_summary_patterns():
    vc = {"vars": [None, 3.42, 3.44], "varsMa": [None, 1.0, 1.2], "varsState": [None, 1, 1]}
    assert rsp._rs_vars(vc, [1, 2, 3], 60, 20, 50, "session", "SPY", lambda: 0)["summary"] == \
        "Strong, rising: +3.4 against SPY, above its 50-session average"
    vc = {"vars": [-1.0, -2.04], "varsMa": [-1.5, -1.9], "varsState": [3, 4]}
    out = rsp._rs_vars(vc, [1, 2], 60, 20, 50, "week", "QQQ", lambda: 0)
    assert out["summary"] == "Weak, falling: -2.0 against QQQ, below its 50-week average"
    vc = {"vars": [0.0], "varsMa": [0.5], "varsState": [None]}
    assert rsp._rs_vars(vc, [1], 60, 20, 50, "session", "SPY", lambda: 0)["summary"] == "0.0, level with SPY"
    vc = {"vars": [None, 1.0, 1.26], "varsMa": [None, None, None], "varsState": [None, None, None]}
    assert rsp._rs_vars(vc, [1, 2, 3], 60, 20, 50, "session", "SPY", lambda: 0)["summary"] == \
        f"+1.3 against SPY; its 50-session average needs 50{NB}readings (has 2)"
    none = rsp._rs_vars({"vars": [None], "varsMa": [None], "varsState": [None]}, [1], 60, 20, 50,
                        "session", "SPY", lambda: 1)
    assert none["reason"] == f"needs 80{NB}sessions of both (has 1)" and none["value"] is None


# ── the three blocks on a young listing and on the no-ratio states ───────────

def test_a_300_bar_ipo_answers_every_block(v4_row, monkeypatch):
    store = _arith_store(900)
    store["IPO"] = _arith_series(300, 20.0, 0.002, 0.04, 97)
    store["IPO"] = [dict(b, t=t) for b, t in zip(store["IPO"], [b["t"] for b in store["SPY"][-300:]])]
    env = _lane(monkeypatch, store, sym="IPO", inputs={"view": "quality"})
    p = env["payload"]
    assert p["state"] == "short-history"
    for block in ("rotation", "quality", "vars"):
        assert p[block]["reason"] is None, (block, p[block])
    assert _nonnull(env["columns"]["clenowScore"]) == 300 - 90 + 1


@pytest.mark.parametrize("bench, why, state", [
    ("NVDA", "benchmark is the symbol", "same-symbol"),
    ("ZZZQ", "no benchmark bars", "no-benchmark-bars"),
])
def test_the_no_ratio_states_blank_every_phase3_column_with_the_state_as_reason(bench, why, state,
                                                                                 v4_row, monkeypatch):
    env = _lane(monkeypatch, _arith_store(400),
                inputs={"benchmark": "CUSTOM", "customBenchmark": bench, "view": "rotation"})
    assert env["payload"]["state"] == state
    for k in rd.RS_PHASE3_WIRE_COLUMNS:
        assert all(v is None for v in env["columns"][k]), k
    for block in ("rotation", "quality", "vars"):
        assert env["payload"][block]["reason"] == why and env["payload"][block]["summary"] == why


# ── the anchor (D6) ──────────────────────────────────────────────────────────

def _anchor_bars(n=60):
    """Weekday bars from Mon 2026-08-03, the stock rising 1 a day, the
    benchmark flat with a low on 2026-09-01 (well before the last 20)."""
    times = _weekdays(n, _dt.date(2026, 8, 3))
    stock = [{"t": t, "o": 100.0 + i, "h": 101.0 + i, "l": 99.0 + i, "c": 100.0 + i, "v": 1}
             for i, t in enumerate(times)]
    bench = [{"t": t, "o": 400.0, "h": 401.0, "l": 399.0, "c": 400.0 + (i % 3), "v": 1}
             for i, t in enumerate(times)]
    return stock, bench


def test_the_default_anchor_is_v3s_rule_plus_its_source():
    stock, bench = _anchor_bars()
    v3 = rsp._rs_checks(stock, bench, "SPY", -0.5)
    v4 = rsp._rs_checks(stock, bench, "SPY", -0.5, anchor_date="", today=TODAY)
    assert {k: v for k, v in v4["anchor"].items() if k not in ("source", "date")} == v3["anchor"]
    assert v4["anchor"]["source"] == "default" and v4["anchor"]["date"] is None
    assert "source" not in v3["anchor"], "the v3 rule is byte-identical"


def test_a_picked_anchor_is_the_first_session_on_or_after_the_date():
    stock, bench = _anchor_bars()
    a = rsp._rs_checks(stock, bench, "SPY", -0.5, anchor_date="2026-08-12", today=TODAY)["anchor"]
    i = [b["t"] for b in stock].index(20260812)
    assert a["source"] == "picked" and a["date"] == "2026-08-12" and a["anchorTime"] == 20260812
    assert a["barsAgo"] == len(stock) - 1 - i
    sr = (stock[-1]["c"] / stock[i]["c"] - 1) * 100
    br = (bench[-1]["c"] / bench[i]["c"] - 1) * 100
    assert a["pass"] is (sr > br) is True
    assert a["reason"] == f"stock {rsp._rs_pct(sr)}, SPY {rsp._rs_pct(br)} since Aug 12, 2026"
    assert a["line"] == "pass · " + a["reason"]
    # a Saturday: the Monday after, and the reason says why that bar
    sat = rsp._rs_checks(stock, bench, "SPY", -0.5, anchor_date="2026-08-08", today=TODAY)["anchor"]
    assert sat["anchorTime"] == 20260810
    assert sat["reason"].endswith("since Aug 10, 2026 (the first session after Aug 8)")


def test_a_picked_date_on_a_benchmark_holiday_moves_to_the_next_shared_session():
    stock, bench = _anchor_bars()
    bench = [b for b in bench if b["t"] != 20260812]
    a = rsp._rs_checks(stock, bench, "SPY", -0.5, anchor_date="2026-08-12", today=TODAY)["anchor"]
    assert a["anchorTime"] == 20260813 and a["pass"] is not None


@pytest.mark.parametrize("raw, reason", [
    ("2026-13-45", "2026-13-45 is not a real date"),
    ("2026-02-30", "2026-02-30 is not a real date"),
    ("next week", "next week is not a real date"),
    ("2026-11-20", "Nov 20, 2026 is in the future"),
    ("2026-07-01", "Jul 1, 2026 is before the history this reading holds, which starts Aug 3, 2026"),
])
def test_an_unusable_anchor_date_is_undecided_with_its_reason_never_the_default(raw, reason):
    stock, bench = _anchor_bars()
    out = rsp._rs_checks(stock, bench, "SPY", -0.5, anchor_date=raw, today=TODAY)
    a = out["anchor"]
    assert a["pass"] is None and a["reason"] == reason and a["line"] == reason
    assert a["source"] == "picked" and a["date"] == raw and a["anchorTime"] is None
    dflt = rsp._rs_checks(stock, bench, "SPY", -0.5, anchor_date="", today=TODAY)
    assert dflt["anchor"]["pass"] is not None
    assert out["of"] == dflt["of"] - 1, "an undecided anchor is out of the count"


def test_a_date_after_the_last_session_but_not_in_the_future_has_no_bar_yet():
    stock, bench = _anchor_bars(60)
    last = _dt.date(int(str(stock[-1]["t"])[:4]), int(str(stock[-1]["t"])[4:6]), int(str(stock[-1]["t"])[6:]))
    after = last + _dt.timedelta(days=1)
    a = rsp._rs_checks(stock, bench, "SPY", -0.5, anchor_date=after.isoformat(),
                       today=after + _dt.timedelta(days=3))["anchor"]
    assert a["pass"] is None and a["reason"] == f"no session of both on or after {rsp._rs_long_date(after.strftime('%Y%m%d'))} yet"


def test_a_pick_on_the_newest_session_is_undecided():
    stock, bench = _anchor_bars()
    t = str(stock[-1]["t"])
    a = rsp._rs_checks(stock, bench, "SPY", -0.5, anchor_date=f"{t[:4]}-{t[4:6]}-{t[6:]}", today=TODAY)["anchor"]
    assert a["pass"] is None and a["barsAgo"] == 0
    assert a["reason"].endswith("is the newest session; there is no move to compare yet")


def test_the_provider_passes_the_anchor_date_on_daily_and_says_so_elsewhere(v4_row, monkeypatch):
    store = _arith_store()
    picked = str(store["NVDA"][-300]["t"])
    iso = f"{picked[:4]}-{picked[4:6]}-{picked[6:]}"
    env = _lane(monkeypatch, store, inputs={"anchorDate": iso})
    a = env["payload"]["checks"]["anchor"]
    assert a["source"] == "picked" and a["anchorTime"] == int(picked) and a["barsAgo"] == 299
    assert env["payload"]["inputs"]["anchorDate"] == iso
    dflt = _lane(monkeypatch, store)["payload"]["checks"]["anchor"]
    assert dflt["source"] == "default" and dflt["date"] is None
    wk = _lane(monkeypatch, store, tf="W", inputs={"anchorDate": iso})["payload"]["checks"]["anchor"]
    assert wk["pass"] is None and wk["reason"] == "daily charts only" and wk["source"] == "picked"
    bad = _lane(monkeypatch, store, inputs={"anchorDate": "2026-13-45"})["payload"]["checks"]["anchor"]
    assert bad["pass"] is None and bad["reason"] == "2026-13-45 is not a real date"


# ── the custom benchmark (D4) ────────────────────────────────────────────────

def test_custom_with_bars_resolves_as_the_ticker(v4_row, monkeypatch):
    env = _lane(monkeypatch, _arith_store(), inputs={"benchmark": "CUSTOM", "customBenchmark": "smh"})
    b = env["payload"]["benchmark"]
    assert (b["requested"], b["resolved"], b["label"], b["fallback"], b["note"]) == \
        ("CUSTOM", "SMH", "SMH", None, None)
    assert env["payload"]["state"] == "ok" and env["payload"]["inputs"]["customBenchmark"] == "SMH"
    assert env["_warmed"] == []
    assert env["payload"]["vars"]["summary"].split(": ")[1].split(" against ")[1].startswith("SMH")


def test_custom_without_bars_is_an_honest_empty_pane_warmed_once_and_cached_a_minute(v4_row, monkeypatch):
    ttls = []
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: ttls.append(ttl))
    store = _arith_store(400)
    env = _lane(monkeypatch, store, inputs={"benchmark": "CUSTOM", "customBenchmark": "ZZZQ"})
    p = env["payload"]
    assert p["state"] == "no-benchmark-bars"
    assert p["benchmark"]["resolved"] == "ZZZQ" and p["benchmark"]["fallback"] is None
    assert p["benchmark"]["note"] == "No ZZZQ bars yet; they usually load within a minute"
    assert env["_warmed"] == [("ZZZQ", "D")]
    assert ttls == [60]
    again = _lane(monkeypatch, store, inputs={"benchmark": "CUSTOM", "customBenchmark": "ZZZQ"})
    assert again["_warmed"] == [], "rs_benchmarks warms a ticker once per ten minutes"


@pytest.mark.parametrize("value", ["", "   ", None, "$SPX"])
def test_custom_with_no_usable_symbol_uses_spy_and_says_so(value, v4_row, monkeypatch):
    env = _lane(monkeypatch, _arith_store(400), inputs={"benchmark": "CUSTOM", "customBenchmark": value})
    b = env["payload"]["benchmark"]
    assert (b["resolved"], b["fallback"]) == ("SPY", "no custom symbol")
    assert b["note"] == "No symbol entered for Your symbol; using SPY"
    assert env["payload"]["inputs"]["customBenchmark"] == ""


def test_custom_on_the_charts_own_symbol_is_the_same_symbol_state(v4_row, monkeypatch):
    env = _lane(monkeypatch, _arith_store(400), inputs={"benchmark": "CUSTOM", "customBenchmark": "nvda"})
    assert env["payload"]["state"] == "same-symbol" and env["_warmed"] == []


def test_a_ticker_left_in_the_box_under_another_benchmark_is_ignored(v4_row, monkeypatch):
    keys = []
    monkeypatch.setattr(sig.cache, "get", lambda k: keys.append(k))
    store = _arith_store(300)
    a = _lane(monkeypatch, store, inputs={"benchmark": "SPY", "customBenchmark": "SMH"})
    b = _lane(monkeypatch, store, inputs={"benchmark": "SPY"})
    assert keys[0] == keys[1], "one answer, one cache entry"
    assert a["payload"]["benchmark"]["resolved"] == "SPY" and a["payload"]["inputs"]["customBenchmark"] == ""
    assert b["_warmed"] == []


def test_the_regime_reads_the_custom_benchmark_not_spy(v4_row, monkeypatch):
    store = _arith_store()
    calls = []

    def fetch(s, tf_, count):
        calls.append((s.upper(), count))
        return list(store.get(s.upper(), [])[-count:])
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", fetch)
    monkeypatch.setattr(sig, "_rs_warm_bars", lambda t, tf_: None)
    sig._rs_line_provider("NVDA", "D", {"benchmark": "CUSTOM", "customBenchmark": "SMH"})
    assert ("SMH", rsp._RS_REGIME_BARS) in calls


def test_the_benchmark_note_puts_a_resolver_note_first():
    bench = {"requested": "CUSTOM", "resolved": "ZZZQ", "fallback": None, "note": "No ZZZQ bars yet; x"}
    assert rsp._rs_benchmark_note(bench, {"index": None}, [20261106], intraday=False) == "No ZZZQ bars yet; x"
    assert rb.CUSTOM_NO_SYMBOL in rsp._RS_FALLBACK_SENTENCE


# ── the warm path (router) ───────────────────────────────────────────────────

def test_the_router_warm_is_the_deduped_bounded_cold_fetch(monkeypatch):
    from api.services import bars_fetch
    kicked = []
    monkeypatch.setattr(bars_fetch, "_kick_cold_fetch", lambda *a: kicked.append(a))
    monkeypatch.setattr(bars_fetch, "warm_bars_async",
                        lambda *a, **k: pytest.fail("the unbounded warm pool is not the custom path"))
    sig._rs_warm_bars("smh", "D")
    sig._rs_warm_bars("SMH", "1W")
    sig._rs_warm_bars("SMH", "5")
    assert kicked == [("SMH", "D", 8000, True), ("SMH", "W", 8000, True), ("SMH", "5", 400, False)]


def test_the_wrapper_binds_the_charts_timeframe_to_the_warm(v4_row, monkeypatch):
    from api.services import bars_fetch
    kicked = []
    monkeypatch.setattr(bars_fetch, "_kick_cold_fetch", lambda *a: kicked.append(a))
    store = _arith_store(300)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", lambda s, tf_, count: list(store.get(s.upper(), [])))
    sig._rs_line_provider("NVDA", "W", {"benchmark": "CUSTOM", "customBenchmark": "QQQZ"})
    assert kicked == [("QQQZ", "W", 8000, True)]


# ── the cache key ────────────────────────────────────────────────────────────

def test_the_v4_key_leads_with_rev_5_and_shape_6_and_carries_the_new_inputs(v4_row, monkeypatch):
    keys = []
    monkeypatch.setattr(sig.cache, "get", lambda k: keys.append(k))
    store = _arith_store(300)
    _lane(monkeypatch, store)
    _lane(monkeypatch, store, inputs={"view": "vars"})
    _lane(monkeypatch, store, inputs={"anchorDate": "2024-01-02"})
    _lane(monkeypatch, store, inputs={"benchmark": "CUSTOM", "customBenchmark": "SMH"})
    _lane(monkeypatch, store, inputs={"clenowWindow": 60})
    # Deepvue round 2 (2026-11-08): rev 5 / shape 6 (`rating.m9`, `ratingHistory`)
    assert rsp._RS_PAYLOAD_SHAPE_V4 == 6 and rsp._RS_PAYLOAD_SHAPE == 4
    assert all(k.startswith("sig:rs5p6:") for k in keys), keys
    assert len(set(keys)) == 5
    assert '"view": "vars"' in keys[1] and '"anchorDate": "2024-01-02"' in keys[2]
    assert ':CUSTOM:' in keys[3] and '"customBenchmark": "SMH"' in keys[3]


def test_the_method_inputs_are_clamped_by_the_rows_own_ranges(v4_row, monkeypatch):
    env = _lane(monkeypatch, _arith_store(300), inputs={"clenowWindow": 5, "rrgRatioLength": 999,
                                                         "clenowGapPct": "x", "varsLookback": 60.6})
    i = env["payload"]["inputs"]
    assert (i["clenowWindow"], i["rrgRatioLength"], i["clenowGapPct"], i["varsLookback"]) == (20, 60, 15.0, 61)


# ── member copy ──────────────────────────────────────────────────────────────

def _strings(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from _strings(v, f"{path}.{k}" if path else str(k))


@pytest.mark.parametrize("tf, inputs", [("D", {}), ("W", {}), ("5", {}), ("D", {"anchorDate": "2026-13-45"}),
                                        ("D", {"benchmark": "CUSTOM", "customBenchmark": "ZZZQ"})])
def test_phase3_copy_is_plain_words_with_the_plural_rule(tf, inputs, v4_row, monkeypatch):
    p = _lane(monkeypatch, _arith_store(), tf=tf, inputs=inputs)["payload"]
    for block in ("rotation", "quality", "vars"):
        for path, text in _strings(p[block], block):
            assert not ONE_BARS.search(text), (path, text)
            assert not re.search(r"\b(buy|sell)\b", text, re.I), (path, text)
            assert text.isascii() or set(text) - set(map(chr, range(128))) <= {"²", "·", NB}, (path, text)
            assert not text.endswith("."), (path, text)
    for path, text in _strings(p["checks"]["anchor"], "anchor"):
        assert not ONE_BARS.search(text), (path, text)


# ── the flag-off control ─────────────────────────────────────────────────────
#
# ⭐ TAKEN FROM THE PRE-3-06 PROVIDER. The digest and the key below were made by
# running BOTH `rs_provider.py` at 9f22f8684e (the commit before this unit) and
# this unit's file over `_arith_store(900)` (arithmetic only, so no platform's
# libm moves a digit) with the v3 row installed: the two envelopes and the two
# keys were identical, and these are their values. A change to the v3 lane that
# moves either is a v3 change, not a v4 one: it needs its own shape bump.
V3_DIGEST = "6c26597300e84c91"
V3_KEY = ('sig:rs3p4:NVDA:D:SPY:{"lookback": 252, "maLength": 21, "maType": "EMA", "mansfieldLength": 200, "priceTolerance": 2.0, "redDayThreshold": -0.5}:{"shortHistoryDots": true, "showMansfield": false, "showNewHigh": true, "showNewHighBeforePrice": true, "showNewLow": false, "showRedDay": false}:r-|e-:2026-11-07')


def _v3_envelope(monkeypatch, tf="D", inputs=None):
    monkeypatch.setitem(rd._BY_ID, "rsLine", rd._rs_line_row(True))
    monkeypatch.setattr(rd, "RS_V2_ENABLED", True)
    monkeypatch.setattr(rsp, "_rs_data_generation", lambda now=None: "r-|e-")
    monkeypatch.setattr(rsp, "_et_session_day", lambda: "2026-11-07")
    monkeypatch.setattr(rb, "_groups_for", lambda s: {"sector": "Technology", "industry": "Semiconductors"})
    keys = []
    monkeypatch.setattr(sig.cache, "get", lambda k: keys.append(k))
    monkeypatch.setattr(sig.cache, "set", lambda k, v, ttl: None)
    store = _arith_store(900)
    monkeypatch.setattr(sig, "_fetch_bars_for_tf", lambda s, tf_, count: list(store.get(s.upper(), []))[-count:])
    env = sig._rs_line_provider("NVDA", tf, dict(inputs or {"benchmark": "SPY"}))
    body = json.dumps({k: v for k, v in env.items() if k != "asOf"}, sort_keys=True, separators=(",", ":"))
    return env, body, keys[-1]


def test_control_the_v3_envelope_and_key_are_byte_identical_with_the_flag_off(monkeypatch):
    env, body, key = _v3_envelope(monkeypatch)
    assert hashlib.sha256(body.encode()).hexdigest()[:16] == V3_DIGEST
    assert key == V3_KEY
    assert not {"rotation", "quality", "vars", "ratingHistory"} & set(env["payload"])
    assert "m9" not in env["payload"]["rating"], "the v3 payload keeps its four components"
    assert set(env["columns"]) == set(V4_COLUMNS) - set(rd.RS_PHASE3_WIRE_COLUMNS) - set(rd.RS_RATING_WIRE_COLUMNS)
    assert "source" not in env["payload"]["checks"]["anchor"]


def test_control_v4_inputs_sent_to_the_v3_row_change_nothing(monkeypatch):
    _env, base, key = _v3_envelope(monkeypatch)
    _env, body, key2 = _v3_envelope(monkeypatch, inputs={
        "benchmark": "SPY", "view": "rotation", "customBenchmark": "SMH", "anchorDate": "2024-06-05",
        "clenowWindow": 40})
    assert body == base and key2 == key
