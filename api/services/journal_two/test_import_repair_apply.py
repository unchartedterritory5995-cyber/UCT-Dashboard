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

    def spy(conn, user_id, note_id, body, *, expected_updated_at):
        seen.append(_q("SELECT outcome, before_body_json FROM j2_import_repair_log WHERE note_id = ?", note_id))
        return real(conn, user_id, note_id, body, expected_updated_at=expected_updated_at)

    monkeypatch.setattr(engine, "_apply_resolved_body", spy)
    _apply()
    assert seen == [[("repair_started", stored_before)]]
    assert _outcomes(note) == ["repair_started", "repaired"]


def test_a_failing_write_is_logged_and_the_run_goes_on(armed, monkeypatch):
    first = _note("u1", "Notion", "notion:Export/A.md", BARE)
    second = _note("u1", "Notion", "notion:Export/B.md", BARE)
    real = engine._apply_resolved_body

    def boom(conn, user_id, note_id, body, *, expected_updated_at):
        if note_id == first:
            raise RuntimeError("disk")
        return real(conn, user_id, note_id, body, expected_updated_at=expected_updated_at)

    monkeypatch.setattr(engine, "_apply_resolved_body", boom)
    report = _apply()
    assert (report["failed"], report["repaired"]) == (1, 1)
    assert _outcomes(first) == ["repair_started", "failed"] and _outcomes(second)[-1] == "repaired"
    assert store.member_done(auth_db.get_connection(), RUN, "u1") is True


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
