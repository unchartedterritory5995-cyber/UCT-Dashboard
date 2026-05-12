"""Polish P9 — deep data tools: bars, patterns, trade detail, alerts, breadth."""

import uuid
import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_deep_data_tools as dd


def _user():
    init_db()
    return create_user(f"ddt_{uuid.uuid4()}@x.com", "p")["id"]


# ── 1. get_bar_summary ─────────────────────────────────────────────────────

def test_bar_summary_rejects_empty_symbol():
    out = dd.get_bar_summary(symbol="")
    assert out["ok"] is False
    assert "ticker" in out["narration"].lower() or "symbol" in out["narration"].lower()


def test_bar_summary_handles_no_cached_data(monkeypatch):
    """Cache miss → graceful empty narration, ok=False."""
    monkeypatch.setattr(dd, "_norm_tf", lambda *a, **k: "D")

    class _BS:
        @staticmethod
        def get_bars(_t, _tf, _n):
            return []

    monkeypatch.setattr(
        "api.services.bars_sqlite.get_bars",
        lambda *a, **k: [],
    )
    out = dd.get_bar_summary(symbol="XYZNOTREAL", timeframe="D", lookback=20)
    assert out["ok"] is False
    assert "no cached bars" in out["narration"].lower()


def test_bar_summary_computes_stats(monkeypatch):
    """Provide synthetic bars; verify the stats math."""
    # 5 bars: (ts, o, h, l, c, v)
    bars = [
        (1, 100.0, 105.0,  95.0, 102.0, 1000),
        (2, 102.0, 108.0, 100.0, 106.0, 1500),
        (3, 106.0, 110.0, 103.0, 108.0, 2000),
        (4, 108.0, 112.0, 106.0, 110.0, 2500),
        (5, 110.0, 115.0, 108.0, 113.0, 3000),
    ]
    monkeypatch.setattr(
        "api.services.bars_sqlite.get_bars",
        lambda *a, **k: bars,
    )
    out = dd.get_bar_summary(symbol="TEST", timeframe="D", lookback=5)
    assert out["ok"] is True
    assert out["symbol"] == "TEST"
    assert out["timeframe"] == "D"
    assert out["last_close"] == 113.0
    assert out["prev_close"] == 110.0
    assert abs(out["change_pct"] - 2.73) < 0.05  # (113-110)/110*100
    assert out["window_high"] == 115.0
    assert out["window_low"] == 95.0
    assert out["bar_count"] == 5
    assert out["above_sma_20"] is True  # 113 > avg


# ── 2. get_pattern_detection ───────────────────────────────────────────────

def test_pattern_detection_rejects_empty_symbol():
    out = dd.get_pattern_detection(symbol="")
    assert out["ok"] is False


def test_pattern_detection_empty_results(monkeypatch):
    monkeypatch.setattr(
        "api.services.pattern_engine.memory.get_active_detections",
        lambda *a, **k: [],
    )
    out = dd.get_pattern_detection(
        symbol="NVDA", timeframe="D", min_confidence=50,
    )
    assert out["ok"] is True
    assert out["pattern_count"] == 0
    assert "no active patterns" in out["narration"].lower()


def test_pattern_detection_returns_top(monkeypatch):
    sample = [
        {"pattern_id": "bull_flag", "direction": "bullish",
         "confidence": 78.0, "status": "active", "detected_at": 1234},
        {"pattern_id": "vcp", "direction": "bullish",
         "confidence": 65.0, "status": "active", "detected_at": 1200},
    ]
    monkeypatch.setattr(
        "api.services.pattern_engine.memory.get_active_detections",
        lambda *a, **k: sample,
    )
    out = dd.get_pattern_detection(symbol="NVDA", count=5)
    assert out["ok"] is True
    assert out["pattern_count"] == 2
    assert out["patterns"][0]["pattern_id"] == "bull_flag"
    assert "78" in out["narration"]


# ── 3. get_trade_detail ────────────────────────────────────────────────────

def test_trade_detail_requires_user():
    out = dd.get_trade_detail(symbol="NVDA")
    assert out["ok"] is False
    assert out["error"] == "no_user"


def test_trade_detail_not_found(monkeypatch):
    uid = _user()
    monkeypatch.setattr(
        "api.services.journal_two.trades.list_trades_for_user",
        lambda *a, **k: [],
    )
    out = dd.get_trade_detail(
        symbol="ZZZ", user={"id": uid},
    )
    assert out["ok"] is False
    assert out["error"] == "trade_not_found"


def test_trade_detail_by_symbol(monkeypatch):
    uid = _user()
    sample = [{
        "id": "t1", "user_id": uid, "symbol": "NVDA", "side": "long",
        "shares": 100, "entry_price": 200.0, "exit_price": 220.0,
        "entry_date": "2026-05-01", "exit_date": "2026-05-08",
        "original_stop": 195.0, "setup": "bull_flag", "notes": "",
        "pnl_dollar": 2000.0, "pnl_percent": 10.0, "r_multiple": 2.5,
        "hold_days": 7, "result": "win", "context_at_entry": "",
        "account_id": "acc1", "fees": 1.0,
        "created_at": "2026-05-01", "mistake_tags": [],
        "emotion_tags": ["confident"],
    }]
    monkeypatch.setattr(
        "api.services.journal_two.trades.list_trades_for_user",
        lambda *a, **k: sample,
    )
    out = dd.get_trade_detail(symbol="NVDA", user={"id": uid})
    assert out["ok"] is True
    assert out["symbol"] == "NVDA"
    assert out["pnl_dollar"] == 2000.0
    assert out["r_multiple"] == 2.5
    assert "NVDA" in out["narration"]


def test_trade_detail_by_id(monkeypatch):
    uid = _user()
    sample = [
        {"id": "a", "symbol": "TSLA", "side": "long", "shares": 50,
         "entry_price": 100.0, "exit_price": None, "pnl_dollar": None,
         "pnl_percent": None, "r_multiple": None, "hold_days": None,
         "setup": None, "result": None, "mistake_tags": [],
         "emotion_tags": [], "entry_date": None, "exit_date": None,
         "original_stop": None, "notes": "", "account_id": "acc1"},
        {"id": "b", "symbol": "NVDA", "side": "long", "shares": 100,
         "entry_price": 200.0, "exit_price": 220.0, "pnl_dollar": 2000.0,
         "pnl_percent": 10.0, "r_multiple": 2.5, "hold_days": 7,
         "setup": "bull_flag", "result": "win", "mistake_tags": [],
         "emotion_tags": [], "entry_date": None, "exit_date": None,
         "original_stop": None, "notes": "", "account_id": "acc1"},
    ]
    monkeypatch.setattr(
        "api.services.journal_two.trades.list_trades_for_user",
        lambda *a, **k: sample,
    )
    out = dd.get_trade_detail(trade_id="b", user={"id": uid})
    assert out["ok"] is True
    assert out["symbol"] == "NVDA"


# ── 4. get_recent_alerts ───────────────────────────────────────────────────

def test_recent_alerts_empty(monkeypatch):
    monkeypatch.setattr(
        "api.services.alerts.get_alerts",
        lambda **k: [],
    )
    out = dd.get_recent_alerts(count=5)
    assert out["ok"] is True
    assert out["alerts"] == []


def test_recent_alerts_filtered_by_severity(monkeypatch):
    sample = [
        {"id": "1", "type": "regime", "severity": "warning",
         "title": "Regime flip", "message": "Phase changed",
         "timestamp": "2026-05-08T10:00:00", "read": False},
        {"id": "2", "type": "scanner", "severity": "info",
         "title": "Scanner hit",  "message": "",
         "timestamp": "2026-05-08T09:00:00", "read": False},
    ]
    monkeypatch.setattr(
        "api.services.alerts.get_alerts",
        lambda **k: sample,
    )
    out = dd.get_recent_alerts(count=5, severity="warning")
    assert out["ok"] is True
    assert out["alert_count"] == 1
    assert out["alerts"][0]["severity"] == "warning"


# ── 5. get_breadth_history ─────────────────────────────────────────────────

def test_breadth_history_unknown_metric(monkeypatch):
    monkeypatch.setattr(
        "api.services.breadth_monitor.get_history",
        lambda days=30: [{"date": "2026-05-08", "breadth_score": 65}],
    )
    out = dd.get_breadth_history(metric="not_a_real_metric", days=30)
    assert out["ok"] is False
    assert out["error"] == "unknown_metric"
    assert "available_metrics_sample" in out


def test_breadth_history_known_metric(monkeypatch):
    rows = [
        {"date": "2026-05-08", "breadth_score": 65},
        {"date": "2026-05-07", "breadth_score": 60},
        {"date": "2026-05-06", "breadth_score": 55},
    ]
    monkeypatch.setattr(
        "api.services.breadth_monitor.get_history",
        lambda days=30: rows,
    )
    out = dd.get_breadth_history(metric="breadth_score", days=30)
    assert out["ok"] is True
    assert out["metric"] == "breadth_score"
    assert out["count"] == 3
    assert out["latest_value"] == 65
    assert out["oldest_value"] == 55
    assert out["delta"] == 10.0


def test_breadth_history_alias_resolution(monkeypatch):
    """'breadth' alias should resolve to breadth_score."""
    rows = [{"date": "2026-05-08", "breadth_score": 80}]
    monkeypatch.setattr(
        "api.services.breadth_monitor.get_history",
        lambda days=30: rows,
    )
    out = dd.get_breadth_history(metric="breadth", days=30)
    assert out["ok"] is True
    assert out["metric"] == "breadth_score"


# ── 6. Registration smoke test ─────────────────────────────────────────────

def test_p9_tools_are_registered():
    """All 5 new tools should be in the voice_tools registry."""
    # Import side-effect registers tools
    import api.services.voice_tool_impls  # noqa: F401
    from api.services.voice_tools import _REGISTRY
    for name in (
        "get_bar_summary",
        "get_pattern_detection",
        "get_trade_detail",
        "get_recent_alerts",
        "get_breadth_history",
    ):
        assert name in _REGISTRY, f"missing voice tool: {name}"


def test_p9_tools_in_analyst_allowlist():
    from api.services.voice_agents import get_agent
    analyst = get_agent("analyst")
    assert analyst is not None
    for name in ("get_bar_summary", "get_pattern_detection",
                 "get_breadth_history", "get_recent_alerts"):
        assert name in analyst["tool_allowlist"], name


def test_p9_tools_in_scout_allowlist():
    from api.services.voice_agents import get_agent
    scout = get_agent("scout")
    assert scout is not None
    assert "get_pattern_detection" in scout["tool_allowlist"]
    assert "get_bar_summary" in scout["tool_allowlist"]


def test_p9_trade_detail_in_coach_allowlist():
    from api.services.voice_agents import get_agent
    coach = get_agent("coach")
    assert coach is not None
    assert "get_trade_detail" in coach["tool_allowlist"]
