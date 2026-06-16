"""Forced category-mix selector. Picks top 12 across 4 buckets, then
redistributes empty quotas to next-highest-scored leftovers."""
import os
from collections import defaultdict


_KNOWN_TAGS = ("Catalyst", "Earnings", "Gapper", "News")


def _quota(tag: str, default: int) -> int:
    return int(os.environ.get(f"CATALYST_QUOTA_{tag.upper()}", default))


def select_top_12(scored: list[dict]) -> list[dict]:
    # NOTE: function name kept for backwards compat — actual total is the sum
    # of quotas (now 20 by default; was 12). Quotas are env-overridable.
    quotas = {
        "Catalyst": _quota("Catalyst", 10),
        "Earnings": _quota("Earnings", 5),
        "Gapper":   _quota("Gapper", 3),
        "News":     _quota("News", 2),
    }
    total = sum(quotas.values())

    # Bucket scored candidates by tag (drop unknown tags entirely)
    buckets = defaultdict(list)
    for c in scored:
        if c.get("tag") in _KNOWN_TAGS:
            buckets[c["tag"]].append(c)
    for k in buckets:
        buckets[k].sort(key=lambda c: c.get("score", 0.0), reverse=True)

    # Pull quota from each bucket
    selected: list[dict] = []
    for tag, n in quotas.items():
        selected.extend(buckets[tag][:n])

    # Redistribute unfilled slots to next-highest leftovers (any tag)
    if len(selected) < total:
        chosen_ids = {id(c) for c in selected}
        leftovers = sorted(
            [c for c in scored
             if c.get("tag") in _KNOWN_TAGS and id(c) not in chosen_ids],
            key=lambda c: c.get("score", 0.0),
            reverse=True,
        )
        selected.extend(leftovers[: total - len(selected)])

    # Min-analyst reserve: guarantee a few analyst-driven rows survive even when
    # higher-scored pure movers fill the quotas. Never backfills junk — only
    # promotes analyst rows that already passed the gates + tagging.
    min_analyst = int(os.environ.get("CATALYST_MIN_ANALYST_ROWS", "2"))
    if min_analyst > 0:
        chosen_ids = {id(c) for c in selected}
        have = sum(1 for c in selected if c.get("analyst_meta"))
        if have < min_analyst:
            extra = sorted(
                [c for c in scored
                 if c.get("analyst_meta") and id(c) not in chosen_ids],
                key=lambda c: c.get("score", 0.0), reverse=True,
            )[: (min_analyst - have)]
            # Swap out the lowest-scored NON-analyst rows to make room.
            if extra:
                non_analyst = sorted(
                    [c for c in selected if not c.get("analyst_meta")],
                    key=lambda c: c.get("score", 0.0),
                )
                for new_row in extra:
                    if non_analyst:
                        drop = non_analyst.pop(0)
                        selected = [c for c in selected if id(c) != id(drop)]
                    selected.append(new_row)

    selected.sort(key=lambda c: c.get("score", 0.0), reverse=True)
    return selected
