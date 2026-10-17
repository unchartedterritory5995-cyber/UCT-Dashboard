"""The daily pattern scan: declared history depth and the ticker on the context.

Two production gaps closed for uct_pullback_ma_v5, both exercised through the
REAL scan function (`api.main._scan_patterns_daily`), the real SQLite store and
the real `/api/patterns/{sym}` route, with only the bar source stubbed:

1. DEPTH. The scan fetched 200 daily bars, and the rule needs 220. A detector
   now declares `min_bars` at registration; the scan fetches the deepest
   declaration and hands each detector its own trailing slice. Every detector
   that declares nothing must receive BYTE-IDENTICAL bars to before (the
   trailing 200), and the context must be the one built on those 200 bars.
2. SYMBOL. A detector with a per-symbol rule registers `wants_sym=True`;
   `detect_all(..., sym=X)` hands ONLY it a context copy carrying `sym`, so the
   excluded-fund guard fires on the scan path. Every other detector's context
   (which it embeds in its detections) is unchanged, so their stored rows stay
   byte-identical (tests/pattern_engine/detectors/test_uct_setup_geometry.py
   pins digests of whole detections, context included).
"""
from __future__ import annotations

import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.patterns as patterns_router
from api.main import _scan_patterns_daily
from api.services import bars_sqlite
from api.services.pattern_engine import detect_all, memory
from api.services.pattern_engine.detectors import registry
from api.services.pattern_engine.detectors.uct import uct_pullback_ma_v5 as PB
from api.services.pattern_engine.detectors.uct import uct_setups_common as U
from api.services.pattern_engine.primitives.context import build_context
from tests.authclients import ADMIN, PAID_MEMBER, signed_in_as
from tests.pattern_engine.detectors import _pullback_v5_synth as SY

_ID = "uct_pullback_ma_v5"
_DAY = 86_400


class _Log:
    def debug(self, *a, **k): pass
    def warning(self, *a, **k): pass
    def info(self, *a, **k): pass


def _recent(bars):
    """Re-time a synthetic series so its last bar is yesterday (the store and
    the route keep only recent detections active)."""
    last = int(time.time()) - _DAY
    n = len(bars)
    return [{**b, "t": last - (n - 1 - k) * _DAY} for k, b in enumerate(bars)]


def _tuples(bars):
    return [(b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]) for b in bars]


@pytest.fixture
def store(monkeypatch, tmp_path):
    monkeypatch.setenv("PATTERN_DB_PATH", str(tmp_path / "patterns.db"))
    from api.services.pattern_engine import pattern_db
    pattern_db._initialized_paths.clear()
    pattern_db.init_db()
    yield


def _stub_bars(monkeypatch, by_sym, calls=None):
    def get_bars(sym, tf, n):
        if calls is not None:
            calls.append((sym, tf, n))
        rows = by_sym.get(sym, [])
        return rows[-n:]
    monkeypatch.setattr(bars_sqlite, "get_bars", get_bars)


def _route(user, sym):
    app = FastAPI()
    app.include_router(patterns_router.router)
    with signed_in_as(user, app=app):
        r = TestClient(app).get(f"/api/patterns/{sym}?tf=D&confirmed_only=false&min_conf=0")
    assert r.status_code == 200
    return {d["pattern_id"] for d in r.json()["detections"]}


# ── the registry helpers ─────────────────────────────────────────────────────

def test_the_pullback_detector_declares_its_history_and_nothing_else_does():
    assert registry.min_bars_for(_ID) == PB.MIN_BARS == 222
    declared = {pid for pid in registry.list_pattern_ids() if registry.min_bars_for(pid)}
    assert declared == {_ID}, declared
    assert registry.scan_depth(registry.SCAN_BASE_DEPTH) == 222
    assert registry.scan_depth(500) == 500


def test_bars_for_slices_by_declaration():
    bars = list(range(300))
    assert registry.bars_for("bull_flag", bars, 200) == bars[-200:]
    assert registry.bars_for(_ID, bars, 200) == bars[-222:]
    assert registry.bars_for(_ID, bars, 250) == bars[-250:]   # never LESS than the base
    short = list(range(150))
    assert registry.bars_for("bull_flag", short, 200) == short
    assert registry.bars_for(_ID, short, 200) == short


# ── 1. depth: other detectors see byte-identical bars ───────────────────────

def test_undeclared_detectors_receive_byte_identical_bars_and_context(monkeypatch, store):
    """Record exactly what each registered detector is handed by the scan, and
    compare with what the pre-change scan handed it: the trailing 200 bars of a
    200-bar fetch, and the context built on those 200 bars."""
    import api.routers.patterns  # noqa: F401  (registers every detector)
    full = _recent(SY.random_walk(n=320, seed=3))
    rows = _tuples(full)
    # non-vacuity: on this series the context depends on the window, so a scan
    # that built it on the deeper fetch would be caught below
    assert build_context(full[-222:], sym="DEPTHX") != build_context(full[-200:], sym="DEPTHX")
    calls = []
    _stub_bars(monkeypatch, {"DEPTHX": rows}, calls)
    seen = {}
    for pid in registry.list_pattern_ids():
        real = registry._REGISTRY[pid]

        def rec(bars, ctx, _pid=pid, _real=real):
            seen[_pid] = (tuple(tuple(sorted(b.items())) for b in bars), dict(ctx))
            return _real(bars, ctx)
        monkeypatch.setitem(registry._REGISTRY, pid, rec)
    _scan_patterns_daily(["DEPTHX"], set(), _Log())

    assert calls == [("DEPTHX", "D", 222)], calls
    old_bars = [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}
                for r in rows[-200:]]
    old_key = tuple(tuple(sorted(b.items())) for b in old_bars)
    old_ctx = build_context(old_bars, sym="DEPTHX")
    assert set(seen) == set(registry.list_pattern_ids())
    assert "sym" not in old_ctx
    for pid, (got, ctx) in seen.items():
        if pid == _ID:
            assert ctx == {**old_ctx, "sym": "DEPTHX"}
        else:
            assert ctx == old_ctx, pid
        if pid == _ID:
            assert len(got) == 222 and got == tuple(
                tuple(sorted({"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}.items()))
                for r in rows[-222:])
        else:
            assert len(got) == 200, (pid, len(got))
            assert got[0] == old_key[0] and got[-1] == old_key[-1], pid
            assert got == old_key, pid


def test_undeclared_detectors_produce_identical_detections(monkeypatch):
    """The detections themselves, old path vs new path, for every detector but
    the one that declared a deeper history."""
    import api.routers.patterns  # noqa: F401
    full = _recent(SY.random_walk(n=320, seed=3))
    old_bars = full[-200:]
    ctx = build_context(old_bars, sym="IDENT")
    others = [p for p in registry.list_pattern_ids() if p != _ID]
    monkeypatch.setattr(time, "time", lambda: 1_800_000_000.0)

    def strip(ds):
        out = []
        for d in ds:
            d = dict(d)
            d.pop("id", None)
            out.append(d)
        return out
    before = strip(detect_all(old_bars, ctx, pattern_ids=others))
    after = strip(detect_all(full, ctx, pattern_ids=others, base_depth=200))
    assert before, "non-vacuity: the walk must fire some detector"
    assert after == before


def test_detect_all_without_base_depth_is_unchanged():
    """Callers that pass no base_depth (pattern vision, tests) keep handing
    every detector the bars they passed."""
    import api.routers.patterns  # noqa: F401
    bars = SY.fire_e21(U.series)
    got = {}
    real = registry._REGISTRY["bull_flag"]
    try:
        registry._REGISTRY["bull_flag"] = lambda b, c: got.setdefault("n", len(b)) and []
        detect_all(bars, {}, pattern_ids=["bull_flag"])
    finally:
        registry._REGISTRY["bull_flag"] = real
    assert got["n"] == len(bars)


# ── 1+2 through the real scan, store and route ──────────────────────────────

def test_the_scan_fires_the_pullback_detector_and_the_route_serves_it_to_admins_only(
        monkeypatch, store):
    bars = _tuples(_recent(SY.fire_e21(U.series)))
    _stub_bars(monkeypatch, {"PBVFIVE": bars})
    _scan_patterns_daily(["PBVFIVE"], set(), _Log())
    stored = memory.get_active_detections("PBVFIVE", "D", include_internal=True,
                                          pattern_ids=[_ID])
    assert len(stored) == 1 and stored[0]["context"]["sym"] == "PBVFIVE"
    assert _ID in _route(ADMIN, "PBVFIVE")
    assert _ID not in _route(PAID_MEMBER, "PBVFIVE")


def test_without_the_declaration_the_scan_cannot_fire_it(monkeypatch, store):
    """Control: the old 200-bar depth is exactly what kept it from firing."""
    bars = _tuples(_recent(SY.fire_e21(U.series)))
    _stub_bars(monkeypatch, {"PBVFIVE": bars})
    monkeypatch.delitem(registry._MIN_BARS, _ID)
    _scan_patterns_daily(["PBVFIVE"], set(), _Log())
    assert memory.get_active_detections("PBVFIVE", "D", include_internal=True,
                                        pattern_ids=[_ID]) == []


@pytest.mark.parametrize("fund", ["TQQQ", "SOXL", "GLD"])
def test_the_scan_applies_the_excluded_fund_guard(monkeypatch, store, fund):
    bars = _tuples(_recent(SY.fire_e21(U.series)))
    _stub_bars(monkeypatch, {fund: bars, "PBCTRL": bars})
    _scan_patterns_daily([fund, "PBCTRL"], set(), _Log())
    assert memory.get_active_detections(fund, "D", include_internal=True,
                                        pattern_ids=[_ID]) == []
    assert _ID not in _route(ADMIN, fund)
    # control: identical bars under an ordinary ticker fire through the same path
    assert len(memory.get_active_detections("PBCTRL", "D", include_internal=True,
                                            pattern_ids=[_ID])) == 1
    assert _ID in _route(ADMIN, "PBCTRL")


def test_only_a_detector_that_asked_receives_the_ticker():
    import api.routers.patterns  # noqa: F401
    assert {p for p in registry.list_pattern_ids() if registry.wants_sym(p)} == {_ID}
    ctx = build_context(SY.uptrend(n=60), sym="nvda")
    assert "sym" not in ctx, "build_context itself is unchanged"
    assert registry.context_for(_ID, ctx, "nvda") == {**ctx, "sym": "NVDA"}
    assert registry.context_for("bull_flag", ctx, "nvda") is ctx
    assert registry.context_for(_ID, ctx, None) is ctx

