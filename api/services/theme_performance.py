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
import logging
import os
import threading
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from api.services.cache import cache
from api.services.engine import _load_wire_data
from api.services.massive import get_agg_bars
from api.services import theme_db

import re

_logger = logging.getLogger(__name__)


def _to_hyphen(s: str | None) -> str:
    """App-canonical sym form (BRK.B -> BRK-B) — matches wire/cap_universe/bars.
    The taxonomy DB stores dot class-shares; normalize at every join point."""
    return (s or "").strip().upper().replace(".", "-")

# A real equity/ETF symbol: 1-5 uppercase letters, optional single class suffix
# (e.g. BRK.B). Curated-only themes carry their theme *id* in the `ticker` field
# instead of an ETF — those are UPPER_SNAKE ("MANAGED_CARE"), too long
# ("ECOMMERCE"), or contain digits ("GLP1"), so they fail this and must NOT be
# sent to the bars warmer (yfinance treats them as delisted tickers -> log spam).
_TICKER_RE = re.compile(r"^[A-Z]{1,5}([.\-][A-Z])?$")


def looks_like_ticker(s: str | None) -> bool:
    """True only for plausible equity/ETF symbols (filters theme-id pseudo-tickers)."""
    return bool(s) and bool(_TICKER_RE.match(s))


_CACHE_KEY = "theme_performance"
_CACHE_TTL = 900          # 15 min in-memory cache
_ROTATION_CACHE_KEY = "theme_rotation"
_ROTATION_CACHE_TTL = 900  # 15 min rotation signals cache
_LIVE_1D_KEY = "theme_live_1d_map"
_LIVE_1D_TTL = 10         # 10s live intraday overlay (theme %s re-sort ~live)
# Fully overlaid + taxonomy-enriched response, memoized for the live-overlay
# window. The live-1d map only refreshes every _LIVE_1D_TTL seconds, so the
# enriched output is byte-identical within that window — caching it avoids
# rebuilding the ~345KB structure + re-walking the taxonomy on EVERY request
# (and every 30s SWR poll from every connected client).
_OVERLAID_KEY = "theme_performance_overlaid"
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
    null = {k: None for k in ("1d", "1w", "1m", "3m", "1y", "ytd", "5d", "30d", "60d", "90d")}
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
    # N trading days back = close_at(N+1)
    ref_5d  = close_at(6)
    ref_30d = close_at(31)
    ref_60d = close_at(61)
    ref_90d = close_at(91)

    returns = {
        "1d": pct(ref_1d), "1w": pct(ref_1w),
        "1m": pct(ref_1m), "3m": pct(ref_3m),
        "1y": pct(ref_1y), "ytd": pct(ytd_close),
        "5d": pct(ref_5d), "30d": pct(ref_30d),
        "60d": pct(ref_60d), "90d": pct(ref_90d),
    }
    ref_prices = {
        "1d": ref_1d, "1w": ref_1w,
        "1m": ref_1m, "3m": ref_3m,
        "1y": ref_1y, "ytd": ytd_close,
        "5d": ref_5d, "30d": ref_30d,
        "60d": ref_60d, "90d": ref_90d,
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
            cache.invalidate(_OVERLAID_KEY)
            _save_to_disk(result)
            return

        today = date.today()
        from_date = (today - timedelta(days=_BAR_DAYS)).strftime("%Y-%m-%d")
        to_date = today.strftime("%Y-%m-%d")

        # ── Merged-membership union (Theme Membership Engine) ────────────────
        # The taxonomy DB (owner rows + engine overlay, merged read) is the
        # membership authority; the wire snapshot can lag it. Union each
        # theme's wire holdings with the merged DB member syms so DB-only
        # members get priced in this same pass. A cold/absent DB degrades to
        # wire-only. db_members: wire theme key -> {hyphen sym: source}.
        db_members: dict[str, dict[str, str]] = {}
        try:
            tax = theme_db.get_all_themes()
            by_key: dict[str, dict] = {}
            for t in tax.get("themes", []):
                by_key[t["id"]] = t              # curated-only wire keys ARE the theme id
                if t.get("etf_ticker"):
                    by_key.setdefault(t["etf_ticker"], t)
                if t.get("name"):
                    by_key.setdefault(t["name"], t)
            for etf_key, theme_data in raw_themes.items():
                if not isinstance(theme_data, dict) or etf_key in _EXCLUDED or etf_key == "UCT20":
                    continue          # UCT20 is leadership-based, not a taxonomy theme
                t = by_key.get(etf_key) or by_key.get(theme_data.get("name", ""))
                if not t:
                    continue
                db_members[etf_key] = {
                    _to_hyphen(m.get("sym")): m.get("source", "owner")
                    for m in t.get("holdings", []) if m.get("sym")
                }
        except Exception as e:
            _logger.debug("[theme-perf] merged-membership union skipped (cold DB): %s", e)

        # Deduplicated symbol list (wire syms ∪ merged DB member syms)
        all_syms: set[str] = set()
        for etf_key, theme_data in raw_themes.items():
            if not isinstance(theme_data, dict) or etf_key in _EXCLUDED:
                continue
            for sym in _resolve_holdings(etf_key, theme_data, wire):
                all_syms.add(sym)
            all_syms.update(db_members.get(etf_key, ()))

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


        # UCT20: composition-aware NAV returns (tracks stocks that rotated in/out)
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
            members = db_members.get(etf_ticker, {})
            have = {_to_hyphen(s) for s in syms}
            union_syms = list(syms) + [s for s in members if s not in have]
            theme_obj = {
                "name": theme_data.get("name", etf_ticker),
                "ticker": etf_ticker,
                "etf_name": theme_data.get("etf_name", ""),
                "holdings": [
                    {
                        "sym": sym,
                        "name": sym,
                        "weight_pct": 0.0,
                        # Membership source: engine-overlay members keep their
                        # individual return rows but NEVER move the theme
                        # aggregate (_owner_only_mean, spec §4b). Wire syms not
                        # in the DB stay owner (counted).
                        "source": members.get(_to_hyphen(sym), "owner"),
                        "returns": returns_map.get(sym, null_returns.copy()),
                        "ref_prices": refs_map.get(sym, null_returns.copy()),
                    }
                    for sym in union_syms
                ],
            }
            # UCT20: override group return with NAV-based values so past
            # holdings that rotated out still contribute their return
            if etf_ticker == "UCT20" and uct20_nav_returns:
                theme_obj["group_return"] = uct20_nav_returns
            else:
                # §4b structural stamp (Task-4 review Important #1): bake an
                # OWNER-ONLY group_return into the base result so every consumer
                # — including the frontend's average-the-holdings fallback and a
                # live-snapshot outage — inherits the engine-invariant number
                # instead of recomputing a diluted mean over engine members.
                gr = _owner_group_return(union_syms, returns_map, members, _ALL_PERIODS)
                if gr:
                    theme_obj["group_return"] = gr
            themes_out.append(theme_obj)

        result = {
            "themes": themes_out,
            "status": "ok",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        # Write to in-memory cache and persist to volume
        cache.set(_CACHE_KEY, result, ttl=_CACHE_TTL)
        cache.invalidate(_OVERLAID_KEY)
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


def _owner_only_mean(per_sym_returns: dict, owner_syms: set):
    """Mean of the OWNER members' returns only — engine-overlay members keep
    their individual rows but never move the theme number (spec §4b).
    per_sym_returns and owner_syms must use the same sym form (hyphen upper).
    None when no owner member has a value."""
    vals = [v for s, v in per_sym_returns.items() if s in owner_syms and v is not None]
    return round(sum(vals) / len(vals), 2) if vals else None


def _owner_group_return(union_syms, returns_map: dict, members: dict, periods) -> dict:
    """The §4b base-result group_return: per-period owner-only mean over a theme's
    union holdings. `members` maps hyphen sym -> source STRING ('owner'|'engine');
    a sym absent from `members` (a wire-only holding) counts as owner. Extracted
    from _run_computation so the byte-identical invariance is unit-testable:
    adding engine members must NOT change the result."""
    owner_syms_hy = {_to_hyphen(s) for s in union_syms
                     if members.get(_to_hyphen(s), "owner") != "engine"}
    gr = {}
    for period in periods:
        per_sym = {_to_hyphen(s): returns_map.get(s, {}).get(period)
                   for s in union_syms
                   if returns_map.get(s, {}).get(period) is not None}
        v = _owner_only_mean(per_sym, owner_syms_hy)
        if v is not None:
            gr[period] = v
    return gr


def _theme_owner_syms(theme: dict) -> set:
    """Owner basket for a theme's aggregates: holdings whose membership source
    is not 'engine' (absent source = owner — old persisted data stays fully
    counted), plus the `_owner_syms` stash when enrichment already ran."""
    owner = {h["sym"] for h in theme.get("holdings", [])
             if h.get("sym") and h.get("source", "owner") != "engine"}
    owner.update(theme.get("_owner_syms") or ())
    return owner


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
        holdings_out = []
        live_by_period: dict[str, dict[str, float]] = {p: {} for p in _ALL_PERIODS}

        for h in theme.get("holdings", []):
            # live is todaysChangePerc (a %, e.g. 1.5 means +1.5%) — NOT a dollar price
            live_pct = live_map.get(h["sym"])
            if live_pct is not None:
                refs = h.get("ref_prices", {})
                old_returns = h.get("returns", {})
                # Derive current dollar price: prev_close * (1 + today_pct/100)
                prev_close = refs.get("1d")  # close[-2] = yesterday's official close
                current_price = (float(prev_close) * (1 + float(live_pct) / 100)
                                 if prev_close and prev_close != 0 else None)
                new_returns = {}
                for period in _ALL_PERIODS:
                    ref = refs.get(period)
                    if period == "1d":
                        # live_pct IS the 1d return — use directly
                        val = round(float(live_pct), 2)
                    elif current_price is not None and ref and ref != 0:
                        val = round((current_price - float(ref)) / float(ref) * 100, 2)
                    else:
                        # ref_prices missing (old persisted data) — keep original
                        val = old_returns.get(period)
                    new_returns[period] = val
                    if val is not None:
                        live_by_period[period][h["sym"]] = float(val)
                holdings_out.append({**h, "returns": new_returns})
            else:
                holdings_out.append(h)
                for period in _ALL_PERIODS:
                    v = h.get("returns", {}).get(period)
                    if v is not None:
                        live_by_period[period][h["sym"]] = float(v)

        # Theme aggregate = OWNER basket only (spec §4b): engine-overlay
        # members keep their individual return rows above but never move the
        # theme number. Absent source (old persisted data) counts as owner.
        owner_syms = _theme_owner_syms(theme)
        new_theme = {**theme, "holdings": holdings_out}
        gr = dict(theme.get("group_return") or {})
        if theme.get("ticker") == "UCT20":
            # 1d: live average of current holdings (best intraday approximation)
            # 1w/1m/3m/1y/ytd: keep NAV values — composition-aware, includes
            # stocks that have already rotated out of the list
            v = _owner_only_mean(live_by_period["1d"], owner_syms)
            if v is not None:
                gr["1d"] = v
        else:
            for period, per_sym in live_by_period.items():
                v = _owner_only_mean(per_sym, owner_syms)
                if v is not None:
                    gr[period] = v
        if gr:
            new_theme["group_return"] = gr

        themes_out.append(new_theme)

    return {**result, "themes": themes_out}


# ── Public API ────────────────────────────────────────────────────────────────

def _enrich_with_taxonomy(result: dict) -> dict:
    """Add sector, tier, sub-theme + membership-source metadata from the theme
    taxonomy DB (merged owner + engine-overlay read), and append merged members
    the wire snapshot doesn't carry yet (they render with null returns until
    the next recompute prices them).

    Join order: theme id FIRST — curated-only themes carry their theme id as
    the wire ticker, and the id survives DB-side renames — then name and
    etf_ticker (setdefault, so they can never clobber an id entry).
    Also stashes per-theme `_owner_syms` (hyphen form, source != 'engine') for
    the owner-only group aggregates (spec §4b)."""
    try:
        taxonomy = theme_db.get_all_themes()
        theme_lookup = {}
        for t in taxonomy.get("themes", []):
            theme_lookup[t["id"]] = t              # id first — beats name drift
        for t in taxonomy.get("themes", []):
            theme_lookup.setdefault(t["name"], t)
            if t.get("etf_ticker"):
                theme_lookup.setdefault(t["etf_ticker"], t)
        sector_lookup = {s["id"]: s["name"] for s in taxonomy.get("sectors", [])}
        # Member maps keyed by HYPHEN sym — wire holdings use hyphen form, the
        # taxonomy stores dot class-shares (BRK.B).
        member_lookup = {}
        for t in taxonomy.get("themes", []):
            member_lookup[t["id"]] = {_to_hyphen(m["sym"]): m
                                      for m in t.get("holdings", []) if m.get("sym")}

        null_returns = {k: None for k in _ALL_PERIODS}
        for theme in result.get("themes", []):
            tax = theme_lookup.get(theme.get("ticker")) or theme_lookup.get(theme.get("name"))
            if not tax:
                continue
            theme["sector"] = sector_lookup.get(tax.get("sector_id"), "")
            theme["sector_id"] = tax.get("sector_id", "")
            theme["sub_themes"] = tax.get("sub_themes", [])
            theme["theme_id"] = tax.get("id", "")
            members = member_lookup.get(tax["id"], {})
            holdings = theme.setdefault("holdings", [])
            for h in holdings:
                m = members.get(_to_hyphen(h.get("sym")))
                if m:
                    h["tier"] = m.get("tier", "relevant")
                    h["sub_theme_id"] = m.get("sub_theme_id")
                    h["source"] = m.get("source", "owner")
            # I-3: drop members that left the merged read but still linger in
            # the wire-derived base result — otherwise a dropped name shows in
            # Theme Tracker until the next wire push (up to ~1 day).
            #   - ENGINE rows: always dropped (co-movement auto-drop/rollback).
            #   - OWNER rows: dropped ONLY for curated-only themes (etf_ticker
            #     null), where the taxonomy IS the complete holdings source.
            #     ETF-backed themes take their wire holdings from live yfinance
            #     fund constituents, which legitimately extend beyond the
            #     curated taxonomy supplement — filtering those would empty the
            #     theme. There an owner removal still waits for the wire push.
            # Guarded on a NON-EMPTY members map so a cold or partially-seeded
            # taxonomy DB can never blank a theme's holdings.
            curated_only = not tax.get("etf_ticker")
            if members:
                holdings[:] = [
                    h for h in holdings
                    if _to_hyphen(h.get("sym")) in members
                    or (h.get("source") != "engine" and not curated_only)
                ]
            # Merged members the wire snapshot doesn't carry yet — appended in
            # the same holding shape; priced on the next recompute.
            have = {_to_hyphen(h.get("sym")) for h in holdings}
            for hy, m in members.items():
                if hy in have:
                    continue
                holdings.append({
                    "sym": hy,
                    "name": hy,
                    "weight_pct": 0.0,
                    "returns": null_returns.copy(),
                    "ref_prices": null_returns.copy(),
                    "tier": m.get("tier", "relevant"),
                    "sub_theme_id": m.get("sub_theme_id"),
                    "source": m.get("source", "owner"),
                })
            # Owner basket for the group aggregates (JSON-safe list; consumed
            # as a membership set by the _owner_only_mean call sites).
            theme["_owner_syms"] = sorted(
                hy for hy, m in members.items() if m.get("source", "owner") != "engine")
    except Exception as e:
        _logger.warning("[themes] Taxonomy enrichment failed: %s", e)
    return result


def get_theme_performance() -> dict:
    """Return theme performance data. Never blocks — always returns immediately.

    Priority: in-memory cache → disk → trigger background compute.
    """
    global _computing

    # 0. Fully overlaid + enriched response cache (short TTL == live window).
    #    Collapses thousands of redundant ~345KB rebuilds into one per window.
    overlaid = cache.get(_OVERLAID_KEY)
    if overlaid is not None:
        return overlaid

    # 1. In-memory cache hit (fast path) — overlay live 1d, enrich, memoize
    cached = cache.get(_CACHE_KEY)
    if cached is not None:
        out = _enrich_with_taxonomy(_apply_live_returns(cached))
        cache.set(_OVERLAID_KEY, out, ttl=_LIVE_1D_TTL)
        return out

    # 2. Disk hit — load into memory cache, overlay, enrich, memoize
    disk_data = _load_from_disk()
    if disk_data:
        cache.set(_CACHE_KEY, disk_data, ttl=_CACHE_TTL)
        out = _enrich_with_taxonomy(_apply_live_returns(disk_data))
        cache.set(_OVERLAID_KEY, out, ttl=_LIVE_1D_TTL)
        return out

    # 3. Cache cold — trigger background computation if not already running
    with _compute_lock:
        if _computing:
            return {"themes": [], "status": "computing",
                    "generated_at": datetime.now(timezone.utc).isoformat()}
        _computing = True

    threading.Thread(target=_run_computation, daemon=True, name="theme-perf-compute").start()
    return {"themes": [], "status": "computing",
            "generated_at": datetime.now(timezone.utc).isoformat()}


def compute_rotation_signals() -> dict:
    """Compute sector rotation signals from theme performance data.

    For each theme, ranks its 1W and 1M returns as percentiles (0-100) among
    all themes.  Themes where the 1W rank exceeds the 1M rank by 20+
    percentile points are "rotating in"; the reverse means "rotating out".

    Cached for 15 minutes to avoid redundant computation.
    """
    cached = cache.get(_ROTATION_CACHE_KEY)
    if cached is not None:
        return cached

    perf = get_theme_performance()
    themes = perf.get("themes", [])
    if not themes:
        return {"rotating_in": [], "rotating_out": [], "rankings": {},
                "generated_at": datetime.now(timezone.utc).isoformat()}

    # Gather group-level returns for ranking periods
    RANK_PERIODS = ("1w", "1m", "3m")
    theme_returns: dict[str, dict] = {}
    for t in themes:
        gr = t.get("group_return") or {}
        # Fallback averages use the OWNER basket only (spec §4b) — an
        # engine-overlay member must not move a theme's rotation rank either.
        owner_syms = _theme_owner_syms(t)
        avg_fallback = {}
        for p in RANK_PERIODS:
            if gr.get(p) is not None:
                avg_fallback[p] = gr[p]
            else:
                per_sym = {h["sym"]: h["returns"].get(p) for h in t.get("holdings", [])
                           if h.get("sym") and h.get("returns", {}).get(p) is not None}
                avg_fallback[p] = _owner_only_mean(per_sym, owner_syms)
        theme_returns[t["ticker"]] = avg_fallback

    # Percentile rank per period (0 = worst, 100 = best)
    def percentile_ranks(period: str) -> dict[str, float | None]:
        vals = [(tk, theme_returns[tk].get(period))
                for tk in theme_returns if theme_returns[tk].get(period) is not None]
        if not vals:
            return {tk: None for tk in theme_returns}
        sorted_tks = sorted(vals, key=lambda x: x[1])
        n = len(sorted_tks)
        ranks = {}
        for i, (tk, _) in enumerate(sorted_tks):
            ranks[tk] = round(i / max(n - 1, 1) * 100, 1)
        # Tickers with None stay None
        for tk in theme_returns:
            if tk not in ranks:
                ranks[tk] = None
        return ranks

    pctile = {p: percentile_ranks(p) for p in RANK_PERIODS}

    # Build rankings dict and detect rotation
    rankings: dict[str, dict] = {}
    rotating_in = []
    rotating_out = []

    for t in themes:
        tk = t["ticker"]
        entry = {
            "name": t.get("name", tk),
            "ticker": tk,
        }
        for p in RANK_PERIODS:
            entry[f"{p}_return"] = theme_returns[tk].get(p)
            entry[f"{p}_rank"] = pctile[p].get(tk)
        rankings[tk] = entry

        rank_1w = pctile["1w"].get(tk)
        rank_1m = pctile["1m"].get(tk)
        if rank_1w is not None and rank_1m is not None:
            delta = rank_1w - rank_1m
            entry["momentum_delta"] = round(delta, 1)
            if delta >= 20:
                rotating_in.append({**entry})
            elif delta <= -20:
                rotating_out.append({**entry})

    # Sort by magnitude of delta
    rotating_in.sort(key=lambda x: x.get("momentum_delta", 0), reverse=True)
    rotating_out.sort(key=lambda x: x.get("momentum_delta", 0))

    result = {
        "rotating_in": rotating_in,
        "rotating_out": rotating_out,
        "rankings": rankings,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    cache.set(_ROTATION_CACHE_KEY, result, ttl=_ROTATION_CACHE_TTL)
    return result


def invalidate_memory_cache() -> None:
    """Drop the derived in-memory caches so overlay membership changes surface
    on the next read (theme_engine.invalidate.post_engine_run hook). The base
    computed-returns cache + disk persist stay — they re-enrich against the
    fresh merged membership on the next overlay rebuild; newly-added members
    appear immediately (null returns) and price on the next recompute."""
    cache.invalidate(_OVERLAID_KEY)
    cache.invalidate(_ROTATION_CACHE_KEY)
    cache.invalidate(_LIVE_1D_KEY)


def trigger_recompute() -> None:
    """Force a fresh background computation (call after wire push or manual refresh)."""
    global _computing
    with _compute_lock:
        if _computing:
            return  # Already running
        _computing = True
    threading.Thread(target=_run_computation, daemon=True, name="theme-perf-recompute").start()
