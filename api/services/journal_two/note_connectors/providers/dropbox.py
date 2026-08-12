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
  - `content_hash` on file metadata drives PER-FILE SKIP-DETECTION inside
    this provider (`_entries_to_refs`'s `_LAST_SEEN_HASHES` check — a file
    whose hash hasn't changed since this process last saw it is never
    re-emitted). `RemoteRef`/`RemoteNote.updated_at` carry `server_modified`
    instead — a REAL ISO-8601 timestamp — never `content_hash` (see
    `_change_timestamp`'s docstring for the fidelity/safety bug that choice
    fixes).

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
`RemoteRef.updated_at` carries Dropbox's `server_modified` (see
`_change_timestamp`) — a real ISO-8601 timestamp, but still NOT a real
Dropbox `list_folder` continuation cursor (Dropbox's own cursor is an opaque
token this provider never gets a channel to persist across the
fresh-instance-per-sync boundary).

Consequence: `list_changed(credentials, cursor=<some file's server_modified
timestamp>)` will almost always fail Dropbox's own cursor validation. This is
handled, not ignored: Dropbox's `409 {".tag": "reset"}` response is EXACTLY
the documented recovery signal for "this cursor isn't recognized," and
`list_changed` below catches it and falls back to a full recursive re-list
transparently. The net effect (today, until a future task threads a
provider-private cursor store through the source row) is that Dropbox syncs
here are always effectively FULL listings — correct, self-healing, just not
maximally efficient (mitigated by the `content_hash`-driven skip-detection in
`_entries_to_refs`, which keeps a full listing from re-emitting every
unchanged file). `list_folder/continue` is still implemented faithfully (not
stubbed out) so it activates for free the day a real cursor can flow through.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import posixpath
import re
from typing import Any
from urllib.parse import quote, unquote, urlencode, urlsplit

import httpx

from ...notes import _MAX_FILE_BYTES
from .. import errors
from ..convert import ATTACHMENT_REF_PREFIX, LINK_PREFIX, REF_PREFIX, html_to_tiptap, md_to_tiptap
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

# Internal-only prefixes marking a media/attachment ref this provider has
# already resolved to an absolute Dropbox `path_lower` (see
# `_resolve_one_relative_ref` / `fetch_media`) — distinguishing "download via
# the Dropbox content API" from a genuine external `https://` URL. Never
# leak outward; stripped in `fetch_media` before anything reaches Dropbox.
#
# TWO ENCODING DOMAINS, never mixed (review fix — a prior version relied on
# markdown-it-py's own `normalizeLink` to percent-encode an angle-bracket
# destination, then blindly `unquote()`'d it on the way back; that round-trip
# is NOT provably symmetric for a path containing a literal "%" — see
# `test_markdown_media_ref_round_trips_byte_exact_adversarial_names` /
# `test_html_media_ref_round_trips_byte_exact_adversarial_names` in the test
# file):
#   - MD-sourced refs (`_MD_*`): WE percent-encode the resolved path
#     ourselves (`quote(resolved, safe="/")`) before angle-bracket-wrapping
#     it in the rewritten markdown source. markdown-it-py's `normalizeLink`
#     is idempotent on an already-percent-encoded, already-ASCII-safe string
#     (verified empirically — it leaves ours byte-for-byte unchanged), so
#     `fetch_media` un-quotes EXACTLY ONCE to recover the original path.
#   - HTML-sourced refs (`_HTML_SCHEME`): NEVER percent-encoded by anything
#     in this pipeline (`html.parser` attribute values are literal text) and
#     therefore NEVER unquoted in `fetch_media` — doing so would corrupt a
#     real filename that happens to contain a literal "%" sequence.
#
# `_MD_ATTACH_SCHEME` exists only to tell `_promote_md_attachments` apart
# from a genuine `_MD_MEDIA_SCHEME` image after `md_to_tiptap` returns (see
# that function's docstring) — both decode identically (MD-sourced, unquote
# once).
_MD_MEDIA_SCHEME = "dbx-md-media:"
_MD_ATTACH_SCHEME = "dbx-md-attach:"
_MD_SCHEMES = (_MD_MEDIA_SCHEME, _MD_ATTACH_SCHEME)

_HTML_SCHEME = "dbx-html:"

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


def _change_timestamp(entry: dict[str, Any]) -> str:
    """`RemoteRef.updated_at` / `RemoteNote.updated_at` — a REAL ISO-8601
    timestamp (Dropbox's `server_modified`), matching `base.py`'s own
    contract ("ALWAYS an ISO-8601 UTC string").

    Review fix (fidelity + safety): an earlier version used `content_hash`
    (a 64-char hex digest, NOT ISO-parseable) here. Two problems: (1)
    fidelity — every synced note's displayed "last updated" read as "just
    synced" instead of the file's real modification time, because it was
    never a real date to begin with; (2) safety — `notes.py::_import_date`
    silently falls back to the CURRENT sync time (`now`) whenever the
    supplied `updatedAt` fails `datetime.fromisoformat`, which a content
    hash always does. `content_hash` is still used, separately, for
    per-file SKIP-detection (`_entries_to_refs`'s `_LAST_SEEN_HASHES` check)
    — it never flows into a field anything downstream tries to parse as a
    date. Falls back to an EMPTY STRING (never to content_hash) when
    `server_modified` is absent from a defensive/malformed entry shape —
    `_import_date`'s `not value` fast path treats `""` as "no value
    supplied" and uses ITS OWN fallback without ever attempting (and
    failing) to parse it. Real Dropbox `FileMetadata` always includes
    `server_modified`."""
    return entry.get("server_modified") or ""


# Per-process (NOT per-instance) content-hash memory: (tenant_key,
# folder_path) -> {path_lower: content_hash}. A fresh `DropboxProvider` is
# constructed every sync (`_default_provider_factory`), so per-file
# skip-detection ("has this file's CONTENT actually changed since we last
# looked") needs somewhere to live that survives that boundary.
#
# ⚠️ MUST be keyed by MORE than `folder_path` alone — review fix (round 2).
# This is a SAME-PROCESS, PRESENT-DAY CROSS-TENANT HAZARD, not a future
# scale-out risk and not "astronomically unlikely": Dropbox's `content_hash`
# is CONTENT-ADDRESSED (identical bytes produce the identical hash in ANY
# account — it carries no account/tenant information at all), and the web
# pod is ONE process serving EVERY user's sync through `sync_due_sources()`.
# If two different users each connect a Dropbox folder with the same
# `folder_path` string (plausible in a trading-journal product — a shared
# firm template, shared course notes) and both hold a byte-identical file at
# the same `path_lower`, a `folder_path`-only key would let user A's sync
# "poison" user B's entry: B's file silently never gets emitted on B's own
# FIRST sync, with no error and nothing to grep for.
#
# This is also NOT analogous to `engine.py`'s module-level `_locks` dict
# (an earlier version of this comment made that comparison, and it doesn't
# hold): `_locks` is a CONCURRENCY GUARD whose failure mode is contention
# (two syncs of the same source briefly serialize instead of running in
# parallel — self-correcting, no data loss). `_LAST_SEEN_HASHES` is a DATA
# CACHE whose failure mode is a SILENT WRONG SKIP across tenants — a
# correctness bug, not a performance one.
#
# Fix: every entry is keyed by `(tenant_key, folder_path)`, where
# `tenant_key` is derived from the connector's `refreshToken` (see
# `_tenant_key`) — a value already in scope at the `list_changed` call site,
# stable for the life of one OAuth connection, and unique per Dropbox
# account. Two different accounts can never collide, regardless of what
# folder_path or file content they happen to share.
#
# Lost on process restart — worst case is simply re-emitting every unchanged
# file once, which `import_confirm`'s own hash-basis (fed by
# `server_modified`, independent of this cache) still correctly no-ops on
# the DB side.
_LAST_SEEN_HASHES: dict[tuple[str, str], dict[str, str]] = {}


def _tenant_key(credentials: dict[str, Any]) -> str:
    """A stable, per-CONNECTION disambiguator for `_LAST_SEEN_HASHES` (see
    that dict's docstring for the cross-tenant hazard this closes) —
    derived from `refreshToken`: the one value that's both already in scope
    at every `list_changed` call site AND stays constant for the life of
    one OAuth connection (Dropbox's offline-access model never rotates it).
    Deliberately NOT derived from `accessToken`, which DOES rotate on every
    refresh — keying on that would fragment one tenant's own cache on every
    token refresh instead of fixing the cross-tenant problem. Falls back to
    `accessToken` only when `refreshToken` is somehow absent (defensive;
    every real offline-access connection has one) — a safe degradation
    (that tenant's own skip-detection resets more often; never a
    cross-tenant leak, since the fallback key is still per-credentials-dict,
    never shared across accounts). Hashed + truncated only to keep dict
    keys short and to never retain a raw token in memory any longer than
    the call that derives this."""
    material = credentials.get("refreshToken") or credentials.get("accessToken") or ""
    return hashlib.sha256(material.encode("utf-8")).hexdigest()[:16]


def _title_from_path(path_lower: str, entry: dict[str, Any] | None) -> str:
    name = (entry or {}).get("name")
    base = name or posixpath.basename(path_lower)
    stem = posixpath.splitext(base)[0]
    return stem or base


def _basename_of_ref(ref: str) -> str:
    """Basename for a media/attachment `ref` string — decodes MD-family
    percent-encoding first (a no-op for HTML-family refs, which were never
    encoded to begin with; see the module docstring's "TWO ENCODING
    DOMAINS" note)."""
    path = ref
    for scheme in _MD_SCHEMES:
        if ref.startswith(scheme):
            path = unquote(ref[len(scheme):])
            break
    else:
        if ref.startswith(_HTML_SCHEME):
            path = ref[len(_HTML_SCHEME):]
    clean = path.split("#", 1)[0].split("?", 1)[0]
    tail = clean.rsplit("/", 1)[-1]
    return tail or clean


_MD_IMAGE_RE = re.compile(r"(!\[[^\]]*\]\()\s*([^)\s]+)((?:\s+\"[^\"]*\")?\s*\))")
# Same shape as `_MD_IMAGE_RE` but for plain `[text](url)` LINKS (negative
# lookbehind excludes image syntax) — captures link text separately (group 1)
# so a resolved attachment can be re-emitted as `![text](...)` (see
# `_resolve_relative_attachments_markdown`).
_MD_LINK_RE = re.compile(r"(?<!\!)\[([^\]]*)\]\(\s*([^)\s]+)((?:\s+\"[^\"]*\")?\s*\))")
_HTML_IMG_SRC_RE = re.compile(r'(<img\b[^>]*?\bsrc\s*=\s*)(["\'])(.*?)\2', re.IGNORECASE | re.DOTALL)
_HTML_A_HREF_RE = re.compile(r'(<a\b[^>]*?\bhref\s*=\s*)(["\'])(.*?)\2', re.IGNORECASE | re.DOTALL)


def _looks_like_local_path(url: str) -> bool:
    """True for a reference this provider should attempt to resolve against
    the synced folder tree — i.e. NOT an absolute URL, a `data:` URI, or
    something already carrying one of mddoc's own placeholder prefixes."""
    if not url:
        return False
    if url.startswith((REF_PREFIX, LINK_PREFIX, "data:") + _MD_SCHEMES + (_HTML_SCHEME,)):
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

    def _entries_to_refs(
        self, entries: list[dict[str, Any]], folder_path: str, credentials: dict[str, Any],
    ) -> list[RemoteRef]:
        """Maps `entries` -> `RemoteRef`s, skip-detecting via `content_hash`
        against `_LAST_SEEN_HASHES` (module-level, see its own docstring) —
        a file whose hash matches what THIS PROCESS last saw for it, FOR
        THIS SAME DROPBOX ACCOUNT (`_tenant_key(credentials)`), is NOT
        re-emitted, even on a full listing (Dropbox's own delta API already
        skips unchanged files on a true incremental `continue`; this closes
        the same gap for the FULL-listing path, which is this provider's
        common case per the module docstring's cursor-representation note).
        The `(tenant_key, folder_path)` compound key is what keeps two
        different accounts sharing a folder_path + a byte-identical file
        from cross-contaminating each other's skip-detection (see
        `_LAST_SEEN_HASHES`'s docstring)."""
        cache_key = (_tenant_key(credentials), folder_path)
        seen = _LAST_SEEN_HASHES.setdefault(cache_key, {})
        refs: list[RemoteRef] = []
        for entry in entries:
            if entry.get(".tag") != "file":
                continue  # folders + deleted entries never become notes directly
            path_lower = entry.get("path_lower")
            if not path_lower or _extension(path_lower) not in _NOTE_EXTENSIONS:
                continue  # media/other attachments are resolved by reference, not enumerated
            content_hash = entry.get("content_hash") or ""
            if content_hash and seen.get(path_lower) == content_hash:
                continue  # unchanged since this process last saw it -- skip
            if content_hash:
                seen[path_lower] = content_hash
            refs.append(RemoteRef(remote_id=path_lower, updated_at=_change_timestamp(entry)))
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
        return self._entries_to_refs(entries, folder_path, credentials)

    def _resolve_one_relative_ref(self, url: str, file_dir: str) -> str | None:
        """Pure lookup — `url` must already be decoded/normalized by the
        CALLER (deliberately: MD sources conventionally percent-encode
        special characters in a relative destination, HTML attribute values
        never are — see each caller's own comment). Never decodes internally,
        so this one function can't accidentally apply the wrong rule."""
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
            # CommonMark bare/percent-encoded convention: a markdown author
            # (or exporter) referencing a local path containing a space MUST
            # percent-encode it in a BARE `(url)` destination (angle-bracket
            # `<...>` with a raw space is the alternative CommonMark allows,
            # but is NOT handled by this regex — a documented, bounded
            # limitation; such a reference degrades to an untouched, inert
            # link rather than crashing). Decode before resolving so either
            # convention's ENCODED form still matches the real (never
            # encoded) Dropbox `path_lower`.
            resolved = self._resolve_one_relative_ref(unquote(m.group(2)), file_dir)
            if resolved is None:
                return m.group(0)
            # WE percent-encode (never markdown-it-py) — see the module
            # docstring's "TWO ENCODING DOMAINS" note. Angle-bracket form is
            # kept for robustness/clarity even though a fully-encoded
            # destination no longer strictly needs it.
            encoded = quote(resolved, safe="/")
            return f"{m.group(1)}<{_MD_MEDIA_SCHEME}{encoded}>{m.group(3)}"

        return _MD_IMAGE_RE.sub(repl, text)

    def _resolve_relative_attachments_markdown(self, text: str, path_lower: str) -> str:
        """Rewrites `[text](relpath)` links (NOT image syntax) that resolve
        to a co-located FILE with a non-note extension into synthetic
        markdown IMAGE syntax carrying `_MD_ATTACH_SCHEME` — reusing
        `md_to_tiptap`'s own image block-hoisting + media-registration
        machinery for free (mirrors the wizard's `generic.js:265-292`
        resolveRelativeMedia precedent, which does the equivalent DOM-
        attribute rewrite once ProseMirror's schema-guided HTML parser is
        available to do the block-hoisting itself; we have no such parser
        here for markdown, hence the borrow-image-hoisting trick).
        `fetch()` POST-PROCESSES the returned doc via
        `_promote_md_attachments`, converting each resulting `image` node
        whose src carries `_MD_ATTACH_SCHEME` into a real `attachmentChip`
        node (block-level atom, per the installed AttachmentChip TipTap
        node) and fixing its media `kind` to `'file'`.

        A relative link to another IMPORTABLE note extension (.md/.txt/
        .html) is left as an ordinary, untouched relative link -- cross-note
        linking is FUTURE connector work (mirrors generic.js's own
        `SUPPORTED_EXT` check), not wired here."""
        file_dir = posixpath.dirname(path_lower)

        def repl(m: "re.Match[str]") -> str:
            link_text = m.group(1)
            resolved = self._resolve_one_relative_ref(unquote(m.group(2)), file_dir)
            if resolved is None:
                return m.group(0)
            if _extension(resolved) in _NOTE_EXTENSIONS:
                return m.group(0)  # inert relative anchor -- cross-note linking is future work
            encoded = quote(resolved, safe="/")
            return f"![{link_text}](<{_MD_ATTACH_SCHEME}{encoded}>{m.group(3)}"

        return _MD_LINK_RE.sub(repl, text)

    def _promote_md_attachments(self, converted: dict[str, Any]) -> dict[str, Any]:
        """Second half of the markdown-attachment trick (see
        `_resolve_relative_attachments_markdown`): walks the doc
        `md_to_tiptap` already produced (with normal image-hoisting/
        media-registration already applied by mddoc.py) and converts every
        `image` node whose `src` carries `_MD_ATTACH_SCHEME` into a real
        `attachmentChip` node, and every matching `media` entry's `kind`
        from `'image'` (what `md_to_tiptap`'s generic image path always
        registers) to `'file'`. Never mutates `converted`."""
        marker = f"{REF_PREFIX}{_MD_ATTACH_SCHEME}"

        def walk(node: Any) -> Any:
            if not isinstance(node, dict):
                return node
            if node.get("type") == "image":
                src = (node.get("attrs") or {}).get("src", "")
                if src.startswith(marker):
                    ref = src[len(REF_PREFIX):]
                    name = _basename_of_ref(ref)
                    return {"type": "attachmentChip", "attrs": {"href": src, "name": name}}
                return node
            if isinstance(node.get("content"), list):
                new_node = dict(node)
                new_node["content"] = [walk(c) for c in node["content"]]
                return new_node
            return node

        doc = walk(converted["doc"])
        media = [
            {**m, "kind": "file"} if m.get("ref", "").startswith(_MD_ATTACH_SCHEME) else m
            for m in converted["media"]
        ]
        return {"doc": doc, "media": media, "links": converted["links"]}

    def _resolve_relative_media_html(self, text: str, path_lower: str) -> str:
        file_dir = posixpath.dirname(path_lower)

        def repl(m: "re.Match[str]") -> str:
            # HTML attribute values are literal -- NEVER decoded (see the
            # module docstring's "TWO ENCODING DOMAINS" note).
            resolved = self._resolve_one_relative_ref(m.group(3), file_dir)
            if resolved is None:
                return m.group(0)
            return f"{m.group(1)}{m.group(2)}{_HTML_SCHEME}{resolved}{m.group(2)}"

        return _HTML_IMG_SRC_RE.sub(repl, text)

    def _resolve_relative_attachments_html(self, text: str, path_lower: str) -> str:
        """`<a href="relpath">` -> `<a href="{ATTACHMENT_REF_PREFIX}
        {_HTML_SCHEME}{resolved}">` for a co-located FILE with a non-note
        extension. `mddoc.py`'s HTML walker recognizes
        `ATTACHMENT_REF_PREFIX` generically (the same "connector already
        resolved this" convention `REF_PREFIX` uses for images) and emits a
        real `attachmentChip` node directly -- no post-processing needed on
        the HTML side, unlike markdown's image-syntax trick. A relative link
        to another importable note extension is left untouched (future
        cross-note-linking work, same as the markdown path)."""
        file_dir = posixpath.dirname(path_lower)

        def repl(m: "re.Match[str]") -> str:
            prefix, q, url = m.group(1), m.group(2), m.group(3)
            resolved = self._resolve_one_relative_ref(url, file_dir)
            if resolved is None:
                return m.group(0)
            if _extension(resolved) in _NOTE_EXTENSIONS:
                return m.group(0)
            return f"{prefix}{q}{ATTACHMENT_REF_PREFIX}{_HTML_SCHEME}{resolved}{q}"

        return _HTML_A_HREF_RE.sub(repl, text)

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
        """STREAMS the download (never `_send`'s buffer-the-whole-body
        `client.post`), enforcing `_MAX_FILE_BYTES` (imported from
        `notes.py` — the SAME 25MB cap `save_note_attachment_bytes` enforces,
        never retyped) as early as possible: first via the `Content-Length`
        response header when Dropbox supplies one (rejects before reading
        any body bytes at all), and unconditionally via a running total
        while streaming (the guaranteed backstop regardless of whether
        Content-Length was present/honest). An over-cap file raises
        `NoteConnUnsupported` — caught by the engine's existing per-item
        try/except (`_upload_media_for_note`) as ONE named media failure,
        never a crash of the whole note or sync. Still honors one 401
        refresh-and-retry and the bounded 429 ladder, same as `_send`."""
        async with self._download_semaphore:
            return await self._download_streamed(credentials, path_lower)

    async def _download_streamed(self, credentials: dict[str, Any], path_lower: str) -> bytes:
        client = await self._get_client()
        url = f"{_CONTENT_BASE}/files/download"
        refreshed_once = False
        attempt = 0
        while True:
            token = self._effective_access_token(credentials)
            headers = {
                "Authorization": f"Bearer {token}",
                "Dropbox-API-Arg": json.dumps({"path": path_lower}, ensure_ascii=True),
            }
            try:
                async with client.stream("POST", url, headers=headers, content=b"") as response:
                    if response.status_code != 200:
                        await response.aread()  # populate .content/.json() for error inspection
                        if response.status_code == 401 and not refreshed_once:
                            refreshed_once = True
                            new_token = await self._try_refresh(credentials)
                            if new_token is not None:
                                self._access_token_override = new_token
                                continue
                            _raise_generic_error(response)
                        if response.status_code == 429 and attempt < _RATE_LIMIT_MAX_RETRIES:
                            await self._sleep(_retry_after_seconds(response))
                            attempt += 1
                            continue
                        _raise_generic_error(response)

                    content_length = response.headers.get("content-length")
                    if content_length is not None:
                        try:
                            over_cap = int(content_length) > _MAX_FILE_BYTES
                        except ValueError:
                            over_cap = False
                        if over_cap:
                            raise errors.NoteConnUnsupported(
                                f"Dropbox file exceeds the {_MAX_FILE_BYTES}-byte import "
                                f"cap (reported size {content_length} bytes)",
                                reason="File is larger than the 25 MB import limit",
                            )

                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > _MAX_FILE_BYTES:
                            raise errors.NoteConnUnsupported(
                                f"Dropbox file exceeds the {_MAX_FILE_BYTES}-byte import "
                                "cap (exceeded while streaming)",
                                reason="File is larger than the 25 MB import limit",
                            )
                        chunks.append(chunk)
                    return b"".join(chunks)
            except httpx.RequestError as exc:
                raise errors.NoteConnTransient(f"Dropbox download request failed: {exc}") from exc

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
            text = self._resolve_relative_attachments_html(text, path_lower)
            converted = html_to_tiptap(text)
        elif ext == ".md":
            text = self._resolve_relative_media_markdown(text, path_lower)
            text = self._resolve_relative_attachments_markdown(text, path_lower)
            converted = md_to_tiptap(text)
            converted = self._promote_md_attachments(converted)
        else:  # .txt
            converted = _txt_to_tiptap(text)

        updated_at = _change_timestamp(entry) if entry else ref.updated_at
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
            updated_at=updated_at,
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
        # MD-sourced (unquote EXACTLY ONCE — reverses OUR OWN `quote()` call
        # in the resolver, never markdown-it-py's; see the module docstring's
        # "TWO ENCODING DOMAINS" note) vs HTML-sourced (NEVER unquoted —
        # HTML attribute values are literal) — two disjoint scheme families,
        # checked separately so neither branch can accidentally apply the
        # other's decode rule.
        for scheme in _MD_SCHEMES:
            if ref.startswith(scheme):
                path_lower = unquote(ref[len(scheme):])
                content = await self._download(credentials, path_lower)
                return content, _guess_content_type(path_lower)
        if ref.startswith(_HTML_SCHEME):
            path_lower = ref[len(_HTML_SCHEME):]
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
