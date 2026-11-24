"""MD-1 kind `analyst.ratings` (owner: terminal-data, data wave 12) — one stock's analyst ratings and price targets, as held.

The counts of analysts by rating (strong buy to strong sell) with the consensus word, the price target (high, low,
median, consensus and the recent averages by month, quarter and year), the upside from the stock's newest stored close to
the consensus target (the median when no consensus is given: the ANR panel's own rule), and the most recent rating actions
(bounded). The Agent half of ANR, over the record of `GET /api/research/analyst-ratings/{sym}`
(`api/services/research/analyst_ratings.py`), with the route's own field names.

⛔ ONLY WHAT THE SERVER ALREADY HOLDS, NEVER A VENDOR READ (MD-1 §5). The route's composer
(`analyst_grades.get_analyst_grades`) reads the shared cache and, on a miss, asks the vendor four times on the caller's
thread. A turn must not, so this adapter never calls it: it reads through `analyst_ratings_held.held_ratings()`, the same
cache entry shaped as the route shapes it, which never asks. provider_calls is always 0. A rail shows the composer asking
in the same state.

THE UPSIDE IS NOT THE PANEL'S LAST TRADE: the panel measures the target against the live last trade, which a held read
does not have. This read measures it against the newest completed session's close in UCT's bar store (read-only, as
`bars.daily` reads it), and says that close and its day. No stored close: no upside, said (never 0).

NOTHING HELD IS SAID, NEVER "NO COVERAGE": nothing held is `unavailable` with that reason. A record the vendor answered
with no coverage for every leg is `ok` with each section null and the route's own words for it. An outage the composer
holds is `unavailable` (the route answers 503 for it); a record built while one leg was down is `partial`, said. A fund is
`unavailable` with the route's own reason. Each vendor-side `_meta` is reduced to its observation time (no vendor name).

TIME (MD-1 §3): `as_of` = the newest observation time the record's legs carry (`sourceObservedAt`), the data's own time;
null, said, when no leg carries one. Never the time of the read. Every read is `periodic`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the consensus, targets and actions are the estimates vendor's
(docs/terminal-research/09-security-licensing-cost/licensing-register.md, row T-34: FMP's analyst estimates, grades, price
targets and consensus for member display, "R"; row T-44: FMP's numbers into a model, "No AI clause"); the close beside
them is the market-data vendor's stored history (row T-04, member display of D/W/M history; row T-14, its numbers into a
model, "R"). No row of that register clears these figures for a model provider. Shown to the member only; the capability
is local-only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _num, _whole
from api.services.uct_agent.marketdata.stock_stats_read import check_params, clean_symbol

KIND = "analyst.ratings"
SOURCE = "uct-analyst-ratings"
DEFAULT_ROWS = 5
MAX_ROWS = 12                       # analyst_grades._MAX_ACTIONS (a rail pins the two together)
BUCKETS = ("strongBuy", "buy", "hold", "sell", "strongSell")      # analyst_grades._consensus's own keys
WINDOWS = ("last_month", "last_quarter", "last_year")             # analyst_grades._price_target's own keys
ACTION_FIELDS = ("date", "company", "action", "from_grade", "to_grade")

NOTE_WHAT = ("{symbol}'s analyst ratings as UCT holds them for the ANR panel: the count of analysts by rating with the "
             "consensus, the price target (high, low, median, consensus and the recent averages) and the most recent "
             "rating actions. Analysts' opinions, not UCT's, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the newest time the vendor's legs say they observed the data ({at}); it is never the time of the "
              "read, and this read never asks the vendor")
NOTE_NO_TIME = "`as_of` is null: no leg of the held record carries an observation time"
NOTE_UPSIDE = ("the upside is the {target} target against {symbol}'s close of {day} in UCT's bar store ({close}), not the "
               "last trade the ANR panel uses")
NOTE_NO_UPSIDE = "no upside is stated: {why}. That is not an upside of 0"
NOTE_NO_COVERAGE = ("the vendor answered for every leg and has no analyst coverage on file for {symbol}: no consensus, no "
                    "target and no rating action")
NOTE_OUTAGE = ("some of {symbol}'s analyst data could not be read when UCT last asked; what is stated is what answered, "
               "and a missing section is not the same as none")
NOTE_CUT = "{total} recent rating actions are held and the newest {shown} are returned: the list is cut from the OLD end"
NOTE_LEFT_OUT = ("the monthly rating trend and the estimate revisions are not in this read: the ANR panel in UCT shows the "
                 "revisions")
NOTE_FUND = "{reason}, so no analyst rating is stated. That is not the same as no coverage"
NOTE_NOT_HELD = ("{symbol}'s analyst ratings are not held on this server yet, and this read never asks the vendor. That is "
                 "not the same as no coverage. Open ANR for {symbol} in UCT, then ask again")
NOTE_FAILED = "the analyst ratings read failed; nothing is stated. That is not the same as no coverage"
UPSIDE_WHY = {"no_target": "the record gives no consensus or median target",
              "no_close": "UCT's bar store holds no completed close for it"}


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_params(params, MAX_ROWS, DEFAULT_ROWS)


def held_answer(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: (the route's own record, 'held' | 'fund' | 'failed' | 'not_held'), WITHOUT asking the vendor
    (`analyst_ratings_held.held_ratings`)."""
    from api.services.research import analyst_ratings_held as svc
    return svc.held_ratings(sym)


def held_close(sym: str) -> Optional[tuple[str, float]]:
    """READ ONLY: (the day, the close) of the newest completed session UCT's bar store holds for `sym`, or None. The
    store's own read primitive, as `bars.daily` uses it; never a fetch."""
    from api.services import bars_sqlite
    from api.services.uct_agent.marketdata.sessions import last_completed_session
    rows = bars_sqlite.get_bars_before(sym, "D", 1, last_completed_session())
    if not rows:
        return None
    ts, close = rows[-1][0], _num(rows[-1][4])
    s = str(ts)
    return (f"{s[:4]}-{s[4:6]}-{s[6:8]}", close) if len(s) == 8 and close and close > 0 else None


def _observed(meta: Any) -> Optional[str]:
    t = _num(meta.get("sourceObservedAt")) if isinstance(meta, dict) else None
    return env.utc_iso(datetime.fromtimestamp(t, tz=timezone.utc)) if t and t > 0 else None


def _consensus(c: Any) -> Optional[dict]:
    if not isinstance(c, dict):
        return None
    out = {k: _whole(c.get(k)) for k in BUCKETS}
    out.update({"total": _whole(c.get("total")), "label": c.get("label") if isinstance(c.get("label"), str) else None,
                "observed_at": _observed(c.get("_meta"))})
    return out


def _target(p: Any) -> Optional[dict]:
    if not isinstance(p, dict):
        return None
    out = {k: _num(p.get(k)) for k in ("high", "low", "median", "consensus")}
    for w in WINDOWS:
        b = p.get(w) if isinstance(p.get(w), dict) else {}
        n = _whole(b.get("count"))
        out[w] = {"count": n, "avg": _num(b.get("avg")) if n else None}       # no target counted: no average, never 0
    out["observed_at"] = _observed(p.get("_meta"))
    return out


def read_ratings(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    sym = clean_symbol(params["symbol"])
    rows = params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer(sym)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "fund":
        reason = (got or {}).get("reason") if isinstance(got, dict) else None
        return env.unavailable(KIND, params, SOURCE, NOTE_FUND.format(reason=reason or f"{sym} is a fund"))
    if how == "failed":
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how != "held" or not isinstance(got, dict):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(symbol=sym))
    try:
        return _answer(params, sym, rows, got)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, sym: str, rows: int, got: dict) -> dict:
    con, pt = _consensus(got.get("consensus")), _target(got.get("price_target"))
    ra = got.get("recent_actions") if isinstance(got.get("recent_actions"), dict) else {}
    items = [a for a in (ra.get("items") or []) if isinstance(a, dict)]
    actions = [{k: (a.get(k) if isinstance(a.get(k), str) and a.get(k) else None) for k in ACTION_FIELDS} for a in items]
    shown = actions[:rows]
    outage = got.get("outage") is True
    observed = [t for t in (con and con["observed_at"], pt and pt["observed_at"], _observed(ra.get("_meta"))) if t]
    as_of = max(observed) if observed else None
    notes = [NOTE_WHAT.format(symbol=sym), NOTE_AS_OF.format(at=as_of) if as_of else NOTE_NO_TIME]
    upside = None
    if pt or con or actions:
        target_kind = "consensus" if pt and pt["consensus"] is not None else "median" if pt and pt["median"] is not None else None
        target = pt[target_kind] if target_kind else None
        close = held_close(sym) if target is not None else None
        if target is None:
            notes.append(NOTE_NO_UPSIDE.format(why=UPSIDE_WHY["no_target"]))
        elif close is None:
            notes.append(NOTE_NO_UPSIDE.format(why=UPSIDE_WHY["no_close"]))
        else:
            day, px = close
            upside = {"target": target_kind, "target_value": target, "close": px, "close_date": day,
                      "pct": round((target - px) / px * 100.0, 2), "basis": "stored_close"}
            notes.append(NOTE_UPSIDE.format(target=target_kind, symbol=sym, day=day, close=px))
    else:
        notes.append(NOTE_NO_COVERAGE.format(symbol=sym))
    if outage:
        notes.append(NOTE_OUTAGE.format(symbol=sym))
    if len(actions) > len(shown):
        notes.append(NOTE_CUT.format(total=len(actions), shown=len(shown)))
    notes.append(NOTE_LEFT_OUT)
    data = {"symbol": sym, "consensus": con, "price_target": pt, "upside": upside, "recent_actions": shown,
            "actions_total": len(actions), "outage": outage, "covered": bool(con or pt or actions),
            "left_out": ["trend", "revisions"]}
    return env.make_envelope(KIND, params, status="partial" if outage else "ok", freshness="periodic", as_of=as_of,
                             source=SOURCE, data=data, notes=notes, provider_calls=0)
