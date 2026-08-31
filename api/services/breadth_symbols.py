"""UCT Breadth Symbols — chartable pseudo-tickers for our breadth indicators.

TradingView has MMTW / S5FD, TC2000 has T2108 / T2107. This gives OUR breadth
indicators the same treatment: type ``UCTA50`` in any chart search and get a
candlestick chart of "% of the universe above the 50-day MA" straight from the
daily breadth history in ``breadth_monitor``.

One value is stored per metric per day (the 4:30pm EOD snapshot), so a true
intraday OHLC candle is not available historically. We render **close-to-close**
candles instead: each day's body spans yesterday's value → today's value (green
when breadth rose, red when it fell), which reads as a real candlestick and is
honest about the data we have. Real intraday wicks accumulate going forward as
``breadth_intraday`` captures them (fast-follow).

The registry here is the SINGLE SOURCE OF TRUTH consumed by:
  - ``api/routers/bars.py``          → serves the candles (interception branch)
  - ``api/routers/ticker_search.py`` → makes the symbols searchable
  - ``api/routers/breadth_monitor``  → ``/api/breadth-symbols`` for the frontend
  - ``watchlist_prebuilt``           → the "UCT Breadth" prebuilt-list section
"""
from __future__ import annotations

import logging
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date as _date, datetime, timedelta
from typing import Optional

_log = logging.getLogger("breadth_symbols")

# ── Registry ────────────────────────────────────────────────────────────────
# symbol → (metric_key, display name, group). `group` drives both the search
# grouping and the prebuilt-watchlist lists. Order within a group is the display
# order. Keep symbols UNIQUE and collision-free with real tickers (they are all
# distinctly UCT-prefixed AND longer/shaped unlike real UCT* tickers e.g. UCTT).

# Group ids (also the prebuilt-list names, prettified in LIST_META below).
G_MA = "ma"
G_MOM = "momentum"
G_HL = "highs_lows"
G_REG = "score_regime"

# (symbol, metric_key, name, group)
_ROWS = [
    # ── MA Breadth ──────────────────────────────────────────────────────────
    ("UCTA5",   "pct_above_5sma",   "% of Stocks Above 5-Day MA",   G_MA),
    ("UCTA10",  "pct_above_10sma",  "% of Stocks Above 10-Day MA",  G_MA),
    ("UCTA20",  "pct_above_20ema",  "% of Stocks Above 20-Day EMA", G_MA),
    ("UCTA40",  "pct_above_40sma",  "% of Stocks Above 40-Day MA",  G_MA),
    ("UCTA50",  "pct_above_50sma",  "% of Stocks Above 50-Day MA",  G_MA),
    ("UCTA100", "pct_above_100sma", "% of Stocks Above 100-Day MA", G_MA),
    ("UCTA200", "pct_above_200sma", "% of Stocks Above 200-Day MA", G_MA),

    # ── Momentum / Primary Breadth ──────────────────────────────────────────
    ("UCTU4",   "up_4pct_today",    "Stocks Up 4%+ Today",          G_MOM),
    ("UCTD4",   "down_4pct_today",  "Stocks Down 4%+ Today",        G_MOM),
    ("UCTU20W", "up_20pct_5d",      "Stocks Up 20%+ in 5 Days",     G_MOM),
    ("UCTD20W", "down_20pct_5d",    "Stocks Down 20%+ in 5 Days",   G_MOM),
    ("UCTU25M", "up_25pct_month",   "Stocks Up 25%+ in a Month",    G_MOM),
    ("UCTD25M", "down_25pct_month", "Stocks Down 25%+ in a Month",  G_MOM),
    ("UCTU50M", "up_50pct_month",   "Stocks Up 50%+ in a Month",    G_MOM),
    ("UCTD50M", "down_50pct_month", "Stocks Down 50%+ in a Month",  G_MOM),
    ("UCTU25Q", "up_25pct_quarter", "Stocks Up 25%+ in a Quarter",  G_MOM),
    ("UCTD25Q", "down_25pct_quarter","Stocks Down 25%+ in a Quarter",G_MOM),
    ("UCTMU",   "magna_up",         "Momentum Up (13% in 34 Days)", G_MOM),
    ("UCTMD",   "magna_down",       "Momentum Down (13% in 34 Days)",G_MOM),
    ("UCTR5",   "ratio_5day",       "5-Day Up/Down Ratio",          G_MOM),
    ("UCTR10",  "ratio_10day",      "10-Day Up/Down Ratio",         G_MOM),
    ("UCTUV",   "up_vol_ratio",     "Up/Down Volume Ratio",         G_MOM),

    # ── Highs / Lows ────────────────────────────────────────────────────────
    ("UCTNH",   "new_52w_highs",    "New 52-Week Highs",            G_HL),
    ("UCTNL",   "new_52w_lows",     "New 52-Week Lows",             G_HL),
    ("UCTNH20", "new_20d_highs",    "New 20-Day Highs",             G_HL),
    ("UCTNL20", "new_20d_lows",     "New 20-Day Lows",              G_HL),
    ("UCTATH",  "new_ath",          "New All-Time Highs",           G_HL),
    ("UCTPH",   "hi_ratio",         "% of Stocks at 52-Week Highs", G_HL),
    ("UCTPL",   "lo_ratio",         "% of Stocks at 52-Week Lows",  G_HL),
    ("UCTNRH",  "near_52w_high",    "Stocks Within 5% of 52W High", G_HL),
    ("UCTHVC",  "hvc_52w",          "High-Volume Closes (52W Vol Hi)", G_HL),
    ("UCTXR",   "atr_ext_7",        "Stocks >7x ATR Extended (50MA)", G_HL),

    # ── Score / Regime ──────────────────────────────────────────────────────
    ("UCTHS",   "breadth_score",    "UCT Breadth Health Score",     G_REG),
    ("UCTX",    "uct_exposure",     "UCT Exposure Rating",          G_REG),
    ("UCTMC",   "mcclellan_osc",    "McClellan Oscillator",         G_REG),
    ("UCTAD",   "adv_decline_cum",  "Advance/Decline Line",         G_REG),
    ("UCTNA",   "adv_decline",      "Net Advancers (Daily)",        G_REG),
    ("UCTS2",   "stage2_count",     "Stage 2 Uptrend Count",        G_REG),
    ("UCTS4",   "stage4_count",     "Stage 4 Downtrend Count",      G_REG),
    ("UCTEW",   "rsp_spy_ratio",    "Equal-Weight vs Cap-Weight (RSP/SPY)", G_REG),
    ("UCTSC",   "iwm_qqq_ratio",    "Small-Cap vs Nasdaq (IWM/QQQ)", G_REG),
    ("UCTFG",   "cnn_fear_greed",   "CNN Fear & Greed Index",       G_REG),
    ("UCTPC",   "cboe_putcall",     "CBOE Put/Call Ratio",          G_REG),
    ("UCTAAII", "aaii_spread",      "AAII Bull-Bear Spread",        G_REG),
]

# group id → pretty label for the search header + prebuilt-list name.
LIST_META = {
    G_MA:  {"label": "MA Breadth",   "list_name": "MA Breadth"},
    G_MOM: {"label": "Momentum",     "list_name": "Momentum Breadth"},
    G_HL:  {"label": "Highs / Lows", "list_name": "Highs & Lows"},
    G_REG: {"label": "Score / Regime","list_name": "Score & Regime"},
}
GROUP_ORDER = [G_MA, G_MOM, G_HL, G_REG]

# Fast lookups (all symbols stored UPPER-case).
SYMBOLS = {sym.upper(): {"symbol": sym.upper(), "metric": metric, "name": name, "group": group}
           for (sym, metric, name, group) in _ROWS}
_METRIC_OF = {sym: rec["metric"] for sym, rec in SYMBOLS.items()}


def is_breadth_symbol(sym: str) -> bool:
    """True when `sym` is one of our chartable breadth pseudo-tickers.

    Membership test (NOT a bare 'UCT' prefix) so a real ticker like UCTT never
    collides.
    """
    return bool(sym) and sym.strip().upper() in SYMBOLS


def list_breadth_symbols() -> list[dict]:
    """All symbols in display order, each with symbol/metric/name/group/group_label.
    Consumed by the search injection, the /api/breadth-symbols endpoint, and the
    prebuilt-watchlist seed."""
    out = []
    for group in GROUP_ORDER:
        for rec in SYMBOLS.values():
            if rec["group"] == group:
                out.append({**rec, "group_label": LIST_META[group]["label"]})
    return out


def search(qq: str, limit: int = 20) -> list[dict]:
    """Ranked breadth-symbol matches for a search query: exact symbol → symbol
    prefix → name substring. Also matches the numeric core (e.g. "50" → UCTA50)
    and label words ("highs", "breadth"). Returns rows shaped for ticker-search:
    {ticker, name, breadth:True, group_label}. `symbol_hit` flags a symbol-level
    match so the router can rank those ahead of live-ticker results."""
    qq = (qq or "").strip().upper()
    if not qq:
        return []
    exact, prefix, namesub = [], [], []
    for rec in list_breadth_symbols():
        sym, name = rec["symbol"], rec["name"]
        if sym == qq:
            exact.append((rec, True))
        elif sym.startswith(qq):
            prefix.append((rec, True))
        elif qq in sym or qq in name.upper():
            namesub.append((rec, False))
    out = []
    for rec, symbol_hit in (exact + prefix + namesub)[:limit]:
        out.append({
            "ticker": rec["symbol"],
            "name": rec["name"],
            "breadth": True,
            "group_label": rec["group_label"],
            "symbol_hit": symbol_hit,
        })
    return out


def symbols_by_group() -> dict[str, list[str]]:
    """group id → [symbols] in display order (drives the prebuilt lists)."""
    out = {g: [] for g in GROUP_ORDER}
    for rec in SYMBOLS.values():
        out[rec["group"]].append(rec["symbol"])
    return out


# ── Candle builder ──────────────────────────────────────────────────────────

def _friday_of_week(d: _date) -> _date:
    """The Friday of `d`'s ISO week (Mon-anchored) — matches the chart's weekly
    bar keying (weekly bars are dated to the week's Friday close)."""
    return d + timedelta(days=(4 - d.weekday()))


def _resample(daily_candles: list[dict], tf: str) -> list[dict]:
    """Roll close-to-close DAILY candles up to weekly / monthly OHLC.

    daily_candles: oldest-first [{t:'YYYY-MM-DD', o,h,l,c,v}]. For 'W' the bucket
    key is the week's Friday; for 'M' it is the month's first. O = first day's open,
    C = last day's close, H/L = extremes over the bucket."""
    if tf == "D" or not daily_candles:
        return daily_candles
    buckets: dict[str, dict] = {}
    order: list[str] = []
    for c in daily_candles:
        try:
            d = datetime.strptime(c["t"], "%Y-%m-%d").date()
        except (ValueError, KeyError):
            continue
        key = _friday_of_week(d).isoformat() if tf == "W" else f"{d.year:04d}-{d.month:02d}-01"
        b = buckets.get(key)
        if b is None:
            buckets[key] = {"t": key, "o": c["o"], "h": c["h"], "l": c["l"], "c": c["c"], "v": 0}
            order.append(key)
        else:
            b["h"] = max(b["h"], c["h"])
            b["l"] = min(b["l"], c["l"])
            b["c"] = c["c"]
    return [buckets[k] for k in order]


def _et_today() -> Optional[str]:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:
        return None


def _live_map() -> dict:
    """The current LIVE breadth snapshot as a FLAT {metric_key: value} dict, or {} when
    live breadth is disabled/unavailable/not-yet-meaningful. `compute_live()` returns a
    WRAPPER — the flat metric set lives under `payload["metrics"]` — so pull that out.
    Cached by compute_live itself, so calling it per request is cheap.

    Gated on `breadth_live._session_started()` (today past 09:30 ET) AND on the read being
    `anchored` and not `degraded` — the SAME trustworthiness gate the intraday store-writer
    uses (breadth_monitor router, ~L301). Two reasons a live read is untrustworthy:
      • Pre-open: most of the universe hasn't traded, so it falls back to yesterday's closes
        ("true, and useless" per the breadth_live docstring).
      • Un-anchored (early session, before the anchor basis builds): the raw value carries the
        split-vs-dividend basis offset on the ratio metrics and partial/degraded counts. That
        painted the bogus early-session developing candle (200MA +6 while 40/50 −6; new-lows
        showing a partial 19 vs ~256). The anchored store row is the authoritative today
        candle; this fallback must match its gate or it leaks raw values before the store row
        lands."""
    try:
        from api.services import breadth_live
        if breadth_live.enabled() and breadth_live._session_started():
            # CACHE-ONLY: a chart serve must never trigger compute_live's ~12-16s
            # full-universe snapshot recompute. Read the warm cache (kept fresh by the
            # dashboard live-breadth poll) or omit today's live tick. This is the fix
            # for breadth pseudo-tickers cold-building 12-16s on every request — the
            # recompute was baked into the (cached) series build, defeating the cache.
            payload = breadth_live.compute_live(cached_only=True) or {}
            if not payload.get("anchored") or payload.get("degraded"):
                return {}
            m = payload.get("metrics")
            return m if isinstance(m, dict) else {}
    except Exception:
        pass
    return {}


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def latest_quotes(syms: list[str]) -> dict:
    """{symbol: {price, change, change_pct, volume, breadth}} for the breadth symbols
    in `syms` — the "quote" the watchlist columns show. Uses the LIVE intraday value
    where breadth_live tracks that metric (today, vs yesterday's close); otherwise the
    latest EOD value with its day-over-day change (mirrors the chart's last candle)."""
    wanted = [s.strip().upper() for s in (syms or []) if is_breadth_symbol(s)]
    if not wanted:
        return {}
    from api.services import breadth_monitor
    try:
        hist = breadth_monitor.get_history(4)  # newest-first
    except Exception:
        hist = []
    live_map = _live_map()
    today = _et_today()

    out = {}
    for s in wanted:
        metric = _METRIC_OF[s]
        dvals = []  # (date, value) newest-first, finite only
        for row in hist:
            d, fv = row.get("date"), _finite(row.get(metric))
            if fv is not None:
                dvals.append((d, fv))
        if not dvals:
            continue
        lv = _finite(live_map.get(metric))
        if lv is not None:
            # live value = today; compare against the newest stored day that ISN'T today
            price = lv
            prev = next((v for (d, v) in dvals if today is None or d != today), dvals[0][1])
        else:
            # no live value — mirror the last completed daily candle + its day change
            price = dvals[0][1]
            prev = dvals[1][1] if len(dvals) > 1 else dvals[0][1]
        change = price - prev
        change_pct = (change / prev * 100.0) if prev else 0.0
        out[s] = {
            "price": round(price, 2),
            "change": round(change, 2),
            "change_pct": round(change_pct, 2),
            "volume": 0,
            "breadth": True,
        }
    return out


# ── Serve-time cache (instant-charts) ────────────────────────────────────────
# The SEALED daily history (one EOD value per day back to ~2008) and the DEVELOPING
# today candle are DECOUPLED, because they change on completely different clocks:
#   • Sealed history changes once a day (the 4:30pm EOD push). It is expensive to
#     rebuild (get_history + the reconstructed-OHLC merge), so it is cached per SYMBOL
#     for hours. The warm loop rebuilds a symbol only when a NEW sealed day has landed,
#     so after one boot pass it goes quiet — it does NOT perpetually rebuild.
#   • The today candle is cheap and must stay live, so it is appended at SERVE time from
#     a CACHE-ONLY live read (never triggers compute_live's ~12-16s universe recompute).
# The earlier design baked the live value INTO the cached series, which forced a 60s TTL
# (to keep the candle fresh) — but a full warm pass takes minutes, so entries expired
# mid-pass and the loop rebuilt all ~40 symbols forever, a CPU-bound churn that starved
# the single pod. Decoupling fixes both: long-lived sealed cache + always-live candle.
_SEALED_TTL = 21600      # 6h; sealed history changes only at EOD — the warm loop's
                         # new-day check refreshes it promptly, this is just the ceiling.
_WARM_GAP = 0.4          # seconds slept between warm builds so a cold pass never bursts
_bg_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="breadth-bars-refresh")
_bg_inflight: set[str] = set()
_bg_lock = threading.Lock()


def _build_breadth_series(sym: str, metric: str) -> list[dict]:
    """Compute the SEALED close-to-close DAILY candle series for `metric` — the expensive
    part (DB reads + reconstructed-OHLC merge). No live value, no resample, no slice: the
    serve fn appends the developing today candle, resamples to the requested tf, and
    slices. Keeping the live value OUT is what lets this be cached for hours (the warm
    loop then converges instead of rebuilding every minute)."""
    from api.services import breadth_monitor
    want_daily = 6000   # full history (breadth starts ~2008; 6000 daily covers it)
    try:
        history = breadth_monitor.get_history(want_daily)  # newest-first
    except Exception:
        history = []

    # Per-day OHLC store (trusted sources: 'live' intraday wicks + 'close_recon' deep
    # reconstructed history). This is where the DEEP history lives — recomputed close-basis
    # bodies back years — so it drives the date series alongside the collector.
    ohlc_map = {}
    try:
        from api.services import breadth_daily_ohlc
        ohlc_map = breadth_daily_ohlc.history(metric)
    except Exception:
        ohlc_map = {}

    # Merged close-per-day: the reconstructed/live store PLUS the collector's snapshots, with
    # the COLLECTOR winning on any shared date (its EOD value is authoritative for days it
    # covers; the store supplies everything before the collector started + any wick highs/lows).
    closes_by_date: dict = {}
    for d, row in ohlc_map.items():
        cv = _finite(row.get("c"))
        if cv is not None:
            closes_by_date[d] = cv
    for row in history:
        d = row.get("date")
        cv = _finite(row.get(metric))
        if d and cv is not None:
            closes_by_date[d] = cv

    seq: list[tuple[str, float]] = sorted(closes_by_date.items())  # oldest-first

    daily: list[dict] = []
    prev: Optional[float] = None
    for (d, v) in seq:
        row = ohlc_map.get(d)
        ro = _finite((row or {}).get("o")) if row else None
        rh = _finite((row or {}).get("h")) if row else None
        rl = _finite((row or {}).get("l")) if row else None
        if row and None not in (ro, rh, rl):
            o, c = ro, v
            h = max(rh, o, c)
            l = min(rl, o, c)
        else:
            o, c = (prev if prev is not None else v), v   # close-to-close body
            h, l = max(o, c), min(o, c)
        daily.append({"t": d, "o": round(o, 4), "h": round(h, 4),
                      "l": round(l, 4), "c": round(c, 4), "v": 0})
        prev = v

    return daily   # SEALED days only; today's developing candle is a serve-time append


def _append_today_candle(daily: list[dict], metric: str) -> list[dict]:
    """Return `daily` with a developing today candle appended, or unchanged. CHEAP +
    serve-time: reads the CACHE-ONLY live value (never triggers compute_live's universe
    recompute — see _live_map) so the candle stays live (≤ the live-cache TTL, kept warm
    by the per-minute breadth-live sampler) without the sealed series ever recomputing.

    Close-to-close body: open = the prior session's close, close = the live value. This is
    intentionally simpler than the old baked-in candle (which also merged the store's
    intraday high/low wick) — breadth history is close-to-close by nature, and the wick
    would have been build-time-stale under the long sealed-cache TTL anyway. Never mutates
    the cached list (returns a new one)."""
    today = _et_today()
    if not (today and daily and daily[-1]["t"] < today):
        return daily
    live_val = _finite(_live_map().get(metric))
    if live_val is None:
        return daily
    o = daily[-1]["c"]
    c = live_val
    h, l = max(o, c), min(o, c)
    return daily + [{"t": today, "o": round(o, 4), "h": round(h, 4),
                     "l": round(l, 4), "c": round(c, 4), "v": 0}]


def _refresh_series(sym: str, metric: str) -> list[dict]:
    """Recompute + cache the SEALED daily series for `sym`. Returns it ([] on failure).
    One daily build serves D/W/M (the serve fn resamples), so this is keyed per symbol."""
    from api.services.cache import cache
    try:
        series = _build_breadth_series(sym, metric)
    except Exception as e:
        _log.warning("[breadth_symbols] series build failed %s: %s", sym, e)
        return []
    cache.set(f"breadthdaily_{sym}", {"saved_at": time.time(), "series": series},
              ttl=_SEALED_TTL)
    return series


def _kick_series_refresh(sym: str, metric: str) -> None:
    key = sym
    with _bg_lock:
        if key in _bg_inflight or len(_bg_inflight) >= 8:
            return
        _bg_inflight.add(key)

    def _job():
        try:
            _refresh_series(sym, metric)
        finally:
            with _bg_lock:
                _bg_inflight.discard(key)
    try:
        _bg_pool.submit(_job)
    except Exception:
        with _bg_lock:
            _bg_inflight.discard(key)


def build_breadth_bars(sym: str, tf: str = "D", bars: int = 400) -> dict:
    """Serve close-to-close OHLC candles for a breadth pseudo-ticker — CACHE-FIRST.

    Returns {ticker, tf, bars:[{t,o,h,l,c,v}]} with `t` a 'YYYY-MM-DD' string. The SEALED
    daily history is cached per symbol (hours); a warm request appends the live today
    candle + resamples to `tf` (a few ms) instead of rebuilding. Stale cache is served
    immediately + a background refresh is kicked, so a request never rebuilds inline when
    a cached series exists.
    """
    sym = (sym or "").strip().upper()
    tf = (tf or "D").upper()
    if tf not in ("D", "W", "M"):
        tf = "D"  # breadth is daily-basis; intraday requests collapse to daily
    metric = _METRIC_OF.get(sym)
    if not metric:
        return {"ticker": sym, "tf": tf, "bars": []}

    from api.services.cache import cache
    now = time.time()
    hit = cache.get(f"breadthdaily_{sym}")
    tier = "breadth-build"
    if hit and hit.get("series") is not None:
        daily = hit["series"]
        if now - hit.get("saved_at", 0) <= _SEALED_TTL:
            tier = "breadth-cache"
        else:
            _kick_series_refresh(sym, metric)   # stale → serve + revalidate
            tier = "breadth-cache-stale"
    else:
        daily = _refresh_series(sym, metric)    # cold miss — the one slow request

    # Serve-time: append the live developing candle (cheap, cache-only) then resample.
    series = _resample(_append_today_candle(daily or [], metric), tf)

    try:
        from api.services.bars_fetch import _mark_serve
        _mark_serve(tier)
    except Exception:
        pass

    out = series or []
    if bars and len(out) > bars:
        out = out[-bars:]
    return {"ticker": sym, "tf": tf, "bars": out}


# ── Web-side warm loop (keeps the ~40 breadth series hot in the cache) ────────
def warm_breadth() -> dict:
    """Warm each breadth symbol's SEALED daily series so the first request after a deploy
    is a cache hit. CONVERGES: a symbol is rebuilt only when its cache is missing/expired
    OR a NEW sealed day has landed (the 4:30pm EOD push), so after one boot pass this goes
    quiet instead of perpetually rebuilding. Builds are throttled (`_WARM_GAP`) so a cold
    pass never bursts and starves the pod's bars path."""
    from api.services import breadth_monitor
    from api.services.cache import cache
    # Latest sealed date, shared across all metrics (get_history is cached). When a new EOD
    # day lands this advances, so even a still-fresh cache is rebuilt to include it.
    latest = None
    try:
        h = breadth_monitor.get_history(1)  # newest-first
        latest = h[0].get("date") if h else None
    except Exception:
        latest = None

    stats = {"refreshed": 0, "fresh": 0}
    now = time.time()
    for sym, metric in _METRIC_OF.items():
        hit = cache.get(f"breadthdaily_{sym}")
        fresh = bool(hit and hit.get("series") is not None
                     and now - hit.get("saved_at", 0) <= _SEALED_TTL)
        up_to_date = True
        if fresh and latest:
            ser = hit["series"]
            # A non-empty series is stale only if it lacks the latest sealed day. An empty
            # series stays empty on rebuild, so treat it as up-to-date — never churn it.
            up_to_date = (not ser) or ser[-1].get("t", "") >= latest
        if fresh and up_to_date:
            stats["fresh"] += 1
            continue
        _refresh_series(sym, metric)
        stats["refreshed"] += 1
        time.sleep(_WARM_GAP)   # yield between cold builds — gentle on the single pod
    _log.info("[breadth_symbols] warm pass done: %s", stats)
    return stats


def start_breadth_warm(interval_seconds: int = 90) -> None:
    """Boot warm + periodic refresh on a daemon thread. ~40 symbols, one sealed daily build
    each, throttled by `_WARM_GAP` and skipped once fresh + up-to-date — so the loop
    converges after the boot pass and only rebuilds when the 4:30pm EOD push lands a new
    day. (Was ~40×3 TFs rebuilt every cycle, which never converged.)"""
    def _loop():
        time.sleep(20)   # let boot settle
        while True:
            try:
                warm_breadth()
            except Exception:
                _log.exception("[breadth_symbols] warm loop error")
            time.sleep(interval_seconds)
    threading.Thread(target=_loop, name="breadth-bars-warm", daemon=True).start()
