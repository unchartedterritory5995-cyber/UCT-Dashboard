"""L8 (Studio plan, section 7): "Send this to UCT" -- a Create Indicator conversation as a
second KIND of the consented support report.

It rides the Pine report door unchanged in every way that protects a member: off unless
`PINE_SUPPORT_REPORTS_ENABLED`, sent only with `consent: true`, the same size cap, the same
5-per-hour and 20-per-day limit, the same retention, withdrawal by the member, and the same
account deletion (the same table). What is new is a `kind` column and a check that a
conversation report is exactly the document the dialog said it sends.
"""
from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import indicator_support as router_mod
from api.services import auth_db
from api.services import indicator_support as svc
from api.services import indicator_support_loop as loop

ALICE = {"id": "u-alice", "role": "user", "email": "a@test"}
BOB = {"id": "u-bob", "role": "user", "email": "b@test"}
CONVO = json.dumps({
    "transcript": [{"role": "member", "text": "a stop 2 ATRs under the highest close"},
                   {"role": "uct", "lines": ["I can't build a stop that remembers its own level."]}],
    "definition": None, "readback": [], "chart": {"sym": "SPY", "tf": "D"},
})


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    auth_db.init_db()
    monkeypatch.setenv(svc.FLAG_ENV, "1")
    return tmp_path


@pytest.fixture
def client():
    a = FastAPI()
    a.include_router(router_mod.router)

    def as_(user):
        a.dependency_overrides[get_current_user] = lambda: user
        return tc
    tc = TestClient(a)
    return as_


def _send(client, user=ALICE, **over):
    body = {"consent": True, "kind": "converse", "source": CONVO, "note": "it refused"}
    body.update(over)
    return client(user).post("/api/indicator-support/reports", json=body)


def test_a_conversation_is_stored_as_its_own_kind_and_the_member_can_read_it_back(client):
    r = _send(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["kind"] == "converse" and body["duplicate"] is False and body["gaps"] == []
    mine = client(ALICE).get(f"/api/indicator-support/reports/mine/{body['id']}").json()
    assert json.loads(mine["source"])["transcript"][0]["text"].startswith("a stop 2 ATRs")
    assert client(ALICE).get("/api/indicator-support/reports/mine").json()["reports"][0]["kind"] == "converse"


def test_a_pine_report_is_unchanged_and_reads_as_pine(client):
    r = client(ALICE).post("/api/indicator-support/reports", json={
        "consent": True, "source": '//@version=5\nindicator("t")\nplot(close)\n'})
    assert r.status_code == 200 and r.json()["kind"] == "pine"


@pytest.mark.parametrize("over,code", [
    ({"consent": None}, "consent"),
    ({"consent": "yes"}, "consent"),
    ({"kind": "screenshot"}, "kind"),
    ({"source": "not json"}, "source-format"),
    ({"source": json.dumps({"transcript": []})}, "source-format"),
    ({"source": json.dumps(["transcript"])}, "source-format"),
    ({"source": json.dumps({"transcript": [{"role": "member", "text": "x"}], "email": "me@x"})}, "source-format"),
])
def test_nothing_is_stored_without_consent_or_with_anything_but_the_declared_document(client, over, code):
    r = _send(client, **over)
    assert r.status_code == 422 and r.json()["detail"]["code"] == code
    assert client(ALICE).get("/api/indicator-support/reports/mine").json()["reports"] == []


def test_off_means_off(client, monkeypatch):
    monkeypatch.delenv(svc.FLAG_ENV, raising=False)
    assert _send(client).status_code == 404


def test_the_member_withdraws_it_and_another_member_cannot_see_or_withdraw_it(client):
    rid = _send(client).json()["id"]
    assert client(BOB).get(f"/api/indicator-support/reports/mine/{rid}").status_code == 404
    assert client(BOB).delete(f"/api/indicator-support/reports/mine/{rid}").status_code == 404
    assert client(ALICE).delete(f"/api/indicator-support/reports/mine/{rid}").status_code == 200
    assert client(ALICE).get("/api/indicator-support/reports/mine").json()["reports"] == []


def test_it_shares_the_pine_reports_rate_limit(client):
    for i in range(svc.RATE_PER_HOUR):
        doc = json.loads(CONVO); doc["transcript"][0]["text"] += f" {i}"
        assert _send(client, source=json.dumps(doc)).status_code == 200
    assert _send(client, source=CONVO.replace("highest", "lowest")).status_code == 429


def test_the_same_conversation_twice_is_one_report(client):
    a = _send(client).json()
    b = _send(client).json()
    assert b["duplicate"] is True and b["id"] == a["id"]


def test_the_digest_says_what_kind_each_report_is_and_still_holds_no_member_text(client):
    _send(client)
    d = loop.build_digest()
    (row,) = d["reports"]["open"]
    assert row["kind"] == "converse"
    assert "ATRs" not in json.dumps(d)                 # no member words in the digest


def test_an_old_table_gains_the_column_and_its_rows_read_as_pine(db):
    conn = auth_db.get_connection()
    try:
        old = svc._SCHEMA.replace(",\n    kind               TEXT NOT NULL DEFAULT 'pine'\n", "\n")
        assert "kind               TEXT" not in old          # control: the old shape really has no column
        conn.executescript(old)
        conn.execute(f"INSERT INTO indicator_support_reports ({svc._COLS})"
                     " VALUES ('a' || hex(randomblob(15)),'u',1,'s','h',1,NULL,NULL,NULL,NULL,'[]','v','new',"
                     "'2026-11-16T00:00:00Z','2026-11-16T00:00:00Z')")
        conn.commit()
        svc.ensure_schema(conn)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(indicator_support_reports)").fetchall()}
        assert "kind" in cols
        assert conn.execute("SELECT kind FROM indicator_support_reports").fetchone()[0] == "pine"
        svc.ensure_schema(conn)                             # idempotent
    finally:
        conn.close()


def test_account_deletion_still_takes_every_report_kind():
    from api.services.journal_two import account_purge
    assert "indicator_support_reports" in account_purge._DIRECT_USER_TABLES
