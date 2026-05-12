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
    """Return list of {sector, change_pct (float)} sorted by strength.
    Falls back to themes leaders if no dedicated endpoint.
    change_pct is always parsed to a float so callers can compare numerically."""
    def _to_float(v) -> float:
        if v is None:
            return 0.0
        if isinstance(v, (int, float)):
            return float(v)
        s = str(v).strip().replace("%", "").replace("+", "")
        try:
            return float(s)
        except ValueError:
            return 0.0

    try:
        from api.services.rs_ranking import get_sector_strength as _sec
        raw = _sec() or []
        return [{"sector": s.get("sector") or s.get("name"),
                 "change_pct": _to_float(s.get("change_pct") or s.get("pct"))} for s in raw]
    except (ImportError, AttributeError):
        from api.services.engine import get_themes
        themes = get_themes() or {}
        leaders = (themes.get("leaders") or [])[:5]
        return [{"sector": t.get("name"), "change_pct": _to_float(t.get("pct"))} for t in leaders]


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


def _get_theme_status(period: str = "", count: int = 3) -> dict:
    from api.services.voice_market_tools import get_theme_status
    return get_theme_status(period=period or None, count=count)


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


# ── Batch 1: watchlist / tag / alert wrappers ───────────────────────────────

def _flag_ticker(*, user, symbol: str) -> dict:
    from api.services.voice_watchlist_tools import flag_ticker
    return flag_ticker(symbol=symbol or "", user_id=user["id"])


def _unflag_ticker(*, user, symbol: str) -> dict:
    from api.services.voice_watchlist_tools import unflag_ticker
    return unflag_ticker(symbol=symbol or "", user_id=user["id"])


def _tag_ticker(*, user, symbol: str, color: str) -> dict:
    from api.services.voice_watchlist_tools import tag_ticker
    return tag_ticker(symbol=symbol or "", color=color or "", user_id=user["id"])


def _untag_ticker(*, user, symbol: str) -> dict:
    from api.services.voice_watchlist_tools import untag_ticker
    return untag_ticker(symbol=symbol or "", user_id=user["id"])


def _list_my_tags(*, user) -> dict:
    from api.services.voice_watchlist_tools import list_my_tags
    return list_my_tags(user_id=user["id"])


def _add_to_watchlist(*, user, symbol: str, list_name: str) -> dict:
    from api.services.voice_watchlist_tools import add_to_watchlist
    return add_to_watchlist(
        symbol=symbol or "", list_name=list_name or "", user_id=user["id"]
    )


def _remove_from_watchlist(*, user, symbol: str, list_name: str) -> dict:
    from api.services.voice_watchlist_tools import remove_from_watchlist
    return remove_from_watchlist(
        symbol=symbol or "", list_name=list_name or "", user_id=user["id"]
    )


def _list_my_watchlists(*, user) -> dict:
    from api.services.voice_watchlist_tools import list_my_watchlists
    return list_my_watchlists(user_id=user["id"])


def _set_price_alert(*, user, symbol: str, target_price, direction: str) -> dict:
    from api.services.voice_watchlist_tools import set_price_alert
    return set_price_alert(
        symbol=symbol or "", target_price=target_price,
        direction=direction or "", user_id=user["id"],
    )


def _list_my_alerts(*, user) -> dict:
    from api.services.voice_watchlist_tools import list_my_alerts
    return list_my_alerts(user_id=user["id"])


def _cancel_alert(*, user, symbol: str) -> dict:
    from api.services.voice_watchlist_tools import cancel_alert
    return cancel_alert(symbol=symbol or "", user_id=user["id"])


# ── Batch 2: market read wrappers ───────────────────────────────────────────

def _get_theme_laggards(period: str = "", count: int = 3) -> dict:
    from api.services.voice_market_tools import get_theme_laggards
    return get_theme_laggards(period=period or None, count=count)


def _get_theme_holdings(theme: str = "", count: int = 6) -> dict:
    from api.services.voice_market_tools import get_theme_holdings
    return get_theme_holdings(theme=theme, count=count)


def _get_theme_history(theme: str = "", period: str = "") -> dict:
    from api.services.voice_market_tools import get_theme_history
    return get_theme_history(theme=theme, period=period or None)


def _get_scanner_candidates(type: str = "", count: int = 5) -> dict:
    from api.services.voice_market_tools import get_scanner_candidates
    return get_scanner_candidates(type=type or None, count=count)


def _get_uct20_picks(count: int = 5) -> dict:
    from api.services.voice_market_tools import get_uct20_picks
    return get_uct20_picks(count=count)


def _get_uct20_portfolio_stats() -> dict:
    from api.services.voice_market_tools import get_uct20_portfolio_stats
    return get_uct20_portfolio_stats()


def _get_cot_data(symbol: str = "", weeks: int = 4) -> dict:
    from api.services.voice_market_tools import get_cot_data
    return get_cot_data(symbol=symbol, weeks=weeks)


def _get_breadth_analogues(count: int = 3) -> dict:
    from api.services.voice_market_tools import get_breadth_analogues
    return get_breadth_analogues(count=count)


def _get_breadth_metric(metric: str = "", days: int = 30) -> dict:
    from api.services.voice_market_tools import get_breadth_metric
    return get_breadth_metric(metric=metric, days=days)


def _get_insider_activity(symbol: str = "", count: int = 5) -> dict:
    from api.services.voice_market_tools import get_insider_activity
    return get_insider_activity(symbol=symbol, count=count)


def _get_earnings_intel(symbol: str = "") -> dict:
    from api.services.voice_market_tools import get_earnings_intel
    return get_earnings_intel(symbol=symbol)


def _get_earnings_this_week(count: int = 8) -> dict:
    from api.services.voice_market_tools import get_earnings_this_week
    return get_earnings_this_week(count=count)


# ── Batch 3: client-action wrappers (navigate / read-aloud) ────────────────

def _open_page(name: str = "") -> dict:
    from api.services.voice_client_action_tools import open_page
    return open_page(name=name)


def _read_aloud(content: str = "") -> dict:
    from api.services.voice_client_action_tools import read_aloud
    return read_aloud(content=content)


# ── Batch 7c: chart actions (client_action via global chartBus) ─────────────

def _open_ticker(symbol: str = "") -> dict:
    from api.services.voice_client_action_tools import open_ticker
    return open_ticker(symbol=symbol)


def _change_chart_timeframe(timeframe: str = "") -> dict:
    from api.services.voice_client_action_tools import change_chart_timeframe
    return change_chart_timeframe(timeframe=timeframe)


def _add_chart_indicator(name: str = "") -> dict:
    from api.services.voice_client_action_tools import add_chart_indicator
    return add_chart_indicator(name=name)


def _change_chart_type(chart_type: str = "") -> dict:
    from api.services.voice_client_action_tools import change_chart_type
    return change_chart_type(chart_type=chart_type)


# ── Batch 4: journal deep reads ─────────────────────────────────────────────

def _get_my_calendar(*, user, month: str = "") -> dict:
    from api.services.voice_journal_tools import get_my_calendar
    return get_my_calendar(month=month or None, user_id=user["id"])


def _get_my_daily_note(*, user, date: str = "") -> dict:
    from api.services.voice_journal_tools import get_my_daily_note
    return get_my_daily_note(date=date or None, user_id=user["id"])


def _get_my_weekly_review(*, user) -> dict:
    from api.services.voice_journal_tools import get_my_weekly_review
    return get_my_weekly_review(user_id=user["id"])


def _get_my_account_balance(*, user, account_name: str = "") -> dict:
    from api.services.voice_journal_tools import get_my_account_balance
    return get_my_account_balance(account_name=account_name or None,
                                  user_id=user["id"])


def _switch_account(*, user, account_name: str = "") -> dict:
    from api.services.voice_journal_tools import switch_account
    return switch_account(account_name=account_name or "", user_id=user["id"])


def _list_my_accounts(*, user) -> dict:
    from api.services.voice_journal_tools import list_my_accounts
    return list_my_accounts(user_id=user["id"])


def _get_my_option_strategies(*, user, status: str = "", count: int = 5) -> dict:
    from api.services.voice_journal_tools import get_my_option_strategies
    return get_my_option_strategies(
        status=status or None, count=count, user_id=user["id"],
    )


# ── Batch 6d: settings writes ────────────────────────────────────────────────

def _change_voice_setting(*, user, field: str = "", value=None) -> dict:
    from api.services.voice_settings_tools import change_voice_setting
    return change_voice_setting(field=field or "", value=value, user_id=user["id"])


def _list_voice_settings(*, user) -> dict:
    from api.services.voice_settings_tools import list_voice_settings
    return list_voice_settings(user_id=user["id"])


# ── Batch 8b: scratchpad (per-session working memory) ──────────────────────

def _note_write(*, user, key: str = "", value: str = "") -> dict:
    """Save a key/value pair to this session's scratchpad."""
    from api.services.voice_scratchpad_service import write_note
    try:
        out = write_note(
            user_id=user["id"], session_id=user.get("session_id"),
            key=key, value=value,
        )
    except ValueError as e:
        return {"ok": False, "narration": str(e)}
    return {"ok": True, "narration": f"Noted {out['key']}.", **out}


def _note_read(*, user, key: str = "") -> dict:
    from api.services.voice_scratchpad_service import read_note
    v = read_note(session_id=user.get("session_id"), key=key)
    if v is None:
        return {"ok": False, "narration": f"No note saved under {key!r}."}
    return {"ok": True, "narration": v, "key": key, "value": v}


def _note_list(*, user) -> dict:
    from api.services.voice_scratchpad_service import list_notes
    notes = list_notes(session_id=user.get("session_id"))
    if not notes:
        return {"ok": True, "narration": "Scratchpad is empty.", "notes": []}
    keys = [n["key"] for n in notes]
    return {
        "ok": True,
        "narration": "Scratchpad keys: " + ", ".join(keys) + ".",
        "notes": notes,
        "count": len(notes),
    }


# ── Batch 9d: Causal model ──────────────────────────────────────────────────

def _get_sector_rotation_state(regime: str = "") -> dict:
    from api.services.voice_causal_model import get_sector_rotation_state
    return get_sector_rotation_state(regime=regime or None)


def _classify_catalyst(text: str = "") -> dict:
    from api.services.voice_causal_model import classify_catalyst
    return classify_catalyst(text=text)


def _get_time_of_day_pattern() -> dict:
    from api.services.voice_causal_model import get_time_of_day_pattern
    return get_time_of_day_pattern()


# ── Batch 9c: Position-sizing engine ────────────────────────────────────────

def _calc_position_size(account_size: float = 0, risk_pct: float = 1.0,
                        entry: float = 0, stop: float = 0,
                        side: str = "long") -> dict:
    """Pure-math sizing calculator. No user state."""
    from api.services.voice_position_sizing import calc_position_size
    try:
        return calc_position_size(
            account_size=float(account_size or 0),
            risk_pct=float(risk_pct or 1.0),
            entry=float(entry or 0), stop=float(stop or 0),
            side=(side or "long").lower(),
        )
    except (TypeError, ValueError) as e:
        return {"ok": False, "reason": str(e), "shares": 0}


def _validate_trade(*, user, symbol: str = "", entry: float = 0,
                     stop: float = 0, shares: int = 0,
                     side: str = "long") -> dict:
    """Validate a planned trade against the user's rules. Returns whether
    it passes + refusal_basis if not + suggested sizing."""
    from api.services.voice_position_sizing import validate_trade
    try:
        return validate_trade(
            user_id=user["id"], symbol=symbol or "",
            entry=float(entry or 0), stop=float(stop or 0),
            shares=int(shares or 0), side=(side or "long").lower(),
        )
    except (TypeError, ValueError) as e:
        return {"ok": False, "reason": str(e),
                "refusal_basis": [str(e)], "suggested_shares": 0}


# ── Batch 9b: Regime classifier ─────────────────────────────────────────────

def _get_regime(fresh: bool = False) -> dict:
    """Current market regime — synthesizes breadth, VIX, McClellan, MA breadth
    into one canonical label with reasons."""
    from api.services.voice_regime_classifier import get_current_regime
    return get_current_regime(fresh=bool(fresh))


# ── Batch 9a: Trading Knowledge Base lookup ────────────────────────────────

def _lookup_trading_principle(query: str = "", count: int = 3) -> dict:
    """Look up curated trading wisdom — position sizing, setup definitions,
    behavioral biases, regime playbooks, microstructure. Use this whenever
    you'd benefit from established trading principles rather than just data."""
    from api.services.voice_kb_service import lookup
    q = (query or "").strip()
    if not q:
        return {"ok": False,
                "narration": "What topic? E.g. position sizing, flag breakouts, regime."}
    try:
        n = max(1, min(8, int(count or 3)))
    except (TypeError, ValueError):
        n = 3
    hits = lookup(q, k=n)
    if not hits:
        return {"ok": True,
                "narration": f"Nothing in the knowledge base on {q!r}.",
                "hits": []}
    parts = []
    for h in hits[:3]:
        parts.append(f"{h['title']}: {(h['text'] or '')[:240]}")
    return {
        "ok": True,
        "narration": " | ".join(parts)[:800],
        "hits": hits,
        "count": len(hits),
    }


# ── Batch 8a: RAG retrieval ─────────────────────────────────────────────────

def _recall_relevant(*, user, query: str = "", kind: str = "", count: int = 5) -> dict:
    """Semantic search over the user's facts + summaries + indexed content.
    Returns the top-K most relevant hits with similarity scores."""
    from api.services.voice_embeddings_service import search
    q = (query or "").strip()
    if not q:
        return {"ok": False,
                "narration": "What should I recall? Give me a topic or keyword."}
    try:
        n = max(1, min(15, int(count or 5)))
    except (TypeError, ValueError):
        n = 5
    k = kind.strip() if kind else None
    if k and k not in ("fact", "summary", "journal_entry", "transcript", "kb_chunk"):
        k = None
    try:
        hits = search(user["id"], q, k=n, kind=k)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "narration": "Recall failed.", "error": str(e)}
    if not hits:
        return {"ok": True,
                "narration": f"Nothing relevant to {q!r} in your memory.",
                "hits": []}
    top_lines = []
    for h in hits[:5]:
        snippet = (h["text"] or "")[:150]
        score = h["score"]
        top_lines.append(f"[{h['kind']} score={score}] {snippet}")
    return {
        "ok": True,
        "narration": "Most relevant — " + " | ".join(top_lines)[:600],
        "hits": [{"kind": h["kind"], "text": h["text"],
                  "score": h["score"], "source_id": h["source_id"]}
                 for h in hits],
        "count": len(hits),
    }


# ── Batch 5: feedback / training ────────────────────────────────────────────

def _correct_me(*, user, what_was_wrong: str = "", what_was_right: str = "") -> dict:
    """Persist a user correction. Voice can call this directly when the user
    says 'no, you got that wrong — X means Y'."""
    from api.services.voice_feedback_service import record_feedback
    wrong = (what_was_wrong or "").strip()
    right = (what_was_right or "").strip()
    if not right:
        return {"ok": False,
                "narration": "What's the correct answer? Tell me how I should have responded."}
    text = right if not wrong else f"When asked about {wrong}: {right}"
    record_feedback(
        user["id"], rating="down",
        turn_text=wrong or None,
        correction_text=text,
    )
    return {
        "ok": True,
        "narration": "Got it — I'll remember that going forward.",
        "correction": text,
    }


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
        description="Get the strongest sectors right now, ranked by recent relative strength. Accepts a period.",
        parameters={
            "period": {"type": "string", "description": "Today, 1W, 1M, or 3M. Defaults to today's snapshot."},
            "count": {"type": "integer", "description": "How many sectors (default 3, max 8)."},
        },
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
        description="Get the strongest themes for a given period (Today, 1W, 1M, 3M). Default 1W. Call when user says 'what themes are leading today' or 'which themes are hot this month'.",
        parameters={
            "period": {"type": "string", "description": "Today, 1W, 1M, or 3M. Default 1W."},
            "count": {"type": "integer", "description": "How many leading themes (default 3, max 8)."},
        },
        contexts=["global"],
    )(_get_theme_status)

    _vt.voice_tool(
        name="get_theme_laggards",
        description="Get the weakest themes for a given period (Today, 1W, 1M, 3M).",
        parameters={
            "period": {"type": "string", "description": "Today, 1W, 1M, or 3M. Default 1W."},
            "count": {"type": "integer"},
        },
        contexts=["global"],
    )(_get_theme_laggards)

    _vt.voice_tool(
        name="get_theme_holdings",
        description="List the top stock holdings inside a theme. Call when user says 'what's in AI theme' or 'show me semi holdings'.",
        parameters={
            "theme": {"type": "string", "description": "Theme name or ETF ticker."},
            "count": {"type": "integer", "description": "How many holdings (default 6, max 15)."},
        },
        contexts=["global"],
    )(_get_theme_holdings)

    _vt.voice_tool(
        name="get_theme_history",
        description="Get a single theme's return over a specific period.",
        parameters={
            "theme": {"type": "string"},
            "period": {"type": "string", "description": "Today, 1W, 1M, or 3M."},
        },
        contexts=["global"],
    )(_get_theme_history)

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
        contexts=["global", "train_me"],
        wants_user=True,
    )(_remember)

    _vt.voice_tool(
        name="forget",
        description="Remove saved facts matching a topic or keyword. Call this when the user says 'forget...' or asks you to stop remembering something.",
        parameters={"query": {"type": "string", "description": "Topic or keyword to match."}},
        contexts=["global", "train_me"],
        wants_user=True,
    )(_forget)

    _vt.voice_tool(
        name="list_my_facts",
        description="Read back everything you currently remember about the user.",
        parameters={},
        contexts=["global", "train_me"],
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
            "value": {"type": "string", "description": "New value. Numeric for stop/target; free text for notes."},
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

    # ── Batch 1: watchlist / tag / alert tools (single-step writes) ─────────

    _vt.voice_tool(
        name="flag_ticker",
        description="Add a ticker to the user's flagged watchlist. Call when user says 'flag NVDA' or 'mark X as flagged'. Single-step write — no confirmation needed.",
        parameters={"symbol": {"type": "string", "description": "Ticker to flag."}},
        contexts=["global"],
        wants_user=True,
    )(_flag_ticker)

    _vt.voice_tool(
        name="unflag_ticker",
        description="Remove a ticker from the user's flagged watchlist.",
        parameters={"symbol": {"type": "string"}},
        contexts=["global"],
        wants_user=True,
    )(_unflag_ticker)

    _vt.voice_tool(
        name="tag_ticker",
        description="Apply a color tag to a ticker. Colors: green, blue, orange, red, purple, gold, teal. Call when user says 'tag NVDA gold' or 'mark TSLA red'.",
        parameters={
            "symbol": {"type": "string"},
            "color": {"type": "string", "description": "One of: green, blue, orange, red, purple, gold, teal."},
        },
        contexts=["global"],
        wants_user=True,
    )(_tag_ticker)

    _vt.voice_tool(
        name="untag_ticker",
        description="Remove the color tag from a ticker.",
        parameters={"symbol": {"type": "string"}},
        contexts=["global"],
        wants_user=True,
    )(_untag_ticker)

    _vt.voice_tool(
        name="list_my_tags",
        description="Read back the user's tagged tickers, grouped by color.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_list_my_tags)

    _vt.voice_tool(
        name="add_to_watchlist",
        description="Add a ticker to a named watchlist (the user must already own a list by that name). Fuzzy name matching on the user's lists.",
        parameters={
            "symbol": {"type": "string"},
            "list_name": {"type": "string", "description": "Name of the watchlist."},
        },
        contexts=["global"],
        wants_user=True,
    )(_add_to_watchlist)

    _vt.voice_tool(
        name="remove_from_watchlist",
        description="Remove a ticker from one of the user's watchlists.",
        parameters={
            "symbol": {"type": "string"},
            "list_name": {"type": "string"},
        },
        contexts=["global"],
        wants_user=True,
    )(_remove_from_watchlist)

    _vt.voice_tool(
        name="list_my_watchlists",
        description="Read back the names and sizes of the user's watchlists.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_list_my_watchlists)

    _vt.voice_tool(
        name="set_price_alert",
        description="Create a price alert. Direction must be 'above' or 'below'. Call when user says 'alert me if NVDA hits 200' or 'tell me when TSLA breaks 250'.",
        parameters={
            "symbol": {"type": "string"},
            "target_price": {"type": "number"},
            "direction": {"type": "string", "enum": ["above", "below"]},
        },
        contexts=["global"],
        wants_user=True,
    )(_set_price_alert)

    _vt.voice_tool(
        name="list_my_alerts",
        description="Read back the user's active price alerts.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_list_my_alerts)

    _vt.voice_tool(
        name="cancel_alert",
        description="Cancel the most recent active price alert for a given symbol.",
        parameters={"symbol": {"type": "string"}},
        contexts=["global"],
        wants_user=True,
    )(_cancel_alert)

    # ── Batch 2: market data deep reads ─────────────────────────────────────

    _vt.voice_tool(
        name="get_scanner_candidates",
        description="List top scanner candidates from the UCT scanner. Type ∈ {pullback, remount, gapper}. Call when user says 'what's the scanner showing' or 'show me pullback candidates'.",
        parameters={
            "type": {"type": "string", "description": "pullback | remount | gapper. Default pullback."},
            "count": {"type": "integer", "description": "How many candidates (default 5, max 15)."},
        },
        contexts=["global"],
    )(_get_scanner_candidates)

    _vt.voice_tool(
        name="get_uct20_picks",
        description="Read the current UCT 20 leadership list — top-ranked stocks managed by the morning wire engine.",
        parameters={"count": {"type": "integer", "description": "How many (default 5, max 20)."}},
        contexts=["global"],
    )(_get_uct20_picks)

    _vt.voice_tool(
        name="get_uct20_portfolio_stats",
        description="Read the UCT 20 model portfolio's overall stats — NAV, total return, open position count.",
        parameters={},
        contexts=["global"],
    )(_get_uct20_portfolio_stats)

    _vt.voice_tool(
        name="get_cot_data",
        description="Recent CFTC Commitments of Traders positioning for a futures symbol (CL, GC, ES, NQ, etc.).",
        parameters={
            "symbol": {"type": "string", "description": "Futures symbol — CL, GC, ES, NQ, NG, ZB, DX, BTC, etc."},
            "weeks": {"type": "integer", "description": "How many weeks of history (default 4, max 12)."},
        },
        contexts=["global"],
    )(_get_cot_data)

    _vt.voice_tool(
        name="get_breadth_analogues",
        description="Find historical days with breadth patterns most similar to today, with their forward returns.",
        parameters={"count": {"type": "integer", "description": "How many analogues (default 3, max 5)."}},
        contexts=["global"],
    )(_get_breadth_analogues)

    _vt.voice_tool(
        name="get_breadth_metric",
        description="Historical value of a specific breadth metric (e.g. pct_above_50sma, new_highs, breadth_score) — latest plus N-day average.",
        parameters={
            "metric": {"type": "string"},
            "days": {"type": "integer", "description": "Lookback window (default 30, max 365)."},
        },
        contexts=["global"],
    )(_get_breadth_metric)

    _vt.voice_tool(
        name="get_insider_activity",
        description="Recent insider transactions (buys vs sells) for a ticker.",
        parameters={
            "symbol": {"type": "string"},
            "count": {"type": "integer", "description": "Transactions to summarize (default 5, max 10)."},
        },
        contexts=["global"],
    )(_get_insider_activity)

    _vt.voice_tool(
        name="get_earnings_intel",
        description="Analyst consensus and price target for a ticker (Finnhub).",
        parameters={"symbol": {"type": "string"}},
        contexts=["global"],
    )(_get_earnings_intel)

    _vt.voice_tool(
        name="get_earnings_this_week",
        description="Tickers reporting earnings before the bell and after close for the week.",
        parameters={"count": {"type": "integer", "description": "How many per bucket (default 8, max 20)."}},
        contexts=["global"],
    )(_get_earnings_this_week)

    # ── Batch 3: client-action tools (navigate / read-aloud) ────────────────

    _vt.voice_tool(
        name="open_page",
        description="Navigate the dashboard to a named page. Call when the user says 'open journal', 'take me to themes', 'go to the scanner', etc.",
        parameters={
            "name": {"type": "string", "description": "Page name — Journal, Watchlists, Themes, Breadth, Calendar, Scanner, Morning Wire, UCT 20, Settings, etc."},
        },
        contexts=["global"],
    )(_open_page)

    _vt.voice_tool(
        name="read_aloud",
        description="Play TTS playback of a known piece of dashboard content. Call when the user says 'read the morning wire', 'read me the transcript', 'play the daily note', etc.",
        parameters={
            "content": {"type": "string", "description": "What to read — morning wire, earnings transcript, UCT 20 picks, setup library, daily note, morning briefing, closing briefing."},
        },
        contexts=["global"],
    )(_read_aloud)

    # ── Batch 4: journal deep reads ─────────────────────────────────────────

    _vt.voice_tool(
        name="get_my_calendar",
        description="Read the user's Journal 2.0 monthly trade calendar summary — active days, wins, losses, net P&L. Call when user says 'what's my calendar look like' or 'how was last month'.",
        parameters={
            "month": {"type": "string", "description": "Month name ('May'), 'this month', 'last month', or YYYY-MM. Defaults to current month."},
        },
        contexts=["global"],
        wants_user=True,
    )(_get_my_calendar)

    _vt.voice_tool(
        name="get_my_daily_note",
        description="Read back the user's structured daily note (prep / mid-day / recap) for a date.",
        parameters={
            "date": {"type": "string", "description": "Date string — 'today', 'yesterday', or YYYY-MM-DD."},
        },
        contexts=["global"],
        wants_user=True,
    )(_get_my_daily_note)

    _vt.voice_tool(
        name="get_my_weekly_review",
        description="Read this ISO week's trade aggregate — wins, losses, net P&L.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_get_my_weekly_review)

    _vt.voice_tool(
        name="get_my_account_balance",
        description="Read back the closed-trade equity balance for one of the user's J2 accounts. Defaults to the active account.",
        parameters={
            "account_name": {"type": "string", "description": "Optional account display name."},
        },
        contexts=["global"],
        wants_user=True,
    )(_get_my_account_balance)

    _vt.voice_tool(
        name="switch_account",
        description="Switch the active Journal 2.0 account. Call when user says 'switch to my swing account' or 'change to day trading'.",
        parameters={
            "account_name": {"type": "string", "description": "Display name of the target account."},
        },
        contexts=["global"],
        wants_user=True,
    )(_switch_account)

    _vt.voice_tool(
        name="list_my_accounts",
        description="Read back the user's Journal 2.0 accounts.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_list_my_accounts)

    _vt.voice_tool(
        name="get_my_option_strategies",
        description="List the user's logged option strategies, optionally filtered by status.",
        parameters={
            "status": {"type": "string", "enum": ["open", "closed", ""]},
            "count": {"type": "integer", "description": "How many (default 5, max 15)."},
        },
        contexts=["global"],
        wants_user=True,
    )(_get_my_option_strategies)

    # ── Batch 5: feedback / training ────────────────────────────────────────

    _vt.voice_tool(
        name="correct_me",
        description="Persist a durable correction. Call when the user says 'no, you got that wrong' or 'actually X means Y' or 'remember that I prefer Z' — corrections are injected into your future sessions' instructions.",
        parameters={
            "what_was_wrong": {"type": "string", "description": "Brief description of what you got wrong (optional)."},
            "what_was_right": {"type": "string", "description": "The correct answer or preference to remember."},
        },
        contexts=["global", "train_me"],
        wants_user=True,
    )(_correct_me)

    # ── Batch 6d: settings writes ───────────────────────────────────────────

    _vt.voice_tool(
        name="change_voice_setting",
        description="Change one of the user's voice settings. Call when user says 'switch your voice to alloy', 'speak faster', 'set speed to 1.25', 'disable voice'.",
        parameters={
            "field": {"type": "string", "enum": ["voice", "speed", "enabled"]},
            "value": {"type": "string", "description": "Voice name (alloy, ash, ballad, coral, echo, sage, shimmer, verse) for field=voice; number or named speed (normal/faster/slower) for field=speed; yes/no for field=enabled."},
        },
        contexts=["global"],
        wants_user=True,
    )(_change_voice_setting)

    _vt.voice_tool(
        name="list_voice_settings",
        description="Read back the user's current voice settings — voice, speed, enabled state.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_list_voice_settings)

    _vt.voice_tool(
        name="lookup_trading_principle",
        description="Look up curated trading wisdom from a vetted knowledge base — position sizing, setup definitions (flags, VCP, episodic pivots, ORB, etc.), behavioral biases, regime playbooks, microstructure rules. Use this whenever the user asks a question that benefits from established trading principles vs raw data ('how should I size this', 'what does a high tight flag look like', 'is this a bull or bear regime', 'why am I tilting').",
        parameters={
            "query": {"type": "string", "description": "Topic, setup name, or concept."},
            "count": {"type": "integer", "description": "How many principles to return (default 3, max 8)."},
        },
        contexts=["global"],
    )(_lookup_trading_principle)

    _vt.voice_tool(
        name="get_regime",
        description="Current market regime — one of bull_trend, bull_correction, distribution, chop, bear_trend — plus confidence and the breadth/VIX/MA signals driving the call. Always check this before recommending a setup; the same setup behaves very differently across regimes. Use lookup_trading_principle with the regime name for the playbook.",
        parameters={
            "fresh": {"type": "boolean", "description": "Force a fresh classification, bypassing the 15-min cache."},
        },
        contexts=["global"],
    )(_get_regime)

    _vt.voice_tool(
        name="calc_position_size",
        description="Pure-math sizing calculator — given account size, risk %, entry, stop, returns the right number of shares. Use this whenever the user asks 'how many shares should I buy' or 'how do I size this' for a specific account size other than their own.",
        parameters={
            "account_size": {"type": "number"},
            "risk_pct": {"type": "number", "description": "Risk percent per trade (e.g. 1.0 for 1%)."},
            "entry": {"type": "number"},
            "stop": {"type": "number"},
            "side": {"type": "string", "enum": ["long", "short"]},
        },
        contexts=["global"],
    )(_calc_position_size)

    _vt.voice_tool(
        name="validate_trade",
        description="Run a planned trade against the USER's risk rules — account size, max risk per trade, current portfolio heat, existing positions. Returns ok/refusal_basis. This is the RISK OFFICER check — call BEFORE preview_create_position. If it returns ok=false, do NOT proceed; speak the refusal_basis to the user and either resize or skip the trade.",
        parameters={
            "symbol": {"type": "string"},
            "entry": {"type": "number"},
            "stop": {"type": "number"},
            "shares": {"type": "integer"},
            "side": {"type": "string", "enum": ["long", "short"]},
        },
        contexts=["global"],
        wants_user=True,
    )(_validate_trade)

    _vt.voice_tool(
        name="get_sector_rotation_state",
        description="Which sectors typically lead vs lag given the current (or specified) market regime. Use to anchor sector-themed recommendations to the cycle stage — e.g. financials and discretionary lead in early bull, energy and materials in late bull, staples and utilities in bear.",
        parameters={
            "regime": {"type": "string", "description": "Optional override — bull_trend, bull_correction, distribution, chop, bear_trend. Defaults to live classifier."},
        },
        contexts=["global"],
    )(_get_sector_rotation_state)

    _vt.voice_tool(
        name="classify_catalyst",
        description="Given a news headline or description, identify the catalyst type (earnings beat, FDA approval, analyst upgrade, M&A, guidance cut, etc.) and return its typical magnitude + persistence + tactical notes. Use BEFORE recommending a trade on news to anchor expectations on what this kind of catalyst usually does.",
        parameters={
            "text": {"type": "string", "description": "Headline or news snippet."},
        },
        contexts=["global"],
    )(_classify_catalyst)

    _vt.voice_tool(
        name="get_time_of_day_pattern",
        description="What intraday behavior is typical RIGHT NOW (US/Eastern). Six buckets: opening drive, morning continuation, lunch chop, afternoon trend, MOC window, after-hours. Use to filter setup recommendations — e.g. don't recommend ORB at 1pm.",
        parameters={},
        contexts=["global"],
    )(_get_time_of_day_pattern)

    _vt.voice_tool(
        name="recall_relevant",
        description="Semantic search over EVERYTHING you've saved about this user — facts, past session summaries, journal entries, indexed knowledge. Call when the user asks 'what do you remember about X', 'have we talked about Y', or whenever you'd benefit from past context on a topic that the recent-N injection might have missed.",
        parameters={
            "query": {"type": "string", "description": "Topic or keyword to search for."},
            "kind": {"type": "string", "description": "Optional filter: fact, summary, journal_entry, transcript, kb_chunk."},
            "count": {"type": "integer", "description": "How many hits (default 5, max 15)."},
        },
        contexts=["global", "train_me"],
        wants_user=True,
    )(_recall_relevant)

    # ── Batch 8b: scratchpad ───────────────────────────────────────────────

    _vt.voice_tool(
        name="note_write",
        description="Save a key/value pair to this session's working memory. Use when you've fetched data via several tools and want to reference it later in the same conversation without re-fetching. Example: after pulling NVDA quote, sector, and journal stats, write notes 'nvda_quote'='at 200, up 2%', 'nvda_sector'='semis leading', 'nvda_history'='you went 11-3 on flag breakouts'.",
        parameters={
            "key": {"type": "string", "description": "Short identifier."},
            "value": {"type": "string", "description": "Content to remember (max 4000 chars)."},
        },
        contexts=["global"],
        wants_user=True,
    )(_note_write)

    _vt.voice_tool(
        name="note_read",
        description="Read back a value you previously wrote to the session scratchpad.",
        parameters={"key": {"type": "string"}},
        contexts=["global"],
        wants_user=True,
    )(_note_read)

    _vt.voice_tool(
        name="note_list",
        description="List all keys currently in this session's scratchpad.",
        parameters={},
        contexts=["global"],
        wants_user=True,
    )(_note_list)

    # ── Batch 7c: chart actions (dispatched via client chartBus) ───────────

    _vt.voice_tool(
        name="open_ticker",
        description="Open the TickerPopup chart modal for a symbol. Call when user says 'open NVDA' or 'show me AAPL'.",
        parameters={"symbol": {"type": "string"}},
        contexts=["global"],
    )(_open_ticker)

    _vt.voice_tool(
        name="change_chart_timeframe",
        description="Switch the current chart's timeframe. Accepts 5min/30min/1hr/Daily/Weekly/Monthly and aliases like 'one hour' or 'D'.",
        parameters={"timeframe": {"type": "string"}},
        contexts=["global"],
    )(_change_chart_timeframe)

    _vt.voice_tool(
        name="add_chart_indicator",
        description="Add an indicator/overlay to the current chart. Supported: VWAP, AVWAP, MA9/20/50/200, EMA9/20/50, RSI, MACD, Bollinger Bands.",
        parameters={"name": {"type": "string"}},
        contexts=["global"],
    )(_add_chart_indicator)

    _vt.voice_tool(
        name="change_chart_type",
        description="Switch chart type — candles, hollow, bars, line, or area.",
        parameters={"chart_type": {"type": "string"}},
        contexts=["global"],
    )(_change_chart_type)


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


def _get_sector_strength(period: str = "", count: int = 3) -> dict:
    from api.services.voice_market_tools import get_sector_strength
    return get_sector_strength(period=period or None, count=count)


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
