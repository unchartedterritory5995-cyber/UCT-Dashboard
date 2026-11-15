"""U4 (2026-11-14): every by-name refusal a member hits is a ranked work item.

The support loop's gap table (``indicator_gap_hits``) gains two kinds, ``refusal-guard`` and
``capability`` (``api/services/indicator_support.py``, module header). What must hold:

* the refusal-code vocabulary is CLOSED and DERIVED: every guard literal in our client source is
  on ``refusalCodes.json`` (regenerate with ``tools/support_loop/refusal_codes.py --write``), and a
  code NOT on it is stored as ``_unlisted``, never verbatim;
* a capability is stored only as a detector id; ``pending`` (not a refusal) never;
* the verdict door records the member's refused capabilities SERVER-side, once per day and set;
* no row carries the raw member id or any part of the script;
* a table built before U4 is migrated, every row kept, and the new kinds rank, purge and digest
  through the paths that already existed.
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
from api.services import runtime_definitions as rd
from tools.support_loop import refusal_codes as gen

ALICE = {"id": "u-alice-7731", "role": "user", "email": "a@test"}
BOB = {"id": "u-bob-1180", "role": "user", "email": "b@test"}


@pytest.fixture(autouse=True)
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    auth_db.init_db()
    monkeypatch.delenv(svc.GAP_LOG_OFF_ENV, raising=False)
    svc._CAP_SEEN.clear()
    return tmp_path


def _client(user=ALICE) -> TestClient:
    app = FastAPI()
    app.include_router(router_mod.router)
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _rows():
    conn = auth_db.get_connection()
    try:
        svc.ensure_schema(conn)
        return conn.execute("SELECT day, name, kind, member_key, hits FROM indicator_gap_hits"
                            " ORDER BY kind, name").fetchall()
    finally:
        conn.close()


# ─── the vocabulary ──────────────────────────────────────────────────────────

def test_every_guard_literal_in_the_client_source_is_on_the_committed_list():
    missing = sorted(set(gen.scan()) - set(gen.committed()))
    assert not missing, ("refusal guard codes in app/src that refusalCodes.json lacks; run "
                         "`python tools/support_loop/refusal_codes.py --write`:\n  " + "\n  ".join(missing))


def test_the_list_is_real_and_is_what_the_server_loaded():
    codes = set(gen.committed())
    assert len(codes) > 100
    for c in ("pine:builtin", "runtime:not-yet-graded", "runtime:killed", "run-half:object-rail",
              "runtime:worker-failed"):
        assert c in codes, c
    assert svc.REFUSAL_CODES == frozenset(codes)
    assert all(":" in c and " " not in c for c in codes)


def test_an_unreadable_list_admits_no_code(monkeypatch, tmp_path):
    monkeypatch.setattr(svc, "REFUSAL_CODES_PATH", tmp_path / "missing.json")
    assert svc._load_refusal_codes() == frozenset()


# ─── refusal codes ───────────────────────────────────────────────────────────

def test_listed_codes_are_stored_and_anything_else_is_one_unlisted_row():
    r = _client().post("/api/indicator-support/gaps", json={"dialect": "pine", "gaps": [], "guards": [
        "pine:builtin", "runtime:not-yet-graded", "pine:builtin",
        "pine:mySecretLevel",              # code-shaped, NOT on the list
        "alice@example.com", "secret plot line 3"]})
    assert r.status_code == 200
    rows = _rows()
    got = {(n, k) for _d, n, k, _m, _h in rows}
    assert got == {("pine:builtin", "refusal-guard"), ("runtime:not-yet-graded", "refusal-guard"),
                   (svc.UNLISTED, "refusal-guard")}
    dump = json.dumps([list(r) for r in rows])
    for leak in ("mySecretLevel", "alice@", "secret plot", ALICE["id"]):
        assert leak not in dump, leak


def test_names_and_codes_ride_one_post_and_rank_together():
    c = _client()
    c.post("/api/indicator-support/gaps", json={"gaps": [{"name": "ta.supertrend", "kind": "name-unknown"}],
                                               "guards": ["pine:builtin"]})
    _client(BOB).post("/api/indicator-support/gaps", json={"guards": ["pine:builtin"]})
    rank = {(g["name"], g["kind"]): g for g in svc.gap_ranking(30)}
    assert rank[("pine:builtin", "refusal-guard")]["members"] == 2
    assert rank[("ta.supertrend", "name-unknown")]["members"] == 1


def test_a_guards_list_too_long_or_non_string_is_a_422():
    c = _client()
    assert c.post("/api/indicator-support/gaps", json={"guards": ["pine:builtin"] * (svc.MAX_GUARDS + 1)}).status_code == 422
    assert c.post("/api/indicator-support/gaps", json={"guards": [{"x": 1}]}).status_code == 422
    assert c.post("/api/indicator-support/gaps", json={"guards": ["x" * 81]}).status_code == 422
    assert _rows() == []


# ─── capabilities ────────────────────────────────────────────────────────────

def test_capability_ids_are_stored_and_pending_and_junk_are_not():
    assert svc.record_capability_gaps("u1", ["switch", "collections:matrix", "pending", "ta.secret", 7]) == 2
    assert {(n, k) for _d, n, k, _m, _h in _rows()} == {("collections:matrix", "capability"),
                                                        ("switch", "capability")}
    assert svc.record_capability_gaps("u2", ["pending"]) == 0
    assert svc.record_capability_gaps(None, ["switch"]) == 0


def test_capability_repeats_write_once_per_day_and_set_per_process():
    assert svc.record_capability_gaps("u1", ["switch"]) == 1
    assert svc.record_capability_gaps("u1", ["switch"]) == 0
    assert _rows()[0][4] == 1


def test_the_verdict_door_records_a_refused_members_capabilities(monkeypatch):
    monkeypatch.setenv(rd.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setattr(rd, "capability_admitted", lambda *a, **k: (False, ["generics", "switch"]))
    out = rd.runtime_admission("//@version=6\nindicator('x')\nplot(close)", member=ALICE["id"])
    assert out["admitted"] is False
    assert {(n, k) for _d, n, k, _m, _h in _rows()} == {("generics", "capability"), ("switch", "capability")}
    assert all(m == svc.member_key(ALICE["id"]) for *_x, m, _h in _rows())


def test_the_verdict_door_records_nothing_when_pending_admitted_or_off(monkeypatch):
    monkeypatch.setenv(rd.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setattr(rd, "capability_admitted", lambda *a, **k: (False, [rd.PENDING]))
    rd.runtime_admission("plot(close)", member="m1")
    monkeypatch.setattr(rd, "capability_admitted", lambda *a, **k: (True, []))
    rd.runtime_admission("plot(open)", member="m1")
    monkeypatch.setenv(rd.CAPABILITY_ADMISSION_ENV, "off")
    monkeypatch.setattr(rd, "capability_admitted", lambda *a, **k: (False, ["switch"]))
    rd.runtime_admission("plot(high)", member="m1")
    assert _rows() == []


def test_a_failing_gap_write_never_reaches_the_verdict(monkeypatch):
    monkeypatch.setenv(rd.CAPABILITY_ADMISSION_ENV, "on")
    monkeypatch.setattr(rd, "capability_admitted", lambda *a, **k: (False, ["switch"]))
    monkeypatch.setattr(svc, "_upsert_pairs", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db gone")))
    assert rd.runtime_admission("plot(close)", member="m1")["admitted"] is False


# ─── the table: migration, purge, digest ─────────────────────────────────────

def test_a_pre_u4_table_is_migrated_once_with_every_row_kept(db):
    path = auth_db._DB_PATH
    conn = sqlite3.connect(path)
    conn.execute("DROP TABLE IF EXISTS indicator_gap_hits")
    conn.execute("CREATE TABLE indicator_gap_hits (day TEXT NOT NULL, name TEXT NOT NULL,"
                 " kind TEXT NOT NULL CHECK (kind IN ('name-unknown', 'call-unmapped')),"
                 " member_key TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 1,"
                 " PRIMARY KEY (day, name, kind, member_key))")
    conn.execute("INSERT INTO indicator_gap_hits VALUES ('2026-11-01', 'ta.rci', 'name-unknown', 'k1', 4)")
    conn.commit()
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO indicator_gap_hits VALUES ('2026-11-01', 'pine:builtin', 'refusal-guard', 'k1', 1)")
    conn.close()
    assert svc.record_gaps("u1", [], guards=["pine:builtin"]) == 1
    rows = {(n, k, m, h) for _d, n, k, m, h in _rows()}
    assert ("ta.rci", "name-unknown", "k1", 4) in rows
    assert ("pine:builtin", "refusal-guard", svc.member_key("u1"), 1) in rows
    c2 = auth_db.get_connection()
    try:
        svc.ensure_schema(c2)   # idempotent: a second pass changes nothing
        assert c2.execute("SELECT COUNT(*) FROM indicator_gap_hits").fetchone()[0] == 2
    finally:
        c2.close()


def test_account_deletion_removes_the_new_kinds_too():
    """Through the real purge (`purge_user_rows`), which deletes by the keyed hash."""
    from api.services.journal_two import account_purge
    svc.record_gaps(ALICE["id"], [], guards=["pine:builtin"])
    svc.record_capability_gaps(ALICE["id"], ["switch"])
    svc.record_gaps(BOB["id"], [], guards=["pine:builtin"])
    conn = auth_db.get_connection()
    try:
        account_purge.purge_user_rows(ALICE["id"], conn)
    finally:
        conn.close()
    assert {m for *_x, m, _h in _rows()} == {svc.member_key(BOB["id"])}


def test_the_digest_ranks_codes_open_and_keeps_unlisted_codes_apart():
    svc.record_gaps("u1", [], unlisted=2, guards=["pine:builtin", "pine:notOnTheList"])
    svc.record_gaps("u2", [], guards=["pine:builtin"])
    svc.record_capability_gaps("u1", ["switch"])
    d = loop.build_digest()
    open_rows = {(g["name"], g["kind"]): g for g in d["gaps"]["open"]}
    assert open_rows[("pine:builtin", "refusal-guard")]["members"] == 2
    assert open_rows[("pine:builtin", "refusal-guard")]["fixed_on_master"] is False
    assert ("switch", "capability") in open_rows
    assert d["gaps"]["unlisted"]["members"] == 1                  # the unnamed built-in gaps
    assert d["gaps"]["unlisted_refusal_codes"]["members"] == 1    # NOT overwritten by them
