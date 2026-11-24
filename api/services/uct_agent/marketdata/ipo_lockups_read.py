"""MD-1 kind `ipo.lockups` (owner: terminal-data, data wave 11) — IPO lockups ending soon or lately, as held.

The companies of the site's last-year listings whose ESTIMATED lockup expiry (the listing date plus 180 calendar days,
rolled to the next trading session) falls between 7 days ago and 30 days ahead, soonest first: the company, the listing
date and where it came from, the estimated expiry and the days to go, and the change since listing from the site's own
closes. EVERY row is an estimate (the server holds no prospectus) and says so. The Agent half of IPO LOCKUP, over the
answer of `GET /api/scans/ipo-lockups` (`api/services/ipo_lockups.py`), with the route's own field names (the IpoLockup
panel's model reads them).

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `ipo_lockups.get_lockups` answers
through `held_build.HeldBuild.get()`, which STARTS the one background build (a read of the listings scan's held answer,
the name cache and each row's daily closes) when the held answer is due, and with nothing held waits on it. A turn must
not, so this adapter never calls it. It reads through `ipo_lockups_held.held_lockups()`, the service's held answer
(`_HELD.peek()`, which never starts a build). provider_calls is always 0. A rail shows `get_lockups` starting that build in
the same state.

NOTHING HELD IS SAID, NEVER "NO LOCKUPS": nothing held, or a held answer from before the listings scan answered
(`warming`), is `unavailable` with that reason. A window with no estimated expiry is an answer (no row), said with its
dates. A change since listing the closes cannot give is null with the service's own reason, never 0.

WHAT IS STATED: every row is the service's own, passed through, and its `basis` is always `estimated` (a row is never
called stated here). The rows return the first `rows` (soonest first), cut from the FAR end, with the count in the window
beside them. Where each listing date came from is kept as the service's key (`listing_source`).

TIME (MD-1 §3): `as_of` = the listings scan's own time (`listings_as_of`), in UTC; never the time of the read. The days to
go are counted from the day the answer was built (`today`), said; when UCT built it rides as `data.built_at`. The read is
`stale`, with a note, when that day is earlier than today in New York (`ipo_lockups.now_et`, the service's clock): the
days to go are then off by the days since, and this read never builds it again. Every read is `periodic`; the kind is
DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the listings and their dates come from the market-data vendor's
reference data and UCT's daily bar store (docs/terminal-research/09-security-licensing-cost/licensing-register.md, rows
T-04 and T-09: the vendor's daily history, its display and its storage; row T-14: the vendor's numbers into a model,
restricted), the same set the IPO calendar's listings use (row T-52: the IPO calendar for member display; its AI row,
T-54, class R). No row clears these rows for a model provider. The same rule as `calendar.ipos`. Shown to the member
only; the capability is local-only.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole, day_as_of

KIND = "ipo.lockups"
SOURCE = "uct-ipo-lockups"
DEFAULT_ROWS = 10
MAX_ROWS = 60
BASIS = "estimated"                      # ipo_lockups.BASIS (a rail pins the two together)
LISTING_SOURCES = ("first_bar", "relisting", "reference")      # ipo_lockups.LISTING_SOURCES, by key
CHANGE_REASONS = ("bars_unreadable", "no_closes", "no_first_day", "no_later_close")   # ipo_lockups.change_since_listing

NOTE_WHAT = ("the IPO lockups UCT worked out for IPO LOCKUP from the companies its last-year listings scan holds ({listings} "
             "listed, {dated} with a listing date): each one's lockup expiry ESTIMATED as its listing date plus {days} "
             "calendar days, rolled to the next trading session, between {start} and {end}. The prospectus sets the actual "
             "date: every row is an estimate, never a stated date, and not advice")
NOTE_AS_OF = ("`as_of` is the time of the listings scan the list was worked out from ({at}); it is never the time of the "
              "read. The days to go are counted from {today}")
NOTE_NO_SCAN_TIME = "`as_of` is the start of {today}, the day the list was worked out: the listings scan's own time was not given"
NOTE_STALE = ("UCT worked this list out on {today}; a newer day has begun in New York ({now}), so each row's days to go is "
              "{late} days behind, and this read never works it out again")
NOTE_NONE = "no estimated lockup expiry falls between {start} and {end}"
NOTE_CUT = ("{total} estimated expiries fall in the window and the {shown} soonest are returned: the list is cut from the "
            "FAR end")
NOTE_NO_DATE = "{n} listed stocks have no listing date, so no expiry can be estimated for them: they are left out"
NOTE_NO_CHANGE = ("{n} rows have no change since listing (the site's closes cannot give one), said by its reason, never "
                  "a change of 0")
NOTE_WARMING = ("the last-year listings scan had not answered since the server started when the list was last worked "
                "out, so no lockup is stated. That is not the same as no lockups")
NOTE_NOT_HELD = ("the IPO lockup list is not held on this server yet, and this read never works it out. That is not the "
                 "same as no lockups. Open IPO LOCKUP in UCT, then ask again")
NOTE_FAILED = "the IPO lockup read failed; nothing is stated. That is not the same as no lockups"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. The list takes no symbol."""
    if not isinstance(params, dict):
        return "the request must be an object"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer() -> tuple[Optional[dict], str]:
    """READ ONLY: (the service's held answer, 'held' | 'not_held'), WITHOUT starting a build
    (`ipo_lockups_held.held_lockups`)."""
    from api.services import ipo_lockups_held as svc
    return svc.held_lockups()


def today_et() -> str:
    """Today in New York by the service's own clock (`ipo_lockups.now_et`; pure: no read)."""
    from api.services import ipo_lockups as svc
    return svc.now_et().date().isoformat()


def basis_words() -> str:
    """The service's own words for every row's basis (`ipo_lockups.BASIS_WORDS`)."""
    from api.services import ipo_lockups as svc
    return svc.BASIS_WORDS


def _change(c: Any) -> dict:
    c = c if isinstance(c, dict) else {}
    return {"pct": _num(c.get("pct")), "first_close": _num(c.get("first_close")), "first_date": _day(c.get("first_date")),
            "last_close": _num(c.get("last_close")), "last_date": _day(c.get("last_date")),
            "reason": c.get("reason") if c.get("reason") in CHANGE_REASONS else None}


def _row(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or not isinstance(r.get("symbol"), str) or not _day(r.get("estimated_expiry")):
        return None
    days = r.get("days_to_go")
    return {"symbol": r["symbol"][:12], "company": r["company"][:120] if isinstance(r.get("company"), str) else None,
            "listing_date": _day(r.get("listing_date")),
            "listing_source": r.get("listing_source") if r.get("listing_source") in LISTING_SOURCES else None,
            "estimated_expiry": _day(r.get("estimated_expiry")),
            "days_to_go": days if isinstance(days, int) and not isinstance(days, bool) else None,
            "basis": BASIS, "change_since_listing": _change(r.get("change_since_listing"))}


def _utc(v: Any) -> Optional[str]:
    try:
        at = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return env.utc_iso(at.astimezone(timezone.utc)) if at.tzinfo else None


def read_lockups(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    limit = params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer()
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how != "held" or not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    if got.get("status") == "warming":
        return env.unavailable(KIND, params, SOURCE, NOTE_WARMING)
    try:
        return _answer(params, got, limit)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, got: dict, limit: int) -> dict:
    today = _day(got.get("today"))
    w = got.get("window") if isinstance(got.get("window"), dict) else {}
    c = got.get("counts") if isinstance(got.get("counts"), dict) else {}
    rows = sorted((x for x in (_row(r) for r in (got.get("rows") or [])) if x),
                  key=lambda x: (x["estimated_expiry"], x["symbol"]))
    shown = rows[:limit]
    start, end = _day(w.get("from")) or "a day it does not give", _day(w.get("to")) or "a day it does not give"
    scan_at = _utc(got.get("listings_as_of"))
    notes = [NOTE_WHAT.format(listings=_whole(c.get("listings")) or 0, dated=_whole(c.get("with_listing_date")) or 0,
                              days=_whole(got.get("lockup_days")) or 180, start=start, end=end),
             NOTE_AS_OF.format(at=scan_at, today=today) if scan_at else NOTE_NO_SCAN_TIME.format(today=today)]
    now = today_et()
    stale = bool(today and today < now)
    if stale:
        notes.append(NOTE_STALE.format(today=today, now=now, late=(date.fromisoformat(now) - date.fromisoformat(today)).days))
    if not rows:
        notes.append(NOTE_NONE.format(start=start, end=end))
    elif len(rows) > len(shown):
        notes.append(NOTE_CUT.format(total=len(rows), shown=len(shown)))
    if _whole(c.get("without_listing_date")):
        notes.append(NOTE_NO_DATE.format(n=_whole(c.get("without_listing_date"))))
    no_change = sum(1 for r in shown if r["change_since_listing"]["pct"] is None)
    if no_change:
        notes.append(NOTE_NO_CHANGE.format(n=no_change))
    by_source = c.get("by_source") if isinstance(c.get("by_source"), dict) else {}
    data = {"today": today, "window": {"from": _day(w.get("from")), "to": _day(w.get("to")), "behind_days": _whole(w.get("behind_days")),
                                       "ahead_days": _whole(w.get("ahead_days"))},
            "lockup_days": _whole(got.get("lockup_days")), "basis": BASIS,
            "basis_words": basis_words(),
            "built_at": _read_at(got.get("built_at")), "listings_as_of": scan_at,
            "counts": {"listings": _whole(c.get("listings")), "with_listing_date": _whole(c.get("with_listing_date")),
                       "without_listing_date": _whole(c.get("without_listing_date")), "in_window": len(rows),
                       "by_source": {k: _whole(by_source.get(k)) or 0 for k in (*LISTING_SOURCES, "unknown")}},
            "rows": shown, "stale_for": ["earlier_day"] if stale else []}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=scan_at or day_as_of(today), source=SOURCE,
                             data=data, stale=stale, notes=notes, provider_calls=0)
