"""ONE hotlink fetch: download a linked image and store our own copy (Plan F Task 4).

Used by the member's door (`POST /api/j2/notes/media/fetch`, `api/routers/journal_two.py`) and by
the import repair (`import_repair`), so the two can never disagree about what is fetched, how
long it may take, or how it is stored:

  * the download is the shared `fetch_content_url` (http allowed for the download only,
    redirects followed, the SSRF guard on every hop) through `media_http_client` (no
    credential, no shared cookie jar, never an env proxy);
  * the WHOLE download (every hop, every slow-drip read, and the wait for a slot) has one
    deadline, because the client timeout is per read;
  * then `normalize_media` + `store_media` under the member's `MediaBudget`, off the event loop.

It raises whatever those raise; the caller maps the refusal (the door: a named 422; the
repair: leave the hotlink as it is and log it).

C1 (pre-flight ruling): the door keeps its own names and seams (`_media_fetch_client`,
`MEDIA_FETCH_DEADLINE_S`, `_MEDIA_FETCH_SEM`, the in-flight count) and passes them in at CALL
time, so its tests' patches still hold; this module holds the defaults the repair uses.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable
from urllib.parse import unquote, urlsplit

from api.services.journal_two import media_policy

logger = logging.getLogger(__name__)

#: Per read (the client's timeout).
FETCH_TIMEOUT_S = 30.0
#: The whole download, every hop and every read, and the wait for a slot.
FETCH_DEADLINE_S = 60.0


def default_client():
    """The fetch's HTTP client (`media_http_client`)."""
    from api.services.journal_two.note_connectors.providers.base import media_http_client
    return media_http_client(timeout=FETCH_TIMEOUT_S)


def filename_of(url: str) -> str:
    """The stored file's name: the URL path's last segment, decoded; `image` when it has none."""
    name = unquote(urlsplit(url).path.rsplit("/", 1)[-1]).strip()
    return name or "image"


async def download(url: str, *, client_factory: Callable[[], Any] | None = None,
                   deadline_s: float | None = None,
                   semaphore: asyncio.Semaphore | None = None) -> tuple[bytes, str | None]:
    """`(bytes, content type)` of `url`, under ONE deadline that covers the slot wait too."""
    from api.services.journal_two.note_connectors.providers.base import fetch_content_url
    factory = client_factory or default_client

    async def run():
        async with factory() as client:
            return await fetch_content_url(client, url, what="Linked image")

    async def gated():
        if semaphore is None:
            return await run()
        async with semaphore:
            return await run()

    return await asyncio.wait_for(gated(), FETCH_DEADLINE_S if deadline_s is None else deadline_s)


def store(user_id: str, note_id: str, data: bytes, content_type: str | None,
          filename: str) -> media_policy.StoredMedia:
    """The media policy's decision, stored under the member's budget (blocking: run it off
    the event loop)."""
    result = media_policy.normalize_media(data, content_type, filename)
    budget = media_policy.MediaBudget.for_member(user_id)
    return media_policy.store_media(user_id, note_id, result, budget=budget)


def stored_payload(stored: media_policy.StoredMedia) -> dict[str, Any]:
    """[B A1] The upload doors' answer: additive over the old `{url, width, height}` (images)
    and `{url, name, size}` (files), so an older client keeps reading what it read. THE builder:
    the router's `_stored_media_payload` is this function (Plan F Task 7 review M-6)."""
    return {
        "url": stored.url, "kind": stored.kind, "name": stored.name, "size": stored.size,
        "mime": stored.mime, "width": stored.width, "height": stored.height,
        "original": ({"url": stored.original.url, "name": stored.original.name}
                     if stored.original is not None else None),
    }


def hand_off(user_id: str, note_id: str, stored: media_policy.StoredMedia) -> None:
    """Plan B R7 (a), for the import repair: a fetched file is searchable exactly as one the
    member door fetched (`_hand_off_to_documents`): the same payload through the same seam.
    Re-review I-5: the row only (`queue=False`). The repair is a short-lived process on the prod
    pod; extraction and OCR run on the web pod, whose pending sweep picks the row up, never here.
    Guarded: a failure here is one log line and never costs the repair."""
    from api.services.journal_two import document_extraction
    try:
        document_extraction.on_attachment_saved(user_id, note_id, stored_payload(stored), stored.mime,
                                                kind=stored.kind, queue=False)
    except Exception as e:  # noqa: BLE001 -- extraction never costs the copy
        logger.warning("[import repair] document hand-off failed after a stored copy (%s)",
                       type(e).__name__)


async def fetch_and_store(user_id: str, note_id: str, url: str, *,
                          client_factory: Callable[[], Any] | None = None,
                          deadline_s: float | None = None,
                          semaphore: asyncio.Semaphore | None = None,
                          after_download: Callable[[], None] | None = None) -> media_policy.StoredMedia:
    """Download `url` and store our copy for `note_id`. `after_download` runs once the download
    is over, whether it succeeded or not (the door gives back its in-flight slot there, before
    the decode and store)."""
    from starlette.concurrency import run_in_threadpool
    try:
        data, content_type = await download(url, client_factory=client_factory, deadline_s=deadline_s,
                                            semaphore=semaphore)
    finally:
        if after_download is not None:
            after_download()
    return await run_in_threadpool(store, user_id, note_id, data, content_type, filename_of(url))
