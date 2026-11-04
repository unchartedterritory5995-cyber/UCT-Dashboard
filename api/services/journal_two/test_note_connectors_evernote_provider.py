"""Tests for `EvernoteProvider` (Plan E Task 5).

No network: the MCP client is a fake built from the MEASURED `structuredContent` shapes
(`docs/notebook-connectors/evernote-mcp-probe.md`, "Measured field names"), and attachment
downloads go through `httpx.MockTransport` with `base._resolve_host` answering a public test
address (as `corpora_gen` does).
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
import pytest

from api.services.journal_two import import_provenance
from api.services.journal_two.note_connectors import errors, evernote_oauth
from api.services.journal_two.note_connectors.evernote_mcp import READ_TOOLS, WriteToolRefused
from api.services.journal_two.note_connectors.providers import base
from api.services.journal_two.note_connectors.providers import evernote as ev
from api.services.journal_two.note_connectors.providers.base import RemoteRef

PUBLIC = "142.250.0.1"
CREDS = {"accessToken": "at-0", "refreshToken": "rt-0", "clientId": "cid"}
G1 = "11111111-aaaa-4bbb-8ccc-000000000001"
H1 = "a" * 32
EPOCH_FLOOR = "1970-01-01T00:00:00.000+00:00"


def _guid(i: int) -> str:
    return f"00000000-0000-4000-8000-{i:012d}"


def _hit(i: int, updated: str | None = "2026-11-02T10:00:00Z", created: str | None = None,
         title: str | None = None) -> dict:
    return {"noteId": _guid(i), "title": title or f"Note {i}", "snippet": None,
            "createdAt": created, "updatedAt": updated, "score": None}


def _note(guid: str = G1, **over: Any) -> dict:
    sc = {"id": guid, "title": "Plan", "version": 3, "updateSequenceNumber": 9,
          "notebookId": "nb-1", "content": '<en-note><div>body</div></en-note>',
          "created": 1762077600000, "updated": "2026-11-02T10:00:00-04:00", "active": True,
          "deleted": None, "tasks": [], "tags": None, "resources": None, "attributes": {}}
    sc.update(over)
    return sc


class FakeMcp:
    """Answers the five read tools from scripted data; refuses anything else like the real client."""

    def __init__(self, *, active: list[dict] | None = None, trash: list[dict] | None = None,
                 notes: dict[str, dict] | None = None, notebooks: list[dict] | None = None,
                 tags: list[dict] | None = None, attachments: dict[tuple, dict] | None = None,
                 totals: list[int] | None = None, after_page=None,
                 last_page_flag: bool | None = None):
        self.active = active or []
        self.trash = trash or []
        self.notes = notes or {}
        self.notebooks = notebooks or []
        self.tags = tags or []
        self.attachments = attachments or {}
        self.totals = list(totals or [])  # per full pass: the totalResultCount to report
        # Called as after_page(fake, query, startIndex) once a page is served: lets a test trash or
        # edit notes BETWEEN page calls, as a member using Evernote during a sync would.
        self.after_page = after_page
        self.last_page_flag = last_page_flag  # force isLastPage (None: computed)
        self.tool_calls: list[str] = []
        self.calls: list[tuple[str, dict]] = []
        self.closed = False
        self._pass_total: int | None = None

    async def call_tool(self, name: str, arguments: dict) -> dict:
        if name not in READ_TOOLS:
            raise WriteToolRefused(f"{name} refused")
        self.tool_calls.append(name)
        self.calls.append((name, dict(arguments)))
        if name == "search_notes":
            source = self.trash if arguments.get("query") == "intrash:true" else self.active
            start = arguments.get("startIndex", 0)
            size = arguments.get("maxResults", 100)
            if start == 0:
                self._pass_total = self.totals.pop(0) if self.totals else None
            total = self._pass_total if self._pass_total is not None else len(source)
            page = list(source[start:start + size])
            last = start + size >= len(source) if self.last_page_flag is None else self.last_page_flag
            result = {"hits": page, "totalResultCount": total, "startIndex": start, "isLastPage": last}
            if self.after_page is not None:
                self.after_page(self, arguments.get("query"), start)
            return result
        if name == "get_note":
            return self.notes[arguments["noteId"]]
        if name == "search_notebooks":
            return {"hits": self.notebooks, "totalResultCount": len(self.notebooks),
                    "startIndex": 0, "isLastPage": True}
        if name == "search_tags":
            return {"hits": self.tags, "totalResultCount": len(self.tags),
                    "startIndex": 0, "isLastPage": True}
        if name == "get_attachment":
            return self.attachments[(arguments["noteId"], arguments["hash"])]
        raise AssertionError(name)

    async def aclose(self) -> None:
        self.closed = True


def _provider(fake: FakeMcp, http: httpx.AsyncClient | None = None, user_id: str | None = "u1"):
    return ev.EvernoteProvider(user_id=user_id, mcp_factory=lambda creds: fake, http=http)


def _nb(i: str, label: str, stack: str | None = None) -> dict:
    return {"notebookId": i, "label": label, "searchFilter": f'notebook:"{label}"', "score": None,
            "stack": stack, "primaryAccess": "OWNED", "workspaceId": None, "workspaceName": None}


def _tag(i: str, label: str) -> dict:
    return {"tagId": i, "label": label, "searchFilter": f"tag:{label}", "score": None}


@pytest.fixture(autouse=True)
def _public_dns(monkeypatch):
    async def resolve(_host: str) -> list[str]:
        return [PUBLIC]

    monkeypatch.setattr(base, "_resolve_host", resolve)


# --------------------------------------------------------------------------- identity


def test_import_key_is_the_live_key():
    p = _provider(FakeMcp())
    assert p.import_key("account", G1) == f"evernote:guid:{G1}"
    assert p.name == "evernote" and p.adopt_import_source == "evernote"
    assert (p.PAGE_SIZE, p.CURSOR_OVERLAP_S, p.ATTACHMENT_HOST) == (100, 1800, "storage.googleapis.com")


def test_instant_is_public_in_import_provenance():
    assert import_provenance.instant("2026-11-02T10:00:00Z") is not None
    assert not hasattr(import_provenance, "_instant")


async def test_validate_reports_the_note_count():
    fake = FakeMcp(active=[_hit(i) for i in range(3)])
    info = await _provider(fake).validate(CREDS)
    assert info.label == "Evernote" and info.raw == {"noteCount": 3}


# --------------------------------------------------------------------------- listing


async def test_list_changed_without_cursor_pages_every_hit():
    fake = FakeMcp(active=[_hit(i) for i in range(215)])
    refs = await _provider(fake).list_changed(CREDS, None)
    assert len(refs) == 215 and len({r.remote_id for r in refs}) == 215
    pages = [a for n, a in fake.calls if n == "search_notes"]
    assert [a["startIndex"] for a in pages] == [0, 100, 200]
    for a in pages:
        assert a == {"query": "", "sortBy": "updated", "ascending": False, "maxResults": 100,
                     "startIndex": a["startIndex"]}


async def test_list_changed_with_cursor_stops_past_the_overlap_window():
    # Newest first: 150 recent hits, then older ones. Cursor 10:00; bound = 09:58.
    recent = [_hit(i, updated="2026-11-02T10:05:00Z") for i in range(150)]
    inside_overlap = [_hit(150, updated="2026-11-02T09:59:00Z")]   # within 120 s: returned
    older = [_hit(i, updated="2026-11-01T00:00:00Z") for i in range(151, 400)]
    fake = FakeMcp(active=recent + inside_overlap + older)
    refs = await _provider(fake).list_changed(CREDS, "2026-11-02T10:00:00.000+00:00")
    assert {r.remote_id for r in refs} == {_guid(i) for i in range(151)}
    pages = [a["startIndex"] for n, a in fake.calls if n == "search_notes"]
    assert pages == [0, 100]  # stopped at the first page holding an older hit


async def test_updated_at_is_normalised_to_utc_milliseconds():
    fake = FakeMcp(active=[_hit(1, updated="2026-11-02T10:00:00-04:00")])
    (ref,) = await _provider(fake).list_changed(CREDS, None)
    assert ref.updated_at == "2026-11-02T14:00:00.000+00:00"


@pytest.mark.parametrize("value,expected", [
    ("2026-11-02T10:00:00-04:00", "2026-11-02T14:00:00.000+00:00"),
    ("2026-11-02T14:00:00Z", "2026-11-02T14:00:00.000+00:00"),
    (1762092000000, "2025-11-02T14:00:00.000+00:00"),
    ("1762092000000", "2025-11-02T14:00:00.000+00:00"),
    (1762092000000.0, "2025-11-02T14:00:00.000+00:00"),
    (None, None), ("not a date", None), (True, None), ({}, None), (10 ** 30, None),
])
def test_iso_reads_iso_and_epoch_ms_and_never_raises(value, expected):
    assert ev._iso(value) == expected


async def test_null_updated_at_falls_back_to_created_at():
    fake = FakeMcp(active=[_hit(1, updated=None, created="2026-11-02T08:00:00Z")])
    (ref,) = await _provider(fake).list_changed(CREDS, None)
    assert ref.updated_at == "2026-11-02T08:00:00.000+00:00"


async def test_null_hit_timestamps_are_listed_and_never_move_the_cursor():
    cursor = "2026-11-02T10:00:00.000+00:00"
    fake = FakeMcp(active=[_hit(1, updated="2026-11-02T10:01:00Z"), _hit(2, updated=None, created=None),
                           _hit(3, updated="2026-11-01T00:00:00Z")])
    refs = await _provider(fake).list_changed(CREDS, cursor)
    by_id = {r.remote_id: r.updated_at for r in refs}
    assert by_id[_guid(2)] == cursor  # listed, at the floor
    assert max(by_id.values()) == "2026-11-02T10:01:00.000+00:00"
    fake2 = FakeMcp(active=[_hit(2, updated=None, created=None)])
    (ref,) = await _provider(fake2).list_changed(CREDS, None)
    assert ref.updated_at == EPOCH_FLOOR


# ---- review I2: a note trashed DURING paging shifts every later note up one place ----------


def _trash_once(index: int):
    """after_page hook: after page 0 is served (once), the note at `index` leaves the active set."""
    state = {"done": False}

    def hook(fake, query, start):
        if query == "" and start == 0 and not state["done"]:
            state["done"] = True
            del fake.active[index]

    return hook


def _trash_every_pass(fake, query, start):
    if query == "" and start == 0 and len(fake.active) > 1:
        del fake.active[0]


async def test_a_note_trashed_during_paging_never_hides_the_note_at_the_page_boundary():
    fake = FakeMcp(active=[_hit(i) for i in range(150)], after_page=_trash_once(50))
    refs = await _provider(fake).list_changed(CREDS, None)
    ids = {r.remote_id for r in refs}
    # Without the stable-total check, _guid(100) shifted to index 99 (page 0) after page 0 was
    # read, and was never returned; the engine's max cursor then moved past it for good.
    assert _guid(100) in ids
    assert ids == {_guid(i) for i in range(150) if i != 50}
    starts = [a["startIndex"] for n, a in fake.calls if n == "search_notes"]
    assert starts == [0, 100, 0, 100]  # the change was seen, the listing restarted once


async def test_a_listing_that_keeps_changing_is_transient_so_the_cursor_never_moves():
    fake = FakeMcp(active=[_hit(i) for i in range(150)], after_page=_trash_every_pass)
    with pytest.raises(errors.NoteConnTransient):
        await _provider(fake).list_changed(CREDS, None)
    restarts = [a for n, a in fake.calls if n == "search_notes" and a["startIndex"] == 0]
    assert len(restarts) == ev.LISTING_ATTEMPTS


async def test_present_refs_rejects_a_total_that_changes_between_pages():
    # m4: the unique count can equal the NEW total while a shifted note was skipped.
    fake = FakeMcp(active=[_hit(i) for i in range(150)], after_page=_trash_once(50))
    refs = await _provider(fake).list_present_refs(CREDS)
    assert len(refs) == 149 and _guid(100) in {r.remote_id for r in refs}


# ---- review minors -------------------------------------------------------------------------


async def test_a_hit_whose_id_is_not_a_guid_is_dropped_at_listing():
    # m1: it would otherwise become an import key the fetch refuses every pass, pinning the cursor.
    bad = {"noteId": "a/b", "title": "Odd", "snippet": None, "createdAt": None,
           "updatedAt": "2026-11-02T10:00:00Z", "score": None}
    fake = FakeMcp(active=[_hit(1), bad, _hit(2)])
    p = _provider(fake)
    refs = await p.list_changed(CREDS, None)
    assert [r.remote_id for r in refs] == [_guid(1), _guid(2)]
    assert p.drain_item_failures() == [
        {"noteTitle": "Odd", "reason": "evernote note shape: note id", "name": None}]


async def test_under_the_tag_cap_an_unknown_guid_like_string_is_dropped_not_a_label():
    # m2: with a partial (capped) map, a GUID-shaped string is an id we could not resolve.
    tags = [_tag(f"t-{i}", f"tag {i}") for i in range(100)]
    unknown = "99999999-0000-4000-8000-000000000999"
    fake = FakeMcp(notes={G1: _note(tags=["t-1", unknown, "Plain"])},
                   notebooks=[_nb("nb-1", "S")], tags=tags)
    p, note = await _fetch(fake)
    assert note.tags == ["tag 1", "Plain"]
    assert {"noteTitle": "Plan", "reason": f"evernote tag not listed: {unknown}", "name": None} in (
        p.drain_item_failures())


async def test_a_hit_exactly_at_the_overlap_bound_is_returned():
    # m3: the bound is inclusive (cursor 10:00, overlap 30 min since slot scheduling fix round 2
    # -> 09:30:00 is kept).
    fake = FakeMcp(active=[_hit(1, updated="2026-11-02T09:30:00Z"),
                           _hit(2, updated="2026-11-02T09:29:59.999Z")])
    refs = await _provider(fake).list_changed(CREDS, "2026-11-02T10:00:00.000+00:00")
    assert [r.remote_id for r in refs] == [_guid(1)]


async def test_present_refs_needs_the_last_page_flag_even_when_the_count_matches():
    # m3: a pager that ends on an empty page with isLastPage false is not a complete listing.
    fake = FakeMcp(active=[_hit(i) for i in range(5)], last_page_flag=False)
    with pytest.raises(errors.NoteConnTransient):
        await _provider(fake).list_present_refs(CREDS)


async def test_a_note_listed_twice_across_pages_keeps_its_newest_place():
    # m3: an edit during paging moves a note up; the total is unchanged, the note repeats.
    hits = [_hit(i, updated="2026-11-02T12:00:00Z") for i in range(100)]
    hits += [_hit(5, updated="2026-11-01T00:00:00Z")] + [_hit(i) for i in range(100, 110)]
    fake = FakeMcp(active=hits)
    refs = await _provider(fake).list_changed(CREDS, None)
    by_id = {}
    for r in refs:
        assert r.remote_id not in by_id
        by_id[r.remote_id] = r.updated_at
    assert by_id[_guid(5)] == "2026-11-02T12:00:00.000+00:00"


async def test_an_unparseable_cursor_enumerates_everything_at_the_epoch_floor():
    # m3: never a garbage floor, which a string max would keep as the cursor forever.
    fake = FakeMcp(active=[_hit(1, updated="2020-01-01T00:00:00Z"), _hit(2, updated=None, created=None)])
    refs = await _provider(fake).list_changed(CREDS, "not-a-time")
    assert {r.remote_id: r.updated_at for r in refs} == {
        _guid(1): "2020-01-01T00:00:00.000+00:00", _guid(2): EPOCH_FLOOR}


async def test_a_repeated_failure_names_its_first_note_and_counts_the_others():
    # m5: one row per reason, but it says how many notes it covers.
    notes = {_guid(i): _note(_guid(i), title=f"N{i}") for i in range(3)}
    for sc in notes.values():
        del sc["updated"]
    fake = FakeMcp(notes=notes, notebooks=[_nb("nb-1", "S")])
    p = _provider(fake)
    for i in range(3):
        await p.fetch(CREDS, RemoteRef(remote_id=_guid(i), updated_at="x"))
    assert p.drain_item_failures() == [
        {"noteTitle": "N0 (and 2 more)", "reason": "evernote note shape: missing updated", "name": None}]


async def test_present_refs_reenumerates_once_when_ids_do_not_match_total():
    fake = FakeMcp(active=[_hit(i) for i in range(150)], totals=[151, 150])
    refs = await _provider(fake).list_present_refs(CREDS)
    assert len(refs) == 150
    starts = [a["startIndex"] for n, a in fake.calls if n == "search_notes"]
    assert starts == [0, 100, 0, 100]


async def test_present_refs_raises_transient_after_two_mismatches():
    fake = FakeMcp(active=[_hit(i) for i in range(150)], totals=[151, 149])
    with pytest.raises(errors.NoteConnTransient):
        await _provider(fake).list_present_refs(CREDS)


async def test_present_refs_counts_unique_ids():
    dup = [_hit(i) for i in range(5)] + [_hit(0)]
    fake = FakeMcp(active=dup, totals=[6, 6])
    with pytest.raises(errors.NoteConnTransient):
        await _provider(fake).list_present_refs(CREDS)


async def test_list_deleted_queries_intrash_true():
    fake = FakeMcp(trash=[_hit(i) for i in range(3)])
    refs = await _provider(fake).list_deleted(CREDS)
    assert {r.remote_id for r in refs} == {_guid(i) for i in range(3)}
    assert {a["query"] for n, a in fake.calls if n == "search_notes"} == {"intrash:true"}


# --------------------------------------------------------------------------- fetch


def _fetch_fake(**note_over: Any) -> FakeMcp:
    return FakeMcp(notes={G1: _note(**note_over)},
                   notebooks=[_nb("nb-1", "Setups", stack="Trading"), _nb("nb-2", "Inbox")],
                   tags=[_tag("t-1", "breakout"), _tag("t-2", "earnings")])


async def _fetch(fake: FakeMcp, p=None):
    p = p or _provider(fake)
    return p, await p.fetch(CREDS, RemoteRef(remote_id=G1, updated_at="x"))


async def test_fetch_maps_stack_and_notebook_to_folder_path():
    _, note = await _fetch(_fetch_fake())
    assert note.folder_path == ["Trading", "Setups"]
    _, note = await _fetch(_fetch_fake(notebookId="nb-2"))
    assert note.folder_path == ["Inbox"]


async def test_fetch_maps_tag_ids_to_labels():
    _, note = await _fetch(_fetch_fake(tags=["t-1", "t-2"]))
    assert note.tags == ["breakout", "earnings"]


async def test_fetch_reads_the_measured_keys():
    p, note = await _fetch(_fetch_fake(tags=["t-1"], attributes={"sourceURL": "https://x.com/a"}))
    assert note.remote_id == G1 and note.title == "Plan"
    assert note.folder_path == ["Trading", "Setups"] and note.tags == ["breakout"]
    assert note.created_at == "2025-11-02T10:00:00.000+00:00"
    assert note.updated_at == "2026-11-02T14:00:00.000+00:00"
    first = note.doc["content"][0]
    assert "".join(n.get("text", "") for n in first["content"]) == "Source: https://x.com/a"
    assert p.drain_item_failures() == []


async def test_guessed_key_names_are_not_read():
    sc = {"id": G1, "title": "Plan", "content": "<en-note><div>b</div></en-note>",
          "resources": None, "notebookGuid": "nb-1", "tagIds": ["t-1"],
          "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z",
          "sourceUrl": "https://x.com/a"}
    p, note = await _fetch(FakeMcp(notes={G1: sc}, notebooks=[_nb("nb-1", "Setups")],
                                   tags=[_tag("t-1", "breakout")]))
    assert note.folder_path == [] and note.tags == []
    assert note.created_at is None and note.updated_at is None
    assert "x.com" not in str(note.doc)
    reasons = sorted(f["reason"] for f in p.drain_item_failures())
    assert reasons == sorted(f"evernote note shape: missing {k}"
                             for k in ("notebookId", "tags", "created", "updated", "attributes"))


async def test_fetch_missing_notebook_key_is_named_not_crashed():
    sc = _note()
    del sc["notebookId"]
    p, note = await _fetch(FakeMcp(notes={G1: sc}, notebooks=[_nb("nb-1", "Setups")]))
    assert note.folder_path == []
    assert p.drain_item_failures() == [
        {"noteTitle": "Plan", "reason": "evernote note shape: missing notebookId", "name": None}]


async def test_null_resources_is_an_empty_list_everywhere():
    content = f'<en-note><div>x</div><en-media hash="{H1}" type="image/png"/></en-note>'
    _, note = await _fetch(_fetch_fake(resources=None, content=content))
    assert note.media == []
    assert [n["attrs"]["reason"] for n in note.doc["content"] if n["type"] == "importNotice"] == [
        "missing_resource"]


async def test_null_resources_reach_the_converter_as_null(monkeypatch):
    """Task 9 fix round 1 (concern 6): the ONE null-resources guard is the converter's
    (`enml_to_tiptap(..., resources=None)`, T3's signature). The provider passes the measured
    value through untouched, so removing that one guard turns the corpus rail red on its own."""
    seen: list = []
    real = ev.enml.enml_to_tiptap

    def spy(content, resources, **kw):
        seen.append(resources)
        return real(content, resources, **kw)

    monkeypatch.setattr(ev.enml, "enml_to_tiptap", spy)
    await _fetch(_fetch_fake(resources=None, content="<en-note><div>x</div></en-note>"))
    assert seen == [None]


async def test_resources_become_media_refs():
    content = f'<en-note><en-media hash="{H1}" type="image/png"/></en-note>'
    res = [{"id": "r1", "hash": H1, "mime": "image/png", "name": "c.png", "sizeBytes": 5}]
    _, note = await _fetch(_fetch_fake(resources=res, content=content))
    assert note.media == [{"ref": f"evernote-res://{G1}/{H1}", "kind": "image", "name": "c.png",
                           "mime": "image/png"}]


async def test_tags_accept_strings_and_objects():
    tags = ["t-1", "Plain label", {"name": "Obj"}, {"guid": "t-2"}, {"label": "Lab"}, {"id": "t-9"},
            42]
    p, note = await _fetch(_fetch_fake(tags=tags))
    assert note.tags == ["breakout", "Plain label", "Obj", "earnings", "Lab"]
    assert sorted(f["reason"] for f in p.drain_item_failures()) == [
        "evernote note shape: tag element int", "evernote tag not listed: t-9"]


@pytest.mark.parametrize("attributes,source", [
    ({"sourceURL": "https://x.com/a"}, "https://x.com/a"),
    ({"sourceURL": {"name": "https://x.com/a"}}, "https://x.com/a"),
    ({"sourceURL": "ftp://x.com/a"}, None),
    ({"sourceURL": 5}, None),
    ("not a dict", None),
    (None, None),
])
async def test_attributes_source_url_accepts_string_or_named_object(attributes, source):
    p, note = await _fetch(_fetch_fake(attributes=attributes))
    first = note.doc["content"][0]
    texts = "".join(n.get("text", "") for n in first.get("content") or [])
    if source:
        assert texts == f"Source: {source}"
    else:
        assert not texts.startswith("Source:")
    assert p.drain_item_failures() == []


async def test_notebooks_and_tags_are_one_call_each_with_max_100():
    fake = FakeMcp(notes={G1: _note(tags=["t-1"]), _guid(2): _note(_guid(2), tags=["t-2"])},
                   notebooks=[_nb("nb-1", "Setups")], tags=[_tag("t-1", "a"), _tag("t-2", "b")])
    p = _provider(fake)
    await p.fetch(CREDS, RemoteRef(remote_id=G1, updated_at="x"))
    await p.fetch(CREDS, RemoteRef(remote_id=_guid(2), updated_at="x"))
    nb_calls = [a for n, a in fake.calls if n == "search_notebooks"]
    tag_calls = [a for n, a in fake.calls if n == "search_tags"]
    assert nb_calls == [{"query": "", "maxResults": 100}]
    assert tag_calls == [{"query": "", "maxResults": 100}]


async def test_no_tag_call_when_no_note_needs_an_id_lookup():
    fake = _fetch_fake(tags=[{"name": "x"}])
    await _fetch(fake)
    assert "search_tags" not in fake.tool_calls


async def test_cap_of_100_logs_a_warning_and_falls_back_to_note_fields(caplog):
    notebooks = [_nb(f"nb-{i}", f"NB {i}") for i in range(100)]
    fake = FakeMcp(notes={G1: _note(notebookId="nb-x", tags=[{"name": "kept"}])},
                   notebooks=notebooks)
    with caplog.at_level(logging.WARNING, logger=ev.log.name):
        p, note = await _fetch(fake)
    assert note.folder_path == [] and note.tags == ["kept"]
    assert sum("evernote notebooks listing hit the 100 cap" in r.message for r in caplog.records) == 1
    assert p.drain_item_failures() == [
        {"noteTitle": "Plan", "reason": "evernote notebook not listed: nb-x", "name": None}]


async def test_shape_sample_is_logged_once_with_keys_only(caplog):
    fake = FakeMcp(notes={G1: _note(title="SECRET TITLE", tags=[{"guid": "t-1", "name": "n"}],
                                    attributes={"sourceURL": "https://secret.example/x"}),
                          _guid(2): _note(_guid(2))},
                   notebooks=[_nb("nb-1", "Setups")])
    p = _provider(fake)
    with caplog.at_level(logging.INFO, logger=ev.log.name):
        await p.fetch(CREDS, RemoteRef(remote_id=G1, updated_at="x"))
        await p.fetch(CREDS, RemoteRef(remote_id=_guid(2), updated_at="x"))
    lines = [r.getMessage() for r in caplog.records if "evernote note shape sample" in r.getMessage()]
    assert lines == ["evernote note shape sample: tags=dict tag_keys=['guid', 'name'] "
                     "attributes_keys=['sourceURL']"]
    assert "SECRET" not in lines[0] and "secret.example" not in lines[0]


async def test_drain_item_failures_returns_plan_d_shape_and_clears():
    sc = _note()
    del sc["updated"]
    p, _ = await _fetch(FakeMcp(notes={G1: sc}, notebooks=[_nb("nb-1", "Setups")]))
    assert p.drain_item_failures() == [
        {"noteTitle": "Plan", "reason": "evernote note shape: missing updated", "name": None}]
    assert p.drain_item_failures() == []


async def test_a_failure_string_is_recorded_once_per_key_per_instance():
    sc1, sc2 = _note(), _note(_guid(2))
    del sc1["updated"], sc2["updated"]
    fake = FakeMcp(notes={G1: sc1, _guid(2): sc2}, notebooks=[_nb("nb-1", "Setups")])
    p = _provider(fake)
    await p.fetch(CREDS, RemoteRef(remote_id=G1, updated_at="x"))
    await p.fetch(CREDS, RemoteRef(remote_id=_guid(2), updated_at="x"))
    assert len(p.drain_item_failures()) == 1


@pytest.mark.parametrize("bad", ["../etc", "a/b", "", "x y"])
async def test_a_note_id_that_is_not_a_guid_is_refused(bad):
    # Review n3: the id builds media refs and import keys; it must be a GUID.
    fake = FakeMcp(notes={bad: _note(bad)})
    with pytest.raises(errors.NoteConnUnsupported):
        await _provider(fake).fetch(CREDS, RemoteRef(remote_id=bad, updated_at="x"))
    assert "get_note" not in fake.tool_calls


async def test_title_falls_back_to_the_hit_title():
    fake = FakeMcp(active=[_hit(1, title="From the hit")],
                   notes={_guid(1): _note(_guid(1), title=None)}, notebooks=[_nb("nb-1", "S")])
    p = _provider(fake)
    (ref,) = await p.list_changed(CREDS, None)
    note = await p.fetch(CREDS, ref)
    assert note.title == "From the hit"


# --------------------------------------------------------------------------- media


def _gcs(host: str = "storage.googleapis.com", path: str = "/bkt/obj?X-Goog-Signature=s") -> str:
    return f"https://{host}{path}"


def _attachment(url: str, size: int = 9, mime: str | None = "image/png") -> dict:
    return {"downloadUrl": url, "expiresAt": 1762092000000, "noteId": G1, "resourceGuid": "r1",
            "hash": H1, "mimeType": mime, "filename": "c.png", "sizeBytes": size}


class Downloads:
    def __init__(self):
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return httpx.Response(200, headers={"content-type": "application/octet-stream"}, content=b"png-bytes")


def _http(dl: Downloads) -> httpx.AsyncClient:
    return base.media_http_client(transport=httpx.MockTransport(dl))


async def test_fetch_media_returns_bytes_and_the_declared_mime():
    dl = Downloads()
    fake = FakeMcp(attachments={(G1, H1): _attachment(_gcs())})
    async with _http(dl) as http:
        data, mime = await _provider(fake, http).fetch_media(CREDS, f"evernote-res://{G1}/{H1}")
    assert data == b"png-bytes" and mime == "image/png"


async def test_fetch_media_asks_for_a_fresh_url_every_attempt():
    dl = Downloads()
    fake = FakeMcp(attachments={(G1, H1): _attachment(_gcs())})
    async with _http(dl) as http:
        p = _provider(fake, http)
        await p.fetch_media(CREDS, f"evernote-res://{G1}/{H1}")
        await p.fetch_media(CREDS, f"evernote-res://{G1}/{H1}")
    assert fake.tool_calls.count("get_attachment") == 2
    assert [a for n, a in fake.calls if n == "get_attachment"] == [{"noteId": G1, "hash": H1}] * 2


@pytest.mark.parametrize("url", [_gcs("bucket.storage.googleapis.com"), _gcs("evil.example"),
                                 "http://storage.googleapis.com/bkt/obj", "ftp://storage.googleapis.com/x"])
async def test_fetch_media_refuses_a_non_gcs_host(url):
    dl = Downloads()
    fake = FakeMcp(attachments={(G1, H1): _attachment(url)})
    async with _http(dl) as http:
        with pytest.raises(errors.NoteConnUnsafeAddress):
            await _provider(fake, http).fetch_media(CREDS, f"evernote-res://{G1}/{H1}")
    assert dl.requests == []


async def test_fetch_media_refuses_oversize_before_downloading():
    dl = Downloads()
    fake = FakeMcp(attachments={(G1, H1): _attachment(_gcs(), size=base.MEDIA_MAX_BYTES + 1)})
    async with _http(dl) as http:
        with pytest.raises(errors.NoteConnTooLarge):
            await _provider(fake, http).fetch_media(CREDS, f"evernote-res://{G1}/{H1}")
    assert dl.requests == []


async def test_fetch_media_sends_no_authorization_header():
    dl = Downloads()
    fake = FakeMcp(attachments={(G1, H1): _attachment(_gcs())})
    async with _http(dl) as http:
        await _provider(fake, http).fetch_media(CREDS, f"evernote-res://{G1}/{H1}")
    (req,) = dl.requests
    assert "authorization" not in req.headers
    assert "at-0" not in str(req.headers) and "at-0" not in str(req.url)


async def test_fetch_media_passes_the_host_pin_to_every_hop(monkeypatch):
    seen = {}

    async def fake_get(client, url, **kw):
        seen.update(kw)
        return httpx.Response(200, headers={"content-type": "image/png"}, content=b"x",
                              request=httpx.Request("GET", url))

    monkeypatch.setattr(base, "guarded_media_get", fake_get)
    fake = FakeMcp(attachments={(G1, H1): _attachment(_gcs())})
    await _provider(fake).fetch_media(CREDS, f"evernote-res://{G1}/{H1}")
    assert seen.get("allowed_host") == "storage.googleapis.com"


async def test_fetch_media_logs_the_attachment_host_once_never_the_query(caplog):
    dl = Downloads()
    fake = FakeMcp(attachments={(G1, H1): _attachment(_gcs())})
    async with _http(dl) as http:
        p = _provider(fake, http)
        with caplog.at_level(logging.INFO, logger=ev.log.name):
            await p.fetch_media(CREDS, f"evernote-res://{G1}/{H1}")
            await p.fetch_media(CREDS, f"evernote-res://{G1}/{H1}")
    lines = [r.getMessage() for r in caplog.records if "attachment host sample" in r.getMessage()]
    assert lines == ["evernote attachment host sample: storage.googleapis.com"]


async def test_fetch_media_copies_a_web_hotlink_through_the_shared_guarded_path(monkeypatch):
    seen = {}

    async def fake_fetch(client, url, *, what):
        seen["url"] = url
        return b"remote", "image/jpeg"

    monkeypatch.setattr(base, "fetch_content_url", fake_fetch)
    fake = FakeMcp()
    data, mime = await _provider(fake).fetch_media(CREDS, "https://e.example.com/x.jpg")
    assert (data, mime) == (b"remote", "image/jpeg") and seen["url"] == "https://e.example.com/x.jpg"
    assert fake.tool_calls == []


@pytest.mark.parametrize("ref", ["javascript:alert(1)", "data:image/png;base64,AAAA", "file:///x",
                                 "evernote-res://../x/" + H1, f"evernote-res://{G1}/NOTAHASH",
                                 "md-img-1.png", "/relative.png"])
async def test_fetch_media_refuses_any_other_ref_before_any_io(ref):
    dl = Downloads()
    fake = FakeMcp()
    async with _http(dl) as http:
        with pytest.raises((errors.NoteConnUnsafeAddress, errors.NoteConnUnsupported)):
            await _provider(fake, http).fetch_media(CREDS, ref)
    assert fake.tool_calls == [] and dl.requests == []


# --------------------------------------------------------------------------- whole surface + auth


async def test_provider_only_ever_calls_read_tools():
    dl = Downloads()
    res = [{"id": "r1", "hash": H1, "mime": "image/png", "name": "c.png", "sizeBytes": 5}]
    fake = FakeMcp(active=[_hit(1)], trash=[_hit(2)],
                   notes={_guid(1): _note(_guid(1), tags=["t-1"], resources=res,
                                          content=f'<en-note><en-media hash="{H1}"/></en-note>')},
                   notebooks=[_nb("nb-1", "S")], tags=[_tag("t-1", "a")],
                   attachments={(_guid(1), H1): _attachment(_gcs())}, totals=[1])
    async with _http(dl) as http:
        p = _provider(fake, http)
        await p.validate(CREDS)
        refs = await p.list_changed(CREDS, None)
        await p.list_present_refs(CREDS)
        await p.list_deleted(CREDS)
        note = await p.fetch(CREDS, refs[0])
        for m in note.media:
            await p.fetch_media(CREDS, m["ref"])
        await p.aclose()
    assert fake.tool_calls and set(fake.tool_calls) <= READ_TOOLS
    assert fake.closed


async def test_on_unauthorized_none_refresh_raises_auth_error(monkeypatch):
    async def none_refresh(user_id, **kw):
        return None

    monkeypatch.setattr(evernote_oauth, "refresh_if_needed", none_refresh)
    p = ev.EvernoteProvider(user_id="u1")
    p._token = "at-0"
    with pytest.raises(errors.NoteConnAuthError):
        await p._on_unauthorized()


async def test_on_unauthorized_forces_a_refresh_and_passes_the_rejected_token(monkeypatch):
    calls = []

    async def refresh(user_id, **kw):
        calls.append((user_id, kw))
        return {"accessToken": "at-1"}

    monkeypatch.setattr(evernote_oauth, "refresh_if_needed", refresh)
    p = ev.EvernoteProvider(user_id="u1")
    p._token = "at-0"
    assert await p._on_unauthorized() == "at-1"
    assert calls == [("u1", {"force": True, "rejected_access_token": "at-0"})]
    assert p._token == "at-1"


async def test_the_real_client_is_built_from_the_access_token_with_a_refresher():
    p = ev.EvernoteProvider(user_id="u1")
    client = p._client(CREDS)
    assert client._token == "at-0" and client._on_unauthorized is not None
    await p.aclose()
    anonymous = ev.EvernoteProvider(user_id=None)
    assert anonymous._client(CREDS)._on_unauthorized is None
    await anonymous.aclose()


async def test_no_access_token_is_an_auth_error():
    with pytest.raises(errors.NoteConnAuthError):
        await ev.EvernoteProvider(user_id="u1").validate({})


async def test_enml_conversion_runs_off_the_event_loop_thread(monkeypatch):
    """Final review I1(b): a 1.7 MB web clip converts in ~1.6 s, which on the uvicorn loop stalls
    every request (the first sync after connect, and every "Sync now", run there). The converter is
    pure, so `fetch` runs it in a worker thread."""
    import threading
    loop_thread = threading.get_ident()
    seen: list[int] = []
    real = ev.enml.enml_to_tiptap

    def spy(*args, **kwargs):
        seen.append(threading.get_ident())
        return real(*args, **kwargs)

    monkeypatch.setattr(ev.enml, "enml_to_tiptap", spy)
    _, note = await _fetch(_fetch_fake(resources=None, content="<en-note><div>x</div></en-note>"))
    assert seen and all(t != loop_thread for t in seen)
    assert note.doc["content"][0]["content"][0]["text"] == "x"


# ── fix round 1: listing revisions (D1) and carried pacing (D3) ──────────────

async def test_listing_revision_is_the_hits_updated_at_and_none_without_one():
    fake = FakeMcp(active=[_hit(1, updated="2026-11-02T14:00:00Z"),
                           _hit(2, updated=None, created="2026-01-01T00:00:00Z")])
    p = _provider(fake)
    refs = {r.remote_id: r for r in await p.list_changed(CREDS, None)}
    assert p.listing_revision(refs[_guid(1)]) == "2026-11-02T14:00:00.000+00:00"
    # Listed by createdAt: no real revision, so the engine always fetches it.
    assert p.listing_revision(refs[_guid(2)]) is None


async def test_the_listing_and_the_stored_revision_name_the_same_instant():
    # D1's assumption, pinned: `search_notes.updatedAt` (an ISO string at whole seconds in the
    # corpus mock) and `get_note.updated` (epoch milliseconds there) are the same field; they
    # compare equal at whole seconds through `engine._same_revision`.
    from datetime import datetime, timezone
    from api.services.journal_two.note_connectors import engine
    when = datetime(2026, 11, 2, 14, 0, 0, 123000, tzinfo=timezone.utc)
    ms = int(when.timestamp() * 1000)
    fake = FakeMcp(active=[_hit(1, updated="2026-11-02T14:00:00Z")],
                   notes={_guid(1): _note(_guid(1), updated=ms)})
    p = _provider(fake)
    [ref] = await p.list_changed(CREDS, None)
    rn = await p.fetch(CREDS, ref)
    assert rn.updated_at == "2026-11-02T14:00:00.123+00:00"
    assert engine._same_revision(rn.updated_at, p.listing_revision(ref))


class _PacedFake(FakeMcp):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.seeds: list[float] = []

    def seed_interval(self, s):
        self.seeds.append(s)

    def learned_interval(self):
        return (2.5, True)


async def test_seed_pacing_reaches_the_client_and_learned_pacing_reads_it():
    fake = _PacedFake(active=[_hit(1)])
    p = _provider(fake)
    assert p.learned_pacing() == (None, False)  # no session yet
    p.seed_pacing(3.0)
    await p.list_changed(CREDS, None)  # the client is made on the first call
    assert fake.seeds == [3.0]
    assert p.learned_pacing() == (2.5, True)


# ── fix round 2 (N2): each listing opens, sizes and closes its own allowance ─

class _ListingFake(FakeMcp):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.events: list = []

    def begin_listing(self):
        self.events.append("begin")

    def size_listing(self, pages):
        self.events.append(("size", pages))

    def end_listing(self):
        self.events.append("end")


async def test_every_listing_opens_sizes_and_closes_its_allowance():
    fake = _ListingFake(active=[_hit(i) for i in range(250)], trash=[_hit(900 + i) for i in range(3)])
    p = _provider(fake)
    await p.list_changed(CREDS, None)
    assert fake.events == ["begin", ("size", 3), "end"]
    fake.events.clear()
    await p.list_deleted(CREDS)  # a removal listing of a full pass: its own allowance
    assert fake.events == ["begin", ("size", 1), "end"]


async def test_a_listing_that_raises_still_closes_its_allowance():
    fake = _ListingFake(active=[_hit(i) for i in range(150)])
    p = _provider(fake)
    real = fake.call_tool
    n = {"calls": 0}

    async def failing(name, arguments):
        n["calls"] += 1
        if name == "search_notes" and n["calls"] == 2:
            raise errors.NoteConnRateLimited("limited")
        return await real(name, arguments)

    fake.call_tool = failing
    with pytest.raises(errors.NoteConnRateLimited):
        await p.list_changed(CREDS, None)
    assert fake.events[0] == "begin" and fake.events[-1] == "end"


async def test_a_listings_page_count_is_clamped_to_the_page_cap():
    # NEW-3: `totalResultCount` comes from the server; a huge one must not size an allowance
    # past what the pager will ever read (`_MAX_PAGES`).
    fake = _ListingFake(active=[_hit(i) for i in range(3)])
    real = fake.call_tool

    async def inflated(name, arguments):
        sc = await real(name, arguments)
        if name == "search_notes":
            sc = {**sc, "totalResultCount": 10 ** 9}
        return sc

    fake.call_tool = inflated
    p = _provider(fake)
    with pytest.raises(errors.NoteConnTransient):  # the count never adds up; that is fine here
        await p.list_present_refs(CREDS)
    sizes = [e[1] for e in fake.events if isinstance(e, tuple)]
    assert sizes and set(sizes) == {ev._MAX_PAGES}
