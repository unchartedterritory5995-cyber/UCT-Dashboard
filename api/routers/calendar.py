"""Weekly earnings + economic events calendar endpoint.

Data priority:
  1. wire_data['weekly_calendar'] — multi-source earnings (rich)
  2. EarningsWhispers live fetch for each weekday — earnings only
  3. Empty structure — graceful fallback

Economic events: always fetched live from ForexFactory (real data, no AI hallucination).
POST /api/calendar/refresh — rebuild cache immediately
"""

from __future__ import annotations
import logging
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

        def _chip(c: dict) -> dict:
            rev = c.get("rev_est")
            # Wire chips store rev as raw dollars (millions × 1_000_000); convert back to millions.
            if rev is not None and rev > 1_000_000:
                rev = rev / 1_000_000
            return {
                "sym":     c.get("sym", ""),
                "eps_est": c.get("eps_est"),
                "eps_act": c.get("eps_act"),
                "rev_est": rev,
                "ew":      int(c.get("ew", c.get("ew_total", 0)) or 0),
            }

        days[ds] = {
            "label":    wd.get("label", d.strftime("%a %b ") + str(d.day)),
            "day":      wd.get("day",   d.strftime("%A")),
            "is_today": d == today,
            "bmo":      [_chip(c) for c in wd.get("bmo", [])],
            "amc":      [_chip(c) for c in wd.get("amc", [])],
            "econ":     wd.get("econ", []),
            "fed":      wd.get("fed",  []),
        }
    return days


# ── Live EarningsWhispers path ─────────────────────────────────────────────────

def _build_live(week_dates: list[date], today: date) -> dict:
    """Parallel EarningsWhispers fetch for each weekday. No econ events."""
    from api.services.engine import _fetch_ew_live

    results: dict[str, dict] = {}

    def _fetch(d: date) -> None:
        ds = d.strftime("%Y-%m-%d")
        try:
            raw = _fetch_ew_live(ds)
        except Exception as exc:
            _logger.warning("EW fetch failed for %s: %s", ds, exc)
            raw = []

        bmo: list[dict] = []
        amc: list[dict] = []
        for item in raw:
            entry = {
                "sym":     item["symbol"],
                "eps_est": item.get("eps_estimate"),
                "eps_act": item.get("eps_actual"),
                "rev_est": item.get("rev_estimate"),  # already in millions from _fetch_ew_live
                "ew":      int(item.get("ew_total", 0) or 0),
            }
            (bmo if item["hour"] == "bmo" else amc).append(entry)

        bmo.sort(key=lambda x: x["ew"], reverse=True)
        amc.sort(key=lambda x: x["ew"], reverse=True)

        results[ds] = {
            "label":    d.strftime("%a %b ") + str(d.day),
            "day":      d.strftime("%A"),
            "is_today": d == today,
            "bmo":      bmo[:40],
            "amc":      amc[:40],
            "econ":     [],
            "fed":      [],
        }

    threads = [threading.Thread(target=_fetch, args=(d,)) for d in week_dates]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    return results


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

    # ── 1. Wire data (AI-curated econ + multi-source earnings) ────────────────
    try:
        from api.services.engine import _load_wire_data
        wire = _load_wire_data()
        if wire and wire.get("weekly_calendar"):
            days = _from_wire(wire["weekly_calendar"], week_dates, today)
            result = {
                "week_start": week_start,
                "week_end":   week_end,
                "days":       days,
                "source":     "wire",
            }
            cache.set("calendar_weekly", result, ttl=_CACHE_TTL)
            return result
    except Exception as exc:
        _logger.warning("Calendar: wire_data path error: %s", exc)

    # ── 2. Live EarningsWhispers + econ curation ──────────────────────────────
    try:
        days = _build_live(week_dates, today)
        for d in week_dates:
            ds = d.strftime("%Y-%m-%d")
            if ds not in days:
                days[ds] = _empty_day(d, today)
        _curate_econ_events(week_start, week_end, days)
        result = {
            "week_start": week_start,
            "week_end":   week_end,
            "days":       days,
            "source":     "live",
        }
        cache.set("calendar_weekly", result, ttl=_CACHE_TTL)
        return result
    except Exception as exc:
        _logger.warning("Calendar: live build error: %s", exc)

    # ── 3. Empty fallback ─────────────────────────────────────────────────────
    days = {d.strftime("%Y-%m-%d"): _empty_day(d, today) for d in week_dates}
    return {
        "week_start": week_start,
        "week_end":   week_end,
        "days":       days,
        "source":     "empty",
    }


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
                result[ds]["econ"].append({
                    "time":     time_str,
                    "event":    title,
                    "estimate": forecast,
                    "prior":    previous,
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
    """Rebuild the calendar cache immediately — earnings from EW + econ from Claude."""
    cache.invalidate("calendar_weekly")

    week_dates = _week_dates()
    today      = _today_et()
    week_start = week_dates[0].isoformat()
    week_end   = week_dates[-1].isoformat()

    # Fetch earnings in parallel from EarningsWhispers
    days = _build_live(week_dates, today)
    for d in week_dates:
        ds = d.strftime("%Y-%m-%d")
        if ds not in days:
            days[ds] = _empty_day(d, today)

    # Curate econ events via Claude Haiku
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
