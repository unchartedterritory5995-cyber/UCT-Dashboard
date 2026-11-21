"""MD-1 kind `calendar.ipos` (owner: terminal-data, data wave 8) — the IPO calendar, as held.

Upcoming and recently priced IPOs as the IPO calendar route serves them: each deal's day, company, symbol, exchange,
price or price range, shares offered, value and status, for the window the IPO calendar panel reads (last week's Monday
to next week's Friday around the read day, New York time). The Agent half of the IPO terminal function, over the
answer of `GET /api/calendar/ipos` (`api/services/ipo_calendar.py`). The stocks first traded in the last year (the
`/api/scans/ipo-1y` list) are NOT this kind: `leaders.longRun` already reads that list (its `IPO` lens).

⛔ ONLY THE CALENDAR THE SERVER ALREADY HOLDS, NEVER A VENDOR REQUEST (MD-1 §5). The route's
`ipo_calendar.get_ipos_with_status` asks two vendors (Finnhub and FMP) whenever nothing is held for the range. A turn
must not, so this adapter never calls it. It reads through `ipo_calendar_held.held_ipos(from, to)`, which returns the
merged rows the service stored for exactly that range (with the time it stored them), or the service's own record
that both vendors failed, or nothing, and never fetches. provider_calls is always 0. A rail shows
`get_ipos_with_status` reaching both vendors in the same state.

NOTHING HELD IS SAID, NEVER "NO IPOS": no calendar held for the window is `unavailable`, and so is the service's own
record that both vendors failed. A held calendar with no deal is a healthy answer: at least one vendor calendar
answered, and the ones that answered list none.

WHAT IS STATED: every field is the route's own, passed through. A field the calendars leave empty (price, shares or
value) is null, never 0. `value` is the dollar value of the shares offered where a calendar gives it; for some deals a
calendar gives the company's expected market value in its place, and the merged row does not say which: a note says
so, as the panel does. The canonical entity the service stamps on each row is not carried.

THE CUT IS STATED: deals today and ahead are listed soonest first and deals before today newest first, each list at
most `rows` deals; a longer list is cut from its FAR end (the latest days ahead, the oldest days before) and the note
says so. Each list's count of everything held rides beside what is shown.

TIME (MD-1 §3): the calendars carry no as-of time of their own, so `as_of` is null and a note says so; when UCT read
them (the time the service stored the range) rides beside it as `data.read_at`. The server keeps one range for at
most six hours (the service's own `_CACHE_TTL`), so a held calendar is never older and the read is never `stale`.
Every read is `periodic`, as the kind is declared. The read day (New York) picks the window and splits the deals
into ahead and before; it is never stated as the data's date.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-52 covers Finnhub's IPO calendar for
member display, and its AI row, row T-54, is class R in its class column, with the owner fact answered and LA in its
scenario column. The merged rows also carry FMP's leg: no row names FMP's IPO calendar, and FMP's AI row, row T-44,
is class U ("No AI clause"). A merged row does not say which vendor supplied a field. No row clears this calendar for
a model provider, and no other row does. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num

KIND = "calendar.ipos"
SOURCE = "uct-ipo-calendar"
DEFAULT_ROWS = 20
MAX_ROWS = 50
#: the IPO calendar panel's own window around the read day (ipoCalendarModel.js `ipoWindow`; a rail pins both numbers)
WINDOW_BACK_DAYS = 7
WINDOW_FORWARD_DAYS = 11
FIELDS = ("symbol", "name", "date", "exchange", "price_range", "shares", "value", "status")
MAX_TEXT = 120
MAX_STATUS = 24
_ET = ZoneInfo("America/New_York")

NOTE_WHAT = ("the IPO calendar for {start} to {end} (the window the IPO calendar panel reads: last week's Monday to next "
             "week's Friday) as UCT holds it, merged from two vendors' IPO calendars: each deal's day, company, symbol, "
             "exchange, price or price range, shares offered, value and status, deals today and ahead soonest first and "
             "earlier deals newest first. When one vendor fails the other's rows are served, and the server does not "
             "record which. A calendar of deals, not a forecast and not advice")
NOTE_AS_OF = ("the IPO calendars give no as-of time of their own, so `as_of` is null. UCT read them at {at} (UCT's own "
              "time); the server keeps one answer for at most {hours} hours, and this read never asks the vendors")
NOTE_VALUE = ("`value` is the dollar value of the shares offered where a calendar gives it; for some deals a calendar "
              "gives the company's expected market value in its place, and the merged row does not say which")
NOTE_MISSING = ("{n} deals have at least one field the calendars leave empty (price, shares or value); those fields are "
                "null, never 0")
NOTE_CUT_AHEAD = ("{total} deals are on the calendar for today and ahead and the soonest {shown} are returned: the list "
                  "is cut from the FAR end")
NOTE_CUT_EARLIER = ("{total} deals before today are on the calendar and the newest {shown} are returned: the list is cut "
                    "from the OLD end")
NOTE_NONE = ("no deal is on the IPO calendar for {start} to {end} in what UCT holds: the vendor calendars that answered "
             "list none")
NOTE_DROPPED = "{n} rows the server holds have no usable day or no company and are not returned"
NOTE_NOT_HELD = ("no IPO calendar is held on this server for {start} to {end} (the window the IPO calendar panel reads), "
                 "and this read never asks the vendors. That is not the same as no IPOs. Open the IPO calendar panel "
                 "(IPO) in UCT, then ask again")
NOTE_SOURCE_FAILED = ("UCT's last read of the IPO calendars for {start} to {end} found both vendors failing, at {at} "
                      "(UCT's own time); nothing is stated. That is not the same as no IPOs")
NOTE_FAILED = "the IPO calendar read failed; nothing is stated. That is not the same as no IPOs"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. The calendar takes no symbol."""
    if not isinstance(params, dict):
        return "the request must be an object"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def today_et() -> date:
    return datetime.now(_ET).date()


def window(today: date) -> tuple[str, str]:
    """The IPO calendar panel's window around `today` (a New York day): last week's Monday to next week's Friday."""
    monday = today - timedelta(days=today.weekday())
    return ((monday - timedelta(days=WINDOW_BACK_DAYS)).isoformat(),
            (monday + timedelta(days=WINDOW_FORWARD_DAYS)).isoformat())


def held_answer(start: str, end: str) -> tuple[Optional[list], Optional[float], str]:
    """READ ONLY: (the rows the service holds for the range, when it stored them, 'held' | 'failed' | 'not_held'),
    WITHOUT asking a vendor (`ipo_calendar_held.held_ipos`)."""
    from api.services import ipo_calendar_held as svc
    return svc.held_ipos(start, end)


def hold_hours() -> int:
    """How long the service keeps one range (`ipo_calendar._CACHE_TTL`), in hours, read at call time."""
    from api.services import ipo_calendar as svc
    return int(svc._CACHE_TTL) // 3600


def _text(v: Any, limit: int = MAX_TEXT) -> Optional[str]:
    return v.strip()[:limit] if isinstance(v, str) and v.strip() else None


def _positive(v: Any) -> Optional[float]:
    f = _num(v)
    return f if f is not None and f > 0 else None


def _deal(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or _day(r.get("date")) is None:
        return None
    sym, name = _text(r.get("sym"), 12), _text(r.get("name"))
    if not sym and not name:
        return None
    shares = _positive(r.get("shares"))
    status = _text(r.get("status"), MAX_STATUS)
    return {"symbol": sym.upper() if sym else None, "name": name, "date": _day(r["date"]), "exchange": _text(r.get("exchange")),
            "price_range": _text(r.get("price_range"), 40), "shares": int(shares) if shares is not None else None,
            "value": _positive(r.get("value")), "status": status.lower() if status else None}


def _key(d: dict) -> str:
    """Within a day: deals with a symbol first, by symbol, then the ones with only a name, by name (as the panel)."""
    return f"0{d['symbol']}" if d["symbol"] else f"1{d['name'] or ''}"


def read_ipos(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    limit = params.get("rows", DEFAULT_ROWS)
    try:
        today = today_et()
        start, end = window(today)
        rows, stored_at, how = held_answer(start, end)         # the held calendar only: never a vendor request
        hours = hold_hours()
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no IPOs"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    at = env.utc_iso(datetime.fromtimestamp(stored_at, tz=timezone.utc)) if isinstance(stored_at, (int, float)) else None
    if how == "not_held":
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(start=start, end=end))
    if how == "failed":
        return env.unavailable(KIND, params, SOURCE, NOTE_SOURCE_FAILED.format(
            start=start, end=end, at=at or "a time it did not record"))
    if how != "held" or not isinstance(rows, list) or at is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    deals = [x for x in (_deal(r) for r in rows) if x]
    dropped = len(rows) - len(deals)
    day = today.isoformat()
    ahead = sorted((d for d in deals if d["date"] >= day), key=lambda d: (d["date"], _key(d)))
    earlier = sorted((d for d in deals if d["date"] < day), key=lambda d: _key(d))
    earlier.sort(key=lambda d: d["date"], reverse=True)                    # newest day first, the panel's order within a day
    shown_ahead, shown_earlier = ahead[:limit], earlier[:limit]
    gaps = sum(1 for d in shown_ahead + shown_earlier if d["price_range"] is None or d["shares"] is None or d["value"] is None)

    notes = [NOTE_WHAT.format(start=start, end=end), NOTE_AS_OF.format(at=at, hours=hours)]
    if deals:
        notes.append(NOTE_VALUE)
    else:
        notes.append(NOTE_NONE.format(start=start, end=end))
    if len(ahead) > len(shown_ahead):
        notes.append(NOTE_CUT_AHEAD.format(total=len(ahead), shown=len(shown_ahead)))
    if len(earlier) > len(shown_earlier):
        notes.append(NOTE_CUT_EARLIER.format(total=len(earlier), shown=len(shown_earlier)))
    if gaps:
        notes.append(NOTE_MISSING.format(n=gaps))
    if dropped:
        notes.append(NOTE_DROPPED.format(n=dropped))

    data = {"window": {"from": start, "to": end}, "split_day": day,
            "ahead": {"rows": shown_ahead, "count": len(shown_ahead), "total": len(ahead), "cut": len(ahead) > len(shown_ahead)},
            "earlier": {"rows": shown_earlier, "count": len(shown_earlier), "total": len(earlier),
                        "cut": len(earlier) > len(shown_earlier)},
            "total": len(deals), "dropped": dropped, "as_of": None, "read_at": at}
    shown_n = len(shown_ahead) + len(shown_earlier)
    coverage = {"evaluated": len(deals), "answered": shown_n, "dropped": len(deals) - shown_n, "not_computable": gaps}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=None, source=SOURCE, data=data,
                             stale=False, coverage=coverage, notes=notes, provider_calls=0)
