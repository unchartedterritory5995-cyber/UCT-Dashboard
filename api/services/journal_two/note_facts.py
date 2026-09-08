"""Wave F — Financial Fact / Snapshot Ledger.

The immutable, note-owned store of a captured financial observation
(`j2_fact_observations`) plus its note-content sidecar (`j2_note_fact_refs`,
mirroring `j2_note_links`' "rebuildable projection, never edited directly"
contract). See the Wave F entry checkpoint
(`docs/notebook/prelaunch-primary-notebook-build-plan.md`) for the full
36/46-point rationale behind every decision below.

Two structural guarantees enforced by this module's own shape, not by
convention:
- **Immutability.** There is no `update_fact_observation` function -- only
  `create_fact_observation` (INSERT-only) and `delete_fact_observation`. The
  one editable field, `caption`, has its own narrow `update_fact_caption`.
  A second observation of the same logical series is a NEW row, never an
  overwrite of an old one (checkpoint decision 8/19/37).
- **Entity resolution never blocks a capture.** `entity_master.resolve()`
  returning `not_found`/`ambiguous` still lets the capture proceed with
  `entity_id = NULL` -- `ticker` (the display symbol as captured) is always
  present regardless (checkpoint decision 9).
"""
from __future__ import annotations

import sqlite3
import uuid
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import fact_registry


def _now_iso() -> str:
    from api.services.journal_two.notes import _now_iso as _impl
    return _impl()


class FactValidationError(ValueError):
    pass


def _resolve_entity_id(ticker: str) -> str | None:
    """Never raises, never blocks a capture (checkpoint decision 9)."""
    try:
        from api.services.entity_master import api as entity_master
        result = entity_master.resolve(ticker)
        if result.status == "resolved" and result.entity:
            return result.entity.entity_id
    except Exception:
        pass
    return None


def _row_to_fact(row: sqlite3.Row) -> dict[str, Any]:
    fdef = fact_registry.get_fact_type(row["fact_type"])
    value = row["value_number"] if row["value_number"] is not None else row["value_text"]
    return {
        "id": row["id"],
        "noteId": row["note_id"],
        "entityId": row["entity_id"],
        "ticker": row["ticker"],
        "factType": row["fact_type"],
        "factLabel": fdef.label if fdef else row["fact_type"],
        "period": row["period"],
        "value": value,
        "unit": row["unit"],
        "currency": row["currency"],
        "temporalMode": row["temporal_mode"],
        "observedAt": row["observed_at"],
        "sourceAsOf": row["source_as_of"],
        "source": row["source"],
        "sourceRef": row["source_ref"],
        "rightsClass": row["rights_class"],
        "caption": row["caption"],
        "createdAt": row["created_at"],
    }


def create_fact_observation(
    user_id: str, note_id: str, *,
    ticker: str, fact_type: str,
    value: Any,
    observed_at: str | None = None,
    caption: str | None = None,
    idempotency_key: str | None = None,
    period: str | None = None,
    source_ref: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Create one immutable observation. `value` is validated against the
    fact type's declared value column (checkpoint decision 11). Idempotent:
    a repeated `idempotency_key` for this user returns the EXISTING row
    rather than creating a duplicate (checkpoint decision 20) -- the atomic
    INSERT-then-catch-IntegrityError pattern this codebase already uses for
    `watchlist_alert_service.try_record_alert`.

    `value=None` for `fact_type='price'` auto-resolves the current live price
    (directive §43/§112's "UCT already knows this" -- a member should never
    have to manually type in the number UCT can already read off the same
    live-price cache the dashboard already polls). Every OTHER fact type
    still requires an explicit value -- there is no generic auto-fill,
    only this one, narrow, already-cached case."""
    ticker = (ticker or "").strip().upper()
    if not ticker:
        raise FactValidationError("Ticker is required")
    fdef = fact_registry.get_fact_type(fact_type)
    if fdef is None:
        raise FactValidationError(f"Unknown fact type: {fact_type!r}")
    if not fdef.active:
        raise FactValidationError(
            f"{fdef.label} capture is not yet enabled (rights-conditional, architecture-only)"
        )
    if value is None and fact_type == "price":
        from api.services.journal_two import fact_current_value
        resolved = fact_current_value.resolve_current_values(
            [{"id": "_capture", "factType": "price", "temporalMode": "live_and_snapshot", "ticker": ticker}]
        )
        value = resolved.get("_capture")
        if value is None:
            raise FactValidationError(f"Could not resolve a current price for {ticker}")
    if fdef.value_column == "value_number":
        try:
            value_number = float(value)
        except (TypeError, ValueError):
            raise FactValidationError(f"{fdef.label} requires a numeric value")
        value_text = None
    else:
        value_text = "" if value is None else str(value)
        if not value_text.strip():
            raise FactValidationError(f"{fdef.label} requires a non-empty value")
        value_number = None

    owned = conn is None
    conn = conn or get_connection()
    try:
        if idempotency_key:
            existing = conn.execute(
                "SELECT * FROM j2_fact_observations WHERE user_id = ? AND idempotency_key = ?",
                (user_id, idempotency_key),
            ).fetchone()
            if existing is not None:
                return _row_to_fact(existing)

        fact_id = uuid.uuid4().hex
        now = _now_iso()
        entity_id = _resolve_entity_id(ticker)
        try:
            conn.execute(
                "INSERT INTO j2_fact_observations"
                " (id, user_id, note_id, entity_id, ticker, fact_type, period,"
                "  value_number, value_text, unit, currency, scale, temporal_mode,"
                "  observed_at, source_as_of, source, source_ref, rights_class,"
                "  idempotency_key, caption, created_at)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    fact_id, user_id, note_id, entity_id, ticker, fact_type, period,
                    value_number, value_text, fdef.unit, "USD", None, fdef.temporal_mode,
                    observed_at or now, None, fdef.source, source_ref, fdef.rights_class,
                    idempotency_key, caption, now,
                ),
            )
        except sqlite3.IntegrityError:
            # Concurrent retry of the same capture intent lost the race —
            # the unique (user_id, idempotency_key) index means the winner's
            # row is what we want back, not an error.
            existing = conn.execute(
                "SELECT * FROM j2_fact_observations WHERE user_id = ? AND idempotency_key = ?",
                (user_id, idempotency_key),
            ).fetchone()
            if existing is not None:
                return _row_to_fact(existing)
            raise
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_fact_observations WHERE id = ?", (fact_id,)
        ).fetchone()
        return _row_to_fact(row)
    finally:
        if owned:
            conn.close()


def get_fact_observation(
    user_id: str, fact_id: str, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_fact_observations WHERE id = ? AND user_id = ?",
            (fact_id, user_id),
        ).fetchone()
        return _row_to_fact(row) if row else None
    finally:
        if owned:
            conn.close()


def list_note_facts(
    user_id: str, note_id: str, conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Every fact the note's own `j2_note_fact_refs` sidecar references, in
    document order — the resolution endpoint's core (checkpoint decision 24),
    same shape as Wave E's `resolve_note_properties`."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT f.* FROM j2_note_fact_refs r"
            " JOIN j2_fact_observations f ON f.id = r.fact_id AND f.user_id = r.user_id"
            " WHERE r.note_id = ? AND r.user_id = ?"
            " ORDER BY r.position ASC",
            (note_id, user_id),
        ).fetchall()
        return [_row_to_fact(r) for r in rows]
    finally:
        if owned:
            conn.close()


def update_fact_caption(
    user_id: str, fact_id: str, caption: str | None, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """The ONE mutable field — a user annotation, never the observed value
    itself (checkpoint decision 19)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM j2_fact_observations WHERE id = ? AND user_id = ?",
            (fact_id, user_id),
        ).fetchone()
        if existing is None:
            return None
        conn.execute(
            "UPDATE j2_fact_observations SET caption = ? WHERE id = ? AND user_id = ?",
            (caption, fact_id, user_id),
        )
        conn.commit()
        return get_fact_observation(user_id, fact_id, conn=conn)
    finally:
        if owned:
            conn.close()


def delete_fact_observation(
    user_id: str, fact_id: str, conn: sqlite3.Connection | None = None,
) -> bool:
    """Facts are note-owned, not shared (checkpoint decision 24) — removing
    one from its note IS deleting the object, no separate distinction."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.execute(
            "DELETE FROM j2_note_fact_refs WHERE fact_id = ? AND user_id = ?",
            (fact_id, user_id),
        )
        cur = conn.execute(
            "DELETE FROM j2_fact_observations WHERE id = ? AND user_id = ?",
            (fact_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()
