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

from api.services.breadth_universes import DEFAULT_UNIVERSE

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


# ─── BL-008: THE REGISTRY DECIDES MEMBERSHIP. SYNTAX NEVER DOES. ─────────────
#
# ⭐⭐ THE ONE RULE THIS SECTION EXISTS TO ENFORCE: `NASDAQ:A50` is a Breadth
# Library symbol because the registry CONTAINS that identity, not because it has a
# colon in it. `NASDAQ:AAPL` has the identical shape and is not one — it is a venue
# prefix on a third-party instrument, and nothing here may promote it.
#
# ⛔⛔ SO NOTHING IN THIS MODULE SPLITS A STRING ON ":" TO DECIDE WHAT IT MEANS.
# The resolver is a dict lookup against identities minted from
# `breadth_universes` × `breadth_metrics`. That is why the reverted TICKER_SHAPE
# widening was the wrong fix and must not come back: a SHAPE test cannot tell those
# two strings apart, and a registry does it without trying.
#
# ⚠️ SOURCE GRAMMAR AND SYMBOL VALIDITY ARE DIFFERENT LAYERS. `sourceRef.js` can
# structurally carry `sym:NASDAQ:A50:close` — that is parsing, and it is correct
# for it to be shape-based. Whether `NASDAQ:A50` EXISTS is this layer's answer.
# Conflating them is how `FOO:BAR` becomes chartable.

_LIBRARY_INDEX: Optional[dict] = None


def _library_index() -> dict:
    """`{SYMBOL: row}` over every registered identity, aliases included.

    ⚠️ MEMOISED, AND IT HAS TO BE. `is_breadth_symbol` sits on the `/api/bars` hot
    path and is asked about EVERY ticker, so an ordinary `AAPL` fell through the
    `SYMBOLS` fast path into this function. Rebuilding the 156-row projection there
    measured **404 µs per call** against 0.09 µs for a UCT symbol — a ~4,500x
    regression paid on every chart request in the product, to answer "no".

    ⛔ AND A MODULE-LEVEL CACHE IS CORRECT HERE rather than a shortcut, because the
    projection is PURE: it reads `_ROWS`, `breadth_universes.UNIVERSES` and
    `breadth_metrics.METRICS`, all of which are module constants fixed at import.
    Nothing mutates them at runtime. If that ever stops being true — a catalogue
    loaded from disk, a universe added by configuration — this must gain an explicit
    invalidation, and `_LIBRARY_INDEX = None` is the whole of it.

    ⚠️ The PUBLISHED gate is deliberately NOT baked in: it reads an env var that a
    test flips per-case, so it is applied by `resolve()` on every lookup against
    this immutable index.
    """
    global _LIBRARY_INDEX
    if _LIBRARY_INDEX is not None:
        return _LIBRARY_INDEX
    idx = {}
    for row in library_rows():
        sym = row.get("symbol")
        if sym:
            idx[sym.upper()] = row
    # Explicit aliases, from a TABLE. `UCT:A50` is a legal spelling of `UCTA50`
    # because this says so, not because a rule rewrites prefixes.
    for alias, target in library_aliases().items():
        row = idx.get(target.upper())
        if row:
            idx[alias.upper()] = {**row, "symbol": target.upper(), "matched_alias": alias.upper()}
    _LIBRARY_INDEX = idx
    return idx


def library_aliases() -> dict:
    """`{alias: canonical symbol}` — EXPLICIT, never inferred.

    ⭐ The namespaced spelling of a UCT metric (`UCT:A50`) resolves to the symbol
    that has always named it (`UCTA50`). It is an alias in exactly one direction:
    `UCTA50` stays canonical, nothing is renamed, and no stored layout, watchlist,
    drawing or formula has to change. The brief's rule — "aliases must also be
    explicit registry mappings" — is satisfied by this being a derived TABLE rather
    than a prefix rewrite applied at lookup time.
    """
    from api.services import breadth_metrics as _bm
    from api.services import breadth_universes as _bu
    out = {}
    for metric, legacy in LEGACY_SYMBOL_BY_METRIC.items():
        m = _bm.get(metric)
        if m:
            out[f"{_bu.label(_bu.DEFAULT_UNIVERSE)}:{m['code']}"] = legacy
    return out


def resolve(sym: str, published_only: bool = True) -> Optional[dict]:
    """The registry row for `sym`, or None. THE membership authority.

    `published_only` (the default) restricts the answer to universes
    `breadth_universes.published_universe_ids()` allows — UCT alone unless the
    `BREADTH_LIBRARY_UNIVERSES` flag says otherwise. Discovery and tests pass
    False to see the whole catalogue.

    ⛔ An unregistered colon-bearing token — `NASDAQ:AAPL`, `FOO:BAR`, `US:NOPE` —
    returns None at every setting. There is no "looks close enough".
    """
    from api.services import breadth_universes as _bu
    if not sym:
        return None
    row = _library_index().get(str(sym).strip().upper())
    if row is None:
        return None
    if published_only and row["universe"] not in _bu.published_universe_ids():
        return None
    return row


#: metric key → the UCT symbol that has ALWAYS named it. ⭐⭐ THE ALIAS TABLE IS
#: DATA, DERIVED FROM `_ROWS`, AND IT IS THE ONLY THING THAT MAY ANSWER "what is
#: UCT's symbol for this metric". The rendered symbol is never PARSED to recover
#: `universe`/`metric` — those are carried — and a UCT symbol is never COMPUTED
#: from a rule, because no rule produces `UCTA50`, `UCTNH20` and `UCTAAII` from
#: their metric keys. An explicit mapping is what lets the new universes be
#: systematic without renaming a single shipped symbol.
LEGACY_SYMBOL_BY_METRIC = {metric: sym.upper() for (sym, metric, _n, _g) in _ROWS}


def is_breadth_symbol(sym: str) -> bool:
    """True when `sym` is a chartable breadth pseudo-ticker THIS DEPLOY SERVES.

    Membership test (NOT a bare 'UCT' prefix) so a real ticker like UCTT never
    collides — and now REGISTRY-backed rather than a fixed dict, so a namespaced
    identity is recognised when, and only when, the registry contains it AND its
    universe is published.

    ⭐ THE 44 SHIPPED UCT SYMBOLS ANSWER EXACTLY AS BEFORE. `SYMBOLS` is consulted
    first and unconditionally: UCT is always in the published set, so no flag, no
    catalogue edit and no registry failure can take a shipped symbol off the air.
    That ordering is the backward-compatibility guarantee, not a fast path.

    ⛔ AND SYNTAX GRANTS NOTHING. `NASDAQ:AAPL` and `FOO:BAR` are False at every
    setting of every flag, because `resolve()` is a dict lookup against minted
    identities and neither string is one. See the BL-008 block above.
    """
    if not sym:
        return False
    s = sym.strip().upper()
    if s in SYMBOLS:
        return True
    return resolve(s) is not None


def symbol_for(universe: str, metric: str) -> Optional[str]:
    """The canonical symbol for one (universe, metric), or None if there isn't one.

    ⭐ UCT READS ITS ANSWER OFF THE ALIAS TABLE; every other universe DERIVES one
    as `<LABEL>:<CODE>`. That asymmetry is the whole backward-compatibility story:
    the shipped symbols keep their historical spellings because they are RECORDED,
    not because a naming rule happens to reproduce them — and a metric UCT never
    published (`net_new_high_low`) correctly has no UCT symbol rather than a freshly
    invented one.
    """
    from api.services import breadth_metrics as _bm
    from api.services import breadth_universes as _bu
    uni = _bu.normalize(universe)
    if not _bm.applies_to(metric, uni):
        return None
    if uni == _bu.DEFAULT_UNIVERSE:
        return LEGACY_SYMBOL_BY_METRIC.get(metric)
    row = _bm.get(metric)
    return f"{_bu.label(uni)}:{row['code']}" if row else None


def library_rows(universes=None) -> list[dict]:
    """`UNIVERSES × METRICS` — the Breadth Library as a projection.

    ⛔⛔ NOT A SECOND CATALOGUE, AND NOT PUBLIC. Every field is read from the system
    that owns it — `breadth_universes` for the universe and its floor,
    `breadth_metrics` for the measurement, `LEGACY_SYMBOL_BY_METRIC` for UCT's
    historical spelling — on every call. Nothing here is stored, so adding a metric
    or a universe shows up without this function being edited, which is the test of
    whether a facade is a projection or a copy.

    ⚠️ NO PUBLIC SURFACE READS THIS YET. `/api/breadth-symbols`, `is_breadth_symbol`
    and the chart routing are untouched; this exists so the shape can be proven
    before anything is published.
    """
    from api.services import breadth_metrics as _bm
    from api.services import breadth_universes as _bu
    out = []
    for uni in (universes or _bu.UNIVERSE_IDS):
        u = _bu.get(uni)
        for metric in _bm.metrics_for(u["id"]):
            m = _bm.get(metric)
            out.append({
                "universe": u["id"], "universe_label": u["label"],
                "metric": metric, "code": m["code"],
                "symbol": symbol_for(u["id"], metric),
                "name": m["name"], "short_name": m["short_name"],
                "group": m["group"],
                # ⚠️ The family LABEL rides along because discovery groups by it and
                # `LIST_META` is where it already lives — a second spelling in the
                # metric catalogue would be the copy that drifts.
                "group_label": (LIST_META.get(m["group"]) or {}).get("label", m["group"]),
                "unit": m["unit"], "domain": m["domain"],
                "presentation": m["presentation"], "floor": u["floor"],
                # ⭐ A UCT row is LEGACY: its symbol is recorded history, not a
                # rendering of the namespace. Anything reading this list can tell
                # "already published under an old name" from "a name we would mint".
                "legacy": u["id"] == _bu.DEFAULT_UNIVERSE,
            })
    return out


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
        # ⚠️ REGISTRY-BACKED, and `.get` first rather than `[]`: `wanted` is filtered
        # by `is_breadth_symbol`, which now admits published namespaced identities,
        # so a bare `_METRIC_OF[s]` would KeyError on the first `US:A50` a watchlist
        # holds. A PIT universe has no live quote, so it is skipped rather than
        # given UCT's.
        metric = _METRIC_OF.get(s)
        if metric is None:
            row = resolve(s)
            if not row or row["universe"] != DEFAULT_UNIVERSE:
                continue
            metric = row["metric"]
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
# ⭐⭐ BREADTH GETS ITS OWN CACHE INSTANCE, for the reason `live_prices` already
# has one (`cache.py`: "the instance that exists specifically to escape LRU
# pressure"). The shared singleton is bounded at 1,000 entries and is hammered by
# bars, news, snapshots and analyst keys; a sealed breadth series is a LARGE value
# — thousands of candles — held for HOURS. Measured shape: ~4,700 candles per
# series, and the library projects 156 identities across four universes.
#
# ⛔ SO THE HARM IS MUTUAL AND SILENT IF THEY SHARE. Breadth would evict the hot
# bars keys it has no business touching, and bars would evict breadth series whose
# rebuild costs seconds — each looking like the other's performance problem. An
# instance whose working set is a KNOWN, DERIVABLE quantity states its own bound,
# which is the rule `cache.py` writes down.
#
# ⚠️ ISOLATION ONLY — no routing change, no move to bars-api, no CDN change. Those
# are architecture decisions with more than one valid answer and they are the
# owner's.
_BREADTH_CACHE_MAX = 512        # ~156 identities today, with room for the catalogue
                                # to grow before the bound is the binding constraint
_SEALED_TTL = 21600      # 6h; sealed history changes only at EOD — the warm loop's
                         # new-day check refreshes it promptly, this is just the ceiling.
_WARM_GAP = 0.4          # seconds slept between warm builds so a cold pass never bursts

#: The dedicated instance (see `_BREADTH_CACHE_MAX`). Module-level so every reader
#: shares ONE store; a per-call instance would be a cache that never hits.
from api.services.cache import TTLCache as _TTLCache   # noqa: E402
_breadth_cache = _TTLCache(max_size=_BREADTH_CACHE_MAX)
_bg_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="breadth-bars-refresh")
_bg_inflight: set[str] = set()
_bg_lock = threading.Lock()


def _build_breadth_series(sym: str, metric: str,
                          universe: str = DEFAULT_UNIVERSE) -> list[dict]:
    """Compute the SEALED close-to-close DAILY candle series for `metric` — the expensive
    part (DB reads + reconstructed-OHLC merge). No live value, no resample, no slice: the
    serve fn appends the developing today candle, resamples to the requested tf, and
    slices. Keeping the live value OUT is what lets this be cached for hours (the warm
    loop then converges instead of rebuilding every minute)."""
    from api.services import breadth_monitor
    want_daily = 6000   # full history (breadth starts ~2008; 6000 daily covers it)
    # ⛔ THE COLLECTOR SNAPSHOT IS UCT'S. `breadth_monitor` stores what the 4:15pm
    # collector measured over the UCT universe, so merging it into a PIT universe's
    # series would splice two different populations into one line. A PIT universe is
    # its OHLC store and nothing else.
    history = []
    if universe == DEFAULT_UNIVERSE:
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
        ohlc_map = breadth_daily_ohlc.history(metric, universe=universe)
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


def _refresh_series(sym: str, metric: str,
                    universe: str = DEFAULT_UNIVERSE) -> list[dict]:
    """Recompute + cache the SEALED daily series for `sym`. Returns it ([] on failure).
    One daily build serves D/W/M (the serve fn resamples), so this is keyed per symbol."""
    cache = _breadth_cache
    try:
        series = _build_breadth_series(sym, metric, universe)
    except Exception as e:
        _log.warning("[breadth_symbols] series build failed %s: %s", sym, e)
        return []
    cache.set(f"breadthdaily_{sym}", {"saved_at": time.time(), "series": series},
              ttl=_SEALED_TTL)
    return series


def _kick_series_refresh(sym: str, metric: str,
                         universe: str = DEFAULT_UNIVERSE) -> None:
    key = sym
    with _bg_lock:
        if key in _bg_inflight or len(_bg_inflight) >= 8:
            return
        _bg_inflight.add(key)

    def _job():
        try:
            _refresh_series(sym, metric, universe)
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
    # ⭐ THE REGISTRY RESOLVES BOTH HALVES. `_METRIC_OF` answers for the 44 shipped
    # UCT symbols on the identical fast path it always did; anything else is a
    # registry lookup that yields a UNIVERSE as well as a metric, so a published
    # `US:A50` reads US's rows rather than UCT's. An unregistered token resolves to
    # nothing and serves an empty series — never another universe's numbers.
    metric = _METRIC_OF.get(sym)
    universe = DEFAULT_UNIVERSE
    if not metric:
        row = resolve(sym)
        if not row:
            return {"ticker": sym, "tf": tf, "bars": []}
        metric, universe = row["metric"], row["universe"]

    cache = _breadth_cache
    now = time.time()
    hit = cache.get(f"breadthdaily_{sym}")   # `sym` already carries the universe
    tier = "breadth-build"
    if hit and hit.get("series") is not None:
        daily = hit["series"]
        if now - hit.get("saved_at", 0) <= _SEALED_TTL:
            tier = "breadth-cache"
        else:
            _kick_series_refresh(sym, metric, universe)   # stale → serve + revalidate
            tier = "breadth-cache-stale"
    else:
        daily = _refresh_series(sym, metric, universe)    # cold miss — the one slow request

    # Serve-time: append the live developing candle (cheap, cache-only) then resample.
    # ⚠️ THE LIVE CANDLE IS UCT'S ALONE. `breadth_live` measures the collector's
    # universe; appending its value to a US or NASDAQ series would paint one
    # universe's intraday number on another's chart. A PIT universe therefore ends
    # at its last sealed day, which is honest — it has no live feed.
    body = daily or []
    if universe == DEFAULT_UNIVERSE:
        body = _append_today_candle(body, metric)
    series = _resample(body, tf)

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
    pass never bursts and starves the pod's bars path.

    ⚠️ UCT ONLY, KNOWINGLY. It walks `_METRIC_OF` (the 44 shipped symbols) and reads
    its "latest sealed day" from `breadth_monitor`, which is the collector's — so a
    PUBLISHED PIT universe would not be warmed and its first request per symbol
    would pay a cold build of seconds.
    ⛔ NOT EXTENDED HERE, deliberately. A per-universe sealed-date probe plus a
    throttle that stays safe across four universes is a judgement about pod CPU, and
    this loop's own history is a starvation incident (see `start_breadth_warm`). It
    is INERT while the library is dark, so the honest move is to state the gap and
    let it be designed awake rather than widen a tuned loop at the end of a session.
    `test_the_warm_loop_is_uct_only_and_that_is_recorded` pins it so the gap cannot
    become invisible."""
    from api.services import breadth_monitor
    cache = _breadth_cache
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


# ─── Discovery over the library (Phase 5) ────────────────────────────────────
#
# ⭐⭐ HUMAN METRIC FIRST, UNIVERSE SECOND, SYMBOL AVAILABLE BUT NOT DOMINANT.
# A member looking for Nasdaq's 50-day-MA breadth is looking for "% of Stocks Above
# 50-Day MA" and then for "NASDAQ" — not for the string `NASDAQ:A50`, which is an
# ADDRESS. So a result leads with `name`, carries `universe_label` as a compact
# qualifier, and keeps `symbol` for the member who already knows it.
#
# ⛔ THIS IS NOT A SECOND CATALOGUE. It ranks rows from `library_rows()` and owns
# no facts of its own — no names, no families, no units. Add a metric or a universe
# and this function reports it without being edited.

#: Query words that name the LIBRARY rather than anything in it. "NASDAQ breadth"
#: means "Nasdaq's breadth metrics"; requiring the word to appear in a metric's own
#: text would return the one metric with "Breadth" in its name and hide the rest.
_LIBRARY_NOISE = frozenset({"BREADTH", "METRIC", "METRICS", "INDICATOR",
                            "INDICATORS", "LIBRARY", "SERIES"})


def _tokens(q: str) -> list[str]:
    """Upper-cased alphanumeric runs. `:` is a separator here and nothing more —
    the resolver, not the tokeniser, decides whether a colon string is an identity."""
    out, cur = [], []
    for ch in (q or "").upper():
        if ch.isalnum() or ch == "%":
            cur.append(ch)
        elif cur:
            out.append("".join(cur))
            cur = []
    if cur:
        out.append("".join(cur))
    return out


def _haystack(row: dict) -> str:
    """Everything a text query may legitimately match, normalised once."""
    return " ".join(str(v).upper() for v in (
        row.get("name"), row.get("short_name"), row.get("code"),
        row.get("group_label"), row.get("symbol") or "", row.get("universe_label"),
    ))


def library_search(q: str, limit: int = 40, published_only: bool = False) -> list[dict]:
    """Ranked Breadth Library results for one query.

    Supports, in the owner's words: `"50 MA"` → the A50 family across universes;
    `"NASDAQ breadth"` → Nasdaq's library; `"high low"` → New Highs, New Lows and
    Net New High-Low with their universe variants; `"A50"` → every A50 universe;
    `"NASDAQ:A50"` → that exact series.

    ⚠️ A UNIVERSE WORD NARROWS RATHER THAN MATCHES. `NASDAQ` in a query means "only
    Nasdaq rows", not "rows whose text contains NASDAQ" — otherwise `"NASDAQ 50 MA"`
    would rank a UCT row that happens to mention neither.

    ⛔ AND A FAMILY WORD MATCHES THE FAMILY. `"high low"` finds New Highs even
    though its own name contains no "Low", because `group_label` ("Highs / Lows")
    is in the haystack. Requiring every token inside one metric's NAME would return
    only the one metric that happens to carry both words.
    """
    from api.services import breadth_universes as _bu

    rows = [r for r in library_rows() if r.get("symbol")]
    if published_only:
        pub = set(_bu.published_universe_ids())
        rows = [r for r in rows if r["universe"] in pub]
    raw = (q or "").strip()
    if not raw:
        return []

    # ── 0. an exact identity (or alias) wins outright ──────────────────────
    hit = _library_index().get(raw.upper())
    scored = []
    if hit is not None and (not published_only
                            or hit["universe"] in set(_bu.published_universe_ids())):
        scored.append((0, hit))

    toks = _tokens(raw)
    label_to_id = {_bu.label(u).upper(): u for u in _bu.UNIVERSE_IDS}
    want_universes = {label_to_id[t] for t in toks if t in label_to_id}
    rest = [t for t in toks
            if t not in label_to_id and t not in _LIBRARY_NOISE]

    for row in rows:
        if hit is not None and row is hit:
            continue
        if want_universes and row["universe"] not in want_universes:
            continue
        code = str(row["code"]).upper()
        hay = _haystack(row)
        # ⭐ THE METRIC'S OWN TEXT OUTRANKS ITS FAMILY'S, and that tier is what makes
        # "new lows" answer with New Lows. Without it both NH and NL match only
        # through the shared family label "Highs / Lows", the tie breaks on
        # catalogue order, and the member who typed "lows" is shown "New 52-Week
        # Highs" first — technically a family hit, and obviously the wrong answer.
        own = f"{row['name']} {row['short_name']} {code}".upper()
        if not rest:
            # a bare universe query ("NASDAQ") lists that universe's library
            score = 2 if want_universes else None
        elif all(t == code for t in rest):
            score = 1                                   # "A50"
        elif all(t in own for t in rest):
            score = 3                                   # "new lows", "above 50"
        elif all(t in hay for t in rest):
            score = 4                                   # family / universe context
        else:
            score = None
        if score is not None:
            scored.append((score, row))

    # ⭐⭐ METRIC FIRST, UNIVERSE SECOND — the owner's UX principle, expressed as a
    # SORT rather than as a later grouping pass. `"high low"` must read
    #
    #     New 52-Week Highs      UCT · US · NASDAQ · NYSE
    #     New 52-Week Lows       UCT · US · NASDAQ · NYSE
    #
    # so a member sees one metric with its universe variants adjacent. Sorting by
    # universe first produced the opposite — every UCT metric, then every US metric
    # — which is the ticker-soup list this library exists to replace.
    #
    # ⚠️ And it is STABLE: score, then catalogue metric order, then universe order.
    # A search that reorders itself between identical calls is one nobody can learn.
    from api.services import breadth_metrics as _bm
    metric_rank = {k: i for i, k in enumerate(_bm.METRIC_KEYS)}
    uni_rank = {u: i for i, u in enumerate(_bu.UNIVERSE_IDS)}
    scored.sort(key=lambda sr: (sr[0],
                                metric_rank.get(sr[1]["metric"], 10**6),
                                uni_rank.get(sr[1]["universe"], 99)))

    out, seen = [], set()
    for score, row in scored:
        key = (row["universe"], row["metric"])
        if key in seen:
            continue
        seen.add(key)
        out.append({**row, "score": score, "symbol_hit": score <= 1})
        if len(out) >= limit:
            break
    return out


# ─── Availability (Phase 7 §11) ──────────────────────────────────────────────

_AVAIL_TTL = 300
_avail_cache: dict = {"at": 0.0, "value": None}


def availability() -> dict:
    """`{universe: {state, first, last, rows, floor}}` — what history ACTUALLY exists.

    ⭐⭐ THE UI MUST NOT IMPLY HISTORY WE HAVE NOT POPULATED, and the only way to
    keep that true as the backfill lands is to ASK THE STORE rather than to describe
    it in a constant somebody has to remember to update. A universe with no rows
    reports `not_populated`; one with rows reports the real first/last it holds.

    States:
      `available`     — rows exist and reach the universe's approved floor
      `limited`       — rows exist but start later than the floor (a partial backfill)
      `not_populated` — no rows at all
    ⛔ There is no `complete`. "Reaches the floor" is the strongest claim the data
    can support; whether every session inside it is present is `distinct_dates`'
    question, not this one.
    """
    now = time.time()
    if _avail_cache["value"] is not None and now - _avail_cache["at"] < _AVAIL_TTL:
        return _avail_cache["value"]
    from api.services import breadth_daily_ohlc as _store
    from api.services import breadth_universes as _bu
    out = {}
    for uid in _bu.UNIVERSE_IDS:
        floor = _bu.floor(uid)
        try:
            st = _store.stats(uid) or {}
        except Exception:
            st = {}
        rows, first, last = st.get("rows") or 0, st.get("first"), st.get("last")
        if not rows:
            state = "not_populated"
        elif floor and first and first > floor:
            state = "limited"
        else:
            state = "available"
        out[uid] = {"state": state, "rows": rows, "first": first, "last": last,
                    "floor": floor}
    _avail_cache.update(at=now, value=out)
    return out


def library_catalog(published_only: bool = True) -> dict:
    """The Breadth Library as the CLIENT consumes it: rows + families + universes.

    ⛔ ONE PAYLOAD, NOT THREE ENDPOINTS. The frontend needs the metric, its family,
    its universe, how to draw it and whether its history exists — and every one of
    those already lives in a module here. Splitting them across calls would make the
    client join them, which is where a second catalogue is born.

    ⚠️ `published_only` keeps the library DARK by default: a universe absent from
    `published_universe_ids()` contributes no rows, so an unpopulated NASDAQ cannot
    appear in a menu and imply history that does not exist.
    """
    from api.services import breadth_universes as _bu
    avail = availability()
    unis = _bu.published_universe_ids() if published_only else list(_bu.UNIVERSE_IDS)
    rows = [r for r in library_rows(unis) if r.get("symbol")]
    fams, seen = [], set()
    for r in rows:
        if r["group"] not in seen:
            seen.add(r["group"])
            fams.append({"id": r["group"], "label": r["group_label"]})
    from api.services import breadth_metrics as _bm
    return {
        "rows": rows,
        "families": fams,
        "universes": [{"id": u, "label": _bu.label(u), **avail.get(u, {})}
                      for u in unis],
        # ⛔⛔ THE CANONICAL METRIC ORDER, SENT RATHER THAN RE-DERIVED. A client that
        # infers it from first appearance in `rows` gets it WRONG the moment a metric
        # has no symbol in the first universe: `net_new_high_low` has no UCT symbol
        # (UCT never published one), so it first appears under `us` and sorts after
        # every UCT metric instead of beside its own family. Measured as a parity
        # failure between the two search lanes, which is exactly what that rail is for.
        "metric_order": _bm.METRIC_KEYS,
    }
