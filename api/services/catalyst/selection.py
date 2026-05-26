"""Forced category-mix selector. Picks top 12 across 4 buckets, then
redistributes empty quotas to next-highest-scored leftovers."""
import os
from collections import defaultdict


_KNOWN_TAGS = ("Catalyst", "Earnings", "Gapper", "News")


def _quota(tag: str, default: int) -> int:
    return int(os.environ.get(f"CATALYST_QUOTA_{tag.upper()}", default))


def select_top_12(scored: list[dict]) -> list[dict]:
    quotas = {
        "Catalyst": _quota("Catalyst", 6),
        "Earnings": _quota("Earnings", 3),
        "Gapper":   _quota("Gapper", 2),
        "News":     _quota("News", 1),
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

    selected.sort(key=lambda c: c.get("score", 0.0), reverse=True)
    return selected
