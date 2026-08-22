"""api/services/cot_weekly_post.py -- optional Discord post of the week's COT reads.

After `cot_prewarm.run_prewarm` has written the week's narratives, post the
MOST WATCHED symbols' reads as Discord embeds: one embed per symbol, at most
five embeds per message.

THE SAFETY RAIL
---------------
The COT read is PAID content. `COT_WEEKLY_DISCORD_WEBHOOK_URL` unset or blank ->
`{"posted": 0, "skipped": "no-webhook"}` and nothing leaves the box. Pointing the
variable at a channel is the owner's explicit decision to publish there: there
is no default channel and deliberately no fallback to the admin or TSDR webhooks.

WHAT GETS POSTED
----------------
For each symbol in `cot_service.SYMBOL_GROUPS["MOST WATCHED"]` (read from the
service -- never copied here; a missing group is a recorded no-op) that has a
stored read for the run's `report_date` (`cot_narrative.get_for`):

    title        "{SYM} . {name} -- {bias label} ({strength})"   (middle dot / em dash)
    description  the narrative text, cut at 1000 chars on a word boundary + ellipsis
    field        "What to watch" (<= 1024 chars) when the run carried one
    footer       "CFTC report {report_date} . UCT Intelligence"
    color        bull 0x3cb868 / bear 0xe74c3c / else 0xc9a84c (the brand gold)

Batches are capped at five embeds AND at a character budget under Discord's
6000-per-message limit (five full embeds can exceed it). Never raises: a failed
POST is logged and counted as not posted.
"""
from __future__ import annotations

import logging
import os

import requests

from api.services import cot_narrative, cot_service

logger = logging.getLogger(__name__)

WEBHOOK_ENV = "COT_WEEKLY_DISCORD_WEBHOOK_URL"
GROUP = "MOST WATCHED"

MAX_EMBEDS_PER_MESSAGE = 5
MAX_CHARS_PER_MESSAGE  = 5800   # Discord counts title+description+fields+footer against 6000
DESCRIPTION_MAX = 1000
FIELD_MAX = 1024
TITLE_MAX = 256
POST_TIMEOUT_S = 10

COLOR_BULL    = 0x3CB868
COLOR_BEAR    = 0xE74C3C
COLOR_NEUTRAL = 0xC9A84C
_COLOR_BY_TONE = {"bull": COLOR_BULL, "bullish": COLOR_BULL,
                  "bear": COLOR_BEAR, "bearish": COLOR_BEAR}

ELLIPSIS = "…"
DOT  = " · "
DASH = " — "


def _webhook() -> str:
    return os.environ.get(WEBHOOK_ENV, "").strip()


def most_watched() -> list[str]:
    """The MOST WATCHED roster, read off `cot_service` at call time."""
    return list(cot_service.SYMBOL_GROUPS.get(GROUP) or [])


def truncate(text, limit: int) -> str:
    """`text` cut to at most `limit` chars on a word boundary, ending in an
    ellipsis when anything was dropped. Newlines are kept (Discord renders them)."""
    s = str(text or "").strip()
    if len(s) <= limit:
        return s
    cut = s[: max(limit - 1, 0)]
    boundary = max(cut.rfind(" "), cut.rfind("\n"))
    if boundary >= limit // 2:
        cut = cut[:boundary]
    return cut.rstrip(" \n,;:") + ELLIPSIS


def color_for(tone) -> int:
    return _COLOR_BY_TONE.get(str(tone or "").strip().lower(), COLOR_NEUTRAL)


def _title(sym: str, name: str, bias: dict) -> str:
    label = str(bias.get("label") or "").strip()
    strength = str(bias.get("strength") or "").strip()
    title = f"{sym}{DOT}{name}"
    if label:
        title += f"{DASH}{label}"
        if strength:
            title += f" ({strength})"
    return title[:TITLE_MAX]


def build_embed(sym: str, row: dict, result: dict, report_date: str) -> dict:
    """One Discord embed for a stored read. `result` is the prewarm summary's
    entry for the symbol (bias/watch); an empty dict degrades to a plain title."""
    name = cot_service.SYMBOL_NAMES.get(sym, sym)
    bias = result.get("bias") if isinstance(result.get("bias"), dict) else {}
    embed = {
        "title": _title(sym, name, bias),
        "description": truncate(row.get("text"), DESCRIPTION_MAX),
        "color": color_for(bias.get("tone")),
        "footer": {"text": f"CFTC report {report_date}{DOT}UCT Intelligence"},
    }
    watch = str(result.get("watch") or "").strip()
    if watch:
        embed["fields"] = [{"name": "What to watch", "value": truncate(watch, FIELD_MAX),
                            "inline": False}]
    return embed


def build_embeds(summary: dict) -> list[dict]:
    """Embeds for every MOST WATCHED symbol with a stored read for the run's
    report_date, in roster order."""
    report_date = summary.get("report_date")
    if not report_date:
        return []
    results = summary.get("results") if isinstance(summary.get("results"), dict) else {}
    out = []
    for sym in most_watched():
        row = cot_narrative.get_for(sym, report_date)
        if not row or not (row.get("text") or "").strip():
            continue
        out.append(build_embed(sym, row, results.get(sym) or {}, report_date))
    return out


def _embed_chars(e: dict) -> int:
    n = len(e.get("title") or "") + len(e.get("description") or "")
    n += len((e.get("footer") or {}).get("text") or "")
    for f in e.get("fields") or []:
        n += len(f.get("name") or "") + len(f.get("value") or "")
    return n


def batches(embeds: list[dict]) -> list[list[dict]]:
    """<= MAX_EMBEDS_PER_MESSAGE embeds and <= MAX_CHARS_PER_MESSAGE chars per message."""
    out: list[list[dict]] = []
    cur: list[dict] = []
    cur_chars = 0
    for e in embeds:
        size = _embed_chars(e)
        if cur and (len(cur) >= MAX_EMBEDS_PER_MESSAGE or cur_chars + size > MAX_CHARS_PER_MESSAGE):
            out.append(cur)
            cur, cur_chars = [], 0
        cur.append(e)
        cur_chars += size
    if cur:
        out.append(cur)
    return out


def post_most_watched(summary: dict) -> dict:
    """Post the week's MOST WATCHED reads to the configured webhook. Never raises.
    {"posted": n, "messages": m, "embeds": total} or {"posted": 0, "skipped": why}."""
    url = _webhook()
    if not url:
        logger.info("[cot_weekly_post] %s unset -- nothing posted", WEBHOOK_ENV)
        return {"posted": 0, "skipped": "no-webhook"}
    if not most_watched():
        logger.warning("[cot_weekly_post] cot_service.SYMBOL_GROUPS has no %r group -- nothing to post",
                       GROUP)
        return {"posted": 0, "messages": 0, "skipped": "no-most-watched-group"}
    try:
        embeds = build_embeds(summary if isinstance(summary, dict) else {})
    except Exception as exc:  # noqa: BLE001
        logger.error("[cot_weekly_post] could not build embeds: %s: %s", type(exc).__name__, exc)
        return {"posted": 0, "messages": 0, "error": f"{type(exc).__name__}: {exc}"[:200]}
    if not embeds:
        logger.info("[cot_weekly_post] no stored reads for report %s -- nothing posted",
                    (summary or {}).get("report_date"))
        return {"posted": 0, "messages": 0, "skipped": "no-narratives"}

    posted = messages = 0
    for batch in batches(embeds):
        try:
            resp = requests.post(url, json={"embeds": batch}, timeout=POST_TIMEOUT_S)
            status = getattr(resp, "status_code", 200)
            if status >= 400:
                logger.warning("[cot_weekly_post] Discord answered %s: %s", status,
                               (getattr(resp, "text", "") or "")[:200])
                continue
            posted += len(batch)
            messages += 1
        except Exception as exc:  # noqa: BLE001
            logger.error("[cot_weekly_post] post failed: %s: %s", type(exc).__name__, exc)
    logger.info("[cot_weekly_post] posted %d of %d embeds in %d message(s)", posted, len(embeds), messages)
    return {"posted": posted, "messages": messages, "embeds": len(embeds)}
