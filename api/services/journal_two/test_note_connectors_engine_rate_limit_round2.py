"""Fix round 2 (final) for a rate-limited Evernote import (re-review of ac7c3d53a1).

  N1  the per-pass cap is safe even if D1's revision match never fires: notes with no stored
      row go first, then changed or pending ones, then the rest; one log line per pass says how
      many D1 skipped.
  N3  a stalled import (and a listing that keeps being rate limited) backs off exponentially
      with its zero passes (2, 4, 8 ... 60 min) instead of booking a quick follow-up.
  C4  a rate-limited LISTING reads "importing" with its own sentence, not "sync stopped", and
      counts as a zero pass.
  N4  attachments copied count as progress; nightly full passes never add a zero pass.
  N5  three follow-up passes in a row that raised (not a rate limit) clear the stamp.
  N8  D1's skips are their own `unchanged` count, never the card's "Unchanged" (notes_skipped).
  D4  follow-up passes run concurrently, at most FOLLOW_UP_CONCURRENCY at once; an importing
      source is never due in the hourly tick (its last_sync_at is fresh).
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone

import pytest

from api.services import auth_db
from api.services.journal_two.note_connectors import dest_folder, engine, errors
from api.services.journal_two.note_connectors.providers.base import RemoteRef
from api.services.journal_two.test_note_connectors_engine import (  # noqa: F401  (fixtures)
    PNG_BYTES, _rn, db,
)
from api.services.journal_two.test_note_connectors_engine_rate_limit_round1 import (
    PerRefProvider, _install, _label, _row, _seed, _source, _state,
)


def _until_s(db, sid, t0) -> float:
    return (datetime.fromisoformat(_row(db, sid)["warmingUntil"]) - t0).total_seconds()


def _log_rows(sid):
    conn = auth_db.get_connection()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM j2_note_sync_log WHERE source_id = ? ORDER BY id", (sid,)).fetchall()]
    finally:
        conn.close()


# ── N1 ───────────────────────────────────────────────────────────────────────

async def test_with_d1_never_matching_a_library_over_the_cap_still_converges(db, monkeypatch):
    monkeypatch.setattr(engine, "FETCH_CAP_PER_PASS", 3)
    monkeypatch.setattr(engine, "_same_revision", lambda a, b: False)  # D1's assumption is wrong
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 7)
    src = _source(db)
    created = []
    for _ in range(3):
        result = await engine.sync_source(src["id"], manual=True)
        created.append(result["created"])
    assert created == [3, 3, 1]  # new-note progress every pass
    conn = auth_db.get_connection()
    n = conn.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id = 'u1' AND deleted_at IS NULL "
                     "AND import_key IS NOT NULL").fetchone()[0]
    conn.close()
    assert n == 7


async def test_the_fetch_order_is_new_then_changed_then_the_rest(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 3)
    src = _source(db)
    p.limited = {"p2"}  # p0, p1 stored; p2 never was
    await engine.sync_source(src["id"], manual=True)
    p.limited = set()
    p.refs[1] = RemoteRef(remote_id="p1", updated_at="2026-09-09T00:00:00+00:00")  # changed
    p.notes_by_id["p1"] = _rn("p1", "Note 1 edited", updated_at="2026-09-09T00:00:00+00:00")
    monkeypatch.setattr(engine, "FETCH_CAP_PER_PASS", 2)
    before = len(p.fetch_calls)
    await engine.sync_source(src["id"], full=True, manual=True)  # a full pass skips nothing
    assert p.fetch_calls[before:] == ["p2", "p1"]  # p0 (stored, unchanged) was not reached


async def test_one_log_line_per_pass_says_how_many_d1_skipped(db, monkeypatch, caplog):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 5)
    p.limited = {"p3", "p4"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    caplog.clear()
    with caplog.at_level(logging.INFO, logger=engine.log.name):
        await engine.sync_source(src["id"], manual=True)
    lines = [r.getMessage() for r in caplog.records if "D1 skipped" in r.getMessage()]
    assert len(lines) == 1 and lines[0].endswith(
        "fake D1 skipped 3 of 5 listed (stored revision match)")


# ── N8 ───────────────────────────────────────────────────────────────────────

async def test_d1_skips_are_their_own_count_and_never_the_cards_unchanged(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 5)
    p.limited = {"p3", "p4"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    p.limited = set()
    result = await engine.sync_source(src["id"], manual=True)
    assert result["unchanged"] == 3 and result["skipped"] == 0 and result["created"] == 2
    assert _log_rows(src["id"])[-1]["notes_skipped"] == 0


# ── N3 ───────────────────────────────────────────────────────────────────────

async def test_passes_without_progress_back_off_exponentially(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.limited = {"p0", "p1"}
    p.retry_after = 1.0
    src = _source(db)
    delays = []
    for _ in range(7):
        t0 = datetime.now(timezone.utc)
        await engine.sync_source(src["id"], manual=True)
        delays.append(round(_until_s(db, src["id"], t0) / 60))
    assert delays == [2, 4, 8, 16, 32, 60, 60]  # minutes; stalled from the 3rd pass on


async def test_progress_brings_the_quick_follow_up_back(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 3)
    p.limited = {"p0", "p1", "p2"}
    p.retry_after = 1.0
    src = _source(db)
    for _ in range(3):
        await engine.sync_source(src["id"], manual=True)
    p.limited = {"p1", "p2"}
    t0 = datetime.now(timezone.utc)
    await engine.sync_source(src["id"], manual=True)
    assert round(_until_s(db, src["id"], t0)) == engine.FOLLOW_UP_MIN_DELAY_S


# ── C4: a rate-limited listing ───────────────────────────────────────────────

async def test_a_rate_limited_listing_reads_importing_and_counts_as_a_zero_pass(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.raise_on_list_changed = errors.NoteConnRateLimited("listing limited", retry_after=1.0)
    src = _source(db)
    result = await engine.sync_source(src["id"], manual=True)
    row = _row(db, src["id"])
    assert result["status"] == "importing" and row["lastSyncStatus"] == "importing"
    assert row["lastSyncError"] == engine.LISTING_LIMITED_REASON.format(label=_label())
    assert _state(db, src["id"])["importing"]["zeroPasses"] == 1
    assert _log_rows(src["id"])[-1]["status"] == "importing"
    for _ in range(engine.IMPORT_STALL_PASSES - 1):
        result = await engine.sync_source(src["id"], manual=True)
    row = _row(db, src["id"])
    assert result["status"] == "warning" and row["lastSyncStatus"] == "warning"
    assert row["lastSyncError"] == engine.LISTING_STALLED_REASON.format(label=_label())
    t_left = (datetime.fromisoformat(row["warmingUntil"]) - datetime.now(timezone.utc)).total_seconds()
    assert t_left > 400  # backed off (8 min), not a quick follow-up


async def test_a_rate_limited_listing_on_a_provider_that_does_not_opt_in_still_raises(db, monkeypatch):
    class Plain(PerRefProvider):
        follow_up_on_rate_limit = False

    p = _install(monkeypatch, Plain())
    _seed(p, 1)
    p.raise_on_list_changed = errors.NoteConnRateLimited("listing limited", retry_after=1.0)
    src = _source(db)
    with pytest.raises(errors.NoteConnRateLimited):
        await engine.sync_source(src["id"], manual=True)


# ── N4 ───────────────────────────────────────────────────────────────────────

async def test_a_nightly_full_pass_adds_no_zero_pass(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.limited = {"p0", "p1"}
    src = _source(db)
    for _ in range(2):
        await engine.sync_source(src["id"], manual=True)
    assert _state(db, src["id"])["importing"]["zeroPasses"] == 2
    result = await engine.sync_source(src["id"], full=True, manual=True)
    assert _state(db, src["id"])["importing"]["zeroPasses"] == 2
    assert result["status"] == "importing"  # not stalled by a pass that does not count


async def test_attachments_copied_count_as_progress(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.notes_by_id["p0"] = _rn("p0", "With image", updated_at="2026-08-01T00:00:00+00:00",
                              media=[{"ref": "img-1", "kind": "image", "name": "chart.png"}])
    p.notes_by_id["p0"].doc["content"].append(
        {"type": "image", "attrs": {"src": "import-ref://img-1"}})
    p.media_by_ref["img-1"] = (PNG_BYTES, "image/png")
    p.media_limited = {"img-1"}
    p.limited = {"p1"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)  # p0 created: progress
    await engine.sync_source(src["id"], manual=True)  # nothing new: zero pass 1
    assert _state(db, src["id"])["importing"]["zeroPasses"] == 1
    p.media_limited = set()
    result = await engine.sync_source(src["id"], manual=True)  # only the image lands
    assert result["created"] == 0 and result["mediaUploaded"] == 1
    assert _state(db, src["id"])["importing"]["zeroPasses"] == 0


# ── N5 ───────────────────────────────────────────────────────────────────────

def _due(db, sid):
    db.set_follow_up("u1", sid, (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())


async def test_three_follow_up_passes_that_raise_clear_the_stamp(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    src = _source(db)
    p.raise_on_list_changed = errors.NoteConnTransient("listing down")
    for i in range(engine.FOLLOW_UP_MAX_ERRORS):
        _due(db, src["id"])
        assert (await engine.sync_follow_up_sources())["ran"] == 1
    assert _row(db, src["id"])["warmingUntil"] is None  # given up: the hourly tick carries on
    assert "followUpErrors" not in _state(db, src["id"])


async def test_a_follow_up_that_succeeds_resets_the_error_count(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    src = _source(db)
    p.raise_on_list_changed = errors.NoteConnTransient("listing down")
    for _ in range(engine.FOLLOW_UP_MAX_ERRORS - 1):
        _due(db, src["id"])
        await engine.sync_follow_up_sources()
    assert _state(db, src["id"])["followUpErrors"] == engine.FOLLOW_UP_MAX_ERRORS - 1
    assert _row(db, src["id"])["warmingUntil"] is not None  # still leased
    p.raise_on_list_changed = None
    p.limited = {"p1"}
    _due(db, src["id"])
    await engine.sync_follow_up_sources()
    assert "followUpErrors" not in _state(db, src["id"])
    assert _row(db, src["id"])["warmingUntil"] is not None  # booked again by the pass


# ── D4 ───────────────────────────────────────────────────────────────────────

async def test_follow_up_passes_run_concurrently_up_to_the_pool_size(db, monkeypatch):
    live = {"now": 0, "peak": 0}

    class Slow(PerRefProvider):
        async def list_changed(self, credentials, cursor=None):
            live["now"] += 1
            live["peak"] = max(live["peak"], live["now"])
            try:
                await asyncio.sleep(0.05)
                return await super().list_changed(credentials, cursor)
            finally:
                live["now"] -= 1

    def factory(name, source=None):
        p = Slow()
        _seed(p, 1)
        return p

    monkeypatch.setattr(engine, "_provider_factory", factory)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sids = [db.create_source("u1", "fake", f"graph-{i}")["id"] for i in range(5)]
    for sid in sids:
        _due(db, sid)
    out = await engine.sync_follow_up_sources()
    assert out["ran"] == 5
    assert live["peak"] == engine.FOLLOW_UP_CONCURRENCY


async def test_an_importing_source_is_not_due_in_the_hourly_tick(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.limited = {"p1"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    assert _row(db, src["id"])["lastSyncStatus"] == "importing"
    assert src["id"] not in {s["id"] for s in db.list_due_sources(30)}


def test_fix_round_2_engine_constants():
    assert engine.FOLLOW_UP_CONCURRENCY == 3
    assert engine.FOLLOW_UP_MAX_ERRORS == 3
    assert engine.FOLLOW_UP_BACKOFF_BASE_S == 120


async def test_every_opt_in_pass_shares_the_process_slots_not_only_follow_ups(db, monkeypatch):
    # D4: first syncs and Sync now (not only follow-ups) take a slot, so many members connecting at
    # once never run more than FOLLOW_UP_CONCURRENCY Evernote passes against a shared limit.
    monkeypatch.setattr(engine, "PASS_SLOT_POLL_S", 0.01)
    live = {"now": 0, "peak": 0}

    class Slow(PerRefProvider):
        async def list_changed(self, credentials, cursor=None):
            live["now"] += 1
            live["peak"] = max(live["peak"], live["now"])
            try:
                await asyncio.sleep(0.05)
                return await super().list_changed(credentials, cursor)
            finally:
                live["now"] -= 1

    def factory(name, source=None):
        p = Slow()
        _seed(p, 1)
        return p

    monkeypatch.setattr(engine, "_provider_factory", factory)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sids = [db.create_source("u1", "fake", f"graph-{i}")["id"] for i in range(6)]
    results = await asyncio.gather(*(engine.sync_source(sid, manual=True) for sid in sids))
    assert all(r["status"] == "ok" for r in results)
    assert live["peak"] == engine.FOLLOW_UP_CONCURRENCY
    assert engine._pass_slots_in_use() == 0  # every slot given back


async def test_a_provider_that_does_not_opt_in_takes_no_slot(db, monkeypatch):
    live = {"now": 0, "peak": 0}

    class Plain(PerRefProvider):
        follow_up_on_rate_limit = False

        async def list_changed(self, credentials, cursor=None):
            live["now"] += 1
            live["peak"] = max(live["peak"], live["now"])
            try:
                await asyncio.sleep(0.05)
                return await super().list_changed(credentials, cursor)
            finally:
                live["now"] -= 1

    def factory(name, source=None):
        p = Plain()
        _seed(p, 1)
        return p

    monkeypatch.setattr(engine, "_provider_factory", factory)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sids = [db.create_source("u1", "fake", f"graph-{i}")["id"] for i in range(5)]
    await asyncio.gather(*(engine.sync_source(sid, manual=True) for sid in sids))
    assert live["peak"] == 5


async def test_a_pass_that_raises_gives_its_slot_back(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 1)
    p.raise_on_list_changed = errors.NoteConnTransient("down")
    src = _source(db)
    with pytest.raises(errors.NoteConnTransient):
        await engine.sync_source(src["id"], manual=True)
    assert engine._pass_slots_in_use() == 0


async def test_a_genuine_failure_beside_d1_skips_is_not_read_as_lost(db, monkeypatch):
    # N8 with the A1 rule: notes D1 did not fetch are stored, so a pass whose only other ref
    # failed genuinely is NOT "stored none of them" (a warning).
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 3)
    p.limited = {"p2"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)  # p0, p1 stored; cursor held by p2
    p.limited = set()
    p.raise_on_fetch_for = {"p2"}  # p2 now fails for real; p0, p1 are D1-unchanged
    result = await engine.sync_source(src["id"], manual=True)
    assert result["unchanged"] == 2 and result["created"] == result["skipped"] == 0
    assert result["status"] == "ok"


async def test_an_attachment_copied_while_another_still_waits_is_progress(db, monkeypatch):
    # N4: a note with two images, one copied and one still waiting on the limit: the note's
    # "updated" is discounted (it is still a leftover), so only the copied image says progress.
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.notes_by_id["p0"] = _rn("p0", "Two images", updated_at="2026-08-01T00:00:00+00:00",
                              media=[{"ref": "img-1", "kind": "image", "name": "a.png"},
                                     {"ref": "img-2", "kind": "image", "name": "b.png"}])
    for ref in ("img-1", "img-2"):
        p.notes_by_id["p0"].doc["content"].append(
            {"type": "image", "attrs": {"src": f"import-ref://{ref}"}})
        p.media_by_ref[ref] = (PNG_BYTES, "image/png")
    p.media_limited = {"img-1", "img-2"}
    p.limited = {"p1"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)  # p0 created
    await engine.sync_source(src["id"], manual=True)  # nothing: zero pass 1
    assert _state(db, src["id"])["importing"]["zeroPasses"] == 1
    p.media_limited = {"img-1"}
    result = await engine.sync_source(src["id"], manual=True)
    assert result["mediaUploaded"] == 1
    assert _state(db, src["id"])["importing"]["zeroPasses"] == 0


async def test_new_notes_go_first_even_when_the_listing_carries_no_revisions(db, monkeypatch):
    # N1 without any D1: Evernote hits with no updatedAt name no revision, so nothing is
    # skipped, but the stored-row order still puts unread notes first and the import converges.
    monkeypatch.setattr(engine, "FETCH_CAP_PER_PASS", 3)
    p = _install(monkeypatch, PerRefProvider())
    p.listing_revision = lambda ref: None
    _seed(p, 7)
    src = _source(db)
    created = [(await engine.sync_source(src["id"], manual=True))["created"] for _ in range(3)]
    assert created == [3, 3, 1]
