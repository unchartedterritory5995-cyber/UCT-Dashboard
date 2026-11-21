"""MD-1 kind `stock.eventsTimeline` (owner: terminal-data, data wave 7) — one stock's dated events, as stored.

The dated events UCT's stores hold for one stock, each placed against its nearest earnings print: earnings reports
and the next scheduled one, days the UCT catalyst engine flagged the stock, SEC filings in the filing-search index,
and days the room's mentions of the ticker spiked: the Agent half of the EVTS terminal function, over the answer of
`GET /api/research/events/{sym}` (`api/services/events_timeline.py`).

⛔ ONLY WHAT THE STORES ALREADY HOLD, NEVER A BUILD (MD-1 §5). The route's `events_timeline.timeline(sym)` reads the
earnings history from cache and, when it is not there, SCHEDULES the earnings rebuild (a background job that asks a
vendor). A turn must not, so this adapter calls `timeline(sym, held_only=True)`: the same stores, and an earnings
history that is not held is reported as `not_held`, with nothing scheduled. provider_calls is always 0. A rail shows
the default call scheduling the rebuild in the same state.

THE SWITCH IS THE ROUTE'S: while `EVENTS_TIMELINE_ENABLED` is not on, the route answers 404 and this read is
`unavailable` with that reason: never an empty timeline.

A SOURCE THAT DID NOT ANSWER IS SAID: each of the four sources answers for itself. A source that failed, or an
earnings history that is not held, makes the read `partial` and is named in a note; when no source answered the read
is `unavailable`. A stock with no event in any store is a healthy answer with no rows.

WHAT IS LEFT OUT, AND SAID: the catalyst engine's written thesis and each filing's link are not carried.

THE CUT IS STATED: at most `rows` events are returned, newest first; a longer list is cut from the OLD end and the
note says so.

TIME (MD-1 §3): `as_of` = the date of the newest event that is not in the future (a scheduled report is in the
list, and is not the as-of), as the start of that Eastern day; never the time of the read. When no event is dated
on or before the read day `as_of` is null and a note says why. Every read is `historical`; the kind is DECLARED
`periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) has no row for this timeline; the earnings
figures in it are the fundamentals vendor's, and row T-44 marks those numbers into a model as unknown ("No AI
clause"). No row clears this timeline for a model provider. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.bars_daily import _SYMBOL_RE
from api.services.uct_agent.marketdata.short_interest import _day, day_as_of

KIND = "stock.eventsTimeline"
SOURCE = "uct-events-stores"
DEFAULT_ROWS = 20
MAX_ROWS = 40
MAX_PRINTS = 9              # the service's own ceiling on prints (events_timeline.MAX_PRINTS; a rail pins it)
MAX_TEXT = 160
#: the four sources, by the service's own names
SOURCE_NAMES = ("earnings", "uct_catalyst", "filing", "room_spike")
SOURCE_WORDS = {"earnings": "the earnings history", "uct_catalyst": "the UCT catalyst engine's flags",
                "filing": "the SEC filing index", "room_spike": "the room's mention counts"}
SOURCE_STATES = ("ok", "empty", "error", "not_held")
#: the kind whose `detail` is a written thesis and is not carried
NO_DETAIL_KINDS = ("uct_catalyst",)
_ET = ZoneInfo("America/New_York")

NOTE_WHAT = ("dated events UCT's stores hold for {symbol}, each placed against its nearest earnings report: "
             "earnings reports and the next scheduled one, days the UCT catalyst engine flagged the stock, SEC "
             "filings in UCT's filing index, and days the room's mentions of the ticker spiked. Stored events only: "
             "nothing is fetched for this read. A record, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the date of the newest event that is not in the future ({day}); it is never the time of "
              "the read. A scheduled report is listed and is not the as-of")
NOTE_NO_PAST = ("no event here is dated on or before the read day, so `as_of` is null")
NOTE_OFFSET = ("each event's offset from its nearest report is counted in {unit}")
NOTE_UNSTAGED = ("the events are not placed against a report: {reason}")
NOTE_CUT = ("{total} events are stored and the newest {shown} are returned, newest first: the list is cut from the "
            "OLD end")
NOTE_LEFT_OUT = ("the catalyst engine's written thesis and each filing's link are left out of this read. The Events "
                 "timeline panel (EVTS) in UCT shows them")
NOTE_SOURCES = ("{n} of the 4 sources did not answer and their events are missing from this list, which is not the "
                "same as no event there: {list}")
NOTE_EMPTY = ("no event is stored for {symbol} in any of the 4 sources")
NOTE_OFF = ("the events timeline is switched off on this server (EVENTS_TIMELINE_ENABLED is not on), so nothing is "
            "read. That is not the same as no event")
NOTE_NOT_HELD = ("none of the 4 event sources answered for {symbol}; nothing is stated. That is not the same as no "
                 "event")
NOTE_FAILED = "the events timeline read failed; nothing is stated. That is not the same as no event"


def _clean(v: Any) -> Optional[str]:
    s = v.strip().upper().lstrip("$") if isinstance(v, str) else ""
    return s if s and _SYMBOL_RE.match(s) else None


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if _clean(params.get("symbol")) is None:
        return "`symbol` must be one US stock or fund ticker"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """(the timeline from the stores, 'held') or (None, 'off') while the route's own switch is off. READ ONLY: the
    service's `held_only` form, which never schedules the earnings rebuild."""
    from api.services import events_timeline as svc
    if not svc.is_enabled():
        return None, "off"
    return svc.timeline(sym, held_only=True), "held"


def today_et() -> str:
    return datetime.now(_ET).strftime("%Y-%m-%d")


def _text(v: Any) -> Optional[str]:
    return v.strip()[:MAX_TEXT] if isinstance(v, str) and v.strip() else None


def _event(e: Any) -> Optional[dict]:
    if not isinstance(e, dict) or _day(e.get("date")) is None or not _text(e.get("kind")):
        return None
    kind = _text(e["kind"])
    off = e.get("offset")
    return {"date": _day(e["date"]), "kind": kind, "title": _text(e.get("title")),
            "detail": None if kind in NO_DETAIL_KINDS else _text(e.get("detail")), "source": _text(e.get("source")),
            "print_date": _day(e.get("print_date")), "print_label": _text(e.get("print_label")),
            "print_state": _text(e.get("print_state")),
            "offset": off if isinstance(off, int) and not isinstance(off, bool) else None,   # not staged: null, never 0
            "stage": _text(e.get("stage"))}


def read_events(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym, limit = _clean(params["symbol"]), params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer(sym)                            # the stores only: never the earnings rebuild
        today = today_et()
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no event"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "off":
        return env.unavailable(KIND, params, SOURCE, NOTE_OFF)
    if how != "held" or not isinstance(got, dict) or not isinstance(got.get("events"), list) \
            or not isinstance(got.get("sources"), dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    states = {}
    for name in SOURCE_NAMES:
        s = got["sources"].get(name)
        state = s.get("state") if isinstance(s, dict) else None
        states[name] = state if state in SOURCE_STATES else "error"
    silent = [n for n in SOURCE_NAMES if states[n] in ("error", "not_held")]
    events = [x for x in (_event(e) for e in got["events"]) if x]
    events.sort(key=lambda e: (e["date"], e["kind"]), reverse=True)        # newest first
    if len(silent) == len(SOURCE_NAMES):                                   # no source answered: nothing to state
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(symbol=sym))
    total, shown = len(events), events[:limit]
    past = [e["date"] for e in events if e["date"] <= today]
    day = max(past) if past else None
    prints = [{"date": _day(p.get("date")), "label": _text(p.get("label")), "state": _text(p.get("state"))}
              for p in (got.get("prints") or []) if isinstance(p, dict) and _day(p.get("date"))][:MAX_PRINTS]
    staged = got.get("state") == "ok"

    notes = [NOTE_WHAT.format(symbol=sym), NOTE_AS_OF.format(day=day) if day else NOTE_NO_PAST]
    if staged and isinstance(got.get("offset_unit"), str):
        notes.append(NOTE_OFFSET.format(unit=got["offset_unit"]))
    if not staged:
        notes.append(NOTE_UNSTAGED.format(reason=_text(got.get("reason")) or "no reason was given"))
    if not events:
        notes.append(NOTE_EMPTY.format(symbol=sym))
    if total > len(shown):
        notes.append(NOTE_CUT.format(total=total, shown=len(shown)))
    if shown:
        notes.append(NOTE_LEFT_OUT)
    if silent:
        notes.append(NOTE_SOURCES.format(n=len(silent), list=", ".join(
            f"{SOURCE_WORDS[n]} ({'not held on this server' if states[n] == 'not_held' else 'the read failed'})"
            for n in silent)))

    data = {"symbol": sym, "staged": staged, "reason": _text(got.get("reason")),
            "offset_unit": got.get("offset_unit") if isinstance(got.get("offset_unit"), str) else None,
            "prints": prints, "rows": shown, "count": len(shown), "total": total, "cut": total > len(shown),
            "sources": states, "as_of": day, "left_out": ["thesis", "url"]}
    coverage = {"evaluated": len(SOURCE_NAMES), "answered": len(SOURCE_NAMES) - len(silent), "dropped": total - len(shown),
                "not_computable": len(silent)}
    return env.make_envelope(KIND, params, status="partial" if silent else "ok", freshness="historical",
                             as_of=day_as_of(day), source=SOURCE, data=data, stale=False, coverage=coverage,
                             notes=notes, provider_calls=0)
