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


# Longest a 429's retry-after may park an APScheduler worker slot.
MAX_RETRY_AFTER_S = float(os.environ.get("BUZZ_MAX_RETRY_AFTER_S", "30"))


def _token() -> str:
    return os.environ.get("DISCORD_BOT_TOKEN", "").strip()


def fetch_messages(channel_id: str, *, after=None, before=None, limit: int = PAGE, http=None) -> list[dict] | None:
    """One page of messages, newest first.

    ⛔ Returns None on FAILURE and [] only on a genuinely empty page. `backfill`
    stops on [] and reports truncation on None -- collapsing the two makes a
    single 429 look like "end of history" and silently short-reads the whole
    backfill while reporting success.
    """
    # ⛔ NAME THE MISCONFIGURATION. DISCORD_BOT_TOKEN has no other consumer in
    # this app, so it is the one variable an activation is most likely to miss —
    # and without this branch the symptom is a 401 logged as a generic
    # "fetch HTTP 401", every 60s, behind a board that just looks like a quiet
    # room. A named cause is the difference between a two-minute fix and an
    # afternoon spent doubting the extractor.
    if not _token():
        log.warning("[buzz] DISCORD_BOT_TOKEN is not set — cannot read %s. "
                    "The poller is configured (BUZZ_CHANNELS) but has no "
                    "credentials; see docs/runbooks/buzz-activation.md.", channel_id)
        return None

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
            # ⛔ CAPPED, because this sleeps inside one of APScheduler's TEN
            # worker slots (see the `max_instances=1` note in main.py). A
            # global-limit or ban 429 answers `retry-after: 3600`, and the
            # uncapped version held a slot for an hour to then return None
            # anyway -- max_instances protects this job from itself, not the
            # 140+ other jobs sharing the pool. The poll runs every 60s, so
            # waiting longer than this buys nothing: the next tick retries.
            asked = float(r.headers.get("retry-after", "1"))
            wait = min(max(0.0, asked), MAX_RETRY_AFTER_S)
            log.warning("[buzz] rate limited on %s, retry-after %.1fs (waiting %.1fs)",
                        channel_id, asked, wait)
            time.sleep(wait)
            return None
        if not r.is_success:
            log.warning("[buzz] fetch HTTP %s for %s: %s", r.status_code, channel_id, r.text[:160])
            return None
        return r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("[buzz] fetch failed for %s: %s", channel_id, e)
        return None
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


def backfill(channel_id: str, days: int = 30, *, fetch_fn=None, progress=None,
             restart: bool = False) -> dict:
    """Walk the channel backwards until messages fall outside the window.

    ⛔ RESUMABLE, AND IT HAS TO BE. This used to set `before = None` on every
    run, so the walk always restarted from the NEWEST message. On a channel
    doing ~1,100 messages a day, a single rate limit at page 11 capped it at
    about 14 hours of history — and each re-run re-walked those same pages and
    stopped in the same place, so a 30-day backfill was unreachable no matter
    how many times you ran it. Measured on #main-chat: five consecutive runs,
    four adding zero new mentions. The tool printed "re-run to continue"; it
    could not continue.

    The walk now starts from the persisted backward watermark and advances it
    AFTER each page's rows commit, so a rate limit, a crash or a deploy swap
    costs one page, not the whole run. `restart=True` ignores the mark and
    walks from the newest again.
    """
    fetch = fetch_fn or fetch_messages
    cutoff = int(time.time()) - days * 86400
    if restart:
        buzz_store.clear_backfill_mark(channel_id)
        before = None
    else:
        before = buzz_store.get_backfill_mark(channel_id)
    resumed = before is not None
    total = pages = fetched = 0
    newest_seen: int | None = None
    truncated = False
    while True:
        msgs = fetch(channel_id, before=before, limit=PAGE)
        if msgs is None:                       # failure, NOT end of history
            truncated = True
            log.warning("[buzz] backfill of %s truncated after %d page(s)", channel_id, pages)
            break
        if not msgs:                           # genuine end
            break
        pages += 1
        fetched += len(msgs)
        written, newest = ingest_messages(channel_id, msgs)
        total += written
        if newest:
            newest_seen = max(newest_seen or 0, int(newest))
        oldest = min(int(m["id"]) for m in msgs)
        before = str(oldest)
        # ⛔ AFTER the page's rows are committed by ingest_messages above, never
        # before: a mark written first would skip this page forever if the next
        # step died. Same ordering rule as the forward cursor.
        buzz_store.set_backfill_mark(channel_id, before)
        if progress:
            progress(pages, fetched, total)
        if buzz_store.snowflake_ts(str(oldest)) < cutoff:
            break
        if fetch_fn is None:
            time.sleep(BACKFILL_PAGE_PAUSE_S)
    # Only a walk that STARTED at the newest message may seed the forward
    # cursor. A resumed run begins deep in the past, so its "newest seen" is an
    # old id -- planting that as the poller's cursor would make the next poll
    # re-fetch weeks of history one 100-message page at a time.
    if newest_seen and not resumed and not buzz_store.get_cursor(channel_id):
        buzz_store.set_cursor(channel_id, str(newest_seen))
    return {"pages": pages, "fetched": fetched, "rows": total, "truncated": truncated}
