"""Weekly earnings + economic events calendar endpoint.

Data priority:
  1. wire_data['weekly_calendar'] — multi-source earnings (rich, 5-source aggregated)
  2. EarningsWhispers + Finviz Elite live fetch for each weekday — earnings only
  3. Empty structure — graceful fallback

Economic events: always fetched live from ForexFactory (real data, never AI).
Finnhub actuals patch: applied to today's pending tickers on every cache miss.
POST /api/calendar/refresh — rebuild cache immediately
GET  /api/calendar/reactions?date=YYYY-MM-DD — live gap % for reported tickers (Massive)
"""

from __future__ import annotations
import logging
import os
import threading
from datetime import date, timedelta, datetime
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")
from fastapi import APIRouter
from api.services.cache import cache

_logger = logging.getLogger(__name__)
router = APIRouter()

_CACHE_TTL = 1800  # 30 min


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

def _from_wire(wire_calendar: dict, week_dates: list[date], today: date) -> dict:
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
            return {
                "sym":     sym,
                "eps_est": _clean_eps(c.get("eps_est"), sym),
                "eps_act": _clean_eps(c.get("eps_act"), sym),
                "rev_est": _to_m(c.get("rev_est")),
                "rev_act": _to_m(c.get("rev_act")),
                "ew":      int(c.get("ew", c.get("ew_total", 0)) or 0),
                "mc_b":    c.get("mc_b"),   # market cap in billions (for client-side filtering)
            }

        days[ds] = {
            "label":    wd.get("label", d.strftime("%a %b ") + str(d.day)),
            "day":      wd.get("day",   d.strftime("%A")),
            "is_today": d == today,
            "bmo":      [_chip(c) for c in wd.get("bmo", [])],
            "amc":      [_chip(c) for c in wd.get("amc", [])],
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
            entry = {
                "sym":     sym,
                "eps_est": _clean_eps_live(item.get("eps_estimate")),
                "eps_act": _clean_eps_live(item.get("eps_actual")),
                "rev_est": item.get("rev_estimate"),  # already in millions from _fetch_ew_live
                "rev_act": item.get("rev_actual"),    # already in millions from _fetch_ew_live
                "ew":      int(item.get("ew_total", 0) or 0),
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

    # ── 1. Earnings: wire data (4-source aggregated, confidence-scored) ────────
    source = "empty"
    days: dict | None = None
    try:
        from api.services.engine import _load_wire_data
        wire = _load_wire_data()
        if wire and wire.get("weekly_calendar"):
            days = _from_wire(wire["weekly_calendar"], week_dates, today)
            source = "wire"
    except Exception as exc:
        _logger.warning("Calendar: wire_data path error: %s", exc)

    # ── 2. Earnings fallback: live EarningsWhispers ───────────────────────────
    if days is None:
        try:
            days = _build_live(week_dates, today)
            for d in week_dates:
                ds = d.strftime("%Y-%m-%d")
                if ds not in days:
                    days[ds] = _empty_day(d, today)
            source = "live"
        except Exception as exc:
            _logger.warning("Calendar: live build error: %s", exc)

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


@router.post("/api/calendar/refresh")
def refresh_calendar():
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
