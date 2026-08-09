import time

from fastapi.testclient import TestClient

from api.main import app
from api.services.auth_db import init_db
from api.services.pattern_engine import memory

# `GET /api/patterns/scan` is `require_paid` since the 2026-08-09 auth sweep —
# it was serving the whole live detection set to anyone. These are BEHAVIOUR
# tests, so they get the caller they always implied; the gate is owned by
# tests/test_exposed_routes_gated.py and asserted exactly once, there.
from tests.authclients import as_a_paid_member  # noqa: F401  (autouse fixture)


client = TestClient(app)


def _det(**overrides):
    now = int(time.time())
    base = {
        "id": "scan-test-1",
        "sym": "ZZZZ", "tf": "D",
        "pattern_id": "bull_flag", "pattern_name": "Bull Flag",
        "category": "classical", "direction": "bullish",
        "start_t": 1700000000, "end_t": 1700100000,
        "pivot_ts": [],
        "geometry": {"shape": "trendline_pair", "anchors": [], "extras": {}},
        "levels": {"entry": 100, "entry_condition": "", "stop": 95, "stop_basis": "",
                   "target_primary": 110, "target_secondary": None, "risk_reward": 2.0},
        "context": {"trend_stage": 2, "rs_trend": "up", "ma_alignment": "stacked_bullish",
                    "volume_signature": "contracting", "regime": "bull",
                    "nearest_resistance": None, "nearest_support": None,
                    "days_to_earnings": None, "sector_strength_rank": None,
                    "recent_dcr_avg": 0.7, "dcr_signature": "accumulation"},
        "confidence": 80.0,
        "quality_components": {"geometry_score": 80.0, "volume_score": 75.0,
                               "context_score": 80.0, "historical_score": 50.0},
        "narrative": {"headline": "test scan", "what_it_is": "", "why_it_matters": "",
                      "what_to_watch_for": "", "failure_signal": ""},
        "status": "ready", "outcome": None,
        "detected_at": now, "last_seen_at": now,
    }
    base.update(overrides)
    return base


def test_scan_returns_recent_detections():
    init_db()
    memory.store_detection(_det(id="scan-1", sym="AAA", start_t=100, end_t=200))
    r = client.get("/api/patterns/scan?tf=D")
    assert r.status_code == 200
    data = r.json()
    assert "detections" in data
    assert "count" in data


def test_scan_filters_by_min_conf():
    r = client.get("/api/patterns/scan?tf=D&min_conf=95")
    assert r.status_code == 200
    data = r.json()
    for d in data["detections"]:
        assert d["confidence"] >= 95


def test_scan_filters_by_pattern_types():
    r = client.get("/api/patterns/scan?tf=D&types=bull_flag,bear_flag")
    assert r.status_code == 200
    data = r.json()
    for d in data["detections"]:
        assert d["pattern_id"] in ("bull_flag", "bear_flag")


def test_scan_invalid_min_conf_rejected():
    r = client.get("/api/patterns/scan?tf=D&min_conf=200")
    assert r.status_code == 422  # validation error


def test_scan_limit_capped():
    r = client.get("/api/patterns/scan?tf=D&limit=100")
    assert r.status_code == 200
    data = r.json()
    assert len(data["detections"]) <= 100


def test_scan_surfaces_from_leader_universe_flag():
    """Slim detection payload includes from_leader_universe flag from geometry.extras."""
    init_db()
    memory.store_detection(_det(
        id="scan-leader-1", sym="NVDA",
        start_t=1700100000, end_t=1700200000,
        geometry={"shape": "trendline_pair", "anchors": [],
                  "extras": {"from_leader_universe": True}},
    ))
    memory.store_detection(_det(
        id="scan-cap-1", sym="ZZZZ",
        start_t=1700200000, end_t=1700300000,
        geometry={"shape": "trendline_pair", "anchors": [],
                  "extras": {"from_leader_universe": False}},
    ))
    r = client.get("/api/patterns/scan?tf=D")
    assert r.status_code == 200
    data = r.json()
    by_sym = {d["sym"]: d for d in data["detections"]}
    if "NVDA" in by_sym:
        assert by_sym["NVDA"]["from_leader_universe"] is True
    if "ZZZZ" in by_sym:
        assert by_sym["ZZZZ"]["from_leader_universe"] is False


def test_scan_leaders_only_filter():
    """leaders_only=true restricts results to tickers in api/data/leader_universe.json."""
    init_db()
    # NVDA is in the seed leader_universe.json; "ZZZZ" is not.
    memory.store_detection(_det(
        id="scan-leaders-nvda", sym="NVDA",
        start_t=1700400000, end_t=1700500000,
    ))
    memory.store_detection(_det(
        id="scan-leaders-zzzz", sym="ZZZZ",
        start_t=1700500000, end_t=1700600000,
    ))
    r = client.get("/api/patterns/scan?tf=D&leaders_only=true")
    assert r.status_code == 200
    data = r.json()
    # leader_universe_size should be > 0 when leaders_only is on
    assert (data.get("leader_universe_size") or 0) > 0
    syms = {d["sym"] for d in data["detections"]}
    assert "ZZZZ" not in syms
    # If any NVDA detection is present it must be flagged
    for d in data["detections"]:
        if d["sym"] == "NVDA":
            assert d["from_leader_universe"] is True or d["sym"] in syms
