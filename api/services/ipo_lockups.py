"""IPO LOCKUP: the IPO lockups ending in the next 30 days and the past 7, from what the server already holds.

WHAT A ROW IS
  A company the site's last-year listings scan holds (`scan_ipo`, the list `GET /api/scans/ipo-1y` and LEAD IPO
  show) whose ESTIMATED lockup expiry falls between 7 days ago and 30 days ahead: its listing date plus
  `LOCKUP_DAYS` calendar days, rolled to the next trading session. Insiders are usually free to sell from about
  then; the exact term is in each company's prospectus and varies. The server holds no prospectus, so EVERY row
  is an estimate and says so (`basis`, `basis_words`); none is called stated.

WHERE EACH PART COMES FROM (all held on this server; no vendor call, no prospectus read)
  * the companies and their listing dates: `scan_ipo.held_listings()` (the live pass's last answer, which drops
    funds, names not trading and names under the scan's tradability floor, and where each listing date came from:
    the first daily bar in the site's bar store, the day a reused ticker's current listing began, or the listing
    date in Massive's reference data);
  * the company name: `held_reads.held_name` (the name cache the charts already hold), else none;
  * the change since listing: the site's own daily closes (`local_bars.read_bars`, current listing only): the
    latest close against the first day's close. The IPO price is not held, so it is never the offer price; a stock
    whose held closes start more than `FIRST_BAR_MAX_GAP_DAYS` after its listing date has no change, with the reason.

THE HOUSE RULE (builder rule 5)
  One answer held in this module, built by ONE background thread (`held_build.HeldBuild`); a request never builds:
  it gets the held answer, or waits a few seconds on the one build it started, or is told `computing`. The build is
  small: one memory read and one local bar read per row in the window (tens of names).
"""
from __future__ import annotations

import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from api.services.held_build import HeldBuild

LOCKUP_DAYS = 180
AHEAD_DAYS = 30
BEHIND_DAYS = 7
BASIS = "estimated"
BASIS_WORDS = "estimated: 180 days after listing; the prospectus sets the actual date"
SOURCE = "the site's last-year listings scan (LEAD IPO), its daily closes and its name cache"
LISTING_SOURCES = {
    "first_bar": "its first daily bar in the site's bar store",
    "relisting": "the day the ticker's current listing began (a reused ticker)",
    "reference": "the listing date in Massive's reference data",
}
FIRST_BAR_MAX_GAP_DAYS = 7
BARS_WANT = 300
REFRESH_S = 30 * 60.0       # a held answer is refreshed in the background at most this often
WARMING_RETRY_S = 15.0      # while the listings scan has not answered yet, look again this soon
VERSION = 1


def now_et() -> datetime:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York"))


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _ymd(v) -> Optional[date]:
    s = str(v or "").replace("-", "")[:8]
    if len(s) != 8 or not s.isdigit():
        return None
    try:
        return date(int(s[:4]), int(s[4:6]), int(s[6:]))
    except ValueError:
        return None


def estimated_expiry(listing: date) -> Optional[date]:
    """Listing date + LOCKUP_DAYS calendar days, rolled forward to the next NYSE session."""
    from api.services import session_calendar
    d = listing + timedelta(days=LOCKUP_DAYS)
    for _ in range(10):
        try:
            if session_calendar.is_trading_day(d):
                return d
        except Exception:  # noqa: BLE001 -- no date beats a guessed one
            return None
        d += timedelta(days=1)
    return None


def change_since_listing(sym: str, listing: date) -> dict:
    """The latest held close against the first day's close: {pct, first_close, first_date, last_close, last_date,
    reason}. `pct` is None with a reason word when it cannot be said."""
    out = {"pct": None, "first_close": None, "first_date": None, "last_close": None, "last_date": None, "reason": None}
    try:
        from api.services import local_bars
        bars = local_bars.read_bars(sym, local_bars.DAILY_TF, BARS_WANT) or []
    except Exception:  # noqa: BLE001 -- the row stands without it
        return {**out, "reason": "bars_unreadable"}
    dated = [(d, b) for b in bars if (d := _ymd(b.get("t"))) is not None
             and isinstance(b.get("c"), (int, float)) and not isinstance(b.get("c"), bool) and b["c"] > 0]
    after = [(d, b) for d, b in dated if d >= listing]
    if not after:
        return {**out, "reason": "no_closes"}
    (fd, fb), (ld, lb) = after[0], after[-1]
    out.update(first_close=float(fb["c"]), first_date=fd.isoformat(), last_close=float(lb["c"]), last_date=ld.isoformat())
    if (fd - listing).days > FIRST_BAR_MAX_GAP_DAYS:
        return {**out, "reason": "no_first_day"}
    if ld <= fd:
        return {**out, "reason": "no_later_close"}
    return {**out, "pct": round((float(lb["c"]) / float(fb["c"]) - 1.0) * 100.0, 2)}


def _base(today: date) -> dict:
    return {"v": VERSION, "today": today.isoformat(), "lockup_days": LOCKUP_DAYS, "basis": BASIS,
            "basis_words": BASIS_WORDS, "source": SOURCE, "built_at": _iso_now(),
            "window": {"behind_days": BEHIND_DAYS, "ahead_days": AHEAD_DAYS,
                       "from": (today - timedelta(days=BEHIND_DAYS)).isoformat(),
                       "to": (today + timedelta(days=AHEAD_DAYS)).isoformat()}}


def build(previous: Optional[dict] = None, *, now: Optional[datetime] = None) -> tuple[dict, str]:
    """`(answer, note)` from what is held now. Never a vendor call."""
    from api.services import scan_ipo
    from api.services.held_reads import held_name
    today = (now or now_et()).date()
    held = scan_ipo.held_listings()
    live = held.get("live")
    results = live.get("results") if isinstance(live, dict) else None
    base = _base(today)
    if not isinstance(results, list):
        return ({**base, "status": "warming", "listings_as_of": None, "listings_date": held.get("date"),
                 "counts": {"listings": 0, "with_listing_date": 0, "without_listing_date": 0, "in_window": 0,
                            "by_source": {}}, "rows": []},
                "warming: the last-year listings scan has not answered since the server started")
    sources = held.get("sources") or {}
    rows, with_date, without = [], 0, 0
    by_source: dict[str, int] = {}
    for r in results:
        if not isinstance(r, dict):
            continue
        sym = str(r.get("sym") or "").strip().upper()
        listing = _ymd(r.get("ipo_date"))
        if not sym or listing is None:
            without += 1
            continue
        with_date += 1
        expiry = estimated_expiry(listing)
        if expiry is None:
            continue
        days = (expiry - today).days
        if not -BEHIND_DAYS <= days <= AHEAD_DAYS:
            continue
        kind = sources.get(sym) if sources.get(sym) in LISTING_SOURCES else None
        by_source[kind or "unknown"] = by_source.get(kind or "unknown", 0) + 1
        rows.append({"symbol": sym, "listing_date": listing.isoformat(), "listing_source": kind,
                     "listing_source_words": LISTING_SOURCES.get(kind) if kind else None,
                     "estimated_expiry": expiry.isoformat(), "days_to_go": days, "basis": BASIS,
                     "basis_words": BASIS_WORDS})
    rows.sort(key=lambda x: (x["estimated_expiry"], x["symbol"]))
    for row in rows:
        row["company"] = held_name(row["symbol"])
        row["change_since_listing"] = change_since_listing(row["symbol"], date.fromisoformat(row["listing_date"]))
    answer = {**base, "status": "ok", "listings_as_of": live.get("as_of"), "listings_date": held.get("date"),
              "counts": {"listings": len(results), "with_listing_date": with_date, "without_listing_date": without,
                         "in_window": len(rows), "by_source": by_source},
              "rows": rows}
    return answer, f"listings={len(results)} dated={with_date} in_window={len(rows)}"


def _due(answer: dict, checked: float) -> bool:
    age = time.time() - checked
    if answer.get("status") != "ok":
        return age >= WARMING_RETRY_S
    if answer.get("today") != now_et().date().isoformat():
        return True
    from api.services import scan_ipo
    if answer.get("listings_as_of") != ((scan_ipo.held_listings().get("live") or {}).get("as_of")) and age >= 60:
        return True
    return age >= REFRESH_S


def _valid(answer) -> bool:
    return isinstance(answer, dict) and answer.get("v") == VERSION and isinstance(answer.get("rows"), list)


_HELD = HeldBuild("ipo-lockups", lambda previous: build(previous), _due, valid=_valid)


def get_lockups() -> dict:
    """THE REQUEST PATH (`GET /api/scans/ipo-lockups`): the held answer, else a few seconds on the one build it
    starts, else `{"status": "computing"}`.

    status: 'ok' | 'warming' (the listings scan has not answered since the server started) | 'computing' |
            'failed' (the build broke; it is tried again shortly)
    ok:     today, window {from, to, behind_days, ahead_days}, lockup_days, basis ('estimated'), basis_words, source,
            built_at, listings_as_of, counts {listings, with_listing_date, without_listing_date, in_window, by_source},
            rows [{symbol, company (None when the name is not held), listing_date, listing_source, listing_source_words,
            estimated_expiry, days_to_go, basis, basis_words, change_since_listing {pct, first_close, first_date,
            last_close, last_date, reason}}], soonest first
    """
    out = _HELD.get()
    return {k: v for k, v in out.items() if k != "v"}


def reset_for_tests() -> None:
    _HELD.reset()
