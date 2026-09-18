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
