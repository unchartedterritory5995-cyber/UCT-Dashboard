"""Stage A member-validation report (decision-log "Stage A→B gate" entry,
2026-09-06; refined by the "activate the real beta cohort" checkpoint, also
2026-09-06). Proves the report computes real numbers from real telemetry +
real note/embed data, never guesses, never leaks note/query/question
content, excludes admin accounts from every real-member count, and never
lets a single member satisfy a multi-member criterion alone.
"""
from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.journal_two.db import ensure_schema
from api.services.journal_two import stage_a_validation

ADMIN = {"id": "admin1", "email": "admin@example.test", "role": "admin", "plan": "pro"}
MEMBER = {"id": "u1", "email": "u1@x.test", "role": "member", "plan": "pro"}


@pytest.fixture
def conn(tmp_path, monkeypatch):
    from api.services import auth_db
    db_path = str(tmp_path / "stage_a.db")
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    c.executescript(auth_db._SCHEMA)
    c.execute("ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP")  # normally an init_db() migration
    ensure_schema(c)
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    yield c
    c.close()


def _seed_user(conn, user_id, email, role="member"):
    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name, role, created_at)"
        " VALUES (?,?,?,?,?,datetime('now'))",
        (user_id, email, "x", user_id, role),
    )
    conn.commit()


def _seed_account(conn, user_id, broker_synced=False):
    acc_id = f"acc-{user_id}"
    conn.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, starting_balance,"
        " account_size, created_at, updated_at) VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))",
        (acc_id, user_id, "Default", "blue", 100000, 100000),
    )
    if broker_synced:
        conn.execute(
            "INSERT INTO j2_broker_accounts (id, user_id, snaptrade_account_id,"
            " j2_account_id, created_at, updated_at)"
            " VALUES (?,?,?,?,datetime('now'),datetime('now'))",
            (f"brk-{user_id}", user_id, "st1", acc_id),
        )
    conn.commit()


def _log(conn, user_id, event, details=None, day_offset=0):
    import uuid
    conn.execute(
        "INSERT INTO activity_log (id, user_id, action, details, created_at)"
        " VALUES (?,?,?,?, datetime('now', ?))",
        (str(uuid.uuid4()), user_id, f"j2:{event}",
         json.dumps(details or {}), f"-{day_offset} days"),
    )
    conn.commit()


def _seed_note(conn, note_id, user_id, tags="[]"):
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
        " created_at, updated_at) VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))",
        (note_id, user_id, "note", "{}", "", tags),
    )
    conn.commit()


def _seed_full_engagement(conn, user_id, email):
    """One member who completes every Stage A workflow once -- used to build
    a 3-member cohort where every computable criterion is genuinely met by
    MULTIPLE distinct people, not one power user."""
    _seed_user(conn, user_id, email)
    _seed_account(conn, user_id, broker_synced=True)
    _log(conn, user_id, "notebook_tab_visit", day_offset=0)
    _log(conn, user_id, "notebook_tab_visit", day_offset=3)  # a later distinct day
    _log(conn, user_id, "notebook_note_created", day_offset=0)
    _log(conn, user_id, "notebook_capture_saved", day_offset=0)
    _log(conn, user_id, "notebook_search_used", {"hasResults": True}, day_offset=0)
    _log(conn, user_id, "notebook_search_used", {"hasResults": True}, day_offset=1)
    for i in range(3):
        _seed_note(conn, f"n-{user_id}-{i}", user_id, tags='["thesis"]' if i == 0 else "[]")
    conn.execute(
        "INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id,"
        " trade_ref, trade_ref_type) VALUES (?,?,0,'chart','123','position')",
        (f"n-{user_id}-0", user_id),
    )
    conn.commit()


def test_empty_cohort_reports_zero_everywhere_not_an_error(conn):
    r = stage_a_validation.compute_report(conn)
    assert r["cohort"]["totalRegisteredUsers"] == 0
    assert r["cohort"]["eligibleUsers"] == 0
    assert r["cohort"]["eligibleBrokerSyncedUsers"] == 0
    assert r["cohort"]["recentlyActiveUsers"] == 0
    assert r["cohort"]["recommendedBeachheadCohort"] == 0
    assert r["cohort"]["activatedUsers"] == 0
    assert r["earlySignalGate"]["computedCriteriaMet"] is False


def test_cohort_counts_eligible_and_broker_synced_separately(conn):
    _seed_user(conn, "u1", "u1@x.test")
    _seed_user(conn, "u2", "u2@x.test")
    _seed_account(conn, "u1", broker_synced=True)
    _seed_account(conn, "u2", broker_synced=False)
    r = stage_a_validation.compute_report(conn)
    assert r["cohort"]["eligibleUsers"] == 2
    assert r["cohort"]["eligibleBrokerSyncedUsers"] == 1


def test_recently_active_and_recommended_beachhead_cohort(conn):
    _seed_user(conn, "u1", "u1@x.test")
    _seed_user(conn, "u2", "u2@x.test")
    conn.execute("UPDATE users SET last_login_at = datetime('now') WHERE id = 'u1'")
    conn.execute("UPDATE users SET last_login_at = datetime('now', '-90 days') WHERE id = 'u2'")
    conn.commit()
    _seed_account(conn, "u1", broker_synced=True)
    _seed_account(conn, "u2", broker_synced=True)
    r = stage_a_validation.compute_report(conn)
    assert r["cohort"]["recentlyActiveUsers"] == 1  # only u1, within the window
    assert r["cohort"]["recommendedBeachheadCohort"] == 1  # recently active AND eligible AND broker-synced


def test_activation_counts_distinct_users_who_touched_notebook(conn):
    _seed_user(conn, "u1", "u1@x.test")
    _seed_user(conn, "u2", "u2@x.test")
    _log(conn, "u1", "notebook_tab_visit")
    _log(conn, "u1", "notebook_tab_visit")  # same user twice — still 1
    _log(conn, "u2", "notebook_note_created")
    r = stage_a_validation.compute_report(conn)
    assert r["cohort"]["activatedUsers"] == 2


def test_task_completion_per_capability(conn):
    _seed_user(conn, "u1", "u1@x.test")
    _log(conn, "u1", "notebook_note_created")
    _log(conn, "u1", "notebook_search_used", {"hasResults": True})
    _log(conn, "u1", "notebook_ask_current_note_used")
    r = stage_a_validation.compute_report(conn)
    assert r["taskCompletion"]["createdNote"] == 1
    assert r["taskCompletion"]["searched"] == 1
    assert r["taskCompletion"]["askedCurrentNote"] == 1
    assert r["taskCompletion"]["createdThesisNote"] == 0


def test_repeat_usage_requires_two_distinct_calendar_days(conn):
    _seed_user(conn, "u1", "u1@x.test")
    _seed_user(conn, "u2", "u2@x.test")
    _log(conn, "u1", "notebook_tab_visit", day_offset=0)
    _log(conn, "u1", "notebook_tab_visit", day_offset=5)  # returned 5 days later
    _log(conn, "u2", "notebook_tab_visit", day_offset=0)  # only ever showed up once
    r = stage_a_validation.compute_report(conn)
    assert r["repeatUsage"]["returnedOnALaterDay"] == 1


def test_search_success_rate_computed_from_hasResults_flag(conn):
    _seed_user(conn, "u1", "u1@x.test")
    _log(conn, "u1", "notebook_search_used", {"hasResults": True}, day_offset=0)
    _log(conn, "u1", "notebook_search_used", {"hasResults": True}, day_offset=1)
    _log(conn, "u1", "notebook_search_used", {"hasResults": False}, day_offset=2)
    r = stage_a_validation.compute_report(conn)
    assert r["searchBehavior"]["totalSearches"] == 3
    assert r["searchBehavior"]["searchesWithResults"] == 2
    assert r["searchBehavior"]["searchSuccessRate"] == pytest.approx(2 / 3, rel=0.01)
    assert r["searchBehavior"]["distinctUsersWhoSearched"] == 1


def test_thesis_and_trade_link_counts_come_from_real_notes_and_embeds(conn):
    _seed_user(conn, "u1", "u1@x.test")
    _seed_note(conn, "n1", "u1", tags='["thesis"]')
    conn.execute(
        "INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id,"
        " trade_ref, trade_ref_type) VALUES ('n1','u1',0,'chart','123','position')"
    )
    conn.commit()
    r = stage_a_validation.compute_report(conn)
    assert r["thesisTradeLinkBehavior"]["thesisNotes"] == 1
    assert r["thesisTradeLinkBehavior"]["tradeLinkedEmbeds"] == 1


def test_early_signal_gate_is_not_met_until_every_computed_criterion_is_true(conn):
    _seed_user(conn, "u1", "u1@x.test")
    _log(conn, "u1", "notebook_note_created")  # only 1 member, far below MULTI_USER_MIN
    r = stage_a_validation.compute_report(conn)
    assert r["earlySignalGate"]["computedCriteriaMet"] is False


def test_the_two_judgment_criteria_are_never_silently_assumed_true(conn):
    # Even with every telemetry-derivable criterion satisfied, the gate
    # report must still surface the two judgment-only criteria as
    # REQUIRES_OWNER_JUDGMENT, never auto-passing them.
    for uid in ("u1", "u2", "u3"):
        _seed_full_engagement(conn, uid, f"{uid}@x.test")
    r = stage_a_validation.compute_report(conn)
    by_key = {c["key"]: c for c in r["earlySignalGate"]["criteria"]}
    assert by_key["noTrustOrDataLossDefectObserved"]["passed"] is None
    assert by_key["noTrustOrDataLossDefectObserved"]["status"] == "REQUIRES_OWNER_JUDGMENT"
    assert by_key["qualitativeFeedbackNotFundamentallyNegative"]["passed"] is None
    assert by_key["qualitativeFeedbackNotFundamentallyNegative"]["status"] == "REQUIRES_OWNER_JUDGMENT"


def test_multiple_members_satisfy_every_computable_criterion_and_the_gate_computes_true(conn):
    for uid in ("u1", "u2", "u3"):
        _seed_full_engagement(conn, uid, f"{uid}@x.test")
    r = stage_a_validation.compute_report(conn)
    assert r["earlySignalGate"]["computedCriteriaMet"] is True
    by_key = {c["key"]: c for c in r["earlySignalGate"]["criteria"]}
    for key in (
        "multipleMembersCompletedCoreWorkflow",
        "multipleMembersDiscoveredSaveToNotebookUnprompted",
        "multipleMembersReturnedOnALaterDay",
        "multipleMembersAccumulatedResearch",
        "thesisTradeLinkUnderstoodAndUsedByMultipleMembers",
        "searchUsedEnoughToBeEvidenceBacked",
    ):
        assert by_key[key]["status"] == "PASS", key


def test_a_single_power_user_cannot_satisfy_a_multi_member_criterion(conn):
    _seed_full_engagement(conn, "solo", "solo@x.test")
    # Pile on far more of the SAME single member's activity -- still one person.
    for i in range(3, 10):
        _seed_note(conn, f"n-solo-{i}", "solo")
        _log(conn, "solo", "notebook_search_used", {"hasResults": True}, day_offset=i % 3)
    r = stage_a_validation.compute_report(conn)
    assert r["earlySignalGate"]["computedCriteriaMet"] is False
    by_key = {c["key"]: c for c in r["earlySignalGate"]["criteria"]}
    assert by_key["multipleMembersCompletedCoreWorkflow"]["status"] == "FAIL"
    assert by_key["multipleMembersDiscoveredSaveToNotebookUnprompted"]["status"] == "FAIL"
    assert by_key["thesisTradeLinkUnderstoodAndUsedByMultipleMembers"]["status"] == "FAIL"
    # Ten searches from ONE distinct member still fails the distinct-user half.
    assert by_key["searchUsedEnoughToBeEvidenceBacked"]["status"] == "FAIL"
    assert r["searchBehavior"]["totalSearches"] >= stage_a_validation.SEARCH_MIN_TOTAL_EVENTS
    assert r["searchBehavior"]["distinctUsersWhoSearched"] == 1


def test_admin_accounts_are_excluded_from_every_real_member_count(conn):
    _seed_user(conn, "admin1", "admin@x.test", role="admin")
    _log(conn, "admin1", "notebook_tab_visit")
    _log(conn, "admin1", "notebook_note_created")
    _log(conn, "admin1", "notebook_capture_saved")
    _log(conn, "admin1", "notebook_search_used", {"hasResults": True})
    _seed_note(conn, "n-admin", "admin1", tags='["thesis"]')
    conn.execute(
        "INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id,"
        " trade_ref, trade_ref_type) VALUES ('n-admin','admin1',0,'chart','999','position')"
    )
    conn.commit()
    r = stage_a_validation.compute_report(conn)
    assert r["cohort"]["totalRegisteredUsers"] == 1  # raw platform fact, admins included
    assert r["cohort"]["activatedUsers"] == 0
    assert r["taskCompletion"]["createdNote"] == 0
    assert r["taskCompletion"]["savedCapture"] == 0
    assert r["taskCompletion"]["createdTradeLink"] == 0
    assert r["searchBehavior"]["totalSearches"] == 0
    assert r["thesisTradeLinkBehavior"]["thesisNotes"] == 0
    assert r["thesisTradeLinkBehavior"]["tradeLinkedEmbeds"] == 0


def test_report_never_contains_note_or_query_content(conn):
    _seed_user(conn, "u1", "u1@x.test")
    _log(conn, "u1", "notebook_search_used", {"hasResults": True})
    _seed_note(conn, "n1", "u1")
    conn.execute(
        "UPDATE j2_notes SET title = 'my secret NVDA thesis',"
        " body_plain = 'confidential body text' WHERE id = 'n1'"
    )
    conn.commit()
    r = stage_a_validation.compute_report(conn)
    serialized = json.dumps(r)
    assert "secret" not in serialized
    assert "confidential" not in serialized


# ── HTTP layer: dual-gated (admin session OR PUSH_SECRET bearer) ─────────

def _http_app(tmp_path, monkeypatch, session_user=None):
    """A bare app + TestClient wired to a fresh DB, with auth_service's real
    validate_session monkeypatched (the endpoint calls it directly, not via
    FastAPI Depends, so dependency_overrides can't reach it)."""
    from api.services import auth_db, auth_service
    from api.routers import journal_two

    db_path = str(tmp_path / "stage_a_http.db")
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    c.executescript(auth_db._SCHEMA)
    c.execute("ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP")  # normally an init_db() migration
    ensure_schema(c)
    c.close()
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    monkeypatch.setattr(
        auth_service, "validate_session",
        lambda token: dict(session_user) if session_user and token == "sess-tok" else None,
    )

    app = FastAPI()
    app.include_router(journal_two.router)
    tc = TestClient(app)
    if session_user:
        tc.cookies.set("uct_session", "sess-tok")
    return tc


def test_endpoint_returns_the_full_report_shape(tmp_path, monkeypatch):
    r = _http_app(tmp_path, monkeypatch, session_user=ADMIN).get("/api/j2/notebook-validation-report")
    assert r.status_code == 200
    body = r.json()
    for key in (
        "cohort", "taskCompletion", "repeatUsage", "researchAccumulation",
        "searchBehavior", "thesisTradeLinkBehavior", "earlySignalGate",
        "fullStageAValidation", "qualitativeFeedback",
    ):
        assert key in body


def test_endpoint_is_admin_gated(tmp_path, monkeypatch):
    # A real member session, no PUSH_SECRET -- must be refused.
    r = _http_app(tmp_path, monkeypatch, session_user=MEMBER).get("/api/j2/notebook-validation-report")
    assert r.status_code in (401, 403)


def test_endpoint_refuses_an_unauthenticated_request(tmp_path, monkeypatch):
    r = _http_app(tmp_path, monkeypatch, session_user=None).get("/api/j2/notebook-validation-report")
    assert r.status_code == 401


def test_endpoint_accepts_the_push_secret_bearer_without_any_session(tmp_path, monkeypatch):
    tc = _http_app(tmp_path, monkeypatch, session_user=None)
    monkeypatch.setenv("PUSH_SECRET", "test-secret-value")
    r = tc.get(
        "/api/j2/notebook-validation-report",
        headers={"Authorization": "Bearer test-secret-value"},
    )
    assert r.status_code == 200


def test_endpoint_rejects_the_wrong_bearer_value(tmp_path, monkeypatch):
    tc = _http_app(tmp_path, monkeypatch, session_user=None)
    monkeypatch.setenv("PUSH_SECRET", "test-secret-value")
    r = tc.get(
        "/api/j2/notebook-validation-report",
        headers={"Authorization": "Bearer wrong-value"},
    )
    assert r.status_code == 401
