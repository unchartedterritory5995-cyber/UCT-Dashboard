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
from datetime import datetime, timezone
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


def _clean(v) -> str | None:
    if v is None or v == "":
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v)


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
             "is_fed": is_fed},
        ))

    result: dict[str, list[dict]] = {}
    for ds, items in out.items():
        # Pick by importance…
        keep = sorted(items, key=lambda t: (t[0], t[1]))[:max(1, limit_per_day)]
        # …then present chronologically, the way a calendar reads.
        result[ds] = [e for _, _, e in sorted(keep, key=lambda t: t[1])]
    return result
