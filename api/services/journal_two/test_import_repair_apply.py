"""Plan F Task 7: apply, with the rails.

The one guard (`runner.hands_off`), the optimistic lock on the listing row's `updated_at`, the
undo copy committed before each write (C7), the per-member lease (Task 5 M-4, renewed right
before each write: Task 6 M-3), timestamp-neutral writes, resume, and the C8 bounds. Real schema;
notes come in through `notes.import_confirm`; hotlinks are fetched through the real
`hotlink_fetch.fetch_and_store` over a mock transport (no network).
"""
from __future__ import annotations

import asyncio
import io
import json
from datetime import datetime, timezone

import httpx
import pytest
from PIL import Image

from api.services import auth_db
from api.services.journal_two import hotlink_fetch, media_policy
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.import_repair import runner, store
from api.services.journal_two.note_connectors import engine
from api.services.journal_two.note_connectors.convert import REF_PREFIX
from api.services.journal_two.test_import_repair_runner import (  # noqa: F401 -- fixture by name
    BARE, EDITED_AT, _doc, _link, _note, _para, _source, _sql, _t, db,
)

HOT = "http://cdn.example.com/a.png"
HOT2 = "http://cdn.example.com/b.png"
RUN = "run-1"


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (8, 6), (200, 30, 30)).save(buf, "PNG")
    return buf.getvalue()


PNG = _png()


@pytest.fixture
def armed(db, monkeypatch):
    monkeypatch.setenv(runner.FLAG, "1")
    monkeypatch.setenv("DATA_DIR", str(db))
    media_policy._USAGE_MEMO.clear()
    return db


@pytest.fixture
def web(monkeypatch):
    """The fetch's client answers from a mock transport; every request is recorded."""
    from api.services.journal_two.note_connectors.providers import base as base_module

    async def _public(host):
        return ["142.250.0.1"]

    monkeypatch.setattr(base_module, "_resolve_host", _public)
    state = {"routes": {}, "calls": []}

    async def handler(request: httpx.Request) -> httpx.Response:
        url = f"{request.url.scheme}://{request.headers['host']}{request.url.raw_path.decode()}"
        state["calls"].append(url)
        answer = state["routes"].get(url)
        if answer is None:
            return httpx.Response(404)
        return answer()

    monkeypatch.setattr(hotlink_fetch, "default_client",
                        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return state


def _apply(**kw):
    kw.setdefault("allow_market_hours", True)  # never a function of the hour the suite runs
    kw.setdefault("sleep_ms", 0)
    c = auth_db.get_connection()
    try:
        return runner.apply(c, run_id=kw.pop("run_id", RUN), **kw)
    finally:
        c.close()


def _q(sql, *params):
    c = auth_db.get_connection()
    try:
        return [tuple(r) for r in c.execute(sql, params).fetchall()]
    finally:
        c.close()


def _note_row(note_id):
    return _q("SELECT body_json, updated_at, imported_at, import_hash, import_remote_rev,"
              " import_links_pending FROM j2_notes WHERE id = ?", note_id)[0]


def _outcomes(note_id=None):
    if note_id is None:
        return _q("SELECT note_id, outcome FROM j2_import_repair_log ORDER BY id")
    return [r[0] for r in _q("SELECT outcome FROM j2_import_repair_log WHERE note_id = ? ORDER BY id", note_id)]


WORK = _doc(_para(_t("other", _link("Other.md"))), _para(_t("see https://example.com/a now")))


def _work_note(user="u1"):
    _note(user, "Obsidian", "obsidian:Vault/Other.md", _doc(_para(_t("plain"))))
    return _note(user, "Obsidian", "obsidian:Vault/Here.md", WORK)


# ── refusals ──────────────────────────────────────────────────────────────────

def test_apply_refuses_without_the_flag(db, monkeypatch):
    monkeypatch.delenv(runner.FLAG, raising=False)
    _work_note()
    with pytest.raises(runner.RepairRefused):
        _apply()
    monkeypatch.setenv(runner.FLAG, "true")  # only exactly "1" arms it
    with pytest.raises(runner.RepairRefused):
        _apply()
    assert _outcomes() == []


@pytest.mark.parametrize("et,refused", [
    ("2026-11-04T09:30:00", True), ("2026-11-04T15:59:00", True), ("2026-11-04T16:00:00", False),
    ("2026-11-04T09:29:00", False), ("2026-11-07T11:00:00", False),  # a Saturday
])
def test_apply_refuses_market_hours_unless_allowed(armed, et, refused):
    """C8 (3): `--apply` refuses 9:30-16:00 ET on a weekday unless explicitly allowed."""
    from zoneinfo import ZoneInfo
    at = datetime.fromisoformat(et).replace(tzinfo=ZoneInfo("America/New_York"))
    _work_note()
    if refused:
        with pytest.raises(runner.RepairRefused):
            _apply(allow_market_hours=False, now=lambda: at)
        assert _apply(allow_market_hours=True, now=lambda: at)["repaired"] == 1
    else:
        assert _apply(allow_market_hours=False, now=lambda: at)["repaired"] == 1


def test_a_run_that_reaches_market_hours_stops_before_the_next_member(armed):
    """Fix round 1 (review M-5): a run started at 09:29 ET does not write through the session.
    Market hours are re-checked before each member; the run stops cleanly and reports it."""
    from zoneinfo import ZoneInfo
    _note("u1", "Notion", "notion:Export/A.md", BARE)
    _note("u2", "Notion", "notion:Export/B.md", BARE)
    et = ZoneInfo("America/New_York")
    report = _apply(allow_market_hours=False, now=_stepping_clock(
        datetime(2026, 11, 4, 9, 29, tzinfo=et),        # start
        datetime(2026, 11, 4, 9, 29, 30, tzinfo=et),    # member 1
        datetime(2026, 11, 4, 9, 29, 40, tzinfo=et),    # member 1's note
        datetime(2026, 11, 4, 9, 30, tzinfo=et)))       # member 2 (and after)
    assert report["repaired"] == 1 and report["stoppedForMarketHours"] is True
    c = auth_db.get_connection()
    try:
        assert store.member_done(c, RUN, "u1") is True and store.member_done(c, RUN, "u2") is False
    finally:
        c.close()


def _stepping_clock(*times):
    """A clock that answers each time in turn, then keeps answering the last one."""
    seq = list(times)

    def clock():
        return seq.pop(0) if len(seq) > 1 else seq[0]
    return clock


def test_a_run_that_reaches_market_hours_stops_between_notes_of_one_member(armed):
    """Final review M-4: one member with many notes (hotlinks can take up to a minute each) must
    not carry a run into the session. Market hours are re-checked before each note's write; the
    member is released unfinished (no notice, not done, lease free), and a later run resumes it."""
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    first = _note("u1", "Notion", "notion:Export/A.md", BARE)
    second = _note("u1", "Notion", "notion:Export/B.md", BARE)
    report = _apply(allow_market_hours=False, now=_stepping_clock(
        datetime(2026, 11, 4, 9, 29, tzinfo=et),        # start
        datetime(2026, 11, 4, 9, 29, 10, tzinfo=et),    # the member
        datetime(2026, 11, 4, 9, 29, 20, tzinfo=et),    # note 1
        datetime(2026, 11, 4, 9, 30, tzinfo=et)))       # note 2: the session has opened
    assert report["repaired"] == 1 and report["stoppedForMarketHours"] is True
    assert [_outcomes(first), _outcomes(second)].count([]) == 1  # exactly one note was written
    c = auth_db.get_connection()
    try:
        assert store.member_done(c, RUN, "u1") is False
        assert store.pending_notice(c, "u1") is None
        store.claim_member(c, RUN, "u1", "another-runner")  # the lease was given back
        store.release_lease(c, RUN, "u1", "another-runner")
        c.commit()
    finally:
        c.close()
    resumed = _apply(allow_market_hours=False, now=lambda: datetime(2026, 11, 4, 17, 0, tzinfo=et))
    assert resumed["repaired"] == 1 and resumed["stoppedForMarketHours"] is False


# ── the guard ─────────────────────────────────────────────────────────────────

def test_an_edited_note_is_never_written(armed):
    note = _work_note()
    _sql("UPDATE j2_notes SET updated_at = ? WHERE id = ?", EDITED_AT, note)
    before = _note_row(note)
    report = _apply()
    assert _note_row(note) == before
    assert _outcomes(note) == ["kept_edited"]
    assert report["repaired"] == 0 and report["totals"]["keptEdited"] == 1


def test_the_guard_is_what_protects_it(armed, monkeypatch):
    """CONTROL: with `hands_off` forced False the same note IS rewritten, so the test above
    fails without the guard (the in-suite mutation)."""
    note = _work_note()
    _sql("UPDATE j2_notes SET updated_at = ? WHERE id = ?", EDITED_AT, note)
    before = _note_row(note)
    monkeypatch.setattr(runner, "hands_off", lambda row: False)
    _apply()
    assert _note_row(note)[0] != before[0]
    assert _outcomes(note)[-1] == "repaired"


def test_a_note_edited_after_planning_is_not_overwritten(armed, monkeypatch):
    """M-6 (2): the LISTING row's `updated_at` is the expected one; a member edit after the plan
    surfaces as `race_lost` and the member's body stands."""
    note = _work_note()
    real = runner.plan_note

    def plan_then_edit(conn, user_id, row, note_class, index):
        plan = real(conn, user_id, row, note_class, index)
        if row.id == note:
            notes_svc.update_note("u1", note, {"bodyJson": _doc(_para(_t("member wrote this")))})
        return plan

    monkeypatch.setattr(runner, "plan_note", plan_then_edit)
    report = _apply()
    assert "member wrote this" in _note_row(note)[0]
    assert _outcomes(note)[-1] == "race_lost" and report["raceLost"] == 1


def test_the_write_is_locked_on_the_listing_rows_stamp(armed, monkeypatch):
    """Fix round 1, I-4: a member edit AFTER the pre-fetch re-check (during the downloads, or
    after the undo copy) is caught only by the optimistic lock on the LISTING row's
    `updated_at`. A real `update_note` lands right after `log_started`: `race_lost`, and the
    member's body stands."""
    note = _work_note()
    real = store.log_started

    def then_edit(conn, run_id, user_id, note_id, shapes, actions, before):
        real(conn, run_id, user_id, note_id, shapes, actions, before)
        notes_svc.update_note("u1", note_id, {"bodyJson": _doc(_para(_t("member wrote this")))})

    monkeypatch.setattr(store, "log_started", then_edit)
    report = _apply()
    assert "member wrote this" in _note_row(note)[0]
    assert _outcomes(note) == ["repair_started", "race_lost"] and report["raceLost"] == 1


@pytest.mark.parametrize("when", ["before_fetch", "before_write"])
def test_a_timestamp_neutral_write_since_planning_is_never_overwritten(armed, web, monkeypatch, when):
    """Fix round 1 (review M-2): the live link heal pass writes through `_apply_resolved_body`
    without moving `updated_at`, so the stamp lock cannot see it. The stored body is compared
    with the one the plan was made from; any difference is `race_lost`, never an overwrite."""
    note = _note("u1", "Notion", "notion:Export/H.md", _doc(
        {"type": "image", "attrs": {"src": HOT}}, _para(_t("see https://example.com/a"))))
    web["routes"][HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    healed = _doc(_para(_t("healed by the heal pass")))

    def heal(note_id):
        c = auth_db.get_connection()
        try:
            stamp = c.execute("SELECT updated_at FROM j2_notes WHERE id = ?", (note_id,)).fetchone()[0]
            assert engine._apply_resolved_body(c, "u1", note_id, healed, expected_updated_at=stamp)
        finally:
            c.close()

    if when == "before_fetch":
        real = runner.plan_note
        monkeypatch.setattr(runner, "plan_note", lambda conn, user_id, row, cls, index: (
            lambda plan: (heal(row.id), plan)[1])(real(conn, user_id, row, cls, index)))
    else:
        real_fetch = hotlink_fetch.fetch_and_store

        async def fetch_then_heal(user_id, note_id, url, **kw):
            stored = await real_fetch(user_id, note_id, url, **kw)
            heal(note_id)
            return stored

        monkeypatch.setattr(hotlink_fetch, "fetch_and_store", fetch_then_heal)
    report = _apply()
    assert json.loads(_note_row(note)[0]) == healed
    assert _outcomes(note)[-1] == "race_lost" and report["raceLost"] == 1
    if when == "before_fetch":
        assert web["calls"] == []  # nothing downloaded for a plan that is already stale


def test_a_tags_only_edit_after_the_undo_copy_is_never_overwritten(armed, monkeypatch):
    """Fix round 2, I-4: a member edit that does NOT change the body (tags) right after the undo
    copy is invisible to the body lock. Only the lock on the LISTING row's `updated_at` stops the
    write: `race_lost`, and the member's tags and body stand."""
    note = _work_note()
    before_body = _note_row(note)[0]
    real = store.log_started

    def then_tag(conn, run_id, user_id, note_id, shapes, actions, before):
        real(conn, run_id, user_id, note_id, shapes, actions, before)
        notes_svc.update_note("u1", note_id, {"tags": ["mine"]})

    monkeypatch.setattr(store, "log_started", then_tag)
    report = _apply()
    assert _note_row(note)[0] == before_body
    assert _outcomes(note) == ["repair_started", "race_lost"] and report["raceLost"] == 1
    assert _q("SELECT tags FROM j2_notes WHERE id = ?", note)[0][0] != "[]"


def test_the_body_lock_is_in_the_same_update_as_the_stamp_lock(armed):
    """Fix round 1 follow-up (concern 2): `_apply_resolved_body(..., expected_body_hash=)`
    writes only when the stored body still hashes to it, checked IN the UPDATE's WHERE, beside
    `updated_at`. None (every existing caller) keeps today's behaviour."""
    note = _note("u1", "Notion", "notion:Export/A.md", BARE)
    stored, stamp = _note_row(note)[0], _note_row(note)[1]
    new = _doc(_para(_t("new")))
    c = auth_db.get_connection()
    try:
        assert engine._apply_resolved_body(c, "u1", note, new, expected_updated_at=stamp,
                                           expected_body_hash=engine.stored_body_sha("something else")) is False
        assert _note_row(note)[0] == stored
        assert engine._apply_resolved_body(c, "u1", note, new, expected_updated_at=stamp,
                                           expected_body_hash=engine.stored_body_sha(stored)) is True
        assert json.loads(_note_row(note)[0]) == new
        assert engine._apply_resolved_body(c, "u1", note, BARE, expected_updated_at=stamp) is True  # None
    finally:
        c.close()
    assert runner.body_sha is engine.stored_body_sha  # one definition of the hash


def test_the_body_hash_function_is_registered_once_per_connection(armed):
    """Re-review N-1: SQLite refuses to RE-register a function while another statement on the
    connection is still active. The engine registers it only when the connection lacks it."""
    a = _note("u1", "Notion", "notion:Export/A.md", BARE)
    b = _note("u1", "Notion", "notion:Export/B.md", BARE)
    c = auth_db.get_connection()
    try:
        for note in (a, b):
            stored, stamp = _note_row(note)[0], _note_row(note)[1]
            cursor = c.execute("SELECT id FROM j2_notes")  # left open, mid-iteration
            cursor.fetchone()
            assert engine._apply_resolved_body(c, "u1", note, _doc(_para(_t("x"))), expected_updated_at=stamp,
                                               expected_body_hash=engine.stored_body_sha(stored)) is True
            cursor.close()
    finally:
        c.close()


def test_a_timestamp_neutral_write_at_the_last_moment_is_never_overwritten(armed, monkeypatch):
    """Concern 2: a timestamp-neutral write (the heal pass) landing AFTER the repair's last
    body check and before its UPDATE is caught by the UPDATE itself: `race_lost`."""
    note = _work_note()
    healed = _doc(_para(_t("healed at the last moment")))
    real = store.log_started

    def then_heal(conn, run_id, user_id, note_id, shapes, actions, before):
        real(conn, run_id, user_id, note_id, shapes, actions, before)  # after the last check
        other = auth_db.get_connection()
        try:
            stamp = other.execute("SELECT updated_at FROM j2_notes WHERE id = ?", (note_id,)).fetchone()[0]
            assert engine._apply_resolved_body(other, user_id, note_id, healed, expected_updated_at=stamp)
        finally:
            other.close()

    monkeypatch.setattr(store, "log_started", then_heal)
    report = _apply()
    assert json.loads(_note_row(note)[0]) == healed
    assert _outcomes(note) == ["repair_started", "race_lost"] and report["raceLost"] == 1


def test_an_edit_before_the_fetch_stops_the_fetch(armed, web, monkeypatch):
    """C7: `updated_at` is re-read right before fetching; a moved stamp means no download (no
    orphan file on the member's budget) and `race_lost`."""
    note = _note("u1", "Notion", "notion:Export/H.md", _doc({"type": "image", "attrs": {"src": HOT}}))
    web["routes"][HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    real = runner.plan_note

    def plan_then_edit(conn, user_id, row, note_class, index):
        plan = real(conn, user_id, row, note_class, index)
        _sql("UPDATE j2_notes SET updated_at = ? WHERE id = ?", EDITED_AT, note)
        return plan

    monkeypatch.setattr(runner, "plan_note", plan_then_edit)
    report = _apply()
    assert web["calls"] == [] and report["fetched"] == 0
    assert _outcomes(note) == ["race_lost"]


# ── the write ─────────────────────────────────────────────────────────────────

def test_writes_are_timestamp_neutral(armed):
    note = _work_note()
    _sql("UPDATE j2_notes SET import_links_pending = 1 WHERE id = ?", note)
    before = _note_row(note)
    versions = _q("SELECT COUNT(*) FROM j2_note_versions WHERE note_id = ?", note)
    _apply()
    after = _note_row(note)
    assert after[0] != before[0]  # the body was repaired
    assert after[1:5] == before[1:5]  # updated_at, imported_at, import_hash, import_remote_rev
    assert after[5] == 0  # import_links_pending recomputed from the written body
    assert _q("SELECT COUNT(*) FROM j2_note_versions WHERE note_id = ?", note) == versions
    body = json.loads(after[0])
    hrefs = [m["attrs"]["href"] for p in body["content"] for n in p.get("content", []) for m in n.get("marks", [])]
    assert hrefs[0].startswith("/journal?j2tab=notebook&note=") and hrefs[1] == "https://example.com/a"


def test_the_undo_copy_is_committed_before_the_write(armed, monkeypatch):
    """C7: when the body is replaced, a `repair_started` row holding the old body is already
    durable (read from ANOTHER connection inside the write)."""
    note = _work_note()
    stored_before = _note_row(note)[0]
    seen = []
    real = engine._apply_resolved_body

    def spy(conn, user_id, note_id, body, **kw):
        seen.append(_q("SELECT outcome, before_body_json FROM j2_import_repair_log WHERE note_id = ?", note_id))
        return real(conn, user_id, note_id, body, **kw)

    monkeypatch.setattr(engine, "_apply_resolved_body", spy)
    _apply()
    assert seen == [[("repair_started", stored_before)]]
    assert _outcomes(note) == ["repair_started", "repaired"]


def test_a_failing_write_is_logged_and_the_run_goes_on(armed, monkeypatch):
    first = _note("u1", "Notion", "notion:Export/A.md", BARE)
    second = _note("u1", "Notion", "notion:Export/B.md", BARE)
    real = engine._apply_resolved_body

    def boom(conn, user_id, note_id, body, **kw):
        if note_id == first:
            raise RuntimeError("disk")
        return real(conn, user_id, note_id, body, **kw)

    monkeypatch.setattr(engine, "_apply_resolved_body", boom)
    report = _apply()
    assert (report["failed"], report["repaired"]) == (1, 1)
    assert _outcomes(first) == ["repair_started", "failed"] and _outcomes(second)[-1] == "repaired"
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is True


def test_a_note_that_fails_to_plan_is_logged_and_the_run_goes_on(armed, monkeypatch):
    """Fix round 1, I-3: a planning error is one note's failure, never the run's. It is logged
    `failed`, the member is finished, and the same run never retries it (no poison pill)."""
    bad = _note("u1", "Notion", "notion:Export/A.md", BARE)
    good = _note("u1", "Notion", "notion:Export/B.md", BARE)
    real = runner.plan_note
    tried = []

    def boom(conn, user_id, row, cls, index):
        tried.append(row.id)
        if row.id == bad:
            raise TypeError("an unexpected body shape")
        return real(conn, user_id, row, cls, index)

    monkeypatch.setattr(runner, "plan_note", boom)
    report = _apply()
    assert (report["failed"], report["repaired"]) == (1, 1)
    assert _outcomes(bad) == ["failed"] and _outcomes(good)[-1] == "repaired"
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is True
    # a resume of the same run (member unfinished) skips the note that already failed in it
    _sql("UPDATE j2_import_repair_progress SET status = 'in_progress' WHERE user_id = 'u1'")
    tried.clear()
    _apply()
    assert bad not in tried


def test_the_lease_is_released_on_any_exit(armed, monkeypatch):
    """I-3 / M-3: an abort mid-member (RSS, an error, ^C) gives the member back at once, so a
    resume is not refused as busy for the stale window."""
    _note("u1", "Notion", "notion:Export/A.md", BARE)
    monkeypatch.setattr(runner, "_apply_note", lambda *a, **k: (_ for _ in ()).throw(KeyboardInterrupt()))
    with pytest.raises(KeyboardInterrupt):
        _apply(holder="first")
    lease = _q("SELECT lease_holder FROM j2_import_repair_progress WHERE user_id = 'u1'")
    assert lease == [(None,)]
    c = auth_db.get_connection()
    try:
        assert store.claim_member(c, RUN, "u1", "second") == []  # free at once, nothing taken over
    finally:
        c.close()


def test_a_committed_write_is_reported_repaired_even_if_its_log_row_fails(armed, monkeypatch):
    """Fix round 1 (review M-4): the body write commits on its own; if the outcome row then
    fails, the note IS repaired and the report says so (the undo copy is already durable)."""
    note = _work_note()
    real = store.log_note

    def refuse_outcome(conn, run_id, user_id, note_id, outcome, *a):
        if outcome == "repaired":
            raise RuntimeError("log write failed")
        return real(conn, run_id, user_id, note_id, outcome, *a)

    monkeypatch.setattr(store, "log_note", refuse_outcome)
    report = _apply()
    assert (report["repaired"], report["failed"]) == (1, 0)
    assert "/journal?j2tab=notebook&note=" in _note_row(note)[0]
    assert _outcomes(note) == ["repair_started"]  # runbook 10 resolves a lone started row


def test_an_unchanged_note_writes_no_log_row(armed):
    """C12: counted, never logged."""
    note = _note("u1", "Notion", "notion:Export/Plain.md", _doc(_para(_t("plain"))))
    _apply()
    assert _outcomes(note) == []


def test_apply_is_idempotent(armed):
    note = _work_note()
    first = _apply()
    body = _note_row(note)[0]
    second = _apply(run_id="run-2")
    assert first["repaired"] == 1 and second["repaired"] == 0
    assert _note_row(note)[0] == body
    assert [o for n, o in _outcomes() if o == "repaired"] == ["repaired"]


def test_resume_after_interruption(armed, monkeypatch):
    _note("u1", "Notion", "notion:Export/A.md", BARE)
    _note("u2", "Notion", "notion:Export/B.md", BARE)
    real = store.finish_member
    calls = []

    def stop_after_first(conn, run_id, user_id, **kw):
        real(conn, run_id, user_id, **kw)
        calls.append(user_id)
        if len(calls) == 1:
            raise KeyboardInterrupt  # the operator stopped the run

    monkeypatch.setattr(store, "finish_member", stop_after_first)
    with pytest.raises(KeyboardInterrupt):
        _apply()
    planned = []
    real_plan = runner.plan_note
    monkeypatch.setattr(runner, "plan_note",
                        lambda conn, user_id, row, cls, index: planned.append(user_id) or real_plan(conn, user_id, row, cls, index))
    report = _apply()
    assert planned == ["u2"]  # member 1 is done in this run: skipped
    assert report["repaired"] == 1 and calls == ["u1", "u2"]


def test_another_runner_holding_the_member_is_respected(armed):
    """Task 5 M-4: a member another live runner holds is skipped and counted."""
    note = _work_note()
    c = auth_db.get_connection()
    try:
        store.claim_member(c, "other-run", "u1", "someone-else")
    finally:
        c.close()
    before = _note_row(note)
    report = _apply()
    assert report["busyMembers"] == 1 and report["repaired"] == 0 and _note_row(note) == before


def test_a_lost_lease_stops_before_the_write(armed, monkeypatch):
    """Task 6 M-3: the lease is renewed right before each note's write; lost means stop."""
    note = _work_note()
    before = _note_row(note)
    monkeypatch.setattr(store, "renew_lease", lambda conn, run_id, user_id, holder: False)
    report = _apply()
    assert _note_row(note) == before and report["leaseLost"] == 1
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is False


def test_the_lease_is_renewed_while_working_not_only_before_a_write(armed, monkeypatch):
    """Fix round 1 (review M-8): a member with many unchanged notes renews its lease every
    `RSS_CHECK_EVERY` notes, so it never goes stale while it is being worked on; a renewal that
    fails stops the member there."""
    plain = _doc(_para(_t("plain")))
    for i in range(4):
        _note("u1", "Notion", f"notion:Export/{i}.md", plain)
    monkeypatch.setattr(runner, "RSS_CHECK_EVERY", 2)
    calls = []
    real = store.renew_lease
    monkeypatch.setattr(store, "renew_lease",
                        lambda *a: calls.append(1) or real(*a))
    _apply()
    assert len(calls) == 2  # notes 2 and 4: periodic renewals, with nothing written
    monkeypatch.setattr(store, "renew_lease", lambda *a: False)
    report = _apply(run_id="run-2")
    assert report["leaseLost"] == 1
    assert store.member_done(auth_db.get_connection(), "run-2", "u1") is False


def test_a_member_whose_lease_was_taken_is_not_finished_by_the_old_runner(armed, monkeypatch):
    """M-8: `finish_member` is holder-scoped: a runner that lost the member never marks it done."""
    _note("u1", "Notion", "notion:Export/A.md", _doc(_para(_t("plain"))))
    real = store.finish_member

    def taken_over_first(conn, run_id, user_id, **kw):
        conn.execute("UPDATE j2_import_repair_progress SET lease_holder = 'someone-else'")
        conn.commit()
        return real(conn, run_id, user_id, **kw)

    monkeypatch.setattr(store, "finish_member", taken_over_first)
    report = _apply()
    assert report["leaseLost"] == 1
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is False


def test_a_huge_note_is_skipped_in_apply_too(armed, monkeypatch):
    """M-6 (1): the size skip holds in apply, not only in the scan."""
    note = _work_note()
    before = _note_row(note)
    monkeypatch.setattr(runner, "MAX_SCAN_BODY_BYTES", 10)
    report = _apply()
    assert _note_row(note) == before and report["totals"]["tooLargeToScan"] == 2


def test_rss_watchdog_aborts_the_run(armed, monkeypatch):
    """C8 (1): memory over the ceiling above the start aborts (the CLI exits 4); state stays
    resumable."""
    for i in range(3):
        _note("u1", "Notion", f"notion:Export/{i}.md", BARE)
    rss = iter([100.0, 100.0, 400.0, 400.0, 400.0])
    monkeypatch.setattr(runner, "_rss_mb", lambda: next(rss))
    monkeypatch.setattr(runner, "RSS_CHECK_EVERY", 1)
    with pytest.raises(runner.RepairAborted):
        _apply(rss_ceiling_mb=250)
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is False


def test_batches_progress_with_the_same_limit_every_run(armed):
    """Fix round 1, I-2: `max_notes` counts only notes still needing work, so a resumed batch
    moves on past the notes an earlier batch repaired: 3 notes at 2 per run is 2, then 1, done."""
    for i in range(3):
        _note("u1", "Notion", f"notion:Export/{i}.md", BARE)
    assert _apply(max_notes=2, holder="a")["repaired"] == 2
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is False
    assert _apply(max_notes=2, holder="b")["repaired"] == 1
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is True


def test_batches_stop_cleanly_and_resume(armed):
    """C8 (2): `max_notes` stops mid-member without finishing it; its lease is released, so the
    next run resumes at once."""
    for i in range(3):
        _note("u1", "Notion", f"notion:Export/{i}.md", BARE)
    first = _apply(max_notes=2, holder="a")
    assert first["repaired"] == 2
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is False
    second = _apply(holder="b")
    assert second["repaired"] == 1
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is True


# ── hotlinks ─────────────────────────────────────────────────────────────────

def test_a_hotlink_is_replaced_by_our_copy_under_the_notes_own_folder(armed, web):
    """T4 M-1: the stored file lands under THIS row's own member and note."""
    note = _note("u1", "Notion", "notion:Export/H.md", _doc(
        {"type": "image", "attrs": {"src": HOT, "alt": "Chart"}}))
    web["routes"][HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    report = _apply()
    image = json.loads(_note_row(note)[0])["content"][0]
    assert image["attrs"]["alt"] == "Chart"
    assert image["attrs"]["src"].startswith(f"/api/j2/notes/attachments/u1/{note}/")
    files = [p for p in (armed / "j2_attachments" / "u1" / "notes" / note).rglob("*") if p.is_file()]
    assert len(files) == 1 and files[0].read_bytes() == PNG
    assert (report["fetched"], report["repaired"]) == (1, 1)


SVG = (b'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">'
       b'<rect width="8" height="8" fill="red"/></svg>')


def _animated_gif() -> bytes:
    frames = [Image.effect_noise((64, 64), 80 + 40 * i).convert("RGB") for i in range(4)]
    buf = io.BytesIO()
    frames[0].save(buf, "GIF", save_all=True, append_images=frames[1:], duration=100, loop=0)
    return buf.getvalue()


def _no_orphans(note):
    from api.services.journal_two.import_repair import shapes
    return shapes.orphan_media_count("u1", note, _note_row(note)[0]) == 0


def test_a_stored_file_kind_becomes_a_chip_never_an_image(armed, web):
    """Fix round 1, I-1: the policy stores an SVG as a FILE. As the door and `commit.js` do, it
    becomes a chip in the image's place, never an <img> of a stored file."""
    url = "http://cdn.example.com/logo.svg"
    note = _note("u1", "Notion", "notion:Export/S.md", _doc({"type": "image", "attrs": {"src": url}}))
    web["routes"][url] = lambda: httpx.Response(200, content=SVG, headers={"content-type": "image/svg+xml"})
    _apply()
    node = json.loads(_note_row(note)[0])["content"][0]
    assert node["type"] == "attachmentChip"
    assert node["attrs"]["href"].startswith(f"/api/j2/notes/attachments/u1/{note}/")
    assert node["attrs"]["name"] == "logo.svg"
    assert _no_orphans(note)


def test_a_kept_original_gets_its_chip_after_the_image(armed, web, monkeypatch):
    """I-1: an animated GIF over the inline cap is stored as its first frame plus the animation
    as the original. The original is referenced by a chip right after the image (the door's
    rule), so nothing stored is left unreferenced and the animation is one tap away."""
    monkeypatch.setattr(media_policy, "IMAGE_MAX_BYTES", 9000)
    url = "http://cdn.example.com/big.gif"
    note = _note("u1", "Notion", "notion:Export/G.md", _doc({"type": "image", "attrs": {"src": url, "alt": "Loop"}}))
    web["routes"][url] = lambda: httpx.Response(200, content=_animated_gif(), headers={"content-type": "image/gif"})
    _apply()
    image, chip = json.loads(_note_row(note)[0])["content"]
    assert image["type"] == "image" and image["attrs"]["alt"] == "Loop"
    assert chip["type"] == "attachmentChip" and chip["attrs"]["href"].endswith(".gif")
    assert _no_orphans(note)


def test_a_hotlink_inside_a_figure_keeps_the_figure_well_formed(armed, web, monkeypatch):
    """I-1 with the T4 figure rule: `imageFigure` is `image imageCaption`. A kept original's
    chip goes AFTER the figure; a file kind dissolves the figure into the chip and its caption."""
    from api.services.journal_two.test_import_repair_media import _assert_figures_are_well_formed
    monkeypatch.setattr(media_policy, "IMAGE_MAX_BYTES", 9000)
    gif, svg = "http://cdn.example.com/big.gif", "http://cdn.example.com/logo.svg"
    cap = {"type": "imageCaption", "content": [_t("Caption")]}
    note = _note("u1", "Notion", "notion:Export/F.md", _doc(
        {"type": "imageFigure", "content": [{"type": "image", "attrs": {"src": gif}}, cap]},
        {"type": "imageFigure", "content": [{"type": "image", "attrs": {"src": svg}}, cap]}))
    web["routes"][gif] = lambda: httpx.Response(200, content=_animated_gif(), headers={"content-type": "image/gif"})
    web["routes"][svg] = lambda: httpx.Response(200, content=SVG, headers={"content-type": "image/svg+xml"})
    _apply()
    body = json.loads(_note_row(note)[0])
    _assert_figures_are_well_formed(body)
    assert [n["type"] for n in body["content"]] == ["imageFigure", "attachmentChip", "attachmentChip", "paragraph"]
    assert body["content"][3] == _para(_t("Caption"))
    assert _no_orphans(note)


def test_the_repair_creates_document_rows_but_starts_no_extraction(armed, web, monkeypatch):
    """Re-review I-5: the repair is a short-lived process on the prod pod. It creates the
    document row (`pending`) and never queues extraction or OCR there: the web pod's sweep
    (`requeue_stale_pending`) picks the row up. No extraction thread exists after the run."""
    import threading
    from api.services.journal_two import document_extraction
    submitted = []
    monkeypatch.setattr(document_extraction._EXTRACTION_POOL, "submit", lambda *a: submitted.append(a))
    note = _note("u1", "Notion", "notion:Export/H.md", _doc({"type": "image", "attrs": {"src": HOT}}))
    web["routes"][HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    _apply()
    assert submitted == []
    assert _q("SELECT status FROM j2_note_documents WHERE note_id = ?", note) == [("pending",)]
    assert not [t for t in threading.enumerate() if t.name in ("j2-doc-extract", "j2-doc-ocr")]


def test_a_repaired_copy_is_handed_to_documents_like_the_doors(armed, web, monkeypatch):
    """Fix round 1 (review M-6): Plan B R7 (a) -- a fetched image is searchable (OCR) exactly as
    the member door's is: the same payload, the same seam, once the note's write landed."""
    from api.services.journal_two import document_extraction
    note = _note("u1", "Notion", "notion:Export/H.md", _doc({"type": "image", "attrs": {"src": HOT}}))
    web["routes"][HOT] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    seen = []
    monkeypatch.setattr(document_extraction, "on_attachment_saved",
                        lambda user_id, note_id, saved, content_type, *, kind, queue=True: seen.append(
                            (user_id, note_id, saved["url"], content_type, kind, queue)))
    _apply()
    src = json.loads(_note_row(note)[0])["content"][0]["attrs"]["src"]
    assert seen == [("u1", note, src, "image/png", "image", False)]  # I-5: the row only


def test_failed_hotlink_keeps_the_image(armed, web):
    note = _note("u1", "Notion", "notion:Export/H.md", _doc(
        {"type": "image", "attrs": {"src": HOT}}, _para(_t("see https://example.com/a"))))
    report = _apply()  # the mock answers 404
    body = json.loads(_note_row(note)[0])
    assert body["content"][0] == {"type": "image", "attrs": {"src": HOT}}  # left as it is
    assert body["content"][1]["content"][1]["marks"][0]["attrs"]["href"] == "https://example.com/a"
    assert report["fetchFailed"] == 1 and report["repaired"] == 1
    assert _outcomes(note) == ["fetch_failed", "repair_started", "repaired"]
    # a hotlink-only note whose fetch fails is not written at all
    only = _note("u2", "Notion", "notion:Export/O.md", _doc({"type": "image", "attrs": {"src": HOT2}}))
    before = _note_row(only)
    _apply(run_id="run-2")
    assert _note_row(only) == before and _outcomes(only) == ["fetch_failed"]


def test_a_fetch_cap_leaves_the_member_for_a_same_run_resume(armed, web):
    """Fix round 1 (review M-1): runbook step 6 resumes with the SAME run id, so a member whose
    hotlinks the cap deferred is not finished; the resume fetches the rest."""
    a = _note("u1", "Notion", "notion:Export/A.md", _doc({"type": "image", "attrs": {"src": HOT}}))
    b = _note("u1", "Notion", "notion:Export/B.md", _doc({"type": "image", "attrs": {"src": HOT2}}))
    for url in (HOT, HOT2):
        web["routes"][url] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    first = _apply(max_fetches=1)
    assert (first["fetched"], first["fetchDeferred"]) == (1, 1)
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is False
    second = _apply(max_fetches=1)
    assert (second["fetched"], second["fetchDeferred"]) == (1, 0)
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is True
    for note in (a, b):
        assert json.loads(_note_row(note)[0])["content"][0]["attrs"]["src"].startswith("/api/j2/notes/attachments/")


def test_dead_hotlinks_never_stall_batches_and_are_retried_once_by_a_new_run(armed, web):
    """Fix round 2, I-6: a hotlink that failed to copy keeps its image and is DONE for this run:
    later batches of the same run skip it (no re-fetch, no budget). A NEW run retries it at most
    once more. 3 dead hotlink notes + 1 bare-URL note at `--max-notes 2`: the member finishes."""
    dead = [_note("u1", "Notion", f"notion:Export/D{i}.md",
                  _doc({"type": "image", "attrs": {"src": f"http://dead.example.com/{i}.png"}})) for i in range(3)]
    bare = _note("u1", "Notion", "notion:Export/B.md", BARE)
    runs = 0
    while not store.member_done(auth_db.get_connection(), RUN, "u1"):
        _apply(max_notes=2)
        runs += 1
        assert runs <= 4, "batches stalled"
    assert len(web["calls"]) == 3  # each dead link tried once in this run
    assert "https://example.com/post" in _note_row(bare)[0]
    for note in dead:
        assert json.loads(_note_row(note)[0])["content"][0]["attrs"]["src"].startswith("http://dead.")
    _apply(run_id="run-2")
    assert len(web["calls"]) == 6  # a new run retries each once more
    _apply(run_id="run-3")
    assert len(web["calls"]) == 6  # and then never again


def test_a_same_run_resume_keeps_a_live_deferred_hotlink_beside_a_dead_one(armed, web):
    """Round 2 S-5: only the URL that failed is done for the run. A live hotlink in the SAME note,
    deferred by `--max-fetches`, is fetched by a resume with the same run id (runbook step 13)."""
    dead, live = "http://dead.example.com/x.png", HOT
    note = _note("u1", "Notion", "notion:Export/M.md", _doc(
        {"type": "image", "attrs": {"src": dead}}, {"type": "image", "attrs": {"src": live}}))
    web["routes"][live] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    first = _apply(max_fetches=1)
    assert (first["fetchFailed"], first["fetchDeferred"]) == (1, 1)
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is False
    second = _apply(max_fetches=1)
    assert (second["fetched"], second["fetchFailed"]) == (1, 0)  # the dead one is not retried
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is True
    srcs = [n["attrs"]["src"] for n in json.loads(_note_row(note)[0])["content"]]
    assert srcs[0] == dead and srcs[1].startswith("/api/j2/notes/attachments/")
    assert web["calls"].count(dead) == 1 and web["calls"].count(live) == 1


def test_max_fetches_bounds_the_downloads(armed, web):
    note = _note("u1", "Notion", "notion:Export/H.md", _doc(
        {"type": "image", "attrs": {"src": HOT}}, {"type": "image", "attrs": {"src": HOT2}}))
    for url in (HOT, HOT2):
        web["routes"][url] = lambda: httpx.Response(200, content=PNG, headers={"content-type": "image/png"})
    report = _apply(max_fetches=1)
    assert len(web["calls"]) == 1 and report["fetched"] == 1
    body = json.loads(_note_row(note)[0])
    assert body["content"][1]["attrs"]["src"] == HOT2  # the second waits for the next run


# ── relist and notices ───────────────────────────────────────────────────────

def test_obsidian_relist_resets_only_active_obsidian_cursors(armed):
    _source("u1", "obsidian", sid="obs-active")
    _source("u1", "notion", sid="notion-active")
    _source("u2", "obsidian", active=False, sid="obs-paused")
    _sql("UPDATE j2_note_sources SET cursor = 'c-' || id")
    _note("u1", "obsidian", "obsidian:vault-uuid/A.md", BARE)
    _note("u2", "obsidian", "obsidian:vault-uuid/B.md", BARE)
    report = _apply()  # C10: off by default
    assert report["relistRequested"] == 0
    assert _q("SELECT id, cursor FROM j2_note_sources ORDER BY id") == [
        ("notion-active", "c-notion-active"), ("obs-active", "c-obs-active"), ("obs-paused", "c-obs-paused")]
    report = _apply(run_id="run-2", obsidian_relist=True)
    assert report["relistRequested"] == 1
    assert _q("SELECT id, cursor FROM j2_note_sources ORDER BY id") == [
        ("notion-active", "c-notion-active"), ("obs-active", None), ("obs-paused", "c-obs-paused")]
    rows = _q("SELECT user_id, note_id, outcome, actions_json FROM j2_import_repair_log"
              " WHERE outcome = 'relist_requested'")
    assert rows == [("u1", "obs-active", "relist_requested", json.dumps(["prior_cursor:c-obs-active"]))]


def test_notice_recorded_only_for_members_with_losses(armed):
    _note("u1", "Notion", "notion:Export/L.md", _doc({"type": "image", "attrs": {"src": REF_PREFIX + "a.png"}}))
    _note("u2", "Notion", "notion:Export/F.md", BARE)
    report = _apply()
    c = auth_db.get_connection()
    try:
        assert store.pending_notice(c, "u1") == 1 and store.pending_notice(c, "u2") is None
    finally:
        c.close()
    assert report["totals"]["noticeMembers"] == 1
