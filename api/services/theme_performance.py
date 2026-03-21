"""api/services/theme_performance.py

Loads themes from wire_data, fetches daily OHLCV bars from Massive for
each holding, computes 1D/1W/1M/3M/1Y/YTD returns, and returns a
structured themes-with-holdings response.

Persistence strategy:
  - Results are written to /data/theme_performance.json (Railway volume)
  - On startup, results are loaded from disk — instant, zero computation
  - Computation only runs: first deploy, manual refresh, or daily wire push
  - In-memory TTLCache sits on top (15 min) to avoid repeated disk reads

This ensures Railway container restarts never trigger recomputation.
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from api.services.cache import cache
from api.services.engine import _load_wire_data
from api.services.massive import get_agg_bars


_CACHE_KEY = "theme_performance"
_CACHE_TTL = 900          # 15 min in-memory cache
_LIVE_1D_KEY = "theme_live_1d_map"
_LIVE_1D_TTL = 30         # 30s live intraday overlay
_MAX_WORKERS = 6          # conservative — keeps Railway memory safe
_BAR_DAYS = 420           # ~14 months → ≥252 trading days for 1Y
_EXCLUDED = {"TLT", "HYG", "URA", "IBB", "FXI", "MSOS"}
_PERSIST_FILE = "/data/theme_performance.json"

# Background computation state
_computing = False
_compute_lock = threading.Lock()


# ── Disk persistence ──────────────────────────────────────────────────────────

def _load_from_disk() -> Optional[dict]:
    """Load persisted results from Railway volume. Returns None if missing/stale."""
    try:
        if not os.path.exists(_PERSIST_FILE):
            return None
        with open(_PERSIST_FILE, encoding="utf-8") as f:
            data = json.load(f)
        if not data.get("themes"):
            return None
        # Accept disk data up to 26 hours old (covers overnight gap)
        gen_str = data.get("generated_at", "")
        if gen_str:
            gen = datetime.fromisoformat(gen_str)
            if gen.tzinfo is None:
                gen = gen.replace(tzinfo=timezone.utc)
            age = datetime.now(timezone.utc) - gen
            if age > timedelta(hours=26):
                return None
        return data
    except Exception:
        return None


def _save_to_disk(result: dict) -> None:
    """Write results to Railway volume atomically."""
    try:
        os.makedirs(os.path.dirname(_PERSIST_FILE), exist_ok=True)
        tmp = _PERSIST_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(result, f, separators=(",", ":"))
        os.replace(tmp, _PERSIST_FILE)
    except Exception:
        pass  # Volume not mounted in local dev — safe to ignore


def load_persisted_on_startup() -> None:
    """Call from app startup to seed in-memory cache from disk. Fast, no I/O to Massive."""
    data = _load_from_disk()
    if data:
        cache.set(_CACHE_KEY, data, ttl=_CACHE_TTL)
        n = len(data.get("themes", []))
        print(f"[startup] Theme performance loaded from disk — {n} themes ready")
    else:
        print("[startup] No persisted theme data — will compute on first request")


# ── Returns computation ───────────────────────────────────────────────────────

def _resolve_holdings(etf_key: str, theme_data: dict, wire: dict) -> list[str]:
    if etf_key == "UCT20":
        leadership = wire.get("leadership", [])
        return [e["sym"] for e in leadership if isinstance(e, dict) and "sym" in e]
    return [h["sym"] for h in theme_data.get("holdings", []) if isinstance(h, dict) and h.get("sym")]


def _compute_returns_with_refs(bars: list[dict]) -> tuple[dict, dict]:
    """Return (returns, ref_prices) for all periods.

    ref_prices stores the reference close price for each period so the live
    overlay can recompute returns using a fresh intraday price without
    re-fetching bar history.
    """
    null = {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd")}
    if not bars:
        return null.copy(), null.copy()
    closes = [b["c"] for b in bars]
    cur = closes[-1]

    def pct(ref):
        if ref is None or ref == 0:
            return None
        return round((cur - ref) / ref * 100, 2)

    def close_at(n):
        idx = -n
        return closes[0] if abs(idx) > len(closes) else closes[idx]

    current_year = date.today().year
    ytd_close = next(
        (b["c"] for b in bars
         if datetime.fromtimestamp(b["t"] / 1000, tz=timezone.utc).year == current_year),
        closes[0]
    )
    ref_1d  = close_at(2)
    ref_1w  = close_at(6)
    ref_1m  = close_at(23)
    ref_3m  = close_at(67)
    ref_1y  = close_at(253)

    returns = {
        "1d": pct(ref_1d), "1w": pct(ref_1w),
        "1m": pct(ref_1m), "3m": pct(ref_3m),
        "1y": pct(ref_1y), "ytd": pct(ytd_close),
    }
    ref_prices = {
        "1d": ref_1d, "1w": ref_1w,
        "1m": ref_1m, "3m": ref_3m,
        "1y": ref_1y, "ytd": ytd_close,
    }
    return returns, ref_prices


def _compute_returns(bars: list[dict]) -> dict[str, Optional[float]]:
    returns, _ = _compute_returns_with_refs(bars)
    return returns


def _fetch_returns_for(ticker: str, from_date: str, to_date: str) -> tuple[dict, dict]:
    return _compute_returns_with_refs(get_agg_bars(ticker, from_date, to_date))


def _run_computation() -> None:
    """Background thread: fetch all returns, cache in memory, and persist to disk."""
    global _computing
    try:
        wire = _load_wire_data()
        raw_themes = dict(wire.get("themes", {})) if wire else {}

        # UCT20 is not a real ETF — inject it so _resolve_holdings can pull from leadership list
        if wire and "UCT20" not in raw_themes:
            raw_themes["UCT20"] = {
                "name": "UCT 20",
                "ticker": "UCT20",
                "etf_name": "UCT Intelligence Leadership 20",
                "holdings": [],
            }

        if not raw_themes or not isinstance(raw_themes, dict):
            result = {"themes": [], "status": "ok",
                      "generated_at": datetime.now(timezone.utc).isoformat()}
            cache.set(_CACHE_KEY, result, ttl=60)
            _save_to_disk(result)
            return

        today = date.today()
        from_date = (today - timedelta(days=_BAR_DAYS)).strftime("%Y-%m-%d")
        to_date = today.strftime("%Y-%m-%d")

        # Deduplicated symbol list
        all_syms: set[str] = set()
        for etf_key, theme_data in raw_themes.items():
            if not isinstance(theme_data, dict) or etf_key in _EXCLUDED:
                continue
            for sym in _resolve_holdings(etf_key, theme_data, wire):
                all_syms.add(sym)

        # Fetch in parallel with conservative worker count
        returns_map: dict[str, dict] = {}
        refs_map: dict[str, dict] = {}
        null_returns = {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd")}
        with concurrent.futures.ThreadPoolExecutor(max_workers=_MAX_WORKERS) as executor:
            futures = {
                executor.submit(_fetch_returns_for, sym, from_date, to_date): sym
                for sym in all_syms
            }
            for future in concurrent.futures.as_completed(futures):
                sym = futures[future]
                try:
                    returns_map[sym], refs_map[sym] = future.result()
                except Exception:
                    returns_map[sym] = null_returns.copy()
                    refs_map[sym] = null_returns.copy()

        # Compute UCT20 portfolio NAV returns (composition-history based)
        try:
            from api.services.uct20_nav import compute_portfolio_returns
            uct20_nav_returns = compute_portfolio_returns()
        except Exception:
            uct20_nav_returns = None

        # Build response
        themes_out = []
        for etf_ticker, theme_data in raw_themes.items():
            if not isinstance(theme_data, dict) or etf_ticker in _EXCLUDED:
                continue
            syms = _resolve_holdings(etf_ticker, theme_data, wire)
            theme_obj = {
                "name": theme_data.get("name", etf_ticker),
                "ticker": etf_ticker,
                "etf_name": theme_data.get("etf_name", ""),
                "holdings": [
                    {
                        "sym": sym,
                        "name": theme_data.get("name", sym),
                        "weight_pct": 0.0,
                        "returns": returns_map.get(sym, null_returns.copy()),
                        "ref_prices": refs_map.get(sym, null_returns.copy()),
                    }
                    for sym in syms
                ],
            }
            # UCT20: attach portfolio NAV returns as group_return so the UI
            # shows proper portfolio accounting instead of simple avg of holdings
            if etf_ticker == "UCT20" and uct20_nav_returns:
                theme_obj["group_return"] = uct20_nav_returns
            themes_out.append(theme_obj)

        result = {
            "themes": themes_out,
            "status": "ok",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        # Write to in-memory cache and persist to volume
        cache.set(_CACHE_KEY, result, ttl=_CACHE_TTL)
        _save_to_disk(result)
        print(f"[theme-perf] Computation done — {len(themes_out)} themes persisted to disk")

    except Exception as e:
        print(f"[theme-perf] Computation failed: {e}")
    finally:
        with _compute_lock:
            global _computing
            _computing = False


# ── Live 1d overlay ───────────────────────────────────────────────────────────

def _fetch_live_1d_map(syms: list[str]) -> dict[str, float]:
    """Return todaysChangePerc for all holdings via batch snapshot. Cached 30s."""
    cached = cache.get(_LIVE_1D_KEY)
    if cached is not None:
        return cached
    from api.services.massive import get_etf_snapshots
    live_map = get_etf_snapshots(syms)
    cache.set(_LIVE_1D_KEY, live_map, ttl=_LIVE_1D_TTL)
    return live_map


_ALL_PERIODS = ("1d", "1w", "1m", "3m", "1y", "ytd")


def _apply_live_returns(result: dict) -> dict:
    """Recompute all period returns using real-time price + stored ref prices.

    For each holding with a live snapshot price, computes:
        return = (live_price - ref_price) / ref_price * 100
    for every period (1d/1w/1m/3m/1y/ytd) using the ref_prices stored at
    computation time.  Falls back to the stored return when ref_price is
    missing (e.g. persisted data from before this change).

    For UCT20 only 1d is updated from the live average — other periods use
    the portfolio NAV computed at daily computation time (which accounts for
    composition changes the simple average cannot).

    Returns a new dict — does not mutate the cached base.
    """
    themes = result.get("themes")
    if not themes:
        return result

    all_syms = [h["sym"] for theme in themes for h in theme.get("holdings", []) if h.get("sym")]
    live_map = _fetch_live_1d_map(all_syms)
    if not live_map:
        return result

    themes_out = []
    for theme in themes:
        is_uct20 = theme.get("ticker") == "UCT20"
        holdings_out = []
        live_by_period: dict[str, list[float]] = {p: [] for p in _ALL_PERIODS}

        for h in theme.get("holdings", []):
            live = live_map.get(h["sym"])
            if live is not None:
                refs = h.get("ref_prices", {})
                old_returns = h.get("returns", {})
                new_returns = {}
                for period in _ALL_PERIODS:
                    ref = refs.get(period)
                    if ref and ref != 0:
                        val = round((float(live) - float(ref)) / float(ref) * 100, 2)
                    else:
                        # ref_prices not stored yet (old persisted data) — keep original
                        val = old_returns.get(period)
                    new_returns[period] = val
                    if val is not None:
                        live_by_period[period].append(float(val))
                holdings_out.append({**h, "returns": new_returns})
            else:
                holdings_out.append(h)
                for period in _ALL_PERIODS:
                    v = h.get("returns", {}).get(period)
                    if v is not None:
                        live_by_period[period].append(float(v))

        new_theme = {**theme, "holdings": holdings_out}
        gr = dict(theme.get("group_return") or {})
        if is_uct20:
            # UCT20: only update 1d — 1w/1m/etc. use portfolio NAV (composition-aware)
            if live_by_period["1d"]:
                gr["1d"] = round(sum(live_by_period["1d"]) / len(live_by_period["1d"]), 2)
        else:
            for period, vals in live_by_period.items():
                if vals:
                    gr[period] = round(sum(vals) / len(vals), 2)
        if gr:
            new_theme["group_return"] = gr

        themes_out.append(new_theme)

    return {**result, "themes": themes_out}


# ── Public API ────────────────────────────────────────────────────────────────

def get_theme_performance() -> dict:
    """Return theme performance data. Never blocks — always returns immediately.

    Priority: in-memory cache → disk → trigger background compute.
    """
    global _computing

    # 1. In-memory cache hit (fast path) — overlay live 1d before returning
    cached = cache.get(_CACHE_KEY)
    if cached is not None:
        return _apply_live_returns(cached)

    # 2. Disk hit — load into memory cache and return with live 1d overlay
    disk_data = _load_from_disk()
    if disk_data:
        cache.set(_CACHE_KEY, disk_data, ttl=_CACHE_TTL)
        return _apply_live_returns(disk_data)

    # 3. Cache cold — trigger background computation if not already running
    with _compute_lock:
        if _computing:
            return {"themes": [], "status": "computing",
                    "generated_at": datetime.now(timezone.utc).isoformat()}
        _computing = True

    threading.Thread(target=_run_computation, daemon=True, name="theme-perf-compute").start()
    return {"themes": [], "status": "computing",
            "generated_at": datetime.now(timezone.utc).isoformat()}


def trigger_recompute() -> None:
    """Force a fresh background computation (call after wire push or manual refresh)."""
    global _computing
    with _compute_lock:
        if _computing:
            return  # Already running
        _computing = True
    threading.Thread(target=_run_computation, daemon=True, name="theme-perf-recompute").start()
