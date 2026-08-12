"""Dropbox folder-sync provider — the fourth connector (spec §7), built
COMPLETE but DARK: inert until `DROPBOX_APP_KEY`/`DROPBOX_APP_SECRET` are set
(`configured()`). Importing this module with no env creds set never raises —
only calling a method does (`NoteConnNotConfigured`), same contract as every
other provider (`providers/__init__.py`).

⚠️ CONCURRENCY NOTE (task-10 brief): `oauth.py` is being built concurrently
by another agent for the Notion provider and does not exist yet. Dropbox's
own OAuth token-exchange/refresh mechanics therefore live HERE as private
module functions (`_exchange_authorization_code`, `_refresh_access_token`)
rather than importing a shared helper — the router task (whichever task
wires `POST /{provider}/connect` + `GET /{provider}/callback`) can call these
directly or move/re-export them once `oauth.py` lands. Do not block on that
file; this module is self-contained.

Dropbox mechanics (research, binding per the brief):
  - Offline OAuth: `token_access_type=offline` at authorize time, scopes
    `files.metadata.read files.content.read account_info.read`. Refresh via
    `POST https://api.dropboxapi.com/oauth2/token` (`grant_type=
    refresh_token`) — per Dropbox's offline-access model this does NOT
    rotate/return a new refresh_token; the original stays valid until the
    user revokes access. Neither token is ever logged (only short, non-secret
    messages appear in raised exceptions).
  - RPC endpoints are JSON POSTs to `https://api.dropboxapi.com/2/...`.
  - Content download is `POST https://content.dropboxapi.com/2/files/
    download` with a `Dropbox-API-Arg` HEADER (JSON, must be ASCII-safe —
    `json.dumps(..., ensure_ascii=True)`, since HTTP headers cannot carry
    arbitrary UTF-8 bytes; a non-ASCII Dropbox path would otherwise break the
    header encoding) and an EMPTY body.
  - `files/list_folder` (`{path, recursive: true}`) -> `{entries, cursor,
    has_more}`; `has_more` -> `files/list_folder/continue` in a loop.
    Entries are tagged `file`/`folder`/`deleted`.
  - A 409 on `list_folder`/`list_folder/continue` whose body is `{"error":
    {".tag": "reset"}}` means the cursor was invalidated — the correct
    recovery is a fresh full recursive re-list, never a crash. A `{".tag":
    "path"}` 409 means the synced folder itself is gone/inaccessible ->
    `NoteConnUnsupported`.
  - A 429 carries a `Retry-After` header (and/or a body `retry_after`) that
    MUST be honored — Dropbox notes it may reflect lock contention, not a
    genuine quota breach, so the correct remedy is the same either way: wait
    and retry.
  - `content_hash` on file metadata is the per-file change-detection
    surrogate (see `_change_signal`'s docstring for why it — not
    `server_modified` — was chosen, and the cursor-representation tradeoff
    that choice implies).

────────────────────────────────────────────────────────────────────────────
KNOWN, DOCUMENTED DESIGN GAP — read before wiring this provider into a source
────────────────────────────────────────────────────────────────────────────
`NoteProvider.list_changed`/`fetch`/`fetch_media` (base.py) take ONLY
`credentials` — there is no per-SOURCE parameter, because `engine._do_sync`
(out of this task's scope to change) does exactly:

    provider = _provider_factory(source["provider"])          # name only
    creds = connections.get_token(user_id, source["provider"]) # connector-level
    refs = await provider.list_changed(creds, cursor=cursor)   # no source info

Roam/Craft never hit this: for them, "connector" and "source" are 1:1 (a
graph token / capability URL both up front be a single graph/space, so the
credentials dict itself IS the source identity). Dropbox is the first
provider where that's false BY DESIGN — one OAuth connection (one connector
row, `j2_note_connectors` is PK'd `(user_id, provider)`, so only ONE Dropbox
connector can ever exist per user) can back MULTIPLE folders/sources
(`j2_note_sources` has no such uniqueness constraint on remote_id). So
`list_changed`/`fetch`/`fetch_media` need to know WHICH folder, and the
current contract has nowhere to put that.

`_default_provider_factory`'s own docstring flags itself as "a test seam;
Task 11's registry replaces this" — i.e. a source-aware construction path is
already expected to land. Until then, `DropboxProvider` accepts the target
folder path in EITHER of two ways (documented so the eventual router/registry
task has a concrete contract to satisfy):

  1. At construction: `DropboxProvider(folder_path="/team notes")` — the
     shape a source-aware factory would use.
  2. Embedded in the credentials dict: `credentials["folderPath"]` — a
     fallback for the CURRENT `_default_provider_factory`-shaped call path,
     if some future glue augments `connections.get_token`'s result before
     calling this provider.

If neither is supplied, every method raises `NoteConnAuthError` with an
actionable message rather than doing something silently wrong.

────────────────────────────────────────────────────────────────────────────
CURSOR REPRESENTATION — the other documented tradeoff
────────────────────────────────────────────────────────────────────────────
`engine._do_sync` persists `source.cursor <- max(ref.updated_at for ref in
refs)` after every successful sync (engine.py's own docstring, point 6), and
hands that value straight back as `cursor` on the next call — there is no
separate channel for a provider to store its OWN opaque state across syncs.
The task brief is explicit that `RemoteRef.updated_at` should carry Dropbox's
`content_hash` (see `_change_signal`), which is the CORRECT signal for
per-file change detection (feeds `j2_note_remote_index.remote_updated_at`
and, via `RemoteNote.updated_at`, the engine's `import_confirm` hash basis)
but is NOT a real Dropbox `list_folder` continuation cursor.

Consequence: `list_changed(credentials, cursor=<some file's content_hash>)`
will almost always fail Dropbox's own cursor validation. This is handled,
not ignored: Dropbox's `409 {".tag": "reset"}` response is EXACTLY the
documented recovery signal for "this cursor isn't recognized," and
`list_changed` below catches it and falls back to a full recursive re-list
transparently. The net effect (today, until a future task threads a
provider-private cursor store through the source row) is that Dropbox syncs
here are always effectively FULL listings — correct, self-healing, just not
maximally efficient. `list_folder/continue` is still implemented faithfully
(not stubbed out) so it activates for free the day a real cursor can flow
through.
"""

from __future__ import annotations

import asyncio
import json
import os
import posixpath
import re
from typing import Any
from urllib.parse import unquote, urlencode, urlsplit

import httpx

from .. import errors
from ..convert import LINK_PREFIX, REF_PREFIX, html_to_tiptap, md_to_tiptap
from .base import AccountInfo, NoteProvider, RemoteNote, RemoteRef


_API_BASE = "https://api.dropboxapi.com/2"
_CONTENT_BASE = "https://content.dropboxapi.com/2"
_OAUTH_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"
_OAUTH_AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize"

# Offline access (long-lived, unattended background sync) + the three
# read-only scopes the brief names.
OAUTH_SCOPES = "files.metadata.read files.content.read account_info.read"
OAUTH_TOKEN_ACCESS_TYPE = "offline"

# File extensions that become NOTES (mapped to RemoteRefs). Everything else
# under the folder (images, PDFs, other attachments) is MEDIA — resolved
# only when a note references it by relative path, never enumerated as its
# own note.
_NOTE_EXTENSIONS = (".md", ".txt", ".html", ".htm")

# Internal-only prefix marking a media ref this provider has already
# resolved to an absolute Dropbox `path_lower` (see `_resolve_one_relative_ref`
# / `fetch_media`) — distinguishes "download via the Dropbox content API" from
# a genuine external `https://` URL. Never leaks outward; stripped in
# `fetch_media` before it ever reaches Dropbox.
_DBX_PATH_SCHEME = "dbx-path:"

_MAX_LIST_PAGES = 500  # defensive cap against a pathological has_more loop
_RATE_LIMIT_MAX_RETRIES = 3
_DEFAULT_RETRY_AFTER_SECONDS = 5.0
_MAX_CONCURRENT_DOWNLOADS = 6  # brief: "downloads 6-way bounded concurrency"


def configured() -> bool:
    """`DROPBOX_APP_KEY`/`DROPBOX_APP_SECRET` both set -> the app is
    registered and this provider is usable. Every public method (`validate`/
    `list_changed`/`fetch`/`fetch_media`/`list_folders`) checks this FIRST
    and raises `NoteConnNotConfigured` when false — importing this module
    (or constructing `DropboxProvider`) with neither set never raises."""
    return bool(os.environ.get("DROPBOX_APP_KEY") and os.environ.get("DROPBOX_APP_SECRET"))


def _require_configured() -> None:
    if not configured():
        raise errors.NoteConnNotConfigured("DROPBOX_APP_KEY/DROPBOX_APP_SECRET not set")


def _app_credentials() -> tuple[str, str]:
    app_key = os.environ.get("DROPBOX_APP_KEY")
    app_secret = os.environ.get("DROPBOX_APP_SECRET")
    if not app_key or not app_secret:
        raise errors.NoteConnNotConfigured("DROPBOX_APP_KEY/DROPBOX_APP_SECRET not set")
    return app_key, app_secret


def authorize_url(redirect_uri: str, state: str | None = None) -> str:
    """Builds the Dropbox `/oauth2/authorize` redirect URL for the connect
    flow (offline access + the three read scopes). A thin, stateless helper
    -- the router task decides where/how to send the user here."""
    app_key, _app_secret = _app_credentials()
    params = {
        "client_id": app_key,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "token_access_type": OAUTH_TOKEN_ACCESS_TYPE,
        "scope": OAUTH_SCOPES,
    }
    if state:
        params["state"] = state
    return f"{_OAUTH_AUTHORIZE_URL}?{urlencode(params)}"


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except ValueError:
        return None


def _retry_after_seconds(response: httpx.Response) -> float:
    header_val = response.headers.get("retry-after")
    if header_val:
        try:
            return max(0.0, float(header_val))
        except ValueError:
            pass
    body = _safe_json(response) or {}
    err = body.get("error")
    if isinstance(err, dict):
        ra = err.get("retry_after")
        if isinstance(ra, (int, float)):
            return max(0.0, float(ra))
    return _DEFAULT_RETRY_AFTER_SECONDS


def _error_tag(response: httpx.Response) -> str | None:
    body = _safe_json(response) or {}
    err = body.get("error")
    if isinstance(err, dict):
        tag = err.get(".tag")
        return str(tag) if tag is not None else None
    return None


def _raise_generic_error(response: httpx.Response) -> None:
    """Raises the shared taxonomy for any status this module doesn't give
    special handling to elsewhere (401/403/429/5xx/other)."""
    if response.status_code in (401, 403):
        tag = (_error_tag(response) or "").lower()
        if "expired" in tag:
            raise errors.NoteConnTokenExpired(
                f"Dropbox access token expired ({response.status_code})",
                status=response.status_code,
            )
        raise errors.NoteConnAuthError(
            f"Dropbox rejected the access token ({response.status_code})",
            status=response.status_code,
        )
    if response.status_code == 429:
        raise errors.NoteConnRateLimited(
            "Dropbox rate limit exceeded",
            retry_after=_retry_after_seconds(response),
            status=429,
        )
    raise errors.NoteConnTransient(
        f"Dropbox API error {response.status_code}", status=response.status_code,
    )


class _ResetSignal(Exception):
    """Internal-only sentinel: a `list_folder`/`list_folder/continue` call
    409'd with `.tag: reset` (the cursor is invalidated). Caught inside this
    module to trigger a full recursive re-list — NEVER escapes to a caller
    (every raise site is wrapped)."""


def _raise_list_folder_error(response: httpx.Response) -> None:
    """409-aware error classification for the `list_folder` family — falls
    through to `_raise_generic_error` for anything that isn't one of
    Dropbox's two documented `ListFolderContinueError`/`ListFolderError`
    shapes."""
    if response.status_code == 409:
        tag = _error_tag(response)
        if tag == "reset":
            raise _ResetSignal()
        if tag == "path":
            reason = (
                "The synced Dropbox folder no longer exists or is no longer accessible."
            )
            raise errors.NoteConnUnsupported(reason, reason=reason, status=409)
        body = _safe_json(response) or {}
        raise errors.NoteConnTransient(
            f"Dropbox list_folder error: {body.get('error_summary') or tag or 'unknown'}",
            status=409,
        )
    _raise_generic_error(response)


def _dropbox_api_path(path: str | None) -> str:
    """Dropbox's API wants `""` for the root of the app/account folder (NOT
    `"/"`), and any other path must start with `/` and carry no trailing
    slash."""
    p = (path or "").strip()
    if p in ("", "/"):
        return ""
    if not p.startswith("/"):
        p = "/" + p
    return p.rstrip("/")


def _extension(path_lower: str) -> str:
    idx = path_lower.rfind(".")
    return path_lower[idx:] if idx != -1 else ""


def _change_signal(entry: dict[str, Any]) -> str:
    """The per-file change-detection surrogate — stored as BOTH
    `RemoteRef.updated_at` (-> `j2_note_remote_index.remote_updated_at`, per
    the brief's explicit directive) and `RemoteNote.updated_at` (-> the
    engine's `import_confirm` hash basis, so an unchanged file hashes
    identically and is correctly skipped downstream). Dropbox's
    `content_hash` reflects file CONTENT ONLY — ignoring metadata-only
    touches like an in-place rename/move some sync clients perform without
    altering bytes — which is a more reliable "did this note actually
    change" signal than `server_modified` (which some clients bump on
    metadata-only touches). See the module docstring's cursor-representation
    note for the tradeoff this choice implies for `source.cursor`. Falls
    back to `server_modified` for the rare entry shape lacking
    `content_hash` (defensive; real Dropbox `FileMetadata` always has it)."""
    return entry.get("content_hash") or entry.get("server_modified") or ""


def _title_from_path(path_lower: str, entry: dict[str, Any] | None) -> str:
    name = (entry or {}).get("name")
    base = name or posixpath.basename(path_lower)
    stem = posixpath.splitext(base)[0]
    return stem or base


_MD_IMAGE_RE = re.compile(r"(!\[[^\]]*\]\()\s*([^)\s]+)((?:\s+\"[^\"]*\")?\s*\))")
_HTML_IMG_SRC_RE = re.compile(r'(<img\b[^>]*?\bsrc\s*=\s*)(["\'])(.*?)\2', re.IGNORECASE | re.DOTALL)


def _looks_like_local_path(url: str) -> bool:
    """True for a reference this provider should attempt to resolve against
    the synced folder tree — i.e. NOT an absolute URL, a `data:` URI, or
    something already carrying one of mddoc's own placeholder prefixes."""
    if not url:
        return False
    if url.startswith((REF_PREFIX, LINK_PREFIX, "data:", _DBX_PATH_SCHEME)):
        return False
    first_segment = url.split("/", 1)[0]
    if "://" in first_segment or first_segment.startswith("mailto:"):
        return False
    return True


class DropboxProvider(NoteProvider):
    name = "dropbox"

    def __init__(
        self,
        *,
        client: httpx.AsyncClient | None = None,
        sleep_fn: Any = None,
        folder_path: str | None = None,
    ) -> None:
        # Tests inject a `client` built on `httpx.MockTransport` (no live
        # calls) and a `sleep_fn` that returns instantly instead of actually
        # sleeping through the 429 retry ladder.
        self._client = client
        self._owns_client = client is None
        self._sleep = sleep_fn if sleep_fn is not None else asyncio.sleep
        # See the module docstring's "KNOWN, DOCUMENTED DESIGN GAP" section —
        # the folder this provider syncs, supplied here (source-aware
        # construction) or read from `credentials['folderPath']` per call.
        self._folder_path_override = folder_path
        # A token minted by an in-place refresh (see `_send`'s 401 handling)
        # — lives only as long as this instance (one sync), never persisted;
        # the router/engine reconciliation is expected to capture+persist a
        # refreshed token in a future task (see module docstring).
        self._access_token_override: str | None = None
        # path_lower -> Dropbox entry metadata, rebuilt on every
        # `list_changed()` — used both to resolve relative media references
        # (`_resolve_one_relative_ref`) and to look up a file's `name`/
        # `content_hash` in `fetch()`. Instance state, not a module global —
        # its lifetime is exactly one `DropboxProvider` object, mirroring
        # `CraftProvider._doc_meta` / `RoamProvider._title_to_uid`.
        self._entries_by_path: dict[str, dict[str, Any]] = {}
        self._folder_root: str = ""
        self._enumerated = False
        self._download_semaphore = asyncio.Semaphore(_MAX_CONCURRENT_DOWNLOADS)

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    # ── credentials / folder resolution ─────────────────────────────────

    def _effective_access_token(self, credentials: dict[str, Any]) -> str:
        token = self._access_token_override or credentials.get("accessToken")
        if not token:
            raise errors.NoteConnAuthError("Dropbox credentials missing accessToken")
        return token

    def _resolve_folder_path(self, credentials: dict[str, Any]) -> str:
        path = self._folder_path_override or credentials.get("folderPath")
        if not path:
            raise errors.NoteConnAuthError(
                "Dropbox source requires a folder path — pass folder_path= to "
                "DropboxProvider(), or set credentials['folderPath'] (see the "
                "module docstring's design-gap note)",
            )
        return path

    def _require_enumerated(self) -> None:
        if not self._enumerated:
            raise RuntimeError(
                "call list_changed() before fetch()/fetch_media() — the "
                "path->entry map (relative media resolution, titles, "
                "folder_path) is built there",
            )

    # ── transport ────────────────────────────────────────────────────────

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30.0)
        return self._client

    async def _try_refresh(self, credentials: dict[str, Any]) -> str | None:
        refresh_token = credentials.get("refreshToken")
        if not refresh_token or not configured():
            return None
        client = await self._get_client()
        try:
            data = await _refresh_access_token(client, refresh_token)
        except errors.NoteConnError:
            return None
        token = data.get("access_token")
        return token if isinstance(token, str) and token else None

    async def _send(
        self,
        credentials: dict[str, Any],
        path: str,
        *,
        json_body: dict[str, Any] | None,
        is_content: bool = False,
        dbx_api_arg: dict[str, Any] | None = None,
    ) -> httpx.Response:
        """Sends ONE Dropbox call (RPC or content), UNIFORMLY handling: (a)
        one in-place access-token refresh-and-retry on a 401 (see the module
        docstring — the refreshed token is cached on `self` for the rest of
        this instance's lifetime, not persisted), and (b) a bounded
        Retry-After-honoring retry ladder on 429. The access token is the
        ONLY credential ever attached, and ONLY to `api.dropboxapi.com`/
        `content.dropboxapi.com` (`_API_BASE`/`_CONTENT_BASE` are the sole
        URL bases this method ever builds a request against)."""
        client = await self._get_client()
        base = _CONTENT_BASE if is_content else _API_BASE
        url = f"{base}{path}"
        refreshed_once = False
        attempt = 0
        while True:
            token = self._effective_access_token(credentials)
            headers: dict[str, str] = {"Authorization": f"Bearer {token}"}
            if is_content:
                # ASCII-safe per the module docstring — a raw UTF-8 header
                # value is invalid HTTP and would corrupt a non-ASCII path.
                headers["Dropbox-API-Arg"] = json.dumps(dbx_api_arg or {}, ensure_ascii=True)
                body = b""
            else:
                headers["Content-Type"] = "application/json"
                body = json.dumps(json_body).encode("utf-8")
            try:
                response = await client.post(url, headers=headers, content=body)
            except httpx.RequestError as exc:
                raise errors.NoteConnTransient(f"Dropbox request failed: {exc}") from exc

            if response.status_code == 401 and not refreshed_once:
                refreshed_once = True
                new_token = await self._try_refresh(credentials)
                if new_token is not None:
                    self._access_token_override = new_token
                    continue
                return response  # caller raises the appropriate auth error

            if response.status_code == 429:
                if attempt < _RATE_LIMIT_MAX_RETRIES:
                    await self._sleep(_retry_after_seconds(response))
                    attempt += 1
                    continue
                return response  # retries exhausted -- caller raises NoteConnRateLimited

            return response

    # ── list_folder pagination (shared by list_changed + list_folders) ──

    async def _drain(self, credentials: dict[str, Any], first: httpx.Response) -> list[dict[str, Any]]:
        """Given the response of an initial `list_folder`/`list_folder/
        continue` call, pages via `list_folder/continue` until `has_more` is
        false. Raises `_ResetSignal` (internal) on a `.tag: reset` 409 at
        ANY point in the loop — including the very first response."""
        if first.status_code != 200:
            _raise_list_folder_error(first)
        data = first.json()
        entries = list(data.get("entries") or [])
        cursor = data.get("cursor")
        has_more = bool(data.get("has_more"))
        pages = 1
        while has_more:
            pages += 1
            if pages > _MAX_LIST_PAGES:
                raise errors.NoteConnTransient(
                    f"Dropbox list_folder pagination exceeded {_MAX_LIST_PAGES} "
                    "pages without finishing -- aborting rather than looping forever",
                )
            resp = await self._send(
                credentials, "/files/list_folder/continue",
                json_body={"cursor": cursor},
            )
            if resp.status_code != 200:
                _raise_list_folder_error(resp)
            data = resp.json()
            entries.extend(data.get("entries") or [])
            cursor = data.get("cursor")
            has_more = bool(data.get("has_more"))
        return entries

    async def _full_listing_entries(
        self, credentials: dict[str, Any], folder_path: str,
    ) -> list[dict[str, Any]]:
        try:
            first = await self._send(
                credentials, "/files/list_folder",
                json_body={
                    "path": _dropbox_api_path(folder_path),
                    "recursive": True,
                    "include_deleted": True,
                    "include_non_downloadable_files": True,
                },
            )
            return await self._drain(credentials, first)
        except _ResetSignal as exc:
            # A reset THIS early (mid a just-started full listing) would be
            # unusual, but must never escape as an internal exception type.
            raise errors.NoteConnTransient(
                "Dropbox invalidated the list_folder cursor mid-listing -- retry the sync",
            ) from exc

    def _entries_to_refs(self, entries: list[dict[str, Any]]) -> list[RemoteRef]:
        refs: list[RemoteRef] = []
        for entry in entries:
            if entry.get(".tag") != "file":
                continue  # folders + deleted entries never become notes directly
            path_lower = entry.get("path_lower")
            if not path_lower or _extension(path_lower) not in _NOTE_EXTENSIONS:
                continue  # media/other attachments are resolved by reference, not enumerated
            refs.append(RemoteRef(remote_id=path_lower, updated_at=_change_signal(entry)))
        return refs

    def _index_entries(self, folder_path: str, entries: list[dict[str, Any]]) -> None:
        self._folder_root = _dropbox_api_path(folder_path).lower().strip("/")
        index: dict[str, dict[str, Any]] = {}
        for entry in entries:
            path_lower = entry.get("path_lower")
            if path_lower:
                index[path_lower] = entry
        self._entries_by_path = index
        self._enumerated = True

    # ── NoteProvider contract ───────────────────────────────────────────

    async def validate(self, credentials: dict[str, Any]) -> AccountInfo:
        _require_configured()
        response = await self._send(credentials, "/users/get_current_account", json_body=None)
        if response.status_code != 200:
            _raise_generic_error(response)
        data = response.json()
        name = ((data.get("name") or {}).get("display_name")) or data.get("email") or "Dropbox"
        return AccountInfo(label=name, raw={"account_id": data.get("account_id")})

    async def list_folders(
        self, credentials: dict[str, Any], path: str = "",
    ) -> list[dict[str, Any]]:
        """Non-recursive folder listing for the CONNECT-FLOW PICKER (spec
        §7: "OWN folder picker") — a Dropbox-specific extra method, not part
        of the abstract `NoteProvider` contract, exposed for the router task.
        Returns immediate child FOLDERS only, files filtered out."""
        _require_configured()
        try:
            first = await self._send(
                credentials, "/files/list_folder",
                json_body={"path": _dropbox_api_path(path), "recursive": False},
            )
            entries = await self._drain(credentials, first)
        except _ResetSignal as exc:
            raise errors.NoteConnTransient(
                "Dropbox invalidated the list_folder cursor -- retry",
            ) from exc
        return [
            {"path_lower": e.get("path_lower"), "name": e.get("name")}
            for e in entries if e.get(".tag") == "folder"
        ]

    async def list_changed(
        self, credentials: dict[str, Any], cursor: str | None = None,
    ) -> list[RemoteRef]:
        _require_configured()
        folder_path = self._resolve_folder_path(credentials)

        if cursor:
            try:
                first = await self._send(
                    credentials, "/files/list_folder/continue",
                    json_body={"cursor": cursor},
                )
                entries = await self._drain(credentials, first)
            except _ResetSignal:
                # The documented recovery path — see module docstring's
                # "CURSOR REPRESENTATION" section for why this is the
                # EXPECTED steady-state, not an edge case.
                entries = await self._full_listing_entries(credentials, folder_path)
        else:
            entries = await self._full_listing_entries(credentials, folder_path)

        self._index_entries(folder_path, entries)
        return self._entries_to_refs(entries)

    def _resolve_one_relative_ref(self, url: str, file_dir: str) -> str | None:
        if not _looks_like_local_path(url):
            return None
        candidate = posixpath.normpath(posixpath.join(file_dir, url)).lower()
        entry = self._entries_by_path.get(candidate)
        if entry is not None and entry.get(".tag") == "file":
            return candidate
        return None

    def _resolve_relative_media_markdown(self, text: str, path_lower: str) -> str:
        file_dir = posixpath.dirname(path_lower)

        def repl(m: "re.Match[str]") -> str:
            resolved = self._resolve_one_relative_ref(m.group(2), file_dir)
            if resolved is None:
                return m.group(0)
            # Angle-bracket destination form (CommonMark-legal) -- a bare
            # `(url)` destination cannot contain a raw space, and Dropbox
            # paths routinely do (folder/file names with spaces). markdown-
            # it-py still percent-encodes the destination it parses out of
            # `<...>` (its own `normalizeLink`), so `fetch_media` below
            # un-quotes a `dbx-path:` ref before using it as a real Dropbox
            # path -- this wrapping and that un-quoting are a matched pair.
            return f"{m.group(1)}<{_DBX_PATH_SCHEME}{resolved}>{m.group(3)}"

        return _MD_IMAGE_RE.sub(repl, text)

    def _resolve_relative_media_html(self, text: str, path_lower: str) -> str:
        file_dir = posixpath.dirname(path_lower)

        def repl(m: "re.Match[str]") -> str:
            resolved = self._resolve_one_relative_ref(m.group(3), file_dir)
            if resolved is None:
                return m.group(0)
            return f"{m.group(1)}{m.group(2)}{_DBX_PATH_SCHEME}{resolved}{m.group(2)}"

        return _HTML_IMG_SRC_RE.sub(repl, text)

    def _relative_folder(self, path_lower: str) -> list[str]:
        """The file's directory segments RELATIVE to the synced folder
        root (spec: `folder_path`)."""
        file_dir = posixpath.dirname(path_lower).strip("/")
        root = self._folder_root
        if root and (file_dir == root or file_dir.startswith(root + "/")):
            rel = file_dir[len(root):].strip("/")
        elif root:
            rel = file_dir  # outside the known root (shouldn't happen) -- best effort
        else:
            rel = file_dir
        return [seg for seg in rel.split("/") if seg] if rel else []

    async def _download(self, credentials: dict[str, Any], path_lower: str) -> bytes:
        async with self._download_semaphore:
            response = await self._send(
                credentials, "/files/download", json_body=None, is_content=True,
                dbx_api_arg={"path": path_lower},
            )
        if response.status_code != 200:
            _raise_generic_error(response)
        return response.content

    async def fetch(self, credentials: dict[str, Any], ref: RemoteRef) -> RemoteNote:
        _require_configured()
        self._require_enumerated()
        path_lower = ref.remote_id
        entry = self._entries_by_path.get(path_lower)
        raw = await self._download(credentials, path_lower)
        text = raw.decode("utf-8", errors="replace")
        ext = _extension(path_lower)

        if ext in (".html", ".htm"):
            text = self._resolve_relative_media_html(text, path_lower)
            converted = html_to_tiptap(text)
        elif ext == ".md":
            text = self._resolve_relative_media_markdown(text, path_lower)
            converted = md_to_tiptap(text)
        else:  # .txt
            converted = _txt_to_tiptap(text)

        change_signal = _change_signal(entry) if entry else ref.updated_at
        return RemoteNote(
            remote_id=path_lower,
            title=_title_from_path(path_lower, entry),
            doc=converted["doc"],
            media=converted["media"],
            links=converted["links"],
            tags=[],
            folder_path=self._relative_folder(path_lower),
            created_at=None,  # Dropbox FileMetadata has no field distinct from
            # client_modified/server_modified that means "created" — leaving
            # this None is honest rather than guessing.
            updated_at=change_signal,
        )

    async def fetch_many(
        self, credentials: dict[str, Any], refs: list[RemoteRef],
    ) -> list[RemoteNote]:
        """Concurrent resolution — each `fetch()`'s actual download is
        bounded by `self._download_semaphore` (6-way, per the brief), so
        gathering the whole batch here is safe: at most 6 downloads are ever
        in flight regardless of batch size. On ANY single ref's failure this
        raises (default `asyncio.gather` behavior), and the engine's own
        `_fetch_remote_notes` falls back to a sequential per-ref `fetch()`
        loop for that batch — isolating the one bad ref to one named failure
        without special-casing it here."""
        self._require_enumerated()
        if not refs:
            return []
        return list(await asyncio.gather(*(self.fetch(credentials, ref) for ref in refs)))

    async def fetch_media(self, credentials: dict[str, Any], ref: str) -> tuple[bytes, str]:
        _require_configured()
        if ref.startswith(_DBX_PATH_SCHEME):
            # `unquote` reverses markdown-it-py's `normalizeLink` percent-
            # encoding of the angle-bracket destination `_resolve_relative_
            # media_markdown` writes (a raw Dropbox path can contain spaces,
            # which bare markdown destinations can't) -- a no-op for the
            # HTML path, which was never percent-encoded to begin with.
            path_lower = unquote(ref[len(_DBX_PATH_SCHEME):])
            content = await self._download(credentials, path_lower)
            return content, _guess_content_type(path_lower)

        # NOT a Dropbox-internal path we resolved ourselves -- some other
        # ref (an unresolved relative path, or a genuine external URL) taken
        # from DOCUMENT CONTENT. The Dropbox access token is NEVER attached
        # here (mirrors CraftProvider.fetch_media's precedent): only
        # `_send()` (hardcoded to `_API_BASE`/`_CONTENT_BASE`) ever carries
        # it, and this branch never calls `_send()`.
        parsed = urlsplit(ref)
        if (parsed.scheme or "").lower() != "https":
            raise errors.NoteConnUnsupported(
                f"Cannot fetch media over a non-Dropbox, non-https reference ({ref!r})",
                reason="Media reference did not resolve to a file in the synced "
                       "folder and is not a secure (https) URL",
            )
        client = await self._get_client()
        try:
            response = await client.get(ref, follow_redirects=True)
        except httpx.RequestError as exc:
            raise errors.NoteConnTransient(f"Failed to download media: {exc}") from exc
        if response.status_code >= 400:
            raise errors.NoteConnTransient(
                f"Failed to download media ({response.status_code})",
                status=response.status_code,
            )
        content_type = response.headers.get("content-type", "application/octet-stream")
        return response.content, content_type


def _txt_to_tiptap(text: str | None) -> dict[str, Any]:
    """Plain-text (.txt) -> TipTap JSON with NO markdown parsing — every
    character is literal (a `*`/`#`/`_` is never interpreted as syntax).
    Blank-line-separated blocks become separate paragraphs; single newlines
    within a block become explicit `hardBreak`s (preserves a plain-text
    file's original line layout, which its author typically intends
    verbatim, unlike markdown's line-reflow convention). No links/media are
    possible in plain text, so both lists are always empty.

    Private, Dropbox-only fallback per the task brief ("reuse the mddoc
    helper if one exists, else escape+paragraphs") — `mddoc.py` has no
    ready-made text-literal helper, and feeding raw `.txt` content through
    `md_to_tiptap` would risk misinterpreting literal characters (a leading
    `#`, a stray `*`) as markdown syntax."""
    raw = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip("\n")
    if raw.strip() == "":
        return {"doc": {"type": "doc", "content": []}, "media": [], "links": []}
    content: list[dict[str, Any]] = []
    for block in re.split(r"\n{2,}", raw):
        lines = block.split("\n")
        para: list[dict[str, Any]] = []
        for i, line in enumerate(lines):
            if i > 0:
                para.append({"type": "hardBreak"})
            if line:
                para.append({"type": "text", "text": line})
        content.append({"type": "paragraph", "content": para})
    return {"doc": {"type": "doc", "content": content}, "media": [], "links": []}


_CONTENT_TYPE_BY_EXT = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
}


def _guess_content_type(path_lower: str) -> str:
    return _CONTENT_TYPE_BY_EXT.get(_extension(path_lower), "application/octet-stream")


# ── OAuth mechanics (private; see module docstring's CONCURRENCY NOTE) ─────


async def _exchange_authorization_code(
    client: httpx.AsyncClient, code: str, redirect_uri: str,
) -> dict[str, Any]:
    """`POST /oauth2/token`, `grant_type=authorization_code`. Dropbox's OAuth
    token endpoint (unlike every other Dropbox endpoint) is FORM-encoded,
    not JSON — `data=` here, not `json=`/`content=`."""
    app_key, app_secret = _app_credentials()
    resp = await client.post(
        _OAUTH_TOKEN_URL,
        data={
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
            "client_id": app_key,
            "client_secret": app_secret,
        },
    )
    return _parse_oauth_response(resp)


async def _refresh_access_token(client: httpx.AsyncClient, refresh_token: str) -> dict[str, Any]:
    """`POST /oauth2/token`, `grant_type=refresh_token`. Per Dropbox's
    offline-access model this does NOT rotate/return a new refresh_token —
    the response has no `refresh_token` field for this grant type; callers
    keep using the SAME refresh_token they already hold. Never logs either
    token — only short, non-secret messages appear in raised exceptions."""
    app_key, app_secret = _app_credentials()
    resp = await client.post(
        _OAUTH_TOKEN_URL,
        data={
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
            "client_id": app_key,
            "client_secret": app_secret,
        },
    )
    return _parse_oauth_response(resp)


def _parse_oauth_response(resp: httpx.Response) -> dict[str, Any]:
    if resp.status_code != 200:
        body = _safe_json(resp) or {}
        detail = body.get("error_description") or body.get("error") or resp.status_code
        raise errors.NoteConnAuthError(
            f"Dropbox OAuth token request failed: {detail}", status=resp.status_code,
        )
    data = _safe_json(resp)
    if not isinstance(data, dict):
        raise errors.NoteConnTransient("Dropbox OAuth token response was not valid JSON")
    return data
