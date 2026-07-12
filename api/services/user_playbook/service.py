"""
My Playbook — service layer (validation, caps, CRUD).

Every function takes user_id as its FIRST argument, and every SQL
statement includes `AND user_id = ?` (the journal_two/notes.py idiom).
Nested mutations resolve ownership through the row's own user_id column,
never a bare id — a foreign row simply doesn't match, so the router
returns 404 without leaking existence.

Spec: docs/superpowers/specs/2026-07-12-my-playbook-builder-design.md
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
import uuid
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.notes import extract_plain_text

# ── Caps & enums (spec — hard server-side abuse ceiling, MUST ship in v1) ────

MAX_SECTIONS_PER_USER = 30
MAX_ENTRIES_PER_USER = 300
MAX_CHARTS_PER_ENTRY = 10
MAX_NOTE_LINKS_PER_ENTRY = 10
MAX_TITLE_CHARS = 300
MAX_BLURB_CHARS = 500
MAX_BODY_JSON_BYTES = 1_000_000  # notes.py encode-and-measure idiom
MAX_DRAWINGS_BYTES = 200_000
MAX_DRAWING_OBJECTS = 200
MAX_NOTES_CHARS = 5_000  # upb_charts.notes

ACCENTS = {"gold", "green", "blue", "red", "purple", "teal"}
GRADES = {"A+", "A", "B", "C", "F"}
TIMEFRAMES = {"D", "W", "M"}
SCALE_MODES = {"arith", "log"}
YEAR_MIN = 1900
YEAR_MAX = 2100

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SYMBOL_RE = re.compile(r"^[A-Z0-9.\-]{1,16}$")

# clone_setup finds-or-creates this section for "Add to my playbook".
SETUPS_SECTION_TITLE = "My Setups"


class UpbValidationError(ValueError):
    """Raised when a playbook payload is malformed or over a cap."""


def _now() -> int:
    return int(time.time())


# ── Validation ───────────────────────────────────────────────────────────────

def _validate_title(raw: Any, *, required: bool = False) -> str:
    if raw is None:
        raw = ""
    if not isinstance(raw, str):
        raise UpbValidationError("title must be a string")
    t = raw.strip()
    if required and not t:
        raise UpbValidationError("title is required")
    if len(t) > MAX_TITLE_CHARS:
        raise UpbValidationError(f"title exceeds {MAX_TITLE_CHARS} characters")
    return t


def _validate_blurb(raw: Any) -> str:
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise UpbValidationError("blurb must be a string")
    b = raw.strip()
    if len(b) > MAX_BLURB_CHARS:
        raise UpbValidationError(f"blurb exceeds {MAX_BLURB_CHARS} characters")
    return b


def _validate_accent(raw: Any) -> str:
    if not isinstance(raw, str) or raw not in ACCENTS:
        raise UpbValidationError(
            f"accent must be one of: {', '.join(sorted(ACCENTS))}"
        )
    return raw


def _validate_sort_order(raw: Any) -> int:
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise UpbValidationError("sort_order must be an integer")
    return raw


def _validate_body_json(raw: Any) -> dict[str, Any]:
    # Copied from journal_two/notes.py — dict, type=='doc', ≤1MB serialized.
    if raw is None or raw == "":
        return {"type": "doc", "content": []}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            raise UpbValidationError("body_json must be valid JSON")
    if not isinstance(raw, dict):
        raise UpbValidationError("body_json must be an object")
    if raw.get("type") != "doc":
        raise UpbValidationError("body_json must be a TipTap doc")
    serialized = json.dumps(raw)
    if len(serialized.encode("utf-8")) > MAX_BODY_JSON_BYTES:
        raise UpbValidationError("body_json too large (>1MB)")
    return raw


def _validate_drawings(raw: Any) -> str | None:
    """Used by EVERY drawings write (drawings_json AND result_drawings_json):
    json.loads → must be a list → ≤ MAX_DRAWING_OBJECTS objects →
    serialized UTF-8 bytes ≤ MAX_DRAWINGS_BYTES. Returns the canonical
    serialized string (or None to clear)."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            raise UpbValidationError("drawings must be valid JSON")
    else:
        parsed = raw
    if not isinstance(parsed, list):
        raise UpbValidationError("drawings must be a JSON array")
    if len(parsed) > MAX_DRAWING_OBJECTS:
        raise UpbValidationError(
            f"drawings exceed the {MAX_DRAWING_OBJECTS}-object limit"
        )
    serialized = json.dumps(parsed)
    if len(serialized.encode("utf-8")) > MAX_DRAWINGS_BYTES:
        raise UpbValidationError("drawings too large (>200KB)")
    return serialized


def _validate_symbol(raw: Any) -> str:
    if not isinstance(raw, str):
        raise UpbValidationError("symbol is required")
    s = raw.upper().strip()
    if not _SYMBOL_RE.match(s):
        raise UpbValidationError("symbol has invalid characters")
    return s


def _validate_timeframe(raw: Any) -> str:
    if not isinstance(raw, str) or raw not in TIMEFRAMES:
        raise UpbValidationError(
            f"timeframe must be one of: {', '.join(sorted(TIMEFRAMES))}"
        )
    return raw


def _validate_grade(raw: Any) -> str | None:
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str) or raw not in GRADES:
        raise UpbValidationError("grade must be one of: A+, A, B, C, F")
    return raw


def _validate_iso_date(raw: Any, field: str) -> str | None:
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str) or not _ISO_DATE.match(raw):
        raise UpbValidationError(f"{field} must be YYYY-MM-DD")
    return raw


def _validate_year(raw: Any) -> int | None:
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise UpbValidationError("year must be an integer")
    if raw < YEAR_MIN or raw > YEAR_MAX:
        raise UpbValidationError(f"year must be {YEAR_MIN}-{YEAR_MAX}")
    return raw


def _validate_price(raw: Any, field: str) -> float | None:
    if raw is None:
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        raise UpbValidationError(f"{field} must be a number")
    return float(raw)


def _validate_scale_mode(raw: Any) -> str:
    if not isinstance(raw, str) or raw not in SCALE_MODES:
        raise UpbValidationError("scale_mode must be 'arith' or 'log'")
    return raw


def _validate_chart_notes(raw: Any) -> str | None:
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise UpbValidationError("notes must be a string")
    if len(raw) > MAX_NOTES_CHARS:
        raise UpbValidationError(f"notes exceed {MAX_NOTES_CHARS} characters")
    return raw


# ── Row mapping ──────────────────────────────────────────────────────────────

def _row_to_section(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row["title"],
        "blurb": row["blurb"] or "",
        "accent": row["accent"],
        "sort_order": row["sort_order"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_entry(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "section_id": row["section_id"],
        "title": row["title"] or "",
        "body_json": json.loads(row["body_json"] or '{"type":"doc","content":[]}'),
        "body_plain": row["body_plain"] or "",
        "sort_order": row["sort_order"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _row_to_chart(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "entry_id": row["entry_id"],
        "symbol": row["symbol"],
        "timeframe": row["timeframe"],
        "year": row["year"],
        "label_date": row["label_date"],
        "frame_start_date": row["frame_start_date"],
        "result_start_date": row["result_start_date"],
        "result_end_date": row["result_end_date"],
        "entry_price": row["entry_price"],
        "stop_price": row["stop_price"],
        "target_price": row["target_price"],
        "grade": row["grade"],
        "notes": row["notes"],
        "scale_mode": row["scale_mode"],
        "drawings_json": row["drawings_json"],
        "result_drawings_json": row["result_drawings_json"],
        "sort_order": row["sort_order"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


# ── Overview ─────────────────────────────────────────────────────────────────

def overview(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Hub badge + mini-hub in one call: every section with its
    entry_count/chart_count, plus totals. One grouped query — no N+1."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT s.*,
                   COUNT(DISTINCT e.id) AS entry_count,
                   COUNT(DISTINCT c.id) AS chart_count
            FROM upb_sections s
            LEFT JOIN upb_entries e ON e.section_id = s.id AND e.user_id = ?
            LEFT JOIN upb_charts  c ON c.entry_id  = e.id AND c.user_id = ?
            WHERE s.user_id = ?
            GROUP BY s.id
            ORDER BY s.sort_order ASC, s.created_at ASC
            """,
            (user_id, user_id, user_id),
        ).fetchall()
        sections = []
        total_entries = 0
        total_charts = 0
        for r in rows:
            sec = _row_to_section(r)
            sec["entry_count"] = r["entry_count"]
            sec["chart_count"] = r["chart_count"]
            total_entries += r["entry_count"]
            total_charts += r["chart_count"]
            sections.append(sec)
        return {
            "sections": sections,
            "totals": {
                "sections": len(sections),
                "entries": total_entries,
                "charts": total_charts,
            },
        }
    finally:
        if owned:
            conn.close()


# ── Sections CRUD ────────────────────────────────────────────────────────────

def create_section(
    user_id: str,
    payload: dict[str, Any] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    payload = payload or {}
    title = _validate_title(payload.get("title"), required=True)
    blurb = _validate_blurb(payload.get("blurb"))
    accent = _validate_accent(payload.get("accent", "gold"))
    sort_order = _validate_sort_order(payload.get("sort_order", 0))

    owned = conn is None
    conn = conn or get_connection()
    try:
        # Row-cap preflight (spec: COUNT(*) → friendly 400).
        n = conn.execute(
            "SELECT COUNT(*) FROM upb_sections WHERE user_id = ?", (user_id,)
        ).fetchone()[0]
        if n >= MAX_SECTIONS_PER_USER:
            raise UpbValidationError(
                f"You've hit the {MAX_SECTIONS_PER_USER}-section limit — "
                "delete a section to add another"
            )
        new_id = uuid.uuid4().hex
        now = _now()
        conn.execute(
            """
            INSERT INTO upb_sections
                (id, user_id, title, blurb, accent, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (new_id, user_id, title, blurb, accent, sort_order, now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM upb_sections WHERE id = ? AND user_id = ?",
            (new_id, user_id),
        ).fetchone()
        return _row_to_section(row)
    finally:
        if owned:
            conn.close()


def update_section(
    user_id: str,
    section_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Partial update — only keys present in the patch are written."""
    if not isinstance(patch, dict):
        raise UpbValidationError("patch must be an object")
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM upb_sections WHERE id = ? AND user_id = ?",
            (section_id, user_id),
        ).fetchone()
        if existing is None:
            return None

        sets: list[str] = []
        params: list[Any] = []
        if "title" in patch:
            sets.append("title = ?")
            params.append(_validate_title(patch["title"], required=True))
        if "blurb" in patch:
            sets.append("blurb = ?")
            params.append(_validate_blurb(patch["blurb"]))
        if "accent" in patch:
            sets.append("accent = ?")
            params.append(_validate_accent(patch["accent"]))
        if "sort_order" in patch:
            sets.append("sort_order = ?")
            params.append(_validate_sort_order(patch["sort_order"]))

        if not sets:
            return _row_to_section(existing)

        sets.append("updated_at = ?")
        params.append(_now())
        params.extend([section_id, user_id])
        conn.execute(
            f"UPDATE upb_sections SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
            params,
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM upb_sections WHERE id = ? AND user_id = ?",
            (section_id, user_id),
        ).fetchone()
        return _row_to_section(row)
    finally:
        if owned:
            conn.close()


def delete_section(
    user_id: str,
    section_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """FK cascade removes the section's entries → charts → note links."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM upb_sections WHERE id = ? AND user_id = ?",
            (section_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


# ── Entries ──────────────────────────────────────────────────────────────────

def _section_exists(conn: sqlite3.Connection, user_id: str, section_id: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM upb_sections WHERE id = ? AND user_id = ?",
        (section_id, user_id),
    ).fetchone() is not None


def list_entries(
    user_id: str,
    section_id: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]] | None:
    """Lean rows for the section screen (snippet, not the full body).
    Returns None when the section isn't the caller's (router → 404)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        if not _section_exists(conn, user_id, section_id):
            return None
        rows = conn.execute(
            """
            SELECT e.id, e.title, substr(e.body_plain, 1, 200) AS snippet,
                   e.sort_order, e.updated_at,
                   COUNT(DISTINCT c.id)  AS chart_count,
                   COUNT(DISTINCT nl.id) AS note_link_count
            FROM upb_entries e
            LEFT JOIN upb_charts     c  ON c.entry_id  = e.id AND c.user_id = ?
            LEFT JOIN upb_note_links nl ON nl.entry_id = e.id AND nl.user_id = ?
            WHERE e.user_id = ? AND e.section_id = ?
            GROUP BY e.id
            ORDER BY e.sort_order ASC, e.created_at ASC
            """,
            (user_id, user_id, user_id, section_id),
        ).fetchall()
        return [
            {
                "id": r["id"],
                "title": r["title"] or "",
                "snippet": r["snippet"] or "",
                "chart_count": r["chart_count"],
                "note_link_count": r["note_link_count"],
                "sort_order": r["sort_order"],
                "updated_at": r["updated_at"],
            }
            for r in rows
        ]
    finally:
        if owned:
            conn.close()


def create_entry(
    user_id: str,
    section_id: str,
    payload: dict[str, Any] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    payload = payload or {}
    title = _validate_title(payload.get("title"))
    body_json = _validate_body_json(payload.get("body_json"))
    body_plain = extract_plain_text(body_json)
    sort_order = _validate_sort_order(payload.get("sort_order", 0))

    owned = conn is None
    conn = conn or get_connection()
    try:
        if not _section_exists(conn, user_id, section_id):
            return None
        # Per-USER row cap (not per-section) — the overall abuse ceiling.
        n = conn.execute(
            "SELECT COUNT(*) FROM upb_entries WHERE user_id = ?", (user_id,)
        ).fetchone()[0]
        if n >= MAX_ENTRIES_PER_USER:
            raise UpbValidationError(
                f"You've hit the {MAX_ENTRIES_PER_USER}-entry limit — "
                "delete an entry to add another"
            )
        new_id = uuid.uuid4().hex
        now = _now()
        conn.execute(
            """
            INSERT INTO upb_entries
                (id, user_id, section_id, title, body_json, body_plain,
                 sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (new_id, user_id, section_id, title, json.dumps(body_json),
             body_plain, sort_order, now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM upb_entries WHERE id = ? AND user_id = ?",
            (new_id, user_id),
        ).fetchone()
        return _row_to_entry(row)
    finally:
        if owned:
            conn.close()


def _note_links_for_entry(
    conn: sqlite3.Connection, user_id: str, entry_id: str
) -> list[dict[str, Any]]:
    """Note links with liveness in ONE LEFT JOIN (no N+1). A dead link
    (Notebook note deleted) keeps its title_snapshot + live: false."""
    rows = conn.execute(
        """
        SELECT nl.note_id, nl.title_snapshot, n.id AS live_id, n.title AS live_title
        FROM upb_note_links nl
        LEFT JOIN j2_notes n ON n.id = nl.note_id AND n.user_id = ?
        WHERE nl.entry_id = ? AND nl.user_id = ?
        ORDER BY nl.sort_order ASC, nl.created_at ASC
        """,
        (user_id, entry_id, user_id),
    ).fetchall()
    return [
        {
            "noteId": r["note_id"],
            "title": (r["live_title"] if r["live_id"] else r["title_snapshot"]) or "",
            "live": r["live_id"] is not None,
        }
        for r in rows
    ]


def get_entry_detail(
    user_id: str,
    entry_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM upb_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        ).fetchone()
        if row is None:
            return None
        entry = _row_to_entry(row)
        chart_rows = conn.execute(
            "SELECT * FROM upb_charts WHERE entry_id = ? AND user_id = ? "
            "ORDER BY sort_order ASC, created_at ASC",
            (entry_id, user_id),
        ).fetchall()
        entry["charts"] = [_row_to_chart(r) for r in chart_rows]
        entry["note_links"] = _note_links_for_entry(conn, user_id, entry_id)
        return entry
    finally:
        if owned:
            conn.close()


def update_entry(
    user_id: str,
    entry_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Partial update — only keys present in the patch are written.
    A body_json write re-extracts body_plain."""
    if not isinstance(patch, dict):
        raise UpbValidationError("patch must be an object")
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM upb_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        ).fetchone()
        if existing is None:
            return None

        sets: list[str] = []
        params: list[Any] = []
        if "title" in patch:
            sets.append("title = ?")
            params.append(_validate_title(patch["title"]))
        if "body_json" in patch:
            bj = _validate_body_json(patch["body_json"])
            sets.append("body_json = ?")
            params.append(json.dumps(bj))
            sets.append("body_plain = ?")
            params.append(extract_plain_text(bj))
        if "sort_order" in patch:
            sets.append("sort_order = ?")
            params.append(_validate_sort_order(patch["sort_order"]))

        if not sets:
            return _row_to_entry(existing)

        sets.append("updated_at = ?")
        params.append(_now())
        params.extend([entry_id, user_id])
        conn.execute(
            f"UPDATE upb_entries SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
            params,
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM upb_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        ).fetchone()
        return _row_to_entry(row)
    finally:
        if owned:
            conn.close()


def delete_entry(
    user_id: str,
    entry_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """FK cascade removes the entry's charts + note links."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM upb_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


# ── Charts ───────────────────────────────────────────────────────────────────

def _entry_exists(conn: sqlite3.Connection, user_id: str, entry_id: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM upb_entries WHERE id = ? AND user_id = ?",
        (entry_id, user_id),
    ).fetchone() is not None


def create_chart(
    user_id: str,
    entry_id: str,
    payload: dict[str, Any] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    payload = payload or {}
    symbol = _validate_symbol(payload.get("symbol"))
    timeframe = _validate_timeframe(payload.get("timeframe", "D"))
    year = _validate_year(payload.get("year"))
    label_date = _validate_iso_date(payload.get("label_date"), "label_date")
    frame_start = _validate_iso_date(payload.get("frame_start_date"), "frame_start_date")
    result_start = _validate_iso_date(payload.get("result_start_date"), "result_start_date")
    result_end = _validate_iso_date(payload.get("result_end_date"), "result_end_date")
    entry_price = _validate_price(payload.get("entry_price"), "entry_price")
    stop_price = _validate_price(payload.get("stop_price"), "stop_price")
    target_price = _validate_price(payload.get("target_price"), "target_price")
    grade = _validate_grade(payload.get("grade"))
    notes = _validate_chart_notes(payload.get("notes"))
    scale_mode = _validate_scale_mode(payload.get("scale_mode", "arith"))
    drawings = _validate_drawings(payload.get("drawings_json"))
    result_drawings = _validate_drawings(payload.get("result_drawings_json"))
    sort_order = _validate_sort_order(payload.get("sort_order", 0))

    owned = conn is None
    conn = conn or get_connection()
    try:
        if not _entry_exists(conn, user_id, entry_id):
            return None
        n = conn.execute(
            "SELECT COUNT(*) FROM upb_charts WHERE entry_id = ? AND user_id = ?",
            (entry_id, user_id),
        ).fetchone()[0]
        if n >= MAX_CHARTS_PER_ENTRY:
            raise UpbValidationError(
                f"This entry already has {MAX_CHARTS_PER_ENTRY} charts — "
                "remove one to add another"
            )
        new_id = uuid.uuid4().hex
        now = _now()
        conn.execute(
            """
            INSERT INTO upb_charts
                (id, user_id, entry_id, symbol, timeframe, year, label_date,
                 frame_start_date, result_start_date, result_end_date,
                 entry_price, stop_price, target_price, grade, notes,
                 scale_mode, drawings_json, result_drawings_json,
                 sort_order, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (new_id, user_id, entry_id, symbol, timeframe, year, label_date,
             frame_start, result_start, result_end,
             entry_price, stop_price, target_price, grade, notes,
             scale_mode, drawings, result_drawings, sort_order, now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM upb_charts WHERE id = ? AND user_id = ?",
            (new_id, user_id),
        ).fetchone()
        return _row_to_chart(row)
    finally:
        if owned:
            conn.close()


# Per-field validators for the partial chart update. Each takes the raw
# incoming value and returns the storable value (raises UpbValidationError).
_CHART_PATCH_VALIDATORS: dict[str, Any] = {
    "symbol": _validate_symbol,
    "timeframe": _validate_timeframe,
    "year": _validate_year,
    "label_date": lambda v: _validate_iso_date(v, "label_date"),
    "frame_start_date": lambda v: _validate_iso_date(v, "frame_start_date"),
    "result_start_date": lambda v: _validate_iso_date(v, "result_start_date"),
    "result_end_date": lambda v: _validate_iso_date(v, "result_end_date"),
    "entry_price": lambda v: _validate_price(v, "entry_price"),
    "stop_price": lambda v: _validate_price(v, "stop_price"),
    "target_price": lambda v: _validate_price(v, "target_price"),
    "grade": _validate_grade,
    "notes": _validate_chart_notes,
    "scale_mode": _validate_scale_mode,
    "drawings_json": _validate_drawings,
    "result_drawings_json": _validate_drawings,
    "sort_order": _validate_sort_order,
}


def update_chart(
    user_id: str,
    chart_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Partial update with the same validators as create — the annotate
    save PUTs ONLY {drawings_json} (or {result_drawings_json}) and must
    not disturb any other field."""
    if not isinstance(patch, dict):
        raise UpbValidationError("patch must be an object")
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM upb_charts WHERE id = ? AND user_id = ?",
            (chart_id, user_id),
        ).fetchone()
        if existing is None:
            return None

        sets: list[str] = []
        params: list[Any] = []
        for field, validator in _CHART_PATCH_VALIDATORS.items():
            if field in patch:
                sets.append(f"{field} = ?")
                params.append(validator(patch[field]))

        if not sets:
            return _row_to_chart(existing)

        sets.append("updated_at = ?")
        params.append(_now())
        params.extend([chart_id, user_id])
        conn.execute(
            f"UPDATE upb_charts SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
            params,
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM upb_charts WHERE id = ? AND user_id = ?",
            (chart_id, user_id),
        ).fetchone()
        return _row_to_chart(row)
    finally:
        if owned:
            conn.close()


def delete_chart(
    user_id: str,
    chart_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM upb_charts WHERE id = ? AND user_id = ?",
            (chart_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


# ── Note links (replace-set semantics) ───────────────────────────────────────

def replace_note_links(
    user_id: str,
    entry_id: str,
    note_ids: Any,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]] | None:
    """Replace the entry's Notebook links with the given ordered set.
    Every id is ownership-checked against j2_notes (the folder-check
    idiom) and its title snapshotted at link time. Delete-then-insert in
    one transaction. Returns None when the entry isn't the caller's."""
    if not isinstance(note_ids, list) or not all(isinstance(n, str) for n in note_ids):
        raise UpbValidationError("note_ids must be a list of ids")
    # Dedupe preserving order (UNIQUE(entry_id, note_id) would reject dups).
    deduped: list[str] = []
    seen: set[str] = set()
    for nid in note_ids:
        if nid not in seen:
            seen.add(nid)
            deduped.append(nid)
    if len(deduped) > MAX_NOTE_LINKS_PER_ENTRY:
        raise UpbValidationError(
            f"An entry can link at most {MAX_NOTE_LINKS_PER_ENTRY} notes"
        )

    owned = conn is None
    conn = conn or get_connection()
    try:
        if not _entry_exists(conn, user_id, entry_id):
            return None
        # Ownership check + title snapshot per note, before any write.
        titles: dict[str, str] = {}
        for nid in deduped:
            row = conn.execute(
                "SELECT title FROM j2_notes WHERE id = ? AND user_id = ?",
                (nid, user_id),
            ).fetchone()
            if row is None:
                raise UpbValidationError("note not found")
            titles[nid] = row["title"] or ""

        now = _now()
        conn.execute(
            "DELETE FROM upb_note_links WHERE entry_id = ? AND user_id = ?",
            (entry_id, user_id),
        )
        conn.executemany(
            """
            INSERT INTO upb_note_links
                (id, user_id, entry_id, note_id, title_snapshot, sort_order, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (uuid.uuid4().hex, user_id, entry_id, nid, titles[nid], i, now)
                for i, nid in enumerate(deduped)
            ],
        )
        conn.commit()
        return _note_links_for_entry(conn, user_id, entry_id)
    finally:
        if owned:
            conn.close()


# ── Clone setup ("Add to my playbook" on the firm's Setup Library) ───────────

def _scaffold_body() -> dict[str, Any]:
    """TipTap doc scaffold for a cloned setup entry — three prompts the
    member fills in with their own words."""
    def heading(text: str) -> dict[str, Any]:
        return {
            "type": "heading",
            "attrs": {"level": 3},
            "content": [{"type": "text", "text": text}],
        }

    def paragraph() -> dict[str, Any]:
        return {"type": "paragraph"}

    return {
        "type": "doc",
        "content": [
            heading("When I trade this"), paragraph(),
            heading("My entry criteria"), paragraph(),
            heading("My mistakes"), paragraph(),
        ],
    }


def clone_setup(
    user_id: str,
    setup_name: Any,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Find-or-create the user's 'My Setups' section, then create an entry
    pre-titled with the firm setup's name and a scaffold body."""
    title = _validate_title(setup_name, required=True)

    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM upb_sections WHERE user_id = ? AND title = ?",
            (user_id, SETUPS_SECTION_TITLE),
        ).fetchone()
        if row is not None:
            section = _row_to_section(row)
        else:
            section = create_section(
                user_id,
                {
                    "title": SETUPS_SECTION_TITLE,
                    "blurb": "Setups from the firm's library, rewritten in my words.",
                    "accent": "gold",
                },
                conn=conn,
            )
        entry = create_entry(
            user_id,
            section["id"],
            {"title": title, "body_json": json.dumps(_scaffold_body())},
            conn=conn,
        )
        return {"section": section, "entry": entry}
    finally:
        if owned:
            conn.close()
