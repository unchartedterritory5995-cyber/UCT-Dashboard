"""Today's Study set composer (spec §4.5, §7.1 "Selection", §13.5 P1/P3,
§13.2 T5, §13.9 #2).

compose_today(user_id, bank_query) → a list of 10 item ids:
  1. the 3 DUE SLOTS first (`list_due`: items answered right 3/10/30 days ago,
     vocabulary first, then a stale skill's item);
  2. the other 7 a random mix of the approved bank, weighted ×2 toward skills
     the member is below Practised in and ×2 toward items they have missed;
  3. a TYPE MIX target when the bank allows it (1 regime, 2-3 chart, 1 size,
     1 recall) — filled first, then the rest at random;
  4. never the same item twice; never two chart items back to back (T5: one
     StockChart per session, a chart swap costs a paint).

Every data read is injectable so the policy is testable with literals:
`bank_query()` returns candidate rows `{id, type, skill_id, difficulty,
has_chart}`; `due_fn`, `missed_fn`, `weak_fn` default to the store.
"""
from __future__ import annotations

import random
from typing import Callable, Iterable, Optional

from api.services import study_store

SET_SIZE = 10
DUE_SLOTS = 3
WEAK_SKILL_WEIGHT = 2.0
MISSED_WEIGHT = 2.0
#: (type, minimum, maximum) — the §4.5 mix. "chart" counts any item with bars;
#: recall is the unbounded filler (None), the others are capped so a set of
#: ten is never half regime calls and the chart cap keeps "no two charts back
#: to back" satisfiable.
TYPE_MIX = (("regime", 1, 1), ("chart", 2, 3), ("size", 1, 1), ("recall", 1, None))


def _bucket(row: dict) -> str:
    if row.get("has_chart"):
        return "chart"
    return str(row.get("type") or "")


def _weight(row: dict, weak: set, missed: set) -> float:
    w = 1.0
    if row.get("skill_id") in weak:
        w *= WEAK_SKILL_WEIGHT
    if row.get("id") in missed:
        w *= MISSED_WEIGHT
    return w


def _pick_weighted(rows: list, weak: set, missed: set, rng: random.Random) -> Optional[dict]:
    if not rows:
        return None
    weights = [_weight(r, weak, missed) for r in rows]
    return rng.choices(rows, weights=weights, k=1)[0]


def arrange_no_adjacent_charts(rows: list) -> list:
    """Reorder so no two chart items sit back to back, keeping the given
    order as much as possible (a stable greedy pass). When charts outnumber
    the gaps, the leftover charts land at the end — the caller caps the mix
    so that cannot happen for a daily set."""
    out: list = []
    pending = list(rows)
    while pending:
        placed = False
        for i, r in enumerate(pending):
            if out and out[-1].get("has_chart") and r.get("has_chart"):
                continue
            out.append(pending.pop(i))
            placed = True
            break
        if not placed:
            out.append(pending.pop(0))
    return out


def compose_today(user_id: str, bank_query: Callable[[], Iterable[dict]], *,
                  n: int = SET_SIZE, due_slots: int = DUE_SLOTS,
                  due_fn: Optional[Callable[[str, int], list]] = None,
                  missed_fn: Optional[Callable[[str], set]] = None,
                  weak_fn: Optional[Callable[[str], set]] = None,
                  rng: Optional[random.Random] = None) -> list[str]:
    """See the module docstring. Returns item ids in play order."""
    rng = rng or random.Random()
    due_fn = due_fn or study_store.list_due
    missed_fn = missed_fn or study_store.missed_item_ids
    weak_fn = weak_fn or study_store.weak_skill_ids

    bank = [dict(r) for r in (bank_query() or []) if r.get("id")]
    by_id = {r["id"]: r for r in bank}
    chosen: list[dict] = []
    seen: set = set()

    # 1. due slots
    for r in (due_fn(user_id, due_slots) or [])[:due_slots]:
        rid = r.get("id")
        if rid and rid not in seen:
            row = dict(by_id.get(rid) or r)
            row.setdefault("has_chart", False)
            chosen.append(row)
            seen.add(rid)

    weak = set(weak_fn(user_id) or ())
    missed = set(missed_fn(user_id) or ())
    pool = [r for r in bank if r["id"] not in seen]

    def take(row: dict) -> None:
        chosen.append(row)
        seen.add(row["id"])
        pool.remove(row)

    # 2. type mix minimums (counting what the due slots already supplied)
    counts: dict = {}
    for r in chosen:
        counts[_bucket(r)] = counts.get(_bucket(r), 0) + 1
    for bucket, lo, _hi in TYPE_MIX:
        while counts.get(bucket, 0) < lo and len(chosen) < n:
            cands = [r for r in pool if _bucket(r) == bucket]
            pick = _pick_weighted(cands, weak, missed, rng)
            if pick is None:
                break
            take(pick)
            counts[bucket] = counts.get(bucket, 0) + 1

    # 3. fill the rest at random, respecting the mix maximums
    maxima = {bucket: hi for bucket, _lo, hi in TYPE_MIX if hi is not None}
    while len(chosen) < n and pool:
        cands = [r for r in pool if counts.get(_bucket(r), 0) < maxima.get(_bucket(r), n)]
        if not cands:
            cands = pool
        pick = _pick_weighted(cands, weak, missed, rng)
        if pick is None:
            break
        take(pick)
        counts[_bucket(pick)] = counts.get(_bucket(pick), 0) + 1

    # 4. due first, then the mix, then no two charts back to back
    ordered = arrange_no_adjacent_charts(chosen)
    return [r["id"] for r in ordered]
