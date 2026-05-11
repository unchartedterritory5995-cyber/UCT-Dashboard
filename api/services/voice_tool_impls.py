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


# ── Write tools (Slice 5) ──────────────────────────────────────────────────


def _create_position(*, user, account: str = "default", symbol: str = "",
                     shares=None, entry=None, stop=None, target=None,
                     setup: str = "", notes: str = "") -> dict:
    from api.services.voice_write_tools import preview_create_position
    try:
        return preview_create_position(
            user_id=user["id"], account=account, symbol=symbol,
            shares=shares, entry=entry, stop=stop, target=target,
            setup=setup, notes=notes,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _close_position(*, user, symbol: str = "", exit=None,
                    partial: bool = False, account: str = "") -> dict:
    from api.services.voice_write_tools import preview_close_position
    try:
        return preview_close_position(
            user_id=user["id"], symbol=symbol, exit=exit,
            partial=partial, account=account,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _update_position(*, user, symbol: str = "", field: str = "", value=None) -> dict:
    from api.services.voice_write_tools import preview_update_position
    try:
        return preview_update_position(
            user_id=user["id"], symbol=symbol, field=field, value=value,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _add_daily_note(*, user, text: str = "", emotion: str = "", date: str = "") -> dict:
    from api.services.voice_write_tools import preview_add_daily_note
    try:
        return preview_add_daily_note(
            user_id=user["id"], text=text, emotion=emotion, date=date,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _log_mistake(*, user, mistake_type: str = "", text: str = "", symbol: str = "") -> dict:
    from api.services.voice_write_tools import preview_log_mistake
    try:
        return preview_log_mistake(
            user_id=user["id"], mistake_type=mistake_type, text=text, symbol=symbol,
        )
    except ValueError as e:
        return {"ok": False, "error": str(e)}


def _confirm_action(*, user, action_id: str = "") -> dict:
    from api.services.voice_action_signer import (
        consume_action, ActionInvalid, ActionExpired, ActionReplayed,
    )
    from api.services.voice_write_tools import run_confirm
    try:
        payload = consume_action(action_id)
    except ActionInvalid as e:
        return {"ok": False, "error": f"invalid confirmation: {e}"}
    except ActionExpired as e:
        return {"ok": False, "error": f"confirmation expired: {e}"}
    except ActionReplayed as e:
        return {"ok": False, "error": f"already confirmed: {e}"}

    if payload.get("user_id") != user.get("id"):
        return {"ok": False, "error": "user mismatch"}

    raw_args = payload.get("args")
    if not raw_args:
        return {"ok": False, "error": "action payload missing args"}

    return run_confirm(payload["tool"], raw_args)


# ── Self-Q&A (Slice 7) ─────────────────────────────────────────────────────


def _get_my_pnl(*, user, period: str = "week") -> dict:
    from api.services.voice_self_qa import get_my_pnl
    return get_my_pnl(user_id=user["id"], period=period)


def _get_my_setup_performance(*, user, setup: str = "") -> dict:
    from api.services.voice_self_qa import get_my_setup_performance
    return get_my_setup_performance(user_id=user["id"], setup=setup)


def _get_my_recent_mistakes(*, user, days: int = 30) -> dict:
    from api.services.voice_self_qa import get_my_recent_mistakes
    return get_my_recent_mistakes(user_id=user["id"], days=days)


def _get_my_psychology(*, user, period: str = "month") -> dict:
    from api.services.voice_self_qa import get_my_psychology
    return get_my_psychology(user_id=user["id"], period=period)


def _find_my_trades(*, user, symbol: str = "", status: str = "",
                    setup: str = "", days: int = 30) -> dict:
    from api.services.voice_self_qa import find_my_trades
    return find_my_trades(user_id=user["id"], symbol=symbol, status=status,
                          setup=setup, days=days)


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

    _vt.voice_tool(
        name="create_position",
        description="Open a new position in the user's journal. ALWAYS reads back the parsed trade and waits for user confirmation via `confirm_action`. Call this when the user says 'open a position', 'log a trade', 'I just bought X', etc.",
        parameters={
            "account": {"type": "string"},
            "symbol": {"type": "string"},
            "shares": {"type": "integer"},
            "entry": {"type": "number"},
            "stop": {"type": "number"},
            "target": {"type": "number"},
            "setup": {"type": "string"},
            "notes": {"type": "string"},
        },
        contexts=["global"],
        wants_user=True,
    )(_create_position)

    _vt.voice_tool(
        name="close_position",
        description="Close an open position. Requires user confirmation via `confirm_action`.",
        parameters={
            "symbol": {"type": "string"},
            "exit": {"type": "number"},
            "partial": {"type": "boolean"},
            "account": {"type": "string"},
        },
        contexts=["global"],
        wants_user=True,
    )(_close_position)

    _vt.voice_tool(
        name="update_position",
        description="Adjust stop, target, or notes on an open position.",
        parameters={
            "symbol": {"type": "string"},
            "field": {"type": "string", "enum": ["stop", "target", "notes", "stop_price", "target_price"]},
            "value": {},
        },
        contexts=["global"],
        wants_user=True,
    )(_update_position)

    _vt.voice_tool(
        name="add_daily_note",
        description="Add a quick journal note for today.",
        parameters={
            "text": {"type": "string"},
            "emotion": {"type": "string"},
            "date": {"type": "string"},
        },
        contexts=["global"],
        wants_user=True,
    )(_add_daily_note)

    _vt.voice_tool(
        name="log_mistake",
        description="Log a trading mistake (overtrading, FOMO, broke risk rule, etc.).",
        parameters={
            "mistake_type": {"type": "string"},
            "text": {"type": "string"},
            "symbol": {"type": "string"},
        },
        contexts=["global"],
        wants_user=True,
    )(_log_mistake)

    _vt.voice_tool(
        name="confirm_action",
        description="Confirm a pending write. The user must say 'yes' or 'confirm' before you call this. Use the action_id from the preview response.",
        parameters={"action_id": {"type": "string"}},
        contexts=["global"],
        wants_user=True,
    )(_confirm_action)

    _vt.voice_tool(
        name="get_my_pnl",
        description="Get the user's trading P&L for a period (today, week, month, ytd). Call when they ask 'how did I do this week' / 'what's my P&L' / etc.",
        parameters={"period": {"type": "string", "enum": ["today", "week", "month", "ytd", "year", "all"]}},
        contexts=["global"],
        wants_user=True,
    )(_get_my_pnl)

    _vt.voice_tool(
        name="get_my_setup_performance",
        description="Best/worst setups for the user, or stats for one specific setup. Call when they ask 'what's my best setup' / 'how does my VCP perform' / etc.",
        parameters={"setup": {"type": "string", "description": "Optional — specific setup name."}},
        contexts=["global"],
        wants_user=True,
    )(_get_my_setup_performance)

    _vt.voice_tool(
        name="get_my_recent_mistakes",
        description="Recurring mistakes from the user's journal. Call when they ask 'what mistakes have I been making' / 'show recent mistakes'.",
        parameters={"days": {"type": "integer", "description": "Lookback window in days, default 30."}},
        contexts=["global"],
        wants_user=True,
    )(_get_my_recent_mistakes)

    _vt.voice_tool(
        name="get_my_psychology",
        description="Process score + emotional state summary. Call when they ask 'how's my process / discipline' or 'when do I trade best'.",
        parameters={"period": {"type": "string", "enum": ["week", "month", "quarter", "year"]}},
        contexts=["global"],
        wants_user=True,
    )(_get_my_psychology)

    _vt.voice_tool(
        name="find_my_trades",
        description="Search the user's journal for trades matching a symbol, status, setup, or date range.",
        parameters={
            "symbol": {"type": "string"},
            "status": {"type": "string", "enum": ["open", "closed", ""]},
            "setup": {"type": "string"},
            "days": {"type": "integer"},
        },
        contexts=["global"],
        wants_user=True,
    )(_find_my_trades)


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
