"""close_position (write Trade + update Position) — the critical write path."""

import json
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)

    import importlib
    from api.services import auth_db
    importlib.reload(auth_db)

    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_yss(conn, user_id, *, raise_to_be=False, breakeven_stop=None):
    """Seed the §14.7 YSS Long position. Optionally raised-to-breakeven."""
    pid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    ctx = json.dumps(
        {
            "navCount": 0,
            "rallyDay": None,
            "powerTrend": None,
            "breadthValue": None,
            "breadthMetricName": "NASI RSI",
            "indexName": "NYA",
            "igRank": None,
            "rsRating": None,
        }
    )
    conn.execute(
        """
        INSERT INTO j2_positions (
            id, user_id, symbol, side, entry_date, shares, original_shares,
            entry_price, stop_price, breakeven_stop, raise_to_breakeven,
            setup, notes, context_at_entry, created_at, updated_at, closed_at
        ) VALUES (?, ?, 'YSS', 'Long', ?, 250, 250, 29.57, 27.90, ?, ?, 'VCP', NULL, ?, ?, ?, NULL)
        """,
        (
            pid,
            user_id,
            "2026-04-09T00:00:00Z",
            breakeven_stop,
            1 if raise_to_be else 0,
            ctx,
            now,
            now,
        ),
    )
    conn.commit()
    return pid


SETTINGS_BE_20 = {
    "breakevenRange": {"enabled": True, "unit": "$", "value": 20},
}


# ── §14.7 YSS partial close — full round-trip ────────────────────────────────


def test_partial_close_writes_trade_with_yss_reference_values(db_conn):
    from api.services.journal_two import trades as svc

    pid = _seed_yss(db_conn, "u1")
    result = svc.close_position(
        user_id="u1",
        position_id=pid,
        payload={
            "shares": 100,
            "exitPrice": 34.50,
            "exitDate": "2026-04-10T00:00:00Z",
            "notes": "scale out",
        },
        settings=SETTINGS_BE_20,
        conn=db_conn,
    )
    trade = result["trade"]
    position = result["position"]

    # §14.7 expected values
    assert trade["pnlDollar"] == pytest.approx(493.0, abs=1e-9)
    assert trade["pnlPercent"] * 100 == pytest.approx(16.6723, abs=1e-3)
    assert trade["rMultiple"] == pytest.approx(2.9521, abs=1e-3)
    assert trade["holdDays"] == 1
    assert trade["result"] == "Win"
    assert trade["originalStop"] == 27.90

    # Position decremented but not archived
    assert position["shares"] == 150.0
    assert position["closedAt"] is None


def test_full_close_archives_position(db_conn):
    from api.services.journal_two import trades as svc

    pid = _seed_yss(db_conn, "u1")
    result = svc.close_position(
        user_id="u1",
        position_id=pid,
        payload={
            "shares": 250,
            "exitPrice": 34.50,
            "exitDate": "2026-04-10T00:00:00Z",
        },
        settings=SETTINGS_BE_20,
        conn=db_conn,
    )
    assert result["position"]["shares"] == 0.0
    assert result["position"]["closedAt"] is not None


# ── CRITICAL: originalStop invariant ─────────────────────────────────────────


def test_original_stop_uses_position_stopPrice_even_with_raise_to_breakeven_on(db_conn):
    """The key §10 / §18 invariant: R-multiples use the ORIGINAL stop.
    Even if the user has raised to BE, the Trade's originalStop is the
    position's stopPrice, not breakevenStop."""
    from api.services.journal_two import trades as svc

    # YSS with stop raised to entry (breakevenStop = entry)
    pid = _seed_yss(db_conn, "u1", raise_to_be=True, breakeven_stop=29.57)

    result = svc.close_position(
        user_id="u1",
        position_id=pid,
        payload={
            "shares": 100,
            "exitPrice": 34.50,
            "exitDate": "2026-04-10T00:00:00Z",
        },
        settings=SETTINGS_BE_20,
        conn=db_conn,
    )
    # originalStop MUST still be 27.90 (the original), not 29.57 (the BE stop).
    assert result["trade"]["originalStop"] == 27.90
    # And the R-multiple uses the original risk:
    # (34.50 − 29.57) / (29.57 − 27.90) = 4.93 / 1.67 = 2.9521
    assert result["trade"]["rMultiple"] == pytest.approx(2.9521, abs=1e-3)


# ── contextAtEntry passthrough ───────────────────────────────────────────────


def test_context_at_entry_copied_from_position_not_recomputed(db_conn):
    from api.services.journal_two import trades as svc

    pid = _seed_yss(db_conn, "u1")
    result = svc.close_position(
        user_id="u1",
        position_id=pid,
        payload={
            "shares": 100,
            "exitPrice": 34.50,
            "exitDate": "2026-04-10T00:00:00Z",
        },
        settings=SETTINGS_BE_20,
        conn=db_conn,
    )
    # Position's contextAtEntry is the one we seeded, verbatim
    assert result["trade"]["contextAtEntry"]["indexName"] == "NYA"
    assert result["trade"]["contextAtEntry"]["breadthMetricName"] == "NASI RSI"


# ── Validation rejections ────────────────────────────────────────────────────


def test_reject_close_larger_than_remaining(db_conn):
    from api.services.journal_two import trades as svc
    from api.services.journal_two.trades import CloseValidationError

    pid = _seed_yss(db_conn, "u1")
    with pytest.raises(CloseValidationError):
        svc.close_position(
            user_id="u1",
            position_id=pid,
            payload={
                "shares": 300,  # position has 250
                "exitPrice": 34.50,
                "exitDate": "2026-04-10T00:00:00Z",
            },
            settings=SETTINGS_BE_20,
            conn=db_conn,
        )


def test_reject_exit_before_entry(db_conn):
    from api.services.journal_two import trades as svc
    from api.services.journal_two.trades import CloseValidationError

    pid = _seed_yss(db_conn, "u1")
    with pytest.raises(CloseValidationError):
        svc.close_position(
            user_id="u1",
            position_id=pid,
            payload={
                "shares": 100,
                "exitPrice": 34.50,
                "exitDate": "2026-04-08T00:00:00Z",  # before 04-09
            },
            settings=SETTINGS_BE_20,
            conn=db_conn,
        )


def test_reject_zero_or_negative_shares(db_conn):
    from api.services.journal_two import trades as svc
    from api.services.journal_two.trades import CloseValidationError

    pid = _seed_yss(db_conn, "u1")
    with pytest.raises(CloseValidationError):
        svc.close_position(
            user_id="u1",
            position_id=pid,
            payload={"shares": 0, "exitPrice": 34.50, "exitDate": "2026-04-10"},
            settings=SETTINGS_BE_20,
            conn=db_conn,
        )
    with pytest.raises(CloseValidationError):
        svc.close_position(
            user_id="u1",
            position_id=pid,
            payload={"shares": -10, "exitPrice": 34.50, "exitDate": "2026-04-10"},
            settings=SETTINGS_BE_20,
            conn=db_conn,
        )


def test_reject_zero_exit_price(db_conn):
    from api.services.journal_two import trades as svc
    from api.services.journal_two.trades import CloseValidationError

    pid = _seed_yss(db_conn, "u1")
    with pytest.raises(CloseValidationError):
        svc.close_position(
            user_id="u1",
            position_id=pid,
            payload={"shares": 100, "exitPrice": 0, "exitDate": "2026-04-10"},
            settings=SETTINGS_BE_20,
            conn=db_conn,
        )


def test_reject_close_of_already_closed_position(db_conn):
    from api.services.journal_two import trades as svc
    from api.services.journal_two.trades import CloseValidationError

    pid = _seed_yss(db_conn, "u1")
    svc.close_position(
        user_id="u1",
        position_id=pid,
        payload={"shares": 250, "exitPrice": 34.50, "exitDate": "2026-04-10"},
        settings=SETTINGS_BE_20,
        conn=db_conn,
    )
    with pytest.raises(CloseValidationError):
        svc.close_position(
            user_id="u1",
            position_id=pid,
            payload={"shares": 1, "exitPrice": 34.50, "exitDate": "2026-04-10"},
            settings=SETTINGS_BE_20,
            conn=db_conn,
        )


def test_reject_close_of_other_users_position(db_conn):
    from api.services.journal_two import trades as svc

    pid = _seed_yss(db_conn, "u1")
    with pytest.raises(LookupError):
        svc.close_position(
            user_id="u2",  # not the owner
            position_id=pid,
            payload={"shares": 100, "exitPrice": 34.50, "exitDate": "2026-04-10"},
            settings=SETTINGS_BE_20,
            conn=db_conn,
        )


# ── Result classification uses settings at close time ────────────────────────


def test_close_with_be_range_disabled_classifies_as_win(db_conn):
    from api.services.journal_two import trades as svc

    pid = _seed_yss(db_conn, "u1")
    settings = {"breakevenRange": {"enabled": False, "unit": "$", "value": 0}}
    result = svc.close_position(
        user_id="u1",
        position_id=pid,
        payload={"shares": 100, "exitPrice": 34.50, "exitDate": "2026-04-10"},
        settings=settings,
        conn=db_conn,
    )
    assert result["trade"]["result"] == "Win"


def test_close_within_be_range_classifies_as_be(db_conn):
    from api.services.journal_two import trades as svc

    pid = _seed_yss(db_conn, "u1")
    # Exit 29.60 → P&L $3 on 100 shares → within $20 BE range
    settings = {"breakevenRange": {"enabled": True, "unit": "$", "value": 20}}
    result = svc.close_position(
        user_id="u1",
        position_id=pid,
        payload={"shares": 100, "exitPrice": 29.60, "exitDate": "2026-04-10"},
        settings=settings,
        conn=db_conn,
    )
    assert result["trade"]["result"] == "BE"


# ── list_trades_for_user ─────────────────────────────────────────────────────


def test_list_trades_after_close(db_conn):
    from api.services.journal_two import trades as svc

    pid = _seed_yss(db_conn, "u1")
    svc.close_position(
        user_id="u1",
        position_id=pid,
        payload={"shares": 100, "exitPrice": 34.50, "exitDate": "2026-04-10"},
        settings=SETTINGS_BE_20,
        conn=db_conn,
    )
    trades = svc.list_trades_for_user("u1", conn=db_conn)
    assert len(trades) == 1
    assert trades[0]["symbol"] == "YSS"
    assert trades[0]["result"] == "Win"


def test_list_trades_user_isolation(db_conn):
    from api.services.journal_two import trades as svc

    pid_a = _seed_yss(db_conn, "user-A")
    pid_b = _seed_yss(db_conn, "user-B")
    svc.close_position(
        user_id="user-A", position_id=pid_a,
        payload={"shares": 100, "exitPrice": 34.50, "exitDate": "2026-04-10"},
        settings=SETTINGS_BE_20, conn=db_conn,
    )
    svc.close_position(
        user_id="user-B", position_id=pid_b,
        payload={"shares": 50, "exitPrice": 34.50, "exitDate": "2026-04-10"},
        settings=SETTINGS_BE_20, conn=db_conn,
    )
    a_trades = svc.list_trades_for_user("user-A", conn=db_conn)
    b_trades = svc.list_trades_for_user("user-B", conn=db_conn)
    assert len(a_trades) == 1
    assert len(b_trades) == 1
    assert a_trades[0]["shares"] == 100.0
    assert b_trades[0]["shares"] == 50.0


# ═══ Phase 5: Manual Add Trade ═══════════════════════════════════════════════

SETTINGS_STD = {
    "breakevenRange": {"enabled": True, "unit": "$", "value": 20},
}


def _valid_manual_payload(**overrides):
    """YSS §14.7 partial-close shape, as a manual Add Trade."""
    payload = {
        "symbol": "yss",
        "side": "Long",
        "shares": 100,
        "entryPrice": 29.57,
        "entryDate": "2026-04-09",
        "exitPrice": 34.50,
        "exitDate": "2026-04-10",
        "originalStop": 27.90,
        "setup": "VCP",
        "notes": "manual backfill",
    }
    payload.update(overrides)
    return payload


def test_manual_add_trade_computes_yss_derived_values(db_conn):
    from api.services.journal_two import trades as svc

    t = svc.create_trade_manual("u1", _valid_manual_payload(), SETTINGS_STD, conn=db_conn)
    assert t["symbol"] == "YSS"
    assert t["pnlDollar"] == pytest.approx(493.0, abs=1e-9)
    assert t["rMultiple"] == pytest.approx(2.9521, abs=1e-3)
    assert t["holdDays"] == 1
    assert t["result"] == "Win"


def test_manual_add_trade_positionId_uses_manual_sentinel(db_conn):
    """A1: positionId must start with 'manual-' for trades with no parent Position."""
    from api.services.journal_two import trades as svc

    t = svc.create_trade_manual("u1", _valid_manual_payload(), SETTINGS_STD, conn=db_conn)
    assert t["positionId"].startswith("manual-")
    # Should never collide with a real UUID position id
    assert len(t["positionId"]) > len("manual-") + 30


def test_manual_add_trade_context_is_empty_dict(db_conn):
    """No verdict → manual trades store an empty context dict."""
    from api.services.journal_two import trades as svc

    t = svc.create_trade_manual("u1", _valid_manual_payload(), SETTINGS_STD, conn=db_conn)
    assert t["contextAtEntry"] == {}


def test_manual_add_trade_persists_verdict_attachment(db_conn):
    """Verdict→trade loop: payload.contextAtEntry (Compass verdict id + label)
    is persisted verbatim so the attachment survives on the resulting trade."""
    from api.services.journal_two import trades as svc

    payload = _valid_manual_payload()
    payload["contextAtEntry"] = {
        "compass_verdict_id": "v-123",
        "compass_verdict_label": "GO",
    }
    t = svc.create_trade_manual("u1", payload, SETTINGS_STD, conn=db_conn)
    assert t["contextAtEntry"] == {
        "compass_verdict_id": "v-123",
        "compass_verdict_label": "GO",
    }


def test_manual_add_trade_context_dict_guarded_against_non_dict(db_conn):
    """A malformed contextAtEntry (non-dict) falls back to an empty dict."""
    from api.services.journal_two import trades as svc

    payload = _valid_manual_payload()
    payload["contextAtEntry"] = "not-a-dict"
    t = svc.create_trade_manual("u1", payload, SETTINGS_STD, conn=db_conn)
    assert t["contextAtEntry"] == {}


def test_manual_add_trade_blank_original_stop_defaults_to_entry_price(db_conn):
    """§14.5 edge case #3: entry == originalStop → rMultiple null."""
    from api.services.journal_two import trades as svc

    payload = _valid_manual_payload()
    payload["originalStop"] = None
    t = svc.create_trade_manual("u1", payload, SETTINGS_STD, conn=db_conn)
    assert t["originalStop"] == 29.57  # defaulted to entryPrice
    assert t["rMultiple"] is None


def test_manual_add_trade_rejects_wrong_side_stop_long(db_conn):
    from api.services.journal_two import trades as svc
    from api.services.journal_two.trades import ManualTradeValidationError

    payload = _valid_manual_payload(side="Long", originalStop=35)  # above entry 29.57
    with pytest.raises(ManualTradeValidationError):
        svc.create_trade_manual("u1", payload, SETTINGS_STD, conn=db_conn)


def test_manual_add_trade_rejects_wrong_side_stop_short(db_conn):
    from api.services.journal_two import trades as svc
    from api.services.journal_two.trades import ManualTradeValidationError

    payload = _valid_manual_payload(side="Short", originalStop=25)  # below entry 29.57
    with pytest.raises(ManualTradeValidationError):
        svc.create_trade_manual("u1", payload, SETTINGS_STD, conn=db_conn)


def test_manual_add_trade_rejects_exit_before_entry(db_conn):
    from api.services.journal_two import trades as svc
    from api.services.journal_two.trades import ManualTradeValidationError

    payload = _valid_manual_payload(entryDate="2026-04-10", exitDate="2026-04-09")
    with pytest.raises(ManualTradeValidationError):
        svc.create_trade_manual("u1", payload, SETTINGS_STD, conn=db_conn)


def test_manual_add_trade_rejects_zero_shares(db_conn):
    from api.services.journal_two import trades as svc
    from api.services.journal_two.trades import ManualTradeValidationError

    payload = _valid_manual_payload(shares=0)
    with pytest.raises(ManualTradeValidationError):
        svc.create_trade_manual("u1", payload, SETTINGS_STD, conn=db_conn)


def test_manual_add_trade_short_side(db_conn):
    """Short with valid stop above entry; result classified correctly."""
    from api.services.journal_two import trades as svc

    payload = _valid_manual_payload(
        side="Short",
        entryPrice=29.57,
        exitPrice=23.61,
        originalStop=31.24,
    )
    t = svc.create_trade_manual("u1", payload, SETTINGS_STD, conn=db_conn)
    # P&L = (29.57 - 23.61) * 100 = $596
    assert t["pnlDollar"] == pytest.approx(596.0, abs=1e-9)
    assert t["result"] == "Win"
    # R = 5.96 / 1.67 = 3.5689
    assert t["rMultiple"] == pytest.approx(5.96 / 1.67, abs=1e-3)


# ═══ Phase 5: delete_trade + delete_all_trades ═══════════════════════════════


def test_delete_trade_user_isolation(db_conn):
    from api.services.journal_two import trades as svc

    t = svc.create_trade_manual("u1", _valid_manual_payload(), SETTINGS_STD, conn=db_conn)
    # Wrong user can't delete
    assert svc.delete_trade("u2", t["id"], conn=db_conn) is False
    # Right user can
    assert svc.delete_trade("u1", t["id"], conn=db_conn) is True
    # Gone now
    assert svc.delete_trade("u1", t["id"], conn=db_conn) is False


def test_delete_all_trades_only_affects_requesting_user(db_conn):
    from api.services.journal_two import trades as svc

    svc.create_trade_manual("user-A", _valid_manual_payload(), SETTINGS_STD, conn=db_conn)
    svc.create_trade_manual("user-A", _valid_manual_payload(symbol="AAPL"), SETTINGS_STD, conn=db_conn)
    svc.create_trade_manual("user-B", _valid_manual_payload(symbol="MSFT"), SETTINGS_STD, conn=db_conn)

    count = svc.delete_all_trades("user-A", conn=db_conn)
    assert count == 2
    assert svc.list_trades_for_user("user-A", conn=db_conn) == []
    # user-B untouched
    b_trades = svc.list_trades_for_user("user-B", conn=db_conn)
    assert len(b_trades) == 1
    assert b_trades[0]["symbol"] == "MSFT"


def test_delete_all_trades_empty_returns_zero(db_conn):
    from api.services.journal_two import trades as svc

    assert svc.delete_all_trades("u1", conn=db_conn) == 0


# ═══ Phase E: mistake_tags + emotion_tags round-trip ═════════════════════════


def test_close_position_with_tags_survives_round_trip(db_conn):
    """Tags passed at close time should be persisted and returned by list_trades."""
    from api.services.journal_two import trades as svc

    pid = _seed_yss(db_conn, "u1")
    result = svc.close_position(
        user_id="u1",
        position_id=pid,
        payload={
            "shares": 100,
            "exitPrice": 34.50,
            "exitDate": "2026-04-10T00:00:00Z",
            "mistakeTags": ["fomo"],
            "emotionTags": ["euphoric"],
        },
        settings=SETTINGS_BE_20,
        conn=db_conn,
    )
    # Inline return shape exposes tags immediately
    trade = result["trade"]
    assert trade["mistakeTags"] == ["fomo"]
    assert trade["emotionTags"] == ["euphoric"]

    # Re-read from DB via list_trades_for_user — tags must survive the round-trip
    trades = svc.list_trades_for_user("u1", conn=db_conn)
    assert len(trades) == 1
    assert trades[0]["mistakeTags"] == ["fomo"]
    assert trades[0]["emotionTags"] == ["euphoric"]
