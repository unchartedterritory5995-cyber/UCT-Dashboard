"""Stable annotation identity for trades.

Broker rows are purged+reinserted with fresh uuid4 ids on full resync
(broker/service.py _purge_imported), but their external_id fingerprint is
deterministic — so annotations key on 'ext:<external_id>' for broker rows
and 'id:<row id>' for manual rows (manual ids never change).
Orphaned refs (a re-sliced fingerprint) are PARKED, never deleted —
surfaced later by the Trust Center reattach queue (spec §8).
"""
from __future__ import annotations

import sqlite3


def trade_ref_for_row(row) -> str:
    # sqlite3.Row raises IndexError (not KeyError) on a missing key, so guard
    # BOTH `source` and `external_id` via `in row.keys()` — a dict falls through
    # the same guard harmlessly.
    keys = row.keys()
    ext = row["external_id"] if "external_id" in keys else None
    source = row["source"] if "source" in keys else None
    if source == "broker" and ext:
        return f"ext:{ext}"
    return f"id:{row['id']}"


def resolve_trade_by_ref(user_id: str, ref: str, conn: sqlite3.Connection):
    if ref.startswith("ext:"):
        return conn.execute(
            "SELECT * FROM j2_trades WHERE user_id = ? AND external_id = ?",
            (user_id, ref[4:]),
        ).fetchone()
    if ref.startswith("id:"):
        return conn.execute(
            "SELECT * FROM j2_trades WHERE user_id = ? AND id = ?",
            (user_id, ref[3:]),
        ).fetchone()
    return None


def orphaned_refs(user_id: str, refs: list[str], conn: sqlite3.Connection) -> list[str]:
    return [r for r in refs if resolve_trade_by_ref(user_id, r, conn) is None]
