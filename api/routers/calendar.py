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
from fastapi import APIRouter, Depends
from api.services.cache import cache
from api.middleware.auth_middleware import get_current_user, require_admin
from api.services import calendar_personalization as _cp

_logger = logging.getLogger(__name__)
router = APIRouter()

_CACHE_TTL = 600  # 10 min — shorter to pick up reported actuals faster

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
    """For today's pending earnings, fetch live actuals from Finnhub.

    Catches BMO reporters that file between 7:35 AM (wire run) and 9:30 AM
    (market open), and AMC reporters that filed last night but weren't in wire.
    Silent no-op if Finnhub key is absent or the call fails.
    """
    day = days.get(today_str)
    if not day:
        return

    fh_key = os.environ.get("FINNHUB_API_KEY")
    if not fh_key:
        return

    all_entries = _day_entries(day)
    pending = [e for e in all_entries if e.get("eps_act") is None and e.get("sym")]
    if not pending:
        return

    pending_syms = {e["sym"] for e in pending}
    try:
        import requests
        r = requests.get(
            "https://finnhub.io/api/v1/calendar/earnings",
            params={"from": today_str, "to": today_str, "token": fh_key},
            timeout=10,
        )
        if not r.ok:
            return
        fh_map = {
            e["symbol"]: e
            for e in r.json().get("earningsCalendar", [])
            if e.get("symbol") in pending_syms and e.get("epsActual") is not None
        }
        patched = 0
        for entry in pending:
            fh = fh_map.get(entry["sym"])
            if not fh:
                continue
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
            _logger.info("Calendar: Finnhub patched %d actuals for %s", patched, today_str)
    except Exception as exc:
        _logger.warning("Calendar: Finnhub actuals patch failed: %s", exc)


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

    Mirrors the _fh_get pattern from earnings_estimates.py.
    Returns the raw JSON dict or None on failure.
    """
    fh_key = os.environ.get("FINNHUB_API_KEY")
    if not fh_key:
        _logger.warning("Calendar month: FINNHUB_API_KEY not set")
        return None
    try:
        import requests
        r = requests.get(
            "https://finnhub.io/api/v1/calendar/earnings",
            params={"from": from_date, "to": to_date, "token": fh_key},
            timeout=15,
        )
        if not r.ok:
            _logger.warning("Calendar month: Finnhub HTTP %d", r.status_code)
            return None
        return r.json()
    except Exception as exc:
        _logger.warning("Calendar month: Finnhub fetch failed: %s", exc)
        return None


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


def _attach_names(days: dict) -> None:
    """Best-effort company names onto every entry, cache-hits only."""
    try:
        from api.services.ticker_meta import _mem, _disk_get, _base_meta
    except Exception:
        return
    for day in days.values():
        for e in _day_entries(day):
            sym = (e.get("sym") or "").upper()
            if not sym or e.get("name"):
                continue
            meta = _mem.get(f"tmeta_{sym}")
            if meta is None:
                try:
                    meta = _disk_get(sym)
                except Exception:
                    meta = None
            if meta and meta.get("name"):
                e["name"] = meta["name"]
                continue
            # Miss → bounded async backfill (resolves for the next request)
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


def _fmp_range_week(from_date: str, to_date: str) -> list[dict] | None:
    """FMP stable/earnings-calendar rows for a date range, or None on failure.
    Probe-verified on this plan 2026-07-09 (200, actuals inline, lastUpdated —
    but NO session field and international symbols mixed in)."""
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        return None
    try:
        import requests
        r = requests.get(
            "https://financialmodelingprep.com/stable/earnings-calendar",
            params={"from": from_date, "to": to_date, "apikey": key},
            timeout=15,
        )
        if not r.ok:
            _logger.warning("Calendar range: FMP HTTP %d", r.status_code)
            return None
        data = r.json()
        return data if isinstance(data, list) else None
    except Exception as exc:
        _logger.warning("Calendar range: FMP fetch failed: %s", exc)
        return None


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
            days[ds][timing].append({
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
            })
    else:
        fmp_rows = _fmp_range_week(week_start, week_end)
        if fmp_rows:
            source = "range_fmp"
            for row in fmp_rows:
                sym = (row.get("symbol") or "").strip().upper()
                ds  = str(row.get("date") or "")[:10]
                if not sym or ds not in days or not _keep(sym):
                    continue
                rev_est_raw = row.get("revenueEstimated")
                rev_act_raw = row.get("revenueActual")
                days[ds]["tbd"].append({
                    "sym":      sym,
                    "eps_est":  _clean_eps(row.get("epsEstimated")),
                    "eps_act":  _clean_eps(row.get("epsActual")),
                    "rev_est":  round(rev_est_raw / 1_000_000, 1) if rev_est_raw else None,
                    "rev_act":  round(rev_act_raw / 1_000_000, 1) if rev_act_raw else None,
                    "ew":       0,
                    "mc_b":     None,
                    "time_et":  None,
                    "date_est": True,   # FMP range carries no session/confirmation
                })

    # Same ordering rule every week: estimate-bearing names first, then alpha;
    # same [:40] per-session cap as the current-week live path.
    for day in days.values():
        for bucket in ("bmo", "amc", "tbd"):
            day[bucket].sort(key=lambda e: (
                e.get("eps_est") is None and e.get("rev_est") is None,
                e.get("sym") or "",
            ))
            day[bucket] = day[bucket][:40]

    # FF serves ONLY this week + next week — for any other week the two
    # faireconomy fetches are pure request-path waste (2 × 12s timeouts on a
    # cold month assembly). Skip them outside that range.
    if abs((monday - _week_dates()[0]).days) <= 7:
        _curate_econ_events(week_start, week_end, days)
    _attach_names(days)

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

@router.get("/api/calendar")
def get_calendar(week: str | None = None):
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

    cached = cache.get("calendar_weekly")
    if cached is not None:
        return cached

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

    # ── 4. Finnhub actuals patch for today's pending reporters ───────────────
    #    Catches companies that report BMO after the 7:35 AM wire run.
    _patch_today_actuals(days, today.isoformat())

    # ── 5. Econ events: ALWAYS from ForexFactory (real data, never AI) ────────
    #    Overlays econ/fed on whichever earnings path ran above.
    _curate_econ_events(week_start, week_end, days)

    # ── 6. Company names from the ticker_meta cache (non-blocking) ───────────
    _attach_names(days)

    result = {
        "week_start":      week_start,
        "week_end":        week_end,
        "days":            days,
        "source":          source,
        "is_current_week": True,
    }
    cache.set("calendar_weekly", result, ttl=_CACHE_TTL)
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


def _is_fed_speaker(title: str) -> bool:
    t = title.lower()
    return any(x in t for x in _FED_TERMS)


def _fmt_time(dt: datetime) -> str:
    h  = dt.hour % 12 or 12
    m  = dt.minute
    ap = "AM" if dt.hour < 12 else "PM"
    return f"{h}:{m:02d} {ap}"


def _fetch_ff_events(week_start: str, week_end: str) -> dict:
    """Fetch USD economic events from ForexFactory for the given week range.
    Returns {YYYY-MM-DD: {econ: [...], fed: [...]}}
    """
    import requests

    result: dict[str, dict] = {}

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

            # Keep: High/Medium impact + all Fed speakers
            is_fed = _is_fed_speaker(title)
            if impact == "Low" and not is_fed:
                continue

            date_raw = ev.get("date", "")
            if not date_raw:
                continue
            try:
                dt = datetime.fromisoformat(date_raw).astimezone(_ET)
                ds = dt.strftime("%Y-%m-%d")
            except Exception:
                continue

            if ds < week_start or ds > week_end:
                continue

            if ds not in result:
                result[ds] = {"econ": [], "fed": []}

            time_str = _fmt_time(dt)
            forecast = ev.get("forecast") or None
            previous = ev.get("previous") or None

            if is_fed:
                result[ds]["fed"].append({
                    "time":  time_str,
                    "event": title,
                    "note":  impact,
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
                })

    return result


def _curate_econ_events(week_start: str, week_end: str, days: dict) -> None:
    """Fetch real economic events from ForexFactory and inject into days in-place."""
    try:
        ff = _fetch_ff_events(week_start, week_end)
        for ds, buckets in ff.items():
            if ds in days:
                days[ds]["econ"] = buckets["econ"]
                days[ds]["fed"]  = buckets["fed"]
        total = sum(len(b["econ"]) + len(b["fed"]) for b in ff.values())
        _logger.info("Calendar: FF econ loaded %d events across %d days", total, len(ff))
    except Exception as exc:
        _logger.warning("Calendar: FF econ fetch failed: %s", exc)


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
    _curate_econ_events(week_start, week_end, days)
    _attach_names(days)

    result = {
        "week_start":      week_start,
        "week_end":        week_end,
        "days":            days,
        "source":          "refresh",
        "is_current_week": True,
    }
    cache.set("calendar_weekly", result, ttl=_CACHE_TTL)
    totals = {ds: {"bmo": len(d["bmo"]), "amc": len(d["amc"]),
                   "tbd": len(d.get("tbd", [])), "econ": len(d["econ"])}
              for ds, d in days.items()}
    return {"ok": True, "totals": totals}


# ── Live price reactions for reported tickers (Massive batch snapshot) ─────────

_REACTIONS_TTL = 30              # seconds — live during market hours
_PAST_REACTIONS_TTL = 24 * 3600  # settled history only (see get_reactions)
_PAST_REACTIONS_MAX_SYMS = 80
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
def get_reactions(date: str | None = None):
    """Return post-print reaction %% for all reported tickers on a given date.

    Today/future: live todaysChangePerc via ONE Massive batch snapshot (30s TTL).
    Past dates: computed once from daily bars (24h TTL) — the live snapshot is
    meaningless for a print that happened days ago.
    Resolves the day from whichever week cache owns the date (paging-aware).
    """
    import re as _re
    if date and not _re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return {}

    target = date or _today_et().isoformat()

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


@router.get("/api/calendar/day-metrics")
def get_day_metrics(date: str | None = None):
    """Return price, avg_vol, mc_b for every ticker on a given date.

    Primary: Finviz Elite v=152 screener (price, 30d avg vol, market cap in one call).
    Fallback: Massive batch rich snapshots (price + prev-day vol).
    mc_b also sourced from the calendar chip data (wire-computed, most accurate).

    TTL: 2 min — these fields don't need to update frequently.
    """
    import re as _re
    if date and not _re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return {}

    target = date or _today_et().isoformat()
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
                        return float(s) / 1e9
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
    if not fv_ok:
        try:
            from api.services.massive import _get_client
            rich = _get_client().get_batch_rich_snapshots(syms)
            for sym, snap in rich.items():
                if sym in result:
                    result[sym]["price"]   = snap.get("price")
                    result[sym]["avg_vol"] = snap.get("vol")   # prev-day vol proxy
        except Exception as exc:
            _logger.warning("Calendar metrics: Massive fallback failed: %s", exc)

    cache.set(cache_key, result, ttl=ttl)
    return result


# ── Personalization endpoint ───────────────────────────────────────────────────

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


def _compute_enrichment_for_date(target: str) -> dict:
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
    ttl = (_ENRICH_TTL if in_current_week
           else _ENRICH_TTL_PAST if is_past
           else _ENRICH_TTL_FUTURE_WEEK)

    from api.services.earnings_enrichment import get_implied_move, get_historical_earnings_moves
    from api.services.earnings_estimates import get_earnings_intel

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
            n = raw.get("n_quarters") or len(moves)
            up = sum(1 for m in moves if m > 0)
            return {
                "avg_abs_move": raw.get("avg_abs_move_pct"),
                "up_count":     up,
                "total":        n,
                "last_n":       list(reversed(moves[:8])),   # newest first, capped 8
            }
        except Exception:
            return None

    def _one(sym):
        move = None
        hist = None
        hist_stats = None
        if not is_past:
            # _bounded_em: a hung yfinance option-chain call frees this worker
            # after the timeout instead of pinning it (524-outage class), on a
            # pool ISOLATED from yf_util's shared one.
            move = _bounded_em(lambda s=sym: get_implied_move(s, earnings_date=target))
        try:
            intel = get_earnings_intel(sym)
            hist = intel.get("beat_history") if intel else None
        except Exception:
            pass
        try:
            hist_stats = _compute_hist_stats(sym)
        except Exception:
            pass
        return sym, {"expected_move": move, "beat_history": hist, "hist_stats": hist_stats}

    # Bounded WAIT for a compute slot — a request that can't get one returns
    # empty (uncached) instead of parking an anyio thread for the duration of
    # someone else's compute; SWR's next poll picks up the winner's cache.
    if not _ENRICH_SEMAPHORE.acquire(timeout=_ENRICH_ACQUIRE_TIMEOUT):
        return cache.get(ck) or {}
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

    _ENRICH_STATS[target] = {
        "total":     len(syms),
        "with_em":   sum(1 for v in out.values() if v.get("expected_move")),
        "with_hist": sum(1 for v in out.values() if v.get("hist_stats")),
        "past":      is_past,
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


@router.get("/api/calendar/enrichment")
def get_enrichment(date: str | None = None):
    """Single-day enrichment overlay. See _compute_enrichment_for_date."""
    import re as _re
    if date and not _re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return {}
    target = date or _today_et().isoformat()
    return _compute_enrichment_for_date(target)


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
    for d in dates.split(","):
        d = d.strip()
        if d and _re.match(r"^\d{4}-\d{2}-\d{2}$", d):
            out[d] = _compute_enrichment_for_date(d)
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
