"""Plan F Task 6: selection, the one hands-off guard, and the dry-run scan.

Real schema (`ensure_schema` on a temp auth.db); notes come in through the file importer's own
`notes.import_confirm`, then their stored body is set directly (the shapes under test are ones
an OLD import left behind, which today's importer would not write).
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from api.services import auth_db
from api.services.journal_two import import_repair
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.import_repair import runner
from api.services.journal_two.note_connectors.convert import REF_PREFIX

FILE, LIVE, RELIST, ORPHANED = (import_repair.FILE, import_repair.CONNECTOR_LIVE,
                                import_repair.CONNECTOR_RELIST, import_repair.CONNECTOR_ORPHANED)


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    c = auth_db.get_connection()
    ensure_schema(c)
    c.close()
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "j2_attachments")
    return tmp_path


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def _para(*inline):
    return {"type": "paragraph", "content": list(inline)}


def _t(text, *marks):
    node = {"type": "text", "text": text}
    if marks:
        node["marks"] = [dict(m) for m in marks]
    return node


def _link(href):
    return {"type": "link", "attrs": {"href": href}}


def _note(user, source, key, body, *, title="t"):
    out = notes_svc.import_confirm(user, {"source": source, "destFolderId": None, "notes": [{
        "importKey": key, "title": title, "bodyJson": _doc(_para(_t("x"))), "tags": [], "folderPath": [],
        "updatedAt": "2026-08-01T00:00:00+00:00"}]})
    note_id = (out["created"] + out["updated"])[0]["id"]
    c = auth_db.get_connection()
    try:
        c.execute("UPDATE j2_notes SET body_json = ? WHERE id = ?", (json.dumps(body), note_id))
        c.commit()
    finally:
        c.close()
    return note_id


def _sql(statement, *params):
    c = auth_db.get_connection()
    try:
        c.execute(statement, params)
        c.commit()
    finally:
        c.close()


def _source(user, provider, *, active=True, last_full_sync_at=None, sid=None):
    _sql("INSERT INTO j2_note_sources (id, user_id, provider, remote_id, status, sync_enabled,"
         " last_full_sync_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, '2026-08-01T00:00:00+00:00')",
         sid or f"{user}-{provider}", user, provider, f"r-{provider}", "active" if active else "paused",
         1, last_full_sync_at)


def _scan(**kw):
    c = auth_db.get_connection()
    try:
        return runner.scan(c, run_id="t", **kw)
    finally:
        c.close()


def _row(import_source, *, updated_at="2026-08-01T00:00:00+00:00", imported_at="2026-08-01T00:00:00+00:00"):
    return runner.NoteRow(id="n", import_source=import_source, import_key="k", updated_at=updated_at,
                          imported_at=imported_at, body_bytes=10)


BARE = _doc(_para(_t("read https://example.com/post today")))
STRANDED = _doc({"type": "image", "attrs": {"src": REF_PREFIX + "imgs/a.png"}})


# ── constants and classify ───────────────────────────────────────────────────

def test_constants():
    assert runner.FLAG == "NOTE_IMPORT_REPAIR_ENABLED"
    assert runner.RUN_ID_DEFAULT == "2026-11-connector-fidelity-f"
    assert runner.MAX_SCAN_BODY_BYTES == 4_000_000 and runner.SAMPLE_PER_SHAPE == 5


def test_the_converter_precondition_is_0147_et_on_11_03():
    """C5: the nightly re-convert runs at 01:47 ET; DST ended 2026-11-01, so 01:47 EST on 11-03
    is 06:47Z. Derived here from the zone, so the constant cannot drift silently."""
    want = datetime(2026, 11, 3, 1, 47, tzinfo=ZoneInfo("America/New_York"))
    assert datetime.fromisoformat(runner.CONVERTER_NIGHTLY_AT) == want
    assert runner.CONVERTER_NIGHTLY_AT == "2026-11-03T06:47:00+00:00"


def test_classify_separates_file_labels_from_provider_ids():
    assert runner.classify(_row("Notion"), {"notion"}) == FILE
    assert runner.classify(_row("Obsidian"), {"obsidian"}) == FILE
    assert runner.classify(_row("Files (Markdown, Text, HTML, Word)"), set()) == FILE
    assert runner.classify(_row("UCT Notebook Export"), set()) == FILE
    assert runner.classify(_row("notion"), {"notion"}) == LIVE
    assert runner.classify(_row("notion"), set()) == ORPHANED
    assert runner.classify(_row("obsidian"), {"obsidian"}) == RELIST
    assert runner.classify(_row("obsidian"), set()) == ORPHANED
    assert runner.classify(_row("sample"), set()) is None  # C6: the stored-row check, `is_sample`


@pytest.mark.parametrize("archived", ["dropbox", "onenote", "onedrive"])
def test_classify_keeps_an_archived_providers_notes_as_connector_notes(archived):
    """The 2026-11-04 archive took these out of the registry. Their notes must keep the class they
    had before (a connector id, never a file importer label), so the guarded repair never treats
    them as FILE notes and adds the file markers to their bodies."""
    assert archived not in runner.registry._REGISTRY  # non-vacuity: only the archive clause can match
    assert runner.classify(_row(archived), set()) == ORPHANED
    assert runner.classify(_row(archived), {archived}) == LIVE
    # CONTROL: a lowercase name in neither set is still a file label
    assert runner.classify(_row("not-a-provider"), set()) == FILE


# ── the one guard ─────────────────────────────────────────────────────────────

def test_hands_off_is_the_one_predicate():
    assert runner.hands_off(_row("Notion", updated_at="2026-08-02T00:00:00+00:00")) is True
    assert runner.hands_off(_row("Notion")) is False


#: Fix round 1, I-2: the two classes `plan_note` writes. The guard is railed on both.
WRITABLE = [("Notion", "notion:Export/A.md", FILE), ("roam", "roam:g/p", ORPHANED)]


@pytest.mark.parametrize("source,key,note_class", WRITABLE)
def test_an_unreadable_stamp_is_hands_off(db, source, key, note_class):
    """C4: `edited_since_import` answers "not edited" when a stamp cannot be read. The repair
    never writes such a note: kept as edited, counted as `unreadableStamp`."""
    note = _note("u1", source, key, BARE)
    _sql("UPDATE j2_notes SET updated_at = 'not a time' WHERE id = ?", note)
    report = _scan()
    assert report["totals"]["byClass"][note_class] == 1
    assert report["totals"]["keptEdited"] == 1 and report["totals"]["unreadableStamp"] == 1
    assert report["totals"]["wouldRepairNotes"] == 0
    assert report["totals"]["byShape"]["bare_url"] == {"unedited": 0, "edited": 1}


EDITED_AT = "2099-01-01T00:00:00+00:00"  # later than any `imported_at` the import stamps (now)


@pytest.mark.parametrize("source,key,note_class", WRITABLE)
def test_scan_counts_an_edited_note_and_plans_no_write(db, monkeypatch, source, key, note_class):
    note = _note("u1", source, key, BARE)
    _sql("UPDATE j2_notes SET updated_at = ? WHERE id = ?", EDITED_AT, note)
    report = _scan()
    t = report["totals"]
    assert t["byClass"][note_class] == 1
    assert (t["keptEdited"], t["wouldRepairNotes"], t["legacyFinalize"]) == (1, 0, 0)
    assert t["byShape"] == {"bare_url": {"unedited": 0, "edited": 1}}
    if note_class == FILE:
        # C3: the legacy-finalize count is the file importer's own composition, never restated
        monkeypatch.setattr(notes_svc, "_edited_since_file_import", lambda conn, user_id, row: False)
        assert _scan()["totals"]["legacyFinalize"] == 1


@pytest.mark.parametrize("patch", [{"tags": ["mine"]}, {"title": "My title"}])
def test_a_real_edit_through_the_door_is_hands_off(db, patch):
    """Fix round 1, M-1: no synthetic stamp. A member edit through the live door
    (`notes.update_note`), right after a real import, keeps the note out of the repair."""
    out = notes_svc.import_confirm("u1", {"source": "Notion", "destFolderId": None, "notes": [{
        "importKey": "notion:Export/A.md", "title": "t", "bodyJson": BARE, "tags": [], "folderPath": [],
        "updatedAt": "2026-08-01T00:00:00+00:00"}]})
    note = (out["created"] + out["updated"])[0]["id"]
    assert _scan()["totals"]["wouldRepairNotes"] == 1  # unedited: the bare URL would be linked
    notes_svc.update_note("u1", note, patch)
    t = _scan()["totals"]
    assert (t["keptEdited"], t["wouldRepairNotes"]) == (1, 0)


def test_the_guard_is_what_stops_the_write(db, monkeypatch):
    """Control: with `hands_off` forced False the edited note IS planned, so the edited test
    above cannot pass for another reason."""
    note = _note("u1", "Notion", "notion:Export/A.md", BARE)
    _sql("UPDATE j2_notes SET updated_at = ? WHERE id = ?", EDITED_AT, note)
    monkeypatch.setattr(runner, "hands_off", lambda row: False)
    assert _scan()["totals"]["wouldRepairNotes"] == 1


# ── the scan ─────────────────────────────────────────────────────────────────

REPORT_KEYS = {"runId", "mode", "startedAt", "finishedAt", "peakRssMb", "sourcesNotFullSyncedSinceConverter",
               "totals", "perMember", "samples"}
TOTALS_KEYS = {"members", "notesScanned", "tooLargeToScan", "byClass", "byShape", "bySource", "wouldRepairNotes",
               "hotlinksToFetch", "keptEdited", "legacyFinalize", "obsidianSourcesToRelist", "noticeMembers",
               # rulings: C4, C11, Task 3/4 carry-ins
               "unreadableStamp", "byClassShape", "lostLinks", "unreadableBody"}


def test_scan_counts_per_member_shape_and_source(db):
    obs = _note("u1", "Obsidian", "obsidian:Vault/Notes/Here.md", _doc(
        _para(_t("other", _link("Other.md"))),        # a relative note link (resolves)
        _para(_t("see https://example.com/a now")),   # a bare URL
        {"type": "image", "attrs": {"src": "https://cdn.example.com/x.png"}}))
    _note("u1", "Obsidian", "obsidian:Vault/Notes/Other.md", _doc(_para(_t("plain"))))
    lost = _note("u1", "Notion", "notion:Export/Lost.md", STRANDED)
    _note("u2", "Evernote", "evernote:nb/t/1", _doc(_para(_t("plain"))))
    report = _scan()
    assert set(report) == REPORT_KEYS and set(report["totals"]) == TOTALS_KEYS
    assert report["mode"] == "dry-run" and report["runId"] == "t"
    t = report["totals"]
    assert (t["members"], t["notesScanned"], t["tooLargeToScan"]) == (2, 4, 0)
    assert t["byClass"] == {FILE: 4, LIVE: 0, RELIST: 0, ORPHANED: 0}
    assert t["byShape"] == {"relative_note_href": {"unedited": 1, "edited": 0},
                            "bare_url": {"unedited": 1, "edited": 0},
                            "hotlinked_image": {"unedited": 1, "edited": 0},
                            "stranded_media_ref": {"unedited": 1, "edited": 0}}
    assert t["byClassShape"] == {FILE: t["byShape"]}
    assert t["bySource"] == {"Obsidian": {"relative_note_href": 1, "bare_url": 1, "hotlinked_image": 1},
                             "Notion": {"stranded_media_ref": 1}}
    assert (t["wouldRepairNotes"], t["hotlinksToFetch"], t["noticeMembers"]) == (2, 1, 1)
    assert report["perMember"] == [{"userId": "u1", "notes": 3, "wouldRepair": 2, "lossNotes": 1, "lostLinks": 0,
                                    "byShape": {"relative_note_href": 1, "bare_url": 1, "hotlinked_image": 1,
                                                "stranded_media_ref": 1}}]
    assert report["samples"]["stranded_media_ref"] == [lost] and report["samples"]["bare_url"] == [obs]
    text = json.dumps(report)
    assert "plain" not in text and "example.com" not in text  # no titles, no text


def test_plan_note_for_a_file_note_links_marks_and_lists_hotlinks(db):
    note = _note("u1", "Obsidian", "obsidian:Vault/Here.md", _doc(
        _para(_t("deck", _link("deck.pdf")), _t(" see https://example.com/a")),
        {"type": "image", "attrs": {"src": REF_PREFIX + "a.png"}},
        {"type": "image", "attrs": {"src": "https://cdn.example.com/x.png"}}))
    report = _scan()
    assert report["totals"]["lostLinks"] == 1 and report["perMember"][0]["lostLinks"] == 1
    c = auth_db.get_connection()
    try:
        row = next(r for r in runner.iter_note_rows(c, "u1") if r.id == note)
        index = runner.links.build_file_key_index(c, "u1")
        plan = runner.plan_note(c, "u1", row, FILE, index)
    finally:
        c.close()
    assert plan.loss is True and plan.lost_links == 1 and plan.hotlinks == ["https://cdn.example.com/x.png"]
    kinds = [n["type"] for n in plan.new_doc["content"]]
    assert kinds == ["paragraph", "importNotice", "importNotice", "image"]  # the file link's marker, the lost image's
    assert "linkified" in plan.actions and "relative_file_unresolved" in plan.actions


def test_a_hotlink_only_note_would_be_repaired(db):
    """Fix round 1, M-2: the apply replaces the hotlink's `src` with our copy, a write, so the
    owner's go/no-go number counts it."""
    _note("u1", "Notion", "notion:Export/H.md", _doc({"type": "image", "attrs": {"src": "https://cdn.example.com/x.png"}}))
    report = _scan()
    assert (report["totals"]["hotlinksToFetch"], report["totals"]["wouldRepairNotes"]) == (1, 1)
    assert report["perMember"][0]["wouldRepair"] == 1


@pytest.mark.parametrize("edited", [False, True])
def test_a_lost_file_link_is_a_loss_the_member_is_told_about(db, edited):
    """Fix round 1, I-1: a FILE note whose ONLY problem is a link to a file that never came over
    is a lost file: counted in `lostLinks` and in `lossNotes` / `noticeMembers`, edited or not
    (counting is read-only; only the write waits on the guard)."""
    note = _note("u1", "Obsidian", "obsidian:Vault/Here.md", _doc(_para(_t("deck", _link("deck.pdf")))))
    if edited:
        _sql("UPDATE j2_notes SET updated_at = ? WHERE id = ?", EDITED_AT, note)
    report = _scan()
    t = report["totals"]
    assert (t["lostLinks"], t["noticeMembers"]) == (1, 1)
    assert report["perMember"][0]["lossNotes"] == 1 and report["perMember"][0]["lostLinks"] == 1
    assert t["wouldRepairNotes"] == (0 if edited else 1)


def test_scan_counts_live_connector_notes_but_never_plans_them(db):
    _source("u1", "notion")
    _source("u1", "obsidian")
    live = _note("u1", "notion", "notion:11111111-2222-3333-4444-555555555555", BARE)
    relist = _note("u1", "obsidian", "obsidian:vault-uuid/A.md", BARE)
    orphan = _note("u1", "roam", "roam:g/p", _doc(_para(_t("see https://example.com/a")),
                                                  {"type": "image", "attrs": {"src": REF_PREFIX + "r.png"}}))
    report = _scan()
    t = report["totals"]
    assert t["byClass"] == {FILE: 0, LIVE: 1, RELIST: 1, ORPHANED: 1}
    assert t["byShape"]["bare_url"] == {"unedited": 3, "edited": 0}  # counted for every class
    assert t["wouldRepairNotes"] == 1  # only the orphaned note
    assert t["obsidianSourcesToRelist"] == 1 and t["noticeMembers"] == 0 and t["hotlinksToFetch"] == 0
    c = auth_db.get_connection()
    try:
        rows = {r.id: r for r in runner.iter_note_rows(c, "u1")}
        index = runner.links.build_file_key_index(c, "u1")
        for note, cls in ((live, LIVE), (relist, RELIST)):
            assert runner.plan_note(c, "u1", rows[note], cls, index).new_doc is None
        plan = runner.plan_note(c, "u1", rows[orphan], ORPHANED, index)
    finally:
        c.close()
    # a connector note is linkified, but its pending media ref is never marked: the engine may
    # still retry it (media_pending_state == 1), so no missing_from_import marker there
    assert plan.new_doc["content"][1] == {"type": "image", "attrs": {"src": REF_PREFIX + "r.png"}}
    assert plan.loss is False and plan.hotlinks == []


def test_sources_not_full_synced_since_the_converter(db):
    _source("u1", "notion", last_full_sync_at="2026-11-03T06:46:59+00:00", sid="a")
    _source("u1", "dropbox", last_full_sync_at="2026-11-03T06:47:00+00:00", sid="b")
    _source("u2", "roam", last_full_sync_at=None, sid="c")
    _source("u2", "craft", active=False, last_full_sync_at=None, sid="d")
    assert _scan()["sourcesNotFullSyncedSinceConverter"] == 2


def test_scan_opens_nothing_for_write(db):
    _note("u1", "Notion", "notion:Export/A.md", STRANDED)
    _note("u1", "Obsidian", "obsidian:Vault/B.md", BARE)
    ro = sqlite3.connect(f"file:{auth_db._DB_PATH}?mode=ro", uri=True)
    ro.row_factory = sqlite3.Row  # C13: what the CLI sets on its read-only connection
    try:
        report = runner.scan(ro, run_id="t")
        assert report["totals"]["notesScanned"] == 2
        assert ro.total_changes == 0
    finally:
        ro.close()


def test_huge_body_is_counted_not_parsed(db, monkeypatch):
    huge = _note("u1", "Notion", "notion:Export/Big.md", _doc(_para(_t("y" * 400))))
    _note("u1", "Notion", "notion:Export/Small.md", BARE)
    monkeypatch.setattr(runner, "MAX_SCAN_BODY_BYTES", 300)
    seen = []
    real_loads = json.loads

    def spy(text, *a, **k):
        seen.append(text)
        return real_loads(text, *a, **k)

    monkeypatch.setattr(runner.json, "loads", spy)
    loaded = []
    real_load_body = runner.load_body
    monkeypatch.setattr(runner, "load_body", lambda conn, nid: loaded.append(nid) or real_load_body(conn, nid))
    report = _scan()
    assert report["totals"]["tooLargeToScan"] == 1 and report["totals"]["notesScanned"] == 2
    assert huge not in loaded and not any("y" * 400 in s for s in seen if isinstance(s, str))


def test_bodies_are_read_one_at_a_time(db, monkeypatch):
    """D3: the note list carries no body, and at most ONE body is alive at any time."""
    for i in range(4):
        _note("u1", "Notion", f"notion:Export/{i}.md", BARE)
    statements = []
    live = {"now": 0, "high": 0}

    class Tracked(str):
        def __del__(self):
            live["now"] -= 1

    real = runner.load_body

    def tracked(conn, note_id):
        live["now"] += 1
        live["high"] = max(live["high"], live["now"])
        return Tracked(real(conn, note_id))

    monkeypatch.setattr(runner, "load_body", tracked)
    c = auth_db.get_connection()
    try:
        c.set_trace_callback(statements.append)
        rows = list(runner.iter_note_rows(c, "u1"))
        listing = [s for s in statements if "FROM j2_notes" in s]
        # only its SIZE: `length(CAST(body_json AS BLOB))`, never the column itself
        assert listing and all(
            "body_json" not in s.split("FROM")[0].replace("length(CAST(body_json AS BLOB))", "")
            for s in listing)
        assert {r.body_bytes for r in rows} == {len(json.dumps(BARE))}
        c.set_trace_callback(None)
        report = runner.scan(c, run_id="t")
    finally:
        c.close()
    assert report["totals"]["notesScanned"] == 4
    assert live["high"] == 1 and live["now"] == 0
