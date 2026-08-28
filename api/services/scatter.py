"""api/services/scatter.py — universe-wide per-ticker metric bundles for the
Scatter (bubble) widget.

The widget plots one point per stock: the user picks a UNIVERSE (an index, a
watchlist, a scanner's output, a breadth set, a theme, the whole market) and picks
which metric goes on X, Y and (optionally) bubble SIZE. So the job here is: resolve
a universe → a ticker list, and return a per-ticker bundle carrying EVERY plottable
metric at once, so the client can switch axes with no refetch.

Two data layers, merged per ticker:
  • DAILY (slow) — the precomputed nightly `screener_rows` snapshot + the RS cache:
    RS rank, ADR/ATR, multi-period returns, market cap, P/E, MA distances, 52w
    distances, RSI, beta, short float, sector/industry. Cheap indexed reads.
  • LIVE (ticks) — one free whole-market snapshot (`get_full_market_snapshot`):
    price, % change today, gap %, from-open %, RVOL, $-volume, range position.
    Re-polled every couple seconds so the dots glide.

Everything here is READ-ONLY and cheap enough for the request path: no per-ticker
bar fetch, no per-ticker external call. The heavy work (the nightly screener build,
the RS rebuild) happens on background jobs; this only reads their output.
"""
from __future__ import annotations

import threading
import time
from typing import Optional

# ── Metric catalog ────────────────────────────────────────────────────────────
# Each axis option. `live` marks a metric that updates on every tick (from the
# whole-market snapshot); the rest come from the nightly snapshot and refresh
# slowly. `unit` drives client-side formatting. `src` is the field key we emit.
METRICS = [
    # ── Today (live) ──
    {"key": "chg_today",  "label": "% Change Today",   "group": "Today",  "unit": "pct",    "live": True},
    {"key": "gap",        "label": "Gap %",            "group": "Today",  "unit": "pct",    "live": True},
    {"key": "from_open",  "label": "% From Open",      "group": "Today",  "unit": "pct",    "live": True},
    {"key": "range_pos",  "label": "Day Range Pos %",  "group": "Today",  "unit": "pct0",   "live": True},
    {"key": "rvol",       "label": "Run Rate",         "group": "Today",  "unit": "x",      "live": True},
    {"key": "price",      "label": "Price",            "group": "Today",  "unit": "usd",    "live": True},
    {"key": "dvol_today", "label": "$ Volume Today",   "group": "Today",  "unit": "usd_big","live": True},
    {"key": "vol_today",  "label": "Volume Today",     "group": "Today",  "unit": "big",    "live": True},
    # ── Momentum / RS ──
    {"key": "rs_rank",    "label": "RS Rating",        "group": "Momentum", "unit": "num",  "live": False},
    {"key": "chg_1w",     "label": "1-Week %",         "group": "Momentum", "unit": "pct",  "live": False},
    {"key": "chg_1m",     "label": "1-Month %",        "group": "Momentum", "unit": "pct",  "live": False},
    {"key": "chg_3m",     "label": "3-Month %",        "group": "Momentum", "unit": "pct",  "live": False},
    {"key": "chg_6m",     "label": "6-Month %",        "group": "Momentum", "unit": "pct",  "live": False},
    {"key": "chg_1y",     "label": "1-Year %",         "group": "Momentum", "unit": "pct",  "live": False},
    {"key": "chg_ytd",    "label": "YTD %",            "group": "Momentum", "unit": "pct",  "live": False},
    # ── Trend ──
    {"key": "pct_vs_sma50",  "label": "% vs 50-SMA",   "group": "Trend", "unit": "pct", "live": False},
    {"key": "pct_vs_sma200", "label": "% vs 200-SMA",  "group": "Trend", "unit": "pct", "live": False},
    {"key": "dist_52w_high", "label": "% Off 52w High", "group": "Trend", "unit": "pct", "live": False},
    {"key": "dist_52w_low",  "label": "% Off 52w Low",  "group": "Trend", "unit": "pct", "live": False},
    {"key": "rsi14",         "label": "RSI (14)",       "group": "Trend", "unit": "num", "live": False},
    # ── Volatility / Volume ──
    {"key": "adr_pct",     "label": "ADR %",           "group": "Volatility", "unit": "pct", "live": False},
    {"key": "atr_pct",     "label": "ATR %",           "group": "Volatility", "unit": "pct", "live": False},
    {"key": "beta",        "label": "Beta",            "group": "Volatility", "unit": "num", "live": False},
    {"key": "avg_vol_30d", "label": "Avg Vol (30d)",   "group": "Volume",     "unit": "big", "live": False},
    {"key": "dollar_vol_30d", "label": "Avg $ Vol (30d)", "group": "Volume",  "unit": "usd_big", "live": False},
    # ── Fundamentals ──
    {"key": "market_cap",  "label": "Market Cap",      "group": "Fundamentals", "unit": "usd_big", "live": False},
    {"key": "pe_ttm",      "label": "P/E (TTM)",       "group": "Fundamentals", "unit": "num", "live": False},
    {"key": "short_float", "label": "Short Float %",   "group": "Fundamentals", "unit": "pct", "live": False},
    {"key": "div_yield",   "label": "Dividend Yield %","group": "Fundamentals", "unit": "pct", "live": False},
]
_METRIC_KEYS = {m["key"] for m in METRICS}

# Daily metric key → screener_rows column. RS is served from the RS cache (fresher
# + populated even when the nightly sweep's rs_rank column is cold), everything else
# straight off the snapshot row.
_DAILY_COL = {
    "chg_1w": "chg_pct_1w", "chg_1m": "chg_pct_1m", "chg_3m": "chg_pct_3m",
    "chg_6m": "chg_pct_6m", "chg_1y": "chg_pct_1y", "chg_ytd": "chg_pct_ytd",
    "pct_vs_sma50": "pct_vs_sma50", "pct_vs_sma200": "pct_vs_sma200",
    "dist_52w_high": "dist_52w_high_pct", "dist_52w_low": "dist_52w_low_pct",
    "rsi14": "rsi14", "adr_pct": "adr_pct", "atr_pct": "atr_pct", "beta": "beta",
    "avg_vol_30d": "avg_volume_30d", "dollar_vol_30d": "dollar_vol_30d",
    "market_cap": "market_cap", "pe_ttm": "pe_ttm", "short_float": "short_float_pct",
    "div_yield": "dividend_yield",
}


def metric_catalog() -> list:
    return METRICS


# ── Session-aware whole-market snapshot ─────────────────────────────────────────
# The Market Map is a REGULAR-SESSION view: it uses the regular-session price
# (day.c) — NEVER the ext-hours last trade — so it is not moved by pre/post-market
# prints, it FREEZES at the 4pm close, and it holds that close until the next 9:30
# open. Mechanism: during RTH we fetch fresh regular-session data and keep it as the
# `_rth_freeze`; outside RTH we serve the freeze (today's close after 4pm; yesterday's
# close overnight/pre-market), so nothing changes until 9:30 the next day.
_snap_lock = threading.Lock()
_snap_cache: dict = {"at": 0.0, "data": None}
_rth_freeze: dict = {"session_date": None, "data": None}
_SNAP_TTL = 2.5   # a couple seconds — the whole-market call is one request

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    _ET = None


def _et_now():
    from datetime import datetime, timezone
    d = datetime.now(timezone.utc)
    return d.astimezone(_ET) if _ET else d


def _is_rth(now=None) -> bool:
    """Regular session, 9:30–16:00 ET on a real trading day (holiday-aware when the
    liveness helper is available, else a weekday clock check)."""
    try:
        from api.services.bars_liveness import is_market_open
        return bool(is_market_open())
    except Exception:
        n = now or _et_now()
        hm = n.hour * 100 + n.minute
        return n.weekday() < 5 and 930 <= hm < 1600


def _cumfrac_now() -> float:
    """Expected fraction of a full regular session's volume elapsed by now — so a
    RUN RATE projects to full-day (a name trading at 2× its normal pace reads ~2×
    regardless of the time of day). 1.0 when the session is over (the frozen close
    already holds the full day), clamped to a floor so the open doesn't blow up."""
    if not _is_rth():
        return 1.0
    try:
        from api.services.volume_live import _cumfrac
        cf = float(_cumfrac(_et_now()))
        return min(1.0, max(0.08, cf))
    except Exception:
        return 1.0


def _fetch_regular_snapshot() -> dict:
    """The whole market as REGULAR-SESSION values (day.c price, day.v volume) — the
    ext-hours last trade is deliberately ignored. Keyed by PROVIDER ticker.

    Rides the SHARED hl-snapshot cache (`get_full_market_snapshot_hl_cached`) that the
    Volume / NH-NL scanners already keep warm — so this never makes its own blocking
    whole-market provider call on the request path (single-flight + last-good on error).
    """
    try:
        from api.services.massive import get_full_market_snapshot_hl_cached
        raw = get_full_market_snapshot_hl_cached(ttl=2.0) or {}
    except Exception:
        return {}
    out = {}
    for t, d in raw.items():
        day_c = d.get("day_c") or 0.0            # regular-session last / 4pm close (frozen after close)
        prev = d.get("prev_close") or 0.0
        price = day_c if day_c and day_c > 0 else prev   # pre-open: no regular trade yet → prior close
        out[t] = {
            "last_price": round(float(price), 4),
            "prev_close": round(float(prev), 4),
            "today_vol": int(d.get("today_vol") or 0),   # day.v — regular-session volume
            "day_open": d.get("day_open"),
            "day_high": d.get("day_high"),
            "day_low": d.get("day_low"),
        }
    return out


def _full_snapshot() -> dict:
    """Regular-session whole-market snapshot, memoized ~2.5s. During RTH it tracks the
    live regular session AND updates the freeze; outside RTH it returns the frozen
    last-RTH snapshot (so the map holds the 4pm close until the next 9:30 open)."""
    now = time.time()
    with _snap_lock:
        if _snap_cache["data"] is not None and now - _snap_cache["at"] < _SNAP_TTL:
            return _snap_cache["data"]
        frozen = _rth_freeze["data"]
    rth = _is_rth()
    # Market closed + we already hold a frozen session → serve it, no re-fetch.
    if not rth and frozen is not None:
        with _snap_lock:
            _snap_cache["data"] = frozen
            _snap_cache["at"] = now
        return frozen
    reg = _fetch_regular_snapshot()
    with _snap_lock:
        _snap_cache["data"] = reg
        _snap_cache["at"] = now
        if rth and reg:
            _rth_freeze["session_date"] = _et_now().date().isoformat()
            _rth_freeze["data"] = reg
    return reg


def _prov(sym: str) -> str:
    """App ticker → provider ticker for the snapshot lookup (BRK-B → BRK.B)."""
    try:
        from api.services.massive import to_polygon_symbol
        return to_polygon_symbol(sym)
    except Exception:
        return sym


def _live_fields(s: dict, avg_vol, cumfrac: float = 1.0) -> dict:
    """The intraday metrics + direction from one regular-session snapshot row. RVOL is
    a RUN RATE: `(today_vol / cumfrac) / avg_vol` projects to full-day during RTH, and
    since `cumfrac` is 1.0 once the session is over it becomes the true full-day RVOL,
    frozen. Missing values are simply omitted."""
    out: dict = {}
    if not s:
        return out
    last = s.get("last_price") or 0.0
    prev = s.get("prev_close") or 0.0
    op = s.get("day_open")
    hi, lo = s.get("day_high"), s.get("day_low")
    tv = s.get("today_vol") or 0
    if last > 0:
        out["price"] = round(last, 2)
    if prev > 0 and last > 0:
        out["chg_today"] = round((last - prev) / prev * 100, 2)
    if prev > 0 and op:
        out["gap"] = round((op - prev) / prev * 100, 2)
    if op and last > 0:
        out["from_open"] = round((last - op) / op * 100, 2)
    if hi and lo and hi > lo and last > 0:
        out["range_pos"] = round((last - lo) / (hi - lo) * 100, 1)
    if tv > 0:
        out["vol_today"] = tv
        if last > 0:
            out["dvol_today"] = round(tv * last)
        if avg_vol and avg_vol > 0:
            out["rvol"] = round((tv / max(cumfrac, 0.08)) / avg_vol, 2)
    out["dir"] = "up" if out.get("chg_today", 0.0) >= 0 else "down"
    return out


def live_overlay(tickers: list, avg_vol_map: Optional[dict] = None) -> dict:
    """`{sym: {chg_today, gap, from_open, price, rvol, range_pos, dvol_today,
    vol_today, dir}}` for a universe — the fast-poll payload the widget re-fetches
    on a short cadence to glide the dots. `avg_vol_map` (app-ticker → 30d avg vol)
    lets RVOL be computed; without it RVOL is simply absent."""
    snap = _full_snapshot()
    avg_vol_map = avg_vol_map or {}
    out = {}
    for sym in tickers:
        s = snap.get(_prov(sym))
        if not s:
            continue
        live = _live_fields(s, avg_vol_map.get(sym.upper()))
        if live:
            out[sym] = live
    return out


def _num(v):
    """Coerce a stored value to a float, or None (NULLs and junk drop out cleanly
    so a metric a name lacks just doesn't plot that name)."""
    if v is None or v == "":
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None   # drop NaN


def bundle(tickers: list) -> dict:
    """The full per-ticker metric bundle for a universe.

    Returns `{asof, count, tickers: [{sym, name, sector, industry, dir, m}]}` where
    `m` carries EVERY available metric key (daily from screener_rows + RS cache,
    live from the market snapshot), so the client can switch X / Y / Size instantly.
    """
    tickers = [t.upper() for t in tickers if t]
    if not tickers:
        return {"asof": None, "count": 0, "tickers": []}

    from api.services.screener import snapshot_db
    from api.services import rs_ranking
    try:
        rows = snapshot_db.get_rows(tickers)
    except Exception:
        rows = {}
    try:
        rs = rs_ranking.cached_rank_map()
    except Exception:
        rs = {}
    snap = _full_snapshot()
    cf = _cumfrac_now()

    out = []
    for sym in tickers:
        r = rows.get(sym, {})
        m: dict = {}
        # daily metrics from the screener snapshot
        for key, col in _DAILY_COL.items():
            v = _num(r.get(col))
            if v is not None:
                m[key] = round(v, 4)
        # RS from the (fresher) RS cache, falling back to the snapshot column
        rsrow = rs.get(sym)
        rs_rank = None
        if rsrow is not None:
            rs_rank = rsrow.get("rs_rank")
        if rs_rank is None:
            rs_rank = _num(r.get("rs_rank"))
        if rs_rank is not None:
            m["rs_rank"] = int(rs_rank)
        # live metrics from the (regular-session) market snapshot
        live = _live_fields(snap.get(_prov(sym)), r.get("avg_volume_30d"), cf)
        direction = live.pop("dir", None)
        m.update({k: v for k, v in live.items() if v is not None})
        out.append({
            "sym": sym,
            "name": r.get("company") or None,
            "sector": r.get("sector") or None,
            "industry": r.get("industry") or None,
            "dir": direction or "flat",
            "m": m,
        })
    return {"asof": _snap_cache.get("at") or None, "count": len(out),
            "cumfrac": round(cf, 4), "rth": _is_rth(), "tickers": out}


# ── Universe resolution ────────────────────────────────────────────────────────
# Breadth drill sets offered in the picker (label + the metric key its member list
# comes from). Kept short + high-signal; the full DRILLABLE set is larger.
_BREADTH_SETS = [
    ("up_4pct_today", "Up 4%+ Today"), ("down_4pct_today", "Down 4%+ Today"),
    ("up_from_open", "Up From Open"), ("down_from_open", "Down From Open"),
    ("up_on_volume", "Up On Volume"), ("down_on_volume", "Down On Volume"),
    ("new_52w_highs", "New 52w Highs"), ("new_52w_lows", "New 52w Lows"),
    ("up_25pct_quarter", "Up 25% / Qtr"), ("up_50pct_month", "Up 50% / Mo"),
    ("stage2_count", "Stage 2 (MA stack)"), ("stage4_count", "Stage 4 (MA stack)"),
]
_BREADTH_LABEL = dict(_BREADTH_SETS)

_INDEX_SETS = [
    ("sp500", "S&P 500", "index_sp500"),
    ("ndx", "Nasdaq 100", "index_ndx"),
    ("dow", "Dow 30", "index_dow"),
    ("r2k", "Russell 2000", "index_r2k"),
]
_INDEX_COL = {k: col for k, _lbl, col in _INDEX_SETS}
_INDEX_LABEL = {k: lbl for k, lbl, _c in _INDEX_SETS}

# Curated equity ETFs offered as scatter universes (resolved via their holdings) —
# the same set the NH/NL scanner offers, minus the four already in "Indices" above.
# S&P 100 + the 11 sector SPDRs; no commodity/bond funds (nothing to plot).
_ETF_SETS = [
    ("OEF", "S&P 100"),
    ("XLV", "XLV"), ("XLE", "XLE"), ("XLF", "XLF"), ("XLK", "XLK"),
    ("XLI", "XLI"), ("XLU", "XLU"), ("XLB", "XLB"), ("XLY", "XLY"),
    ("XLP", "XLP"), ("XLC", "XLC"), ("XLRE", "XLRE"),
]
_ETF_LABEL = dict(_ETF_SETS)

_SCANNERS = [
    ("volume", "Volume Surge"), ("nhnl", "New Highs / Lows"),
    ("movers", "Movers"), ("catalysts", "Catalysts"), ("candidates", "Scanner Candidates"),
]
_SCANNER_LABEL = dict(_SCANNERS)

_MAX_TICKERS = 2500   # a scatter past this is a blob; cap the universe size


def _index_members(flag_col: str) -> list:
    """Index constituents from the screener snapshot's membership flags (no network)."""
    from api.services.screener import snapshot_db
    try:
        with snapshot_db.connect() as conn:
            rows = conn.execute(
                f"SELECT ticker FROM screener_rows WHERE {flag_col} = 1"
            ).fetchall()
        return [r[0] for r in rows]
    except Exception:
        return []


def _cap_universe() -> list:
    try:
        from api.routers import ticker_search
        return list(getattr(ticker_search, "_UNIVERSE", []) or [])
    except Exception:
        pass
    try:
        import json
        import os
        p = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
        with open(p) as f:
            data = json.load(f)
        return data if isinstance(data, list) else list(data.get("tickers", []))
    except Exception:
        return []


def _syms_from(items, *keys) -> list:
    """Pull tickers out of a list of dicts, trying each candidate key in order."""
    out = []
    for it in items or []:
        if isinstance(it, str):
            out.append(it)
            continue
        for k in keys:
            v = it.get(k) if isinstance(it, dict) else None
            if v:
                out.append(v)
                break
    return out


def resolve_universe(source: str, value: Optional[str], user_id: Optional[str]) -> list:
    """A universe descriptor → a de-duplicated ticker list (app tickers, uppercased).

    Every branch is defensive: a source that is cold / unavailable returns [] rather
    than raising, so one dead feed never breaks the widget."""
    src = (source or "market").lower()
    tickers: list = []
    try:
        if src == "market":
            tickers = _cap_universe()
        elif src == "index":
            col = _INDEX_COL.get((value or "").lower())
            tickers = _index_members(col) if col else []
        elif src == "watchlist" and value and user_id:
            from api.services import watchlist_service
            wl = watchlist_service.get_watchlist(value, user_id)
            tickers = _syms_from((wl or {}).get("items"), "sym", "ticker")
        elif src == "flagged" and user_id:
            from api.services import watchlist_service
            fl = watchlist_service.get_or_create_flagged_list(user_id)
            tickers = _syms_from((fl or {}).get("items"), "sym", "ticker")
        elif src == "tag" and value and user_id:
            from api.services import ticker_tag_service
            tags = ticker_tag_service.get_user_tags(user_id)   # {sym: color}
            tickers = [s for s, c in tags.items() if c == value]
        elif src == "uct20":
            from api.services import engine
            tickers = _syms_from(engine.get_leadership(), "sym", "ticker", "symbol")
        elif src == "etf" and value:
            from api.services import etf_holdings
            tickers = _syms_from(etf_holdings.get_holdings(value.upper()), "sym", "ticker")
        elif src == "industry" and value:
            from api.services import industry_map
            tickers = industry_map.tickers_in_industry(value)
        elif src == "theme" and value:
            from api.services import theme_db
            tickers = _syms_from(theme_db.get_theme_holdings(value), "sym", "ticker")
        elif src == "breadth" and value:
            from api.services import breadth_live
            res = breadth_live.live_drill(value)
            tickers = _syms_from((res or {}).get("items"), "t", "sym", "ticker")
        elif src == "scanner":
            tickers = _scanner_syms((value or "").lower())
    except Exception:
        tickers = []

    seen, out = set(), []
    for t in tickers:
        u = str(t).strip().upper()
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out[:_MAX_TICKERS]


def _scanner_syms(which: str) -> list:
    if which == "volume":
        from api.services import volume_live
        return _syms_from(volume_live.get_live().get("rows"), "sym")
    if which == "nhnl":
        from api.services import nhnl_live
        live = nhnl_live.get_live()
        return _syms_from(live.get("highs"), "sym") + _syms_from(live.get("lows"), "sym")
    if which == "movers":
        from api.services import massive
        mv = massive.get_movers() or {}
        return _syms_from(mv.get("ripping"), "sym") + _syms_from(mv.get("drilling"), "sym")
    if which == "catalysts":
        from api.services.catalyst import store as cat_store
        from datetime import datetime
        try:
            from zoneinfo import ZoneInfo
            md = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
        except Exception:
            md = datetime.utcnow().date().isoformat()
        return _syms_from(cat_store.get_for_date(md, ranked_only=True), "ticker", "sym")
    if which == "candidates":
        from api.services import engine
        cand = engine.get_candidates() or {}
        out = []
        for key in ("pullback", "remount", "gappers", "candidates"):
            out += _syms_from(cand.get(key), "sym", "ticker")
        return out
    return []


def list_universes(user_id: Optional[str]) -> list:
    """The grouped universe menu for the picker. Dynamic groups (watchlists, tags,
    themes) are filled from the user's account; static groups are always present."""
    groups = [{
        "group": "Indices",
        "items": [{"source": "index", "value": k, "label": lbl} for k, lbl, _c in _INDEX_SETS],
    }]
    groups.append({
        "group": "ETFs",
        "items": [{"source": "etf", "value": t, "label": lbl} for t, lbl in _ETF_SETS],
    })

    mine = [{"source": "flagged", "value": "", "label": "Flagged"},
            {"source": "uct20", "value": "", "label": "UCT 20"}]
    if user_id:
        try:
            from api.services import watchlist_service
            for wl in watchlist_service.list_user_watchlists(user_id):
                mine.append({"source": "watchlist", "value": wl.get("id"),
                             "label": wl.get("name") or "Watchlist"})
        except Exception:
            pass
        try:
            from api.services import ticker_tag_service
            colors = sorted({c for c in ticker_tag_service.get_user_tags(user_id).values()})
            for c in colors:
                mine.append({"source": "tag", "value": c, "label": f"{c.title()} tag"})
        except Exception:
            pass
    groups.append({"group": "My Lists", "items": mine})

    groups.append({
        "group": "Scanners",
        "items": [{"source": "scanner", "value": k, "label": lbl} for k, lbl in _SCANNERS],
    })
    groups.append({
        "group": "Breadth",
        "items": [{"source": "breadth", "value": k, "label": lbl} for k, lbl in _BREADTH_SETS],
    })

    themes = []
    try:
        from api.services import theme_db
        for th in theme_db.get_all_themes() or []:
            tid = th.get("id") or th.get("theme_id")
            if tid:
                themes.append({"source": "theme", "value": str(tid),
                               "label": th.get("name") or th.get("title") or str(tid)})
    except Exception:
        pass
    if themes:
        groups.append({"group": "Themes", "items": themes})

    try:
        from api.services import industry_map
        inds = industry_map.list_industries()
        if inds:
            groups.append({"group": "Industries",
                           "items": [{"source": "industry", "value": n, "label": n} for n in inds]})
    except Exception:
        pass

    groups.append({"group": "Market", "items": [
        {"source": "market", "value": "", "label": "Whole Market"}]})
    return groups


def label_for(source: str, value: Optional[str], user_id: Optional[str]) -> str:
    """A human label for a universe descriptor (for the picker button + header)."""
    src = (source or "market").lower()
    if src == "market":
        return "Whole Market"
    if src == "index":
        return _INDEX_LABEL.get((value or "").lower(), "Index")
    if src == "etf":
        return _ETF_LABEL.get((value or "").upper(), (value or "ETF").upper())
    if src == "industry":
        return value or "Industry"
    if src == "flagged":
        return "Flagged"
    if src == "uct20":
        return "UCT 20"
    if src == "tag":
        return f"{(value or '').title()} tag"
    if src == "scanner":
        return _SCANNER_LABEL.get((value or "").lower(), "Scanner")
    if src == "breadth":
        return _BREADTH_LABEL.get(value or "", "Breadth")
    if src == "watchlist" and value and user_id:
        try:
            from api.services import watchlist_service
            wl = watchlist_service.get_watchlist(value, user_id)
            if wl:
                return wl.get("name") or "Watchlist"
        except Exception:
            pass
        return "Watchlist"
    if src == "theme" and value:
        try:
            from api.services import theme_db
            for th in theme_db.get_all_themes() or []:
                if str(th.get("id") or th.get("theme_id")) == str(value):
                    return th.get("name") or "Theme"
        except Exception:
            pass
        return "Theme"
    return "Universe"
