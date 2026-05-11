"""
Voice tool implementations — Slice 2 read-only tools.

These wrap existing services. The wrappers normalize results into flat
dicts whose keys can be used as {placeholder} markers in the classifier's
narration_template.
"""

import logging

import api.services.voice_tools as _vt

_log = logging.getLogger(__name__)


# ── Indirections (set 1) — exposed for monkeypatching in tests ─────────────

def _snapshot(sym: str) -> dict:
    """Single-ticker snapshot. Wraps massive.get_ticker_snapshot."""
    from api.services.massive import get_ticker_snapshot
    return get_ticker_snapshot(sym) or {}


def _movers() -> dict:
    from api.services.massive import get_movers
    return get_movers() or {}


def _breadth() -> dict:
    from api.services.engine import get_breadth
    return get_breadth() or {}


def _sector_flow() -> list[dict]:
    """Return list of {sector, change_pct} sorted by strength.
    Falls back to themes leaders if no dedicated endpoint."""
    try:
        from api.services.rs_ranking import get_sector_strength as _sec
        return _sec() or []
    except (ImportError, AttributeError):
        from api.services.engine import get_themes
        themes = get_themes() or {}
        leaders = (themes.get("leaders") or [])[:5]
        return [{"sector": t.get("name"), "change_pct": t.get("pct", 0)} for t in leaders]


# ── Indirections (set 2) ────────────────────────────────────────────────────

def _news(symbol: str | None = None) -> list[dict]:
    from api.services.engine import get_news
    items = get_news() or []
    if symbol:
        sym = symbol.upper()
        items = [i for i in items if sym in (i.get("headline") or "").upper()]
    return items


def _earnings_today() -> list[dict]:
    from api.services.engine import get_earnings
    e = get_earnings() or {}
    return (e.get("bmo") or []) + (e.get("amc") or [])


def _themes() -> dict:
    """Return {leaders: [...], laggards: [...], period}. Each item has
    `name` (str), `pct` (str like '+2.50%'), `ticker` (str)."""
    from api.services.engine import get_themes
    return get_themes() or {}


def _parse_pct(value) -> float:
    """Parse a pct that may be a string like '+2.50%' or '-1.3%' or a number."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace("%", "").replace("+", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def _theme_performance() -> dict:
    from api.services.theme_performance import get_theme_performance
    return get_theme_performance() or {}


def _options_flow(sym: str | None = None) -> list[dict]:
    try:
        from api.flow_router import get_recent_flow
        return get_recent_flow(sym) or []
    except (ImportError, AttributeError):
        return []


def _dark_pool(sym: str | None = None) -> list[dict]:
    try:
        from api.top_flow_router import get_recent_dark_pool
        return get_recent_dark_pool(sym) or []
    except (ImportError, AttributeError):
        return []


def _economic_calendar() -> list[dict]:
    try:
        from api.services.engine import get_macro_events
        return get_macro_events() or []
    except (ImportError, AttributeError):
        return []


# ── Registration helper — called at import and after registry.clear() ───────

def _get_news(symbol: str = "", count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    items = _news(symbol or None)[:count]
    if not items:
        return {"headlines": "no recent news", "count": 0}
    return {
        "headlines": ". ".join(i.get("headline", "") for i in items)[:400],
        "count": len(items),
    }


def _get_earnings_today() -> dict:
    items = _earnings_today()
    if not items:
        return {"tickers": "no earnings today", "count": 0}
    syms = [str(i.get("sym", "")).upper() for i in items if i.get("sym")][:8]
    return {"tickers": ", ".join(syms), "count": len(syms)}


def _get_theme_status(count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    themes = _themes()
    leaders = (themes.get("leaders") or [])[:count]
    if not leaders:
        return {"top_themes": "no theme data available", "count": 0}
    parts = []
    for t in leaders:
        pct = _parse_pct(t.get("pct"))
        direction = "up" if pct >= 0 else "down"
        parts.append(f"{t.get('name')} {direction} {abs(round(pct, 1))} percent")
    return {"top_themes": ", ".join(parts), "count": len(parts)}


def _get_options_flow(symbol: str = "", count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    items = _options_flow(symbol or None)[:count]
    if not items:
        return {"flow": "no recent options flow available", "count": 0}
    parts = [f"{i.get('sym', '')} {i.get('option_type', '')} {i.get('strike', '')}".strip()
             for i in items]
    return {"flow": ", ".join(p for p in parts if p), "count": len(parts)}


def _get_dark_pool(symbol: str = "", count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    items = _dark_pool(symbol or None)[:count]
    if not items:
        return {"prints": "no recent dark pool prints available", "count": 0}
    parts = [f"{i.get('sym', '')} {i.get('size', '')} shares".strip() for i in items]
    return {"prints": ", ".join(p for p in parts if p), "count": len(parts)}


def _get_economic_calendar() -> dict:
    items = _economic_calendar()[:5]
    if not items:
        return {"events": "no upcoming events available", "count": 0}
    parts = [f"{i.get('title', '')} {i.get('date', '')}".strip() for i in items]
    return {"events": "; ".join(p for p in parts if p), "count": len(parts)}


# ── Memory tools (Slice 8) ──────────────────────────────────────────────────


def _remember(*, user, fact: str, category: str = "general") -> dict:
    from api.services.voice_memory_service import add_fact
    fact = (fact or "").strip()
    if not fact:
        return {"ok": False, "error": "fact text is required"}
    try:
        fid = add_fact(user["id"], text=fact, category=category or "general")
        return {"ok": True, "fact_id": fid, "text": fact}
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _forget(*, user, query: str) -> dict:
    from api.services.voice_memory_service import delete_facts_matching
    q = (query or "").strip()
    if not q:
        return {"ok": False, "removed": 0, "error": "query is required"}
    removed = delete_facts_matching(user["id"], q)
    return {"ok": True, "removed": removed}


def _list_my_facts(*, user) -> dict:
    from api.services.voice_memory_service import list_facts
    facts = list_facts(user["id"], limit=50)
    if not facts:
        return {"facts_text": "I don't have any saved facts about you yet.", "count": 0}
    lines = [f"[{f.get('category')}] {f.get('text')}" for f in facts]
    return {"facts_text": "; ".join(lines)[:1500], "count": len(facts)}


def _recall_session(*, user, query: str) -> dict:
    from api.services.voice_memory_service import search_summaries
    q = (query or "").strip()
    if not q:
        return {"recall_text": "I need a topic or keyword to search past conversations.", "count": 0}
    rows = search_summaries(user["id"], query=q, limit=5)
    if not rows:
        return {"recall_text": f"I don't have any past conversations matching '{q}'.", "count": 0}
    lines = [f"{r.get('summary_text')}" for r in rows]
    return {"recall_text": "; ".join(lines)[:1500], "count": len(rows)}


# ── Agentic flows (Slice 6) ────────────────────────────────────────────────


def _morning_briefing(*, user) -> dict:
    from api.services.voice_briefings import morning_briefing
    return morning_briefing(user_id=user["id"])


def _closing_briefing(*, user) -> dict:
    from api.services.voice_briefings import closing_briefing
    return closing_briefing(user_id=user["id"])


def _pre_trade_check(*, user, symbol: str) -> dict:
    from api.services.voice_briefings import pre_trade_check
    return pre_trade_check(symbol=symbol or "", user_id=user["id"])


def _post_trade_review(*, user, symbol: str) -> dict:
    from api.services.voice_briefings import post_trade_review
    return post_trade_review(symbol=symbol or "", user_id=user["id"])


def _plan_my_day(*, user) -> dict:
    from api.services.voice_briefings import plan_my_day
    return plan_my_day(user_id=user["id"])


def _register_all() -> None:
    """Register (or re-register) all Slice 2 tools into the registry."""

    _vt.voice_tool(
        name="get_quote",
        description="Get the current price, percent change, and volume for a stock symbol.",
        parameters={"symbol": {"type": "string", "description": "Ticker symbol, e.g. NVDA"}},
        contexts=["global"],
    )(_get_quote)

    _vt.voice_tool(
        name="get_movers",
        description="Get the top market movers — gainers or losers.",
        parameters={
            "direction": {"type": "string", "enum": ["gainers", "losers"],
                          "description": "Which direction. Defaults to gainers."},
            "count": {"type": "integer", "description": "How many to include (default 3, max 5)."},
        },
        contexts=["global"],
    )(_get_movers)

    _vt.voice_tool(
        name="get_breadth",
        description="Get current market breadth: advancing vs declining, new highs vs lows, breadth score.",
        parameters={},
        contexts=["global"],
    )(_get_breadth)

    _vt.voice_tool(
        name="get_sector_strength",
        description="Get the strongest sectors right now, ranked by recent relative strength.",
        parameters={"count": {"type": "integer", "description": "How many sectors to include (default 3)."}},
        contexts=["global"],
    )(_get_sector_strength)

    _vt.voice_tool(
        name="get_company_info",
        description="Get basic company info — sector, industry, and market cap in billions.",
        parameters={"symbol": {"type": "string"}},
        contexts=["global"],
    )(_get_company_info)

    _vt.voice_tool(
        name="compare_tickers",
        description="Compare current price + percent change across multiple tickers.",
        parameters={"symbols": {"type": "array", "items": {"type": "string"},
                                "description": "Two to four ticker symbols."}},
        contexts=["global"],
    )(_compare_tickers)

    _vt.voice_tool(
        name="get_news",
        description="Get the most recent news headlines, optionally filtered by ticker.",
        parameters={
            "symbol": {"type": "string", "description": "Optional ticker filter."},
            "count": {"type": "integer", "description": "How many headlines (default 3, max 5)."},
        },
        contexts=["global"],
    )(_get_news)

    _vt.voice_tool(
        name="get_earnings_today",
        description="List the tickers reporting earnings today.",
        parameters={},
        contexts=["global"],
    )(_get_earnings_today)

    _vt.voice_tool(
        name="get_theme_status",
        description="Get the strongest themes right now (e.g. Semis, AI, Crypto).",
        parameters={"count": {"type": "integer", "description": "How many leading themes (default 3)."}},
        contexts=["global"],
    )(_get_theme_status)

    _vt.voice_tool(
        name="get_options_flow",
        description="Get recent unusual options activity, optionally for a specific ticker.",
        parameters={
            "symbol": {"type": "string", "description": "Optional ticker filter."},
            "count": {"type": "integer", "description": "How many to include (default 3)."},
        },
        contexts=["global"],
    )(_get_options_flow)

    _vt.voice_tool(
        name="get_dark_pool",
        description="Get recent dark pool prints, optionally for a specific ticker.",
        parameters={
            "symbol": {"type": "string"},
            "count": {"type": "integer", "description": "How many (default 3)."},
        },
        contexts=["global"],
    )(_get_dark_pool)

    _vt.voice_tool(
        name="get_economic_calendar",
        description="Get major economic events on the calendar (FOMC, CPI, jobs, Fed speakers).",
        parameters={},
        contexts=["global"],
    )(_get_economic_calendar)

    _vt.voice_tool(
        name="remember",
        description="Save a fact about the user (preference, account alias, trading style, etc.) for future conversations. Call this when the user explicitly says 'remember that...' or states a clear preference you should keep.",
        parameters={
            "fact": {"type": "string", "description": "The fact to remember, in the user's words."},
            "category": {"type": "string", "enum": ["preference", "account_alias", "style", "fact", "general"]},
        },
        contexts=["global"],
        wants_user=True,
    )(_remember)

    _vt.voice_tool(
        name="forget",
        description="Remove saved facts matching a topic or keyword. Call this when the user says 'forget...' or asks you to stop remembering something.",
        parameters={"query": {"type": "string", "description": "Topic or keyword to match."}},
        contexts=["global"],
        wants_user=True,
    )(_forget)

    _vt.voice_tool(
        name="list_my_facts",
        description="Read back everything you currently remember about the user.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_list_my_facts)

    _vt.voice_tool(
        name="recall_session",
        description="Search past conversation summaries for a topic. Call this when the user asks 'what did we discuss about X?' or 'remind me what I said about Y'.",
        parameters={"query": {"type": "string"}},
        contexts=["global"],
        wants_user=True,
    )(_recall_session)

    _vt.voice_tool(
        name="morning_briefing",
        description="Comprehensive morning market briefing — regime, leading themes, today's earnings, and overall posture. Call this when the user says 'morning briefing' or 'what's the morning look like' or similar.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_morning_briefing)

    _vt.voice_tool(
        name="closing_briefing",
        description="End-of-day market recap — top performers, weakest names, breadth, what's on deck tomorrow. Call this when the user asks 'how did the market close?' or 'eod recap' or similar.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_closing_briefing)

    _vt.voice_tool(
        name="pre_trade_check",
        description="Quick briefing on a specific ticker before entering a trade — current quote, broader market context, and theme alignment. Call this when the user asks 'check NVDA before I trade it' or 'pre-trade briefing on X'.",
        parameters={"symbol": {"type": "string", "description": "Ticker symbol."}},
        contexts=["global"],
        wants_user=True,
    )(_pre_trade_check)

    _vt.voice_tool(
        name="post_trade_review",
        description="Recap the user's most recent trade for a given ticker, with entry, exit, P&L, and setup type. Call this when the user asks 'how did my NVDA trade go?' or 'recap my last X trade'.",
        parameters={"symbol": {"type": "string"}},
        contexts=["global"],
        wants_user=True,
    )(_post_trade_review)

    _vt.voice_tool(
        name="plan_my_day",
        description="Briefing for what's likely to matter today — earnings, regime, leading themes, and a closing line. Call this when the user says 'plan my day' or 'what should I focus on'.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_plan_my_day)


# ── Patch _REGISTRY so clear() re-registers these tools automatically ───────

class _SelfHealingRegistry(dict):
    """Dict subclass that re-registers Slice 2 tools after clear()."""

    def clear(self):
        super().clear()
        _register_all()


# Replace the plain dict with the self-healing variant (idempotent on reload).
if not isinstance(_vt._REGISTRY, _SelfHealingRegistry):
    _new = _SelfHealingRegistry(_vt._REGISTRY)
    _vt._REGISTRY = _new


# ── Tool implementations (plain functions — registered below) ───────────────

def _get_quote(symbol: str) -> dict:
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"symbol": "", "last": 0, "direction": "flat", "abs_pct": 0}
    snap = _snapshot(sym) or {}
    last = float(snap.get("close") or 0)
    chg = float(snap.get("change_pct") or 0)
    direction = "up" if chg > 0 else "down" if chg < 0 else "flat"
    return {
        "symbol": sym,
        "last": round(last, 2),
        "direction": direction,
        "abs_pct": abs(round(chg, 2)),
    }


def _get_movers(direction: str = "gainers", count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    data = _movers() or {}
    arr = data.get("ripping" if direction == "gainers" else "drilling", [])[:count]
    if not arr:
        return {"top_movers": "no movers available right now", "count": 0}
    parts = [
        f"{m.get('sym')} {('up' if (m.get('pct') or 0) >= 0 else 'down')} "
        f"{abs(round(m.get('pct') or 0, 1))} percent"
        for m in arr
    ]
    return {"top_movers": ", ".join(parts), "count": len(parts)}


def _get_breadth() -> dict:
    b = _breadth() or {}
    adv = int(b.get("advancing") or 0)
    dec = int(b.get("declining") or 0)
    nh = int(b.get("new_highs") or 0)
    nl = int(b.get("new_lows") or 0)
    score = b.get("breadth_score")
    skew = "advancing" if adv > dec else "declining" if dec > adv else "balanced"
    return {
        "skew": skew,
        "advancing": adv,
        "declining": dec,
        "new_highs": nh,
        "new_lows": nl,
        "score": score if score is not None else "unavailable",
    }


def _get_sector_strength(count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    sectors = (_sector_flow() or [])[:count]
    if not sectors:
        return {"top_sectors": "no sector data available", "count": 0}
    parts = [
        f"{s.get('sector')} {('up' if (s.get('change_pct') or 0) >= 0 else 'down')} "
        f"{abs(round(s.get('change_pct') or 0, 1))} percent"
        for s in sectors
    ]
    return {"top_sectors": ", ".join(parts), "count": len(parts)}


def _get_company_info(symbol: str) -> dict:
    sym = (symbol or "").upper().strip()
    return {
        "symbol": sym,
        "sector": "not available",
        "industry": "not available",
        "market_cap_b": 0,
        "note": "company-info data source not yet wired",
    }


def _compare_tickers(symbols: list[str]) -> dict:
    syms = [s.upper().strip() for s in (symbols or []) if s][:4]
    if len(syms) < 2:
        return {"summary": "I need at least two tickers to compare.", "count": 0}
    parts = []
    for s in syms:
        snap = _snapshot(s) or {}
        chg = round(float(snap.get("change_pct") or 0), 1)
        last = float(snap.get("close") or 0)
        direction = "up" if chg > 0 else "down" if chg < 0 else "flat"
        parts.append(f"{s} at {last:.2f}, {direction} {abs(chg)} percent")
    return {"summary": "; ".join(parts), "count": len(syms)}


# ── Initial registration (runs once at import) ──────────────────────────────
_register_all()
