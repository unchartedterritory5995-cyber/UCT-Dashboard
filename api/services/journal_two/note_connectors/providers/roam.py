"""Roam Research provider — the first LIVE connector (spec §7).

Roam's "Backend API" is three POST endpoints under one graph-scoped base URL,
Bearer-token authenticated:

    POST https://api.roamresearch.com/api/graph/{GRAPH}/q           (datalog query)
    POST https://api.roamresearch.com/api/graph/{GRAPH}/pull         (single-entity pull)
    POST https://api.roamresearch.com/api/graph/{GRAPH}/pull-many    (batch pull)

Provider-specific behaviors this file exists to get right (each has a
dedicated test):

  1. **308 redirect re-auth, HOST-VALIDATED.** Roam's backend fronts multiple
     "peer" hosts and can 308 a request to a peer-specific URL. An httpx
     client with `follow_redirects=True` would re-issue the redirected
     request WITHOUT the `Authorization` header (cross-origin redirect — the
     standard/safe fetch behavior almost every HTTP client defaults to),
     silently turning every redirected call into an unauthenticated 401. We
     build our client with `follow_redirects=False` and manually re-send the
     SAME method/body to the `Location` URL, WITH `Authorization` reattached
     (`_send_with_redirect`) — but ONLY after checking the redirect target is
     `https://api.roamresearch.com` or an `*.api.roamresearch.com` subdomain
     (`_is_allowed_redirect_target`). A redirect anywhere else is refused
     BEFORE the second request is ever sent — otherwise a compromised or
     misbehaving server could 308 us into leaking the Bearer token to an
     arbitrary host.
  2. **503 cold-start retry ladder.** An idle graph "wakes" on first access
     and can 503 for a few seconds. Retry ladder: 3 retries, waiting
     2s/5s/10s between attempts (`_COLD_START_RETRY_DELAYS`), sleep injectable
     via `sleep_fn` so tests run instantly.
  3. **Encrypted graphs.** A graph token can be valid while the graph itself
     is end-to-end encrypted — Roam simply cannot serve US a readable
     response for it. There is no dedicated "encrypted" status code in the
     public API surface; the read just fails. We treat any non-success
     response whose body mentions "encrypt" as that signal and raise
     `NoteConnUnsupported` with a clear, user-facing reason; every OTHER
     non-success status is a plain `NoteConnTransient`.
  4. **The taxonomy contract holds even when the network itself misbehaves.**
     A raw httpx transport exception (timeout, connection refused, …) or an
     unparseable JSON body would otherwise escape as a bare `httpx`/`json`
     exception, breaking the "providers raise ONLY the errors taxonomy"
     contract every caller relies on. Both are wrapped at their ONE
     chokepoint each — `_send_with_redirect` for transport errors, `_call`
     for the JSON parse — into `NoteConnTransient`, never per-call-site.
  5. **`fetch()`/`fetch_many()` need `list_changed()` to have run first.**
     The full-graph `title->uid` map that resolves `[[Page Link]]`s is built
     by `list_changed()` (see `self._title_to_uid`). Calling `fetch()` cold,
     on a provider instance that never enumerated, wouldn't crash — it would
     silently resolve every link as unresolved plain text. `self._enumerated`
     turns that into a loud `RuntimeError` instead of a quiet content bug.

Everything else (enumeration, page-tree pull, wiki-syntax conversion) is
built on top of those primitives.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

import httpx

from ..convert import md_to_tiptap
from ..convert.roam_text import convert_roam_markdown, fix_empty_task_items
from ..errors import (
    NoteConnAuthError,
    NoteConnTransient,
    NoteConnUnsupported,
)
from .base import AccountInfo, NoteProvider, RemoteNote, RemoteRef, guarded_media_get

_API_BASE = "https://api.roamresearch.com/api/graph"

# Only a redirect back onto Roam's own domain is ever followed — see module
# docstring point 1.
_ALLOWED_REDIRECT_HOST = "api.roamresearch.com"

# 3 retries, waiting this long BEFORE each one (i.e. up to 4 total attempts:
# the original + 3 retries), per spec §7's "retry ladder (3 attempts,
# 2s/5s/10s)".
_COLD_START_RETRY_DELAYS: tuple[float, ...] = (2.0, 5.0, 10.0)

# pull-many is chunked so a huge graph never builds one unbounded EDN vector.
_PULL_MANY_BATCH = 40

# A lightweight query used only to confirm the token+graph pair can read at
# all (distinct from the full enumeration below) — an aggregate count, never
# pulling actual page data.
_VALIDATE_QUERY = "[:find (count ?e) . :where [?e :node/title]]"

# The exact enumeration query from the research write-up: every page's uid,
# title, and last-edit time (epoch millis).
_ENUMERATE_QUERY = (
    "[:find ?uid ?title ?time :where "
    "[?e :node/title ?title] [?e :block/uid ?uid] [?e :edit/time ?time]]"
)

# Recursive pull selector: every field on a block plus its children,
# recursively, so one call resolves an entire page tree.
_PULL_SELECTOR = (
    "[:block/uid :node/title :block/string :block/order "
    ":block/heading {:block/children ...}]"
)

_MONTHS = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
# Roam's daily-note page title format, e.g. "August 12th, 2026".
_DAILY_NOTE_RE = re.compile(
    r"^(?:" + "|".join(_MONTHS) + r") \d{1,2}(?:st|nd|rd|th), \d{4}$"
)


def _epoch_ms_to_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).isoformat()


def _is_daily_note_title(title: str | None) -> bool:
    return bool(title) and bool(_DAILY_NOTE_RE.match(title))


def _is_allowed_redirect_target(url: httpx.URL) -> bool:
    """https-only; host must be exactly `api.roamresearch.com` or a
    subdomain of it (`peer-3.api.roamresearch.com`, etc.) — see module
    docstring point 1. A relative Location (no host at all) is rejected by
    the same `host == ""` falling through to `False`."""
    if url.scheme != "https":
        return False
    host = url.host or ""
    return host == _ALLOWED_REDIRECT_HOST or host.endswith(f".{_ALLOWED_REDIRECT_HOST}")


def _edn_escape_uid(uid: str) -> str:
    """A Roam uid should never legitimately contain a `"`, but if one ever
    did, an unescaped quote would break out of the EDN string literal inside
    the `eids` vector handed to `pull-many` — escape defensively."""
    return uid.replace('"', '\\"')


def _children_to_lines(children: list[dict[str, Any]], indent: int) -> list[str]:
    """Block tree -> markdown lines: children indented 2 spaces per level as
    nested bullets; a heading block (`:block/heading` 1-3) becomes a
    `#`-prefixed line instead of a bullet. Each block's RAW `:block/string`
    is embedded untouched — `convert_roam_markdown` rewrites Roam syntax
    afterward, over the WHOLE assembled string."""
    lines: list[str] = []
    ordered = sorted(children or [], key=lambda c: c.get(":block/order", 0) or 0)
    pad = "  " * indent
    for child in ordered:
        raw = child.get(":block/string") or ""
        heading = child.get(":block/heading") or 0
        if heading and 1 <= heading <= 3:
            lines.append(f"{pad}{'#' * heading} {raw}")
        else:
            lines.append(f"{pad}- {raw}")
        grandchildren = child.get(":block/children") or []
        if grandchildren:
            lines.extend(_children_to_lines(grandchildren, indent + 1))
    return lines


def _collect_uid_to_string(entity: dict[str, Any]) -> dict[str, str]:
    """uid -> block string, over the ENTIRE pulled tree (the page's own root
    plus every descendant) — the map `((block-ref))` resolution draws from.
    Scoped to one page's pull; never merged across pages."""
    out: dict[str, str] = {}

    def walk(node: dict[str, Any]) -> None:
        uid = node.get(":block/uid")
        if uid:
            out[uid] = node.get(":block/string") or ""
        for child in node.get(":block/children") or []:
            walk(child)

    walk(entity)
    return out


class RoamProvider(NoteProvider):
    name = "roam"

    def __init__(
        self,
        *,
        client: httpx.AsyncClient | None = None,
        sleep_fn: Callable[[float], Awaitable[None]] | None = None,
    ) -> None:
        # Tests inject a `client` built on `httpx.MockTransport` (no live
        # calls) and a `sleep_fn` that returns instantly instead of actually
        # sleeping through the cold-start ladder.
        self._client = client
        self._owns_client = client is None
        self._sleep = sleep_fn if sleep_fn is not None else asyncio.sleep
        # Title -> uid, from the MOST RECENT full enumeration
        # (`list_changed`). INSTANCE state, not a module global — its
        # lifetime is exactly one `RoamProvider` object, which the sync
        # engine constructs fresh per sync (Task 8). `fetch()` reads it but
        # never mutates it, and every roam_text call it feeds still takes
        # the map as an explicit parameter — nothing inside roam_text.py
        # ever reaches back into `self`.
        self._title_to_uid: dict[str, str] = {}
        # Flips True at the end of `list_changed()` — see module docstring
        # point 5. `fetch()`/`fetch_many()` refuse to run before this is
        # True rather than silently resolving every [[link]] as unresolved.
        self._enumerated: bool = False

    async def aclose(self) -> None:
        if self._owns_client and self._client is not None:
            await self._client.aclose()
            self._client = None

    # ── credentials ──────────────────────────────────────────────────────

    @staticmethod
    def _creds(credentials: dict[str, Any]) -> tuple[str, str]:
        graph = credentials.get("graphName")
        token = credentials.get("graphToken")
        if not graph or not token:
            raise NoteConnAuthError("Roam credentials missing graphName/graphToken")
        return graph, token

    # ── transport ────────────────────────────────────────────────────────

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            # follow_redirects=False is LOAD-BEARING — see module docstring
            # point 1. Never flip this without also removing the manual
            # `_send_with_redirect` re-auth below.
            self._client = httpx.AsyncClient(follow_redirects=False, timeout=30.0)
        return self._client

    async def _send_with_redirect(
        self, client: httpx.AsyncClient, url: str, headers: dict[str, str],
        body: dict[str, Any], max_hops: int = 3,
    ) -> httpx.Response:
        """POSTs `body` to `url`; on a 307/308 with a `Location` pointing
        back at Roam's own domain, manually re-sends the SAME body + headers
        (Authorization included) to that URL rather than relying on httpx's
        redirect-follow (which would drop Authorization on the cross-host
        hop). A redirect Location OUTSIDE `api.roamresearch.com`/
        `*.api.roamresearch.com` is refused — the second request (carrying
        the Bearer token) is never sent — raising `NoteConnTransient`
        instead. Bounded to `max_hops` so a misbehaving peer chain can never
        loop forever. Also the SOLE chokepoint that wraps raw httpx
        transport exceptions (timeout, connection refused, …) into the
        errors taxonomy — see module docstring point 4."""
        current_url = url
        response: httpx.Response | None = None
        for _ in range(max_hops):
            try:
                response = await client.post(current_url, headers=headers, json=body)
            except httpx.RequestError as exc:
                raise NoteConnTransient(f"Roam request failed: {exc}") from exc
            if response.status_code in (307, 308) and "location" in response.headers:
                location = response.headers["location"]
                target = httpx.URL(location)
                if not _is_allowed_redirect_target(target):
                    raise NoteConnTransient(
                        f"Roam redirected to an unexpected host ({target.host!r}) "
                        "— refusing to forward credentials there",
                    )
                current_url = location
                continue
            return response
        assert response is not None  # max_hops >= 1 guarantees at least one send
        return response

    async def _call(self, graph: str, token: str, path: str, body: dict[str, Any]) -> Any:
        client = await self._get_client()
        url = f"{_API_BASE}/{graph}/{path}"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        attempt = 0
        while True:
            response = await self._send_with_redirect(client, url, headers, body)
            if response.status_code == 200:
                try:
                    return response.json()
                except json.JSONDecodeError as exc:
                    snippet = (response.text or "")[:200]
                    raise NoteConnTransient(
                        f"Roam returned invalid JSON: {exc}. Body snippet: {snippet!r}",
                    ) from exc
            if response.status_code in (401, 403):
                raise NoteConnAuthError(
                    f"Roam rejected the graph token ({response.status_code})",
                    status=response.status_code,
                )
            if response.status_code == 503:
                if attempt < len(_COLD_START_RETRY_DELAYS):
                    await self._sleep(_COLD_START_RETRY_DELAYS[attempt])
                    attempt += 1
                    continue
                raise NoteConnTransient(
                    "Roam graph is cold-starting (503) — retries exhausted",
                    status=503,
                )
            body_text = (response.text or "").lower()
            if "encrypt" in body_text:
                # `reason` deliberately left to default to `message` (see
                # `errors.NoteConnUnsupported`) — that field is surfaced
                # verbatim in the UI, so it must be the same clear sentence,
                # not an internal code.
                raise NoteConnUnsupported(
                    "This Roam graph is encrypted and cannot be read with a "
                    "graph token. Disable graph encryption (or use an "
                    "unencrypted graph) to connect it.",
                    status=response.status_code,
                )
            raise NoteConnTransient(
                f"Roam API error {response.status_code}", status=response.status_code,
            )

    async def _enumerate(self, graph: str, token: str) -> list[tuple[str, str, int]]:
        data = await self._call(graph, token, "q", {"query": _ENUMERATE_QUERY, "args": []})
        rows = data.get("result") or []
        return [(row[0], row[1], row[2]) for row in rows]

    async def _pull_many(
        self, graph: str, token: str, uids: list[str],
    ) -> dict[str, dict[str, Any]]:
        out: dict[str, dict[str, Any]] = {}
        for start in range(0, len(uids), _PULL_MANY_BATCH):
            chunk = uids[start:start + _PULL_MANY_BATCH]
            eids = "[" + " ".join(
                f'[:block/uid "{_edn_escape_uid(uid)}"]' for uid in chunk
            ) + "]"
            data = await self._call(
                graph, token, "pull-many", {"eids": eids, "selector": _PULL_SELECTOR},
            )
            result = data.get("result") or {}
            for uid in chunk:
                entity = result.get(f'[:block/uid "{_edn_escape_uid(uid)}"]')
                if entity is not None:
                    out[uid] = entity
        return out

    # ── NoteProvider contract ───────────────────────────────────────────

    async def validate(self, credentials: dict[str, Any]) -> AccountInfo:
        graph, token = self._creds(credentials)
        data = await self._call(graph, token, "q", {"query": _VALIDATE_QUERY, "args": []})
        return AccountInfo(label=graph, raw={"page_count": data.get("result")})

    async def list_changed(
        self, credentials: dict[str, Any], cursor: str | None = None,
    ) -> list[RemoteRef]:
        graph, token = self._creds(credentials)
        rows = await self._enumerate(graph, token)
        # Full-graph title->uid map, rebuilt on EVERY call (incremental sync
        # re-enumerates everything too — Roam has no true delta API, spec
        # §7) so a [[link]] to an unchanged page still resolves during the
        # `fetch()` calls that follow this one on the same instance.
        self._title_to_uid = {title: uid for uid, title, _time in rows}
        self._enumerated = True
        refs: list[RemoteRef] = []
        for uid, _title, time_ms in rows:
            updated_at = _epoch_ms_to_iso(time_ms)
            if cursor is not None and updated_at <= cursor:
                continue
            refs.append(RemoteRef(remote_id=uid, updated_at=updated_at))
        refs.sort(key=lambda r: r.updated_at)
        return refs

    def _require_enumerated(self) -> None:
        if not self._enumerated:
            raise RuntimeError(
                "call list_changed() before fetch() — the link-resolution "
                "map is built there",
            )

    def _entity_to_remote_note(
        self, ref: RemoteRef, entity: dict[str, Any], graph: str,
    ) -> RemoteNote:
        title = entity.get(":node/title") or ref.remote_id
        uid_to_string = _collect_uid_to_string(entity)
        raw_lines = _children_to_lines(entity.get(":block/children") or [], indent=0)
        final_md = convert_roam_markdown(
            "\n".join(raw_lines),
            graph=graph,
            title_to_uid=self._title_to_uid,
            uid_to_string=uid_to_string,
        )
        converted = md_to_tiptap(final_md)
        # Repairs a bare {{[[TODO]]}}/{{[[DONE]]}} block (no other text),
        # which md_to_tiptap alone can't recognize as a task item — see
        # roam_text.fix_empty_task_items's docstring.
        doc = fix_empty_task_items(converted["doc"])
        folder_path = ["Daily Notes"] if _is_daily_note_title(title) else []
        return RemoteNote(
            remote_id=ref.remote_id,
            title=title,
            doc=doc,
            media=converted["media"],
            links=converted["links"],
            tags=[],
            folder_path=folder_path,
            created_at=None,
            updated_at=ref.updated_at,
        )

    async def fetch(self, credentials: dict[str, Any], ref: RemoteRef) -> RemoteNote:
        self._require_enumerated()
        graph, token = self._creds(credentials)
        pulled = await self._pull_many(graph, token, [ref.remote_id])
        entity = pulled.get(ref.remote_id)
        if entity is None:
            raise NoteConnTransient(
                f"Roam pull-many returned no data for uid {ref.remote_id!r}",
            )
        return self._entity_to_remote_note(ref, entity, graph)

    async def fetch_many(
        self, credentials: dict[str, Any], refs: list[RemoteRef],
    ) -> list[RemoteNote]:
        """True batch resolution via `pull-many` (≤40 eids/call — see
        `_pull_many`), overriding the base class's per-ref loop. The engine
        (Task 8) prefers this over repeated `fetch()` calls when a provider
        supplies it."""
        self._require_enumerated()
        if not refs:
            return []
        graph, token = self._creds(credentials)
        pulled = await self._pull_many(graph, token, [ref.remote_id for ref in refs])
        notes: list[RemoteNote] = []
        for ref in refs:
            entity = pulled.get(ref.remote_id)
            if entity is None:
                raise NoteConnTransient(
                    f"Roam pull-many returned no data for uid {ref.remote_id!r}",
                )
            notes.append(self._entity_to_remote_note(ref, entity, graph))
        return notes

    async def fetch_media(self, credentials: dict[str, Any], ref: str) -> tuple[bytes, str]:
        # Firebase Storage URLs are pre-signed/public — no Roam Authorization
        # header needed, and (unlike the graph-data endpoints) a redirect-
        # following GET is fine credential-wise (there's no auth header to
        # lose on the hop). BUT `ref` is an image src taken verbatim from
        # graph CONTENT, not a Roam-vouched URL — final-review Item D:
        # `guarded_media_get` enforces https + a public-IP host on the
        # initial URL AND every redirect hop before issuing that hop's
        # request (plain `follow_redirects=True` would happily follow a
        # public-looking URL straight to a private/internal address).
        client = await self._get_client()
        response = await guarded_media_get(client, ref, what="Roam media")
        if response.status_code >= 400:
            raise NoteConnTransient(
                f"Failed to download Roam media ({response.status_code})",
                status=response.status_code,
            )
        content_type = response.headers.get("content-type", "application/octet-stream")
        return response.content, content_type
