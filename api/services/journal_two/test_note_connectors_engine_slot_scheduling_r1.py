"""Slot scheduling, review fix round 1 (of 1d3818006d).

  N-A  a pooled pass takes `_IMPORT_WRITE_LOCK` BEFORE its first pre-confirm write (adoption
       re-keys, the conflict gate's hash baselines), so it never waits on the lock holding
       SQLite's write lock; waiting with an open transaction raises.
  N-B  the follow-up job also claims on a timer (FOLLOW_UP_CLAIM_WAKE_S), not only when a pass
       ends, so free slots do not idle behind one long pass.
  N-C  an hourly pass that finds no free slot books a follow-up due now.
  C3   pooled imports confirm in POOLED_CONFIRM_BATCH_SIZE batches and hold the lock for
       IMPORT_WRITE_GAP_S after each, so a member's save lands between importers.
  C1   a fourth slot is reserved for member presses (SLOT_MEMBER); the three background slots
       are unchanged; a press on a source already syncing never books one.
  C2   a remote edit after the member trashed the note in UCT is written INTO the trashed row
       (deleted_at kept, import_remote_rev stamped): no warning, the cursor moves, a restore
       shows the latest content.
  N-D  a background waiter is promoted to first-sync priority after SLOT_AGING_S.
  F-a  a follow-up whose pass is skipped by the destination-folder heal gives up its lease.
  F-b  a full pass that raises before its removal check counts a skipped check.
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
from api.services.journal_two.note_connectors import dest_folder, engine, errors
from api.services.journal_two.note_connectors.providers.base import RemoteRef
from api.services.journal_two.test_note_connectors_engine import (  # noqa: F401  (fixtures)
    FakeProvider, _rn, db,
)
from api.services.journal_two.test_note_connectors_engine_rate_limit_round1 import (
    PerRefProvider, _row, _seed, _state,
)
from api.services.journal_two.test_note_connectors_engine_slot_scheduling import (  # noqa: F401
    Gate, Plain, _due, _factory_by_remote, _fresh_slots, _hold_all_slots, _log_rows, _release,
    _trash, _two_providers,
)


def _hold_member_slot():
    with engine._PASS_SLOTS_LOCK:
        engine._member_slots_used += 1


def _release_member_slot():
    with engine._PASS_SLOTS_LOCK:
        engine._member_slots_used -= 1


@pytest.fixture(autouse=True)
def _fresh_member_slot(_fresh_slots, monkeypatch):
    # `_fresh_slots` (imported) rails the queue without the reserved slot; these tests have it.
    monkeypatch.setattr(engine, "MEMBER_RESERVED_SLOTS", 1)
    with engine._PASS_SLOTS_LOCK:
        engine._member_slots_used = 0
    yield
    with engine._PASS_SLOTS_LOCK:
        engine._member_slots_used = 0


def _note_rows(user_id="u1"):
    conn = auth_db.get_connection()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT id, title, import_key, deleted_at, import_remote_rev, body_plain "
            "FROM j2_notes WHERE user_id = ? AND import_key IS NOT NULL ORDER BY title", (user_id,))]
    finally:
        conn.close()


# ── N-A: no lock-order inversion ──────────────────────────────────────────────

async def _conflict_ready(db, monkeypatch, p, sid):
    """p0 stored, then edited by the member and changed remotely: the next pass writes the
    conflict gate's hash baseline before its confirm."""
    await engine.sync_source(sid, manual=True)
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_notes SET updated_at = '2099-01-01T00:00:00+00:00' WHERE import_key = ?",
                 (p.import_key("a", "p0"),))
    conn.commit()
    conn.close()
    p.refs[0] = RemoteRef(remote_id="p0", updated_at="2026-09-09T00:00:00+00:00")
    p.notes_by_id["p0"] = _rn("p0", "Note 0 remote edit", updated_at="2026-09-09T00:00:00+00:00")


async def test_a_pooled_pass_never_waits_on_the_import_lock_holding_a_write(db, monkeypatch):
    # B holds the import lock and is about to write; A, meanwhile, has a conflict baseline to
    # write before its own confirm. Before the fix A wrote it first (opening a write
    # transaction) and then waited on the lock: B's confirm sat out busy_timeout and its batch
    # was lost as "database is locked".
    a, b = PerRefProvider(), PerRefProvider()
    _seed(a, 2)
    b.refs = [RemoteRef(remote_id="b0", updated_at="2026-08-01T00:00:00+00:00")]
    b.notes_by_id = {"b0": _rn("b0", "B note")}
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sa = db.create_source("u1", "fake", "a")["id"]
    sb = db.create_source("u1", "fake", "b")["id"]
    monkeypatch.setattr(engine, "_provider_factory", _factory_by_remote({"a": a, "b": b}))
    await _conflict_ready(db, monkeypatch, a, sa)

    real = notes_svc.import_confirm
    b_inside = threading.Event()

    def confirm(user_id, payload, conn=None, **kw):
        keys = [n["importKey"] for n in payload["notes"]]
        if any(k.endswith("/b0") for k in keys):
            b_inside.set()
            time.sleep(0.4)  # A gets to its pre-confirm writes while B holds the lock
        return real(user_id, payload, conn=conn, **kw)

    monkeypatch.setattr(notes_svc, "import_confirm", confirm)
    task_b = asyncio.create_task(engine.sync_source(sb, manual=True))
    for _ in range(500):
        if b_inside.is_set():
            break
        await asyncio.sleep(0.01)
    assert b_inside.is_set()
    result_a = await engine.sync_source(sa, manual=True)
    result_b = await task_b
    assert result_b["created"] == 1 and not result_b["failures"], result_b
    assert result_a["conflicts"] == 1 and not any("locked" in f for f in result_a["failures"])
    titles = [r["title"] for r in _note_rows()]
    assert "B note" in titles and "Note 0 remote edit (synced copy)" in titles


async def test_a_pooled_pass_that_adopts_an_enex_row_beside_another_import_stores_both(db, monkeypatch):
    from api.services.journal_two.note_connectors.convert import enml

    class LiveEv(PerRefProvider):
        adopt_import_source = "evernote"

        def import_key(self, source_remote_id, remote_id):
            return enml.live_import_key(remote_id)

    created = "2026-03-04T10:15:00.000+00:00"
    notes_svc.import_confirm("u1", {"source": "evernote", "destFolderId": None, "notes": [{
        "importKey": f"evernote:Notebook/Plan/{created}", "title": "Plan",
        "bodyJson": {"type": "doc", "content": []}, "tags": [], "folderPath": ["Notebook"],
        "createdAt": created, "updatedAt": "2026-03-05T08:00:00.000+00:00"}]})
    a = LiveEv()
    a.refs = [RemoteRef(remote_id="G", updated_at="2026-06-01T09:00:00.000+00:00")]
    a.notes_by_id = {"G": _rn("G", "Plan", text="live body", created_at=created,
                              updated_at="2026-06-01T09:00:00.000+00:00")}
    b = PerRefProvider()
    b.refs = [RemoteRef(remote_id="b0", updated_at="2026-08-01T00:00:00+00:00")]
    b.notes_by_id = {"b0": _rn("b0", "B note")}
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sa = db.create_source("u1", "fake", "a")["id"]
    sb = db.create_source("u1", "fake", "b")["id"]
    monkeypatch.setattr(engine, "_provider_factory", _factory_by_remote({"a": a, "b": b}))
    real = notes_svc.import_confirm

    def confirm(user_id, payload, conn=None, **kw):
        time.sleep(0.2)
        return real(user_id, payload, conn=conn, **kw)

    monkeypatch.setattr(notes_svc, "import_confirm", confirm)
    ra, rb = await asyncio.gather(engine.sync_source(sa, manual=True),
                                  engine.sync_source(sb, manual=True))
    assert ra["adopted"] == 1 and not ra["failures"]
    assert rb["created"] == 1 and not rb["failures"]
    rows = _note_rows()
    assert sorted(r["title"] for r in rows) == ["B note", "Plan"]


def test_waiting_on_the_import_lock_with_an_open_transaction_raises(db):
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_note_sources SET sync_state = NULL WHERE 0")  # no row; opens a txn
        conn.execute("INSERT INTO j2_note_sync_log (source_id, user_id, started_at) VALUES ('x', 'u1', 'y')")
        assert conn.in_transaction
        with pytest.raises(engine.ImportLockOrderError):
            engine._import_confirm_serialized("u1", {"source": "fake", "notes": []}, conn)
    finally:
        conn.rollback()
        conn.close()


# ── N-B: the claimer also wakes on a timer ────────────────────────────────────

async def test_the_follow_up_job_claims_a_newly_due_source_while_a_long_pass_runs(db, monkeypatch):
    monkeypatch.setattr(engine, "FOLLOW_UP_CLAIM_WAKE_S", 0.05)
    live = {"now": 0, "peak": 0, "order": []}
    gate = asyncio.Event()
    db.upsert_connector("u1", "fake", {"token": "abc"})
    providers = {"long": Gate("long", live, gate), "late": Gate("late", live)}
    sids = {n: db.create_source("u1", "fake", n)["id"] for n in providers}
    monkeypatch.setattr(engine, "_provider_factory", _factory_by_remote(providers))
    _due(db, sids["long"])
    job = asyncio.create_task(engine.sync_follow_up_sources())
    for _ in range(300):
        if live["order"]:
            break
        await asyncio.sleep(0.01)
    _due(db, sids["late"])  # due while the long pass holds its slot; two slots are free
    for _ in range(300):
        if "late" in live["order"]:
            break
        await asyncio.sleep(0.01)
    assert "late" in live["order"] and not job.done()
    gate.set()
    out = await job
    assert out["ran"] == 2


# ── N-C: an hourly skip books a follow-up ─────────────────────────────────────

async def test_an_hourly_pass_with_no_free_slot_books_a_follow_up_due_now(db, monkeypatch):
    ev_p, pl_p = PerRefProvider(), Plain()
    _seed(ev_p, 1)
    _seed(pl_p, 1)
    ev, _pl = _two_providers(db, monkeypatch, ev_p, pl_p)
    held = _hold_all_slots()
    try:
        await asyncio.wait_for(engine.sync_due_sources(), timeout=5)
    finally:
        _release(held)
    stamp = _row(db, ev)["warmingUntil"]
    assert stamp is not None and datetime.fromisoformat(stamp) <= datetime.now(timezone.utc)
    assert "fullPending" not in _state(db, ev)  # an incremental follow-up, not a full one


# ── C1: the member slot ───────────────────────────────────────────────────────

async def test_a_member_press_takes_the_reserved_slot_while_the_pool_is_full(db, monkeypatch):
    p = PerRefProvider()
    _seed(p, 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    db.record_sync_result("u1", sid, ok=True, status="ok")
    held = _hold_all_slots()
    try:
        assert held == engine.FOLLOW_UP_CONCURRENCY  # three background slots, unchanged
        result = await asyncio.wait_for(engine.sync_source(sid, member=True), timeout=5)
        assert result["status"] == "ok"  # ran at once, beside a full pool
        # A background pass (and a first sync) never takes the member slot.
        assert engine._try_acquire_pass_slot() is False
        bg = asyncio.create_task(engine.sync_source(sid, manual=True))
        await asyncio.sleep(0.05)
        assert engine.is_source_queued(sid) and not bg.done()
    finally:
        _release(held)
    await bg
    assert engine._pass_slots_in_use() == 0


async def test_a_second_member_press_waits_for_the_member_slot_or_a_pool_slot(db, monkeypatch):
    p = PerRefProvider()
    _seed(p, 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    held = _hold_all_slots()
    _hold_member_slot()
    task = asyncio.create_task(engine.sync_source(sid, member=True))
    await asyncio.sleep(0.05)
    assert engine.is_source_queued(sid)
    _release_member_slot()
    assert (await asyncio.wait_for(task, timeout=5))["status"] == "ok"
    _release(held)


async def test_a_press_on_a_source_already_syncing_books_no_slot(db, monkeypatch):
    gate = asyncio.Event()
    entered = asyncio.Event()

    class Hang(PerRefProvider):
        async def list_changed(self, credentials, cursor=None):
            entered.set()
            await gate.wait()
            return await super().list_changed(credentials, cursor)

    p = Hang()
    _seed(p, 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    importing = asyncio.create_task(engine.sync_source(sid, manual=True))
    await asyncio.wait_for(entered.wait(), timeout=5)
    used = engine._pass_slots_in_use()
    press = await engine.sync_source(sid, member=True)
    assert press["status"] == "busy" and engine._pass_slots_in_use() == used
    assert not engine.is_source_queued(sid)
    gate.set()
    await importing


# ── C2: a remote edit after a UCT trash ───────────────────────────────────────

async def test_a_remote_edit_after_a_trash_is_kept_in_the_trashed_note(db, monkeypatch):
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
    p.notes_by_id["p0"] = _rn("p0", "Note 0 edited", text="the newest words",
                              updated_at="2026-09-09T00:00:00+00:00")
    result = await engine.sync_source(sid, manual=True)
    assert result["status"] == "ok" and not result["failures"], result
    assert _row(db, sid)["lastSyncError"] is None
    assert _row(db, sid)["cursor"] is not None  # counted as stored: the cursor moved
    rows = {r["import_key"]: r for r in _note_rows()}
    trashed = rows[p.import_key("g", "p0")]
    assert trashed["deleted_at"] is not None  # still the member's trash
    assert trashed["import_remote_rev"] == "2026-09-09T00:00:00+00:00"
    before = len(p.fetch_calls)
    await engine.sync_source(sid, manual=True)
    assert "p0" not in p.fetch_calls[before:]  # NEW-7 now skips it
    restored = notes_svc.restore_note("u1", trashed["id"])
    assert restored["title"] == "Note 0 edited"
    assert "the newest words" in json.dumps(restored["bodyJson"])


# ── N-D: aging ────────────────────────────────────────────────────────────────

async def test_a_background_waiter_ages_into_first_sync_priority(monkeypatch):
    monkeypatch.setattr(engine, "SLOT_AGING_S", 0.05)
    held = _hold_all_slots()
    old = asyncio.create_task(engine._acquire_pass_slot("old", priority=engine.SLOT_BACKGROUND))
    await asyncio.sleep(0.15)  # aged
    first = asyncio.create_task(engine._acquire_pass_slot("first", priority=engine.SLOT_FIRST_SYNC))
    await asyncio.sleep(0.03)
    with engine._PASS_SLOTS_LOCK:
        assert engine._slot_waiters[0][2] == "old"  # aged ahead of the newer first sync
    _release(1)
    await asyncio.wait_for(old, timeout=5)
    assert not first.done()
    _release(held - 1)
    await asyncio.wait_for(first, timeout=5)
    _release(engine._pass_slots_in_use())


# ── fullPending minors ────────────────────────────────────────────────────────

async def test_a_follow_up_skipped_by_the_folder_heal_gives_up_its_lease(db, monkeypatch):
    p = PerRefProvider()
    _seed(p, 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    monkeypatch.setattr(dest_folder, "heal_missing_dest_folder",
                        lambda user_id, source_id: dest_folder.HealResult("failed", None))
    _due(db, sid)
    await engine.sync_follow_up_sources()
    assert _row(db, sid)["warmingUntil"] is None  # not a 30-minute lease firing forever


async def test_a_full_pass_that_raises_counts_a_skipped_removal_check(db, monkeypatch):
    p = PerRefProvider()
    _seed(p, 1)
    p.raise_on_list_changed = errors.NoteConnTransient("down")
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    for _ in range(3):
        with pytest.raises(errors.NoteConnTransient):
            await engine.sync_source(sid, full=True, manual=True)
    assert db.removal_skips("u1", sid) == 3


# ── C3: short writes, and a gap after each ────────────────────────────────────

async def test_a_pooled_pass_confirms_in_short_batches(db, monkeypatch):
    real = notes_svc.import_confirm
    sizes = []

    def spy(user_id, payload, conn=None, **kw):
        sizes.append(len(payload["notes"]))
        return real(user_id, payload, conn=conn, **kw)

    monkeypatch.setattr(notes_svc, "import_confirm", spy)
    monkeypatch.setattr(engine, "IMPORT_WRITE_GAP_S", 0.0)
    p = PerRefProvider()
    p.refs = [RemoteRef(remote_id=f"n{i}", updated_at="2026-08-01T00:00:00+00:00") for i in range(60)]
    p.notes_by_id = {f"n{i}": _rn(f"n{i}", f"Note {i}") for i in range(60)}
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    result = await engine.sync_source(sid, manual=True)
    assert result["created"] == 60
    assert sizes == [engine.POOLED_CONFIRM_BATCH_SIZE, 60 - engine.POOLED_CONFIRM_BATCH_SIZE]


def test_the_import_lock_is_held_for_the_gap_after_each_confirm(db, monkeypatch):
    monkeypatch.setattr(engine, "IMPORT_WRITE_GAP_S", 0.3)
    done = threading.Event()
    real = notes_svc.import_confirm

    def spy(*a, **kw):
        out = real(*a, **kw)
        done.set()
        return out

    monkeypatch.setattr(notes_svc, "import_confirm", spy)
    conn = auth_db.get_connection()
    t = threading.Thread(target=engine._import_confirm_serialized,
                         args=("u1", {"source": "fake", "notes": []}, conn))
    t.start()
    assert done.wait(5)
    time.sleep(0.1)
    assert engine._IMPORT_WRITE_LOCK.locked()  # committed, still holding: the gap
    t.join(5)
    assert not engine._IMPORT_WRITE_LOCK.locked()
    conn.close()



# ── Live bug 2026-11-03: a stale listing revision hid an edit ─────────────────

async def test_an_incremental_pass_fetches_a_listed_note_whose_revision_looks_unchanged(db, monkeypatch):
    # The owner's account: first import done (cursor set), a note edited in Evernote, and the
    # listing hit still carrying the OLD updatedAt (the search index lags). D1 skipped it as a
    # stored-revision match and the edit never arrived.
    p = PerRefProvider()
    _seed(p, 2)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    first = await engine.sync_source(sid, manual=True)
    assert first["created"] == 2 and _row(db, sid)["cursor"] is not None
    p.notes_by_id["p1"] = _rn("p1", "Note 1", text="edited in Evernote",
                              updated_at="2026-09-09T00:00:00+00:00")  # the fetch sees the edit
    # ...while the listing still reports the old revision, and lists it again (inside the
    # provider's cursor overlap, as Evernote's own listing does).
    monkeypatch.setattr(p, "list_changed", _relisting(p))
    before = len(p.fetch_calls)
    result = await engine.sync_source(sid, member=True)
    assert "p1" in p.fetch_calls[before:]
    assert result["updated"] == 1 and result["unchanged"] == 0
    body = [r for r in _note_rows() if r["title"] == "Note 1"][0]["body_plain"]
    assert "edited in Evernote" in body


def _relisting(p):
    async def list_changed(credentials, cursor=None):
        p.list_changed_calls.append(cursor)
        p._enumerated = True
        return list(p.refs)
    return list_changed


async def test_a_first_import_still_skips_a_stored_revision_match(db, monkeypatch):
    p = PerRefProvider()
    _seed(p, 3)
    p.limited = {"p2"}  # the first import is cut short: the cursor stays None
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    await engine.sync_source(sid, manual=True)
    assert _row(db, sid)["cursor"] is None
    p.limited = set()
    before = len(p.fetch_calls)
    result = await engine.sync_source(sid, manual=True)
    assert p.fetch_calls[before:] == ["p2"] and result["unchanged"] == 2


async def test_an_incremental_pass_keeps_a_trashed_notes_new_content_in_the_trash(db, monkeypatch):
    # NEW-7's same-revision skip, under the same rule: on an incremental pass a listed trashed
    # note is fetched and goes through the in-place path (still trashed), never a blind skip.
    p = PerRefProvider()
    _seed(p, 2)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    await engine.sync_source(sid, manual=True)
    _trash(p.import_key("g", "p0"))
    p.notes_by_id["p0"] = _rn("p0", "Note 0", text="edited after the trash",
                              updated_at=p.refs[0].updated_at)  # stale listing revision
    monkeypatch.setattr(p, "list_changed", _relisting(p))
    before = len(p.fetch_calls)
    result = await engine.sync_source(sid, member=True)
    assert "p0" in p.fetch_calls[before:] and not result["failures"]
    row = [r for r in _note_rows() if r["title"] == "Note 0"][0]
    assert row["deleted_at"] is not None and "edited after the trash" in row["body_plain"]
