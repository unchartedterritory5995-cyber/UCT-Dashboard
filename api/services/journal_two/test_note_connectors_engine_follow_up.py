"""A quick follow-up pass, and an honest progress line, for a first import a provider's rate
limit cut short (live gate 2026-11-03: Evernote's first pass stored 75 of 215 notes and said
"140 notes couldn't be read from Evernote this time").

A provider OPTS IN with `follow_up_on_rate_limit = True` (Evernote). When a pass of such a provider
ends with listed notes left unread because of `NoteConnRateLimited`, the engine:
  * stamps the source's `warming_until` a few minutes ahead (retry_after + a margin, clamped to
    [FOLLOW_UP_MIN_DELAY_S, FOLLOW_UP_MAX_DELAY_S]) unless the source already ran
    FOLLOW_UP_MAX_PASSES_PER_HOUR passes in the last hour;
  * records status `importing` with a progress sentence (stored of listed), never the failure
    sentence, unless something else genuinely failed too.
`sync_follow_up_sources` (the `note_sync_follow_up` APScheduler job) runs every source whose stamp
is due, through `sync_source` and its in-flight lock. Any other provider is unchanged.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from api.services import auth_db
from api.services.journal_two.note_connectors import dest_folder, engine, errors
from api.services.journal_two.note_connectors.providers.base import NoteProvider, RemoteRef
from api.services.journal_two.test_note_connectors_engine import (  # noqa: F401  (fixtures)
    FakeProvider, _rn, db,
)


class LimitedProvider(FakeProvider):
    """FakeProvider whose `fetch`/`fetch_many` raise `NoteConnRateLimited` for chosen ids."""

    follow_up_on_rate_limit = True

    def __init__(self):
        super().__init__()
        self.limited: set[str] = set()
        self.retry_after: float | None = 60.0

    def _limit(self, rid: str) -> None:
        if rid in self.limited:
            raise errors.NoteConnRateLimited(
                f"evernote mcp: get_note rate limited ({rid})", retry_after=self.retry_after)

    async def fetch(self, credentials, ref):
        self._limit(ref.remote_id)
        return await super().fetch(credentials, ref)

    async def fetch_many(self, credentials, refs):
        for r in refs:
            self._limit(r.remote_id)
        return await super().fetch_many(credentials, refs)


class PlainLimitedProvider(LimitedProvider):
    follow_up_on_rate_limit = False


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


def _row(db, source_id):
    return db.get_source_by_id(source_id)


def _until(src) -> datetime | None:
    v = src.get("warmingUntil")
    return datetime.fromisoformat(v) if v else None


def _label() -> str:
    return dest_folder.provider_label("fake")


# ── the opt-in pass ──────────────────────────────────────────────────────────

async def test_a_rate_limited_first_import_says_progress_and_schedules_a_follow_up(db, monkeypatch):
    p = _install(monkeypatch, LimitedProvider())
    _seed(p, 5)
    p.limited = {"p3", "p4"}
    src = _source(db)
    before = datetime.now(timezone.utc)
    result = await engine.sync_source(src["id"], manual=True)

    row = _row(db, src["id"])
    assert result["status"] == "importing"
    assert row["lastSyncStatus"] == "importing"
    assert row["lastSyncError"] == engine.IMPORT_PROGRESS_REASON.format(
        label=_label(), stored=3, total=5, notes="notes")
    assert "couldn't be read" not in row["lastSyncError"]
    until = _until(row)
    # retry_after 60 + margin 30 = 90, raised to the 120 s floor.
    assert until is not None
    assert before + timedelta(seconds=engine.FOLLOW_UP_MIN_DELAY_S - 5) <= until
    assert until <= datetime.now(timezone.utc) + timedelta(seconds=engine.FOLLOW_UP_MIN_DELAY_S + 5)
    assert row["cursor"] is None  # the leftovers hold the cursor, as before


async def test_the_follow_up_delay_follows_retry_after_inside_the_clamp(db, monkeypatch):
    p = _install(monkeypatch, LimitedProvider())
    _seed(p, 2)
    p.limited = {"p1"}
    p.retry_after = 200.0  # 200 + 30 = 230 s: inside [120, 300]
    src = _source(db)
    t0 = datetime.now(timezone.utc)
    await engine.sync_source(src["id"], manual=True)
    until = _until(_row(db, src["id"]))
    assert abs((until - t0).total_seconds() - 230) < 5

    p.retry_after = 7200.0  # fix round 1 (I7): clamped to the one-hour ceiling
    t1 = datetime.now(timezone.utc)
    await engine.sync_source(src["id"], manual=True)
    until = _until(_row(db, src["id"]))
    assert abs((until - t1).total_seconds() - engine.FOLLOW_UP_MAX_DELAY_S) < 5


async def test_a_pass_that_finishes_clears_the_follow_up_and_reads_clean(db, monkeypatch):
    p = _install(monkeypatch, LimitedProvider())
    _seed(p, 4)
    p.limited = {"p2", "p3"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)
    assert _until(_row(db, src["id"])) is not None

    p.limited = set()
    result = await engine.sync_source(src["id"], manual=True)
    row = _row(db, src["id"])
    assert result["status"] == "ok" and row["lastSyncStatus"] == "ok"
    assert row["lastSyncError"] is None
    assert row["warmingUntil"] is None
    assert row["cursor"] is not None  # every listed note stored: the cursor moves


async def test_a_genuine_fetch_failure_still_reads_as_a_failure(db, monkeypatch):
    p = _install(monkeypatch, LimitedProvider())
    _seed(p, 5)
    p.limited = {"p4"}
    p.raise_on_fetch_for = {"p0"}
    p.raise_on_fetch_many_for = {"p0"}
    src = _source(db)
    result = await engine.sync_source(src["id"], manual=True)
    row = _row(db, src["id"])
    progress = engine.IMPORT_PROGRESS_REASON.format(
        label=_label(), stored=3, total=5, notes="notes")
    failure = engine.FETCH_FAILED_REASON.format(
        n=1, notes="note", label=_label(), they="It will be")
    assert row["lastSyncError"] == f"{progress} {failure}"
    # Not "importing": a genuine failure keeps the status it always had (a partial pass is "ok"
    # with the failure sentence, which SourceRow shows as "synced with problems").
    assert result["status"] == "ok" and row["lastSyncStatus"] == "ok"
    assert _until(row) is not None  # the rate-limited note still gets its quick follow-up


async def test_the_follow_ups_per_hour_are_bounded(db, monkeypatch):
    p = _install(monkeypatch, LimitedProvider())
    _seed(p, 3)
    p.limited = {"p2"}
    src = _source(db)
    # FOLLOW_UP_MAX_PASSES_PER_HOUR passes already ran in the last hour.
    conn = auth_db.get_connection()
    recent = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    for _ in range(engine.FOLLOW_UP_MAX_PASSES_PER_HOUR):
        conn.execute("INSERT INTO j2_note_sync_log (source_id, user_id, started_at, status) "
                     "VALUES (?, ?, ?, 'importing')", (src["id"], "u1", recent))
    conn.commit()
    conn.close()
    result = await engine.sync_source(src["id"], manual=True)
    row = _row(db, src["id"])
    assert row["warmingUntil"] is None  # no quick follow-up: the hourly tick takes it from here
    assert result["status"] == "importing"
    assert row["lastSyncError"] == engine.IMPORT_PROGRESS_LATER_REASON.format(
        label=_label(), stored=2, total=3, notes="notes")


async def test_old_passes_do_not_count_against_the_hourly_bound(db, monkeypatch):
    p = _install(monkeypatch, LimitedProvider())
    _seed(p, 3)
    p.limited = {"p2"}
    src = _source(db)
    conn = auth_db.get_connection()
    old = (datetime.now(timezone.utc) - timedelta(minutes=61)).isoformat()
    for _ in range(engine.FOLLOW_UP_MAX_PASSES_PER_HOUR * 2):
        conn.execute("INSERT INTO j2_note_sync_log (source_id, user_id, started_at, status) "
                     "VALUES (?, ?, ?, 'ok')", (src["id"], "u1", old))
    conn.commit()
    conn.close()
    await engine.sync_source(src["id"], manual=True)
    assert _until(_row(db, src["id"])) is not None


async def test_a_provider_that_does_not_opt_in_is_unchanged(db, monkeypatch):
    p = _install(monkeypatch, PlainLimitedProvider())
    assert NoteProvider.follow_up_on_rate_limit is False
    _seed(p, 5)
    p.limited = {"p3", "p4"}
    src = _source(db)
    result = await engine.sync_source(src["id"], manual=True)
    row = _row(db, src["id"])
    assert result["status"] == "ok" and row["lastSyncStatus"] == "ok"
    assert row["lastSyncError"] == engine.FETCH_FAILED_REASON.format(
        n=2, notes="notes", label=_label(), they="They will be")
    assert row["warmingUntil"] is None


# ── the follow-up job ────────────────────────────────────────────────────────

async def test_sync_follow_up_sources_runs_only_due_sources_inside_the_cooldown(db, monkeypatch):
    p = _install(monkeypatch, LimitedProvider())
    _seed(p, 3)
    p.limited = {"p2"}
    src = _source(db)
    await engine.sync_source(src["id"], manual=True)  # stamps a follow-up ~2 min ahead
    list_calls = len(p.list_changed_calls)

    # Not due yet: nothing runs.
    out = await engine.sync_follow_up_sources()
    assert out["ran"] == 0 and len(p.list_changed_calls) == list_calls

    # Due (stamp in the past). The last sync was seconds ago, well inside the 10 min cooldown, so
    # only a manual pass would run: the follow-up must be one.
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    db.set_follow_up("u1", src["id"], past)
    p.limited = set()
    out = await engine.sync_follow_up_sources()
    assert out["ran"] == 1 and len(p.list_changed_calls) == list_calls + 1
    row = _row(db, src["id"])
    assert row["warmingUntil"] is None and row["lastSyncStatus"] == "ok"


async def test_a_follow_up_that_raises_does_not_rerun_forever(db, monkeypatch):
    p = _install(monkeypatch, LimitedProvider())
    _seed(p, 2)
    src = _source(db)
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    db.set_follow_up("u1", src["id"], past)
    p.raise_on_list_changed = errors.NoteConnTransient("listing down")
    out = await engine.sync_follow_up_sources()
    assert out["ran"] == 1
    # Fix round 1 (I9): the stamp was LEASED before the pass, so a failing pass leaves the lease,
    # which fires again only once it runs out (`test_the_follow_up_job_leases_the_stamp...`).
    assert _row(db, src["id"])["warmingUntil"] is not None
    out = await engine.sync_follow_up_sources()
    assert out["ran"] == 0


async def test_a_busy_source_is_not_run_twice(db, monkeypatch):
    p = _install(monkeypatch, LimitedProvider())
    _seed(p, 2)
    src = _source(db)
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    db.set_follow_up("u1", src["id"], past)
    assert engine._try_acquire_source(src["id"])
    try:
        out = await engine.sync_follow_up_sources()
    finally:
        engine._release_source(src["id"])
    assert p.list_changed_calls == []  # the in-flight lock held: no second pass
    assert out["busy"] == 1
    # The running pass owns the outcome; the stamp is kept for it to replace or clear.
    assert _until(_row(db, src["id"])) is not None


async def test_paused_or_broken_sources_get_no_follow_up_run(db, monkeypatch):
    p = _install(monkeypatch, LimitedProvider())
    _seed(p, 2)
    src = _source(db)
    past = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    db.set_follow_up("u1", src["id"], past)
    db.set_sync_enabled("u1", src["id"], False)
    out = await engine.sync_follow_up_sources()
    assert out["ran"] == 0 and p.list_changed_calls == []


def test_follow_up_constants():
    assert engine.FOLLOW_UP_MIN_DELAY_S == 120
    assert engine.FOLLOW_UP_MAX_DELAY_S == 3600  # fix round 1 (I7)
    assert engine.FOLLOW_UP_MARGIN_S == 30
    assert engine.FOLLOW_UP_MAX_PASSES_PER_HOUR == 12


def test_evernote_opts_in():
    from api.services.journal_two.note_connectors.providers.evernote import EvernoteProvider
    assert EvernoteProvider.follow_up_on_rate_limit is True


async def test_a_pass_the_limit_stopped_before_any_note_is_importing_not_lost(db, monkeypatch):
    p = _install(monkeypatch, LimitedProvider())
    _seed(p, 3)
    p.limited = {"p0", "p1", "p2"}
    src = _source(db)
    result = await engine.sync_source(src["id"], manual=True)
    row = _row(db, src["id"])
    # Not the "stored none of them" warning: nothing was lost, the import is waiting on the limit.
    assert result["status"] == "importing" and row["lastSyncStatus"] == "importing"
    assert row["lastSyncError"] == engine.IMPORT_PROGRESS_REASON.format(
        label=_label(), stored=0, total=3, notes="notes")
    assert _until(row) is not None
