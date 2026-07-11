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

from api.services.auth_db import get_connection


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


# ── Trust Center: orphaned-annotation scan + reattach (spec §8, Task B7) ─────
#
# The two ref-keyed annotation stores are j2_trade_attachments (many rows per
# trade_ref) and j2_trade_excursions (PK (user_id, trade_ref) — at most one).
# Orphans are the residue when the broker FIFO fingerprint shifts (re-slice) or
# a trade is hard-deleted: the stable ref no longer resolves. Orphans are
# PARKED (surfaced here), never deleted; reattach re-points them to a live trade.


class OrphanReattachError(Exception):
    """Reattach validation failure. `status` is the HTTP code the router maps to
    (400 bad args / 404 target missing / 409 source ref still live)."""

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


def scan_orphans(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> list[dict[str, str]]:
    """Every DISTINCT annotation trade_ref (across j2_trade_attachments +
    j2_trade_excursions) for the user that no longer resolves to a live trade.

    Returns `[{tradeRef, kind, summary}]`, sorted by tradeRef for a stable UI:
      - `kind` ∈ 'attachment' | 'excursion' | 'attachment+excursion' — which
        table(s) hold the ref.
      - `summary` is a short human hint, e.g. "2 screenshots, excursion data".
    Never deletes — this is a read-only park.
    """
    own = conn is None
    if own:
        conn = get_connection()
    try:
        att_counts = {
            r["trade_ref"]: r["n"]
            for r in conn.execute(
                "SELECT trade_ref, COUNT(*) AS n FROM j2_trade_attachments "
                "WHERE user_id = ? GROUP BY trade_ref",
                (user_id,),
            ).fetchall()
        }
        exc_counts = {
            r["trade_ref"]: r["n"]
            for r in conn.execute(
                "SELECT trade_ref, COUNT(*) AS n FROM j2_trade_excursions "
                "WHERE user_id = ? GROUP BY trade_ref",
                (user_id,),
            ).fetchall()
        }
        all_refs = set(att_counts) | set(exc_counts)
        orphans = orphaned_refs(user_id, list(all_refs), conn)

        out: list[dict[str, str]] = []
        for ref in sorted(orphans):
            kinds: list[str] = []
            parts: list[str] = []
            if ref in att_counts:
                n = att_counts[ref]
                kinds.append("attachment")
                parts.append(f"{n} screenshot" + ("s" if n != 1 else ""))
            if ref in exc_counts:
                kinds.append("excursion")
                parts.append("excursion data")
            out.append(
                {
                    "tradeRef": ref,
                    "kind": "+".join(kinds),
                    "summary": ", ".join(parts),
                }
            )
        return out
    finally:
        if own:
            conn.close()


def reattach_orphan(
    user_id: str,
    trade_ref: str,
    target_trade_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict:
    """Re-point a parked orphan's annotations onto a live target trade's ref.

    Validates: target trade must exist + belong to the user (else 404); the
    source `trade_ref` must currently be ORPHANED (else 409 — never move a live
    ref's annotations). Computes the target's stable ref via `trade_ref_for_row`.

    Collision handling — attachments have no unique key on trade_ref, so they
    always UPDATE (the target's existing screenshots coexist). Excursions have PK
    (user_id, trade_ref): if the target ref ALREADY holds an excursion, moving
    would collide, and INSERT-OR-REPLACE would silently drop the target's real
    data — so we LEAVE the orphan excursion parked and flag `excursionConflict`
    instead (never lose data silently).

    Returns `{moved, attachmentsMoved, excursionsMoved, excursionConflict,
    tradeRef, newRef}`. Raises `OrphanReattachError` (with `.status`) on any
    validation failure — BEFORE any mutation, so a rejected call is a no-op.
    """
    trade_ref = (trade_ref or "").strip()
    target_trade_id = (target_trade_id or "").strip()
    if not trade_ref or not target_trade_id:
        raise OrphanReattachError("tradeRef and targetTradeId are required", 400)

    own = conn is None
    if own:
        conn = get_connection()
    try:
        target = conn.execute(
            "SELECT * FROM j2_trades WHERE user_id = ? AND id = ?",
            (user_id, target_trade_id),
        ).fetchone()
        if target is None:
            raise OrphanReattachError("Target trade not found", 404)

        # Guard: refuse to move a ref that still resolves to a live trade.
        if resolve_trade_by_ref(user_id, trade_ref, conn) is not None:
            raise OrphanReattachError(
                "tradeRef resolves to a live trade; nothing to reattach", 409
            )

        new_ref = trade_ref_for_row(target)

        cur = conn.execute(
            "UPDATE j2_trade_attachments SET trade_ref = ? "
            "WHERE user_id = ? AND trade_ref = ?",
            (new_ref, user_id, trade_ref),
        )
        attachments_moved = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0

        excursions_moved = 0
        excursion_conflict = False
        src_exc = conn.execute(
            "SELECT 1 FROM j2_trade_excursions WHERE user_id = ? AND trade_ref = ?",
            (user_id, trade_ref),
        ).fetchone()
        if src_exc is not None:
            dst_exc = conn.execute(
                "SELECT 1 FROM j2_trade_excursions WHERE user_id = ? AND trade_ref = ?",
                (user_id, new_ref),
            ).fetchone()
            if dst_exc is None:
                conn.execute(
                    "UPDATE j2_trade_excursions SET trade_ref = ? "
                    "WHERE user_id = ? AND trade_ref = ?",
                    (new_ref, user_id, trade_ref),
                )
                excursions_moved = 1
            else:
                excursion_conflict = True  # leave the orphan parked, don't overwrite

        conn.commit()
        return {
            "moved": attachments_moved + excursions_moved,
            "attachmentsMoved": attachments_moved,
            "excursionsMoved": excursions_moved,
            "excursionConflict": excursion_conflict,
            "tradeRef": trade_ref,
            "newRef": new_ref,
        }
    finally:
        if own:
            conn.close()
