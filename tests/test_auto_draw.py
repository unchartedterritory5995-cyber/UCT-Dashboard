"""The learned auto-drawer (api/services/auto_draw.py) and its `drawn` block on the chart route.

Rails:
  * PARITY: the port reproduces the lab drawer exactly (same horizontals, trendlines, scores and
    reasons) on synthetic bars and, when the box has it, on real daily bars. The lab file is read
    from AUTO_DRAW_LAB_DIR (default: the lab folder on the owner's box); absent => those tests skip.
  * the embedded coefficients ARE the lab model's (no transcription drift);
  * drawn_set: prior-day and 10-day high/low always in the default set, nearest-first, capped;
  * the `drawn` block rides GET /api/patterns/{sym} only for an ADMIN while AUTO_STRUCTURES_ENABLED.
Synthetic bars only in the repo (public); real bars are read in place, read-only, never stored.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sqlite3

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.patterns as patterns_router  # registers every detector
from api.services import auto_draw, auto_structures
from api.services.pattern_engine.detectors import registry
from tests.authclients import ADMIN, PAID_MEMBER, authorize

LAB_DIR = os.environ.get("AUTO_DRAW_LAB_DIR",
                         r"C:\Users\Patrick\Desktop\TSDR-Ledger-Backup\lab\auto_draw")
BARS_DB = os.environ.get("AUTO_DRAW_PARITY_BARS_DB", r"C:\data\bars.db")
PARITY_TICKERS = ("AAPL", "NVDA", "MSFT", "TSLA", "SMCI", "PLTR", "CELH", "AMD")


def _lab():
    path = os.path.join(LAB_DIR, "drawer.py")
    if not os.path.exists(path):
        pytest.skip(f"lab drawer not present at {path}")
    spec = importlib.util.spec_from_file_location("_lab_auto_draw_drawer", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _synthetic(seed, n=320, gappy=True):
    """A random walk with occasional >=2% gaps (so gap-edge candidates exist), YYYYMMDD dates."""
    rng = np.random.default_rng(seed)
    import datetime as dt
    d = dt.date(2024, 1, 2)
    p = 50.0 + 30 * rng.random()
    out = []
    while len(out) < n:
        if d.weekday() < 5:
            gap = 1.0
            if gappy and rng.random() < 0.04:
                gap = 1 + rng.choice([-1, 1]) * (0.025 + 0.06 * rng.random())
            o = p * gap
            c = o * (1 + rng.normal(0.0008, 0.022))
            h = max(o, c) * (1 + abs(rng.normal(0, 0.009)))
            lo = min(o, c) * (1 - abs(rng.normal(0, 0.009)))
            v = float(int(1e6 * (0.5 + rng.random()) * (3 if gap != 1.0 else 1)))
            out.append((int(d.strftime("%Y%m%d")), round(o, 4), round(h, 4), round(lo, 4), round(c, 4), v))
            p = c
        d += dt.timedelta(days=1)
    return out


def _strip(rows):
    """Compare on what the lab emits (the port adds `src` / `is_high`)."""
    return [{k: r[k] for k in ("kind", "coords", "score", "why")} for r in rows]


def _mismatches(lab, bars, asofs, k=5):
    bad = []
    for asof in asofs:
        a = _strip(lab.propose(bars, asof, k=k))
        b = _strip(auto_draw.propose(bars, k=k, asof=asof))
        if a != b:
            bad.append((asof, a, b))
    return bad


# ── parity ──────────────────────────────────────────────────────────────────

def test_embedded_coefficients_are_the_lab_models():
    path = os.path.join(LAB_DIR, "out", "drawer_model.json")
    if not os.path.exists(path):
        pytest.skip(f"lab model not present at {path}")
    m = json.load(open(path, encoding="utf-8"))
    for kind in ("horizontal", "trendline"):
        for key in ("features", "mean", "scale", "coef", "intercept"):
            assert auto_draw.MODEL[kind][key] == m[kind][key], (kind, key)
    assert auto_draw.MODEL_DATE == m["meta"]["created"]


def test_parity_with_the_lab_drawer_on_synthetic_bars():
    lab = _lab()
    checked = 0
    total_h = total_t = 0
    for seed in range(10):
        bars = _synthetic(seed)
        asofs = [bars[i][0] for i in (60, 150, 240, len(bars) - 1)]
        assert _mismatches(lab, bars, asofs) == []
        for asof in asofs:
            rows = auto_draw.propose(bars, k=5, asof=asof)
            total_h += sum(r["kind"] == "horizontal" for r in rows)
            total_t += sum(r["kind"] == "trendline" for r in rows)
            checked += 1
    # control: the comparison was over real proposals, not two empty lists
    assert checked == 40 and total_h >= 100 and total_t >= 100


def test_parity_accepts_dict_bars_and_the_last_bar_default():
    lab = _lab()
    bars = _synthetic(42)
    dicts = [{"t": b[0], "o": b[1], "h": b[2], "l": b[3], "c": b[4], "v": b[5]} for b in bars]
    a = _strip(lab.propose(bars, bars[-1][0], k=5))
    assert a and _strip(auto_draw.propose(dicts, k=5)) == a


def _db_bars(con, tk):
    rows = con.execute("select ts,o,h,l,c,v from ohlcv where ticker=? and tf='D' and ts>=20230101 "
                       "order by ts", (tk,)).fetchall()
    return auto_draw.clean_bars(rows)


def test_parity_with_the_lab_drawer_on_real_daily_bars():
    lab = _lab()
    if not os.path.exists(BARS_DB):
        pytest.skip(f"bars db not present at {BARS_DB}")
    con = sqlite3.connect(f"file:{BARS_DB.replace(os.sep, '/')}?mode=ro", uri=True)
    try:
        used = 0
        for tk in PARITY_TICKERS:
            bars = _db_bars(con, tk)
            if len(bars) < 200:
                continue
            asofs = [bars[i][0] for i in (len(bars) - 1, len(bars) - 40, len(bars) - 120)]
            assert _mismatches(lab, bars, asofs) == [], tk
            used += 1
    finally:
        con.close()
    assert used >= 3, "control: too few tickers had bars, the real-bar parity proved little"


def test_clean_bars_clips_bad_prints_and_drops_unusable_rows():
    rows = [(20260101, 10, 20, 9, 10.5, 100),     # high > 1.4x body top -> body top
            (20260102, 10, 11, 3, 10.2, None),    # low < 0.6x body bottom -> body bottom; v None -> 0
            (20260103, None, 11, 9, 10, 5),       # missing price -> dropped
            (20260104, 10, 11, 9, 0, 5)]          # non-positive close -> dropped
    assert auto_draw.clean_bars(rows) == [(20260101, 10, 10.5, 9, 10.5, 100),
                                          (20260102, 10, 11, 10, 10.2, 0)]


# ── the chart's default drawn set ───────────────────────────────────────────

def test_drawn_set_always_carries_prior_day_and_ten_day_levels_nearest_first():
    bars = _synthetic(7)
    d = auto_draw.drawn_set(bars)
    hs = d["horizontals"]
    assert 1 <= len(hs) <= auto_draw.DRAWN_HORIZONTALS
    last = bars[-1]
    w10 = bars[-10:]
    defaults = {"prior_day_high": last[2], "prior_day_low": last[3],
                "ten_day_high": max(b[2] for b in w10), "ten_day_low": min(b[3] for b in w10)}
    got = {h["source"]: h["price"] for h in hs}
    # each default is present unless it sits within 0.5 ATR of an earlier default (PDH can BE the 10D high)
    for src, price in defaults.items():
        assert src in got or any(abs(price - got[s]) <= 0.5 * d["atr"] for s in got if s in defaults), src
    dists = [abs(h["price"] - d["last_close"]) for h in hs]
    assert dists == sorted(dists)
    assert any(h["source"] == "learned" for h in hs), "control: the learned fill never entered"
    assert 1 <= len(d["trendlines"]) <= auto_draw.DRAWN_TRENDLINES
    assert d["asof_t"] == last[0] and d["model"].endswith(auto_draw.MODEL_DATE)
    for tl in d["trendlines"]:
        assert {"t1", "p1", "t2", "p2", "p_now", "score"} <= set(tl)


def test_drawn_set_is_none_on_too_few_bars():
    assert auto_draw.drawn_set(_synthetic(1, n=25)) is None
    assert auto_draw.propose(_synthetic(1, n=25)) == []


def test_learned_display_rules_name_registered_detectors():
    known = set(registry.list_pattern_ids())
    assert registry.DISPLAY_LEARNED_HIDES == {"volume_profile_nodes"}
    assert registry.DISPLAY_LEARNED_REPLACES == {"swing_pivots"}
    assert (registry.DISPLAY_LEARNED_HIDES | registry.DISPLAY_LEARNED_REPLACES) <= known


# ── the route ───────────────────────────────────────────────────────────────

def _client(user, monkeypatch):
    app = FastAPI()
    app.include_router(patterns_router.router)
    authorize(app, user)
    monkeypatch.setattr(patterns_router.memory, "get_active_detections", lambda *a, **k: [])
    return TestClient(app)


def test_drawn_rides_the_route_only_for_an_admin_with_the_flag(monkeypatch):
    from api.services import bars_sqlite
    rows = _synthetic(3)
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda sym, tf, n: rows)
    monkeypatch.setattr(auto_structures, "structures_for", lambda sym: [])
    auto_structures._DRAWN_CACHE.clear()
    url = "/api/patterns/ZZZ?tf=D&confirmed_only=false&include_structures=true"

    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "1")
    body = _client(ADMIN, monkeypatch).get(url).json()
    drawn = body["drawn"]
    assert drawn["horizontals"] and drawn["trendlines"]
    assert drawn["suppress"] == {"volume_profile_nodes": "hidden_by_default",
                                 "swing_pivots": "replaced_by_learned"}

    assert "drawn" not in _client(PAID_MEMBER, monkeypatch).get(url).json()
    assert "drawn" not in _client(ADMIN, monkeypatch).get(
        "/api/patterns/ZZZ?tf=5&confirmed_only=false&include_structures=true").json()
    assert "drawn" not in _client(ADMIN, monkeypatch).get(
        "/api/patterns/ZZZ?tf=D&confirmed_only=false").json()

    monkeypatch.setenv("AUTO_STRUCTURES_ENABLED", "0")
    assert "drawn" not in _client(ADMIN, monkeypatch).get(url).json()


def test_drawn_for_never_raises(monkeypatch):
    from api.services import bars_sqlite

    def boom(*a, **k):
        raise RuntimeError("db down")
    auto_structures._DRAWN_CACHE.clear()
    monkeypatch.setattr(bars_sqlite, "get_bars", boom)
    assert auto_structures.drawn_for("SYNB") is None
