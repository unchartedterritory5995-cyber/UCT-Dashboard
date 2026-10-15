"""The four INTERNAL trader-setup detectors never reach a member.

`registry.INTERNAL_PATTERN_IDS` = uct_kicker · uct_oops_reversal · uct_slingshot
· uct_hve. Their detections are computed and stored (admins read them); every
member-facing read path must drop them. Each test below seeds an internal
detection beside a public CONTROL detection on the same symbol, so a read that
returns nothing at all cannot pass for a read that filtered correctly.

Read paths covered:
  * screener: pattern_join.read_pattern_fields + read_pattern_fields_canonical_shadow
  * GET /api/patterns/{sym}?confirmed_only=false — dropped for a paid member,
    present for an admin
  * memory.get_active_detections — excluded by default, opt-in only
  * voice: _find_patterns_on_ticker, _scan_active_patterns, _list_pattern_types
  * Compass chat: find_patterns_on_ticker, scan_active_patterns, list_pattern_types
  * voice deep-data: get_pattern_detection
  * pattern backtest: an internal id answers as unknown
  * the member catalog (/api/patterns/catalog) never lists them
"""
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.patterns as patterns_router
from api.services.pattern_engine import memory
from api.services.pattern_engine.detectors.registry import (
    INTERNAL_PATTERN_IDS, drop_internal, is_internal, list_pattern_ids,
    list_public_pattern_ids,
)
from tests.authclients import ADMIN, PAID_MEMBER, signed_in_as

_IDS = ("uct_kicker", "uct_oops_reversal", "uct_slingshot", "uct_hve")
_CONTROL = "bull_flag"
_SYM = "GATEX"


def _det(det_id, pattern_id, sym=_SYM, category="uct"):
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
        "confidence": 90.0,
        "quality_components": {"geometry_score": 90.0, "volume_score": 90.0,
                               "context_score": 90.0, "historical_score": 50.0},
        "narrative": {"headline": "h", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "triggered", "outcome": None,
        "detected_at": now, "last_seen_at": now,
    }


@pytest.fixture
def seeded(monkeypatch, tmp_path):
    monkeypatch.setenv("PATTERN_DB_PATH", str(tmp_path / "patterns.db"))
    from api.services.pattern_engine import pattern_db
    pattern_db._initialized_paths.clear()
    pattern_db.init_db()
    for k, pid in enumerate(_IDS):
        memory.store_detection(_det(f"int-{k}", pid))
    memory.store_detection(_det("ctl-1", _CONTROL, category="classical"))
    yield
    pattern_db._initialized_paths.clear()


def _pids(rows, key="pattern_id"):
    return {r[key] for r in rows}


# ── the registry is the one authority ──────────────────────────────────────

def test_the_internal_set_is_exactly_the_four_and_all_are_registered():
    assert INTERNAL_PATTERN_IDS == frozenset(_IDS)
    assert set(_IDS) <= set(list_pattern_ids()), "detectors must still be computed"
    assert not set(_IDS) & set(list_public_pattern_ids())
    assert _CONTROL in list_public_pattern_ids()
    assert all(is_internal(p) for p in _IDS) and not is_internal(_CONTROL)
    assert _pids(drop_internal([{"pattern_id": p} for p in (*_IDS, _CONTROL)])) == {_CONTROL}


def test_the_universe_scan_still_runs_them():
    """`detect_all` (what the background scan stores) is NOT filtered."""
    from api.services.pattern_engine import detect_all
    from api.services.pattern_engine.primitives.context import build_context
    from tests.pattern_engine.detectors.fixture_loader import load_all_fixtures
    fired = set()
    for pid in _IDS:
        f = next(f for f in load_all_fixtures(pid) if f.category == "positive")
        out = detect_all(f.bars, build_context(f.bars, sym="T"), pattern_ids=[pid])
        fired |= _pids(out)
    assert fired == set(_IDS)


def test_not_in_the_member_catalog():
    assert not set(_IDS) & set(patterns_router._PATTERN_METADATA)
    app = FastAPI()
    app.include_router(patterns_router.router)
    with signed_in_as(PAID_MEMBER, app=app):
        body = TestClient(app).get("/api/patterns/catalog").json()["patterns"]
    assert body and not set(_IDS) & set(body)


# ── memory ────────────────────────────────────────────────────────────────

def test_memory_excludes_by_default_and_includes_only_on_request(seeded):
    assert _pids(memory.get_active_detections(_SYM, "D")) == {_CONTROL}
    assert _pids(memory.get_active_detections(_SYM, "D", include_internal=True)) == {*_IDS, _CONTROL}
    # asking for an internal id by name does not open the door
    assert memory.get_active_detections(_SYM, "D", pattern_ids=["uct_kicker"]) == []


# ── screener ──────────────────────────────────────────────────────────────

def test_screener_pattern_fields_never_carry_an_internal_id(seeded):
    from api.services.screener import pattern_join as pj
    out = pj.read_pattern_fields([_SYM])
    ids = {k for k in (out[_SYM]["pattern_engine_ids"] or "").split(",") if k}
    assert _CONTROL in ids, "non-vacuous: the public control must be read"
    assert not ids & set(_IDS)


def test_screener_canonical_shadow_never_picks_an_internal_id(seeded):
    from api.services.screener import pattern_join as pj
    out = pj.read_pattern_fields_canonical_shadow([_SYM])
    assert out[_SYM]["pattern_id"] == _CONTROL


# ── the raw /api/patterns/{sym} branch ────────────────────────────────────

def _raw(user):
    app = FastAPI()
    app.include_router(patterns_router.router)
    with signed_in_as(user, app=app):
        r = TestClient(app).get(f"/api/patterns/{_SYM}?tf=D&confirmed_only=false&min_conf=0")
    assert r.status_code == 200
    return _pids(r.json()["detections"])


def test_raw_detections_drop_internal_ids_for_a_paid_member(seeded):
    assert _raw(PAID_MEMBER) == {_CONTROL}


def test_raw_detections_include_internal_ids_for_an_admin(seeded):
    assert _raw(ADMIN) == {*_IDS, _CONTROL}


# ── voice / Compass ───────────────────────────────────────────────────────

def test_voice_find_and_scan_exclude_internal(seeded):
    from api.services.voice_tool_impls import _find_patterns_on_ticker, _scan_active_patterns
    found = _find_patterns_on_ticker(symbol=_SYM, tf="D", min_conf=0)
    assert _pids(found["detections"]) == {_CONTROL}
    scan = _scan_active_patterns(tf="D", min_conf=50, limit=50)
    assert _pids(scan["detections"]) == {_CONTROL}
    named = _scan_active_patterns(types="uct_kicker,uct_hve", tf="D", min_conf=50)
    assert named["count"] == 0


def test_voice_list_pattern_types_excludes_internal():
    from api.services.voice_tool_impls import _list_pattern_types
    ids = {p["id"] for p in _list_pattern_types()["patterns"]}
    assert _CONTROL in ids and not ids & set(_IDS)


def test_compass_chat_tools_exclude_internal(seeded):
    from api.services.journal_two.coach_chat_tools import TOOLS
    args = dict(user_id="u1", account_id="a1", conn=None)
    found = TOOLS["find_patterns_on_ticker"]["executor"](args={"symbol": _SYM, "min_conf": 0}, **args)
    assert _pids(found["detections"]) == {_CONTROL}
    scan = TOOLS["scan_active_patterns"]["executor"](args={"min_conf": 50, "limit": 50}, **args)
    assert _pids(scan["detections"]) == {_CONTROL}
    types = TOOLS["list_pattern_types"]["executor"](args={}, **args)
    ids = {p["id"] for p in types["patterns"]}
    assert _CONTROL in ids and not ids & set(_IDS)


def test_voice_deep_data_pattern_tool_excludes_internal(seeded):
    from api.services import voice_deep_data_tools as vdd
    fn = next(getattr(vdd, n) for n in dir(vdd)
              if n.endswith("pattern_detection") and callable(getattr(vdd, n)))
    out = fn(symbol=_SYM, timeframe="D", min_confidence=0)
    names = str(out)
    assert "bull" in names.lower(), "non-vacuous: the control must be narrated"
    assert not any(p in names for p in _IDS)


def test_backtest_treats_an_internal_id_as_unknown():
    from api.services.pattern_backtest import backtest_pattern_on_ticker
    out = backtest_pattern_on_ticker("AAPL", "uct_kicker")
    assert out == {"error": "pattern_id 'uct_kicker' not found"}
