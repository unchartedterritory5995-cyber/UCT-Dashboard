"""Stable annotation identity for trades.

Broker rows are purged+reinserted with fresh uuid4 ids on full resync
(broker/service.py _purge_imported), but their external_id fingerprint is
deterministic — so annotations key on 'ext:<external_id>' for broker rows
and 'id:<row id>' for manual rows and option strategies (those ids never
change). Orphaned refs (a re-sliced fingerprint) holding USER content are
PARKED, never deleted — surfaced by the Trust Center reattach queue
(spec §8); machine-generated excursion-only orphans are pruned instead
(`prune_dead_excursions` — the nightly backfill recomputes live refs).
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


def ref_is_live(user_id: str, ref: str, conn: sqlite3.Connection) -> bool:
    """True when `ref` still resolves to a live annotated entity.

    Broader than `resolve_trade_by_ref` (equity j2_trades only): option
    strategies are NOT in j2_trades — their annotations key on
    `id:<strategy id>` (excursion_engine.compute_for_option_strategy) — so an
    `id:` ref must also be checked against j2_option_strategies. Without that,
    every closed option strategy's excursion row reads as a false orphan
    (the 2026-07-12 "37 orphaned annotations" bug)."""
    if resolve_trade_by_ref(user_id, ref, conn) is not None:
        return True
    if ref.startswith("id:"):
        return conn.execute(
            "SELECT 1 FROM j2_option_strategies WHERE user_id = ? AND id = ?",
            (user_id, ref[3:]),
        ).fetchone() is not None
    return False


def orphaned_refs(user_id: str, refs: list[str], conn: sqlite3.Connection) -> list[str]:
    return [r for r in refs if not ref_is_live(user_id, r, conn)]


# ── Trust Center: orphaned-annotation scan + reattach (spec §8, Task B7) ─────
#
# The two ref-keyed annotation stores are j2_trade_attachments (many rows per
# trade_ref) and j2_trade_excursions (PK (user_id, trade_ref) — at most one).
# Orphans are the residue when the broker FIFO fingerprint shifts (re-slice) or
# a trade is hard-deleted: the stable ref no longer resolves.
#
# The never-delete park applies to USER CONTENT (screenshots/notes): those are
# surfaced in the reattach queue until re-pointed. Excursions are MACHINE
# output — the nightly backfill recomputes them for whatever refs are live —
# so an excursion-only dead ref is never surfaced (nothing user-authored to
# save) and is garbage-collected by `prune_dead_excursions`.


class OrphanReattachError(Exception):
    """Reattach validation failure. `status` is the HTTP code the router maps to
    (400 bad args / 404 target missing / 409 source ref still live)."""

    def __init__(self, message: str, status: int):
        super().__init__(message)
        self.status = status


def scan_orphans(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> list[dict[str, str]]:
    """Every annotation trade_ref holding USER CONTENT (j2_trade_attachments)
    for the user that no longer resolves to a live trade or option strategy.

    Excursion-ONLY dead refs are deliberately NOT surfaced: excursion metrics
    are machine-computed (recomputed nightly for live refs), so a manual
    reattach row for them is pure busywork — they're left to
    `prune_dead_excursions`. A dead ref that has attachments still reports its
    excursion in `kind`/`summary` (reattach carries both).

    Returns `[{tradeRef, kind, summary}]`, sorted by tradeRef for a stable UI:
      - `kind` ∈ 'attachment' | 'attachment+excursion' — which table(s) hold
        the ref.
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
            if ref not in att_counts:
                continue  # excursion-only residue — recomputable, never queued
            n = att_counts[ref]
            kinds = ["attachment"]
            parts = [f"{n} screenshot" + ("s" if n != 1 else "")]
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


def prune_dead_excursions(
    user_id: str | None = None, conn: sqlite3.Connection | None = None,
) -> int:
    """Garbage-collect j2_trade_excursions rows whose ref is dead
    (`ref_is_live` false) AND that have NO sibling attachments.

    Excursions are machine-computed — the nightly backfill recomputes live
    refs — so a dead ref's excursion is residue, not user data (spec §8's
    never-delete park protects user content only). A dead ref WITH attachments
    keeps its excursion row: it stays in the reattach queue and
    `reattach_orphan` carries the excursion to the target. All users when
    `user_id` is None (the nightly job). Returns rows deleted."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        if user_id:
            rows = conn.execute(
                "SELECT user_id, trade_ref FROM j2_trade_excursions WHERE user_id = ?",
                (user_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT user_id, trade_ref FROM j2_trade_excursions",
            ).fetchall()

        att_refs: dict[str, set[str]] = {}

        def _atts(uid: str) -> set[str]:
            if uid not in att_refs:
                att_refs[uid] = {
                    r["trade_ref"]
                    for r in conn.execute(
                        "SELECT DISTINCT trade_ref FROM j2_trade_attachments "
                        "WHERE user_id = ?",
                        (uid,),
                    ).fetchall()
                }
            return att_refs[uid]

        doomed = [
            (r["user_id"], r["trade_ref"])
            for r in rows
            if r["trade_ref"] not in _atts(r["user_id"])
            and not ref_is_live(r["user_id"], r["trade_ref"], conn)
        ]
        if doomed:
            conn.executemany(
                "DELETE FROM j2_trade_excursions WHERE user_id = ? AND trade_ref = ?",
                doomed,
            )
            conn.commit()
        return len(doomed)
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

        # Guard: refuse to move a ref that still resolves to a live trade or
        # option strategy (option annotations key `id:<strategy id>`).
        if ref_is_live(user_id, trade_ref, conn):
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

        if attachments_moved > 0:
            # The DB rows now point at new_ref, but the screenshot FILES live
            # under a directory named from the ref — move them so the reattached
            # screenshots actually serve (they'd 404 otherwise). Best-effort,
            # never raises, runs AFTER commit: a failed move must not undo the
            # reattach (DB is source of truth, files are recoverable). Deferred
            # import — trade_attachments pulls in the heavy calendar module, and
            # trade_refs is imported widely, so we don't want it at module load.
            from api.services.journal_two import trade_attachments
            trade_attachments.relocate_ref_dir(user_id, trade_ref, new_ref)

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
