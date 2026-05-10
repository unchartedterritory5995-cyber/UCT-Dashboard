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
    perf = _theme_performance()
    leaders = (perf.get("leaders") or [])[:count]
    if not leaders:
        return {"top_themes": "no theme data available", "count": 0}
    parts = [
        f"{t.get('name')} {('up' if (t.get('pct') or 0) >= 0 else 'down')} "
        f"{abs(round(t.get('pct') or 0, 1))} percent"
        for t in leaders
    ]
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
