"""Tests for Compass Overview aggregator."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
from datetime import datetime, timezone, timedelta
import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    # Isolate the celebrations once-per gate (calendar_seen) to the same temp DB
    # so get_overview's celebration fold never touches a real /data volume.
    from api.services import calendar_seen
    monkeypatch.setattr(calendar_seen, "_DB_PATH", tmp.name)
    monkeypatch.setattr(calendar_seen, "_INIT_DONE", False)
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_account(db_conn, user_id="u_ov"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def test_overview_returns_expected_shape_for_fresh_account(db_conn):
    from api.services.journal_two import overview as ov
    acc = _seed_account(db_conn)
    result = ov.get_overview(user_id="u_ov", account_id=acc["id"], conn=db_conn)
    expected_keys = {
        "profile_excerpt", "onboarded", "this_weeks_focus", "week_to_date",
        "today", "regime", "active_interventions_count",
        "pending_profile_suggestions_count", "recent_trade_reviews",
        "celebrations",
    }
    assert expected_keys.issubset(set(result.keys()))
    assert result["onboarded"] is False
    assert result["profile_excerpt"] == ""
    assert result["this_weeks_focus"] is None
    assert result["recent_trade_reviews"] == []
    assert result["active_interventions_count"] == 0
    # Fresh account has no goals / streaks / trades → no celebrations.
    assert result["celebrations"] == []


def test_overview_extracts_this_weeks_focus_from_weekly_review(db_conn):
    from api.services.journal_two import overview as ov
    acc = _seed_account(db_conn)
    db_conn.execute(
        """INSERT INTO j2_coach_outputs (id, user_id, account_id, output_type,
           body, summary, metadata, forgotten, created_at)
           VALUES (?, 'u_ov', ?, 'weekly_review', 'body', 'summary', ?, 0, ?)""",
        (str(uuid.uuid4()), acc["id"],
         json.dumps({"this_weeks_focus": "Skip Pullbacks this week."}),
         datetime.now(timezone.utc).isoformat()),
    )
    db_conn.commit()
    result = ov.get_overview(user_id="u_ov", account_id=acc["id"], conn=db_conn)
    assert result["this_weeks_focus"] == "Skip Pullbacks this week."


def test_overview_truncates_long_trader_profile(db_conn):
    from api.services.journal_two import overview as ov
    acc = _seed_account(db_conn)
    long_profile = "A" * 500
    db_conn.execute(
        "UPDATE j2_accounts SET trader_profile = ? WHERE id = ?",
        (long_profile, acc["id"]),
    )
    db_conn.commit()
    result = ov.get_overview(user_id="u_ov", account_id=acc["id"], conn=db_conn)
    assert len(result["profile_excerpt"]) <= 260   # 250 + "…"
    assert result["profile_excerpt"].endswith("…")


def test_overview_returns_3_most_recent_trade_reviews(db_conn):
    from api.services.journal_two import overview as ov
    acc = _seed_account(db_conn)
    # Insert 4 trades + reviews; expect only the 3 most recent
    for i, sym in enumerate(["NVDA", "AAPL", "TSLA", "AMD"]):
        tid = str(uuid.uuid4())
        db_conn.execute(
            """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
               entry_price, entry_date, exit_price, exit_date, original_stop, setup,
               notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
               context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees)
               VALUES (?, 'u_ov', ?, ?, 'Long', 100, 200, ?, 205, ?, 198, 'Bull Flag',
               NULL, 500, 2.5, 2.0, 0, 'Win', '{}', ?, ?, '[]', '[]', 0)""",
            (tid, str(uuid.uuid4()), sym,
             f"2026-05-1{i}T18:00:00+00:00", f"2026-05-1{i}T20:00:00+00:00",
             f"2026-05-1{i}T20:00:00+00:00", acc["id"]),
        )
        db_conn.execute(
            """INSERT INTO j2_trade_reviews (id, user_id, account_id, trade_id,
               body, summary, metadata, feedback, forgotten, created_at)
               VALUES (?, 'u_ov', ?, ?, ?, ?, '{}', NULL, 0, ?)""",
            (str(uuid.uuid4()), acc["id"], tid,
             f"{sym} review body", f"{sym} short summary",
             f"2026-05-1{i}T21:00:00+00:00"),
        )
    db_conn.commit()
    result = ov.get_overview(user_id="u_ov", account_id=acc["id"], conn=db_conn)
    assert len(result["recent_trade_reviews"]) == 3
    # Newest first — AMD was inserted last
    assert result["recent_trade_reviews"][0]["symbol"] == "AMD"


def test_overview_includes_today_block(db_conn):
    from api.services.journal_two import overview as ov
    acc = _seed_account(db_conn)
    result = ov.get_overview(user_id="u_ov", account_id=acc["id"], conn=db_conn)
    assert "date" in result["today"]
    assert "trade_count" in result["today"]
    assert "has_eod_recap" in result["today"]
    assert "eod_recap_eta_utc" in result["today"]


def test_overview_celebrations_env_kill_switch_skips_detect(db_conn, monkeypatch):
    """J2_CELEBRATIONS_ENABLED=0 → celebrations:[] AND the detection block
    (goal/nudges/discipline/interventions + detect) never runs — the server-side
    kill for the ~60s-polled 524 hot path, independent of the FE `celebrate` flag."""
    from api.services.journal_two import overview as ov
    from api.services.journal_two import celebrations as celebrations_service
    acc = _seed_account(db_conn)

    called = {"n": 0}

    def _tracked_detect(*a, **k):
        called["n"] += 1
        return []

    monkeypatch.setattr(celebrations_service, "detect", _tracked_detect)
    monkeypatch.setenv("J2_CELEBRATIONS_ENABLED", "0")

    result = ov.get_overview(user_id="u_ov", account_id=acc["id"], conn=db_conn)
    assert result["celebrations"] == []
    assert called["n"] == 0   # detection block entirely bypassed


def test_overview_celebrations_run_when_env_default_on(db_conn, monkeypatch):
    """Default (flag unset) → the detection block runs and passes a BOUNDED nudges
    read (limit) so celebration detection can't trigger the unbounded scan."""
    from api.services.journal_two import overview as ov
    from api.services.journal_two import nudges as nudges_service
    acc = _seed_account(db_conn)

    seen_limits = []
    real_get_nudges = nudges_service.get_nudges_state

    def _spy(user_id, account_id, **kwargs):
        seen_limits.append(kwargs.get("limit"))
        return real_get_nudges(user_id, account_id, **kwargs)

    monkeypatch.setattr(nudges_service, "get_nudges_state", _spy)
    monkeypatch.delenv("J2_CELEBRATIONS_ENABLED", raising=False)

    result = ov.get_overview(user_id="u_ov", account_id=acc["id"], conn=db_conn)
    assert result["celebrations"] == []          # fresh account → nothing earned
    assert seen_limits == [60]                    # bounded, not the unbounded scan
