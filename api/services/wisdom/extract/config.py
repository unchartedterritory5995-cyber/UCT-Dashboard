"""Non-gate extraction knobs (CONTRACTS §4 "Non-gate knobs"; no ledger row).

WISDOM_EXTRACT_MODEL (default claude-opus-5) and WISDOM_EXTRACT_EFFORT (default
high) are read per call. An effort outside the API's set falls back to the default
rather than letting a typo 400 every request. The gate is WISDOM_EXTRACT_ENABLED,
read only through core/flags.py.
"""
from __future__ import annotations

import os

from api.services.wisdom.extract import prompt

#: THE BACKEND SWITCH (R85/R86/R87). "paid" is the DEFAULT and stays the default: a variable
#: nobody set must never silently move extraction onto a different model. "local" routes to a
#: model on this machine and costs nothing.
BACKEND_ENV = "WISDOM_EXTRACT_BACKEND"
BACKEND_PAID = "paid"
BACKEND_LOCAL = "local"


def backend() -> str:
    """Which extractor runs. Anything but the exact literal "local" means PAID - an unknown
    value is not a third mode, and it must not become a cheaper one by accident."""
    raw = (os.environ.get(BACKEND_ENV) or "").strip().lower()
    if raw == BACKEND_LOCAL:
        return BACKEND_LOCAL
    return BACKEND_PAID


def is_local() -> bool:
    return backend() == BACKEND_LOCAL


DEFAULT_MODEL = "claude-opus-5"
DEFAULT_EFFORT = "high"
MAX_ATTEMPTS = 3


def configured_model() -> str:
    value = os.environ.get("WISDOM_EXTRACT_MODEL", "").strip()
    return value or DEFAULT_MODEL


def configured_effort() -> str:
    value = os.environ.get("WISDOM_EXTRACT_EFFORT", "").strip().lower()
    return value if value in prompt.EFFORTS else DEFAULT_EFFORT


def lower_effort(effort: str, steps: int = 1) -> str:
    """Fewer thinking tokens, for a request that ran out of max_tokens at `effort`."""
    order = list(prompt.EFFORTS)
    if effort not in order:
        return DEFAULT_EFFORT
    return order[max(0, order.index(effort) - max(0, int(steps)))]


def next_effort(effort: str) -> str:
    """One level deeper, for the second-pass audit."""
    order = list(prompt.EFFORTS)
    if effort not in order:
        return DEFAULT_EFFORT
    return order[min(len(order) - 1, order.index(effort) + 1)]


#: R100 (owner ruling, 2026-09-18) — the order fresh segments are selected in, for the N=3
#: priority-to-ceiling sweep (R99: N3_PRIORITY_TO_CEILING). ⛔ A VALUE, NOT A SWITCH, same
#: reasoning as `batch.daily_segment_limit`: unset must not mean "no priority" (an accidental
#: reversion to date-only ordering nobody would notice for nights) — it defaults to the exact
#: order the owner approved 2026-09-18. A value that is PRESENT but parses to nothing REFUSES
#: rather than silently keeping the default, so a typo'd env var cannot quietly reorder a night.
CATEGORY_PRIORITY_ENV = "WISDOM_EXTRACT_PRIORITY"
DEFAULT_CATEGORY_PRIORITY: tuple = (
    "The Mental Game", "Setups & Strategies", "Workshops & Fireside Chats", "Interviews",
    "Risk & Trade Management", "Mindset & Psychology", "Scanning & Stock Selection",
    "Market Analysis & Breadth", "Options & Flow", "Sunday Scans", "Thoughts on the Market",
    "Post-Market Recaps", "Evening Update", "Sharpen Your Trading Skills", "Live Trading Sessions",
)


class CategoryPriorityUnusable(ValueError):
    """A priority order that is set but parses to no category name. Refused, never silently
    defaulted — see `CATEGORY_PRIORITY_ENV`."""


def category_priority_order() -> tuple:
    """R100: the category order `pending_segments` selects fresh segments in.

    ⛔ Read at call time, never captured as a default argument — same reason as
    `batch.daily_segment_limit`: a value bound at import is frozen at whatever the environment
    held when this module first loaded.

    ⭐ Categories are folded through `tools.wisdom.category_norm.normalize_category` (R15) on
    BOTH sides of the eventual comparison — here, and again wherever a segment's source `show`
    is read — so a comma-separated env value in a slightly different casing still matches, and
    the two typo folds R15 already knows about (`LIVE TRAIDNG`, casing of "Sharpen Your Trading
    Skills") apply to a hand-typed order exactly as they apply to the data.

    A name repeated in the list keeps its FIRST position — a duplicate is redundant, not
    contradictory, so it is not refused.
    """
    from tools.wisdom.category_norm import normalize_category

    raw = os.environ.get(CATEGORY_PRIORITY_ENV)
    if raw is None or not raw.strip():
        return DEFAULT_CATEGORY_PRIORITY
    seen: dict = {}
    for part in raw.split(","):
        name = normalize_category(part.strip())
        if name and name not in seen:
            seen[name] = True
    if not seen:
        raise CategoryPriorityUnusable(
            f"{CATEGORY_PRIORITY_ENV}={raw[:80]!r} parsed to no category names. Refusing rather "
            "than falling back to the default order — a typo must not quietly reorder a night's "
            "extraction.")
    return tuple(seen)
