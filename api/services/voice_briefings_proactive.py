"""Auto morning briefing — assembles a short narration script the user can
ask Compass to read at session start.

Pulls: today's regime, overnight news (Perplexity finance pack, recency=
'hour'), top movers, top catalysts, today's earnings, the user's open
positions, active interventions, and this-week focus. Formats as a
40-60 second voice script.

The briefing is cached per user per day so multiple voice sessions on the
same morning don't burn API calls. The voice tool play_my_morning_briefing
reads the cached briefing if present and generates fresh if not.
"""

import logging
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_CACHE = TTLCache()
_CACHE_TTL = 8 * 3600  # 8 hours — briefing valid through the trading day

_ET = ZoneInfo("America/New_York")


def _safe(fn, default, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except Exception as e:
        _log.warning("morning_briefing subcall failed: %s", e)
        return default


#: A sentence end this early in the limit is not worth ending on: the clip would throw away
#: most of the text to finish on a two-word sentence.
_MIN_SENTENCE_SHARE = 0.4


def clip_spoken(text: Any, limit: int, *, close: bool = True) -> str:
    """`text` shortened to at most `limit` characters WITHOUT cutting a word (fin walk K5).

    ⚰️ Every limit here was a character slice. The weekly focus came out as "...a month of
    unlabeled ones. Af" and the next sentence was glued to the stub: "Af Tap me when you're
    ready to dig in."

    Ends on the last whole sentence inside the limit when that keeps a fair share of the
    text. Otherwise ends on the last whole word and, with `close`, adds a full stop so the
    next spoken part starts a new sentence. Text that already fits is returned as written.
    """
    s = str(text or "").strip()
    if len(s) <= limit:
        return s
    head = s[:limit]
    last_end = -1
    for i, ch in enumerate(head):
        if ch in ".!?" and s[i + 1:i + 2].isspace():
            last_end = i
    if last_end >= 0 and last_end + 1 >= limit * _MIN_SENTENCE_SHARE:
        return head[:last_end + 1]
    if s[limit:limit + 1].isspace():
        cut = head                                   # the limit fell exactly between two words
    else:
        space = head.rfind(" ")
        cut = head[:space] if space > 0 else head    # one word longer than the limit: keep its start
    cut = cut.rstrip(" ,;:-")
    if not close or (cut and cut[-1] in ".!?"):
        return cut
    if len(cut) + 1 > limit:                         # no room for the full stop: give up a word
        space = cut.rfind(" ")
        cut = cut[:space].rstrip(" ,;:-") if space > 0 else cut[:limit - 1]
    return cut + "."


def _format_positions(positions: list[dict]) -> str:
    if not positions:
        return "You have no open positions."
    parts = []
    for p in positions[:5]:
        sym = (p.get("symbol") or "?").upper()
        side = (p.get("side") or "LONG").upper()
        parts.append(f"{sym} {side}")
    summary = ", ".join(parts)
    if len(positions) > 5:
        summary += f", and {len(positions) - 5} more"
    return f"You're holding: {summary}."


def _format_interventions(items: list[dict]) -> str:
    if not items:
        return ""
    msgs = []
    for i in items[:2]:
        rule = i.get("rule") or ""
        msgs.append(rule.replace("_", " "))
    return f"Active interventions to surface: {', '.join(msgs)}."


def build_briefing(user_id: str) -> dict[str, Any]:
    """Assemble today's briefing for a user. Returns
    {date, script, sections, generated_at}."""
    today = datetime.now(_ET).date().isoformat()
    cache_key = f"briefing::{user_id}::{today}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        out = dict(cached)
        out["cached"] = True
        return out

    sections: dict[str, Any] = {"date": today}

    # 1. Regime
    regime_line = _safe(
        lambda: __import__("api.services.voice_regime_classifier", fromlist=["build_regime_prompt_line"])
                    .build_regime_prompt_line(),
        "",
    )
    sections["regime"] = clip_spoken(regime_line, 300)

    # 2. Overnight market news (Perplexity finance pack, recency=hour-ish)
    news_summary = _safe(
        lambda: __import__("api.services.perplexity_search", fromlist=["web_search"])
                    .web_search(
                        "Overnight market news + pre-market movers + key macro/earnings developments for US equities right now",
                        mode="fast", recency="hour", domain_pack="finance",
                        max_tokens=350,
                    ),
        {},
    )
    sections["news"] = clip_spoken((news_summary or {}).get("answer", ""), 600)

    # 3. Top catalysts (from existing Opus-scored table)
    catalysts = _safe(
        lambda: __import__("api.services.catalyst.store", fromlist=["get_for_date"])
                    .get_for_date(today, ranked_only=True),
        [],
    )
    sections["catalysts"] = [
        {"rank": c.get("rank"), "ticker": c.get("ticker"),
         "headline": clip_spoken(c.get("headline"), 120, close=False)}
        for c in (catalysts or [])[:5]
    ]

    # 4. Trader state (positions + interventions + focus)
    try:
        from api.services.voice_session_context import (
            _resolve_account_id, _load_positions, _load_interventions,
            _load_weekly_focus,
        )
        from api.services.auth_db import get_connection
        conn = get_connection()
        try:
            account_id = _resolve_account_id(conn, user_id)
            if account_id:
                positions = _load_positions(conn, user_id, account_id)
                interventions = _load_interventions(conn, user_id, account_id)
                focus = _load_weekly_focus(conn, user_id, account_id)
            else:
                positions, interventions, focus = [], [], ""
        finally:
            conn.close()
    except Exception as e:
        _log.warning("morning_briefing trader state failed: %s", e)
        positions, interventions, focus = [], [], ""
    sections["positions_summary"] = _format_positions(positions)
    sections["interventions_summary"] = _format_interventions(interventions)
    sections["weekly_focus"] = clip_spoken(focus, 300)

    # Build the spoken script — 40-60 seconds of voice
    script_parts = ["Good morning. Here's your briefing."]
    if sections["regime"]:
        script_parts.append(f"Regime: {sections['regime']}")
    if sections["positions_summary"]:
        script_parts.append(sections["positions_summary"])
    if sections["weekly_focus"]:
        script_parts.append(f"This week's focus: {sections['weekly_focus']}")
    if sections["interventions_summary"]:
        script_parts.append(sections["interventions_summary"])
    if sections["news"]:
        script_parts.append(f"Overnight news: {clip_spoken(sections['news'], 300)}")
    if sections["catalysts"]:
        cat_summary = ", ".join(
            f"{c['ticker']}" for c in sections["catalysts"][:5] if c.get("ticker")
        )
        if cat_summary:
            script_parts.append(f"Top catalysts in play: {cat_summary}.")
    script_parts.append("Tap me when you're ready to dig in.")

    script = " ".join(script_parts)

    result = {
        "date": today,
        "script": script,
        "sections": sections,
        "generated_at": datetime.now(_ET).isoformat(),
        "cached": False,
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
