"""Wave H — Research Home read model.

ONE aggregated, bounded read over Wave B/E/G's own existing tables (checkpoint
decision 14) — no new storage, no new query mechanism. Every section reuses
an already-shipped primitive verbatim: `list_favorites`/`list_recents` (Wave
B), `property_filter_sql` via `list_notes` (Wave E, the SAME predicates
Wave G's own starter saved views already use for Active Theses/Needs Review),
and a new direct SQL join for open-position research (checkpoint decision 17
-- never a per-position `resolve_trade_ref` loop, which would be N+1).

Each section is bounded (default 5) and independently best-effort: one
section's query failing must never blank the rest of Home (checkpoint
decision 36) -- `get_notebook_home` itself catches per-section, so a single
malformed property value or a locked-table hiccup on one section degrades
that section to an empty list rather than 500ing the whole surface.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

_HOME_SECTION_LIMIT = 5


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _active_theses(user_id: str, limit: int, conn: sqlite3.Connection) -> list[dict[str, Any]]:
    from api.services.journal_two.notes import list_notes
    return list_notes(
        user_id,
        property_filter=[{"propertyId": "builtin:thesis_status", "op": "eq", "value": "active"}],
        sort="updated", limit=limit, conn=conn,
    )


def _needs_review(user_id: str, limit: int, conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """`review_date <= today AND thesis_status != 'closed'` (checkpoint
    decision 18) -- but `property_filter_sql`'s AND-only `neq` compiles to a
    plain SQL `!=`, which (correctly, standard SQL) excludes a NULL
    `thesis_status` rather than treating "never set" as "not closed." Most
    review-due notes have no status set at all, so the SQL-only form would
    silently under-report. Fetched via the ONE filter `property_filter_sql`
    CAN express (review_date), then the closed-exclusion is applied in
    Python over a generously-capped fetch -- same "fetch a superset, filter
    the OR-shaped part locally" pattern `ticker_research._theses_for_symbols`
    already uses for the identical AND-only-filter limitation."""
    from api.services.journal_two.notes import list_notes
    due = list_notes(
        user_id,
        property_filter=[{"propertyId": "builtin:review_date", "op": "lte", "value": _today_iso()}],
        sort="updated", limit=200, conn=conn,
    )
    not_closed = [n for n in due if (n.get("propertiesJson") or {}).get("builtin:thesis_status") != "closed"]
    return not_closed[:limit]


def _open_position_research(user_id: str, limit: int, conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """Checkpoint decision 17: a direct join, never a per-position
    `resolve_trade_ref` loop. An `equity_trade`-typed embed is structurally
    never an open position (Wave 3: a j2_trades row only exists once a
    position has closed into it), so `trade_ref_type = 'position'` +
    `closed_at IS NULL` is exact, not an approximation.

    Table-qualified column list (own copy, not `_NOTE_SUMMARY_COLS`) because
    a 3-table join makes `id`/`user_id` genuinely ambiguous -- `j2_positions`
    and `j2_notes` both have an `id` and a `user_id` column."""
    from api.services.journal_two.notes import _row_to_note_summary, _LIST_PLAIN_CHARS
    rows = conn.execute(
        "SELECT DISTINCT n.id, n.user_id, n.account_id, n.folder_id, n.title, n.subtitle,"
        f" substr(coalesce(n.body_plain, ''), 1, {_LIST_PLAIN_CHARS}) AS body_plain,"
        " n.hero_image_url, n.first_image_url, n.ticker, n.tags, n.created_at, n.updated_at,"
        " n.deleted_at, n.properties_json"
        " FROM j2_positions p"
        " JOIN j2_note_embeds e ON e.trade_ref = p.id AND e.trade_ref_type = 'position'"
        "   AND e.user_id = p.user_id"
        " JOIN j2_notes n ON n.id = e.note_id AND n.user_id = e.user_id"
        " WHERE p.user_id = ? AND p.closed_at IS NULL AND n.deleted_at IS NULL"
        " ORDER BY n.updated_at DESC LIMIT ?",
        (user_id, limit),
    ).fetchall()
    return [_row_to_note_summary(r) for r in rows]


def get_notebook_home(user_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Checkpoint decision 11/14: four sections, each bounded and derived --
    Continue Working (Recents), Favorites, Active Theses, Open-Position
    Research, Needs Review. Deliberately no "Upcoming Catalysts"/"Recent
    Captures" (decision 12/19/20 -- explicitly deferred, not silently
    dropped)."""
    from api.services.journal_two.notes import list_favorites, list_recents

    owned = conn is None
    conn = conn or get_connection()

    def _safe(fn, *args):
        try:
            return fn(*args)
        except Exception:  # noqa: BLE001 -- one section's failure must never blank the rest of Home
            return []

    try:
        return {
            "continueWorking": _safe(list_recents, user_id, _HOME_SECTION_LIMIT, conn),
            "favorites": _safe(list_favorites, user_id, _HOME_SECTION_LIMIT, conn),
            "activeTheses": _safe(_active_theses, user_id, _HOME_SECTION_LIMIT, conn),
            "openPositionResearch": _safe(_open_position_research, user_id, _HOME_SECTION_LIMIT, conn),
            "needsReview": _safe(_needs_review, user_id, _HOME_SECTION_LIMIT, conn),
        }
    finally:
        if owned:
            conn.close()
