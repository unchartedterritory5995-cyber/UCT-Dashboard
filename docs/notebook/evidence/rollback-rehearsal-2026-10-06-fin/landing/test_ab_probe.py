"""The A/B at the centre of the wave 12-15 rollback, lane ROLLBACK 2026-10-06.

ONE request and ONE account deletion, run unchanged on two trees:

  A. the landing reverted WITH the keep-list (tools/notebook_rollback_chain.py --landing);
  B. the landing reverted WHOLE (a plain `git revert` of its squash: the pre-landing tree).

It names nothing the landing added, so it imports on both. `EXPECT` says which outcome the run
must see, so a pass or a fail is a statement about the tree and never about this file:

    EXPECT=keeplist  the save is refused (409), the plan data is still in the note, and a deleted
                     member's rows are gone from all twelve tables
    EXPECT=whole     the save is accepted (200), the plan data is gone, and the rows are left behind

Run from the repository root (the root conftest pins every data path to a sandbox):

    EXPECT=keeplist python -m pytest docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/landing/test_ab_probe.py -q
"""
from __future__ import annotations

import json
import os
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware import auth_middleware as authmw
from api.services import auth_db
from api.services.journal_two import account_purge as ap
from api.services.journal_two.db import ensure_schema as j2_ensure_schema

EXPECT = os.environ.get("EXPECT", "")
HEADER = "X-UCT-Notebook-Schema"
TA = {"v": 1, "setupTag": "Breakout", "planBlock": {"shares": 200, "sizedBy": "starter"}}
TA_BODY = {"type": "doc", "content": [
    {"type": "paragraph", "content": [{"type": "text", "text": "NVDA plan"}]},
    {"type": "widgetEmbed", "attrs": {"widgetId": "chart", "params": {"symbol": "NVDA"}, "ta": TA}},
]}
LANDING_TABLES = (
    "j2_trade_plan_links",
    "j2_template_gallery", "j2_template_gallery_reports", "j2_template_gallery_uses",
    "j2_chart_blocks", "j2_chart_fingerprints",
    "j2_entry_context", "j2_entry_context_bell_log",
    "j2_passed_setups",
    "j2_note_levels", "j2_note_resurface_fires",
    "j2_similar_matches",
)


def test_expect_is_set():
    assert EXPECT in ("keeplist", "whole"), "set EXPECT=keeplist or EXPECT=whole"


def test_a_level_3_editor_saves_a_plan_note_without_its_plan_data(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    conn = auth_db.get_connection()
    j2_ensure_schema(conn)
    conn.close()
    from api.routers import journal_two as j2_router
    app = FastAPI()
    app.include_router(j2_router.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": "u1", "role": "member"}
    client = TestClient(app)

    # the note as a landing bundle wrote it (it declares 4; an older server ignores the number)
    r = client.post("/api/j2/notes", headers={HEADER: "4"}, json={"title": "NVDA plan", "bodyJson": TA_BODY})
    assert r.status_code == 200, r.text
    note = r.json()["note"]

    def stored_attrs():
        c = auth_db.get_connection()
        try:
            body = c.execute("SELECT body_json FROM j2_notes WHERE id = ?", (note["id"],)).fetchone()[0]
        finally:
            c.close()
        return json.loads(body)["content"][1]["attrs"]
    assert stored_attrs()["ta"] == TA                       # non-vacuity: the plan data was stored

    # what the rolled-back editor sends: it declares 3, and its copy of the note has no `ta`
    stripped = json.loads(json.dumps(TA_BODY))
    stripped["content"][1]["attrs"].pop("ta")
    r = client.put(f"/api/j2/notes/{note['id']}", headers={HEADER: "3"},
                   json={"bodyJson": stripped, "baseUpdatedAt": note["updatedAt"]})
    outcome = {"status": r.status_code, "plan_data_still_in_the_note": stored_attrs().get("ta") == TA}
    print("AB-PROBE save:", json.dumps(outcome))
    want = ({"status": 409, "plan_data_still_in_the_note": True} if EXPECT == "keeplist"
            else {"status": 200, "plan_data_still_in_the_note": False})
    assert outcome == want


def test_account_deletion_on_a_database_the_landing_wrote_to():
    conn = sqlite3.connect(":memory:")
    for table in LANDING_TABLES:
        # The two gallery child tables carry `gallery_id`: the kept account_purge.py also removes
        # what OTHER members recorded about the leaving member's templates, by that column
        # (security lane M-7, merged after this probe was written). Left NULL, so that pass
        # matches nothing and the counts below are the direct `user_id` pass, as before.
        extra = ", gallery_id TEXT" if table in ("j2_template_gallery_reports", "j2_template_gallery_uses") else ""
        conn.execute(f'CREATE TABLE "{table}" (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, v TEXT{extra})')
        conn.executemany(f'INSERT INTO "{table}" (user_id, v) VALUES (?, ?)',
                         [("member-leaving", "theirs"), ("member-staying", "not theirs")])
    conn.commit()

    def left(user):
        return sum(conn.execute(f'SELECT COUNT(*) FROM "{t}" WHERE user_id = ?', (user,)).fetchone()[0]
                   for t in LANDING_TABLES)
    assert left("member-leaving") == 12 and left("member-staying") == 12       # non-vacuity
    report = ap.purge_user_rows("member-leaving", conn)     # this tree's purge, this tree's list
    assert report["errors"] == [], report["errors"]
    outcome = {"rows_left_behind": left("member-leaving"), "other_members_rows": left("member-staying")}
    print("AB-PROBE purge:", json.dumps(outcome))
    want = ({"rows_left_behind": 0, "other_members_rows": 12} if EXPECT == "keeplist"
            else {"rows_left_behind": 12, "other_members_rows": 12})
    assert outcome == want
