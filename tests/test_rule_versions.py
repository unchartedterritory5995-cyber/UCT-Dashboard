"""Spec §P2 item 2 (R-P2b-1, R-P2b-2): every change to a rule's words is a version; before entry is not."""
from __future__ import annotations

import importlib
import os
import tempfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw

@pytest.fixture
def db_path(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    monkeypatch.setenv("NOTEBOOK_JOURNAL_STYLES_ENABLED", "1")
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    yield tmp.name
    os.unlink(tmp.name)

def _rule(user="u1", label="No trades in the first 5 minutes"):
    from api.services.journal_two import journal_rules
    return journal_rules.create_rule(user, "a1", label)

def test_create_records_v1(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule()
    assert (r["version"], r["beforeEntry"]) == (1, False)
    assert [v["version"] for v in rv.list_versions("u1", r["id"])] == [1]

def test_a_word_change_is_a_version_before_entry_is_not(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule()
    r2 = rv.edit_rule("u1", r["id"], {"label": "No trades in the first 15 minutes", "changeNote": "too early"})
    assert r2["version"] == 2
    r3 = rv.edit_rule("u1", r["id"], {"beforeEntry": True})
    assert (r3["version"], r3["beforeEntry"]) == (2, True)
    assert r3["changedAt"] == r2["changedAt"]       # the toggle is not a change to the words
    vs = rv.list_versions("u1", r["id"])
    assert [(v["version"], v["label"], v["changeNote"]) for v in vs] == [
        (2, "No trades in the first 15 minutes", "too early"), (1, "No trades in the first 5 minutes", None)]

def test_an_unchanged_label_is_no_version(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule()
    assert rv.edit_rule("u1", r["id"], {"label": "No trades in the first 5 minutes"})["version"] == 1

def test_a_rule_from_before_this_release_gets_v1_lazily(db_path):
    from api.services.auth_db import get_connection
    from api.services.journal_two import rule_versions as rv
    c = get_connection()
    c.execute("INSERT INTO j2_journal_rules (id, user_id, account_id, label, status, created_at, updated_at)"
              " VALUES ('old', 'u1', 'a1', 'Old rule', 'active', '2026-01-02T00:00:00+00:00', '2026-01-02T00:00:00+00:00')")
    c.commit(); c.close()
    vs = rv.list_versions("u1", "old")
    assert [(v["version"], v["changedAt"]) for v in vs] == [(1, "2026-01-02T00:00:00+00:00")]
    assert rv.list_versions("u1", "old") == vs                         # idempotent

def test_another_members_rule_is_none(db_path):
    from api.services.journal_two import rule_versions as rv
    r = _rule(user="u2")
    assert rv.edit_rule("u1", r["id"], {"label": "x"}) is None
    assert rv.list_versions("u1", r["id"]) is None

def test_a_blank_label_is_refused(db_path):
    from api.services.journal_two import rule_versions as rv
    with pytest.raises(rv.RuleEditError):
        rv.edit_rule("u1", _rule()["id"], {"label": "   "})

@pytest.mark.parametrize("patch", [
    {"beforeEntry": "true"}, {"beforeEntry": 1}, {"label": 5}, {"evidence": 3}, {"changeNote": ["n"]},
])
def test_a_wrong_type_is_refused_and_changes_nothing(db_path, patch):
    """R-PF-N5: a string "true" never turns the switch OFF silently, and a non-text label is a 400,
    never a 500. Nothing is written."""
    from api.services.journal_two import journal_rules, rule_versions as rv
    r = _rule()
    with pytest.raises(rv.RuleEditError):
        rv.edit_rule("u1", r["id"], patch)
    got = journal_rules.list_rules("u1", "a1")[0]
    assert (got["version"], got["beforeEntry"], got["label"]) == (1, False, "No trades in the first 5 minutes")

def test_the_rules_list_carries_before_entry(db_path):
    from api.services.journal_two import journal_rules, rule_versions as rv
    r = _rule()
    rv.edit_rule("u1", r["id"], {"beforeEntry": True})
    assert journal_rules.list_rules("u1", "a1")[0]["beforeEntry"] is True

def test_the_rules_list_dates_the_words_not_the_toggle(db_path):
    """R-PF-N4: the list the block reads names the day the WORDS changed. A later before-entry toggle
    moves updated_at, never changedAt."""
    from api.services.auth_db import get_connection
    from api.services.journal_two import journal_rules, rule_versions as rv
    r = _rule()
    r2 = rv.edit_rule("u1", r["id"], {"label": "Wait 15 minutes"})
    c = get_connection()
    c.execute("UPDATE j2_journal_rule_versions SET changed_at = '2026-03-01T14:00:00+00:00' WHERE version = 2")
    c.commit(); c.close()
    rv.edit_rule("u1", r["id"], {"beforeEntry": True})
    listed = journal_rules.list_rules("u1", "a1")[0]
    assert listed["changedAt"] == "2026-03-01T14:00:00+00:00" != r2["changedAt"]
    assert listed["updatedAt"] != listed["changedAt"]

def test_routes(db_path):
    from api.routers import notebook_journal_styles as rt
    app = FastAPI()
    app.include_router(rt.router)
    app.dependency_overrides[authmw.get_current_user_with_plan] = lambda: {"id": "u1", "role": "member", "plan": "pro"}
    c = TestClient(app)
    r = _rule()
    got = c.put(f"/api/j2/trader-blocks/rules/{r['id']}", json={"label": "Wait 15 minutes", "changeNote": "n"})
    assert got.status_code == 200 and got.json()["version"] == 2
    assert c.get(f"/api/j2/trader-blocks/rules/{r['id']}/versions").json()["versions"][0]["version"] == 2
    assert c.put("/api/j2/trader-blocks/rules/nope", json={"label": "x"}).status_code == 404
    assert c.put(f"/api/j2/trader-blocks/rules/{r['id']}", json={"label": ""}).status_code == 400
    assert c.put(f"/api/j2/trader-blocks/rules/{r['id']}", json={"beforeEntry": "true"}).status_code == 400
    theirs = _rule(user="u2")
    assert c.get(f"/api/j2/trader-blocks/rules/{theirs['id']}/versions").status_code == 404
    assert c.get("/api/j2/trader-blocks/rules/nope/versions").status_code == 404
