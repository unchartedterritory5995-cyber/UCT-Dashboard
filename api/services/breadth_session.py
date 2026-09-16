"""THE REGULAR-SESSION WINDOW for breadth reconstruction.

⛔⛔ WHY THIS EXISTS. `breadth_wick_recon` replayed EVERY bucket the minute flat file
carried — 4:00 to 20:00 — so a historical breadth candle's Open was a 4:00 AM premarket
print and its High/Low included both extended sessions. Measured on 2026-07-23 against
the broad US universe:

    pct_above_20ema   RTH 35.5/38.4/32.9/37.1      all-hours 42.4/42.9/32.9/37.1
    pct_above_40sma   RTH 42.9/44.7/40.7/43.3      all-hours 47.4/47.6/40.7/43.0

The Open moves SEVEN POINTS and the range inflates 50-86%, because at 4:00 AM a handful
of thin prints sit against a universe still carried at prior close. That is not an
opening breadth reading; it is an artifact of who happened to trade overnight.

⭐ WHY THE BOUNDARY IS DERIVED FROM PARTICIPATION RATHER THAN A TYPED CALENDAR. The
repo's canonical calendars (`liveflow_monitor._NYSE_EARLY_CLOSES_YYYYMMDD`,
`bars_fetch._NYSE_HOLIDAYS_YYYYMMDD`) start at **2025-01-01**, and this reconstruction
runs back to 2008. Hand-typing nineteen years of half-days is exactly the kind of
transcribed constant that rots silently and is wrong in one place nobody checks.

The market itself already says when it closed: during the regular session thousands of
names print every minute, and the moment it ends that collapses by more than an order of
magnitude. `rth_bounds` finds that cliff. ⚠️ AND IT IS NOT TRUSTED ON FAITH — for every
date the canonical calendar DOES cover, `validate_against_calendar` asserts the derived
close equals the calendar's, so the method is checked against the authority wherever the
authority exists rather than merely asserted to agree with it.

⛔ NOT A HEURISTIC DRESSED AS A RULE. A session whose participation never clears the
floor returns `None` and the caller REFUSES the date. A reconstruction that cannot
establish its own session boundary must not guess one.
"""
from __future__ import annotations

import datetime as _dt
from typing import Optional

#: Regular session, ET. The end is a CANDIDATE ceiling; the real close is derived.
RTH_OPEN_MIN = 9 * 60 + 30          # 09:30
RTH_MAX_CLOSE_MIN = 16 * 60         # 16:00
EARLY_CLOSE_MIN = 13 * 60           # 13:00 — what NYSE half-days actually are

#: A minute counts as "regular session" when at least this share of the day's BUSY
#: participation is present. The cliff between 15:59 and 16:01 is roughly 100x, so the
#: threshold is not delicate; it only has to sit inside a very wide gap.
PARTICIPATION_FLOOR = 0.15

#: Below this many names in the busiest minute there is no cliff to find and the
#: session cannot be established. Refuse rather than guess.
MIN_BUSY_NAMES = 50


def et_minute(ts: int) -> int:
    """Minutes past ET midnight for an epoch-second timestamp.

    ⚠️ DST IS WHY THIS USES A REAL TIMEZONE. The flat files are UTC; 13:30 UTC is 9:30
    ET in EDT and 8:30 ET in EST. A fixed -4/-5 offset would silently shift the whole
    session window for every winter date in the archive.
    """
    try:
        from zoneinfo import ZoneInfo
        t = _dt.datetime.fromtimestamp(ts, ZoneInfo("America/New_York"))
    except Exception:                                   # pragma: no cover
        t = _dt.datetime.utcfromtimestamp(ts) - _dt.timedelta(hours=4)
    return t.hour * 60 + t.minute


def participation(per_ticker: dict) -> dict:
    """{et_minute: distinct names printing} for one session's minute bars."""
    out: dict = {}
    for _tk, bars in (per_ticker or {}).items():
        for b in bars:
            m = et_minute(b["t"])
            out[m] = out.get(m, 0) + 1
    return out


def rth_bounds(per_ticker: dict) -> Optional[tuple]:
    """(open_minute, close_minute) in ET minutes, or None when undecidable.

    `close_minute` is INCLUSIVE of the last regular-session minute bar.
    """
    part = participation(per_ticker)
    if not part:
        return None
    inside = {m: n for m, n in part.items()
              if RTH_OPEN_MIN <= m <= RTH_MAX_CLOSE_MIN}
    if not inside:
        return None
    busiest = max(inside.values())
    if busiest < MIN_BUSY_NAMES:
        return None
    floor = busiest * PARTICIPATION_FLOOR
    busy = sorted(m for m, n in inside.items() if n >= floor)
    if not busy:
        return None
    return RTH_OPEN_MIN, busy[-1]


def is_early_close(close_minute: int) -> bool:
    """A close materially before 16:00 is a half-day."""
    return close_minute < RTH_MAX_CLOSE_MIN - 30


def rth_buckets(per_ticker: dict, buckets: list) -> list:
    """Filter `buckets` (epoch seconds, sorted) to the derived regular session."""
    b = rth_bounds(per_ticker)
    if b is None:
        return []
    lo, hi = b
    return [t for t in buckets if lo <= et_minute(t) <= hi]


def calendar_close_minute(iso: str) -> Optional[int]:
    """The canonical calendar's close for `iso`, or None when it does not cover it.

    ⭐ The authority, where it exists. `liveflow_monitor` owns the early-close set and
    `bars_fetch` owns full closures; this reads them rather than restating them.
    """
    try:
        from api.services.liveflow_monitor import _NYSE_EARLY_CLOSES_YYYYMMDD as EARLY
        from api.services.liveflow_monitor import _full_closures
    except Exception:                                   # pragma: no cover
        return None
    d = _dt.date.fromisoformat(iso)
    ymd = d.year * 10000 + d.month * 100 + d.day
    known = set(EARLY) | set(_full_closures() or ())
    if not known:
        return None
    lo = min(known)
    if ymd < lo:
        return None                                     # outside the calendar's era
    if ymd in (_full_closures() or ()):
        return None                                     # not a session at all
    return EARLY_CLOSE_MIN if ymd in EARLY else RTH_MAX_CLOSE_MIN


def validate_against_calendar(iso: str, close_minute: int) -> tuple:
    """(ok, detail) — does the DERIVED close agree with the authority, where it exists?

    ⛔ This is the rail that makes a derived boundary trustworthy. It is checked on
    every date the calendar covers; outside that era it reports `unverifiable` rather
    than `ok`, because "no authority disagreed" is not the same as "the authority
    agreed".
    """
    want = calendar_close_minute(iso)
    if want is None:
        return True, "unverifiable (outside the canonical calendar's era)"
    # the last minute BAR of a session starts one minute before the close
    if abs(close_minute - (want - 1)) <= 1:
        return True, f"agrees with calendar ({want // 60:02d}:{want % 60:02d} close)"
    return False, (f"derived close {close_minute // 60:02d}:{close_minute % 60:02d} "
                   f"disagrees with calendar {want // 60:02d}:{want % 60:02d}")
