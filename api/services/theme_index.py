"""Thematic equal-weight index ("thematic ETF").

Builds a synthetic candlestick series for a THEME by equal-weighting all of its
holdings, daily-rebalanced. The result is returned in the same bar shape as
/api/bars ({t: unix ms, o, h, l, c, v}) so the frontend StockChart renders it as
a normal candle chart (candles + volume + MAs + watermark).

Index math (base = 100, rebalanced daily so every holding carries equal weight
each day):

  For holding i on its bar k (k >= 1), define returns vs its OWN previous close:
      r_o = o_k / c_{k-1} - 1     r_h = h_k / c_{k-1} - 1
      r_l = l_k / c_{k-1} - 1     r_c = c_k / c_{k-1} - 1
  For each calendar date d, average each return across the holdings that have a
  return-bar on d (equal weight; a holding joins the day it starts trading):
      level_open  = level_prev * (1 + mean(r_o))
      level_high  = level_prev * (1 + mean(r_h))
      level_low   = level_prev * (1 + mean(r_l))
      level_close = level_prev * (1 + mean(r_c))     -> becomes level_prev next day
  Volume = sum of the contributing holdings' share volume that day.

High/low are synthetic (the constituents don't all print their extremes at the
same instant) but the candle is always valid — we clamp h >= max(o,c) and
l <= min(o,c).
"""
from __future__ import annotations

import concurrent.futures
import re
import statistics
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from api.services.cache import cache
from api.services.engine import _load_wire_data
from api.services.massive import get_agg_bars
from api.services.theme_performance import _resolve_holdings

_BAR_DAYS = 760            # ~2y of daily history to fetch per holding
_MAX_WORKERS = 6
_MAX_HOLDINGS = 60         # safety cap on constituents fetched per index
_BASE = 100.0
_CACHE_TTL = 1800          # 30 min — closed session, daily bar is final
_CACHE_TTL_RTH = 180       # 3 min during RTH — keep the developing candle fresh
_WARM_BARS = 620           # daily rows to pull from the shared cache (~2.4y)
_WARM_STALE_DAYS = 5       # a cached series older than this → refetch from Massive


def _ymd_to_ms(ymd: int) -> int:
    """A YYYYMMDD int (how bars_sqlite stores a daily bar's ts) → unix ms at UTC
    noon, so `_et_date_str` buckets it on the right calendar day regardless of TZ."""
    y, m, d = ymd // 10000, (ymd // 100) % 100, ymd % 100
    return int(datetime(y, m, d, 12, tzinfo=timezone.utc).timestamp() * 1000)


def _holding_daily_bars(sym: str, from_date: str, to_date: str) -> list[dict]:
    """Daily bars for ONE holding — read from the WARM shared bars cache (the same
    SQLite the /api/bars path serves, kept fresh by the bars prewarmer + R2 bridge),
    NOT a fresh Massive REST call. That direct-fetch fan-out (up to 60 per index) was
    the whole reason a thematic index was slow to load. Falls back to Massive only
    when the cache is empty or stale for this name (a thin/new ticker)."""
    try:
        from api.services import bars_sqlite as _sqlite
        rows = _sqlite.get_bars(sym, "D", _WARM_BARS)   # (ts=YYYYMMDD, o,h,l,c,v)
    except Exception:
        rows = []
    if rows:
        latest = int(rows[-1][0])
        # Fresh enough? (last daily bar within a few days — covers weekends/holidays.)
        try:
            stale = (date.today() - date(latest // 10000, (latest // 100) % 100, latest % 100)).days > _WARM_STALE_DAYS
        except Exception:
            stale = True
        if not stale:
            return [{"t": _ymd_to_ms(int(r[0])), "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]
    return get_agg_bars(sym, from_date, to_date)


def _overlay_today(holdings_bars: dict[str, list[dict]]) -> None:
    """During RTH, overlay each holding's LIVE developing daily candle from the
    shared whole-market snapshot (already polled ~every 2-3s by the live scanners →
    ~free) so the index's last candle reflects intraday moves even when the warm
    bars cache's today-bar lags (the R2 bridge writes it a bit behind). RTH-gated by
    the caller, so we never append a candle on a closed day. Mutates in place."""
    try:
        from api.services.massive import get_full_market_snapshot_hl_cached, to_polygon_symbol
        snap = get_full_market_snapshot_hl_cached(ttl=2.0)
    except Exception:
        return
    if not snap:
        return
    et = datetime.now(timezone.utc).astimezone(ZoneInfo("America/New_York")).date()
    t_ms = _ymd_to_ms(et.year * 10000 + et.month * 100 + et.day)
    today_str = _et_date_str(t_ms)
    for sym, bars in holdings_bars.items():
        s = snap.get(to_polygon_symbol(sym))
        if not s:
            continue
        o = float(s.get("day_open") or 0.0)
        hi = float(s.get("day_high") or 0.0)
        lo = float(s.get("day_low") or 0.0)
        c = float(s.get("day_c") or s.get("last_price") or 0.0)
        if o <= 0 or hi <= 0 or lo <= 0 or c <= 0:
            continue  # pre-open / no RTH print yet → leave the warm series alone
        hi, lo = max(hi, o, c), min(lo, o, c)   # keep the candle valid
        today = {"t": t_ms, "o": o, "h": hi, "l": lo, "c": c, "v": int(s.get("today_vol") or 0)}
        if bars and _et_date_str(bars[-1]["t"]) == today_str:
            bars[-1] = today          # replace a stale today-bar from the warm cache
        else:
            bars.append(today)        # today's bar not in the warm cache yet


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")


def _et_date_str(t_ms: int) -> str:
    """YYYY-MM-DD (UTC date of the daily bar's timestamp)."""
    return datetime.fromtimestamp(t_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _merged_db_syms(etf_key: str, td: dict) -> list[str]:
    """The theme's merged (owner + engine-overlay) member syms from theme_db,
    hyphen-normalized. [] when the theme isn't in the taxonomy. Raises on a
    cold/absent DB — the caller degrades to wire holdings."""
    from api.services import theme_db
    tid = None
    want = _slugify(td.get("name") or "")
    for t in theme_db.get_all_themes().get("themes", []):
        if (t["id"] == etf_key or (t.get("etf_ticker") or "") == etf_key
                or _slugify(t.get("name") or "") == want):
            tid = t["id"]
            break
    if not tid:
        return []
    from api.services import delisted_registry
    syms = [(h.get("sym") or "").strip().upper().replace(".", "-")
            for h in theme_db.get_theme_holdings(tid) if h.get("sym")]
    # Keep delisted names out of the equal-weight index basket (mirrors the
    # _resolve_holdings filter on the wire-holdings path).
    return [s for s in syms if not delisted_registry.is_delisted(s)]


def resolve_theme(slug: str) -> Optional[tuple[str, dict, list[str]]]:
    """Find a theme by slug (slugified name) or etf_key. Returns
    (etf_key, theme_data, holdings) or None.

    Holdings prefer the merged theme_db membership (owner + engine overlay —
    the membership authority) over the wire snapshot; a cold/absent DB or a
    theme not in the taxonomy (e.g. UCT20) degrades to wire holdings."""
    wire = _load_wire_data() or {}
    raw_themes = wire.get("themes", {}) or {}
    if not isinstance(raw_themes, dict):
        return None
    want = _slugify(slug)
    for etf_key, td in raw_themes.items():
        if not isinstance(td, dict):
            continue
        if _slugify(td.get("name", "")) == want or _slugify(etf_key) == want:
            holdings = _resolve_holdings(etf_key, td, wire)[:_MAX_HOLDINGS]
            try:
                db_syms = _merged_db_syms(etf_key, td)
                if db_syms:
                    holdings = db_syms[:_MAX_HOLDINGS]
            except Exception:
                pass  # cold DB — wire-only basket still serves
            return etf_key, td, holdings
    return None


def invalidate_cache() -> None:
    """Drop every cached theme-index series (theme_engine.invalidate hook) so
    overlay membership changes rebuild the synthetic index with the merged
    basket on the next request."""
    cache.delete_prefix("theme_index::")


def _compute_index_bars(holdings_bars: dict[str, list[dict]]) -> list[dict]:
    """Equal-weight, daily-rebalanced OHLC index from per-holding daily bars."""
    # Per holding: date -> return descriptor vs its own previous close; plus each
    # constituent's close-return series (for the diversification-ratio wick scale).
    per_day: dict[str, list[dict]] = {}
    sym_returns: dict[str, list[float]] = {}
    for sym, bars in holdings_bars.items():
        clean = [b for b in (bars or [])
                 if all(isinstance(b.get(k), (int, float)) for k in ("t", "o", "h", "l", "c"))
                 and b["o"] > 0 and b["h"] > 0 and b["l"] > 0 and b["c"] > 0]
        clean.sort(key=lambda b: b["t"])
        rcs: list[float] = []
        for k in range(1, len(clean)):
            prev_c = clean[k - 1]["c"]
            if prev_c <= 0:
                continue
            b = clean[k]
            d = _et_date_str(b["t"])
            rc = b["c"] / prev_c - 1.0
            per_day.setdefault(d, []).append({
                "ro": b["o"] / prev_c - 1.0,
                "rh": b["h"] / prev_c - 1.0,
                "rl": b["l"] / prev_c - 1.0,
                "rc": rc,
                "v": float(b.get("v") or 0),
            })
            rcs.append(rc)
        if len(rcs) >= 5:
            sym_returns[sym] = rcs

    dates = sorted(per_day.keys())

    # Wicks = the averaged per-constituent high/low ranges, which OVERSTATE the
    # index's true daily range because the constituents don't hit their extremes at
    # the same instant (max of a mean <= mean of maxes). Scale them by the basket's
    # DIVERSIFICATION RATIO D = sigma(equal-weight portfolio) / mean(sigma(constituent))
    # = sqrt(rho + (1-rho)/n): a tightly-correlated sector (semis) → D near 1 → real
    # full wicks; a diverse basket → lower D → dampened wicks. This is how a real
    # equal-weight ETF's daily range relates to its holdings'. Clamp so wicks never
    # vanish (>=0.5) and never exceed the raw averaged range (<=1.0).
    D = 1.0
    port_returns = [sum(r["rc"] for r in per_day[d]) / len(per_day[d]) for d in dates if per_day[d]]
    indiv_vols = [statistics.pstdev(v) for v in sym_returns.values() if len(v) >= 2]
    if len(port_returns) >= 5 and indiv_vols:
        avg_iv = sum(indiv_vols) / len(indiv_vols)
        if avg_iv > 1e-9:
            D = max(0.5, min(1.0, statistics.pstdev(port_returns) / avg_iv))

    out: list[dict] = []
    level = _BASE
    for d in dates:
        rows = per_day[d]
        n = len(rows)
        if not n:
            continue
        avg_o = sum(r["ro"] for r in rows) / n
        avg_h = sum(r["rh"] for r in rows) / n
        avg_l = sum(r["rl"] for r in rows) / n
        avg_c = sum(r["rc"] for r in rows) / n
        o = level * (1 + avg_o)
        h = level * (1 + avg_h)
        l = level * (1 + avg_l)
        c = level * (1 + avg_c)
        body_top, body_bot = max(o, c), min(o, c)
        h = body_top + (h - body_top) * D
        l = body_bot - (body_bot - l) * D
        vol = sum(r["v"] for r in rows)
        out.append({
            # D/W/M bars carry `t` as a "YYYY-MM-DD" ET date string (frontend + LW
            # Charts format for D/W/M), NOT unix seconds like intraday.
            "t": d,
            "o": round(o, 4), "h": round(h, 4), "l": round(l, 4), "c": round(c, 4),
            "v": vol,
        })
        level = c
    return out


def _resample(daily: list[dict], tf: str) -> list[dict]:
    """Resample daily index bars to weekly ('W') or monthly ('M'). Daily returned as-is."""
    if tf not in ("W", "M") or not daily:
        return daily
    buckets: dict[str, list[dict]] = {}
    order: list[str] = []
    for b in daily:
        dt = datetime.strptime(b["t"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        if tf == "W":
            iso = dt.isocalendar()
            key = f"{iso[0]}-W{iso[1]:02d}"
        else:
            key = dt.strftime("%Y-%m")
        if key not in buckets:
            buckets[key] = []
            order.append(key)
        buckets[key].append(b)
    out = []
    for key in order:
        grp = buckets[key]
        out.append({
            "t": grp[0]["t"],
            "o": grp[0]["o"],
            "h": max(x["h"] for x in grp),
            "l": min(x["l"] for x in grp),
            "c": grp[-1]["c"],
            "v": sum(x["v"] for x in grp),
        })
    return out


def get_theme_index(slug: str, tf: str = "D") -> dict:
    """Return {ticker, name, holdings, bars} for a theme's equal-weight index."""
    tf = tf if tf in ("D", "W", "M") else "D"
    cache_key = f"theme_index::{_slugify(slug)}::{tf}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    resolved = resolve_theme(slug)
    if not resolved:
        return {"ticker": None, "name": None, "holdings": [], "bars": [], "error": "theme not found"}
    etf_key, td, holdings = resolved
    if not holdings:
        return {"ticker": etf_key, "name": td.get("name"), "holdings": [], "bars": []}

    today = date.today()
    from_date = (today - timedelta(days=_BAR_DAYS)).strftime("%Y-%m-%d")
    to_date = today.strftime("%Y-%m-%d")

    holdings_bars: dict[str, list[dict]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=_MAX_WORKERS) as ex:
        futs = {ex.submit(_holding_daily_bars, s, from_date, to_date): s for s in holdings}
        for fut in concurrent.futures.as_completed(futs):
            s = futs[fut]
            try:
                holdings_bars[s] = fut.result() or []
            except Exception:
                holdings_bars[s] = []

    # Live developing candle: during RTH, refresh today's bar from the shared
    # whole-market snapshot so the index tracks intraday even if the warm bars
    # cache's today-bar lags. Closed sessions serve the warm cache's final close.
    try:
        from api.services import bars_liveness
        if bars_liveness.is_market_open():
            _overlay_today(holdings_bars)
    except Exception:
        pass

    daily = _compute_index_bars(holdings_bars)
    bars = _resample(daily, tf)
    used = [s for s, b in holdings_bars.items() if b]
    result = {
        "ticker": f"${_slugify(td.get('name') or etf_key).upper().replace('-', '_')}",
        "name": td.get("name") or etf_key,
        "sector": td.get("sector"),
        "holdings": used,
        "holdings_count": len(used),
        "bars": bars,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    # SHORT TTL during RTH so the live developing candle stays fresh (a recompute is
    # cheap now — warm bars reads + the shared snapshot); LONG when closed, where the
    # daily bar is final and a hit should be instant.
    try:
        from api.services import bars_liveness
        ttl = _CACHE_TTL_RTH if bars_liveness.is_market_open() else _CACHE_TTL
    except Exception:
        ttl = _CACHE_TTL
    cache.set(cache_key, result, ttl=ttl)
    return result


# ── Batch quotes for the "UCT Thematic Indexes" watchlist ────────────────────
# Every theme → {name, change_pct (live 1d), price} keyed by the $IDX:<slug>
# pseudo-ticker the watchlist rows and chart use. Reads the already-cached,
# live-overlaid theme-performance snapshot so it costs no fetch. `price` is None:
# a synthetic index has no traded level — the daily % IS the performance we show
# (same figure the Theme Tracker displays).
def _theme_1d_return(t: dict):
    gr = t.get("group_return")
    if isinstance(gr, dict) and isinstance(gr.get("1d"), (int, float)):
        return gr["1d"]
    vals = [h.get("returns", {}).get("1d") for h in (t.get("holdings") or [])]
    vals = [v for v in vals if isinstance(v, (int, float))]
    return round(sum(vals) / len(vals), 2) if vals else None


def get_index_quotes() -> dict:
    from api.services import theme_performance
    perf = theme_performance.get_theme_performance()
    out: dict[str, dict] = {}
    for t in perf.get("themes", []):
        name = str(t.get("name") or "").strip()
        slug = _slugify(name)
        if not slug or ("$IDX:" + slug) in out:
            continue
        out["$IDX:" + slug] = {
            "name": f"{name} Index",
            "change_pct": _theme_1d_return(t),
            "price": None,
        }
    return {"quotes": out, "as_of": perf.get("live_as_of")}


# ── "View Holdings" for a thematic index ─────────────────────────────────────
# The stocks that make up the equal-weight index — the SAME merged (owner +
# engine-overlay) basket resolve_theme feeds the chart, so it tracks whatever the
# Theme Tracker currently holds for the theme. Equal-weight, so each carries
# 100/N%. Names/sector/industry are left to the watchlist's own meta layer (the
# basket is <= _MAX_HOLDINGS, under its 100-symbol cap).
def get_index_holdings(slug: str) -> dict:
    r = resolve_theme(slug)
    if not r:
        return {"slug": slug, "name": None, "holdings": [], "count": 0}
    etf_key, td, holdings = r
    n = len(holdings)
    w = round(100.0 / n, 2) if n else None
    return {
        "slug": slug,
        "name": td.get("name") or etf_key,
        "sector": td.get("sector"),
        "holdings": [{"sym": s, "weight": w} for s in holdings],
        "count": n,
    }


# ── Prewarm (web-side) ───────────────────────────────────────────────────────
# The theme_index cache is web-local + in-memory, so a user request that misses
# pays the full recompute. Warming every theme on a schedule (and on boot) keeps
# the serve path a ~1ms cache hit — instant. Cheap now that _holding_daily_bars
# reads the warm shared bars cache instead of fanning out to Massive.
import logging as _logging
_log = _logging.getLogger("theme_index")


def all_theme_slugs() -> list[str]:
    """Every resolvable theme slug (from the pushed wire taxonomy) — the set
    resolve_theme can actually build, so prewarming them never wastes a call."""
    wire = _load_wire_data() or {}
    raw = wire.get("themes", {}) or {}
    out, seen = [], set()
    if isinstance(raw, dict):
        for etf_key, td in raw.items():
            if not isinstance(td, dict):
                continue
            slug = _slugify(td.get("name") or etf_key)
            if slug and slug not in seen:
                seen.add(slug)
                out.append(slug)
    return out


def prewarm_all(tf: str = "D") -> int:
    """Compute + cache every theme's index for `tf`. Returns how many warmed.
    Sequential (each call already uses its own bounded worker pool); exception per
    theme is swallowed so one bad basket never aborts the sweep."""
    n = 0
    for slug in all_theme_slugs():
        try:
            r = get_theme_index(slug, tf)
            if r and r.get("bars"):
                n += 1
        except Exception:
            pass
    return n
