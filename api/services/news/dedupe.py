"""Deduplication and event clustering.

Four tests, cheapest first, each conclusive on its own:

  1. (provider, provider_id)  -- an update in place, never a second row
  2. canonical URL            -- the same article reached by two paths
  3. normalized headline      -- byte-identical after folding
  4. title shingling          -- the same wire copy re-headlined, within a
                                time window and sharing at least one ticker

Survivors of 1-3 are DUPLICATES. Items that only match on 4 are RELATED
COVERAGE: the same event reported independently. That distinction matters --
§9 is explicit that genuinely distinct reporting must not be hidden. Related
items join one `event_key` and the highest-trust source wins the feed slot;
the rest stay queryable for the expanded view.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timedelta

from api.services.news import sources as news_sources

_WS = re.compile(r"\s+")
_NOISE = re.compile(r"[^\w\s]+")

_STOP = frozenset({
    "the", "a", "an", "and", "or", "of", "in", "on", "for", "to", "as", "at",
    "by", "with", "from", "is", "are", "was", "were", "be", "been", "its",
    "it", "s", "after", "amid", "over", "into", "this", "that", "than", "up",
    "down", "new", "says", "said", "will", "has", "have", "had", "but", "not",
    "inc", "corp", "co", "ltd", "plc", "announces", "announced", "reports",
})

# Two stories about the same event, published this far apart, still cluster.
CLUSTER_WINDOW = timedelta(hours=12)
SHINGLE_THRESHOLD = 0.62


def normalize_headline(title: str) -> str:
    """Fold a headline for exact-match comparison."""
    s = _NOISE.sub(" ", (title or "").lower())
    return _WS.sub(" ", s).strip()


def headline_key(title: str) -> str:
    n = normalize_headline(title)
    return hashlib.sha1(n.encode("utf-8")).hexdigest() if n else ""


def shingles(title: str, n: int = 3) -> frozenset[str]:
    words = [w for w in normalize_headline(title).split(" ")
             if w and w not in _STOP]
    if len(words) < n:
        return frozenset({" ".join(words)}) if words else frozenset()
    return frozenset(" ".join(words[i:i + n]) for i in range(len(words) - n + 1))


def similarity(a: str, b: str) -> float:
    sa, sb = shingles(a), shingles(b)
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def same_event(a_title: str, a_time: datetime | None, a_tickers: set[str],
               b_title: str, b_time: datetime | None, b_tickers: set[str]) -> bool:
    """Do these two items describe one event?"""
    if a_time and b_time and abs(a_time - b_time) > CLUSTER_WINDOW:
        return False
    if a_tickers and b_tickers and not (a_tickers & b_tickers):
        return False
    return similarity(a_title, b_title) >= SHINGLE_THRESHOLD


def event_key(title: str, published_at: datetime | None, tickers: set[str]) -> str:
    """A stable-ish clustering key.

    Deliberately coarse: the day plus the first ticker plus the strongest
    shingle. Items that collide here are then confirmed with `same_event`
    before being merged, so a coarse key costs a comparison, never a wrong
    merge.
    """
    day = published_at.date().isoformat() if published_at else "na"
    tick = sorted(tickers)[0] if tickers else "na"
    sh = sorted(shingles(title))
    strongest = sh[0] if sh else normalize_headline(title)[:40]
    raw = f"{day}|{tick}|{strongest}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def pick_primary(items: list[dict]) -> dict | None:
    """Which version of one event owns the feed slot.

    Order: source class rank (primary > wire > journalism > social), then the
    EARLIEST publication -- whoever reported it first, not whoever we ingested
    first. Ties break on having a description, then on id, so the choice is
    deterministic across runs.
    """
    if not items:
        return None

    def key(it: dict):
        cls = it.get("source_class") or news_sources.CLASS_UNKNOWN
        ts = it.get("published_at")
        return (
            news_sources.rank(cls),
            ts if isinstance(ts, datetime) else datetime.max,
            0 if (it.get("description") or "").strip() else 1,
            str(it.get("id") or ""),
        )

    return sorted(items, key=key)[0]
