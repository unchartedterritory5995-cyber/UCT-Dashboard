"""Index additions and removals for the Terminal's IDXC screen: the S&P 500, the Nasdaq 100 and the Dow,
newest first, and one stock's own index history.

    get_changes(index, sym=None) -> the body of GET /api/research/index-changes?index=&sym=
      status   'ok' | 'computing' | 'failed'
      failed:  reason 'source' (none of the three reads answered)
      ok:      index ('all' | 'sp500' | 'nasdaq100' | 'dow'), sym (or None), read_at, source, check,
               indexes {sp500, nasdaq100, dow}: each {state ('ok' | 'none' | 'not_in_plan' |
                   'not_configured' | 'rate_limited' | 'failed'), http_status, count (rows held), dropped}
               changes [{index, date (YYYY-MM-DD), added {sym, name, covered} | None,
                         removed {sym, name, covered} | None, reason}]  newest first
               total (rows that match, before the cap), cut (True when more matched than SHOWN_CAP: the
               OLDEST are left out)

THE SOURCE is Financial Modeling Prep, through the one adapter (`fmp_client`), three typed functions:
`get_historical_sp500_constituents`, `get_historical_nasdaq_constituents`,
`get_historical_dowjones_constituents` (`/stable/historical-sp500-constituent`,
`/stable/historical-nasdaq-constituent`, `/stable/historical-dowjones-constituent`). The repo called no
historical-constituent endpoint before (`index_rebalance_calendar.py` says so); the paths are FMP's stable
docs' own, read 2026-11-21 as a web search indexes them (the docs site refuses automated reading).
Licence: the adapter stamps `data_class="constituents"`, the same unregistered class (so "U") today's
member lists (`index_constituents.py`) already read.

FIELDS READ, NOT CONFIRMED AGAINST A LIVE ANSWER (the docs' sample, as indexed): `symbol` (the stock
added), `addedSecurity` (its name), `removedTicker`, `removedSecurity`, `reason`, `dateAdded` (the change
date as words, "June 23, 2025") and `date`. The DATE is `dateAdded` read as a date when it can be (one
third-party write-up found `date` to be a snapshot date, the same on every row), else `date`. Every other
field is dropped. A row without a date, or with neither an added nor a removed symbol, is skipped and
counted; exact repeats are kept once.

IT NEVER ASKS THE PROVIDER ON A MEMBER'S REQUEST. The three lists are held in this module (and on this
server's disk) through `held_build.HeldBuild`: one background build makes the three reads; a request with
nothing held waits a few seconds and is otherwise told `computing`. A refresh is due once a day
(`TTL_S`; index changes are announced days ahead and happen a few times a year), or after `RETRY_S` when a
read failed; a build where all three fail is held for `RETRY_S`. One stock's history is read out of the
held lists: it never costs a vendor read of its own.
"""
from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any, Optional

from api.services import held_build
from api.services import held_reads
from api.services.held_reads import fmp_leg

SOURCE = "Financial Modeling Prep"
DISK_VERSION = 1
INDEXES = ("sp500", "nasdaq100", "dow")
INDEX_NAMES = {"sp500": "S&P 500", "nasdaq100": "Nasdaq 100", "dow": "Dow 30"}
SHOWN_CAP = 300
TTL_S = 24 * 3600
RETRY_S = 300
_ISO_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}")
_FAILED = ("failed", "rate_limited")


def _text(v: Any) -> Optional[str]:
    s = str(v).strip() if v is not None else ""
    return s or None


def _sym(v: Any) -> Optional[str]:
    s = (_text(v) or "").upper()
    return s if re.fullmatch(r"[A-Z0-9][A-Z0-9.\-]{0,11}", s) else None


def change_date(row: dict) -> Optional[str]:
    """`dateAdded` as a date ("June 23, 2025" or YYYY-MM-DD), else `date`; None when neither reads."""
    words = _text(row.get("dateAdded"))
    if words:
        if _ISO_DAY.match(words):
            return words[:10]
        for fmt in ("%B %d, %Y", "%b %d, %Y", "%B %d %Y"):
            try:
                return datetime.strptime(words, fmt).date().isoformat()
            except ValueError:
                continue
    raw = _text(row.get("date")) or ""
    return raw[:10] if _ISO_DAY.match(raw) else None


def shape_changes(raw: Any, index: str, followed: frozenset) -> tuple[list[dict], int]:
    """One index's rows -> changes newest first, and how many were skipped."""
    out, seen, dropped = [], set(), 0
    for r in raw if isinstance(raw, list) else []:
        if not isinstance(r, dict):
            dropped += 1
            continue
        day = change_date(r)
        added_sym, removed_sym = _sym(r.get("symbol")), _sym(r.get("removedTicker"))
        if not day or not (added_sym or removed_sym):
            dropped += 1
            continue
        added = {"sym": added_sym, "name": _text(r.get("addedSecurity")), "covered": added_sym in followed} if added_sym else None
        removed = ({"sym": removed_sym, "name": _text(r.get("removedSecurity")), "covered": removed_sym in followed}
                   if removed_sym else None)
        key = (day, added_sym, removed_sym)
        if key in seen:
            continue
        seen.add(key)
        out.append({"index": index, "date": day, "added": added, "removed": removed, "reason": _text(r.get("reason"))})
    out.sort(key=lambda c: (c["date"], (c["added"] or {}).get("sym") or ""), reverse=True)
    return out, dropped


def build(_previous: Optional[dict] = None) -> tuple[dict, str]:
    """ONE build: the three reads."""
    from api.services import fmp_client as fc

    fns = {"sp500": fc.get_historical_sp500_constituents, "nasdaq100": fc.get_historical_nasdaq_constituents,
           "dow": fc.get_historical_dowjones_constituents}
    followed = held_reads.site_universe()
    legs, rows = {}, {}
    for idx in INDEXES:
        state, value, status = fmp_leg(fns[idx])
        changes, dropped = shape_changes(value, idx, followed) if state == "ok" else ([], 0)
        if state == "ok" and not changes:
            state = "none"
        legs[idx] = {"state": state, "http_status": status, "count": len(changes), "dropped": dropped}
        rows[idx] = changes
    if all(legs[i]["state"] in _FAILED for i in INDEXES):
        raise held_build.Stop("failed", "source", hold=RETRY_S, note="fmp historical constituents failed (all three)")
    answer = {"status": "ok", "v": DISK_VERSION, "read_at": held_build.now_iso(), "source": SOURCE, "indexes": legs, "rows": rows}
    note = "fmp historical constituents " + " ".join(f"{i}={legs[i]['state']}:{legs[i]['count']}" for i in INDEXES)
    return answer, note


def refresh_due(answer: dict, checked: float, now: Optional[float] = None) -> bool:
    legs = ((answer or {}).get("indexes") or {}).values()
    ttl = RETRY_S if any((leg or {}).get("state") in _FAILED for leg in legs) else TTL_S
    return ((time.time() if now is None else now) - float(checked or 0)) >= ttl


def _valid(held: dict) -> bool:
    return (held.get("status") == "ok" and held.get("v") == DISK_VERSION and isinstance(held.get("indexes"), dict)
            and isinstance(held.get("rows"), dict))


_held = held_build.HeldBuild("index-changes", build, lambda a, c: refresh_due(a, c),
                             disk=("index_changes", f"index_changes_v{DISK_VERSION}.json"), version=DISK_VERSION, valid=_valid)


def get_changes(index: str = "all", sym: Optional[str] = None, *, wait_s: Optional[float] = None) -> dict:
    """The route's body. Never builds on the caller's thread. `sym` is an already-checked ticker."""
    idx = index if index in INDEXES else "all"
    got = _held.get(wait_s=wait_s)
    if got.get("status") != "ok":
        return {**got, "index": idx, "sym": sym, "source": SOURCE}
    wanted = INDEXES if idx == "all" else (idx,)
    rows = [c for i in wanted for c in (got.get("rows") or {}).get(i) or []]
    if sym:
        rows = [c for c in rows if (c.get("added") or {}).get("sym") == sym or (c.get("removed") or {}).get("sym") == sym]
    rows.sort(key=lambda c: (c["date"], INDEXES.index(c["index"]) * -1), reverse=True)
    return {"status": "ok", "index": idx, "sym": sym, "read_at": got.get("read_at"), "source": SOURCE,
            "check": got.get("check"), "indexes": got.get("indexes"), "total": len(rows),
            "cut": len(rows) > SHOWN_CAP, "changes": rows[:SHOWN_CAP]}


def reset_for_tests() -> None:
    _held.reset()
