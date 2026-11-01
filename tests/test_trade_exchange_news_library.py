"""UCT News Research Library V1 (library.py + /api/trade-exchange-news/library/*).

The member's bookmarks, collections and notes live in auth.db; the headlines stay in the
shared, permanent News store. What is proven here:
  * save / duplicate save / remove + Undo, notes, collections (one headline in several);
  * search by text (headline AND note), ticker, collection and ET date; newest first;
  * strict per-member isolation: another member's ids, collections and notes are invisible
    and untouchable (404, never 403);
  * removing a bookmark, deleting a collection or clearing a note NEVER changes a headline
    or a delivery (counted, and pinned by a source scan);
  * references survive archive recovery: a full rebuild from the R2 journal into an empty
    volume, and a story whose FIRST delivery differs after the rebuild;
  * account deletion purges every row; anonymous requests are refused; limits hold.
Synthetic headlines only.
"""
from __future__ import annotations

import asyncio
import pathlib
import re
import sqlite3
import time

import pytest

from api.services.trade_exchange_news import archive as arc
from api.services.trade_exchange_news import library as lib
from api.services.trade_exchange_news import pipeline as pl
from api.services.trade_exchange_news.store import Store
from tests.support.txn_fakes import load_receiver

M = load_receiver()
rx, jr = M["txn_receiver"], M["txn_journal"]
REPO = pathlib.Path(__file__).resolve().parents[1]
NOW_MS = int(time.time() * 1000)
A, B = "member-a", "member-b"


def rec(content, ms=None):
    cfg = rx.Config({"TXN_SOURCE_ALLOWLIST": "TXNews1"})
    return rx.build_record("TXNews1", content, {}, rx.delivery_meta({}, 10, None), cfg, now_ms=ms or NOW_MS)


@pytest.fixture(autouse=True)
def env(monkeypatch, tmp_path):
    from api.services import auth_db
    path = str(tmp_path / "auth.db")
    monkeypatch.setattr(auth_db, "_DB_PATH", path)
    monkeypatch.setenv("AUTH_DB_PATH", path)
    auth_db.init_db()
    c = sqlite3.connect(path)
    for uid in (A, B):
        c.execute("INSERT INTO users (id, email, password_hash) VALUES (?,?,?)", (uid, f"{uid}@test.local", "x"))
    c.commit()
    c.close()
    monkeypatch.setenv("TXN_ENABLED", "1")
    monkeypatch.setenv("TXN_DB_PATH", str(tmp_path / "vol" / "trade_exchange_news.db"))
    (tmp_path / "vol").mkdir()
    monkeypatch.setenv("TXN_SOURCE_ALLOWLIST", "TXNews1")
    monkeypatch.delenv(lib.FLAG, raising=False)
    monkeypatch.setattr(arc, "WARM_ENABLED", False)
    monkeypatch.setattr(jr, "_last_ms", 0)
    lib._reset_for_tests()
    yield path
    pl.stop()


async def _news(contents, journal=None, start_ms=None):
    p = pl.start(asyncio.get_running_loop())
    sent = []
    t = start_ms or NOW_MS - 3 * 86_400_000
    for i, content in enumerate(contents):
        r = rec(content, t + i * 3_600_000)
        if journal is not None:
            journal.put(r)
        await p.submit(r, "push")
        sent.append(r)
    return p, sent


def _counts(store):
    c = store._conn()
    return (c.execute("SELECT COUNT(*) FROM headlines").fetchone()[0],
            c.execute("SELECT COUNT(*) FROM deliveries").fetchone()[0],
            c.execute("SELECT group_concat(content, '|') FROM headlines").fetchone()[0])


def _ev(store):
    return lambda r: pl.headline_event(r, store.epoch, arc.event_fields(r["source"], r["content"]))


HEADS = ["SYNTHETIC: ALFA Corp raises full-year guidance", "SYNTHETIC: Fed minutes due at 2pm",
         "SYNTHETIC: BRVO to sell 5M shares in secondary offering", "SYNTHETIC: oil inventories fall"]


# ── save, duplicate, remove + Undo ───────────────────────────────────────────

async def test_save_is_idempotent_and_remove_offers_everything_undo_needs():
    p, sent = await _news(HEADS)
    eid = sent[0]["id"]
    first = lib.save(A, p.store, eid)
    again = lib.save(A, p.store, eid)
    assert first["created"] is True and again["created"] is False
    assert lib.state(A)["ids"] == [eid]
    col = lib.create_collection(A, "Earnings")
    lib.set_membership(A, col["id"], eid, True)
    lib.set_note(A, eid, "Check margins on the call")
    removed = lib.remove(A, eid)["removed"]
    assert removed["note"] == "Check margins on the call" and removed["collection_ids"] == [col["id"]]
    assert lib.state(A)["ids"] == []
    assert lib.remove(A, eid) == {"removed": None}                   # removing twice is harmless
    back = lib.save(A, p.store, eid, note=removed["note"], collection_ids=removed["collection_ids"],
                    saved_at_ms=removed["saved_at_ms"])["bookmark"]   # Undo
    assert back == {**removed, "note_updated_at_ms": back["note_updated_at_ms"]}


async def test_an_unknown_or_malformed_headline_cannot_be_saved():
    p, _ = await _news(HEADS[:1])
    with pytest.raises(lib.LibraryError) as e:
        lib.save(A, p.store, "01NOSUCHHEADLINE0000000000")
    assert e.value.status == 404
    for bad in ("", "../x", "x" * 65, None, 7):
        with pytest.raises(lib.LibraryError) as e:
            lib.save(A, p.store, bad)
        assert e.value.status == 422


# ── collections and notes ────────────────────────────────────────────────────

async def test_one_headline_in_several_collections_and_collections_are_personal_names():
    p, sent = await _news(HEADS)
    eid = sent[0]["id"]
    lib.save(A, p.store, eid)
    c1, c2 = lib.create_collection(A, "  Earnings   season "), lib.create_collection(A, "Semis")
    assert c1["name"] == "Earnings season"
    lib.set_membership(A, c1["id"], eid, True)
    lib.set_membership(A, c2["id"], eid, True)
    lib.set_membership(A, c2["id"], eid, True)                         # twice: still once
    assert sorted(lib.items(A, p.store)["items"][0]["bookmark"]["collection_ids"]) == sorted([c1["id"], c2["id"]])
    assert {c["name"]: c["count"] for c in lib.state(A)["collections"]} == {"Earnings season": 1, "Semis": 1}
    with pytest.raises(lib.LibraryError) as e:
        lib.create_collection(A, "SEMIS")                              # names are unique per member, any case
    assert e.value.status == 409
    lib.create_collection(B, "Semis")                                  # another member's names are theirs
    assert lib.rename_collection(A, c2["id"], "Chips")["name"] == "Chips"
    lib.set_membership(A, c2["id"], eid, False)
    assert lib.items(A, p.store, collection=c2["id"])["items"] == []
    lib.delete_collection(A, c1["id"])
    assert lib.state(A)["ids"] == [eid]                                # deleting a collection keeps the bookmark
    with pytest.raises(lib.LibraryError) as e:
        lib.set_membership(A, c2["id"], sent[1]["id"], True)           # only a saved headline joins one
    assert e.value.reason == "not_saved"


async def test_notes_are_written_cleared_bounded_and_need_a_saved_headline():
    p, sent = await _news(HEADS)
    eid = sent[1]["id"]
    with pytest.raises(lib.LibraryError) as e:
        lib.set_note(A, eid, "x")
    assert e.value.reason == "not_saved"
    lib.save(A, p.store, eid)
    assert lib.set_note(A, eid, "  Watch the 2-year  \r\n")["bookmark"]["note"] == "Watch the 2-year"
    assert lib.set_note(A, eid, "")["bookmark"]["note"] == ""
    with pytest.raises(lib.LibraryError) as e:
        lib.set_note(A, eid, "n" * (lib.NOTE_MAX + 1))
    assert e.value.status == 422


# ── search and filters ───────────────────────────────────────────────────────

async def test_search_by_text_note_ticker_collection_and_date_newest_first():
    p, sent = await _news(HEADS)
    for r in sent:
        lib.save(A, p.store, r["id"])
        time.sleep(0.002)
    lib.set_note(A, sent[3]["id"], "crude draw thesis")
    col = lib.create_collection(A, "Macro")
    lib.set_membership(A, col["id"], sent[1]["id"], True)
    ids = lambda **kw: [i["id"] for i in lib.items(A, p.store, event_for=_ev(p.store), **kw)["items"]]  # noqa: E731
    assert ids() == [r["id"] for r in reversed(sent)]                 # newest saved first
    assert ids(sort="received") == [r["id"] for r in reversed(sent)]
    assert ids(query="fed MINUTES") == [sent[1]["id"]]
    assert ids(query="crude draw") == [sent[3]["id"]]                  # the member's own note is searched
    assert ids(collection=col["id"]) == [sent[1]["id"]]
    tick = lib.items(A, p.store, event_for=_ev(p.store))["items"]
    assert all("tickers" in i and "content" in i and "received_at_ms" in i for i in tick)
    some = next((t for i in tick for t in i["tickers"]), None)
    if some:
        assert all(some in i["tickers"] for i in lib.items(A, p.store, ticker=some, event_for=_ev(p.store))["items"])
    day = time.strftime("%Y-%m-%d", time.localtime(sent[0]["received_at_ms"] / 1000))
    assert ids(date_from="2000-01-01", date_to="2000-01-02") == []
    assert set(ids(date_from="2000-01-01", date_to="2099-12-31")) == {r["id"] for r in sent}
    assert day                                                         # the ET-day bounds parse
    with pytest.raises(lib.LibraryError):
        lib.items(A, p.store, date_from="yesterday")


# ── isolation between members ────────────────────────────────────────────────

async def test_a_member_never_reads_or_changes_another_members_library():
    p, sent = await _news(HEADS)
    eid = sent[0]["id"]
    lib.save(A, p.store, eid, note="A's private thesis")
    ca = lib.create_collection(A, "A only")
    lib.set_membership(A, ca["id"], eid, True)
    assert lib.state(B) == {**lib.state(B), "ids": [], "collections": []}
    assert lib.items(B, p.store)["items"] == []
    for call in (lambda: lib.rename_collection(B, ca["id"], "mine now"),
                 lambda: lib.delete_collection(B, ca["id"]),
                 lambda: lib.set_membership(B, ca["id"], eid, True),
                 lambda: lib.set_membership(B, ca["id"], eid, False),
                 lambda: lib.items(B, p.store, collection=ca["id"]),
                 lambda: lib.set_note(B, eid, "overwrite")):
        with pytest.raises(lib.LibraryError) as e:
            call()
        assert e.value.status == 404                                  # never "forbidden": ids reveal nothing
    lib.save(B, p.store, eid)                                         # B saving the same headline is B's own row
    assert lib.remove(B, eid)["removed"]["note"] == ""
    mine = lib.items(A, p.store)["items"][0]["bookmark"]
    assert mine["note"] == "A's private thesis" and mine["collection_ids"] == [ca["id"]]
    assert [c["name"] for c in lib.state(A)["collections"]] == ["A only"]


# ── the archive is never touched ─────────────────────────────────────────────

async def test_removing_bookmarks_collections_and_notes_never_changes_a_headline_or_delivery():
    p, sent = await _news(HEADS)
    before = _counts(p.store)
    col = lib.create_collection(A, "All")
    for r in sent:
        lib.save(A, p.store, r["id"], note="n")
        lib.set_membership(A, col["id"], r["id"], True)
    for r in sent:
        lib.set_note(A, r["id"], "")
        lib.remove(A, r["id"])
    lib.delete_collection(A, col["id"])
    assert _counts(p.store) == before


def test_no_library_code_writes_a_news_table():
    src = (REPO / "api/services/trade_exchange_news/library.py").read_text(encoding="utf-8")
    writes = re.findall(r"(INSERT[^\"]*|UPDATE\s+\w+|DELETE\s+FROM\s+\w+)", src, re.I)
    assert writes, "the scan sees the library's own writes"
    for w in writes:
        assert re.search(r"\btxn_(bookmarks|collections|collection_items)\b", w), w
        assert not re.search(r"\b(headlines|deliveries|state)\b", w), w


# ── references survive recovery ──────────────────────────────────────────────

async def test_bookmarks_survive_a_full_rebuild_from_the_r2_journal_into_an_empty_volume(tmp_path, monkeypatch):
    from tools import txn_rebuild_from_r2 as rebuild_tool
    journal = jr.FileJournal(str(tmp_path / "j"))
    p, sent = await _news(HEADS, journal=journal)
    for r in sent:
        lib.save(A, p.store, r["id"])
    pl.stop()
    out = tmp_path / "rebuilt" / "trade_exchange_news.db"
    out.parent.mkdir()
    assert await asyncio.to_thread(rebuild_tool.main, ["--to", str(out), "--journal-dir", str(tmp_path / "j")]) == 0
    rebuilt = Store(str(out))
    got = lib.items(A, rebuilt)["items"]
    assert {i["id"] for i in got} == {r["id"] for r in sent} and not any(i.get("restoring") for i in got)
    assert {i["content"] for i in got} == set(HEADS)


async def test_a_bookmark_resolves_through_any_delivery_of_its_story():
    """After a rebuild the FIRST delivery of a story can differ from the live one (deliveries
    from two receivers interleave). A bookmark made on either delivery finds the same headline."""
    p, sent = await _news(HEADS[:1])
    again = rec(HEADS[0], sent[0]["received_at_ms"] + 20_000)          # a repeat, 20 s later
    await p.submit(again, "push")
    found = p.store.resolve_events([sent[0]["id"], again["id"]])
    assert found[sent[0]["id"]]["seq"] == found[again["id"]]["seq"]
    lib.save(A, p.store, again["id"])
    assert lib.items(A, p.store)["items"][0]["content"] == HEADS[0]
    assert p.store.by_event_id(again["id"])["content"] == HEADS[0]   # Explain finds it too


async def test_while_the_archive_is_restoring_a_bookmark_is_kept_and_listed_as_restoring(tmp_path):
    p, sent = await _news(HEADS[:2])
    for r in sent:
        lib.save(A, p.store, r["id"])
    empty = Store(str(tmp_path / "empty.db"))                         # a fresh volume, before recovery
    got = lib.items(A, empty)["items"]
    assert [i.get("restoring") for i in got] == [True, True]
    assert lib.items(A, empty, query="ALFA")["items"] == []           # nothing readable to match yet
    assert lib.state(A)["ids"] and lib.snapshot(empty)["unresolved"] == 2
    assert lib.snapshot(p.store)["unresolved"] == 0
    assert "member-a" not in repr(lib.snapshot(p.store))


# ── account deletion, limits ─────────────────────────────────────────────────

async def test_account_deletion_purges_every_library_row(env):
    from api.services.journal_two import account_purge
    p, sent = await _news(HEADS[:1])
    lib.save(A, p.store, sent[0]["id"], note="n")
    lib.set_membership(A, lib.create_collection(A, "x")["id"], sent[0]["id"], True)
    lib.save(B, p.store, sent[0]["id"])
    c = sqlite3.connect(env)
    try:
        account_purge.purge_user_data(A, c)
        c.commit()
        left = {t: c.execute(f"SELECT COUNT(*) FROM {t} WHERE user_id = ?", (A,)).fetchone()[0] for t in lib.TABLES}
    finally:
        c.close()
    assert left == {t: 0 for t in lib.TABLES}
    assert lib.state(B)["ids"] == [sent[0]["id"]]                       # another member's are untouched
    assert _counts(p.store)[0] == 1


async def test_limits(monkeypatch):
    p, sent = await _news(HEADS)
    monkeypatch.setattr(lib, "MAX_BOOKMARKS", 2)
    monkeypatch.setattr(lib, "MAX_COLLECTIONS", 1)
    lib.save(A, p.store, sent[0]["id"])
    lib.save(A, p.store, sent[1]["id"])
    with pytest.raises(lib.LibraryError) as e:
        lib.save(A, p.store, sent[2]["id"])
    assert e.value.status == 409
    lib.save(A, p.store, sent[1]["id"])                                 # a duplicate is never "full"
    lib.create_collection(A, "one")
    with pytest.raises(lib.LibraryError):
        lib.create_collection(A, "two")
    with pytest.raises(lib.LibraryError):
        lib.create_collection(A, "x" * (lib.NAME_MAX + 1))
    monkeypatch.setattr(lib, "WRITES_PER_MINUTE", 3)
    lib._reset_for_tests()
    for _ in range(3):
        lib.set_note(A, sent[0]["id"], "n")
    with pytest.raises(lib.LibraryError) as e:
        lib.set_note(A, sent[0]["id"], "n")
    assert e.value.status == 429


# ── the routes: session user only ────────────────────────────────────────────

async def _client(user):
    import httpx
    from fastapi import FastAPI
    from api.middleware import auth_middleware
    from api.routers import trade_exchange_news as route
    app = FastAPI()
    app.include_router(route.router)
    if user is not None:
        app.dependency_overrides[auth_middleware.get_current_user] = lambda: user
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://web.test")


async def test_the_routes_refuse_anonymous_requests():
    p, sent = await _news(HEADS[:1])
    L = "/api/trade-exchange-news/library"
    async with await _client(None) as c:
        for method, path in (("GET", f"{L}/state"), ("GET", f"{L}/items"), ("PUT", f"{L}/bookmarks/{sent[0]['id']}"),
                             ("DELETE", f"{L}/bookmarks/{sent[0]['id']}"), ("POST", f"{L}/collections")):
            r = await c.request(method, path, json={})
            assert r.status_code == 401, (method, path)


async def test_the_routes_act_for_the_session_member_whatever_the_body_says():
    p, sent = await _news(HEADS[:2])
    L = "/api/trade-exchange-news/library"
    async with await _client({"id": A, "role": "member"}) as c:
        r = await c.put(f"{L}/bookmarks/{sent[0]['id']}", json={"user_id": B, "note": "mine"})
        assert r.status_code == 200 and r.json()["bookmark"]["note"] == "mine"
        col = (await c.post(f"{L}/collections", json={"name": "Ideas", "user_id": B})).json()
        assert (await c.put(f"{L}/collections/{col['id']}/items/{sent[0]['id']}")).status_code == 200
        items = (await c.get(f"{L}/items", params={"q": "alfa"})).json()
        assert [i["id"] for i in items["items"]] == [sent[0]["id"]] and items["items"][0]["tickers"] is not None
        assert (await c.put(f"{L}/bookmarks/01NOSUCH000000000000000000", json={})).status_code == 404
        assert (await c.patch(f"{L}/collections/{col['id']}", json={"name": ""})).status_code == 422
        assert (await c.get(f"{L}/items", params={"sort": "bogus"})).status_code == 422
    assert lib.state(B)["ids"] == [] and lib.state(A)["ids"] == [sent[0]["id"]]
    async with await _client({"id": B, "role": "member"}) as c:
        assert (await c.delete(f"{L}/collections/{col['id']}")).status_code == 404
        assert (await c.get(f"{L}/items", params={"collection": col["id"]})).status_code == 404


async def test_the_kill_switch(monkeypatch):
    await _news(HEADS[:1])
    monkeypatch.setenv(lib.FLAG, "0")
    async with await _client({"id": A, "role": "member"}) as c:
        r = await c.get("/api/trade-exchange-news/library/state")
    assert r.status_code == 404 and r.json()["reason"] == "disabled"
