"""Wave E (Structured Research Properties / Saved Views) — property
definitions, per-note values, derived (computed, never-stored) properties,
and saved views.

Architecture (see the Wave E entry checkpoint in
docs/notebook/prelaunch-primary-notebook-build-plan.md for the full
reasoning): a normalized `j2_note_property_defs` (durable, server-minted
`id`/`key`, user-editable `name`) + a narrow `j2_note_property_values`
(one row per note x property actually SET) + `j2_note_saved_views`
(query configuration referencing property_def ids, never display names).

Rename-safety is structural: `value_json` for select/multi_select stores
OPTION IDS, never option label strings, so renaming a property's `name` or
an option's `label` is a pure metadata UPDATE that never touches a value
row or a saved view's filter_json -- the exact same guarantee Wave D's
`noteLink.attrs.noteId` gives note links.
"""
from __future__ import annotations

import json
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PropertyValidationError(ValueError):
    """A property/value/saved-view request failed validation -- the router
    maps this to 400, never a 500."""


PROPERTY_TYPES = ("text", "number", "select", "multi_select", "date", "checkbox", "url")
_URL_SCHEME_RE = re.compile(r"^https?://", re.IGNORECASE)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# Derived (computed, never stored) built-in properties -- resolved at read
# time from the note's own `ticker` field via the SAME ticker_meta lookup
# Wave A's sector/theme search filter already relies on. Never appear as
# rows in j2_note_property_defs; surfaced as a fixed, synthetic def shape
# so the frontend renders them identically to a real (but read-only) property.
_DERIVED_BUILTIN_DEFS = (
    {"id": "__sector__", "key": "__sector__", "name": "Sector", "type": "text",
     "options_json": "[]", "is_builtin": True, "derived": True, "sort_order": -3},
    {"id": "__industry__", "key": "__industry__", "name": "Industry", "type": "text",
     "options_json": "[]", "is_builtin": True, "derived": True, "sort_order": -2},
    {"id": "__theme__", "key": "__theme__", "name": "Theme", "type": "text",
     "options_json": "[]", "is_builtin": True, "derived": True, "sort_order": -1},
)


def _row_to_def(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": r["id"], "key": r["key"], "name": r["name"], "type": r["type"],
        "options": json.loads(r["options_json"] or "[]"),
        "isBuiltin": bool(r["is_builtin"]), "derived": bool(r["derived"]),
        "sortOrder": r["sort_order"], "createdAt": r["created_at"],
    }


def list_property_defs(
    user_id: str, *, include_derived: bool = True, conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Every live (non-deleted) property definition this user owns, plus the
    synthetic derived built-ins (Sector/Industry/Theme) unless the caller
    only wants real, storable definitions (e.g. building a saved view's
    property picker for VALUE-based conditions, where a derived property
    still applies -- so callers generally want include_derived=True; the
    flag exists for the rare caller that only cares about editable defs)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT id, key, name, type, options_json, is_builtin, derived, sort_order, created_at"
            " FROM j2_note_property_defs WHERE user_id = ? AND deleted_at IS NULL"
            " ORDER BY sort_order, created_at",
            (user_id,),
        ).fetchall()
        out = [_row_to_def(r) for r in rows]
        if include_derived:
            out = list(_DERIVED_BUILTIN_DEFS) + out
        return out
    finally:
        if owned:
            conn.close()


def _validate_options(type_: str, options: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if type_ not in ("select", "multi_select"):
        return []
    options = options or []
    seen_ids = set()
    out = []
    for opt in options:
        if not isinstance(opt, dict):
            raise PropertyValidationError("Each option must be an object")
        label = (opt.get("label") or "").strip()
        if not label:
            raise PropertyValidationError("Every option needs a non-empty label")
        opt_id = opt.get("id") or uuid.uuid4().hex
        if opt_id in seen_ids:
            raise PropertyValidationError("Duplicate option id")
        seen_ids.add(opt_id)
        out.append({"id": opt_id, "label": label, "color": opt.get("color") or None})
    return out


def create_property_def(
    user_id: str, payload: dict[str, Any], conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    name = (payload.get("name") or "").strip()
    type_ = payload.get("type")
    if not name:
        raise PropertyValidationError("Property name is required")
    if type_ not in PROPERTY_TYPES:
        raise PropertyValidationError(f"Unknown property type: {type_!r}")
    options = _validate_options(type_, payload.get("options"))
    owned = conn is None
    conn = conn or get_connection()
    try:
        def_id = uuid.uuid4().hex
        key = uuid.uuid4().hex  # stable, never derived from name -- checkpoint point 7
        now = _now_iso()
        max_row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) AS m FROM j2_note_property_defs WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        sort_order = (max_row["m"] or -1) + 1
        conn.execute(
            "INSERT INTO j2_note_property_defs"
            " (id, user_id, key, name, type, options_json, is_builtin, derived, sort_order, created_at)"
            " VALUES (?,?,?,?,?,?,?,0,?,?)",
            (def_id, user_id, key, name, type_, json.dumps(options),
             1 if payload.get("isBuiltin") else 0, sort_order, now),
        )
        conn.commit()
        return get_property_def(user_id, def_id, conn=conn)
    finally:
        if owned:
            conn.close()


def get_property_def(
    user_id: str, def_id: str, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = conn.execute(
            "SELECT id, key, name, type, options_json, is_builtin, derived, sort_order, created_at"
            " FROM j2_note_property_defs WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
            (user_id, def_id),
        ).fetchone()
        return _row_to_def(r) if r else None
    finally:
        if owned:
            conn.close()


def update_property_def(
    user_id: str, def_id: str, patch: dict[str, Any], conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Rename the display name and/or edit the option list (add/rename/
    recolor options in place, by id). Renaming an option's label is the
    same pure-metadata operation as renaming the property itself -- no
    value row or saved view is touched (checkpoint point 7). Removing an
    option from the list is allowed (checkpoint point 23: a value
    referencing a now-missing option renders as a "removed option" state at
    read time, the value row itself is never rewritten or deleted here)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = get_property_def(user_id, def_id, conn=conn)
        if existing is None:
            return None
        name = existing["name"]
        if "name" in patch:
            new_name = (patch["name"] or "").strip()
            if not new_name:
                raise PropertyValidationError("Property name cannot be blank")
            name = new_name
        options_json = json.dumps(existing["options"])
        if "options" in patch:
            options_json = json.dumps(_validate_options(existing["type"], patch["options"]))
        conn.execute(
            "UPDATE j2_note_property_defs SET name = ?, options_json = ?"
            " WHERE user_id = ? AND id = ?",
            (name, options_json, user_id, def_id),
        )
        conn.commit()
        return get_property_def(user_id, def_id, conn=conn)
    finally:
        if owned:
            conn.close()


def delete_property_def(
    user_id: str, def_id: str, conn: sqlite3.Connection | None = None,
) -> bool:
    """Soft delete (checkpoint point 23) -- values are left in place
    (hidden from the UI by the def no longer appearing in list_property_defs)
    so a restore window exists before the periodic purge sweep hard-deletes
    it (mirroring j2_notes' own trash pattern)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_note_property_defs SET deleted_at = ?"
            " WHERE user_id = ? AND id = ? AND deleted_at IS NULL",
            (_now_iso(), user_id, def_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


# ── Values ────────────────────────────────────────────────────────────────

def _validate_value(type_: str, options: list[dict[str, Any]], value: Any) -> Any:
    """Returns the value in its canonical storage shape, or raises
    PropertyValidationError. A rejected value 400s the save rather than
    silently storing malformed data (checkpoint point 31)."""
    if value is None:
        return None
    if type_ == "text" or type_ == "url":
        if not isinstance(value, str):
            raise PropertyValidationError(f"{type_} value must be a string")
        if type_ == "url" and value and not _URL_SCHEME_RE.match(value):
            raise PropertyValidationError("URL must start with http:// or https://")
        return value
    if type_ == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise PropertyValidationError("Number value must be numeric")
        return value
    if type_ == "checkbox":
        if not isinstance(value, bool):
            raise PropertyValidationError("Checkbox value must be a boolean")
        return value
    if type_ == "date":
        if not isinstance(value, str) or not _DATE_RE.match(value):
            raise PropertyValidationError("Date value must be YYYY-MM-DD")
        return value
    if type_ == "select":
        if not isinstance(value, str):
            raise PropertyValidationError("Select value must be an option id")
        valid_ids = {o["id"] for o in options}
        if value not in valid_ids:
            raise PropertyValidationError("Unknown option id for this property")
        return value
    if type_ == "multi_select":
        if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
            raise PropertyValidationError("Multi-select value must be a list of option ids")
        valid_ids = {o["id"] for o in options}
        bad = [v for v in value if v not in valid_ids]
        if bad:
            raise PropertyValidationError("Unknown option id for this property")
        return value
    raise PropertyValidationError(f"Unknown property type: {type_!r}")


def set_note_property_value(
    user_id: str, note_id: str, def_id: str, value: Any,
    conn: sqlite3.Connection | None = None,
) -> None:
    """`value=None` deletes the row (an unset property has no row, never a
    NULL-valued one -- checkpoint point 32)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        prop = get_property_def(user_id, def_id, conn=conn)
        if prop is None:
            raise PropertyValidationError("Unknown property")
        if prop["derived"]:
            raise PropertyValidationError("Derived properties cannot be set directly")
        canon = _validate_value(prop["type"], prop["options"], value)
        if canon is None:
            conn.execute(
                "DELETE FROM j2_note_property_values WHERE user_id = ? AND note_id = ? AND property_def_id = ?",
                (user_id, note_id, def_id),
            )
        else:
            conn.execute(
                "INSERT INTO j2_note_property_values (note_id, user_id, property_def_id, value_json, updated_at)"
                " VALUES (?,?,?,?,?)"
                " ON CONFLICT(note_id, property_def_id) DO UPDATE SET value_json = excluded.value_json,"
                " updated_at = excluded.updated_at",
                (note_id, user_id, def_id, json.dumps(canon), _now_iso()),
            )
        conn.commit()
    finally:
        if owned:
            conn.close()


def _resolve_derived_values(ticker: str | None) -> dict[str, str | None]:
    """{'__sector__': ..., '__industry__': ..., '__theme__': ...} for one
    note's own ticker. Never raises -- a provider hiccup on one ticker
    degrades to blank derived properties for that note, same tolerance as
    Wave A's resolve_sector_theme_symbols."""
    out = {"__sector__": None, "__industry__": None, "__theme__": None}
    if not ticker:
        return out
    try:
        from api.services.ticker_meta import get_ticker_meta
        meta = get_ticker_meta(ticker)
        out["__sector__"] = meta.get("sector") or None
        out["__industry__"] = meta.get("industry") or None
        out["__theme__"] = meta.get("theme") or None
    except Exception:
        pass
    return out


def get_note_properties(
    user_id: str, note_id: str, ticker: str | None, conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Every property this note carries a value for (real, non-derived
    properties only get a row if the member actually set one -- an unset
    property is simply absent from the returned list, matching how Wave D's
    backlinks section renders nothing rather than an empty placeholder),
    PLUS the three derived properties whenever they resolve to a non-blank
    value. Each entry: {defId, key, name, type, options, value, derived}."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        defs_by_id = {d["id"]: d for d in list_property_defs(user_id, include_derived=False, conn=conn)}
        rows = conn.execute(
            "SELECT property_def_id, value_json FROM j2_note_property_values"
            " WHERE user_id = ? AND note_id = ?",
            (user_id, note_id),
        ).fetchall()
        out: list[dict[str, Any]] = []
        for r in rows:
            d = defs_by_id.get(r["property_def_id"])
            if d is None:
                continue  # def soft-deleted -- value hidden, not surfaced (checkpoint 23)
            out.append({
                "defId": d["id"], "key": d["key"], "name": d["name"], "type": d["type"],
                "options": d["options"], "value": json.loads(r["value_json"]), "derived": False,
            })
        derived = _resolve_derived_values(ticker)
        for dd in _DERIVED_BUILTIN_DEFS:
            val = derived.get(dd["key"])
            if val:
                out.append({
                    "defId": dd["id"], "key": dd["key"], "name": dd["name"], "type": dd["type"],
                    "options": [], "value": val, "derived": True,
                })
        out.sort(key=lambda p: (0 if p["derived"] else 1, defs_by_id.get(p["defId"], {}).get("sortOrder", 0)))
        return out
    finally:
        if owned:
            conn.close()


def get_note_properties_batch(
    user_id: str, note_ids: list[str], tickers_by_note: dict[str, str | None],
    conn: sqlite3.Connection | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Property entries for MANY notes in one call -- the Table view's own
    page of notes needs every visible note's property values, and a naive
    per-row `get_note_properties` call would cost one request per row
    (directive §37/§65's own N+1 concern, same shape Wave D's
    `resolve_note_link_targets` batch already solved). ONE query for values
    + derived properties resolved once per DISTINCT ticker across the batch
    (mirrors notes_export.py's `_resolve_note_related_data`)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        ids = [i for i in dict.fromkeys(note_ids) if isinstance(i, str) and i]
        if not ids:
            return {}
        defs_by_id = {d["id"]: d for d in list_property_defs(user_id, include_derived=False, conn=conn)}
        placeholders = ",".join("?" * len(ids))
        rows = conn.execute(
            f"SELECT note_id, property_def_id, value_json FROM j2_note_property_values"
            f" WHERE user_id = ? AND note_id IN ({placeholders})",
            (user_id, *ids),
        ).fetchall()
        out: dict[str, list[dict[str, Any]]] = {}
        for r in rows:
            d = defs_by_id.get(r["property_def_id"])
            if d is None:
                continue
            out.setdefault(r["note_id"], []).append({
                "defId": d["id"], "key": d["key"], "name": d["name"], "type": d["type"],
                "options": d["options"], "value": json.loads(r["value_json"]), "derived": False,
            })
        distinct_tickers = {t for t in tickers_by_note.values() if t}
        derived_by_ticker = {t: _resolve_derived_values(t) for t in distinct_tickers}
        for nid in ids:
            ticker = tickers_by_note.get(nid)
            derived = derived_by_ticker.get(ticker, {}) if ticker else {}
            for dd in _DERIVED_BUILTIN_DEFS:
                val = derived.get(dd["key"])
                if val:
                    out.setdefault(nid, []).append({
                        "defId": dd["id"], "key": dd["key"], "name": dd["name"], "type": dd["type"],
                        "options": [], "value": val, "derived": True,
                    })
        return out
    finally:
        if owned:
            conn.close()


# ── Filter conditions (extends notes._notes_filter_sql) ─────────────────────

_FILTER_OPS = ("eq", "neq", "contains", "gte", "lte", "is_set", "is_not_set")


def property_conditions_sql(
    user_id: str, conditions: list[dict[str, Any]] | None, conn: sqlite3.Connection,
) -> tuple[str, list[Any]]:
    """Builds the `AND EXISTS (...)` fragment(s) for a saved view / ad-hoc
    property filter. AND-only composition (checkpoint point 9) -- each
    condition is independently ANDed onto the caller's existing predicate,
    exactly like every other `_notes_filter_sql` clause.

    SECURITY (checkpoint point 30): every `property_def_id` is re-validated
    against THIS user's own live property defs before being used to build
    SQL -- a condition naming another tenant's def id or a nonexistent one
    is DROPPED (never silently trusted, never used to build a cross-tenant
    query). `filter_json` is client-supplied but is never interpreted as
    raw SQL or executed as-is."""
    if not conditions:
        return "", []
    valid_ids = {d["id"] for d in list_property_defs(user_id, conn=conn)}
    sql = ""
    params: list[Any] = []
    for cond in conditions:
        if not isinstance(cond, dict):
            continue
        def_id = cond.get("propertyDefId")
        op = cond.get("op")
        if def_id not in valid_ids or op not in _FILTER_OPS:
            continue
        if def_id.startswith("__") and def_id.endswith("__"):
            # Derived properties are computed, never stored -- they cannot
            # be filtered via the values EXISTS clause. V1 does not support
            # filtering on a derived property (recorded limitation, not a
            # silent ignore: the condition is simply dropped here).
            continue
        if op == "is_set":
            sql += (" AND EXISTS (SELECT 1 FROM j2_note_property_values pv"
                    " WHERE pv.note_id = j2_notes.id AND pv.user_id = j2_notes.user_id"
                    " AND pv.property_def_id = ?)")
            params.append(def_id)
        elif op == "is_not_set":
            sql += (" AND NOT EXISTS (SELECT 1 FROM j2_note_property_values pv"
                    " WHERE pv.note_id = j2_notes.id AND pv.user_id = j2_notes.user_id"
                    " AND pv.property_def_id = ?)")
            params.append(def_id)
        elif op == "contains":
            val = cond.get("value")
            if not isinstance(val, str) or not val:
                continue
            sql += (" AND EXISTS (SELECT 1 FROM j2_note_property_values pv"
                    " WHERE pv.note_id = j2_notes.id AND pv.user_id = j2_notes.user_id"
                    " AND pv.property_def_id = ? AND pv.value_json LIKE ?)")
            params.append(def_id)
            params.append(f'%{val}%')
        elif op in ("gte", "lte"):
            val = cond.get("value")
            if val is None:
                continue
            operator = ">=" if op == "gte" else "<="
            sql += (f" AND EXISTS (SELECT 1 FROM j2_note_property_values pv"
                    f" WHERE pv.note_id = j2_notes.id AND pv.user_id = j2_notes.user_id"
                    f" AND pv.property_def_id = ? AND pv.value_json {operator} ?)")
            params.append(def_id)
            params.append(json.dumps(val))
        else:  # eq / neq
            val = cond.get("value")
            negate = "NOT " if op == "neq" else ""
            sql += (f" AND {negate}EXISTS (SELECT 1 FROM j2_note_property_values pv"
                    f" WHERE pv.note_id = j2_notes.id AND pv.user_id = j2_notes.user_id"
                    f" AND pv.property_def_id = ? AND pv.value_json = ?)")
            params.append(def_id)
            params.append(json.dumps(val))
    return sql, params


# ── Saved views ───────────────────────────────────────────────────────────

def _row_to_view(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": r["id"], "name": r["name"], "viewType": r["view_type"],
        "filter": json.loads(r["filter_json"] or "[]"),
        "sort": json.loads(r["sort_json"] or "{}"),
        "columns": json.loads(r["columns_json"] or "[]"),
        "sortOrder": r["sort_order"],
        "createdAt": r["created_at"], "updatedAt": r["updated_at"],
    }


def list_saved_views(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT id, name, view_type, filter_json, sort_json, columns_json, sort_order,"
            " created_at, updated_at FROM j2_note_saved_views WHERE user_id = ? ORDER BY sort_order, created_at",
            (user_id,),
        ).fetchall()
        return [_row_to_view(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_saved_view(user_id: str, view_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = conn.execute(
            "SELECT id, name, view_type, filter_json, sort_json, columns_json, sort_order,"
            " created_at, updated_at FROM j2_note_saved_views WHERE user_id = ? AND id = ?",
            (user_id, view_id),
        ).fetchone()
        return _row_to_view(r) if r else None
    finally:
        if owned:
            conn.close()


def create_saved_view(user_id: str, payload: dict[str, Any], conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    name = (payload.get("name") or "").strip()
    if not name:
        raise PropertyValidationError("View name is required")
    view_type = payload.get("viewType") or "list"
    if view_type not in ("list", "table"):
        raise PropertyValidationError(f"Unknown view type: {view_type!r}")
    owned = conn is None
    conn = conn or get_connection()
    try:
        view_id = uuid.uuid4().hex
        now = _now_iso()
        max_row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) AS m FROM j2_note_saved_views WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        sort_order = (max_row["m"] or -1) + 1
        conn.execute(
            "INSERT INTO j2_note_saved_views"
            " (id, user_id, name, view_type, filter_json, sort_json, columns_json, sort_order, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            (view_id, user_id, name, view_type,
             json.dumps(payload.get("filter") or []),
             json.dumps(payload.get("sort") or {}),
             json.dumps(payload.get("columns") or []),
             sort_order, now, now),
        )
        conn.commit()
        return get_saved_view(user_id, view_id, conn=conn)
    finally:
        if owned:
            conn.close()


def update_saved_view(
    user_id: str, view_id: str, patch: dict[str, Any], conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = get_saved_view(user_id, view_id, conn=conn)
        if existing is None:
            return None
        name = existing["name"]
        if "name" in patch:
            new_name = (patch["name"] or "").strip()
            if not new_name:
                raise PropertyValidationError("View name cannot be blank")
            name = new_name
        view_type = existing["viewType"]
        if "viewType" in patch:
            if patch["viewType"] not in ("list", "table"):
                raise PropertyValidationError(f"Unknown view type: {patch['viewType']!r}")
            view_type = patch["viewType"]
        filter_ = patch.get("filter", existing["filter"])
        sort_ = patch.get("sort", existing["sort"])
        columns = patch.get("columns", existing["columns"])
        conn.execute(
            "UPDATE j2_note_saved_views SET name = ?, view_type = ?, filter_json = ?,"
            " sort_json = ?, columns_json = ?, updated_at = ? WHERE user_id = ? AND id = ?",
            (name, view_type, json.dumps(filter_), json.dumps(sort_), json.dumps(columns),
             _now_iso(), user_id, view_id),
        )
        conn.commit()
        return get_saved_view(user_id, view_id, conn=conn)
    finally:
        if owned:
            conn.close()


def delete_saved_view(user_id: str, view_id: str, conn: sqlite3.Connection | None = None) -> bool:
    """A saved view is pure query configuration -- deleting one never
    touches notes or property defs (checkpoint point 23)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM j2_note_saved_views WHERE user_id = ? AND id = ?",
            (user_id, view_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()
