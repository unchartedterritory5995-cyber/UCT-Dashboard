"""MD-1 kind `options.tideHistory` (owner: terminal-data, data wave 6) — Market Tide by finished session.

The net call premium, net put premium and their difference for each finished session UCT has stored, newest first,
for the whole tape, stocks only or funds only, with the store's own facts (the first stored day, the sessions with no
row, what the tape leaves out): the Agent half of the TIDEH terminal function, over the same answer as
`GET /api/options/market-tide/history` (`api/services/options_analytics/tide_history.py: history`).

⛔ A STORE READ, NEVER A CAPTURE (MD-1 §5). `tide_history.history` reads the stored rows and nothing else: it does not
build a tide, read the flow tape or store a session. This adapter calls only that. It never calls the capture
(`capture`, `run_capture_job`, `_store`), which reads the live tape and writes the store, and never the live tide
(`market_tide.build` / `get`). provider_calls is always 0. A rail fails if any of those is reached.

NO SESSION STORED IS SAID, NEVER AN EMPTY TIDE: a store with no row for the scope is `unavailable` with that reason.
The store has no backfill: sessions before the first stored day were never stored, and the note says so.

WHAT IS STATED: every figure is the stored row's own; nothing is recomputed or summed here. A figure that is not a
number is null, never 0. Sessions between the first and the newest stored day that have no row are named
(`missing_sessions`), up to MAX_MISSING, the oldest left out and counted.

THE CUT IS STATED: the read carries the newest `rows` sessions (DEFAULT_ROWS, at most MAX_ROWS, the service's own
ceiling); when more are stored the note says how many were left out and that they are the OLDER ones.

TIME (MD-1 §3): `as_of` = the newest STORED session, as the start of that Eastern day; never today and never the time
of the read. When that session's row was stored rides as `data.read_at`. The read is `stale`, with a note, when the
newest stored session is older than the newest completed session. Every read is `historical`; the kind is DECLARED
`periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the totals are derived from UCT's recorded options flow tape
(docs/terminal-research/09-security-licensing-cost/licensing-register.md, rows T-25 and T-26: the stored options
tape, and the analytics derived from it, whose action reads "Keep member-gated; never public"). No row of that
register names the tide by day, and no row clears these figures for a model provider (row T-14, AI processing of the
vendor's numbers, is restricted and names none of them). Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole, day_as_of

KIND = "options.tideHistory"
SOURCE = "uct-flow-tape"
#: the scopes, by the service's own words (market_tide.SCOPES; a rail pins the two together)
SCOPES = ("all", "stocks", "etfs")
SCOPE_WORDS = {"all": "the whole tape", "stocks": "stocks only", "etfs": "funds only"}
DEFAULT_ROWS = 20           # the panel's first screen (tideHistoryModel.TIDE_ROWS_SHOWN)
MAX_ROWS = 250              # the service's own ceiling (tide_history.MAX_SESSIONS; a rail pins the two together)
MAX_MISSING = 40            # the newest missing sessions named; the older ones are counted
ROW_FIELDS = ("session", "net_call_premium", "net_put_premium", "net_premium", "prints_counted", "prints_unsigned",
              "prints_unreadable", "data_through", "stored_at", "source")

NOTE_WHAT = ("Market Tide by finished session for {scope}, newest first, from UCT's own store: for each session the "
             "net call premium, the net put premium and net (call minus put), in dollars, with the prints counted. "
             "{stored} sessions are stored, the first {began}. Flow that was recorded, not a signal")
NOTE_AS_OF = ("`as_of` is the newest stored session ({day}); it is never today and never the time of the read. That "
              "session was stored at {at} (UCT's own time). Each session is stored once after its close and is not "
              "revised afterwards")
NOTE_CUT = ("the newest {shown} of {stored} stored sessions are carried; the {left} older ones are left out (the "
            "cut is at the OLD end)")
NOTE_NO_BACKFILL = ("sessions before the first stored day ({began}) were never stored and cannot be recovered: the "
                    "history starts there, not when the tape did")
NOTE_MISSING = ("{n} trading sessions between {began} and {latest} have no stored row and are named in "
                "`missing_sessions`: a session that was not stored is not a session with no flow")
NOTE_MISSING_CUT = "{n} sessions have no stored row; the newest {shown} are named and the {left} older ones are counted"
NOTE_UNREADABLE = ("{n} of the sessions carried left out prints that could not be read (`prints_unreadable`): their "
                   "totals are of the prints that could")
NOTE_STALE = ("the newest stored session is {day}; the newest completed session is {expected}. This read never "
              "stores a session")
NOTE_NONE = ("no finished session is stored yet for {scope}, and this read never stores one. Each session is stored "
             "once after its close. That is not the same as no flow")
NOTE_FAILED = "the Market Tide history read failed; nothing is stated. That is not the same as no flow"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    scope = params.get("scope", "all")
    if scope not in SCOPES:
        return "`scope` is all (the whole tape), stocks or etfs"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer(scope: str, rows: int) -> dict:
    """The stored sessions, by the service's own store read. It captures nothing and builds no tide."""
    from api.services.options_analytics import tide_history as svc
    return svc.history(scope, rows)


def _signed(v: Any) -> Optional[int]:
    """Dollars, signed: a finite number as an int. Anything else is null, never 0."""
    f = _num(v)
    return int(round(f)) if f is not None else None


def _row(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or _day(r.get("session")) is None:
        return None
    return {"session": _day(r["session"]), "net_call_premium": _signed(r.get("net_call_premium")),
            "net_put_premium": _signed(r.get("net_put_premium")), "net_premium": _signed(r.get("net_premium")),
            "prints_counted": _whole(r.get("prints_counted")), "prints_unsigned": _whole(r.get("prints_unsigned")),
            "prints_unreadable": _whole(r.get("prints_unreadable")),
            "data_through": r.get("data_through") if isinstance(r.get("data_through"), str) else None,
            "stored_at": r.get("stored_at") if isinstance(r.get("stored_at"), str) else None,
            "source": r.get("source") if isinstance(r.get("source"), str) else None}


def _text(v: Any) -> Optional[str]:
    return v if isinstance(v, str) and v else None


def read_tide_history(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    scope, want = params.get("scope", "all"), params.get("rows", DEFAULT_ROWS)
    try:
        got = held_answer(scope, want)                         # the store only: never a capture
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no flow"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not isinstance(got, dict) or not isinstance(got.get("sessions"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    rows = [x for x in (_row(r) for r in got["sessions"]) if x][:want]
    latest = _day(got.get("latest_session"))
    if not rows or latest is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NONE.format(scope=SCOPE_WORDS[scope]))
    stored = _whole(got.get("sessions_stored")) or len(rows)
    began = _day(got.get("history_began")) or rows[-1]["session"]
    left = max(0, stored - len(rows))
    missing_all = [d for d in (_day(x) for x in got.get("missing_sessions") or []) if d]
    missing = missing_all[-MAX_MISSING:]                       # the service lists them oldest first
    unreadable = sum(1 for r in rows if r["prints_unreadable"])
    stored_at = rows[0]["stored_at"] if rows[0]["session"] == latest else None

    from api.services.uct_agent.marketdata.sessions import last_completed_session
    expected = str(last_completed_session())
    expected = f"{expected[:4]}-{expected[4:6]}-{expected[6:]}"
    stale = latest < expected

    notes = [NOTE_WHAT.format(scope=SCOPE_WORDS[scope], stored=stored, began=began),
             NOTE_AS_OF.format(day=latest, at=stored_at or "a time it did not record")]
    if left:
        notes.append(NOTE_CUT.format(shown=len(rows), stored=stored, left=left))
    if got.get("backfill") is not True:
        notes.append(NOTE_NO_BACKFILL.format(began=began))
    if missing_all:
        notes.append(NOTE_MISSING.format(n=len(missing_all), began=began, latest=latest))
    if len(missing_all) > len(missing):
        notes.append(NOTE_MISSING_CUT.format(n=len(missing_all), shown=len(missing), left=len(missing_all) - len(missing)))
    if unreadable:
        notes.append(NOTE_UNREADABLE.format(n=unreadable))
    if stale:
        notes.append(NOTE_STALE.format(day=latest, expected=expected))

    # every key keeps the route's own name (the panel's model reads them)
    data = {"scope": scope, "sessions": rows, "sessions_stored": stored, "sessions_asked": want,
            "sessions_left_out": left, "history_began": began, "latest_session": latest, "missing_sessions": missing,
            "missing_total": len(missing_all), "missing_checked_through": _day(got.get("missing_checked_through")),
            "backfill": got.get("backfill") is True, "stored_note": _text(got.get("stored_note")),
            "filters": _text(got.get("filters")), "method": _text(got.get("method")), "label": _text(got.get("label")),
            "read_at": _read_at(stored_at) if stored_at else None}
    coverage = {"evaluated": stored, "answered": len(rows), "dropped": left, "not_computable": 0}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(latest), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
