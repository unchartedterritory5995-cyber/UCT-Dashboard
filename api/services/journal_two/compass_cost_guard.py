"""Compass chat GLOBAL daily cost circuit-breaker.

A backstop above the per-user daily message cap: if aggregate Compass LLM spend
crosses COMPASS_COST_CAP_DAILY (USD) for the day, new turns are refused until
tomorrow. Belt-and-suspenders against a many-users-at-once spike or a cost bug.

Design constraints (the 524-outage lesson): the pre-turn check is O(1) in-memory
— NEVER a per-request DB query. The web pod is a single process, so a module-level
counter is accurate for the pod. Default OFF: cap <= 0 (unset) disables it entirely.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

# Sonnet pricing per MTok (env-overridable — the model coach_chat uses).
_IN_PER_MTOK = float(os.environ.get("COMPASS_COST_IN_PER_MTOK", "3.0") or 3.0)
_OUT_PER_MTOK = float(os.environ.get("COMPASS_COST_OUT_PER_MTOK", "15.0") or 15.0)

_state = {"date": None, "usd": 0.0}


def _today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _roll() -> None:
    """Reset the accumulator when the UTC day changes."""
    d = _today()
    if _state["date"] != d:
        _state["date"] = d
        _state["usd"] = 0.0


def cap_usd() -> float:
    try:
        return float(os.environ.get("COMPASS_COST_CAP_DAILY", "0") or 0)
    except (TypeError, ValueError):
        return 0.0


def over_budget() -> bool:
    """True only when a positive cap is set AND today's spend has reached it."""
    cap = cap_usd()
    if cap <= 0:
        return False  # disabled (dark by default)
    _roll()
    return _state["usd"] >= cap


def record(input_tokens: int = 0, output_tokens: int = 0) -> None:
    """Accrue one LLM call's cost into today's total. Best-effort; never raises."""
    try:
        _roll()
        _state["usd"] += (float(input_tokens or 0) / 1e6) * _IN_PER_MTOK
        _state["usd"] += (float(output_tokens or 0) / 1e6) * _OUT_PER_MTOK
    except Exception:  # noqa: BLE001
        pass


def record_from_usage(usage) -> None:
    """Accrue from an Anthropic message `usage` object (has input_tokens/output_tokens)."""
    if usage is None:
        return
    record(getattr(usage, "input_tokens", 0) or 0, getattr(usage, "output_tokens", 0) or 0)


def snapshot() -> dict:
    _roll()
    cap = cap_usd()
    return {
        "date": _state["date"],
        "spent_usd": round(_state["usd"], 4),
        "cap_usd": cap,
        "enabled": cap > 0,
        "over_budget": cap > 0 and _state["usd"] >= cap,
    }


def _reset_for_test() -> None:
    _state["date"] = None
    _state["usd"] = 0.0
