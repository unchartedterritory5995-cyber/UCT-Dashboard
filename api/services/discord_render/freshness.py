"""One market clock and one freshness envelope for the Discord render path (03 §3.8; C-07, C-10).

Two questions this module is the single answer to:

  1. **What session is it?** `session_state(now)` → `holiday | weekend | pre | rth | post | overnight`.
  2. **Is this data fresh enough to draw without a warning?** `envelope(...)` → the stamp that
     travels with every payload, and the `stale` verdict the STALE badge is drawn from.

⛔ ONE CLOSURE LIST. The holiday set is `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD`, imported, never copied.
A second table drifts the first time somebody refreshes one of them — and a holiday that only one
table knows about makes every freshness predicate read the day as a missed session (the Memorial Day
2026 failure that list was created for).

⛔ STALE IS A VERDICT ABOUT THE SESSION, NOT A FIXED AGE. Daily bars at 09:00 ET on a Tuesday are
fine (yesterday's close is the last completed session) and the same bars at 15:00 ET are stale.
Overnight and at the weekend nothing is stale, because no new bar exists to be missing — a chart
that says "stale" all weekend teaches everyone to ignore the badge.

⛔ AND "UNKNOWN" IS NOT "FRESH". A payload with no `as_of` gets `stale=None`, which the caller must
render as an absent badge rather than a clean bill of health.

The prose version of these rules, so nobody re-introduces a fixed age budget, is
`docs/discord-render/03-architecture.md` → "Freshness semantics" (owner ruling R-1, 2026-09-13).
"""
from __future__ import annotations

import datetime as dt
from dataclasses import asdict, dataclass
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

HOLIDAY, WEEKEND, PRE, RTH, POST, OVERNIGHT = "holiday", "weekend", "pre", "rth", "post", "overnight"
CLOSED_STATES = (HOLIDAY, WEEKEND, OVERNIGHT)

PRE_OPEN = (4, 0)      # 04:00 ET — the first pre-market print the feed carries
RTH_OPEN = (9, 30)
RTH_CLOSE = (16, 0)
POST_CLOSE = (20, 0)   # 20:00 ET — the last extended print

# How late a bar may be before the chart says so, per timeframe, DURING RTH. Two bar intervals:
# one for the bar still forming, one of slack for the provider's own lag.
_INTRADAY_MINUTES = {"1": 1, "5": 5, "15": 15, "30": 30, "60": 60}
RTH_DAILY_BUDGET_S = 90 * 60      # a daily bar mid-session may lag; it is the forming bar

AGE, SESSION = "age", "session"   # which rule decided `stale`


def last_trading_date(on_or_before: dt.date) -> dt.date:
    """The most recent NYSE trading date on or before `on_or_before`."""
    d = on_or_before
    for _ in range(12):                       # a run of closures is never this long
        if d.weekday() < 5 and not is_holiday(d):
            return d
        d -= dt.timedelta(days=1)
    return d


def expected_session_date(now: dt.datetime | None = None) -> dt.date:
    """The trading date whose bar we should already hold.

    ⛔ THIS, NOT AN AGE, IS WHAT "FRESH" MEANS WHEN THE MARKET IS SHUT. Friday's close is the
    correct newest bar all weekend and at Monday's pre-open — 65 hours old and perfectly fresh. A
    fixed age budget calls that stale, which is how a badge ends up showing every weekend until
    everyone ignores it."""
    n = _et(now)
    state = session_state(n)
    if state in (RTH, POST):
        return n.date()                                   # today's session exists (forming or done)
    if state == PRE:
        return last_trading_date(n.date() - dt.timedelta(days=1))
    if state == OVERNIGHT:
        if (n.hour, n.minute) >= POST_CLOSE:              # after 20:00 — today traded
            return last_trading_date(n.date())
        return last_trading_date(n.date() - dt.timedelta(days=1))
    return last_trading_date(n.date())                    # weekend / holiday


def _et(now: dt.datetime | None = None) -> dt.datetime:
    now = now or dt.datetime.now(ET)
    return now.astimezone(ET) if now.tzinfo else now.replace(tzinfo=ET)


def is_holiday(day: dt.date) -> bool:
    """NYSE full-day closure. Half days are trading sessions and are NOT in the list."""
    from api.services.bars_fetch import _NYSE_HOLIDAYS_YYYYMMDD
    return int(day.strftime("%Y%m%d")) in _NYSE_HOLIDAYS_YYYYMMDD


def session_state(now: dt.datetime | None = None) -> str:
    """`holiday | weekend | pre | rth | post | overnight` for an ET instant.

    Order matters: a holiday is a holiday even at 10:00, and a Saturday is a weekend even though
    04:00–09:30 would otherwise read as `pre`."""
    n = _et(now)
    if n.weekday() >= 5:
        return WEEKEND
    if is_holiday(n.date()):
        return HOLIDAY
    hm = (n.hour, n.minute)
    if hm < PRE_OPEN:
        return OVERNIGHT
    if hm < RTH_OPEN:
        return PRE
    if hm < RTH_CLOSE:
        return RTH
    if hm < POST_CLOSE:
        return POST
    return OVERNIGHT


def is_open(now: dt.datetime | None = None) -> bool:
    return session_state(now) == RTH


def is_intraday(tf: str) -> bool:
    return str(tf) in _INTRADAY_MINUTES


def budget_s(tf: str, state: str) -> int | None:
    """The age budget, in seconds, when the AGE rule applies — intraday during RTH, where a bar
    really should arrive every interval. `None` everywhere else, because the session rule decides
    there and a number would be a fiction two readers would disagree about."""
    if state != RTH or not is_intraday(tf):
        return None
    return _INTRADAY_MINUTES[str(tf)] * 60 * 2   # the forming bar, plus one interval of slack


@dataclass(frozen=True)
class Envelope:
    as_of_utc: str | None
    as_of_et: str | None
    provider: str | None
    session_state: str
    age_s: float | None
    budget_s: int | None
    stale: bool | None             # None = unknown, and unknown is NOT fresh
    rule: str | None = None        # "age" | "session" — which test produced `stale`
    expected_session: str | None = None

    def as_dict(self) -> dict:
        return asdict(self)

    @property
    def badge(self) -> str | None:
        """What the message says. None when there is nothing to warn about."""
        if self.stale is not True or not self.as_of_et:
            return None
        return f"⚠ data as of {self.as_of_et} ET (stale)"


def _parse(as_of) -> dt.datetime | None:
    """Accept what the bars layer actually carries: epoch seconds, epoch ms, an ISO string, or a
    datetime. Returns an aware UTC datetime, or None when it cannot tell."""
    if as_of is None or as_of == "":
        return None
    if isinstance(as_of, dt.datetime):
        return as_of.astimezone(dt.timezone.utc) if as_of.tzinfo else as_of.replace(tzinfo=ET).astimezone(dt.timezone.utc)
    if isinstance(as_of, (int, float)):
        v = float(as_of)
        if v > 1e11:               # milliseconds
            v /= 1000.0
        try:
            return dt.datetime.fromtimestamp(v, dt.timezone.utc)
        except (OSError, OverflowError, ValueError):
            return None
    text = str(as_of).strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S%z", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            parsed = dt.datetime.strptime(text.replace("Z", "+0000"), fmt)
        except ValueError:
            continue
        # A bare date or a naive timestamp from this pipeline is an ET wall-clock reading.
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=ET)).astimezone(dt.timezone.utc)
    return None


def envelope(as_of, *, tf: str = "D", provider: str | None = None, now: dt.datetime | None = None) -> Envelope:
    """The stamp that travels with a payload. `as_of` is the newest BAR's timestamp — the data's
    vintage, never the wall clock (§3.10: the same closed-market input must render the same pixels)."""
    n = _et(now)
    state = session_state(n)
    budget = budget_s(tf, state)
    expected = expected_session_date(n)
    when = _parse(as_of)
    if when is None:
        return Envelope(None, None, provider, state, None, budget, None, None, expected.isoformat())
    age = (n.astimezone(dt.timezone.utc) - when).total_seconds()
    if budget is not None:
        # AGE rule — intraday during RTH. Negative age (a provider clock ahead of ours) is not
        # stale, and the negative number is kept rather than clamped so the caller can log it.
        stale, rule = bool(age > budget), AGE
    else:
        # SESSION rule — is the newest bar from the session we should already have?
        stale, rule = when.astimezone(ET).date() < expected, SESSION
    return Envelope(
        as_of_utc=when.strftime("%Y-%m-%dT%H:%M:%SZ"),
        as_of_et=when.astimezone(ET).strftime("%Y-%m-%d %H:%M"),
        provider=provider,
        session_state=state,
        age_s=round(age, 1),
        budget_s=budget,
        stale=stale,
        rule=rule,
        expected_session=expected.isoformat(),
    )
