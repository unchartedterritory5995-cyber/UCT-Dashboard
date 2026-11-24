"""MD-1 kind `groups.rank` (owner: terminal-data, data wave 11) — every sector's or industry's weekly rank, as held.

Each group's place among the groups of its kind by the median 6-month (and 3-month) price change of its stocks: now,
4, 13 and 52 weekly points back with the places moved since, its best and worst week of the year, out of how many groups
and on how many stocks; and the groups that climbed and fell the most places over 4 and 13 weeks. The Agent half of GRPS
RANK and GRP's rank section, over the answer of `GET /api/research/group-stats?kind=…[&name=…]`
(`api/services/group_stats.py`), with the route's own field names (the GRPS panel's model reads them).

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The group figures are worked out once each
evening by ONE background build the scheduler starts (`group_stats.scheduled_refresh`); the route's own reads,
`group_stats.get_group_stats` and `get_group_positioning`, NEVER build: they read what the module holds (in memory, else
its copy on this server's disk, looked for once per process). This adapter calls exactly that read and nothing else: no
build, no refresh, no price read. provider_calls is always 0. A rail shows `group_stats.refresh_if_due` starting the
build in the same state, so the rail can fail.

NOTHING HELD IS SAID, NEVER "NO RANK": before the first evening build (`not_built`) or while it runs (`computing`) the
read is `unavailable` with that reason. A rank part built before the weekly rank existed is `pending`, said; a group with
fewer than five stocks with a change has no place (`position` null, its count kept), never a place of 0.

WHAT IS STATED: every point is the service's own (`group_stats_calc.rank_summary`), passed through; nothing is recomputed
here. The table returns the first `rows` groups by their 6-month rank now (1st first; groups with no rank now after them,
by name), cut from the BOTTOM of the ranking, with the whole count beside them. The movers are the GRPS panel's movers
strip (its `rankMovers`): over each window, the groups ranked at both ends that climbed (fell) the most places, equal
moves by name, at most `MOVERS` each, worked out here over EVERY group of the held table, not only the rows returned. One
group (`name`) returns its points in full and never its weekly line. Each group's weekly line, its fundamentals and its
breadth are left out, and a note says the GRPS panel shows them.

TIME (MD-1 §3): `as_of` = the regular-session close of the newest session the build read (`session`), in UTC; never the
time of the read. When UCT worked it out rides as `data.built_at`. The read is `stale`, with a note, when the build was
for an earlier evening than the newest one whose evening has begun (`group_stats.evening_key`, the service's own key):
this read never works it out again. Every read is `historical`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the rank is worked out from UCT's daily bar store, which holds the
market-data vendor's end-of-day history (docs/terminal-research/09-security-licensing-cost/licensing-register.md, rows
T-04 and T-09: member display of daily history, and its storage) and, before 2003-09-10, yfinance history (row T-71: the
pre-2003 daily tail, class X). No row of that register names the group rank, and no row clears it for a model provider
(row T-14, AI processing of the vendor's numbers, is restricted and names none of it). The same rule as the price
studies of wave 10 and `seasonality.stock`. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole
from api.services.uct_agent.marketdata.stock_stats_read import close_as_of

KIND = "groups.rank"
SOURCE = "uct-group-rank"
GROUP_KINDS = ("sector", "industry")      # group_stats.KINDS (a rail pins the two together)
DEFAULT_KIND = "sector"
DEFAULT_ROWS = 10
MAX_ROWS = 50
MAX_NAME = 80                              # group_stats.MAX_NAME
MOVERS = 5
#: the rank's points, by the service's own names (group_stats_calc.rank_summary)
POINTS = ("now", "w4", "w13", "w52", "best", "worst")
MEASURES = ("m6", "m3")                    # group_stats_calc.RANK_MEASURES, by id
MOVER_WINDOWS = ("w4", "w13")              # the GRPS panel's movers strip (RANK_MOVER_WINDOWS)
#: the rank part's own states (group_stats._rank_part) and what each says
RANK_WORDS = {"pending": "the figures held were worked out before the weekly rank was added; it appears after the next evening build",
              "unavailable": "no stored closes could be read at the last evening build, so there is no weekly rank"}
#: the route's own answers when nothing is held (group_stats.get_group_stats)
HELD_WORDS = {"not_built": "the group figures are worked out once each evening after the close, and the first one has not run on this server yet",
              "computing": "the first evening build of the group figures is running now"}

NOTE_WHAT = ("every {kind}'s weekly rank as UCT worked it out for GRPS, from the stored daily closes of its stocks ({stocks} "
             "stocks in {groups} groups, the map GRPS groups by): its place by the median 6-month and 3-month price change "
             "of its stocks now, 4, 13 and 52 weekly points back with the places moved since, and its best and worst week "
             "of the year. A record of the past, not a forecast and not advice")
NOTE_AS_OF = ("`as_of` is the close of the newest session the evening build read ({day}); it is never the time of the "
              "read. UCT worked it out at {at} (UCT's own time) from closes it already held")
NOTE_NO_SESSION = "`as_of` is null: the evening build held found no session in the closes, so the figures carry no date"
NOTE_OLD = ("UCT worked these out for the evening of {built_for}; a newer evening has begun since ({current}), and this "
            "read never works them out again. The server's next evening build adds it")
NOTE_CUT = ("{total} {many} are held and the first {shown} by their 6-month rank now are returned: the list is cut from "
            "the BOTTOM of the ranking (groups with no rank now come last)")
NOTE_FEW = ("a group needs at least {min} stocks with a change for a place: {n} {many} have fewer now, so they have no "
            "rank (never a rank of 0)")
NOTE_MOVERS = ("the movers are worked out over all {total} {many}: only a group ranked at both ends of a window counts, "
               "equal moves go by name, at most {limit} each way")
NOTE_RANK = "the weekly rank is not stated: {why}. That is not the same as no rank"
NOTE_LAGGING = "the evening build's closes stopped short of that evening, so the newest week may be missing; the server tries again"
NOTE_NOT_FOUND = ("no {kind} named {name!r} is in the held table of {total} {many} (names are matched as GRPS matches "
                  "them: case, spacing and punctuation do not count)")
NOTE_LEFT_OUT = ("each group's weekly line, its fundamentals and its breadth are not in this read: the GRPS panel shows "
                 "them")
NOTE_NOT_HELD = "the group figures are not held on this server yet: {why}. This read never works them out. That is not the same as no rank"
NOTE_FAILED = "the group rank read failed; nothing is stated. That is not the same as no rank"


# ── shared by the two group kinds of this wave (group_rank_read, group_crowding_read) ─────────────────────────────

def check_group_params(params: Any, max_rows: int, default_rows: int) -> Optional[str]:
    """The pure parameter check of a group kind: `kind` (sector | industry), an optional `name`, `rows`."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if params.get("kind", DEFAULT_KIND) not in GROUP_KINDS:
        return "`kind` must be sector or industry"
    name = params.get("name")
    if name is not None and (not isinstance(name, str) or not name.strip() or len(name) > MAX_NAME):
        return f"`name` must be a group's name of at most {MAX_NAME} characters"
    n = params.get("rows", default_rows)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= max_rows:
        return f"`rows` must be a whole number from 1 to {max_rows}"
    return None


def group_kind(params: dict) -> str:
    return params.get("kind", DEFAULT_KIND)


def group_name(params: dict) -> Optional[str]:
    name = params.get("name")
    return " ".join(name.split())[:MAX_NAME] if isinstance(name, str) and name.strip() else None


def many(kind: str, n: int) -> str:
    return ("sector" if n == 1 else "sectors") if kind == "sector" else ("industry" if n == 1 else "industries")


def stale_against(built_for: Optional[str]) -> Optional[str]:
    """The newest evening whose build is due by now (`group_stats.evening_key`, the service's own key; pure: no read),
    when the held answer was built for an earlier one, else None."""
    from api.services import group_stats as GS
    current = GS.evening_key(GS.now_et())
    return current if built_for and built_for < current else None


def held_table(kind: str, name: Optional[str], reader: str) -> tuple[Optional[dict], str]:
    """READ ONLY: (the route's own answer, 'held' | 'computing' | 'not_built'), through the service's own read
    (`group_stats.get_group_stats` or `get_group_positioning`), which never builds."""
    from api.services import group_stats as GS
    got = getattr(GS, reader)(kind, name)
    status = got.get("status") if isinstance(got, dict) else None
    if status == "ok":
        return got, "held"
    return None, status if status in HELD_WORDS else "not_built"


# ── this kind ────────────────────────────────────────────────────────────────────────────────────────────────────

def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_group_params(params, MAX_ROWS, DEFAULT_ROWS)


def held_answer(kind: str, name: Optional[str] = None) -> tuple[Optional[dict], str]:
    """READ ONLY: the held group figures for a kind (or one group), WITHOUT building (`group_stats.get_group_stats`)."""
    return held_table(kind, name, "get_group_stats")


def _point(p: Any) -> Optional[dict]:
    if not isinstance(p, dict):
        return None
    out = {"position": p["position"] if isinstance(p.get("position"), int) and p["position"] > 0 else None,
           "of": _whole(p.get("of")), "n": _whole(p.get("n")), "median": _num(p.get("median")),
           "date": _day(p.get("date"))}
    if "change" in p:
        out["change"] = p["change"] if isinstance(p.get("change"), int) and not isinstance(p.get("change"), bool) else None
    return out


def _rank(r: Any) -> Optional[dict]:
    """A group's rank on both measures, its points only (never its weekly line)."""
    if not isinstance(r, dict):
        return None
    out = {}
    for mid in MEASURES:
        m = r.get(mid) if isinstance(r.get(mid), dict) else {}
        out[mid] = {**{k: _point(m.get(k)) for k in POINTS}, "weeks_ranked": _whole(m.get("weeks_ranked"))}
    return out


def _now_place(g: dict) -> Optional[int]:
    return (((g.get("rank") or {}).get("m6") or {}).get("now") or {}).get("position")


def movers(groups: list, back: str, limit: int = MOVERS) -> dict:
    """The GRPS panel's movers strip over `back` (w4 | w13): {up, down, counted}, each item {name, change, from, to}. Only a
    group ranked at both ends counts; the most places first, equal moves by name."""
    moves = []
    for g in groups:
        m = (g.get("rank") or {}).get("m6") or {}
        frm, to = m.get(back), m.get("now")
        if frm and isinstance(frm.get("change"), int) and to and to.get("position"):
            moves.append({"name": g["name"], "change": frm["change"], "from": frm, "to": to})
    up = sorted((x for x in moves if x["change"] > 0), key=lambda x: (-x["change"], x["name"]))[:limit]
    down = sorted((x for x in moves if x["change"] < 0), key=lambda x: (x["change"], x["name"]))[:limit]
    return {"up": up, "down": down, "counted": len(moves)}


def read_rank(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    kind, name, limit = group_kind(params), group_name(params), params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer(kind, name)
    except Exception:  # noqa: BLE001 — a failing read is unavailable, never a guess
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how != "held":
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(why=HELD_WORDS.get(how, HELD_WORDS["not_built"])))
    try:
        return _answer(params, got, kind, name, limit)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, got: dict, kind: str, name: Optional[str], limit: int) -> dict:
    session, built_at = _day(got.get("session")), _read_at(got.get("built_at"))
    src = (got.get("sources") or {}).get("rank") or {}
    state = src.get("state") if src.get("state") in ("ok", "pending", "unavailable") else "pending"
    universe = got.get("universe") if isinstance(got.get("universe"), dict) else {}
    built_for = _day(got.get("built_for"))
    notes = [NOTE_WHAT.format(kind=kind, stocks=_whole(universe.get("mapped")) or 0,
                              groups=_whole(got.get("count") if name is None else got.get("peers")) or 0)]
    notes.append(NOTE_AS_OF.format(day=session, at=built_at or "a time it does not give") if session else NOTE_NO_SESSION)
    current = stale_against(built_for)
    if current:
        notes.append(NOTE_OLD.format(built_for=built_for, current=current))
    if "prices" in (got.get("lagging") or []):
        notes.append(NOTE_LAGGING)
    rank_part = {"state": state, "weeks": _whole(src.get("weeks")), "min_members": _whole(src.get("min_members")),
                 "measures": [{"id": m.get("id"), "sessions": _whole(m.get("sessions"))} for m in (src.get("measures") or [])
                              if isinstance(m, dict) and m.get("id") in MEASURES],
                 "first_week": _day((src.get("dates") or [None])[0]) if src.get("dates") else None}
    if state != "ok":
        notes.append(NOTE_RANK.format(why=RANK_WORDS[state]))
    data: dict[str, Any] = {"kind": kind, "session": session, "built_for": built_for, "built_at": built_at, "rank": rank_part,
                            "universe": {k: _whole(universe.get(k)) for k in ("symbols", "mapped", "not_mapped")},
                            "stale_for": ["earlier_evening"] if current else [], "left_out": ["weekly_line", "fundamentals", "breadth"]}
    coverage = None
    if name is None:
        rows = [g for g in (got.get("groups") or []) if isinstance(g, dict) and isinstance(g.get("name"), str)]
        groups = [{"name": g["name"][:MAX_NAME], "members": _whole(g.get("members")), "rank": _rank(g.get("rank"))} for g in rows]
        ranked = sorted((g for g in groups if _now_place(g)), key=lambda g: (_now_place(g), g["name"]))
        unranked = sorted((g for g in groups if not _now_place(g)), key=lambda g: g["name"])
        ordered = ranked + unranked
        shown = ordered[:limit] if state == "ok" else []
        data.update({"groups": shown, "groups_total": len(groups), "ranked_now": len(ranked),
                     "movers": {back: movers(groups, back) for back in MOVER_WINDOWS} if state == "ok" else None})
        if state == "ok":
            if len(ordered) > len(shown):
                notes.append(NOTE_CUT.format(total=len(ordered), many=many(kind, len(ordered)), shown=len(shown)))
            few = [g for g in unranked if g["rank"] and g["rank"]["m6"]["now"]]
            if few:
                notes.append(NOTE_FEW.format(min=rank_part["min_members"] or 5, n=len(few), many=many(kind, len(few))))
            notes.append(NOTE_MOVERS.format(total=len(groups), many=many(kind, len(groups)), limit=MOVERS))
        coverage = {"evaluated": len(groups), "answered": len(ranked), "dropped": 0, "not_computable": len(unranked)}
    else:
        found = got.get("found") is True
        data.update({"name": got.get("name") if found else name, "found": found, "peers": _whole(got.get("peers")),
                     "members": _whole(got.get("members")) if found else None,
                     "group_rank": _rank(got.get("rank")) if found and state == "ok" else None})
        if not found:
            notes.append(NOTE_NOT_FOUND.format(kind=kind, name=name, total=_whole(got.get("peers")) or 0,
                                               many=many(kind, _whole(got.get("peers")) or 0)))
    notes.append(NOTE_LEFT_OUT)
    return env.make_envelope(KIND, params, status="ok", freshness="historical", as_of=close_as_of(session), source=SOURCE,
                             data=data, stale=bool(current), coverage=coverage, notes=notes, provider_calls=0)
