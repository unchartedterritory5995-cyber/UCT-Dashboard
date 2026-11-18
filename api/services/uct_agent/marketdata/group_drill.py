"""MD-1 kind `group.drill` (owner: terminal-data, data wave 4) — one sector, industry or UCT theme and its stocks.

One group with each of its stocks' change over a one-click range, its RS rank and whether it is on UCT's confluence
board: the Agent half of the GRP terminal panel (app/src/pages/terminal/panels/groupDrillModel.js). The panel has no
route of its own: it joins, in the browser, four answers the server already holds. This kind joins the SAME held
answers on the server, in one read.

TWO SHAPES OF ONE READ (`data.mode`):
  * `groups`  no `group` named: the names of the ranked groups (with each group's change and how many of its stocks
              are ranked), for one `kind` or for all three. It is what a name is resolved against: the browser runs
              the GRP panel's own resolver (`resolveGroup`) over it, so there is ONE resolver and none here;
  * `group`   a `kind` and the group's name exactly as the ranking lists it: that group's stocks.

⛔ ONLY WHAT THE SERVER ALREADY HOLDS, NEVER A BUILD (MD-1 §5). Each of the four reads can start work on its member
route, so none of those routes' entry points is called:
  * the ranking     `scan_period.get_period_change` starts ONE background build of the whole-market ranking when it
                    holds nothing for the range (two whole-market grouped-daily reads and the market snapshot: it did
                    not answer within 40 seconds mid-session, 2026-11-17). This adapter reads the answer the service
                    holds (`_period_answer`: `data.held` `fresh`) or its last good one (`_period_old_answer`:
                    `last_good`, and the read is `stale`), and is `unavailable` otherwise. The seven one-click ranges
                    are kept built by the web service's own warmer (`warm_presets`), and this kind takes no other range;
  * the groups      `scan_period.period_groups_of(held ranking, kind)`: the service's own grouping (the route's
                    `get_period_change_groups` is that function over `get_period_change`). It reads the stored sector
                    and industry map or the stored theme list, and leaves a theme's engine-suggested holdings out
                    (`source == "engine"`) exactly as the route does, because it IS the route's code;
  * RS              the ranking `GET /api/rs-rankings` serves, from the cache (`cached_rankings`) or the last one
                    written to disk (`snapshot_rankings`), through the route's own overlay (`unified_rankings`, a
                    table read). `kick_background_warm` (the 17-second rebuild the route starts on a cold cache) is
                    never called. Not held → every `rs` is null, the read is `partial` and a note says so;
  * the board       the confluence board's cache entry for the one window the server keeps warm
                    (`confluence_screen._CACHES[DAYS]`). `get_board` is never called: on a cold or old entry it
                    starts the four-minute rebuild. Not held → every `flow` is null, `partial`, with a note.
provider_calls is always 0.
⚠️ COUPLING, stated: the ranking's cache key (`scan_period_<start>_<end>`, with the dates `preset_ranges` gives) and
its two held-answer readers, private to api/services/scan_period.py; and the board's cache entry. Rails fill each
through the service's own writer (`_period_remember`, the board's own cache) and read it back, so a rename fails by name.

ONE THING THE RS LIST DOES THAT THIS DOES NOT: the RS route hides a stock in a pending acquisition from its displayed
list (`deal_status.consumer_pending`). That set is built on its first read of the day, so it is not read here: such a
stock keeps the rank it was given. No other name's rank differs.

A NUMBER THAT DOES NOT EXIST IS NULL, NEVER 0: a stock the RS ranking does not hold has `rs: null`; a stock not on the
board has `flow: null`; a member the ranking carries no change for has `pct: null` and sorts last.
THE CUT IS STATED: at most `limit` stocks in the order asked for, the whole count beside them and a note naming both.

TIME (MD-1 §3): the ranking carries the two trading days it measures between (`start_day`, `end_day`) and when UCT
built it. The build time is a computation time, and the end day's close can be a session still under way, so neither
is claimed as `as_of`: `as_of` is null with a note, and all three ride in `data`. freshness `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the RS rank is UCT-derived (the reason `rs.leadership` is isolated),
the board is UCT's own selection (`confluence.board`), UCT themes are UCT's own taxonomy (hidden from the Agent's
screens by owner decision), and the changes are derived analytics over a vendor's whole-market closes, which no
licensing record clears for a model provider (api/services/provider_licensing_class.py). Shown to the member only;
the capability is local-only.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env

KIND = "group.drill"
SOURCE = "uct-group-drill"
#: the three kinds of group, in the GRP panel's own order (groupDrillModel.js GROUP_KIND_ORDER)
GROUP_KINDS = ("sector", "industry", "theme")
KIND_WORDS = {"sector": "sector", "industry": "industry", "theme": "UCT theme"}
#: the one-click ranges the server keeps built (scan_period.preset_ranges), railed equal to the service and the panel
RANGES = ("mtd", "qtd", "ytd", "m1", "m3", "m6", "y1")
DEFAULT_RANGE = "ytd"                   # the panel's own default (periodChangeModel.js DEFAULT_PERIOD_RANGE)
RANGE_WORDS = {"mtd": "this month", "qtd": "this quarter", "ytd": "this year", "m1": "the last month",
               "m3": "the last 3 months", "m6": "the last 6 months", "y1": "the last year"}
#: the columns a member can sort by (groupDrillModel.js GROUP_SORTS) and the two directions
SORTS = ("pct", "rs")
DIRS = ("desc", "asc")
SORT_WORDS = {("pct", "desc"): "biggest gain first", ("pct", "asc"): "biggest fall first",
              ("rs", "desc"): "highest RS rank first", ("rs", "asc"): "lowest RS rank first"}
MODES = ("groups", "group")
HELD = ("fresh", "last_good")
RS_STATES = ("held", "last_stored", "not_held")
FLOW_STATES = ("held", "not_held")
DEFAULT_LIMIT = 25
MAX_LIMIT = 50
MAX_NAME = 80
#: the most group names one kind returns (a sector list is 11, an industry list about 150)
MAX_GROUPS = 400
ROW_FIELDS = ("sym", "pct", "start_close", "end_close", "industry", "sector", "rs", "flow")
FLOW_FIELDS = ("dir", "status")
GROUP_FIELDS = ("name", "pct", "count")

NOTE_WHAT = ("the stocks of the {kind} {name} with each one's percent change over {range} (between the closes of "
             "{start} and {end}), its RS rank and whether it is on UCT's confluence board; UCT's own ranking and "
             "grouping, not a recommendation")
NOTE_GROUP_PCT = ("the group's own change is UCT's average of its ranked stocks with the biggest gains capped, so one "
                  "outsized gainer cannot carry it; each stock's change is its own")
NOTE_LISTS = ("the groups of each kind asked for (sectors, industries, UCT themes) that hold at least one ranked stock "
              "over {range} (between the closes of {start} and {end}), each with its change and how many of its stocks "
              "are ranked; UCT's own grouping, not a recommendation")
NOTE_TIME = ("the ranking was built by UCT at {at} (UCT's own time; it carries the two days it measures between, not a "
             "data time), so as_of is not given: not a live feed")
NOTE_NO_TIME = "the held ranking carries no build time, so its age is unknown and as_of is not given"
NOTE_LAST_GOOD = ("this is the last good ranking for the range, older than the {minutes} minutes it is normally kept, "
                  "so it may be behind the market")
NOTE_PARTIAL_HISTORY = ("the ranking for this range comes from UCT's own bar history, so stocks that have since "
                        "delisted are missing")
NOTE_RS = ("an RS rank is UCT's 1 to 99 rating of a stock against the market; a stock the ranking does not hold has "
           "none, which is not a rank of 0")
NOTE_RS_LAST_STORED = ("the RS ranks are from the last ranking written to disk, because the server's cache is cold, "
                       "so they may be behind")
NOTE_RS_NOT_HELD = ("the RS ranking is not held on the server, and this read never starts that rebuild; no RS rank is "
                    "given, which is not the same as no rank")
NOTE_FLOW = ("the flow column says only whether a stock is on UCT's confluence board (a large dark pool dollar size "
             "with aligned long-dated options flow) and on which side; a stock not on the board has none")
NOTE_FLOW_OLD = "the confluence board is older than its {minutes}-minute refresh, so the flow column may be behind"
NOTE_FLOW_NOT_HELD = ("the confluence board is not held on the server, and this read never starts that build; no flow "
                      "signal is given, which is not the same as no stock being on the board")
NOTE_NO_CHANGE = "{n} of the {total} stocks have no change in the ranking and are listed last, never as 0%"
NOTE_CUT = "showing the first {n} of {total} stocks, {order}"
NOTE_NO_GROUP = ("the ranking holds no {kind} called {name} for this range ({n} are ranked); a name must be given "
                 "exactly as the ranking lists it")
NOTE_NO_GROUPS = ("no {kind} holds a ranked stock for this range; a stored list that could not be read looks the same, "
                  "so this is not a statement that there is none")
NOTE_GROUPS_CUT = "showing the first {n} of {total} {kind} groups, biggest gain first"
NOTE_NOT_HELD = ("the ranking for {range} is not held on the server (the web service keeps the seven one-click ranges "
                 "built, each for {minutes} minutes and a last good copy {extra} minutes more), and this read never "
                 "starts that build; that is not the same as no group")
NOTE_NOT_READY = ("the server's last attempt to rank {range} did not produce a list, and this read never starts "
                  "another; that is not the same as no group")
NOTE_FAILED = "the group could not be read"


def validate(params: dict) -> Optional[str]:
    """Pure pre-admission check (Kind.validate)."""
    if params.get("range", DEFAULT_RANGE) not in RANGES:
        return "`range` must be one of " + ", ".join(RANGES)
    kind = params.get("kind")
    if kind is not None and kind not in GROUP_KINDS:
        return "`kind` must be one of " + ", ".join(GROUP_KINDS)
    group = params.get("group")
    if group is not None:
        if not isinstance(group, str) or not 1 <= len(group.strip()) <= MAX_NAME:
            return f"`group` must be a group's name of 1 to {MAX_NAME} characters"
        if kind is None:
            return "`group` needs its `kind`: one of " + ", ".join(GROUP_KINDS)
    if params.get("sort", "pct") not in SORTS:
        return "`sort` must be one of " + ", ".join(SORTS)
    if params.get("dir", "desc") not in DIRS:
        return "`dir` must be one of " + ", ".join(DIRS)
    n = params.get("limit", DEFAULT_LIMIT)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_LIMIT:
        return f"`limit` must be a whole number from 1 to {MAX_LIMIT}"
    return None


def now_s() -> float:
    return time.time()


def today_et():
    from api.services import scan_period as svc
    return svc._now_et().date()


def range_key(name: str) -> str:
    """The ranking's cache key for a one-click range today: the dates `preset_ranges` gives, as the warmer builds them."""
    from api.services import scan_period as svc
    today = today_et()
    start = svc.preset_ranges(today)[name]
    return f"scan_period_{start.strftime('%Y%m%d')}_{today.strftime('%Y%m%d')}"


def held_ranking(name: str) -> tuple[Optional[dict], str]:
    """(the per-stock ranking the service already holds for this range, how it is held), WITHOUT building one.
    `fresh` is whatever the service holds inside its freshness, an `ok` list or not; `last_good` is its last good list."""
    from api.services import scan_period as svc
    ck = range_key(name)
    hit = svc._period_answer(ck)
    if isinstance(hit, dict) and hit.get("status") == "ok":
        return hit, "fresh"
    old = svc._period_old_answer(ck)
    if isinstance(old, dict):
        return old, "last_good"
    if isinstance(hit, dict):
        return hit, "fresh"
    return None, "not_held"


def held_rs() -> tuple[Optional[dict], str]:
    """({SYMBOL: rank}, how) from the RS ranking the server already holds, WITHOUT the rebuild the route can start."""
    from api.services import rs_ranking
    rows, how = rs_ranking.cached_rankings(), "held"
    if not rows:
        rows, how = rs_ranking.snapshot_rankings(), "last_stored"
    if not rows:
        return None, "not_held"
    ranks: dict[str, float] = {}
    for it in rs_ranking.unified_rankings(rows) or []:
        sym = _sym(it.get("ticker")) if isinstance(it, dict) else ""
        rank = _num(it.get("rs_rank")) if isinstance(it, dict) else None
        if sym and rank is not None and sym not in ranks:
            ranks[sym] = rank
    return (ranks, how) if ranks else (None, "not_held")


def held_board() -> tuple[Optional[dict], Optional[float]]:
    """({SYMBOL: {dir, status}}, when the board was built) from the confluence board's cache entry, WITHOUT a build."""
    from api import confluence_screen as svc
    entry = (getattr(svc, "_CACHES", None) or {}).get(int(svc.DAYS)) or {}
    board = entry.get("board")
    if not isinstance(board, dict) or board.get("ok") is not True or not isinstance(board.get("rows"), list):
        return None, None
    out: dict[str, dict] = {}
    for r in board["rows"]:
        sym = _sym(r.get("sym")) if isinstance(r, dict) else ""
        if sym and r.get("dir") in ("BULL", "BEAR") and sym not in out:
            out[sym] = {"dir": r["dir"], "status": r.get("status") if isinstance(r.get("status"), str) else None}
    at = entry.get("at")
    return out, float(at) if isinstance(at, (int, float)) and not isinstance(at, bool) and at > 0 else None


def _sym(v: Any) -> str:
    return str(v or "").strip().upper().replace(".", "-")


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return None
    return float(v)


def _day(v: Any) -> Optional[str]:
    s = str(v or "")
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}" if len(s) == 8 and s.isdigit() else None


def _built(v: Any) -> Optional[str]:
    try:
        at = datetime.fromisoformat(str(v))
    except (TypeError, ValueError):
        return None
    return env.utc_iso(at if at.tzinfo else at.replace(tzinfo=timezone.utc))


def read_group_drill(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    name = params.get("range", DEFAULT_RANGE)
    kind = params.get("kind")
    group = " ".join(params["group"].split()) if params.get("group") else None
    sort = params.get("sort", "pct")
    direction = params.get("dir", "desc")
    limit = params.get("limit", DEFAULT_LIMIT)
    words = RANGE_WORDS[name]
    try:
        from api.services import scan_period as svc
        base, how = held_ranking(name)                      # the held ranking or nothing: never a build
        keep_minutes = int(svc._TTL // 60)
        extra_minutes = int(svc._PERIOD_STALE_S // 60)
    except Exception:  # noqa: BLE001 — a failing service is an honest unavailable, never "no such group"
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if base is None:
        return env.unavailable(KIND, params, SOURCE,
                               NOTE_NOT_HELD.format(range=words, minutes=keep_minutes, extra=extra_minutes))
    if base.get("status") != "ok" or not isinstance(base.get("results"), list):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_READY.format(range=words))
    try:
        answers = {k: svc.period_groups_of(base, k) for k in ((kind,) if kind else GROUP_KINDS)}
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if any(a.get("status") != "ok" or not isinstance(a.get("results"), list) for a in answers.values()):
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)

    start_day, end_day = _day(base.get("start")), _day(base.get("end"))
    built_at = _built(base.get("as_of"))
    span = dict(range=words, start=start_day or "a day not given", end=end_day or "a day not given")
    time_note = NOTE_TIME.format(at=built_at) if built_at else NOTE_NO_TIME
    # unknown is never claimed fresh: a ranking with no build time is stale
    stale = how == "last_good" or built_at is None
    common = {"range": name, "start_day": start_day, "end_day": end_day, "built_at": built_at, "held": how,
              "partial_history": base.get("partial") is True}

    if group is None:                                       # the names a group is resolved against
        lists, counts, notes = {}, {}, [NOTE_LISTS.format(**span), time_note]
        for k, a in answers.items():
            rows = [{"name": str(g["name"]).strip(), "pct": _num(g.get("period_change")),
                     "count": int(g["count"]) if isinstance(g.get("count"), int) and not isinstance(g.get("count"), bool) else None}
                    for g in a["results"] if isinstance(g, dict) and str(g.get("name") or "").strip()]
            counts[k] = len(rows)
            lists[k] = rows[:MAX_GROUPS]
            if not rows:
                notes.append(NOTE_NO_GROUPS.format(kind=KIND_WORDS[k]))
            elif len(rows) > MAX_GROUPS:
                notes.append(NOTE_GROUPS_CUT.format(n=MAX_GROUPS, total=len(rows), kind=KIND_WORDS[k]))
        if how == "last_good":
            notes.append(NOTE_LAST_GOOD.format(minutes=keep_minutes))
        if common["partial_history"]:
            notes.append(NOTE_PARTIAL_HISTORY)
        total = sum(counts.values())
        answered = sum(len(v) for v in lists.values())
        data = {"mode": "groups", **common, "kind": kind, "lists": lists, "counts": counts}
        coverage = {"evaluated": total, "answered": answered, "dropped": total - answered, "not_computable": 0}
        return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=None, source=SOURCE, data=data,
                                 stale=stale, coverage=coverage, notes=notes, provider_calls=0)

    ranked = [g for g in answers[kind]["results"] if isinstance(g, dict)]
    hit = next((g for g in ranked if str(g.get("name") or "").strip() == group), None)
    if hit is None:                                         # a healthy answer: the ranking has no such group
        data = {"mode": "group", **common, "kind": kind, "name": group, "found": False, "group_pct": None, "rows": [],
                "count": 0, "shown": 0, "known": 0, "ranked": 0, "on_board": 0, "sort": sort, "dir": direction,
                "rs_state": None, "flow_state": None, "flow_built_at": None}
        notes = [NOTE_NO_GROUP.format(kind=KIND_WORDS[kind], name=group, n=len(ranked)), time_note]
        return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=None, source=SOURCE, data=data,
                                 stale=stale, coverage={"evaluated": 0, "answered": 0, "dropped": 0, "not_computable": 0},
                                 notes=notes, provider_calls=0)

    try:
        ranks, rs_state = held_rs()                         # the cache or the last stored ranking: never a rebuild
    except Exception:  # noqa: BLE001 — the group was read; the RS ranking was not
        ranks, rs_state = None, "not_held"
    try:
        from api import confluence_screen as board_svc
        board, board_at = held_board()                      # the cache entry: never a build
        board_ttl = float(getattr(board_svc, "_TTL", 1800.0))
    except Exception:  # noqa: BLE001
        board, board_at, board_ttl = None, None, 1800.0
    flow_state = "held" if board is not None else "not_held"

    by_sym = {_sym(r.get("sym")): r for r in base["results"] if isinstance(r, dict) and r.get("sym")}
    rows, seen = [], set()
    for m in hit.get("members") or []:
        sym = _sym(m)
        if not sym or sym in seen:
            continue
        seen.add(sym)
        r = by_sym.get(sym) or {}
        rows.append({"sym": sym, "pct": _num(r.get("period_change")), "start_close": _num(r.get("start_close")),
                     "end_close": _num(r.get("end_close")),
                     "industry": str(r.get("industry") or "").strip() or None,
                     "sector": str(r.get("sector") or "").strip() or None,
                     "rs": ranks.get(sym) if ranks is not None else None,
                     "flow": dict(board[sym]) if board is not None and sym in board else None})
    # the GRP panel's order (groupDrillModel.js sortGroupRows): a stock with no value for the column sinks to the end
    # either way, and a tie keeps the gain order
    sign = -1.0 if direction == "desc" else 1.0
    rows.sort(key=lambda r: (r["pct"] is None, -(r["pct"] or 0.0), r["sym"]))
    rows.sort(key=lambda r: (r[sort] is None, sign * (r[sort] or 0.0)))
    shown = rows[:limit]
    known = sum(1 for r in rows if r["pct"] is not None)

    notes = [NOTE_WHAT.format(kind=KIND_WORDS[kind], name=group, **span), NOTE_GROUP_PCT, time_note, NOTE_RS, NOTE_FLOW]
    if how == "last_good":
        notes.append(NOTE_LAST_GOOD.format(minutes=keep_minutes))
    if common["partial_history"]:
        notes.append(NOTE_PARTIAL_HISTORY)
    if rs_state == "last_stored":
        notes.append(NOTE_RS_LAST_STORED)
    elif rs_state == "not_held":
        notes.append(NOTE_RS_NOT_HELD)
    board_old = board is not None and (board_at is None or (now_s() - board_at) >= board_ttl)
    if flow_state == "not_held":
        notes.append(NOTE_FLOW_NOT_HELD)
    elif board_old:
        notes.append(NOTE_FLOW_OLD.format(minutes=int(board_ttl // 60)))
    if known < len(rows):
        notes.append(NOTE_NO_CHANGE.format(n=len(rows) - known, total=len(rows)))
    if len(rows) > limit:
        notes.append(NOTE_CUT.format(n=limit, total=len(rows), order=SORT_WORDS[(sort, direction)]))
    data = {"mode": "group", **common, "kind": kind, "name": group, "found": True,
            "group_pct": _num(hit.get("period_change")), "rows": shown, "count": len(rows), "shown": len(shown),
            "known": known, "ranked": sum(1 for r in rows if r["rs"] is not None),
            "on_board": sum(1 for r in rows if r["flow"] is not None), "sort": sort, "dir": direction,
            "rs_state": rs_state, "flow_state": flow_state,
            "flow_built_at": env.utc_iso(datetime.fromtimestamp(board_at, tz=timezone.utc)) if board_at else None}
    coverage = {"evaluated": len(rows), "answered": len(shown), "dropped": len(rows) - len(shown),
                "not_computable": len(rows) - known}
    partial = rs_state == "not_held" or flow_state == "not_held"
    return env.make_envelope(KIND, params, status="partial" if partial else "ok", freshness="periodic", as_of=None,
                             source=SOURCE, data=data, stale=stale or rs_state == "last_stored" or board_old,
                             coverage=coverage, notes=notes, provider_calls=0)
