"""Fix round 1 for a rate-limited first import (live gate 2026-11-03; review of
fix/evernote-tool-rate-limit): Evernote must be safe to open to a member with a library of any size.

  D1  work is cumulative across passes: a listed note whose STORED revision equals the listing's
      (and has no pending media) is not fetched again, so an interrupted import resumes where it
      stopped. Never from `j2_note_remote_index` (stamped before the fetch: C2). Never on the
      nightly full pass, never without a real listing revision.
  D2  a per-pass cap on note fetches for a provider that opts in; the rest are leftovers.
  I4  a provider on the base `fetch_many` is fetched per ref, once each (no batch, then refetch).
  I7  a follow-up after a long server wait is booked for then (up to an hour).
  I8  an attachment the rate limit stopped is a leftover that spends no retry attempt.
  I9  the follow-up job leases the stamp instead of clearing it, and enforces the hourly bound.
  I10 an import that stops making progress turns amber with an honest sentence; an incremental
      pass that tripped says it is importing NEW notes, not "X of Y".
  D3  the learned pacing interval is carried to the next pass, decaying with age.
  M2  a pass stops at the next chunk boundary when the source was paused or removed.
  Off the event loop: the remote-index touch and the result recording run in worker threads.
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timedelta, timezone

import pytest

from api.services import auth_db
from api.services.journal_two.note_connectors import dest_folder, engine, errors
from api.services.journal_two.note_connectors.providers.base import NoteProvider, RemoteRef
from api.services.journal_two.test_note_connectors_engine import (  # noqa: F401  (fixtures)
    PNG_BYTES, FakeProvider, _rn, db,
)


class PerRefProvider(FakeProvider):
    """The Evernote shape: the BASE `fetch_many` (per ref), opted in to follow-ups, and a real
    listing revision for every ref unless named in `no_rev`."""

    follow_up_on_rate_limit = True
    fetch_many = NoteProvider.fetch_many

    def __init__(self):
        super().__init__()
        self.limited: set[str] = set()
        self.retry_after: float | None = 60.0
        self.no_rev: set[str] = set()
        self.media_limited: set[str] = set()
        self.on_fetch = None  # optional hook(remote_id)
        self.seeded: list[float] = []
        self.learned: tuple[float | None, bool] = (None, False)

    def listing_revision(self, ref):
        return None if ref.remote_id in self.no_rev else ref.updated_at

    async def fetch(self, credentials, ref):
        if self.on_fetch is not None:
            self.on_fetch(ref.remote_id)
        if ref.remote_id in self.limited:
            self.fetch_calls.append(ref.remote_id)
            raise errors.NoteConnRateLimited("limited", retry_after=self.retry_after)
        return await super().fetch(credentials, ref)

    async def fetch_media(self, credentials, ref):
        if ref in self.media_limited:
            self.fetch_media_calls.append(ref)
            raise errors.NoteConnRateLimited("media limited", retry_after=self.retry_after)
        return await super().fetch_media(credentials, ref)

    def seed_pacing(self, interval_s):
        self.seeded.append(interval_s)

    def learned_pacing(self):
        return self.learned


def _install(monkeypatch, p):
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    return p


def _seed(p, n: int) -> None:
    p.refs = [RemoteRef(remote_id=f"p{i}", updated_at=f"2026-08-{i + 1:02d}T00:00:00+00:00")
              for i in range(n)]
    p.notes_by_id = {f"p{i}": _rn(f"p{i}", f"Note {i}",
                                  updated_at=f"2026-08-{i + 1:02d}T00:00:00+00:00")
                     for i in range(n)}


def _source(db):
    db.upsert_connector("u1", "fake", {"token": "abc"})
    return db.create_source("u1", "fake", "fake-graph")


def _row(db, sid):
    return db.get_source_by_id(sid)


def _label():
    return dest_folder.provider_label("fake")


def _state(db, sid) -> dict:
    raw = _row(db, sid).get("syncState")
    return json.loads(raw) if raw else {}


def _fetched_this_pass(p, before: int) -> list[str]:
    return p.fetch_calls[before:]


# ── D1: cumulative work ──────────────────────────────────────────────────────

async def test_an_interrupted_import_resumes_with_only_the_remainder(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 10)
    p.limited = {f"p{i}" for i in range(4, 10)}  # the limit stops the pass after 4 notes
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    assert _row(db, src["id"])["cursor"] is None

    p.limited = set()
    before = len(p.fetch_calls)
    result = await engine.sync_source(src["id"], manual=True)
    assert sorted(_fetched_this_pass(p, before)) == sorted(f"p{i}" for i in range(4, 10))
    # Fix round 2 (N8): D1's skips are their own `unchanged` count.
    assert result["status"] == "ok" and result["created"] == 6 and result["unchanged"] == 4
    assert _row(db, src["id"])["cursor"] is not None  # the skipped 4 count as stored


async def test_a_changed_note_is_fetched_again(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 4)
    p.limited = {"p3"}  # keeps the cursor at None, so the next pass lists everything
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    p.refs[1] = RemoteRef(remote_id="p1", updated_at="2026-09-09T00:00:00+00:00")
    p.notes_by_id["p1"] = _rn("p1", "Note 1 edited", updated_at="2026-09-09T00:00:00+00:00")
    before = len(p.fetch_calls)
    await engine.sync_source(src["id"], manual=True)
    assert sorted(_fetched_this_pass(p, before)) == ["p1", "p3"]


async def test_a_note_waiting_on_media_is_fetched_again(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 3)
    p.notes_by_id["p0"] = _rn("p0", "With image", updated_at="2026-08-01T00:00:00+00:00",
                              media=[{"ref": "img-1", "kind": "image", "name": "chart.png"}])
    p.notes_by_id["p0"].doc["content"].append(
        {"type": "image", "attrs": {"src": "import-ref://img-1"}})
    p.raise_on_fetch_media_for = {"img-1"}  # an ordinary failure: retryable, pending = 1
    p.limited = {"p2"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    before = len(p.fetch_calls)
    await engine.sync_source(src["id"], manual=True)
    assert sorted(_fetched_this_pass(p, before)) == ["p0", "p2"]


async def test_the_nightly_full_pass_never_skips(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 4)
    p.limited = {"p3"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    p.limited = set()
    before = len(p.fetch_calls)
    await engine.sync_source(src["id"], full=True, manual=True)
    assert sorted(_fetched_this_pass(p, before)) == ["p0", "p1", "p2", "p3"]


async def test_remote_index_rows_alone_never_cause_a_skip(db, monkeypatch):
    # C2: `_touch_remote_index` stamps every LISTED ref before any fetch. A pass the limit
    # stopped before it stored anything leaves index rows for every note and no stored note:
    # the next pass must fetch them all.
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 5)
    p.limited = {f"p{i}" for i in range(5)}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    conn = auth_db.get_connection()
    n_index = conn.execute("SELECT COUNT(*) FROM j2_note_remote_index WHERE source_id = ?",
                           (src["id"],)).fetchone()[0]
    conn.close()
    assert n_index == 5
    p.limited = set()
    before = len(p.fetch_calls)
    await engine.sync_source(src["id"], manual=True)
    assert sorted(_fetched_this_pass(p, before)) == [f"p{i}" for i in range(5)]


async def test_a_listing_without_a_real_revision_is_always_fetched(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 3)
    p.limited = {"p2"}
    p.no_rev = {"p1"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    before = len(p.fetch_calls)
    await engine.sync_source(src["id"], manual=True)
    assert sorted(_fetched_this_pass(p, before)) == ["p1", "p2"]


async def test_a_provider_without_listing_revisions_skips_nothing(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    p.listing_revision = lambda ref: None  # the base default
    _seed(p, 3)
    p.limited = {"p2"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    before = len(p.fetch_calls)
    await engine.sync_source(src["id"], manual=True)
    assert sorted(_fetched_this_pass(p, before)) == ["p0", "p1", "p2"]


def test_the_base_provider_reports_no_listing_revision():
    assert NoteProvider.listing_revision(object(), RemoteRef("x", "2026-01-01T00:00:00Z")) is None


def test_revisions_compare_at_whole_seconds_through_instant():
    same = engine._same_revision
    assert same("2026-08-01T00:00:00.000+00:00", "2026-08-01T00:00:00Z")
    assert same("2026-08-01T00:00:00.420+00:00", "2026-08-01T02:00:00+02:00")
    assert not same("2026-08-01T00:00:01+00:00", "2026-08-01T00:00:00+00:00")
    assert not same(None, "2026-08-01T00:00:00Z") and not same("2026-08-01T00:00:00Z", None)
    assert not same("garbage", "garbage")


# ── D2 + I4: a bounded, per-ref pass ─────────────────────────────────────────

async def test_a_pass_fetches_at_most_the_cap_and_follows_up_for_the_rest(db, monkeypatch):
    monkeypatch.setattr(engine, "FETCH_CAP_PER_PASS", 3)
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 5)
    src = _source(db)
    result = await engine.sync_source(src["id"], manual=True)
    row = _row(db, src["id"])
    assert len(p.fetch_calls) == 3
    assert result["status"] == "importing" and row["warmingUntil"] is not None
    assert row["lastSyncError"] == engine.IMPORT_PROGRESS_REASON.format(
        label=_label(), stored=3, total=5, notes="notes")
    assert row["cursor"] is None
    before = len(p.fetch_calls)
    result = await engine.sync_source(src["id"], manual=True)
    assert len(_fetched_this_pass(p, before)) == 2
    assert result["status"] == "ok" and _row(db, src["id"])["cursor"] is not None


async def test_the_cap_is_only_for_providers_that_opt_in(db, monkeypatch):
    monkeypatch.setattr(engine, "FETCH_CAP_PER_PASS", 3)

    class Plain(PerRefProvider):
        follow_up_on_rate_limit = False

    p = _install(monkeypatch, Plain())
    _seed(p, 5)
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    assert len(p.fetch_calls) == 5


async def test_a_provider_on_the_base_fetch_many_is_fetched_once_per_ref(db, monkeypatch):
    # I4: no 40-note batch that fails and is then fetched again one by one.
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 5)
    p.raise_on_fetch_for = {"p2"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    assert sorted(p.fetch_calls) == [f"p{i}" for i in range(5)]


# ── I7: a long server wait ───────────────────────────────────────────────────

@pytest.mark.parametrize("retry_after, expected", [(3600.0, 3600), (7200.0, 3600)])
async def test_a_long_server_wait_books_the_follow_up_for_then(db, monkeypatch, retry_after, expected):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.limited = {"p1"}
    p.retry_after = retry_after
    src = _source(db)
    t0 = datetime.now(timezone.utc)
    await engine.sync_source(src["id"], manual=True)
    until = datetime.fromisoformat(_row(db, src["id"])["warmingUntil"])
    assert abs((until - t0).total_seconds() - expected) < 5


# ── I8: an attachment the limit stopped ──────────────────────────────────────

async def test_a_rate_limited_attachment_is_a_leftover_that_spends_no_attempt(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.notes_by_id["p0"] = _rn("p0", "With image", updated_at="2026-08-01T00:00:00+00:00",
                              media=[{"ref": "img-1", "kind": "image", "name": "chart.png"}])
    p.notes_by_id["p0"].doc["content"].append(
        {"type": "image", "attrs": {"src": "import-ref://img-1"}})
    p.media_by_ref["img-1"] = (PNG_BYTES, "image/png")
    p.media_limited = {"img-1"}
    src = _source(db)
    result = await engine.sync_source(src["id"], manual=True)
    row = _row(db, src["id"])
    assert result["status"] == "importing"
    assert row["warmingUntil"] is not None and row["cursor"] is None
    assert "couldn't" not in (row["lastSyncError"] or "")
    conn = auth_db.get_connection()
    body = json.loads(conn.execute(
        "SELECT body_json FROM j2_notes WHERE import_key LIKE '%p0'").fetchone()[0])
    conn.close()
    notices = [n for n in json.dumps(body).split('"importNotice"')[1:]]
    assert notices, "the image keeps a notice where it was"
    assert '"attempts": 0' in json.dumps(body)  # no retry attempt spent

    p.media_limited = set()
    before = len(p.fetch_calls)
    result = await engine.sync_source(src["id"], manual=True)
    assert "p0" in _fetched_this_pass(p, before)  # pending media: fetched again
    assert result["mediaUploaded"] == 1 and result["status"] == "ok"


# ── I9: the lease ────────────────────────────────────────────────────────────

async def test_the_follow_up_job_leases_the_stamp_and_a_crash_refires_after_it(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    src = _source(db)
    db.set_follow_up("u1", src["id"], (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
    p.raise_on_list_changed = errors.NoteConnTransient("listing down")
    t0 = datetime.now(timezone.utc)
    out = await engine.sync_follow_up_sources()
    assert out["ran"] == 1
    lease = datetime.fromisoformat(_row(db, src["id"])["warmingUntil"])
    assert abs((lease - t0).total_seconds() - engine.FOLLOW_UP_LEASE_S) < 5
    assert (await engine.sync_follow_up_sources())["ran"] == 0  # inside the lease
    db.set_follow_up("u1", src["id"], (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
    p.raise_on_list_changed = None
    assert (await engine.sync_follow_up_sources())["ran"] == 1  # the lease ran out: re-fired
    assert _row(db, src["id"])["warmingUntil"] is None  # a pass that finished cleared it


async def test_the_follow_up_job_enforces_the_hourly_bound(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    src = _source(db)
    conn = auth_db.get_connection()
    recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    for _ in range(engine.FOLLOW_UP_MAX_PASSES_PER_HOUR):
        conn.execute("INSERT INTO j2_note_sync_log (source_id, user_id, started_at, status) "
                     "VALUES (?, 'u1', ?, 'importing')", (src["id"], recent))
    conn.commit()
    conn.close()
    db.set_follow_up("u1", src["id"], (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat())
    out = await engine.sync_follow_up_sources()
    assert out["ran"] == 0 and p.list_changed_calls == []
    assert _row(db, src["id"])["warmingUntil"] is None


# ── I10: progress tracking ───────────────────────────────────────────────────

async def test_an_import_that_stops_making_progress_turns_amber(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 3)
    p.limited = {"p0", "p1", "p2"}
    src = _source(db)
    for _ in range(engine.IMPORT_STALL_PASSES - 1):
        result = await engine.sync_source(src["id"], manual=True)
        assert result["status"] == "importing"
    result = await engine.sync_source(src["id"], manual=True)
    row = _row(db, src["id"])
    assert result["status"] == "warning" and row["lastSyncStatus"] == "warning"
    assert row["lastSyncError"] == engine.IMPORT_STALLED_REASON.format(
        label=_label(), stored=0, total=3, notes="notes")
    assert row["warmingUntil"] is not None  # it keeps retrying


async def test_progress_resets_the_stall_count(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 4)
    p.limited = {"p0", "p1", "p2", "p3"}
    src = _source(db)
    for _ in range(engine.IMPORT_STALL_PASSES - 1):
        await engine.sync_source(src["id"], manual=True)
    p.limited = {"p1", "p2", "p3"}  # one more note lands
    result = await engine.sync_source(src["id"], manual=True)
    assert result["status"] == "importing"
    assert _state(db, src["id"])["importing"]["zeroPasses"] == 0


async def test_an_import_older_than_a_day_without_progress_is_stalled(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.limited = {"p0", "p1"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    state = _state(db, src["id"])
    state["importing"]["since"] = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
    db.set_sync_state("u1", src["id"], json.dumps(state))
    result = await engine.sync_source(src["id"], manual=True)
    assert result["status"] == "warning"


async def test_a_tripped_incremental_pass_says_importing_new_notes(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 3)
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    assert _row(db, src["id"])["cursor"] is not None
    p.refs.append(RemoteRef(remote_id="p9", updated_at="2026-09-09T00:00:00+00:00"))
    p.notes_by_id["p9"] = _rn("p9", "New", updated_at="2026-09-09T00:00:00+00:00")
    p.limited = {"p9"}
    result = await engine.sync_source(src["id"], manual=True)
    assert result["status"] == "importing"
    assert _row(db, src["id"])["lastSyncError"] == engine.IMPORT_NEW_PROGRESS_REASON.format(
        label=_label())


async def test_a_finished_import_clears_its_progress_state(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.limited = {"p1"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    assert "importing" in _state(db, src["id"])
    p.limited = set()
    await engine.sync_source(src["id"], manual=True)
    assert "importing" not in _state(db, src["id"])


# ── D3: the learned interval ─────────────────────────────────────────────────

async def test_a_learned_interval_is_stored_and_seeds_the_next_pass(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.learned = (4.0, True)
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    pace = _state(db, src["id"])["pace"]
    assert pace["intervalS"] == 4.0
    p.learned = (4.0, False)  # seeded this time, nothing new learned
    await engine.sync_source(src["id"], manual=True)
    assert p.seeded and p.seeded[-1] == pytest.approx(4.0, rel=0.01)
    assert _state(db, src["id"])["pace"]["learnedAt"] == pace["learnedAt"]  # age keeps counting


@pytest.mark.parametrize("age_h, expected", [(6, 2.0), (12, 1.0), (25, None)])
async def test_the_seed_decays_with_age(db, monkeypatch, age_h, expected):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 1)
    src = _source(db)
    learned_at = (datetime.now(timezone.utc) - timedelta(hours=age_h)).isoformat()
    db.set_sync_state("u1", src["id"], json.dumps({"pace": {"intervalS": 4.0, "learnedAt": learned_at}}))
    await engine.sync_source(src["id"], manual=True)
    if expected is None:
        assert p.seeded == []
    else:
        assert p.seeded[-1] == pytest.approx(expected, rel=0.02)


# ── M2: a pause or removal mid-pass ──────────────────────────────────────────

async def test_a_pass_stops_at_the_next_chunk_when_the_source_is_paused(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    n = engine.IMPORT_CHUNK_NOTES + 20
    _seed(p, 1)
    p.refs = [RemoteRef(remote_id=f"q{i:04d}", updated_at=f"2026-08-01T00:{i // 60:02d}:{i % 60:02d}+00:00")
              for i in range(n)]
    p.notes_by_id = {r.remote_id: _rn(r.remote_id, r.remote_id, updated_at=r.updated_at) for r in p.refs}
    src = _source(db)
    monkeypatch.setattr(engine, "FETCH_CAP_PER_PASS", 10_000)

    def pause_once(rid):
        if rid == p.refs[5].remote_id:
            db.set_sync_enabled("u1", src["id"], False)

    p.on_fetch = pause_once
    await engine.sync_source(src["id"], manual=True)
    assert len(p.fetch_calls) == engine.IMPORT_CHUNK_NOTES
    assert _row(db, src["id"])["cursor"] is None


# ── off the event loop ───────────────────────────────────────────────────────

async def test_the_index_touch_and_result_recording_run_off_the_event_loop(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    src = _source(db)
    main = threading.current_thread()
    seen: dict[str, bool] = {}
    real_touch, real_record = engine._touch_remote_index, engine.connections.record_sync_result

    def touch(*a, **k):
        seen["touch"] = threading.current_thread() is not main
        return real_touch(*a, **k)

    def record(*a, **k):
        seen["record"] = threading.current_thread() is not main
        return real_record(*a, **k)

    monkeypatch.setattr(engine, "_touch_remote_index", touch)
    monkeypatch.setattr(engine.connections, "record_sync_result", record)
    await engine.sync_source(src["id"], manual=True)
    assert seen == {"touch": True, "record": True}


def test_fix_round_1_engine_constants():
    assert engine.FETCH_CAP_PER_PASS == 300
    assert engine.FOLLOW_UP_LEASE_S == 1800
    assert engine.FOLLOW_UP_MAX_DELAY_S == 3600
    assert engine.IMPORT_STALL_PASSES == 3
    assert engine.IMPORT_STALL_AFTER_S == 86400
    assert engine.PACE_MEMORY_S == 86400
    assert engine.PACE_HALF_LIFE_S == 21600


async def test_a_rate_limited_listing_books_the_follow_up(db, monkeypatch):
    p = _install(monkeypatch, PerRefProvider())
    _seed(p, 2)
    p.raise_on_list_changed = errors.NoteConnRateLimited("listing limited", retry_after=200.0)
    src = _source(db)
    t0 = datetime.now(timezone.utc)
    # Fix round 2 (concern 4): an opt-in provider's rate-limited listing no longer raises.
    result = await engine.sync_source(src["id"], manual=True)
    assert result["status"] == "importing"
    until = datetime.fromisoformat(_row(db, src["id"])["warmingUntil"])
    assert abs((until - t0).total_seconds() - 230) < 5
