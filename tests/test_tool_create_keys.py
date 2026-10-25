"""Task 9.6b (ruling W9-R48): the routine and tracker Duplicate is idempotent on the server.

`POST /api/j2/routines/{rid}/duplicate` and `POST /api/j2/trackers/{tid}/duplicate` read an
`Idempotency-Key` header, with the widget create key's design (wave 8 consolidation, rulings R-43,
R-48, R-52): one key is one request; the same key and the same source answers the copy it already
made (200, never a second copy); the same key on a different source or kind is a 409 `conflict`; a
malformed key is ignored; keys are per member, kept 24 h, swept by the next keyed duplicate and
purged with the account.

Real auth.db schema (db.ensure_schema through auth_db.init_db) in a tmp dir; nothing here reaches
`C:\\data`. Every store call passes `now`, so no test is a function of the hour.
"""
from __future__ import annotations

import ast
import importlib
import re
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

A, B = "u-toolkey-a", "u-toolkey-b"
KEY = "3f2b8c1d-9e4a-4b6c-8d7e-1a2b3c4d5e6f"
KEY2 = "7a1c2e3f-4b5d-4e6f-a7b8-c9d0e1f2a3b4"
#: Wednesday 2026-11-04, noon ET.
T0 = datetime(2026, 11, 4, 17, 0, tzinfo=timezone.utc)
ITEMS = [{"text": "Read the wire"}, {"text": "Set max loss"}]
EVERY = {"kind": "every"}
ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def K(monkeypatch, tmp_path):
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    from api.services.journal_two import tool_create_keys
    yield tool_create_keys
    importlib.reload(auth_db)


def _conn():
    from api.services import auth_db
    return auth_db.get_connection()


def _keys(user_id=None):
    c = _conn()
    try:
        sql = "SELECT user_id, key, kind, source_id, new_id FROM j2_tool_create_keys"
        args: tuple = ()
        if user_id is not None:
            sql += " WHERE user_id = ?"
            args = (user_id,)
        return [tuple(r) for r in c.execute(sql + " ORDER BY user_id, key", args)]
    finally:
        c.close()


def _count(table, user_id):
    c = _conn()
    try:
        return c.execute(f"SELECT COUNT(*) FROM {table} WHERE user_id = ?", (user_id,)).fetchone()[0]
    finally:
        c.close()


def _routine(user_id=A, name="Morning"):
    from api.services.journal_two import routines
    return routines.create(user_id, name=name, items=ITEMS, schedule=EVERY, now=T0)


def _tracker(user_id=A, name="Sleep"):
    from api.services.journal_two import trackers
    return trackers.create(user_id, name=name, kind="number", now=T0)


def _dup(K, kind, user_id, source_id, key=KEY, now=T0, **kw):
    return K.duplicate_with_key(user_id, kind, source_id, key=key, now=now, **kw)


# -- one key, one copy -----------------------------------------------------------------------------

@pytest.mark.parametrize("kind,make,table", [("routine", _routine, "j2_routines"),
                                             ("tracker", _tracker, "j2_trackers")])
def test_two_duplicates_with_one_key_make_one_copy(K, kind, make, table):
    src = make()
    first = _dup(K, kind, A, src["id"])
    assert first["id"] != src["id"] and first["name"] == src["name"] + " copy"
    assert "replayed" not in first
    again = _dup(K, kind, A, src["id"])
    assert again["id"] == first["id"] and again["replayed"] is True
    assert {k: v for k, v in again.items() if k != "replayed"} == first     # the copy as it reads now
    assert _count(table, A) == 2                                            # the source and ONE copy
    assert _keys(A) == [(A, KEY, kind, src["id"], first["id"])]


def test_a_new_key_is_a_new_copy(K):
    src = _routine()
    one = _dup(K, "routine", A, src["id"], key=KEY)
    two = _dup(K, "routine", A, src["id"], key=KEY2)
    assert one["id"] != two["id"] and _count("j2_routines", A) == 3


def test_the_key_is_normalised_before_the_lookup(K):
    src = _routine()
    first = _dup(K, "routine", A, src["id"], key=KEY)
    again = _dup(K, "routine", A, src["id"], key="  " + KEY.upper() + "\n")
    assert again["id"] == first["id"] and again["replayed"] is True


def test_different_members_with_one_key_make_two_copies(K):
    a_src, b_src = _routine(A), _routine(B)
    a_copy = _dup(K, "routine", A, a_src["id"])
    b_copy = _dup(K, "routine", B, b_src["id"])
    assert a_copy["id"] != b_copy["id"] and "replayed" not in b_copy
    assert _count("j2_routines", A) == 2 and _count("j2_routines", B) == 2
    assert [r[0] for r in _keys()] == [A, B]


def test_a_key_never_reaches_another_members_copy(K):
    """B sends A's key on B's own copy of a routine id that is A's: B's key space is B's own."""
    a_src = _routine(A)
    _dup(K, "routine", A, a_src["id"])
    from api.services.journal_two import routines
    with pytest.raises(routines.NotFound):
        _dup(K, "routine", B, a_src["id"])                  # the source is not B's: the plain 404
    assert _keys(B) == []


# -- the same key on another source or kind: 409 ---------------------------------------------------

def test_a_key_reused_on_another_source_is_refused_and_writes_nothing(K):
    one, two = _routine(name="One"), _routine(name="Two")
    first = _dup(K, "routine", A, one["id"])
    with pytest.raises(K.KeyReused) as e:
        _dup(K, "routine", A, two["id"])
    assert e.value.status == 409 and e.value.code == "conflict"
    assert e.value.sentence == K.S_KEY_REUSED
    assert _count("j2_routines", A) == 3                                    # one, two, ONE copy
    assert _keys(A) == [(A, KEY, "routine", one["id"], first["id"])]


def test_a_key_reused_on_another_kind_is_refused(K):
    r, t = _routine(), _tracker()
    _dup(K, "routine", A, r["id"])
    with pytest.raises(K.KeyReused):
        _dup(K, "tracker", A, t["id"])
    with pytest.raises(K.KeyReused):                        # even with the routine's own id as the source
        _dup(K, "tracker", A, r["id"])
    assert _count("j2_trackers", A) == 1


def test_an_unknown_kind_is_a_programming_error(K):
    with pytest.raises(ValueError):
        _dup(K, "widget", A, "x")


# -- a malformed key is ignored ---------------------------------------------------------------------

@pytest.mark.parametrize("bad", [None, "", "   ", "not-a-key", 42,
                                 "3f2b8c1d-9e4a-1b6c-8d7e-1a2b3c4d5e6f",    # a version-1 uuid
                                 "3f2b8c1d-9e4a-4b6c-7d7e-1a2b3c4d5e6f",    # a bad variant
                                 KEY + "0", "{" + KEY + "}"])
def test_a_malformed_key_is_ignored_and_the_duplicate_behaves_as_before(K, bad):
    src = _routine()
    one = _dup(K, "routine", A, src["id"], key=bad)
    two = _dup(K, "routine", A, src["id"], key=bad)
    assert one["id"] != two["id"] and "replayed" not in two
    assert _count("j2_routines", A) == 3 and _keys() == []


def test_clean_create_key(K):
    from api.services.journal_two import create_keys as ck
    assert ck.clean_create_key(KEY) == KEY
    assert ck.clean_create_key(" " + KEY.upper()) == KEY
    for bad in (None, 1, b"x", "x", KEY[:-1], KEY.replace("-4", "-1", 1)):
        assert ck.clean_create_key(bad) is None


# -- refusals remember nothing; a replay asks nothing -----------------------------------------------

def test_a_refused_duplicate_remembers_nothing(K):
    from api.services.journal_two import trackers
    with pytest.raises(trackers.ReadOnly):                  # a built-in tracker cannot be copied
        _dup(K, "tracker", A, "checkin:mood")
    with pytest.raises(trackers.NotFound):
        _dup(K, "tracker", A, "no-such-id")
    assert _keys() == []
    t = _tracker()                                          # and the key is still free
    assert "replayed" not in _dup(K, "tracker", A, t["id"])


def test_a_replay_never_asks_the_count_cap(K, monkeypatch):
    from api.services.journal_two import routines
    src = _routine()
    first = _dup(K, "routine", A, src["id"])

    def capped(c, user_id):
        raise routines.CountCap()

    monkeypatch.setattr(routines, "_check_cap", capped)
    assert _dup(K, "routine", A, src["id"])["id"] == first["id"]       # no copy is made: no cap
    with pytest.raises(routines.CountCap):
        _dup(K, "routine", A, src["id"], key=KEY2)
    assert _keys(A) == [(A, KEY, "routine", src["id"], first["id"])]


def test_a_key_whose_copy_was_deleted_makes_a_new_copy(K):
    from api.services.journal_two import routines
    src = _routine()
    first = _dup(K, "routine", A, src["id"])
    routines.archive(A, first["id"], now=T0)
    assert _dup(K, "routine", A, src["id"])["id"] == first["id"]        # archived: the same copy
    routines.soft_delete(A, first["id"], typed_name=first["name"], now=T0)
    fresh = _dup(K, "routine", A, src["id"])
    assert fresh["id"] != first["id"] and "replayed" not in fresh
    assert _keys(A) == [(A, KEY, "routine", src["id"], fresh["id"])]


# -- 24 h, swept by the next keyed duplicate ---------------------------------------------------------

def test_a_key_expires_after_24_hours_and_the_sweep_takes_every_members_old_keys(K):
    from api.services.journal_two import create_keys as ck
    src = _routine()
    first = _dup(K, "routine", A, src["id"])
    inside = _dup(K, "routine", A, src["id"], now=T0 + timedelta(seconds=ck.CREATE_KEY_TTL_S))
    assert inside["id"] == first["id"]
    later = _dup(K, "routine", A, src["id"], now=T0 + timedelta(seconds=ck.CREATE_KEY_TTL_S + 1))
    assert later["id"] != first["id"] and "replayed" not in later
    assert _keys(A) == [(A, KEY, "routine", src["id"], later["id"])]
    # an expired key of ANOTHER member goes in the same sweep, whatever kind
    b = _tracker(B)
    _dup(K, "tracker", B, b["id"], now=T0 + timedelta(days=2))
    _dup(K, "routine", A, src["id"], key=KEY2, now=T0 + timedelta(days=3, seconds=1))
    assert [r[0] for r in _keys()] == [A]
    assert ck.CREATE_KEY_TTL_S == 24 * 60 * 60


def test_a_plain_duplicate_never_writes_a_key_or_sweeps(K):
    src = _routine()
    _dup(K, "routine", A, src["id"])
    _dup(K, "routine", A, src["id"], key=None, now=T0 + timedelta(days=5))
    assert len(_keys(A)) == 1                               # only a keyed duplicate sweeps


# -- the purge --------------------------------------------------------------------------------------

def test_account_purge_removes_the_tool_keys(K):
    from api.services.journal_two import account_purge as ap
    _dup(K, "routine", A, _routine(A)["id"])
    _dup(K, "tracker", A, _tracker(A)["id"], key=KEY2)
    _dup(K, "routine", B, _routine(B)["id"])
    assert "j2_tool_create_keys" in ap._DIRECT_USER_TABLES
    c = _conn()
    try:
        report = ap.purge_user_data(A, c)
    finally:
        c.close()
    assert report["ok"] is True
    assert _keys(A) == []
    assert [r[0] for r in _keys()] == [B]                   # the other member's key is untouched


def test_the_deletion_manifest_names_the_table():
    text = (ROOT / "docs" / "account-deletion-manifest.md").read_text(encoding="utf-8")
    assert "j2_tool_create_keys" in text


# -- the race (R-52's shape) ------------------------------------------------------------------------

def test_two_duplicates_racing_on_one_key_make_one_copy(K):
    """The second waits on the first's write lock (BEGIN IMMEDIATE), then replays it."""
    src = _routine()
    held = _conn()
    held.execute("BEGIN IMMEDIATE")
    first = _dup(K, "routine", A, src["id"], conn=held)                 # inside the open transaction
    out: dict = {}

    def second():
        try:
            out["got"] = _dup(K, "routine", A, src["id"])
        except BaseException as e:                                      # surfaced below, never lost
            out["err"] = e

    t = threading.Thread(target=second)
    t.start()
    time.sleep(0.3)
    assert t.is_alive()                                     # waiting on the lock, not racing past it
    held.commit()
    held.close()
    t.join(5)
    assert "err" not in out, out.get("err")
    assert out["got"]["id"] == first["id"] and out["got"]["replayed"] is True
    assert _count("j2_routines", A) == 2


def test_the_primary_key_is_the_backstop(K):
    """Even without the lock, one (member, key) holds one row, whatever its kind or source."""
    src = _routine()
    made = _dup(K, "routine", A, src["id"])
    c = _conn()
    try:
        with pytest.raises(sqlite3.IntegrityError):
            c.execute("INSERT INTO j2_tool_create_keys (user_id, key, kind, source_id, new_id, created_at)"
                      " VALUES (?, ?, 'tracker', 'other', ?, ?)", (A, KEY, made["id"], T0.isoformat()))
    finally:
        c.close()


# -- the router -------------------------------------------------------------------------------------

def _client(monkeypatch, user_id=A):
    import api.routers.notebook_routines as nr
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.limiter import limiter
    limiter.reset()
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "1")
    user = {"id": user_id, "email": "paid@example.test", "role": "member", "plan": "pro"}
    app = FastAPI()
    app.include_router(nr.routines_router)
    app.include_router(nr.trackers_router)
    app.dependency_overrides[get_current_user] = lambda: dict(user)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


@pytest.mark.parametrize("base,make,table", [("/api/j2/routines", _routine, "j2_routines"),
                                             ("/api/j2/trackers", _tracker, "j2_trackers")])
def test_router_honours_the_idempotency_key_header(K, monkeypatch, base, make, table):
    c = _client(monkeypatch)
    src = make()
    url = f"{base}/{src['id']}/duplicate"
    one = c.post(url, headers={"Idempotency-Key": KEY})
    two = c.post(url, headers={"Idempotency-Key": KEY})
    assert one.status_code == 200 and two.status_code == 200
    assert two.json()["id"] == one.json()["id"] and two.json()["replayed"] is True
    assert two.headers["cache-control"] == "no-store"
    assert _count(table, A) == 2


def test_router_a_key_on_another_source_is_a_409_conflict(K, monkeypatch):
    c = _client(monkeypatch)
    one, two = _routine(name="One"), _routine(name="Two")
    assert c.post(f"/api/j2/routines/{one['id']}/duplicate", headers={"Idempotency-Key": KEY}).status_code == 200
    r = c.post(f"/api/j2/routines/{two['id']}/duplicate", headers={"Idempotency-Key": KEY})
    assert r.status_code == 409
    assert r.json() == {"detail": {"code": "conflict", "message": K.S_KEY_REUSED}}
    assert r.headers["cache-control"].startswith("no-store")
    t = _tracker()                                          # and on the other kind's route
    r = c.post(f"/api/j2/trackers/{t['id']}/duplicate", headers={"Idempotency-Key": KEY})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "conflict"
    assert _count("j2_routines", A) == 3 and _count("j2_trackers", A) == 1


def test_router_no_key_or_a_malformed_key_behaves_as_before(K, monkeypatch):
    c = _client(monkeypatch)
    src = _tracker()
    url = f"/api/j2/trackers/{src['id']}/duplicate"
    ids = {c.post(url).json()["id"], c.post(url).json()["id"],
           c.post(url, headers={"Idempotency-Key": "nope"}).json()["id"],
           c.post(url, headers={"Idempotency-Key": "nope"}).json()["id"]}
    assert len(ids) == 4 and _keys() == []


def test_router_different_members_with_one_key_get_two_copies(K, monkeypatch):
    a, b = _client(monkeypatch, A), _client(monkeypatch, B)
    a_src, b_src = _routine(A), _routine(B)
    ra = a.post(f"/api/j2/routines/{a_src['id']}/duplicate", headers={"Idempotency-Key": KEY})
    rb = b.post(f"/api/j2/routines/{b_src['id']}/duplicate", headers={"Idempotency-Key": KEY})
    assert ra.status_code == 200 and rb.status_code == 200
    assert ra.json()["id"] != rb.json()["id"] and "replayed" not in rb.json()


def test_router_the_dark_gate_answers_before_the_key_is_read(K, monkeypatch):
    c = _client(monkeypatch)
    src = _routine()
    monkeypatch.setenv("NOTEBOOK_WIDGETS_W9_ENABLED", "0")
    r = c.post(f"/api/j2/routines/{src['id']}/duplicate", headers={"Idempotency-Key": KEY})
    assert r.status_code == 404 and _keys() == []


# -- one home for the key helpers -------------------------------------------------------------------

_UUID4_SHAPE = re.compile(r"4\[0-9a-f\]\{3\}-\[89ab\]")


def test_the_uuid4_key_rule_has_one_home():
    """`clean_create_key` and its uuid4 pattern live ONLY in `create_keys.py`. ⛔ At the 9.20 be->impl
    merge, `widget_definitions.py` brings its own copy (`_CREATE_KEY_RE`, `clean_create_key`,
    `CREATE_KEY_TTL_S`): this rail goes red there BY DESIGN until it imports them from `create_keys`
    instead (the brief: one shared helper, never a copy)."""
    homes = sorted(str(p.relative_to(ROOT)).replace("\\", "/")
                   for p in (ROOT / "api").rglob("*.py")
                   if _UUID4_SHAPE.search(p.read_text(encoding="utf-8", errors="replace")))
    assert homes == ["api/services/journal_two/create_keys.py"]
    defs = []
    for p in (ROOT / "api").rglob("*.py"):
        tree = ast.parse(p.read_text(encoding="utf-8", errors="replace"))
        defs += [str(p.relative_to(ROOT)).replace("\\", "/") for n in ast.walk(tree)
                 if isinstance(n, ast.FunctionDef) and n.name == "clean_create_key"]
    assert defs == ["api/services/journal_two/create_keys.py"]


def test_the_one_home_rail_can_see_a_copy(tmp_path):
    """Non-vacuity: the pattern the rail searches for matches the real rule's text."""
    from api.services.journal_two import create_keys as ck
    assert _UUID4_SHAPE.search(ck._CREATE_KEY_RE.pattern)
