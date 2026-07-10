"""Peer read-through — one AI sentence on a sector's earnings setup this week.

The cheap corpus differentiator from the flagship spec: "one cached Claude call
per sector per day, cost-guarded." When a user scopes the calendar to a GICS
sector, this returns a single swing-trader-oriented read grounded on that
sector's ACTUAL reporters this week (tickers + caps + sessions), not generic
market commentary.

Cost posture (the catalyst tuner melted the shared budget this same month — be
conservative):
  - Cached per (sector, week), 12h TTL, with a __null__ negative cache so a
    failed/empty generation isn't retried every poll.
  - Guarded by the SHARED catalyst cost_guard daily cap (same as call_recap) —
    it can never independently blow the budget.
  - Gated behind CALENDAR_SECTOR_READ_ENABLED (default ON — the owner greenlit
    it; flip to 0 to kill instantly, no redeploy of the render path).
  - Background-generated + polled (never blocks the calendar request path).
"""
from __future__ import annotations

import datetime
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo

_log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

# Inherit the catalyst Opus override on prod if set; else current Opus 4.8
# (owner preference: Opus for synthesis, never a stale/cheaper default).
_OPUS_MODEL = os.environ.get("CATALYST_OPUS_MODEL") or "claude-opus-4-8"
_READ_TTL = 12 * 3600           # refresh ~twice a day ("per sector per day")
_NULL_TTL = 3600                # short negative cache — retry within the hour
_MAX_REPORTERS = 12             # grounding context cap (prompt stays cheap)

_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="sector-read")
_INFLIGHT: set[str] = set()
_INFLIGHT_GUARD = threading.Lock()


def _enabled() -> bool:
    return os.environ.get("CALENDAR_SECTOR_READ_ENABLED", "1") == "1"


def _cache():
    from api.services.cache import cache
    return cache


def _cost_guard():
    from api.services.catalyst import cost_guard
    return cost_guard


def _anthropic_client():
    import anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    return anthropic.Anthropic(api_key=api_key)


def _today_date() -> str:
    return datetime.datetime.now(_ET).date().isoformat()


def _key(sector: str, week: str) -> str:
    return f"sector_read::{sector}::{week}"


def _fmt_cap(mc_b) -> str:
    if not mc_b or mc_b <= 0:
        return ""
    if mc_b >= 1000:
        return f"${mc_b / 1000:.1f}T"
    if mc_b >= 1:
        return f"${round(mc_b)}B"
    return f"${round(mc_b * 1000)}M"


def get_cached(sector: str, week: str):
    """Read-only cache peek. Returns the dict, None (never generated), or the
    sentinel string '__null__' (generated → nothing usable)."""
    return _cache().get(_key(sector, week))


def status_for(sector: str, week: str) -> dict:
    """The endpoint's view: cached line, generating, or unavailable."""
    if not _enabled():
        return {"status": "unavailable"}
    hit = get_cached(sector, week)
    if hit == "__null__":
        return {"status": "unavailable"}
    if isinstance(hit, dict):
        return {"status": "ready", **hit}
    return {"status": "generating"}


def request_generation(sector: str, week: str, reporters: list[dict]) -> None:
    """Fire a deduped background generation for (sector, week). No-op if
    disabled, already cached, already in flight, or the budget is spent."""
    if not _enabled():
        return
    ck = _key(sector, week)
    if _cache().get(ck) is not None:      # already generated (dict or __null__)
        return
    with _INFLIGHT_GUARD:
        if ck in _INFLIGHT:
            return
        _INFLIGHT.add(ck)

    def _job():
        try:
            _generate(sector, week, reporters)
        except Exception as exc:          # never let a bad job crash the pool
            _log.warning("[sector_read] job failed for %s/%s: %s", sector, week, exc)
        finally:
            with _INFLIGHT_GUARD:
                _INFLIGHT.discard(ck)

    _POOL.submit(_job)


def _generate(sector: str, week: str, reporters: list[dict]) -> None:
    ck = _key(sector, week)
    cache = _cache()

    if not reporters:
        cache.set(ck, "__null__", _NULL_TTL)
        return

    market_date = _today_date()
    guard = _cost_guard()
    if not guard.may_synthesize(market_date):
        _log.info("[sector_read] cost cap reached, skipping %s/%s", sector, week)
        # NOT cached — retry once the budget frees up (don't poison with __null__).
        return

    # Grounding: the biggest reporters in this sector this week.
    top = sorted(reporters, key=lambda r: (r.get("mc_b") or 0), reverse=True)[:_MAX_REPORTERS]
    lines = []
    for r in top:
        cap = _fmt_cap(r.get("mc_b"))
        sess = (r.get("timing") or "").upper()
        nm = r.get("name") or ""
        lines.append(f"- {r.get('sym')} {nm} {cap} {sess}".rstrip())
    roster = "\n".join(lines)

    prompt = (
        f"You are a desk strategist briefing a swing trader. In ONE sentence "
        f"(max 32 words, no hype, no disclaimer, no preamble), give the read on "
        f"{sector} earnings this week. Name the bellwether to watch and the single "
        f"signal that matters most (guidance, demand, margins, or a shared theme). "
        f"Ground it ONLY in these companies actually reporting this week:\n{roster}\n\n"
        f"Return only the sentence."
    )
    try:
        client = _anthropic_client()
        resp = client.messages.create(
            model=_OPUS_MODEL,
            max_tokens=120,
            messages=[{"role": "user", "content": prompt}],
        )
        line = (resp.content[0].text or "").strip().strip('"').strip()
        guard.record(
            market_date=market_date,
            ticker=f"sector:{sector}",
            model=_OPUS_MODEL,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
        )
        if not line or len(line) < 8:
            cache.set(ck, "__null__", _NULL_TTL)
            return
        cache.set(ck, {"line": line, "model": _OPUS_MODEL, "at": market_date}, _READ_TTL)
    except Exception as exc:
        _log.warning("[sector_read] LLM synthesis failed for %s: %s", sector, exc)
        cache.set(ck, "__null__", _NULL_TTL)
