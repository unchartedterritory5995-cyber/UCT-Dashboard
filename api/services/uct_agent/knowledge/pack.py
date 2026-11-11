"""The installed Brain Pack, as the knowledge kinds see it: paths, version, freshness. Read-only.

Compatibility with the pack manifest (the LOCKED two-repo contract): today PACK_MANIFEST.json carries
{ts, kb_rows, template_rows, db_bytes, data_files}. The additive fields this program asked the partner for
(`schema_version`, `kb_sources`, `stats_updated_at`) are optional: when absent they are reported as missing
and every behaviour falls back to what can be measured from the database itself. Nothing is invented.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from typing import Optional

OPTIONAL_MANIFEST_FIELDS = ("schema_version", "kb_sources", "stats_updated_at")
KNOWN_SCHEMA_VERSION_MAX = None  # unknown until the partner publishes one; None = accept (no field to compare)


def brain_dir() -> str:
    from api.services import brain_sync
    return brain_sync.brain_dir()


def db_path() -> str:
    return os.path.join(brain_dir(), "data", "uct_intelligence.db")


def connect() -> Optional[sqlite3.Connection]:
    """The pack database, read-only, or None when no pack is installed."""
    p = db_path()
    if not os.path.isfile(p):
        return None
    uri = "file:" + p.replace("\\", "/") + "?mode=ro"
    c = sqlite3.connect(uri, uri=True, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


def manifest() -> dict:
    try:
        with open(os.path.join(brain_dir(), "PACK_MANIFEST.json"), encoding="utf-8") as fh:
            m = json.load(fh)
        return m if isinstance(m, dict) else {}
    except (OSError, ValueError):
        return {}


def pack_ts() -> int:
    """The installed pack's version: the sync marker, else the manifest ts, else the DB file's mtime; 0 = none."""
    try:
        from api.services import brain_sync
        ts = int(brain_sync.installed_ts() or 0)
    except Exception:  # noqa: BLE001
        ts = 0
    if not ts:
        try:
            ts = int(manifest().get("ts") or 0)
        except (TypeError, ValueError):
            ts = 0
    if not ts and os.path.isfile(db_path()):
        ts = int(os.path.getmtime(db_path()))
    return ts


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def age_days(ts: int, now: Optional[float] = None) -> float:
    return max(0.0, ((now or time.time()) - ts) / 86400.0) if ts else float("inf")


def version_info() -> dict:
    m = manifest()
    return {"pack_ts": pack_ts(), "kb_rows": m.get("kb_rows"), "template_rows": m.get("template_rows"),
            "schema_version": m.get("schema_version"),
            "manifest_fields_missing": [f for f in OPTIONAL_MANIFEST_FIELDS if f not in m]}
