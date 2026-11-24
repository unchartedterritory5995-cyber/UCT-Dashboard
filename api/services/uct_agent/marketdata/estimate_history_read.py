"""MD-1 kind `estimates.history` (owner: terminal-data, data wave 12) — one stock's estimate history, as held.

For each upcoming fiscal quarter in UCT's own daily snapshots of the analysts' consensus (at most four): the newest
consensus EPS and revenue estimate with its low, high and analyst count, and how each moved over 7, 30 and 90 days; with
whether the stock is in the population UCT snapshots at all, and from where. The Agent half of EEH, over the answer of
`GET /api/research/estimate-history/{sym}` (`api/services/estimate_history.py`), with the route's own field names.

⛔ ONLY WHAT THE SERVER ALREADY HOLDS, NEVER A WRITE OR A VENDOR READ (MD-1 §5). The route's `estimate_history.history`
REGISTERS the stock in the tracked population (a write that adds it to the daily snapshot job). A turn must not, so this
adapter reads through `estimate_history_held.held_history()`: the route's answer with registering switched off, with the
tracked origin and the store's newest day read over a read-only connection, and nothing when the store does not exist.
provider_calls is always 0. A rail shows the route's reader registering the stock in the same state.

EACH MOVE IS THE EEHSC RULE, NOT A NEW ONE: `estimate_revisions.classify` (the pure function EEHSC counts every stock
with) over this stock's held snapshots of that quarter: the newest snapshot against the newest one on or before 7, 30 or
90 days earlier (within the service's slack), a change of more than its tolerance either way raised or cut, anything
within it held; too short a history is `collecting`, a missing snapshot a `gap`, a missing or zero estimate
`not_comparable`, each with the service's own reason. Nothing else is worked out here.

THE TRACKED-POPULATION RULE IS SAID: UCT snapshots only the stocks it tracks (the S&P 500 list its daily job seeds and the
stocks members opened EEH for, at most `estimate_history.MAX_SYMBOLS`). A stock outside it with no snapshot is
`unavailable` with that reason, never "no estimates"; a stock inside it with none yet is `unavailable` with the date rule.
The fiscal YEAR's consensus is not held (the snapshots are quarterly), said.

THE ROUTE'S SWITCH IS RESPECTED EXACTLY: the route answers 404 unless ESTIMATE_HISTORY_ENABLED is on; with it off this
read is `unavailable`, never an empty table.

TIME (MD-1 §3): `as_of` = the start of the Eastern day of the stock's newest snapshot, the data's own date; never the time
of the read. Every read is `periodic`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the consensus estimates are the estimates vendor's
(docs/terminal-research/09-security-licensing-cost/licensing-register.md, row T-34: FMP's analyst estimates and consensus
for member display; row T-44: FMP's numbers into a model, "No AI clause"). No row of that register clears these figures
for a model provider. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _whole, day_as_of
from api.services.uct_agent.marketdata.stock_stats_read import check_params, clean_symbol

KIND = "estimates.history"
SOURCE = "uct-estimate-history"
WINDOWS = (7, 30, 90)
METRICS = ("eps", "revenue")                 # estimate_revisions.METRICS (a rail pins the two together)
MAX_PERIODS = 4                              # estimate_history.MAX_PERIODS
MAX_GAPS = 5
POINT_FIELDS = ("snap_date", "eps_avg", "eps_low", "eps_high", "n_eps", "rev_avg", "rev_low", "rev_high", "n_rev")
MOVE_FIELDS = ("state", "reason", "pct", "from", "to", "from_date", "to_date")
ORIGIN_WORDS = {"sp500": "the S&P 500 list UCT's daily job seeds", "viewed": "a member opened EEH for it"}

NOTE_WHAT = ("{symbol}'s estimate history as UCT holds it for the EEH panel: its own daily snapshots of the analysts' "
             "consensus EPS and revenue estimate for each upcoming fiscal quarter (at most {periods}), {first} to {last}, "
             "{days} snapshot days. Analysts' estimates, not a forecast of UCT's and not advice")
NOTE_AS_OF = ("`as_of` is the day of {symbol}'s newest snapshot ({day}); it is never the time of the read, and this read "
              "never adds a snapshot")
NOTE_TRACKED = "{symbol} is in the population UCT snapshots because {why} ({count} of at most {cap} stocks are tracked)"
NOTE_MOVES = ("each move is the newest snapshot against the newest one on or before {windows} days earlier (within {slack} "
              "days), EEHSC's own rule: a change of more than {tol}% either way is raised or cut, anything within it held; "
              "a move the history cannot give is said with its reason, never as 0")
NOTE_YEAR = "the fiscal year's consensus is not held: UCT snapshots the quarterly estimates only"
NOTE_GAPS = "{n} snapshot days failed to read for {symbol} (newest {newest}): they are gaps, never skipped silently"
NOTE_BEHIND = ("{symbol}'s newest snapshot ({last}) is older than the store's newest ({store}): the daily read has not "
               "answered for it since")
NOTE_NO_PERIODS = "{reason}: no upcoming quarter is held, so no estimate is stated. That is not the same as no estimates"
NOTE_LEFT_OUT = "every snapshot point of each quarter is not in this read, only the newest: the EEH panel shows them"
NOTE_NOT_TRACKED = ("{symbol} is not in the population UCT snapshots (the S&P 500 list and the stocks members opened EEH "
                    "for, at most {cap}), so no estimate history is held for it. That is not the same as no estimates. "
                    "Opening EEH for {symbol} in UCT adds it when there is room; its history begins with the next snapshot")
NOTE_COLLECTING = ("{symbol} is tracked but has no snapshot yet: the daily job adds one each weekday evening and its "
                   "history begins with the first. That is not the same as no estimates")
NOTE_SWITCHED_OFF = ("the estimate history is switched off on this server (its route answers nothing), so it is not read. "
                     "That is not the same as no estimates")
NOTE_NOT_HELD = ("no estimate history is held on this server yet, and this read never adds one. That is not the same as "
                 "no estimates. Open EEH in UCT, then ask again")
NOTE_FAILED = "the estimate history read failed; nothing is stated. That is not the same as no estimates"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_params(params, None, None)


def switched_on() -> bool:
    """The route's own switch (`estimate_history.is_enabled`, read per call)."""
    from api.services import estimate_history as eh
    return eh.is_enabled()


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: (the route's own answer, 'held' | 'not_held'), WITHOUT registering the stock
    (`estimate_history_held.held_history`)."""
    from api.services import estimate_history_held as svc
    return svc.held_history(sym)


def read_history(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = clean_symbol(params["symbol"])
    try:
        if not switched_on():
            return env.unavailable(KIND, params, SOURCE, NOTE_SWITCHED_OFF)
        got, how = held_answer(sym)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how != "held" or not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    from api.services import estimate_history as EH
    cap = _whole(got.get("tracked_cap")) or EH.MAX_SYMBOLS
    if not _day(got.get("last_snapshot")):
        if not got.get("tracked_origin"):
            return env.unavailable(KIND, params, SOURCE, NOTE_NOT_TRACKED.format(symbol=sym, cap=cap))
        return env.unavailable(KIND, params, SOURCE, NOTE_COLLECTING.format(symbol=sym))
    try:
        return _answer(params, sym, got, cap)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _moves(points: list, period_end: str, first: str, last: str, store: Optional[str]) -> dict:
    from api.services import estimate_revisions as ER
    rows = [(p.get("snap_date"), period_end, p.get("eps_avg"), p.get("rev_avg")) for p in points]
    out = {}
    for metric in METRICS:
        out[metric] = {}
        for w in WINDOWS:
            c = ER.classify(rows, first, last, store or last, w, metric)
            out[metric][str(w)] = {k: c.get(k) for k in MOVE_FIELDS}
    return out


def _point(p: Any) -> dict:
    return {k: (p.get(k) if k == "snap_date" else _whole(p.get(k)) if k.startswith("n_") else _num(p.get(k))) for k in POINT_FIELDS}


def _answer(params: dict, sym: str, got: dict, cap: int) -> dict:
    from api.services import estimate_revisions as ER
    first, last, store = _day(got.get("covers_from")), _day(got.get("last_snapshot")), _day(got.get("store_newest"))
    origin = got.get("tracked_origin") if got.get("tracked_origin") in ORIGIN_WORDS else None
    periods = []
    for p in (got.get("periods") or [])[:MAX_PERIODS]:
        if not isinstance(p, dict) or not _day(p.get("period_end")):
            continue
        pts = [x for x in (p.get("points") or []) if isinstance(x, dict) and _day(x.get("snap_date"))]
        if not pts:
            continue
        upcoming = p["period_end"] > last
        periods.append({"period_end": p["period_end"], "n": len(pts), "first_snapshot": pts[0]["snap_date"],
                        "upcoming": upcoming, "newest": _point(pts[-1]),
                        "moves": _moves(pts, p["period_end"], first, last, store) if upcoming else None})
    notes = [NOTE_WHAT.format(symbol=sym, periods=MAX_PERIODS, first=first, last=last,
                              days=_whole(got.get("snapshot_days")) or 0),
             NOTE_AS_OF.format(symbol=sym, day=last)]
    if origin:
        notes.append(NOTE_TRACKED.format(symbol=sym, why=ORIGIN_WORDS[origin], count=_whole(got.get("tracked_count")) or 0,
                                         cap=cap))
    if periods:
        notes.append(NOTE_MOVES.format(windows=", ".join(str(w) for w in WINDOWS[:-1]) + f" or {WINDOWS[-1]}",
                                       slack=ER.SLACK_DAYS, tol=ER.HELD_TOLERANCE_PCT))
    else:
        notes.append(NOTE_NO_PERIODS.format(reason=str(got.get("reason") or "the snapshots hold no upcoming quarter")))
    notes.append(NOTE_YEAR)
    gaps = [g for g in (got.get("failed_days") or []) if isinstance(g, dict) and _day(g.get("snap_date"))]
    if gaps:
        notes.append(NOTE_GAPS.format(n=len(gaps), symbol=sym, newest=gaps[-1]["snap_date"]))
    if store and store > last:
        notes.append(NOTE_BEHIND.format(symbol=sym, last=last, store=store))
    notes.append(NOTE_LEFT_OUT)
    data = {"symbol": sym, "state": got.get("state") if isinstance(got.get("state"), str) else None,
            "covers_from": first, "last_snapshot": last, "store_newest": store,
            "snapshot_days": _whole(got.get("snapshot_days")), "currency": got.get("currency") if isinstance(got.get("currency"), str) else None,
            "tracked": {"origin": origin, "count": _whole(got.get("tracked_count")), "cap": cap},
            "windows": list(WINDOWS), "tolerance_pct": ER.HELD_TOLERANCE_PCT, "slack_days": ER.SLACK_DAYS,
            "periods": periods, "failed_days": len(gaps),
            "failed_newest": [g["snap_date"] for g in gaps[-MAX_GAPS:]][::-1], "left_out": ["points", "year"]}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=day_as_of(last), source=SOURCE,
                             data=data, notes=notes, provider_calls=0)
