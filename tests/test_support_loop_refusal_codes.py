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


def test_a_retired_code_is_still_a_code_the_server_stores():
    """A code the source no longer writes stays on the list (an older open tab still sends it)."""
    retired = gen.committed_retired()
    assert "runtime:calc-bars-bar-index" in retired
    assert "runtime:calc-bars-bar-index" not in gen.scan()      # CONTROL: it really is retired
    for code, note in retired.items():
        assert svc.is_refusal_code(code), code
        assert isinstance(note, dict) and note.get("since"), code
    assert set(retired) <= set(gen.committed())
    assert not set(retired) & set(gen.scan()), "a retired code is live again; run --write"
    r = _client().post("/api/indicator-support/gaps", json={"guards": ["runtime:calc-bars-bar-index"]})
    assert r.status_code == 200
    assert {(n, k) for _d, n, k, _m, _h in _rows()} == {("runtime:calc-bars-bar-index", "refusal-guard")}


def test_regenerating_never_deletes_a_code_it_retires_it(monkeypatch, tmp_path):
    """On a COPY: a code that vanished from the source is kept and recorded; a new one is added;
    a second pass changes nothing; a retired code that comes back is live again."""
    out = tmp_path / "refusalCodes.json"
    out.write_bytes(gen.OUT.read_bytes())
    before = json.loads(out.read_text(encoding="utf-8"))
    live = gen.scan()
    gone = "pine:builtin"
    assert gone in live and gone in before["codes"]
    next_live = [c for c in live if c != gone] + ["pine:brand-new-code"]
    doc = gen.write(out=out, live=next_live, today="2026-01-02")
    assert doc == json.loads(out.read_text(encoding="utf-8"))
    assert set(before["codes"]) <= set(doc["codes"]), sorted(set(before["codes"]) - set(doc["codes"]))
    assert gone in doc["codes"] and doc["retired"][gone] == {"since": "2026-01-02"}
    assert "pine:brand-new-code" in doc["codes"] and "pine:brand-new-code" not in doc["retired"]
    assert doc["codes"] == sorted(doc["codes"])
    for code, note in before["retired"].items():          # an existing entry is kept as written
        assert doc["retired"][code] == note
    # the server's loader accepts the retired code from that file, unchanged
    monkeypatch.setattr(svc, "REFUSAL_CODES_PATH", out)
    assert gone in svc._load_refusal_codes()
    # idempotent, and the date of a retirement is not rewritten
    assert gen.write(out=out, live=next_live, today="2026-09-09") == doc
    # live again: off the retired record, still a code
    back = gen.write(out=out, live=next_live + [gone], today="2026-09-09")
    assert gone in back["codes"] and gone not in back["retired"]


def test_the_check_passes_on_the_committed_list_and_fails_on_a_missing_literal(monkeypatch, capsys):
    assert gen.main([]) == 0
    monkeypatch.setattr(gen, "scan", lambda *a, **k: ["pine:builtin", "pine:not-on-the-list-yet"])
    assert gen.main([]) == 1
    assert "pine:not-on-the-list-yet" in capsys.readouterr().out


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
    assert c.post("/api/indicator-support/gaps", json={"guards": ["x" * 201]}).status_code == 422   # absurd: bounded
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


# ─── review fixes L1-L3 ──────────────────────────────────────────────────────

def test_L1_one_over_long_code_is_unlisted_never_a_422_for_the_whole_post():
    r = _client().post("/api/indicator-support/gaps", json={"guards": ["pine:" + "x" * 150, "pine:builtin"]})
    assert r.status_code == 200
    assert {(n, k) for _d, n, k, _m, _h in _rows()} == {("pine:builtin", "refusal-guard"),
                                                        (svc.UNLISTED, "refusal-guard")}


def test_L1_the_client_and_server_agree_on_the_longest_code():
    import re as _re
    from pathlib import Path as _P
    js = (_P(__file__).resolve().parents[1] / "app" / "src" / "components" / "chart" / "supportLoop"
          / "supportApi.js").read_text(encoding="utf-8")
    assert int(_re.search(r"export const REFUSAL_CODE_MAX = (\d+)", js).group(1)) == svc.REFUSAL_CODE_MAX
    assert max(len(c) for c in svc.REFUSAL_CODES) <= svc.REFUSAL_CODE_MAX


def test_L2_a_BEGIN_that_fails_raises_its_own_error_not_a_rollback_error(db):
    path = auth_db._DB_PATH
    setup = sqlite3.connect(path)
    setup.execute("DROP TABLE IF EXISTS indicator_gap_hits")
    setup.execute("CREATE TABLE indicator_gap_hits (day TEXT NOT NULL, name TEXT NOT NULL,"
                  " kind TEXT NOT NULL CHECK (kind IN ('name-unknown', 'call-unmapped')),"
                  " member_key TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 1,"
                  " PRIMARY KEY (day, name, kind, member_key))")
    setup.commit()
    holder = sqlite3.connect(path, isolation_level=None)
    holder.execute("BEGIN IMMEDIATE")                       # another writer holds the lock
    try:
        conn = sqlite3.connect(path, timeout=0.05)
        with pytest.raises(sqlite3.OperationalError, match="locked"):
            svc._migrate_gap_kinds(conn)
        conn.close()
    finally:
        holder.execute("ROLLBACK")
        holder.close()
        setup.close()


def test_L3_racing_threads_write_one_capability_row_once(monkeypatch):
    import threading as _th
    writes = []
    real = svc._upsert_pairs

    def spy(*a, **k):
        writes.append(1)
        return real(*a, **k)
    monkeypatch.setattr(svc, "_upsert_pairs", spy)
    barrier = _th.Barrier(16)
    got = []

    def one():
        barrier.wait()
        got.append(svc.record_capability_gaps("u-race", ["switch"]))
    ts = [_th.Thread(target=one) for _ in range(16)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert writes == [1] and sorted(got) == [0] * 15 + [1]


def test_L3_a_failed_capability_write_can_be_tried_again(monkeypatch):
    real = svc._upsert_pairs
    monkeypatch.setattr(svc, "_upsert_pairs", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db gone")))
    assert svc.record_capability_gaps("u-retry", ["switch"]) == 0
    monkeypatch.setattr(svc, "_upsert_pairs", real)
    assert svc.record_capability_gaps("u-retry", ["switch"]) == 1


def test_L2_a_failing_ROLLBACK_never_hides_the_error_that_caused_it():
    """A statement that fails mid-rebuild, and a ROLLBACK that then fails too (the engine had
    already rolled back): the caller sees the ORIGINAL error."""
    class Original(Exception):
        pass

    class Conn:
        def __init__(self):
            self.calls = []

        def commit(self):
            pass

        def execute(self, sql, *a):
            self.calls.append(sql.split()[0])
            if sql.startswith("SELECT sql FROM sqlite_master"):
                return type("R", (), {"fetchone": lambda _s: ("CREATE TABLE indicator_gap_hits (kind CHECK (kind IN ('name-unknown')))",)})()
            if sql.startswith("INSERT INTO indicator_gap_hits_u4"):
                raise Original("the copy failed")
            if sql == "ROLLBACK":
                raise sqlite3.OperationalError("cannot rollback - no transaction is active")
            return None
    c = Conn()
    with pytest.raises(Original, match="the copy failed"):
        svc._migrate_gap_kinds(c)
    assert "ROLLBACK" in c.calls
