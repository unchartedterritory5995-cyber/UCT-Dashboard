"""D-7 -- a coarse importance label on company-news stories (Lane R).

High / Normal / Low, from features the store already holds about each story,
never a model and never a hidden score. Every label carries the rule(s) that
set it, in words, and the payload publishes the whole rule table, so a member
can see exactly why a story is High and another is Low (the Benzinga pattern:
a coarse ladder a person can read; the Bloomberg warning: an unexplained
formula reads as a bug).

Inputs, all already on the row or one indexed read away:
  category       the store's own restrained category (filters.categorize)
  source_class   primary / wire / journalism / social
  relevance      direct / related (the ticker is the subject vs is in it)
  outlets        how many DISTINCT outlets the store holds for the same event
                 (event_key clusters across sources; a story with no cluster
                 counts as 1)

It is a label about the STORY, not a prediction about the stock.

DARK behind NEWS_IMPORTANCE_LABEL_ENABLED (read per call).
"""
from __future__ import annotations

import contextlib
import os
from typing import Any

ENABLED_ENV = "NEWS_IMPORTANCE_LABEL_ENABLED"

HIGH_CATEGORIES = frozenset({"earnings", "guidance", "m&a", "regulatory"})
LOW_CATEGORIES = frozenset({"other", "social", "product"})
WIDE_COVERAGE = 3   # distinct outlets on one event

RULES = [
    {"label": "high", "rule": f"Category is one of {', '.join(sorted(HIGH_CATEGORIES))}, and the ticker is the story's subject"},
    {"label": "high", "rule": f"{WIDE_COVERAGE} or more distinct outlets reported the same event"},
    {"label": "low", "rule": "The ticker is only related to the story, not its subject"},
    {"label": "low", "rule": f"Category is one of {', '.join(sorted(LOW_CATEGORIES))} and only one outlet reported it"},
    {"label": "normal", "rule": "Everything else"},
]


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def classify(row: dict[str, Any], outlets: int) -> dict[str, Any]:
    """{label, reasons[]} for one stored story. High beats Low beats Normal;
    every matching rule is listed, not just the first."""
    cat = (row.get("category") or "other").lower()
    rel = (row.get("rel") or row.get("relevance") or "").lower()
    outlets = max(1, int(outlets or 1))
    high, low = [], []
    if cat in HIGH_CATEGORIES and rel == "direct":
        high.append(f"{cat} story about this ticker")
    if outlets >= WIDE_COVERAGE:
        high.append(f"reported by {outlets} outlets")
    if rel == "related":
        low.append("this ticker is related, not the subject")
    if cat in LOW_CATEGORIES and outlets <= 1:
        low.append(f"{cat} story from a single outlet")
    if high:
        return {"label": "high", "reasons": high, "outlets": outlets}
    if low:
        return {"label": "low", "reasons": low, "outlets": outlets}
    return {"label": "normal", "reasons": [f"{cat} story, {outlets} outlet{'s' if outlets != 1 else ''}"],
            "outlets": outlets}


def outlet_counts(event_keys: list[str]) -> dict[str, int]:
    """Distinct outlets the store holds per event key (one indexed read)."""
    keys = sorted({k for k in event_keys if k})
    if not keys:
        return {}
    from api.services.news import store
    store._ensure_init()  # noqa: SLF001
    marks = ",".join("?" for _ in keys)
    with contextlib.closing(store._connect()) as c:  # noqa: SLF001
        rows = c.execute(
            f"SELECT event_key, COUNT(DISTINCT source_display) FROM news_items "
            f"WHERE event_key IN ({marks}) AND reject_reason='' GROUP BY event_key",
            keys).fetchall()
    return {r[0]: int(r[1]) for r in rows}
