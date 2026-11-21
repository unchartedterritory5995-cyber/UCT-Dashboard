"""MD-1 kind `calendar.dividends` (owner: terminal-data, data wave 8) — dividends and splits declared ahead, as held.

The dividends and splits declared ahead for the stocks named in the request, one stock at a time: for each stock its
next ex-dividend date with the cash amount as declared, and every split ahead, soonest first. The Agent half of the
DVD terminal function in its one-stock form, over the answer of `GET /api/calendar/dividends?syms=<sym>`
(`api/services/dividends_calendar.py`). Past events are not this kind: they are `stock.corporateActions`'s (CACT).

THE STOCKS NAMED, NEVER THE MEMBER'S OWN: with no `syms` the route reads the caller's own stocks (watchlists, flagged,
positions and the UCT 20). No existing kind reads a member's own lists, so this kind does not: it answers for the
stocks the request names (at most `MAX_SYMBOLS`) and a note says so.

⛔ ONLY WHAT THE SERVER ALREADY HOLDS, NEVER A VENDOR REQUEST (MD-1 §5). The route's
`dividends_calendar.get_events_with_status` asks the market-data vendor (two reference reads per stock) whenever
nothing is held for the symbol set. A turn must not, so this adapter never calls it. It reads through
`dividends_calendar_held.held_events(sym)`, which returns what the service stored for that ONE stock (the answer the
dividend calendar panel reads for one stock), with the time it stored it and whether the service marked that read
incomplete, or nothing, and never fetches. provider_calls is always 0. A rail shows `get_events_with_status` reaching
the vendor in the same state.

NOTHING HELD IS SAID, NEVER "NO DIVIDEND": a stock with nothing held is left out of the answer and named (`partial`);
with nothing held for any stock named the read is `unavailable`. A stock whose read the service marked incomplete (a
vendor read failed or was cut by its deadline) keeps what is held and is named, never said as "none". A stock held
whole with no event is a healthy answer: nothing is declared ahead in what UCT read.

WHAT IS STATED: every event is the route's own, passed through: a dividend's ex-date and its cash amount as declared
(not split-adjusted; the CACT record's amounts are), a split's date and ratio. A dividend with no declared amount
keeps a null amount, never 0. The canonical entity the service stamps on each event is not carried.

THE CUT IS STATED: at most `MAX_ROWS` events are returned, soonest first; a longer list is cut from the FAR end (the
latest dates) and the note says so. Each stock's count of events rides beside them.

TIME (MD-1 §3): a forward calendar carries no as-of time of its own, so `as_of` is null and a note says so; when UCT
read each stock's calendar (the time the service stored it) rides beside it, and `data.read_at` is the oldest of
them, so the answer is never described fresher than its oldest stock. The service keeps one stock's answer for at most
twelve hours (`_CACHE_TTL`), five minutes when incomplete (`_CACHE_TTL_PARTIAL`), so a held answer is never older and
the read is never `stale`. Every read is `periodic`, as the kind is declared.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-07 covers this reference data for
member display and external publication, and the register's 2026-09-19 note scopes its LA reading to member display,
with AI use its own row. That row, row T-14 (AI processing: the vendor's numbers into a model), is class R in its class
column and LA in its Business column, which the register's legend defines as verify the contract. No row clears these
events for a model provider outright, and no other row does. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num

KIND = "calendar.dividends"
SOURCE = "uct-dividend-calendar"
MAX_SYMBOLS = 10
MAX_ROWS = 40
EVENT_TYPES = ("dividend", "split")
STATES = ("complete", "incomplete", "not_held")
MAX_RATIO_CHARS = 16

NOTE_WHAT = ("the dividends and splits declared ahead for {symbols} as UCT holds them, one stock at a time (the answer "
             "the dividend calendar panel reads for one stock), from its market-data vendor's reference data: for each "
             "stock its next ex-dividend date with the cash amount as declared, and every split ahead, soonest first. "
             "Past events are the Corporate actions panel's (CACT). A calendar of declared events, not a forecast and "
             "not advice")
NOTE_AS_OF = ("a forward calendar carries no as-of time of its own, so `as_of` is null. UCT read these stocks' calendars "
              "from its vendor at {at} at the oldest (UCT's own time), so an event dated before the day of this read "
              "may have passed since. The server keeps one stock's answer for at most {hours} hours, and this read "
              "never asks the vendor")
NOTE_NAMED_ONLY = ("this read answers for the stocks named in the request only: it never reads the member's own "
                   "watchlists, positions or stocks")
NOTE_NONE = "no dividend or split is declared ahead in what UCT read for: {list}"
NOTE_INCOMPLETE = ("UCT's last read of these stocks did not fully answer (a vendor read failed or was cut by its "
                   "deadline), so events may be missing for them: {list}. What is held is returned; that is not the "
                   "same as no event")
NOTE_SOME_NOT_HELD = ("nothing is held on this server for these stocks alone, and this read never asks the vendor, so "
                      "they are not in this answer: {list}. That is not the same as no dividend or split. Open the "
                      "dividend calendar panel (DVD) for each of them in UCT, then ask again")
NOTE_CUT = ("{total} events are held for these stocks and the soonest {shown} are returned: the list is cut from the "
            "FAR end")
NOTE_NO_AMOUNT = "{n} of the dividends returned have no declared amount; that amount is null, never 0"
NOTE_NOT_HELD = ("nothing is held on this server for {list} alone (the dividend calendar panel's one-stock read), and "
                 "this read never asks the vendor. That is not the same as no dividend or split. Open the dividend "
                 "calendar panel (DVD) for each stock in UCT, then ask again")
NOTE_FAILED = "the dividend calendar read failed; nothing is stated. That is not the same as no dividend or split"


def _clean(v: Any) -> Optional[str]:
    """The house spelling of a ticker (`ticker_resolver.route_symbol`: BRK.B -> BRK-B), or None."""
    from api.services.ticker_resolver import route_symbol
    return route_symbol(v.strip().lstrip("$")) if isinstance(v, str) and v.strip() else None


def _symbols(params: dict) -> list[str]:
    """The stocks named, cleaned, in the order named, each once."""
    out: list[str] = []
    for v in params.get("symbols") or []:
        s = _clean(v)
        if s and s not in out:
            out.append(s)
    return out


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    syms = params.get("symbols")
    if not isinstance(syms, list) or not 1 <= len(syms) <= MAX_SYMBOLS:
        return f"`symbols` must name 1 to {MAX_SYMBOLS} US stock tickers"
    if any(_clean(v) is None for v in syms):
        return "each of `symbols` must be one US stock ticker"
    return None


def held_answer(sym: str) -> tuple[Optional[list], Optional[float], str]:
    """READ ONLY: (the events the service holds for that one stock, when it stored them, 'complete' | 'incomplete' |
    'not_held'), WITHOUT asking a vendor (`dividends_calendar_held.held_events`)."""
    from api.services import dividends_calendar_held as svc
    return svc.held_events(sym)


def hold_hours() -> int:
    """How long the service keeps one answer whole (`dividends_calendar._CACHE_TTL`), in hours, read at call time."""
    from api.services import dividends_calendar as svc
    return int(svc._CACHE_TTL) // 3600


def _event(r: Any, sym: str) -> Optional[dict]:
    if not isinstance(r, dict) or _day(r.get("date")) is None or r.get("type") not in EVENT_TYPES:
        return None
    if not isinstance(r.get("sym"), str) or r["sym"].strip().upper().replace(".", "-") != sym:
        return None
    if r["type"] == "dividend":
        amount = _num(r.get("amount"))
        return {"symbol": sym, "type": "dividend", "date": _day(r["date"]),
                "amount": amount if amount is not None and amount > 0 else None, "ratio": None}
    ratio = r.get("ratio")
    return {"symbol": sym, "type": "split", "date": _day(r["date"]), "amount": None,
            "ratio": ratio.strip()[:MAX_RATIO_CHARS] if isinstance(ratio, str) and ratio.strip() else None}


def _iso(t: Any) -> Optional[str]:
    return env.utc_iso(datetime.fromtimestamp(t, tz=timezone.utc)) if isinstance(t, (int, float)) else None


def read_dividends(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    syms = _symbols(params)
    try:
        held = {s: held_answer(s) for s in syms}               # what is held per stock: never a vendor request
        hours = hold_hours()
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no dividend"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    stocks, events, read_times = [], [], []
    for s in syms:
        rows, stored_at, how = held[s] if isinstance(held[s], tuple) and len(held[s]) == 3 else (None, None, "bad")
        if how not in STATES or (how != "not_held" and (not isinstance(rows, list) or _iso(stored_at) is None)):
            return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
        mine = [x for x in (_event(r, s) for r in rows) if x] if how != "not_held" else []
        events.extend(mine)
        if how != "not_held":
            read_times.append(stored_at)
        stocks.append({"symbol": s, "state": how, "read_at": _iso(stored_at) if how != "not_held" else None,
                       "events": len(mine) if how != "not_held" else None})
    not_held = [x["symbol"] for x in stocks if x["state"] == "not_held"]
    if len(not_held) == len(syms):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(list=", ".join(syms)))
    events.sort(key=lambda e: (e["date"], e["symbol"], e["type"]))        # soonest first, as the panel lists them
    shown = events[:MAX_ROWS]
    at = _iso(min(read_times))
    incomplete = [x["symbol"] for x in stocks if x["state"] == "incomplete"]
    none = [x["symbol"] for x in stocks if x["state"] == "complete" and not x["events"]]
    no_amount = sum(1 for e in shown if e["type"] == "dividend" and e["amount"] is None)

    notes = [NOTE_WHAT.format(symbols=", ".join(syms)), NOTE_AS_OF.format(at=at, hours=hours), NOTE_NAMED_ONLY]
    if none:
        notes.append(NOTE_NONE.format(list=", ".join(none)))
    if len(events) > len(shown):
        notes.append(NOTE_CUT.format(total=len(events), shown=len(shown)))
    if no_amount:
        notes.append(NOTE_NO_AMOUNT.format(n=no_amount))
    if incomplete:
        notes.append(NOTE_INCOMPLETE.format(list=", ".join(incomplete)))
    if not_held:
        notes.append(NOTE_SOME_NOT_HELD.format(list=", ".join(not_held)))

    data = {"symbols": syms, "stocks": stocks, "rows": shown, "count": len(shown), "total": len(events),
            "cut": len(events) > len(shown), "as_of": None, "read_at": at}
    coverage = {"evaluated": len(syms), "answered": len(syms) - len(not_held), "dropped": len(events) - len(shown),
                "not_computable": len(not_held) + len(incomplete)}
    return env.make_envelope(KIND, params, status="partial" if (not_held or incomplete) else "ok", freshness="periodic",
                             as_of=None, source=SOURCE, data=data, stale=False, coverage=coverage, notes=notes,
                             provider_calls=0)
