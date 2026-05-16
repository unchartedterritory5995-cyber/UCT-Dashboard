"""P5-O — Compass weekly email digest tests."""

import importlib
import os
import sqlite3
import tempfile
from datetime import date
from unittest.mock import patch

import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_user_and_account(conn, *, user_id="u_dig", email="trader@example.com",
                           display_name="Pat"):
    conn.execute(
        """INSERT INTO users (id, email, display_name, password_hash, role, created_at)
           VALUES (?, ?, ?, 'x', 'user', '2026-01-01T00:00:00Z')""",
        (user_id, email, display_name),
    )
    conn.commit()
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=conn)


# ── previous_week_monday_iso ─────────────────────────────────────────────────

def test_previous_week_monday_from_sunday():
    from api.services.journal_two import coach_email_digest as ed
    # Sunday 2026-05-10 → previous Monday is 2026-05-04
    assert ed.previous_week_monday_iso(date(2026, 5, 10)) == "2026-05-04"


def test_previous_week_monday_from_monday():
    """On Monday we still want last week's Monday (the week that JUST ended)."""
    from api.services.journal_two import coach_email_digest as ed
    # Monday 2026-05-11 → last week's Monday is 2026-05-04
    assert ed.previous_week_monday_iso(date(2026, 5, 11)) == "2026-05-04"


def test_previous_week_monday_from_friday():
    from api.services.journal_two import coach_email_digest as ed
    # Friday 2026-05-08 → that same week's Monday is 2026-05-04
    assert ed.previous_week_monday_iso(date(2026, 5, 8)) == "2026-05-04"


# ── HTML composition ─────────────────────────────────────────────────────────

def test_compose_digest_html_includes_stats_and_focus():
    from api.services.journal_two import coach_email_digest as ed
    html = ed.compose_digest_html(
        display_name="Pat",
        account_name="Default",
        week_start="2026-05-04",
        review_body="## Wins\n\n- Held trail on AAPL\n\n## Losses\n\nFOMO entry on TSLA.",
        this_weeks_focus="Cut size to 1% until the cooling-off window clears.",
        stats={"trade_count": 12, "win_rate": 58.3, "avg_r": 1.4,
               "post_mortems": 3, "interventions": 1},
    )
    assert "Your Week with Compass" in html
    assert "Pat" in html
    assert "12" in html             # trade count
    assert "58.3%" in html          # win rate
    assert "+1.40R" in html         # avg R
    assert "Cut size to 1%" in html  # focus pullout
    assert "Held trail on AAPL" in html  # body bullet
    assert "Open Compass" in html   # CTA


def test_md_to_html_escapes_html_and_renders_bullets():
    from api.services.journal_two.coach_email_digest import _md_to_html
    out = _md_to_html("**Watch out** for `<script>` injection\n\n- a\n- b")
    assert "<strong>Watch out</strong>" in out
    assert "&lt;script&gt;" in out
    assert "<ul" in out and "<li" in out
    # Raw <script> tag should NOT make it through
    assert "<script>" not in out


# ── send_digest_for_account ──────────────────────────────────────────────────

def test_send_digest_skips_when_no_user_email(db_conn):
    from api.services.journal_two import coach_email_digest as ed
    # Account exists but user_id points to nobody
    from api.services.journal_two import accounts as accounts_service
    accounts_service.get_or_migrate_default_account("u_missing", conn=db_conn)
    acct_id = db_conn.execute(
        "SELECT id FROM j2_accounts WHERE user_id = ? LIMIT 1", ("u_missing",),
    ).fetchone()["id"]

    result = ed.send_digest_for_account(
        user_id="u_missing", account_id=acct_id,
        week_start="2026-05-04", conn=db_conn,
    )
    assert result["sent"] is False
    assert result["reason"] == "no_user_email"


def test_send_digest_idempotent_on_same_week(db_conn):
    from api.services.journal_two import coach_email_digest as ed
    acct = _seed_user_and_account(db_conn)

    fake_review = {"body": "# Week\n\nBody.", "metadata": {"this_weeks_focus": "Focus."}}
    with patch("api.services.journal_two.coach.generate_weekly_review",
               return_value=fake_review), \
         patch("api.services.email_service.send_email",
               return_value=True) as send_mock:
        first = ed.send_digest_for_account(
            user_id="u_dig", account_id=acct["id"],
            week_start="2026-05-04", conn=db_conn,
        )
        second = ed.send_digest_for_account(
            user_id="u_dig", account_id=acct["id"],
            week_start="2026-05-04", conn=db_conn,
        )

    assert first["sent"] is True
    assert second["sent"] is False
    assert second["reason"] == "already_sent"
    # send_email should only have been called once total
    assert send_mock.call_count == 1


def test_send_digest_skips_dead_week(db_conn):
    from api.services.journal_two import coach_email_digest as ed
    acct = _seed_user_and_account(db_conn)

    fake_review = {"body": "", "metadata": {}}
    with patch("api.services.journal_two.coach.generate_weekly_review",
               return_value=fake_review), \
         patch("api.services.email_service.send_email",
               return_value=True) as send_mock:
        result = ed.send_digest_for_account(
            user_id="u_dig", account_id=acct["id"],
            week_start="2026-05-04", conn=db_conn,
        )
    assert result["sent"] is False
    assert result["reason"] == "no_activity"
    assert send_mock.call_count == 0


def test_send_digest_force_bypasses_idempotency(db_conn):
    from api.services.journal_two import coach_email_digest as ed
    acct = _seed_user_and_account(db_conn)

    fake_review = {"body": "# Body", "metadata": {"this_weeks_focus": "F."}}
    with patch("api.services.journal_two.coach.generate_weekly_review",
               return_value=fake_review), \
         patch("api.services.email_service.send_email",
               return_value=True) as send_mock:
        ed.send_digest_for_account(
            user_id="u_dig", account_id=acct["id"],
            week_start="2026-05-04", conn=db_conn,
        )
        forced = ed.send_digest_for_account(
            user_id="u_dig", account_id=acct["id"],
            week_start="2026-05-04", conn=db_conn, force=True,
        )
    assert forced["sent"] is True
    assert send_mock.call_count == 2


# ── Unified ('_all_') weekly digest ──────────────────────────────────────────


def test_send_digest_for_all_sentinel_labels_all_accounts(db_conn):
    from api.services.journal_two import coach_email_digest as ed
    _seed_user_and_account(db_conn)  # creates user + a default account
    captured = {}

    def _capture(to, subject, html):
        captured["html"] = html
        captured["subject"] = subject
        return True

    fake_review = {"body": "# Portfolio week\n\nBody.", "metadata": {}}
    with patch("api.services.journal_two.coach.generate_weekly_review",
               return_value=fake_review), \
         patch("api.services.email_service.send_email", side_effect=_capture):
        result = ed.send_digest_for_account(
            user_id="u_dig", account_id="_all_",
            week_start="2026-05-04", conn=db_conn,
        )
    assert result["sent"] is True
    assert "All Accounts" in captured["html"]


def test_run_unified_skips_when_unified_compass_disabled(db_conn):
    from api.services.journal_two import coach_email_digest as ed
    from api.services.journal_two import unified_coach
    _seed_user_and_account(db_conn)
    unified_coach.get_or_create(db_conn, "u_dig")
    unified_coach.update_state(db_conn, "u_dig", compass_enabled=False)

    with patch("api.services.journal_two.coach.generate_weekly_review",
               return_value={"body": "x", "metadata": {}}), \
         patch("api.services.email_service.send_email",
               return_value=True) as send_mock:
        report = ed.run_unified_for_all_users()
    assert report["sent"] == 0
    assert send_mock.call_count == 0


def test_run_unified_sends_one_per_enabled_user(db_conn):
    from api.services.journal_two import coach_email_digest as ed
    _seed_user_and_account(db_conn)

    fake_review = {"body": "# Wk\n\nBody.", "metadata": {}}
    with patch("api.services.journal_two.coach.generate_weekly_review",
               return_value=fake_review), \
         patch("api.services.email_service.send_email",
               return_value=True) as send_mock:
        report = ed.run_unified_for_all_users()
    assert report["sent"] == 1
    assert send_mock.call_count == 1
