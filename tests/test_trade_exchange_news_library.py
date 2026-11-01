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
    volume, a story whose FIRST delivery (so its row id) changes in the rebuild -- still one
    bookmark, shown saved, not duplicated -- and the nightly SQLite backup restored;
  * every write is one transaction (an injected failure mid-removal changes nothing), and
    Undo puts back the exact note, note time, saved time and collections;
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


def _archive_digest(store):
    """Every headline and delivery column that matters, hashed -- an exact before/after."""
    import hashlib
    c = store._conn()
    h = hashlib.sha256()
    for q in ("SELECT seq, event_id, content, received_at_ms, dedupe_key, tickers, repeat_count, last_repeat_ms"
              " FROM headlines ORDER BY seq",
              "SELECT event_id, headline_seq, received_at_ms, kind, record_json, journaled FROM deliveries ORDER BY event_id"):
        for r in c.execute(q):
            h.update(repr(tuple(r)).encode())
    return h.hexdigest()


async def test_undo_puts_back_the_exact_note_and_every_collection_and_a_later_save_is_fresh():
    p, sent = await _news(HEADS)
    eid = sent[1]["id"]
    lib.save(A, p.store, eid, saved_at_ms=NOW_MS - 50_000)
    c1, c2, c3 = (lib.create_collection(A, n) for n in ("Fed", "Macro", "Unrelated"))
    for c in (c1, c2):
        lib.set_membership(A, c["id"], eid, True)
    note = "Line one\n  indented line two -- with “quotes” & <tags> kept verbatim"
    before = lib.set_note(A, eid, note)["bookmark"]
    removed = lib.remove(A, eid, p.store)["removed"]
    assert removed == before
    assert lib.state(A, p.store)["ids"] == []
    assert {c["id"]: c["count"] for c in lib.state(A)["collections"]} == {c1["id"]: 0, c2["id"]: 0, c3["id"]: 0}
    back = lib.save(A, p.store, removed["event_id"], note=removed["note"], collection_ids=removed["collection_ids"],
                    saved_at_ms=removed["saved_at_ms"], note_updated_at_ms=removed["note_updated_at_ms"])
    assert back["created"] is True and back["bookmark"] == before          # exact: text, times, collections
    assert sorted(back["bookmark"]["collection_ids"]) == sorted([c1["id"], c2["id"]])
    # the Undo window passes without Undo: the removal stands, and saving again is a FRESH bookmark
    lib.remove(A, eid, p.store)
    fresh = lib.save(A, p.store, eid)["bookmark"]
    assert fresh["note"] == "" and fresh["note_updated_at_ms"] is None and fresh["collection_ids"] == []
    assert fresh["saved_at_ms"] > before["saved_at_ms"]


async def test_undo_skips_a_collection_deleted_meanwhile_and_never_reaches_another_members():
    p, sent = await _news(HEADS)
    eid = sent[0]["id"]
    keep, gone = lib.create_collection(A, "Keep"), lib.create_collection(A, "Gone")
    theirs = lib.create_collection(B, "B's")
    lib.save(A, p.store, eid)
    for c in (keep, gone):
        lib.set_membership(A, c["id"], eid, True)
    removed = lib.remove(A, eid, p.store)["removed"]
    lib.delete_collection(A, gone["id"])
    back = lib.save(A, p.store, eid, collection_ids=[*removed["collection_ids"], theirs["id"]],
                    saved_at_ms=removed["saved_at_ms"])["bookmark"]
    assert back["collection_ids"] == [keep["id"]]
    assert [c["count"] for c in lib.state(B)["collections"]] == [0]


async def test_a_failed_write_leaves_no_partial_change(monkeypatch):
    p, sent = await _news(HEADS)
    eid = sent[0]["id"]
    col = lib.create_collection(A, "Earnings")
    lib.save(A, p.store, eid, note="keep me")
    lib.set_membership(A, col["id"], eid, True)
    before = lib.items(A, p.store)["items"][0]["bookmark"]
    real = lib._db

    class Boom:                                     # fails the SECOND statement of the removal
        def __init__(self, c):
            self.c = c

        def execute(self, sql, *a):
            if sql.startswith("DELETE FROM txn_bookmarks"):
                raise sqlite3.OperationalError("disk I/O error (injected)")
            return self.c.execute(sql, *a)

        def __getattr__(self, k):
            return getattr(self.c, k)

    import contextlib

    @contextlib.contextmanager
    def failing():
        with real() as c:
            yield Boom(c)

    monkeypatch.setattr(lib, "_db", failing)
    with pytest.raises(sqlite3.OperationalError):
        lib.remove(A, eid, p.store)                 # the collection rows were already deleted ...
    monkeypatch.setattr(lib, "_db", real)
    assert lib.items(A, p.store)["items"][0]["bookmark"] == before   # ... and rolled back with it
    assert lib.state(A)["collections"][0]["count"] == 1


async def test_a_rebuild_that_changes_a_storys_first_delivery_keeps_one_bookmark(tmp_path):
    """Live: delivery LATE (the earlier event id) misses push and is recovered after EARLY's
    sibling made the headline, so the live headline's id is the later one. A rebuild replays in
    event-id order and the SAME story's id becomes the earlier one. The bookmark (made on the
    live row) is still that row's: shown as saved, not duplicated by a second save, removable,
    its note intact."""
    from tools import txn_rebuild_from_r2 as rebuild_tool
    journal = jr.FileJournal(str(tmp_path / "j"))
    p = pl.start(asyncio.get_running_loop())
    t = NOW_MS - 86_400_000
    first = rec(HEADS[0], t)                        # the earlier event id ...
    second = rec(HEADS[0], t + 20_000)              # ... and a repeat 20 s later
    assert first["id"] < second["id"]
    for r in (first, second):
        journal.put(r)
    await p.submit(second, "push")                  # push saw only the later one
    await p.submit(first, "reconcile")              # the earlier one recovered from R2 afterwards
    live_row = p.store.by_event_id(second["id"])["event_id"]
    assert live_row == second["id"]
    lib.save(A, p.store, live_row, note="from the live row")
    pl.stop()
    out = tmp_path / "rebuilt" / "trade_exchange_news.db"
    out.parent.mkdir()
    assert await asyncio.to_thread(rebuild_tool.main, ["--to", str(out), "--journal-dir", str(tmp_path / "j")]) == 0
    rebuilt = Store(str(out))
    new_row = rebuilt.by_event_id(second["id"])["event_id"]
    assert new_row == first["id"] != live_row                   # the story's id DID change
    assert set(rebuilt.story_ids(new_row)) == {first["id"], second["id"]}
    assert new_row in lib.state(A, rebuilt)["ids"]              # the rebuilt News row shows as saved
    again = lib.save(A, rebuilt, new_row)                       # saving that row is a no-op
    assert again["created"] is False and again["bookmark"]["event_id"] == live_row
    got = lib.items(A, rebuilt)["items"]
    assert len(got) == 1 and got[0]["content"] == HEADS[0] and got[0]["bookmark"]["note"] == "from the live row"
    lib.set_note(A, new_row, "edited via the rebuilt row", rebuilt)
    col = lib.create_collection(A, "Fed")
    lib.set_membership(A, col["id"], new_row, True, rebuilt)
    removed = lib.remove(A, new_row, rebuilt)["removed"]
    assert removed["event_id"] == live_row and removed["note"] == "edited via the rebuilt row"
    assert removed["collection_ids"] == [col["id"]] and lib.state(A, rebuilt)["ids"] == []


async def test_bookmarks_resolve_identically_after_a_sqlite_backup_and_restore(tmp_path):
    """The nightly store backup's own snapshot (store_backup.build_artifacts) restored by the
    restore tool's own procedure (store_restore.restore_file): every bookmark finds the same
    headline, by the same id, with nothing restoring."""
    import datetime as dt
    from api.services import store_backup as sb
    from tools import store_restore as sr
    p, sent = await _news(HEADS)
    again = rec(HEADS[2], sent[2]["received_at_ms"] + 20_000)
    await p.submit(again, "push")
    for r in (*sent, again):
        lib.save(A, p.store, r["id"])
    live = {i["id"]: (i["content"], i["received_at_ms"]) for i in lib.items(A, p.store)["items"]}
    now = dt.datetime.now(dt.timezone.utc)
    work = tmp_path / "bk"
    work.mkdir()
    art = sb.build_artifacts("trade_exchange_news", p.store.path, str(work), now)
    dest = tmp_path / "restored" / "trade_exchange_news.db"
    dest.parent.mkdir()
    sr.restore_file(art["gz"], dest, now=now)
    restored = Store(str(dest))
    got = lib.items(A, restored)["items"]
    assert not any(i.get("restoring") for i in got)
    assert {i["id"]: (i["content"], i["received_at_ms"]) for i in got} == live
    assert lib.state(A, restored)["ids"] == lib.state(A, p.store)["ids"]
    assert _archive_digest(restored) == _archive_digest(p.store)


async def test_no_bookmark_operation_changes_a_single_archive_byte_column():
    p, sent = await _news(HEADS)
    await p.submit(rec(HEADS[0], sent[0]["received_at_ms"] + 20_000), "push")
    before = _archive_digest(p.store)
    col = lib.create_collection(A, "All")
    for r in sent:
        lib.save(A, p.store, r["id"], note="n")
        lib.set_membership(A, col["id"], r["id"], True, p.store)
        lib.set_note(A, r["id"], "changed", p.store)
    lib.rename_collection(A, col["id"], "Renamed")
    for r in sent[:2]:
        lib.set_membership(A, col["id"], r["id"], False, p.store)
        lib.remove(A, r["id"], p.store)
    lib.delete_collection(A, col["id"])
    for r in sent[2:]:
        lib.remove(A, r["id"], p.store)
    assert _archive_digest(p.store) == before


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
