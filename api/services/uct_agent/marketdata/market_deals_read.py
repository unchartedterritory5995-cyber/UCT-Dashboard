"""MD-1 kind `market.deals` (owner: terminal-data, data wave 14) — the market's latest deals and index changes, as held.

Two parts, each with its own state, source and read time: the latest announced mergers and acquisitions across the market
(each with its filing day, acquirer, target and SEC filing), and the additions to and removals from the S&P 500, the Nasdaq
100 and the Dow 30 (each with the day, the stock added, the stock removed and the reason given). The Agent half of the bare
MNA and IDXC terminal functions, over the answers of `GET /api/research/mergers` (`api/services/mergers.py`) and
`GET /api/research/index-changes` (`api/services/index_changes.py`), with the routes' own field names. One stock's deals
and index changes are `company.deals`'s.

⛔ ONLY THE ANSWERS THE SERVICES ALREADY HOLD, NEVER A BUILD (MD-1 §5). Both routes answer through their holds' `get()`,
which STARTS the one background build (the latest-deals pages, the three index lists) when nothing is held or a refresh is
due. This adapter reads the holds' `peek()` only (never a build; a hold may read its own copy from this server's disk, as the
holds themselves do). provider_calls is always 0.

NOTHING HELD IS SAID, NEVER "NONE": a part not held says so; both not held is `unavailable`. An index whose list the vendor
did not answer is named with the route's own leg state.

THE CUT IS STATED: at most `rows` per part, newest first; the rest are cut from the OLD end. The latest-deals list says when
its last page was full, so older deals exist than it holds.

TIME (MD-1 §3): `as_of` is null and each part carries its own read time (when UCT read the vendor), never the time of the
read; each row carries its own day. Every read is `periodic`.

MODEL-ISOLATED (ADR-005; when in doubt, isolate): the estimates vendor's lists, which no row of
docs/terminal-research/09-security-licensing-cost/licensing-register.md names for these lists; the nearest rows are T-39
(FMP's index constituents for member display, "R") and T-44 (FMP's numbers into a model, "No AI clause"). The SEC filing
each deal links to is public (row T-83), but the list that found it is the vendor's. No row clears these lists for a model
provider. Shown to the member only; the capability is local-only.
"""
from __future__ import annotations

from typing import Any, Optional

from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata.company_deals_read import INDEX_NAMES, LEG_WORDS
from api.services.uct_agent.marketdata.short_interest import _day, _read_at

KIND = "market.deals"
SOURCE = "uct-market-deals"
DEFAULT_ROWS = 10
MAX_ROWS = 50
PARTS = ("mergers", "index_changes")
INDEXES = ("sp500", "nasdaq100", "dow")             # index_changes.INDEXES, railed equal

NOTE_WHAT = ("the market's latest deals and index changes as UCT holds them for the MNA and IDXC panels: the announced "
             "mergers and acquisitions across the market, with each SEC filing, and the additions to and removals from "
             "the S&P 500, the Nasdaq 100 and the Dow 30. A record of announcements, not advice")
NOTE_AS_OF = ("`as_of` is null: each part carries its own read time (deals: {deals}; index changes: {changes}), and each "
              "row its own day; never the time of the read")
NOTE_CUT = "{part}: {total} are held and the newest {shown} are returned: the list is cut from the OLD end"
NOTE_FEED_CUT = "deals: the last page UCT read was full, so the market has older announced deals than it holds"
NOTE_LEG = "the {index} list is not stated: {why}"
NOTE_PART_NOT_HELD = ("{part} are not held on this server yet, and this read never builds them. Open {code} in UCT, then "
                      "ask again")
NOTE_NOT_HELD = ("the market's latest deals and index changes are not held on this server yet, and this read never builds "
                 "them. That is not the same as none. Open MNA or IDXC in UCT, then ask again")
NOTE_FAILED = "the market deals read failed; nothing is stated. That is not the same as none"


def validate(params: dict) -> Optional[str]:
    """Pure parameter check, run by the gateway BEFORE admission, so a malformed request spends no read."""
    if not isinstance(params, dict):
        return "the request must be an object"
    if params.get("part") is not None and params["part"] not in PARTS:
        return f"`part` must be one of {', '.join(PARTS)}, or null for both"
    if params.get("index") is not None and params["index"] not in INDEXES:
        return f"`index` must be one of {', '.join(INDEXES)}, or null for all three"
    n = params.get("rows", DEFAULT_ROWS)
    if not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= MAX_ROWS:
        return f"`rows` must be a whole number from 1 to {MAX_ROWS}"
    return None


def held_answer() -> tuple[Optional[dict], Optional[dict]]:
    """READ ONLY: (the latest-deals answer held, the index lists held), each None when nothing is held. Never builds."""
    from api.services import index_changes, mergers
    deals = mergers._latest.peek()
    lists = index_changes._held.peek()
    ok_deals = isinstance(deals, dict) and deals.get("status") == "ok" and isinstance(deals.get("deals"), list)
    ok_lists = isinstance(lists, dict) and lists.get("status") == "ok" and isinstance(lists.get("rows"), dict)
    return (deals if ok_deals else None), (lists if ok_lists else None)


def _party(p: Any) -> Optional[dict]:
    if not isinstance(p, dict):
        return None
    return {"sym": p.get("sym") if isinstance(p.get("sym"), str) else None,
            "name": p.get("name") if isinstance(p.get("name"), str) else None}


def _deal(d: Any) -> Optional[dict]:
    if not isinstance(d, dict) or _day(d.get("date")) is None:
        return None
    link = d.get("link") if isinstance(d.get("link"), str) and d["link"].startswith("https://") else None
    return {"date": _day(d["date"]), "acquirer": _party(d.get("acquirer")), "target": _party(d.get("target")), "link": link}


def _change(c: Any) -> Optional[dict]:
    if not isinstance(c, dict) or _day(c.get("date")) is None or c.get("index") not in INDEXES:
        return None
    return {"index": c["index"], "index_name": INDEX_NAMES[c["index"]], "date": _day(c["date"]),
            "added": _party(c.get("added")), "removed": _party(c.get("removed")),
            "reason": c.get("reason") if isinstance(c.get("reason"), str) else None}


def read_market_deals(params: dict, ctx: dict) -> dict:  # noqa: ARG001 — no per-user state
    why = validate(params)
    if why:
        return env.unavailable(KIND, params, SOURCE, why)
    want = (params["part"],) if params.get("part") else PARTS
    index, limit = params.get("index"), params.get("rows", DEFAULT_ROWS)
    try:
        deals, lists = held_answer()
    except Exception:  # noqa: BLE001
        return env.unavailable(KIND, params, SOURCE, NOTE_FAILED)
    held = {"mergers": deals, "index_changes": lists}
    if not any(held[p] is not None for p in want):
        return env.unavailable(KIND, params, SOURCE, NOTE_NOT_HELD)
    notes, data, read = [], {"part": params.get("part"), "index": index}, {}
    for part in PARTS:
        if part not in want:
            data[part] = None
            continue
        got = held[part]
        if got is None:
            data[part] = {"state": "not_held", "rows": [], "count": 0, "total": 0, "cut": False, "read_at": None}
            notes.append(NOTE_PART_NOT_HELD.format(part="The latest deals" if part == "mergers" else "The index changes",
                                                   code="MNA" if part == "mergers" else "IDXC"))
            continue
        read[part] = _read_at(got.get("read_at"))
        if part == "mergers":
            rows = sorted((x for x in (_deal(d) for d in got["deals"]) if x), key=lambda d: d["date"], reverse=True)
            extra = {"feed_cut": got.get("cut") is True}
            if extra["feed_cut"]:
                notes.append(NOTE_FEED_CUT)
        else:
            wanted = (index,) if index else INDEXES
            rows = [x for i in wanted for x in (_change(c) for c in (got["rows"].get(i) or [])) if x]
            rows.sort(key=lambda c: (c["date"], -INDEXES.index(c["index"])), reverse=True)
            legs = {i: ((got.get("indexes") or {}).get(i) or {}).get("state") for i in wanted}
            extra = {"legs": legs}
            for i, st in legs.items():
                if st in LEG_WORDS and st != "none":
                    notes.append(NOTE_LEG.format(index=INDEX_NAMES[i], why=LEG_WORDS[st]))
        shown = rows[:limit]
        if len(rows) > len(shown):
            notes.append(NOTE_CUT.format(part="deals" if part == "mergers" else "index changes", total=len(rows),
                                         shown=len(shown)))
        data[part] = {"state": "held", "rows": shown, "count": len(shown), "total": len(rows),
                      "cut": len(rows) > len(shown), "read_at": read[part], **extra}
    notes = [NOTE_WHAT, NOTE_AS_OF.format(deals=read.get("mergers") or "not read", changes=read.get("index_changes") or "not read"),
             *notes]
    status = "ok" if all(held[p] is not None for p in want) else "partial"
    return env.make_envelope(KIND, params, status=status, freshness="periodic", as_of=None, source=SOURCE, data=data,
                             notes=notes, provider_calls=0)
