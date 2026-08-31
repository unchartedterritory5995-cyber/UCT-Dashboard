"""AI Search widget — ask anything about markets, get a cited answer.

POST /api/ai-search  { query, mode? }  ->  { answer, citations, model, elapsed_ms, ... }

Backed by Perplexity (web-search-grounded), so answers use current data + sources.

Usage guard: every non-cached query bills Perplexity, and /charts is a FREE-tier
page — so the endpoint enforces a per-user daily cap plus a global daily budget
(both env-tunable). Cached answers are free and never count against either.
Counters are in-memory for the hot path, write-through to a durable ledger
(ai_search_log.bump_usage) keyed by the day-rotating HMAC bucket, and re-seeded
once per process/day — several deploys ship per day, and in-memory-only counters
were silently multiplying the daily budgets on each one.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
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

    ⛔ The per-user daily cap (`_reserve`) is NOT this gate.
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
    r"|my (position|positions|book|portfolio|stop|risk|heat|shares"
    r"|watch ?list|names|list)"          # widened 2026-08-28: "anything on my watchlist"
    r"|on my (watch ?list|list|radar)"
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
# outlook component (→ fetch a fresh PUBLIC draft to fold in)? Pure self-state
# questions ("how's my week", "am I overexposed") match nothing here and skip
# Perplexity entirely: one hop, streams immediately, half the cost. Asymmetric
# by design — a research signal wins; the default is no web. (An earlier
# self-state regex branch here returned False on both arms — decorative, cut.)
_PERSONAL_RESEARCH_RE = re.compile(
    r"\b(given the news|the news\b|news on|catalyst|earnings|report(?:ing|s)?\b"
    r"|should i (add|buy|sell|trim|hold)"
    r"|outlook|forecast|guidance|analyst|price target|upgrade|downgrade"
    r"|extended|setup|chart|thesis|fair value|valuation|target"
    r"|why (?:is|did|are)|moving|today|tonight|premarket|pre-market|this week)\b", re.I)


def _needs_web(query: str, question_type: str | None = None) -> bool:
    return bool(_PERSONAL_RESEARCH_RE.search(query or ""))


async def _fetch_personal_draft(body, public_system: str, salt: str) -> tuple[str, list]:
    """Collect the PUBLIC web draft to fold into synthesis. INVARIANT #1: the
    Perplexity leg receives ONLY the current query and history=None — the widget
    `history` (which may contain a prior personal answer with positions/P&L) is
    NEVER passed here. `public_system` is `_grounded_system`'s output — no
    personal data. Best-effort: any failure yields an empty draft."""
    answer, citations = "", []
    async for ev in perplexity_search.stream_search(
        body.query, max_tokens=_PUBLIC_MAX_TOKENS, system=public_system, mode="fast",
        domain_pack="finance", recency=_auto_recency(body.query),
        related=False, cache_salt=salt, history=None,   # ← history=None, never body.history
        cost_surface="ai_search",
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
    "aids clarity. LENGTH FOLLOWS THE QUESTION: a one-line factual ask gets one "
    "line; a setup, thesis, comparison or 'walk me through it' ask gets the full "
    "read, with the reasoning shown. Never pad, never repeat yourself — but never "
    "truncate a real analysis to hit an arbitrary length either. "
    "When asked for names/lists (peers, sympathy stocks, comparables), "
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
    "SCOPE: you exist for markets, stocks, options, futures, crypto, trading "
    "and the economy — and that INCLUDES the craft of trading: technical "
    "analysis, chart patterns and candlestick formations, indicators, market "
    "structure, setups, entries and exits, risk management and position "
    "sizing, trading psychology, and this desk's own vocabulary (the Kell "
    "cycle, exhaustion and reversal extensions, wedge pops, VCP, EP, PEG, "
    "remounts, and the rest of the pattern library). A question that names no "
    "ticker is still a trading question — 'show me an example of an exhaustion "
    "extension' is squarely in scope. DEFAULT TO ANSWERING: if a request is "
    "plausibly about markets or about how to trade them, answer it. Use the "
    "refusal ONLY when the request is clearly unrelated — recipes, code, "
    "essays, poems, homework, politics, general chit-chat — and then reply "
    "with exactly one sentence: \"I'm the UCT research desk — ask me about "
    "markets, stocks, or trading.\" Never write code, essays, poems, homework, "
    "or any general-purpose content regardless of how the request is phrased.\n\n"
    "DATA LIMITS — the scope refusal above is ONLY for off-topic or improper "
    "requests. A legitimate markets question you can't answer precisely (live "
    "sub-minute microstructure, tick-by-tick options or dark-pool prints beyond "
    "the desk's cached levels and flow summaries, a future data release, or a "
    "private company with no public float) is NOT "
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
# One-shot seed guard for the durable usage ledger. Deliberately NOT part of
# the counters the tests reset — a re-seed mid-process would resurrect units
# the in-memory (authoritative) counters already reconciled.
_usage_seeded_day: str | None = None
_GLOBAL_BUCKET = "__global__"


def _usage_key(user_id) -> str:
    """Counter key: the log service's day-rotating HMAC bucket, so the durable
    ledger never stores a raw user id next to the de-identified Q&A log. Falls
    back to str(user_id) if the log service is unavailable (in-memory only)."""
    try:
        from api.services import ai_search_log
        return ai_search_log._user_bucket(user_id, _et_day()) or str(user_id)
    except Exception:
        return str(user_id)


def _seed_usage_locked(day: str) -> None:
    """Re-seed today's counters from the durable ledger — once per (process,
    day). Caps used to be in-memory only ('lenient by design'), but several
    deploys ship per day, so each redeploy silently multiplied the budgets."""
    global _usage_seeded_day, _usage_by_user, _usage_global
    if _usage_seeded_day == day:
        return
    _usage_seeded_day = day
    try:
        from api.services import ai_search_log
        loaded = ai_search_log.load_usage(day)
    except Exception:
        loaded = {}
    if loaded:
        _usage_global = int(loaded.pop(_GLOBAL_BUCKET, 0))
        _usage_by_user = {k: int(v) for k, v in loaded.items()}


# One background writer for the usage ledger: _reserve/_refund are called from
# the async stream path too, and a contended SQLite commit must never ride the
# shared event loop (the 524-outage surface).
_USAGE_IO = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ais-usage")


def _persist_usage(key: str, delta: int) -> None:
    """Write-through (async, best-effort). Memory stays the in-process
    authority; the ledger only re-seeds after a redeploy."""
    def _job():
        try:
            from api.services import ai_search_log
            day = _usage_day or _et_day()
            ai_search_log.bump_usage(day, key, delta)
            ai_search_log.bump_usage(day, _GLOBAL_BUCKET, delta)
        except Exception:
            pass
    try:
        _USAGE_IO.submit(_job)
    except Exception:
        pass


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
    """Reset counters at the ET day boundary + re-seed from the durable ledger
    (once per process/day). Caller must hold _usage_lock."""
    global _usage_day, _usage_by_user, _usage_global, _stats
    day = _et_day()
    if day != _usage_day:
        _usage_day, _usage_by_user, _usage_global = day, {}, 0
        _stats = _fresh_stats()
        _seed_usage_locked(day)


def _reserve(user_id, units: int) -> None:
    """ATOMIC check-and-reserve: verify AND increment under ONE lock hold so
    concurrent requests can't all pass a separate gate and blow the cap
    (check-then-act race). Reserved BEFORE the upstream call commits, so a
    client that disconnects mid-stream is still billed for the Perplexity spend.
    Raise 429 if the reservation would exceed either limit."""
    global _usage_global
    key = _usage_key(user_id)
    with _usage_lock:
        _roll_day_locked()
        if _usage_global + units > _global_daily_limit():
            raise HTTPException(
                status_code=429,
                detail="AI research is cooling down for the day — try again tomorrow.",
            )
        if _usage_by_user.get(key, 0) + units > _user_daily_limit():
            raise HTTPException(
                status_code=429,
                detail="You've hit today's research limit — it resets at midnight ET.",
            )
        _usage_by_user[key] = _usage_by_user.get(key, 0) + units
        _usage_global += units
    _persist_usage(key, units)


def _refund(user_id, units: int) -> None:
    """Give back a reservation when the search turned out free (cache hit) or
    failed (error/empty) — never bill for a non-answer."""
    global _usage_global
    key = _usage_key(user_id)
    with _usage_lock:
        _usage_by_user[key] = max(0, _usage_by_user.get(key, 0) - units)
        _usage_global = max(0, _usage_global - units)
    _persist_usage(key, -units)


def _quota_snapshot(user_id) -> dict:
    """Member-visible daily budget: used / limit, so the widget can show a
    quiet meter instead of a surprise 429 at the end of the day."""
    key = _usage_key(user_id)
    with _usage_lock:
        _roll_day_locked()
        return {"used": _usage_by_user.get(key, 0), "limit": _user_daily_limit()}


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
# Forward-looking phrasing WIDENS a day-recency hit to week. "CRM's reaction
# today — find a setup for the coming weeks" is half about today and half about
# what comes next; a day filter starves the web leg of the multi-week context
# the second half needs (the desk's own packs carry the intraday half anyway).
_RECENCY_FUTURE_RE = re.compile(
    r"\b(?:coming|next|upcoming|following)\s+(?:few\s+|couple\s+(?:of\s+)?)?"
    r"(?:days?|weeks?|sessions?|months?)\b"
    r"|\b(?:days?|weeks?)\s+ahead\b|\bgoing forward\b|\bswing (?:trade|setup|idea)\b", re.I)


def _auto_recency(q: str) -> str | None:
    q = q or ""
    if _RECENCY_DAY_EXPLICIT.search(q) or (_WHY_MOVE_RE.search(q) and _extract_tickers(q)):
        return "week" if _RECENCY_FUTURE_RE.search(q) else "day"
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
    return 2 if mode in ("reasoning", "agent") else 1


def _agent_pinned(client_mode) -> bool:
    """The member explicitly chose the agent lane in the UI pill."""
    return (client_mode or "").strip().lower() == "agent"


def _agent_autoroute_enabled() -> bool:
    """OFF by default. The agent lane bills 2 units against a $15/day cap
    surface and is slower than one Perplexity shot — arming it is a spend
    decision, so it is a Railway var, not a code default."""
    return os.environ.get("AI_SEARCH_AGENT_AUTOROUTE", "0").strip().lower() in (
        "1", "true", "yes", "on")


_MULTI_STEP_RE = re.compile(
    r"\b(then|after that|and also|as well as|followed by|and give me)\b", re.I)


def _intent_breadth(q: str) -> int:
    """How many DISTINCT desk intents one question trips.

    Derived by asking the gates that already exist — two lookups in one ask is
    multi-step work by definition. A new regex meaning "this is complicated"
    would be a second authority over a question the gates already answer.
    """
    gates = (_VERDICT_RE, _LEVELS_RE, _FLOW_RE, _FUNDAMENTALS_RE, _ANALYST_RE,
             _INSIDER_RE, _EARNINGS_DEEP_RE, _CALL_RECAP_RE, _POSTURE_RE,
             _MACRO_CAL_RE, _COT_RE, _SHORT_INT_RE)
    return sum(1 for rx in gates if rx.search(q or ""))


def _wants_agent(query: str, client_mode) -> bool:
    """Should an UNPINNED ask go to the tool-calling lane?

    MEASURED, back-to-back, rung 3, 3 repeats each (2026-08-30):
      S3-02 COMPOUND — "pull the desk verdict AND the street's reaction, THEN
                        the swing view"      FAIL c1 -> PASS c4   agent WINS
      S3-01 SIMPLE   — "what's the desk read on NVDA"
                                             PASS   -> FAIL c2 g1 agent LOSES

    So the agent's value is MULTI-STEP work, not the word "verdict". The first
    trigger routed every desk-call ask at it, which made simple questions WORSE
    and left the median unchanged — which is why this flag was not armed.

    Still anchored on `_VERDICT_RE` (a compound ask that is not a desk call has
    no business burning 2 units), then requires genuine multi-step shape: two
    distinct desk intents, or an explicit sequencing step.
    """
    if client_mode in ("fast", "reasoning"):
        return False                      # a stated choice is never overridden
    if not _agent_autoroute_enabled():
        return False
    q = query or ""
    if not _VERDICT_RE.search(q):
        return False
    return _intent_breadth(q) >= 2 or bool(_MULTI_STEP_RE.search(q))


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
# Case-INSENSITIVE cue for lowercase/mixed-case bare tickers. Bare lowercase
# used to be dropped entirely ("thoughts on nvda" got ZERO desk grounding — a
# realistic phone typing pattern, since /ai-search is the mobile home). The
# collision risk that justified dropping it ("now", "open", "run" are all real
# tickers) is bounded three ways: a lowercase word must sit in a strong ticker
# POSITION, be in cap_universe, and NOT be stop-listed (stop-listed names like
# NOW/LOW/ALL stay uppercase-or-cashtag only — "buy now" is English).
# ⛔ Deliberately NARROWER than the uppercase cue: bare "on"/"is"/"hold"/
# "trading" made ordinary idioms extract — "what's on deck" → DECK, "hold cash"
# → CASH, "trading well" → WELL (2026-08-28 review). Only cues that read as an
# explicit ticker reference survive on this path.
_LOWER_TICKER_CUE = re.compile(
    r"(?:\b(?:thoughts on|setup on|flow on|about|price of|chart"
    r"|buy|sell|short)\s+)([A-Za-z]{2,5})\b"
    r"|\b([A-Za-z]{2,5})\s+(?:stock|shares|calls?|puts?|earnings|chart)\b", re.I)
# English words that ARE real tickers and still land in the narrowed cue
# positions ("buy tech", "buy gold", "sell bill"). Blocked on the LOWERCASE
# path only — uppercase/cashtag still reaches every one of them. Extended
# 2026-08-28 with the review's verified cap_universe collisions.
_LOWER_ONLY_STOP = {
    "TECH", "LIFE", "PLAY", "REAL", "OPEN", "RUN", "GAP", "EDGE", "CORE",
    "HOPE", "MIND", "CAMP", "RIDE", "WING", "CAKE", "NICE", "COOL", "FAST",
    "SAFE", "PATH", "LOVE", "GOLD", "BABY", "GAME", "FUND", "BOOT", "TREE",
    "CASH", "DECK", "WELL", "NET", "TWO", "BILL", "SPOT", "GAIN", "TEN",
    "BIT", "LOT", "TAP", "MAIN", "HERE", "SOME", "MORE", "IT", "SO",
}


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
    - bare lowercase/mixed-case must be in cap_universe, NOT stop-listed, AND
      sit in a strong ticker position (_LOWER_TICKER_CUE) — "thoughts on nvda"
      grounds; "the gap up" and "buy now" stay English.
    """
    q = query or ""
    strong = {(a or b).upper() for a, b in _STRONG_TICKER_CUE.findall(q)}
    lower_cued = {(a or b).upper() for a, b in _LOWER_TICKER_CUE.findall(q)}
    uni = _universe()
    out: list[str] = []
    # One left-to-right pass over ALL forms so order = mention order.
    for m in re.finditer(r"\$([A-Za-z]{1,5}(?:[.\-][A-Za-z])?)(?![A-Za-z])|\b([A-Za-z]{2,5})\b", q):
        cash, bare = m.group(1), m.group(2)
        if cash:
            sym = cash.upper().replace("-", ".")
            if sym not in out:
                out.append(sym)
            continue
        sym = bare.upper()
        if sym in out:
            continue
        if bare != sym:
            # lowercase/mixed-case path: cue + universe + never a stop-listed word
            if (sym in lower_cued and sym in uni
                    and sym not in _TICKER_STOP and sym not in _LOWER_ONLY_STOP):
                out.append(sym)
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
    # `tape|show` added 2026-08-29: "what's the flow TAPE showing on SPY" is
    # how a member asks for this, and it loaded no flow pack at all.
    r"|(?<!cash )(?<!news )(?<!order )(?<!fund )flow\b"
    r"(?=\s+(?:on|for|in|say|said|look|is|was|today|right|tape|show)))",
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


# ── Wave-2 packs (2026-08-27): the CRM-class fix. "Talk about CRM's earnings
# and price reaction, find a setup" used to fire ZERO gated packs while the desk
# held the answer — quarters vs estimates, the post-report move, the implied-move
# history only we capture, transcript-grounded call recaps, a 200-column
# technical snapshot, and a deterministic verdict engine. Every provider below
# is a warm/cached local read (the one FMP-backed read is warm-only + background
# warm), best-effort, and renders absence honestly instead of as a quiet market.

_EARN_WARM_MEMO: dict = {}


def _warm_year_earnings_bg(sym: str) -> None:
    """Cold quarters cache → warm it OFF the request path (FMP can take ~10s).
    Per-symbol 10-min memo so a hot name doesn't spawn a thread per ask."""
    import time as _time
    now = _time.time()
    if now - _EARN_WARM_MEMO.get(sym, 0) < 600:
        return
    _EARN_WARM_MEMO[sym] = now

    def _job():
        try:
            from api.services.earnings_estimates import get_year_earnings
            get_year_earnings(sym, datetime.now(timezone.utc).year)
        except Exception:
            pass

    threading.Thread(target=_job, daemon=True, name=f"ais-earnwarm-{sym}").start()


def _ctx_earnings_deep(sym: str) -> str:
    """Earnings history vs estimates + reaction + the implied-move series only
    the desk holds. Screener row + implied_store are ~1ms local reads; the
    quarters table is read WARM-ONLY (cache) with a background warm on miss."""
    bits: list[str] = []
    try:
        from api.services.screener import snapshot_db
        row = snapshot_db.get_row(sym) or {}
    except Exception:
        row = {}
    if row.get("last_report_move_pct") is not None:
        bits.append(f"last report moved {row['last_report_move_pct']:+.1f}%")
    if row.get("earnings_setup_grade"):
        bits.append(f"earnings setup grade {row['earnings_setup_grade']}")
    if row.get("days_to_earnings") is not None:
        bits.append(f"{row['days_to_earnings']}d to next report"
                    + (f" ({row['next_earnings_date']})" if row.get("next_earnings_date") else ""))
    if row.get("implied_move_pct") is not None:
        bits.append(f"options imply ±{row['implied_move_pct']:.1f}%")
    try:
        from api.services import implied_store
        hist = implied_store.get_implied_history(sym, limit=3) or []
        if hist:
            seq = ", ".join(f"±{h['pct']:.1f}% ({h['report_date']})"
                            for h in hist if h.get("pct") is not None)
            if seq:
                bits.append(f"prior pre-report implied moves: {seq}")
    except Exception:
        pass
    try:
        from api.services.cache import cache as _shared
        year = datetime.now(timezone.utc).year
        rows = _shared.get(f"mb_year_earnings_{sym}_{year}")
        if rows is None:
            _warm_year_earnings_bg(sym)
        else:
            reported = [r for r in rows if isinstance(r, dict) and r.get("eps_actual") is not None]
            qs = []
            for r in reported[-2:]:
                seg = f"Q{r.get('quarter')} EPS {r['eps_actual']}"
                if r.get("eps_estimate") is not None:
                    seg += f" vs {r['eps_estimate']}e"
                if r.get("eps_surprise_pct") is not None:
                    seg += f" ({r['eps_surprise_pct']:+.0f}%)"
                qs.append(seg)
            if qs:
                bits.append("recent quarters: " + "; ".join(qs))
    except Exception:
        pass
    return f"{sym} earnings intel (UCT data): " + "; ".join(bits) if bits else ""


def _ctx_call_recap(sym: str) -> str:
    """Transcript-grounded call recap — pure store read, never generates
    (call_recap_store.get is the read path by design)."""
    from api.services import call_recap_store
    r = call_recap_store.get(sym) or {}
    head = (r.get("headline") or "").strip()
    if not head:
        return ""
    bits = [head[:160]]
    if r.get("guidance") and r["guidance"] != "none":
        gd = (r.get("guidance_detail") or "").strip()
        bits.append(f"guidance {r['guidance']}" + (f" — {gd[:100]}" if gd else ""))
    for b in (r.get("bullets") or [])[:2]:
        bits.append(str(b)[:110])
    q = f" ({r['quarter']})" if r.get("quarter") else ""
    return f"{sym} earnings call{q} (UCT transcript-grounded recap): " + " | ".join(bits)


def _ctx_posture(sym: str) -> str:
    """Technical posture off the nightly screener snapshot — one SQLite row.
    NULLs render as absent (rs_rank in particular is routinely NULL)."""
    from api.services.screener import snapshot_db
    row = snapshot_db.get_row(sym) or {}
    if not row:
        return ""
    bits: list[str] = []
    for col, label in (("pct_vs_sma20", "20sma"), ("pct_vs_sma50", "50sma"),
                       ("pct_vs_sma200", "200sma")):
        if row.get(col) is not None:
            bits.append(f"{row[col]:+.1f}% vs {label}")
    if row.get("dist_52w_high_pct") is not None:
        bits.append(f"{row['dist_52w_high_pct']:+.1f}% vs 52w high")
    # Real DOLLAR levels. Everything else here is a percentage, so a member
    # asking "where's the entry" got no price to anchor on and the model
    # computed one — which is why `price_without_tool` kept firing on answers
    # the judge rated 4/4/4/4. These are also the levels this desk's own
    # playbook trades off ("PREV DAY HIGH BREAK"). Rendered independently:
    # a break level is useful even when the low is missing.
    if row.get("prev_day_high") is not None:
        bits.append(f"prev day high ${row['prev_day_high']:g}")
    if row.get("prev_day_low") is not None:
        bits.append(f"prev day low ${row['prev_day_low']:g}")
    if row.get("rsi14") is not None:
        bits.append(f"RSI {row['rsi14']:.0f}")
    if row.get("adr_pct") is not None:
        bits.append(f"ADR {row['adr_pct']:.1f}%")
    if row.get("rs_rank") is not None:
        bits.append(f"RS rank {row['rs_rank']}")
    if row.get("uct_composite") is not None:
        bits.append(f"UCT composite {row['uct_composite']}")
    if row.get("stage2"):
        bits.append("Stage 2 uptrend")
    elif row.get("stage4"):
        bits.append("Stage 4 downtrend")
    if row.get("candle_recent_label") or row.get("candle_recent"):
        bits.append(f"recent candle: {row.get('candle_recent_label') or row.get('candle_recent')}")
    if row.get("bar_character_label") or row.get("bar_character"):
        bits.append(f"bar character: {row.get('bar_character_label') or row.get('bar_character')}")
    if row.get("short_float_pct") is not None:
        bits.append(f"short float {row['short_float_pct']:.1f}%")
    if row.get("theme"):
        bits.append(f"theme: {row['theme']}")
    return f"{sym} technical posture (UCT nightly snapshot): " + ", ".join(bits) if bits else ""


def _ctx_verdict(sym: str) -> str:
    """The deterministic GO/HOLD/SKIP verdict (grade_ticker) — the model
    narrates a computed answer instead of hedging. Every number is tool-sourced;
    hard flags are surfaced so a SKIP-for-missing-data reads as exactly that."""
    from api.services.grade_ticker import grade_ticker
    v = grade_ticker(sym) or {}
    if not v.get("ok"):
        return ""
    bits = [f"verdict {v.get('verdict')}", f"regime {v.get('regime')}"]
    if v.get("setup"):
        bits.append(f"setup {v['setup']}" + (f" grade {v['grade']}" if v.get("grade") else ""))
    if v.get("entry") is not None and v.get("stop") is not None:
        seg = f"entry {v['entry']} / stop {v['stop']}"
        if v.get("first_target") is not None:
            seg += f" / target {v['first_target']}"
        bits.append(seg)
    if v.get("size_pct") is not None:
        bits.append(f"size {v['size_pct']}% ({v.get('account_risk_pct')}% acct risk)")
    if v.get("hard_flags"):
        bits.append("flags: " + ",".join(str(f) for f in v["hard_flags"]))
    basis = (v.get("basis") or "").strip()
    if basis:
        bits.append(basis[:160])
    return (f"{sym} desk verdict (UCT grade_ticker — deterministic, cite as the "
            f"firm's computed read): " + "; ".join(bits))


def _ctx_levels(sym: str) -> str:
    """Dark-pool levels (SQLite-backed, safe to build) + gamma walls read
    CACHE-ONLY — the GXW cold build is a live ~20s Schwab chain call and must
    never run inside an answer."""
    bits: list[str] = []
    try:
        from api.routers import signature
        dpl = signature._serve_dpl(sym) or {}
        levels = dpl.get("levels")
        if levels:   # None = build failed (not "no levels") — render nothing
            seg = ", ".join(
                f"${lv['price']:g} (${(lv.get('notional') or 0) / 1e6:.0f}M, "
                f"{lv.get('printCount', '?')} prints)"
                for lv in levels[:3] if isinstance(lv, dict) and lv.get("price"))
            if seg:
                bits.append(f"dark-pool levels: {seg}")
        gxw = None
        try:
            from api.services.cache import cache as _shared
            gxw = _shared.get(signature._ck("gxw", sym))
            if not gxw:
                peek = signature._GXW_STALE.peek(sym)
                if peek:
                    gxw = peek[0]
        except Exception:
            gxw = None
        if gxw and gxw.get("levels"):
            segs = []
            for lv in gxw["levels"]:
                if isinstance(lv, dict) and lv.get("price"):
                    kind = {"callWall": "call wall", "putWall": "put wall",
                            "zeroGamma": "zero-gamma"}.get(lv.get("kind"), lv.get("kind"))
                    segs.append(f"{kind} ${lv['price']:g}")
            if segs:
                spot = f" (spot ${gxw['spot']:g})" if gxw.get("spot") else ""
                bits.append("gamma: " + ", ".join(segs) + spot)
    except Exception:
        pass
    # The desk's OWN playbook entry is a prev-day-high break, and this pack —
    # the one whose entire job is price levels — carried only dark-pool and
    # gamma prices. "Where's the entry?" routes here, not to posture, so the
    # model had no desk level to anchor on and computed one.
    try:
        from api.services.screener import snapshot_db
        row = snapshot_db.get_row(sym) or {}
        if row.get("prev_day_high") is not None:
            bits.append(f"prev day high ${row['prev_day_high']:g}")
        if row.get("prev_day_low") is not None:
            bits.append(f"prev day low ${row['prev_day_low']:g}")
    except Exception:
        pass
    return f"{sym} key levels (UCT desk): " + "; ".join(bits) if bits else ""


# "Which of today's candidates has the best setup?" — a question about a desk
# LIST, naming no ticker, so the per-ticker packs never run and the model picks
# a name and justifies it from nothing. Both halves are required: a ranking word
# AND a list the desk actually owns.
_LIST_SCOPE_RE = re.compile(
    r"\b(scanner|candidates?|the scan|on the scan|watch ?list|uct ?20)\b", re.I)
_RANK_RE = re.compile(
    r"\b(best|which (?:one|of)|rank(?:ed|ing)?|top (?:pick|name|setup)"
    r"|strongest|most compelling)\b", re.I)
_LIST_VERDICT_MAX = 3          # grade_ticker is a real computation per symbol


def _candidate_symbols(limit: int) -> list[str]:
    """Top scanner symbols, newest scan. ⛔ The buckets are NESTED and the key is
    `ticker` — see _ctx_candidates for the history of getting that wrong."""
    try:
        from api.services.engine import get_candidates
        buckets = (get_candidates() or {}).get("candidates") or {}
    except Exception:
        return []
    out: list[str] = []
    for rows in buckets.values():
        for r in (rows or []):
            t = str((r or {}).get("ticker") or "").upper().strip()
            if t and t not in out:
                out.append(t)
            if len(out) >= limit:
                return out
    return out


def _ctx_list_verdict(query: str, syms: list[str]) -> str:
    """The desk's read on the top names of a list the member asked to rank."""
    if syms:                       # named a ticker → per-ticker packs own it
        return ""
    q = query or ""
    if not (_LIST_SCOPE_RE.search(q) and _RANK_RE.search(q)):
        return ""
    segs = []
    for sym in _candidate_symbols(_LIST_VERDICT_MAX):
        try:
            line = _ctx_verdict(sym)
        except Exception:
            line = ""
        if line:
            segs.append(line)
    return ("Desk read on the top scan names: " + " || ".join(segs)) if segs else ""


_SHORT_INT_RE = re.compile(r"\bshort (?:interest|float)\b|\bsqueeze\b", re.I)


def _short_interest_missing(syms: list[str]) -> bool:
    """True when NO named symbol has a short float on its screener row.

    The nightly Finviz snapshot leaves `short_float_pct` NULL for plenty of
    names — sparse the same way implied_move_pct is. Silence there reads to the
    model as "the desk didn't mention it", not "the desk doesn't have it".
    """
    try:
        from api.services.screener import snapshot_db
    except Exception:
        return False
    for s in (syms or [])[:2]:
        try:
            row = snapshot_db.get_row(s) or {}
        except Exception:
            return False          # can't tell → never claim a gap
        if row.get("short_float_pct") is not None:
            return False
    return True


_HIST_DATE_RE = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")

_MONTHS = {m: i for i, m in enumerate(
    ("jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"), start=1)}

# "March 3rd, 2016" · "Sep 18 2025" · "20 August 2026". Traders do not type ISO,
# and the log's most-asked shape is a dated question.
# ⛔ BOTH a day number and a 20xx year are mandatory — without them "will NVDA
# march higher" and "stocks may rally" become history lookups.
_HIST_WORD_DATE_RE = re.compile(
    r"\b(?:(?P<m1>[A-Za-z]{3,9})\s+(?P<d1>\d{1,2})(?:st|nd|rd|th)?"
    r"|(?P<d2>\d{1,2})(?:st|nd|rd|th)?\s+(?P<m2>[A-Za-z]{3,9}))"
    r",?\s+(?P<y>20\d{2})\b", re.I)


def _hist_written_date(query: str) -> tuple[int, int, int] | None:
    """(y, m, d) from a written date, or None. Month must be a real month name."""
    m = _HIST_WORD_DATE_RE.search(query or "")
    if not m:
        return None
    word = (m.group("m1") or m.group("m2") or "").lower()[:3]
    mon = _MONTHS.get(word)
    if not mon:
        return None
    day = int(m.group("d1") or m.group("d2"))
    return int(m.group("y")), mon, day


def _hist_date_ymd(query: str) -> int | None:
    """A PAST calendar date named in the question, as a YYYYMMDD int, else None.

    Today is deliberately excluded: the live quote pack already answers it with
    fresher data, and a stored daily bar for today is mid-session. A future date
    ("does INTC report on 2026-11-04?") is not a history lookup at all.
    """
    m = _HIST_DATE_RE.search(query or "")
    if m:
        y, mo, d = (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    else:
        written = _hist_written_date(query)
        if not written:
            return None
        y, mo, d = written
    try:
        import datetime as _dt
        _dt.date(y, mo, d)                       # reject 2025-13-45
    except ValueError:
        return None
    ymd = y * 10000 + mo * 100 + d
    try:
        today = int(_et_day().replace("-", ""))
    except Exception:
        return None
    return ymd if ymd < today else None


def _fmt_vol(v) -> str:
    try:
        v = float(v or 0)
    except (TypeError, ValueError):
        return "?"
    if v >= 1e9:
        return f"{v / 1e9:.1f}B"
    if v >= 1e6:
        return f"{v / 1e6:.1f}M"
    if v >= 1e3:
        return f"{v / 1e3:.0f}K"
    return f"{v:.0f}"


def _ctx_history(query: str, syms: list[str]) -> str:
    """That session's OHLCV + day move for a ticker named with a PAST date.

    The single most-asked shape in the prod capture log is "what moved <SYM> on
    <DATE>? give the specific % move that day" — and the desk was answering one
    of them "I don't have historical, date-stamped tape", while bars.db on the
    same pod held the bar. This hands it over.

    ⛔ If the named date had no session, this returns "". Labelling the previous
    Friday's bar with the Saturday a member typed would be fabricated precision,
    which is worse than the honest "I don't have it" it replaces.
    """
    ymd = _hist_date_ymd(query)
    if not ymd or not syms:
        return ""
    from api.services import bars_sqlite
    segs: list[str] = []
    for sym in syms[:2]:
        rows = bars_sqlite.get_bars_before(sym, "D", 2, ymd) or []
        if not rows or int(rows[-1][0]) != ymd:
            continue
        _ts, o, h, l, c, v = rows[-1][:6]
        iso = f"{ymd // 10000:04d}-{(ymd // 100) % 100:02d}-{ymd % 100:02d}"
        seg = (f"{sym} on {iso} (UCT desk daily bar): open ${o:g}, high ${h:g}, "
               f"low ${l:g}, close ${c:g}, volume {_fmt_vol(v)}")
        prior = rows[-2][4] if len(rows) >= 2 else None
        if prior:
            seg += f"; {(c - prior) / prior * 100:+.1f}% vs prior close ${prior:g}"
        segs.append(seg)
    return "; ".join(segs)


def _ctx_ticker_news(sym: str) -> str:
    """Per-ticker headlines w/ sentiment (Massive/Polygon, 5-min module cache)
    — the why-is-it-moving fallback when the curated tape has nothing."""
    from api.services import polygon_news
    res = polygon_news.get_news(sym, limit=3) or {}
    items = res.get("items") or []
    if not items:
        return ""
    segs = []
    for it in items[:3]:
        t = (it.get("title") or "").strip()[:90]
        if not t:
            continue
        s = it.get("ticker_sentiment")
        segs.append(f"{t}" + (f" [{s}]" if s else ""))
    return f"{sym} news (UCT feed): " + " | ".join(segs) if segs else ""


# Wave-2 intent gates — same discipline as the four above: anchored so a plain
# price/flow question doesn't pay for packs it didn't ask for.
_EARNINGS_DEEP_RE = re.compile(
    r"\b(vs\.?,? estimates?|compared? (?:to|with|against) (?:the )?estimates?"
    r"|beat|miss(?:ed|es)?\b|last (?:quarter|earnings|report|print)"
    r"|past earnings|earnings (?:history|track record|reaction)"
    r"|(?:implied|expected) move|post[- ]earnings|after (?:past )?earnings"
    r"|how did .{0,24}?\b(?:print|report|quarter|numbers?)\b"
    r"|(?:print|report|quarter|numbers?) (?:compare|go|look)"
    r"|reported? (?:eps|revenue|earnings))\b", re.I)
_CALL_RECAP_RE = re.compile(
    r"\b((?:earnings|conference) call|on the (?:earnings )?call|the call itself"
    r"|management (?:said|guided?|tone|sound)|guidance|guided? to|guide to"
    r"|transcript|prepared remarks|q&a|(?:ceo|cfo) said)\b", re.I)
_POSTURE_RE = re.compile(
    r"\b(extended|overbought|oversold|technicals?|technical (?:posture|picture|read)"
    r"|trend\b|moving averages?|\d{1,3}[- ]day(?: (?:ma|sma|ema|line|average))?"
    r"|rs rank|relative strength|stage [24]|setting up|tight(?:ening)? (?:range|action)"
    r"|consolidat|basing|uct (?:rating|composite)|short (?:interest|float)|squeeze)\b", re.I)
_VERDICT_RE = re.compile(
    r"\b(trade (?:setup|opportunit(?:y|ies)|idea)|find (?:me )?a (?:good )?(?:trade|setup|entry)"
    r"|should i (?:buy|enter|take|get in)|worth (?:a )?(?:trade|buy(?:ing)?|swing|entry)"
    r"|how would you trade|entry and stop|is (?:it|this) a buy"
    r"|good (?:swing|trade|entry) here|call this trade|grade (?:this|the) (?:setup|trade)"
    # 2026-08-29: the gate for "give me the desk's call" did not contain the
    # word `verdict`, nor "best setup" — the two phrasings the exam actually used.
    r"|verdict|desk read|best setup|where'?s the entry)\b", re.I)
_LEVELS_RE = re.compile(
    # bare `levels?` 2026-08-29: "what levels matter" reached the model with no
    # dark-pool/gamma pack, because the gate only knew three fixed phrasings.
    r"\b(support|resistance|levels?|dark ?pool"
    r"|gamma\b|gex\b|call wall|put wall|zero[- ]gamma|max pain)\b", re.I)

# COT / futures positioning — a market-level ask resolved from the query's own
# words (futures markets aren't in cap_universe, and 'COT' is stop-listed).
_COT_RE = re.compile(
    r"\b(cot\b|commitment of traders|positioning|commercials|large specs?"
    r"|net (?:long|short) positioning|spec(?:ulator)?s? (?:net|positioning))\b", re.I)
_COT_ALIASES = {
    "gold": "GC", "silver": "SI", "copper": "HG", "platinum": "PL", "palladium": "PA",
    "crude": "CL", "crude oil": "CL", "oil": "CL", "wti": "CL", "brent": "BZ",
    "nat gas": "NG", "natural gas": "NG", "gasoline": "RB", "heating oil": "HO",
    "dollar": "DX", "dxy": "DX", "euro": "E6", "yen": "J6", "pound": "B6",
    "bitcoin": "BTC", "btc": "BTC", "ethereum": "ETH", "eth": "ETH",
    "s&p": "ES", "spx": "ES", "nasdaq": "NQ", "dow": "YM", "russell": "QR",
    "vix": "VI", "10-year": "ZN", "10 year": "ZN", "ten-year": "ZN",
    "bonds": "ZB", "treasuries": "ZB", "2-year": "ZT", "5-year": "ZF",
    "corn": "ZC", "wheat": "ZW", "soybeans": "ZS", "beans": "ZS",
    "coffee": "KC", "sugar": "SB", "cocoa": "CC", "cotton": "CT",
    "cattle": "LE", "hogs": "HE", "lumber": "LB",
}


def _cot_word_hit(name: str, q: str) -> bool:
    """Boundary-guarded alias match. Lookarounds instead of \\b because aliases
    like 's&p' and '10-year' contain non-word chars — a bare substring test made
    'gold' match inside \"Goldman's positioning\" and 'oil' inside 'turmoil',
    injecting the wrong futures market as desk context."""
    return re.search(r"(?<![a-z0-9])" + re.escape(name) + r"(?![a-z0-9])", q) is not None


def _cot_symbol_for(query: str) -> str | None:
    """Resolve which futures market a COT question is about — alias table first
    (multi-word aliases before single words), then the display-name map."""
    q = (query or "").lower()
    for name in sorted(_COT_ALIASES, key=len, reverse=True):
        if _cot_word_hit(name, q):
            return _COT_ALIASES[name]
    try:
        from api.services.cot_service import SYMBOL_NAMES
        for sym_code, disp in SYMBOL_NAMES.items():
            if disp and _cot_word_hit(disp.lower(), q):
                return sym_code
    except Exception:
        pass
    return None


def _ctx_cot(query: str) -> str:
    """The already-paid weekly COT narrative for the market the question names
    — a pure cot.db read (get_for/list_for_symbol never generate)."""
    sym = _cot_symbol_for(query)
    if not sym:
        return ""
    from api.services import cot_narrative
    rows = cot_narrative.list_for_symbol(sym, limit=1) or []
    if not rows:
        return ""
    r = rows[0]
    text = (r.get("text") or "").strip()
    if not text:
        return ""
    return (f"COT positioning — {sym}, report week {r.get('report_date')} "
            f"(UCT weekly read): {text[:380]}")


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
    # ⛔ `if not b` asked whether the dict was EMPTY; the invariant is whether it
    # holds usable VALUES. A payload of Nones sailed straight through and put
    # "score None, phase , adv/dec None/None" in front of the model — worse than
    # silence, because silence lets it say it has no breadth while "score None"
    # reads as a feed to interpret, and it filled the gap (measured 2026-08-29:
    # that question scored c1 g2 o2 s1 with a safety break).
    # ⛔ Test `is None`, never falsiness: ZERO advancing issues is a real and
    # dramatic reading, not a missing one.
    bits: list[str] = []
    if b.get("breadth_score") is not None:
        bits.append(f"score {b['breadth_score']}")
    if b.get("market_phase"):          # a string field: "" is not a phase
        bits.append(f"phase {b['market_phase']}")
    adv, dec = b.get("advancing"), b.get("declining")
    if adv is not None and dec is not None:
        bits.append(f"adv/dec {adv}/{dec}")
    nh, nl = b.get("new_highs"), b.get("new_lows")
    if nh is not None and nl is not None:
        bits.append(f"52wk NH/NL {nh}/{nl}")
    return "Breadth (UCT): " + ", ".join(bits) if bits else ""


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
    if not syms.strip(", "):
        return ""
    out = f"UCT20 leadership list (the firm's ranked top 20): {syms}"
    # get_leadership rows carry rank + thesis — stripping them to bare symbols
    # threw away the reason each name is on the list. Top 3 theses ride along.
    theses = []
    for i, r in enumerate(rows[:3]):
        if not isinstance(r, dict):
            continue
        th = str(r.get("thesis") or "").strip()
        tk = r.get("ticker") or r.get("sym") or ""
        if th and tk:
            theses.append(f"#{r.get('rank', i + 1)} {tk}: {th[:90]}")
    if theses:
        out += ". Top theses — " + "; ".join(theses)
    return out


def _ctx_candidates() -> str:
    """The 7 AM pre-market setup scan (`scanner_candidates.py` → the wire push).

    ⛔ THE BUCKETS ARE NESTED AND THE SYMBOL KEY IS `ticker`. This read used to
    ask `c.get("pullback_ma")` at the TOP level and pull `x["sym"]`, and
    `get_candidates()` answers neither — it returns
    `{generated_at, counts, candidates: {pullback_ma: [{ticker: ...}]}}`. So
    both names came back empty, the `not pb and not rm` guard fired, and this
    pack contributed NOTHING to any answer it was routed onto. It read as a
    quiet market rather than as a wrong key, which is why it survived: the whole
    failure is a bare `""`, and both tests that touch `_ctx_candidates`
    monkeypatch it, so the suite could not see the shape at all
    (`tests/test_ai_search_candidates_ctx.py` is the one that does).

    `voice_market_tools.get_scanner_candidates` already read the true shape —
    this is the second reader of one payload agreeing with the first, not a new
    opinion about it.
    """
    from api.services.engine import get_candidates
    buckets = (get_candidates() or {}).get("candidates") or {}

    def _syms(key: str) -> str:
        rows = buckets.get(key) or []
        return ", ".join(
            (r.get("ticker") or r.get("sym") or "") for r in rows[:5] if isinstance(r, dict)
        ).strip(", ")

    pb, rm = _syms("pullback_ma"), _syms("remount")
    if not pb and not rm:
        return ""
    return f"UCT scanner candidates today: pullbacks — {pb or 'none'}; remounts — {rm or 'none'}"


def _ctx_news() -> str:
    from api.services.engine import get_news
    items = get_news() or []
    heads = "; ".join((x.get("headline") or "")[:90] for x in items[:5] if isinstance(x, dict))
    return f"Latest headlines (UCT feed): {heads}" if heads else ""


def _ctx_wire() -> str:
    """The firm's own exposure dial (0-150 score + the daily note) — pushed by
    the morning wire, cached 1h, no network on the warm path."""
    from api.services.engine import get_breadth
    exp = (get_breadth() or {}).get("exposure") or {}
    score = exp.get("score")
    if score is None:
        return ""
    bits = [f"UCT exposure rating (the firm's own dial): {score}/150"]
    note = (exp.get("note") or "").strip()
    if note:
        bits.append(note[:160])
    if exp.get("gate_active") and exp.get("gate_reason"):
        bits.append(f"GATED: {str(exp['gate_reason'])[:120]}")
    return " — ".join(bits)


def _ctx_sector() -> str:
    """Sector strength (11 SPDRs, 15-min cache, single-flighted) + 1W theme
    leaders off the wire push. Best-effort both halves."""
    bits: list[str] = []
    try:
        from api.services.sector_strength import get_sector_strength
        rows = get_sector_strength("1W") or []
        if rows:
            top = ", ".join(f"{r['sector']} {r['change_pct']:+.1f}%" for r in rows[:3])
            low = ", ".join(f"{r['sector']} {r['change_pct']:+.1f}%" for r in rows[-2:])
            bits.append(f"1W sector strength (UCT): leaders — {top}; laggards — {low}")
    except Exception:
        pass
    try:
        from api.services.engine import get_themes
        th = get_themes("1W") or {}
        leaders = [x.get("name") for x in (th.get("leaders") or [])[:3] if isinstance(x, dict)]
        if leaders:
            bits.append("leading themes (1W): " + ", ".join(str(x) for x in leaders if x))
    except Exception:
        pass
    return "; ".join(bits)


# (regex, provider name) — resolved via getattr at call time so tests can patch.
# Each anchored to market-LEVEL phrasing so single-stock questions naming a
# collision ticker (AMC, BMO, NOW…) don't pull an unrelated market feed.
_MACRO_CAL_RE = re.compile(
    r"\b(economic calendar|econ calendar|cpi\b|ppi\b|pce\b|fomc|jobs report"
    r"|nonfarm|payrolls|nfp\b|jobless claims|gdp\b|retail sales"
    r"|rate (?:decision|cut|hike)|fed (?:meeting|decision|decides?)"
    r"|when does the fed|inflation (?:print|report|data))\b", re.I)


def _ctx_macro() -> str:
    """This week's US econ calendar — the desk's own feed.

    The fast lane had NO macro pack, so "when is the next CPI print" reached the
    model with `regime` grounding and nothing else. Returns "" when the feed is
    empty, which the assembler declares as a DESK GAP — the honest answer.
    """
    try:
        from api.services import voice_tool_impls
        items = voice_tool_impls._economic_calendar()[:6]
    except Exception:
        return ""
    segs = [f"{it['date']} {it.get('time', '')} {it['title']}".strip()
            for it in items if it.get("title")]
    return "US econ calendar (UCT desk): " + " | ".join(segs) if segs else ""


_INTENT_SPECS: list[tuple[re.Pattern, str]] = [
    (_MACRO_CAL_RE, "_ctx_macro"),
    (re.compile(r"\b(movers?|gainers?|losers?|ripping|what'?s moving|gapp(?:ing|ers?)|gaps? (?:up|down)|biggest (moves?|movers?|gainers?|losers?))\b", re.I), "_ctx_movers"),
    (re.compile(r"\b(advance[- ]decline|advancers?|decliners?|market breadth|breadth|market internals|internals|new (highs?|lows?)|market (health|conditions?)|net exposure|market exposure)\b", re.I), "_ctx_breadth"),
    (re.compile(r"\b(earnings (today|tonight|this week)|who(?:'?s| is| are)? reporting|who reports?|reporting (today|tonight|this week)|(?:reporting|earnings)\s+(?:bmo|amc)|\b(?:bmo|amc)\b(?=[^a-z]*\b(?:earnings|reports?|reporters?|tonight|today)\b))", re.I), "_ctx_earnings"),
    (re.compile(r"\b(uct ?20|leadership (list|names|20)|(?:your|firm'?s|the firm'?s|uct) top (stocks|names|picks|ideas|20))\b", re.I), "_ctx_uct20"),
    (re.compile(r"\b(scanner|(?:trade|long|buy|swing) candidates?|setups? (?:today|on watch|on the scan)|pullbacks?|remounts?|watch ?list ideas|on the scan)\b", re.I), "_ctx_candidates"),
    (re.compile(r"\b(headlines?|the tape|top stories|market news|news (?:today|this morning|before the open))\b", re.I), "_ctx_news"),
    (re.compile(r"\b(uct exposure|exposure (?:rating|score)|game ?plan|top (?:5|five) picks?"
                r"|today'?s picks?|morning wire|how much (?:should i be |are we )?invested)\b", re.I), "_ctx_wire"),
    (re.compile(r"\b(sector rotation|(?:strongest|weakest|leading|lagging|hottest) (?:sectors?|groups?|themes?)"
                r"|sector strength|which sectors?|rotation (?:into|out of))\b", re.I), "_ctx_sector"),
]

_CTX_BUDGET = 3600   # chars — keep grounding a supplement, not a payload
                     # (2600 → 3600 with the Wave-2 packs, 2026-08-27)

# Answer budget. 700 (the value through 2026-08-29) is ~500 words: the wrapper
# was asking the SAME model raw Perplexity uses for a fraction of the answer,
# then telling it "never an essay" on top. Length now follows the question —
# see _WIDGET_INTRO. Cost of the raise is ~$0.017/ask at sonar-pro output rates.
_ANSWER_MAX_TOKENS = 1800
_PUBLIC_MAX_TOKENS = 900     # unauthenticated teaser path stays tighter


#: Own cost surface, so synthesis spend is separable from the Perplexity leg in
#: `llm_route_cost_log` and cappable on its own.
_SYNTH_SURFACE = "ai_search_synth"
_SYNTH_CAP_ENV = "AI_SEARCH_SYNTH_DAILY_CAP"
_SYNTH_CAP_DEFAULT = 5.0          # USD/ET-day; ~135 asks at the measured $0.037


def _claude_synth_enabled() -> bool:
    """OFF by default. Adds one Anthropic call per ask — a spend decision, so a
    Railway var rather than a code default."""
    return os.environ.get("AI_SEARCH_CLAUDE_SYNTH", "0").strip().lower() in (
        "1", "true", "yes", "on")


_SYNTH_NOTE = (
    "\n\nWEB FINDINGS (a live web search already ran for this question; its "
    "answer and numbered sources follow). Treat them as RETRIEVAL, not as your "
    "answer: reason over them together with the UCT desk data above, and prefer "
    "a desk figure over a web one whenever both exist. If the two disagree, say "
    "so.\n"
    "CITATION RULE — every FIGURE you take from the web findings carries its "
    "[n] marker IMMEDIATELY after it, in the same sentence, reusing the SAME "
    "numbering. A desk figure needs no [n]; attribute it to 'UCT desk data' "
    "instead. A number with neither an [n] nor a desk attribution reads as "
    "invented — if you cannot source it either way, leave it out.\n")


def _claude_synthesis(query: str, system: str, web: dict, history) -> dict | None:
    """Perplexity retrieves; Claude thinks. Returns None to leave `web` standing.

    The fast lane synthesises with `sonar-pro`, so on open-ended reasoning a
    member was getting a Perplexity-model answer while our whole advantage — the
    desk data — was already in the prompt. This keeps Perplexity for what it is
    genuinely good at (searching the live web, returning cited sources) and
    hands the SYNTHESIS to Claude over the desk context plus those findings.

    ⛔ Never raises and never swallows a member's answer: any failure returns
    None and the caller ships the Perplexity result unchanged.
    """
    web = web or {}
    if web.get("error"):
        return None                    # a provider error belongs to the outage ladder
    web_answer = (web.get("answer") or "").strip()
    if not web_answer and not (system or "").strip():
        return None                    # nothing to reason over
    try:
        # Bounded and visible. This lane called Anthropic directly and recorded
        # NOTHING — invisible to /admin/stats.spend_today_usd and capped by
        # nothing. Over budget we skip Claude entirely and the member still gets
        # the Perplexity answer: degrade, never fail.
        from api.services import narrative_cost_guard as _guard
        if _guard.over_budget(_SYNTH_SURFACE, _SYNTH_CAP_ENV, _SYNTH_CAP_DEFAULT):
            return None
    except Exception:
        pass                      # a guard fault must not silence the lane
    try:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
        if client is None:
            return None
        model = os.environ.get("AI_SEARCH_SYNTH_MODEL", "claude-sonnet-5").strip()
        cites = [str(c) for c in (web.get("citations") or [])][:20]
        block = _SYNTH_NOTE + web_answer
        if cites:
            block += "\n\nSOURCES: " + " ".join(
                f"[{i}] {c}" for i, c in enumerate(cites, start=1))
        msgs: list[dict] = []
        for h in (history or []):
            q, a = (h.get("q") or "").strip(), (h.get("a") or "").strip()
            if q and a:
                msgs.append({"role": "user", "content": q})
                msgs.append({"role": "assistant", "content": a})
        msgs.append({"role": "user", "content": query})
        # Prompt caching. `_WIDGET_SYSTEM` is byte-identical on EVERY request
        # (intro + safety blocks + formatting) and measured 1299 tokens, above
        # Sonnet 5's 1024 minimum. Caching is a PREFIX match, so the breakpoint
        # goes at the end of the stable text and every volatile thing — the desk
        # quote, the playbook, the web findings — must sit AFTER it, or each
        # request writes a fresh entry and reads nothing back.
        #
        # ⚠️ HONEST ECONOMICS: a 5-minute write bills 1.25x and a read 0.1x, so
        # break-even is TWO requests sharing the prefix. At the logged ~1.7
        # asks/day nearly every call is a cold write and this costs ~$0.03/MONTH
        # more; at bursty member volume the reads dominate and it saves ~$70/mo
        # at 30k asks. Kept because the structure is right and the downside is
        # noise. ⛔ Do NOT "fix" this with ttl:"1h" — that doubles the write to
        # 2x and only pays off for 5-60 minute gaps; ours are hours or seconds.
        full = (system or "")
        if full.startswith(_WIDGET_SYSTEM):
            sys_param: object = [
                {"type": "text", "text": _WIDGET_SYSTEM,
                 "cache_control": {"type": "ephemeral"}},
                {"type": "text", "text": full[len(_WIDGET_SYSTEM):] + block},
            ]
        else:
            sys_param = full + block      # unexpected shape → answer uncached
        resp = client.with_options(timeout=30).messages.create(
            model=model, max_tokens=_ANSWER_MAX_TOKENS,
            system=sys_param, messages=msgs)
        try:
            # ⛔ record_from_response, not record(input_tokens=...): a cached
            # prefix arrives as cache_read_input_tokens (0.1x) /
            # cache_creation_input_tokens (1.25x) and NEVER as input_tokens, so
            # a guard fed only input_tokens mis-bills every cached call.
            from api.services import narrative_cost_guard as _g
            _g.record_from_response(_SYNTH_SURFACE, model, resp)
        except Exception:
            pass                  # accounting is bookkeeping; the answer stands
        text = "".join(
            b.text for b in (resp.content or []) if getattr(b, "type", "") == "text"
        ).strip()
        if not text:
            return None
        out = dict(web)
        out.update({"answer": text, "model": model, "synth": "claude"})
        # Surfaced so a silent cache miss is observable rather than invisible:
        # zero reads across repeated asks means an invalidator crept into the
        # prefix.
        u = getattr(resp, "usage", None)
        if u is not None:
            out["cache_read_tokens"] = getattr(u, "cache_read_input_tokens", None)
            out["cache_write_tokens"] = getattr(u, "cache_creation_input_tokens", None)
        return out
    except Exception:
        return None


def fast_lane_answer(query: str, system: str, salt: str, *, mode: str = "fast",
                     history=None, cost_surface: str = "ai_search",
                     allow_stale: bool = True) -> dict:
    """THE definition of the fast (Perplexity) lane's provider call.

    Three byte-identical copies of this call lived in this file — the single
    shot plus two stream fallbacks — all passing the same max_tokens,
    domain_pack, recency, salt and cost surface. That is how a 700-token cap
    and an 18-site domain allowlist survived review for months: a reader fixes
    the copy they found. One definition, and `tests/test_ai_search_fast_lane_
    exam.py` fails BY NAME (via AST) on a fourth.

    It is also the exam's SEAM for this lane — the fast-lane twin of the agent
    lane's tool-capture hook. Grading a lane through a second, hand-copied set
    of parameters would grade something members never receive.

    (Deliberately phrased without that hook's keyword: a standing rail greps
    THIS file to prove the router never opts into it, and a comment quoting it
    is indistinguishable from a call site to a text search.)
    """
    res = perplexity_search.web_search(
        query, max_tokens=_ANSWER_MAX_TOKENS, system=system, mode=mode,
        domain_pack="finance", recency=_auto_recency(query), related=True,
        cache_salt=salt, history=history, cost_surface=cost_surface,
        allow_stale=allow_stale)   # UI labels stale answers
    # Perplexity retrieves; Claude thinks — when armed. Inside the helper on
    # purpose, so the single shot, both stream fallbacks and the exam all get it
    # from ONE place. Falls back to `res` on any failure.
    if _claude_synth_enabled():
        res = _claude_synthesis(query, system, res, history) or res
    return res


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
            "recency": None, "had_live_price": False, "ctx_block": "",
            "query_tickers": [], "grounding_gaps": []}


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
        _flow_any = False
        for s in syms[:2]:
            try:
                _line = _ctx_flow_ticker(s)
            except Exception:
                _line = ""
            if _line:
                _add("flow", _line)
                _flow_any = True
        # Asked for flow, desk has none → say so. Silence reads to the model as
        # "the desk didn't mention it", and it invents flow.
        if syms and not _flow_any:
            meta["grounding_gaps"].append("flow")
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
    if _EARNINGS_DEEP_RE.search(q):
        _perticker.append(("earnings_deep", "_ctx_earnings_deep"))
    if _CALL_RECAP_RE.search(q):
        _perticker.append(("call_recap", "_ctx_call_recap"))
    if _POSTURE_RE.search(q):
        _perticker.append(("posture", "_ctx_posture"))
    if _VERDICT_RE.search(q):
        _perticker.append(("verdict", "_ctx_verdict"))
    if _LEVELS_RE.search(q):
        _perticker.append(("levels", "_ctx_levels"))
    for source, fn_name in _perticker:
        fn = getattr(_this, fn_name)
        got_any = False
        for s in syms[:2]:
            try:
                line = fn(s)
            except Exception:
                line = ""
            if line:
                _add(source, line)
                got_any = True
        # Same rule as the market-level packs: a pack the QUESTION opened that
        # comes back empty is a declared gap, not silence. ⛔ One symbol
        # answering is enough — declaring a gap while handing over real data
        # for the other name would tell the model the desk is empty when it is
        # not.
        if syms and not got_any and source not in meta["grounding_gaps"]:
            meta["grounding_gaps"].append(source)
    # Why-is-it-moving asks with a silent tape: per-ticker news fallback so the
    # model isn't left guessing from the web alone (first symbol only).
    if meta["recency"] == "day" and syms and "tape" not in meta["grounding_sources"]:
        try:
            _add("news_ticker", _ctx_ticker_news(syms[0]))
        except Exception:
            pass
    salt_bits.extend(syms)
    this_mod = sys.modules[__name__]
    for rx, fn_name in _INTENT_SPECS:
        if not rx.search(query or ""):
            continue
        name = fn_name.replace("_ctx_", "")
        try:
            line = getattr(this_mod, fn_name)()
        except Exception:
            line = ""
        if line:
            _add(name, line)
            meta["grounding_intents"].append(name)
        else:
            # The member ASKED for this and the desk has nothing. Silence is
            # indistinguishable from "we never looked", so the model fills the
            # gap — rung 4 (data-limits honesty) scores 0/5 on this lane and the
            # breadth question fabricates every run. Declaring the absence is
            # NOT the same as leaking a null: "score None" reads as a data
            # VALUE, "no current data" reads as a stated gap.
            meta["grounding_gaps"].append(name)
    # "Which of today's candidates is best?" names no ticker, so nothing above
    # graded anything. Resolve the names from the desk's own list and read them.
    try:
        _lv = _ctx_list_verdict(query or "", syms)
        if _lv:
            _add("list_verdict", _lv)
    except Exception:
        pass
    # A pack can FIRE and still not answer what was asked. The posture gate is
    # broad (trend / RSI / stage 2 / short interest), so a short-interest ask
    # gets a TECHNICAL posture line back — and the model, seeing a confident
    # desk line with no short interest in it, invents a number. Measured: that
    # question scored c0 g0 s0 on every single exam run.
    if _SHORT_INT_RE.search(query or "") and syms and _short_interest_missing(syms):
        meta["grounding_gaps"].append("short interest")
    # Historical session — query-resolved like COT below, because the trigger is
    # a DATE in the question, which the per-ticker machinery has no notion of.
    # Answers the most-asked shape in the capture log ("what moved X on DATE?
    # give the specific % move that day") from bars we already hold.
    if _hist_date_ymd(query or ""):
        try:
            line = _ctx_history(query or "", syms)
            if line:
                _add("history", line)
                meta["grounding_intents"].append("history")
        except Exception:
            pass
    # COT / futures positioning — resolved from the query's own words (futures
    # roots aren't in cap_universe, so the per-ticker machinery can't carry it).
    if _COT_RE.search(query or ""):
        try:
            line = _ctx_cot(query or "")
            if line:
                _add("cot", line)
                meta["grounding_intents"].append("cot")
        except Exception:
            pass
    if meta["grounding_gaps"]:
        parts.append(
            "DESK GAPS (the member asked for these and the desk has no current "
            "data for them: " + ", ".join(meta["grounding_gaps"]) + ") — say so "
            "plainly, do not estimate them, and never pass a web figure off as "
            "desk data.")
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


# ── House-KB grounding (2026-08-28): the owner's 8,978-entry trading knowledge
# base has been one warm index away this whole time — brain_index.db lives on
# the same pod, reindexed on every nightly Brain Pack install, and AI Search
# never touched it (only Compass voice tools and community /ask did). Craft and
# setup questions now pull the firm's own methodology passages.
# "other" is the BACKSTOP (2026-08-29): the classifier is a regex and will miss
# again. When it does, the miss must still reach the KB rather than silently
# losing the firm's own methodology the way "exhaustion extension" did.
_BRAIN_ELIGIBLE = {"concept-education", "valuation", "compare", "setup-technical", "other"}
_BRAIN_MIN_SCORE = 0.34   # same floor the Phase-2 memory blend uses


def _brain_enabled() -> bool:
    return os.environ.get("AI_SEARCH_BRAIN_ENABLED", "1").strip().lower() not in ("0", "false", "no")


def _brain_context(query: str, question_type: str | None, verdict_ask: bool) -> str:
    """Top methodology passages from the installed Brain Pack, or "". Only for
    question shapes where craft beats news (plus any explicit setup/trade ask).
    Makes one embedding call — callers already run _grounded_system off the
    event loop for exactly this class of blocking work."""
    if not _brain_enabled():
        return ""
    if question_type not in _BRAIN_ELIGIBLE and not verdict_ask:
        return ""
    from api.services import brain_kb_service
    hits = [h for h in (brain_kb_service.search(query, k=3) or [])
            if (h.get("score") or 0) >= _BRAIN_MIN_SCORE][:2]
    if not hits:
        return ""
    segs = []
    for h in hits:
        who = h.get("trader") or "firm KB"
        segs.append(f"[{who} — {h.get('title')}] {(h.get('text') or '').strip()[:350]}")
    return (
        "\n\nUCT PLAYBOOK (the firm's own trading methodology — timeless craft, "
        "not today's data; cite as 'the UCT playbook'): " + " | ".join(segs)
    )


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
    # House KB — methodology passages for craft/setup questions (best-effort).
    try:
        bctx = _brain_context(query, meta.get("question_type"),
                              bool(_VERDICT_RE.search(query or "")))
        if bctx:
            system += bctx
            if "playbook" not in meta["grounding_sources"]:
                meta["grounding_sources"].append("playbook")
    except Exception:
        pass
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


# ── Do-things-from-the-ask-box (2026-08-28): "alert me when NVDA breaks 190"
# yields a PROPOSAL the widget renders as a one-tap confirm chip. The server
# never auto-creates the alert — an LLM surface must not mutate member state
# off a regex; the member's tap posts to the existing /api/watchlist-alerts.
_ALERT_ASK_RE = re.compile(
    r"\b(alert me|let me know (?:if|when)|notify me|ping me|set (?:an?|a price) alert"
    r"|watch (?:for|it) (?:and )?(?:tell|ping|alert) me)\b", re.I)
# A "price" that is really a percent, a period ("52-week"), or a magnitude
# ("4 trillion") must never become an alert level — the review executed the
# first cut of these regexes and got 'below $5' from "drops 5%" and
# 'below $52' from "hits 52-week highs".
_NUM = r"(\d+(?:\.\d+)?)\b(?!\s*(?:%|percent\b))(?!-)"
# EXPLICIT direction words are taken literally — never quote-flipped.
_ALERT_ABOVE_EXPLICIT_RE = re.compile(
    r"\b(?:above|over|breaks?\s+(?:above|over|out\s+over)|crosses?\s+(?:above|over)"
    r"|clears?|reclaims?|takes?\s+out)\s+\$?" + _NUM, re.I)
# AMBIGUOUS verbs ("hits 90", bare "breaks 150") need the live quote to decide.
_ALERT_AMBIG_RE = re.compile(
    r"\b(?:breaks?|crosses?|hits?|reaches?|gets?\s+to)\s+\$?" + _NUM, re.I)
_ALERT_BELOW_RE = re.compile(
    r"\b(?:below|under|drops?(?:\s+(?:below|under|to))?|falls?(?:\s+(?:below|under|to))?"
    r"|loses|breaks?\s+down(?:\s+(?:through|below))?|undercuts?)\s+\$?" + _NUM, re.I)
# Words after the number that reveal it was never a price level.
_ALERT_NOT_A_PRICE_TAIL = re.compile(
    r"^\s*(?:%|percent\b|trillion\b|billion\b|million\b|levels?\b|users?\b"
    r"|shares?\b|contracts?\b|handles?\b|points?\b|pts?\b)", re.I)

# "Brief me on CRM every morning" → a standing-briefing proposal (same consent
# model as alerts: the server proposes, the member's tap creates it).
# Verb-shaped briefing phrasings only — adjectival 'keep it brief' beside a
# cadence word ("alert me daily… keep it brief") must not eat an alert ask.
_BRIEF_WORD_RE = re.compile(
    r"\b(?:brief|update)\s+me\b|\bbrief(?:ing)?\s+(?:on|about)\b"
    r"|\b(?:daily|morning|evening)\s+brief(?:ing)?\b", re.I)
_BRIEF_CADENCE_RE = re.compile(
    r"\b(?:every|each)\s+(morning|day|evening|night|close|open)\b"
    r"|\b(daily)\b|\bevery\s+(premarket|pre-market)\b", re.I)


def _briefing_proposal(query: str, syms: list[str]) -> dict | None:
    q = query or ""
    if not _BRIEF_WORD_RE.search(q):
        return None
    m = _BRIEF_CADENCE_RE.search(q)
    if not m:
        return None
    word = (m.group(1) or m.group(2) or m.group(3) or "").lower()
    cadence = "postmarket" if word in ("evening", "night", "close") else "premarket"
    return {"kind": "briefing", "query": q[:500],
            "sym": (syms[0] if syms else None), "cadence": cadence}


# "Deep report on CRM every Sunday" → a weekly Deep Research proposal. Needs
# BOTH a deep-work phrase and a weekly cadence phrase — "keep it brief every
# sunday" and "deep dive on CRM" (one-shot) must propose nothing here.
_DEEP_WORDS_RE = re.compile(
    r"\b(?:deep\s+(?:report|dive|research)|full\s+(?:picture|report|breakdown)"
    r"|research\s+report)\b", re.I)
# "weekly" alone is usually a chart TIMEFRAME on this product ("deep dive on
# SPY's weekly chart") — bare `weekly` only counts when it is not naming a
# chart object, and Sunday phrasings ("on Sundays", "sunday deep dive") count
# too (2026-08-28 review: both directions confirmed against real phrasings).
_WEEKLY_CADENCE_RE = re.compile(
    r"\b(?:every|each)\s+(?:sunday|week(?:end)?)\b"
    r"|\bon\s+sundays?\b"
    r"|\bsundays?\b(?=\s+(?:deep|full|research))"
    r"|\bonce\s+a\s+week\b"
    r"|\bweekly\b(?!\s+(?:charts?|candles?|bars?|timeframes?|closes?|opens?"
    r"|highs?|lows?|levels?|ma\b|moving))", re.I)


def _deep_weekly_proposal(query: str, syms: list[str]) -> dict | None:
    q = query or ""
    if not (_DEEP_WORDS_RE.search(q) and _WEEKLY_CADENCE_RE.search(q)):
        return None
    return {"kind": "deep_briefing", "query": q[:500],
            "sym": (syms[0] if syms else None), "cadence": "weekly_deep"}


def _ask_proposal(query: str, syms: list[str]) -> dict | None:
    """One proposal per ask. An explicit alert verb ("alert me when…") is the
    stronger intent signal — it wins over briefing phrasing (2026-08-28: the
    briefing-first order let adjectival 'brief' eat alert asks). A weekly DEEP
    ask outranks a plain briefing (it names the heavier product)."""
    return (_alert_proposal(query, syms)
            or _deep_weekly_proposal(query, syms)
            or _briefing_proposal(query, syms))


def _alert_num(m, q: str) -> float | None:
    price = float(m.group(1))
    if not (0 < price < 1_000_000):
        return None
    if _ALERT_NOT_A_PRICE_TAIL.match(q[m.end():m.end() + 16]):
        return None
    return price


def _alert_proposal(query: str, syms: list[str]) -> dict | None:
    """{kind, sym, direction, price} when the ask reads as a price-alert
    request for a named ticker, else None. Explicit direction words are taken
    literally (the first cut quote-flipped 'breaks back above 175' into a
    below-alert); ambiguous verbs ("hits 90") pick the direction from the live
    quote — and propose NOTHING when no quote is available, because a guessed
    direction can create an alert that fires the moment it's confirmed."""
    q = query or ""
    if not syms or not _ALERT_ASK_RE.search(q):
        return None
    price = None
    m = _ALERT_BELOW_RE.search(q)
    if m is not None:
        price = _alert_num(m, q)
    if price is not None:
        direction = "below"
    else:
        m = _ALERT_ABOVE_EXPLICIT_RE.search(q)
        price = _alert_num(m, q) if m is not None else None
        if price is not None:
            direction = "above"
        else:
            m = _ALERT_AMBIG_RE.search(q)
            price = _alert_num(m, q) if m is not None else None
            if price is None:
                return None
            try:
                last = float((_quote_provider(syms[0]) or {}).get("last") or 0)
            except Exception:
                last = 0.0
            if last <= 0:
                return None   # can't orient an ambiguous verb — never guess
            direction = "above" if price >= last else "below"
    return {"kind": "price_alert", "sym": syms[0], "direction": direction, "price": price}


_DEGRADED_NOTE = (
    "\n\nWEB SEARCH IS TEMPORARILY UNAVAILABLE. Answer ONLY from the UCT DESK "
    "CONTEXT above plus general market knowledge. Open with one brief phrase "
    "noting live web sources are temporarily down (e.g. 'Working from desk "
    "data only right now —'). Never fabricate a current headline, price move "
    "you weren't given, or anything that would require today's web."
)


def _desk_only_answer(query: str, system: str, meta: dict, history: list) -> dict | None:
    """Perplexity is down and no stale answer exists → synthesize from the
    already-assembled desk grounding via the shared Anthropic client, flagged
    `degraded` so the widget can label it. Returns None when there is no desk
    context to stand on (a web-only question deserves an honest error) or the
    synthesis fails. Blocking — stream callers run it in an executor."""
    ctx = (meta or {}).get("ctx_block") or ""
    if not ctx.strip():
        return None
    try:
        from api.services.engine import _get_anthropic_client
        client = _get_anthropic_client()
        if client is None:
            return None
        model = os.environ.get("AI_SEARCH_DEGRADED_MODEL", "claude-sonnet-5").strip()
        msgs: list[dict] = []
        for h in (history or []):
            q, a = (h.get("q") or "").strip(), (h.get("a") or "").strip()
            if q and a:
                msgs.append({"role": "user", "content": q})
                msgs.append({"role": "assistant", "content": a})
        msgs.append({"role": "user", "content": query})
        resp = client.with_options(timeout=25).messages.create(
            model=model, max_tokens=600, system=system + _DEGRADED_NOTE, messages=msgs)
        text = "".join(
            b.text for b in (resp.content or []) if getattr(b, "type", "") == "text"
        ).strip()
        if not text:
            return None
        return {"answer": text, "citations": [], "related_questions": [],
                "model": model, "mode": "degraded", "degraded": True, "cached": False}
    except Exception:
        return None


class AiSearchIn(BaseModel):
    query: str
    # The widget sends no mode, so this default flows through _auto_mode, which
    # routes by phrasing: most asks -> sonar-pro ("fast"), deep-analysis phrasing
    # -> sonar-reasoning-pro. A client may pin "fast"/"reasoning" to force a tier;
    # any other value (this "auto" default included) flows through _auto_mode.
    mode: str = "auto"
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
        return fast_lane_answer(body.query, system, salt, mode=m, history=history)

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
        # Provider down + nothing stale to serve → desk-data-only synthesis so a
        # paid ask gets a grounded answer instead of an error box.
        degraded = _desk_only_answer(body.query, system, meta, history)
        if degraded is not None:
            try:
                _reserve(user_id, 1)   # a real (Anthropic) spend — bill one unit
            except HTTPException:
                pass                   # was within cap at request start; serve anyway
            result = degraded
            effective_mode = "degraded"
            fallback_used = True
    elif effective_units != units:
        _refund(user_id, units - effective_units)   # keep only the fast unit
    # Stable id so a later save/share/pin can join back to this de-identified row.
    answer_id = ai_search_log_new_id()
    result["answer_id"] = answer_id
    # Member-visible transparency: which desk feeds grounded this answer, and
    # where the daily budget stands after this ask.
    result["grounding"] = {"sources": meta.get("grounding_sources") or [],
                           "intents": meta.get("grounding_intents") or []}
    result["quota"] = _quota_snapshot(user_id)
    proposal = _ask_proposal(body.query, meta.get("query_tickers") or [])
    if proposal:
        result["proposal"] = proposal
    # Best-effort capture (sync def runs in the anyio threadpool — a direct call is fine).
    _log_answer(body=body, user_id=user_id, answer_id=answer_id, endpoint="single",
                mode=effective_mode, result=result, meta=meta, history=history,
                fallback_used=fallback_used)
    return result


async def _agent_gen(body, user_id, system, salt, meta, history, proposal, answer_id):
    """SSE generator for the agent lane: meta → activity* → final. The blocking
    tool loop runs in an executor; `emit` callbacks bridge onto the loop via a
    queue so the member watches the agent work. On failure the ask falls back
    to the fast web path (in an executor), then desk-only, then honest error —
    the same ladder every other failure walks.

    Billing invariant (2026-08-28 review): `outstanding` tracks exactly what
    this member currently owes; every final/error yield sets `settled`; the
    finally refunds any outstanding units on an unsettled exit (client
    disconnect mid-run — the sibling gen() refunds the same disconnect), and
    signals the worker thread to stop so a dead client stops burning the
    agent dollar cap."""
    grounding = {"sources": (meta.get("grounding_sources") or []) + ["agent"],
                 "intents": list(meta.get("grounding_intents") or [])}
    yield f"data: {json.dumps({'type': 'meta', 'mode': 'agent', 'answer_id': answer_id, 'grounding': grounding})}\n\n"
    units = _billing_units("agent")
    outstanding = units          # what the member owes right now
    settled = False              # a final/error reached the wire
    _loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()
    cancel_event = threading.Event()
    getter = None

    def _emit(text: str) -> None:
        try:
            _loop.call_soon_threadsafe(q.put_nowait, text)
        except Exception:
            pass

    from api.services import ai_search_agent
    fut = _loop.run_in_executor(
        None, lambda: ai_search_agent.run_agent(
            body.query, system, history, None, emit=_emit, cancel=cancel_event))
    captured = {"result": None, "mode": "agent", "fallback_used": False}
    try:
        while True:
            getter = asyncio.ensure_future(q.get())
            done, _pending = await asyncio.wait(
                {getter, fut}, return_when=asyncio.FIRST_COMPLETED)
            if getter in done:
                yield f"data: {json.dumps({'type': 'activity', 'text': getter.result()})}\n\n"
                continue
            getter.cancel()
            break
        try:
            res = fut.result() or {}
        except Exception:
            # a bug in the worker must degrade like any agent failure, never
            # kill the stream with no event (the finally would refund, but the
            # member would just see a dead spinner)
            res = {"answer": "", "error": "agent crashed"}
        # drain any activity that raced the finish
        while not q.empty():
            try:
                yield f"data: {json.dumps({'type': 'activity', 'text': q.get_nowait()})}\n\n"
            except Exception:
                break
        if res.get("answer"):
            grounding["intents"] = res.get("tools_used") or []
            result = {"answer": res["answer"], "citations": res.get("citations") or [],
                      "related_questions": [], "model": ai_search_agent._model(),
                      "mode": "agent", "cached": False}
            captured["result"] = dict(result)
            final = {"type": "final", "answer_id": answer_id, "grounding": grounding,
                     "quota": _quota_snapshot(user_id), **result}
            if proposal:
                final["proposal"] = proposal
            settled = True
            yield f"data: {json.dumps(final)}\n\n"
            return
        # Agent came up empty → refund the agent units and walk the ladder.
        _refund(user_id, units)
        outstanding = 0
        fb = await _loop.run_in_executor(
            None,
            # FULL salt — history digest included.
            lambda: fast_lane_answer(body.query, system, salt, history=history))
        if fb.get("answer"):
            if not fb.get("cached"):
                try:
                    _reserve(user_id, 1)
                    outstanding = 1
                except HTTPException:
                    pass   # cap raced shut between refund and rebill — still serve
            captured["result"] = dict(fb)
            captured["mode"] = "fast"
            captured["fallback_used"] = True
            final = {"type": "final", "answer_id": answer_id, "grounding": grounding,
                     "quota": _quota_snapshot(user_id), **fb}
            if proposal:
                final["proposal"] = proposal
            settled = True
            yield f"data: {json.dumps(final)}\n\n"
            return
        dg = await _loop.run_in_executor(
            None, lambda: _desk_only_answer(body.query, system, meta, history))
        if dg is not None:
            try:
                _reserve(user_id, 1)
                outstanding = 1
            except HTTPException:
                pass
            captured["result"] = dict(dg)
            captured["mode"] = "degraded"
            captured["fallback_used"] = True
            final = {"type": "final", "answer_id": answer_id, "grounding": grounding,
                     "quota": _quota_snapshot(user_id), **dg}
            settled = True
            yield f"data: {json.dumps(final)}\n\n"
            return
        captured["result"] = {"answer": "", "error": res.get("error") or "agent error"}
        _refund(user_id, outstanding)   # error final — nothing billed
        outstanding = 0
        settled = True
        yield f"data: {json.dumps({'type': 'error', 'error': 'agent error'})}\n\n"
    finally:
        cancel_event.set()   # a dead client must not keep the worker spending
        if getter is not None and not getter.done():
            getter.cancel()
        if not settled and outstanding:
            _refund(user_id, outstanding)   # never bill for an undelivered answer
        if captured["result"] is None:   # cancelled mid-run (client disconnect)
            captured["result"] = {"answer": "", "error": "incomplete"}
        try:
            _loop.run_in_executor(
                None,
                lambda: _log_answer(
                    body=body, user_id=user_id, answer_id=answer_id, endpoint="stream",
                    mode=captured["mode"], result=captured["result"], meta=meta,
                    history=history, fallback_used=captured["fallback_used"]))
        except Exception:
            pass


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
    # ── Agent lane: the one-brain tool loop. Pinned by the UI pill, OR
    # auto-routed for a request for the desk's CALL when
    # AI_SEARCH_AGENT_AUTOROUTE is armed (default off — see _wants_agent).
    # Falls back to auto routing when the lane is over its dollar cap or the
    # synthesis client is down — the ask always answers.
    agent_mode = False
    if _agent_pinned(body.mode) or _wants_agent(body.query, body.mode):
        try:
            from api.services import ai_search_agent
            agent_mode = ai_search_agent.available()
        except Exception:
            agent_mode = False
    mode = "agent" if agent_mode else _auto_mode(body.query, body.mode)
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
    # Proposal parse can hit the live quote (ambiguous verbs) — a blocking
    # Massive read that must never ride the shared event loop inside gen().
    proposal = await loop.run_in_executor(
        None, lambda: _ask_proposal(body.query, meta.get("query_tickers") or []))
    answer_id = ai_search_log_new_id()

    if mode == "agent":
        return StreamingResponse(
            _agent_gen(body, user_id, system, salt, meta, history, proposal, answer_id),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def gen():
        settled = False
        got_answer = False
        # captured_final holds the ONE answer we log — updated at BOTH the normal
        # 'final' event AND the inline reasoning→fast fallback, so the log records
        # the answer the member actually saw (never the failed empty reasoning try).
        captured = {"result": None, "mode": mode, "fallback_used": False}
        # Tell the client the tier + the stable answer_id up front (the id lets a
        # later save/share/pin join back to this de-identified row), plus which
        # desk feeds grounded the answer (the widget's "grounded on" chips).
        grounding = {"sources": meta.get("grounding_sources") or [],
                     "intents": meta.get("grounding_intents") or []}
        yield f"data: {json.dumps({'type': 'meta', 'mode': mode, 'answer_id': answer_id, 'grounding': grounding})}\n\n"
        try:
            async for ev in perplexity_search.stream_search(
                body.query, max_tokens=_ANSWER_MAX_TOKENS, system=system, mode=mode, domain_pack="finance",
                recency=_auto_recency(body.query), related=True, cache_salt=salt, history=history,
                cost_surface="ai_search",
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
                    # Recovery ladder for a stream that died before ANY token
                    # reached the member (a partial answer already on screen falls
                    # through to the error event → widget's single-shot fallback,
                    # which walks the same ladder server-side):
                    #   1. blocking web_search on sonar-pro — carries the bounded
                    #      transient retry AND the stale-shadow serve
                    #   2. desk-data-only Anthropic synthesis
                    #   3. honest error
                    # BOTH run in an executor: web_search can sleep+retry (~37s
                    # worst case) and the synthesis is a blocking Anthropic call —
                    # the shared loop is the 524-outage surface.
                    # NB: gen()'s finally block rebinds `loop`, making it local to
                    # gen — fetch the running loop under a distinct name.
                    if not got_answer:
                        _fb_loop = asyncio.get_running_loop()
                        fb = await _fb_loop.run_in_executor(
                            None,
                            lambda: fast_lane_answer(body.query, system, salt,
                                                     history=history))
                        if fb.get("answer"):
                            if not fb.get("cached"):
                                _reserve(user_id, 1)
                            captured["result"] = dict(fb)
                            captured["mode"] = "fast"
                            captured["fallback_used"] = True
                            settled_fb = {'type': 'final', 'answer_id': answer_id,
                                          'grounding': grounding,
                                          'quota': _quota_snapshot(user_id), **fb}
                            if proposal:
                                settled_fb['proposal'] = proposal
                            yield f"data: {json.dumps(settled_fb)}\n\n"
                            continue
                        dg = await _fb_loop.run_in_executor(
                            None, lambda: _desk_only_answer(body.query, system, meta, history))
                        if dg is not None:
                            try:
                                _reserve(user_id, 1)
                            except HTTPException:
                                pass
                            captured["result"] = dict(dg)
                            captured["mode"] = "degraded"
                            captured["fallback_used"] = True
                            dg_final = {'type': 'final', 'answer_id': answer_id,
                                        'grounding': grounding,
                                        'quota': _quota_snapshot(user_id), **dg}
                            if proposal:
                                dg_final['proposal'] = proposal
                            yield f"data: {json.dumps(dg_final)}\n\n"
                            continue
                    captured["result"] = {"answer": "", "error": ev.get("error") or "stream error"}
                if t == "final":
                    ev = {**ev, "answer_id": answer_id, "grounding": grounding,
                          "quota": _quota_snapshot(user_id)}
                    if proposal:
                        ev["proposal"] = proposal
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
    # Ledger reads OUTSIDE the hot-path lock — four SQLite SUMs against /data
    # must never block member reserves behind an admin page load.
    spend = _spend_block()
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
            "note": ("billed units re-seed from the durable ledger after a redeploy; "
                     "request/cache-hit stats are in-memory since last deploy"),
            # Dollar telemetry off the shared ledger (Perplexity had NONE until
            # 2026-08-28 — every completion now records under pplx:* surfaces).
            "spend_today_usd": spend,
        }


def _spend_block() -> dict:
    try:
        from api.services import narrative_cost_guard as guard
        return {
            "perplexity_ai_search": round(guard.spend_today_usd("pplx:ai_search"), 4),
            "perplexity_deep": round(guard.spend_today_usd("pplx:ai_search_deep"), 4),
            "perplexity_other": round(guard.spend_today_usd("pplx:perplexity"), 4),
            "deep_research_anthropic": round(guard.spend_today_usd("ai_search_deep"), 4),
        }
    except Exception:
        return {}


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


# ── Per-member recollection (2026-08-28): server-side threads + saved answers.
# Backed by ai_search_member — a member-keyed CONSENTED store, deliberately
# separate from the de-identified capture log (see that module's docstring).
# Every read/write is scoped to the session's own user id; there is no admin
# surface over this data.

class AiThreadIn(BaseModel):
    thread_id: str
    surface: str | None = None
    turns: list  # [{q, a, citations?, answer_id?, personal?}]


class AiSavedIn(BaseModel):
    answer_id: str
    q: str | None = None
    answer: str
    citations: list | None = None
    personal: bool = False


def _member_uid(user) -> str | None:
    u = user or {}
    uid = u.get("user_id") or u.get("id")
    return str(uid) if uid is not None else None


@router.get("/threads")
def ai_search_threads(limit: int = 30, user: dict = Depends(require_paid)):
    from api.services import ai_search_member
    return {"threads": ai_search_member.list_threads(_member_uid(user), limit=limit)}


@router.get("/threads/{thread_id}")
def ai_search_thread_detail(thread_id: str, user: dict = Depends(require_paid)):
    from api.services import ai_search_member
    out = ai_search_member.get_thread(_member_uid(user), thread_id)
    if out is None:
        raise HTTPException(status_code=404, detail="thread not found")
    return out


@router.post("/threads")
def ai_search_thread_save(body: AiThreadIn, user: dict = Depends(require_paid)):
    from api.services import ai_search_member
    out = ai_search_member.save_thread(
        _member_uid(user), body.thread_id, body.turns, surface=body.surface or "")
    if not out.get("ok"):
        raise HTTPException(status_code=422, detail="nothing to save")
    return out


@router.delete("/threads/{thread_id}")
def ai_search_thread_delete(thread_id: str, user: dict = Depends(require_paid)):
    from api.services import ai_search_member
    return {"ok": ai_search_member.delete_thread(_member_uid(user), thread_id)}


@router.get("/saved")
def ai_search_saved_list(limit: int = 100, user: dict = Depends(require_paid)):
    from api.services import ai_search_member
    return {"saved": ai_search_member.list_saved(_member_uid(user), limit=limit)}


@router.post("/saved")
def ai_search_saved_put(body: AiSavedIn, user: dict = Depends(require_paid)):
    from api.services import ai_search_member
    ok = ai_search_member.save_answer(_member_uid(user), body.model_dump())
    if not ok:
        raise HTTPException(status_code=422, detail="nothing to save")
    return {"ok": True}


@router.delete("/saved/{answer_id}")
def ai_search_saved_delete(answer_id: str, user: dict = Depends(require_paid)):
    from api.services import ai_search_member
    return {"ok": ai_search_member.delete_saved(_member_uid(user), answer_id)}


# ── Deep Research (2026-08-28): async multi-step reports. Submission bills 5
# quota units (a report is ~5 asks of spend, refunded by the service on error);
# per-user/day + global-dollar caps live in ai_search_deep.

class AiDeepIn(BaseModel):
    query: str


@router.post("/deep")
def ai_search_deep_submit(body: AiDeepIn, user: dict = Depends(require_paid)):
    from api.services import ai_search_deep
    uid = _member_uid(user)
    if not (body.query or "").strip():
        raise HTTPException(status_code=422, detail="Empty question.")
    _reserve(user.get("id"), ai_search_deep._QUOTA_UNITS)
    out = ai_search_deep.submit(uid, body.query)
    if not out.get("ok"):
        _refund(user.get("id"), ai_search_deep._QUOTA_UNITS)
        raise HTTPException(status_code=429, detail=out.get("reason") or "unavailable")
    _record_request("deep", stream=False)
    return {**out, "quota": _quota_snapshot(user.get("id"))}


@router.get("/deep")
def ai_search_deep_list(limit: int = 20, user: dict = Depends(require_paid)):
    from api.services import ai_search_deep
    return {"jobs": ai_search_deep.list_jobs(_member_uid(user), limit=limit)}


@router.get("/deep/{job_id}")
def ai_search_deep_detail(job_id: str, user: dict = Depends(require_paid)):
    from api.services import ai_search_deep
    out = ai_search_deep.get_job(_member_uid(user), job_id)
    if out is None:
        raise HTTPException(status_code=404, detail="report not found")
    return out


@router.delete("/deep/{job_id}")
def ai_search_deep_delete(job_id: str, user: dict = Depends(require_paid)):
    from api.services import ai_search_deep
    return {"ok": ai_search_deep.delete_job(_member_uid(user), job_id)}


# ── Scheduled briefings (2026-08-28): standing questions delivered premarket /
# post-close through the existing multi-channel alert door.

class AiBriefingIn(BaseModel):
    query: str
    sym: str | None = None
    cadence: str = "premarket"   # premarket | postmarket | weekly_deep


@router.get("/briefings")
def ai_search_briefings_list(user: dict = Depends(require_paid)):
    from api.services import ai_search_briefings
    return {"briefings": ai_search_briefings.list_briefings(_member_uid(user))}


@router.post("/briefings")
def ai_search_briefings_create(body: AiBriefingIn, user: dict = Depends(require_paid)):
    from api.services import ai_search_briefings
    out = ai_search_briefings.create(_member_uid(user), body.query, body.sym, body.cadence)
    if not out.get("ok"):
        raise HTTPException(status_code=422, detail=out.get("reason") or "could not create")
    return out


@router.post("/briefings/{briefing_id}/toggle")
def ai_search_briefings_toggle(briefing_id: str, enabled: bool = True,
                               user: dict = Depends(get_current_user_with_plan)):
    # Deliberately NOT require_paid: a lapsed member must still be able to
    # pause their own standing briefings (the runner skips unpaid rows, but
    # the member controlling their own rows is the honest door).
    from api.services import ai_search_briefings
    return ai_search_briefings.set_enabled(_member_uid(user), briefing_id, enabled)


@router.delete("/briefings/{briefing_id}")
def ai_search_briefings_delete(briefing_id: str,
                               user: dict = Depends(get_current_user_with_plan)):
    # Same rationale as toggle — deleting your own rows never needs a plan.
    from api.services import ai_search_briefings
    return {"ok": ai_search_briefings.delete(_member_uid(user), briefing_id)}


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
