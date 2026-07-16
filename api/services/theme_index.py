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

from api.services.cache import cache
from api.services.engine import _load_wire_data
from api.services.massive import get_agg_bars
from api.services.theme_performance import _resolve_holdings

_BAR_DAYS = 760            # ~2y of daily history to fetch per holding
_MAX_WORKERS = 6
_MAX_HOLDINGS = 60         # safety cap on constituents fetched per index
_BASE = 100.0
_CACHE_TTL = 1800          # 30 min — daily bars, cheap to re-derive


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")


def _et_date_str(t_ms: int) -> str:
    """YYYY-MM-DD (UTC date of the daily bar's timestamp)."""
    return datetime.fromtimestamp(t_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def resolve_theme(slug: str) -> Optional[tuple[str, dict, list[str]]]:
    """Find a theme by slug (slugified name) or etf_key. Returns
    (etf_key, theme_data, holdings) or None."""
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
            return etf_key, td, holdings
    return None


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
        futs = {ex.submit(get_agg_bars, s, from_date, to_date): s for s in holdings}
        for fut in concurrent.futures.as_completed(futs):
            s = futs[fut]
            try:
                holdings_bars[s] = fut.result() or []
            except Exception:
                holdings_bars[s] = []

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
    cache.set(cache_key, result, ttl=_CACHE_TTL)
    return result
