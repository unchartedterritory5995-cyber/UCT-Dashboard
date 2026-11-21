"""MD-1 kind `uct20.list` (owner: terminal-data, data wave 7) — the current UCT 20 list, as pushed.

The UCT 20 leadership list as the morning wire last pushed it to this server: each name's rank in the list, its
symbol, its RS rating and UCT 20 score, its one-month and three-month returns and its next earnings date: the list
half of the UCT 20 page (U20), over the list `GET /api/leadership` serves (`api/services/engine.py`).

⛔ ONLY THE LIST THE SERVER ALREADY HOLDS, NEVER A BUILD OR A FETCH (MD-1 §5). The route starts a background bar
warm for every name on the list, and `engine.get_leadership()` can build the day's pending-acquisition set
(`deal_status.consumer_pending`, when `DEAL_STATUS_ENABLED` is on: a build that reads news and bars, and a
background refresh). A turn must not, so this adapter calls neither. It reads the pushed list
(`engine._leadership_as_pushed`: the cache, then the file on this server) and the wire's own date and status, and
it applies the pending-acquisition rule ONLY from a set already built for today (`held_pending`). provider_calls is
always 0. A rail shows `get_leadership` building that set in the same state.

THE LIST MEMBERS SEE, OR NOTHING: when the pending-acquisition rule is on and today's set is not built, the list
members see cannot be stated without a build, so the read is `unavailable` with that reason, never the unfiltered
list. No list held is `unavailable`, never an empty list.

WHAT IS LEFT OUT, AND SAID (the licensing register's row T-12 names "the composites: UCT20 portfolio NAV ..., the
Exposure Rating ..., published entry/stop/target on named tickers" and says "do not add new composite publications
until answered"): the model portfolio (its value, its NAV curve, its entry and stop prices and its trades) and each
name's entry, stop and targets are NOT carried. Nor are the wire's price and change (a morning snapshot, not a
quote) or the written thesis and company description. `data.left_out` names them and a note says so. A figure the
wire did not carry is null, never 0.

THE CUT IS STATED: at most `rows` names are returned, in the list's own order; a longer list is cut from the BOTTOM
of the ranking and the note says so.

TIME (MD-1 §3): `as_of` = the wire run's own date, as the start of that Eastern day; never the time of the read.
The read is `stale`, with a note, when the route's own rule says so: a trading-day run was missed, or the wire's
publish gate held or degraded the list. Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the licensing register
(docs/terminal-research/09-security-licensing-cost/licensing-register.md) row T-11 covers the RS rank and the other
analytics derived from the vendor's data as restricted, row T-12 covers the UCT 20 composites as restricted, and row
T-14 is the vendor's numbers into a model, restricted. None of the three clears this list for a model provider, and
no other row does. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.bars_daily import _SYMBOL_RE
from api.services.uct_agent.marketdata.short_interest import _day, _num, day_as_of

KIND = "uct20.list"
SOURCE = "uct-morning-wire"
MAX_ROWS = 20               # the UCT 20 page shows the first twenty (a rail pins it to the page's own slice)
DEFAULT_ROWS = 20
#: the per-name figures carried, by the wire's own field names
FIELDS = ("rs", "score", "ret_1m", "ret_3m")
#: on the wire or the page and NOT carried (see the module docstring)
LEFT_OUT = ("entry", "stop", "target_1", "target_2", "portfolio", "nav", "price", "change", "thesis", "company_desc")
STALE_WORDS = {"stale": "a trading-day wire run was missed, so this is the list of an earlier run",
               "held": "the wire's publish check held this run, so this is the last list that passed it",
               "degraded": "the wire's publish check marked this run degraded"}

NOTE_WHAT = ("the UCT 20 leadership list as the morning wire last pushed it: each name's rank in the list, its RS "
             "rating, its UCT 20 score, its one-month and three-month returns in percent and its next earnings "
             "date. UCT's own selection, not advice and not a forecast")
NOTE_AS_OF = ("`as_of` is the wire run's own date ({day}); it is never the time of the read. The list is built once "
              "a day before the open and this read never rebuilds it")
NOTE_NO_DATE = ("the pushed list carries no run date, so `as_of` is null and how old the list is cannot be stated")
NOTE_LEFT_OUT = ("the UCT 20 model portfolio (its value, its NAV curve, its entry and stop prices and its trades) "
                 "and each name's entry, stop and targets are left out of this answer, with the wire's price and "
                 "change and the written thesis. The UCT 20 page in UCT shows them")
NOTE_CUT = ("the list holds {total} names and the top {shown} are returned in the list's own order: it is cut from "
            "the BOTTOM of the ranking")
NOTE_PENDING = ("{n} names with a pending acquisition are left off the list, as on the UCT 20 page")
NOTE_MISSING = ("{n} names have at least one figure the wire did not carry; those figures are null, never 0")
NOTE_STALE = ("{why}. This read never rebuilds the list")
NOTE_NOT_HELD = ("no UCT 20 list is held on this server, and this read never builds one. That is not the same as an "
                 "empty list")
NOTE_DEALS_NOT_HELD = ("the UCT 20 page leaves out names with a pending acquisition, and today's set of those names "
                       "is not built on this server yet. This read never builds it, so the list members see cannot "
                       "be stated. Open the UCT 20 page in UCT, then ask again")
NOTE_FAILED = "the UCT 20 read failed; nothing is stated. That is not the same as an empty list"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_pending() -> tuple[Optional[frozenset], str]:
    """(today's pending-acquisition set, how): 'off' (the rule is off: an empty set), 'held' (a set already built
    for today) or 'not_held' (the rule is on and today's set is not built: None). READ ONLY: it reads the set
    `deal_status` holds and never builds or refreshes one (`consumer_pending` does both)."""
    from api.services import deal_status as ds
    if not ds.enabled():
        return frozenset(), "off"
    with ds._LOCK:
        cur = ds._SETS["v"]
    if not isinstance(cur, dict) or cur.get("day") != ds._today():
        return None, "not_held"
    return frozenset(ds._norm(s) for s in cur.get("pending") or () if s), "held"


def held_answer() -> tuple[Optional[dict], str]:
    """(the pushed list with the wire's date and status, how): how is 'held', 'not_held' (no list on this server) or
    'deals_not_held' (the pending-acquisition rule is on and today's set is not built). READ ONLY: the cache and the
    file on this server; never the route, never a bar warm, never a deal-status build."""
    from api.routers import engine_data
    from api.services import deal_status as ds
    from api.services import engine
    stocks = engine._leadership_as_pushed()
    stocks = [r for r in stocks if isinstance(r, dict)] if isinstance(stocks, list) else []
    wire = engine._load_wire_data() or {}
    wire_date = wire.get("date") or wire.get("generated_at") or None
    if not stocks:
        return None, "not_held"
    pending, how = held_pending()
    if pending is None:
        return None, "deals_not_held"
    kept = [r for r in stocks if not (pending and ds._norm(r.get("ticker") or r.get("sym") or r.get("symbol")) in pending)]
    status = engine_data._leadership_status(kept, wire_date)
    meta = wire.get("leadership_meta") if isinstance(wire.get("leadership_meta"), dict) else {}
    if meta.get("status") in ("held", "degraded"):
        status = meta["status"]
    return {"stocks": kept, "last_updated": wire_date, "status": status, "pending_removed": len(stocks) - len(kept),
            "held_since": meta.get("held_since")}, "held"


def _symbol(r: dict) -> Optional[str]:
    v = r.get("ticker") or r.get("sym") or r.get("symbol")
    s = v.strip().upper() if isinstance(v, str) else ""
    return s if s and _SYMBOL_RE.match(s) else None


def read_uct20(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    limit = params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer()                               # the pushed list only: never a build
    except Exception:  # noqa: BLE001 — a failing read is an honest unavailable, never "an empty list"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how == "deals_not_held":
        return env.unavailable(KIND, params, SOURCE, NOTE_DEALS_NOT_HELD)
    if how == "not_held" or got is None:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    if how != "held" or not isinstance(got, dict) or not isinstance(got.get("stocks"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    listed = [r for r in got["stocks"][:MAX_ROWS] if isinstance(r, dict)]   # the page's own first twenty
    rows = []
    for i, r in enumerate(listed):
        sym = _symbol(r)
        if sym is None:
            continue
        # rank = the name's place in the list as pushed; a figure the wire did not carry is null, never 0
        rows.append({"rank": i + 1, "symbol": sym, **{k: _num(r.get(k)) for k in FIELDS},
                     "earnings_date": _day(r.get("earnings_date"))})
    if not rows:
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    total, shown = len(rows), rows[:limit]
    day = _day(got.get("last_updated"))
    status = got.get("status") if got.get("status") in ("fresh", "stale", "held", "degraded") else "stale"
    stale = status != "fresh" or day is None
    removed = got.get("pending_removed") if isinstance(got.get("pending_removed"), int) else 0
    gaps = sum(1 for r in shown if any(r[k] is None for k in FIELDS))

    notes = [NOTE_WHAT, NOTE_AS_OF.format(day=day) if day else NOTE_NO_DATE, NOTE_LEFT_OUT]
    if total > len(shown):
        notes.append(NOTE_CUT.format(total=total, shown=len(shown)))
    if removed:
        notes.append(NOTE_PENDING.format(n=removed))
    if gaps:
        notes.append(NOTE_MISSING.format(n=gaps))
    if status in STALE_WORDS:
        notes.append(NOTE_STALE.format(why=STALE_WORDS[status][0].upper() + STALE_WORDS[status][1:]))

    data = {"rows": shown, "count": len(shown), "total": total, "cut": total > len(shown), "as_of": day,
            "status": status, "held_since": _day(got.get("held_since")), "pending_removed": removed,
            "left_out": list(LEFT_OUT)}
    coverage = {"evaluated": total, "answered": len(shown), "dropped": total - len(shown), "not_computable": gaps}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=day_as_of(day), source=SOURCE,
                             data=data, stale=stale, coverage=coverage, notes=notes, provider_calls=0)
