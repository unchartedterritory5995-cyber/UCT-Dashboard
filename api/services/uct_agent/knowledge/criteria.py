"""Derived setup criteria (KN-1 pilot): docs/agent/knowledge/setup-criteria.json, validated, served only when reviewed.

Each template entry lists conditions that map template wording to a measurable id from the closed list below (the same
list as docs/agent/program/contracts/KN-1-knowledge.md#measurables; a test holds the two equal). `reviewed_conditions`
returns a template's conditions ONLY when its entry is `reviewed: true` and every condition validates; anything else is
None, so setup.playbook stays exactly as before. Read per request (mtime-cached), never at import.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

ENV_PATH = "UCT_AGENT_KNOWLEDGE_CRITERIA"
DEFAULT_PATH = Path(__file__).resolve().parents[4] / "docs" / "agent" / "knowledge" / "setup-criteria.json"

MEASURABLES = frozenset({
    "close_vs_sma20", "close_vs_sma50", "pct_from_52w_high", "range_pct_10", "rel_volume_50d",
    "sma50_above_sma200", "sma50_rising", "sma200_rising",
    "close_vs_sma150", "close_vs_sma200", "close_vs_ema10", "close_vs_sma30w", "rel_volume_weekly_10w", "adr_pct_20",
    "gap_pct", "prior_run_pct_40d", "prior_run_pct_60d", "close_vs_gap_day_low", "undercut_reclaim_sessions",
    "stop_distance_pct",
})
ROLES = frozenset({"entry", "context", "invalidation", "risk"})
OPS = frozenset({">", ">=", "<", "<=", "==", None})
BASIS = frozenset({"stated", "interpreted"})
STRENGTH = frozenset({"required", "preferred"})
UNITS = frozenset({"pct", "x", "bool", "sessions", None})
TEMPLATE_FIELDS = frozenset({"entry_triggers", "stop_methods", "invalidation", "ma_alignment", "rs_requirements",
                             "trend_requirements", "liquidity_min", "max_stop_pct", "profit_logic", "addon_rules",
                             "ideal_regime", "description", "sector_conditions", "float_requirements", "hold_time_range"})
SERVED_KEYS = ("id", "role", "measurable", "op", "value", "unit", "timeframe", "basis", "strength", "assumptions", "blocked")

_cache: dict = {"path": None, "mtime": None, "data": None}


def path() -> Path:
    return Path(os.environ.get(ENV_PATH) or DEFAULT_PATH)


def load() -> dict:
    p = path()
    try:
        m = p.stat().st_mtime
    except OSError:
        return {"templates": []}
    if _cache["path"] == str(p) and _cache["mtime"] == m:
        return _cache["data"]
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("templates"), list):
            raise ValueError
    except (OSError, ValueError):
        data = {"templates": []}
    _cache.update(path=str(p), mtime=m, data=data)
    return data


def condition_errors(c: Any) -> list[str]:
    """Why one condition is invalid (empty list = valid)."""
    if not isinstance(c, dict):
        return ["not an object"]
    e = []
    cid = c.get("id")
    if not isinstance(cid, str) or not cid:
        e.append("id missing")
    if c.get("role") not in ROLES:
        e.append(f"{cid}: role")
    loc = str(c.get("locator") or "")
    if loc.split(".", 1)[0] not in TEMPLATE_FIELDS:
        e.append(f"{cid}: locator {loc!r} is not a template field")
    if c.get("basis") not in BASIS:
        e.append(f"{cid}: basis")
    if c.get("strength") not in STRENGTH:
        e.append(f"{cid}: strength")
    if not isinstance(c.get("assumptions", []), list):
        e.append(f"{cid}: assumptions must be a list")
    if c.get("blocked"):
        if c.get("measurable") is not None or c.get("value") is not None:
            e.append(f"{cid}: a blocked condition carries no measurable and no value (F-16 names never ride along)")
        return e                                   # a blocked condition carries its reason instead of a measure
    if c.get("measurable") not in MEASURABLES:
        e.append(f"{cid}: measurable {c.get('measurable')!r} is not in the closed list")
    if c.get("op") not in OPS or c.get("op") is None:
        e.append(f"{cid}: op")
    if c.get("unit") not in UNITS:
        e.append(f"{cid}: unit")
    v = c.get("value")
    if c.get("unit") == "bool":
        if v is not None and not isinstance(v, bool):
            e.append(f"{cid}: a bool measurable needs a bool value")
    elif v is not None and (isinstance(v, bool) or not isinstance(v, (int, float))):
        e.append(f"{cid}: value must be a number or null")
    if c.get("basis") == "stated" and v is None:
        e.append(f"{cid}: a stated condition needs its literal value")
    return e


def entry_errors(t: Any) -> list[str]:
    if not isinstance(t, dict) or not isinstance(t.get("template"), str):
        return ["entry without a template name"]
    errs = []
    conds = t.get("conditions")
    if not isinstance(conds, list) or not conds:
        return [f"{t['template']}: no conditions"]
    ids = [c.get("id") for c in conds if isinstance(c, dict)]
    if len(ids) != len(set(ids)):
        errs.append(f"{t['template']}: duplicate condition ids")
    for c in conds:
        errs.extend(f"{t['template']}: {m}" for m in condition_errors(c))
    return errs


def reviewed_conditions(template_name: str) -> Optional[list[dict]]:
    """The template's conditions for serving, or None (no entry, not reviewed, or any condition invalid)."""
    for t in load().get("templates") or []:
        if isinstance(t, dict) and t.get("template") == template_name:
            if t.get("reviewed") is not True or entry_errors(t):
                return None
            return [{k: c.get(k) for k in SERVED_KEYS if c.get(k) not in (None, [], "")} for c in t["conditions"]]
    return None
