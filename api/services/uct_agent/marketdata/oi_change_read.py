"""MD-1 kind `options.oiChange` (owner: terminal-data, data wave 6) — one stock's open-interest change by contract.

One stock's open interest, contract by contract, between the two newest sessions of UCT's own options log: the
contracts whose open interest changed and the newly listed ones, biggest first, for calls, puts or both, with the
totals by side, what expired or dropped out, what was not reported and the trading sessions with no file between the
two: the Agent half of the OIC terminal function, over the same answer as `GET /api/options-screener/oi-change/{sym}`
(`api/services/options_analytics/oi_change.py`).

⛔ ONLY THE PAIR THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `oi_change.oi_change` STARTS a
background build when no pair is prepared, or when the held one is due a look: a thread that lists the log's sessions
and downloads up to two files of about 50 MB. A turn must not, so this adapter never calls it. It reads through
`oi_change.held_change`, which answers from the pair already held (two indexed lookups in files already on this
server's disk) and never starts the build, never waits on one, never lists or downloads a file and changes no state
of the service. provider_calls is always 0. A rail shows `oi_change.oi_change` starting the build in the same state.

A PAIR THAT IS NOT PREPARED IS SAID, NEVER AN EMPTY CHANGE: no pair held, a failed build, a held file that can no
longer be read, a log with one session or none: each is `unavailable` with its own reason. None of them is "no
contract changed".

WHAT IS STATED: every figure is the service's own; nothing is recomputed here. A newly listed contract has no earlier
figure, so its `prior_oi`, `change` and `change_pct` are null, never 0; a percent with nothing to divide by is null;
the traded volume beside a change is the EARLIER session's own and is null when that file did not record volume. A
stock in neither file is a healthy answer that says so, with no rows.

THE CUT IS STATED: the read carries the `rows` biggest changed or new contracts (DEFAULT_ROWS, at most MAX_ROWS, the
service's own ceiling); when more matched the note says how many were left out and that they are the SMALLEST.

TIME (MD-1 §3): `as_of` = the date of the NEWER of the two log files, as the start of that Eastern day; never today
and never the time of the read. Open interest is published the morning after the session it counts, so the newer
file holds the positions as they stood at the close of the session before it: the note says so. When the newer file
was built rides as `data.read_at`. The read is `stale`, with a note, when the newer file is older than the newest
completed session: this read never looks for a newer one. Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the figures come from UCT's options log, a recording of the
market-data vendor's end-of-day options chain snapshot
(docs/terminal-research/09-security-licensing-cost/licensing-register.md, row T-28: member display of the options
chain from that snapshot). No row of that register names the options log or open-interest change, and no row clears
these figures for a model provider (row T-14, AI processing of the vendor's numbers, is restricted and names none of
them). Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.bars_daily import _SYMBOL_RE
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole, day_as_of

KIND = "options.oiChange"
SOURCE = "uct-options-log"
#: the sides, by the service's own words (oi_change.SIDES; a rail pins the two together)
SIDES = ("any", "call", "put")
SIDE_WORDS = {"any": "calls and puts", "call": "calls only", "put": "puts only"}
DEFAULT_ROWS = 15           # the panel's first screen (oiChangeModel.OI_ROWS_SHOWN)
MAX_ROWS = 50               # the service's own ceiling (oi_change.MAX_ROWS; a rail pins the two together)
ROW_FIELDS = ("contract", "expiration", "strike", "type", "oi", "kind", "prior_oi", "change", "change_pct", "volume")

NOTE_WHAT = ("{symbol} open interest by contract, {side}: the log file of {session} against the one of {prior}, "
             "from UCT's own options log. The contracts whose open interest changed and the newly listed ones, "
             "biggest first. It says how many contracts were open, not who opened or closed them or in which "
             "direction")
NOTE_AS_OF = ("`as_of` is the date of the newer log file ({session}); it is never today and never the time of the "
              "read. Open interest is published the morning after the session it counts, so the change shown is "
              "what was opened or closed during the session of {prior}. The newer file was built at {at} (UCT's "
              "own time)")
NOTE_CUT = ("the {shown} biggest of {matched} changed or new contracts are carried; the {left} smallest are left "
            "out (the cut is at the SMALL end)")
NOTE_NEW = ("{n} contracts are newly listed (in the newer file only): they have no earlier figure, so their change "
            "and percent are null, never 0, and they are left out of the totals")
NOTE_GONE = ("{n} contracts are in the earlier file only ({expired} of them expired): they are counted, and left "
             "out of the totals")
NOTE_NOT_REPORTED = ("{n} contracts had no open interest reported on one side or the other: they are counted, "
                     "never read as 0")
NOTE_SKIPPED = ("the two files are not consecutive sessions: {list} had no log file, so the change spans more than "
                "one session")
NOTE_NO_VOLUME = "the earlier file did not record traded volume: `volume` is null on every row, never 0"
NOTE_UNKNOWN = ("{symbol} is in neither log file ({session} and {prior}): no contract of it had an ask, open "
                "interest or volume in either. That is the log's own answer, and there is nothing to compare")
NOTE_STALE = ("the newer log file held is {session}; the newest completed session is {expected}. This read never "
              "looks for a newer file: open the open-interest change panel (OIC) in UCT, then ask again")
NOTE_NOT_HELD = ("the two log files have not been prepared on this server yet, and this read never starts that "
                 "work. That is not the same as no change. Open the open-interest change panel (OIC) in UCT, then "
                 "ask again")
NOTE_BUILD_FAILED = ("the last attempt to prepare the two log files on this server failed ({error}), and this read "
                     "never tries again. That is not the same as no change")
NOTE_FILE_GONE = ("one of the two log files held on this server could no longer be read, and this read never "
                  "fetches it again. That is not the same as no change. Open the open-interest change panel (OIC) "
                  "in UCT, then ask again")
NOTE_NO_SESSIONS = ("UCT's options log holds no session yet, so there is nothing to compare. That is not the same "
                    "as no change")
NOTE_ONE_SESSION = ("UCT's options log holds one session ({session}) and a change needs two, so there is nothing to "
                    "compare yet. That is not the same as no change")
NOTE_FAILED = "the open-interest change read failed; nothing is stated. That is not the same as no change"


def _clean(v: Any) -> Optional[str]:
    s = v.strip().upper().lstrip("$") if isinstance(v, str) else ""
    return s if _SYMBOL_RE.match(s) else None


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if _clean(params.get("symbol")) is None:
        return "`symbol` must be one US stock or fund ticker"
    if params.get("side", "any") not in SIDES:
        return "`side` is any (calls and puts), call or put"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer(sym: str, side: str) -> tuple[Optional[dict], str]:
    """(the answer from the pair the service already holds, how it is held), WITHOUT starting or waiting on a build."""
    from api.services.options_analytics import oi_change as svc
    return svc.held_change(sym, side)


def _signed(v: Any) -> Optional[int]:
    f = _num(v)
    return int(round(f)) if f is not None else None


def _row(r: Any) -> Optional[dict]:
    if not isinstance(r, dict) or not isinstance(r.get("contract"), str) or r.get("type") not in ("call", "put"):
        return None
    new = r.get("kind") != "change"
    return {"contract": r["contract"], "expiration": _day(r.get("expiration")), "strike": _num(r.get("strike")),
            "type": r["type"], "oi": _whole(r.get("oi")), "kind": "new" if new else "change",
            # a newly listed contract has no earlier figure: no change and no percent, never a 0
            "prior_oi": None if new else _whole(r.get("prior_oi")), "change": None if new else _signed(r.get("change")),
            "change_pct": None if new else _num(r.get("change_pct")), "volume": None if new else _whole(r.get("volume"))}


def _counts(v: Any, keys: tuple) -> dict:
    v = v if isinstance(v, dict) else {}
    return {k: (_signed(v.get(k)) if k == "change" else _whole(v.get(k))) for k in keys}


def read_oi_change(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym, side, want = _clean(params["symbol"]), params.get("side", "any"), params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer(sym, side)                      # the held pair only: never a build
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no change"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "not_held":
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    if how == "file_gone":
        return env.unavailable(KIND, params, SOURCE, NOTE_FILE_GONE)
    if not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "failed":
        error = got.get("error") if isinstance(got.get("error"), str) and got["error"] else "no reason recorded"
        return env.unavailable(KIND, params, SOURCE, NOTE_BUILD_FAILED.format(error=error[:60]))
    state = got.get("status")
    if state == "no_sessions":
        return env.unavailable(KIND, params, SOURCE, NOTE_NO_SESSIONS)
    if state == "one_session":
        return env.unavailable(KIND, params, SOURCE,
                               NOTE_ONE_SESSION.format(session=_day(got.get("session")) or "its date was not recorded"))
    session, prior = _day(got.get("session")), _day(got.get("prior_session"))
    if how != "held" or state != "ok" or session is None or prior is None or not isinstance(got.get("rows"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    held_rows = [x for x in (_row(r) for r in got["rows"]) if x]
    rows = held_rows[:want]
    matched = max(_whole(got.get("matched")) or 0, len(held_rows))
    left = matched - len(rows)
    known = got.get("known") is True
    summary = got.get("summary") if isinstance(got.get("summary"), dict) else {}
    new = _counts(got.get("new"), ("contracts", "oi"))
    gone = _counts(got.get("gone"), ("contracts", "prior_oi", "expired"))
    not_reported = _whole(got.get("not_reported"))
    skipped = [d for d in (_day(x) for x in got.get("skipped_sessions") or []) if d]
    volume_present = got.get("volume_present") is True
    built_at = got.get("built_at") if isinstance(got.get("built_at"), str) and got["built_at"] else None

    from api.services.uct_agent.marketdata.sessions import last_completed_session
    expected = str(last_completed_session())
    expected = f"{expected[:4]}-{expected[4:6]}-{expected[6:]}"
    stale = session < expected

    notes = [NOTE_WHAT.format(symbol=sym, side=SIDE_WORDS[side], session=session, prior=prior),
             NOTE_AS_OF.format(session=session, prior=prior, at=built_at or "a time it did not record")]
    if not known:
        notes.append(NOTE_UNKNOWN.format(symbol=sym, session=session, prior=prior))
    if left > 0:
        notes.append(NOTE_CUT.format(shown=len(rows), matched=matched, left=left))
    if new["contracts"]:
        notes.append(NOTE_NEW.format(n=new["contracts"]))
    if gone["contracts"]:
        notes.append(NOTE_GONE.format(n=gone["contracts"], expired=gone["expired"] if gone["expired"] is not None else "an unknown number"))
    if not_reported:
        notes.append(NOTE_NOT_REPORTED.format(n=not_reported))
    if skipped:
        notes.append(NOTE_SKIPPED.format(list=", ".join(skipped)))
    if known and not volume_present:
        notes.append(NOTE_NO_VOLUME)
    if stale:
        notes.append(NOTE_STALE.format(session=session, expected=expected))

    # every key keeps the route's own name (the panel's model reads them)
    side_keys = ("contracts", "oi", "prior_oi", "change")
    data = {"symbol": sym, "side": side, "session": session, "prior_session": prior, "skipped_sessions": skipped,
            "known": known, "has_symbol": got.get("has_symbol") is True,
            "prior_has_symbol": got.get("prior_has_symbol") is True, "rows": rows, "matched": matched,
            "shown": len(rows), "left_out": max(0, left), "max_rows": MAX_ROWS,
            "summary": {"call": _counts(summary.get("call"), side_keys), "put": _counts(summary.get("put"), side_keys),
                        "contracts": _whole(summary.get("contracts")), "unchanged": _whole(summary.get("unchanged"))},
            "new": new, "gone": gone, "not_reported": not_reported, "volume_present": volume_present,
            "volume_session": prior, "built_at": built_at,
            "source": got.get("source") if isinstance(got.get("source"), str) else None,
            "coverage": got.get("coverage") if isinstance(got.get("coverage"), str) else None,
            "read_at": _read_at(built_at) if built_at else None}
    coverage = {"evaluated": matched, "answered": len(rows), "dropped": max(0, left), "not_computable": 0}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(session), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
