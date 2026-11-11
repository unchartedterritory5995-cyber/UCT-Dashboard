"""Reindex-time health and coverage report for the knowledge kinds (K-06). Counts only, never content.

`report()` builds {pack, policy, coverage by state / licence / source / category, duplicates, rows without a
locator, statistics freshness, new sources since the last report}. `write()` stores it at
<DATA_DIR>/agent_knowledge_health.json (env UCT_AGENT_KNOWLEDGE_HEALTH) after every index build, so an admin
surface or a session can read what the Agent can and cannot cite without opening the pack.
"""
from __future__ import annotations

import json
import os
import time
from collections import Counter

from api.services.uct_agent.knowledge import index, pack, policy

ENV_PATH = "UCT_AGENT_KNOWLEDGE_HEALTH"
STATS_TABLES = ("setup_performance", "trigger_performance")


def health_path() -> str:
    return os.environ.get(ENV_PATH) or os.path.join(os.environ.get("DATA_DIR", "/data"), "agent_knowledge_health.json")


def _previous_sources() -> set[str]:
    try:
        with open(health_path(), encoding="utf-8") as fh:
            return set((json.load(fh).get("coverage") or {}).get("by_source", {}).keys())
    except (OSError, ValueError):
        return set()


def _stats_freshness() -> dict:
    out = {}
    c = pack.connect()
    if c is None:
        return out
    try:
        for t in STATS_TABLES:
            try:
                r = c.execute(f"SELECT COUNT(*), MAX(updated_at) FROM {t}").fetchone()
                out[t] = {"rows": r[0], "updated_at": r[1]}
            except Exception:  # noqa: BLE001
                out[t] = {"rows": 0, "updated_at": None, "missing": True}
        try:
            out["setup_templates"] = {"rows": c.execute("SELECT COUNT(*) FROM setup_templates").fetchone()[0]}
        except Exception:  # noqa: BLE001
            out["setup_templates"] = {"rows": 0, "missing": True}
    finally:
        c.close()
    return out


def report() -> dict:
    cov = index.coverage()
    by_source = cov.get("by_source") or {}
    states, licences, excluded = Counter(), Counter(), Counter()
    for src, n in by_source.items():
        cls = policy.classify(src)
        states[cls["state"]] += n
        licences[cls["licence"]] += n
        if cls["state"] != "admitted":
            excluded[f"{cls['state']}:{cls['licence']}"] += n
    prev = _previous_sources()
    info = index.built_info()
    return {
        "generated_at": int(time.time()),
        "pack": pack.version_info(),
        "index": {k: info.get(k) for k in ("pack_ts", "built_at", "rows", "duplicates", "schema")},
        "policy": {"version": policy.version(), "admitted_sources": policy.admitted_sources()},
        "coverage": {"by_state": dict(states), "by_licence": dict(licences), "excluded": dict(excluded),
                     "by_source": by_source, "by_category": cov.get("by_category") or {},
                     "duplicates": cov.get("duplicates"), "without_source_ref": cov.get("without_source_ref")},
        "new_sources_since_last_report": sorted(set(by_source) - prev) if prev else [],
        "statistics": _stats_freshness(),
    }


def write() -> dict:
    r = report()
    tmp = f"{health_path()}.{os.getpid()}-{int(time.time() * 1000)}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(r, fh, indent=1, sort_keys=True)
    os.replace(tmp, health_path())
    return r
