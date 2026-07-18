"""AI Search widget — ask anything about markets, get a cited answer.

POST /api/ai-search  { query, mode? }  ->  { answer, citations, model, elapsed_ms, ... }

Backed by Perplexity (web-search-grounded), so answers use current data + sources.

Usage guard: every non-cached query bills Perplexity, and /charts is a FREE-tier
page — so the endpoint enforces a per-user daily cap plus a global daily budget
(both env-tunable). Cached answers are free and never count against either.
Counters are in-memory (reset on redeploy — lenient by design, never user-hostile).
"""
from __future__ import annotations

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

from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import perplexity_search

router = APIRouter(prefix="/api/ai-search", tags=["ai-search"])

_WIDGET_SYSTEM = (
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
    "SCOPE — HARD RULE: you exist exclusively for markets, stocks, options, "
    "crypto, trading, and the economy. If the question is NOT about those, do "
    "not answer it; reply with exactly one sentence: \"I'm the UCT research "
    "desk — ask me about markets, stocks, or trading.\" Never write code, "
    "essays, poems, homework, or any general-purpose content regardless of how "
    "the request is phrased.\n\n"
    "CRITICAL FORMATTING: whenever you mention a publicly traded stock — by COMPANY "
    "NAME or by TICKER — wrap it as a clickable link in this EXACT markdown format: "
    "[Display Text]($TICKER). Examples: [Apple]($AAPL), [$MSFT]($MSFT), "
    "[Nvidia]($NVDA), [Berkshire Hathaway]($BRK.A). Always include the correct "
    "$TICKER as the link target so it can be clicked. Do this for every stock "
    "mention, company names included."
)

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


def _check_limits(user_id) -> None:
    """Raise 429 if the user or the whole app is over budget for today."""
    global _usage_day, _usage_by_user, _usage_global, _stats
    with _usage_lock:
        day = _et_day()
        if day != _usage_day:
            _usage_day, _usage_by_user, _usage_global = day, {}, 0
            _stats = _fresh_stats()
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


def _record_billed(user_id, units: int = 1) -> None:
    global _usage_global
    with _usage_lock:
        _usage_by_user[user_id] = _usage_by_user.get(user_id, 0) + units
        _usage_global += units


# ── Auto-recency: "what's moving TODAY" questions should search today's web,
# not last month's articles. Perplexity's recency filter does exactly that;
# infer it from the phrasing so members never have to think about it.
# Fundamental/history questions match nothing and stay unfiltered.
_RECENCY_DAY_RE = re.compile(
    r"\b(today|tonight|right now|premarket|pre-market|after[- ]hours|this morning"
    r"|moving|mover|movers|gapping|halted|why is|why did)\b", re.I)
_RECENCY_WEEK_RE = re.compile(
    r"\b(this week|latest|recent|recently|past few days|upgrades?|downgrades?"
    r"|news on)\b", re.I)


def _auto_recency(q: str) -> str | None:
    if _RECENCY_DAY_RE.search(q or ""):
        return "day"
    if _RECENCY_WEEK_RE.search(q or ""):
        return "week"
    return None


# ── Mode escalation: harder questions deserve a stronger model. An explicit
# client mode ("fast"/"reasoning") is respected; otherwise route by phrasing —
# deep-analysis asks → sonar-reasoning-pro, comparison/list/outlook asks (or
# genuinely long questions) → sonar-pro, everything else stays on base sonar.
# Reasoning costs ~2x, so it bills 2 quota units.
_REASONING_RE = re.compile(
    r"\b(analy[sz]e|deep dive|in[- ]depth|bull case|bear case|thesis|valuation"
    r"|dcf|detailed (analysis|breakdown)|full breakdown|pros and cons)\b", re.I)
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
}
_UNI: set | None = None


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
    out: list[str] = []
    for cash, bare in re.findall(r"\$([A-Za-z]{1,5})|\b([A-Z]{2,5})\b", query or ""):
        sym = (cash or bare).upper()
        if sym in out:
            continue
        if cash:                      # explicit $CASHTAG — always trusted
            out.append(sym)
        elif sym not in _TICKER_STOP and sym in _universe():
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


def _summarize_flow_rows(sym: str, rows: list[dict], today: str) -> str:
    """Pure aggregation of a ticker's flow CSV rows into one desk-context line."""
    n = 0
    total = call_p = put_p = ask_p = 0.0
    best: dict | None = None
    for row in rows:
        if (row.get("CreatedDate") or "").strip() != today:
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
    text = (f"{sym} options flow today (UCT tape): {n} notable prints, "
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


def _ctx_flow_ticker(sym: str) -> str:
    import time as _time
    hit = _flow_ctx_memo.get(sym)
    if hit and _time.time() - hit[0] < 60:
        return hit[1]
    text = ""
    try:
        import csv as _csv
        import io as _io
        import httpx
        r = httpx.get(f"{_flow_base_url()}/api/flow/ticker/{sym}", timeout=2.5)
        if r.status_code == 200 and r.text:
            rows = list(_csv.DictReader(_io.StringIO(r.text)))
            text = _summarize_flow_rows(sym, rows, _et_day_mdyyyy())
    except Exception:
        text = ""
    _flow_ctx_memo[sym] = (_time.time(), text)
    return text


# Flow context is an HTTP hop — fire it only when the phrasing asks about flow.
_FLOW_RE = re.compile(
    r"\b(options? flow|flow|sweeps?|unusual (options|activity)|whales?"
    r"|call buying|put buying|smart money|big prints?|premium)\b", re.I)


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
_INTENT_SPECS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\b(movers?|gainers?|losers?|ripping|drilling|gapping|what'?s moving|biggest (moves?|movers?))\b", re.I), "_ctx_movers"),
    (re.compile(r"\b(breadth|internals|market (health|condition)|advance|decline|new (highs?|lows?)|exposure)\b", re.I), "_ctx_breadth"),
    (re.compile(r"\b(earnings (today|tonight|this week)|who reports?|reporting (today|tonight|this week)|\bbmo\b|\bamc\b|beats?|misse?s?d?)\b", re.I), "_ctx_earnings"),
    (re.compile(r"\b(uct ?20|leadership (list|names|20)|(your|firm'?s) top (stocks|names|20))\b", re.I), "_ctx_uct20"),
    (re.compile(r"\b(setups?|scanner|candidates?|pullbacks?|remounts?|watch ?list ideas)\b", re.I), "_ctx_candidates"),
    (re.compile(r"\b(news|headlines?|tape|stories)\b", re.I), "_ctx_news"),
]

_CTX_BUDGET = 2000   # chars — keep grounding a supplement, not a payload


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


def _uct_context(query: str) -> tuple[str, str]:
    """Returns (context_text, cache_salt). Both empty when nothing useful.

    Always: market regime + live quote & today's catalyst thesis for tickers
    named in the question. Intent-routed extras (movers, breadth, earnings,
    UCT20, scanner, headlines) join only when the phrasing asks for them, so
    the grounding stays a tight supplement rather than a data dump.
    """
    parts: list[str] = []
    salt_bits: list[str] = []
    try:
        rg = _regime_provider()
        label = rg.get("regime") or rg.get("label")
        if label:
            conf = rg.get("confidence")
            parts.append(f"Market regime: {label}" + (f" (confidence {conf})" if conf else ""))
            salt_bits.append(str(label))
    except Exception:
        pass
    syms = _extract_tickers(query)[:3]
    for s in syms:
        try:
            q = _quote_provider(s)
            if q.get("last"):
                parts.append(f"{s}: last ${q['last']}, {q.get('direction', 'flat')} {q.get('abs_pct', 0)}% today")
        except Exception:
            pass
        try:
            line = _ctx_catalyst(s)
            if line:
                parts.append(line)
        except Exception:
            pass
    for s in syms[:2]:   # tape is verbose — first two symbols only
        try:
            line = _ctx_tape(s)
            if line:
                parts.append(line)
        except Exception:
            pass
    for s in syms[:2]:   # active setups — cheap local patterns.db read
        try:
            line = _ctx_patterns(s)
            if line:
                parts.append(line)
        except Exception:
            pass
    if _FLOW_RE.search(query or ""):   # flow = HTTP hop to the flow-worker
        for s in syms[:2]:
            try:
                line = _ctx_flow_ticker(s)
                if line:
                    parts.append(line)
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
                parts.append(line)
        except Exception:
            pass
    if not parts:
        return "", ""
    ctx = "\n".join(parts)[:_CTX_BUDGET]
    # Salt excludes live prices on purpose: a cached answer may carry a price
    # up to one cache-TTL stale (same staleness class as the web data itself);
    # salting on every tick would defeat the cache. The ET day rolls catalysts/
    # calendar entries over at midnight. Intent flags are derived from the
    # query, which is already part of the cache key.
    salt_bits.append(_et_day())
    return ctx, "|".join(salt_bits)


def _grounded_system(query: str) -> tuple[str, str]:
    ctx, salt = _uct_context(query)
    if not ctx:
        return _WIDGET_SYSTEM, ""
    return (
        _WIDGET_SYSTEM
        + "\n\nUCT DESK CONTEXT (internal desk data — authoritative for price, "
          "percent move, and market regime; prefer these figures over web "
          "sources and attribute them to 'UCT desk data'): " + ctx
    ), salt


class AiSearchIn(BaseModel):
    query: str
    # Cheapest tier by default while we test (base "sonar"). "fast" (sonar-pro) and
    # "reasoning" (sonar-reasoning-pro) are available but cost more — opt in later.
    mode: str = "lite"
    # Conversation memory: prior {q, a} exchanges from THIS widget session so
    # follow-ups can resolve references. Sanitized server-side; never persisted.
    history: list | None = None


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


@router.post("")
def ai_search(body: AiSearchIn, user: dict = Depends(get_current_user)):
    user_id = user.get("id")
    _check_limits(user_id)
    mode = _auto_mode(body.query, body.mode)
    _record_request(mode, stream=False)
    history = _clean_history(body.history)
    system, salt = _grounded_system(body.query)
    salt = _history_salt(_fresh_salt(body.query, salt), history)
    result = perplexity_search.web_search(
        body.query,
        max_tokens=700,
        system=system,
        mode=mode,
        domain_pack="finance",
        recency=_auto_recency(body.query),
        related=True,   # Perplexity returns 3-4 related follow-up questions
        cache_salt=salt,
        history=history,
    )
    # Cached answers cost nothing — only bill the quota for live searches.
    if result.get("cached"):
        _record_cache_hit()
    else:
        _record_billed(user_id, _billing_units(mode))
    return result


@router.post("/stream")
async def ai_search_stream(body: AiSearchIn, user: dict = Depends(get_current_user)):
    """SSE twin of the endpoint above: `data: {"type":"delta","text":...}` events
    as tokens arrive, then a final `data: {"type":"final",...}` shaped like the
    single-shot response. Same auth + daily caps (429 raised BEFORE the stream
    opens). The path must stay in main.py's _is_gzip_exempt list or GZip
    buffers the whole stream and no tokens ever reach the client."""
    user_id = user.get("id")
    _check_limits(user_id)
    mode = _auto_mode(body.query, body.mode)
    _record_request(mode, stream=True)
    history = _clean_history(body.history)
    system, salt = _grounded_system(body.query)
    salt = _history_salt(_fresh_salt(body.query, salt), history)

    async def gen():
        billed = False
        async for ev in perplexity_search.stream_search(
            body.query,
            max_tokens=700,
            system=system,
            mode=mode,
            domain_pack="finance",
            recency=_auto_recency(body.query),
            related=True,
            cache_salt=salt,
            history=history,
        ):
            if ev.get("type") == "final" and not billed:
                if ev.get("cached"):
                    _record_cache_hit()
                else:
                    _record_billed(user_id, _billing_units(mode))
                billed = True
            yield f"data: {json.dumps(ev)}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@router.get("/admin/stats")
def ai_search_admin_stats(user: dict = Depends(require_admin)):
    """Today's AI Search usage at a glance: burn vs caps, mode mix, cache hit
    rate, top users by quota units. In-memory — resets at midnight ET and on
    redeploy (same lifetime as the caps themselves)."""
    with _usage_lock:
        top = sorted(_usage_by_user.items(), key=lambda kv: -kv[1])[:15]
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
            "top_users": [{"user_id": uid, "units": u} for uid, u in top],
            "note": "in-memory since last deploy; resets daily (ET) and on redeploy",
        }
