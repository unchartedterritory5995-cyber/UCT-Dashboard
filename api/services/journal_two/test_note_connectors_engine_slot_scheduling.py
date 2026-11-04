"""Evernote pass scheduling: the shared pass slots made fair before every member gets Evernote.

  D4-1  the follow-up job claims at most the free slots, oldest stamp first, and runs only those
        (refilling as passes end), so no claimed source sits leased, logged and "syncing now"
        while it waits for a slot.
  D4-2  a member's pass (Sync now, a first sync) goes ahead of background waiters; while a pass
        waits for a slot the source reads "queued" (no log row is opened yet).
  D4-3  the hourly and nightly loops never wait for a slot: no slot means skip (hourly) or a
        booked follow-up flagged as a full pass (nightly), which the pool runs as a full pass.
        A non-Evernote source's hourly pass never waits on Evernote work.
  NEW-4 the import write transactions of opt-in passes are serialized by one process lock, taken
        off the event loop and never across a network call.
  NEW-5 `sync_state` is patched one key at a time, so writers never lose each other's update.
  NEW-7 a note the member trashed during an import is not brought back while the remote is
        unchanged; a remote edit after the trash still imports (import_confirm's rule).
  Cancellation: a waiter cancelled while polling never takes a slot; a holder cancelled mid-pass
        gives it back.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.note_connectors import engine
from api.services.journal_two.note_connectors.providers.base import RemoteRef
from api.services.journal_two.test_note_connectors_engine import (  # noqa: F401  (fixtures)
    FakeProvider, _rn, db,
)
from api.services.journal_two.test_note_connectors_engine_rate_limit_round1 import (
    PerRefProvider, _row, _seed, _state,
)


@pytest.fixture(autouse=True)
def _fresh_slots(monkeypatch):
    """The pass slots are module state: every test starts with all of them free and no waiter,
    and polls quickly."""
    monkeypatch.setattr(engine, "PASS_SLOT_POLL_S", 0.01)
    # The queue's own rules are railed here without the reserved member slot (fix round 1,
    # concern 1), which `test_note_connectors_engine_slot_scheduling_r1.py` rails on top.
    monkeypatch.setattr(engine, "MEMBER_RESERVED_SLOTS", 0)
    with engine._PASS_SLOTS_LOCK:
        engine._pass_slots_used = 0
        engine._member_slots_used = 0
        engine._slot_waiters.clear()
    yield
    with engine._PASS_SLOTS_LOCK:
        engine._pass_slots_used = 0
        engine._member_slots_used = 0
        engine._slot_waiters.clear()


def _hold_all_slots() -> int:
    held = 0
    while engine._try_acquire_pass_slot():
        held += 1
    return held


def _release(n: int) -> None:
    for _ in range(n):
        engine._release_pass_slot()


def _log_rows(sid):
    conn = auth_db.get_connection()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM j2_note_sync_log WHERE source_id = ? ORDER BY id", (sid,)).fetchall()]
    finally:
        conn.close()


def _due(db, sid, ago_s: float = 1.0):
    db.set_follow_up("u1", sid, (datetime.now(timezone.utc) - timedelta(seconds=ago_s)).isoformat())


class Gate(PerRefProvider):
    """An opt-in provider whose listing waits on an event, recording who is listing."""

    def __init__(self, name, live, gate=None):
        super().__init__()
        self.sname = name
        self.live = live
        self.gate = gate
        _seed(self, 1)

    async def list_changed(self, credentials, cursor=None):
        self.live["now"] += 1
        self.live["peak"] = max(self.live["peak"], self.live["now"])
        self.live["order"].append(self.sname)
        try:
            if self.gate is not None:
                await self.gate.wait()
            else:
                await asyncio.sleep(0.03)
            return await super().list_changed(credentials, cursor)
        finally:
            self.live["now"] -= 1


def _factory_by_remote(providers: dict):
    return lambda name, source=None: providers[source["remoteId"]]


# ── D4-1: the follow-up job claims only what it can run ───────────────────────

async def test_the_follow_up_job_claims_at_most_the_free_slots(db, monkeypatch):
    live = {"now": 0, "peak": 0, "order": []}
    db.upsert_connector("u1", "fake", {"token": "abc"})
    providers = {}
    sids = []
    for i in range(4):
        providers[f"g{i}"] = Gate(f"g{i}", live)
        sids.append(db.create_source("u1", "fake", f"g{i}")["id"])
    monkeypatch.setattr(engine, "_provider_factory", _factory_by_remote(providers))
    for i, sid in enumerate(sids):
        _due(db, sid, ago_s=100 - i)  # g0 is the oldest stamp
    held = 2
    assert engine._try_acquire_pass_slot() and engine._try_acquire_pass_slot()
    in_flight = {"peak": 0}
    real_try = engine._try_acquire_source

    def spy(source_id):
        ok = real_try(source_id)
        with engine._inflight_lock:
            in_flight["peak"] = max(in_flight["peak"], len(engine._inflight_sources))
        return ok

    monkeypatch.setattr(engine, "_try_acquire_source", spy)
    try:
        out = await engine.sync_follow_up_sources()
    finally:
        _release(held)
    assert out["ran"] == 4
    assert live["peak"] == 1  # one free slot: one pass at a time, never a crowd of waiters
    assert in_flight["peak"] == 1  # no claimed source held its in-flight lock while it waited
    assert live["order"] == ["g0", "g1", "g2", "g3"]  # oldest stamp first


async def test_with_no_free_slot_the_follow_up_job_claims_nothing_and_leases_nothing(db, monkeypatch):
    p = PerRefProvider()
    _seed(p, 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    _due(db, sid)
    stamp = _row(db, sid)["warmingUntil"]
    held = _hold_all_slots()
    try:
        out = await engine.sync_follow_up_sources()
    finally:
        _release(held)
    assert out["ran"] == 0 and out["waiting"] == 1
    assert _row(db, sid)["warmingUntil"] == stamp  # not leased: the next tick takes it
    assert _log_rows(sid) == []


async def test_the_follow_up_job_refills_a_slot_as_soon_as_a_pass_ends(db, monkeypatch):
    # The tail: with every pass launched at once and max_instances=1, a slot freed early idled
    # until the slowest pass ended. Here g0 is slow and g1..g3 are quick: the slot g1 or g2 gives
    # back goes to g3 while g0 is still running.
    live = {"now": 0, "peak": 0, "order": []}
    slow_gate = asyncio.Event()
    db.upsert_connector("u1", "fake", {"token": "abc"})
    providers = {"g0": Gate("g0", live, slow_gate)}
    for i in range(1, 4):
        providers[f"g{i}"] = Gate(f"g{i}", live)
    sids = [db.create_source("u1", "fake", f"g{i}")["id"] for i in range(4)]
    for i, sid in enumerate(sids):
        _due(db, sid, ago_s=100 - i)
    monkeypatch.setattr(engine, "_provider_factory", _factory_by_remote(providers))
    job = asyncio.create_task(engine.sync_follow_up_sources())
    for _ in range(500):
        if "g3" in live["order"]:
            break
        await asyncio.sleep(0.01)
    assert "g3" in live["order"] and not job.done()  # g3 ran while g0 still held its slot
    slow_gate.set()
    out = await job
    assert out["ran"] == 4 and live["peak"] <= engine.FOLLOW_UP_CONCURRENCY


# ── D4-2: member passes first, and "queued" while waiting ─────────────────────

async def test_a_member_sync_now_goes_ahead_of_background_waiters(db, monkeypatch):
    live = {"now": 0, "peak": 0, "order": []}
    db.upsert_connector("u1", "fake", {"token": "abc"})
    providers = {n: Gate(n, live) for n in ("bg1", "bg2", "member")}
    sids = {n: db.create_source("u1", "fake", n)["id"] for n in providers}
    for n in ("bg1", "bg2", "member"):
        db.record_sync_result("u1", sids[n], ok=True, status="ok")  # synced before: not a first sync
    monkeypatch.setattr(engine, "_provider_factory", _factory_by_remote(providers))
    held = _hold_all_slots()
    bg = [asyncio.create_task(engine.sync_source(sids[n], manual=True)) for n in ("bg1", "bg2")]
    await asyncio.sleep(0.05)  # both background passes are waiting
    member = asyncio.create_task(engine.sync_source(sids["member"], member=True))
    await asyncio.sleep(0.05)
    assert engine.is_source_queued(sids["member"]) and engine.is_source_queued(sids["bg1"])
    _release(1)  # one slot frees: the member's pass takes it
    await member
    assert live["order"][0] == "member"
    await asyncio.gather(*bg)  # one slot cycling: the queue's order is the run order
    _release(held - 1)
    assert live["order"] == ["member", "bg1", "bg2"]  # then FIFO


async def test_a_first_sync_goes_ahead_of_background_waiters(db, monkeypatch):
    live = {"now": 0, "peak": 0, "order": []}
    db.upsert_connector("u1", "fake", {"token": "abc"})
    providers = {n: Gate(n, live) for n in ("bg", "first")}
    sids = {n: db.create_source("u1", "fake", n)["id"] for n in providers}
    db.record_sync_result("u1", sids["bg"], ok=True, status="ok")
    monkeypatch.setattr(engine, "_provider_factory", _factory_by_remote(providers))
    held = _hold_all_slots()
    bg = asyncio.create_task(engine.sync_source(sids["bg"], manual=True))
    await asyncio.sleep(0.05)
    first = asyncio.create_task(engine.sync_source(sids["first"], manual=True))  # never synced
    await asyncio.sleep(0.05)
    _release(1)
    await first
    assert live["order"] == ["first"]
    _release(held - 1)
    await bg


async def test_a_waiting_pass_reads_queued_and_opens_no_log_row(db, monkeypatch):
    p = PerRefProvider()
    _seed(p, 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    held = _hold_all_slots()
    task = asyncio.create_task(engine.sync_source(sid, member=True))
    await asyncio.sleep(0.05)
    assert engine.is_source_queued(sid) and engine.is_source_busy(sid)
    assert _log_rows(sid) == []  # no "syncing" row for a pass that has not started
    _release(held)
    result = await task
    assert result["status"] == "ok" and not engine.is_source_queued(sid)
    assert len(_log_rows(sid)) == 1


# ── D4-3: the serial loops never wait ─────────────────────────────────────────

class Plain(PerRefProvider):
    follow_up_on_rate_limit = False


def _two_providers(db, monkeypatch, opt_in, plain):
    db.upsert_connector("u1", "fake", {"token": "abc"})
    db.upsert_connector("u1", "plain", {"token": "abc"})
    ev = db.create_source("u1", "fake", "ev")["id"]
    pl = db.create_source("u1", "plain", "pl")["id"]
    monkeypatch.setattr(engine, "_provider_factory",
                        lambda name, source=None: opt_in if name == "fake" else plain)
    monkeypatch.setattr(engine, "_pooled_provider", lambda name: name == "fake")
    return ev, pl


async def test_the_hourly_tick_skips_an_opt_in_source_with_no_free_slot(db, monkeypatch):
    ev_p, pl_p = PerRefProvider(), Plain()
    _seed(ev_p, 1)
    _seed(pl_p, 1)
    ev, pl = _two_providers(db, monkeypatch, ev_p, pl_p)
    held = _hold_all_slots()
    try:
        t0 = time.monotonic()
        await asyncio.wait_for(engine.sync_due_sources(), timeout=5)
        elapsed = time.monotonic() - t0
    finally:
        _release(held)
    assert elapsed < 2  # never waited for a slot
    assert _log_rows(ev) == [] and ev_p.list_changed_calls == []  # skipped
    assert len(_log_rows(pl)) == 1  # the non-Evernote source synced


async def test_a_non_evernote_hourly_pass_never_waits_on_an_evernote_pass(db, monkeypatch):
    # The opt-in pass gets a slot and runs for a while; the plain source listed AFTER it in the
    # tick starts before that pass ends, so Evernote work never delays it.
    started = {}
    gate = asyncio.Event()

    class SlowEv(PerRefProvider):
        async def list_changed(self, credentials, cursor=None):
            started["ev"] = time.monotonic()
            await gate.wait()
            return await super().list_changed(credentials, cursor)

    class QuickPlain(Plain):
        async def list_changed(self, credentials, cursor=None):
            started["pl"] = time.monotonic()
            gate.set()
            return await super().list_changed(credentials, cursor)

    ev_p, pl_p = SlowEv(), QuickPlain()
    _seed(ev_p, 1)
    _seed(pl_p, 1)
    ev, pl = _two_providers(db, monkeypatch, ev_p, pl_p)
    # The opt-in source sorts first in the due list (never synced, before one synced 2 h ago).
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_note_sources SET last_sync_at = ? WHERE id = ?",
                 ((datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(), pl))
    conn.commit()
    conn.close()
    assert [s["id"] for s in db.list_due_sources(30)] == [ev, pl]
    await asyncio.wait_for(engine.sync_due_sources(), timeout=5)
    assert "pl" in started and len(_log_rows(ev)) == 1 and len(_log_rows(pl)) == 1


async def test_the_nightly_pass_with_no_free_slot_books_a_full_follow_up(db, monkeypatch):
    ev_p, pl_p = PerRefProvider(), Plain()
    _seed(ev_p, 2)
    _seed(pl_p, 1)
    ev, pl = _two_providers(db, monkeypatch, ev_p, pl_p)
    held = _hold_all_slots()
    try:
        await asyncio.wait_for(engine.sync_all_active_sources_full(), timeout=5)
    finally:
        _release(held)
    assert _log_rows(ev) == []
    assert _state(db, ev).get("fullPending") is True
    stamp = datetime.fromisoformat(_row(db, ev)["warmingUntil"])
    assert stamp <= datetime.now(timezone.utc)  # due now
    assert _row(db, pl)["lastFullSyncAt"] is not None  # the plain source's removal check ran
    # The pool then runs it AS A FULL PASS: the removal check still runs tonight.
    out = await engine.sync_follow_up_sources()
    assert out["ran"] == 1
    assert ev_p.list_changed_calls == [None]  # a full pass re-lists from scratch
    assert _row(db, ev)["lastFullSyncAt"] is not None
    assert "fullPending" not in _state(db, ev)
    assert _row(db, ev)["warmingUntil"] is None  # nothing left over


async def test_a_pass_that_ends_clean_keeps_a_pending_full_pass_due(db, monkeypatch):
    # The flag survives an incremental pass that would otherwise clear the stamp.
    p = PerRefProvider()
    _seed(p, 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    db.set_follow_up("u1", sid, (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat())
    db.patch_sync_state("u1", sid, set_keys={"fullPending": True})
    await engine.sync_source(sid, member=True)  # incremental, nothing left over
    assert _row(db, sid)["warmingUntil"] is not None
    assert _state(db, sid).get("fullPending") is True


# ── NEW-4: serialized import writes ───────────────────────────────────────────

async def test_opt_in_import_confirms_are_serialized_off_the_loop(db, monkeypatch):
    real = notes_svc.import_confirm
    seen = {"now": 0, "peak": 0, "threads": set()}
    lock = threading.Lock()

    def spy(*a, **kw):
        with lock:
            seen["now"] += 1
            seen["peak"] = max(seen["peak"], seen["now"])
            seen["threads"].add(threading.get_ident())
        try:
            time.sleep(0.05)
            return real(*a, **kw)
        finally:
            with lock:
                seen["now"] -= 1

    monkeypatch.setattr(notes_svc, "import_confirm", spy)
    monkeypatch.setattr(engine, "IMPORT_WRITE_GAP_S", 0.0)  # the gap alone must not serialize
    db.upsert_connector("u1", "fake", {"token": "abc"})
    providers = {}
    sids = []
    for i in range(3):
        p = PerRefProvider()
        p.refs = [RemoteRef(remote_id=f"s{i}n", updated_at="2026-08-01T00:00:00+00:00")]
        p.notes_by_id = {f"s{i}n": _rn(f"s{i}n", f"Note {i}")}
        providers[f"s{i}"] = p
        sids.append(db.create_source("u1", "fake", f"s{i}")["id"])
    monkeypatch.setattr(engine, "_provider_factory", _factory_by_remote(providers))
    results = await asyncio.gather(*(engine.sync_source(s, manual=True) for s in sids))
    assert all(r["created"] == 1 for r in results)
    assert seen["peak"] == 1  # one import write transaction at a time
    assert threading.get_ident() not in seen["threads"]  # never on the event loop thread


async def test_the_import_write_lock_is_not_held_while_media_downloads(db, monkeypatch):
    from api.services.journal_two.test_note_connectors_engine import PNG_BYTES
    p = PerRefProvider()
    p.refs = [RemoteRef(remote_id="n", updated_at="2026-08-01T00:00:00+00:00")]
    rn = _rn("n", "With image", media=[{"ref": "img", "kind": "image", "name": "a.png"}])
    rn.doc["content"].append({"type": "image", "attrs": {"src": "import-ref://img"}})
    p.notes_by_id = {"n": rn}
    p.media_by_ref["img"] = (PNG_BYTES, "image/png")
    held_during_media = []
    real_media = p.fetch_media

    async def media(credentials, ref):
        held_during_media.append(engine._IMPORT_WRITE_LOCK.locked())
        return await real_media(credentials, ref)

    p.fetch_media = media
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    result = await engine.sync_source(sid, manual=True)
    assert result["mediaUploaded"] == 1
    assert held_during_media == [False]


# ── NEW-5: key-level sync_state writes ────────────────────────────────────────

def test_a_pass_saving_its_state_keeps_a_key_another_writer_set_meanwhile(db):
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    db.patch_sync_state("u1", sid, set_keys={"pace": {"intervalS": 2.0, "learnedAt": "x"}})
    source = db.get_source_by_id(sid)  # the pass reads its state here
    state = engine._load_sync_state(source)
    assert db.bump_sync_state_counter("u1", sid, "followUpErrors") == 1  # the job, meanwhile
    state["importing"] = {"since": "2026-11-03T00:00:00+00:00", "zeroPasses": 1}
    state.pop("pace")
    engine._save_sync_state("u1", sid, source, state)
    assert _state(db, sid) == {"followUpErrors": 1,
                               "importing": {"since": "2026-11-03T00:00:00+00:00", "zeroPasses": 1}}


async def test_the_follow_up_bookkeeping_never_drops_the_passs_state(db, monkeypatch):
    # `_note_follow_up_outcome` used to write back the whole blob it read after the pass.
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    stale = db.get_source_by_id(sid)
    db.patch_sync_state("u1", sid, set_keys={"importing": {"since": "s", "zeroPasses": 2}})
    real_get = db.get_source_by_id
    monkeypatch.setattr(engine.connections, "get_source_by_id",
                        lambda source_id: stale if source_id == sid else real_get(source_id))
    engine._note_follow_up_outcome(stale, failed=True)
    monkeypatch.setattr(engine.connections, "get_source_by_id", real_get)
    assert _state(db, sid) == {"followUpErrors": 1, "importing": {"since": "s", "zeroPasses": 2}}


def test_patch_sync_state_survives_a_corrupt_blob_and_clears_to_null(db):
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    db.set_sync_state("u1", sid, "not json")
    db.patch_sync_state("u1", sid, set_keys={"a": 1})
    assert _state(db, sid) == {"a": 1}
    db.patch_sync_state("u1", sid, remove_keys=["a"])
    assert _row(db, sid)["syncState"] is None
    with pytest.raises(ValueError):
        db.patch_sync_state("u1", sid, set_keys={"a.b": 1})


# ── NEW-7: a note trashed during an import stays trashed ──────────────────────

def _trash(note_key: str):
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_notes SET deleted_at = ? WHERE import_key = ?",
                     (datetime.now(timezone.utc).isoformat(), note_key))
        conn.commit()
    finally:
        conn.close()


def _live_and_trashed(user_id="u1"):
    conn = auth_db.get_connection()
    try:
        rows = conn.execute("SELECT title, deleted_at FROM j2_notes WHERE user_id = ? "
                            "AND import_key IS NOT NULL", (user_id,)).fetchall()
        return ([r["title"] for r in rows if r["deleted_at"] is None],
                [r["title"] for r in rows if r["deleted_at"] is not None])
    finally:
        conn.close()


async def test_a_note_trashed_during_an_import_is_not_brought_back(db, monkeypatch):
    p = PerRefProvider()
    _seed(p, 3)
    p.limited = {"p2"}  # the import is cut short: the cursor is held, p0/p1 are listed again
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    await engine.sync_source(sid, manual=True)
    key = p.import_key("g", "p1")
    _trash(key)  # the member trashes Note 1 in UCT while the import is still running
    p.limited = set()
    before = len(p.fetch_calls)
    result = await engine.sync_source(sid, manual=True)
    assert "p1" not in p.fetch_calls[before:]
    live, trashed = _live_and_trashed()
    assert sorted(live) == ["Note 0", "Note 2"] and trashed == ["Note 1"]
    assert result["status"] == "ok" and _row(db, sid)["cursor"] is not None  # it counts as done
    await engine.sync_source(sid, full=True, manual=True)  # the nightly pass respects it too
    assert sorted(_live_and_trashed()[0]) == ["Note 0", "Note 2"]


async def test_a_trashed_note_edited_remotely_afterwards_stays_in_the_trash(db, monkeypatch):
    # The remote changed after the trash, so NEW-7's skip does not apply. Fix round 1 (concern
    # 2): the note is fetched and its new content kept IN the trashed row; nothing comes back
    # and nothing is reported (before, import_confirm's partial UNIQUE index refused the fresh
    # INSERT and the note was "not stored" every pass).
    p = PerRefProvider()
    _seed(p, 2)
    p.limited = {"p1"}
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    await engine.sync_source(sid, manual=True)
    _trash(p.import_key("g", "p0"))
    p.limited = set()
    p.refs[0] = RemoteRef(remote_id="p0", updated_at="2026-09-09T00:00:00+00:00")
    p.notes_by_id["p0"] = _rn("p0", "Note 0 edited", updated_at="2026-09-09T00:00:00+00:00")
    before = len(p.fetch_calls)
    result = await engine.sync_source(sid, manual=True)
    assert "p0" in p.fetch_calls[before:]  # fetched: the trash skip did not fire
    live, trashed = _live_and_trashed()
    assert live == ["Note 1"] and trashed == ["Note 0 edited"]
    assert result["created"] == 1 and not result["failures"]


# ── Cancellation rail ─────────────────────────────────────────────────────────

async def test_a_waiter_cancelled_while_polling_never_takes_a_slot():
    held = _hold_all_slots()
    waiter = asyncio.create_task(engine._acquire_pass_slot("s1", priority=engine.SLOT_BACKGROUND))
    await asyncio.sleep(0.05)
    assert engine.is_source_queued("s1")
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    assert not engine.is_source_queued("s1") and engine._slot_waiters == []
    _release(held)
    await asyncio.sleep(0.05)
    assert engine._pass_slots_in_use() == 0  # the cancelled waiter took nothing
    assert engine._try_acquire_pass_slot()  # and does not block the queue
    _release(1)


async def test_a_holder_cancelled_mid_pass_gives_its_slot_back(db, monkeypatch):
    gate = asyncio.Event()
    entered = asyncio.Event()

    class Hang(PerRefProvider):
        async def list_changed(self, credentials, cursor=None):
            entered.set()
            await gate.wait()

    p = Hang()
    _seed(p, 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    task = asyncio.create_task(engine.sync_source(sid, manual=True))
    await asyncio.wait_for(entered.wait(), timeout=5)
    assert engine._pass_slots_in_use() == 1
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert engine._pass_slots_in_use() == 0 and not engine.is_source_busy(sid)
    assert p.aclose_calls == 1


async def test_a_serial_loops_try_never_takes_a_slot_a_waiter_is_lined_up_for():
    held = _hold_all_slots()
    waiter = asyncio.create_task(engine._acquire_pass_slot("w", priority=engine.SLOT_BACKGROUND))
    await asyncio.sleep(0.03)
    _release(1)  # a slot frees; the waiter has not polled yet
    assert engine._try_acquire_pass_slot() is False  # the serial loop does not jump the queue
    await asyncio.wait_for(waiter, timeout=5)  # the waiter gets it
    assert engine._pass_slots_in_use() == held
    _release(held)


def test_the_follow_up_room_leaves_out_slots_a_waiter_is_lined_up_for():
    with engine._PASS_SLOTS_LOCK:
        engine._pass_slots_used = 1
        engine._slot_waiters.append((engine.SLOT_MEMBER, -1, "member"))
    assert engine._pass_slot_room() == engine.FOLLOW_UP_CONCURRENCY - 2


def _fill_hour_of_passes(sid):
    conn = auth_db.get_connection()
    try:
        now = datetime.now(timezone.utc)
        for i in range(engine.FOLLOW_UP_MAX_PASSES_PER_HOUR):
            conn.execute("INSERT INTO j2_note_sync_log (source_id, user_id, started_at) "
                         "VALUES (?, 'u1', ?)", (sid, (now - timedelta(minutes=i + 1)).isoformat()))
        conn.commit()
    finally:
        conn.close()


async def test_the_hourly_bound_never_drops_a_pending_full_pass(db, monkeypatch):
    p = PerRefProvider()
    _seed(p, 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    other = db.create_source("u1", "fake", "h")["id"]
    for s in (sid, other):
        _fill_hour_of_passes(s)
        _due(db, s)
    db.patch_sync_state("u1", sid, set_keys={"fullPending": True})
    out = await engine.sync_follow_up_sources()
    assert out["ran"] == 0
    assert _row(db, other)["warmingUntil"] is None  # an ordinary follow-up is left to the tick
    stamp = datetime.fromisoformat(_row(db, sid)["warmingUntil"])
    assert stamp > datetime.now(timezone.utc) + timedelta(minutes=50)  # the full pass waits an hour
    assert _state(db, sid).get("fullPending") is True
    # ...and the same rule where a pass books its own follow-up (`_schedule_follow_up`).
    db.set_follow_up("u1", sid, None)
    assert engine._schedule_follow_up("u1", sid, [1.0]) is False
    assert _row(db, sid)["warmingUntil"] is not None


async def test_a_full_follow_up_with_leftovers_still_settles_the_pending_full_pass(db, monkeypatch):
    # An import still running when the nightly pass was booked: the full pass runs (its listing
    # and removal check), leaves leftovers, and the follow-ups after it are incremental again.
    p = PerRefProvider()
    _seed(p, 3)
    p.limited = {"p2"}
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    db.patch_sync_state("u1", sid, set_keys={"fullPending": True})
    _due(db, sid)
    await engine.sync_follow_up_sources()
    assert _row(db, sid)["lastFullSyncAt"] is not None
    assert "fullPending" not in _state(db, sid)
    assert _row(db, sid)["warmingUntil"] is not None  # the leftover's own follow-up


async def test_a_sync_now_goes_ahead_of_first_syncs_still_waiting(db, monkeypatch):
    # The storm case: many members connecting at once queue their first syncs; a member pressing
    # Sync now waits for the next free slot, not behind every first pass.
    live = {"now": 0, "peak": 0, "order": []}
    db.upsert_connector("u1", "fake", {"token": "abc"})
    providers = {n: Gate(n, live) for n in ("first1", "first2", "member")}
    sids = {n: db.create_source("u1", "fake", n)["id"] for n in providers}
    db.record_sync_result("u1", sids["member"], ok=True, status="ok")
    monkeypatch.setattr(engine, "_provider_factory", _factory_by_remote(providers))
    held = _hold_all_slots()
    firsts = [asyncio.create_task(engine.sync_source(sids[n], manual=True)) for n in ("first1", "first2")]
    await asyncio.sleep(0.05)
    member = asyncio.create_task(engine.sync_source(sids["member"], member=True))
    await asyncio.sleep(0.05)
    _release(1)
    await member
    await asyncio.gather(*firsts)  # one slot cycling: the queue's order is the run order
    _release(held - 1)
    assert live["order"] == ["member", "first1", "first2"]


async def test_only_the_head_of_the_queue_may_take_a_free_slot():
    # A free slot and a waiter ahead in the queue (here a ticket that never polls): a later
    # waiter must not take it, whatever the polling order.
    with engine._PASS_SLOTS_LOCK:
        engine._slot_waiters.append((engine.SLOT_MEMBER, -1, "ahead"))
    later = asyncio.create_task(engine._acquire_pass_slot("later", priority=engine.SLOT_BACKGROUND))
    await asyncio.sleep(0.05)
    assert not later.done() and engine._pass_slots_in_use() == 0
    with engine._PASS_SLOTS_LOCK:
        engine._slot_waiters.remove((engine.SLOT_MEMBER, -1, "ahead"))
    await asyncio.wait_for(later, timeout=5)
    _release(1)
