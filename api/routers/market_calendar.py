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

from fastapi import APIRouter, Response

from api.services.bars_fetch import _NYSE_HOLIDAYS_YYYYMMDD

router = APIRouter()

_MAX_AGE = 86_400


def _iso(yyyymmdd: int) -> str:
    s = str(yyyymmdd)
    return f"{s[0:4]}-{s[4:6]}-{s[6:8]}"


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
    days = sorted(_NYSE_HOLIDAYS_YYYYMMDD)
    response.headers["Cache-Control"] = f"public, max-age={_MAX_AGE}"
    return {
        "holidays": [_iso(d) for d in days],
        "covers_through": f"{str(days[-1])[:4]}-12-31" if days else None,
        "source": "bars_fetch._NYSE_HOLIDAYS_YYYYMMDD",
    }
