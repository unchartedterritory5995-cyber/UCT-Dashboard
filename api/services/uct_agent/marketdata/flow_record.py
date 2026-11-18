"""MD-1 kind `flow.record` (owner: terminal-data, data wave 3) — the Flow Record's aggregate results.

How every Top Flow pick has done, in aggregate: win rates, the same by grade, the recent standouts and the last scored
picks whatever their result. A thin adapter over `api/flow_scoreboard._get_payload()`, the read behind
`GET /api/flow-scoreboard` (the Flow Record page): the service's own payload from its own 5-minute cache.

NO BUILD THAT DOES NOT FIT A TURN (MD-1 §5). On a cache miss the service computes the board from the pick tracker's
in-memory lists (`compute_scoreboard`: pure arithmetic, no I/O, no provider), the same work the member route does. A
failed tracker read is the service's own `ScoreboardUnavailable` (it remembers the failure for 30 seconds and never
caches it as data): this kind answers `unavailable`, never a zero-pick board. provider_calls is always 0.

THE SERVICE'S HONESTY RULES ARE KEPT AS THEY ARE (api/flow_scoreboard.py, "LOCKED"): losers are never left out; a pick
with fewer than two daily prices is "too new", counted apart and in no rate, never 0%; every gain is the option
CONTRACT's price gain, never the stock's move. Nothing is re-derived here: every rate and gain is the service's.

WHERE THE NUMBERS COME FROM, said on every read: the picks and their entry prices from UCT's options flow tape; every
gain, win rate and open-interest confirmation from daily contract prices recorded each weekday after the close, from
Massive (prices recorded before November 2026 came from Schwab and stay as recorded).

THE LISTS ARE THE SERVICE'S OWN, AND THEIR CUT IS STATED: its `RECENT_WINNERS_LIMIT` best peak gains among scored picks
flagged in the last `RECENT_WINDOW_DAYS` days, and its last `RECENT_PICKS_LIMIT` scored picks whatever their result.

AN EMPTY RECORD IS AMBIGUOUS, AND SAID SO: a pick store that could not be loaded at startup reads the same as an empty
one (see flow_top_picks.py). The read is `ok` with zero picks and a note that says exactly that.

TIME (MD-1 §3): `generated_at` is when the service worked the board out (a computation time), so it is never `as_of`; it
rides as `data.computed_at`. `as_of` = the newest daily price date in the pick store, as that session's close; null with
a note when no pick carries a price. Every read is `historical`; the kind is DECLARED `periodic`. `stale` and the
newest-pick note are flow_top_picks.py's own rule (`time_facts`), so the two kinds cannot disagree.
THE RECORD CAN KEEP ITS RESULTS WHILE NOTHING NEW IS ADDED: `data.newest_pick_date` says when the last pick was flagged.

MODEL-ISOLATED (ADR-005): the rates are UCT's own measurement of its own selections, worked out from vendor option
contract prices: UCT-derived, over options data the owner has not cleared for the model. Shown to the member only; the
capability is local-only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import flow_top_picks as picks_kind

KIND = "flow.record"
SOURCE = "uct-flow-record"
#: an aggregate's fields, by the route's own names (flow_scoreboard._bucket_stats)
BUCKET_FIELDS = ("picks", "win_rate_10", "win_rate_25", "win_rate_50", "pct_doubled", "avg_max_gain", "median_max_gain",
                 "oi_confirmed_rate", "oi_evaluated")
#: a listed pick's fields, by the route's own names (flow_scoreboard._PUBLIC_FIELDS; the last two on recent picks only)
PICK_FIELDS = ("sym", "cp", "strike", "exp", "grade", "dateSaved", "entry", "peak_price", "max_gain_pct", "days_tracked",
               "oi_confirmed", "current_gain_pct", "latest_price")

NOTE_WHAT = ("the Flow Record: how every Top Flow pick UCT flagged has done, measured on the option contract's own daily "
             "prices; a win rate is the share of scored picks whose best daily price reached that gain over the price "
             "when flagged, and losers are never left out; past results, not a forecast")
NOTE_SOURCES = ("picks and entry prices come from UCT's options flow tape; every gain, win rate and open-interest "
                "confirmation is worked out from daily contract prices recorded each weekday after the close, from "
                "Massive (prices recorded before November 2026 came from Schwab and stay as recorded)")
NOTE_TOO_NEW = ("{n} picks have fewer than {min} daily prices and are too new to score: they are counted apart and are "
                "in no rate, never as 0%")
NOTE_LISTS = ("the two lists are the service's own cut: its {winners} best peak gains among scored picks flagged in the "
              "last {days} days, and its last {picks} scored picks whatever their result")
NOTE_TIME = "worked out by UCT at {at} and kept for up to {minutes} minutes (UCT's own time, never as_of)"
NOTE_AS_OF = ("as_of is the newest daily price date in the pick store, as that session's close; prices are recorded "
              "once each weekday after the close, never during a session")
NOTE_NO_PRICES = "no pick in the store carries a daily price, so as_of is not given"
NOTE_STALE = "the newest daily price in the store is {date}, more than {days} days old, so the results stop there"
NOTE_NO_NEW_PICKS = "the newest pick in the record was flagged on {date}; none has been added since"
NOTE_DATES_UNREAD = "the pick store's dates could not be read, so as_of is not given and the record's age is unknown"
NOTE_EMPTY = ("the record holds no pick; a pick store that could not be loaded when the server started reads the same as "
              "an empty one, so this is not a statement about the picks")
NOTE_FAILED = "the Flow Record could not be read; that is a gap in what could be read, not a statement about the picks"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate). The record is one board: it takes no parameter."""
    if params:
        return "this kind takes no parameters"
    return None


def _bucket(b: Any) -> dict:
    b = b if isinstance(b, dict) else {}
    return {k: b.get(k) for k in BUCKET_FIELDS}


def _picks(rows: Any) -> list[dict]:
    return [{k: r.get(k) for k in PICK_FIELDS if k in r} for r in (rows if isinstance(rows, list) else [])
            if isinstance(r, dict) and r.get("sym")]


def _computed_at(raw: Any) -> Optional[str]:
    try:
        d = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return env.utc_iso(d if d.tzinfo else d.replace(tzinfo=timezone.utc))


def read_flow_record(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    try:
        from api import flow_scoreboard as svc
        payload = svc._get_payload()                      # the route's own cached read; raises when the tracker failed
    except Exception:  # noqa: BLE001 — ScoreboardUnavailable or any failure: unavailable, never a zero-pick board
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if not isinstance(payload, dict) or not isinstance(payload.get("overall"), dict) \
            or not isinstance(payload.get("by_grade"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    tracked = payload.get("picks_tracked") if isinstance(payload.get("picks_tracked"), int) else 0
    too_new = payload.get("too_new") if isinstance(payload.get("too_new"), int) else 0
    computed_at = _computed_at(payload.get("generated_at"))
    minutes = int(svc.CACHE_TTL_SECONDS // 60)
    notes = [NOTE_WHAT, NOTE_SOURCES]
    if computed_at:
        notes.append(NOTE_TIME.format(at=computed_at, minutes=minutes))
    try:
        from api import top_flow_tracker
        store = top_flow_tracker.get_all()
        facts = picks_kind.time_facts(picks_kind.store_dates(store["active"] + store["archived"]), picks_kind.today_et())
    except Exception:  # noqa: BLE001 — the board was read; only its dates were not
        facts = None
    if facts is None:
        notes.append(NOTE_DATES_UNREAD)
    else:
        notes.append(NOTE_AS_OF if facts["as_of"] else NOTE_NO_PRICES)
        if facts["stale"]:
            notes.append(NOTE_STALE.format(date=facts["newest_price_date"], days=picks_kind.STALE_AFTER_DAYS))
        if facts["no_new_picks"]:
            notes.append(NOTE_NO_NEW_PICKS.format(date=facts["newest_pick_date"]))
    if not tracked and not too_new:
        notes.append(NOTE_EMPTY)
    else:
        if too_new:
            notes.append(NOTE_TOO_NEW.format(n=too_new, min=int(svc.MIN_HISTORY_SNAPSHOTS)))
        notes.append(NOTE_LISTS.format(winners=int(svc.RECENT_WINNERS_LIMIT), days=int(svc.RECENT_WINDOW_DAYS),
                                       picks=int(svc.RECENT_PICKS_LIMIT)))
    facts = facts or {}
    # `picks_tracked` / `too_new` / `overall` / `by_grade` / `recent_winners` / `recent_picks` / `generated_at` keep the
    # route's own names (the Flow Record page reads them)
    data = {"flagged": tracked + too_new, "picks_tracked": tracked, "too_new": too_new,
            "overall": _bucket(payload["overall"]),
            "by_grade": [{"grade": g.get("grade"), **_bucket(g)} for g in payload["by_grade"] if isinstance(g, dict)],
            "recent_winners": _picks(payload.get("recent_winners")), "recent_picks": _picks(payload.get("recent_picks")),
            "generated_at": payload.get("generated_at"), "computed_at": computed_at,
            "min_prices": int(svc.MIN_HISTORY_SNAPSHOTS), "recent_window_days": int(svc.RECENT_WINDOW_DAYS),
            "newest_price_date": facts.get("newest_price_date"), "newest_pick_date": facts.get("newest_pick_date"),
            "days_since_newest_price": facts.get("days_since_newest_price"),
            "days_since_newest_pick": facts.get("days_since_newest_pick"),
            "no_new_picks": bool(facts.get("no_new_picks"))}
    # unknown is never claimed fresh: a record whose dates could not be read is stale
    stale = bool(facts.get("stale")) if facts else True
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=facts.get("as_of"),
                             source=SOURCE, data=data, stale=stale, notes=notes, provider_calls=0)
