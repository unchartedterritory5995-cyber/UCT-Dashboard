"""Tests for api/services/awareness/engine.py -- the scan cycle orchestrator."""
from __future__ import annotations

import gc
import importlib
import os
import tempfile
import uuid
from datetime import date
from unittest import mock

import pytest


@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("DATA_DIR", os.path.dirname(tmp.name) or ".")

    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()

    from api.services.awareness import regime_snapshots
    importlib.reload(regime_snapshots)
    regime_snapshots.init_schema()

    from api.services.awareness import engine as eng
    importlib.reload(eng)

    yield tmp.name
    # Windows adaptation: regime_snapshots._conn()'s `with` block only
    # commits/rolls back -- it never explicitly closes the connection, so
    # the underlying file handle is released on GC, not on scope-exit. This
    # is a no-op on POSIX (unlink-while-open is legal there) but on Windows
    # a still-open handle makes os.unlink race a PermissionError. gc.collect()
    # forces the close before cleanup; this changes no test assertions.
    gc.collect()
    try:
        os.unlink(tmp.name)
    except PermissionError:
        pass


def _seed_user(user_id: str, email: str) -> None:
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, display_name, role) "
            "VALUES (?, ?, 'x', 'x', 'member')",
            (user_id, email),
        )
        conn.commit()
    finally:
        conn.close()


def _seed_position(user_id, symbol, side, entry, stop, source=None):
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO j2_positions
               (id, user_id, symbol, side, entry_date, shares, original_shares,
                entry_price, stop_price, context_at_entry, created_at,
                updated_at, source)
               VALUES (?, ?, ?, ?, '2026-01-01', 100, 100, ?, ?, '{}',
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?)""",
            (str(uuid.uuid4()), user_id, symbol, side, entry, stop, source),
        )
        conn.commit()
    finally:
        conn.close()


def _seed_watchlist(user_id, symbols):
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        wl_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO watchlists (id, user_id, name) VALUES (?, ?, 'My List')",
            (wl_id, user_id),
        )
        for sym in symbols:
            conn.execute(
                "INSERT INTO watchlist_items (id, watchlist_id, sym) VALUES (?, ?, ?)",
                (str(uuid.uuid4()), wl_id, sym),
            )
        conn.commit()
    finally:
        conn.close()


# ── _enabled ─────────────────────────────────────────────────────────────────

def test_enabled_gate(monkeypatch):
    from api.services.awareness import engine as eng
    monkeypatch.delenv("AWARENESS_ENGINE_ENABLED", raising=False)
    assert eng._enabled() is False
    monkeypatch.setenv("AWARENESS_ENGINE_ENABLED", "1")
    assert eng._enabled() is True


# ── _bulk_load_user_contexts ─────────────────────────────────────────────────

def test_bulk_load_user_contexts_groups_positions_and_watchlists(db_path):
    from api.services.awareness import engine as eng
    _seed_user("u1", "u1@x.com")
    _seed_user("u2", "u2@x.com")
    _seed_position("u1", "NVDA", "Long", 100.0, 90.0)
    _seed_watchlist("u2", ["AAPL", "MSFT"])

    ctxs = eng._bulk_load_user_contexts()

    assert ctxs["u1"]["positions"] == [
        {"symbol": "NVDA", "side": "Long", "entry_price": 100.0,
         "stop_price": 90.0, "source": None},
    ]
    assert ctxs["u1"]["watch_syms"] == set()
    assert ctxs["u2"]["positions"] == []
    assert ctxs["u2"]["watch_syms"] == {"AAPL", "MSFT"}


# ── _collect_earnings_window ─────────────────────────────────────────────────

def test_collect_earnings_window_returns_earliest_date_per_symbol(monkeypatch):
    from api.services.awareness import engine as eng

    def fake_reporters(d_str):
        return {"2026-07-02": {"AAPL"}, "2026-07-03": {"AAPL", "MSFT"}}[d_str]

    monkeypatch.setattr(
        "api.services.calendar_alerts._get_reporters_for_date", fake_reporters,
    )
    out = eng._collect_earnings_window(date(2026, 7, 2), 1)
    assert out == {"AAPL": "2026-07-02", "MSFT": "2026-07-03"}


# ── _build_market_scan_ctx ───────────────────────────────────────────────────

def test_build_market_scan_ctx_reads_cached_prices_and_regime(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    from api.routers.live_prices import cache as px_cache, _px_key

    px_cache.set(_px_key("NVDA"), {"price": 123.45}, ttl=60)

    monkeypatch.setattr(
        "api.services.voice_regime_classifier.get_current_regime",
        lambda: {"regime": "bull_trend", "confidence": 0.8},
    )
    monkeypatch.setattr(eng, "_collect_earnings_window",
                         lambda today, days: {"AAPL": "2026-07-03"})

    user_ctxs = {"u1": {"positions": [{"symbol": "NVDA", "side": "Long",
                                        "entry_price": 100.0, "stop_price": 90.0,
                                        "source": None}],
                         "watch_syms": set()}}

    ctx = eng._build_market_scan_ctx(user_ctxs)

    assert ctx["live_prices"]["NVDA"] == 123.45
    assert ctx["regime"]["label"] == "bull_trend"
    assert ctx["regime"]["confidence"] == 0.8
    assert ctx["earnings_by_symbol"] == {"AAPL": "2026-07-03"}

    # A second call sees the FIRST call's label as prev_label (durable ledger).
    ctx2 = eng._build_market_scan_ctx(user_ctxs)
    assert ctx2["regime"]["prev_label"] == "bull_trend"


# ── _fire_candidate ───────────────────────────────────────────────────────────

def test_fire_candidate_delivers_when_importance_high(db_path):
    from api.services.awareness import engine as eng
    from api.services.awareness.rules import InsightCandidate
    _seed_user("u3", "u3@x.com")

    candidate = InsightCandidate(
        kind="stop_hit", symbol="NVDA", headline="NVDA is AT its stop",
        body="body", base_signal=1.0, personal_multiplier=1.3, urgency=2.0,
        dedup_key="NVDA",
    )
    with mock.patch(
        "api.services.watchlist_alert_service.deliver_alert_payload"
    ) as deliver:
        fired = eng._fire_candidate("u3", candidate)

    assert fired is True
    deliver.assert_called_once()
    assert deliver.call_args.kwargs["user_id"] == "u3"
    assert deliver.call_args.kwargs["sym"] == "NVDA"


def test_fire_candidate_no_delivery_below_importance_floor(db_path):
    from api.services.awareness import engine as eng
    from api.services.awareness.rules import InsightCandidate
    _seed_user("u4", "u4@x.com")

    # 0.4*1.0*1.0*10 = 4 -> importance 4, below the delivery floor (8)
    candidate = InsightCandidate(
        kind="earnings_proximity", symbol="AAPL", headline="AAPL reports soon",
        body="body", base_signal=0.4, personal_multiplier=1.0, urgency=1.0,
        dedup_key="AAPL:earnings",
    )
    with mock.patch(
        "api.services.watchlist_alert_service.deliver_alert_payload"
    ) as deliver:
        fired = eng._fire_candidate("u4", candidate)

    assert fired is True
    deliver.assert_not_called()


def test_fire_candidate_stop_hit_not_suppressed_by_prior_proximity_warning(db_path):
    """A 'nearing stop' warning must NOT start the cooldown that swallows the
    subsequent THROUGH-the-stop escalation -- the two stop kinds carry distinct
    dedup namespaces (SYM:stop_near vs SYM:stop_hit)."""
    from api.services.awareness import engine as eng
    from api.services.awareness.rules import InsightCandidate
    _seed_user("u7", "u7@x.com")

    proximity = InsightCandidate(
        kind="stop_proximity", symbol="NVDA", headline="NVDA is nearing its stop",
        body="body", base_signal=0.6, personal_multiplier=1.2, urgency=1.3,
        dedup_key="NVDA:stop_near",
    )
    stop_hit = InsightCandidate(
        kind="stop_hit", symbol="NVDA", headline="NVDA is AT or THROUGH its stop",
        body="body", base_signal=1.0, personal_multiplier=1.3, urgency=2.0,
        dedup_key="NVDA:stop_hit",
    )
    with mock.patch("api.services.watchlist_alert_service.deliver_alert_payload"):
        first = eng._fire_candidate("u7", proximity)
        second = eng._fire_candidate("u7", stop_hit)  # escalation must land

    assert first is True
    assert second is True


def test_fire_candidate_suppressed_by_cooldown_returns_false(db_path):
    from api.services.awareness import engine as eng
    from api.services.awareness.rules import InsightCandidate
    _seed_user("u5", "u5@x.com")

    candidate = InsightCandidate(
        kind="stop_hit", symbol="TSLA", headline="TSLA is AT its stop",
        body="body", base_signal=1.0, personal_multiplier=1.0, urgency=1.0,
        dedup_key="TSLA",
    )
    with mock.patch("api.services.watchlist_alert_service.deliver_alert_payload"):
        first = eng._fire_candidate("u5", candidate)
        second = eng._fire_candidate("u5", candidate)  # same symbol -> 6h cooldown

    assert first is True
    assert second is False


# ── run_awareness_scan (end to end) ──────────────────────────────────────────

def test_run_awareness_scan_noop_when_disabled(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    monkeypatch.setenv("AWARENESS_ENGINE_ENABLED", "0")
    assert eng.run_awareness_scan() == {"enabled": False, "scanned_users": 0, "fired": 0}


def test_run_awareness_scan_end_to_end_fires_stop_hit(db_path, monkeypatch):
    from api.services.awareness import engine as eng
    monkeypatch.setenv("AWARENESS_ENGINE_ENABLED", "1")
    _seed_user("u6", "u6@x.com")
    _seed_position("u6", "NVDA", "Long", 100.0, 90.0)

    monkeypatch.setattr(
        eng, "_build_market_scan_ctx",
        lambda user_ctxs: {
            "live_prices": {"NVDA": 88.0},  # below stop -> R1 fires
            "regime": {"label": None, "confidence": None, "prev_label": None},
            "earnings_by_symbol": {},
            "today": date(2026, 7, 2),
        },
    )

    with mock.patch("api.services.watchlist_alert_service.deliver_alert_payload"):
        result = eng.run_awareness_scan()

    assert result["enabled"] is True
    assert result["scanned_users"] == 1
    assert result["fired"] == 1
