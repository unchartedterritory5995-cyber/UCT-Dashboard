"""Discord source: REST-only poller + resumable full-history backfill (CONTRACTS.md §6.3, W1 §2.1).

WHAT THIS MODULE GUARANTEES, and the test that says red for each
  1. REST only. There is no gateway (websocket) connection here and never will
     be; the rail scans this package for a websocket URL scheme.
  2. ONLY the four authors in docs/wisdom/authors.json are stored. Every other
     message is dropped BEFORE any write — it is counted, never persisted
     (§0.4e: no member messages are ever ingested).
  3. Quoted or replied-to member text never lands: `referenced_message` and
     forwarded `message_snapshots` are never read, blockquote lines (`> `,
     `>>> `) are stripped, and a member @mention becomes `@member`.
  4. Attachments are kept as media POINTERS (ids, filename, type, size, url).
  5. A 401/403 sets blocked_until = now + 1 h and the channel is skipped until
     then — a forbidden channel must not burn the pod IP's invalid-request budget
     every tick (that budget is shared with buzz_poll and /chart).
  6. At most MAX_PAGES_PER_TICK pages per channel per tick, forward pages first,
     the rest of the budget spent on the backfill.
  7. X-RateLimit-Remaining / X-RateLimit-Reset-After are honoured before the
     next request; a 429 sleeps once (capped) and stops the channel for the tick.
  8. A cursor (forward or backfill) only moves in the SAME transaction that
     commits the rows it covers.
  9. The 7,766 legacy classified #tsdr messages are reconciled BY ID
     (legacy_classified = 1) and excluded from extraction by the
     wisdom_sources_extractable_segments view — nothing double-counts.

Import-light on purpose: tools/wisdom/sources_discord_probe.py imports the fetch
and clean functions without touching wisdom.db.
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from api.services.wisdom.core import authors, ids, timeutil

API = "https://discord.com/api/v10"
USER_AGENT = "DiscordBot (https://uctintelligence.com, 1.0)"
PAGE = 100
MAX_PAGES_PER_TICK = 5
BLOCK_SECONDS = 3600
MAX_SLEEP_S = 30.0
HTTP_TIMEOUT_S = 20.0
NORMALIZER_VERSION = "discord-clean-v1"
STREAM = "discord"
# 0 = DEFAULT, 19 = REPLY. Everything else (joins, pins, thread notices, slash
# command echoes) is not something an author wrote.
KEEP_TYPES = frozenset({0, 19})
_DISCORD_EPOCH_MS = 1420070400000

# Injectable for tests: every sleep this module takes goes through here.
_sleep: Callable[[float], None] = time.sleep


# ── time ─────────────────────────────────────────────────────────────────────

def snowflake_datetime(message_id: object) -> datetime:
    ms = (int(message_id) >> 22) + _DISCORD_EPOCH_MS
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc)


def snowflake_et_iso(message_id: object) -> str:
    return timeutil.iso_et(snowflake_datetime(message_id))


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ── HTTP ─────────────────────────────────────────────────────────────────────

def token() -> str:
    return os.environ.get("DISCORD_BOT_TOKEN", "").strip()


class FetchResult:
    __slots__ = ("status", "messages", "retry_after", "remaining", "reset_after", "error")

    def __init__(self, status: Optional[int], messages: Optional[list] = None, *,
                 retry_after: Optional[float] = None, remaining: Optional[int] = None,
                 reset_after: Optional[float] = None, error: Optional[str] = None):
        self.status = status
        self.messages = messages
        self.retry_after = retry_after
        self.remaining = remaining
        self.reset_after = reset_after
        self.error = error

    @property
    def ok(self) -> bool:
        return self.status is not None and 200 <= self.status < 300 and self.messages is not None


def _float(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value) -> Optional[int]:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def fetch_page(channel_id: str, *, after: Optional[str] = None, before: Optional[str] = None,
               limit: int = PAGE, http=None) -> FetchResult:
    """One GET /channels/{id}/messages page. Never raises.

    `http` is anything with `.get(url, params=, headers=, timeout=)` returning an
    object with `.status_code`, `.headers` and `.json()` (httpx by default)."""
    tok = token()
    if not tok:
        return FetchResult(None, error="DISCORD_BOT_TOKEN is not set")
    params = {"limit": max(1, min(PAGE, int(limit)))}
    if after:
        params["after"] = str(after)
    if before:
        params["before"] = str(before)
    headers = {"Authorization": f"Bot {tok}", "User-Agent": USER_AGENT}
    close = None
    try:
        if http is None:
            import httpx

            http = httpx.Client(timeout=HTTP_TIMEOUT_S)
            close = http
        resp = http.get(f"{API}/channels/{channel_id}/messages", params=params,
                        headers=headers, timeout=HTTP_TIMEOUT_S)
        hdrs = {str(k).lower(): v for k, v in dict(resp.headers or {}).items()}
        remaining = _int(hdrs.get("x-ratelimit-remaining"))
        reset_after = _float(hdrs.get("x-ratelimit-reset-after"))
        status = int(resp.status_code)
        if status == 429:
            retry = _float(hdrs.get("retry-after"))
            try:
                body = resp.json()
                retry = _float((body or {}).get("retry_after")) or retry
            except Exception:
                pass
            return FetchResult(429, retry_after=retry, remaining=remaining,
                               reset_after=reset_after, error="rate limited")
        if status < 200 or status >= 300:
            return FetchResult(status, remaining=remaining, reset_after=reset_after,
                               error=f"HTTP {status}")
        data = resp.json()
        if not isinstance(data, list):
            return FetchResult(status, remaining=remaining, reset_after=reset_after,
                               error="response was not a message list")
        return FetchResult(status, data, remaining=remaining, reset_after=reset_after)
    except Exception as exc:  # noqa: BLE001 — a network failure is a result, not a crash
        return FetchResult(None, error=f"{type(exc).__name__}: {str(exc)[:200]}")
    finally:
        if close is not None:
            try:
                close.close()
            except Exception:
                pass


# ── cleaning (pure) ──────────────────────────────────────────────────────────

_USER_MENTION = re.compile(r"<@!?(\d+)>")
_ROLE_MENTION = re.compile(r"<@&(\d+)>")
_BLANK_RUNS = re.compile(r"\n{3,}")


def clean_text(content: str) -> tuple[str, dict]:
    """Strip quoted text and member mentions from an AUTHOR's message.

    Returns (text, counters). Quoted lines are dropped whole: a quote inside an
    author's message is somebody else's words by definition."""
    counters = {"quote_lines": 0, "member_mentions": 0}
    kept: list[str] = []
    lines = (content or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        if stripped.startswith(">>>"):
            # Discord's multi-line quote: this line and every line after it.
            counters["quote_lines"] += len(lines) - i
            break
        if stripped == ">" or stripped.startswith("> "):
            counters["quote_lines"] += 1
            continue
        kept.append(line)
    text = "\n".join(kept)

    def _user(m: re.Match) -> str:
        who = authors.author_for_discord_user(m.group(1))
        if who:
            return f"@{who}"
        counters["member_mentions"] += 1
        return "@member"

    text = _USER_MENTION.sub(_user, text)
    text = _ROLE_MENTION.sub("@role", text)
    text = _BLANK_RUNS.sub("\n\n", text).strip()
    return text, counters


def _attachment_pointers(msg: dict) -> list[dict]:
    out = []
    for a in msg.get("attachments") or []:
        if not isinstance(a, dict):
            continue
        out.append({
            "id": str(a.get("id") or ""),
            "filename": a.get("filename"),
            "content_type": a.get("content_type"),
            "size": a.get("size"),
            "width": a.get("width"),
            "height": a.get("height"),
            "url": a.get("url"),
        })
    return out


def clean_message(msg: dict, channel_id: str) -> Optional[dict]:
    """The storable form of one message, or None when it must not be stored.

    None for: a non-author (the allowlist is docs/wisdom/authors.json by user id),
    a bot/webhook post, a system message type, or a message with neither text nor
    attachments left after cleaning. Never reads `referenced_message` or
    `message_snapshots`."""
    if not isinstance(msg, dict):
        return None
    author = msg.get("author") or {}
    if msg.get("webhook_id") or author.get("bot"):
        return None
    author_id = authors.author_for_discord_user(author.get("id"))
    if author_id is None:
        return None
    try:
        mtype = int(msg.get("type") or 0)
    except (TypeError, ValueError):
        return None
    if mtype not in KEEP_TYPES:
        return None
    message_id = str(msg.get("id") or "").strip()
    if not message_id.isdigit():
        return None
    text, counters = clean_text(msg.get("content") or "")
    attachments = _attachment_pointers(msg)
    if not text and not attachments:
        return None
    ref = msg.get("message_reference") or {}
    reply_to = str(ref.get("message_id")) if ref.get("message_id") else None
    return {
        "message_id": message_id,
        "channel_id": str(channel_id),
        "author_id": author_id,
        "created_at": snowflake_et_iso(message_id),
        "text": text,
        "reply_to_message_id": reply_to,
        "attachments": attachments,
        "stripped": {**counters, "reply_reference": 1 if reply_to else 0},
    }


def _display_name(author_id: str) -> Optional[str]:
    for a in authors.authors():
        if a["author_id"] == author_id:
            return a.get("display_name") or author_id
    return None


# ── state ────────────────────────────────────────────────────────────────────

def _state(conn, channel_id: str) -> dict:
    row = conn.execute("SELECT * FROM wisdom_discord_state WHERE channel_id = ?", (channel_id,)).fetchone()
    return dict(row) if row else {
        "channel_id": channel_id, "forward_cursor": None, "backfill_before": None, "backfill_done": 0,
        "last_poll_at": None, "last_ok_at": None, "last_status": None, "blocked_until": None,
        "last_error": None, "messages_seen": 0, "messages_kept": 0,
    }


def _save_state(conn, st: dict) -> None:
    conn.execute(
        """INSERT INTO wisdom_discord_state
             (channel_id, forward_cursor, backfill_before, backfill_done, last_poll_at, last_ok_at,
              last_status, blocked_until, last_error, messages_seen, messages_kept)
           VALUES (:channel_id, :forward_cursor, :backfill_before, :backfill_done, :last_poll_at,
                   :last_ok_at, :last_status, :blocked_until, :last_error, :messages_seen, :messages_kept)
           ON CONFLICT(channel_id) DO UPDATE SET
             forward_cursor = excluded.forward_cursor, backfill_before = excluded.backfill_before,
             backfill_done = excluded.backfill_done, last_poll_at = excluded.last_poll_at,
             last_ok_at = excluded.last_ok_at, last_status = excluded.last_status,
             blocked_until = excluded.blocked_until, last_error = excluded.last_error,
             messages_seen = excluded.messages_seen, messages_kept = excluded.messages_kept""",
        st,
    )


def _store_page(conn, channel_id: str, messages: list, now_iso: str) -> dict:
    """Write the storable messages of one page. Caller holds the write transaction."""
    from api.services.wisdom.sources import common

    seen = kept = written = 0
    for msg in messages:
        seen += 1
        cleaned = clean_message(msg, channel_id)
        if cleaned is None:
            continue  # dropped before any write
        kept += 1
        mid = cleaned["message_id"]
        existing = conn.execute(
            "SELECT segment_id FROM wisdom_discord_messages WHERE message_id = ?", (mid,)
        ).fetchone()
        if existing is not None and existing["segment_id"]:
            continue
        external_ref = f"discord:{channel_id}:{mid}"
        attachments_json = json.dumps(cleaned["attachments"], sort_keys=True, ensure_ascii=False)
        raw_sha = ids.sha256_text(json.dumps(
            {"text": cleaned["text"], "attachments": [a["id"] for a in cleaned["attachments"]]},
            sort_keys=True, ensure_ascii=False))
        source_id = common.source_id_for(STREAM, external_ref, 1)
        common.insert_source(conn, {
            "source_id": source_id, "stream": STREAM, "external_ref": external_ref, "version": 1,
            "home_pointer": f"discord channel={channel_id} message={mid}",
            "published_at_et": cleaned["created_at"], "host_author_id": cleaned["author_id"],
            "raw_r2_key": None, "raw_sha256": raw_sha,
            "media_pointer": attachments_json if cleaned["attachments"] else None,
            "ingested_at": now_iso,
        })
        common.insert_segments(conn, source_id, 1, [{
            "ordinal": 0, "kind": "message", "char_start": 0, "char_end": len(cleaned["text"]),
            "speaker_label": _display_name(cleaned["author_id"]), "author_id": cleaned["author_id"],
            "speaker_confidence": "high", "text": cleaned["text"],
        }], NORMALIZER_VERSION)
        segment_id = common.segment_id_for(source_id, 1, 0)
        conn.execute(
            """INSERT INTO wisdom_discord_messages
                 (message_id, channel_id, author_id, created_at, segment_id, source_id,
                  legacy_classified, reply_to_message_id, attachments_json, ingested_at)
               VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
               ON CONFLICT(message_id) DO UPDATE SET
                 channel_id = excluded.channel_id, author_id = excluded.author_id,
                 created_at = excluded.created_at, segment_id = excluded.segment_id,
                 source_id = excluded.source_id, reply_to_message_id = excluded.reply_to_message_id,
                 attachments_json = excluded.attachments_json, ingested_at = excluded.ingested_at""",
            (mid, channel_id, cleaned["author_id"], cleaned["created_at"], segment_id, source_id,
             cleaned["reply_to_message_id"], attachments_json, now_iso),
        )
        written += 1
    return {"seen": seen, "kept": kept, "written": written}


# ── polling ──────────────────────────────────────────────────────────────────

def _blocked(st: dict, now: datetime) -> bool:
    until = timeutil.parse_iso(st.get("blocked_until"))
    return until is not None and now < until


def _respect_headers(res: FetchResult) -> None:
    if res.remaining is not None and res.remaining <= 0 and res.reset_after:
        _sleep(min(max(0.0, res.reset_after), MAX_SLEEP_S))


def _record_failure(st: dict, res: FetchResult, now: datetime) -> str:
    st["last_status"] = res.status
    st["last_error"] = (res.error or "")[:500] or None
    if res.status in (401, 403):
        st["blocked_until"] = timeutil.iso_et(now + timedelta(seconds=BLOCK_SECONDS))
        return "blocked"
    if res.status == 429:
        if res.retry_after:
            _sleep(min(max(0.0, res.retry_after), MAX_SLEEP_S))
        return "rate_limited"
    return "failed"


def poll_channel(channel_id: str, *, page_budget: int = MAX_PAGES_PER_TICK, backfill: bool = True,
                 dry_run: bool = False, fetch: Callable[..., FetchResult] = None,
                 now: Optional[datetime] = None) -> dict:
    """Forward pages first, then the backfill with whatever budget is left."""
    from api.services.wisdom.core import store

    fetch = fetch or fetch_page
    now = timeutil.to_et(now or _now_utc())
    now_iso = timeutil.iso_et(now)
    budget = max(0, min(int(page_budget), 1000))
    with store.read() as conn:
        st = _state(conn, channel_id)
    summary = {"channel_id": channel_id, "pages": 0, "seen": 0, "kept": 0, "written": 0,
               "outcome": "ok", "dry_run": dry_run}
    if _blocked(st, now):
        summary["outcome"] = "blocked"
        summary["blocked_until"] = st["blocked_until"]
        return summary
    st["last_poll_at"] = now_iso

    def _commit(page_msgs: list, mutate) -> dict:
        if dry_run:
            kept = sum(1 for m in page_msgs if clean_message(m, channel_id) is not None)
            return {"seen": len(page_msgs), "kept": kept, "written": 0}
        with store.write() as conn:
            cur = _state(conn, channel_id)
            # Carry this tick's in-memory fields onto the committed row.
            cur.update({k: st[k] for k in ("last_poll_at", "last_status", "last_ok_at",
                                           "last_error", "blocked_until")})
            counts = _store_page(conn, channel_id, page_msgs, now_iso)
            mutate(cur)
            cur["messages_seen"] = int(cur.get("messages_seen") or 0) + counts["seen"]
            cur["messages_kept"] = int(cur.get("messages_kept") or 0) + counts["kept"]
            _save_state(conn, cur)
            st.update(cur)
        return counts

    def _add(counts: dict) -> None:
        for k in ("seen", "kept", "written"):
            summary[k] += counts[k]

    # forward
    cursor = st.get("forward_cursor")
    while summary["pages"] < budget:
        res = fetch(channel_id, after=cursor) if cursor else fetch(channel_id)
        summary["pages"] += 1
        if not res.ok:
            summary["outcome"] = _record_failure(st, res, now)
            summary["error"] = res.error
            if not dry_run:
                with store.write() as conn:
                    cur = _state(conn, channel_id)
                    cur.update({k: st[k] for k in ("last_poll_at", "last_status", "last_error",
                                                   "blocked_until")})
                    _save_state(conn, cur)
            return summary
        st["last_status"], st["last_ok_at"], st["last_error"] = res.status, now_iso, None
        msgs = [m for m in res.messages if isinstance(m, dict) and str(m.get("id") or "").isdigit()]
        first_page = cursor is None
        if msgs:
            newest = max(msgs, key=lambda m: int(m["id"]))["id"]
            oldest = min(msgs, key=lambda m: int(m["id"]))["id"]

            def _fwd(cur, newest=newest, oldest=oldest, first_page=first_page, n=len(msgs)):
                cur["forward_cursor"] = str(newest)
                if first_page and not cur.get("backfill_before"):
                    cur["backfill_before"] = str(oldest)
                    if n < PAGE:
                        cur["backfill_done"] = 1

            _add(_commit(msgs, _fwd))
            cursor = str(newest)
        else:
            _add(_commit([], lambda cur, fp=first_page: cur.update({"backfill_done": 1}) if fp else None))
        _respect_headers(res)
        if first_page or len(msgs) < PAGE:
            break

    # backfill
    while backfill and summary["pages"] < budget and not int(st.get("backfill_done") or 0):
        before = st.get("backfill_before")
        if not before:
            break
        res = fetch(channel_id, before=before)
        summary["pages"] += 1
        if not res.ok:
            summary["outcome"] = _record_failure(st, res, now)
            summary["error"] = res.error
            if not dry_run:
                with store.write() as conn:
                    cur = _state(conn, channel_id)
                    cur.update({k: st[k] for k in ("last_poll_at", "last_status", "last_error",
                                                   "blocked_until")})
                    _save_state(conn, cur)
            return summary
        st["last_status"], st["last_ok_at"], st["last_error"] = res.status, now_iso, None
        msgs = [m for m in res.messages if isinstance(m, dict) and str(m.get("id") or "").isdigit()]
        if msgs:
            oldest = min(msgs, key=lambda m: int(m["id"]))["id"]

            def _back(cur, oldest=oldest, n=len(msgs)):
                cur["backfill_before"] = str(oldest)
                if n < PAGE:
                    cur["backfill_done"] = 1

            _add(_commit(msgs, _back))
            if dry_run:
                st["backfill_before"] = str(oldest)
                if len(msgs) < PAGE:
                    st["backfill_done"] = 1
        else:
            _add(_commit([], lambda cur: cur.update({"backfill_done": 1})))
            if dry_run:
                st["backfill_done"] = 1
        _respect_headers(res)
    summary["backfill_done"] = int(st.get("backfill_done") or 0)
    return summary


def in_scope_channel_ids() -> list[str]:
    return [str(c["channel_id"]) for c in authors.in_scope_channels()]


def tick(*, page_budget: int = MAX_PAGES_PER_TICK, dry_run: bool = False, backfill: bool = True,
         fetch: Callable[..., FetchResult] = None, now: Optional[datetime] = None,
         log: Callable[[str], None] = None) -> dict:
    """One listener tick over every in-scope channel."""
    channels = []
    if not token() and fetch is None:
        return {"outcome": "no_token", "channels": [], "error": "DISCORD_BOT_TOKEN is not set"}
    for channel_id in in_scope_channel_ids():
        out = poll_channel(channel_id, page_budget=page_budget, backfill=backfill,
                           dry_run=dry_run, fetch=fetch, now=now)
        channels.append(out)
        if log:
            log(f"discord {channel_id}: {out['outcome']} pages={out['pages']} "
                f"seen={out['seen']} kept={out['kept']}")
    totals = {k: sum(c[k] for c in channels) for k in ("pages", "seen", "kept", "written")}
    return {"outcome": "ok", "channels": channels, **totals}


# ── legacy reconcile ─────────────────────────────────────────────────────────

MAX_LEGACY_BATCH = 2000
_ID = re.compile(r"^\d{15,21}$")


def record_legacy_ids(channel_id: str, message_ids: list, *, now: Optional[datetime] = None) -> dict:
    """Mark legacy-classified message ids so the Wave 1 extractor never re-extracts them.

    Ids only — no text, no author. An id not yet fetched gets a placeholder row
    (author NULL, segment NULL) that the backfill later completes WITHOUT clearing
    legacy_classified."""
    from api.services.wisdom.core import store

    channel_id = str(channel_id or "").strip()
    if channel_id not in in_scope_channel_ids():
        raise ValueError("channel is not an in-scope Wisdom channel")
    if len(message_ids) > MAX_LEGACY_BATCH:
        raise ValueError(f"at most {MAX_LEGACY_BATCH} ids per batch")
    valid, rejected = [], 0
    for raw in message_ids:
        mid = str(raw or "").strip()
        if _ID.match(mid):
            valid.append(mid)
        else:
            rejected += 1
    valid = list(dict.fromkeys(valid))
    now_iso = timeutil.iso_et(timeutil.to_et(now or _now_utc()))
    inserted = marked = 0
    with store.write() as conn:
        for mid in valid:
            row = conn.execute(
                "SELECT legacy_classified FROM wisdom_discord_messages WHERE message_id = ?", (mid,)
            ).fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO wisdom_discord_messages (message_id, channel_id, created_at, "
                    "legacy_classified, ingested_at) VALUES (?, ?, ?, 1, ?)",
                    (mid, channel_id, snowflake_et_iso(mid), now_iso),
                )
                inserted += 1
            elif not row["legacy_classified"]:
                conn.execute(
                    "UPDATE wisdom_discord_messages SET legacy_classified = 1 WHERE message_id = ?", (mid,)
                )
                marked += 1
    return {"received": len(message_ids), "valid": len(valid), "inserted": inserted,
            "marked_existing": marked, "already_marked": len(valid) - inserted - marked,
            "rejected": rejected}


# ── status ───────────────────────────────────────────────────────────────────

def discord_status(conn, *, now: Optional[datetime] = None) -> dict:
    now = timeutil.to_et(now or _now_utc())
    channels = []
    for ch in authors.in_scope_channels():
        cid = str(ch["channel_id"])
        st = _state(conn, cid)
        counts = conn.execute(
            """SELECT COUNT(*) AS rows_total,
                      SUM(CASE WHEN segment_id IS NOT NULL THEN 1 ELSE 0 END) AS stored,
                      SUM(CASE WHEN legacy_classified = 1 THEN 1 ELSE 0 END) AS legacy,
                      MIN(CASE WHEN segment_id IS NOT NULL THEN created_at END) AS oldest,
                      MAX(CASE WHEN segment_id IS NOT NULL THEN created_at END) AS newest
               FROM wisdom_discord_messages WHERE channel_id = ?""",
            (cid,),
        ).fetchone()
        by_author = {r["author_id"]: r["n"] for r in conn.execute(
            "SELECT author_id, COUNT(*) AS n FROM wisdom_discord_messages "
            "WHERE channel_id = ? AND segment_id IS NOT NULL GROUP BY author_id", (cid,))}
        channels.append({
            "key": ch.get("key"), "name": ch.get("name"), "channel_id": cid,
            "forward_cursor": st["forward_cursor"], "backfill_before": st["backfill_before"],
            "backfill_done": bool(st["backfill_done"]), "last_poll_at": st["last_poll_at"],
            "last_ok_at": st["last_ok_at"], "last_status": st["last_status"],
            "blocked": _blocked(st, now), "blocked_until": st["blocked_until"],
            "last_error": st["last_error"], "messages_seen": st["messages_seen"],
            "messages_kept": st["messages_kept"], "stored": int(counts["stored"] or 0),
            "legacy_classified": int(counts["legacy"] or 0), "oldest_stored_at": counts["oldest"],
            "newest_stored_at": counts["newest"], "stored_by_author": by_author,
        })
    return {"token_configured": bool(token()), "channels": channels,
            "stored_total": sum(c["stored"] for c in channels),
            "legacy_total": sum(c["legacy_classified"] for c in channels)}
