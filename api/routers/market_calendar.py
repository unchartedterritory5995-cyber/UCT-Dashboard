"""GET /api/market-calendar — the NYSE full-closure dates, as data.

🔴 WHY THIS EXISTS. Zone A's countdown ("Opens in 16h 16m") is computed in the
browser by `app/src/pages/dashboard/useSessionState.js`, which knows weekends
and clock hours and nothing else — so on Thanksgiving or Christmas the paid
home counts down, confidently and to the minute, to an open that will not
happen.

⛔ AND THE FIX IS NOT A SECOND TABLE. This repo already maintains exactly one
NYSE closure list, `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD`, with an explicit
"refresh annually from nyse.com/markets/hours-calendars" contract on it; five
services read it (`barspack`, `catalyst/engine`, `discord_index_close`,
`liveflow_monitor`, `screener/scan_evaluator`). Typing those dates into a
frontend constant would be a second authority over one value — this repo's
most repeated defect — and the two copies would diverge in the year whichever
one nobody remembered to update. So this route DERIVES its answer from that
frozenset and serves it; the browser reads, it does not restate.

Public on purpose, like `/api/quote-of-the-day`: these are published exchange
dates, they carry nothing personal, and Zone A must render for a free-tier
member (the Dashboard is a FREE_PAGE) without a 401/402 turning the countdown
off. `Cache-Control` is a day because the underlying set changes about once a
year, by hand, in a deploy.

⚠️ FULL CLOSURES ONLY, exactly as `_is_nyse_holiday` documents: a 1pm ET early
close is still a trading session with a real 09:30 open, so including those
would make the countdown wrong in the OTHER direction.
"""

from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, Response

from api.services.bars_fetch import _NYSE_HOLIDAYS_YYYYMMDD

router = APIRouter()
_logger = logging.getLogger(__name__)

_MAX_AGE = 86_400

# How much runway the table must keep before we start saying so. The source set
# is refreshed BY HAND, once a year; half a year of notice is enough for that
# cadence to be met without the warning becoming background noise.
_EXPIRING_WITHIN_DAYS = 180

_REFRESH_HINT = (
    "refresh api/services/bars_fetch.py::_NYSE_HOLIDAYS_YYYYMMDD from "
    "nyse.com/markets/hours-calendars"
)


def _iso(yyyymmdd: int) -> str:
    s = str(yyyymmdd)
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


# ⭐ COMPUTED ONCE, AT IMPORT. The frozenset is immutable and module-level, so
# re-sorting and re-formatting 31 dates on every request bought nothing.
_HOLIDAYS_ISO: tuple[str, ...] = tuple(_iso(d) for d in sorted(_NYSE_HOLIDAYS_YYYYMMDD))
_COVERS_THROUGH: str | None = f"{_HOLIDAYS_ISO[-1][:4]}-12-31" if _HOLIDAYS_ISO else None


def _classify(today: date) -> tuple[str, int | None]:
    """`(status, days_remaining)` for the table's runway against *today*.

    🔴 THE ANTI-ROT SIGNAL, AND WHY IT IS DATA RATHER THAN A TEST. The closure
    list carries a hand-written "refresh annually" contract that nothing
    enforced: the day it stops being refreshed, `covers_through` stops moving,
    the dashboard countdown walks past it and DISAPPEARS — and "no countdown"
    already means "still loading" and "endpoint down", so the permanent failure
    is indistinguishable from a transient that will clear.

    ⛔ A `assert max_year >= today.year + 1` RAIL WOULD BE THE WRONG SHAPE — it
    goes red purely because time passed, which is the dated time bomb this repo
    has an explicit lesson against, and it fires in CI on whatever unrelated
    change happens to run first.

    So the signal is a FIELD, always present, always positive when clean:
      * `ok`       — looked, and there is runway. `days_remaining` says how much.
      * `expiring` — looked, and the cliff is inside _EXPIRING_WITHIN_DAYS.
      * `expired`  — looked, and it is past. `days_remaining` is negative.
      * (no `status` key at all) — an older deploy that DID NOT LOOK.
    That last line is the distinction the field exists to make: silence and
    "clean" are different answers, and a check that only speaks up when it is
    unhappy cannot tell them apart.
    """
    if _COVERS_THROUGH is None:
        return "unknown", None
    remaining = (date.fromisoformat(_COVERS_THROUGH) - today).days
    if remaining < 0:
        return "expired", remaining
    if remaining <= _EXPIRING_WITHIN_DAYS:
        return "expiring", remaining
    return "ok", remaining


def _announce(status: str, days_remaining: int | None) -> None:
    """Put a non-clean runway on a surface a human actually reads.

    `chart_health_alerts` is the in-app admin alert feed (rendered by
    `pages/admin/ChartHealth.jsx`) and pages Discord on `critical`; it is
    in-memory, throttled per key, and never raises — the same best-effort idiom
    `provider_coverage_monitor._alert` uses. Called from the request path
    rather than at import so a cold module cannot emit before the app is up,
    and the throttle makes the per-request call free.
    """
    if status == "ok":
        return
    msg = (
        f"NYSE closure table is {status}"
        + (f" ({days_remaining} days)" if days_remaining is not None else "")
        + f" — the dashboard countdown stops rendering when it lapses; {_REFRESH_HINT}"
    )
    _logger.warning("[market-calendar] %s", msg)
    try:
        from api.services import chart_health_alerts

        chart_health_alerts.emit(
            "market_calendar_stale",
            "critical" if status in ("expired", "unknown") else "warning",
            msg,
            {"status": status, "days_remaining": days_remaining,
             "covers_through": _COVERS_THROUGH},
        )
    except Exception:  # pragma: no cover - alerting must never break the route
        pass


@router.get("/api/market-calendar")
def market_calendar(response: Response) -> dict:
    """The NYSE full-closure dates this deploy knows about, ISO, ascending.

    ⭐ `covers_through` IS THE HORIZON, AND IT IS THE LOAD-BEARING FIELD.
    Without it, a date past the end of the table is indistinguishable from a
    date the exchange is open — so the day this list stops being refreshed,
    every consumer silently goes back to being holiday-blind and nothing says
    so. That is the "half-right calendar that goes stale" failure, which is
    worse than no calendar at all, so the horizon ships WITH the data and a
    consumer can refuse rather than guess.

    It is the end of the last calendar year the table ENUMERATES, not the last
    holiday in it: the source set is written a whole year at a time (see its
    comment, "keep this list ahead of `today` by at least one calendar year"),
    and using the last holiday would report the final week of that year as
    unknown when it is in fact known to have no closure in it.
    """
    status, days_remaining = _classify(date.today())
    _announce(status, days_remaining)
    response.headers["Cache-Control"] = f"public, max-age={_MAX_AGE}"
    return {
        "holidays": list(_HOLIDAYS_ISO),
        "covers_through": _COVERS_THROUGH,
        "status": status,
        "days_remaining": days_remaining,
        "source": "bars_fetch._NYSE_HOLIDAYS_YYYYMMDD",
    }
