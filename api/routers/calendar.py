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


def _empty_day(d: date, today: date) -> dict:
    return {
        "label":    d.strftime("%a %b ") + str(d.day),
        "day":      d.strftime("%A"),
        "is_today": d == today,
        "bmo":      [],
        "amc":      [],
        "econ":     [],
        "fed":      [],
    }


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


# ── Live EarningsWhispers + Finviz path ────────────────────────────────────────

def _build_live(week_dates: list[date], today: date) -> dict:
    """Parallel EarningsWhispers fetch + Finviz Elite supplement for each weekday."""
    from api.services.engine import _fetch_ew_live

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
        try:
            raw = _fetch_ew_live(ds)
        except Exception as exc:
            _logger.warning("EW fetch failed for %s: %s", ds, exc)
            raw = []

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
            "_seen":    seen,   # temp field for Finviz merge
            "econ":     [],
            "fed":      [],
        }

    threads = [threading.Thread(target=_fetch, args=(d,)) for d in week_dates]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    # Wait for Finviz (max 5s beyond EW threads)
    fv_done.wait(timeout=5)

    # Merge Finviz tickers not already in EW, using Finviz estimates
    for ds, day in results.items():
        seen = day.pop("_seen", set())
        fv_day = fv_result.get(ds, {})
        for timing_key, bucket_key in (("bmo", "bmo"), ("amc", "amc"), ("tbd", "amc")):
            for fv_entry in fv_day.get(timing_key, []):
                sym = fv_entry["sym"]
                if sym in seen:
                    continue
                seen.add(sym)
                day[bucket_key].append({
                    "sym":     sym,
                    "eps_est": fv_entry["eps_est"],
                    "eps_act": None,
                    "rev_est": fv_entry["rev_est"],
                    "rev_act": None,
                    "ew":      0,
                })

        day["bmo"].sort(key=lambda x: x["ew"], reverse=True)
        day["amc"].sort(key=lambda x: x["ew"], reverse=True)
        day["bmo"] = day["bmo"][:40]
        day["amc"] = day["amc"][:40]

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

    all_entries = day.get("bmo", []) + day.get("amc", [])
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

    # Compute first and last day of the requested month
    _, last_day = _cal_module.monthrange(year, month)
    from_date = f"{year:04d}-{month:02d}-01"
    to_date   = f"{year:04d}-{month:02d}-{last_day:02d}"

    cap_uni = _load_cap_universe()

    raw = _fh_get_month(from_date, to_date)
    days: dict[str, dict] = {}

    if raw:
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

        for row in raw.get("earningsCalendar", []):
            sym = (row.get("symbol") or "").strip().upper()
            if not sym:
                continue
            # Filter to cap_universe when available
            if cap_uni and sym not in cap_uni:
                continue

            ds = (row.get("date") or "").strip()
            if not ds or not ds.startswith(f"{year:04d}-{month:02d}"):
                continue

            # hour field: "bmo" | "amc" | "dmh" → dmh goes to amc bucket
            hour = (row.get("hour") or "amc").lower()
            timing = "bmo" if hour == "bmo" else "amc"

            rev_est_raw = row.get("revenueEstimate")
            rev_act_raw = row.get("revenueActual")

            entry = {
                "sym":     sym,
                "timing":  timing,
                "eps_est": _clean_eps(row.get("epsEstimate")),
                "eps_act": _clean_eps(row.get("epsActual")),
                # Store in millions (Finnhub returns raw dollars)
                "rev_est": round(rev_est_raw / 1_000_000, 1) if rev_est_raw else None,
                "rev_act": round(rev_act_raw / 1_000_000, 1) if rev_act_raw else None,
            }

            if ds not in days:
                days[ds] = {"bmo": [], "amc": []}
            days[ds][timing].append(entry)

    result = {"month": f"{year:04d}-{month:02d}", "days": days}
    cache.set(cache_key, result, ttl=_MONTH_CACHE_TTL)
    return result


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/api/calendar")
def get_calendar():
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
            for ds, day in days.items():
                day["bmo"] = [e for e in day["bmo"] if e["sym"] in cap_uni]
                day["amc"] = [e for e in day["amc"] if e["sym"] in cap_uni]
        for d in week_dates:
            ds = d.strftime("%Y-%m-%d")
            if ds not in days:
                days[ds] = _empty_day(d, today)
        source = "live"
    except Exception as exc:
        _logger.warning("Calendar: live build error: %s", exc)

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

    result = {
        "week_start": week_start,
        "week_end":   week_end,
        "days":       days,
        "source":     source,
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

    result = {
        "week_start": week_start,
        "week_end":   week_end,
        "days":       days,
        "source":     "refresh",
    }
    cache.set("calendar_weekly", result, ttl=_CACHE_TTL)
    totals = {ds: {"bmo": len(d["bmo"]), "amc": len(d["amc"]), "econ": len(d["econ"])} for ds, d in days.items()}
    return {"ok": True, "totals": totals}


# ── Live price reactions for reported tickers (Massive batch snapshot) ─────────

_REACTIONS_TTL = 30  # seconds — stays in sync with Massive movers polling


@router.get("/api/calendar/reactions")
def get_reactions(date: str | None = None):
    """Return live todaysChangePerc for all reported tickers on a given date.

    Uses Massive batch snapshot — one API call regardless of reporter count.
    TTL: 30s (live during market hours).
    Falls back to empty dict if Massive is unavailable.
    """
    import re as _re
    if date and not _re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return {}

    target = date or _today_et().isoformat()

    cache_key = f"calendar_reactions_{target}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # Pull reported tickers from the calendar cache (no extra network call)
    cal = cache.get("calendar_weekly")
    if not cal:
        return {}

    day = cal.get("days", {}).get(target, {})
    reported = [
        e["sym"] for e in (day.get("bmo", []) + day.get("amc", []))
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

    # Pull all tickers for the target date from calendar cache
    cal = cache.get("calendar_weekly")
    if not cal:
        return {}

    day = cal.get("days", {}).get(target, {})
    all_entries = day.get("bmo", []) + day.get("amc", [])
    if not all_entries:
        cache.set(cache_key, {}, ttl=_METRICS_TTL)
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

    cache.set(cache_key, result, ttl=_METRICS_TTL)
    return result


# ── Personalization endpoint ───────────────────────────────────────────────────

@router.get("/api/calendar/my-sets")
def calendar_my_sets(user: dict = Depends(get_current_user)):
    """Return the logged-in user's personalization ticker sets for the calendar."""
    sets = _cp.get_user_ticker_sets(user["id"])
    return _cp.to_payload(sets)


# ── Enrichment overlay endpoint ────────────────────────────────────────────────

_ENRICH_TTL = 300  # 5 min — options move is itself 60s-cached upstream


@router.get("/api/calendar/enrichment")
def get_enrichment(date: str | None = None):
    """Per-ticker expected move + 4-quarter beat history + hist_stats for a given day.

    Bounded + cached so the core /api/calendar paints instantly and this
    overlays on top. Empty dict if the calendar cache isn't warm yet.

    hist_stats shape: {avg_abs_move, up_count, total, last_n}
      avg_abs_move — average absolute post-earnings move over last N reports
      up_count     — number of those reports where the stock gapped up
      total        — total number of reports measured
      last_n       — last N individual moves (pct, newest first, capped at 8)
    """
    import re as _re
    from concurrent.futures import ThreadPoolExecutor
    if date and not _re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return {}
    target = date or _today_et().isoformat()

    ck = f"calendar_enrichment_{target}"
    hit = cache.get(ck)
    if hit is not None:
        return hit

    cal = cache.get("calendar_weekly")
    if not cal:
        return {}
    day = cal.get("days", {}).get(target, {})
    syms = [e["sym"] for e in (day.get("bmo", []) + day.get("amc", [])) if e.get("sym")]
    if not syms:
        cache.set(ck, {}, ttl=_ENRICH_TTL)
        return {}

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
        try:
            move = get_implied_move(sym, earnings_date=target)
        except Exception:
            pass
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

    out: dict = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for sym, data in ex.map(_one, syms):
            out[sym] = data

    cache.set(ck, out, ttl=_ENRICH_TTL)
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
    timing: 'bmo' | 'amc'
    """
    # DTSTART: BMO → 7 AM ET (12:00 UTC), AMC → 4 PM ET (21:00 UTC)
    # Using floating local-time form (TZID=America/New_York) so calendar apps
    # display it correctly in the user's local zone.
    hour = "07" if timing == "bmo" else "16"
    dtstart = f"TZID=America/New_York:{report_date.replace('-', '')}T{hour}0000"
    dtend_hour = "08" if timing == "bmo" else "17"
    dtend = f"TZID=America/New_York:{report_date.replace('-', '')}T{dtend_hour}0000"
    session_label = "BMO" if timing == "bmo" else "AMC"
    uid = f"{sym}-{report_date}-earnings@uctintelligence.com"
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
            for entry in day.get("bmo", []):
                sym = (entry.get("sym") or "").upper()
                if sym and (scope == "all" or sym in mine):
                    result.append((sym, ds, "bmo"))
            for entry in day.get("amc", []):
                sym = (entry.get("sym") or "").upper()
                if sym and (scope == "all" or sym in mine):
                    result.append((sym, ds, "amc"))

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
                for entry in day.get("bmo", []):
                    sym = (entry.get("sym") or "").upper()
                    if sym and (scope == "all" or sym in mine):
                        if not any(t[0] == sym and t[1] == ds for t in result):
                            result.append((sym, ds, "bmo"))
                for entry in day.get("amc", []):
                    sym = (entry.get("sym") or "").upper()
                    if sym and (scope == "all" or sym in mine):
                        if not any(t[0] == sym and t[1] == ds for t in result):
                            result.append((sym, ds, "amc"))
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
