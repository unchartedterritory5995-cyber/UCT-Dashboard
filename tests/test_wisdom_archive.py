"""The wisdom archive (TSDR Ledger backfill) — admin routes, batch import, service. SYNTHETIC data only.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. the batch route answering without the exact PUSH_SECRET bearer, or with the flag off;
2. an admin read answering a member (403) or answering anyone with the flag off (404);
3. validation letting an unknown author, a bad type, an unknown field or a malformed id in;
4. a re-sent batch writing twice (idempotency by primary key + sha);
5. FTS search not finding a note it just indexed;
6. any archive write touching wisdom_records / wisdom_segments (they reach paid members);
7. the routes not being mounted through the wisdom registry.

Builds its own minimal FastAPI app (no api.main import), with the identity overridden one
level down so require_admin itself still runs.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import wisdom_archive
from api.services.wisdom.archive import service
from api.services.wisdom.core import store
from tests.authclients import ADMIN, FREE_MEMBER, authorize

SECRET = "s3cret-archive-test"
BATCH = "/api/internal/wisdom/archive/batch"
AUTH = {"Authorization": f"Bearer {SECRET}"}


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


@pytest.fixture
def app():
    a = FastAPI()
    a.include_router(wisdom_archive.router)
    a.include_router(wisdom_archive.internal_router)
    return a


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "1")
    monkeypatch.setenv("PUSH_SECRET", SECRET)


def _client(app, user=ADMIN):
    if user is not None:
        authorize(app, user)
    return TestClient(app, raise_server_exceptions=False)


def _record(rid="t9001", **kw):
    r = {"record_id": rid, "author_id": "tsdr", "stated_date": "2025-01-02", "record_type": "CALL",
         "tickers": ["ZZTA", "ZZTB"], "note": "synthetic pivot breakout on rising volume",
         "quote": "synthetic quote text", "image_count": 2}
    r.update(kw)
    return r


def _call(cid="t9001#0", **kw):
    c = {"call_id": cid, "record_id": cid.split("#")[0], "author_id": "tsdr", "ticker": "ZZTA",
         "direction": "long", "setup": "synthetic_setup", "action": "entry", "posted": "2025-01-02T14:00:00",
         "entry": 10.0, "stop": 9.0, "target": None, "conf": "high", "reported": None,
         "outcome": {"r1": 0.01, "r5": 0.03, "r20": 0.10, "status": "scored", "regime": "up"},
         "methodology": "entry_mode=next_open"}
    c.update(kw)
    return c


def _seed(client):
    recs = [_record("t9001"), _record("t9002", record_type="LESSON", tickers="ZZTC",
                                      note="synthetic lesson about patience", author_id="bracco")]
    calls = [_call("t9001#0"), _call("t9001#1", outcome={"r20": -0.05, "status": "scored"}),
             _call("t9002#0", author_id="bracco", ticker="ZZTC", outcome={"r20": 0.30})]
    assert client.post(BATCH, json={"kind": "records", "items": recs}, headers=AUTH).status_code == 200
    assert client.post(BATCH, json={"kind": "calls", "items": calls}, headers=AUTH).status_code == 200


# ── 1. machine route auth + flag ─────────────────────────────────────────────

def test_batch_refuses_missing_wrong_and_blank_secret(app, wisdom_db, on, monkeypatch):
    c = _client(app, None)
    body = {"kind": "records", "items": [_record()]}
    assert c.post(BATCH, json=body).status_code == 401
    assert c.post(BATCH, json=body, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert c.post(BATCH, json=body, headers=AUTH).status_code == 200          # control: right bearer passes
    monkeypatch.setenv("PUSH_SECRET", "")
    assert c.post(BATCH, json=body, headers={"Authorization": "Bearer "}).status_code == 401


def test_batch_is_404_with_the_flag_off_even_with_the_right_secret(app, wisdom_db, on, monkeypatch):
    monkeypatch.delenv("WISDOM_ARCHIVE_ENABLED")
    c = _client(app, None)
    assert c.post(BATCH, json={"kind": "records", "items": [_record()]}, headers=AUTH).status_code == 404
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_archive_records").fetchone()[0] == 0


def test_batch_caps_items_and_kind(app, wisdom_db, on):
    c = _client(app, None)
    too_many = [_record(f"t{i}") for i in range(service.MAX_BATCH + 1)]
    assert c.post(BATCH, json={"kind": "records", "items": too_many}, headers=AUTH).status_code == 422
    assert c.post(BATCH, json={"kind": "segments", "items": []}, headers=AUTH).status_code == 422


# ── 2. admin reads ───────────────────────────────────────────────────────────

ADMIN_GETS = ("/api/admin/wisdom/archive/ticker/ZZTA", "/api/admin/wisdom/archive/setup/synthetic_setup",
              "/api/admin/wisdom/archive/search?q=breakout", "/api/admin/wisdom/archive/stats")


def test_admin_reads_refuse_a_member_and_admit_an_admin(app, wisdom_db, on):
    member = _client(app, FREE_MEMBER)
    for path in ADMIN_GETS:
        assert member.get(path).status_code == 403, path
    admin = _client(app, ADMIN)
    for path in ADMIN_GETS:
        assert admin.get(path).status_code == 200, path                       # control


def test_admin_reads_are_404_with_the_flag_off(app, wisdom_db, on, monkeypatch):
    monkeypatch.setenv("WISDOM_ARCHIVE_ENABLED", "0")
    admin = _client(app, ADMIN)
    for path in ADMIN_GETS:
        assert admin.get(path).status_code == 404, path


# ── 3. validation ────────────────────────────────────────────────────────────

@pytest.mark.parametrize("bad,why", [
    ({"author_id": "somemember"}, "author"),
    ({"record_type": "MENTION"}, "record_type"),
    ({"record_id": "x12"}, "record_id"),
    ({"stated_date": "yesterday"}, "stated_date"),
    ({"shares": 500}, "unknown fields"),
    ({"image_count": -1}, "image_count"),
    ({"tickers": ["not a ticker"]}, "ticker"),
])
def test_record_validation_rejects_per_item_and_keeps_the_rest(app, wisdom_db, on, bad, why):
    c = _client(app, None)
    res = c.post(BATCH, json={"kind": "records", "items": [_record("t1"), _record("t2", **bad)]}, headers=AUTH)
    body = res.json()
    assert res.status_code == 200 and body["inserted"] == 1 and body["rejected"] == 1
    assert body["errors"][0]["index"] == 1 and why in body["errors"][0]["error"]


@pytest.mark.parametrize("bad,why", [
    ({"call_id": "t1#0", "record_id": "t2"}, "record_id"),
    ({"direction": "sideways"}, "direction"),
    ({"entry": "ten"}, "entry"),
    ({"outcome": {"r20": 0.1, "position_size": 3}}, "outcome"),
    ({"size": 100}, "unknown fields"),
    ({"author_id": "nobody"}, "author"),
])
def test_call_validation(app, wisdom_db, on, bad, why):
    c = _client(app, None)
    res = c.post(BATCH, json={"kind": "calls", "items": [_call(**bad)]}, headers=AUTH)
    body = res.json()
    assert body["rejected"] == 1 and body["inserted"] == 0 and why in body["errors"][0]["error"]


@pytest.mark.parametrize("rid", ["z1", "z02710002", "z123456789"])
def test_a_spoken_record_and_its_call_are_accepted(app, wisdom_db, on, rid):
    """A spoken Live Trading Session segment ("z" ids) is a record with text, like a post."""
    c = _client(app, None)
    rec = c.post(BATCH, json={"kind": "records", "items": [_record(rid, quote="synthetic spoken words")]},
                 headers=AUTH).json()
    call = c.post(BATCH, json={"kind": "calls", "items": [_call(f"{rid}#0")]}, headers=AUTH).json()
    assert (rec["inserted"], rec["rejected"], call["inserted"], call["rejected"]) == (1, 0, 1, 0)


@pytest.mark.parametrize("rid", ["z", "z1234567890", "zt12", "Z12"])
def test_a_malformed_spoken_record_id_is_still_refused(app, wisdom_db, on, rid):
    c = _client(app, None)
    res = c.post(BATCH, json={"kind": "records", "items": [_record("t1"), _record(rid)]}, headers=AUTH).json()
    assert res["inserted"] == 1 and res["rejected"] == 1 and "record_id" in res["errors"][0]["error"]


def test_a_spoken_call_must_cite_its_own_record():
    with pytest.raises(service.ItemError, match="record_id"):
        service.validate_call(_call("z02710002#0", record_id="z02710003"))
    with pytest.raises(service.ItemError, match="record_id"):
        service.validate_call(_call("z02710002#0", record_id="t02710002"))
    assert service.validate_call(_call("z02710002#0"))["record_id"] == "z02710002"      # control


def test_every_team_author_from_authors_json_is_accepted():
    authors = service.team_authors()
    assert len(authors) == 6 and "tsdr" in authors                           # the six, by slug
    for a in authors:
        assert service.validate_record(_record(author_id=a))["author_id"] == a


# ── 4. idempotency ───────────────────────────────────────────────────────────

def test_resending_is_unchanged_and_a_new_sha_updates(app, wisdom_db, on):
    c = _client(app, None)
    items = [_record("t1", sha="a" * 64), _record("t2", sha="b" * 64)]
    first = c.post(BATCH, json={"kind": "records", "items": items}, headers=AUTH).json()
    again = c.post(BATCH, json={"kind": "records", "items": items}, headers=AUTH).json()
    assert (first["inserted"], again["inserted"], again["unchanged"]) == (2, 0, 2)
    changed = c.post(BATCH, json={"kind": "records", "items": [_record("t1", note="edited", sha="c" * 64)]},
                     headers=AUTH).json()
    assert changed["updated"] == 1
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_archive_records").fetchone()[0] == 2
        assert conn.execute("SELECT note FROM wisdom_archive_records WHERE record_id='t1'").fetchone()[0] == "edited"
        # the FTS index followed the update and holds one row per record
        assert conn.execute("SELECT COUNT(*) FROM wisdom_archive_fts").fetchone()[0] == 2


def test_calls_are_idempotent_without_a_client_sha(app, wisdom_db, on):
    c = _client(app, None)
    a = c.post(BATCH, json={"kind": "calls", "items": [_call()]}, headers=AUTH).json()
    b = c.post(BATCH, json={"kind": "calls", "items": [_call()]}, headers=AUTH).json()
    assert (a["inserted"], b["unchanged"]) == (1, 1)


# ── 5. reads + FTS ───────────────────────────────────────────────────────────

def test_ticker_setup_search_and_stats(app, wisdom_db, on):
    c = _client(app, None)
    _seed(c)
    admin = _client(app, ADMIN)
    tk = admin.get("/api/admin/wisdom/archive/ticker/zzta").json()
    assert tk["ticker"] == "ZZTA" and [r["record_id"] for r in tk["records"]] == ["t9001"]
    assert [x["call_id"] for x in tk["calls"]] == ["t9001#0", "t9001#1"]
    assert tk["calls"][0]["outcome"]["r20"] == pytest.approx(0.10)

    st = admin.get("/api/admin/wisdom/archive/setup/synthetic_setup").json()
    assert st["n_calls"] == 3 and st["best"][0]["call_id"] == "t9002#0"
    assert st["worst"][0]["call_id"] == "t9001#1" and st["best"][0]["record_note"].startswith("synthetic lesson")

    hits = admin.get("/api/admin/wisdom/archive/search?q=patience").json()["hits"]
    assert [h["record_id"] for h in hits] == ["t9002"]
    assert admin.get("/api/admin/wisdom/archive/search?q=nonexistentword").json()["hits"] == []
    assert admin.get("/api/admin/wisdom/archive/search?q=").json()["hits"] == []

    stats = admin.get("/api/admin/wisdom/archive/stats").json()
    assert stats["records"] == 2 and stats["calls"] == 3
    assert stats["records_by_author"] == {"tsdr": 1, "bracco": 1}
    assert stats["calls_by_setup"] == {"synthetic_setup": 3}


# ── 6. the member-facing tables are never written ────────────────────────────

def test_archive_writes_never_touch_wisdom_records_or_segments(app, wisdom_db, on):
    tables = ("wisdom_records", "wisdom_segments")
    with store.read() as conn:
        before = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
        assert set(before) == set(tables)                                       # non-vacuity: they exist
    _seed(_client(app, None))
    with store.read() as conn:
        after = {t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tables}
        assert conn.execute("SELECT COUNT(*) FROM wisdom_archive_records").fetchone()[0] == 2   # control
    assert after == before


def test_no_archive_sql_names_a_member_facing_table():
    import re
    text = open(service.__file__, encoding="utf-8").read()
    found = set(re.findall(r"(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)", text))
    # every table-shaped name (the {table} placeholders resolve to the three archive tables)
    tables = {t for t in found if t.startswith(("wisdom", "sqlite"))}
    assert tables and tables <= {"wisdom_archive_records", "wisdom_archive_calls", "wisdom_archive_fts",
                                 "wisdom_archive_setups", "sqlite_master"}, tables


# ── 7. mounted through the registry, with its gates ──────────────────────────

def _dep_names(route) -> set:
    names, stack = set(), [route.dependant]
    while stack:
        d = stack.pop()
        if d.call is not None:
            names.add(getattr(d.call, "__name__", ""))
        stack.extend(d.dependencies)
    return names


def test_registry_mounts_both_archive_routers_with_their_gates():
    from api.services.wisdom import registry

    routers = registry.routers()
    prefixes = {r.prefix for r in routers}
    assert {"/api/admin/wisdom/archive", "/api/internal/wisdom/archive"} <= prefixes
    assert "archive_001_records" in {n for n, _ in registry.schema_migrations()}
    for r in wisdom_archive.router.routes:
        assert "require_admin" in _dep_names(r), r.path
    for r in wisdom_archive.internal_router.routes:
        assert "require_push_secret" in _dep_names(r), r.path
        assert "require_admin" not in _dep_names(r)                             # control: the reader can say absent
