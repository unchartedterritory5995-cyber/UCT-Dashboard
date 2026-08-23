"""Quote of the Day — the server-side pick.

The library is ``app/src/constants/quotes.json`` (ONE authority; the frontend
imports the same file). This module chooses today's quote so that every viewer,
every surface (Dashboard, status bar, Morning Wire banner) and the Substack
letter agree on it:

* **Day** = the ET calendar day (the wire's calendar), as ``day_ordinal`` —
  days since 1970-01-01. The client fallback in ``quotes.js`` keys off the
  viewer's LOCAL date with the same ordinal math, so it only ever differs from
  the server in the minutes around midnight.
* **Regime** = the Morning Wire's exposure tier — the text the engine itself
  publishes in ``wire_data["game_plan"]["exposure_tier"]`` (``discipline.py``
  in morning-wire: Aggressive / Constructive / Neutral / Caution / Defensive).
  No score threshold is restated here: we take the engine's word for the tier.
* **Pool** = quotes carrying any of the tier's preferred tags (``REGIME_TAGS``);
  an unknown/blank tier means the whole library.
* **Walk** = ``ordinal × stride mod len(pool)`` with a stride coprime to the
  pool size, so each pool is a full cycle — every quote in it surfaces once
  before any repeats (the same construction as ``quotes.js``; the
  ``STRIDE`` constant is mirrored and parity-tested).

Never raises on missing data: a missing library yields ``quote: None`` so the
frontend falls back to its own rotation.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from functools import lru_cache
from math import gcd
from pathlib import Path
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

LIBRARY_PATH = Path(__file__).resolve().parents[2] / "app" / "src" / "constants" / "quotes.json"

# Mirrors `export const STRIDE` in app/src/constants/quotes.js — tests/test_quote_of_the_day.py
# reads the JS source and fails if the two drift.
STRIDE = 131

TAGS = ("risk", "patience", "process", "psychology", "momentum",
        "sizing", "contrarian", "grit", "learning")

# Keyed by the engine's tier words (morning-wire discipline.py `_TIERS`). Order
# within a tuple is cosmetic; membership is what selects the pool.
REGIME_TAGS = {
    "Aggressive":   ("momentum", "sizing", "grit"),
    "Constructive": ("momentum", "process", "patience"),
    "Neutral":      ("process", "patience", "psychology"),
    "Caution":      ("risk", "patience", "contrarian"),
    "Defensive":    ("risk", "psychology", "learning"),
}

_ET = ZoneInfo("America/New_York")
_EPOCH = date(1970, 1, 1)


@lru_cache(maxsize=1)
def load_library() -> tuple:
    """The library as a tuple of dicts, read once per process. () if unreadable."""
    try:
        with open(LIBRARY_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError) as exc:
        log.warning("[qotd] library unreadable at %s: %s", LIBRARY_PATH, exc)
        return ()
    out = []
    for q in data if isinstance(data, list) else []:
        if isinstance(q, dict) and q.get("t") and q.get("a"):
            out.append({"t": str(q["t"]), "a": str(q["a"]), "src": str(q.get("src") or ""),
                        "tags": [t for t in (q.get("tags") or []) if t in TAGS]})
    return tuple(out)


def day_ordinal(d: date) -> int:
    return (d - _EPOCH).days


def today_et() -> date:
    return datetime.now(_ET).date()


def normalize_label(label) -> str | None:
    """The engine's tier word, case-insensitively, or None for anything else."""
    if not label:
        return None
    key = str(label).strip().lower()
    for tier in REGIME_TAGS:
        if tier.lower() == key:
            return tier
    return None


def pool_for(label: str | None) -> list:
    lib = list(load_library())
    tier = normalize_label(label)
    if tier is None:
        return lib
    wanted = set(REGIME_TAGS[tier])
    pool = [q for q in lib if wanted & set(q["tags"])]
    return pool or lib      # a regime with no tagged quotes falls back to everything


def stride_for(n: int) -> int:
    """Largest stride ≤ STRIDE coprime with n — a full cycle over any pool size."""
    s = STRIDE
    while n > 1 and gcd(s, n) != 1:
        s -= 1
    return max(s, 1)


def pick_index(ordinal: int, n: int) -> int:
    """Mirror of quoteRotation.js `pickIndex` — parity-tested against Node."""
    if n <= 0:
        return -1
    return (ordinal * stride_for(n)) % n


def pick(d: date, label: str | None = None) -> dict:
    tier = normalize_label(label)
    pool = pool_for(tier)
    n = len(pool)
    quote = pool[pick_index(day_ordinal(d), n)] if n else None
    return {
        "date": d.isoformat(),
        "label": tier,
        "tags": list(REGIME_TAGS[tier]) if tier else [],
        "pool_size": n,
        "quote": quote,
    }


def current_label() -> str | None:
    """The exposure tier of the latest pushed wire, or None if there is none."""
    try:
        from api.services import engine as _engine   # local import: engine is heavy
        wire = _engine._load_wire_data()
    except Exception as exc:  # noqa: BLE001 — a quote must never 500 on the wire cache
        log.warning("[qotd] wire unavailable: %s", exc)
        return None
    gp = (wire or {}).get("game_plan") if isinstance(wire, dict) else None
    return normalize_label((gp or {}).get("exposure_tier"))


def pick_today(label: str | None = None) -> dict:
    return pick(today_et(), label if label is not None else current_label())
