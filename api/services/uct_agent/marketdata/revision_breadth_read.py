"""MD-1 kind `estimates.revisionBreadth` (owner: terminal-data, data wave 11) — estimate revisions by sector, as held.

Among the stocks UCT tracks (the S&P 500 list its estimate job follows and the stocks members opened the estimate history
of, never the whole market): for one estimate (next-quarter EPS or revenue) and one window (7 or 30 days), per sector
how many stocks' consensus was raised, cut or held, the net breadth, and the largest raises and cuts; the total; and
how many are not counted and why. The Agent half of EEHSC, over the answer of
`GET /api/research/estimate-history?metric=…&window=…` (`api/services/estimate_revisions.py`), with the route's own field
names (the EEHSC panel's model reads them).

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The route's `estimate_revisions.get_breadth`
answers through `held_build.HeldBuild.get()`, which STARTS the one background read of the estimate snapshot store when
the held answer is due, and with nothing held waits on it. A turn must not, so this adapter never calls it. It reads
through `estimate_revisions_held.held_breadth()`, the route's own answer shaped over `estimate_revisions.peek()`, which
never starts a read. provider_calls is always 0. A rail shows `get_breadth` starting that read in the same state.

THE ROUTE'S SWITCH IS RESPECTED EXACTLY: the route answers 404 unless ESTIMATE_HISTORY_ENABLED is on
(`estimate_history.is_enabled`, read per call); with it off this read is `unavailable`, never an empty table.

NOTHING HELD IS SAID, NEVER "NO REVISIONS": nothing held is `unavailable` with that reason. A sector with fewer than five
counted stocks has its counts and no net figure, never a net of 0.

WHAT IS STATED: every count is the service's own (`estimate_revisions.sector_slice`), passed through; nothing is
recomputed here. Each sector's list of every symbol with its state is left out (the largest three raises and cuts are
kept), and a note says the EEHSC panel shows them. At most `MAX_SECTORS` sectors; a cut is said.

TIME (MD-1 §3): `as_of` = the start of the Eastern day of the store's newest snapshot (`asof`), the data's own date;
never the time of the read. When UCT added them up rides as `data.built_at`. Every read is `periodic`; the kind is
DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the consensus estimates are the estimates vendor's
(docs/terminal-research/09-security-licensing-cost/licensing-register.md, row T-34: FMP's analyst estimates and consensus
for member display; row T-44: FMP's numbers into a model, "No AI clause"). No row of that register clears these figures
for a model provider. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole, day_as_of
from api.services.uct_agent.marketdata.stock_stats_read import tree

KIND = "estimates.revisionBreadth"
SOURCE = "uct-estimate-revisions"
METRICS = ("eps", "revenue")             # estimate_revisions.METRICS (a rail pins the two together)
WINDOWS = (7, 30)                         # estimate_revisions.WINDOWS
DEFAULT_METRIC = "eps"
DEFAULT_WINDOW = 30
MAX_SECTORS = 30
#: one sector's (or the total's) counts, by the service's own names (estimate_revisions._blank_counts, sector_slice)
COUNT_FIELDS = ("name", "on_file", "members", "counted", "up", "down", "held", "not_counted", "net", "raises", "cuts")
METRIC_WORDS = {"eps": "EPS", "revenue": "revenue"}

NOTE_WHAT = ("estimate revisions by sector as UCT added them up for EEHSC, among the {n} stocks it tracks ({origins}), "
             "not the whole market: for each stock the next fiscal quarter's consensus {metric} estimate {window} days "
             "apart, a change of more than {tol}% either way a raise or a cut, anything within it held. Analysts' "
             "estimates, not a forecast of UCT's and not advice")
NOTE_AS_OF = ("`as_of` is the day of the store's newest snapshot ({day}); it is never the time of the read. UCT added "
              "them up at {at} (UCT's own time)")
NOTE_NO_SNAPSHOT = "`as_of` is null: the store holds no snapshot yet, so nothing has a date and nothing is counted"
NOTE_FLOOR = "a net figure needs {min} counted stocks: a sector with fewer gives its counts and no net (never 0)"
NOTE_NOT_COUNTED = ("{collecting} still collecting (snapshots too new to span the window), {gap} with a gap in their "
                    "snapshots, {nc} with no comparable estimate: none of them is counted, and none is dropped")
NOTE_COLLECTING = "no tracked stock's snapshots span the {window}-day window yet (they began {began}), so nothing is counted"
NOTE_NO_SECTOR = "{n} of the tracked stocks have no sector on file: they are counted on their own row"
NOTE_CUT = "{total} sectors are held and the first {shown} are returned: the list is cut from the end of the server's order"
NOTE_LEFT_OUT = ("each sector's list of every stock with its state is not in this read, only its three largest raises and "
                 "cuts: the EEHSC panel shows them")
NOTE_SWITCHED_OFF = ("the estimate history is switched off on this server (its route answers nothing), so revision "
                     "breadth is not read. That is not the same as no revisions")
NOTE_NOT_HELD = ("estimate revisions by sector are not held on this server yet, and this read never adds them up. That is "
                 "not the same as no revisions. Open EEHSC in UCT, then ask again")
NOTE_FAILED = "the estimate revisions read failed; nothing is stated. That is not the same as no revisions"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if params.get("metric", DEFAULT_METRIC) not in METRICS:
        return "`metric` must be eps or revenue"
    w = params.get("window", DEFAULT_WINDOW)
    if isinstance(w, bool) or w not in WINDOWS:
        return "`window` must be 7 or 30"
    return None


def switched_on() -> bool:
    """The route's own switch (`estimate_history.is_enabled`, read per call)."""
    from api.services import estimate_history as eh
    return eh.is_enabled()


def held_answer(metric: str, window: int) -> tuple[Optional[dict], str]:
    """READ ONLY: (the route's own answer, 'held' | 'not_held'), WITHOUT starting a read
    (`estimate_revisions_held.held_breadth`)."""
    from api.services import estimate_revisions_held as svc
    return svc.held_breadth(metric, window)


def _counts(c: Any) -> Optional[dict]:
    return {k: tree(c.get(k)) for k in COUNT_FIELDS if k in c} if isinstance(c, dict) else None


def read_breadth(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    metric, window = params.get("metric", DEFAULT_METRIC), params.get("window", DEFAULT_WINDOW)
    try:
        if not switched_on():
            return env.unavailable(KIND, params, SOURCE, NOTE_SWITCHED_OFF)
        got, how = held_answer(metric, window)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how != "held" or not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    try:
        return _answer(params, got, metric, window)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, got: dict, metric: str, window: int) -> dict:
    tracked = got.get("tracked") if isinstance(got.get("tracked"), dict) else {}
    origins = tracked.get("origins") if isinstance(tracked.get("origins"), dict) else {}
    n = _whole(tracked.get("n")) or 0
    sp, viewed = _whole(origins.get("sp500")) or 0, _whole(origins.get("viewed")) or 0
    from_words = ("the S&P 500 list and stocks members looked at" if sp and viewed else "the S&P 500 list" if sp
                  else "stocks members looked at")
    asof, built_at = _day(got.get("asof")), _read_at(got.get("built_at"))
    tol = _num(got.get("tolerance_pct"))
    total = _counts(got.get("total")) or {}
    sectors = [_counts(s) for s in (got.get("sectors") or []) if isinstance(s, dict)]
    shown = sectors[:MAX_SECTORS]
    notes = [NOTE_WHAT.format(n=n, origins=from_words, metric=METRIC_WORDS[metric], window=window,
                              tol=tol if tol is not None else 0.5),
             NOTE_AS_OF.format(day=asof, at=built_at or "a time it does not give") if asof else NOTE_NO_SNAPSHOT,
             NOTE_FLOOR.format(min=_whole(got.get("min_counted")) or 5)]
    nc = total.get("not_counted") if isinstance(total.get("not_counted"), dict) else {}
    if any(_whole(nc.get(k)) for k in ("collecting", "gap", "not_comparable")):
        notes.append(NOTE_NOT_COUNTED.format(collecting=_whole(nc.get("collecting")) or 0, gap=_whole(nc.get("gap")) or 0,
                                             nc=_whole(nc.get("not_comparable")) or 0))
    if asof and n and not total.get("counted"):
        notes.append(NOTE_COLLECTING.format(window=window, began=_day(got.get("covers_from")) or "on a day it does not give"))
    if _whole(tracked.get("no_sector")):
        notes.append(NOTE_NO_SECTOR.format(n=_whole(tracked.get("no_sector"))))
    if len(sectors) > len(shown):
        notes.append(NOTE_CUT.format(total=len(sectors), shown=len(shown)))
    notes.append(NOTE_LEFT_OUT)
    data = {"metric": metric, "window": window, "asof": asof, "covers_from": _day(got.get("covers_from")), "built_at": built_at,
            "tracked": {"n": n, "cap": _whole(tracked.get("cap")), "origins": {"sp500": sp, "viewed": viewed},
                        "no_sector": _whole(tracked.get("no_sector"))},
            "tolerance_pct": tol, "slack_days": _whole(got.get("slack_days")), "min_counted": _whole(got.get("min_counted")),
            "top_n": _whole(got.get("top_n")), "total": total, "sectors": shown, "count": len(sectors),
            "left_out": ["symbols"]}
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=day_as_of(asof), source=SOURCE, data=data,
                             coverage={"evaluated": n, "answered": _whole(total.get("counted")) or 0, "dropped": 0,
                                       "not_computable": max(0, n - (_whole(total.get("counted")) or 0))},
                             notes=notes, provider_calls=0)
