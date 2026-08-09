"""AI Search widget — ask anything about markets, get a cited answer.

POST /api/ai-search  { query, mode? }  ->  { answer, citations, model, elapsed_ms, ... }

Backed by Perplexity (web-search-grounded), so answers use current data + sources.

Usage guard: every non-cached query bills Perplexity, and /charts is a FREE-tier
page — so the endpoint enforces a per-user daily cap plus a global daily budget
(both env-tunable). Cached answers are free and never count against either.
Counters are in-memory (reset on redeploy — lenient by design, never user-hostile).
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sys
import threading
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.middleware.auth_middleware import (
    get_current_user_with_plan, is_paid_user, require_admin,
)
from api.services import ai_search_personal, perplexity_search

router = APIRouter(prefix="/api/ai-search", tags=["ai-search"])


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for AI Search.

    🔴 THE MONEY ROUTE. `POST ""`, `POST /stream` and `POST /signal` were
    `get_current_user` only — a session, never a plan — and signup is open and
    free. Every accepted question runs a Perplexity web search and an LLM
    synthesis **on the firm's key**, so a free registration in a loop was an
    unbounded bill charged to us on somebody else's behalf. That is money leaving
    the account, which the brief names as paid at minimum regardless of what the
    answer is worth.

    ⛔ The per-user daily cap (`_check_limits` / `_reserve`) is NOT this gate.
    It bounds one account's spend; it never asked whether the account had paid
    for any. A cap on free usage is a budget for giving the product away.

    ⚠️ `_is_paid_server` elsewhere in this file is a DIFFERENT decision — it
    chooses whether a question may read the member's own portfolio (the personal
    branch). It has never gated access, and reusing it here would conflate
    "may see their own book" with "may spend our tokens".

    ⛔ Defined HERE, never imported from a sibling — each router owns its own
    402 sentence so "which surface refused me" is readable off the message.
    Rail: `tests/test_user_definitions_auth.py::test_require_paid_is_defined_PER_ROUTER…`
    """
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="AI Search requires a paid plan")
    return user


def _is_paid_server(user):
    """Server-resolved plan — NEVER trust a client-sent plan field."""
    try:
        from api.middleware.auth_middleware import is_paid_user
        from api.services.auth_service import get_user_plan
        uid = (user or {}).get("user_id") or (user or {}).get("id")
        if not uid:
            return False
        return is_paid_user({**user, "plan": get_user_plan(uid)})
    except Exception:
        return False


# ── Personal-intent detection: is this query about the member's OWN portfolio?
# Purpose-built regex — matches "am I overexposed", "should I trim my NVDA",
# "room to add", "how's my week", "my positions/stop" phrasing. Deliberately
# does NOT match generic market/ticker questions ("is TSLA extended", "thoughts
# on NVDA") — asymmetric by design: when unsure, treat as non-personal.
_PERSONAL_INTENT_RE = re.compile(
    r"\b(am i (over ?exposed|too (concentrated|heavy)|too much in)"
    r"|should i (add|trim|hold|sell|buy)\b"
    r"|room to add|how('?s| is| am i) my|how am i doing"
    r"|my (position|positions|book|portfolio|stop|risk|heat|shares)"
    r"|(closest|near(est)?) (to )?(its )?stop"
    r"|how('?s| is) my (day|week|book))\b", re.I)


def is_personal(query, user):
    """True only when the query reads as a portfolio-intent question AND the
    member is paid AND we actually have personal data for them. Gate order is
    deliberate: cheap regex -> cheap paid check -> DB has_data probe, so the
    DB read only runs on a real candidate."""
    if not user or not (query or "").strip():
        return False
    if not _PERSONAL_INTENT_RE.search(query):
        return False
    if not _is_paid_server(user):          # cheap gate before any DB read
        return False
    try:
        uid = (user or {}).get("user_id") or (user or {}).get("id")
        return bool(uid) and ai_search_personal.has_data(uid)
    except Exception:
        return False


def _personal_uid(user) -> str | None:
    """The user_id used for personal reads. `get_current_user` returns `id`;
    `is_personal`/`_is_paid_server` read `user_id` — accept either so the branch
    fires with the real server-derived session dict."""
    u = user or {}
    return u.get("user_id") or u.get("id")


def _personal_enabled() -> bool:
    """Dark by default — flip AI_SEARCH_PERSONAL_ENABLED to arm the branch."""
    return os.environ.get("AI_SEARCH_PERSONAL_ENABLED", "").strip().lower() in ("1", "true", "yes")


# ── needs-web heuristic: does the personal query have a research/news/ticker-
# outlook component (→ fetch a fresh PUBLIC draft to fold in), or is it PURE
# self-state (→ skip Perplexity entirely: one hop, streams immediately, half
# the cost)? Asymmetric: a research signal wins; otherwise default to no web.
_PERSONAL_SELF_STATE_RE = re.compile(
    r"\b(am i (over ?exposed|too (concentrated|heavy)|too much in)"
    r"|how('?s| is| am i) (my )?(book|week|day|portfolio|risk|heat|exposure|doing)"
    r"|how am i doing"
    r"|my (heat|risk|exposure|book|portfolio)\b(?!.*\b(news|earnings|catalyst)\b))\b", re.I)
_PERSONAL_RESEARCH_RE = re.compile(
    r"\b(given the news|the news\b|news on|catalyst|earnings|report(?:ing|s)?\b"
    r"|should i (add|buy|sell|trim|hold)"
    r"|outlook|forecast|guidance|analyst|price target|upgrade|downgrade"
    r"|extended|setup|chart|thesis|fair value|valuation|target"
    r"|why (?:is|did|are)|moving|today|tonight|premarket|pre-market|this week)\b", re.I)


def _needs_web(query: str, question_type: str | None = None) -> bool:
    q = query or ""
    if _PERSONAL_RESEARCH_RE.search(q):
        return True
    if _PERSONAL_SELF_STATE_RE.search(q):
        return False
    return False


async def _fetch_personal_draft(body, public_system: str, salt: str) -> tuple[str, list]:
    """Collect the PUBLIC web draft to fold into synthesis. INVARIANT #1: the
    Perplexity leg receives ONLY the current query and history=None — the widget
    `history` (which may contain a prior personal answer with positions/P&L) is
    NEVER passed here. `public_system` is `_grounded_system`'s output — no
    personal data. Best-effort: any failure yields an empty draft."""
    answer, citations = "", []
    async for ev in perplexity_search.stream_search(
        body.query, max_tokens=500, system=public_system, mode="fast",
        domain_pack="finance", recency=_auto_recency(body.query),
        related=False, cache_salt=salt, history=None,   # ← history=None, never body.history
    ):
        if ev.get("type") == "final":
            answer = ev.get("answer") or ""
            citations = ev.get("citations") or []
    return answer, citations


def _resolve_personal(uid, query: str):
    """Blocking: build the PUBLIC grounded system (no personal data) + resolve the
    single account. Returns (account_id, public_system, salt, meta) or None to
    decline (zero accounts → fall through to the normal public path). Runs off the
    event loop (grounding reads + memory embedding block)."""
    system, salt, meta = _grounded_system(query)
    tickers = meta.get("query_tickers") or []
    try:
        account_id = ai_search_personal.resolve_account(uid, tickers)
    except Exception:
        account_id = None
    if account_id is None:
        return None
    return account_id, system, salt, meta


async def _personal_gen(body, uid, account_id, public_system, salt, meta):
    """Async SSE generator for the personal branch (stream endpoint).

    Order is load-bearing for privacy:
      • emit `meta {personal:true}` FIRST (position-aware waiting state, no dead-air)
      • PUBLIC draft (invariant #1: history=None) only when the query needs web
      • assemble the PERSONAL block (best-effort) — goes ONLY to synthesize()
      • per-user atomic synth reserve; over-cap → PUBLIC draft in-band (never raise)
      • synthesis error/empty → refund the synth reservation + PUBLIC draft in-band
      • NEVER `_log_answer` anywhere here (invariant #2, branch-keyed skip)
      • never writes the synthesized answer to any shared cache (invariant #3)
    """
    from api.services import ai_search_log
    answer_id = ai_search_log_new_id()
    yield f"data: {json.dumps({'type': 'meta', 'personal': True, 'answer_id': answer_id})}\n\n"
    tickers = meta.get("query_tickers") or []
    draft, citations = "", []
    if _needs_web(body.query, meta.get("question_type")):
        try:
            draft, citations = await _fetch_personal_draft(body, public_system, salt)
        except Exception:
            draft, citations = "", []
    loop = asyncio.get_running_loop()
    try:
        personal_block = await loop.run_in_executor(
            None, ai_search_personal.assemble, uid, account_id, body.query, tickers)
    except Exception:
        personal_block = ""
    live_desk = meta.get("ctx_block") or ""

    if not ai_search_personal.reserve_synth(uid):
        # Over the synth cost cap → degrade to the PUBLIC draft, flagged so the
        # UI can show "general answer (personalization paused)". No reservation
        # was taken, so nothing to refund.
        await loop.run_in_executor(None, ai_search_log.record_personal_invocation, True)
        final = {"type": "final", "answer": draft, "citations": citations,
                 "personal": True, "personalization_paused": True, "answer_id": answer_id}
        yield f"data: {json.dumps(final)}\n\n"
        return

    parts: list[str] = []
    try:
        async for delta in ai_search_personal.synthesize(
                body.query, draft, personal_block, live_desk, body.history):   # FULL history → synthesis ONLY
            if delta:
                parts.append(delta)
                yield f"data: {json.dumps({'type': 'delta', 'text': delta})}\n\n"
        answer = "".join(parts).strip()
        if not answer:
            ai_search_personal.refund_synth(uid)   # produced nothing → give the reservation back
            await loop.run_in_executor(None, ai_search_log.record_personal_invocation, True)
            final = {"type": "final", "answer": draft, "citations": citations,
                     "personal": True, "personalization_paused": True, "answer_id": answer_id}
            yield f"data: {json.dumps(final)}\n\n"
            return   # mirror _personal_single: don't leave this yield reachable by the except below
        await loop.run_in_executor(None, ai_search_log.record_personal_invocation, False)
        final = {"type": "final", "answer": answer, "citations": citations,
                 "personal": True, "answer_id": answer_id}
        yield f"data: {json.dumps(final)}\n\n"
    except Exception:
        # Synthesis error/timeout AFTER a successful reserve → refund + emit the
        # already-fetched PUBLIC draft as the final IN-BAND (never raise, never
        # null: the widget must not re-run the whole 2× branch via single-shot).
        ai_search_personal.refund_synth(uid)
        await loop.run_in_executor(None, ai_search_log.record_personal_invocation, True)
        fallback = "".join(parts).strip() or draft
        final = {"type": "final", "answer": fallback, "citations": citations,
                 "personal": True, "personalization_paused": True, "answer_id": answer_id}
        yield f"data: {json.dumps(final)}\n\n"
    # INVARIANT #2: no `_log_answer` on this branch — decided at branch entry,
    # covering every exit above (success, over-cap degrade, synthesis failure).
    # record_personal_invocation is the ONE content-free exception — it stores
    # no query/answer text, only a per-day invocation+degraded tally.


async def _personal_single(body, uid, account_id, public_system, salt, meta) -> dict:
    """Single-shot (non-streamed) twin of `_personal_gen` — collect synthesis to a
    string. Same no-log / no-cache / in-band-fallback rules; returns a dict shaped
    like the public single-shot response, carrying personal:true."""
    from api.services import ai_search_log
    answer_id = ai_search_log_new_id()
    tickers = meta.get("query_tickers") or []
    draft, citations = "", []
    if _needs_web(body.query, meta.get("question_type")):
        try:
            draft, citations = await _fetch_personal_draft(body, public_system, salt)
        except Exception:
            draft, citations = "", []
    loop = asyncio.get_running_loop()
    try:
        personal_block = await loop.run_in_executor(
            None, ai_search_personal.assemble, uid, account_id, body.query, tickers)
    except Exception:
        personal_block = ""
    live_desk = meta.get("ctx_block") or ""
    base = {"citations": citations, "personal": True, "answer_id": answer_id,
            "model": None, "mode": "personal"}

    if not ai_search_personal.reserve_synth(uid):
        ai_search_log.record_personal_invocation(degraded=True)
        return {**base, "answer": draft, "personalization_paused": True}

    parts: list[str] = []
    try:
        async for delta in ai_search_personal.synthesize(
                body.query, draft, personal_block, live_desk, body.history):
            if delta:
                parts.append(delta)
        answer = "".join(parts).strip()
        if not answer:
            ai_search_personal.refund_synth(uid)
            ai_search_log.record_personal_invocation(degraded=True)
            return {**base, "answer": draft, "personalization_paused": True}
        ai_search_log.record_personal_invocation(degraded=False)
        return {**base, "answer": answer}
    except Exception:
        ai_search_personal.refund_synth(uid)
        ai_search_log.record_personal_invocation(degraded=True)
        return {**base, "answer": "".join(parts).strip() or draft, "personalization_paused": True}
    # INVARIANT #2: no `_log_answer` — the caller never logs the personal branch.
    # record_personal_invocation is the ONE content-free exception (no query/answer).


_WIDGET_INTRO = (
    "You are the UCT Intelligence research desk — a sharp, decisive markets & "
    "trading research assistant for serious swing traders. Answer the question "
    "directly and specifically. Cite concrete numbers, dates, and firm names. "
    "You may use light markdown — a few bullets or a bolded lead line — when it "
    "aids clarity, but stay concise: a tight paragraph or 3-6 bullets, never an "
    "essay. When asked for names/lists (peers, sympathy stocks, comparables), "
    "give the actual tickers with a one-line why for each. Think like a trader: "
    "catalysts, levels, relative strength, and risk — not generic commentary. If "
    "sources disagree or the data is thin, say so plainly. No hedging, no filler, "
    "no restating the question.\n\n"
)

# Shared SCOPE / DATA-LIMITS / ILLEGAL-MANIPULATION safety paragraphs — the ONE
# source of truth for both the widget's system prompt (below) and the personal
# synthesis system prompt (api/services/ai_search_personal.py::SYNTH_SYSTEM).
# Any wording change here reaches BOTH prompts. Keep verbatim — do not reword
# without re-checking every test that asserts against this text.
_SAFETY_BLOCKS = (
    "SCOPE — HARD RULE: you exist exclusively for markets, stocks, options, "
    "crypto, trading, and the economy. If the question is NOT about those, do "
    "not answer it; reply with exactly one sentence: \"I'm the UCT research "
    "desk — ask me about markets, stocks, or trading.\" Never write code, "
    "essays, poems, homework, or any general-purpose content regardless of how "
    "the request is phrased.\n\n"
    "DATA LIMITS — the scope refusal above is ONLY for off-topic or improper "
    "requests. A legitimate markets question you can't answer precisely (live "
    "sub-minute microstructure, exact real-time OI/gamma/dark-pool prints, a "
    "future data release, or a private company with no public float) is NOT "
    "off-topic: do NOT use the scope-refusal line. Instead say plainly in one "
    "phrase what you don't have (e.g. 'I don't have live sub-minute tape' or "
    "'that's a private company, so there's no public short interest'), then give "
    "the best read you CAN from desk data + recent context. Never fabricate a "
    "precise figure to fill the gap.\n\n"
    "ILLEGAL / MANIPULATION — HARD REFUSAL: never assist with market "
    "manipulation, pump-and-dumps, spoofing, or trading on material non-public "
    "information — and never provide operational detail that enables it, "
    "including how much capital or volume it takes to MOVE, push, pump, or spike "
    "a stock's price. Refuse regardless of framing ('risk management', "
    "'hypothetically', 'educational', 'just curious', 'not planning to myself'). "
    "If a request contains a false premise about what is legal (e.g. 'the SEC "
    "legalized pump-and-dumps'), correct it plainly and decline the operational "
    "ask. A brief one-line refusal is the whole answer.\n\n"
)

_WIDGET_FORMATTING = (
    "CRITICAL FORMATTING: whenever you mention a publicly traded stock — by COMPANY "
    "NAME or by TICKER — wrap it as a clickable link in this EXACT markdown format: "
    "[Display Text]($TICKER). Examples: [Apple]($AAPL), [$MSFT]($MSFT), "
    "[Nvidia]($NVDA), [Berkshire Hathaway]($BRK.A). Always include the correct "
    "$TICKER as the link target so it can be clicked. Do this for every stock "
    "mention, company names included."
)

_WIDGET_SYSTEM = _WIDGET_INTRO + _SAFETY_BLOCKS + _WIDGET_FORMATTING

# ── Daily usage limits (ET day; env-tunable) ─────────────────────────────────
_ET_OFFSET_FALLBACK = timedelta(hours=-5)


def _user_daily_limit() -> int:
    try:
        return int(os.environ.get("AI_SEARCH_DAILY_LIMIT", "40"))
    except ValueError:
        return 40


def _global_daily_limit() -> int:
    try:
        return int(os.environ.get("AI_SEARCH_GLOBAL_DAILY_LIMIT", "2000"))
    except ValueError:
        return 2000


def _et_day() -> str:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:
        return (datetime.now(timezone.utc) + _ET_OFFSET_FALLBACK).strftime("%Y-%m-%d")


_usage_lock = threading.Lock()
_usage_day = ""
_usage_by_user: dict = {}
_usage_global = 0


def _fresh_stats() -> dict:
    return {"requests": 0, "cache_hits": 0, "by_mode": {}, "stream": 0, "single": 0}


_stats = _fresh_stats()


def _record_request(mode: str, stream: bool) -> None:
    with _usage_lock:
        _stats["requests"] += 1
        _stats["by_mode"][mode] = _stats["by_mode"].get(mode, 0) + 1
        _stats["stream" if stream else "single"] += 1


def _record_cache_hit() -> None:
    with _usage_lock:
        _stats["cache_hits"] += 1


def _roll_day_locked() -> None:
    """Reset counters at the ET day boundary. Caller must hold _usage_lock."""
    global _usage_day, _usage_by_user, _usage_global, _stats
    day = _et_day()
    if day != _usage_day:
        _usage_day, _usage_by_user, _usage_global = day, {}, 0
        _stats = _fresh_stats()


def _check_limits(user_id) -> None:
    """Raise 429 if the user or the whole app is already over budget."""
    with _usage_lock:
        _roll_day_locked()
        if _usage_global >= _global_daily_limit():
            raise HTTPException(
                status_code=429,
                detail="AI research is cooling down for the day — try again tomorrow.",
            )
        if _usage_by_user.get(user_id, 0) >= _user_daily_limit():
            raise HTTPException(
                status_code=429,
                detail="You've hit today's research limit — it resets at midnight ET.",
            )


def _reserve(user_id, units: int) -> None:
    """ATOMIC check-and-reserve: verify AND increment under ONE lock hold so
    concurrent requests can't all pass a separate gate and blow the cap
    (check-then-act race). Reserved BEFORE the upstream call commits, so a
    client that disconnects mid-stream is still billed for the Perplexity spend.
    Raise 429 if the reservation would exceed either limit."""
    global _usage_global
    with _usage_lock:
        _roll_day_locked()
        if _usage_global + units > _global_daily_limit():
            raise HTTPException(
                status_code=429,
                detail="AI research is cooling down for the day — try again tomorrow.",
            )
        if _usage_by_user.get(user_id, 0) + units > _user_daily_limit():
            raise HTTPException(
                status_code=429,
                detail="You've hit today's research limit — it resets at midnight ET.",
            )
        _usage_by_user[user_id] = _usage_by_user.get(user_id, 0) + units
        _usage_global += units


def _refund(user_id, units: int) -> None:
    """Give back a reservation when the search turned out free (cache hit) or
    failed (error/empty) — never bill for a non-answer."""
    global _usage_global
    with _usage_lock:
        _usage_by_user[user_id] = max(0, _usage_by_user.get(user_id, 0) - units)
        _usage_global = max(0, _usage_global - units)


def _record_billed(user_id, units: int = 1) -> None:
    # Retained for back-compat; new paths use _reserve/_refund.
    _reserve(user_id, units)


# ── Auto-recency: "what's moving TODAY" questions should search today's web,
# not last month's articles. Perplexity's recency filter does exactly that;
# infer it from the phrasing so members never have to think about it.
# Fundamental/history questions match nothing and stay unfiltered.
# Unambiguous "today" markers — always day-recency regardless of ticker.
_RECENCY_DAY_EXPLICIT = re.compile(
    r"\b(today|tonight|right now|premarket|pre-market|after[- ]hours|this morning"
    r"|moving(?!\s+average)|\bmovers?\b|gapp(?:ed|ing)|gaps?\s+(?:up|down)|halted)\b",
    re.I)
# "why is/did … <price verb>" is day-hot ONLY when a real ticker is named —
# "why did NVDA crash" (day) vs "why did the 1987 crash happen" (evergreen).
_WHY_MOVE_RE = re.compile(
    r"\bwhy (?:is|did|are|has)\b[^?.!]{0,40}?"
    r"\b(?:up|down|moving|gapp|dropp|fall|spik|surg|tank|rally|rip|dump|crash|sink"
    r"|jump|pop|slid|plung|soar|sell|rall|bounce|break)", re.I)
_RECENCY_WEEK_RE = re.compile(
    r"\b(this week|latest|recent|recently|past few days"
    # up/downgrades only in a ticker/analyst context, not general education
    r"|(?:up|down)grades?\b[^?.!]{0,30}?\b(?:on|for|to)\b|analyst|price target"
    r"|news on)\b", re.I)


def _auto_recency(q: str) -> str | None:
    q = q or ""
    if _RECENCY_DAY_EXPLICIT.search(q):
        return "day"
    if _WHY_MOVE_RE.search(q) and _extract_tickers(q):
        return "day"
    if _RECENCY_WEEK_RE.search(q):
        return "week"
    return None


# ── Mode escalation: harder questions deserve a stronger model. An explicit
# client mode ("fast"/"reasoning") is respected; otherwise route by phrasing —
# deep-analysis asks → sonar-reasoning-pro, comparison/list/outlook asks (or
# genuinely long questions) → sonar-pro, everything else stays on base sonar.
# Reasoning costs ~2x, so it bills 2 quota units.
_REASONING_RE = re.compile(
    r"\b(analy(?:s[ei]s|[sz]e|[sz]ing)|deep dive|in[- ]depth|bull case|bear case"
    r"|thesis|valuation|dcf|detailed (analysis|breakdown)|full breakdown"
    r"|(?:full |deep )?break ?down of|pros and cons)\b", re.I)
_FAST_RE = re.compile(
    r"\b(compare|comparison|versus|vs\.?|competitors?|comparables?|peers?"
    r"|outlook|forecast|guidance|rank(ed|ing)?|which (names|stocks)"
    r"|best .{0,20}(stocks|names|plays)|sympathy)\b", re.I)


def _auto_mode(query: str, client_mode: str) -> str:
    if client_mode in ("fast", "reasoning"):
        return client_mode
    q = query or ""
    if _REASONING_RE.search(q):
        return "reasoning"
    if _FAST_RE.search(q) or len(q.split()) > 18:
        return "fast"
    # Default tier: sonar-pro (owner call 2026-07-18 — first-impression answer
    # depth beats the ~2x per-query cost; revisit via usage stats if spend bites).
    return "fast"


def _billing_units(mode: str) -> int:
    return 2 if mode == "reasoning" else 1


# ── UCT grounding: inject the desk's own numbers (regime + live quotes for
# tickers named in the question) into the system prompt, so answers carry data
# Perplexity can't see. Every piece is a cached internal read (regime 15-min,
# snapshots 15s) — best-effort, never blocks or fails the search.
_TICKER_STOP = {
    "A", "I", "AI", "AN", "AT", "BE", "BY", "DO", "GO", "IF", "IN", "IS", "IT",
    "ME", "MY", "NO", "OF", "OK", "ON", "OR", "SO", "TO", "UP", "US", "WE",
    "ALL", "AND", "ANY", "ARE", "BIG", "CAN", "CEO", "CFO", "DID", "EPS", "ETF",
    "FOR", "GET", "HAS", "HOW", "IPO", "LOW", "NEW", "NOW", "OUT", "PE", "SEC",
    "THE", "TOP", "USD", "WAS", "WHO", "WHY", "YES", "YOY", "HIGH", "WHAT",
    "WEEK", "GOOD", "BEST", "NEXT", "LAST", "MOVE", "NAME", "LIST",
    # Options / trading jargon that collide with real cap_universe tickers and
    # would inject the WRONG company as authoritative desk context:
    "PM", "AM", "MA", "DTE", "OI", "DD", "ES", "DOW", "EOD", "ATH", "ATL",
    "IV", "RSI", "MACD", "VWAP", "ADR", "RS", "PT", "EOW", "EOM", "YTD", "GEX",
    "OTM", "ITM", "ATM", "COT", "FOMC", "CPI", "GDP", "PCE", "QE", "SI", "FA",
    "TA", "EV", "TAM", "YOLO", "HODL", "FUD", "DCA", "PA",
}
_UNI: set | None = None
# A stop-listed symbol that IS a real ticker (NOW=ServiceNow, LOW=Lowe's,
# HAS=Hasbro, ALL=Allstate, DD=DuPont, PM=Philip Morris, MA=Mastercard …) can
# still be a genuine mention — extract it only on a STRONG ticker-position cue.
_STRONG_TICKER_CUE = re.compile(
    r"(?:\b(?:is|why is|why did|about|on|buy|sell|short|long|thoughts on|hold|own"
    r"|trading|chart|setup on|flow on|price of)\s+)([A-Z]{1,5})\b"
    r"|\b([A-Z]{1,5})\s+(?:stock|shares|calls?|puts?|earnings|chart)\b")


def _universe() -> set:
    global _UNI
    if _UNI is None:
        try:
            from api.routers.ticker_search import _UNIVERSE
            _UNI = set(_UNIVERSE)
        except Exception:
            _UNI = set()
    return _UNI


def _extract_tickers(query: str) -> list[str]:
    """Tickers named in the query, in document order (order matters — the
    grounding caps at the first 2-3 symbols).

    - $CASHTAG (incl. class shares $BRK.B / $BRK-B) is always trusted; the
      trailing (?![A-Za-z]) makes $NVIDIA match nothing rather than a fragment.
    - bare UPPERCASE must be in cap_universe and not a stopword; a stop-listed
      symbol that IS a real ticker (NOW/LOW/HAS…) needs a strong position cue.
    """
    q = query or ""
    strong = {(a or b).upper() for a, b in _STRONG_TICKER_CUE.findall(q)}
    uni = _universe()
    out: list[str] = []
    # One left-to-right pass over BOTH forms so order = mention order.
    for m in re.finditer(r"\$([A-Za-z]{1,5}(?:[.\-][A-Za-z])?)(?![A-Za-z])|\b([A-Z]{2,5})\b", q):
        cash, bare = m.group(1), m.group(2)
        if cash:
            sym = cash.upper().replace("-", ".")
            if sym not in out:
                out.append(sym)
            continue
        sym = bare.upper()
        if sym in out:
            continue
        if sym in _TICKER_STOP:
            if sym in strong and sym in uni:
                out.append(sym)
            continue
        if sym in uni:
            out.append(sym)
    return out


def _regime_provider() -> dict:
    from api.services.voice_tool_impls import _get_regime
    return _get_regime() or {}


def _quote_provider(sym: str) -> dict:
    from api.services.voice_tool_impls import _get_quote
    return _get_quote(sym) or {}


# ── Intent-routed desk feeds. Every provider reads an ALREADY-CACHED internal
# (wire push, 15s-30s live caches, catalysts.db) — never a cold external call —
# and returns a short line or "". All best-effort.

def _ctx_catalyst(sym: str) -> str:
    from api.services.catalyst import store as _cstore
    row = _cstore.get_ticker_for_date(sym, _et_day()) or {}
    thesis = (row.get("thesis_text") or "").strip()
    if not thesis:
        return ""
    return f"{sym} catalyst (UCT board, today): {thesis[:240]}"


def _ctx_tape(sym: str) -> str:
    """Curated-wire tweets for a ticker — the freshest data in the app
    (2-min poll cadence premarket). Perplexity's index can't compete here."""
    from api.services import tweet_store
    rows = tweet_store.tweets_for_ticker(sym, hours=8)[:2]
    if not rows:
        return ""
    lines = " | ".join((r.get("text") or "").replace("\n", " ").strip()[:130] for r in rows)
    return f"{sym} tape (UCT curated wires, last 8h): {lines}"


def _ctx_patterns(sym: str) -> str:
    """Active pattern-engine detections (entry/stop/target levels) — a local
    patterns.db read via the same tool Compass uses."""
    from api.services.voice_tool_impls import _find_patterns_on_ticker
    res = _find_patterns_on_ticker(symbol=sym) or {}
    if not (res.get("ok") and res.get("count")):
        return ""
    narr = (res.get("narration") or "").strip()
    return f"{sym} active setups (UCT pattern engine): {narr[:400]}" if narr else ""


# ── Options-flow grounding. flow.db lives on the FLOW-WORKER post-P5; the
# per-ticker read is uncapped-but-tiny (indexed, tens of rows), fetched over
# Railway private networking when the proxy is live (else self). Strict 2.5s
# budget + 60s memo — a slow flow read must never slow an answer.
_ET_FALLBACK = timezone(timedelta(hours=-5))


def _et_day_mdyyyy() -> str:
    """flow.db CreatedDate format: M/D/YYYY, no zero padding."""
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        now = datetime.now(_ET_FALLBACK)
    return f"{now.month}/{now.day}/{now.year}"


def _flow_base_url() -> str:
    try:
        from api import flow_proxy
        if flow_proxy.PROXY_ENABLED and flow_proxy.WORKER_INTERNAL_URL:
            return flow_proxy.WORKER_INTERNAL_URL
    except Exception:
        pass
    return f"http://127.0.0.1:{os.environ.get('PORT', '8000')}"


def _parse_mdyyyy(s: str):
    try:
        m, d, y = (s or "").strip().split("/")
        return (int(y), int(m), int(d))
    except (ValueError, AttributeError):
        return None


def _summarize_flow_rows(sym: str, rows: list[dict], today: str) -> str:
    """Pure aggregation of a ticker's flow CSV rows into one desk-context line.

    Uses today's prints when the session is live; otherwise (weekend/evening
    with no rows yet) falls back to the LATEST session present and labels it
    honestly — a weekend "what did the flow say on X" must still be grounded.
    """
    dates = {(row.get("CreatedDate") or "").strip() for row in rows}
    if today in dates:
        target, label = today, "today"
    else:
        parsed = sorted((p, s) for s in dates if (p := _parse_mdyyyy(s)))
        if not parsed:
            return ""
        target = parsed[-1][1]
        label = f"last session ({target})"
    n = 0
    total = call_p = put_p = ask_p = 0.0
    best: dict | None = None
    for row in rows:
        if (row.get("CreatedDate") or "").strip() != target:
            continue
        try:
            prem = float(row.get("Premium") or 0)
        except (TypeError, ValueError):
            continue
        n += 1
        total += prem
        if (row.get("CallPut") or "").strip().upper().startswith("C"):
            call_p += prem
        else:
            put_p += prem
        if (row.get("Side") or "").strip().upper().startswith("A"):
            ask_p += prem
        if best is None or prem > float(best.get("Premium") or 0):
            best = row
    if not n or total <= 0:
        return ""
    bias = ("call-heavy" if call_p > put_p * 1.5
            else "put-heavy" if put_p > call_p * 1.5 else "mixed")
    text = (f"{sym} options flow {label} (UCT tape): {n} notable prints, "
            f"${total / 1e6:.1f}M premium — {bias} "
            f"(${call_p / 1e6:.1f}M calls / ${put_p / 1e6:.1f}M puts, "
            f"{ask_p / total * 100:.0f}% at ask)")
    if best is not None:
        try:
            bp = float(best.get("Premium") or 0) / 1e6
            text += (f"; largest: {best.get('CallPut', '?')} ${best.get('Strike', '?')} "
                     f"exp {best.get('ExpirationDate', '?')} ${bp:.2f}M")
        except (TypeError, ValueError):
            pass
    return text


_flow_ctx_memo: dict = {}


def _read_flow_rows(sym: str, source: str) -> list[dict] | None:
    """One read of ONE flow source. Parsed rows, or **None when the read FAILED**.

    An unreachable flow service and a genuinely quiet tape both summarize to the
    same empty string, but only one of them is an answer — and the caller has to
    tell them apart to know whether asking the other source is warranted
    (`lesson_market_cap_cache_poison`: never treat a failed fetch as a value).
    """
    import csv as _csv
    import io as _io
    import httpx
    try:
        r = httpx.get(f"{_flow_base_url()}/api/flow/ticker/{sym}",
                      params={"source": source}, timeout=2.5)
    except Exception:
        return None
    if r.status_code != 200 or not r.text:
        return None
    try:
        return list(_csv.DictReader(_io.StringIO(r.text)))
    except Exception:
        return None


def _ctx_flow_ticker(sym: str) -> str:
    """One desk-context line of a ticker's flow, read from BOTH sources it may
    be filed under.

    `/api/flow/ticker` defaults to `source=stocks`, but the flow DB files
    index/ETF symbols — SPY, QQQ, IWM, every XL*, ~200 names — under
    `source=indexes`, and asking the wrong one returns a header with no rows: a
    200, no error, and an empty summary. On this path that means the model
    answers "what did the flow say on SPY" ungrounded, on exactly the symbols
    people ask about first, with nothing anywhere to alert on.

    So: ask `stocks`, and only if the parse yields ZERO rows ask `indexes` once.
    Deliberately not a hardcoded symbol list — membership is upstream's to
    change and a list would drift out of date without ever failing. A real stock
    still costs exactly one request, which matters on a 2.5s budget inside a
    user-facing answer.

    A FAILED read short-circuits: a 500 is not an empty tape, so it is never
    re-asked against the other source nor reported as a quiet one — and it is
    never MEMOIZED either (`lesson_market_cap_cache_poison`: never cache a
    failed fetch as a value). `rows is not None` is exactly the "we reached a
    conclusion" test, because that is the distinction `_read_flow_rows` returns
    None to express. Caching "" off a failure would pin 'no flow on SPY' for a
    full minute of questions after the outage cleared, each one ungrounded with
    nothing anywhere to alert on. A genuinely quiet tape — both sources
    answered, both empty — still caches, or every quiet symbol pays two HTTP
    hops per question on a 2.5s budget.
    """
    import time as _time
    hit = _flow_ctx_memo.get(sym)
    if hit and _time.time() - hit[0] < 60:
        return hit[1]
    text = ""
    conclusive = False
    try:
        rows = _read_flow_rows(sym, "stocks")
        if rows is not None and not rows:
            rows = _read_flow_rows(sym, "indexes")
        # None here means the LAST read attempted failed — either the `stocks`
        # read (nothing else was tried) or, for an index symbol whose empty
        # `stocks` result carries no information, the `indexes` read that was
        # supposed to answer it.
        conclusive = rows is not None
        if rows:
            text = _summarize_flow_rows(sym, rows, _et_day_mdyyyy())
    except Exception:
        text = ""
        conclusive = False
    if conclusive:
        _flow_ctx_memo[sym] = (_time.time(), text)
    return text


# Flow context is an HTTP hop — fire it only when the phrasing asks about OPTIONS
# flow, never on 'cash flow' / 'free cash flow' / 'news flow' (bare 'flow' would).
_FLOW_RE = re.compile(
    r"\b(options? flow|sweeps?|unusual (options|activity)|whales?"
    r"|call buying|put buying|smart money|big (?:options? )?prints?|options? premium"
    r"|(?<!cash )(?<!news )(?<!order )(?<!fund )flow\b(?=\s+(?:on|for|in|say|said|look|is|was|today|right)))",
    re.I)


# ── Per-ticker fundamentals / analyst / insider — cached internal reads that
# ground the answer with the desk's OWN numbers instead of web guesses. Each is
# intent-gated (below) so a plain price/flow question doesn't pay for them, and
# each is best-effort (never raises, never blocks the answer).

def _ctx_fundamentals(sym: str) -> str:
    from api.services.fundamentals import get_fundamentals
    f = get_fundamentals(sym) or {}
    if f.get("error") or not (f.get("market_cap") or f.get("pe_forward") or f.get("next_earnings")):
        return ""
    bits = []
    if f.get("market_cap"):
        bits.append(f"mkt cap {f['market_cap']}")
    if f.get("pe_forward") is not None:
        bits.append(f"fwd P/E {f['pe_forward']}")
    if f.get("pe_trailing") is not None:
        bits.append(f"P/E {f['pe_trailing']}")
    if f.get("peg") is not None:
        bits.append(f"PEG {f['peg']}")
    if f.get("profit_margin_pct") is not None:
        bits.append(f"net margin {f['profit_margin_pct']}%")
    if f.get("revenue_growth_pct") is not None:
        bits.append(f"rev growth {f['revenue_growth_pct']}%")
    if f.get("dividend_yield_pct"):
        bits.append(f"div yield {f['dividend_yield_pct']}%")
    if f.get("next_earnings"):
        bits.append(f"next earnings {f['next_earnings']}")
    return f"{sym} fundamentals (UCT data): " + ", ".join(bits) if bits else ""


def _ctx_analyst(sym: str) -> str:
    from api.services.analyst_intel import get_analyst_intel
    a = get_analyst_intel(sym) or {}
    cons = a.get("consensus") or {}
    pt = a.get("price_target") or {}
    parts = []
    if cons.get("rating"):
        parts.append(f"consensus {cons['rating']}" + (f" ({cons.get('count')} analysts)" if cons.get("count") else ""))
    if pt.get("avg"):
        seg = f"avg PT ${pt['avg']}"
        if pt.get("upside_pct") is not None:
            seg += f" ({pt['upside_pct']:+.0f}% vs spot)"
        parts.append(seg)
    acts = a.get("recent_actions") or []
    if acts:
        top = acts[0]
        parts.append(f"latest: {top.get('firm', '?')} {top.get('action', '')} {top.get('to_grade', '') or ''}".strip())
    return f"{sym} analyst view (UCT data): " + "; ".join(parts) if parts else ""


def _ctx_insider(sym: str) -> str:
    from api.services.insider import get_insider_activity
    rows = get_insider_activity(sym) or []
    if not rows:
        return ""
    buys = [r for r in rows if (r.get("type") or "").lower() == "buy"][:2]
    sells = [r for r in rows if (r.get("type") or "").lower() == "sell"][:1]
    seg = []
    for r in buys:
        seg.append(f"BUY {r.get('name', '?')} ${round((r.get('amount') or 0) / 1e6, 2)}M ({r.get('date', '')})")
    for r in sells:
        seg.append(f"SELL {r.get('name', '?')} ${round((r.get('amount') or 0) / 1e6, 2)}M")
    return f"{sym} insider activity (UCT data, last ~90d): " + "; ".join(seg) if seg else ""


# Intent gates — tight, anchored so single-stock price/flow questions don't fire them.
_FUNDAMENTALS_RE = re.compile(
    r"\b(valuation|market ?cap|mkt ?cap|p/?e\b|pe ratio|forward p/?e|peg\b|price[- ]to[- ]"
    r"|ev/|multiple|fundamentals?|profit margins?|net margin|gross margin|operating margin"
    r"|revenue growth|earnings growth|balance sheet|free cash flow|fcf\b|dividend|yield|payout"
    r"|how (?:big|large|much bigger)|worth|bigger by (?:market )?cap"
    r"|when (?:does|do|is|will).{0,20}\breport|next earnings|report (?:next|date)|earnings date)\b", re.I)
_ANALYST_RE = re.compile(
    r"\b(analysts?|price targets?|\bpts?\b(?= |$)|upgrade[sd]?|downgrade[sd]?|ratings?"
    r"|overweight|underweight|buy rating|consensus|street (?:says|view|target|estimate)"
    r"|sell[- ]side|wall street (?:target|expect))\b", re.I)
_INSIDER_RE = re.compile(
    r"\b(insider|insiders|form 4|c-suite|(?:ceo|cfo|ceo'?s|executives?|management)"
    r".{0,30}?\b(?:buy|buying|bought|sell|selling|sold|purchase)|cluster buy)\b", re.I)


def _ctx_movers() -> str:
    from api.services.massive import get_movers
    m = get_movers() or {}
    up = ", ".join(f"{x.get('sym')} +{round(x.get('pct') or 0, 1)}%" for x in (m.get("ripping") or [])[:4])
    dn = ", ".join(f"{x.get('sym')} {round(x.get('pct') or 0, 1)}%" for x in (m.get("drilling") or [])[:4])
    if not up and not dn:
        return ""
    return f"Movers (UCT live feed): up — {up or 'none'}; down — {dn or 'none'}"


def _ctx_breadth() -> str:
    from api.services.engine import get_breadth
    b = get_breadth() or {}
    if not b:
        return ""
    return (
        f"Breadth (UCT): score {b.get('breadth_score')}, phase {b.get('market_phase')}, "
        f"adv/dec {b.get('advancing')}/{b.get('declining')}, "
        f"52wk NH/NL {b.get('new_highs')}/{b.get('new_lows')}"
    )


def _ctx_earnings() -> str:
    from api.services.engine import get_earnings
    e = get_earnings() or {}
    bmo = ", ".join(x.get("sym", "") for x in (e.get("bmo") or [])[:8])
    amc = ", ".join(x.get("sym", "") for x in (e.get("amc") or [])[:8])
    if not bmo and not amc:
        return ""
    return f"Earnings (UCT calendar): today BMO — {bmo or 'none'}; last night AMC — {amc or 'none'}"


def _ctx_uct20() -> str:
    from api.services.engine import get_leadership
    rows = get_leadership() or []
    syms = ", ".join((r.get("ticker") or r.get("sym") or "") for r in rows[:20] if isinstance(r, dict))
    return f"UCT20 leadership list (the firm's ranked top 20): {syms}" if syms.strip(", ") else ""


def _ctx_candidates() -> str:
    from api.services.engine import get_candidates
    c = get_candidates() or {}
    pb = ", ".join(x.get("sym", "") for x in (c.get("pullback_ma") or c.get("pullback") or [])[:5])
    rm = ", ".join(x.get("sym", "") for x in (c.get("remount") or [])[:5])
    if not pb and not rm:
        return ""
    return f"UCT scanner candidates today: pullbacks — {pb or 'none'}; remounts — {rm or 'none'}"


def _ctx_news() -> str:
    from api.services.engine import get_news
    items = get_news() or []
    heads = "; ".join((x.get("headline") or "")[:90] for x in items[:5] if isinstance(x, dict))
    return f"Latest headlines (UCT feed): {heads}" if heads else ""


# (regex, provider name) — resolved via getattr at call time so tests can patch.
# Each anchored to market-LEVEL phrasing so single-stock questions naming a
# collision ticker (AMC, BMO, NOW…) don't pull an unrelated market feed.
_INTENT_SPECS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\b(movers?|gainers?|losers?|ripping|what'?s moving|gapp(?:ing|ers?)|gaps? (?:up|down)|biggest (moves?|movers?|gainers?|losers?))\b", re.I), "_ctx_movers"),
    (re.compile(r"\b(advance[- ]decline|advancers?|decliners?|market breadth|breadth|market internals|internals|new (highs?|lows?)|market (health|conditions?)|net exposure|market exposure)\b", re.I), "_ctx_breadth"),
    (re.compile(r"\b(earnings (today|tonight|this week)|who(?:'?s| is| are)? reporting|who reports?|reporting (today|tonight|this week)|(?:reporting|earnings)\s+(?:bmo|amc)|\b(?:bmo|amc)\b(?=[^a-z]*\b(?:earnings|reports?|reporters?|tonight|today)\b))", re.I), "_ctx_earnings"),
    (re.compile(r"\b(uct ?20|leadership (list|names|20)|(?:your|firm'?s|the firm'?s|uct) top (stocks|names|picks|ideas|20))\b", re.I), "_ctx_uct20"),
    (re.compile(r"\b(scanner|(?:trade|long|buy|swing) candidates?|setups? (?:today|on watch|on the scan)|pullbacks?|remounts?|watch ?list ideas|on the scan)\b", re.I), "_ctx_candidates"),
    (re.compile(r"\b(headlines?|the tape|top stories|market news|news (?:today|this morning|before the open))\b", re.I), "_ctx_news"),
]

_CTX_BUDGET = 2600   # chars — keep grounding a supplement, not a payload


def _time_bucket() -> str:
    """Freshness bucket for market-action queries: 5-min granularity during the
    extended session (Mon-Fri 4:00-20:00 ET) so hot answers refresh fast; a
    single 'off' bucket otherwise (nothing is moving — cache freely)."""
    try:
        from zoneinfo import ZoneInfo
        now = datetime.now(ZoneInfo("America/New_York"))
    except Exception:
        now = datetime.now(timezone.utc) + _ET_OFFSET_FALLBACK
    if now.weekday() < 5 and 4 <= now.hour < 20:
        return f"b{(now.hour * 60 + now.minute) // 5}"
    return "off"


def _fresh_salt(query: str, salt: str) -> str:
    """'Today/moving'-shaped queries must not serve a 15-min-old cached answer
    mid-session — bucket their cache so they refresh every ~5 minutes."""
    if _auto_recency(query) != "day":
        return salt
    bucket = _time_bucket()
    return f"{salt}|{bucket}" if salt else bucket


def _empty_meta() -> dict:
    return {"grounding_sources": [], "grounding_intents": [], "regime_label": None,
            "recency": None, "had_live_price": False, "ctx_block": "", "query_tickers": []}


def _uct_context(query: str) -> tuple[str, str, dict]:
    """Returns (context_text, cache_salt, meta). ctx+salt empty when nothing useful.

    Always: market regime + live quote & today's catalyst thesis for tickers
    named in the question. Intent-routed extras (movers, breadth, earnings,
    UCT20, scanner, headlines) join only when the phrasing asks for them, so
    the grounding stays a tight supplement rather than a data dump.

    `meta` records — for the capture log, computed here so the log wrapper never
    re-runs the regexes — which desk feeds actually fired, the regime label at
    answer time (a genuine one-way door; the classifier never persists history),
    the query recency, whether a live price was injected, and the ctx block.
    """
    parts: list[str] = []
    salt_bits: list[str] = []
    meta = _empty_meta()
    syms = _extract_tickers(query)[:3]
    meta["query_tickers"] = list(syms)
    meta["recency"] = _auto_recency(query)

    def _add(source: str, line: str):
        if line:
            parts.append(line)
            if source not in meta["grounding_sources"]:
                meta["grounding_sources"].append(source)

    try:
        rg = _regime_provider()
        label = rg.get("regime") or rg.get("label")
        if label:
            conf = rg.get("confidence")
            _add("regime", f"Market regime: {label}" + (f" (confidence {conf})" if conf else ""))
            meta["regime_label"] = str(label)
            salt_bits.append(str(label))
    except Exception:
        pass
    for s in syms:
        try:
            q = _quote_provider(s)
            if q.get("last"):
                _add("quote", f"{s}: last ${q['last']}, {q.get('direction', 'flat')} {q.get('abs_pct', 0)}% today")
                meta["had_live_price"] = True
        except Exception:
            pass
        try:
            _add("catalyst", _ctx_catalyst(s))
        except Exception:
            pass
    for s in syms[:2]:   # tape is verbose — first two symbols only
        try:
            _add("tape", _ctx_tape(s))
        except Exception:
            pass
    for s in syms[:2]:   # active setups — cheap local patterns.db read
        try:
            _add("patterns", _ctx_patterns(s))
        except Exception:
            pass
    if _FLOW_RE.search(query or ""):   # flow = HTTP hop to the flow-worker
        for s in syms[:2]:
            try:
                _add("flow", _ctx_flow_ticker(s))
            except Exception:
                pass
    # Per-ticker fundamentals / analyst / insider — intent-gated cached reads.
    # Resolve each fn by NAME off the live module so a test/patch is honored.
    _this = sys.modules[__name__]
    q = query or ""
    _perticker = []
    if _FUNDAMENTALS_RE.search(q):
        _perticker.append(("fundamentals", "_ctx_fundamentals"))
    if _ANALYST_RE.search(q):
        _perticker.append(("analyst", "_ctx_analyst"))
    if _INSIDER_RE.search(q):
        _perticker.append(("insider", "_ctx_insider"))
    for source, fn_name in _perticker:
        fn = getattr(_this, fn_name)
        for s in syms[:2]:
            try:
                _add(source, fn(s))
            except Exception:
                pass
    salt_bits.extend(syms)
    this_mod = sys.modules[__name__]
    for rx, fn_name in _INTENT_SPECS:
        if not rx.search(query or ""):
            continue
        try:
            line = getattr(this_mod, fn_name)()
            if line:
                _add(fn_name.replace("_ctx_", ""), line)
                meta["grounding_intents"].append(fn_name.replace("_ctx_", ""))
        except Exception:
            pass
    if not parts:
        return "", "", meta
    ctx = "\n".join(parts)[:_CTX_BUDGET]
    meta["ctx_block"] = ctx
    # Salt excludes live prices on purpose: a cached answer may carry a price
    # up to one cache-TTL stale (same staleness class as the web data itself);
    # salting on every tick would defeat the cache. The ET day rolls catalysts/
    # calendar entries over at midnight. Intent flags are derived from the
    # query, which is already part of the cache key.
    salt_bits.append(_et_day())
    return ctx, "|".join(salt_bits), meta


def _grounded_system(query: str) -> tuple[str, str, dict]:
    ctx, salt, meta = _uct_context(query)
    # question_type drives the Phase-2 memory blend (and is captured in the log).
    try:
        from api.services import ai_search_log
        meta["question_type"] = ai_search_log.classify_question_type(query)
    except Exception:
        meta["question_type"] = None
    system = _WIDGET_SYSTEM
    if ctx:
        system += (
            "\n\nUCT DESK CONTEXT (internal desk data — authoritative for price, "
            "percent move, and market regime; prefer these figures over web "
            "sources and attribute them to 'UCT desk data'): " + ctx
        )
    # Phase 2 — blend in the desk's OWN prior evergreen research (best-effort,
    # flag + question-type gated, labeled 'may be dated' so live data stays primary).
    # NOTE: this can make a blocking embedding call, so the streaming endpoint runs
    # _grounded_system in a thread (never on the shared event loop).
    try:
        from api.services import ai_search_memory
        qtk = meta.get("query_tickers") or []
        mblock = ai_search_memory.retrieve_context(
            query, meta.get("question_type"), primary_ticker=(qtk[0] if qtk else None))
        if mblock:
            system += mblock
    except Exception:
        pass
    # Phase 3 — throttled background dossier synthesis (dark unless flag on; kicks
    # a daemon thread, never blocks). Warms the house-view brain as questions come in.
    try:
        from api.services import ai_search_dossier
        ai_search_dossier.maybe_run()
    except Exception:
        pass
    return system, salt, meta


class AiSearchIn(BaseModel):
    query: str
    # The widget sends no mode, so this default flows through _auto_mode, which
    # routes by phrasing: most asks -> sonar-pro ("fast"), deep-analysis phrasing
    # -> sonar-reasoning-pro. A client may pin "fast"/"reasoning" to force a tier.
    # (Base sonar "lite" is only reached if _auto_mode is bypassed.)
    mode: str = "lite"
    # Conversation memory: prior {q, a} exchanges from THIS widget session so
    # follow-ups can resolve references. Sanitized server-side; never persisted.
    history: list | None = None
    # Anonymized conversation threading for the capture log (NOT identity): a random
    # per-widget-session id + this ask's turn index. Optional; capture is best-effort.
    conversation_id: str | None = None
    turn_index: int | None = None


def _clean_history(hist) -> list[dict]:
    """Keep at most the last 3 well-formed exchanges, size-capped — the model
    needs reference resolution, not a transcript."""
    out: list[dict] = []
    for h in (hist or [])[-3:]:
        if not isinstance(h, dict):
            continue
        q = str(h.get("q") or "").strip()[:300]
        a = str(h.get("a") or "").strip()[:1200]
        if q and a:
            out.append({"q": q, "a": a})
    return out


def _history_salt(salt: str, history: list[dict]) -> str:
    """History changes the answer — give threaded asks their own cache lane."""
    if not history:
        return salt
    digest = hashlib.md5(json.dumps(history, sort_keys=True).encode()).hexdigest()[:10]
    return f"{salt}|h{digest}" if salt else f"h{digest}"


def ai_search_log_new_id() -> str:
    """A stable answer id, even if the log service is unavailable (best-effort)."""
    try:
        from api.services import ai_search_log
        return ai_search_log.new_answer_id()
    except Exception:
        import uuid
        return uuid.uuid4().hex


def _answer_kind(result: dict) -> str:
    """Classify a finished answer for the capture log — the cheap Phase-2 exclusion
    gate (refusals / data-limited / empty never become house knowledge)."""
    if result.get("error") == "incomplete":
        return "incomplete"
    if result.get("error"):
        return "error"
    ans = (result.get("answer") or "").strip()
    if not ans:
        return "empty"
    low = ans.lower()
    if "i'm the uct research desk" in low or "ask me about markets" in low:
        return "refused"
    if len(ans) < 220 and not result.get("citations") and (
            "don't have" in low or "no live" in low or "can't fetch" in low
            or "private company" in low):
        return "data_limited"
    return "ok"


def _log_answer(*, body: AiSearchIn, user_id, answer_id, endpoint, mode, result,
                meta: dict, history, fallback_used=False) -> None:
    """Best-effort capture of a finished answer. Never raises (double-guarded here
    AND inside ai_search_log.log). Reads grounding facts from `meta` — never re-runs
    the router regexes."""
    try:
        from api.services import ai_search_log
        m = meta or _empty_meta()
        ai_search_log.log(
            user_id=user_id, answer_id=answer_id, endpoint=endpoint,
            query=body.query, answer=result.get("answer") or "",
            answer_kind=_answer_kind(result), mode=mode, model=result.get("model"),
            fallback_used=fallback_used, cached=bool(result.get("cached")),
            recency=m.get("recency"), grounded_sources=m.get("grounding_sources"),
            grounding_intents=m.get("grounding_intents"), regime_label=m.get("regime_label"),
            had_live_price=m.get("had_live_price"), grounding_context=m.get("ctx_block"),
            query_tickers=m.get("query_tickers"), citations=result.get("citations"),
            related_questions=result.get("related_questions"),
            domain_pack=result.get("domain_pack"), elapsed_ms=result.get("elapsed_ms"),
            error=result.get("error"), units=_billing_units(mode),
            conversation_id=body.conversation_id, turn_index=body.turn_index,
            has_history=bool(history))
    except Exception:
        pass


@router.post("")
def ai_search(body: AiSearchIn, user: dict = Depends(require_paid)):
    user_id = user.get("id")
    if not (body.query or "").strip():
        raise HTTPException(status_code=422, detail="Empty question.")
    # ── Personal branch (dark unless AI_SEARCH_PERSONAL_ENABLED). Distinct code
    # path: no _log_answer, no shared cache, PUBLIC-only Perplexity leg. Decided
    # here from the SERVER-derived user dict, never client JSON.
    puid = _personal_uid(user)
    if _personal_enabled() and is_personal(body.query, user):
        resolved = _resolve_personal(puid, body.query)
        if resolved is not None:
            account_id, public_system, psalt, pmeta = resolved
            _record_request("personal", stream=False)
            _reserve(user_id, 1)   # daily cap (raises 429 before any upstream work)
            return asyncio.run(
                _personal_single(body, puid, account_id, public_system, psalt, pmeta))
        # zero accounts → decline, fall through to the normal public path.
    mode = _auto_mode(body.query, body.mode)
    units = _billing_units(mode)
    _reserve(user_id, units)   # atomic check-and-reserve BEFORE the upstream call
    _record_request(mode, stream=False)
    history = _clean_history(body.history)
    system, salt, meta = _grounded_system(body.query)
    salt = _history_salt(_fresh_salt(body.query, salt), history)

    def _search(m):
        return perplexity_search.web_search(
            body.query, max_tokens=700, system=system, mode=m, domain_pack="finance",
            recency=_auto_recency(body.query), related=True, cache_salt=salt, history=history,
        )

    result = _search(mode)
    effective_mode = mode
    effective_units = units
    fallback_used = False
    # Reasoning came back empty (budget consumed by <think>) → fall back to
    # sonar-pro so a member never sees a blank answer; bill the fast tier only.
    if mode == "reasoning" and not result.get("answer"):
        result = _search("fast")
        effective_mode = "fast"
        effective_units = _billing_units("fast")
        fallback_used = True
    # Reconcile the reservation with what actually happened.
    if result.get("cached"):
        _refund(user_id, units); _record_cache_hit()
    elif not result.get("answer") or result.get("error"):
        _refund(user_id, units)   # never bill a failed/empty search
    elif effective_units != units:
        _refund(user_id, units - effective_units)   # keep only the fast unit
    # Stable id so a later save/share/pin can join back to this de-identified row.
    answer_id = ai_search_log_new_id()
    result["answer_id"] = answer_id
    # Best-effort capture (sync def runs in the anyio threadpool — a direct call is fine).
    _log_answer(body=body, user_id=user_id, answer_id=answer_id, endpoint="single",
                mode=effective_mode, result=result, meta=meta, history=history,
                fallback_used=fallback_used)
    return result


@router.post("/stream")
async def ai_search_stream(body: AiSearchIn, user: dict = Depends(require_paid)):
    """SSE twin of the endpoint above: `data: {"type":"delta","text":...}` events
    as tokens arrive, then a final `data: {"type":"final",...}` shaped like the
    single-shot response. Same auth + daily caps (429 raised BEFORE the stream
    opens). The path must stay in main.py's _is_gzip_exempt list or GZip
    buffers the whole stream and no tokens ever reach the client."""
    user_id = user.get("id")
    if not (body.query or "").strip():
        raise HTTPException(status_code=422, detail="Empty question.")
    # ── Personal branch (dark unless AI_SEARCH_PERSONAL_ENABLED). Distinct code
    # path from the public stream below: PUBLIC-only Perplexity leg (history=None),
    # per-user synth reserve, in-band fallback, and NO _log_answer anywhere.
    puid = _personal_uid(user)
    if _personal_enabled() and is_personal(body.query, user):
        loop = asyncio.get_running_loop()
        resolved = await loop.run_in_executor(None, _resolve_personal, puid, body.query)
        if resolved is not None:
            account_id, public_system, psalt, pmeta = resolved
            _record_request("personal", stream=True)
            _reserve(user_id, 1)   # daily cap (raises 429 BEFORE the stream opens)
            return StreamingResponse(
                _personal_gen(body, puid, account_id, public_system, psalt, pmeta),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        # zero accounts → decline, fall through to the normal public stream.
    mode = _auto_mode(body.query, body.mode)
    units = _billing_units(mode)
    _reserve(user_id, units)   # reserve BEFORE opening the stream (bill even if client disconnects)
    _record_request(mode, stream=True)
    history = _clean_history(body.history)
    # Build the grounded system OFF the event loop — grounding reads + the Phase-2
    # memory embedding call are blocking, and this runs on the single shared loop
    # (the 524-outage surface). run_in_executor keeps the loop free.
    loop = asyncio.get_running_loop()
    system, salt, meta = await loop.run_in_executor(None, _grounded_system, body.query)
    salt = _history_salt(_fresh_salt(body.query, salt), history)
    answer_id = ai_search_log_new_id()

    async def gen():
        settled = False
        got_answer = False
        # captured_final holds the ONE answer we log — updated at BOTH the normal
        # 'final' event AND the inline reasoning→fast fallback, so the log records
        # the answer the member actually saw (never the failed empty reasoning try).
        captured = {"result": None, "mode": mode, "fallback_used": False}
        # Tell the client the tier + the stable answer_id up front (the id lets a
        # later save/share/pin join back to this de-identified row).
        yield f"data: {json.dumps({'type': 'meta', 'mode': mode, 'answer_id': answer_id})}\n\n"
        try:
            async for ev in perplexity_search.stream_search(
                body.query, max_tokens=700, system=system, mode=mode, domain_pack="finance",
                recency=_auto_recency(body.query), related=True, cache_salt=salt, history=history,
            ):
                t = ev.get("type")
                if t == "delta" and ev.get("text"):
                    got_answer = True
                if t == "final" and not settled:
                    settled = True   # keep the reservation for a real answer
                    captured["result"] = {k: v for k, v in ev.items() if k != "type"}
                    if ev.get("cached"):
                        _refund(user_id, units); _record_cache_hit()
                elif t == "error" and not settled:
                    settled = True
                    _refund(user_id, units)   # upstream failed — give the reservation back
                    # Reasoning tier failed/empty → one-shot fall back to sonar-pro so the
                    # member gets a real answer instead of an error.
                    if mode == "reasoning" and not got_answer:
                        fb = perplexity_search.web_search(
                            body.query, max_tokens=700, system=system, mode="fast",
                            domain_pack="finance", recency=_auto_recency(body.query),
                            related=True, cache_salt=salt, history=history)
                        if fb.get("answer"):
                            if not fb.get("cached"):
                                _reserve(user_id, 1)
                            captured["result"] = dict(fb)
                            captured["mode"] = "fast"
                            captured["fallback_used"] = True
                            yield f"data: {json.dumps({'type':'final', 'answer_id': answer_id, **fb})}\n\n"
                            continue
                    captured["result"] = {"answer": "", "error": ev.get("error") or "stream error"}
                if t == "final":
                    ev = {**ev, "answer_id": answer_id}
                yield f"data: {json.dumps(ev)}\n\n"
        finally:
            if not settled:
                _refund(user_id, units)   # generator cancelled before any final/error
            # Capture the finished answer ONCE — offloaded to a worker thread so the
            # SQLite write NEVER blocks the shared event loop (the 524-outage surface).
            res = captured["result"]
            if res is None and not settled:
                res = {"answer": "", "error": "incomplete"}   # disconnect before any final
            if res is not None:
                try:
                    loop = asyncio.get_running_loop()
                    loop.run_in_executor(
                        None,
                        lambda: _log_answer(
                            body=body, user_id=user_id, answer_id=answer_id, endpoint="stream",
                            mode=captured["mode"], result=res, meta=meta, history=history,
                            fallback_used=captured["fallback_used"]))
                except Exception:
                    pass

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.get("/admin/stats")
def ai_search_admin_stats(user: dict = Depends(require_admin)):
    """Today's live AI Search usage: burn vs caps, mode mix, cache-hit rate.
    In-memory — resets at midnight ET and on redeploy (same lifetime as the caps).
    De-identified: no per-user breakdown (that lives nowhere now)."""
    with _usage_lock:
        requests = _stats["requests"]
        cache_hits = _stats["cache_hits"]
        return {
            "day_et": _usage_day or _et_day(),
            "billed_units": _usage_global,
            "global_limit": _global_daily_limit(),
            "per_user_limit": _user_daily_limit(),
            "active_users": len(_usage_by_user),
            "requests": requests,
            "cache_hits": cache_hits,
            "cache_hit_rate": round(cache_hits / requests, 3) if requests else 0.0,
            "by_mode": dict(_stats["by_mode"]),
            "stream_requests": _stats["stream"],
            "single_shot_requests": _stats["single"],
            "note": "in-memory since last deploy; resets daily (ET) and on redeploy",
        }


@router.get("/admin/log")
def ai_search_admin_log(days: int = 7, limit: int = 50, user: dict = Depends(require_admin)):
    """Persistent, DE-IDENTIFIED analytics over the captured Q&A log: what members
    ask, top tickers, freshness split, mode/grounding/cache/error rates, recent rows.
    The 'All-time · window' lane of the admin panel (vs /admin/stats' 'Today · live')."""
    from api.services import ai_search_log
    days = max(1, min(90, int(days or 7)))
    limit = max(1, min(200, int(limit or 50)))
    out = ai_search_log.insights(days=days, recent_limit=limit)
    try:
        from api.services import ai_search_memory
        out["memory"] = ai_search_memory.status()   # Phase-2 house-brain summary
    except Exception:
        out["memory"] = {"enabled": False, "indexed": 0}
    return out


@router.post("/admin/reindex")
def ai_search_admin_reindex(user: dict = Depends(require_admin)):
    """Force a rebuild of the Phase-2 house-brain index from the eligible evergreen
    log rows. Runs inline (admin path, off the user request path)."""
    from api.services import ai_search_memory
    return ai_search_memory.reindex()


@router.post("/admin/synthesize")
def ai_search_admin_synthesize(user: dict = Depends(require_admin)):
    """Force a Phase-3 dossier synthesis batch (per-ticker/theme house views).
    No-op unless AI_SEARCH_DOSSIER_ENABLED=1. Runs inline (admin path)."""
    from api.services import ai_search_dossier
    return ai_search_dossier.run_batch()


class AiSignalIn(BaseModel):
    answer_id: str
    kind: str   # save | share | copy | pin | unpin | exclude | unexclude | helpful


@router.post("/signal")
def ai_search_signal(body: AiSignalIn, user: dict = Depends(require_paid)):
    """Best-effort human quality signal on a prior answer (save/share/copy = member
    vouch; pin/exclude = admin curation). Joined by the stable answer_id, so it stays
    de-identified. Never fails the caller."""
    try:
        from api.services import ai_search_log
        kind = (body.kind or "").strip().lower()
        # Curation (pin/exclude) is admin-only; passive signals are open to any member.
        if kind in ("pin", "unpin", "exclude", "unexclude") and user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="admin only")
        if kind not in ("save", "share", "copy", "pin", "unpin", "exclude", "unexclude", "helpful"):
            raise HTTPException(status_code=422, detail="unknown signal kind")
        ai_search_log.record_signal(body.answer_id, kind)
    except HTTPException:
        raise
    except Exception:
        pass
    return {"ok": True}
