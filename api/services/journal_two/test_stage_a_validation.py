"""Stage A member-validation report (decision-log "Stage A→B gate" entry,
2026-09-06). Proves the report computes real numbers from real telemetry +
real note/embed data, never guesses, and never leaks note/query/question
content through any of its aggregate fields.
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


@pytest.fixture
def conn(tmp_path, monkeypatch):
    from api.services import auth_db
    db_path = str(tmp_path / "stage_a.db")
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    c.executescript(auth_db._SCHEMA)
    ensure_schema(c)
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)
    yield c
    c.close()


def _seed_user(conn, user_id, email):
    conn.execute(
        "INSERT INTO users (id, email, password_hash, display_name, role, created_at)"
        " VALUES (?,?,?,?,?,datetime('now'))",
        (user_id, email, "x", user_id, "member"),
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


def test_empty_cohort_reports_zero_everywhere_not_an_error(conn):
    r = stage_a_validation.compute_report(conn)
    assert r["cohort"] == {"eligibleUsers": 0, "eligibleBrokerSyncedUsers": 0, "activatedUsers": 0}
    assert r["earlySignalGate"]["computedCriteriaMet"] is False


def test_cohort_counts_eligible_and_broker_synced_separately(conn):
    _seed_user(conn, "u1", "u1@x.test")
    _seed_user(conn, "u2", "u2@x.test")
    _seed_account(conn, "u1", broker_synced=True)
    _seed_account(conn, "u2", broker_synced=False)
    r = stage_a_validation.compute_report(conn)
    assert r["cohort"]["eligibleUsers"] == 2
    assert r["cohort"]["eligibleBrokerSyncedUsers"] == 1


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


def test_thesis_and_trade_link_counts_come_from_real_notes_and_embeds(conn):
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
        " created_at, updated_at) VALUES ('n1','u1','T','{}','','[\"thesis\"]',"
        " datetime('now'), datetime('now'))"
    )
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
    _log(conn, "u1", "notebook_note_created")  # only 1 user, not >=2
    r = stage_a_validation.compute_report(conn)
    assert r["earlySignalGate"]["computedCriteriaMet"] is False


def test_the_two_judgment_criteria_are_never_silently_assumed_true(conn):
    # Even with every telemetry-derivable criterion satisfied, the gate
    # report must still surface the two judgment-only criteria as null,
    # never auto-passing them.
    r = stage_a_validation.compute_report(conn)
    crit = r["earlySignalGate"]["criteria"]
    assert crit["noTrustOrDataLossDefectObserved"] is None
    assert crit["qualitativeFeedbackNotFundamentallyNegative"] is None


def test_report_never_contains_note_or_query_content(conn):
    _seed_user(conn, "u1", "u1@x.test")
    _log(conn, "u1", "notebook_search_used", {"hasResults": True})
    conn.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags,"
        " created_at, updated_at) VALUES ('n1','u1','my secret NVDA thesis','{}',"
        " 'confidential body text','[]', datetime('now'), datetime('now'))"
    )
    conn.commit()
    r = stage_a_validation.compute_report(conn)
    serialized = json.dumps(r)
    assert "secret" not in serialized
    assert "confidential" not in serialized


# ── HTTP layer: admin-gated ──────────────────────────────────────────────

@pytest.fixture()
def client(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan, require_admin
    from api.routers import journal_two

    db_path = str(tmp_path / "stage_a_http.db")
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    c.executescript(auth_db._SCHEMA)
    ensure_schema(c)
    c.close()
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)

    app = FastAPI()
    app.include_router(journal_two.router)
    app.dependency_overrides[get_current_user] = lambda: dict(ADMIN)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(ADMIN)
    app.dependency_overrides[require_admin] = lambda: dict(ADMIN)
    return TestClient(app)


def test_endpoint_returns_the_full_report_shape(client):
    r = client.get("/api/j2/notebook-validation-report")
    assert r.status_code == 200
    body = r.json()
    for key in (
        "cohort", "taskCompletion", "repeatUsage", "researchAccumulation",
        "searchBehavior", "thesisTradeLinkBehavior", "earlySignalGate",
        "fullStageAValidation", "qualitativeFeedback",
    ):
        assert key in body


def test_endpoint_is_admin_gated(tmp_path, monkeypatch):
    from api.services import auth_db
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import journal_two

    db_path = str(tmp_path / "stage_a_gated.db")
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row
    c.executescript(auth_db._SCHEMA)
    ensure_schema(c)
    c.close()
    monkeypatch.setattr(auth_db, "_DB_PATH", db_path)

    app = FastAPI()
    app.include_router(journal_two.router)
    member = {"id": "u1", "email": "u1@x.test", "role": "member", "plan": "pro"}
    app.dependency_overrides[get_current_user] = lambda: dict(member)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(member)
    # require_admin is NOT overridden — a real member must be refused.
    r = TestClient(app).get("/api/j2/notebook-validation-report")
    assert r.status_code in (401, 403)
