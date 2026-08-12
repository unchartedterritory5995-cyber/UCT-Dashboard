"""Tests for the Dropbox folder-sync provider — `note_connectors.providers.dropbox`.

No live calls anywhere: every test builds an `httpx.AsyncClient` on
`httpx.MockTransport`, so a request only ever reaches the in-process handler
function defined in each test. `pytest.ini`'s `asyncio_mode = auto` means the
`async def test_*` functions below need no explicit marker.

The five required test areas from the task brief:
  1. list+continue fixture -> notes (has_more pagination aggregates across
     BOTH `list_folder` and `list_folder/continue` pages into one result).
  2. content_hash change skip -- an unchanged file (same `content_hash` as
     the last time THIS PROCESS saw it, via the module-level
     `_LAST_SEEN_HASHES`) is NOT re-emitted as a `RemoteRef` on a subsequent
     `list_changed` call; a genuinely changed one IS. `RemoteRef`/
     `RemoteNote.updated_at` themselves carry `server_modified` (a real
     ISO-8601 date — review fix, see `dropbox._change_timestamp`'s
     docstring), never `content_hash`.
  3. 409 `.tag: reset` -> falls back to a full recursive re-list.
  4. deleted entries -- a `.tag: "deleted"` entry never becomes a RemoteRef
     on a full pass (the actual "flag as source-deleted after 2 misses"
     mechanism lives in `engine.py`'s `_run_delete_detection`, off-limits to
     this task; our contract is simply "a full pass omits what's gone").
  5. `html_to_tiptap` vocabulary safety (incl. script-drop) -- lives in
     `test_note_convert_mddoc.py` per the brief, not here.

Plus the self-review points named in the brief:
  - CREDENTIAL BOUNDARY: the access token goes ONLY to `api.dropboxapi.com`/
    `content.dropboxapi.com`, never anywhere else (`test_every_request_...`
    below, plus the dedicated `fetch_media` external-URL probe).
  - `Dropbox-API-Arg` header JSON-escapes non-ASCII paths (`ensure_ascii`).
  - the 6-way bounded download concurrency in `fetch_many`.
  - env darkness: `configured()` False -> import inert, `NotConfigured` on use.
"""

from __future__ import annotations

import asyncio
import json
from urllib.parse import parse_qs, quote

import httpx
import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import engine as note_engine
from api.services.journal_two.note_connectors.errors import (
    NoteConnAuthError,
    NoteConnNotConfigured,
    NoteConnRateLimited,
    NoteConnTokenExpired,
    NoteConnTransient,
    NoteConnUnsupported,
)
from api.services.journal_two.note_connectors.providers import dropbox as dropbox_module
from api.services.journal_two.note_connectors.providers.base import (
    AccountInfo,
    NoteProvider,
    RemoteNote,
    RemoteRef,
)
from api.services.journal_two.note_connectors.providers.dropbox import (
    DropboxProvider,
    _exchange_authorization_code,
    _refresh_access_token,
    authorize_url,
    configured,
)

ACCESS_TOKEN = "dbx-access-token-abc"
REFRESH_TOKEN = "dbx-refresh-token-xyz"
FOLDER = "/Team Notes"  # as the user configured it -- mixed case preserved

CREDS = {"accessToken": ACCESS_TOKEN, "refreshToken": REFRESH_TOKEN, "folderPath": FOLDER}

ACCOUNT_PAYLOAD = {
    "account_id": "dbid:abc123",
    "name": {"display_name": "Jordan Trader"},
    "email": "jordan@example.com",
}

TRADING_MD_PATH = "/team notes/trading.md"
SETUP_MD_PATH = "/team notes/sub/setup.md"
CHART_PNG_PATH = "/team notes/assets/chart.png"
SUB_FOLDER_PATH = "/team notes/sub"

TRADING_MD_TEXT = "# Trading\n\nSome notes.\n"
SETUP_MD_TEXT = "# Setup\n\nSee ![chart](../assets/chart.png) for reference.\n"

PAGE1_ENTRIES = [
    {
        # `name` preserves the file's ORIGINAL casing (real Dropbox
        # behavior); `path_lower` is always fully lowercased.
        ".tag": "file", "name": "Trading.md", "path_lower": TRADING_MD_PATH,
        "content_hash": "hash-trading-v1", "server_modified": "2026-08-01T00:00:00Z",
    },
]
PAGE2_ENTRIES = [
    {".tag": "folder", "name": "Sub", "path_lower": SUB_FOLDER_PATH},
    {
        ".tag": "file", "name": "Setup.md", "path_lower": SETUP_MD_PATH,
        "content_hash": "hash-setup-v1", "server_modified": "2026-08-02T00:00:00Z",
    },
    {
        ".tag": "file", "name": "chart.png", "path_lower": CHART_PNG_PATH,
        "content_hash": "hash-chart-v1", "server_modified": "2026-08-01T00:00:00Z",
    },
]

FILE_CONTENTS = {
    TRADING_MD_PATH: TRADING_MD_TEXT.encode("utf-8"),
    SETUP_MD_PATH: SETUP_MD_TEXT.encode("utf-8"),
    CHART_PNG_PATH: b"\x89PNG\r\n",
}


def _dbx_api_arg(request: httpx.Request) -> dict:
    return json.loads(request.headers["dropbox-api-arg"])


def _body(request: httpx.Request) -> dict:
    return json.loads(request.content or b"{}")


def _default_handler(request: httpx.Request) -> httpx.Response:
    host = request.url.host
    path = request.url.path

    if host == "api.dropboxapi.com":
        if path == "/2/users/get_current_account":
            return httpx.Response(200, json=ACCOUNT_PAYLOAD)
        if path == "/2/files/list_folder":
            body = _body(request)
            if body.get("recursive"):
                return httpx.Response(
                    200, json={"entries": PAGE1_ENTRIES, "cursor": "cursor-page-1", "has_more": True},
                )
            return httpx.Response(200, json={"entries": [], "cursor": "c", "has_more": False})
        if path == "/2/files/list_folder/continue":
            body = _body(request)
            if body.get("cursor") == "cursor-page-1":
                return httpx.Response(
                    200, json={"entries": PAGE2_ENTRIES, "cursor": "cursor-final", "has_more": False},
                )
            return httpx.Response(404)
        return httpx.Response(404)

    if host == "content.dropboxapi.com" and path == "/2/files/download":
        arg = _dbx_api_arg(request)
        content = FILE_CONTENTS.get(arg.get("path"))
        if content is None:
            return httpx.Response(409, json={"error_summary": "path/not_found/", "error": {".tag": "path"}})
        return httpx.Response(200, content=content)

    return httpx.Response(404)


def _make_provider(handler=_default_handler, *, sleep_fn=None, folder_path=FOLDER) -> DropboxProvider:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return DropboxProvider(client=client, sleep_fn=sleep_fn, folder_path=folder_path)


@pytest.fixture(autouse=True)
def _dropbox_app_env(monkeypatch):
    monkeypatch.setenv("DROPBOX_APP_KEY", "test-app-key")
    monkeypatch.setenv("DROPBOX_APP_SECRET", "test-app-secret")


@pytest.fixture(autouse=True)
def _reset_last_seen_hashes():
    """`dropbox._LAST_SEEN_HASHES` is a PER-PROCESS (module-level, not
    instance-level) cache by design — see its docstring — so it survives
    across the `_make_provider()` calls different tests make. Without this
    reset, a test asserting "unchanged content_hash is skipped" could pass
    for the wrong reason (polluted by an EARLIER test's entry sharing the
    same folder_path/path_lower/content_hash), and a later test could fail
    because an earlier one already "saw" its hash. Clears both before AND
    after so failures don't leak into whichever test runs next either."""
    dropbox_module._LAST_SEEN_HASHES.clear()
    yield
    dropbox_module._LAST_SEEN_HASHES.clear()


# ---------------------------------------------------------------------------
# Env darkness: configured() False -> import inert, NotConfigured on use.
# ---------------------------------------------------------------------------


def test_configured_reflects_env_state():
    assert configured() is True  # the autouse fixture set both vars


async def test_not_configured_raises_on_every_public_method(monkeypatch):
    """Import-inertness is exercised merely by this test FILE having
    successfully collected: the `from ... import DropboxProvider` above ran
    before any fixture (incl. the autouse env fixture) executed, against
    whatever the ambient pytest process environment was -- if importing (or
    constructing) the module required the env vars, collection itself would
    already have failed. This test additionally proves every public method
    reacts to the env at CALL time, never at import/construction time."""
    monkeypatch.delenv("DROPBOX_APP_KEY", raising=False)
    monkeypatch.delenv("DROPBOX_APP_SECRET", raising=False)
    assert configured() is False

    provider = DropboxProvider(folder_path="/notes")  # construction never raises
    with pytest.raises(NoteConnNotConfigured):
        await provider.validate(CREDS)
    with pytest.raises(NoteConnNotConfigured):
        await provider.list_changed(CREDS)
    with pytest.raises(NoteConnNotConfigured):
        await provider.fetch(CREDS, RemoteRef(remote_id="/notes/x.md", updated_at="h1"))
    with pytest.raises(NoteConnNotConfigured):
        await provider.fetch_media(CREDS, "dbx-md-media:/notes/img.png")
    with pytest.raises(NoteConnNotConfigured):
        await provider.list_folders(CREDS)


# ---------------------------------------------------------------------------
# CREDENTIAL BOUNDARY — the access token goes ONLY to api.dropboxapi.com /
# content.dropboxapi.com, and only ever as the correct Bearer value.
# ---------------------------------------------------------------------------


async def test_every_request_across_a_full_sync_targets_only_dropbox_hosts_with_the_token():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return _default_handler(request)

    provider = _make_provider(handler)
    await provider.validate(CREDS)
    refs = await provider.list_changed(CREDS)
    note = await provider.fetch(CREDS, next(r for r in refs if r.remote_id == TRADING_MD_PATH))
    assert note.title == "Trading"

    assert captured, "expected at least one outbound request"
    for req in captured:
        assert req.url.host in ("api.dropboxapi.com", "content.dropboxapi.com"), req.url
        assert req.headers.get("authorization") == f"Bearer {ACCESS_TOKEN}"


async def test_fetch_media_external_url_never_receives_the_access_token():
    """A media `ref` handed to `fetch_media` that did NOT resolve to a known
    in-folder Dropbox path (an external URL, or a broken relative
    reference) must NEVER carry the Dropbox Bearer token — mirrors
    `CraftProvider.fetch_media`'s attacker-controlled-URL precedent."""
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, content=b"stolen?", headers={"content-type": "image/png"})

    provider = _make_provider(handler)
    data, content_type = await provider.fetch_media(CREDS, "https://evil.example.com/steal.png")

    assert data == b"stolen?"
    assert content_type == "image/png"
    assert len(captured) == 1
    assert captured[0].url.host == "evil.example.com"
    assert "authorization" not in {k.lower() for k in captured[0].headers.keys()}


async def test_fetch_media_rejects_non_https_scheme_without_making_a_request():
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        return httpx.Response(200)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnUnsupported):
        await provider.fetch_media(CREDS, "http://example.com/img.png")

    assert request_count == 0, "a non-https, non-Dropbox ref must be refused before any request"


# ---------------------------------------------------------------------------
# 1. list+continue fixture -> notes
# ---------------------------------------------------------------------------


async def test_list_changed_aggregates_across_list_folder_and_continue_pages():
    provider = _make_provider()
    refs = await provider.list_changed(CREDS)  # cursor=None -> full recursive list
    assert {r.remote_id for r in refs} == {TRADING_MD_PATH, SETUP_MD_PATH}


async def test_list_changed_excludes_folders_and_non_note_extensions():
    """PAGE2 also contains a `folder` entry and a `.png` file -- neither
    becomes a RemoteRef (folders aren't notes; images are media, resolved
    only by reference, never enumerated as their own note)."""
    provider = _make_provider()
    refs = await provider.list_changed(CREDS)
    remote_ids = {r.remote_id for r in refs}
    assert SUB_FOLDER_PATH not in remote_ids
    assert CHART_PNG_PATH not in remote_ids


async def test_fetch_produces_a_correct_remote_note_from_the_paginated_listing():
    provider = _make_provider()
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == TRADING_MD_PATH)

    note = await provider.fetch(CREDS, ref)

    assert note.title == "Trading"
    assert note.folder_path == []  # root-level file relative to the synced folder
    headings = [n for n in note.doc["content"] if n["type"] == "heading"]
    assert headings and headings[0]["content"][0]["text"] == "Trading"


async def test_fetch_computes_relative_folder_path_for_a_nested_file():
    provider = _make_provider()
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == SETUP_MD_PATH)

    note = await provider.fetch(CREDS, ref)

    assert note.folder_path == ["sub"]
    assert note.title == "Setup"


async def test_fetch_resolves_a_relative_image_reference_via_the_path_map():
    """`setup.md` references `../assets/chart.png` relative to its OWN
    directory (`/team notes/sub`), which resolves to `chart.png`'s real
    `path_lower` -- built from the path->entry map `list_changed` indexed.
    The resulting media ref carries the internal `dbx-md-media:` scheme so
    `fetch_media` knows to download it via the Dropbox content API rather
    than treating it as an external URL."""
    provider = _make_provider()
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == SETUP_MD_PATH)

    note = await provider.fetch(CREDS, ref)

    assert len(note.media) == 1
    # WE percent-encode the resolved path ourselves (the space in "team
    # notes" -> %20) before angle-bracket-wrapping it -- `fetch_media`
    # reverses this (exactly once) before it ever reaches the real Dropbox
    # path, verified below.
    assert note.media[0]["ref"] == "dbx-md-media:/team%20notes/assets/chart.png"

    data, content_type = await provider.fetch_media(CREDS, note.media[0]["ref"])
    assert data == FILE_CONTENTS[CHART_PNG_PATH]
    assert content_type == "image/png"


async def test_fetch_before_list_changed_raises_runtime_error():
    """Mirrors `RoamProvider`'s `_require_enumerated` precedent -- the
    path->entry map `fetch()` depends on (relative media resolution, titles,
    folder_path) is built by `list_changed()`; calling `fetch()` cold would
    silently produce wrong data (unresolved media, a garbage folder_path)
    instead of loudly failing."""
    provider = _make_provider()
    with pytest.raises(RuntimeError, match="list_changed"):
        await provider.fetch(CREDS, RemoteRef(remote_id=TRADING_MD_PATH, updated_at="h1"))


# ---------------------------------------------------------------------------
# 2. content_hash change skip
# ---------------------------------------------------------------------------


async def test_unchanged_content_hash_is_not_re_emitted_on_a_second_full_listing():
    """The actual "content_hash change skip" mechanism (review fix): a full
    listing that returns the SAME content_hash for a path this process has
    already seen does NOT re-emit it as a `RemoteRef` at all -- proven here
    across two DIFFERENT `DropboxProvider` instances (mirrors the real
    fresh-instance-per-sync boundary `_default_provider_factory` imposes),
    since the tracking lives in the module-level `_LAST_SEEN_HASHES`, not on
    `self`."""
    entries = [{
        ".tag": "file", "name": "a.md", "path_lower": "/team notes/a.md",
        "content_hash": "hash-v1", "server_modified": "2026-08-01T00:00:00Z",
    }]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        return httpx.Response(404)

    provider_1 = _make_provider(handler)
    refs_1 = await provider_1.list_changed(CREDS)
    assert [r.remote_id for r in refs_1] == ["/team notes/a.md"]  # first sync -- always emitted

    provider_2 = _make_provider(handler)  # a FRESH instance, same folder -- next sync
    refs_2 = await provider_2.list_changed(CREDS)
    assert refs_2 == []  # unchanged content_hash -- skipped entirely


async def test_changed_content_hash_is_re_emitted_with_the_real_server_modified_timestamp():
    """Control for the test above: a GENUINE content change must NOT be
    silently hidden by skip-detection, and `updated_at` is the REAL
    `server_modified` timestamp (never `content_hash` -- review fidelity
    fix: a hash there made every note read "just synced")."""
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            call_count["n"] += 1
            h = "hash-v1" if call_count["n"] == 1 else "hash-v2"
            entries = [{
                ".tag": "file", "name": "a.md", "path_lower": "/team notes/a.md",
                "content_hash": h, "server_modified": "2026-08-0" + str(call_count["n"]) + "T00:00:00Z",
            }]
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        return httpx.Response(404)

    provider_1 = _make_provider(handler)
    refs_1 = await provider_1.list_changed(CREDS)
    provider_2 = _make_provider(handler)
    refs_2 = await provider_2.list_changed(CREDS)

    assert len(refs_1) == 1 and len(refs_2) == 1  # NOT skipped -- content genuinely changed
    assert refs_1[0].updated_at == "2026-08-01T00:00:00Z"
    assert refs_2[0].updated_at == "2026-08-02T00:00:00Z"
    assert refs_1[0].updated_at != refs_2[0].updated_at


async def test_entries_without_content_hash_are_never_skipped():
    """Skip-detection only ever engages when Dropbox actually supplied a
    `content_hash` (defensive-only per `_change_timestamp`'s docstring --
    real `FileMetadata` always has one). An entry lacking it must be
    re-emitted on every listing rather than silently vanishing."""
    entries = [{
        ".tag": "file", "name": "a.md", "path_lower": "/team notes/a.md",
        "server_modified": "2026-08-03T00:00:00Z",  # no content_hash on this entry
    }]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        return httpx.Response(404)

    provider_1 = _make_provider(handler)
    refs_1 = await provider_1.list_changed(CREDS)
    provider_2 = _make_provider(handler)
    refs_2 = await provider_2.list_changed(CREDS)

    assert len(refs_1) == 1
    assert len(refs_2) == 1  # NOT skipped, despite an identical listing
    assert refs_1[0].updated_at == refs_2[0].updated_at == "2026-08-03T00:00:00Z"


async def test_updated_at_is_never_content_hash_shaped():
    """Direct fidelity assertion: `RemoteRef.updated_at` and
    `RemoteNote.updated_at` are real ISO-8601 timestamps
    (`datetime.fromisoformat` must accept them), never the raw
    `content_hash` hex digest -- the exact bug that made every synced
    Dropbox note read "just synced" (`notes.py::_import_date` silently
    falls back to `now` on anything that fails ISO parsing)."""
    from datetime import datetime

    entries = [{
        ".tag": "file", "name": "a.md", "path_lower": TRADING_MD_PATH,
        "content_hash": "a" * 64, "server_modified": "2026-08-01T00:00:00Z",
    }]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            return httpx.Response(200, content=b"# A\n")
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    note = await provider.fetch(CREDS, refs[0])

    datetime.fromisoformat(refs[0].updated_at.replace("Z", "+00:00"))  # must not raise
    datetime.fromisoformat(note.updated_at.replace("Z", "+00:00"))  # must not raise
    assert refs[0].updated_at == "2026-08-01T00:00:00Z"
    assert note.updated_at == "2026-08-01T00:00:00Z"


async def test_last_seen_hashes_disambiguates_by_credentials_not_just_folder_path():
    """Round-2 review fix: `_LAST_SEEN_HASHES` keyed by `folder_path` ALONE is a
    same-process CROSS-TENANT hazard, not a future scale-out risk. Dropbox's
    `content_hash` is content-addressed (identical bytes -> identical hash in
    ANY account), and the web pod is ONE process serving every user's sync via
    `sync_due_sources()`. Two different accounts (different `refreshToken`)
    syncing a folder with the SAME `folder_path` and holding a byte-identical
    file (same `path_lower` + `content_hash` -- a shared template, shared
    course notes) must each see their OWN file on their OWN first sync. Before
    the credentials-derived keying fix, account B's file was silently skipped
    the moment account A's provider instance (sharing the SAME module-level
    cache) had already recorded that folder_path + path_lower + hash
    combination -- invisible: no error, no log, just a note that never
    imports."""
    shared_entries = [{
        ".tag": "file", "name": "shared.md", "path_lower": "/team notes/shared.md",
        "content_hash": "identical-hash-both-accounts", "server_modified": "2026-08-01T00:00:00Z",
    }]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": shared_entries, "cursor": "c", "has_more": False})
        return httpx.Response(404)

    creds_account_a = {
        "accessToken": "token-a", "refreshToken": "refresh-token-account-a", "folderPath": FOLDER,
    }
    creds_account_b = {
        "accessToken": "token-b", "refreshToken": "refresh-token-account-b", "folderPath": FOLDER,
    }

    provider_a = _make_provider(handler)
    refs_a = await provider_a.list_changed(creds_account_a)
    assert [r.remote_id for r in refs_a] == ["/team notes/shared.md"]  # account A's first sync

    # A DIFFERENT account (different refreshToken), first sync, SAME
    # folder_path + byte-identical file -- must NOT be skipped.
    provider_b = _make_provider(handler)
    refs_b = await provider_b.list_changed(creds_account_b)
    assert [r.remote_id for r in refs_b] == ["/team notes/shared.md"], (
        "account B's file was silently skipped -- cross-tenant _LAST_SEEN_HASHES collision"
    )


# ---------------------------------------------------------------------------
# 3. 409 reset -> full re-list
# ---------------------------------------------------------------------------


async def test_409_reset_on_continue_falls_back_to_a_full_recursive_relist():
    calls: list[tuple[str, object]] = []
    fresh_entries = [
        {".tag": "file", "name": "a.md", "path_lower": "/team notes/a.md", "content_hash": "h1"},
        {".tag": "file", "name": "b.md", "path_lower": "/team notes/b.md", "content_hash": "h2"},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder/continue":
            calls.append(("continue", _body(request).get("cursor")))
            return httpx.Response(
                409, json={"error_summary": "reset/...", "error": {".tag": "reset"}},
            )
        if request.url.path == "/2/files/list_folder":
            calls.append(("list_folder", _body(request).get("recursive")))
            return httpx.Response(200, json={"entries": fresh_entries, "cursor": "fresh", "has_more": False})
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS, cursor="a-stale-or-mismatched-cursor")

    assert calls[0] == ("continue", "a-stale-or-mismatched-cursor")
    assert calls[1] == ("list_folder", True)
    assert {r.remote_id for r in refs} == {"/team notes/a.md", "/team notes/b.md"}


async def test_409_path_error_raises_unsupported_when_folder_is_gone():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409, json={"error_summary": "path/not_found/...", "error": {".tag": "path"}},
        )

    provider = _make_provider(handler)
    with pytest.raises(NoteConnUnsupported):
        await provider.list_changed(CREDS)


async def test_409_reset_never_leaks_as_an_internal_exception_type():
    """Even in the (pathological) case where the FALLBACK full listing also
    409-resets, the internal `_ResetSignal` sentinel must never escape this
    module -- it converts to the shared errors taxonomy."""
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(409, json={"error_summary": "reset/...", "error": {".tag": "reset"}})

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient):
        await provider.list_changed(CREDS)  # cursor=None -> straight to full listing, which also resets


# ---------------------------------------------------------------------------
# 4. deleted entries
# ---------------------------------------------------------------------------


async def test_full_pass_excludes_deleted_entries_from_refs():
    """A full pass simply never yields a `.tag: "deleted"` entry as a
    RemoteRef -- the actual "flag the linked note source-deleted after 2
    consecutive misses" mechanism lives in `engine.py`'s
    `_run_delete_detection` (off-limits to this task; it works off
    `remote_index.seen_at`). This provider's whole contract toward that
    mechanism is exactly this: a full listing that no longer contains a
    path is sufficient signal, because it simply won't appear here."""
    entries = [
        {".tag": "file", "name": "a.md", "path_lower": "/team notes/a.md", "content_hash": "h1"},
        {".tag": "deleted", "name": "b.md", "path_lower": "/team notes/b.md"},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)

    assert [r.remote_id for r in refs] == ["/team notes/a.md"]


# ---------------------------------------------------------------------------
# validate() / bad token / rate limiting / server errors
# ---------------------------------------------------------------------------


async def test_validate_returns_account_label():
    provider = _make_provider()
    info = await provider.validate(CREDS)
    assert info.label == "Jordan Trader"
    assert info.raw["account_id"] == "dbid:abc123"


async def test_validate_falls_back_to_email_when_no_display_name():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"account_id": "dbid:x", "email": "x@example.com"})

    provider = _make_provider(handler)
    info = await provider.validate(CREDS)
    assert info.label == "x@example.com"


async def test_bad_token_raises_auth_error_on_validate():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error_summary": "invalid_access_token/", "error": {".tag": "invalid_access_token"}})

    provider = _make_provider(handler)
    with pytest.raises(NoteConnAuthError):
        await provider.validate(CREDS)


async def test_server_error_raises_transient():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTransient):
        await provider.validate(CREDS)


async def test_429_honors_retry_after_header_then_succeeds():
    sleep_calls: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleep_calls.append(seconds)

    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            return httpx.Response(429, headers={"retry-after": "7"})
        return httpx.Response(200, json=ACCOUNT_PAYLOAD)

    provider = _make_provider(handler, sleep_fn=fake_sleep)
    info = await provider.validate(CREDS)

    assert info.label == "Jordan Trader"
    assert sleep_calls == [7.0]


async def test_429_retries_exhausted_raises_rate_limited():
    async def fake_sleep(seconds: float) -> None:
        return None

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, headers={"retry-after": "3"})

    provider = _make_provider(handler, sleep_fn=fake_sleep)
    with pytest.raises(NoteConnRateLimited) as exc_info:
        await provider.validate(CREDS)
    assert exc_info.value.retry_after == 3.0


async def test_429_body_retry_after_used_when_header_absent():
    async def fake_sleep(seconds: float) -> None:
        return None

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {".tag": "too_many_requests", "retry_after": 9}})

    provider = _make_provider(handler, sleep_fn=fake_sleep)
    with pytest.raises(NoteConnRateLimited) as exc_info:
        await provider.validate(CREDS)
    assert exc_info.value.retry_after == 9.0


# ---------------------------------------------------------------------------
# Token refresh on 401 (does NOT rotate the refresh_token; never persisted --
# see the module docstring)
# ---------------------------------------------------------------------------


async def test_401_triggers_one_refresh_and_retries_with_the_new_token():
    calls: list[tuple] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.dropboxapi.com" and request.url.path == "/oauth2/token":
            form = parse_qs(request.content.decode("utf-8"))
            calls.append(("refresh", form.get("grant_type", [None])[0]))
            assert form.get("refresh_token", [None])[0] == REFRESH_TOKEN
            return httpx.Response(200, json={"access_token": "refreshed-token", "expires_in": 14400})
        if request.url.path == "/2/users/get_current_account":
            auth = request.headers.get("authorization")
            calls.append(("account", auth))
            if auth == f"Bearer {ACCESS_TOKEN}":
                return httpx.Response(
                    401, json={"error_summary": "expired_access_token/", "error": {".tag": "expired_access_token"}},
                )
            return httpx.Response(200, json=ACCOUNT_PAYLOAD)
        return httpx.Response(404)

    provider = _make_provider(handler)
    info = await provider.validate(CREDS)

    assert info.label == "Jordan Trader"
    assert ("refresh", "refresh_token") in calls
    assert ("account", f"Bearer {ACCESS_TOKEN}") in calls
    assert ("account", "Bearer refreshed-token") in calls


async def test_401_without_refresh_token_raises_token_expired():
    creds = {"accessToken": ACCESS_TOKEN, "folderPath": FOLDER}  # no refreshToken

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401, json={"error_summary": "expired_access_token/", "error": {".tag": "expired_access_token"}},
        )

    provider = _make_provider(handler)
    with pytest.raises(NoteConnTokenExpired):
        await provider.validate(creds)


async def test_401_when_refresh_itself_fails_raises_auth_error():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oauth2/token":
            return httpx.Response(400, json={"error": "invalid_grant", "error_description": "revoked"})
        return httpx.Response(401, json={"error_summary": "invalid_access_token/", "error": {".tag": "invalid_access_token"}})

    provider = _make_provider(handler)
    with pytest.raises(NoteConnAuthError):
        await provider.validate(CREDS)


def test_authorize_url_requests_offline_access_and_the_three_read_scopes():
    url = authorize_url("https://uctintelligence.com/api/j2/notes/connectors/dropbox/callback")
    parsed = httpx.URL(url)
    assert parsed.host == "www.dropbox.com"
    assert parsed.path == "/oauth2/authorize"
    params = dict(parsed.params)
    assert params["client_id"] == "test-app-key"
    assert params["token_access_type"] == "offline"
    assert params["scope"] == "files.metadata.read files.content.read account_info.read"
    assert params["response_type"] == "code"


def test_authorize_url_raises_not_configured_without_env(monkeypatch):
    monkeypatch.delenv("DROPBOX_APP_KEY", raising=False)
    monkeypatch.delenv("DROPBOX_APP_SECRET", raising=False)
    with pytest.raises(NoteConnNotConfigured):
        authorize_url("https://example.com/callback")


async def test_exchange_authorization_code_posts_form_encoded_to_dropbox_oauth_token():
    captured = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        form = parse_qs(request.content.decode("utf-8"))
        assert form["grant_type"] == ["authorization_code"]
        assert form["code"] == ["auth-code-123"]
        assert form["client_id"] == ["test-app-key"]
        assert form["client_secret"] == ["test-app-secret"]
        return httpx.Response(200, json={
            "access_token": "at", "refresh_token": "rt", "expires_in": 14400,
        })

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    data = await _exchange_authorization_code(client, "auth-code-123", "https://example.com/cb")

    assert data == {"access_token": "at", "refresh_token": "rt", "expires_in": 14400}
    assert len(captured) == 1
    assert captured[0].url.host == "api.dropboxapi.com"


async def test_refresh_access_token_does_not_request_a_new_refresh_token():
    """Per Dropbox's offline-access model: refresh mints a new access_token
    only. The caller keeps using the SAME refresh_token it already had."""
    def handler(request: httpx.Request) -> httpx.Response:
        form = parse_qs(request.content.decode("utf-8"))
        assert form["grant_type"] == ["refresh_token"]
        assert form["refresh_token"] == [REFRESH_TOKEN]
        return httpx.Response(200, json={"access_token": "brand-new-access-token", "expires_in": 14400})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    data = await _refresh_access_token(client, REFRESH_TOKEN)

    assert data["access_token"] == "brand-new-access-token"
    assert "refresh_token" not in data


async def test_exchange_authorization_code_raises_auth_error_on_failure():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"error": "invalid_grant", "error_description": "bad code"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    with pytest.raises(NoteConnAuthError, match="bad code"):
        await _exchange_authorization_code(client, "bad-code", "https://example.com/cb")


# ---------------------------------------------------------------------------
# .txt handling (no markdown parsing; blank-line paragraphs, hardBreak lines)
# ---------------------------------------------------------------------------


async def test_txt_file_wraps_as_literal_paragraphs_no_markdown_parsing():
    txt_path = "/team notes/plain.txt"
    entries = [{".tag": "file", "name": "plain.txt", "path_lower": txt_path, "content_hash": "h1"}]
    text = "Line one\nLine two\n\n# Not a heading\n*not bold*"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            assert _dbx_api_arg(request)["path"] == txt_path
            return httpx.Response(200, content=text.encode("utf-8"))
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    note = await provider.fetch(CREDS, refs[0])

    paragraphs = note.doc["content"]
    assert len(paragraphs) == 2  # blank-line separated
    first_texts = [n.get("text") for n in paragraphs[0]["content"] if n.get("type") == "text"]
    assert first_texts == ["Line one", "Line two"]
    assert any(n.get("type") == "hardBreak" for n in paragraphs[0]["content"])
    # literal, un-parsed: the "#"/"*" characters survive as plain text, no
    # heading/bold marks appear anywhere in the doc.
    second_texts = [n.get("text") for n in paragraphs[1]["content"] if n.get("type") == "text"]
    assert second_texts == ["# Not a heading", "*not bold*"]
    assert note.doc["content"][1]["type"] == "paragraph"
    for node in paragraphs[1]["content"]:
        assert node.get("marks", []) == []


# ---------------------------------------------------------------------------
# .html handling (routes through html_to_tiptap)
# ---------------------------------------------------------------------------


async def test_html_file_routes_through_html_to_tiptap():
    html_path = "/team notes/page.html"
    entries = [{".tag": "file", "name": "page.html", "path_lower": html_path, "content_hash": "h1"}]
    html = "<h1>Title</h1><p>Hello <b>world</b></p><script>evil()</script>"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            return httpx.Response(200, content=html.encode("utf-8"))
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    note = await provider.fetch(CREDS, refs[0])

    doc_text = json.dumps(note.doc)
    assert "evil()" not in doc_text
    assert note.doc["content"][0] == {
        "type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Title"}],
    }


async def test_html_file_resolves_relative_image_src_via_path_map():
    html_path = "/team notes/sub/page.html"
    entries = [
        {".tag": "file", "name": "page.html", "path_lower": html_path, "content_hash": "h1"},
        {".tag": "file", "name": "chart.png", "path_lower": CHART_PNG_PATH, "content_hash": "h2"},
    ]
    html = '<p>See <img src="../assets/chart.png"></p>'

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            arg = _dbx_api_arg(request)
            if arg["path"] == html_path:
                return httpx.Response(200, content=html.encode("utf-8"))
            if arg["path"] == CHART_PNG_PATH:
                return httpx.Response(200, content=b"\x89PNG\r\n")
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == html_path)
    note = await provider.fetch(CREDS, ref)

    assert note.media == [{"ref": f"dbx-html:{CHART_PNG_PATH}", "kind": "image", "name": "chart.png"}]
    data, content_type = await provider.fetch_media(CREDS, note.media[0]["ref"])
    assert data == b"\x89PNG\r\n"
    assert content_type == "image/png"


# ---------------------------------------------------------------------------
# Dropbox-API-Arg header is ASCII-safe for non-ASCII paths
# ---------------------------------------------------------------------------


async def test_download_dropbox_api_arg_header_is_ascii_safe_for_non_ascii_paths():
    non_ascii_path = "/team notes/café ☕.md"
    captured_headers: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/download":
            captured_headers.update({k.lower(): v for k, v in request.headers.items()})
            return httpx.Response(200, content="café notes".encode("utf-8"))
        return httpx.Response(404)

    provider = _make_provider(handler)
    content = await provider._download(CREDS, non_ascii_path)

    header_val = captured_headers.get("dropbox-api-arg")
    assert header_val is not None
    assert all(ord(c) < 128 for c in header_val), "Dropbox-API-Arg header must be ASCII-safe"
    # The escaped path is present (as a \uXXXX escape sequence, not raw UTF-8
    # bytes) and round-trips correctly on the receiving end.
    assert json.loads(header_val)["path"] == non_ascii_path
    assert content.decode("utf-8") == "café notes"


# ---------------------------------------------------------------------------
# 6-way bounded download concurrency (fetch_many)
# ---------------------------------------------------------------------------


async def test_fetch_many_bounds_concurrent_downloads_to_six():
    paths = [f"/team notes/n{i}.md" for i in range(12)]
    entries = [
        {".tag": "file", "name": f"n{i}.md", "path_lower": p, "content_hash": f"h{i}"}
        for i, p in enumerate(paths)
    ]
    state = {"in_flight": 0, "max_in_flight": 0}
    lock = asyncio.Lock()

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            async with lock:
                state["in_flight"] += 1
                state["max_in_flight"] = max(state["max_in_flight"], state["in_flight"])
            await asyncio.sleep(0.02)
            async with lock:
                state["in_flight"] -= 1
            return httpx.Response(200, content=b"# N\n")
        return httpx.Response(404)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = DropboxProvider(client=client, folder_path=FOLDER)

    refs = await provider.list_changed(CREDS)
    assert len(refs) == 12

    notes = await provider.fetch_many(CREDS, refs)

    assert len(notes) == 12
    assert state["max_in_flight"] <= 6, "download concurrency must be bounded to 6"
    assert state["max_in_flight"] >= 2, "sanity: real concurrency must actually have occurred"


async def test_fetch_many_falls_back_per_ref_isolation_is_the_engines_job_not_ours():
    """Documents (rather than re-tests) engine.py's own contract: `fetch_many`
    here has NO per-item try/except -- on any single ref's failure it lets
    the exception propagate (default `asyncio.gather` behavior), because
    `engine._fetch_remote_notes` already falls back to a sequential per-ref
    `fetch()` loop on a `fetch_many` exception, isolating one bad ref to one
    named failure without this provider duplicating that logic."""
    entries = [
        {".tag": "file", "name": "ok.md", "path_lower": "/team notes/ok.md", "content_hash": "h1"},
        {".tag": "file", "name": "bad.md", "path_lower": "/team notes/bad.md", "content_hash": "h2"},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            arg = _dbx_api_arg(request)
            if arg["path"] == "/team notes/bad.md":
                return httpx.Response(500)
            return httpx.Response(200, content=b"# OK\n")
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    with pytest.raises(NoteConnTransient):
        await provider.fetch_many(CREDS, refs)


# ---------------------------------------------------------------------------
# list_folders — non-recursive PICKER helper
# ---------------------------------------------------------------------------


async def test_list_folders_returns_only_immediate_child_folders():
    entries = [
        {".tag": "folder", "name": "Sub A", "path_lower": "/team notes/sub a"},
        {".tag": "file", "name": "note.md", "path_lower": "/team notes/note.md"},
        {".tag": "folder", "name": "Sub B", "path_lower": "/team notes/sub b"},
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            body = _body(request)
            assert body.get("recursive") is False
            assert body.get("path") == FOLDER
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        return httpx.Response(404)

    provider = _make_provider(handler)
    folders = await provider.list_folders(CREDS, FOLDER)

    assert folders == [
        {"path_lower": "/team notes/sub a", "name": "Sub A"},
        {"path_lower": "/team notes/sub b", "name": "Sub B"},
    ]


# ---------------------------------------------------------------------------
# folder path resolution (the documented design-gap workaround)
# ---------------------------------------------------------------------------


async def test_missing_folder_path_raises_actionable_auth_error():
    creds = {"accessToken": ACCESS_TOKEN}  # no folderPath, provider built with none either
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(404)))
    provider = DropboxProvider(client=client)
    with pytest.raises(NoteConnAuthError, match="folder path"):
        await provider.list_changed(creds)


async def test_folder_path_from_credentials_used_when_not_supplied_at_construction():
    """The SECOND supported channel (module docstring's 'KNOWN, DOCUMENTED
    DESIGN GAP') -- `credentials['folderPath']` works even when the
    provider wasn't constructed with `folder_path=`."""
    entries = [{".tag": "file", "name": "a.md", "path_lower": "/from creds/a.md", "content_hash": "h1"}]

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            assert _body(request).get("path") == "/From Creds"
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        return httpx.Response(404)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    provider = DropboxProvider(client=client)  # no folder_path= at construction
    creds = {"accessToken": ACCESS_TOKEN, "folderPath": "/From Creds"}

    refs = await provider.list_changed(creds)
    assert [r.remote_id for r in refs] == ["/from creds/a.md"]


def test_import_key_uses_the_default_provider_colon_source_slash_remote_format():
    """Spec §5's literal format is `dropbox:{folder_id}/{path_lower}`.
    Since we picked `path_lower` for BOTH the source's `remote_id` (the
    synced folder) and each note's `remote_id` (spec's `{folder_id}` slot
    resolves to the folder's OWN path_lower under that choice), and every
    real Dropbox `path_lower` already starts with `/`, the default
    `NoteProvider.import_key` format (`f"{name}:{source}/{remote_id}"`)
    produces a double slash where the two paths join -- an accepted,
    documented byproduct of Dropbox's own leading-slash path convention,
    not a bug. No override is needed (`base.py`'s own docstring says the
    default already "matches ... Dropbox ... unchanged")."""
    provider = DropboxProvider()
    key = provider.import_key(FOLDER.lower(), TRADING_MD_PATH)
    assert key == f"dropbox:{FOLDER.lower()}/{TRADING_MD_PATH}"
    assert key == "dropbox:/team notes//team notes/trading.md"


# ---------------------------------------------------------------------------
# Attachment support (review fix #1) — co-located non-image files referenced
# by a note become `attachmentChip` nodes + `kind: 'file'` media entries,
# mirroring the wizard's `generic.js:265-292` `resolveRelativeMedia`
# precedent. A relative link to another IMPORTABLE note extension stays an
# inert relative anchor — cross-note linking is future connector work.
# ---------------------------------------------------------------------------


async def test_markdown_attachment_link_becomes_an_attachment_chip():
    note_path = "/team notes/note.md"
    pdf_path = "/team notes/report.pdf"
    entries = [
        {".tag": "file", "name": "note.md", "path_lower": note_path, "content_hash": "h1"},
        {".tag": "file", "name": "report.pdf", "path_lower": pdf_path, "content_hash": "h2"},
    ]
    text = "See [report](report.pdf) for details.\n"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            arg = _dbx_api_arg(request)
            if arg["path"] == note_path:
                return httpx.Response(200, content=text.encode("utf-8"))
            if arg["path"] == pdf_path:
                return httpx.Response(200, content=b"%PDF-1.4")
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == note_path)
    note = await provider.fetch(CREDS, ref)

    chips = [n for n in note.doc["content"] if n["type"] == "attachmentChip"]
    assert len(chips) == 1
    assert chips[0]["attrs"]["name"] == "report.pdf"
    assert chips[0]["attrs"]["href"].startswith("import-ref://dbx-md-attach:")

    assert len(note.media) == 1
    assert note.media[0]["kind"] == "file"
    assert note.media[0]["name"] == "report.pdf"

    data, _content_type = await provider.fetch_media(CREDS, note.media[0]["ref"])
    assert data == b"%PDF-1.4"


async def test_markdown_relative_link_to_another_note_extension_stays_inert():
    """A relative link to another `.md` file is NOT converted to an
    attachment — cross-note linking is future connector work."""
    note_path = "/team notes/note.md"
    other_path = "/team notes/other.md"
    entries = [
        {".tag": "file", "name": "note.md", "path_lower": note_path, "content_hash": "h1"},
        {".tag": "file", "name": "other.md", "path_lower": other_path, "content_hash": "h2"},
    ]
    text = "See [other note](other.md) for details.\n"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            if _dbx_api_arg(request)["path"] == note_path:
                return httpx.Response(200, content=text.encode("utf-8"))
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == note_path)
    note = await provider.fetch(CREDS, ref)

    assert not [n for n in note.doc["content"] if n["type"] == "attachmentChip"]
    assert note.media == []
    para = note.doc["content"][0]
    linked = next(n for n in para["content"] if n.get("marks"))
    assert linked["marks"][0]["attrs"]["href"] == "other.md"  # untouched


async def test_html_attachment_link_becomes_an_attachment_chip():
    html_path = "/team notes/page.html"
    pdf_path = "/team notes/report.pdf"
    entries = [
        {".tag": "file", "name": "page.html", "path_lower": html_path, "content_hash": "h1"},
        {".tag": "file", "name": "report.pdf", "path_lower": pdf_path, "content_hash": "h2"},
    ]
    html = '<p>See <a href="report.pdf">report</a> for details.</p>'

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            arg = _dbx_api_arg(request)
            if arg["path"] == html_path:
                return httpx.Response(200, content=html.encode("utf-8"))
            if arg["path"] == pdf_path:
                return httpx.Response(200, content=b"%PDF-1.4")
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == html_path)
    note = await provider.fetch(CREDS, ref)

    chips = [n for n in note.doc["content"] if n["type"] == "attachmentChip"]
    assert len(chips) == 1
    assert chips[0]["attrs"]["name"] == "report.pdf"

    assert len(note.media) == 1
    assert note.media[0]["kind"] == "file"
    data, _content_type = await provider.fetch_media(CREDS, note.media[0]["ref"])
    assert data == b"%PDF-1.4"


async def test_html_relative_link_to_another_note_extension_stays_inert():
    html_path = "/team notes/page.html"
    other_path = "/team notes/other.html"
    entries = [
        {".tag": "file", "name": "page.html", "path_lower": html_path, "content_hash": "h1"},
        {".tag": "file", "name": "other.html", "path_lower": other_path, "content_hash": "h2"},
    ]
    html = '<p>See <a href="other.html">other note</a></p>'

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            if _dbx_api_arg(request)["path"] == html_path:
                return httpx.Response(200, content=html.encode("utf-8"))
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == html_path)
    note = await provider.fetch(CREDS, ref)

    assert not [n for n in note.doc["content"] if n["type"] == "attachmentChip"]
    assert note.media == []


# ---------------------------------------------------------------------------
# 25MB attachment cap enforced at DOWNLOAD time (review fix #1) — imports
# notes.py's OWN `_MAX_FILE_BYTES`, never retypes it.
# ---------------------------------------------------------------------------


async def test_download_rejects_a_file_over_the_cap_via_content_length_header():
    big_path = "/team notes/huge.pdf"
    over_cap_size = dropbox_module._MAX_FILE_BYTES + 1

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/download":
            # A real over-cap body would be huge; keep the MOCK body small
            # but advertise the true size via Content-Length, proving the
            # header check rejects BEFORE reading a large body.
            return httpx.Response(
                200, content=b"x" * 10, headers={"content-length": str(over_cap_size)},
            )
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnUnsupported):
        await provider._download(CREDS, big_path)


async def test_download_rejects_a_file_over_the_cap_via_streamed_accumulation():
    """Backstop for when Content-Length is absent or understated: the
    RUNNING TOTAL while streaming is the guaranteed enforcement point,
    regardless of what (or whether) the header claims."""
    big_path = "/team notes/huge.bin"
    chunk = b"x" * 4096

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/download":
            n_chunks = (dropbox_module._MAX_FILE_BYTES // len(chunk)) + 10
            return httpx.Response(200, content=chunk * n_chunks)  # no content-length asserted
        return httpx.Response(404)

    provider = _make_provider(handler)
    with pytest.raises(NoteConnUnsupported):
        await provider._download(CREDS, big_path)


async def test_download_under_the_cap_succeeds_normally():
    small_path = "/team notes/small.md"

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/download":
            return httpx.Response(200, content=b"small content")
        return httpx.Response(404)

    provider = _make_provider(handler)
    data = await provider._download(CREDS, small_path)
    assert data == b"small content"


async def test_over_cap_attachment_is_a_named_media_failure_not_a_crash():
    """An over-cap CO-LOCATED ATTACHMENT surfaces as a per-item failure the
    engine's `_upload_media_for_note` catches (matches every other
    `fetch_media` failure mode) — fetching the NOTE ITSELF still succeeds,
    just with that one attachment's download raising when actually
    requested."""
    note_path = "/team notes/note.md"
    huge_path = "/team notes/huge.pdf"
    entries = [
        {".tag": "file", "name": "note.md", "path_lower": note_path, "content_hash": "h1"},
        {".tag": "file", "name": "huge.pdf", "path_lower": huge_path, "content_hash": "h2"},
    ]
    text = "See [huge](huge.pdf) for details.\n"
    over_cap_size = dropbox_module._MAX_FILE_BYTES + 1

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            arg = _dbx_api_arg(request)
            if arg["path"] == note_path:
                return httpx.Response(200, content=text.encode("utf-8"))
            if arg["path"] == huge_path:
                return httpx.Response(
                    200, content=b"x" * 10, headers={"content-length": str(over_cap_size)},
                )
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == note_path)
    note = await provider.fetch(CREDS, ref)  # succeeds -- the NOTE ITSELF is small

    assert len(note.media) == 1
    with pytest.raises(NoteConnUnsupported):
        await provider.fetch_media(CREDS, note.media[0]["ref"])


# ---------------------------------------------------------------------------
# Round-trip property test (review fix #2) — the encode/decode pair must be
# EXACTLY-ONCE and provably symmetric for adversarial filenames, for BOTH md
# and html paths, asserting the byte-exact original path reaches the
# captured Dropbox-API-Arg.
# ---------------------------------------------------------------------------

ADVERSARIAL_NAMES = [
    "sub dir/file %20 name.png",
    "100% done note.md",
    "café 文件.png",
]


@pytest.mark.parametrize("rel_name", ADVERSARIAL_NAMES)
async def test_markdown_media_ref_round_trips_byte_exact_adversarial_names(rel_name):
    note_path = "/team notes/note.md"
    target_path = f"/team notes/{rel_name}".lower()
    entries = [
        {".tag": "file", "name": "note.md", "path_lower": note_path, "content_hash": "h1"},
        {".tag": "file", "name": rel_name, "path_lower": target_path, "content_hash": "h2"},
    ]
    # A well-formed markdown SOURCE percent-encodes a bare destination
    # containing a space (CommonMark requires it) — `safe="/"` preserves the
    # real subdirectory separator in "sub dir/file ...".
    encoded_source_ref = quote(rel_name, safe="/")
    text = f"![x]({encoded_source_ref})\n"
    captured_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            arg = _dbx_api_arg(request)
            captured_paths.append(arg["path"])
            if arg["path"] == note_path:
                return httpx.Response(200, content=text.encode("utf-8"))
            return httpx.Response(200, content=b"binary-bytes")
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == note_path)
    note = await provider.fetch(CREDS, ref)

    assert len(note.media) == 1
    data, _content_type = await provider.fetch_media(CREDS, note.media[0]["ref"])
    assert data == b"binary-bytes"
    assert captured_paths[-1] == target_path, (
        f"round-trip corrupted: sent {captured_paths[-1]!r}, expected {target_path!r}"
    )


@pytest.mark.parametrize("rel_name", ADVERSARIAL_NAMES)
async def test_html_media_ref_round_trips_byte_exact_adversarial_names(rel_name):
    html_path = "/team notes/page.html"
    target_path = f"/team notes/{rel_name}".lower()
    entries = [
        {".tag": "file", "name": "page.html", "path_lower": html_path, "content_hash": "h1"},
        {".tag": "file", "name": rel_name, "path_lower": target_path, "content_hash": "h2"},
    ]
    # HTML attribute values carry the literal name -- no percent-encoding,
    # ever, on this path.
    html = f'<img src="{rel_name}">'
    captured_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            arg = _dbx_api_arg(request)
            captured_paths.append(arg["path"])
            if arg["path"] == html_path:
                return httpx.Response(200, content=html.encode("utf-8"))
            return httpx.Response(200, content=b"binary-bytes")
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == html_path)
    note = await provider.fetch(CREDS, ref)

    assert len(note.media) == 1
    data, _content_type = await provider.fetch_media(CREDS, note.media[0]["ref"])
    assert data == b"binary-bytes"
    assert captured_paths[-1] == target_path, (
        f"round-trip corrupted: sent {captured_paths[-1]!r}, expected {target_path!r}"
    )


async def test_html_attachment_ref_is_never_unquoted_even_with_a_literal_percent_sequence():
    """The other half of the "never unquoted" rule: an HTML-sourced ref
    containing what LOOKS LIKE a percent-escape (`%2520`) is a LITERAL
    filename fragment (never written there by any encoding pass in this
    pipeline) and must reach Dropbox byte-for-byte, NOT get "helpfully"
    decoded into `%20`."""
    html_path = "/team notes/page.html"
    literal_name = "weird%2520name.png"
    target_path = f"/team notes/{literal_name}"
    entries = [
        {".tag": "file", "name": "page.html", "path_lower": html_path, "content_hash": "h1"},
        {".tag": "file", "name": literal_name, "path_lower": target_path, "content_hash": "h2"},
    ]
    html = f'<img src="{literal_name}">'
    captured_paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/2/files/list_folder":
            return httpx.Response(200, json={"entries": entries, "cursor": "c", "has_more": False})
        if request.url.path == "/2/files/download":
            arg = _dbx_api_arg(request)
            captured_paths.append(arg["path"])
            if arg["path"] == html_path:
                return httpx.Response(200, content=html.encode("utf-8"))
            return httpx.Response(200, content=b"binary-bytes")
        return httpx.Response(404)

    provider = _make_provider(handler)
    refs = await provider.list_changed(CREDS)
    ref = next(r for r in refs if r.remote_id == html_path)
    note = await provider.fetch(CREDS, ref)
    await provider.fetch_media(CREDS, note.media[0]["ref"])

    assert captured_paths[-1] == target_path  # byte-exact -- NOT decoded to "weird%20name.png"


# ---------------------------------------------------------------------------
# Engine-level safety net (review fix #3): a non-ISO `updatedAt` must not
# explode into a false conflict on re-sync. Uses the SAME fixture idiom as
# `test_note_connectors_engine.py` (temp auth.db + a fake `NoteProvider`),
# scoped locally here since this task owns only dropbox.py/mddoc.py/this
# test file — this PINS engine.py's EXISTING, already-correct behavior
# (traced during review), it does not change engine.py.
# ---------------------------------------------------------------------------


@pytest.fixture
def _engine_db(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    import api.services.journal_two.note_connectors.connections as conns
    return conns


class _NonIsoFakeProvider(NoteProvider):
    """Emits a NON-ISO `updatedAt` (a 64-char hex digest — exactly the shape
    a content_hash-as-updated_at regression would reintroduce) on every
    fetch, with DIFFERENT body content each call (forcing a real UPDATE, not
    a hash-match skip, on the second sync) — pins the engine's existing
    safety net independent of which real provider might one day trigger it
    again."""

    name = "fake"

    def __init__(self, updated_at: str):
        self._updated_at = updated_at
        self._call_count = 0

    async def validate(self, credentials):
        return AccountInfo(label="fake")

    async def list_changed(self, credentials, cursor=None):
        return [RemoteRef(remote_id="p1", updated_at=self._updated_at)]

    async def fetch(self, credentials, ref):
        self._call_count += 1
        text = f"content version {self._call_count}"
        return RemoteNote(
            remote_id=ref.remote_id, title="Note",
            doc={"type": "doc", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": text}]},
            ]},
            media=[], links=[], tags=[], folder_path=[],
            created_at=None, updated_at=self._updated_at,
        )

    async def fetch_media(self, credentials, ref):
        raise AssertionError("not used in this test")


async def test_non_iso_updated_at_falls_back_consistently_and_never_conflicts_on_resync(
    _engine_db, monkeypatch,
):
    """The safety net the review traced: `notes.py::_import_date` silently
    falls back to `now` for BOTH `updated_at` and `imported_at` on the SAME
    `import_confirm` call whenever the supplied `updatedAt` fails ISO
    parsing (a content-hash-shaped string always does) — so they land
    EQUAL, never stale, and `engine._is_conflict` (`updated > imported`)
    never fires. Pinned so a future `import_confirm`/`_import_date` refactor
    can't silently reintroduce a conflict-explosion for any provider that
    ever emits a non-ISO `updatedAt` again."""
    _engine_db.upsert_connector("u1", "fake", {"token": "abc"})
    source = _engine_db.create_source("u1", "fake", "fake-graph")
    provider = _NonIsoFakeProvider(updated_at="a" * 64)  # content-hash-shaped, non-ISO
    monkeypatch.setattr(note_engine, "_provider_factory", lambda name: provider)

    result_1 = await note_engine.sync_source(source["id"], full=True, manual=True)
    assert result_1["status"] == "ok"
    assert result_1["created"] == 1

    # Re-sync WITHOUT any local edit in between, but with genuinely DIFFERENT
    # remote content (forcing a real update, not a hash-match skip) — must
    # not create a conflict sibling or tag the note sync-conflict.
    result_2 = await note_engine.sync_source(source["id"], full=True, manual=True)
    assert result_2["status"] == "ok"
    assert result_2["updated"] == 1
    assert result_2["conflicts"] == 0

    notes = notes_svc.list_notes("u1")
    assert len(notes) == 1  # no `#remote` conflict sibling was created
    assert "sync-conflict" not in notes[0]["tags"]
    assert notes[0]["bodyPlain"] == "content version 2"  # the update actually applied
