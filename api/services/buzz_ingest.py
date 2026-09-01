# api/services/buzz_ingest.py
"""Poll #main-chat for new messages and record ticker mentions.

Polling, not a gateway, and that is the CORRECT choice here rather than the
lazy one. Measured 2026-09-01: `GET /channels/{id}/messages` returns full
content for other users' messages, so no MESSAGE_CONTENT privileged intent is
needed. And the stored snowflake makes ingest gap-free across a deploy -- `web`
redeploys on every push to master, and a gateway would silently drop every
message during each ~2 minute swap.

⛔ The cursor advances only AFTER the rows are committed. A crash in between
re-fetches that window on the next poll; the store's composite primary key
absorbs the duplicate. Advancing first would lose messages permanently.
"""
from __future__ import annotations

import logging
import os
import time

from api.services import buzz_extract, buzz_store

log = logging.getLogger(__name__)

DEFAULT_CHANNEL = "1216816863313657886"      # #main-chat, Uncharted Territory
API = "https://discord.com/api/v10"
PAGE = 100
BACKFILL_PAGE_PAUSE_S = 0.25                 # measured bucket limit is 5 req/s


def ingest_enabled() -> bool:
    return os.environ.get("BUZZ_INGEST_ENABLED", "1").strip().lower() not in ("0", "false", "off", "")


def channels() -> list[str]:
    raw = os.environ.get("BUZZ_CHANNELS", "").strip()
    if not raw:
        return [DEFAULT_CHANNEL]
    return [c.strip() for c in raw.split(",") if c.strip()]


def _token() -> str:
    return os.environ.get("DISCORD_BOT_TOKEN", "").strip()


def fetch_messages(channel_id: str, *, after=None, before=None, limit: int = PAGE, http=None) -> list[dict]:
    """One page of messages, newest first. Returns [] on any failure."""
    import httpx
    params: dict = {"limit": limit}
    if after:
        params["after"] = str(after)
    if before:
        params["before"] = str(before)
    own = http is None
    c = http or httpx.Client(timeout=20.0)
    try:
        r = c.get(f"{API}/channels/{channel_id}/messages",
                  params=params, headers={"Authorization": f"Bot {_token()}"})
        if r.status_code == 429:
            time.sleep(float(r.headers.get("retry-after", "1")))
            return []
        if not r.is_success:
            log.warning("[buzz] fetch HTTP %s for %s: %s", r.status_code, channel_id, r.text[:160])
            return []
        return r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("[buzz] fetch failed for %s: %s", channel_id, e)
        return []
    finally:
        if own:
            c.close()


def ingest_messages(channel_id: str, messages: list[dict]) -> tuple[int, str | None]:
    rows: list[tuple] = []
    newest: int | None = None
    for m in messages or []:
        mid = str(m.get("id") or "")
        if not mid:
            continue
        newest = max(newest or 0, int(mid))
        author = m.get("author") or {}
        if author.get("bot"):
            continue
        content = (m.get("content") or "").strip()
        if not content:
            continue
        ts = buzz_store.snowflake_ts(mid)
        for ticker, confidence in buzz_extract.extract(content):
            rows.append((mid, channel_id, str(author.get("id") or ""), ticker, ts, confidence))
    written = buzz_store.record_mentions(rows)
    return written, (str(newest) if newest is not None else None)


def poll_once(channel_id: str, *, fetch_fn=None) -> dict:
    fetch = fetch_fn or fetch_messages
    cursor = buzz_store.get_cursor(channel_id)
    msgs = fetch(channel_id, after=cursor, limit=PAGE)
    written, newest = ingest_messages(channel_id, msgs)      # raises => cursor untouched
    if newest:
        buzz_store.set_cursor(channel_id, newest)
    return {"fetched": len(msgs or []), "rows": written, "cursor": newest or cursor}


def backfill(channel_id: str, days: int = 30, *, fetch_fn=None, progress=None) -> dict:
    """Walk the channel backwards until messages fall outside the window."""
    fetch = fetch_fn or fetch_messages
    cutoff = int(time.time()) - days * 86400
    before = None
    total = pages = fetched = 0
    newest_seen: int | None = None
    while True:
        msgs = fetch(channel_id, before=before, limit=PAGE)
        if not msgs:
            break
        pages += 1
        fetched += len(msgs)
        written, newest = ingest_messages(channel_id, msgs)
        total += written
        if newest:
            newest_seen = max(newest_seen or 0, int(newest))
        oldest = min(int(m["id"]) for m in msgs)
        before = str(oldest)
        if progress:
            progress(pages, fetched, total)
        if buzz_store.snowflake_ts(str(oldest)) < cutoff:
            break
        if fetch_fn is None:
            time.sleep(BACKFILL_PAGE_PAUSE_S)
    if newest_seen and not buzz_store.get_cursor(channel_id):
        buzz_store.set_cursor(channel_id, str(newest_seen))
    return {"pages": pages, "fetched": fetched, "rows": total}
