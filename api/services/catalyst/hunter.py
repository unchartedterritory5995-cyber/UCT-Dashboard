"""Catalyst Hunter — a live-web-search discovery agent.

Where the rest of the pipeline only *summarizes* pre-fetched feeds, the hunter
goes *looking*: it runs Claude with the server-side web-search tool and
adaptive reasoning to sweep every catalyst category pre-market — earnings,
analyst rating/PT changes, M&A, FDA, guidance, contracts, index changes,
offerings, halts, other material news — and returns structured candidates,
INCLUDING names that haven't moved yet.

Output is one JSON object: {"hits": [ {ticker, catalyst_type, headline,
source_url, when, moving_yet}, ... ]}. We instruct the model to return JSON
(rather than using output_config.format) so the structured-output path doesn't
have to coexist with the server-tool loop; parsing is defensive.

Cost controls (2026-07-02 — the hunter was ~$28/day before these):
  - deep sweeps use CATALYST_HUNTER_MODEL (default claude-opus-4-8); light
    follow-ups use CATALYST_HUNTER_LIGHT_MODEL (default claude-sonnet-5)
  - web_search capped via max_uses (CATALYST_HUNTER_MAX_SEARCHES_DEEP=12 /
    _LIGHT=4); search fees ($10/1k) are cost-logged alongside tokens
  - prompt caching on pause_turn continuations (re-reads bill ~0.1x)
  - hunts respect the daily cost caps (cost_guard.may_synthesize) BEFORE spending
  - the engine only hunts on designated ticks — see run_refresh(hunt=...)

Fail-open: ANY error returns []. Gated on CATALYST_HUNTER_ENABLED (default off).
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
from typing import Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

# Deep sweep model: CATALYST_HUNTER_MODEL (default claude-opus-4-8).
# Light sweeps use CATALYST_HUNTER_LIGHT_MODEL (default claude-sonnet-5) —
# "what's new in the last 30 minutes" is a search-and-list task, not Opus work.
# Both resolved per-call inside run_hunt().
_MAX_ITERS = int(os.environ.get("CATALYST_HUNTER_MAX_ITERATIONS", "8"))

# The catalyst taxonomy the hunter is allowed to emit. Anything else → "News".
HUNTER_TYPES = {
    "Earnings", "Analyst", "M&A", "FDA", "Guidance",
    "Contract", "Index", "Offering", "Halt", "News",
}

_SYSTEM = """You are a pre-market catalyst scout for a professional US equities trading desk. \
Your job is COVERAGE: find every US-listed stock with a real, company-specific catalyst \
for today's session, INCLUDING names that have not moved yet.

Hunt every category: earnings (beat/miss/guidance), analyst rating changes and price-target \
changes (upgrades/downgrades), M&A / takeover / strategic review, FDA / regulatory \
(approval/CRL/trial data), major contract or customer win, index inclusion/removal, secondary \
offering / dilution, trading halt or resumption, and other material company-specific news.

Rules:
- Company-specific only. EXCLUDE macro, sector-wide, or index-level commentary.
- Real, sourced events only — each hit must rest on an actual article or release. Never invent.
- US-listed common equities only (no ETFs, funds, OTC pink-sheet pumps, or crypto tokens).
- Include a name even if it is flat / only up 1% — early detection is the point.

Use web search as many times as needed to cover the categories; reason about which categories \
you have not yet covered and search again.

Return ONLY a single JSON object, no prose before or after:
{"hits": [{"ticker": "AAPL", "catalyst_type": "Analyst", "headline": "Morgan Stanley raised PT to $250 (Overweight)", "source_url": "https://...", "when": "pre-market", "moving_yet": false}]}

catalyst_type must be one of: Earnings, Analyst, M&A, FDA, Guidance, Contract, Index, Offering, Halt, News."""


def _today_et() -> str:
    return dt.datetime.now(_ET).strftime("%A, %B %d, %Y")


def _deep_prompt() -> str:
    return (
        f"It is {_today_et()}, pre-market. Do a THOROUGH sweep: find every US-listed "
        f"stock with a material company-specific catalyst for today across ALL categories. "
        f"Aim for breadth — earnings reporters, analyst actions, M&A, FDA, guidance, "
        f"contracts, index changes, offerings, halts, and other hard news. Return the JSON object now."
    )


def _light_prompt(existing: set[str]) -> str:
    have = ", ".join(sorted(existing)[:80]) if existing else "(none yet)"
    return (
        f"It is {_today_et()}. A catalyst board already exists for today covering: {have}. "
        f"Do a FOCUSED sweep for what is NEW or CHANGED since the last check — fresh analyst "
        f"actions, just-released news, new halts/M&A/FDA, late earnings reactions. You may "
        f"re-report a listed name only if there's a materially new development. Return the JSON object now."
    )


def _extract_json_object(text: str) -> Optional[str]:
    """First balanced {...} object substring (respects quotes/escapes)."""
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def _coerce_hits(raw) -> list[dict]:
    """Validate + normalize the model's hits. Drops anything unusable.

    Accepts either a list of hit dicts or a {"hits": [...]} object."""
    if isinstance(raw, dict):
        raw = raw.get("hits", [])
    if not isinstance(raw, list):
        return []

    out: list[dict] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        ticker = str(item.get("ticker") or "").upper().strip()
        # US equity symbols: letters + optional dot-class (BRK.B), 1-6 chars.
        if not ticker or not all(c.isalpha() or c == "." for c in ticker) or len(ticker) > 6:
            continue
        if ticker in seen:
            continue
        headline = str(item.get("headline") or "").strip()
        if not headline:
            continue
        ctype = str(item.get("catalyst_type") or "").strip()
        if ctype not in HUNTER_TYPES:
            ctype = "News"
        seen.add(ticker)
        out.append({
            "ticker": ticker,
            "catalyst_type": ctype,
            "headline": headline[:300],
            "source_url": str(item.get("source_url") or "").strip()[:500],
            "when": str(item.get("when") or "").strip()[:60],
            "moving_yet": bool(item.get("moving_yet")),
        })
    return out


def _enabled() -> bool:
    return os.environ.get("CATALYST_HUNTER_ENABLED", "").lower() in ("1", "true", "yes")


def run_hunt(mode: str = "deep", existing_tickers: Optional[set[str]] = None) -> list[dict]:
    """Run one catalyst hunt. mode is 'deep' or 'light'. Returns a list of hit
    dicts (see _coerce_hits). Returns [] when disabled or on ANY error."""
    if not _enabled():
        return []
    try:
        from api.services.engine import _get_anthropic_client
        from api.services.catalyst import cost_guard, store
    except Exception:
        return []

    prompt = _light_prompt(existing_tickers or set()) if mode == "light" else _deep_prompt()
    md = dt.datetime.now(_ET).date().isoformat()

    # The hunter is the pipeline's biggest spender — honor the daily cost caps
    # BEFORE spending, not just synthesis. Fail-open if the guard itself breaks.
    try:
        if not cost_guard.may_synthesize(md):
            logger.warning("[hunter] daily cost cap reached — skipping %s hunt", mode)
            return []
    except Exception:
        pass

    try:
        client = _get_anthropic_client()
    except Exception:
        logger.exception("[hunter] no anthropic client")
        return []

    if mode == "light":
        model = os.environ.get("CATALYST_HUNTER_LIGHT_MODEL", "claude-sonnet-5")
        max_searches = int(os.environ.get("CATALYST_HUNTER_MAX_SEARCHES_LIGHT", "4"))
    else:
        model = os.environ.get("CATALYST_HUNTER_MODEL", "claude-opus-4-8")
        max_searches = int(os.environ.get("CATALYST_HUNTER_MAX_SEARCHES_DEEP", "12"))

    kwargs = dict(
        model=model,
        max_tokens=8000,
        thinking={"type": "adaptive"},
        tools=[{"type": "web_search_20260209", "name": "web_search",
                "max_uses": max_searches}],
        system=_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
        # Auto-cache the last cacheable block: pause_turn continuations re-send
        # the whole search-result history, and cache reads bill at ~0.1x.
        cache_control={"type": "ephemeral"},
    )

    in_tok = out_tok = 0
    cr_tok = cc_tok = 0      # prompt-cache read / creation tokens
    searches = 0
    msg = None
    try:
        for _ in range(max(1, _MAX_ITERS)):
            try:
                msg = client.messages.create(**kwargs)
            except TypeError:
                # SDK too old for the top-level cache_control param — drop it.
                kwargs.pop("cache_control", None)
                msg = client.messages.create(**kwargs)
            except Exception as e:
                if "temperature" in str(e).lower():
                    kwargs.pop("temperature", None)
                    msg = client.messages.create(**kwargs)
                else:
                    raise
            try:
                in_tok += msg.usage.input_tokens
                out_tok += msg.usage.output_tokens
                # this lane is prompt-CACHED: the prefix bills under these
                # fields, not input_tokens — omitting them under-counted the
                # daily caps (2026-08-28 cost census)
                cr_tok += getattr(msg.usage, "cache_read_input_tokens", 0) or 0
                cc_tok += getattr(msg.usage, "cache_creation_input_tokens", 0) or 0
            except Exception:
                pass
            try:
                stu = getattr(msg.usage, "server_tool_use", None)
                searches += int(getattr(stu, "web_search_requests", 0) or 0)
            except Exception:
                pass
            if getattr(msg, "stop_reason", None) != "pause_turn":
                break
            # Server-tool iteration limit — re-send to continue the search loop.
            kwargs["messages"] = [
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": msg.content},
            ]
    except Exception:
        logger.exception("[hunter] model call failed (mode=%s)", mode)
        return []

    # Cost-log (best-effort) so hunts count against the daily caps — including
    # the $10/1k web-search fees, which token counts alone don't capture.
    try:
        cost_guard.record(md, "__hunter__", model, in_tok, out_tok,
                          was_cached=False, search_requests=searches,
                          cache_read_tokens=cr_tok, cache_creation_tokens=cc_tok)
    except Exception:
        pass

    text = ""
    try:
        for block in (msg.content or []):
            t = getattr(block, "text", None)
            if t:
                text += t
    except Exception:
        return []

    obj = _extract_json_object(text)
    if obj is None:
        logger.warning("[hunter] no JSON object in output (mode=%s)", mode)
        return []
    try:
        parsed = json.loads(obj)
    except (json.JSONDecodeError, ValueError):
        logger.warning("[hunter] JSON parse failed (mode=%s)", mode)
        return []

    hits = _coerce_hits(parsed)
    logger.info("[hunter] mode=%s returned %d hits", mode, len(hits))
    return hits
