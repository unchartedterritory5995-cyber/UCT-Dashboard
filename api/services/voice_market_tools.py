"""
Voice market read tools — expand coverage to every data page the dashboard
exposes. Scanner, UCT20, calendar, COT, breadth deep, theme holdings/history,
insider, earnings intel.

All tools normalize results to flat dicts with a "narration" string the
model can speak directly, plus structured fields for inspection.
"""

import logging
from typing import Any

_log = logging.getLogger(__name__)

# Period aliases tolerable to voice transcription
_PERIOD_ALIASES = {
    "today": "Today", "intraday": "Today", "day": "Today", "1d": "Today",
    "week": "1W", "1week": "1W", "one week": "1W", "1w": "1W",
    "month": "1M", "1month": "1M", "one month": "1M", "1m": "1M",
    "3 month": "3M", "3month": "3M", "three month": "3M", "3m": "3M",
    "quarter": "3M",
    "year": "1Y", "1year": "1Y", "ytd": "YTD", "year to date": "YTD",
}


def _norm_period(period: str | None, *, default: str = "1W",
                 allowed: tuple[str, ...] = ("Today", "1W", "1M", "3M")) -> str:
    if not period:
        return default
    p = period.strip().lower()
    p_norm = _PERIOD_ALIASES.get(p, p.upper())
    if p_norm not in allowed:
        return default
    return p_norm


def _to_float(v: Any) -> float:
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace("%", "").replace("+", "")
    try:
        return float(s)
    except ValueError:
        return 0.0


# ── Themes: period control + holdings + history ────────────────────────────

def get_theme_status(*, period: str | None = None, count: int = 3) -> dict:
    """Leading themes for a given period. Period defaults to 1W."""
    from api.services.engine import get_themes
    p = _norm_period(period, default="1W", allowed=("Today", "1W", "1M", "3M"))
    n = max(1, min(8, int(count or 3)))
    themes = get_themes(p) or {}
    leaders = (themes.get("leaders") or [])[:n]
    if not leaders:
        return {"ok": True, "narration": f"No theme data for {p}.", "period": p,
                "themes": []}
    parts, structured = [], []
    for t in leaders:
        pct = _to_float(t.get("pct"))
        direction = "up" if pct >= 0 else "down"
        parts.append(f"{t.get('name')} {direction} {abs(round(pct, 1))} percent")
        structured.append({"name": t.get("name"), "ticker": t.get("ticker"),
                           "pct": round(pct, 2)})
    return {
        "ok": True,
        "narration": f"Top {p} themes — " + ", ".join(parts) + ".",
        "period": p,
        "themes": structured,
        "count": len(structured),
    }


def get_theme_laggards(*, period: str | None = None, count: int = 3) -> dict:
    """Weakest themes for a given period."""
    from api.services.engine import get_themes
    p = _norm_period(period, default="1W", allowed=("Today", "1W", "1M", "3M"))
    n = max(1, min(8, int(count or 3)))
    themes = get_themes(p) or {}
    laggards = (themes.get("laggards") or [])[:n]
    if not laggards:
        return {"ok": True, "narration": f"No laggard data for {p}.", "period": p,
                "themes": []}
    parts, structured = [], []
    for t in laggards:
        pct = _to_float(t.get("pct"))
        parts.append(f"{t.get('name')} down {abs(round(pct, 1))} percent")
        structured.append({"name": t.get("name"), "ticker": t.get("ticker"),
                           "pct": round(pct, 2)})
    return {
        "ok": True,
        "narration": f"Weakest {p} themes — " + ", ".join(parts) + ".",
        "period": p,
        "themes": structured,
        "count": len(structured),
    }


def _find_theme(theme_name: str, period: str) -> dict | None:
    from api.services.engine import get_themes
    target = (theme_name or "").strip().lower()
    if not target:
        return None
    themes = get_themes(period) or {}
    pool = (themes.get("leaders") or []) + (themes.get("laggards") or [])
    for t in pool:
        nm = (t.get("name") or "").strip().lower()
        tk = (t.get("ticker") or "").strip().lower()
        if target == nm or target == tk:
            return t
    for t in pool:
        if target in (t.get("name") or "").strip().lower():
            return t
    return None


def get_theme_holdings(*, theme: str, count: int = 6) -> dict:
    """Top holdings inside a theme."""
    n = max(1, min(15, int(count or 6)))
    t = _find_theme(theme, period="1W")
    if not t:
        return {"ok": False, "narration": f"I couldn't find a theme called {theme!r}."}
    holdings = (t.get("holdings") or [])[:n]
    if not holdings:
        return {"ok": True,
                "narration": f"{t.get('name')} has no listed holdings.",
                "theme": t.get("name"), "holdings": []}
    return {
        "ok": True,
        "narration": f"{t.get('name')} top holdings — {', '.join(holdings)}.",
        "theme": t.get("name"),
        "ticker": t.get("ticker"),
        "holdings": holdings,
        "count": len(holdings),
    }


def get_theme_history(*, theme: str, period: str | None = None) -> dict:
    """One theme's return over a single period."""
    p = _norm_period(period, default="1M", allowed=("Today", "1W", "1M", "3M"))
    t = _find_theme(theme, period=p)
    if not t:
        return {"ok": False, "narration": f"I couldn't find {theme!r}."}
    pct = _to_float(t.get("pct"))
    direction = "up" if pct >= 0 else "down"
    return {
        "ok": True,
        "narration": f"{t.get('name')} is {direction} {abs(round(pct, 2))} percent over {p}.",
        "theme": t.get("name"),
        "period": p,
        "pct": round(pct, 2),
    }


# ── Scanner candidates ─────────────────────────────────────────────────────

def get_scanner_candidates(*, type: str | None = None, count: int = 5) -> dict:
    """List top scanner candidates by type. type ∈ {pullback, remount, gapper}."""
    from api.services.engine import get_candidates
    t = (type or "").strip().lower()
    key_map = {
        "pullback": "pullback_ma", "pullback_ma": "pullback_ma", "ma": "pullback_ma",
        "remount": "remount",
        "gapper": "gapper_news", "gappers": "gapper_news", "gap": "gapper_news",
        "news": "gapper_news",
    }
    key = key_map.get(t, "pullback_ma")
    n = max(1, min(15, int(count or 5)))
    data = get_candidates() or {}
    rows = (data.get("candidates") or {}).get(key) or []
    rows = rows[:n]
    if not rows:
        return {"ok": True, "narration": f"No {key.replace('_', ' ')} candidates right now.",
                "type": key, "candidates": []}
    syms = [r.get("sym") or r.get("ticker") for r in rows if r.get("sym") or r.get("ticker")]
    return {
        "ok": True,
        "narration": f"{key.replace('_', ' ').title()} candidates — {', '.join(syms)}.",
        "type": key,
        "candidates": [
            {"sym": r.get("sym") or r.get("ticker"),
             "score": r.get("candle_score") or r.get("score"),
             "alert": r.get("alert_state") or r.get("alert"),
             "pattern": r.get("pattern_type")}
            for r in rows
        ],
        "count": len(rows),
    }


# ── UCT 20 ─────────────────────────────────────────────────────────────────

def get_uct20_picks(*, count: int = 5) -> dict:
    """The current UCT 20 leadership list."""
    from api.services.engine import get_leadership
    n = max(1, min(20, int(count or 5)))
    rows = (get_leadership() or [])[:n]
    if not rows:
        return {"ok": True, "narration": "UCT 20 hasn't been updated yet today.",
                "picks": []}
    syms = [r.get("sym") or r.get("symbol") for r in rows if r.get("sym") or r.get("symbol")]
    return {
        "ok": True,
        "narration": f"Top UCT 20 picks — {', '.join(syms)}.",
        "picks": [
            {"sym": r.get("sym") or r.get("symbol"),
             "company": r.get("company") or r.get("name"),
             "rating": r.get("uct_rating") or r.get("rating"),
             "setup": r.get("setup")}
            for r in rows
        ],
        "count": len(rows),
    }


def get_uct20_portfolio_stats() -> dict:
    """UCT 20 model portfolio NAV and return stats."""
    from api.services.engine import get_uct20_portfolio_data
    data = get_uct20_portfolio_data() or {}
    if not data:
        return {"ok": True, "narration": "UCT 20 portfolio data not loaded yet.",
                "stats": {}}
    stats = data.get("stats") or {}
    nav = data.get("nav") or stats.get("nav")
    pnl_pct = stats.get("total_return_pct") or stats.get("pnl_pct")
    open_count = len(data.get("open_positions") or [])
    parts = []
    if nav is not None:
        parts.append(f"NAV {nav}")
    if pnl_pct is not None:
        direction = "up" if pnl_pct >= 0 else "down"
        parts.append(f"{direction} {abs(round(float(pnl_pct), 2))} percent overall")
    parts.append(f"{open_count} open positions")
    return {
        "ok": True,
        "narration": "UCT 20 portfolio — " + ", ".join(parts) + ".",
        "stats": {"nav": nav, "pnl_pct": pnl_pct, "open_count": open_count},
    }


# ── COT positioning ────────────────────────────────────────────────────────

def get_cot_data(*, symbol: str, weeks: int = 4) -> dict:
    """Recent CFTC COT positioning trend for a futures symbol."""
    from api.services.cot_service import get_cot_data as _cot
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"ok": False, "narration": "Which futures symbol?"}
    n = max(2, min(12, int(weeks or 4)))
    rows = _cot(sym, weeks=n) or []
    if not rows:
        return {"ok": False, "narration": f"No COT data for {sym}."}
    latest = rows[-1]
    spec_net = latest.get("large_spec_net") or 0
    comm_net = latest.get("commercial_net") or 0
    direction = "long" if spec_net > 0 else "short"
    return {
        "ok": True,
        "narration": (
            f"{sym} COT — large specs net {direction} {abs(spec_net):,}, "
            f"commercials net {'long' if comm_net > 0 else 'short'} {abs(comm_net):,}, "
            f"latest report {latest.get('date')}."
        ),
        "symbol": sym,
        "latest_date": latest.get("date"),
        "large_spec_net": spec_net,
        "commercial_net": comm_net,
        "small_spec_net": latest.get("small_spec_net"),
        "open_interest": latest.get("open_interest"),
        "weeks": n,
    }


# ── Breadth deep ───────────────────────────────────────────────────────────

def get_breadth_analogues(*, count: int = 3) -> dict:
    """Historical analogues of current breadth pattern."""
    try:
        from api.services.breadth_analogues import find_analogues
        result = find_analogues(top_n=max(1, min(5, int(count or 3))))
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "narration": "Breadth analogues unavailable right now.",
                "error": str(e)}
    if not result or not result.get("analogues"):
        return {"ok": True, "narration": "No matching historical analogues found.",
                "analogues": []}
    parts = []
    for a in result["analogues"][:5]:
        date = a.get("date")
        fwd = a.get("forward_returns") or {}
        five_d = fwd.get("5d")
        parts.append(f"{date} (5-day {round(float(five_d), 1) if five_d is not None else 'n/a'} percent)")
    return {
        "ok": True,
        "narration": "Closest analogues — " + ", ".join(parts) + ".",
        "analogues": result["analogues"][:5],
        "count": len(result["analogues"][:5]),
    }


def get_breadth_metric(*, metric: str, days: int = 30) -> dict:
    """Historical value of a specific breadth metric over N days."""
    from api.services.breadth_monitor import get_history
    m = (metric or "").strip().lower()
    if not m:
        return {"ok": False, "narration": "Which breadth metric?"}
    n = max(5, min(365, int(days or 30)))
    rows = get_history(days=n) or []
    if not rows:
        return {"ok": False, "narration": "No breadth history loaded."}
    series = [r for r in rows if r.get(m) is not None]
    if not series:
        return {"ok": False,
                "narration": f"I don't have history for breadth metric {m!r}."}
    latest = series[-1]
    avg = sum(float(r[m]) for r in series) / len(series)
    return {
        "ok": True,
        "narration": (
            f"{m} latest is {latest[m]}, {n}-day average is {round(avg, 1)}."
        ),
        "metric": m,
        "latest": latest[m],
        "latest_date": latest.get("date"),
        "average": round(avg, 2),
        "days": n,
    }


# ── Insider & earnings intel ───────────────────────────────────────────────

def get_insider_activity(*, symbol: str, count: int = 5) -> dict:
    """Recent insider transactions for a ticker (Finnhub)."""
    from api.services.insider import get_insider_activity as _insider
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"ok": False, "narration": "Which ticker?"}
    rows = (_insider(sym) or [])[:max(1, min(10, int(count or 5)))]
    if not rows:
        return {"ok": True, "narration": f"No recent insider activity for {sym}.",
                "transactions": []}
    buys = sum(1 for r in rows if (r.get("transaction_type") or "").lower() == "buy")
    sells = sum(1 for r in rows if (r.get("transaction_type") or "").lower() == "sell")
    return {
        "ok": True,
        "narration": (
            f"{sym} insider activity — {buys} buys, {sells} sells in the last "
            f"{len(rows)} transactions."
        ),
        "symbol": sym,
        "buys": buys,
        "sells": sells,
        "transactions": rows,
    }


def get_earnings_intel(*, symbol: str) -> dict:
    """Analyst consensus + price target for a ticker."""
    from api.services.earnings_estimates import get_earnings_intel as _intel
    sym = (symbol or "").upper().strip()
    if not sym:
        return {"ok": False, "narration": "Which ticker?"}
    data = _intel(sym)
    if not data:
        return {"ok": False, "narration": f"No earnings intel for {sym}."}
    consensus = data.get("consensus") or {}
    pt = data.get("price_target") or {}
    parts = []
    if consensus:
        buys = (consensus.get("buy") or 0) + (consensus.get("strongBuy") or 0)
        holds = consensus.get("hold") or 0
        sells = (consensus.get("sell") or 0) + (consensus.get("strongSell") or 0)
        parts.append(f"{buys} buys, {holds} holds, {sells} sells")
    if pt.get("targetMean"):
        parts.append(f"mean price target {pt['targetMean']}")
    if not parts:
        return {"ok": True, "narration": f"No analyst data on {sym}.",
                "symbol": sym}
    return {
        "ok": True,
        "narration": f"{sym} analyst view — " + ", ".join(parts) + ".",
        "symbol": sym,
        "consensus": consensus,
        "price_target": pt,
        "beat_history": data.get("beat_history"),
    }


# ── Earnings this week ─────────────────────────────────────────────────────

def get_earnings_this_week(*, count: int = 8) -> dict:
    """Tickers reporting earnings BMO or AMC today (and adjacent in wire_data)."""
    from api.services.engine import get_earnings
    data = get_earnings() or {}
    bmo = (data.get("bmo") or [])
    amc = (data.get("amc") or [])
    n = max(1, min(20, int(count or 8)))
    bmo_syms = [str(e.get("sym", "")).upper() for e in bmo if e.get("sym")][:n]
    amc_syms = [str(e.get("sym", "")).upper() for e in amc if e.get("sym")][:n]
    parts = []
    if bmo_syms:
        parts.append(f"before the bell: {', '.join(bmo_syms)}")
    if amc_syms:
        parts.append(f"after close: {', '.join(amc_syms)}")
    if not parts:
        return {"ok": True, "narration": "No earnings on deck.",
                "bmo": [], "amc": []}
    return {
        "ok": True,
        "narration": "Earnings — " + "; ".join(parts) + ".",
        "bmo": bmo_syms,
        "amc": amc_syms,
        "count": len(bmo_syms) + len(amc_syms),
    }


# ── Sector strength with period control ────────────────────────────────────

def get_sector_strength(*, period: str | None = None, count: int = 3) -> dict:
    """Strongest sectors. Period currently snapshot-only (today)."""
    # The underlying rs_ranking service returns the current snapshot.
    # Period is accepted for future expansion and graceful voice handling.
    try:
        from api.services.rs_ranking import get_sector_strength as _sec
        rows = _sec() or []
    except (ImportError, AttributeError):
        from api.services.engine import get_themes
        themes = get_themes() or {}
        rows = [{"sector": t.get("name"), "change_pct": t.get("pct")}
                for t in (themes.get("leaders") or [])[:5]]
    n = max(1, min(8, int(count or 3)))
    sectors = []
    for r in rows[:n]:
        sectors.append({
            "sector": r.get("sector") or r.get("name"),
            "change_pct": _to_float(r.get("change_pct") or r.get("pct")),
        })
    if not sectors:
        return {"ok": True, "narration": "No sector data available.", "sectors": []}
    parts = [
        f"{s['sector']} {('up' if s['change_pct'] >= 0 else 'down')} "
        f"{abs(round(s['change_pct'], 1))} percent"
        for s in sectors
    ]
    return {
        "ok": True,
        "narration": "Sector strength — " + ", ".join(parts) + ".",
        "sectors": sectors,
        "count": len(sectors),
    }
