"""MD-1 kind `market.analogs` (owner: terminal-data, data wave 13) — the past sessions whose breadth looked most like the
newest one, and what the S&P 500 did after each, as held.

The Agent half of ANLG ("days like today"), over the answer of `GET /api/breadth-monitor/analogues?top_n=N`
(`api/services/breadth_analogues.py` `find_analogues`, the same answer the Analogue Deck on Breadth draws), with the
route's own field names: the reference session and its breadth measures, and the closest past sessions (each with its
closeness as a percent, its breadth measures then, and the S&P 500's return 5, 10, 20 and 60 trading days after it).
(The brief named `/api/analogs`: that route is the brain's setup analogs, a different answer; ANLG reads this one.)

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A SEARCH (MD-1 §5). The route works the answer out on the request when
nothing is held for its `top_n` or the held entry is past its six hours (a read of 500 sessions of breadth history and a
similarity pass). This adapter reads `breadth_analogues_held.held_analogues()` instead: the entry with the most matches the
module holds, its first `rows` matches (the search is the same up to the final cut), with the time it was worked out.
provider_calls is always 0. A rail shows the route working it out in the same state.

A RECORD OF WHAT FOLLOWED, NEVER A FORECAST (the panel's first sentence, word for word, travels as a note): a forward
window the calendar has not reached is absent from the service's answer and is said as "not yet", never 0; every count is
counted from the list itself, and a handful of sessions is a small sample.

NOTHING HELD IS SAID: no held entry is `unavailable`, never "no similar days". An entry past the route's six hours is
served with its build time and `stale`.

TIME (MD-1 §3): `as_of` = the regular close of the reference session (the data's own date), never the time of the read;
the time UCT worked it out rides as `data.built_at`. Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the vector each session is matched on is the Breadth Monitor's row
(row T-75 of docs/terminal-research/09-security-licensing-cost/licensing-register.md, the authoritative EOD breadth row,
"X", an owner-accepted risk for member display), UCT's breadth analytics (row T-11) and retained derived history (row
N-25, which names the breadth analogues); its sentiment measures (CNN Fear & Greed, the AAII spread, the CBOE put/call)
come from sources no row names. Row T-14 (the market-data vendor's numbers into a model) is "R". No row clears any of
these for a model provider; the narrower rule is kept. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num
from api.services.uct_agent.marketdata.stock_stats_read import close_as_of

KIND = "market.analogs"
SOURCE = "uct-breadth-analogues"
DEFAULT_ROWS = 5                                  # the route's default `top_n` (a rail pins it)
MAX_ROWS = 10                                     # the route's largest `top_n`
WINDOWS = ("fwd_5d", "fwd_10d", "fwd_20d", "fwd_60d")   # breadth_analogues._compute_forward_returns, in its order
MEASURES = ("breadth_score", "uct_exposure", "pct_above_50sma", "pct_above_200sma", "vix", "mcclellan_osc", "ratio_5day",
            "new_52w_highs", "new_52w_lows", "cnn_fear_greed", "aaii_spread", "sp500_close")   # _build_metrics_summary

NOTE_RECORD = "A record of what followed similar days, not a forecast."
NOTE_WHAT = ("the past sessions whose breadth looked most like {day} in UCT's breadth history (16 weighted breadth measures "
             "over the last 500 sessions), as UCT holds them for the ANLG panel, each with what the S&P 500 did 5, 10, 20 "
             "and 60 trading days later. Not advice")
NOTE_AS_OF = ("`as_of` is the close of the reference session ({day}); it is never the time of the read, and this read never "
              "searches. UCT worked it out at {at} (UCT's own time)")
NOTE_NOT_YET = "{n} of the returned forward returns are not yet: fewer trading days have passed since that session (never 0)"
NOTE_SAMPLE = "{n} sessions is a small sample; every count here is counted from this list"
NOTE_FEWER = "{held} matches are held and {asked} were asked for: only {held} are returned"
NOTE_CUT = "{held} matches are held and the closest {shown} are returned: the list is cut from the LEAST similar end"
NOTE_EXPIRED = ("the held answer was worked out more than {hours} hours ago, longer than the route serves it before working "
                "it out again; this read never works it out")
NOTE_NO_MATCH = "the held answer has no match for {day}: the reference session's measures were too few to compare"
NOTE_NOT_HELD = ("the breadth analogues are not held on this server yet, and this read never searches. That is not the same "
                 "as no similar days. Open ANLG in UCT, then ask again")
NOTE_FAILED = "the breadth analogues read failed; nothing is stated. That is not the same as no similar days"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission. The kind takes no symbol."""
    if not isinstance(params, dict):
        return "the request must be an object"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer() -> tuple[Optional[dict], Optional[float], str]:
    """READ ONLY: (the held answer, when it was worked out, 'held' | 'expired' | 'not_held'), WITHOUT a search
    (`breadth_analogues_held.held_analogues`)."""
    from api.services import breadth_analogues_held as svc
    return svc.held_analogues()


def _measures(m: Any) -> dict:
    m = m if isinstance(m, dict) else {}
    return {k: _num(m.get(k)) for k in MEASURES if _num(m.get(k)) is not None}


def _match(a: Any) -> Optional[dict]:
    if not isinstance(a, dict) or not _day(a.get("date")):
        return None
    fw = a.get("forward_returns") if isinstance(a.get("forward_returns"), dict) else {}
    return {"date": a["date"], "similarity": _num(a.get("similarity")), "distance": _num(a.get("distance")),
            "forward_returns": {w: _num(fw.get(w)) for w in WINDOWS},
            "not_yet": [w for w in WINDOWS if _num(fw.get(w)) is None], "measures_then": _measures(a.get("metrics_then"))}


def read_analogs(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    rows = params.get("rows", DEFAULT_ROWS)
    try:
        got, built, how = held_answer()
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how not in ("held", "expired") or not isinstance(got, dict) or not _day(got.get("reference_date")):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    try:
        return _answer(params, rows, got, built, how)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, rows: int, got: dict, built: Optional[float], how: str) -> dict:
    from api.services import breadth_analogues_held as svc
    day = got["reference_date"][:10]
    matches = [x for x in (_match(a) for a in got.get("analogues") or []) if x]
    shown = matches[:rows]
    at = env.utc_iso(datetime.fromtimestamp(built, tz=timezone.utc)) if isinstance(built, (int, float)) else None
    notes = [NOTE_RECORD, NOTE_WHAT.format(day=day), NOTE_AS_OF.format(day=day, at=at or "a time it does not give")]
    not_yet = sum(len(m["not_yet"]) for m in shown)
    if not_yet:
        notes.append(NOTE_NOT_YET.format(n=not_yet))
    if shown:
        notes.append(NOTE_SAMPLE.format(n=len(shown)))
    else:
        notes.append(NOTE_NO_MATCH.format(day=day))
    if len(matches) < rows and matches:
        notes.append(NOTE_FEWER.format(held=len(matches), asked=rows))
    if len(matches) > len(shown):
        notes.append(NOTE_CUT.format(held=len(matches), shown=len(shown)))
    stale = how == "expired"
    if stale:
        notes.append(NOTE_EXPIRED.format(hours=round(svc.ttl_s() / 3600)))
    data = {"reference_date": day, "reference_measures": _measures(got.get("reference_metrics")), "matches": shown,
            "held": len(matches), "windows": list(WINDOWS), "built_at": at,
            "age_s": round(time.time() - built) if isinstance(built, (int, float)) else None,
            "stale_for": ["expired"] if stale else []}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=close_as_of(day), source=SOURCE,
                             data=data, stale=stale, notes=notes, provider_calls=0)
