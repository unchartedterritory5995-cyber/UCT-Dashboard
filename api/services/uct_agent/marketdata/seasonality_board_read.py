"""MD-1 kind `seasonality.board` (owner: terminal-data, data wave 6) — the index and sector funds by calendar month.

The four index funds and the eleven sector funds, each by calendar month (the years counted, the average and the
median month return, the percent of years the month rose, the thin flag), as the seasonality board holds them: the
Agent half of the SEASB terminal function, over the same answer as `GET /api/research/seasonality-board`
(`api/services/seasonality_board.py`).

⛔ ONLY THE BOARD THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `seasonality_board.serve` BUILDS the
board when none may be reused: fifteen daily reads through the bar serve, each of which can start a deep history fetch
from the market-data vendor. A turn must not, so this adapter never calls it. It reads through
`seasonality_board.held()`, which returns the held board when the service's own `reusable` rule says it may still be
served and otherwise None; it never builds, never reads a fund and never takes the build lock. provider_calls is
always 0. A rail shows `serve` building in the same state.

NOTHING HELD IS SAID, NEVER BUILT: no board was read on this server today, or the last one was unfinished (a fund
still pending or failed) and is older than the service's reuse window (the route would rebuild it; this read does
not). The answer is `unavailable` with that reason. It is never an empty board.

WHAT IS STATED: every figure is the board's own; nothing is recomputed, ranked or summarised here (the best and the
weakest sector of the month are worked out by the member's own app from these rows, with the panel's rules). A fund
without numbers is listed with the board's own `status` (`pending` | `not_held` | `unavailable`) and `reason`, and has
no months at all, never twelve zeros. A month with too few years keeps its `thin` flag. A month with nothing counted
has null figures, never 0. The held board is copied, never changed.

TIME (MD-1 §3): `as_of` = the newest daily bar date any fund's record covers (the board's `data_through`), as the start
of that Eastern day; never the time of the read and never the day the board was built. When the board was built
rides as `data.built_at` (the board's own `as_of` field, a build time) and, in UTC, `data.read_at`. Every read is
`historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the figures are computed from UCT's daily bar store, which holds the
market-data vendor's end-of-day history (docs/terminal-research/09-security-licensing-cost/licensing-register.md, rows
T-04 and T-09: member display of daily history, and its storage) and, before 2003-09-10, yfinance history (row T-71:
the pre-2003 daily tail, class X). No row of that register names seasonality, and no row clears these figures for a
model provider (row T-14, AI processing of the vendor's numbers, is restricted and names none of them). Shown to the
member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, day_as_of

KIND = "seasonality.board"
SOURCE = "uct-bars"
#: the board's own words for a fund without numbers (seasonality_board.PENDING / NOT_HELD / UNAVAILABLE)
WITHOUT_WORDS = {"pending": "its history is still being read", "not_held": "the bar store does not carry it",
                 "unavailable": "its read failed or holds too little"}
MONTH_FIELDS = ("month", "label", "n", "avg_pct", "median_pct", "pct_up", "thin")

NOTE_WHAT = ("the seasonality board as UCT holds it: {funds} index and sector funds by calendar month, close to "
             "close, each month with the years counted, the average and the median month return and the percent of "
             "those years it rose. {answered} of {funds} funds have numbers. A record of the past, not a forecast")
NOTE_AS_OF = ("`as_of` is the newest daily bar date any fund's record covers ({day}); it is never the time of the "
              "read. The board was built at {at} (UCT's own time, New York date {et_date}) and is not rebuilt by "
              "this read")
NOTE_WITHOUT = ("{n} of {funds} funds have no numbers and are listed with the reason, never as zeros: {list}")
NOTE_THIN = ("{n} month figures on the board have fewer than {min_years} years counted and are flagged `thin`: too "
             "few years to read as a pattern")
NOTE_UNSETTLED = ("the board is unfinished: a fund's history was still being read, or its read failed, when it was "
                  "built. The seasonality board in UCT reads it again; this read never does")
NOTE_NOT_HELD = ("the seasonality board has not been read on this server yet today, or its last read was unfinished "
                 "and is too old to serve, and this read never builds it. That is not the same as no pattern. Open "
                 "the seasonality board (SEASB) in UCT, then ask again")
NOTE_NO_NUMBERS = ("the seasonality board held on this server has no fund with numbers yet ({list}), and this read "
                   "never reads a fund. That is not the same as no pattern. Open the seasonality board (SEASB) in "
                   "UCT, then ask again")
NOTE_FAILED = "the seasonality board read failed; nothing is stated. That is not the same as no pattern"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. The board takes no argument."""
    if not isinstance(params, dict):
        return "the request must be an object"
    return None


def held_answer() -> Optional[dict]:
    """The board the service already holds and may still serve, or None, WITHOUT building one."""
    from api.services import seasonality_board as svc
    return svc.held()


def _count(v: Any) -> int:
    return int(v) if isinstance(v, int) and not isinstance(v, bool) and v >= 0 else 0


def _month(m: Any) -> Optional[dict]:
    if not isinstance(m, dict) or not isinstance(m.get("month"), int) or isinstance(m.get("month"), bool):
        return None
    n = _count(m.get("n"))
    return {"month": m["month"], "label": m.get("label") if isinstance(m.get("label"), str) else None, "n": n,
            # nothing counted: no figure, never a 0
            "avg_pct": _num(m.get("avg_pct")) if n else None, "median_pct": _num(m.get("median_pct")) if n else None,
            "pct_up": _num(m.get("pct_up")) if n else None, "thin": m.get("thin") is not False}


def _fund(f: Any) -> Optional[dict]:
    """One fund, copied: with its twelve months when the board has them, else with the board's own status and reason
    and NO months."""
    if not isinstance(f, dict) or not isinstance(f.get("symbol"), str) or not f["symbol"]:
        return None
    base = {"symbol": f["symbol"], "name": f.get("name") if isinstance(f.get("name"), str) else None,
            "kind": f.get("kind") if f.get("kind") in ("index", "sector") else None}
    months = [x for x in (_month(m) for m in f.get("months") or [])] if isinstance(f.get("months"), list) else []
    if f.get("status") == "ok" and len(months) == 12 and all(months):
        return {**base, "status": "ok", "months": months, "covered_from": _day(f.get("covered_from")),
                "covered_to": _day(f.get("covered_to")), "full_months": _count(f.get("full_months"))}
    status = f.get("status") if f.get("status") in WITHOUT_WORDS else "unavailable"
    return {**base, "status": status, "reason": f.get("reason") if isinstance(f.get("reason"), str) else None}


def _why(f: dict) -> str:
    return f"{f['symbol']} ({WITHOUT_WORDS[f['status']]}" + (f": {f['reason']})" if f.get("reason") else ")")


def read_seasonality_board(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    try:
        board = held_answer()                                  # the held board only: never a build
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "no pattern"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if board is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    if not isinstance(board, dict) or not isinstance(board.get("funds"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    funds = [x for x in (_fund(f) for f in board["funds"]) if x]
    have = [f for f in funds if f["status"] == "ok"]
    without = [f for f in funds if f["status"] != "ok"]
    through = _day(board.get("data_through"))
    if not funds:
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not have or through is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NO_NUMBERS.format(list="; ".join(_why(f) for f in without)))
    min_years = _count(board.get("min_years")) or None
    built_at = board.get("as_of") if isinstance(board.get("as_of"), str) else None
    thin = sum(1 for f in have for m in f["months"] if m["n"] and m["thin"])
    settled = board.get("settled") is True

    notes = [NOTE_WHAT.format(funds=len(funds), answered=len(have)),
             NOTE_AS_OF.format(day=through, at=built_at or "a time it did not record",
                               et_date=_day(board.get("et_date")) or "not recorded")]
    if without:
        notes.append(NOTE_WITHOUT.format(n=len(without), funds=len(funds), list="; ".join(_why(f) for f in without)))
    if thin:
        notes.append(NOTE_THIN.format(n=thin, min_years=min_years if min_years is not None else "the minimum"))
    if not settled:
        notes.append(NOTE_UNSETTLED)

    # `funds` / `this_month` / `next_month` / `et_date` / `min_years` / `source` / `data_through` / `complete` /
    # `settled` keep the route's own names (the panel's model reads them); the board's own `as_of` (WHEN IT WAS
    # BUILT) rides as `built_at`, so it cannot be read as the data's date
    month = board.get("this_month") if isinstance(board.get("this_month"), int) else None
    nxt = board.get("next_month") if isinstance(board.get("next_month"), int) else None
    data = {"funds": funds, "this_month": month, "next_month": nxt, "et_date": _day(board.get("et_date")),
            "min_years": min_years, "source": board.get("source") if isinstance(board.get("source"), str) else None,
            "data_through": through, "complete": not without, "settled": settled, "built_at": built_at,
            "read_at": _read_at(built_at)}
    coverage = {"evaluated": len(funds), "answered": len(have), "dropped": 0, "not_computable": len(without)}
    return env.make_envelope(KIND, params, status="ok" if not without else "partial", freshness="historical",
                             as_of=day_as_of(through), source=SOURCE, data=data, stale=False, coverage=coverage,
                             notes=notes, provider_calls=0)
