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
# cadence to be met without the warning becoming background noise. Must stay in
# step with `_MILESTONE_DAYS[0]` — a first milestone outside the expiring window
# would never fire, which a test pins.
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


# The days-remaining values that get a PUSH rather than a feed entry. Chosen to
# be self-limiting: an alert that fires on all 180 days is an alert nobody reads
# by day three, and `_DISCORD_COOLDOWN_SEC` is 30 min, so a permanently-critical
# `expiring` would page up to 48x/day for half a year.
_MILESTONE_DAYS = (180, 90, 30, 14, 7, 3, 1)


def _announce(status: str, days_remaining: int | None, today: date) -> None:
    """Put a non-clean runway on a surface a human actually reads.

    🔴 THE FEED ALONE WAS NOT A SIGNAL, IT WAS A LOTTERY. `chart_health_alerts`
    keeps its entries in an in-memory `deque(maxlen=200)` behind an admin page
    nobody is prompted to open, and that deque is WIPED ON EVERY REDEPLOY —
    which happens several times a day here. It pages Discord only on
    `critical`, and the first cut mapped `expiring → "warning"`, so the whole
    180-day early warning had no push path at all: Discord heard about it only
    at `expired`, i.e. after the countdown had already vanished for every
    member. A warning that arrives with the failure is a post-mortem.

    ⛔ AND THE FIX IS NOT "make expiring critical" — 30-minute cooldown × 180
    days is thousands of messages, which is the same as no alert. So the push
    is MILESTONE-GATED: seven days out of the 180 get a `critical` (and
    therefore a page), each under its own alert key so the feed shows them
    separately and the per-key cooldown does not swallow the next one. Every
    other expiring day still lands in the feed as a `warning`.

    ⚠️ HONEST LIMIT — MEASURED, AND WORSE THAN THIS DOCSTRING FIRST CLAIMED.
    `chart_health_alerts._DISCORD_COOLDOWN_SEC` is 30 minutes **per key**, and
    a milestone key is constant for its whole day, so a milestone day pages
    roughly 48 times, not "a handful": ~336 across the seven milestones, and
    ~48/day indefinitely once `expired`. Day-stamping buys DISTINCTNESS in the
    feed, never a lower rate — the earlier sentence here claimed a rate
    reduction the code does not produce, which is the exact defect class this
    alert exists to catch, written into the alert itself.

    Left as-is deliberately: `_COVERS_THROUGH` is 2027-12-31, so the first
    milestone is ~2027-07-04 and nothing here can fire for ~10 months. The fix
    is to thread a longer `cooldown=` through `emit` for these keys. Until then
    the blast radius is the owner's Discord channel — which is shared with
    signups, theme-engine and chart-health alerts, so a muted channel is the
    real cost, not member impact.

    Called from the request path rather than at import so a cold module cannot
    emit before the app is up; `emit` is in-memory and throttled per key, so
    the per-request call is free. Never raises — the same best-effort idiom
    `provider_coverage_monitor._alert` uses.
    """
    if status == "ok":
        return

    milestone = status == "expiring" and days_remaining in _MILESTONE_DAYS
    if status == "expiring":
        # A milestone is the moment this needs to LEAVE the building; every
        # other expiring day is a note in the feed.
        key = f"market_calendar_expiring_{days_remaining}d" if milestone else "market_calendar_stale"
        severity = "critical" if milestone else "warning"
    else:
        # expired / unknown — the countdown is already gone for everyone.
        # Day-stamped so each day is a DISTINCT entry in the feed. NOT a rate
        # limit: the 30-min cooldown is per key and this key is constant all
        # day, so it still pages ~48x/day. See the HONEST LIMIT above.
        key = f"market_calendar_{status}_{today.isoformat()}"
        severity = "critical"

    msg = (
        f"NYSE closure table is {status}"
        + (f" ({days_remaining} days left)" if days_remaining is not None else "")
        + f" — the dashboard countdown stops rendering when it lapses; {_REFRESH_HINT}"
    )
    _logger.warning("[market-calendar] %s", msg)
    try:
        from api.services import chart_health_alerts

        chart_health_alerts.emit(
            key, severity, msg,
            {"status": status, "days_remaining": days_remaining,
             "covers_through": _COVERS_THROUGH, "milestone": milestone},
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
    today = date.today()
    status, days_remaining = _classify(today)
    _announce(status, days_remaining, today)
    response.headers["Cache-Control"] = f"public, max-age={_MAX_AGE}"
    return {
        "holidays": list(_HOLIDAYS_ISO),
        "covers_through": _COVERS_THROUGH,
        "status": status,
        "days_remaining": days_remaining,
        "source": "bars_fetch._NYSE_HOLIDAYS_YYYYMMDD",
    }
