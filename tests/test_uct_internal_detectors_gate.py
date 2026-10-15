"""The internal-detector gate still works, and the four trader-setup detectors
are now PUBLIC.

History: uct_kicker · uct_oops_reversal · uct_slingshot · uct_hve shipped in
`registry.INTERNAL_PATTERN_IDS` (admin-only). Owner ruling 2026-10-15 made them
visible to every member and every tool. The set is now EMPTY, but the gate
machinery and its call sites stay: they are the kill switch for any future
internal detector. So this file proves two things at once.

1. THE GATE MECHANISM. A synthetic detector id (`_PROBE`) is registered in the
   test and monkeypatched into `INTERNAL_PATTERN_IDS`; every member-facing read
   path must drop it, while an admin's raw read still returns it.
2. THE FOUR ARE VISIBLE on each of those same paths, read in the SAME call that
   proves the probe was dropped, so a read that returns nothing at all cannot
   pass for either claim. A public CONTROL id (bull_flag) is seeded beside them.

Read paths covered:
  * screener: pattern_join.read_pattern_fields + read_pattern_fields_canonical_shadow
  * GET /api/patterns/{sym}?confirmed_only=false (paid member and admin)
  * memory.get_active_detections (default and include_internal=True)
  * voice: _find_patterns_on_ticker, _scan_active_patterns, _list_pattern_types
  * Compass chat: find_patterns_on_ticker, scan_active_patterns, list_pattern_types
  * voice deep-data: get_pattern_detection
  * pattern backtest: an internal id answers as unknown
  * the member catalog (_PATTERN_METADATA and /api/patterns/catalog)
"""
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.patterns as patterns_router
from api.services.pattern_engine import memory
from api.services.pattern_engine.detectors import registry
from tests.authclients import ADMIN, PAID_MEMBER, signed_in_as

_UCT = ("uct_kicker", "uct_oops_reversal", "uct_slingshot", "uct_hve")
_CONTROL = "bull_flag"
_PROBE = "zz_internal_gate_probe"
_SYM = "GATEX"


def _det(det_id, pattern_id, sym=_SYM, category="uct", confidence=90.0):
    now = int(time.time()) - 60
    return {
        "id": det_id, "sym": sym, "tf": "D",
        "pattern_id": pattern_id, "pattern_name": pattern_id,
        "category": category, "direction": "bullish",
        "start_t": now - 86400, "end_t": now, "pivot_ts": [],
        "geometry": {"shape": "candle_mark", "anchors": [], "extras": {}},
        "levels": {"entry": 100.0, "entry_condition": "", "stop": 95.0, "stop_basis": "",
                   "target_primary": 110.0, "target_secondary": 115.0, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
                    "volume_signature": "neutral", "regime": "unknown",
                    "nearest_resistance": None, "nearest_support": None,
                    "days_to_earnings": None, "sector_strength_rank": None},
        "confidence": confidence,
        "quality_components": {"geometry_score": 90.0, "volume_score": 90.0,
                               "context_score": 90.0, "historical_score": 50.0},
        "narrative": {"headline": "h", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "triggered", "outcome": None,
        "detected_at": now, "last_seen_at": now,
    }


@pytest.fixture
def gate_on(monkeypatch):
    """Arm the gate with a synthetic internal detector, registered like a real one."""
    import api.routers.patterns  # noqa: F401  (registers every real detector first)
    monkeypatch.setitem(registry._REGISTRY, _PROBE, lambda bars, ctx: [])
    monkeypatch.setattr(registry, "INTERNAL_PATTERN_IDS", frozenset({_PROBE}))
    yield


@pytest.fixture
def seeded(monkeypatch, tmp_path, gate_on):
    monkeypatch.setenv("PATTERN_DB_PATH", str(tmp_path / "patterns.db"))
    from api.services.pattern_engine import pattern_db
    pattern_db._initialized_paths.clear()
    pattern_db.init_db()
    # Descending confidences give the canonical shadow (one winner per symbol)
    # a deterministic answer: the probe would win if it were not gated.
    memory.store_detection(_det("probe-1", _PROBE, category="classical", confidence=99.0))
    for k, pid in enumerate(_UCT):
        memory.store_detection(_det(f"uct-{k}", pid, confidence=95.0 - k))
    memory.store_detection(_det("ctl-1", _CONTROL, category="classical", confidence=80.0))
    yield
    pattern_db._initialized_paths.clear()


def _pids(rows, key="pattern_id"):
    return {r[key] for r in rows}


_MEMBER_VIEW = {*_UCT, _CONTROL}           # what a member must see
_ADMIN_VIEW = {*_UCT, _CONTROL, _PROBE}    # what an admin's raw read sees


# ── the registry: owner ruling recorded, gate machinery intact ────────────

def test_the_shipped_internal_set_is_empty_and_the_four_are_public():
    import api.routers.patterns  # noqa: F401
    assert registry.INTERNAL_PATTERN_IDS == frozenset(), (
        "owner ruling 2026-10-15: no detector is internal today")
    assert set(_UCT) <= set(registry.list_public_pattern_ids())
    assert not any(registry.is_internal(p) for p in _UCT)


def test_the_gate_helpers_drop_a_synthetic_internal_id(gate_on):
    assert registry.is_internal(_PROBE)
    assert _PROBE in registry.list_pattern_ids(), "the probe is computed like any detector"
    assert _PROBE not in registry.list_public_pattern_ids()
    assert set(_UCT) <= set(registry.list_public_pattern_ids())
    rows = [{"pattern_id": p} for p in (*_UCT, _CONTROL, _PROBE)]
    assert _pids(registry.drop_internal(rows)) == _MEMBER_VIEW


def test_the_universe_scan_runs_the_four():
    """`detect_all` (what the background scan stores) fires each of the four."""
    from api.services.pattern_engine import detect_all
    from api.services.pattern_engine.primitives.context import build_context
    from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures
    import api.routers.patterns  # noqa: F401
    fired = set()
    for pid in _UCT:
        f = next(f for f in load_all_fixtures(pid) if f.category == "positive")
        out = detect_all(f.bars, build_context(f.bars, sym="T"), pattern_ids=[pid])
        fired |= _pids(out)
    assert fired == set(_UCT)


# ── the member catalog ────────────────────────────────────────────────────

def test_the_four_are_in_the_member_catalog():
    for pid in _UCT:
        meta = patterns_router._PATTERN_METADATA.get(pid)
        assert meta, f"{pid} missing from _PATTERN_METADATA"
        assert meta["category"] == "uct"
        assert meta["direction"] in ("bullish", "bearish", "neutral")
        assert meta["name"] and len(meta["description"]) >= 60
    app = FastAPI()
    app.include_router(patterns_router.router)
    with signed_in_as(PAID_MEMBER, app=app):
        body = TestClient(app).get("/api/patterns/catalog").json()["patterns"]
    assert set(_UCT) <= set(body)
    assert body["uct_kicker"]["name"] == "UCT Kicker"


# ── memory ────────────────────────────────────────────────────────────────

def test_memory_drops_the_probe_by_default_and_serves_the_four(seeded):
    assert _pids(memory.get_active_detections(_SYM, "D")) == _MEMBER_VIEW
    assert _pids(memory.get_active_detections(_SYM, "D", include_internal=True)) == _ADMIN_VIEW
    # asking for an internal id by name does not open the door
    assert memory.get_active_detections(_SYM, "D", pattern_ids=[_PROBE]) == []
    assert _pids(memory.get_active_detections(_SYM, "D", pattern_ids=["uct_kicker"])) == {"uct_kicker"}


def test_memory_with_the_shipped_empty_set_serves_everything(monkeypatch, tmp_path):
    """The real configuration: an EMPTY set must not break the SQL (`NOT IN ()`)."""
    monkeypatch.setenv("PATTERN_DB_PATH", str(tmp_path / "patterns.db"))
    from api.services.pattern_engine import pattern_db
    pattern_db._initialized_paths.clear()
    pattern_db.init_db()
    for k, pid in enumerate(_UCT):
        memory.store_detection(_det(f"uct-{k}", pid))
    assert registry.INTERNAL_PATTERN_IDS == frozenset()
    assert _pids(memory.get_active_detections(_SYM, "D")) == set(_UCT)
    pattern_db._initialized_paths.clear()


# ── screener ──────────────────────────────────────────────────────────────

def test_screener_pattern_fields_carry_the_four_not_the_probe(seeded):
    from api.services.screener import pattern_join as pj
    out = pj.read_pattern_fields([_SYM])
    ids = {k for k in (out[_SYM]["pattern_engine_ids"] or "").split(",") if k}
    assert _CONTROL in ids, "non-vacuous: the public control must be read"
    assert set(_UCT) <= ids
    assert _PROBE not in ids


def test_screener_canonical_shadow_skips_the_probe(seeded):
    from api.services.screener import pattern_join as pj
    out = pj.read_pattern_fields_canonical_shadow([_SYM])
    picked = out[_SYM]["pattern_id"]
    assert picked != _PROBE
    assert picked in _MEMBER_VIEW


# ── the raw /api/patterns/{sym} branch (the chart overlay's read) ─────────

def _raw(user):
    app = FastAPI()
    app.include_router(patterns_router.router)
    with signed_in_as(user, app=app):
        r = TestClient(app).get(f"/api/patterns/{_SYM}?tf=D&confirmed_only=false&min_conf=0")
    assert r.status_code == 200
    return _pids(r.json()["detections"])


def test_raw_detections_for_a_paid_member_show_the_four_not_the_probe(seeded):
    assert _raw(PAID_MEMBER) == _MEMBER_VIEW


def test_raw_detections_for_an_admin_include_the_probe(seeded):
    assert _raw(ADMIN) == _ADMIN_VIEW


# ── voice / Compass ───────────────────────────────────────────────────────

def test_voice_find_and_scan_show_the_four_not_the_probe(seeded):
    from api.services.voice_tool_impls import _find_patterns_on_ticker, _scan_active_patterns
    found = _find_patterns_on_ticker(symbol=_SYM, tf="D", min_conf=0)
    assert _pids(found["detections"]) == _MEMBER_VIEW
    scan = _scan_active_patterns(tf="D", min_conf=50, limit=50)
    assert _pids(scan["detections"]) == _MEMBER_VIEW
    named = _scan_active_patterns(types=f"{_PROBE},uct_kicker", tf="D", min_conf=50)
    assert _pids(named["detections"]) == {"uct_kicker"}


def test_voice_list_pattern_types_lists_the_four_not_the_probe(gate_on):
    from api.services.voice_tool_impls import _list_pattern_types
    ids = {p["id"] for p in _list_pattern_types()["patterns"]}
    assert _CONTROL in ids and set(_UCT) <= ids
    assert _PROBE not in ids


def test_compass_chat_tools_show_the_four_not_the_probe(seeded):
    from api.services.journal_two.coach_chat_tools import TOOLS
    args = dict(user_id="u1", account_id="a1", conn=None)
    found = TOOLS["find_patterns_on_ticker"]["executor"](args={"symbol": _SYM, "min_conf": 0}, **args)
    assert _pids(found["detections"]) == _MEMBER_VIEW
    scan = TOOLS["scan_active_patterns"]["executor"](args={"min_conf": 50, "limit": 50}, **args)
    assert _pids(scan["detections"]) == _MEMBER_VIEW
    types = TOOLS["list_pattern_types"]["executor"](args={}, **args)
    ids = {p["id"] for p in types["patterns"]}
    assert _CONTROL in ids and set(_UCT) <= ids
    assert _PROBE not in ids


def test_voice_deep_data_pattern_tool_shows_the_four_not_the_probe(seeded):
    from api.services.voice_deep_data_tools import get_pattern_detection
    out = get_pattern_detection(symbol=_SYM, timeframe="D", min_confidence=0, count=10)
    assert {p["pattern_id"] for p in out["patterns"]} == _MEMBER_VIEW
    assert _PROBE not in str(out)


def test_backtest_treats_an_internal_id_as_unknown(gate_on):
    from api.services.pattern_backtest import backtest_pattern_on_ticker
    out = backtest_pattern_on_ticker("AAPL", _PROBE)
    assert out == {"error": f"pattern_id '{_PROBE}' not found"}
