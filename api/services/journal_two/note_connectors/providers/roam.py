"""Roam Research provider — the first LIVE connector (spec §7).

Roam's "Backend API" is three POST endpoints under one graph-scoped base URL,
Bearer-token authenticated:

    POST https://api.roamresearch.com/api/graph/{GRAPH}/q           (datalog query)
    POST https://api.roamresearch.com/api/graph/{GRAPH}/pull         (single-entity pull)
    POST https://api.roamresearch.com/api/graph/{GRAPH}/pull-many    (batch pull)

Three provider-specific behaviors this file exists to get right (each has a
dedicated test):

  1. **308 redirect re-auth.** Roam's backend fronts multiple "peer" hosts and
     can 308 a request to a peer-specific URL. An httpx client with
     `follow_redirects=True` would re-issue the redirected request WITHOUT the
     `Authorization` header (cross-origin redirect — the standard/safe fetch
     behavior almost every HTTP client defaults to), silently turning every
     redirected call into an unauthenticated 401. We build our client with
     `follow_redirects=False` and manually re-send the SAME method/body to the
     `Location` URL, WITH `Authorization` reattached (`_send_with_redirect`).
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

Everything else (enumeration, page-tree pull, wiki-syntax conversion) is
built on top of those three primitives.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from typing import Any

import httpx

from ..convert import md_to_tiptap
from ..convert.roam_text import convert_roam_markdown
from ..errors import (
    NoteConnAuthError,
    NoteConnTransient,
    NoteConnUnsupported,
)
from .base import AccountInfo, NoteProvider, RemoteNote, RemoteRef

_API_BASE = "https://api.roamresearch.com/api/graph"

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
        """POSTs `body` to `url`; on a 307/308 with a `Location`, manually
        re-sends the SAME body + headers (Authorization included) to that
        URL rather than relying on httpx's redirect-follow (which would drop
        Authorization on the cross-host hop). Bounded to `max_hops` so a
        misbehaving peer chain can never loop forever."""
        current_url = url
        response: httpx.Response | None = None
        for _ in range(max_hops):
            response = await client.post(current_url, headers=headers, json=body)
            if response.status_code in (307, 308) and "location" in response.headers:
                current_url = response.headers["location"]
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
                return response.json()
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
            eids = "[" + " ".join(f'[:block/uid "{uid}"]' for uid in chunk) + "]"
            data = await self._call(
                graph, token, "pull-many", {"eids": eids, "selector": _PULL_SELECTOR},
            )
            result = data.get("result") or {}
            for uid in chunk:
                entity = result.get(f'[:block/uid "{uid}"]')
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
        refs: list[RemoteRef] = []
        for uid, _title, time_ms in rows:
            updated_at = _epoch_ms_to_iso(time_ms)
            if cursor is not None and updated_at <= cursor:
                continue
            refs.append(RemoteRef(remote_id=uid, updated_at=updated_at))
        refs.sort(key=lambda r: r.updated_at)
        return refs

    async def fetch(self, credentials: dict[str, Any], ref: RemoteRef) -> RemoteNote:
        graph, token = self._creds(credentials)
        pulled = await self._pull_many(graph, token, [ref.remote_id])
        entity = pulled.get(ref.remote_id)
        if entity is None:
            raise NoteConnTransient(
                f"Roam pull-many returned no data for uid {ref.remote_id!r}",
            )
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
        folder_path = ["Daily Notes"] if _is_daily_note_title(title) else []
        return RemoteNote(
            remote_id=ref.remote_id,
            title=title,
            doc=converted["doc"],
            media=converted["media"],
            links=converted["links"],
            tags=[],
            folder_path=folder_path,
            created_at=None,
            updated_at=ref.updated_at,
        )

    async def fetch_media(self, credentials: dict[str, Any], ref: str) -> tuple[bytes, str]:
        # Firebase Storage URLs are pre-signed/public — no Roam Authorization
        # header needed, and (unlike the graph-data endpoints) a normal
        # redirect-following GET is fine here since there's no auth header
        # to lose on the hop.
        client = await self._get_client()
        response = await client.get(ref, follow_redirects=True)
        if response.status_code >= 400:
            raise NoteConnTransient(
                f"Failed to download Roam media ({response.status_code})",
                status=response.status_code,
            )
        content_type = response.headers.get("content-type", "application/octet-stream")
        return response.content, content_type
