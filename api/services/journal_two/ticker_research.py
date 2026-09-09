"""Wave H — Ticker Research Workspace read model.

Aggregates existing authoritative objects for one security -- notes, theses,
captured Wave F facts, linked trades/positions -- into ONE bounded summary
(checkpoint decision 15). Nothing here copies content into a new record; the
workspace is a dynamic VIEW, never a duplicate store (directive §15/§66).

Membership (checkpoint decision 9) is high-confidence only: a note's own
`ticker` field, an accepted chart/widget embed's `symbol`, or an explicit
`$CASHTAG` prose mention (`j2_note_mentions`) -- NEVER a bare substring match.
Every source is matched against the security's full known alias-symbol
history (checkpoint decision 5c), so a rename doesn't silently orphan older
research -- degrading to the single requested symbol when entity_master
can't resolve it (never blocks the workspace, same "resolution never blocks"
discipline Wave F established for facts).
"""
from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection

_NOTES_LIMIT = 5
_FACTS_LIMIT = 5
_DOCUMENTS_LIMIT = 5


def resolve_research_symbols(symbol: str) -> dict[str, Any]:
    """Never raises, never blocks. `entityId`/`displayName` are None when the
    symbol doesn't resolve (not_found/ambiguous/entity_master unavailable) --
    the workspace still renders, scoped to just the requested symbol."""
    symbol = (symbol or "").strip().upper()
    out: dict[str, Any] = {"symbol": symbol, "entityId": None, "displayName": None, "symbols": [symbol] if symbol else []}
    if not symbol:
        return out
    try:
        from api.services.entity_master import api as entity_master
        result = entity_master.resolve(symbol)
        if result.status == "resolved" and result.entity:
            out["entityId"] = result.entity.entity_id
            aliases = entity_master.aliases(result.entity.entity_id)
            alias_symbols = sorted({a.alias for a in aliases} | {symbol})
            out["symbols"] = alias_symbols
    except Exception:
        pass  # entity_master hiccup -- degrade to the single requested symbol
    try:
        from api.services.ticker_meta import get_ticker_meta
        meta = get_ticker_meta(symbol)
        out["displayName"] = meta.get("name") or None
    except Exception:
        pass  # provider hiccup -- header shows the bare symbol, never blocks
    return out


def _notes_for_symbols(
    user_id: str, symbols: list[str], limit: int, conn: sqlite3.Connection,
) -> list[dict[str, Any]]:
    """Same OR-of-EXISTS shape `_notes_filter_sql`'s `symbol_in` already uses
    for embed/mention matching, widened here to ALSO include the note's own
    `ticker` field (which the existing `symbol_in` predicate deliberately
    does not cover -- checkpoint decision 9's own reconstruction finding)."""
    from api.services.journal_two.notes import _row_to_note_summary, _LIST_PLAIN_CHARS
    if not symbols:
        return []
    ph = ",".join("?" * len(symbols))
    rows = conn.execute(
        "SELECT DISTINCT n.id, n.user_id, n.account_id, n.folder_id, n.title, n.subtitle,"
        f" substr(coalesce(n.body_plain, ''), 1, {_LIST_PLAIN_CHARS}) AS body_plain,"
        " n.hero_image_url, n.first_image_url, n.ticker, n.tags, n.created_at, n.updated_at,"
        " n.deleted_at, n.properties_json"
        " FROM j2_notes n"
        " WHERE n.user_id = ? AND n.deleted_at IS NULL"
        f" AND (n.ticker IN ({ph})"
        f" OR EXISTS (SELECT 1 FROM j2_note_embeds e WHERE e.note_id = n.id AND e.user_id = n.user_id AND e.symbol IN ({ph}))"
        f" OR EXISTS (SELECT 1 FROM j2_note_mentions m WHERE m.note_id = n.id AND m.user_id = n.user_id AND m.symbol IN ({ph})))"
        " ORDER BY n.updated_at DESC LIMIT ?",
        (user_id, *symbols, *symbols, *symbols, limit),
    ).fetchall()
    return [_row_to_note_summary(r) for r in rows]


def _theses_for_symbols(
    user_id: str, symbols: list[str], conn: sqlite3.Connection,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """A note qualifies as a thesis the SAME way Wave G's own thesis-shaped
    check does (Research Type Long/Short, or the legacy `thesis` tag) --
    never a second definition. Split active vs. past/other (watching/
    invalidated/closed) matching the directive's own two named buckets."""
    import json
    all_notes = _notes_for_symbols(user_id, symbols, 200, conn)  # generous cap; theses are a small subset
    active, past = [], []
    for n in all_notes:
        props = n.get("propertiesJson") or {}
        research_type = props.get("builtin:research_type")
        is_thesis = research_type in ("long_thesis", "short_thesis") or "thesis" in (n.get("tags") or [])
        if not is_thesis:
            continue
        status = props.get("builtin:thesis_status")
        entry = {**n}
        (active if status == "active" else past).append(entry)
    return active[:_NOTES_LIMIT], past[:_NOTES_LIMIT]


def _facts_for_entity(
    user_id: str, entity_id: str | None, symbols: list[str], limit: int, conn: sqlite3.Connection,
) -> list[dict[str, Any]]:
    from api.services.journal_two.note_facts import _row_to_fact
    if entity_id:
        rows = conn.execute(
            "SELECT f.* FROM j2_fact_observations f"
            " JOIN j2_notes n ON n.id = f.note_id AND n.user_id = f.user_id"
            " WHERE f.user_id = ? AND n.deleted_at IS NULL"
            " AND (f.entity_id = ? OR (f.entity_id IS NULL AND f.ticker = ?))"
            " ORDER BY f.observed_at DESC LIMIT ?",
            (user_id, entity_id, symbols[0] if symbols else "", limit),
        ).fetchall()
    elif symbols:
        ph = ",".join("?" * len(symbols))
        rows = conn.execute(
            "SELECT f.* FROM j2_fact_observations f"
            " JOIN j2_notes n ON n.id = f.note_id AND n.user_id = f.user_id"
            f" WHERE f.user_id = ? AND n.deleted_at IS NULL AND f.ticker IN ({ph})"
            " ORDER BY f.observed_at DESC LIMIT ?",
            (user_id, *symbols, limit),
        ).fetchall()
    else:
        return []
    return [_row_to_fact(r) for r in rows]


def _documents_for_symbols(
    user_id: str, symbols: list[str], limit: int, conn: sqlite3.Connection,
) -> list[dict[str, Any]]:
    """Wave I — the bounded "Documents" section. Membership derives entirely
    through the OWNING note's existing ticker/embed/mention relationship
    (checkpoint decision: "a document never carries its own ticker
    metadata") -- the SAME predicate shape `_notes_for_symbols` uses, joined
    to j2_note_documents instead of returned as note rows. Independent of
    the Notes section's own 5-item cap: a PDF on an older note not in that
    list must still surface here."""
    if not symbols:
        return []
    ph = ",".join("?" * len(symbols))
    rows = conn.execute(
        "SELECT DISTINCT d.id, d.note_id, d.attachment_url, d.name, d.status,"
        " d.page_count, d.created_at"
        " FROM j2_note_documents d"
        " JOIN j2_notes n ON n.id = d.note_id AND n.user_id = d.user_id"
        " WHERE d.user_id = ? AND n.deleted_at IS NULL"
        f" AND (n.ticker IN ({ph})"
        f" OR EXISTS (SELECT 1 FROM j2_note_embeds e WHERE e.note_id = n.id AND e.user_id = n.user_id AND e.symbol IN ({ph}))"
        f" OR EXISTS (SELECT 1 FROM j2_note_mentions m WHERE m.note_id = n.id AND m.user_id = n.user_id AND m.symbol IN ({ph})))"
        " ORDER BY d.created_at DESC LIMIT ?",
        (user_id, *symbols, *symbols, *symbols, limit),
    ).fetchall()
    return [{
        "id": r["id"], "noteId": r["note_id"], "attachmentUrl": r["attachment_url"],
        "name": r["name"], "status": r["status"], "pageCount": r["page_count"],
        "createdAt": r["created_at"],
    } for r in rows]


def _trade_position_summary(user_id: str, symbols: list[str], conn: sqlite3.Connection) -> dict[str, Any]:
    """Counts only (checkpoint decision 22) -- never an execution ledger.
    Positions/trades carry their OWN `symbol` column directly; no note
    traversal needed for this summary."""
    if not symbols:
        return {"openPositions": 0, "closedTrades": 0}
    ph = ",".join("?" * len(symbols))
    open_row = conn.execute(
        f"SELECT COUNT(*) AS c FROM j2_positions WHERE user_id = ? AND symbol IN ({ph}) AND closed_at IS NULL",
        (user_id, *symbols),
    ).fetchone()
    closed_row = conn.execute(
        f"SELECT COUNT(*) AS c FROM j2_trades WHERE user_id = ? AND symbol IN ({ph})",
        (user_id, *symbols),
    ).fetchone()
    return {
        "openPositions": int(open_row["c"] or 0) if open_row else 0,
        "closedTrades": int(closed_row["c"] or 0) if closed_row else 0,
    }


def get_ticker_research_summary(
    user_id: str, symbol: str, conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """The workspace's ONE aggregated read (checkpoint decision 15) -- bounded
    summary rows only, never full note bodies. `notes` here is the FULL
    membership set (used for the Notes section); `activeTheses`/`pastTheses`
    are derived from that same set, not a second query."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        identity = resolve_research_symbols(symbol)
        symbols = identity["symbols"]
        notes = _notes_for_symbols(user_id, symbols, _NOTES_LIMIT, conn)
        active_theses, past_theses = _theses_for_symbols(user_id, symbols, conn)
        facts = _facts_for_entity(user_id, identity["entityId"], symbols, _FACTS_LIMIT, conn)
        documents = _documents_for_symbols(user_id, symbols, _DOCUMENTS_LIMIT, conn)
        trade_summary = _trade_position_summary(user_id, symbols, conn)
        return {
            "identity": identity,
            "notes": notes,
            "activeTheses": active_theses,
            "pastTheses": past_theses,
            "facts": facts,
            "documents": documents,
            "tradeSummary": trade_summary,
        }
    finally:
        if owned:
            conn.close()
