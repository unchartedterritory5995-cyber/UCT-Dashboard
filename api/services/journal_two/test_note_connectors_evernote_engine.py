"""The messy Evernote live corpus through the REAL engine (Plan E Task 9).

`corpora/corpora_gen.py::_run_evernote` runs `engine.sync_source` with the real `EvernoteProvider`
and the real `EvernoteMcpClient` against `EvernoteAccount`, a mock of Evernote's hosted MCP server,
its token endpoint and `storage.googleapis.com` (`httpx.MockTransport` under `no_network()`,
`base._resolve_host` patched to `PUBLIC_TEST_ADDRESS`). The dump is synthetic
(`corpora/evernote_live_messy.json`) and uses only the measured key names. Three full passes:

  * pass 1: the first import, with one `.enex` row waiting to be adopted;
  * between 1 and 2: the member edits two notes in UCT; the remote edits one of them, trashes one
    synced note, expunges another, writes the target of a link, and the access token expires;
  * pass 3: no remote change at all.

Every test reads what the engine STORED (`run[...]`), never a re-converted copy. The byte rail
`test_evernote_corpus_fixture_is_current` keeps the committed fixture
`app/src/pages/journal-2-0/lib/importer/__fixtures__/connector_corpora/evernote_live_messy.json`
equal to a fresh run; `connectorCorpora.dom.test.js` mounts every stored body in the editor.

Regenerate after a deliberate change:
    python -m api.services.journal_two.note_connectors.corpora.corpora_gen
"""
from __future__ import annotations

import copy
import json
import pathlib
from typing import Any

import pytest
from PIL import Image

from api.services.journal_two.note_connectors import evernote_mcp
from api.services.journal_two.note_connectors.corpora import corpora_gen as gen

CORPUS = "evernote_live_messy"
USER = "u-evernote"
NOTE_HREF = "/journal?j2tab=notebook&note={}"
ATTACHMENTS = "/api/j2/notes/attachments/"


def G(n: int) -> str:
    return f"e0000000-0000-4000-8000-{n:012d}"


def KEY(n: int) -> str:
    return f"evernote:guid:{G(n)}"


(HUB, TARGET, CHECK, WALL, CLIP, BIG, HUGE, EDITED_CHANGED, EDITED_SAME, LATER, TRASHED_SYNCED,
 TRASHED_A, TRASHED_B, PURGED, NULL_RESOURCES, NULL_HIT, ADOPTED, EDITED_PENDING) = range(1, 19)
#: Adoption failure reasons (Task 8): any reason check must match both.
ADOPTION_REASONS = ("adoption ambiguous", "adoption refused, import date unreadable")


# ── the one run ────────────────────────────────────────────────────────────────

def _dump() -> dict[str, Any]:
    return json.loads(gen.EVERNOTE_DUMP.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def work(tmp_path_factory) -> pathlib.Path:
    return tmp_path_factory.mktemp("evernote_corpus")


@pytest.fixture(scope="module")
def run(work) -> dict[str, Any]:
    result = gen.build_evernote_variant(work, _dump())
    return {CORPUS: result, "_refused": list(gen.LAST_RUN_REFUSED)}


@pytest.fixture(scope="module")
def member(run) -> dict[str, Any]:
    return run[CORPUS]["members"][USER]


@pytest.fixture(scope="module")
def notes(member) -> dict[str, dict[str, Any]]:
    return {n["importKey"]: n for n in member["notes"]}


@pytest.fixture(scope="module")
def passes(member) -> list[dict[str, Any]]:
    return member["passes"]


def _walk(node: Any):
    if isinstance(node, dict):
        yield node
        for child in node.get("content") or []:
            yield from _walk(child)


def _nodes(body, node_type: str) -> list[dict[str, Any]]:
    return [n for n in _walk(body) if n.get("type") == node_type]


def _text(node) -> str:
    return "".join(n.get("text", "") for n in _nodes(node, "text"))


def _links(body) -> list[tuple[str, str]]:
    return [(n["text"], m["attrs"]["href"]) for n in _nodes(body, "text")
            for m in n.get("marks") or [] if m.get("type") == "link"]


def _href(body, text: str) -> str:
    hits = [href for t, href in _links(body) if t == text]
    assert len(hits) == 1, f"expected exactly one link reading {text!r}, got {hits}"
    return hits[0]


def _notices(body) -> dict[str, dict[str, Any]]:
    return {(n["attrs"]["name"] or n["attrs"]["reason"]): n["attrs"] for n in _nodes(body, "importNotice")}


def _file(work: pathlib.Path, url: str) -> pathlib.Path:
    assert url.startswith(ATTACHMENTS), url
    user, note_id, sub, name = url[len(ATTACHMENTS):].split("/")
    path = work / "evernote_variant" / "att" / user / "notes" / note_id / sub / name
    assert path.is_file(), f"{url} has no stored file"
    return path


def _image_size(work, node) -> tuple[tuple[int, int], str]:
    with Image.open(_file(work, node["attrs"]["src"])) as im:
        return im.size, im.format


def _all_failures(passes) -> list[str]:
    out = []
    for p in passes:
        out.extend(p["failures"])
        out.extend(f"{f['noteTitle']}: {f['reason']}" for f in p["failuresJson"])
    return out


# ── the drift rail and the guard ─────────────────────────────────────────────────

def test_evernote_corpus_fixture_is_current(run):
    """Raw bytes, as the other corpora. A difference means the engine, the provider or a
    converter changed what a member's note STORES: look at the diff, then regenerate."""
    committed = (gen.FIXTURES_OUT_DIR / f"{CORPUS}.json").read_bytes()
    assert gen.render(run[CORPUS]).encode("utf-8") == committed, (
        f"{CORPUS}: the engine's stored output differs from the committed fixture. Review the change, "
        "then run `python -m api.services.journal_two.note_connectors.corpora.corpora_gen`.")


def test_evernote_corpus_reached_no_network(run):
    assert run["_refused"] == []


def test_nothing_is_left_as_an_import_placeholder(member):
    for note in member["notes"]:
        assert "import-ref://" not in json.dumps(note["bodyJson"]), note["title"]


# ── the passes ─────────────────────────────────────────────────────────────────────

def test_every_pass_completed(passes):
    assert [{k: p[k] for k in ("status", "created", "updated", "skipped", "mediaUploaded", "conflicts",
                               "adopted", "sourceDeleted")} for p in passes] == [
        {"status": "ok", "created": 13, "updated": 1, "skipped": 0, "mediaUploaded": 9, "conflicts": 0,
         "adopted": 1, "sourceDeleted": 0},
        {"status": "ok", "created": 2, "updated": 1, "skipped": 10, "mediaUploaded": 1, "conflicts": 1,
         "adopted": 0, "sourceDeleted": 1},
        {"status": "ok", "created": 0, "updated": 0, "skipped": 13, "mediaUploaded": 0, "conflicts": 0,
         "adopted": 0, "sourceDeleted": 1},
        # Pass 4 (a member's removal check, an incremental pass): rate-limit fix round 1 (D1) does
        # not fetch the 11 notes whose stored revision matches the listing, and round 2 (N8)
        # counts them as `unchanged`, never `skipped` (the card's "Unchanged"): 2 were fetched.
        {"status": "ok", "created": 0, "updated": 0, "skipped": 2, "mediaUploaded": 0, "conflicts": 0,
         "adopted": 0, "sourceDeleted": 0}]
    assert passes[3]["removalCheckRan"] is True   # pass 4: a member's removal-check pass


def test_resync_is_idempotent(passes, member):
    p = passes
    for later in (p[2], p[3]):   # pass 3 (scheduler) and pass 4 (member removal check): no remote change
        assert later["created"] == later["updated"] == later["mediaUploaded"] == 0
        assert later["conflicts"] == later["adopted"] == 0
    # ...and no stored note was rewritten by it (the purge's tag is timestamp-neutral).
    assert [n["title"] for n in member["notes"] if n["updatedInLastPass"]] == []


def test_edited_and_remote_changed_gets_synced_copy(notes, passes):
    mine, theirs = notes[KEY(EDITED_CHANGED)], notes[f"{KEY(EDITED_CHANGED)}#remote"]
    assert _text(mine["bodyJson"]) == "My own notes, written in UCT. Do not overwrite."
    assert mine["title"] == "Edited and changed"
    assert theirs["title"] == "Edited and changed (synced copy)"
    assert _text(theirs["bodyJson"]) == "Remote text, version two."
    assert "sync-conflict" in mine["tags"] and "sync-conflict" in theirs["tags"]
    assert passes[1]["conflicts"] == 1
    assert mine["updatedInPasses"] == [1], "the member's edit time survives the conflict pass"
    assert theirs["updatedInPasses"] == [2]


def test_edited_and_remote_unchanged_untouched(notes):
    mine = notes[KEY(EDITED_SAME)]
    assert _text(mine["bodyJson"]) == "My edit; the remote never changed."
    assert mine["tags"] == []
    assert f"{KEY(EDITED_SAME)}#remote" not in notes
    # updated_at equal before and after passes 2 and 3 (moved only by its pass-1 creation).
    assert mine["updatedInPasses"] == [1]


def test_trashed_synced_note_is_tagged_source_deleted_not_erased(notes, passes):
    trashed = notes[KEY(TRASHED_SYNCED)]
    assert "source-deleted" in trashed["tags"]
    assert _text(trashed["bodyJson"]) == "Will be trashed in Evernote."
    assert trashed["updatedInPasses"] == [1], "tagging is timestamp-neutral"
    assert passes[1]["sourceDeleted"] == 1          # explicit trash signal: one pass
    for never_synced in (TRASHED_A, TRASHED_B):      # trashed before the first sync: never imported
        assert KEY(never_synced) not in notes


def test_purged_note_needs_two_full_passes(notes, passes):
    """Expunged outright (in neither listing): no explicit signal, so the 2-strike rule. Pass 2's
    one deletion is the trashed note, so the purge struck once there and severed at pass 3."""
    assert [p["sourceDeleted"] for p in passes] == [0, 1, 1, 0]
    purged = notes[KEY(PURGED)]
    assert "source-deleted" in purged["tags"]
    assert _text(purged["bodyJson"]) == "Will be expunged outright."
    assert purged["updatedInPasses"] == [1]


def test_token_rotation_mid_corpus(run, passes):
    """Expired at pass 2 -> exactly one refresh POST, carrying the stored refresh token; the
    rotated pair is in the store; pass 2 is ok. The server rejects the old access token, so a
    pass that used stale credentials would have cost a second POST."""
    oauth = run[CORPUS]["oauth"]
    assert oauth["refreshPosts"] == ["rt-1"]
    assert (oauth["storedRefreshToken"], oauth["storedAccessToken"]) == ("rt-2", "at-2")
    assert passes[1]["status"] == "ok" and passes[2]["status"] == "ok"


def test_only_read_tools_were_called_in_any_pass(run):
    calls = run[CORPUS]["toolCalls"]
    assert calls, "the rail must see the calls it judges"
    assert set(calls) <= evernote_mcp.READ_TOOLS
    # the client's own record and what reached the server are one list
    assert calls == run[CORPUS]["wireToolCalls"]


# ── media ────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def wall(notes):
    return notes[KEY(WALL)]["bodyJson"]


def test_oversize_attachment_is_a_too_large_notice(wall, passes):
    assert _notices(wall)["archive.zip"] == {
        "reason": "too_large", "name": "archive.zip", "sourceUrl": None, "attempts": 0,
        "ref": f"evernote-res://{G(WALL)}/{_dump()['notes'][G(WALL)]['resources'][6]}"}
    # refused on the DECLARED size (26 MB), before any download
    assert any("archive.zip is 27262976 bytes" in f for f in passes[0]["failures"])


def test_expired_attachment_url_recovers_on_retry(work, notes, wall, passes):
    """The first download answers 403 (an expired pre-signed URL): a retryable notice in pass 1.
    Pass 2 asks `get_attachment` again for a fresh URL and the copy lands."""
    assert {"name": "expired.png", "noteTitle": "Media wall",
            "reason": "Couldn't copy expired.png — retrying on the next sync"} in passes[0]["failuresJson"]
    assert passes[1]["mediaUploaded"] == 1
    assert "expired.png" not in _notices(wall)
    assert notes[KEY(WALL)]["importMediaPending"] == 0
    images = [_image_size(work, n) for n in _nodes(wall, "image")]
    assert ((16, 16), "PNG") in images
    assert notes[KEY(WALL)]["updatedInPasses"] == [1], "a media retry is timestamp-neutral"


def test_off_host_redirect_is_refused_and_named(wall, passes):
    assert _notices(wall)["moved.png"]["reason"] == "unsafe"
    assert {"name": "moved.png", "noteTitle": "Media wall",
            "reason": "moved.png wasn't copied: its address isn't allowed"} in passes[0]["failuresJson"]
    assert any("a hop left the allowed host storage.googleapis.com" in f for f in passes[0]["failures"])


def test_null_resources_note_imports_with_no_media(notes):
    assert _dump()["notes"][G(NULL_RESOURCES)]["resources"] is None   # the construct is in the dump
    note = notes[KEY(NULL_RESOURCES)]
    assert note["bodyJson"] == {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "A note whose resources field is null."}]}]}
    assert note["importMediaPending"] == 0


def test_media_wall_kinds(work, wall):
    """PNG/JPEG inline, HEIC converted with its original kept, PDF/SVG as files, a PNG typed
    application/octet-stream inline (fix round 1, concern 5: content wins), a missing resource
    named, the unreferenced resource appended last."""
    kinds = [(n["type"], n["attrs"].get("name") or n["attrs"].get("reason"))
             for n in wall["content"] if n["type"] != "paragraph"]
    assert kinds == [
        ("image", None), ("image", None), ("image", None), ("attachmentChip", "IMG_0412.heic"),
        ("attachmentChip", "report.pdf"), ("attachmentChip", "logo.svg"), ("image", None),
        ("importNotice", "archive.zip"), ("image", None), ("importNotice", "moved.png"),
        ("importNotice", "missing_resource"), ("image", None), ("image", None)]
    sizes = [_image_size(work, n) for n in _nodes(wall, "image")]
    assert sizes == [((40, 20), "PNG"), ((30, 18), "JPEG"), ((16, 32), "JPEG"), ((24, 12), "PNG"), ((16, 16), "PNG"),
                     ((20, 10), "PNG"), ((12, 6), "PNG")]
    heic = next(n for n in wall["content"] if n["type"] == "attachmentChip" and n["attrs"]["name"] == "IMG_0412.heic")
    assert _file(work, heic["attrs"]["href"]).read_bytes() == gen.HEIC_FIXTURE.read_bytes()
    assert not [n for n in _nodes(wall, "image") if n["attrs"]["src"].endswith(".svg")]


def test_image_inside_a_note_link_keeps_the_image_and_the_link(work, notes, wall):
    """Fix round 1 (concern 2, ruling): the linked image is copied AND the note link survives,
    right after it. No alt, so its text is the fixed label (fix round 2: never the URL, which holds
    the member's Evernote user id and shard); healed in the same pass, it opens the target note.
    (Was: the link was dropped, as `enml_parity/08` then pinned on both lanes.)"""
    content = wall["content"]
    at = next(i for i, n in enumerate(content) if n["type"] == "image" and _image_size(work, n)[0] == (20, 10))
    after = content[at + 1]
    assert after["type"] == "paragraph"
    assert _links(after) == [("Linked note", NOTE_HREF.format(notes[KEY(TARGET)]["id"]))]
    assert "/view/123/s1/" not in json.dumps(wall)
    assert notes[KEY(WALL)]["importLinksPending"] == 0


# ── structure and links ───────────────────────────────────────────────────────────

def test_table_with_a_merged_looking_header_keeps_every_cell(notes):
    table = _nodes(notes[KEY(HUB)]["bodyJson"], "table")[0]
    rows = [[_text(c) for c in row["content"]] for row in table["content"]]
    assert rows == [["Q3 watchlist"], ["Ticker", "Setup"], ["NVDA", "Flag"]]


def test_checklist_keeps_its_state_and_trailing_text(notes):
    items = _nodes(notes[KEY(CHECK)]["bodyJson"], "taskItem")
    assert [(i["attrs"]["checked"], _text(i)) for i in items] == [
        (True, "Buy the dip only on volume"), (False, "Review stops"), (False, "Journal the trade")]


def test_codeblock_div_is_one_code_block(notes):
    blocks = _nodes(notes[KEY(CHECK)]["bodyJson"], "codeBlock")
    assert [_text(b) for b in blocks] == ["def risk(r):\n    return r * 0.01"]


def test_nested_lists_keep_three_levels(notes):
    body = notes[KEY(CHECK)]["bodyJson"]
    outer = [n for n in body["content"] if n["type"] == "orderedList"][0]
    level2 = _nodes(outer["content"][0], "bulletList")[0]
    level3 = _nodes(level2, "orderedList")[0]
    assert _text(level3) == "Level three"
    assert [_text(li["content"][0]) for li in outer["content"]] == ["Level one", "Level one again"]


def test_en_crypt_is_a_sentence_never_ciphertext(notes):
    body = notes[KEY(HUB)]["bodyJson"]
    assert "[encrypted content — cannot be imported]" in [_text(p) for p in _nodes(body, "paragraph")]
    assert "U2FsdGVkX19vY29ycHVz" not in json.dumps(body)


def test_guid_links_in_both_url_forms_are_note_links(notes):
    hub = notes[KEY(HUB)]
    assert _href(hub["bodyJson"], "the target") == NOTE_HREF.format(notes[KEY(TARGET)]["id"])
    # the web form's target was written only before pass 2: healed then
    assert _href(hub["bodyJson"], "Later note") == NOTE_HREF.format(notes[KEY(LATER)]["id"])
    assert hub["importLinksPending"] == 0
    assert hub["updatedInPasses"] == [1], "a heal is timestamp-neutral"


def test_share_link_is_title_healed(notes):
    assert _href(notes[KEY(HUB)]["bodyJson"], "Target Note") == NOTE_HREF.format(notes[KEY(TARGET)]["id"])


def test_web_links_kept_unsafe_and_relative_hrefs_are_text(notes):
    body = notes[KEY(HUB)]["bodyJson"]
    assert _href(body, "site") == "https://example.com/page"
    para = next(p for p in _nodes(body, "paragraph") if _text(p).startswith("Links:"))
    assert _text(para) == "Links: site | script | root relative | file relative"
    assert _links(para) == [("site", "https://example.com/page")]
    assert "javascript" not in json.dumps(body)


def test_web_clip_carries_its_source_and_resolves_relative_links(work, notes):
    body = notes[KEY(CLIP)]["bodyJson"]
    assert _links(body["content"][0]) == [
        ("https://news.example.com/markets/story.html", "https://news.example.com/markets/story.html")]
    assert _href(body, "read more") == "https://news.example.com/more.html"
    assert [_image_size(work, n) for n in _nodes(body, "image")] == [((10, 10), "PNG")]   # hotlink copied


def test_six_hundred_kb_note_imports_whole(notes):
    body = notes[KEY(BIG)]["bodyJson"]
    assert len(json.dumps(body)) > 600_000
    paras = _nodes(body, "paragraph")
    assert len(paras) == 3000 and _text(paras[-1]).startswith("Line 3000: ")


def test_oversize_note_is_isolated_and_named(notes, passes):
    """Over the 1 MB body limit: not stored, named in every pass, and nothing else is held back.
    Fix round 1 (concern 4): named by TITLE for the member, once per pass in the log's
    `failures_json`; the engine's own failure string (by import key) is kept as it was."""
    assert KEY(HUGE) not in notes
    for p in passes:
        named = [f for f in p["failures"] if KEY(HUGE) in f]
        assert named == [f"note {KEY(HUGE)!r} could not be stored: This note is too long to save as one "
                         "page. Split it into two or more notes and try again."]
        by_title = [f for f in p["failuresJson"] if f["noteTitle"] == "Over the limit"]
        assert by_title == [{"noteTitle": "Over the limit", "name": None, "reason": (
            "This note is too long to save as one page. Split it into two or more notes and try again.")}]
        assert p["status"] == "ok"
    assert passes[0]["created"] == 13


def test_notebooks_in_a_stack_and_one_unstacked(notes):
    assert notes[KEY(HUB)]["folderPath"] == ["Markets", "Trading"]
    assert notes[KEY(TARGET)]["folderPath"] == ["Markets", "Research"]
    assert notes[KEY(CHECK)]["folderPath"] == ["Inbox"]


def test_tags_in_string_and_object_form(notes):
    assert notes[KEY(HUB)]["tags"] == ["earnings", "swing"]     # an id string and a label string
    assert notes[KEY(TARGET)]["tags"] == ["A+"]                 # {guid, name}
    assert notes[KEY(CHECK)]["tags"] == ["earnings"]            # {guid} only: resolved by id


def test_undated_search_hit_still_imports(notes):
    assert _dump()["notes"][G(NULL_HIT)]["hit"] == {"createdAt": None, "updatedAt": None}
    assert _text(notes[KEY(NULL_HIT)]["bodyJson"]) == "Its search hit carries no timestamps."


def test_no_evernote_note_shape_failures_on_measured_payloads(passes):
    """The live gate's criterion, proven on the corpus first: measured payloads raise no shape,
    notebook or tag drift."""
    found = [f for f in _all_failures(passes)
             if "evernote note shape" in f or "not listed" in f]
    assert found == []


def test_enex_note_adopted_once_no_duplicate(notes, passes):
    adopted = [n for n in notes.values() if n["title"] == "Imported plan"]
    assert [n["importKey"] for n in adopted] == [KEY(ADOPTED)]
    assert [p["adopted"] for p in passes] == [1, 0, 0, 0]
    assert not [f for f in _all_failures(passes) if any(r in f for r in ADOPTION_REASONS)]


# ── the engine fix this corpus found: a pending media retry once the cursor moves ──────────

@pytest.fixture(scope="module")
def cursor_moves(cursor_moves_run) -> dict[str, Any]:
    return cursor_moves_run["members"][USER]


@pytest.fixture(scope="module")
def cursor_moves_run(tmp_path_factory) -> dict[str, Any]:
    """The same dump WITHOUT the oversize note. That note is never stored, so in the full corpus
    it holds the cursor still (session-audit A1) and every pass re-lists everything, which hid
    the defect: with the cursor free to move, an unchanged note is never listed again."""
    dump = _dump()
    variant = copy.deepcopy(dump)
    for p in variant["passes"]:
        p["active"] = [g for g in p["active"] if g != G(HUGE)]
    result = gen.build_evernote_variant(tmp_path_factory.mktemp("evernote_cursor_moves"), variant)
    assert gen.LAST_RUN_REFUSED == []
    return result


def test_pending_media_retries_after_the_cursor_moves(cursor_moves):
    passes = cursor_moves["passes"]
    # the cursor really moved: pass 2 listed a delta, not the whole account
    assert passes[1]["skipped"] < 5
    wall = next(n for n in cursor_moves["notes"] if n["importKey"] == KEY(WALL))
    assert "expired.png" not in _notices(wall["bodyJson"])
    assert wall["importMediaPending"] == 0
    assert passes[1]["mediaUploaded"] == 1


# ── fix round 1, M2: a member-edited note with pending media, and a removal-check pass ──────

def test_member_edited_note_with_pending_media_is_left_to_the_member(notes):
    note = notes[KEY(EDITED_PENDING)]
    assert _text(note["bodyJson"]) == "I wrote this myself; the chart can wait."
    assert note["importMediaPending"] == 1           # its copy never landed; the member owns the note
    assert note["updatedInPasses"] == [1]


def test_member_edited_note_is_never_refetched_once_the_cursor_moves(cursor_moves_run):
    """With the cursor free to move, the edited note is outside every later delta, and the media
    retry never picks it (I1): `get_note` is asked for it in pass 1 only."""
    fetched = cursor_moves_run["getNoteByPass"]
    assert [G(EDITED_PENDING) in ids for ids in fetched] == [True, False, False, False]


def test_removal_check_pass_fetches_only_its_delta(cursor_moves_run):
    """Pass 4 is a member's removal check with no remote change: it fetches at most the delta
    the scheduler pass before it fetched, never a media retry (C2). ⛔ Live bug 2026-11-03: D1's
    stored-revision skip applies only while a first import catches up (cursor None), so this
    incremental pass fetches its whole delta again (a lagging listing revision must never hide
    an edit); `import_confirm`'s hash check makes the refetch a no-op write."""
    fetched = cursor_moves_run["getNoteByPass"]
    assert cursor_moves_run["members"][USER]["passes"][3]["removalCheckRan"] is True
    assert set(fetched[3]) <= set(fetched[2])
    assert len(fetched[3]) < 5

