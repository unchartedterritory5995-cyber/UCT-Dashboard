"""Weekly earnings + economic events calendar endpoint.

Data priority:
  1. wire_data['weekly_calendar'] — multi-source earnings (rich, 5-source aggregated)
  2. EarningsWhispers + Finviz Elite live fetch for each weekday — earnings only
  3. Empty structure — graceful fallback

Economic events: always fetched live from ForexFactory (real data, never AI).
Finnhub actuals patch: applied to today's pending tickers on every cache miss.
POST /api/calendar/refresh — rebuild cache immediately
GET  /api/calendar/reactions?date=YYYY-MM-DD — live gap % for reported tickers (Massive)
GET  /api/calendar/month?year=&month= — full-month earnings via Finnhub
"""

from __future__ import annotations
import calendar as _cal_module
import logging
import os
import threading
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
from fastapi import APIRouter, Depends, Query
from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.serve_stale import ServeStale
from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import calendar_personalization as _cp

_logger = logging.getLogger(__name__)
router = APIRouter()

_CACHE_TTL = 600  # 10 min — shorter to pick up reported actuals faster
_CACHE_FAIL_TTL = 60  # a week that fails `_weekly_payload_is_good` self-heals in 1 min, not 10

# EarningsWhispers connection-drops rapid/parallel bursts, so the per-day live
# fetch is PACED sequentially with a short delay + retry instead of 5 parallel
# threads (which got ~4/5 requests blocked → an empty calendar).
_EW_PACE_SECONDS = 0.6    # delay between consecutive EW day-fetches
_EW_RETRIES = 2           # extra attempts per day on a transient block
_EW_RETRY_BACKOFF = 1.5   # base seconds between retries (grows per attempt)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _today_et() -> date:
    return datetime.now(_ET).date()


def _week_dates() -> list[date]:
    today = _today_et()
    dow = today.weekday()  # Mon=0 … Sun=6
    # On weekends jump forward to next Monday; on weekdays anchor to this Monday
    if dow >= 5:
        monday = today + timedelta(days=7 - dow)
    else:
        monday = today - timedelta(days=dow)
    return [monday + timedelta(days=i) for i in range(5)]


def _monday_of(d: date) -> date:
    """ISO Monday of the week containing d (Sat/Sun snap back to that Monday)."""
    return d - timedelta(days=d.weekday())


def _week_dates_for(monday: date) -> list[date]:
    return [monday + timedelta(days=i) for i in range(5)]


# Paging horizon: how far from the current week a ?week= request may reach.
_WEEK_HORIZON_WEEKS = 52


def _empty_day(d: date, today: date) -> dict:
    return {
        "label":    d.strftime("%a %b ") + str(d.day),
        "day":      d.strftime("%A"),
        "is_today": d == today,
        "bmo":      [],
        "amc":      [],
        "tbd":      [],   # session unconfirmed — NEVER coerced into amc
        "econ":     [],
        "fed":      [],
    }


def _day_entries(day: dict) -> list[dict]:
    """All earnings entries of a day across every session bucket."""
    return (day.get("bmo") or []) + (day.get("amc") or []) + (day.get("tbd") or [])


# ── Wire data path ─────────────────────────────────────────────────────────────

def _from_wire(wire_calendar: dict, week_dates: list[date], today: date, cap_universe: set | None = None) -> dict:
    """Normalize a wire_data['weekly_calendar'] dict into the calendar day structure."""
    days: dict[str, dict] = {}
    for d in week_dates:
        ds = d.strftime("%Y-%m-%d")
        wd = wire_calendar.get(ds, {})

        _EPS_SENTINELS = frozenset({999.0, -999.0, 9999.0, -9999.0, 999.99, -999.99})

        def _clean_eps(v, sym="?"):
            """Null out sentinel / unrealistically large EPS values before serving."""
            if v is None:
                return None
            try:
                fv = float(v)
            except (TypeError, ValueError):
                return None
            if fv in _EPS_SENTINELS or abs(fv) == 999 or abs(fv) == 9999 or abs(fv) > 200:
                _logger.warning("Calendar: bad eps value %.2f for %s — nulled", fv, sym)
                return None
            return fv

        def _chip(c: dict) -> dict:
            # Wire chips store rev as raw dollars (millions × 1_000_000); convert back to millions.
            def _to_m(v):
                if v is None: return None
                return v / 1_000_000 if v > 1_000_000 else v
            sym = c.get("sym", "")
            # Use backup eps_est if primary was a sentinel and got nulled
            eps_est = _clean_eps(c.get("eps_est"), sym)
            if eps_est is None and c.get("eps_est_backup") is not None:
                eps_est = _clean_eps(c.get("eps_est_backup"), sym)
            return {
                "sym":     sym,
                "eps_est": eps_est,
                "eps_act": _clean_eps(c.get("eps_act"), sym),
                "rev_est": _to_m(c.get("rev_est")),
                "rev_act": _to_m(c.get("rev_act")),
                "ew":      int(c.get("ew", c.get("ew_total", 0)) or 0),
                "mc_b":    c.get("mc_b"),   # market cap in billions (for client-side filtering)
                "time_et": c.get("time_et"),  # A5: precise report time (ISO string in ET or None)
            }

        def _keep(c: dict) -> bool:
            """Filter to tradeable names: $300M+ mcap, in cap_universe if available."""
            sym = c.get("sym", "")
            # If we have a cap_universe (from engine), use it as the primary gate
            if cap_universe:
                return sym in cap_universe
            # Fallback: use mc_b from the chip data
            mc = c.get("mc_b")
            return mc is None or mc >= 0.3  # None = unknown, let through; < $300M = drop

        days[ds] = {
            "label":    wd.get("label", d.strftime("%a %b ") + str(d.day)),
            "day":      wd.get("day",   d.strftime("%A")),
            "is_today": d == today,
            "bmo":      [_chip(c) for c in wd.get("bmo", []) if _keep(c)],
            "amc":      [_chip(c) for c in wd.get("amc", []) if _keep(c)],
            "tbd":      [],   # wire data carries only bmo/amc buckets
            "econ":     [],   # placeholder — always overwritten by ForexFactory below
            "fed":      [],
        }
    return days


# ── Finviz Elite live supplement ───────────────────────────────────────────────

def _fetch_finviz_week(week_date_strs: list[str]) -> dict[str, dict]:
    """Fetch this week's earners from Finviz Elite — single bulk call.

    Returns {YYYY-MM-DD: {bmo: [{sym, eps_est, rev_est_m, timing}], amc: [...]}}
    Only used in the live fallback path to supplement EarningsWhispers.
    Silent no-op if FINVIZ_API_KEY absent or request fails.
    """
    token = os.environ.get("FINVIZ_API_KEY") or os.environ.get("FINVIZ_TOKEN")
    if not token:
        return {}

    url = f"https://elite.finviz.com/export.ashx?v=111&f=earningsdate_thisweek&auth={token}"
    try:
        import requests, csv, io
        r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15, allow_redirects=True)
        if not r.ok:
            _logger.warning("Finviz earnings fetch HTTP %d", r.status_code)
            return {}
        rows = list(csv.DictReader(io.StringIO(r.text)))
    except Exception as exc:
        _logger.warning("Finviz earnings fetch failed: %s", exc)
        return {}

    # Column lookup (case-insensitive)
    def _gcol(row: dict, *names: str):
        for n in names:
            for k in row:
                if k.strip().lower() == n.lower():
                    v = row[k]
                    return v.strip() if v else None
        return None

    result: dict[str, dict] = {}
    for row in rows:
        sym = _gcol(row, "Ticker")
        if not sym:
            continue

        earnings_raw = _gcol(row, "Earnings") or ""
        # Format: "Mar 25 BMO" or "Mar 25 AMC" or "Mar 25"
        timing = "tbd"
        date_str_fv = None
        parts = earnings_raw.split()
        if len(parts) >= 2:
            try:
                import calendar as _cal
                months = {m.lower(): i for i, m in enumerate(_cal.month_abbr) if m}
                mon_s = parts[0].lower()
                day_s = parts[1]
                if mon_s in months:
                    mon_i = months[mon_s]
                    day_i = int(day_s)
                    # Find year by matching against week
                    for ds in week_date_strs:
                        d = date.fromisoformat(ds)
                        if d.month == mon_i and d.day == day_i:
                            date_str_fv = ds
                            break
            except (ValueError, IndexError):
                pass
            if len(parts) >= 3:
                t = parts[2].lower()
                if t == "bmo":
                    timing = "bmo"
                elif t == "amc":
                    timing = "amc"

        if not date_str_fv:
            continue

        eps_raw = _gcol(row, "EPS next Q", "EPS Next Q")
        eps_est: float | None = None
        try:
            if eps_raw and eps_raw not in ("-", ""):
                eps_est = float(eps_raw.replace("$", ""))
        except ValueError:
            pass

        rev_raw = _gcol(row, "Sales next Q", "Sales Next Q", "Revenue next Q")
        rev_est_m: float | None = None
        try:
            if rev_raw and rev_raw not in ("-", ""):
                v = rev_raw.replace("$", "").replace(",", "")
                if v.endswith("B"):
                    rev_est_m = float(v[:-1]) * 1000
                elif v.endswith("M"):
                    rev_est_m = float(v[:-1])
                else:
                    rev_est_m = float(v)
        except ValueError:
            pass

        if date_str_fv not in result:
            result[date_str_fv] = {"bmo": [], "amc": [], "tbd": []}
        result[date_str_fv][timing].append({
            "sym":     sym,
            "eps_est": eps_est,
            "rev_est": rev_est_m,
        })

    return result


def _fetch_ew_day_resilient(ds: str) -> list:
    """Fetch one EarningsWhispers day with retries. EW connection-drops rapid
    bursts, so callers MUST pace these sequentially. Never raises — returns []
    only after every attempt fails."""
    import time as _time
    from api.services.engine import _fetch_ew_live
    last_exc = None
    for attempt in range(_EW_RETRIES + 1):
        try:
            return _fetch_ew_live(ds)
        except Exception as exc:  # any failure is retried, then swallowed
            last_exc = exc
            if attempt < _EW_RETRIES:
                _time.sleep(_EW_RETRY_BACKOFF * (attempt + 1))
    _logger.warning("EW fetch failed for %s after %d attempts: %s",
                    ds, _EW_RETRIES + 1, last_exc)
    return []


# ── Live EarningsWhispers + Finviz path ────────────────────────────────────────

def _build_live(week_dates: list[date], today: date) -> dict:
    """Sequential paced EarningsWhispers fetch + Finviz Elite supplement per weekday."""
    week_date_strs = [d.strftime("%Y-%m-%d") for d in week_dates]
    results: dict[str, dict] = {}

    # Pre-fetch Finviz (one bulk call for the whole week) in parallel with EW threads
    fv_result: dict[str, dict] = {}
    fv_done = threading.Event()

    def _fetch_fv():
        try:
            fv_result.update(_fetch_finviz_week(week_date_strs))
        except Exception as exc:
            _logger.warning("Finviz live supplement failed: %s", exc)
        finally:
            fv_done.set()

    fv_thread = threading.Thread(target=_fetch_fv, daemon=True)
    fv_thread.start()

    def _fetch(d: date) -> None:
        ds = d.strftime("%Y-%m-%d")
        raw = _fetch_ew_day_resilient(ds)

        _EPS_SENTINELS_LIVE = frozenset({999.0, -999.0, 9999.0, -9999.0, 999.99, -999.99})

        def _clean_eps_live(v):
            if v is None: return None
            try:
                fv = float(v)
            except (TypeError, ValueError):
                return None
            if fv in _EPS_SENTINELS_LIVE or abs(fv) == 999 or abs(fv) > 200:
                return None
            return fv

        bmo: list[dict] = []
        amc: list[dict] = []
        seen: set[str] = set()
        for item in raw:
            sym = item["symbol"]
            seen.add(sym)
            # A5: thread any precise report time (EW doesn't provide one yet;
            # placeholder for future enrichment — field is None by default)
            time_et = item.get("report_time_et") or item.get("time_et") or None
            entry = {
                "sym":     sym,
                "eps_est": _clean_eps_live(item.get("eps_estimate")),
                "eps_act": _clean_eps_live(item.get("eps_actual")),
                "rev_est": item.get("rev_estimate"),  # already in millions from _fetch_ew_live
                "rev_act": item.get("rev_actual"),    # already in millions from _fetch_ew_live
                "ew":      int(item.get("ew_total", 0) or 0),
                "time_et": time_et,   # A5: ISO datetime string in ET, or None
            }
            (bmo if item["hour"] == "bmo" else amc).append(entry)

        results[ds] = {
            "label":    d.strftime("%a %b ") + str(d.day),
            "day":      d.strftime("%A"),
            "is_today": d == today,
            "bmo":      bmo,
            "amc":      amc,
            "tbd":      [],     # EW timing is binary; Finviz merge may add tbd names
            "_seen":    seen,   # temp field for Finviz merge
            "econ":     [],
            "fed":      [],
        }

    # EW is fetched SEQUENTIALLY with a short delay — parallel bursts get
    # connection-dropped by EW (≈4/5 blocked → empty calendar).
    import time as _time
    for i, d in enumerate(week_dates):
        if i:
            _time.sleep(_EW_PACE_SECONDS)
        _fetch(d)

    # Wait for the (parallel) Finviz bulk call
    fv_done.wait(timeout=5)

    # Merge Finviz tickers not already in EW, using Finviz estimates.
    # A Finviz row with no session marker lands in "tbd" — an unknown session is
    # rendered as unknown, never coerced into AMC (that lie burned us).
    for ds, day in results.items():
        seen = day.pop("_seen", set())
        fv_day = fv_result.get(ds, {})
        for timing_key in ("bmo", "amc", "tbd"):
            for fv_entry in fv_day.get(timing_key, []):
                sym = fv_entry["sym"]
                if sym in seen:
                    continue
                seen.add(sym)
                day[timing_key].append({
                    "sym":     sym,
                    "eps_est": fv_entry["eps_est"],
                    "eps_act": None,
                    "rev_est": fv_entry["rev_est"],
                    "rev_act": None,
                    "ew":      0,
                })

        for bucket in ("bmo", "amc", "tbd"):
            day[bucket].sort(key=lambda x: x["ew"], reverse=True)
            day[bucket] = day[bucket][:40]

    return results


# ── Finnhub actuals patch ─────────────────────────────────────────────────────

def _patch_today_actuals(days: dict, today_str: str) -> None:
    """Fill ACTUALS for every reporter this week whose date is today OR EARLIER.

    A Thursday BMO name (e.g. PEP) that already printed must show its beat/miss
    on Friday — patching only 'today' left every earlier-this-week reporter stuck
    on its estimate (the "PEP earnings went live but aren't there" bug). One
    Finnhub range call over [earliest past day … today] covers them all; future
    days can't have actuals so they're skipped.

    Finnhub is the primary leg (fastest, session-aware). An FMP breadth leg
    (chunked one call per day — see `_fmp_range_week`) runs afterward and
    fills whatever Finnhub left pending — a throttle, a 429, or no Finnhub key
    at all. It only ever fills a still-null field on an entry that ALREADY
    exists in `days` (Finnhub/EW/Finviz already decided its bmo/amc/tbd
    bucket) — it can never add a new bmo/amc member, since FMP carries no
    session field.
    """
    # Only days that could already have printed (today or earlier).
    past_dates = sorted(ds for ds in days.keys() if ds <= today_str)
    if not past_dates:
        return

    # Every still-pending reporter across those days, grouped by symbol (a name
    # can appear once per week, but group defensively).
    pending_by_sym: dict[str, list[dict]] = {}
    for ds in past_dates:
        for e in _day_entries(days[ds]):
            if e.get("eps_act") is None and e.get("sym"):
                pending_by_sym.setdefault(e["sym"], []).append(e)
    if not pending_by_sym:
        return

    fh_key = os.environ.get("FINNHUB_API_KEY")
    if fh_key:
        try:
            # Routed through the shared finnhub_client.fh_get (2026-08-05) so
            # this call shares the process-wide token bucket / 429 cooldown
            # with every other Finnhub caller in the codebase — a raw
            # requests.get here spent the SAME account budget with no
            # coordination. This also drops the old manual "sleep(2) then
            # retry once" on a 429: `_patch_today_actuals` runs on the
            # request path (GET /api/calendar), so a blocking sleep here held
            # an anyio threadpool worker for 2s at exactly the moment — mid
            # rate-limit burst — when threads are scarcest. fh_get degrades
            # instead: None immediately, no wait; the FMP leg below (or the
            # next 10-min rebuild) picks up the slack; the sticky-actuals
            # ledger means a miss here never regresses an actual that already
            # printed.
            from api.services.finnhub_client import fh_get
            data = fh_get("/calendar/earnings", {"from": past_dates[0], "to": today_str}, timeout=10)
            if isinstance(data, dict):
                fh_map = {
                    e["symbol"]: e
                    for e in data.get("earningsCalendar", [])
                    if e.get("symbol") in pending_by_sym and e.get("epsActual") is not None
                }
                patched = 0
                for sym, entries in pending_by_sym.items():
                    fh = fh_map.get(sym)
                    if not fh:
                        continue
                    for entry in entries:
                        entry["eps_act"] = round(float(fh["epsActual"]), 2)
                        if entry.get("eps_est") is None and fh.get("epsEstimate") is not None:
                            entry["eps_est"] = round(float(fh["epsEstimate"]), 2)
                        rev_a = fh.get("revenueActual")
                        rev_e = fh.get("revenueEstimate")
                        if rev_a:
                            entry["rev_act"] = rev_a / 1_000_000
                        if rev_e and entry.get("rev_est") is None:
                            entry["rev_est"] = rev_e / 1_000_000
                        patched += 1
                if patched:
                    _logger.info("Calendar: Finnhub patched %d actuals through %s", patched, today_str)
        except Exception as exc:
            _logger.warning("Calendar: Finnhub actuals patch failed: %s", exc)

    # ── FMP breadth fallback — fills whatever is STILL pending (Finnhub
    # throttled, errored, or no key). Never adds a new bmo/amc member.
    still_pending = {
        sym: entries for sym, entries in pending_by_sym.items()
        if any(e.get("eps_act") is None for e in entries)
    }
    if not still_pending:
        return
    try:
        fmp_rows = _fmp_range_week(past_dates[0], today_str)
        if not fmp_rows:
            return
        fmp_map = {}
        for row in fmp_rows:
            sym = (row.get("symbol") or "").strip().upper()
            if sym in still_pending and row.get("epsActual") is not None:
                fmp_map[sym] = row
        patched = 0
        for sym, entries in still_pending.items():
            fr = fmp_map.get(sym)
            if not fr:
                continue
            for entry in entries:
                if entry.get("eps_act") is not None:
                    continue
                entry["eps_act"] = round(float(fr["epsActual"]), 2)
                if entry.get("eps_est") is None and fr.get("epsEstimated") is not None:
                    entry["eps_est"] = round(float(fr["epsEstimated"]), 2)
                rev_a = fr.get("revenueActual")
                rev_e = fr.get("revenueEstimated")
                if rev_a and entry.get("rev_act") is None:
                    entry["rev_act"] = rev_a / 1_000_000
                if rev_e and entry.get("rev_est") is None:
                    entry["rev_est"] = rev_e / 1_000_000
                patched += 1
        if patched:
            _logger.info("Calendar: FMP patched %d actuals through %s", patched, today_str)
    except Exception as exc:
        _logger.warning("Calendar: FMP actuals patch failed: %s", exc)


# ── Sticky actuals — printed results must never disappear ─────────────────────
#
# The weekly cache rebuilds from EW+Finviz every 10 min. When a rebuild lands
# while the Finnhub patch is rate-limited (429), the fresh actual-less build
# used to REPLACE a cache that already showed actuals — reported EPS/revenue
# would appear, then vanish until a later rebuild got lucky. This ledger on the
# /data volume makes actuals one-way: once a build has them, every later build
# inherits them (and they survive redeploys).

_STICKY_ACTUALS_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "calendar_actuals.json")
_STICKY_KEEP_DAYS = 14
_STICKY_FIELDS = ("eps_act", "rev_act", "eps_est", "rev_est")
_sticky_actuals_lock = threading.Lock()


def _merge_sticky_actuals(days: dict, today_str: str) -> None:
    """Harvest reported actuals into the on-disk ledger AND backfill any entry
    whose actuals a degraded rebuild dropped. Never raises."""
    with _sticky_actuals_lock:
        try:
            import json as _json
            try:
                with open(_STICKY_ACTUALS_PATH, encoding="utf-8") as f:
                    ledger = _json.load(f)
                if not isinstance(ledger, dict):
                    ledger = {}
            except (FileNotFoundError, ValueError):
                ledger = {}

            changed = False
            for ds, day in days.items():
                if ds > today_str:
                    continue  # future days can't have actuals
                day_map = ledger.get(ds) or {}
                for e in _day_entries(day):
                    sym = e.get("sym")
                    if not sym:
                        continue
                    if e.get("eps_act") is not None:
                        snap = {k: e.get(k) for k in _STICKY_FIELDS}
                        if day_map.get(sym) != snap:
                            day_map[sym] = snap
                            changed = True
                    elif sym in day_map:
                        held = day_map[sym]
                        e["eps_act"] = held.get("eps_act")
                        if e.get("rev_act") is None:
                            e["rev_act"] = held.get("rev_act")
                        if e.get("eps_est") is None:
                            e["eps_est"] = held.get("eps_est")
                        if e.get("rev_est") is None:
                            e["rev_est"] = held.get("rev_est")
                if day_map:
                    ledger[ds] = day_map

            cutoff = (date.fromisoformat(today_str) - timedelta(days=_STICKY_KEEP_DAYS)).isoformat()
            stale = [ds for ds in ledger if ds < cutoff]
            for ds in stale:
                del ledger[ds]

            if changed or stale:
                tmp = _STICKY_ACTUALS_PATH + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    _json.dump(ledger, f)
                os.replace(tmp, _STICKY_ACTUALS_PATH)
        except Exception as exc:
            _logger.warning("Calendar: sticky actuals merge failed: %s", exc)


# ── Sticky reporters — a day's reporters must never disappear when it rolls past
#
# Sibling of the sticky-actuals ledger above, for the ROSTER rather than the
# numbers. Two failure modes converge the morning after a day passes: EW drops
# every name that reported (it's a forward SCHEDULE), and the provider range
# backfill lags ~a day on the just-ended day — so a name like DDOG that showed in
# Pre-Market all day is suddenly gone from "yesterday" until the providers catch
# up. This ledger remembers each day's reporters (symbol -> session + EW rank +
# estimates) while the day is live, and re-adds any that a degraded rebuild drops.
_STICKY_ROSTER_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "calendar_roster.json")
_sticky_roster_lock = threading.Lock()


def _roster_rank(snap: dict) -> tuple:
    """Keep-richest key: a confirmed session (bmo/amc) beats tbd, then higher EW."""
    return (1 if snap.get("session") in ("bmo", "amc") else 0, int(snap.get("ew") or 0))


def _load_json_dict(path: str) -> dict:
    """Read a JSON object off disk; {} on any absence/corruption. Never raises."""
    try:
        import json as _json
        with open(path, encoding="utf-8") as f:
            d = _json.load(f)
        return d if isinstance(d, dict) else {}
    except (FileNotFoundError, ValueError, OSError):
        return {}


def _restore_sticky_reporters(days: dict, today_str: str) -> None:
    """Harvest each day's roster while it's live, and re-add reporters a degraded
    PAST-day rebuild dropped, to their remembered session bucket.

    As a bridge for days that passed BEFORE this ledger existed, it also re-adds
    any symbol the sticky-ACTUALS ledger already has a print for — into Time TBD,
    since that ledger carries no session — so a just-passed day is repaired on the
    very first run instead of only from the next day forward. Runs BEFORE
    `_merge_sticky_actuals`, so a roster-restored name (added without actuals)
    still gets its printed numbers filled in. Never raises."""
    with _sticky_roster_lock:
        try:
            import json as _json
            roster = _load_json_dict(_STICKY_ROSTER_PATH)
            changed = False

            # 1. Harvest today + past: remember each reporter's session/rank/estimates.
            for ds, day in days.items():
                if ds > today_str:
                    continue                     # future roster isn't settled yet
                day_map = roster.get(ds) or {}
                for bucket in ("bmo", "amc", "tbd"):
                    for e in day.get(bucket, []):
                        sym = e.get("sym")
                        if not sym:
                            continue
                        snap = {"session": bucket, "ew": int(e.get("ew") or 0),
                                "eps_est": e.get("eps_est"), "rev_est": e.get("rev_est")}
                        prev = day_map.get(sym)
                        if prev is None or _roster_rank(snap) > _roster_rank(prev):
                            day_map[sym] = snap
                            changed = True
                if day_map:
                    roster[ds] = day_map

            # 2. Restore PAST days from the roster (session-correct) + the actuals
            #    ledger bridge (Time TBD) for names the roster doesn't have yet.
            actuals = _load_json_dict(_STICKY_ACTUALS_PATH)
            for ds, day in days.items():
                if ds >= today_str:
                    continue                     # today/future own their live roster
                present = {e.get("sym") for e in _day_entries(day) if e.get("sym")}
                for sym, held in (roster.get(ds) or {}).items():
                    if sym in present:
                        continue
                    bucket = held.get("session") if held.get("session") in ("bmo", "amc", "tbd") else "tbd"
                    day.setdefault(bucket, []).append({
                        "sym": sym, "eps_est": held.get("eps_est"), "eps_act": None,
                        "rev_est": held.get("rev_est"), "rev_act": None,
                        "ew": int(held.get("ew") or 0), "mc_b": None, "time_et": None})
                    present.add(sym)
                for sym, held in (actuals.get(ds) or {}).items():
                    if sym in present or not isinstance(held, dict):
                        continue
                    if held.get("eps_act") is None and held.get("rev_act") is None:
                        continue                 # only re-add names we have a print for
                    day.setdefault("tbd", []).append({
                        "sym": sym, "eps_est": held.get("eps_est"), "eps_act": held.get("eps_act"),
                        "rev_est": held.get("rev_est"), "rev_act": held.get("rev_act"),
                        "ew": 0, "mc_b": None, "time_et": None})
                    present.add(sym)

            cutoff = (date.fromisoformat(today_str) - timedelta(days=_STICKY_KEEP_DAYS)).isoformat()
            stale = [ds for ds in roster if ds < cutoff]
            for ds in stale:
                del roster[ds]

            if changed or stale:
                tmp = _STICKY_ROSTER_PATH + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    _json.dump(roster, f)
                os.replace(tmp, _STICKY_ROSTER_PATH)
        except Exception as exc:                 # noqa: BLE001
            _logger.warning("Calendar: sticky reporter restore failed: %s", exc)


# ── Month-range helpers ────────────────────────────────────────────────────────

def _load_cap_universe() -> set[str]:
    """Load the static cap_universe ticker set.  Never raises — returns empty set."""
    try:
        # Try wire_data first (most up-to-date)
        from api.services.engine import _load_wire_data
        wire = _load_wire_data()
        if wire and wire.get("cap_universe"):
            return set(wire["cap_universe"])
    except Exception:
        pass
    # Fallback: load from static JSON file
    try:
        import json
        path = os.path.join(os.path.dirname(__file__), "..", "data", "cap_universe.json")
        with open(path) as f:
            return set(json.load(f))
    except Exception:
        return set()


def _fh_get_month(from_date: str, to_date: str) -> dict | None:
    """Fetch Finnhub /calendar/earnings for a full date range.

    Routed through the shared api.services.finnhub_client.fh_get — every
    Finnhub caller in the codebase shares ONE process-wide token bucket / 429
    cooldown (2026-08-05; see finnhub_client.py's module docstring). Returns
    the raw JSON dict, or None on failure/budget-shed (fh_get logs the reason
    itself — 429/403/missing key/etc. — so no duplicate logging here).
    """
    from api.services.finnhub_client import fh_get
    data = fh_get("/calendar/earnings", {"from": from_date, "to": to_date}, timeout=15)
    return data if isinstance(data, dict) else None


# ── Past-day backfill (current week only) ─────────────────────────────────────

# A FINISHED day is a record, not a forecast, so it is capped far looser than
# the live path's 40. `_build_live`'s 40 bounds a forward SCHEDULE where EW's
# anticipation rank decides who matters; once the day is over, truncating it
# just hides names that already reported — measured 2026-07-30, a 40-cap showed
# only 96 of Wed 7/29's 240 in-universe reporters. 150 clears the observed
# per-session max (132) with headroom and still bounds the payload.
_PAST_SESSION_CAP = 150


def _fetch_finviz_past_sessions(past_ds: set[str],
                                 filt: str = "earningsdate_thisweek") -> dict[str, dict[str, str]]:
    """{date: {SYM: 'bmo'|'amc'}} for this week's ALREADY-PASSED days, from
    Finviz Elite's CUSTOM export.

    This exists because the claim in `_backfill_past_days` — that Finviz rolls
    a reported company forward and stops matching `earningsdate_thisweek` — is
    true of the PRESET view (`v=111`) the live path uses, and NOT of the custom
    view. Measured 2026-08-06, `v=152&c=0,1,68` returned the whole week
    including every past day: Mon 125, Tue 314, Wed 464, Thu 473, Fri 51.
    (`earningsdate_prevweek` retains a further week — unused here, since this
    function only serves the current week's history.)

    Finviz encodes the session as a SENTINEL CLOCK TIME, not a real one:
    8:30 AM = BMO, 4:30 PM = AMC, and those two values covered 1,427 of 1,429
    rows. Parsed as a threshold rather than an equality so a future sentinel
    change degrades to `tbd` instead of silently mislabelling every row.

    ⚠️ The export mixes TWO date formats in one response (`8/6/2026` and
    `08/06/2026`); matching only the unpadded one silently drops rows.

    Never raises — a Finviz failure must leave the past-day merge exactly as
    it was. Returns {} when the token is absent.
    """
    token = os.environ.get("FINVIZ_API_KEY") or os.environ.get("FINVIZ_TOKEN")
    if not token or not past_ds:
        return {}
    url = (f"https://elite.finviz.com/export.ashx?v=152"
           f"&f={filt}&c=0,1,68&auth={token}")
    try:
        import requests as _rq, csv as _csv, io as _io
        r = _rq.get(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "text/csv"},
                    timeout=20, allow_redirects=True)
        if not r.ok:
            _logger.warning("Finviz session fetch HTTP %d", r.status_code)
            return {}
        rows = list(_csv.DictReader(_io.StringIO(r.text)))
    except Exception as exc:
        _logger.warning("Finviz session fetch failed: %s", exc)
        return {}

    out: dict[str, dict[str, str]] = {}
    for row in rows:
        sym = (row.get("Ticker") or "").strip().upper()
        raw = (row.get("Earnings Date") or "").strip()
        if not sym or not raw:
            continue
        parts = raw.split(None, 1)
        try:
            m, d, y = (int(x) for x in parts[0].split("/"))   # handles 8/6 and 08/06
            ds = date(y, m, d).isoformat()
        except (ValueError, IndexError):
            continue
        if ds not in past_ds:
            continue
        timing = None
        if len(parts) > 1:
            try:
                t = datetime.strptime(parts[1].strip(), "%I:%M:%S %p").time()
                if t.hour < 9 or (t.hour == 9 and t.minute < 30):
                    timing = "bmo"
                elif t.hour >= 16:
                    timing = "amc"
            except ValueError:
                timing = None
        if timing:
            out.setdefault(ds, {})[sym] = timing
    return out


def _finviz_week_filter(monday: date, today: date) -> str | None:
    """Which Finviz week filter (if any) covers `monday`'s week.

    Finviz exposes only `thisweek` and `prevweek` — there is no arbitrary date
    range on this endpoint. Anything older than last week returns None and the
    caller simply skips the leg rather than firing a request that cannot match
    (see `lesson_finviz_ignores_invalid_filter_tokens`: an unrecognised filter
    token is DROPPED silently, so a bogus one would quietly return the WRONG
    week's rows rather than erroring).
    """
    this_monday = today - timedelta(days=today.weekday())
    if monday == this_monday:
        return "earningsdate_thisweek"
    if monday == this_monday - timedelta(days=7):
        return "earningsdate_prevweek"
    return None


def _merge_finviz_sessions(days: dict, target_ds: set[str], filt: str,
                           keep, sym_index: dict, rebucket: bool = True) -> tuple[int, int]:
    """Apply the Finviz session leg to `days`. Returns (added, moved).

    ONE implementation for both the current-week backfill and the range-week
    build — the two differ only in which filter covers their dates, and a
    second copy of this merge would drift from the first.

    Only ever FILLS a missing session; a symbol Finnhub already placed keeps
    its bucket. Never raises.

    `rebucket=False` disables moving a known entry out of `tbd`, because the
    per-session cap is applied AFTER this runs: moving rows into `bmo`/`amc`
    can push those buckets past their limit and the surplus is CUT. Measured on
    the previous week, whose cap is a tight [:40]:

        re-bucket + add   430 reporters, 341 sessioned
        add-only          496 reporters, 333 sessioned

    66 reporters recovered for 8 sessions — so the range path adds only. The
    current-week path keeps re-bucketing: its cap is 150, loose enough that the
    same measurement showed a clean +69 reporters with no loss.
    """
    added = moved = 0
    try:
        sessions = _fetch_finviz_past_sessions(target_ds, filt)
    except Exception as exc:
        _logger.warning("Finviz session merge failed: %s", exc)
        return 0, 0
    for ds, sym_timing in sessions.items():
        day = days.get(ds)
        if day is None:
            continue
        for sym, timing in sym_timing.items():
            if not keep(sym):
                continue
            # Scan the DAY, not just `sym_index` — that index only holds what
            # the earlier legs touched, so trusting it appends a DUPLICATE row
            # for anything the live schedule already placed.
            existing = next((e for e in _day_entries(day) if e.get("sym") == sym), None)
            if existing is None:
                day.setdefault(timing, []).append({
                    "sym": sym, "eps_est": None, "eps_act": None,
                    "rev_est": None, "rev_act": None,
                    "ew": 0, "mc_b": None, "time_et": None,
                })
                sym_index.setdefault(ds, {})[sym] = day[timing][-1]
                added += 1
                continue
            if not rebucket:
                continue
            tbd = day.get("tbd") or []
            if existing in tbd and timing in ("bmo", "amc"):
                tbd.remove(existing)
                day.setdefault(timing, []).append(existing)
                moved += 1
    return added, moved


def _backfill_past_days(days: dict, week_dates: list[date], today: date,
                        cap_uni: set | None) -> int:
    """Refill the current week's ALREADY-PASSED days from Finnhub's range calendar.

    EarningsWhispers is a forward-looking SCHEDULE, not an archive: once a
    company reports, EW drops it from that date.

    Finviz was believed to behave the same way ("its `Earnings` column rolls to
    the next quarter, so `earningsdate_thisweek` stops matching it"). That is
    true only of the PRESET view (`v=111`) the live path uses. The CUSTOM view
    retains the whole week including past days — measured 2026-08-06, `v=152`
    returned Mon 125 / Tue 314 / Wed 464 against EW's handful. It is now the
    third leg below, where it resolves the session field the other two are
    weakest on. See `_fetch_finviz_past_sessions`.
    `_build_live` rebuilds the whole week on every cache miss, so Monday — then
    Tuesday — progressively empties while the week is still open (2026-07-30: EW
    served 2 names for Mon 7/27 and 6 for Tue 7/28 against Finnhub's 119 / 180).
    The `live_total == 0` wire fallback never catches it, because today and
    tomorrow are always full. Every OTHER week already reads the retentive
    Finnhub range via `_build_range_week`; this brings the current week's history
    to the same source.

    TODAY and FUTURE days are deliberately untouched — the live schedule owns
    them, and today's actuals are `_patch_today_actuals`' job.

    Merge rule: a symbol the schedule still carries KEEPS its entry (EW resolves
    the BMO/AMC session and carries the `ew` anticipation rank that drives
    ordering); only its blank actuals/estimates are filled. Symbols the schedule
    has dropped are added back.

    One extra Finnhub range call per `calendar_weekly` miss (10-min TTL), so ~6/h,
    PLUS an FMP breadth leg (chunked one call per past day — see
    `_fmp_range_week`) that fills the same days when Finnhub returns nothing
    (429/error) or fills a still-blank estimate Finnhub left null. Finnhub
    wins on session/quarter/year; an FMP-only symbol lands in `tbd` (FMP
    carries no session field — never coerced into bmo/amc). Never raises — a
    double provider failure leaves the live week exactly as it was. Returns
    the number of entries added.
    """
    past = [d for d in week_dates if d < today]
    if not past:
        return 0

    from_ds, to_ds = past[0].isoformat(), past[-1].isoformat()
    added = 0
    try:
        rows = (_fh_get_month(from_ds, to_ds) or {}).get("earningsCalendar") or []

        _EPS_SENTINELS = frozenset({999.0, -999.0, 9999.0, -9999.0, 999.99, -999.99})

        def _clean_eps(v):
            if v is None:
                return None
            try:
                fv = float(v)
            except (TypeError, ValueError):
                return None
            if fv in _EPS_SENTINELS or abs(fv) > 200:
                return None
            return round(fv, 2)

        def _keep(sym: str) -> bool:
            # Same universe rule as _build_range_week, so a past day's count
            # stays comparable with that same day viewed from another week.
            if cap_uni:
                return sym in cap_uni
            return _is_us_symbol(sym)

        past_ds = {d.isoformat() for d in past}
        touched: set[str] = set()
        # sym -> entry per day, populated as Finnhub rows land, so the FMP
        # merge below can find "did Finnhub already have this symbol" in O(1).
        sym_index: dict[str, dict[str, dict]] = {ds: {} for ds in past_ds}

        for row in rows:
            sym = (row.get("symbol") or "").strip().upper()
            ds  = (row.get("date") or "").strip()
            if not sym or ds not in past_ds or not _keep(sym):
                continue
            day = days.get(ds)
            if day is None:
                continue

            rev_est_raw = row.get("revenueEstimate")
            rev_act_raw = row.get("revenueActual")
            fields = {
                "eps_est": _clean_eps(row.get("epsEstimate")),
                "eps_act": _clean_eps(row.get("epsActual")),
                "rev_est": round(rev_est_raw / 1_000_000, 1) if rev_est_raw else None,
                "rev_act": round(rev_act_raw / 1_000_000, 1) if rev_act_raw else None,
            }

            existing = next((e for e in _day_entries(day) if e.get("sym") == sym), None)
            if existing is not None:
                for k, v in fields.items():
                    if existing.get(k) is None and v is not None:
                        existing[k] = v
                sym_index[ds][sym] = existing
                touched.add(ds)
                continue

            hour = (row.get("hour") or "").lower()
            timing = hour if hour in ("bmo", "amc") else "tbd"
            entry = {
                "sym": sym, **fields,
                "ew": 0, "mc_b": None, "time_et": None,
            }
            day.setdefault(timing, []).append(entry)
            sym_index[ds][sym] = entry
            added += 1
            touched.add(ds)

        # ── FMP breadth leg — ALWAYS attempted (own bounded timeout, chunked
        # one call per past day; short-circuits to None with no network call
        # when FMP_API_KEY is unset). This is what keeps a past day non-empty
        # when Finnhub 429s/errors entirely — `rows` above can be `[]` and
        # this leg still runs (no early return on an empty Finnhub result).
        fmp_rows = _fmp_range_week(from_ds, to_ds)
        if fmp_rows:
            for row in fmp_rows:
                sym = (row.get("symbol") or "").strip().upper()
                ds  = str(row.get("date") or "")[:10]
                if not sym or ds not in past_ds or not _keep(sym):
                    continue
                day = days.get(ds)
                if day is None:
                    continue

                rev_est_raw = row.get("revenueEstimated")
                rev_act_raw = row.get("revenueActual")
                existing = sym_index.get(ds, {}).get(sym)
                if existing is not None:
                    if existing.get("eps_est") is None:
                        v = _clean_eps(row.get("epsEstimated"))
                        if v is not None:
                            existing["eps_est"] = v
                    if existing.get("eps_act") is None:
                        v = _clean_eps(row.get("epsActual"))
                        if v is not None:
                            existing["eps_act"] = v
                    if existing.get("rev_est") is None and rev_est_raw:
                        existing["rev_est"] = round(rev_est_raw / 1_000_000, 1)
                    if existing.get("rev_act") is None and rev_act_raw:
                        existing["rev_act"] = round(rev_act_raw / 1_000_000, 1)
                    touched.add(ds)
                    continue

                entry = {
                    "sym": sym,
                    "eps_est": _clean_eps(row.get("epsEstimated")),
                    "eps_act": _clean_eps(row.get("epsActual")),
                    "rev_est": round(rev_est_raw / 1_000_000, 1) if rev_est_raw else None,
                    "rev_act": round(rev_act_raw / 1_000_000, 1) if rev_act_raw else None,
                    "ew": 0, "mc_b": None, "time_et": None,
                }
                day.setdefault("tbd", []).append(entry)
                sym_index.setdefault(ds, {})[sym] = entry
                added += 1
                touched.add(ds)

        # ── Finviz Elite leg — a THIRD independent past-day source.
        #
        # Measured on the real week 2026-08-03..05 (A/B, this leg on vs off):
        #
        #     Finnhub + FMP            492 reporters, 329 with a session
        #     + Finviz                 418 reporters, 341 with a session
        #     Finnhub DOWN, FMP only   200 reporters,   0 with a session
        #     Finnhub DOWN, FMP+Finviz 380 reporters, 338 with a session
        #
        # CORRECTION: an earlier version of this comment claimed FMP returned
        # NOTHING under a Finnhub outage. That was measured with FMP_API_KEY
        # absent from the local environment — FMP works fine and serves 200
        # reporters. What it genuinely cannot do is SESSION them: FMP carries
        # no session field, so all 200 land in `tbd`. That is the real gap this
        # leg fills — 0 sessioned becomes 338, not 0 reporters becomes 692.
        #
        # It does NOT rescue "Time TBD", which is what this leg was originally
        # built for: of the 264 tbd rows Finnhub+FMP leave behind, Finviz had a
        # session for exactly ONE. The two populations are near-disjoint —
        # Finviz's screener simply does not carry those names. The +70 sessioned
        # rows above are symbols it ADDS, not tbd rows it re-buckets.
        #
        # Runs LAST on purpose: it only ever fills a session that is missing.
        # Finnhub's `hour` still wins where it exists — redundancy for a gap,
        # never a second opinion overriding a good answer.
        fv_added, moved = _merge_finviz_sessions(
            days, past_ds, "earningsdate_thisweek", _keep, sym_index)
        added += fv_added
        if fv_added or moved:
            touched.update(past_ds)
            _logger.info("Calendar: Finviz added %d past-day reporters, "
                         "re-bucketed %d out of Time TBD", fv_added, moved)

        # Re-order + re-cap only the days the backfill touched. EW-ranked names
        # stay on top (that ordering is what the live path serves); the ew=0
        # tail takes _build_range_week's rule — estimate-bearing first, then
        # alphabetical — so the cap cuts deterministically instead of by
        # provider response order.
        for ds in touched:
            day = days[ds]
            for bucket in ("bmo", "amc", "tbd"):
                bucket_rows = day.get(bucket) or []
                bucket_rows.sort(key=lambda e: (
                    -(e.get("ew") or 0),
                    e.get("eps_est") is None and e.get("rev_est") is None,
                    e.get("sym") or "",
                ))
                day[bucket] = bucket_rows[:_PAST_SESSION_CAP]

        if added:
            _logger.info("Calendar: backfilled %d past-day reporters from Finnhub+FMP (%s -> %s)",
                         added, from_ds, to_ds)
    except Exception as exc:
        _logger.warning("Calendar: past-day backfill failed: %s", exc)

    return added


# ── Company names (batched, non-blocking) ─────────────────────────────────────
# EarningsCard renders entry.name — permanently blank until now. Names come
# from the ticker_meta mem/disk cache ONLY (prewarmed for the cap universe);
# misses are queued to a tiny background pool so the NEXT build resolves them.
# This must NEVER block the calendar build on a provider call.

from concurrent.futures import ThreadPoolExecutor as _TPE  # noqa: E402

_NAME_POOL = _TPE(max_workers=2, thread_name_prefix="cal-names")
_NAME_INFLIGHT: set[str] = set()
_NAME_GUARD = threading.Lock()
_NAME_INFLIGHT_MAX = 24


def _attach_date_moves(days: dict) -> None:
    """Observe each reporter's date into the date-integrity store, then stamp
    any detected shift onto the entry as date_moved={from,to} (WSH-grade date
    drift). Best-effort — never breaks the calendar; a bad DB is a silent no-op.
    Only FUTURE-facing reporters are observed (a past date can't 'move')."""
    try:
        from api.services import calendar_date_integrity as _cdi
    except Exception:
        return
    today = _today_et().isoformat()
    pairs: list[tuple[str, str]] = []
    syms: list[str] = []
    for ds, day in days.items():
        if ds < today:
            continue
        for e in _day_entries(day):
            sym = (e.get("sym") or "").upper()
            if sym:
                pairs.append((sym, ds))
                syms.append(sym)
    if not pairs:
        return
    try:
        _cdi.observe_many(pairs)
        moves = _cdi.get_moves(syms)
    except Exception as exc:
        _logger.warning("Calendar date-integrity failed: %s", exc)
        return
    if not moves:
        return
    for day in days.values():
        for e in _day_entries(day):
            mv = moves.get((e.get("sym") or "").upper())
            if mv and mv.get("to") != mv.get("from"):
                e["date_moved"] = mv


_FV_NAME_TTL = 24 * 3600
_FV_NAME_WARMING = threading.Lock()
_FV_NAME_INFLIGHT = False


def _warm_finviz_name_map() -> None:
    """Build the map on ONE background thread, at most one at a time.

    Without the in-flight flag, every calendar build during the ~1s window
    before the first one lands would start its OWN whole-market fetch — a
    self-inflicted herd on exactly the surface this is trying to keep off the
    request path.
    """
    global _FV_NAME_INFLIGHT
    with _FV_NAME_WARMING:
        if _FV_NAME_INFLIGHT:
            return
        _FV_NAME_INFLIGHT = True

    def _run():
        global _FV_NAME_INFLIGHT
        try:
            out = _build_finviz_name_map()
            if out:
                cache.set("finviz_name_map", out, ttl=_FV_NAME_TTL)
        except Exception as exc:
            _logger.warning("Finviz name-map warm failed: %s", exc)
        finally:
            with _FV_NAME_WARMING:
                _FV_NAME_INFLIGHT = False

    threading.Thread(target=_run, daemon=True, name="finviz-name-map").start()


def _finviz_name_map() -> dict[str, dict]:
    """{TICKER: {name, sector}} for the WHOLE market, from one Finviz Elite call.

    `_attach_names` below is cache-hits-only by design, and its miss path is a
    2-worker pool capped at 24 in flight — fine for a handful of names, far too
    slow for a finished day carrying 400+ reporters, where most symbols miss and
    the card renders blank for many requests running.

    Finviz returns the entire market's Ticker/Company/Sector in ONE export, so a
    single call resolves what the trickle needs hundreds of requests to reach.
    Reuses `industry_map._fetch_finviz_universe` rather than issuing its own
    request — that helper already owns the token, the 301 redirect and the 90s
    timeout, and a second copy would drift from it.

    Cached 24h: names and sectors do not move intraday. Returns {} on any
    failure, so `_attach_names` just falls through to its existing path.
    """
    cached = cache.get("finviz_name_map")
    if cached is not None:
        return cached
    # NEVER build inline. Measured 0.89s warm-network, but
    # `_fetch_finviz_universe` carries a 90s timeout, and this runs on the
    # request path in a single-process uvicorn with ONE shared anyio
    # threadpool — a hung Finviz would pin a worker for a minute and a half
    # per calendar build. That is precisely the unbounded-external-call shape
    # behind the 2026-07-01 524 outage.
    #
    # So: kick a bounded background warm and return {} for THIS request. The
    # async name queue still covers this build, and the next one gets the whole
    # map. Same contract `_attach_names` already advertises — "never blocks the
    # build, miss → next request".
    _warm_finviz_name_map()
    return {}


def _build_finviz_name_map() -> dict[str, dict]:
    out: dict[str, dict] = {}
    try:
        from api.services.industry_map import _fetch_finviz_universe
        for row in _fetch_finviz_universe():
            sym = (row.get("Ticker") or "").strip().upper()
            if not sym:
                continue
            name = (row.get("Company") or "").strip() or None
            sector = (row.get("Sector") or "").strip() or None
            if name or sector:
                out[sym] = {"name": name, "sector": sector}
    except Exception as exc:
        _logger.warning("Finviz name map failed: %s", exc)
        return {}
    # Returns the map; the WARM THREAD owns the cache write, and writes only a
    # map that actually resolved. Caching {} for 24h after a transient failure
    # would blank every card for a day. `_fetch_finviz_universe` swallows its
    # own errors and returns [] rather than raising, so the empty case is the
    # LIKELY failure, not the exceptional one.
    return out


def _attach_names(days: dict) -> None:
    """Best-effort company names + GICS sector onto every entry, cache-hits only.
    Both come from the same ticker_meta cache; sector powers the calendar's
    sector-scoping filter chips (never blocks the build — miss → next request).

    A ticker_meta miss falls back to the whole-market Finviz map BEFORE queueing
    the async backfill — see `_finviz_name_map`."""
    try:
        from api.services.ticker_meta import _mem, _disk_get, _base_meta
    except Exception:
        return
    fv_names = _finviz_name_map()
    for day in days.values():
        for e in _day_entries(day):
            sym = (e.get("sym") or "").upper()
            if not sym or (e.get("name") and e.get("sector")):
                continue
            meta = _mem.get(f"tmeta_{sym}")
            if meta is None:
                try:
                    meta = _disk_get(sym)
                except Exception:
                    meta = None
            if meta and (meta.get("name") or meta.get("sector")):
                if meta.get("name"):
                    e["name"] = meta["name"]
                if meta.get("sector") and not e.get("sector"):
                    e["sector"] = meta["sector"]
                if meta.get("name"):
                    continue
            # ticker_meta miss → the whole-market Finviz map, which is already
            # in memory. This runs BEFORE the async queue on purpose: the queue
            # resolves 24 symbols per request cycle, so on a 400-reporter day
            # most cards stayed nameless for many requests. ticker_meta still
            # WINS where it has an answer — this only fills what it lacks.
            fv = fv_names.get(sym)
            if fv:
                if fv.get("name") and not e.get("name"):
                    e["name"] = fv["name"]
                if fv.get("sector") and not e.get("sector"):
                    e["sector"] = fv["sector"]
                if e.get("name"):
                    continue
            # Still a miss → bounded async backfill (resolves for the next request)
            with _NAME_GUARD:
                if sym in _NAME_INFLIGHT or len(_NAME_INFLIGHT) >= _NAME_INFLIGHT_MAX:
                    continue
                _NAME_INFLIGHT.add(sym)

            def _backfill(s=sym):
                try:
                    _base_meta(s)
                except Exception:
                    pass
                finally:
                    with _NAME_GUARD:
                        _NAME_INFLIGHT.discard(s)

            _NAME_POOL.submit(_backfill)


# ── Range-week builder (non-current weeks) ─────────────────────────────────────
# Finnhub /calendar/earnings range is PRIMARY (US-focused, carries the session
# where known); FMP stable/earnings-calendar is the fallback (broader tape but
# no session field + international noise). EarningsWhispers is NEVER paged —
# its scraper is paced for the current week only and gets connection-dropped
# on bursts. Every week passes the SAME universe rule (cap_universe) and the
# same [:40] per-session cap as the current week so day counts stay
# comparable when paging ("THU 9 · 21" must mean the same thing every week).

_RANGE_WEEK_TTL_FUTURE = 3600       # 1 h — forward schedules move
_RANGE_WEEK_TTL_PAST   = 6 * 3600   # 6 h — history is near-immutable
_US_SYM_RE = None  # lazy-compiled

_range_week_locks: dict[str, threading.Lock] = {}
_range_week_locks_guard = threading.Lock()


def _is_us_symbol(sym: str) -> bool:
    global _US_SYM_RE
    if _US_SYM_RE is None:
        import re
        _US_SYM_RE = re.compile(r"^[A-Z]{1,5}$")
    return bool(_US_SYM_RE.match(sym))


_FMP_CAL_CHUNK_TIMEOUT_SECS = 10
_FMP_CAL_CHUNK_MAX_WORKERS = 6


def _fmp_calendar_day(day: date, key: str) -> list[dict] | None:
    """One `stable/earnings-calendar` call scoped to a SINGLE calendar day.

    🔴 Never span more than one day in a single FMP calendar call — live-
    measured (`api/services/implied_store.py:384-398`, the already-proven
    idiom this function mirrors): a 2-day call returned exactly 4,000 rows
    with ZERO of them dated day 1, and a 14-day call dropped days 0-1
    entirely. FMP silently truncates a multi-day range and the truncation is
    NOT date-fair, so chunking one call per day is the only way a wide range
    stays complete. Returns None on failure — the caller treats that as
    "this day contributed nothing" (never a whole-provider failure — one bad
    day-chunk must not blank the rest of the range)."""
    import requests
    try:
        resp = requests.get(
            "https://financialmodelingprep.com/stable/earnings-calendar",
            params={"from": day.isoformat(), "to": day.isoformat(), "apikey": key},
            timeout=_FMP_CAL_CHUNK_TIMEOUT_SECS,
        )
        if not resp.ok:
            _logger.warning("Calendar range: FMP HTTP %d for %s", resp.status_code, day.isoformat())
            return None
        data = resp.json()
    except Exception as exc:
        _logger.warning("Calendar range: FMP fetch failed for %s: %s", day.isoformat(), exc)
        return None
    return data if isinstance(data, list) else None


def _fmp_range_week(from_date: str, to_date: str) -> list[dict] | None:
    """FMP stable/earnings-calendar rows for a date range, chunked ONE CALL
    PER CALENDAR DAY (see `_fmp_calendar_day`) and concatenated. Returns None
    only on TOTAL failure (no key, or every single day-chunk failed) so a
    caller can distinguish "FMP is down" from "FMP had nothing" — a partial
    failure (some days ok, some not) returns whatever succeeded, matching
    `implied_store._fmp_reporters`'s contract. Probe-verified on this plan
    2026-07-09 (200, actuals inline, lastUpdated — but NO session field and
    international symbols mixed in)."""
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return None
    try:
        start = date.fromisoformat(from_date)
        end = date.fromisoformat(to_date)
    except (ValueError, TypeError):
        return None
    if end < start:
        return None
    day_list = [start + timedelta(days=i) for i in range((end - start).days + 1)]

    import concurrent.futures
    results: list[list[dict] | None] = [None] * len(day_list)
    with concurrent.futures.ThreadPoolExecutor(
            max_workers=min(_FMP_CAL_CHUNK_MAX_WORKERS, len(day_list))) as pool:
        future_to_idx = {pool.submit(_fmp_calendar_day, d, key): i
                          for i, d in enumerate(day_list)}
        for fut in concurrent.futures.as_completed(future_to_idx):
            i = future_to_idx[fut]
            try:
                results[i] = fut.result()
            except Exception as exc:  # noqa: BLE001 — one worker's failure isolates to its own day
                _logger.warning("Calendar range: FMP day-chunk worker failed: %s", exc)
                results[i] = None
    if all(r is None for r in results):
        return None  # every single day-chunk failed -> total provider failure
    out: list[dict] = []
    for r in results:
        if r:
            out.extend(r)
    return out


def _build_range_week(monday: date) -> dict:
    """Build a non-current week's payload from provider range calendars."""
    week_dates = _week_dates_for(monday)
    today      = _today_et()
    week_start = week_dates[0].isoformat()
    week_end   = week_dates[-1].isoformat()
    cap_uni    = _load_cap_universe()

    days = {d.strftime("%Y-%m-%d"): _empty_day(d, today) for d in week_dates}

    _EPS_SENTINELS = frozenset({999.0, -999.0, 9999.0, -9999.0, 999.99, -999.99})

    def _clean_eps(v):
        if v is None:
            return None
        try:
            fv = float(v)
        except (TypeError, ValueError):
            return None
        if fv in _EPS_SENTINELS or abs(fv) > 200:
            return None
        return round(fv, 2)

    def _keep(sym: str) -> bool:
        if cap_uni:
            return sym in cap_uni
        return _is_us_symbol(sym)

    source = "range_empty"
    # sym -> entry, per day — built while parsing Finnhub so the FMP merge
    # below can look up "did Finnhub already have this symbol" in O(1)
    # instead of rescanning every bucket per FMP row.
    sym_index: dict[str, dict[str, dict]] = {ds: {} for ds in days}

    raw = _fh_get_month(week_start, week_end)
    fh_rows = (raw or {}).get("earningsCalendar") or []
    if fh_rows:
        source = "range_finnhub"
        for row in fh_rows:
            sym = (row.get("symbol") or "").strip().upper()
            ds  = (row.get("date") or "").strip()
            if not sym or ds not in days or not _keep(sym):
                continue
            hour = (row.get("hour") or "").lower()
            timing = hour if hour in ("bmo", "amc") else "tbd"
            rev_est_raw = row.get("revenueEstimate")
            rev_act_raw = row.get("revenueActual")
            entry = {
                "sym":      sym,
                "eps_est":  _clean_eps(row.get("epsEstimate")),
                "eps_act":  _clean_eps(row.get("epsActual")),
                "rev_est":  round(rev_est_raw / 1_000_000, 1) if rev_est_raw else None,
                "rev_act":  round(rev_act_raw / 1_000_000, 1) if rev_act_raw else None,
                "ew":       0,
                "mc_b":     None,
                "time_et":  None,
                # Heuristic until the Phase-3 revision table: an EMPTY hour on
                # a non-current week usually means a projected date. "dmh"
                # (during market hours) is a CONFIRMED session — it renders in
                # the TBD group but its date is not flagged as an estimate.
                "date_est": hour not in ("bmo", "amc", "dmh"),
            }
            days[ds][timing].append(entry)
            sym_index[ds][sym] = entry

    # ── FMP breadth leg — ALWAYS attempted (own bounded timeout, chunked one
    # call per day; short-circuits to None instantly with no network call
    # when FMP_API_KEY is unset, e.g. every test in this suite). Finnhub wins
    # on hour/quarter/year — nothing below ever touches an existing entry's
    # bucket or overwrites a non-null value. FMP only (a) fills a still-null
    # estimate on a symbol Finnhub already returned, or (b) adds a symbol
    # Finnhub did not return at all, landing in `tbd` (FMP carries no session
    # field, so an FMP-only symbol's session is HONESTLY unknown — never
    # coerced into bmo/amc). This is what keeps a week non-empty when
    # Finnhub 429s/errors entirely (fh_rows == [] above; `source` stays
    # "range_empty" until this leg proves otherwise).
    fmp_rows = _fmp_range_week(week_start, week_end)
    if fmp_rows:
        source = "range_fmp" if source == "range_empty" else f"{source}+fmp"
        for row in fmp_rows:
            sym = (row.get("symbol") or "").strip().upper()
            ds  = str(row.get("date") or "")[:10]
            if not sym or ds not in days or not _keep(sym):
                continue
            rev_est_raw = row.get("revenueEstimated")
            rev_act_raw = row.get("revenueActual")
            existing = sym_index.get(ds, {}).get(sym)
            if existing is not None:
                if existing.get("eps_est") is None:
                    v = _clean_eps(row.get("epsEstimated"))
                    if v is not None:
                        existing["eps_est"] = v
                if existing.get("eps_act") is None:
                    v = _clean_eps(row.get("epsActual"))
                    if v is not None:
                        existing["eps_act"] = v
                if existing.get("rev_est") is None and rev_est_raw:
                    existing["rev_est"] = round(rev_est_raw / 1_000_000, 1)
                if existing.get("rev_act") is None and rev_act_raw:
                    existing["rev_act"] = round(rev_act_raw / 1_000_000, 1)
                continue
            entry = {
                "sym":      sym,
                "eps_est":  _clean_eps(row.get("epsEstimated")),
                "eps_act":  _clean_eps(row.get("epsActual")),
                "rev_est":  round(rev_est_raw / 1_000_000, 1) if rev_est_raw else None,
                "rev_act":  round(rev_act_raw / 1_000_000, 1) if rev_act_raw else None,
                "ew":       0,
                "mc_b":     None,
                "time_et":  None,
                "date_est": True,   # FMP range carries no session/confirmation
            }
            days[ds]["tbd"].append(entry)
            sym_index.setdefault(ds, {})[sym] = entry

    # ── Finviz Elite leg for a PAST week ──────────────────────────────────
    # `_backfill_past_days` gave the CURRENT week a third source; this closes
    # the identical exposure on the previous one. Measured on the current week,
    # a Finnhub outage left FMP returning NOTHING and the day empty — that hole
    # was equally open here, and past weeks are pure history, so an empty one is
    # simply wrong rather than merely early.
    #
    # Finviz offers no arbitrary range: only last week is reachable, so weeks
    # older than that skip the leg entirely rather than fire a request that
    # cannot match. That is a real, stated limit — not silently papered over.
    fv_filt = _finviz_week_filter(monday, today)
    if fv_filt:
        fv_added, fv_moved = _merge_finviz_sessions(
            days, set(days.keys()), fv_filt, _keep, sym_index, rebucket=False)
        if fv_added or fv_moved:
            source = f"{source}+finviz"
            _logger.info("Calendar %s: Finviz added %d, re-bucketed %d",
                         week_start, fv_added, fv_moved)

    # Same ordering rule every week: estimate-bearing names first, then alpha;
    # same [:40] per-session cap as the current-week live path.
    for day in days.values():
        for bucket in ("bmo", "amc", "tbd"):
            day[bucket].sort(key=lambda e: (
                e.get("eps_est") is None and e.get("rev_est") is None,
                e.get("sym") or "",
            ))
            day[bucket] = day[bucket][:40]

    # Called for EVERY week now. `_curate_econ_events` owns the source decision:
    # it skips the (slow, this-week-only) ForexFactory fetches for far weeks and
    # goes straight to FMP, which serves any range. The old guard here predated
    # the FMP fallback and left every week beyond ±7 days with no econ at all.
    _curate_econ_events(week_start, week_end, days)
    _attach_names(days)
    _attach_date_moves(days)

    return {
        "week_start":      week_start,
        "week_end":        week_end,
        "days":            days,
        "source":          source,
        "is_current_week": False,
    }


def _get_or_build_range_week(monday: date) -> dict | None:
    """Read-through per-week cache with a per-key build lock (a cold week must
    not fire duplicate provider calls under concurrent paging)."""
    ck = f"calendar_week_{monday.isoformat()}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    with _range_week_locks_guard:
        lock = _range_week_locks.setdefault(monday.isoformat(), threading.Lock())
    with lock:
        hit = cache.get(ck)
        if hit is not None:
            return hit
        try:
            payload = _build_range_week(monday)
        except Exception as exc:
            _logger.warning("Calendar: range week build failed for %s: %s", monday, exc)
            return None
        if payload.get("source") == "range_empty":
            # Both providers failed (e.g. a transient Finnhub 429). Caching that
            # for hours would resurrect the empty-calendar trust bug — keep it
            # only long enough to absorb a click-storm, then self-heal.
            cache.set(ck, payload, ttl=120)
            return payload
        is_past = _week_dates_for(monday)[-1] < _today_et()
        cache.set(ck, payload,
                  ttl=_RANGE_WEEK_TTL_PAST if is_past else _RANGE_WEEK_TTL_FUTURE)
        return payload


def _days_for_date(ds: str) -> dict | None:
    """Resolve one day's dict from whichever week cache owns that date.

    Current week: read-only against the calendar_weekly cache (cold cache →
    None, preserving the historical contract for /reactions etc.). Any other
    week within the horizon: read-through per-week cache."""
    try:
        d = date.fromisoformat(ds)
    except (ValueError, TypeError):
        return None
    cur_monday = _week_dates()[0]
    monday = _monday_of(d)
    if monday == cur_monday:
        cal = cache.get("calendar_weekly")
        return (cal or {}).get("days", {}).get(ds)
    if abs((monday - cur_monday).days) // 7 > _WEEK_HORIZON_WEEKS:
        return None
    wk = _get_or_build_range_week(monday)
    return (wk or {}).get("days", {}).get(ds)


_MONTH_CACHE_TTL = 1800  # 30 minutes


@router.get("/api/calendar/month")
def get_month_calendar(year: int = 0, month: int = 0):
    """Return full-month earnings bucketed by date.

    Response: { month: "YYYY-MM", days: { YYYY-MM-DD: { bmo: [...], amc: [...] } } }
    Each entry: { sym, eps_est, eps_act, rev_est, rev_act, timing }
    Filtered to cap_universe.  Cached 30 min.  Never raises — returns {} days on failure.
    """
    today = _today_et()
    if not year:
        year = today.year
    if not month:
        month = today.month

    # Validate before monthrange (which raises ValueError → 500 on bad input)
    if not (1 <= month <= 12 and 1900 <= year <= 2100):
        return {"month": f"{year}-{month}", "days": {}}

    cache_key = f"calendar_month_{year}_{month}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # ── ASSEMBLED FROM PER-WEEK FETCHES — never one whole-month range call. ──
    # Finnhub silently caps a range response at 1,500 rows and fills it from
    # the END of the range backward (probe-verified 2026-07-09: a July query
    # returned ONLY Jul 17-31 — the first two weeks vanished). That cap was
    # the structural root cause of "Month contradicts Week". Week-sized
    # chunks stay far under the cap, and riding _get_or_build_range_week
    # means Month and the paged Feed share ONE cache, one universe rule, and
    # one TBD mapping — the views cannot disagree by construction.
    _, last_day = _cal_module.monthrange(year, month)
    month_prefix = f"{year:04d}-{month:02d}"
    first = date(year, month, 1)
    last  = date(year, month, last_day)

    # Same paging horizon as get_calendar (~±52 weeks) — the endpoint is
    # unauthenticated and each out-of-horizon month would otherwise fire
    # provider calls for 5-6 permanently-empty weeks.
    if abs((date(year, month, 15) - today).days) > 400:
        return {"month": month_prefix, "days": {}}

    days: dict[str, dict] = {}
    degraded = False   # any week missing/empty from a provider failure?
    monday = _monday_of(first)
    while monday <= last:
        wk = _get_or_build_range_week(monday)
        if wk is None or wk.get("source") == "range_empty":
            degraded = True
        for ds, day in ((wk or {}).get("days") or {}).items():
            if not ds.startswith(month_prefix):
                continue
            bucket = {"bmo": [], "amc": [], "tbd": []}
            for timing in ("bmo", "amc", "tbd"):
                for e in day.get(timing, []) or []:
                    bucket[timing].append({**e, "timing": timing})
            if bucket["bmo"] or bucket["amc"] or bucket["tbd"]:
                days[ds] = bucket
        monday += timedelta(days=7)

    result = {"month": f"{year:04d}-{month:02d}", "days": days}
    # A degraded assembly must self-heal on the WEEK caches' 120s clock — a
    # 30-min empty month while the Week view heals in 2 minutes would be the
    # Month-contradicts-Week bug wearing a new hat.
    cache.set(cache_key, result, ttl=120 if degraded else _MONTH_CACHE_TTL)
    return result


# ── Endpoint ──────────────────────────────────────────────────────────────────

# The bound: past this we rebuild synchronously rather than keep serving old
# data, so a refresh that keeps failing degrades into today's behaviour instead
# of silently pinning everyone to a stale week.
_WEEKLY_STALE_MAX_AGE = 30 * 60          # 30 min = 3x _CACHE_TTL
_WEEKLY_STALE = ServeStale("calendar_weekly", max_age_seconds=_WEEKLY_STALE_MAX_AGE)


def _weekly_payload_is_good(payload: dict | None) -> bool:
    """Is this week worth remembering as the fallback?

    A trading week with ZERO reporters does not exist — it is always a provider
    failure — so an empty build must never become the payload every user sees
    for the next window. Same rule `get_news` applies to its error placeholder.
    """
    if not payload or payload.get("source") in (None, "", "empty", "error", "out_of_range"):
        return False
    days = (payload.get("days") or {}).values()
    return any(d.get("bmo") or d.get("amc") or d.get("tbd") for d in days)


def _full_econ_cached(week_start: str, week_end: str) -> dict:
    """Full-impact econ for the week (ALL impacts + ACTUAL prints), for the widget's
    star filter. FMP is primary — it carries actuals + all impacts and covers any week;
    ForexFactory include_low is a no-actuals fallback. EMPTY results are NOT cached, so a
    transient provider hiccup can't 'stick' the widget on the curated set for 10 min."""
    ck = f"econ_full::{week_start}"
    cached = cache.get(ck)
    if cached:
        return cached
    data = {}
    try:
        from api.services import econ_calendar_fmp
        data = econ_calendar_fmp.fetch_us_econ_week_full(week_start, week_end) or {}
    except Exception as exc:
        _logger.warning("Calendar: FMP full econ failed: %s", exc)
    if not data:
        try:
            data = _fetch_ff_events(week_start, week_end, include_low=True) or {}
        except Exception as exc:
            _logger.warning("Calendar: FF full econ fallback failed: %s", exc)
            data = {}
    if data:
        cache.set(ck, data, ttl=300)
    return data


def _overlay_full_impact_econ(payload: dict) -> dict:
    """Shallow-copy a calendar payload, replacing each day's econ/fed with the FULL
    ForexFactory set (all impacts + an `impact` level). Days FF doesn't cover keep
    their curated econ; earnings buckets are untouched. Never mutates the cache."""
    days = payload.get("days") or {}
    ws, we = payload.get("week_start"), payload.get("week_end")
    if not days or not ws or not we:
        return payload
    ff = _full_econ_cached(ws, we)
    if not ff:
        return payload
    new_days = {}
    for ds, day in days.items():
        if ds in ff:
            d = dict(day)
            d["econ"] = ff[ds].get("econ", [])
            d["fed"] = ff[ds].get("fed", [])
            new_days[ds] = d
        else:
            new_days[ds] = day
    out = dict(payload)
    out["days"] = new_days
    return out


@router.get("/api/calendar")
def get_calendar(week: str | None = None, full_impact: bool = False):
    """Weekly calendar. `full_impact=1` (used by the Calendar widget's star filter)
    overlays ALL-impact ForexFactory econ; the default is the curated Med/High+Fed
    set the main Calendar page + downstream consumers rely on."""
    payload = _get_calendar_payload(week)
    if full_impact:
        payload = _overlay_full_impact_econ(payload)
    return payload


def _get_calendar_payload(week: str | None = None):
    """Weekly calendar. Optional ?week=YYYY-MM-DD pages to any week within
    ±52 weeks (snapped to that date's Monday). The current week keeps the
    EW+Finviz merged path and the legacy calendar_weekly cache key untouched
    (calendar_alerts, awareness R5, the ics collector, and warm-on-boot all
    read that key); other weeks come from provider range calendars."""
    if week:
        import re as _re
        target_monday = None
        if _re.match(r"^\d{4}-\d{2}-\d{2}$", week):
            try:
                # The regex admits calendar-invalid dates (2026-13-05, 2026-02-31)
                # — those must land on the documented current-week fallback, not
                # a 500 on the flagship public endpoint.
                target_monday = _monday_of(date.fromisoformat(week))
            except ValueError:
                target_monday = None
        if target_monday is not None:
            cur_monday = _week_dates()[0]
            if target_monday != cur_monday:
                if abs((target_monday - cur_monday).days) // 7 > _WEEK_HORIZON_WEEKS:
                    return {
                        "week_start": target_monday.isoformat(),
                        "week_end":   (target_monday + timedelta(days=4)).isoformat(),
                        "days":       {},
                        "source":     "out_of_range",
                        "is_current_week": False,
                    }
                payload = _get_or_build_range_week(target_monday)
                if payload is not None:
                    return payload
                return {
                    "week_start": target_monday.isoformat(),
                    "week_end":   (target_monday + timedelta(days=4)).isoformat(),
                    "days":       {},
                    "source":     "error",
                    "is_current_week": False,
                }
        # Malformed or current-week param → fall through to the current week.

    # Fresh cache → instant. Otherwise serve the last good week and rebuild
    # behind the user: `_CACHE_TTL` is a HARD clock, so without this the first
    # click after each 10-minute lapse eats the whole 4.5-8s provider rebuild
    # (measured on prod — see tests/test_calendar_load_latency.py).
    return _WEEKLY_STALE.serve(
        "current",
        fresh=lambda: cache.get("calendar_weekly"),
        build=_build_current_week,
        good=_weekly_payload_is_good,
    )


def _build_current_week() -> dict:
    """The expensive path: EW + Finviz live, Finnhub past-day backfill, Finnhub
    actuals patch, ForexFactory econ, names. 4.5-8s against live providers.
    Writes the TTL cache itself, exactly as it did before serve-stale existed."""
    week_dates = _week_dates()
    today      = _today_et()
    week_start = week_dates[0].isoformat()
    week_end   = week_dates[-1].isoformat()

    # Load wire_data for cap_universe + wire calendar fallback
    source = "empty"
    days: dict | None = None
    wire = None
    cap_uni: set | None = None
    try:
        from api.services.engine import _load_wire_data
        wire = _load_wire_data()
        if wire and wire.get("cap_universe"):
            cap_uni = set(wire["cap_universe"])
    except Exception as exc:
        _logger.warning("Calendar: wire_data load error: %s", exc)

    # ── 1. Live EarningsWhispers + Finviz (richer data, more tickers) ────────
    try:
        days = _build_live(week_dates, today)
        if cap_uni:
            # ALL THREE buckets pass the same universe rule — tbd skipping the
            # gate let sub-$300M Finviz names into the current week (and into
            # calendar_alerts/ics via the shared payload) while range weeks
            # filtered them: the exact count-incomparability class this
            # redesign exists to kill.
            for ds, day in days.items():
                for bucket in ("bmo", "amc", "tbd"):
                    day[bucket] = [e for e in day[bucket] if e["sym"] in cap_uni]
        for d in week_dates:
            ds = d.strftime("%Y-%m-%d")
            if ds not in days:
                days[ds] = _empty_day(d, today)
        source = "live"
    except Exception as exc:
        _logger.warning("Calendar: live build error: %s", exc)

    # ── 1b. If live came back with ZERO earnings (e.g. EW throttled every day),
    #         don't accept an empty calendar — fall through to wire earnings. ──
    if days is not None:
        live_total = sum(
            len(dy.get("bmo", [])) + len(dy.get("amc", [])) + len(dy.get("tbd", []))
            for dy in days.values())
        if live_total == 0 and wire and wire.get("weekly_calendar"):
            try:
                days = _from_wire(wire["weekly_calendar"], week_dates, today, cap_universe=cap_uni)
                source = "wire_after_empty_live"
            except Exception as exc:
                _logger.warning("Calendar: wire fallback after empty live error: %s", exc)

    # ── 2. Fallback: wire data (from morning engine push) ────────────────────
    if days is None:
        try:
            if wire and wire.get("weekly_calendar"):
                days = _from_wire(wire["weekly_calendar"], week_dates, today, cap_universe=cap_uni)
                source = "wire"
        except Exception as exc:
            _logger.warning("Calendar: wire_data path error: %s", exc)

    # ── 3. Empty shell if both earnings paths failed ──────────────────────────
    if days is None:
        days = {d.strftime("%Y-%m-%d"): _empty_day(d, today) for d in week_dates}

    # ── 3b. Past days of THIS week come from the retentive Finnhub range ─────
    #    EW/Finviz are forward-looking schedules — they drop a company from its
    #    date once it reports, so Monday empties out mid-week. Runs AFTER the
    #    wire-fallback decision above so it can never mask an empty live build.
    _backfill_past_days(days, week_dates, today, cap_uni)

    # ── 4. Finnhub actuals patch for today's pending reporters ───────────────
    #    Catches companies that report BMO after the 7:35 AM wire run.
    _patch_today_actuals(days, today.isoformat())
    # Re-add reporters a degraded past-day rebuild dropped (yesterday loses its
    # roster when EW rolls it forward and the provider backfill lags a day) —
    # BEFORE sticky actuals so a restored name still gets its printed numbers.
    _restore_sticky_reporters(days, today.isoformat())
    _merge_sticky_actuals(days, today.isoformat())

    # ── 5. Econ events: ALWAYS from ForexFactory (real data, never AI) ────────
    #    Overlays econ/fed on whichever earnings path ran above.
    _curate_econ_events(week_start, week_end, days)

    # ── 6. Company names from the ticker_meta cache (non-blocking) ───────────
    _attach_names(days)
    _attach_date_moves(days)

    result = {
        "week_start":      week_start,
        "week_end":        week_end,
        "days":            days,
        "source":          source,
        "is_current_week": True,
    }
    # `_WEEKLY_STALE.serve()` checks the raw TTL cache (`fresh()`) BEFORE ever
    # consulting the last-known-good stale slot -- so an unconditional write
    # here let a poisoned empty-week rebuild win over a real prior week for
    # the next `_CACHE_TTL` (10 min), even though `_weekly_payload_is_good`
    # exists specifically to keep a bad build out of the stale slot. Apply
    # the SAME predicate to the raw cache write so both paths agree.
    set_by_completeness(
        "calendar_weekly", result,
        complete=_weekly_payload_is_good(result),
        ttl_ok=_CACHE_TTL,
        ttl_partial=_CACHE_FAIL_TTL,
    )
    return result


# ── Real economic calendar from ForexFactory ──────────────────────────────────

_FF_URLS = [
    "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    "https://nfs.faireconomy.media/ff_calendar_nextweek.json",
]

_KEY_TERMS = {
    "fomc", "fed funds", "cpi", "ppi", "pce", "nonfarm", "payroll",
    "gdp", "retail sales", "unemployment rate", "ism manufacturing",
    "ism services", "ism non-manufacturing",
}

_FED_TERMS = (
    "fomc member", "fed chair", "powell speaks", "fed governor",
    "waller", "jefferson", "williams", "barkin", "logan",
    "kashkari", "daly", "bowman", "kugler", "miran", "barr",
    "fed's ", "federal reserve",
)


def _is_key_event(title: str) -> bool:
    t = title.lower()
    return any(k in t for k in _KEY_TERMS)


# The events a trader treats as HIGH impact (the widget's 3-star tier). ForexFactory's
# own "High" folder is narrower (and, e.g., marks Fed speeches Low), so we promote this
# curated set to 'high' regardless of FF's label. Matches a TradingEconomics-style
# high-impact list. FF titles differ from other sources (e.g. "Non-Farm Employment
# Change", "UoM Consumer Sentiment") so terms are chosen to catch FF's wording.
_HIGH_IMPACT_TERMS = (
    "employment change", "payrolls", "unemployment rate",   # jobs report (NFP), not productivity
    "cpi", "core inflation", "inflation rate", "consumer price",
    "ppi", "producer price", "pce", "retail sales", "gdp",
    "fomc statement", "fomc meeting", "fomc economic projections",   # the decision/minutes, not speeches
    "federal funds rate", "interest rate decision", "rate decision",
    "ism manufacturing pmi", "ism services pmi", "ism non-manufacturing pmi",   # headline PMI, not sub-prices
    "consumer sentiment", "durable goods",
    "building permits", "housing starts", "existing home sales", "new home sales",
)


def _is_high_impact(title: str) -> bool:
    t = (title or "").lower()
    if "speak" in t or "speech" in t:   # Fed/official speeches are never the high tier
        return False
    return any(k in t for k in _HIGH_IMPACT_TERMS)


def _is_fed_speaker(title: str) -> bool:
    t = (title or "").lower().strip()
    # STRUCTURAL first. FMP ships "Fed <Name> Speech" / "Fed <Name> Speaks" for
    # every official, so matching the SHAPE stays correct as the FOMC roster
    # turns over. The surname list below silently goes stale — it carried
    # `barkin` but not `cook` or `musalem`, so on the week of 2026-08-03 three
    # identical Fed-speech events split across the econ and fed buckets.
    if t.startswith("fed ") and (t.endswith(" speech") or t.endswith(" speaks")):
        return True
    return any(x in t for x in _FED_TERMS)


def _fmt_time(dt: datetime) -> str:
    h  = dt.hour % 12 or 12
    m  = dt.minute
    ap = "AM" if dt.hour < 12 else "PM"
    return f"{h}:{m:02d} {ap}"


# ForexFactory's JSON clock is US CENTRAL, not ET. Verified 2026-07-31 against
# four known releases: FOMC statement 1:00 PM (2:00 ET), Core PCE / Advance GDP /
# Unemployment Claims 7:30 AM (8:30 ET), CB Consumer Confidence 9:00 AM (10:00
# ET). Converted through the ZONE, never a fixed -1 offset, so DST stays right.
_FF_TZ = ZoneInfo("America/Chicago")

# The live feed returns "7/30/2026 7:30:00 AM". It previously returned ISO-8601,
# and `datetime.fromisoformat` raising on the new shape — inside a bare
# `except: continue` — silently dropped ALL 92 events of a working 200-OK feed.
_FF_DATE_FORMATS = (
    "%m/%d/%Y %I:%M:%S %p",
    "%m/%d/%Y %I:%M %p",
    "%m/%d/%Y %H:%M:%S",
)


def _parse_ff_datetime(raw) -> datetime | None:
    """A ForexFactory timestamp as an ET-aware datetime, or None.

    Tolerates ISO-8601 (in case the feed reverts) and the US-style format it
    currently ships. A naive value is CENTRAL — see `_FF_TZ`.
    """
    if not raw or not isinstance(raw, str):
        return None
    raw = raw.strip()
    try:
        dt = datetime.fromisoformat(raw)
        return (dt if dt.tzinfo else dt.replace(tzinfo=_FF_TZ)).astimezone(_ET)
    except ValueError:
        pass
    for fmt in _FF_DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).replace(tzinfo=_FF_TZ).astimezone(_ET)
        except ValueError:
            continue
    return None


def _fetch_ff_events(week_start: str, week_end: str, include_low: bool = False) -> dict:
    """Fetch USD economic events from ForexFactory for the given week range.
    Returns {YYYY-MM-DD: {econ: [...], fed: [...]}}. `include_low=True` keeps the
    Low-impact (yellow) events too and every event carries an `impact` level
    ('low'|'medium'|'high') — used by the Calendar WIDGET's star filter. The default
    (curated) view keeps only Medium/High + Fed, exactly as before.
    """
    import requests

    result: dict[str, dict] = {}
    parsed = unparsed = 0

    for url in _FF_URLS:
        try:
            r = requests.get(url, timeout=12, headers={"User-Agent": "Mozilla/5.0"})
            if not r.ok or not r.text.strip():
                continue
            events = r.json()
        except Exception as exc:
            _logger.warning("FF fetch %s: %s", url, exc)
            continue

        for ev in events:
            if ev.get("country") != "USD":
                continue

            impact = ev.get("impact", "Low")
            title  = (ev.get("title") or "").strip()
            if not title:
                continue

            # Keep: High/Medium impact + all Fed speakers (curated). include_low keeps all.
            is_fed = _is_fed_speaker(title)
            if not include_low and impact == "Low" and not is_fed:
                continue

            date_raw = ev.get("date", "")
            if not date_raw:
                continue
            dt = _parse_ff_datetime(date_raw)
            if dt is None:
                unparsed += 1
                continue
            parsed += 1
            ds = dt.strftime("%Y-%m-%d")

            if ds < week_start or ds > week_end:
                continue

            if ds not in result:
                result[ds] = {"econ": [], "fed": []}

            time_str = _fmt_time(dt)
            forecast = ev.get("forecast") or None
            previous = ev.get("previous") or None

            # Impact tier for the widget's star filter: promote curated high-impact
            # events to 'high' regardless of FF's label; else use FF's Medium/Low.
            if _is_high_impact(title) or impact == "High":
                imp = "high"
            elif impact == "Medium":
                imp = "medium"
            else:
                imp = "low"
            if is_fed:
                result[ds]["fed"].append({
                    "time":  time_str,
                    "event": title,
                    "note":  impact,
                    "impact": imp,
                })
            else:
                actual = ev.get("actual") or None
                result[ds]["econ"].append({
                    "time":     time_str,
                    "event":    title,
                    "estimate": forecast,
                    "prior":    previous,
                    "actual":   actual,   # populated by FF once the event releases
                    "is_key":   _is_key_event(title),
                    "impact":   imp,
                })

    # A feed whose every row fails to parse is the exact failure that hid for
    # weeks behind a silent `continue`. Say so loudly instead of returning {}.
    if unparsed and not parsed:
        _logger.error(
            "Calendar: ForexFactory date format unrecognised — %d rows, 0 parsed. "
            "The feed shape changed; see _FF_DATE_FORMATS.", unparsed)
    elif unparsed:
        _logger.warning("Calendar: %d ForexFactory rows had unparseable dates", unparsed)

    return result


def _curate_econ_events(week_start: str, week_end: str, days: dict) -> None:
    """Real economic events, injected in-place. ForexFactory first, FMP for gaps.

    FF only publishes `ff_calendar_thisweek.json` — `…_nextweek.json` 404s — so
    every OTHER week had no econ source at all. FMP already backs the weekly
    Discord card (`econ_calendar_fmp`), so the page uses the same fallback.

    The fallback fills DAYS FF did not cover; it never replaces an FF day, since
    FF is the richer source (it carries `actual` once a print releases).
    """
    # FF publishes only `ff_calendar_thisweek.json` (nextweek 404s), so for any
    # other week its two fetches are pure request-path waste — 2 × 12s timeouts
    # on a cold month assembly. Skip straight to FMP there.
    try:
        ff_eligible = abs(
            (date.fromisoformat(week_start) - _week_dates()[0]).days) <= 7
    except (ValueError, TypeError):
        ff_eligible = True

    ff: dict = {}
    if ff_eligible:
        try:
            ff = _fetch_ff_events(week_start, week_end)
        except Exception as exc:
            _logger.warning("Calendar: FF econ fetch failed: %s", exc)

    for ds, buckets in ff.items():
        if ds in days:
            days[ds]["econ"] = buckets["econ"]
            days[ds]["fed"]  = buckets["fed"]
    ff_total = sum(len(b["econ"]) + len(b["fed"]) for b in ff.values())

    missing = [ds for ds in days
               if not days[ds].get("econ") and not days[ds].get("fed")]
    if not missing:
        _logger.info("Calendar: FF econ loaded %d events across %d days",
                     ff_total, len(ff))
        return

    try:
        from api.services import econ_calendar_fmp
        fmp = econ_calendar_fmp.fetch_us_econ_week(week_start, week_end) or {}
    except Exception as exc:
        _logger.warning("Calendar: FMP econ fallback failed: %s", exc)
        fmp = {}

    filled = 0
    for ds in missing:
        for row in fmp.get(ds) or []:
            title = row.get("event") or ""
            if not title:
                continue
            # FMP's own is_fed flag is unreliable — on the week of 8/3 it tagged
            # "Fed Barkin Speech" but not "Fed Cook Speech" / "Fed Musalem
            # Speech", so identical events split across two buckets. OR it with
            # the calendar's own detector, the one the FF path already uses, so
            # both sources bucket Fed speakers the same way.
            if row.get("is_fed") or _is_fed_speaker(title):
                days[ds]["fed"].append({
                    "time": row.get("time"), "event": title, "note": "Fed",
                })
            else:
                days[ds]["econ"].append({
                    "time":     row.get("time"),
                    "event":    title,
                    "estimate": row.get("estimate"),
                    "prior":    row.get("prior"),
                    "actual":   None,          # FMP does not carry actuals
                    "is_key":   _is_key_event(title),
                })
            filled += 1
    _logger.info("Calendar: econ loaded — FF %d events / %d days, FMP filled %d "
                 "across %d uncovered days", ff_total, len(ff), filled, len(missing))


# ── IPO calendar endpoint ──────────────────────────────────────────────────────

from api.services.ipo_calendar import get_ipos as _get_ipos  # noqa: E402
from fastapi import Query as _Query  # noqa: E402


@router.get("/api/calendar/ipos")
def get_calendar_ipos(
    from_: str | None = _Query(default=None, alias="from"),
    to:    str | None = _Query(default=None, alias="to"),
):
    """Return normalized IPO calendar entries for the given date range.

    Params (both optional):
        from  YYYY-MM-DD  (defaults to this Monday)
        to    YYYY-MM-DD  (defaults to this Friday)

    Response: list of { sym, name, date, exchange, price_range, shares, value, status }
    Cached 6 h per (from, to) key inside the service.  Never raises — returns [].
    """
    today = _today_et()
    from_date = from_
    to_date   = to
    if from_date is None:
        dow = today.weekday()
        monday = today - timedelta(days=dow) if dow < 5 else today + timedelta(days=7 - dow)
        from_date = monday.strftime("%Y-%m-%d")
    if to_date is None:
        from_dt = date.fromisoformat(from_date)
        to_date = (from_dt + timedelta(days=4)).strftime("%Y-%m-%d")
    return _get_ipos(from_date, to_date)


# ── Dividends / splits forward calendar endpoint ──────────────────────────────

from api.services.dividends_calendar import get_events as _get_div_events  # noqa: E402


@router.get("/api/calendar/dividends")
def get_calendar_dividends(
    syms: str | None = None,
    user: dict = Depends(get_current_user),
):
    """Return forward dividends + splits for the requested symbols.

    Params:
        syms  Comma-separated ticker list (optional).
              When absent, defaults to the authenticated user's My-Stocks set
              (watchlists + flagged + positions + UCT20 union).

    Response: list of { sym, type: 'dividend'|'split', date, amount?, ratio? }
    Only forward-looking events (date >= today).  Cached 12 h per sym set.
    """
    if syms:
        sym_list = [s.strip() for s in syms.split(",") if s.strip()]
    else:
        # Default: caller's My-Stocks set
        sets = _cp.get_user_ticker_sets(user["id"])
        sym_list = sorted(sets.get("all_mine", set()))

    return _get_div_events(sym_list)


@router.post("/api/calendar/refresh")
def refresh_calendar(user: dict = Depends(require_admin)):
    """Rebuild the calendar cache immediately — earnings from EW, actuals from Finnhub, econ from ForexFactory."""
    cache.invalidate("calendar_weekly")

    week_dates = _week_dates()
    today      = _today_et()
    week_start = week_dates[0].isoformat()
    week_end   = week_dates[-1].isoformat()

    days = _build_live(week_dates, today)
    for d in week_dates:
        ds = d.strftime("%Y-%m-%d")
        if ds not in days:
            days[ds] = _empty_day(d, today)

    _patch_today_actuals(days, today.isoformat())
    _restore_sticky_reporters(days, today.isoformat())
    _merge_sticky_actuals(days, today.isoformat())
    _curate_econ_events(week_start, week_end, days)
    _attach_names(days)
    _attach_date_moves(days)

    result = {
        "week_start":      week_start,
        "week_end":        week_end,
        "days":            days,
        "source":          "refresh",
        "is_current_week": True,
    }
    # The ONE calendar_weekly write that used to bypass `set_by_completeness`
    # (the normal build path has used it since the cache-policy pass). An admin
    # hitting refresh during a provider outage rebuilt a degraded week and then
    # PINNED it for the full 10 minutes — the one moment someone is actively
    # trying to fix the calendar is the worst moment to make it stick. Same
    # goodness test the serve-stale slot below already applies, evaluated once.
    good = _weekly_payload_is_good(result)
    set_by_completeness(
        "calendar_weekly", result,
        complete=good, ttl_ok=_CACHE_TTL, ttl_partial=_CACHE_FAIL_TTL,
    )
    # This freshly-rebuilt week also becomes the serve-stale fallback. Without
    # it the admin's forced refresh would leave the PREVIOUS week in the slot,
    # which then resurfaces the moment this entry lapses — a manual refresh
    # would visibly un-apply itself 10 minutes later.
    if good:
        _WEEKLY_STALE.remember("current", result)
    totals = {ds: {"bmo": len(d["bmo"]), "amc": len(d["amc"]),
                   "tbd": len(d.get("tbd", [])), "econ": len(d["econ"])}
              for ds, d in days.items()}
    return {"ok": True, "totals": totals}


# ── Live price reactions for reported tickers (Massive batch snapshot) ─────────

_REACTIONS_TTL = 30              # seconds — live during market hours
_PAST_REACTIONS_TTL = 24 * 3600  # settled history only (see get_reactions)
# Sized to cover a whole finished day now that `_backfill_past_days` restores
# every reporter (Wed 7/29: 214 with actuals). One Massive agg call per sym on a
# bounded pool, cached 24 h — clipping at 80 left the tail with no gap %.
_PAST_REACTIONS_MAX_SYMS = 250
_past_reaction_locks: dict[str, threading.Lock] = {}


def _past_reactions(target: str, day: dict) -> dict:
    """Post-print reaction %% for a PAST date, computed from daily bars.

    BMO/TBD reporter on D → D close vs D-1 close; AMC reporter on D → D+1
    close vs D close. One Massive agg call per sym (bounded pool, capped,
    cached 24h by the caller) — todaysChangePerc is meaningless for past days.
    """
    from concurrent.futures import ThreadPoolExecutor
    from api.services.massive import get_agg_bars

    d = date.fromisoformat(target)
    from_date = (d - timedelta(days=9)).isoformat()
    to_date   = (d + timedelta(days=6)).isoformat()

    jobs: list[tuple[str, bool]] = []          # (sym, is_amc)
    for bucket, is_amc in (("bmo", False), ("tbd", False), ("amc", True)):
        for e in day.get(bucket, []) or []:
            if e.get("eps_act") is not None and e.get("sym"):
                jobs.append((e["sym"], is_amc))
    jobs = jobs[:_PAST_REACTIONS_MAX_SYMS]
    if not jobs:
        return {}

    target_ms_day = target

    def _one(job):
        sym, is_amc = job
        try:
            bars = get_agg_bars(sym, from_date, to_date) or []
            # (YYYY-MM-DD, close) pairs, ascending
            closes = []
            for b in bars:
                ts = b.get("t")
                c  = b.get("c")
                if ts is None or c is None:
                    continue
                ds = datetime.fromtimestamp(ts / 1000, tz=_ET).strftime("%Y-%m-%d")
                closes.append((ds, float(c)))
            idx = next((i for i, (ds, _) in enumerate(closes) if ds >= target_ms_day), None)
            if idx is None:
                return sym, None
            if closes[idx][0] != target_ms_day:
                # No session bar on the report date (halt/holiday edge) — skip.
                return sym, None
            if is_amc:
                if idx + 1 >= len(closes):
                    return sym, None
                prev_c, next_c = closes[idx][1], closes[idx + 1][1]
            else:
                if idx == 0:
                    return sym, None
                prev_c, next_c = closes[idx - 1][1], closes[idx][1]
            if not prev_c:
                return sym, None
            return sym, round((next_c - prev_c) / prev_c * 100, 2)
        except Exception:
            return sym, None

    out: dict = {}
    with ThreadPoolExecutor(max_workers=4) as ex:
        for sym, pct in ex.map(_one, jobs):
            if pct is not None:
                out[sym] = pct
    return out


@router.get("/api/calendar/reactions")
def get_reactions(date_str: str | None = Query(None, alias="date")):
    """Return post-print reaction %% for all reported tickers on a given date.

    Today/future: live todaysChangePerc via ONE Massive batch snapshot (30s TTL).
    Past dates: computed once from daily bars (24h TTL) — the live snapshot is
    meaningless for a print that happened days ago.
    Resolves the day from whichever week cache owns the date (paging-aware).

    The arg is `date_str`, not `date`, and carries `alias="date"` so the public
    `?date=` contract is unchanged: naming it `date` shadows the module's
    `from datetime import date`, which made `date.fromisoformat(target)` below
    raise `AttributeError: 'str' object has no attribute 'fromisoformat'` on
    EVERY past date (a 500 live from 2026-07-09 to 2026-07-31).
    """
    import re as _re
    if date_str and not _re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return {}

    target = date_str or _today_et().isoformat()

    cache_key = f"calendar_reactions_{target}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    day = _days_for_date(target)
    if not day:
        return {}

    # ── Past date: bars-based reaction ────────────────────────────────────────
    if target < _today_et().isoformat():
        # The 24h TTL applies only once the reaction window is SETTLED — an AMC
        # reporter on day D needs D+1's CLOSED session. Yesterday (and Friday
        # viewed on Monday) is not settled: pre-market has no D+1 bar at all,
        # and intraday would freeze a partial-day gap for a day. (Market
        # holidays can mark a day settled one session early — the short-TTL
        # path below bounds that error to minutes, accepted.)
        def _prev_trading_day(d: date) -> date:
            d = d - timedelta(days=1)
            while d.weekday() >= 5:
                d -= timedelta(days=1)
            return d

        settled = date.fromisoformat(target) < _prev_trading_day(_today_et())

        # Per-date build lock: N concurrent cold views of the same past day
        # must not each fan out 80 Massive agg calls.
        with _range_week_locks_guard:
            lock = _past_reaction_locks.setdefault(target, threading.Lock())
        with lock:
            cached = cache.get(cache_key)
            if cached is not None:
                return cached
            try:
                reactions = _past_reactions(target, day)
            except Exception as exc:
                _logger.warning("Calendar past reactions failed for %s: %s", target, exc)
                reactions = {}
            had_reported = any(e.get("eps_act") is not None for e in _day_entries(day))
            if had_reported and not reactions:
                ttl = 120                       # total provider failure — self-heal fast
            elif settled:
                ttl = _PAST_REACTIONS_TTL       # immutable history
            else:
                ttl = 600                       # D+1 session still open/absent
            cache.set(cache_key, reactions, ttl=ttl)
            return reactions

    # ── Today / future: live batch snapshot ──────────────────────────────────
    reported = [
        e["sym"] for e in _day_entries(day)
        if e.get("eps_act") is not None and e.get("sym")
    ]
    if not reported:
        cache.set(cache_key, {}, ttl=_REACTIONS_TTL)
        return {}

    try:
        from api.services.massive import _get_client
        reactions = _get_client().get_batch_snapshots(reported)
    except Exception as exc:
        _logger.warning("Calendar reactions fetch failed: %s", exc)
        reactions = {}

    cache.set(cache_key, reactions, ttl=_REACTIONS_TTL)
    return reactions


# ── Day metrics: price + avg volume + market cap for filter bar ────────────────

_METRICS_TTL = 120  # 2 min — stable enough for filtering purposes
_METRICS_FAIL_TTL = 300  # both Finviz + Massive came back empty-handed — retry in 5 min, not up to 24h


@router.get("/api/calendar/day-metrics")
def get_day_metrics(date_str: str | None = Query(None, alias="date")):
    """Return price, avg_vol, mc_b for every ticker on a given date.

    Primary: Finviz Elite v=152 screener (price, 30d avg vol, market cap in one call).
    Fallback: Massive batch rich snapshots (price + prev-day vol).
    mc_b also sourced from the calendar chip data (wire-computed, most accurate).

    TTL: 2 min — these fields don't need to update frequently.
    """
    import re as _re
    if date_str and not _re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return {}

    target = date_str or _today_et().isoformat()
    cache_key = f"calendar_metrics_{target}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Tiered TTLs: a past date's price/vol/cap are effectively immutable —
    # re-firing the Finviz bulk call every 2 min for history is pure waste.
    today_iso = _today_et().isoformat()
    if target < today_iso:
        ttl = 24 * 3600
    elif target == today_iso:
        ttl = _METRICS_TTL
    else:
        ttl = 3600

    # Resolve the day from whichever week cache owns the date (paging-aware)
    day = _days_for_date(target)
    if not day:
        # Cache the empty briefly so a bad/paged-out date doesn't re-resolve the
        # week (and possibly rebuild it) on every 2-min poll.
        cache.set(cache_key, {}, ttl=300)
        return {}

    all_entries = _day_entries(day)
    if not all_entries:
        cache.set(cache_key, {}, ttl=ttl)
        return {}

    # Seed mc_b from chip data (wire-computed, already in billions)
    result: dict[str, dict] = {}
    for e in all_entries:
        sym = e.get("sym")
        if sym:
            result[sym] = {"price": None, "avg_vol": None, "mc_b": e.get("mc_b")}

    syms = list(result.keys())

    # ── 1. Finviz Elite v=152 (price, avg vol, market cap) ────────────────────
    fv_token = os.environ.get("FINVIZ_API_KEY") or os.environ.get("FINVIZ_TOKEN")
    fv_ok = False
    if fv_token and syms:
        try:
            import requests, csv, io
            tickers_param = ",".join(syms)
            url = (
                f"https://elite.finviz.com/export.ashx"
                f"?v=152&t={tickers_param}&auth={fv_token}"
            )
            r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=15, allow_redirects=True)
            if r.ok and r.text.strip():
                rows = list(csv.DictReader(io.StringIO(r.text)))
                def _gcol(row, *names):
                    for n in names:
                        for k in row:
                            if k.strip().lower() == n.lower():
                                v = row[k]
                                return v.strip() if v else None
                    return None

                def _parse_vol(s):
                    if not s or s == "-": return None
                    s = s.replace(",", "")
                    try: return int(float(s))
                    except ValueError: return None

                def _parse_mc(s):
                    if not s or s == "-": return None
                    s = s.strip()
                    try:
                        if s.endswith("T"): return float(s[:-1]) * 1000
                        if s.endswith("B"): return float(s[:-1])
                        if s.endswith("M"): return float(s[:-1]) / 1000
                        # Finviz export returns suffix-less caps in raw
                        # MILLIONS (the UCT20 raw-millions incident class) —
                        # dividing by 1e9 rendered every cap as "$0M".
                        return float(s) / 1000
                    except ValueError: return None

                for row in rows:
                    sym = _gcol(row, "Ticker")
                    if not sym or sym not in result:
                        continue
                    price_s = _gcol(row, "Price")
                    avg_vol_s = _gcol(row, "Avg Volume")
                    mc_s = _gcol(row, "Market Cap")
                    try:
                        price = float(price_s) if price_s and price_s != "-" else None
                    except ValueError:
                        price = None
                    result[sym]["price"]   = price
                    result[sym]["avg_vol"] = _parse_vol(avg_vol_s)
                    if result[sym]["mc_b"] is None:
                        result[sym]["mc_b"] = _parse_mc(mc_s)
                fv_ok = True
                _logger.info("Calendar metrics: Finviz returned data for %d/%d tickers", len(rows), len(syms))
        except Exception as exc:
            _logger.warning("Calendar metrics: Finviz fetch failed: %s", exc)

    # ── 2. Massive fallback for price (if Finviz failed) ──────────────────────
    massive_ok = False
    if not fv_ok:
        try:
            from api.services.massive import _get_client
            rich = _get_client().get_batch_rich_snapshots(syms)
            if rich:
                massive_ok = True
            for sym, snap in rich.items():
                if sym in result:
                    result[sym]["price"]   = snap.get("price")
                    result[sym]["avg_vol"] = snap.get("vol")   # prev-day vol proxy
        except Exception as exc:
            _logger.warning("Calendar metrics: Massive fallback failed: %s", exc)

    # Finviz (unset key or fetch failure) AND the Massive fallback both empty-
    # handed is a total provider-side miss, not a legitimately blank day — a
    # blank price/avg-vol/mcap silently zeroes the filter bar AND flattens the
    # importance hierarchy. Distinguish it from a normal day where at least
    # one leg produced real numbers (individual symbols can still be missing
    # from either provider; that is not this failure).
    have_data = fv_ok or massive_ok or any(v.get("price") is not None for v in result.values())
    set_by_completeness(
        cache_key, result,
        complete=have_data,
        ttl_ok=ttl,
        ttl_partial=_METRICS_FAIL_TTL,
    )
    return result


@router.get("/api/calendar/day-metrics-batch")
def get_day_metrics_batch(dates: str | None = None):
    """Whole-week metrics in ONE request: {date: {SYM: {price, avg_vol, mc_b}}}.
    Each date reuses get_day_metrics' per-date cache — the client needs the
    caps BEFORE tiering (the importance hierarchy ranks on mc_b/dollar-volume;
    fetching metrics per-DayGroup after tiering left paged weeks ranking on
    nothing and featuring a $500M bank over UnitedHealth).

    HARD CAP at 7 dates: a cold date can fire a Finviz bulk call on the request
    path; the endpoint is unauthenticated, so an unbounded `dates` list would be
    a serial-fetch DoS vector. A week is 5 days — 7 covers any real caller."""
    import re as _re
    if not dates:
        return {}
    out: dict = {}
    seen = 0
    for d in dates.split(","):
        d = d.strip()
        if d and _re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            out[d] = get_day_metrics(date_str=d)
            seen += 1
            if seen >= 7:
                break
    return out


# ── Personalization endpoint ───────────────────────────────────────────────────

@router.get("/api/admin/calendar-date-integrity")
def calendar_date_integrity_status():
    """Read-only date-drift telemetry: how many symbols tracked + how many
    have a recorded date move."""
    try:
        from api.services import calendar_date_integrity as _cdi
        return _cdi.status()
    except Exception as exc:
        return {"error": str(exc)}


@router.get("/api/calendar/my-sets")
def calendar_my_sets(user: dict = Depends(get_current_user)):
    """Return the logged-in user's personalization ticker sets for the calendar."""
    sets = _cp.get_user_ticker_sets(user["id"])
    return _cp.to_payload(sets)


# ── Enrichment overlay endpoint ────────────────────────────────────────────────

_ENRICH_TTL = 300                    # 5 min — current week (live options data)
_ENRICH_TTL_FUTURE_WEEK = 4 * 3600   # non-current future weeks move slowly
_ENRICH_TTL_PAST = 12 * 3600         # past history is stable
_ENRICH_WINDOW_DAYS = 14             # current week ±2 weeks — hard compute gate

# At most 2 week-days' enrichment computing at once — concurrent week-paging
# must never stack unbounded yfinance option-chain storms on the request path
# (the 2026-07-01 threadpool-exhaustion class).
_ENRICH_SEMAPHORE = threading.Semaphore(2)
# How long a request thread may WAIT for a compute slot before giving up and
# returning empty (uncached — the winner's result lands for the next poll).
# Without this, a post-deploy SWR burst parks dozens of anyio threads here.
_ENRICH_ACQUIRE_TIMEOUT = 8.0

# Dedicated pool for implied-move yfinance calls. Deliberately NOT
# yf_util._POOL: enrichment bursts (2 dates × 6 workers × option chains)
# would monopolize the shared 6-thread pool and starve fundamentals/dividends
# bounded calls into their timeouts.
_ENRICH_EM_POOL = _TPE(max_workers=4, thread_name_prefix="cal-em")


def _cutover_on() -> bool:
    """spec §6: the calendar's expected-move switches off the delayed yfinance
    straddle onto the in-house Massive chain. Read at CALL time so the flag can
    be flipped (and tested) without a module reload. Default OFF."""
    return os.environ.get("IMPLIED_ENRICHMENT_CUTOVER") == "1"


def _inhouse_move(sym: str, target: str) -> dict | None:
    """In-house straddle mapped into the calendar-enrichment shape.

    ROUNDING IS LOAD-BEARING: the outgoing yfinance builder rounded pct to 1dp
    and `pages/calendar/CalendarDayTable.jsx:87` prints `±${pct}%` with no
    formatter, so an unrounded float renders ±6.234567891%. FE readers of
    `expected_move` were swept — only `.pct` is consumed anywhere, so the
    call_mark→call_mid field rename rides along harmlessly.
    """
    from api.services import implied_move as _im
    out = _im.get_expected_move(sym, target)
    if not out:
        return None
    return {**out, "pct": round(out["pct"], 1), "dollar": round(out["dollar"], 2)}


def _bounded_em(fn, timeout: float = 15.0):
    """Run an implied-move callable with a hard timeout on the dedicated pool.
    Returns None on timeout or any exception (the calling thread is freed)."""
    try:
        return _ENRICH_EM_POOL.submit(fn).result(timeout=timeout)
    except Exception:
        return None

# Coverage telemetry: a silent universe-wide enrichment failure would silently
# flatten the (Phase-2) hierarchy — make it observable instead.
_ENRICH_STATS: dict[str, dict] = {}


# Enrichment has the SAME cold-cache defect as the week itself: `_ENRICH_TTL`
# is 300s on a hard clock over a ~24s provider fan-out (measured cold on prod
# 2026-07-31: 24.2s, warm 0.10s), and `useWeekEnrichment` asks for all five
# weekdays in one batch — so every 5 minutes the next poll pays it again.
_ENRICH_STALE_MAX_AGE = 30 * 60
_ENRICH_STALE = ServeStale("calendar_enrichment", max_age_seconds=_ENRICH_STALE_MAX_AGE)


def _compute_enrichment_for_date(target: str) -> dict:
    """Serve-stale wrapper over `_build_enrichment_for_date`.

    Only a NON-EMPTY payload is remembered. Every `{}` this can return is from
    a CHEAP early exit (outside the compute window, no syms, week cache not warm
    yet) — those cost nothing to redo, and remembering one would mask a day that
    genuinely has reporters behind a permanent blank overlay.
    """
    return _ENRICH_STALE.serve(
        target,
        fresh=lambda: cache.get(f"calendar_enrichment_{target}"),
        build=lambda: _build_enrichment_for_date(target),
        good=bool,
    )


def _build_enrichment_for_date(target: str) -> dict:
    """Per-ticker expected move + 4-quarter beat history + hist_stats for one day.

    Bounded + cached so the core /api/calendar paints instantly and this
    overlays on top. Empty dict if the owning week cache isn't warm yet.

    Safety rails (do not remove):
      • compute gate: only dates within current week ±2 weeks are enriched
      • implied move SKIPPED for past dates — yfinance only lists future
        expiries, so a past-date "expected move" would be confident garbage
      • per-call bounded_call timeout + a 2-wide semaphore across dates

    hist_stats shape: {avg_abs_move, up_count, total, last_n}
      avg_abs_move — average absolute post-earnings move over last N reports
      up_count     — number of those reports where the stock gapped up
      total        — total number of reports measured
      last_n       — last N individual moves (pct, newest first, capped at 8)
    """
    from concurrent.futures import ThreadPoolExecutor

    ck = f"calendar_enrichment_{target}"
    hit = cache.get(ck)
    if hit is not None:
        return hit

    today_iso = _today_et().isoformat()
    is_past = target < today_iso

    # ── Compute-window gate ───────────────────────────────────────────────────
    try:
        gap_days = abs((date.fromisoformat(target) - _today_et()).days)
    except (ValueError, TypeError):
        return {}
    if gap_days > _ENRICH_WINDOW_DAYS:
        cache.set(ck, {}, ttl=_ENRICH_TTL_PAST if is_past else _ENRICH_TTL_FUTURE_WEEK)
        return {}

    day = _days_for_date(target)
    if not day:
        return {}
    syms = [e["sym"] for e in _day_entries(day) if e.get("sym")]
    if not syms:
        cache.set(ck, {}, ttl=_ENRICH_TTL)
        return {}

    cur_monday = _week_dates()[0]
    in_current_week = _monday_of(date.fromisoformat(target)) == cur_monday
    # is_past wins over in_current_week: the 5-min TTL exists for the LIVE
    # expected-move (options) field, and `_one` skips that entirely for a past
    # date — beat_history + hist_stats of a day that already happened are
    # stable. Before `_backfill_past_days` a past day in this week held ~1
    # symbol so the wasted recompute was invisible; now it holds ~100, and a
    # 5-min TTL would re-fire ~200 provider calls per past day per 5 minutes.
    ttl = (_ENRICH_TTL_PAST if is_past
           else _ENRICH_TTL if in_current_week
           else _ENRICH_TTL_FUTURE_WEEK)

    from api.services.earnings_enrichment import get_implied_move, get_historical_earnings_moves
    from api.services.earnings_estimates import get_earnings_intel, fh_budget_denied_total

    def _compute_hist_stats(sym: str) -> dict | None:
        """Return compact hist_stats from get_historical_earnings_moves.

        Uses _fetch_quarterly_history (FMP → AV fallback) to get the AV-shaped
        quarters list required by get_historical_earnings_moves, then computes
        avg_abs_move, up_count, total, and last_n (newest first, capped at 8).
        """
        try:
            from api.services.engine import _fetch_quarterly_history
            av_quarters = _fetch_quarterly_history(sym)
            raw = get_historical_earnings_moves(sym, av_quarters)
            if not raw:
                return None
            moves = raw.get("moves_pct") or []
            # `moves` can now contain `None` (P2 T9 review round 2, CRITICAL:
            # get_historical_earnings_moves emits an explicit null for a
            # quarter it can't compute yet — e.g. print night, no next-day
            # close — rather than dropping the slot and shifting the rest).
            # `None > 0` raises in Python 3; both counts below must skip gaps
            # rather than crash or silently miscount them as reports.
            n = raw.get("n_quarters") or sum(1 for m in moves if m is not None)
            up = sum(1 for m in moves if m is not None and m > 0)
            return {
                "avg_abs_move": raw.get("avg_abs_move_pct"),
                "up_count":     up,
                "total":        n,
                # `moves` is ALREADY newest-first — it is a verbatim passthrough
                # of `_fetch_quarterly_history`'s GUARANTEED newest-first order
                # (see that function's docstring). A `reversed()` used to sit
                # here, written for a since-superseded AV-only/oldest-first
                # world; left in place after FMP became primary, it silently
                # flipped every emitted `last_n` to oldest-first — the opposite
                # of this line's own comment (P2 T9 review, CRITICAL: every
                # per-quarter reaction pairing downstream was reading the WRONG
                # quarter's move). Do not reintroduce it.
                "last_n":       moves[:8],   # newest first, capped 8; may hold nulls
            }
        except Exception:
            return None

    def _one(sym):
        move = None
        hist = None
        hist_stats = None
        if not is_past:
            # _bounded_em: a hung chain call frees this worker after the timeout
            # instead of pinning it (524-outage class), on a pool ISOLATED from
            # yf_util's shared one. BOTH branches ride it.
            if _cutover_on():
                move = _bounded_em(lambda s=sym: _inhouse_move(s, target))
            else:
                move = _bounded_em(lambda s=sym: get_implied_move(s, earnings_date=target))
        # Carried per-symbol because the failure IS per-symbol: this fan-out
        # sheds individual Finnhub calls for budget, so one ticker's history
        # can be missing in a build where every other ticker's arrived. The
        # day-level `throttled` signal below shortens the TTL, but it cannot
        # say WHICH symbols were shed -- and the modal states its answer per
        # symbol, so the signal has to travel per symbol too.
        history_unresolved = False
        try:
            intel = get_earnings_intel(sym)
            hist = intel.get("beat_history") if intel else None
            # `intel is None` = all three legs failed; `history_answered` False
            # = the history leg specifically did not reply. Either way we do
            # not know this ticker's history, which is NOT the same as knowing
            # it has none. Default True so an older cached intel dict (written
            # before this key existed) is read as an answer rather than
            # flipping every symbol to "unavailable" for one cache generation.
            if not intel or not intel.get("history_answered", True):
                history_unresolved = True
        except Exception:
            history_unresolved = True
        try:
            hist_stats = _compute_hist_stats(sym)
        except Exception:
            pass
        return sym, {"expected_move": move, "beat_history": hist,
                     "hist_stats": hist_stats,
                     "history_unresolved": history_unresolved}

    # Bounded WAIT for a compute slot — a request that can't get one returns
    # empty (uncached) instead of parking an anyio thread for the duration of
    # someone else's compute; SWR's next poll picks up the winner's cache.
    if not _ENRICH_SEMAPHORE.acquire(timeout=_ENRICH_ACQUIRE_TIMEOUT):
        return cache.get(ck) or {}
    # Snapshot the process-wide Finnhub token-bucket denial counter before the
    # fan-out. A heavy day (80+ symbols × 3 Finnhub calls each) can exceed the
    # provider's ~60/min budget within this one build — the bucket sheds the
    # excess (Task 13) instead of storming into 429s, but the symbols it shed
    # come back with no beat_history, not because they lack one but because
    # this pass never got to them. `throttled` (below) tells those two cases
    # apart so a THROTTLED build doesn't lock in that partial coverage for
    # `_ENRICH_TTL_PAST` (12h) / `_ENRICH_TTL_FUTURE_WEEK` (4h) — see the ttl
    # override after the fan-out.
    denied_before = fh_budget_denied_total()
    out: dict = {}
    try:
        # Re-check under the semaphore — a queued duplicate request for the
        # same date should reuse the winner's work, not recompute it.
        hit = cache.get(ck)
        if hit is not None:
            return hit
        with ThreadPoolExecutor(max_workers=6) as ex:
            for sym, data in ex.map(_one, syms):
                out[sym] = data
    finally:
        _ENRICH_SEMAPHORE.release()

    # Any denial during the window this build ran in means SOME Finnhub call
    # here (or from concurrent Finnhub activity elsewhere in the process —
    # the bucket is process-wide, same scope as the existing 429 cooldown)
    # was shed for budget, not because the data doesn't exist. Caching that
    # as if it were a complete, stable result would starve those symbols of
    # `beat_history` for hours. Erring toward "recheck sooner than strictly
    # necessary" is the safe direction; erring the other way is the bug this
    # task exists to fix.
    throttled = fh_budget_denied_total() > denied_before

    # Second failure signal, independent of the Finnhub budget: `expected_move`
    # comes from the yfinance option-chain path (_bounded_em), not Finnhub, so
    # a universe-wide yfinance outage collapses with_em to 0 without moving the
    # Finnhub denial counter at all. `with_em == 0` is BY DESIGN for is_past
    # (the docstring above: implied move is deliberately skipped for past
    # dates) -- only flag the collapse for a day that should have moves.
    with_em = sum(1 for v in out.values() if v.get("expected_move"))
    em_collapsed = (not is_past) and len(syms) > 0 and with_em == 0
    if throttled or em_collapsed:
        ttl = _ENRICH_TTL

    _ENRICH_STATS[target] = {
        "total":     len(syms),
        "with_em":   with_em,
        "with_hist": sum(1 for v in out.values() if v.get("hist_stats")),
        "with_beats": sum(1 for v in out.values() if v.get("beat_history")),
        "past":      is_past,
        "throttled": throttled,
        "em_collapsed": em_collapsed,
        "computed_at": datetime.now(_ET).isoformat(timespec="seconds"),
    }
    # Bound the telemetry dict (it would otherwise grow one key per browsed day)
    if len(_ENRICH_STATS) > 60:
        for k in sorted(_ENRICH_STATS)[:-40]:
            _ENRICH_STATS.pop(k, None)

    cache.set(ck, out, ttl=ttl)
    return out


@router.get("/api/admin/calendar-enrichment-status")
def calendar_enrichment_status():
    """Read-only enrichment coverage telemetry (mirrors reconciliation-status).
    A day whose with_em collapses to ~0 while total is large = the yfinance
    option-chain path is failing universe-wide — investigate before trusting
    expected-move displays (and the Phase-2 importance hierarchy)."""
    return {
        "dates": {k: _ENRICH_STATS[k] for k in sorted(_ENRICH_STATS, reverse=True)[:20]},
        "window_days": _ENRICH_WINDOW_DAYS,
    }


@router.get("/api/admin/implied-sweep-status")
def implied_sweep_status():
    """Did the nightly backfill sweep actually finish? (read-only)

    Read `finished_at` FIRST — it is the whole point of the table:

      finished_at set + outcome 'complete'  -> finished the universe
      finished_at set + outcome 'ceiling'   -> ran out of clock, resumes tonight
      finished_at NULL on an old run        -> KILLED OR HUNG at `last_symbol`

    That third state is why this exists. It cost four nights in August 2026
    while looking exactly like the first, because the only other evidence was
    a row count (which cannot distinguish "nothing left to do" from "died on
    symbol 41") and a log line that `railway logs` drops within ~3 minutes.
    """
    from api.services import implied_backfill as _implied_backfill
    from api.services import implied_store as _store
    try:
        runs = _store.recent_sweep_runs(10)
    except Exception as exc:                          # noqa: BLE001
        return {"error": str(exc), "runs": []}
    return {
        "runs": runs,
        "unfinished": [r["run_id"] for r in runs if not r.get("finished_at")],
        "schedule_et": f"{_implied_backfill.SWEEP_HOUR_ET:02d}:"
                       f"{_implied_backfill.SWEEP_MINUTE_ET:02d} weekdays",
    }


@router.get("/api/calendar/enrichment")
def get_enrichment(date_str: str | None = Query(None, alias="date")):
    """Single-day enrichment overlay. See _compute_enrichment_for_date."""
    import re as _re
    if date_str and not _re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return {}
    target = date_str or _today_et().isoformat()
    return _compute_enrichment_for_date(target)


@router.get("/api/calendar/implied-moves")
def get_implied_moves(date_str: str | None = Query(None, alias="date")):
    """{SYM: pct} — the HONEST pre-report implied move for each reporter on `date`.

    Reads the nightly pre-report snapshot store, NOT the live options chain. That
    matters because once a name reports, its live straddle IV-crushes and the
    /enrichment `expected_move` reads far too low (e.g. DDOG's ~13.7% earnings
    move collapses to ~3.4% the morning after). The store captured the straddle
    the night before, so it holds the real move — and it's an instant indexed
    read available for past days too (a live chain has no expired past expiries).
    Powers the Calendar widget's "Impl. Move" column.
    """
    import re as _re
    if date_str and not _re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return {}
    target = date_str or _today_et().isoformat()
    ck = f"calendar_implied_moves_{target}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    from api.services import implied_store
    try:
        out = implied_store.get_implied_for_date(target)
    except Exception:                                    # noqa: BLE001
        return {}
    # Past days are settled; today/future keep gaining reporters as the nightly
    # capture lands, so cache them briefly.
    is_past = target < _today_et().isoformat()
    cache.set(ck, out, ttl=(6 * 3600) if is_past else 300)
    return out


@router.get("/api/calendar/enrichment-batch")
def get_enrichment_batch(dates: str | None = None):
    """Batch enrichment for a whole week in ONE request. `dates` = comma-separated
    YYYY-MM-DD list; returns {date: enrichment_map}. This replaces the frontend
    firing one request per day (N round-trips + N threadpool slots → 1), which
    matters at scale. Each day reuses the same per-date cache as the single
    endpoint, so a warm calendar returns instantly.
    """
    import re as _re
    if not dates:
        return {}
    out: dict = {}
    seen = 0
    for d in dates.split(","):
        d = d.strip()
        if d and _re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            out[d] = _compute_enrichment_for_date(d)
            seen += 1
            if seen >= 7:   # a week is 5 days; bound this unauthenticated endpoint
                break
    return out


# ── D1: Read/unseen state endpoints ───────────────────────────────────────────

from pydantic import BaseModel as _BaseModel


class _SeenPayload(_BaseModel):
    item_type: str
    item_key: str


@router.get("/api/calendar/seen")
def get_calendar_seen(
    item_type: str | None = None,
    user: dict = Depends(get_current_user),
):
    """Return the set of item_keys seen by the authenticated user.

    Optional query param ``item_type`` scopes the result to a single type
    (earnings | filing | ipo | recap | insight | news).  Omit to get all seen
    keys across every type.

    Response: { "seen": ["key1", "key2", ...] }
    """
    from api.services.calendar_seen import get_seen
    seen = get_seen(user["id"], item_type=item_type)
    return {"seen": list(seen)}


@router.post("/api/calendar/seen")
def post_calendar_seen(
    payload: _SeenPayload,
    user: dict = Depends(get_current_user),
):
    """Mark a single calendar item as seen (idempotent).

    Body: { "item_type": "earnings", "item_key": "AAPL:2026-06-02" }
    Response: { "ok": true }
    """
    from api.services.calendar_seen import mark_seen
    mark_seen(user["id"], payload.item_type, payload.item_key)
    return {"ok": True}


# ── E2: iCal / webcal export ─────────────────────────────────────────────────
# Token strategy: HMAC-SHA256 keyed on PUSH_SECRET (always present in prod).
# token = hmac_hex(PUSH_SECRET, user_id). Stable per user (no TTL) so webcal
# subscribe URLs continue to work forever. decode_ics_token() reverses it by
# iterating all users and checking HMAC equality.

import hashlib as _hashlib
import hmac as _hmac
from fastapi import Response as _Response  # noqa: E402


def _ics_secret() -> bytes:
    s = os.environ.get("PUSH_SECRET", "") or os.environ.get("VOICE_ACTION_SECRET", "")
    if s:
        return s.encode("utf-8")
    # Deterministic fallback so tokens survive restarts (not great, but non-null)
    return b"uct_ics_fallback_secret"


def _make_ics_token(user_id: str) -> str:
    """Return a stable per-user HMAC token for webcal subscribe URLs."""
    sig = _hmac.new(_ics_secret(), user_id.encode("utf-8"), _hashlib.sha256).hexdigest()
    return sig


def _decode_ics_token(token: str) -> str | None:
    """Resolve a token back to a user_id. Returns None if invalid.

    Strategy: pull all user IDs from auth.db, compute expected token for each,
    and return the matching one. O(N users) but called only on subscribe fetches.
    Result is cached for 5 minutes to avoid hammering auth.db.
    """
    if not token or len(token) < 16:
        return None
    cache_key = f"ics_token_decode_{token}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached if cached != "__miss__" else None
    try:
        from api.services.auth_db import get_connection
        with get_connection() as conn:
            rows = conn.execute("SELECT id FROM users").fetchall()
        for row in rows:
            uid = str(row[0] if not isinstance(row, dict) else row["id"])
            if _hmac.compare_digest(_make_ics_token(uid), token):
                cache.set(cache_key, uid, ttl=300)
                return uid
    except Exception as e:
        _logger.warning("[ics] token decode failed: %s", e)
    cache.set(cache_key, "__miss__", ttl=300)
    return None


def _build_vevent(sym: str, report_date: str, timing: str) -> str:
    """Build a single VEVENT block for an earnings reporter.

    report_date: YYYY-MM-DD
    timing: 'bmo' | 'amc' | 'tbd'

    An unconfirmed session ('tbd') exports as an honest ALL-DAY event — never
    a fabricated 4 PM slot (session anchors are already approximations; a fake
    clock time on an unknown session is a lie in the user's own calendar).
    """
    uid = f"{sym}-{report_date}-earnings@uctintelligence.com"

    if timing == "tbd":
        d0 = report_date.replace("-", "")
        d1 = (date.fromisoformat(report_date) + timedelta(days=1)).strftime("%Y%m%d")
        return (
            "BEGIN:VEVENT\r\n"
            f"UID:{uid}\r\n"
            f"DTSTART;VALUE=DATE:{d0}\r\n"
            f"DTEND;VALUE=DATE:{d1}\r\n"
            f"SUMMARY:{sym} earnings (time TBD)\r\n"
            "CATEGORIES:EARNINGS\r\n"
            "END:VEVENT\r\n"
        )

    # DTSTART: BMO → 7 AM ET, AMC → 4 PM ET (session anchors, not exact times —
    # no wired provider publishes clock times).
    # Using floating local-time form (TZID=America/New_York) so calendar apps
    # display it correctly in the user's local zone.
    hour = "07" if timing == "bmo" else "16"
    dtstart = f"TZID=America/New_York:{report_date.replace('-', '')}T{hour}0000"
    dtend_hour = "08" if timing == "bmo" else "17"
    dtend = f"TZID=America/New_York:{report_date.replace('-', '')}T{dtend_hour}0000"
    session_label = "BMO" if timing == "bmo" else "AMC"
    summary = f"{sym} earnings ({session_label})"
    return (
        "BEGIN:VEVENT\r\n"
        f"UID:{uid}\r\n"
        f"DTSTART;{dtstart}\r\n"
        f"DTEND;{dtend}\r\n"
        f"SUMMARY:{summary}\r\n"
        "CATEGORIES:EARNINGS\r\n"
        "END:VEVENT\r\n"
    )


def _build_vcalendar(vevents: list[str]) -> str:
    body = "".join(vevents)
    return (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//UCT Intelligence//Earnings Calendar//EN\r\n"
        "CALSCALE:GREGORIAN\r\n"
        "METHOD:PUBLISH\r\n"
        "X-WR-CALNAME:UCT Earnings Calendar\r\n"
        "X-WR-TIMEZONE:America/New_York\r\n"
        + body
        + "END:VCALENDAR\r\n"
    )


def _collect_reporters_for_ics(scope: str, user_id: str | None) -> list[tuple[str, str, str]]:
    """Return list of (sym, date, timing) tuples for the iCal export.

    scope='mine': filter to user's My-Stocks set.
    scope='all': all reporters from calendar_weekly cache.

    Pulls from the weekly calendar cache; if absent falls back to month
    calendar for current + next month.
    """
    result: list[tuple[str, str, str]] = []

    # Get mine set when scope=mine
    mine: set[str] = set()
    if scope == "mine" and user_id:
        try:
            sets = _cp.get_user_ticker_sets(user_id)
            mine = sets.get("all_mine") or set()
        except Exception:
            pass

    def _add_from_days(days: dict) -> None:
        for ds, day in days.items():
            for timing in ("bmo", "amc", "tbd"):
                for entry in day.get(timing, []) or []:
                    sym = (entry.get("sym") or "").upper()
                    if sym and (scope == "all" or sym in mine):
                        result.append((sym, ds, timing))

    # Try weekly cache first
    cal = cache.get("calendar_weekly")
    if cal and cal.get("days"):
        _add_from_days(cal["days"])

    # Supplement with current month and next month (Finnhub, 30-min cached)
    today = _today_et()
    for yr, mo in [(today.year, today.month),
                   ((today.year if today.month < 12 else today.year + 1),
                    (today.month + 1 if today.month < 12 else 1))]:
        try:
            month_data = get_month_calendar(year=yr, month=mo)
            for ds, day in month_data.get("days", {}).items():
                for timing in ("bmo", "amc", "tbd"):
                    for entry in day.get(timing, []) or []:
                        sym = (entry.get("sym") or "").upper()
                        if sym and (scope == "all" or sym in mine):
                            if not any(t[0] == sym and t[1] == ds for t in result):
                                result.append((sym, ds, timing))
        except Exception:
            pass

    # Dedupe + sort by date then ticker
    seen: set[tuple[str, str]] = set()
    deduped: list[tuple[str, str, str]] = []
    for sym, ds, timing in sorted(result, key=lambda x: (x[1], x[0])):
        key = (sym, ds)
        if key not in seen:
            seen.add(key)
            deduped.append((sym, ds, timing))
    return deduped


# ── Next-report lookup (header ticker search) ─────────────────────────────────

_NEXT_REPORT_TTL = 6 * 3600


@router.get("/api/calendar/next-report")
def get_next_report(sym: str, user: dict = Depends(get_current_user)):
    """Next scheduled report date for ONE symbol — powers the header search's
    "NVDA — Wed Aug 26 · Jump to week" answer for names outside the loaded
    window. FMP stable/earnings future row primary, Finnhub calendar fallback
    (both inside earnings_table._next_report_date). Cached 6 h per sym.
    The frontend fires this on SELECTION only — never per keystroke."""
    sym = (sym or "").upper().strip()
    core = sym.replace(".", "").replace("-", "")
    if not sym or len(core) > 6 or not core.isalpha():
        return {"sym": sym, "date": None, "timing": None, "date_est": None}

    ck = f"calendar_next_report_{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    d = None
    try:
        from api.services.earnings_table import _next_report_date
        d = _next_report_date(sym)
    except Exception as exc:
        _logger.warning("Calendar next-report failed for %s: %s", sym, exc)

    timing = None
    date_est = None
    if d:
        day = _days_for_date(d)   # one cached range-week build at most
        if day:
            for t in ("bmo", "amc", "tbd"):
                entry = next((e for e in (day.get(t) or [])
                              if (e.get("sym") or "").upper() == sym), None)
                if entry is not None:
                    timing = t
                    date_est = entry.get("date_est")
                    break

    out = {"sym": sym, "date": d, "timing": timing, "date_est": date_est}
    # A None date is indistinguishable from a transient provider failure —
    # negative-cache it briefly (the 6h TTL pinned "no upcoming report" lies
    # for symbols searched during an FMP blip).
    cache.set(ck, out, ttl=_NEXT_REPORT_TTL if d else 300)
    return out


@router.get("/api/calendar/export-token")
def get_calendar_export_token(user: dict = Depends(get_current_user)):
    """Return the stable per-user iCal token for webcal subscribe URLs.

    The token is HMAC(PUSH_SECRET, user_id) — stable across restarts so a
    subscribed Google/Apple Calendar URL continues to work indefinitely.
    Response: { token: "<hex>", subscribe_url: "webcal://..." }
    """
    token = _make_ics_token(user["id"])
    base_url = os.environ.get("DASHBOARD_URL", "https://uctintelligence.com")
    subscribe_url = f"webcal://{base_url.replace('https://', '').replace('http://', '')}/api/calendar/export.ics?scope=mine&token={token}"
    return {"token": token, "subscribe_url": subscribe_url}


@router.get("/api/calendar/export.ics")
def export_calendar_ics(
    scope: str = "all",
    token: str | None = None,
    user: dict | None = Depends(lambda: None),  # optional auth
):
    """Generate a VCALENDAR .ics file for downloading or webcal subscription.

    Query params:
        scope   'mine' (user's My Stocks) | 'all' (all reporters)
        token   per-user HMAC token (from /api/calendar/export-token); required for scope=mine

    Returns text/calendar with Content-Disposition attachment.
    Empty-safe: returns a valid VCALENDAR with zero VEVENTs on a cache miss.
    Never raises.
    """
    # Resolve user_id from token for scope=mine
    user_id: str | None = None
    if scope == "mine":
        if not token:
            return _Response(
                content="scope=mine requires a token parameter",
                status_code=400,
                media_type="text/plain",
            )
        user_id = _decode_ics_token(token)
        if not user_id:
            return _Response(
                content="Invalid or expired token",
                status_code=403,
                media_type="text/plain",
            )

    try:
        reporters = _collect_reporters_for_ics(scope, user_id)
    except Exception as e:
        _logger.warning("[ics] collect reporters failed: %s", e)
        reporters = []

    vevents = [_build_vevent(sym, ds, timing) for sym, ds, timing in reporters]
    body = _build_vcalendar(vevents)

    return _Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="uct-earnings.ics"',
            "Cache-Control": "no-cache",
        },
    )


@router.get("/api/calendar/report.ics")
def export_single_report_ics(sym: str, date_str: str = Query(..., alias="date"),
                             timing: str = "tbd"):
    """One earnings report as a downloadable calendar event ("Add to calendar"
    on a card/modal). No auth, no token — it's a single public event the user
    already sees. bmo/amc anchor to the session; anything else = honest all-day.
    Reuses the same _build_vevent as the full export (TBD → all-day)."""
    import re as _re
    s = (sym or "").upper().strip()
    core = s.replace(".", "").replace("-", "")
    # ASCII letters ONLY — str.isalpha() is Unicode-broad (日本/café pass), and a
    # non-latin-1 sym crashes latin-1 header encoding → an unauth 500.
    if not s or len(core) > 6 or not (core.isascii() and core.isalpha()) \
            or not _re.match(r"^\d{4}-\d{2}-\d{2}$", date_str):
        return _Response(content="bad request", status_code=400, media_type="text/plain")
    try:
        date.fromisoformat(date_str)   # reject 2026-13-05 etc.
    except ValueError:
        return _Response(content="bad date", status_code=400, media_type="text/plain")
    t = timing if timing in ("bmo", "amc") else "tbd"
    body = _build_vcalendar([_build_vevent(s, date_str, t)])
    return _Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{s}-earnings.ics"',
            "Cache-Control": "no-cache",
        },
    )


_ANTICIPATED_PNG_FAIL_TTL = 300  # empty ranked list = provider failure, not a real blank week

@router.get("/api/calendar/most-anticipated.png")
def most_anticipated_png(week: str | None = None):
    """A shareable PNG of the week's biggest earnings reporters, ranked by
    market cap, on a branded UCT card. Public (no auth) — a top-of-funnel
    share asset. Cached per week; logos come from the on-disk logo cache."""
    import re as _re
    from datetime import date as _date_cls

    monday = None
    if week and _re.match(r"^\d{4}-\d{2}-\d{2}$", week):
        try:
            monday = _monday_of(_date_cls.fromisoformat(week))
        except ValueError:
            monday = None
    if monday is None:
        monday = _week_dates()[0]

    cur_monday = _week_dates()[0]
    if abs((monday - cur_monday).days) // 7 > _WEEK_HORIZON_WEEKS:
        return _Response(content="out of range", status_code=400, media_type="text/plain")

    ck = f"calendar_anticipated_png_{monday.isoformat()}"
    hit = cache.get(ck)
    if hit is not None:
        return _Response(content=hit, media_type="image/png",
                         headers={"Cache-Control": "public, max-age=1800"})

    payload = get_calendar(week=monday.isoformat())
    days = (payload or {}).get("days", {}) or {}

    from api.services import ticker_logos as _logos
    from api.services.calendar_anticipated_png import render_anticipated_png

    WD = ["MON", "TUE", "WED", "THU", "FRI"]
    ds_to_wd = {d.isoformat(): WD[i] for i, d in enumerate(_week_dates_for(monday))}

    # Flatten earnings across the week, filling mc_b from cached day-metrics.
    best: dict[str, dict] = {}
    for ds, day in days.items():
        metrics = {}
        try:
            metrics = get_day_metrics(date_str=ds) or {}
        except Exception:
            pass
        for bucket in ("bmo", "amc", "tbd"):
            for e in day.get(bucket, []):
                sym = (e.get("sym") or "").upper()
                if not sym:
                    continue
                mc = e.get("mc_b")
                if mc is None:
                    mc = (metrics.get(sym) or {}).get("mc_b")
                row = {
                    "sym": sym,
                    "name": e.get("name"),
                    "timing": bucket,
                    "weekday": ds_to_wd.get(ds, ""),
                    "mc_b": mc,
                    "logo_path": _logos.get_logo_path(sym),
                }
                cur = best.get(sym)
                if cur is None or (mc or -1) > (cur["mc_b"] or -1):
                    best[sym] = row

    ranked = sorted(best.values(),
                    key=lambda e: (e["mc_b"] is not None, e["mc_b"] or 0),
                    reverse=True)

    end = monday + timedelta(days=4)
    if monday.month == end.month:
        wl = f"Week of {monday.strftime('%b')} {monday.day}–{end.day}, {monday.year}"
    else:
        wl = (f"Week of {monday.strftime('%b')} {monday.day} – "
              f"{end.strftime('%b')} {end.day}, {monday.year}")

    try:
        png = render_anticipated_png(wl, ranked)
    except Exception as exc:
        _logger.warning("Most-anticipated PNG render failed: %s", exc)
        return _Response(content="render error", status_code=500, media_type="text/plain")

    # A trading week with ZERO reporters does not exist (same rule
    # `_weekly_payload_is_good` applies to the calendar itself) -- an empty
    # `ranked` here means the underlying `get_calendar()` build failed or came
    # back empty, not that the week genuinely has no earnings. Don't pin that
    # blank card for 6h (a past week) / 30min (current/future).
    ttl_ok = 6 * 3600 if end < _today_et() else 1800
    set_by_completeness(
        ck, png,
        complete=bool(ranked),
        ttl_ok=ttl_ok,
        ttl_partial=_ANTICIPATED_PNG_FAIL_TTL,
    )
    return _Response(content=png, media_type="image/png",
                     headers={"Cache-Control": "public, max-age=1800"})


@router.get("/api/calendar/sector-read")
def sector_read(sector: str, week: str | None = None, user=Depends(get_current_user)):
    """One AI sentence on a GICS sector's earnings setup this week, grounded on
    that sector's actual reporters. Auth-required (paid feature). Cost-guarded +
    cached per (sector, week); returns cached line, {status:'generating'} (fires
    a deduped background job), or {status:'unavailable'}."""
    from api.services import calendar_sector_read as _sr

    sec = (sector or "").strip()
    if not sec:
        return {"status": "unavailable"}

    import re as _re
    from datetime import date as _date_cls
    monday = None
    if week and _re.match(r"^\d{4}-\d{2}-\d{2}$", week):
        try:
            monday = _monday_of(_date_cls.fromisoformat(week))
        except ValueError:
            monday = None
    if monday is None:
        monday = _week_dates()[0]
    week_key = monday.isoformat()

    # Fast path: already generated → return without touching providers.
    cached = _sr.status_for(sec, week_key)
    if cached.get("status") in ("ready", "unavailable"):
        return cached

    # Need to (maybe) kick off generation — assemble this sector's reporters.
    cur_monday = _week_dates()[0]
    if abs((monday - cur_monday).days) // 7 > _WEEK_HORIZON_WEEKS:
        return {"status": "unavailable"}

    payload = get_calendar(week=week_key)
    days = (payload or {}).get("days", {}) or {}

    reporters: list[dict] = []
    for ds, day in days.items():
        metrics = {}
        try:
            metrics = get_day_metrics(date_str=ds) or {}
        except Exception:
            pass
        for bucket in ("bmo", "amc", "tbd"):
            for e in day.get(bucket, []):
                if (e.get("sector") or "") != sec:
                    continue
                sym = (e.get("sym") or "").upper()
                if not sym:
                    continue
                mc = e.get("mc_b")
                if mc is None:
                    mc = (metrics.get(sym) or {}).get("mc_b")
                reporters.append({"sym": sym, "name": e.get("name"),
                                  "mc_b": mc, "timing": bucket})

    if not reporters:
        return {"status": "unavailable"}

    _sr.request_generation(sec, week_key, reporters)
    return _sr.status_for(sec, week_key)


# ── Week-ahead cards + Discord post ───────────────────────────────────────────

_WEEK_CARD_TTL_FUTURE = 1800      # 30 min — a forward week's schedule still moves
_WEEK_CARD_TTL_PAST = 6 * 3600


def _week_card_monday(week: str | None) -> date | None:
    import re as _re
    if week and _re.match(r"^\d{4}-\d{2}-\d{2}$", week):
        try:
            return _monday_of(date.fromisoformat(week))
        except ValueError:
            return None
    return _week_dates()[0]


def _render_week_card(kind: str, week: str | None):
    """Shared body for the two preview endpoints. `kind` is 'earnings'|'econ'."""
    from api.services import calendar_week_poster as _poster
    from api.services.calendar_week_png import (
        render_earnings_week_png, render_econ_week_png,
    )

    monday = _week_card_monday(week)
    if monday is None:
        return _Response(content="bad week", status_code=400, media_type="text/plain")
    if abs((monday - _week_dates()[0]).days) // 7 > _WEEK_HORIZON_WEEKS:
        return _Response(content="out of range", status_code=400, media_type="text/plain")

    ck = f"calendar_week_card_{kind}_{monday.isoformat()}"
    hit = cache.get(ck)
    if hit is None:
        earnings_days, econ_days = _poster.build_payloads(monday)
        label = _poster.week_label(monday)
        hit = (render_earnings_week_png(label, earnings_days) if kind == "earnings"
               else render_econ_week_png(label, econ_days))
        ttl = (_WEEK_CARD_TTL_PAST if monday + timedelta(days=4) < _today_et()
               else _WEEK_CARD_TTL_FUTURE)
        cache.set(ck, hit, ttl=ttl)
    return _Response(content=hit, media_type="image/png",
                     headers={"Cache-Control": "public, max-age=900"})


@router.get("/api/calendar/week-earnings.png")
def week_earnings_png(week: str | None = None):
    """Preview of the Mon-Fri earnings card that gets posted to Discord."""
    return _render_week_card("earnings", week)


@router.get("/api/calendar/week-econ.png")
def week_econ_png(week: str | None = None):
    """Preview of the Mon-Fri economic-events card that gets posted to Discord."""
    return _render_week_card("econ", week)


@router.post("/api/calendar/post-week")
def post_week_to_discord(target: str = "test", week: str | None = None,
                         force: bool = False,
                         user: dict = Depends(require_admin)):
    """Render + post the week-ahead cards to Discord.

    target=test (default) -> UCT Intelligence server / admin fallback.
    target=live           -> #event-calendar; refuses if its webhook is unset.
    force=1 bypasses the once-per-week dedup guard.
    """
    from api.services import calendar_week_poster as _poster
    if target not in ("test", "live"):
        return {"ok": False, "reason": "target must be 'test' or 'live'"}
    monday = _week_card_monday(week)
    if monday is None:
        return {"ok": False, "reason": "bad week"}
    return _poster.post_week(target=target, monday=monday, force=bool(force))
