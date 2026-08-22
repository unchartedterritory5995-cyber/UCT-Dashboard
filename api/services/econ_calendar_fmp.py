"""US economic calendar for an arbitrary week, from FMP.

Why this exists: the calendar page's econ overlay comes from ForexFactory, whose
`ff_calendar_nextweek.json` feed now **404s** — so any week other than the
current one comes back with zero events (verified against prod 2026-07-30 for
the week of Aug 3). A Saturday "week ahead" post therefore had no econ data at
all from that source.

FMP's `stable/economic-calendar` covers arbitrary date ranges on this plan
(79 US events for Aug 3-7). Its `date` field is **UTC** — NFP comes back at
12:30, which is 08:30 ET in EDT — so it is converted through a real timezone,
never a fixed offset, or the times would be an hour off half the year.

Never raises: returns {} on any failure, and the caller decides what to do with
an empty result.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, time as _time, timedelta, timezone
from zoneinfo import ZoneInfo

_logger = logging.getLogger(__name__)

_ET = ZoneInfo("America/New_York")

# Mirrors the ForexFactory curation: high/medium impact releases, plus anything
# that is a Fed speaker regardless of impact.
_KEEP_IMPACT = {"high", "medium"}

# Selection rank when a day has more events than fit. FMP's Medium bucket is
# noisy — left purely time-ordered, a Wednesday spent slots on "EIA Gasoline
# Stocks Change" and three ISM sub-indices while ADP and ISM Services competed
# for the same space. Rank by importance, THEN restore time order for display.
_IMPACT_RANK = {"high": 1, "medium": 2}
_KEY_RANK = 0            # Fed speakers + the calendar's own _KEY_TERMS win first

# Recurring prints that are not macro calendar events for an equities desk:
# weekly mortgage applications and commodity inventory draws. Left in, they took
# 3 of Wednesday's 8 slots (MBA 30-Year Mortgage Rate, EIA Crude, EIA Gasoline)
# while ADP competed for the same space. Deliberately SHORT and substring-based
# — this is a noise filter, not a whitelist, so an unfamiliar release still
# shows up rather than being silently swallowed.
_NOISE = (
    "mba ", "mortgage rate", "mortgage applications",
    "api crude", "eia crude", "eia gasoline", "eia natural gas",
    "crude oil stock", "gasoline stocks", "cushing",
)


def _is_noise(title: str) -> bool:
    t = title.lower()
    return any(n in t for n in _NOISE)


def _fmt_time(dt: datetime) -> str:
    h = dt.hour % 12 or 12
    ap = "AM" if dt.hour < 12 else "PM"
    return f"{h}:{dt.minute:02d} {ap}"


def _et_date(row) -> str | None:
    """ET calendar date of a raw FMP row, or None."""
    try:
        return (datetime.strptime(str(row.get("date") or "")[:19], "%Y-%m-%d %H:%M:%S")
                .replace(tzinfo=timezone.utc).astimezone(_ET).strftime("%Y-%m-%d"))
    except ValueError:
        return None


def with_symposium_keynote(rows: list) -> list:
    """FMP dates Jackson Hole's opening day ("Jackson Hole Symposium", Thu) but —
    most years — never the Chair's keynote the following morning, the event the
    desk actually trades (found 8/21/26: Warsh's 8/28 keynote was nowhere in the
    feed). Derive it from the DATED symposium row, never from recall: next day,
    10:00 ET (the symposium's traditional keynote slot), role-labeled so a stale
    Chair name can never render. A provider row already covering that day wins."""
    for row in rows:
        title = (str(row.get("event") or "")).lower()
        if "jackson hole" not in title:
            continue
        # Only the symposium row seeds the derivation — a chair-speech row that
        # itself mentions Jackson Hole must not spawn a keynote the day after.
        if any(w in title for w in ("chair", "keynote", "speech", "speaks")):
            continue
        if (row.get("country") or "").upper() not in ("US", "USA"):
            continue
        ds = _et_date(row)
        if ds is None:
            continue
        target = (datetime.strptime(ds, "%Y-%m-%d") + timedelta(days=1)).date()
        covered = any(
            _et_date(r) == target.isoformat()
            and ("chair" in str(r.get("event") or "").lower()
                 or "jackson hole" in str(r.get("event") or "").lower())
            for r in rows if r is not row)
        if covered:
            break
        keynote_utc = datetime.combine(target, _time(10, 0), tzinfo=_ET).astimezone(timezone.utc)
        return rows + [{
            "date": keynote_utc.strftime("%Y-%m-%d %H:%M:%S"), "country": "US",
            "event": "Fed Chair Keynote (Jackson Hole)", "impact": "High",
        }]
    return rows


def _clean(v) -> str | None:
    if v is None or v == "":
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v)


def fetch_us_econ_week_full(from_ds: str, to_ds: str) -> dict:
    """{YYYY-MM-DD (ET): {econ: [...], fed: [...]}} — EVERY US econ event (all impacts,
    no curation), each carrying actual/estimate/prior + an impact tier
    ('low'|'medium'|'high'). Powers the Calendar WIDGET's star filter, which needs the
    low-impact events AND the actual prints (ForexFactory's JSON feed has neither).
    Returns {} on any failure."""
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        _logger.warning("[econ-fmp-full] FMP_API_KEY not set")
        return {}
    try:
        import requests
        r = requests.get(
            "https://financialmodelingprep.com/stable/economic-calendar",
            params={"from": from_ds, "to": to_ds, "apikey": key},
            timeout=20,
        )
        if not r.ok:
            _logger.warning("[econ-fmp-full] HTTP %d", r.status_code)
            return {}
        rows = r.json()
        if not isinstance(rows, list):
            return {}
    except Exception as exc:                            # noqa: BLE001
        _logger.warning("[econ-fmp-full] fetch failed: %s", exc)
        return {}
    rows = with_symposium_keynote(rows)

    from api.routers.calendar import _is_fed_speaker, _is_high_impact

    out: dict[str, dict] = {}
    for row in rows:
        if (row.get("country") or "").upper() not in ("US", "USA"):
            continue
        title = (row.get("event") or "").strip()
        if not title:
            continue
        raw = str(row.get("date") or "")
        try:
            dt = datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone.utc).astimezone(_ET)
        except ValueError:
            continue
        ds = dt.strftime("%Y-%m-%d")
        if ds < from_ds or ds > to_ds:
            continue
        fmp_imp = (row.get("impact") or "").lower()
        if _is_high_impact(title) or fmp_imp == "high":
            tier = "high"
        elif fmp_imp == "medium":
            tier = "medium"
        else:
            tier = "low"
        bucket = out.setdefault(ds, {"econ": [], "fed": []})
        if _is_fed_speaker(title):
            bucket["fed"].append({"time": _fmt_time(dt), "event": title,
                                  "note": row.get("impact"), "impact": tier})
        else:
            bucket["econ"].append({
                "time": _fmt_time(dt), "event": title,
                "estimate": _clean(row.get("estimate")),
                "prior": _clean(row.get("previous")),
                "actual": _clean(row.get("actual")),
                "impact": tier,
            })
    return out


def fetch_us_econ_week(from_ds: str, to_ds: str, limit_per_day: int = 8) -> dict[str, list[dict]]:
    """{YYYY-MM-DD (ET): [{time, event, estimate, prior, is_fed}]}.

    At most `limit_per_day` events per day, chosen by IMPACT and then returned
    in TIME order — so a busy day keeps NFP and drops the crude-oil inventory
    print, rather than keeping whichever happened to be released first.
    """
    key = os.environ.get("FMP_API_KEY", "")
    if not key:
        _logger.warning("[econ-fmp] FMP_API_KEY not set")
        return {}
    try:
        import requests
        r = requests.get(
            "https://financialmodelingprep.com/stable/economic-calendar",
            params={"from": from_ds, "to": to_ds, "apikey": key},
            timeout=20,
        )
        if not r.ok:
            _logger.warning("[econ-fmp] HTTP %d", r.status_code)
            return {}
        rows = r.json()
        if not isinstance(rows, list):
            return {}
    except Exception as exc:                            # noqa: BLE001
        _logger.warning("[econ-fmp] fetch failed: %s", exc)
        return {}
    rows = with_symposium_keynote(rows)

    # Imported lazily so this module stays independent of the router. Reusing
    # the calendar's OWN _KEY_TERMS/_is_key_event means the Discord card and the
    # website agree on what counts as a marquee release.
    from api.routers.calendar import _is_fed_speaker, _is_key_event

    out: dict[str, list[tuple]] = {}
    for row in rows:
        if (row.get("country") or "").upper() not in ("US", "USA"):
            continue
        title = (row.get("event") or "").strip()
        if not title:
            continue
        is_fed = _is_fed_speaker(title)
        impact = (row.get("impact") or "").lower()
        if impact not in _KEEP_IMPACT and not is_fed:
            continue
        if _is_noise(title) and not is_fed:
            continue
        rank = (_KEY_RANK if (is_fed or _is_key_event(title))
                else _IMPACT_RANK.get(impact, 3))

        raw = str(row.get("date") or "")
        try:
            dt = datetime.strptime(raw[:19], "%Y-%m-%d %H:%M:%S").replace(
                tzinfo=timezone.utc).astimezone(_ET)
        except ValueError:
            continue

        ds = dt.strftime("%Y-%m-%d")
        # The UTC->ET shift can move an event across the date line; keep only
        # what still lands inside the requested window.
        if ds < from_ds or ds > to_ds:
            continue
        out.setdefault(ds, []).append((
            rank, dt,
            {"time": _fmt_time(dt), "event": title,
             "estimate": _clean(row.get("estimate")),
             "prior": _clean(row.get("previous")),
             "is_fed": is_fed,
             "is_key": rank == _KEY_RANK and not is_fed},
        ))

    result: dict[str, list[dict]] = {}
    for ds, items in out.items():
        # Pick by importance…
        keep = sorted(items, key=lambda t: (t[0], t[1]))[:max(1, limit_per_day)]
        # …then present chronologically, the way a calendar reads.
        result[ds] = [e for _, _, e in sorted(keep, key=lambda t: t[1])]
    return result
