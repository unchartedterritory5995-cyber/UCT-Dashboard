"""api/services/breadth_reading.py — the drill window's reading strip + History drawer.

Synthetic values only (no market data is read or printed)."""
from __future__ import annotations

import os
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tools", "breadth"))

from api.services import breadth_reading as br  # noqa: E402
from api.services import breadth_shade_rule as rule  # noqa: E402
import calibrate_breadth_shading as cb  # noqa: E402

SPEC = {"pcts": {"notable": 25, "strong": 10, "extreme": 3},
        "cols": {"up": {"bull": "high", "sides": "high", "per": "universe_count"},
                 "pct": {"bull": "high", "sides": "both"},
                 "net": {"bull": "high", "sides": "both", "zero": True},
                 "dn": {"bull": "low", "sides": "high", "per": "universe_count",
                        "floors": {"high": 500}, "shareFloors": {"high": 0.19}}}}


def _dates(n, start=2010):
    from datetime import date, timedelta
    d0 = date(start, 1, 4)
    out, d = [], d0
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def _rows(n=600, ucount=lambda i: 2000):
    ds = _dates(n)
    # a deterministic, non-monotone pattern for every column
    return [{"date": ds[i], "universe_count": ucount(i),
             "up": (i * 37) % 400, "pct": (i * 53) % 100, "net": ((i * 29) % 201) - 120,
             "dn": (i * 41) % 700} for i in range(n)]


def _spy(rows, step=0.01):
    ds = [r["date"] for r in rows]
    closes = {d: 100.0 * (1 + step) ** i for i, d in enumerate(ds)}
    return ds, closes, "SPY daily close"


def _series(rows, metric, spec=SPEC, spy=None):
    return br.build_series("uct", metric, rows, spec, spy or _spy(rows))


def _cut(rows, spec=SPEC):
    return cb.build_cutoffs(rows, spec)


# ── level parity with the shading ────────────────────────────────────────────────
@pytest.mark.parametrize("metric", ["up", "pct", "net", "dn"])
@pytest.mark.parametrize("universe", ["uct", "nasdaq"])
def test_level_and_tone_are_the_shading_rule_for_every_row(metric, universe):
    rows = _rows()
    cut = _cut(rows)
    s = _series(rows, metric)
    for r in rows[::7]:
        a = br.answer(s, universe=universe, metric=metric, date=r["date"], spec=SPEC, cut=cut)
        want = rule.shade(r, metric, SPEC, cut, universe)
        assert (a["tone"], a["level"]) == ((want[0], want[1]) if want else (None, 0))


def test_percentile_is_share_at_or_below_like_percentile_js():
    rows = _rows()
    s = _series(rows, "pct")
    r = rows[123]
    a = br.answer(s, universe="uct", metric="pct", date=r["date"], spec=SPEC, cut=_cut(rows))
    vals = [x["pct"] for x in rows]
    assert abs(a["percentile"] - 100 * sum(v <= r["pct"] for v in vals) / len(vals)) <= 0.05


# ── share of the universe ────────────────────────────────────────────────────────
def test_count_columns_rank_by_share_so_a_doubled_universe_ranks_the_same():
    small = _rows()
    big = [dict(r, up=r["up"] * 2, universe_count=4000) for r in small]
    d = small[200]["date"]
    a = br.answer(_series(small, "up"), universe="uct", metric="up", date=d, spec=SPEC, cut=_cut(small))
    b = br.answer(_series(big, "up"), universe="uct", metric="up", date=d, spec=SPEC, cut=_cut(big))
    assert a["percentile"] == b["percentile"] and a["rank"]["by"] == "share"


def test_a_row_without_a_universe_count_is_not_ranked():
    rows = _rows()
    rows[50] = dict(rows[50], universe_count=None)
    s = _series(rows, "up")
    assert rows[50]["date"] not in s["dates"]
    with pytest.raises(br.NoReading):
        br.answer(s, universe="uct", metric="up", date=rows[50]["date"], spec=SPEC, cut=_cut(rows))


# ── signed columns ───────────────────────────────────────────────────────────────
def test_signed_column_positive_is_never_bear_and_negative_never_bull():
    rows = _rows()
    cut = _cut(rows)
    s = _series(rows, "net")
    for r in rows:
        a = br.answer(s, universe="uct", metric="net", date=r["date"], spec=SPEC, cut=cut)
        if r["net"] > 0:
            assert a["tone"] in (None, "bull")
        elif r["net"] < 0:
            assert a["tone"] in (None, "bear")
    assert a["rank"]["signed"] is True


# ── forward returns ──────────────────────────────────────────────────────────────
def test_forward_moves_on_a_synthetic_compounding_series():
    rows = _rows(300)
    s = _series(rows, "pct", spy=_spy(rows, step=0.01))
    f = s["fwd"][0]
    assert abs(f[5] - (1.01 ** 5 - 1) * 100) < 1e-9
    assert abs(f[20] - (1.01 ** 20 - 1) * 100) < 1e-9
    assert 60 not in s["fwd"][-10]                                   # no session 60 ahead
    base = s["baseline"]
    assert base[5]["higher"] == 100 and base[5]["n"] == 295
    assert base[60]["n"] == 240


def test_baseline_is_every_session_and_similar_is_a_subset():
    rows = _rows()
    a = br.answer(_series(rows, "pct"), universe="uct", metric="pct", date=rows[100]["date"],
                  spec=SPEC, cut=_cut(rows))
    for h in ("5", "20", "60"):
        assert a["forward"]["similar"][h]["n"] <= a["forward"]["baseline"][h]["n"]


def test_similarity_rule_is_band_or_nearest_30_whichever_is_larger():
    rows = _rows(3000)
    a = br.answer(_series(rows, "pct"), universe="uct", metric="pct", date=rows[100]["date"],
                  spec=SPEC, cut=_cut(rows))
    assert a["similar"]["rule"] == "band" and a["similar"]["n"] >= 30
    few = _rows(200)
    b = br.answer(_series(few, "pct"), universe="uct", metric="pct", date=few[100]["date"],
                  spec=SPEC, cut=_cut(few))
    # ±2.5 points of 200 sessions holds about 10: the nearest 30 is the larger set
    assert b["similar"]["rule"] == "nearest" and b["similar"]["n"] == 30


def test_small_n_is_flagged_when_few_similar_days_have_a_forward_move():
    rows = _rows(200)
    ds, closes, basis = _spy(rows)
    keep = set(ds[-25:])                                   # SPY only for the last 25 sessions
    spy = ([d for d in ds if d in keep], {d: c for d, c in closes.items() if d in keep}, basis)
    a = br.answer(br.build_series("uct", "pct", rows, SPEC, spy), universe="uct", metric="pct",
                  date=rows[10]["date"], spec=SPEC, cut=_cut(rows))
    assert a["similar"]["small"] is True
    assert a["forward"]["similar"]["5"]["n"] < br.SMALL_N


# ── typical days ─────────────────────────────────────────────────────────────────
def test_a_middle_reading_is_typical_and_unshaded():
    rows = _rows()
    s = _series(rows, "pct")
    mid = next(r for r in rows if r["pct"] == 50)
    a = br.answer(s, universe="uct", metric="pct", date=mid["date"], spec=SPEC, cut=_cut(rows))
    assert a["typical"] is True and a["level"] == 0 and a["tone"] is None
    assert a["context"]["streak"]["side"] == "middle"
    top = max(rows, key=lambda r: r["pct"])
    b = br.answer(s, universe="uct", metric="pct", date=top["date"], spec=SPEC, cut=_cut(rows))
    assert b["typical"] is False and b["level"] >= 1 and b["side"] == "high"
    assert b["share"] <= 3 and b["beyond"]["count"] >= 1


def test_closest_days_are_five_distinct_episodes_not_the_day_itself():
    rows = _rows()
    a = br.answer(_series(rows, "pct"), universe="uct", metric="pct", date=rows[300]["date"],
                  spec=SPEC, cut=_cut(rows))
    picked = [c["date"] for c in a["closest"]]
    assert len(picked) == 5 and rows[300]["date"] not in picked
    idx = sorted(next(i for i, r in enumerate(rows) if r["date"] == d) for d in picked)
    assert all(b - a_ >= br.CLOSEST_GAP for a_, b in zip(idx, idx[1:]))


def test_live_reading_not_in_history_is_ranked_from_the_value():
    rows = _rows()
    s = _series(rows, "up")
    a = br.answer(s, universe="uct", metric="up", date="2099-01-02", spec=SPEC, cut=_cut(rows),
                  row={"date": "2099-01-02", "up": 399, "universe_count": 2000})
    assert a["in_history"] is False and a["side"] == "high"
    assert a["series"]["dates"][-1] == "2099-01-02"


# ── universes, market-wide columns, caching ─────────────────────────────────────
def test_market_wide_columns_rank_on_uct():
    assert br.basis_universe("nasdaq", "vix") == "uct"
    assert br.basis_universe("nasdaq", "up_20pct_5d") == "nasdaq"
    assert br.basis_universe("uct", "up_20pct_5d") == "uct"


@pytest.fixture
def fake_store(monkeypatch):
    calls = []
    data = {"us": _rows(400), "nasdaq": [dict(r, pct=99 - r["pct"]) for r in _rows(400)]}
    tokens = {"us": "t1", "nasdaq": "t1"}

    def load(u):
        calls.append(u)
        return data[u]
    monkeypatch.setattr(br, "_load_rows", load)
    monkeypatch.setattr(br, "store_token", lambda u: f"{u}|{tokens[u]}")
    monkeypatch.setattr(br, "_spy_closes", lambda rows: _spy(rows))
    monkeypatch.setattr(rule, "load_spec", lambda: SPEC)
    monkeypatch.setattr(rule, "cutoffs_for", lambda u, k: _cut(data.get(u, data["us"])))
    br.clear_cache()
    yield calls, data, tokens
    br.clear_cache()


def test_universes_never_share_arrays(fake_store):
    calls, data, _ = fake_store
    d = data["us"][77]["date"]
    a = br.reading("us", "pct", d)
    b = br.reading("nasdaq", "pct", d)
    assert a["basis_universe"] == "us" and b["basis_universe"] == "nasdaq"
    assert a["percentile"] != b["percentile"]
    assert sorted(calls) == ["nasdaq", "us"]


def test_arrays_are_built_once_per_store_token(fake_store):
    calls, data, tokens = fake_store
    d = data["us"][10]["date"]
    br.reading("us", "pct", d)
    br.reading("us", "pct", data["us"][11]["date"])
    br.reading("us", "up", d)                          # another metric reuses the rows
    assert calls == ["us"]
    tokens["us"] = "t2"                                # a new session / rebuild
    br.reading("us", "pct", d)
    assert calls == ["us", "us"]


def test_the_route_is_members_only():
    from api.routers import breadth_monitor as bm
    route = next(r for r in bm.router.routes if getattr(r, "path", "") == "/api/breadth-monitor/reading")
    deps = {d.call for d in route.dependant.dependencies}
    assert bm.require_paid in deps
