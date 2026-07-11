"""j2_journal_rules — the "Make this a rule" personal-rule store (P6-5).

A persisted, evidence-linked, DISPLAY-ONLY reminder store: create / list /
dismiss / count_active. It MUST NOT auto-arm any intervention or mutate a
discipline guardrail — these tests only exercise the CRUD surface (there is no
firing path to test, by design).

Uses the `:memory:` + `ensure_schema(conn)` fixture pattern (mirrors
test_adherence_store.py); the store's `conn` param keeps every store test off
the real auth.db. Every query is user-scoped.
"""
import sqlite3

import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two.journal_rules import (
    JournalRuleError,
    create_rule,
    list_rules,
    dismiss_rule,
    count_active,
)


def _conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    j2db.ensure_schema(conn)
    return conn


# ── create: round-trip + defaults ───────────────────────────────────────────

def test_create_roundtrips_all_fields_camelcase():
    conn = _conn()
    rec = create_rule(
        "u1", "acct1", "Never add to a loser",
        evidence="Lost $400 on TSLA doing this",
        source_type="psychology", source_id="review:abc",
        conn=conn,
    )
    assert rec["id"]
    assert rec["accountId"] == "acct1"
    assert rec["label"] == "Never add to a loser"
    assert rec["evidence"] == "Lost $400 on TSLA doing this"
    assert rec["sourceType"] == "psychology"
    assert rec["sourceId"] == "review:abc"
    assert rec["status"] == "active"  # status defaults active
    assert rec["createdAt"]
    assert rec["updatedAt"]
    # no user_id leaks into the camelCase view
    assert "userId" not in rec
    assert "user_id" not in rec


def test_create_defaults_source_type_manual_and_optional_fields_none():
    conn = _conn()
    rec = create_rule("u1", None, "Wait for the retest", conn=conn)
    assert rec["sourceType"] == "manual"  # default
    assert rec["evidence"] is None
    assert rec["sourceId"] is None
    assert rec["accountId"] is None
    assert rec["status"] == "active"


def test_create_persists_and_is_readable_via_list():
    conn = _conn()
    rec = create_rule("u1", "acct1", "Size down in chop", conn=conn)
    rows = list_rules("u1", "acct1", conn=conn)
    assert len(rows) == 1
    assert rows[0]["id"] == rec["id"]
    assert rows[0]["label"] == "Size down in chop"


# ── label validation ────────────────────────────────────────────────────────

def test_create_empty_label_rejected():
    conn = _conn()
    with pytest.raises(JournalRuleError):
        create_rule("u1", "acct1", "", conn=conn)


def test_create_whitespace_label_rejected():
    conn = _conn()
    with pytest.raises(JournalRuleError):
        create_rule("u1", "acct1", "   \t\n ", conn=conn)


def test_create_none_label_rejected():
    conn = _conn()
    with pytest.raises(JournalRuleError):
        create_rule("u1", "acct1", None, conn=conn)


def test_create_label_trimmed():
    conn = _conn()
    rec = create_rule("u1", "acct1", "   Trim me   ", conn=conn)
    assert rec["label"] == "Trim me"


def test_create_label_capped_at_200_chars():
    conn = _conn()
    rec = create_rule("u1", "acct1", "x" * 500, conn=conn)
    assert len(rec["label"]) == 200


# ── unknown source_type coerced to manual (documented behavior) ──────────────

def test_unknown_source_type_coerced_to_manual():
    conn = _conn()
    rec = create_rule("u1", "acct1", "L", source_type="bogus_kind", conn=conn)
    assert rec["sourceType"] == "manual"


def test_valid_source_types_preserved():
    conn = _conn()
    for st in ("psychology", "review", "manual", "chat"):
        rec = create_rule("u1", "acct1", f"rule for {st}", source_type=st, conn=conn)
        assert rec["sourceType"] == st


# ── list: filters by status + account, newest first ─────────────────────────

def test_list_filters_by_status():
    conn = _conn()
    a = create_rule("u1", "acct1", "active one", conn=conn)
    b = create_rule("u1", "acct1", "to dismiss", conn=conn)
    dismiss_rule("u1", b["id"], conn=conn)

    active = list_rules("u1", "acct1", status="active", conn=conn)
    assert [r["id"] for r in active] == [a["id"]]

    dismissed = list_rules("u1", "acct1", status="dismissed", conn=conn)
    assert [r["id"] for r in dismissed] == [b["id"]]


def test_list_filters_by_account_id():
    conn = _conn()
    a = create_rule("u1", "acct1", "acct1 rule", conn=conn)
    create_rule("u1", "acct2", "acct2 rule", conn=conn)
    rows = list_rules("u1", "acct1", conn=conn)
    assert [r["id"] for r in rows] == [a["id"]]


def test_list_all_accounts_when_account_id_none():
    conn = _conn()
    create_rule("u1", "acct1", "r1", conn=conn)
    create_rule("u1", "acct2", "r2", conn=conn)
    rows = list_rules("u1", account_id=None, conn=conn)
    assert len(rows) == 2


def test_list_newest_first():
    conn = _conn()
    first = create_rule("u1", "acct1", "first", conn=conn)
    second = create_rule("u1", "acct1", "second", conn=conn)
    third = create_rule("u1", "acct1", "third", conn=conn)
    rows = list_rules("u1", "acct1", conn=conn)
    assert [r["id"] for r in rows] == [third["id"], second["id"], first["id"]]


# ── dismiss: flips status, drops from active list, no-op when not owned ──────

def test_dismiss_flips_status_and_drops_from_active():
    conn = _conn()
    rec = create_rule("u1", "acct1", "temp rule", conn=conn)
    out = dismiss_rule("u1", rec["id"], conn=conn)
    assert out is not None
    assert out["status"] == "dismissed"
    assert out["id"] == rec["id"]
    # dropped from the active list
    active = list_rules("u1", "acct1", status="active", conn=conn)
    assert active == []


def test_dismiss_bumps_updated_at():
    conn = _conn()
    rec = create_rule("u1", "acct1", "temp", conn=conn)
    out = dismiss_rule("u1", rec["id"], conn=conn)
    assert out["updatedAt"] >= rec["updatedAt"]


def test_dismiss_missing_returns_none():
    conn = _conn()
    assert dismiss_rule("u1", "does-not-exist", conn=conn) is None


def test_dismiss_not_owned_is_noop_and_returns_none():
    conn = _conn()
    rec = create_rule("u1", "acct1", "u1 rule", conn=conn)
    # user B cannot dismiss user A's rule
    assert dismiss_rule("u2", rec["id"], conn=conn) is None
    # and it stays active for u1
    still = list_rules("u1", "acct1", status="active", conn=conn)
    assert [r["id"] for r in still] == [rec["id"]]


# ── user isolation ──────────────────────────────────────────────────────────

def test_user_isolation_on_list():
    conn = _conn()
    create_rule("u1", "acct1", "u1 rule", conn=conn)
    create_rule("u2", "acct1", "u2 rule", conn=conn)
    u1_rows = list_rules("u1", "acct1", conn=conn)
    assert [r["label"] for r in u1_rows] == ["u1 rule"]
    u2_rows = list_rules("u2", "acct1", conn=conn)
    assert [r["label"] for r in u2_rows] == ["u2 rule"]


# ── count_active ────────────────────────────────────────────────────────────

def test_count_active():
    conn = _conn()
    assert count_active("u1", conn=conn) == 0
    a = create_rule("u1", "acct1", "a", conn=conn)
    create_rule("u1", "acct1", "b", conn=conn)
    create_rule("u1", "acct2", "c", conn=conn)
    assert count_active("u1", conn=conn) == 3
    assert count_active("u1", "acct1", conn=conn) == 2
    # dismiss drops the active count
    dismiss_rule("u1", a["id"], conn=conn)
    assert count_active("u1", "acct1", conn=conn) == 1
    # other users unaffected
    assert count_active("u2", conn=conn) == 0


# ── Router: create/list/dismiss thin wrappers ───────────────────────────────

def test_route_create_400_on_empty_label(monkeypatch):
    from fastapi import HTTPException
    from api.routers import journal_two as r

    with pytest.raises(HTTPException) as ei:
        r.create_journal_rule_route(
            account_id="acct1", payload={"label": "   "}, user={"id": "u1"})
    assert ei.value.status_code == 400


def test_route_create_delegates(monkeypatch):
    from api.routers import journal_two as r
    from api.services.journal_two import journal_rules

    captured = {}

    def fake_create(user_id, account_id, label, evidence=None,
                    source_type="manual", source_id=None):
        captured["args"] = (user_id, account_id, label, evidence,
                            source_type, source_id)
        return {"id": "x", "status": "active"}

    monkeypatch.setattr(journal_rules, "create_rule", fake_create)
    out = r.create_journal_rule_route(
        account_id="acct1",
        payload={"label": "Rule", "evidence": "why", "sourceType": "review",
                 "sourceId": "s1"},
        user={"id": "u1"},
    )
    assert out["id"] == "x"
    assert captured["args"] == ("u1", "acct1", "Rule", "why", "review", "s1")


def test_route_dismiss_404_when_missing(monkeypatch):
    from fastapi import HTTPException
    from api.routers import journal_two as r
    from api.services.journal_two import journal_rules

    monkeypatch.setattr(journal_rules, "dismiss_rule", lambda uid, rid: None)
    with pytest.raises(HTTPException) as ei:
        r.dismiss_journal_rule_route(rule_id="gone", user={"id": "u1"})
    assert ei.value.status_code == 404


def test_rules_routes_registered():
    from api.routers.journal_two import router
    paths = {(rt.path, tuple(sorted(rt.methods)))
             for rt in router.routes if hasattr(rt, "methods")}
    assert ("/api/j2/accounts/{account_id}/rules", ("POST",)) in paths
    assert ("/api/j2/accounts/{account_id}/rules", ("GET",)) in paths
    assert ("/api/j2/rules/{rule_id}/dismiss", ("POST",)) in paths
