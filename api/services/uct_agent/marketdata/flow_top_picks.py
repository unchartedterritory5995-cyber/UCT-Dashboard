"""MD-1 kind `flow.topPicks` (owner: terminal-data, data wave 3) — every Top Flow pick, with how its contract has done.

The Agent half of the TOPF terminal panel (app/src/pages/terminal/panels/topFlowModel.js), over the store behind
`GET /api/top-flow/history`: `api/top_flow_tracker.get_all()`, the tracker's in-memory lists (loaded from disk once, at
startup). The read builds nothing and calls no provider: provider_calls is always 0.

ONE DEFINITION OF A GAIN, THE FLOW RECORD'S. Every gain here is `api/flow_scoreboard.pick_stats(pick)`, called, never
re-derived: a usable daily price is above 0; a pick with fewer than `MIN_HISTORY_SNAPSHOTS` of them is NOT SCORED
(`scored: false`, every gain null: "too new to score", never 0% and never a loss); entry is the stored entry, else the
first tracked price; a gain is the option CONTRACT's own price change, whichever way the pick leans, never the stock's
move. The store's own `finalPnl` is never returned (it reads 0 for a missing price).

WHERE THE NUMBERS COME FROM, said on every read (api/top_flow_tracker.py, api/flow_scoreboard.py):
  * the picks and their entry prices come from UCT's options flow tape (saved by the Options Flow page);
  * the daily contract prices are recorded each weekday after the close, from Massive (prices recorded before
    November 2026 came from Schwab and stay as recorded). Each history entry written since carries `src: "massive"`;
    an entry with `src: "schwab"` or with none was recorded from Schwab. A row's `src` lists the sources that priced it.

THE CUT IS STATED. The store grows with every pick, so the server filters, orders and cuts: at most `limit` rows, the
whole count beside them, and a note naming both. The order is the TOPF panel's own (`sortRows`): a pick that is not
scored has no gain, so under the three gain orders it goes last (newest first), never ranked as 0.

AN EMPTY STORE IS AMBIGUOUS, AND SAID SO. `top_flow_tracker._load` answers a file it could not read with two empty
lists, the same as a store that holds nothing. The read is `ok` with no rows and a note that says exactly that.

TIME (MD-1 §3): `as_of` = the newest daily price date in the whole store, as that session's close (prices are recorded
after the close, never during a session); null with a note when no pick carries a price. Every read is `historical`;
the kind is DECLARED `periodic` (the store grows daily), the less fresh read being allowed. `stale` when that newest
price is more than `STALE_AFTER_DAYS` calendar days old (the TOPF panel's own number, railed equal).
THE NEWEST PICK IS A DIFFERENT QUESTION FROM THE NEWEST PRICE: `data.newest_pick_date` gives it, and a note says when
nothing has been added for more than `NO_NEW_PICKS_AFTER_DAYS` days.

MODEL-ISOLATED (ADR-005): which contracts are picks, and each one's grade, are UCT's own selection from its options flow
tape, and the results are option contract prices from a vendor: a UCT-derived selection over options data the owner has
not cleared for the model. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Optional
from zoneinfo import ZoneInfo

from api.services.uct_agent.marketdata import envelope as env

KIND = "flow.topPicks"
SOURCE = "uct-top-flow"
#: what a member may ask for; the keys are the TOPF panel's own (topFlowModel.js), railed equal in the tests
STATUSES = ("all", "open", "expired")
#: → the store's own `dir`
DIRECTIONS = {"any": None, "bullish": "BULL", "bearish": "BEAR"}
SORTS = ("gain", "loss", "peak", "newest")
SORT_WORDS = {"gain": "biggest current gain first", "loss": "biggest current loss first",
              "peak": "biggest peak gain first", "newest": "newest pick first"}
DEFAULT_LIMIT = 20
MAX_LIMIT = 50
#: the TOPF panel's own numbers (topFlowModel.js STALE_AFTER_DAYS / NO_NEW_PICKS_AFTER_DAYS), railed equal
STALE_AFTER_DAYS = 4
NO_NEW_PICKS_AFTER_DAYS = 14
#: the `src` LABELS a stored history entry can carry. Nothing reads Schwab any more (retired 2026-11-17): "schwab"
#: is here only to read the label of entries recorded before November 2026, which are never rewritten.
PRICE_SOURCES = ("massive", "schwab")
SYMBOL_RE = re.compile(r"^[A-Za-z][A-Za-z.\-]{0,9}$")
#: a stored symbol this kind will show (the TOPF panel's own rule)
_STORED_SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9.\-/]{0,11}$")
_ET = ZoneInfo("America/New_York")
ROW_FIELDS = ("id", "sym", "cp", "strike", "exp", "grade", "dir", "dateSaved", "saved_date", "status", "stopped", "scored",
              "prices", "entry", "latest_price", "latest_date", "peak_price", "current_gain_pct", "max_gain_pct",
              "days_tracked", "oi_evaluable", "oi_confirmed", "prem", "hits", "cap", "src")

NOTE_WHAT = ("each Top Flow pick UCT flagged on its options flow tape, with how its option contract has done since: a "
             "gain is the contract's own price change against its price when flagged, never the stock's move; UCT's "
             "own selection, not a recommendation")
NOTE_SOURCES = ("picks and entry prices come from UCT's options flow tape; daily contract prices are recorded each "
                "weekday after the close, from Massive (prices recorded before November 2026 came from Schwab and stay "
                "as recorded); each row's `src` names the sources that priced it, and an entry with no source on record "
                "is Schwab")
NOTE_TOO_NEW = ("{n} of the {total} picks that match have fewer than {min} daily prices and are too new to score: their "
                "gains are not given, which is not the same as 0%")
NOTE_AS_OF = ("as_of is the newest daily price date in the pick store, as that session's close; prices are recorded "
              "once each weekday after the close, never during a session")
NOTE_NO_PRICES = "no pick in the store carries a daily price, so as_of is not given"
NOTE_STALE = "the newest daily price in the store is {date}, more than {days} days old, so the results stop there"
NOTE_NO_NEW_PICKS = "the newest pick in the store was flagged on {date}; none has been added since"
NOTE_EMPTY = ("the pick store holds no pick; a store that could not be loaded when the server started reads the same as "
              "an empty one, so this is not a statement that no pick was ever flagged")
NOTE_NO_MATCH = "the store holds {total} picks, none of them matching what was asked for"
NOTE_CUT = "showing the first {n} of {total} picks that match, {order}"
NOTE_UNREAD = "{n} stored picks carry no readable symbol or history and are left out"
NOTE_FAILED = "the Top Flow picks could not be read"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    if params.get("status", "all") not in STATUSES:
        return "`status` must be one of " + ", ".join(STATUSES)
    if params.get("direction", "any") not in DIRECTIONS:
        return "`direction` must be one of " + ", ".join(DIRECTIONS)
    if params.get("sort", "gain") not in SORTS:
        return "`sort` must be one of " + ", ".join(SORTS)
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    sym = params.get("symbol")
    if sym is not None and (not isinstance(sym, str) or not SYMBOL_RE.match(sym.strip())):
        return "`symbol` must be one ticker (letters, dots and dashes, starting with a letter)"
    return None


def today_et() -> date:
    return datetime.now(_ET).date()


def _positive(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f and f > 0 else None


def _iso(d: Optional[date]) -> Optional[str]:
    return d.isoformat() if isinstance(d, date) else None


def priced_days(pick: dict) -> list[tuple[Optional[date], str]]:
    """(the day, the source) of every history entry that carries a usable price, in the store's own order. An entry
    with no `src` (or with "schwab") was recorded from Schwab before November 2026 (api/top_flow_tracker.py)."""
    from api import flow_scoreboard as fs
    out = []
    for h in pick.get("history") or []:
        if not isinstance(h, dict) or _positive(h.get("price")) is None:
            continue
        src = h.get("src") if h.get("src") in PRICE_SOURCES else "schwab"
        out.append((fs.parse_pick_date(h.get("date", "")), src))
    return out


def store_dates(picks: list) -> dict:
    """The two dates a read of the pick store states: its newest daily PRICE day and its newest PICK day."""
    from api import flow_scoreboard as fs
    newest_price = newest_pick = None
    for p in picks:
        if not isinstance(p, dict):
            continue
        saved = fs.parse_pick_date(p.get("dateSaved", ""))
        if saved and (newest_pick is None or saved > newest_pick):
            newest_pick = saved
        for day, _ in priced_days(p):
            if day and (newest_price is None or day > newest_price):
                newest_price = day
    return {"newest_price": newest_price, "newest_pick": newest_pick}


def time_facts(dates: dict, today: date) -> dict:
    """as_of / stale / the day counts both flow kinds state, from `store_dates` (one rule for the two kinds)."""
    price, pick = dates.get("newest_price"), dates.get("newest_pick")
    as_of = None
    if price:
        from api.services.uct_agent.marketdata.themes import _session_close_utc
        as_of = _session_close_utc(int(price.strftime("%Y%m%d")))
    price_age = (today - price).days if price else None
    pick_age = (today - pick).days if pick else None
    return {"as_of": as_of, "newest_price_date": _iso(price), "newest_pick_date": _iso(pick),
            "days_since_newest_price": price_age, "days_since_newest_pick": pick_age,
            "stale": price_age is not None and price_age > STALE_AFTER_DAYS,
            "no_new_picks": pick_age is not None and pick_age > NO_NEW_PICKS_AFTER_DAYS}


def _row(pick: Any, status: str) -> Optional[dict]:
    from api import flow_scoreboard as fs
    if not isinstance(pick, dict):
        return None
    sym = str(pick.get("sym") or "").strip().upper()
    if not _STORED_SYMBOL.match(sym):
        return None
    stats = fs.pick_stats(pick)                          # THE gain arithmetic; None = fewer than two daily prices
    days = priced_days(pick)
    dated = sorted(d for d, _ in days if d)
    saved = fs.parse_pick_date(pick.get("dateSaved", ""))
    last_price = None
    for h in pick.get("history") or []:
        if isinstance(h, dict) and _positive(h.get("price")) is not None:
            last_price = round(_positive(h.get("price")), 4)
    return {
        "id": str(pick.get("id") or "") or None, "sym": sym, "cp": str(pick.get("cp") or "").upper()[:1] or None,
        "strike": _positive(pick.get("strike")), "exp": str(pick.get("exp") or "").strip() or None,
        "grade": fs.clean_grade(pick.get("grade", "")) or None,
        "dir": pick.get("dir") if pick.get("dir") in ("BULL", "BEAR") else None,
        "dateSaved": str(pick.get("dateSaved") or "").strip() or None, "saved_date": _iso(saved),
        "status": status, "stopped": status == "expired" and bool(str(pick.get("purgeReason") or "").strip()),
        "scored": stats is not None, "prices": len(days),
        "entry": stats["entry"] if stats else _positive(pick.get("entry")),
        "latest_price": stats["latest_price"] if stats else last_price,
        "latest_date": _iso(dated[-1]) if dated else None,
        "peak_price": stats["peak_price"] if stats else None,
        "current_gain_pct": stats["current_gain_pct"] if stats else None,
        "max_gain_pct": stats["max_gain_pct"] if stats else None,
        "days_tracked": stats["days_tracked"] if stats else None,
        "oi_evaluable": bool(stats["oi_evaluable"]) if stats else False,
        "oi_confirmed": bool(stats["oi_confirmed"]) if stats else False,
        "prem": _positive(pick.get("prem")), "hits": int(_positive(pick.get("hits"))) if _positive(pick.get("hits")) else None,
        "cap": str(pick.get("cap") or "").strip() or None,
        "src": sorted({s for _, s in days}),
    }


def ordered(rows: list[dict], sort: str) -> list[dict]:
    """The TOPF panel's own order (topFlowModel.js `sortRows`): a pick that is not scored goes last, never ranked as 0."""
    def newest(r):                                        # newest pick first; a pick with no readable date last
        return (0, -date.fromisoformat(r["saved_date"]).toordinal()) if r["saved_date"] else (1, 0)
    if sort == "newest":
        return sorted(rows, key=newest)                   # sorted() is stable: equal picks keep the store's order
    field = "max_gain_pct" if sort == "peak" else "current_gain_pct"
    sign = 1 if sort == "loss" else -1

    def key(r):
        return (0, sign * r[field], newest(r)) if r["scored"] else (1, 0, newest(r))
    return sorted(rows, key=key)


def read_top_picks(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    status = params.get("status", "all")
    direction = params.get("direction", "any")
    sort = params.get("sort", "gain")
    limit = params.get("limit", DEFAULT_LIMIT)
    symbol = params["symbol"].strip().upper() if isinstance(params.get("symbol"), str) else None
    try:
        from api import flow_scoreboard as fs
        from api import top_flow_tracker
        store = top_flow_tracker.get_all()                # the in-memory lists: no build, no provider
        active, archived = store["active"], store["archived"]
        if not isinstance(active, list) or not isinstance(archived, list):
            raise TypeError("not the tracker's answer")
        rows, unread = [], 0
        for picks, state in ((active, "open"), (archived, "expired")):
            for p in picks:
                try:
                    row = _row(p, state)
                except Exception:  # noqa: BLE001 — one unreadable pick is counted, never the whole read
                    row = None
                if row is None:
                    unread += 1
                else:
                    rows.append(row)
        facts = time_facts(store_dates(active + archived), today_et())
        min_prices = int(fs.MIN_HISTORY_SNAPSHOTS)
    except Exception:  # noqa: BLE001 — a failing store is an honest unavailable, never an empty list
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    want_dir = DIRECTIONS[direction]
    kept = [r for r in rows if (status == "all" or r["status"] == status)
            and (want_dir is None or r["dir"] == want_dir) and (symbol is None or r["sym"] == symbol)]
    kept = ordered(kept, sort)
    shown = kept[:limit]
    notes = [NOTE_WHAT, NOTE_SOURCES, NOTE_AS_OF if facts["as_of"] else NOTE_NO_PRICES]
    if facts["stale"]:
        notes.append(NOTE_STALE.format(date=facts["newest_price_date"], days=STALE_AFTER_DAYS))
    if facts["no_new_picks"]:
        notes.append(NOTE_NO_NEW_PICKS.format(date=facts["newest_pick_date"]))
    if not rows:
        notes.append(NOTE_EMPTY)
    elif not kept:
        notes.append(NOTE_NO_MATCH.format(total=len(rows)))
    elif len(kept) > limit:
        notes.append(NOTE_CUT.format(n=limit, total=len(kept), order=SORT_WORDS[sort]))
    too_new = sum(1 for r in kept if not r["scored"])
    if too_new:
        notes.append(NOTE_TOO_NEW.format(n=too_new, total=len(kept), min=min_prices))
    if unread:
        notes.append(NOTE_UNREAD.format(n=unread))
    counts = {"total": len(rows), "open": sum(1 for r in rows if r["status"] == "open"),
              "expired": sum(1 for r in rows if r["status"] == "expired"),
              "scored": sum(1 for r in rows if r["scored"]),
              "too_new": sum(1 for r in rows if r["status"] == "open" and not r["scored"]),
              "never_scored": sum(1 for r in rows if r["status"] == "expired" and not r["scored"])}
    data = {"status": status, "direction": direction, "sort": sort, "symbol": symbol, "rows": shown, "count": len(kept),
            "counts": counts, "matching_too_new": too_new, "unread": unread, "min_prices": min_prices,
            "newest_price_date": facts["newest_price_date"], "newest_pick_date": facts["newest_pick_date"],
            "days_since_newest_price": facts["days_since_newest_price"],
            "days_since_newest_pick": facts["days_since_newest_pick"], "no_new_picks": facts["no_new_picks"]}
    coverage = {"evaluated": len(rows), "answered": len(shown), "dropped": len(kept) - len(shown),
                "not_computable": unread}
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=facts["as_of"], source=SOURCE,
                             data=data, stale=facts["stale"], coverage=coverage, notes=notes, provider_calls=0)
