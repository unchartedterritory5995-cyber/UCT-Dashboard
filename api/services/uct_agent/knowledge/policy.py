"""The knowledge source policy, read per request (never at import). Default-deny.

A source string from the Brain Pack (`knowledge_base.source`) is classified as:
  admitted   listed under `sources` with admit=true  -> may be retrieved and cited
  pending    listed with admit=false                 -> excluded, reported as an approval candidate
  excluded   matched by a `prefix_classes` row       -> excluded with its licence class and reason
  unknown    anything else                           -> excluded (a new source the owner has not seen)
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

ENV_PATH = "UCT_AGENT_KNOWLEDGE_POLICY"
DEFAULT_PATH = Path(__file__).resolve().parents[4] / "docs" / "agent" / "knowledge" / "policy.json"

_cache: dict = {"path": None, "mtime": None, "data": None}


def path() -> Path:
    return Path(os.environ.get(ENV_PATH) or DEFAULT_PATH)


def load() -> dict:
    """The policy, re-read when the file changes. A missing or broken file is an EMPTY policy (deny all)."""
    p = path()
    try:
        m = p.stat().st_mtime
    except OSError:
        return _empty("policy file missing")
    if _cache["path"] == str(p) and _cache["mtime"] == m:
        return _cache["data"]
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("sources"), dict):
            raise ValueError("bad shape")
    except (OSError, ValueError):
        return _empty("policy file unreadable")
    _cache.update(path=str(p), mtime=m, data=data)
    return data


def _empty(why: str) -> dict:
    return {"policy_version": 0, "sources": {}, "prefix_classes": [], "error": why}


def version() -> int:
    try:
        return int(load().get("policy_version") or 0)
    except (TypeError, ValueError):
        return 0


def classify(source: Optional[str]) -> dict:
    """{state, licence, label, reason} for one source string. Never raises."""
    pol = load()
    s = str(source or "").strip()
    for pc in pol.get("prefix_classes") or []:      # review N2: an excluded prefix wins over any named key
        if isinstance(pc, dict) and s.startswith(str(pc.get("prefix") or "\0")):
            return {"state": "excluded", "licence": pc.get("licence") or "unresolved", "label": s,
                    "reason": pc.get("reason") or "excluded by policy"}
    row = pol.get("sources", {}).get(s)
    if isinstance(row, dict):
        if row.get("admit") is True:
            return {"state": "admitted", "licence": row.get("licence") or "unresolved",
                    "label": row.get("label") or s, "reason": ""}
        return {"state": "pending", "licence": row.get("licence") or "unresolved",
                "label": row.get("label") or s, "reason": row.get("pending") or "not approved"}
    return {"state": "unknown", "licence": "unresolved", "label": s or "(blank)",
            "reason": "a source the policy does not list (default-deny)"}


def admitted_sources() -> list[str]:
    """Admitted keys, re-checked through classify() so a key under an excluded prefix can never be admitted."""
    return sorted(k for k, v in load().get("sources", {}).items()
                  if isinstance(v, dict) and v.get("admit") is True and classify(k)["state"] == "admitted")


def excluded_categories() -> set[str]:
    return {str(c).upper() for c in load().get("excluded_categories") or []}


def dated_categories() -> set[str]:
    return {str(c).upper() for c in load().get("dated_categories") or []}


def dated_max_age_days() -> int:
    return _int(load().get("dated_max_age_days"), 30)


def trader(name: Optional[str]) -> str:
    n = str(name or "").strip()
    return str((load().get("trader_aliases") or {}).get(n, n))


def search_setting(key: str, default: int) -> int:
    return _int((load().get("search") or {}).get(key), default)


def stats_n_min() -> int:
    return max(1, _int((load().get("stats") or {}).get("n_min"), 30))


def pack_setting(key: str, default: int) -> int:
    return _int((load().get("pack") or {}).get(key), default)


def _int(v, default: int) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default
