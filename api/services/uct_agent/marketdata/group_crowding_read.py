"""MD-1 kind `groups.crowding` (owner: terminal-data, data wave 11) — positioning by sector or industry, as held.

Per group: short interest (the median percent of float, days to cover and change in shares short, each with how many
members it rests on, and the most shorted members), insider buying (the members with an open-market purchase, the
purchases, their dollars and the largest), and fund holdings (the share of members more funds added than cut, and the
median net change); each part's state, source and date; one group's members with their own figures. The Agent half of
GRPS CROWDING, over the answer of `GET /api/research/group-stats?kind=…&part=positioning[&name=…]`
(`group_stats.get_group_positioning` over `api/services/group_positioning.py`), with the route's own field names.

⛔ ONLY THE ANSWER THE SERVICE ALREADY HOLDS, NEVER A BUILD (MD-1 §5). The positioning is worked out inside GRPS's one
evening build, which reads the three stores once each; the route's read `group_stats.get_group_positioning` NEVER builds
and never reads a store. This adapter calls exactly that read: no build, no store read, no vendor. provider_calls is
always 0.

NOTHING HELD IS SAID, NEVER "NOT CROWDED": before the first evening build, or while it runs, the read is `unavailable`
with that reason. A part whose store could not be read (or was not read yet) says so in its own state, and its figures
are null for every group, never 0. The institutions part (13F) is not built by the service and is left out, said.

WHAT IS STATED: every figure is the service's own (`group_positioning.short_block`, `insider_block`, `funds_block`),
passed through; a figure resting on fewer than five members is null with its count kept. The table returns the first
`rows` groups by the median percent of float, highest first (the builder's default order; groups with no figure after
them, by name), cut from the LOW end, with the whole count beside them. One group (`name`) returns its members, the most
shorted first (the service's order), cut to `rows` from the least shorted end.

TIME (MD-1 §3): `as_of` is null: each part carries its own date (short interest its FINRA settlement date, insider buying
its filing window, funds their N-PORT report periods); when UCT worked it out rides as `data.built_at`, never the time
of the read. Stale, with a note, when the evening build was for an earlier evening, on `groups.rank`'s rule. Every read
is `periodic`; the kind is DECLARED `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the short interest is FINRA's, licensed through the market-data vendor
for display to members (docs/terminal-research/09-security-licensing-cost/licensing-register.md, row T-93), its percent
of float divides by the float the screener shows (row T-48); the insider purchases come from the SEC's Form 4 filings
(row T-99: "Nothing else reads it yet (no AI lane, no export, no external publication)"); the fund holdings from the SEC's
Form N-PORT data sets (row T-104, the same words). No row of that register clears any of them for a model provider. The
same rule as `short.list` and `ownership.funds`. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.group_rank_read import (HELD_WORDS, MAX_NAME, check_group_params, group_kind,
                                                               group_name, held_table, many, stale_against)
from api.services.uct_agent.marketdata.short_interest import _day, _num, _read_at, _whole
from api.services.uct_agent.marketdata.stock_stats_read import tree

KIND = "groups.crowding"
SOURCE = "uct-group-positioning"
DEFAULT_ROWS = 10
MAX_ROWS = 50
PARTS = ("short", "insider", "funds")         # group_positioning.PART_NAMES less the institutions (a rail pins it)
#: one member's own figures, by the service's own names (group_positioning.STOCK_FIELDS)
MEMBER_FIELDS = ("short_interest", "pct_float", "days_to_cover", "short_change_pct", "buys", "buy_value", "buy_unpriced",
                 "last_buy", "funds", "funds_added", "funds_cut", "fund_net_pct")
#: a part's own states (group_positioning.read_short / read_insider / read_nport, `_safe`, `failed`, `parts_view`)
PART_WORDS = {"not_held": "the server had not read that store yet at the last evening build",
              "not_built": "the server had not built that index yet at the last evening build",
              "unavailable": "the source did not answer for it at the last evening build",
              "failed": "that store could not be read at the last evening build",
              "pending": "the figures held were worked out before positioning was added; it appears after the next evening build"}
PART_NAMES = {"short": "short interest", "insider": "insider buying", "funds": "fund holdings"}

NOTE_WHAT = ("every {kind}'s positioning as UCT worked it out for GRPS CROWDING, from three stores this server holds, each "
             "read once by the evening build: FINRA's short interest report, the open-market purchases in the SEC Form 4 "
             "filings UCT reads, and the SEC's Form N-PORT fund holdings, rolled up by the map GRPS groups by ({groups} "
             "groups). Filings and reports, not advice")
NOTE_AS_OF = ("`as_of` is null: each part carries its own date (short interest its FINRA settlement date, insider buying "
              "its filing window, funds their report periods). UCT worked it out at {at} (UCT's own time), and this read "
              "never works it out again")
NOTE_OLD = ("UCT worked these out at the evening build for {built_for}; a newer evening has begun since ({current}), and "
            "this read never works them out again")
NOTE_PART = "{part} is not stated: {why}. That is not the same as none"
NOTE_INSIDER_SALES = ("insider buying is open-market purchases only, filed {start} to {end}: the server keeps no insider "
                      "sales, so there is no sales total or net")
NOTE_ORDER = ("the groups are ordered by the median percent of float, highest first (the builder's default order; a group "
              "with fewer than {min} members in the report has no figure and comes after them, by name)")
NOTE_CUT = "{total} {many} are held and the first {shown} are returned: the list is cut from the LOW end"
NOTE_MEMBERS_CUT = ("{total} members are held and the {shown} most shorted are returned: the list is cut from the least "
                    "shorted end (a member with no percent of float last)")
NOTE_NOT_FOUND = ("no {kind} named {name!r} is in the held table of {total} {many} (names are matched as GRPS matches "
                  "them: case, spacing and punctuation do not count)")
NOTE_LEFT_OUT = ("institutions (13F) are not in this read: the server keeps no store of the whole market's 13F holdings "
                 "to roll up. Each group's rank, fundamentals and breadth are not in it either: the GRPS panel shows them")
NOTE_NOT_HELD = "group positioning is not held on this server yet: {why}. This read never works it out. That is not the same as no crowding"
NOTE_FAILED = "the group positioning read failed; nothing is stated. That is not the same as no crowding"

def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    return check_group_params(params, MAX_ROWS, DEFAULT_ROWS)


def held_answer(kind: str, name: Optional[str] = None) -> tuple[Optional[dict], str]:
    """READ ONLY: the held positioning for a kind (or one group), WITHOUT building or reading a store
    (`group_stats.get_group_positioning`)."""
    return held_table(kind, name, "get_group_positioning")


def _parts(src: Any) -> dict:
    """Each part's state, source, date and reach (group_positioning.parts_view), the institutions left out."""
    src = src if isinstance(src, dict) else {}
    out = {}
    for p in PARTS:
        raw = src.get(p) if isinstance(src.get(p), dict) else {"state": "pending" if src.get("state") != "ok" else "failed"}
        out[p] = {k: tree(v) for k, v in raw.items() if k != "reason"}
        if out[p].get("state") not in ("ok", *PART_WORDS):
            out[p]["state"] = "failed"
    return out


def _pctf(g: dict) -> Optional[float]:
    return _num(((((g.get("positioning") or {}).get("short") or {}).get("pct_float")) or {}).get("median"))


def read_crowding(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    kind, name, limit = group_kind(params), group_name(params), params.get("rows", DEFAULT_ROWS)
    try:
        got, how = held_answer(kind, name)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    if how != "held":
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD.format(why=HELD_WORDS.get(how, HELD_WORDS["not_built"])))
    try:
        return _answer(params, got, kind, name, limit)
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)


def _answer(params: dict, got: dict, kind: str, name: Optional[str], limit: int) -> dict:
    built_at, built_for = _read_at(got.get("built_at")), _day(got.get("built_for"))
    src = (got.get("sources") or {}).get("positioning") or {}
    parts = _parts(src)
    min_members = _whole(src.get("min_members")) or 5
    total = _whole(got.get("count") if name is None else got.get("peers")) or 0
    notes = [NOTE_WHAT.format(kind=kind, groups=total), NOTE_AS_OF.format(at=built_at or "a time it does not give")]
    current = stale_against(built_for)
    if current:
        notes.append(NOTE_OLD.format(built_for=built_for, current=current))
    for p in PARTS:
        if parts[p]["state"] != "ok":
            notes.append(NOTE_PART.format(part=PART_NAMES[p].capitalize(), why=PART_WORDS[parts[p]["state"]]))
    if parts["insider"]["state"] == "ok":
        notes.append(NOTE_INSIDER_SALES.format(start=_day(parts["insider"].get("from")) or "a day it does not give",
                                               end=_day(parts["insider"].get("to")) or "a day it does not give"))
    data: dict[str, Any] = {"kind": kind, "built_for": built_for, "built_at": built_at, "session": _day(got.get("session")),
                            "parts": parts, "min_members": min_members, "top_n": _whole(src.get("top_n")),
                            "institutions": "not_held", "stale_for": ["earlier_evening"] if current else [],
                            "left_out": ["institutions", "rank", "fundamentals", "breadth"]}
    coverage = None
    if name is None:
        rows = [g for g in (got.get("groups") or []) if isinstance(g, dict) and isinstance(g.get("name"), str)]
        groups = [{"name": g["name"][:MAX_NAME], "members": _whole(g.get("members")), "positioning": tree(g.get("positioning"))}
                  for g in rows]
        have = sorted((g for g in groups if _pctf(g) is not None), key=lambda g: (-_pctf(g), g["name"]))
        rest = sorted((g for g in groups if _pctf(g) is None), key=lambda g: g["name"])
        shown = (have + rest)[:limit]
        data.update({"groups": shown, "groups_total": len(groups), "with_figure": len(have)})
        notes.append(NOTE_ORDER.format(min=min_members))
        if len(groups) > len(shown):
            notes.append(NOTE_CUT.format(total=len(groups), many=many(kind, len(groups)), shown=len(shown)))
        coverage = {"evaluated": len(groups), "answered": len(have), "dropped": 0, "not_computable": len(rest)}
    else:
        found = got.get("found") is True
        members = [{"sym": str(r.get("sym"))[:12], **{f: tree(r.get(f)) for f in MEMBER_FIELDS}}
                   for r in (got.get("member_rows") or []) if isinstance(r, dict) and r.get("sym")] if found else []
        held = _whole(got.get("member_total")) or len(members)
        data.update({"name": got.get("name") if found else name, "found": found, "peers": _whole(got.get("peers")),
                     "members": _whole(got.get("members")) if found else None,
                     "positioning": tree(got.get("positioning")) if found else None,
                     "member_rows": members[:limit], "member_total": held if found else None})
        if not found:
            notes.append(NOTE_NOT_FOUND.format(kind=kind, name=name, total=total, many=many(kind, total)))
        elif held > len(members[:limit]):
            notes.append(NOTE_MEMBERS_CUT.format(total=held, shown=len(members[:limit])))
    notes.append(NOTE_LEFT_OUT)
    return env.make_envelope(KIND, params, status="ok", freshness="periodic", as_of=None, source=SOURCE, data=data,
                             stale=bool(current), coverage=coverage, notes=notes, provider_calls=0)
