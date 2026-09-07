"""Wave E — Structured Research Properties / Saved Views.

Two kinds of property, resolved through ONE lookup so callers never
special-case which they're looking at:

- **User-defined** properties: real rows in `j2_note_properties`, stable
  uuid identity, editable/renamable/deletable by the member. Values live in
  `j2_notes.properties_json`, keyed by the property's id (never its name) --
  the same stable-id-not-title discipline Wave D established for note links,
  and the same model the Wave E entry checkpoint's competitor research found
  Notion uses internally (never Obsidian's name-keyed one).
- **Built-in financial** properties: CODE-DEFINED constants (`builtin:<key>`
  ids), never a per-user DB row, and — critically — never stored anywhere.
  Every one of them is DERIVED live from data this app already has (the
  note's own `ticker` column, `ticker_meta`, `j2_note_embeds`) so a member
  never manually maintains what UCT already knows (the Wave E north star).

Both kinds render through `resolve_note_properties`, which returns an
ordered list of `{id, name, type, source, value}` -- `source` is
`"user_set"` (editable, versioned) or `"financial_derived"` (read-only,
recomputed every read, never stale).
"""
from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any

from api.services.auth_db import get_connection

_VALID_TYPES = ("text", "number", "select", "multi_select", "date", "checkbox", "url")


def _now_iso() -> str:
    from api.services.journal_two.notes import _now_iso as _impl
    return _impl()


# ── Built-in financial properties (code-defined, never persisted) ──────────
# PRE-BETA classification (Wave E entry checkpoint §2): every entry below is
# CORE (shipped this wave). Catalyst/Catalyst Date/Earnings Date/Source Type
# were classified OPTIONAL/FUTURE and are deliberately NOT here -- adding one
# later is additive (a new dict entry + a resolver branch), never a schema
# change, since none of these are stored.
BUILTIN_PROPERTY_DEFS: list[dict[str, Any]] = [
    {"id": "builtin:ticker", "name": "Ticker", "type": "text", "source": "financial_derived"},
    {"id": "builtin:sector", "name": "Sector", "type": "text", "source": "financial_derived"},
    {"id": "builtin:industry", "name": "Industry", "type": "text", "source": "financial_derived"},
    {"id": "builtin:theme", "name": "Theme", "type": "text", "source": "financial_derived"},
    {"id": "builtin:trade_ref", "name": "Linked Trade", "type": "text", "source": "financial_derived"},
    {
        "id": "builtin:thesis_status", "name": "Thesis Status", "type": "select",
        "source": "user_set",
        "options": [
            {"id": "watching", "label": "Watching", "color": "blue"},
            {"id": "active", "label": "Active", "color": "green"},
            {"id": "invalidated", "label": "Invalidated", "color": "red"},
            {"id": "closed", "label": "Closed", "color": "gray"},
        ],
    },
    {
        "id": "builtin:confidence", "name": "Confidence", "type": "select",
        "source": "user_set",
        "options": [
            {"id": "low", "label": "Low", "color": "gray"},
            {"id": "medium", "label": "Medium", "color": "amber"},
            {"id": "high", "label": "High", "color": "green"},
        ],
    },
    {
        "id": "builtin:research_type", "name": "Research Type", "type": "select",
        "source": "user_set",
        "options": [
            {"id": "long_thesis", "label": "Long Thesis", "color": "green"},
            {"id": "short_thesis", "label": "Short Thesis", "color": "red"},
            {"id": "earnings_play", "label": "Earnings Play", "color": "amber"},
            {"id": "sector_note", "label": "Sector Note", "color": "blue"},
            {"id": "watchlist_note", "label": "Watchlist Note", "color": "gray"},
        ],
    },
    {"id": "builtin:review_date", "name": "Review Date", "type": "date", "source": "user_set"},
]
_BUILTIN_BY_ID = {d["id"]: d for d in BUILTIN_PROPERTY_DEFS}
BUILTIN_USER_SET_IDS = frozenset(d["id"] for d in BUILTIN_PROPERTY_DEFS if d["source"] == "user_set")


def is_builtin_property_id(property_id: str) -> bool:
    return isinstance(property_id, str) and property_id.startswith("builtin:")


# ── User-defined property definitions (j2_note_properties) ─────────────────

def _def_row_to_dict(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": r["id"],
        "name": r["name"],
        "type": r["type"],
        "options": json.loads(r["options_json"]) if r["options_json"] else None,
        "sortOrder": r["sort_order"],
        "source": "user_set",
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
    }


def list_property_defs(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """Every property definition available to this member: built-ins first
    (stable, always-present order), then user-created ones (sort_order, then
    name) -- soft-deleted definitions are excluded, matching every other
    trash-aware list in this program."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_properties WHERE user_id = ? AND deleted_at IS NULL"
            " ORDER BY sort_order, name",
            (user_id,),
        ).fetchall()
        return [dict(d) for d in BUILTIN_PROPERTY_DEFS] + [_def_row_to_dict(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_property_def(user_id: str, property_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    if is_builtin_property_id(property_id):
        d = _BUILTIN_BY_ID.get(property_id)
        return dict(d) if d else None
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = conn.execute(
            "SELECT * FROM j2_note_properties WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (property_id, user_id),
        ).fetchone()
        return _def_row_to_dict(r) if r else None
    finally:
        if owned:
            conn.close()


class PropertyValidationError(ValueError):
    pass


def create_property_def(
    user_id: str, name: str, type_: str, options: list[dict[str, Any]] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    name = (name or "").strip()
    if not name:
        raise PropertyValidationError("Property name is required")
    if type_ not in _VALID_TYPES:
        raise PropertyValidationError(f"Unsupported property type: {type_!r}")
    opts_json = None
    if type_ in ("select", "multi_select"):
        opts = options or []
        normalized = []
        for o in opts:
            label = (o.get("label") or "").strip() if isinstance(o, dict) else ""
            if not label:
                continue
            normalized.append({
                "id": o.get("id") or uuid.uuid4().hex,
                "label": label,
                "color": o.get("color") or "gray",
            })
        opts_json = json.dumps(normalized)
    owned = conn is None
    conn = conn or get_connection()
    try:
        pid = uuid.uuid4().hex
        now = _now_iso()
        row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM j2_note_properties WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        conn.execute(
            "INSERT INTO j2_note_properties"
            " (id, user_id, name, type, options_json, sort_order, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (pid, user_id, name, type_, opts_json, row["n"], now, now),
        )
        conn.commit()
        return get_property_def(user_id, pid, conn=conn)
    finally:
        if owned:
            conn.close()


def update_property_def(
    user_id: str, property_id: str, *, name: str | None = None,
    options: list[dict[str, Any]] | None = None, conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Rename the property and/or edit its option labels/colors -- NEVER the
    property's own id, and NEVER an option's own id (only its label/color).
    Renaming touches exactly this one row; zero note rows are touched, since
    every stored value references property_id/option_id, never a name or
    label (Wave E checkpoint §7/§8)."""
    if is_builtin_property_id(property_id):
        raise PropertyValidationError("Built-in properties cannot be renamed or have their options edited")
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = get_property_def(user_id, property_id, conn=conn)
        if existing is None:
            return None
        new_name = (name or "").strip() if name is not None else existing["name"]
        if not new_name:
            raise PropertyValidationError("Property name is required")
        opts_json = None
        if options is not None and existing["type"] in ("select", "multi_select"):
            existing_by_id = {o["id"]: o for o in (existing["options"] or [])}
            normalized = []
            for o in options:
                label = (o.get("label") or "").strip() if isinstance(o, dict) else ""
                if not label:
                    continue
                oid = o.get("id") if (isinstance(o, dict) and o.get("id") in existing_by_id) else uuid.uuid4().hex
                normalized.append({"id": oid, "label": label, "color": o.get("color") or "gray"})
            opts_json = json.dumps(normalized)
        elif existing["options"] is not None:
            opts_json = json.dumps(existing["options"])
        conn.execute(
            "UPDATE j2_note_properties SET name = ?, options_json = ?, updated_at = ?"
            " WHERE id = ? AND user_id = ?",
            (new_name, opts_json, _now_iso(), property_id, user_id),
        )
        conn.commit()
        return get_property_def(user_id, property_id, conn=conn)
    finally:
        if owned:
            conn.close()


def delete_property_def(user_id: str, property_id: str, conn: sqlite3.Connection | None = None) -> bool:
    """Soft delete only -- hides the definition from pickers/filters/saved
    views, purged like Trash after 30 days (see
    purge_expired_property_defs_and_saved_views below, riding the SAME
    nightly job as notes.register_trash_purge_job). NEVER touches j2_notes
    or any note's own
    properties_json -- a note that had this property set keeps that value,
    invisibly, until/unless the definition is restored (directive's own
    adversarial test: property deletion never deletes a note)."""
    if is_builtin_property_id(property_id):
        raise PropertyValidationError("Built-in properties cannot be deleted")
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_note_properties SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (_now_iso(), property_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


# ── Per-note value read/write ───────────────────────────────────────────────

def _parse_properties_json(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


def validate_property_value(prop_def: dict[str, Any], value: Any) -> Any:
    """Coerce+validate `value` against `prop_def`'s declared type. Raises
    PropertyValidationError on a value that doesn't fit -- never silently
    cast/injected into a filter or a stored value (Wave E checkpoint §14/§89).
    `None` always clears the property regardless of type."""
    if value is None:
        return None
    t = prop_def["type"]
    if t == "text" or t == "url":
        if not isinstance(value, str):
            raise PropertyValidationError(f"{prop_def['name']} must be text")
        return value
    if t == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise PropertyValidationError(f"{prop_def['name']} must be a number")
        return value
    if t == "checkbox":
        if not isinstance(value, bool):
            raise PropertyValidationError(f"{prop_def['name']} must be true/false")
        return value
    if t == "date":
        if not isinstance(value, str) or not value:
            raise PropertyValidationError(f"{prop_def['name']} must be a date string")
        return value
    if t == "select":
        valid_ids = {o["id"] for o in (prop_def.get("options") or [])}
        if not isinstance(value, str) or value not in valid_ids:
            raise PropertyValidationError(f"{prop_def['name']}: unknown option {value!r}")
        return value
    if t == "multi_select":
        valid_ids = {o["id"] for o in (prop_def.get("options") or [])}
        if not isinstance(value, list) or any(v not in valid_ids for v in value):
            raise PropertyValidationError(f"{prop_def['name']}: unknown option(s) in {value!r}")
        return value
    raise PropertyValidationError(f"Unsupported property type: {t!r}")


def set_note_properties(
    user_id: str, note_id: str, patch: dict[str, Any], conn: sqlite3.Connection,
    *, replace: bool = False,
) -> str | None:
    """MERGE `patch` (property_id -> value, value=None clears it) into a
    note's properties_json and return the new serialized JSON, or `None` when
    the result is empty (an empty dict is stored as SQL NULL, never the
    STRING "null" -- that string is truthy, so every `if row["properties_json"]`
    truthiness check elsewhere in this program would treat it as "has a
    value" and then json.loads it into Python None, silently breaking the
    "propertiesJson is always a dict, never null" contract `_row_to_note`
    promises). Pure, no commit, no I/O beyond the one property-defs lookup
    needed to validate.
    Caller (notes.update_note) is responsible for writing the returned
    string into the note row inside its own transaction, exactly like every
    other note field. Builtin user_set properties (thesis_status/confidence/
    research_type/review_date) validate against their fixed option set;
    user-created properties validate against their own stored def.

    `replace=True` (Wave C restore ONLY) starts from an EMPTY property set
    instead of the note's current one before applying `patch` -- restoring
    to an old version must make the note's properties look EXACTLY like
    that snapshot, including clearing a property added after the snapshot
    was captured, which a merge would leave untouched (stacked on top of the
    restored values instead of replaced by them)."""
    current: dict[str, Any] = {}
    if not replace:
        row = conn.execute(
            "SELECT properties_json FROM j2_notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        ).fetchone()
        current = _parse_properties_json(row["properties_json"] if row else None)
    for property_id, value in patch.items():
        if is_builtin_property_id(property_id):
            if property_id not in BUILTIN_USER_SET_IDS:
                raise PropertyValidationError(f"{property_id} is not a settable property")
            prop_def = _BUILTIN_BY_ID[property_id]
        else:
            prop_def = get_property_def(user_id, property_id, conn=conn)
            if prop_def is None:
                raise PropertyValidationError(f"Unknown property: {property_id}")
        validated = validate_property_value(prop_def, value)
        if validated is None:
            current.pop(property_id, None)
        else:
            current[property_id] = validated
    return json.dumps(current) if current else None


# ── Financial-derived resolution ────────────────────────────────────────────

def _derived_financial_values(user_id: str, note: dict[str, Any], conn: sqlite3.Connection) -> dict[str, Any]:
    """Ticker/Sector/Industry/Theme/Trade -- computed live from data this app
    already has, NEVER stored. A note without a ticker/trade simply omits
    those keys (not blank strings) so the UI can render "not set" honestly."""
    out: dict[str, Any] = {}
    ticker = (note.get("ticker") or "").strip().upper()
    if ticker:
        out["builtin:ticker"] = ticker
        try:
            from api.services.ticker_meta import get_ticker_meta
            meta = get_ticker_meta(ticker)
            if meta.get("sector"):
                out["builtin:sector"] = meta["sector"]
            if meta.get("industry"):
                out["builtin:industry"] = meta["industry"]
            if meta.get("theme"):
                out["builtin:theme"] = meta["theme"]
        except Exception:
            pass  # a provider hiccup degrades to "not set", never a note-load failure
    embed = conn.execute(
        "SELECT symbol, trade_ref, trade_ref_type FROM j2_note_embeds"
        " WHERE note_id = ? AND user_id = ? AND trade_ref IS NOT NULL"
        " ORDER BY position LIMIT 1",
        (note["id"], user_id),
    ).fetchone()
    if embed is not None:
        from api.services.journal_two.note_trade_links import resolve_trade_ref
        resolved = resolve_trade_ref(conn, user_id, embed["trade_ref"], embed["trade_ref_type"])
        if resolved.get("symbol"):
            label = f"{resolved['symbol']} ({resolved.get('kind', 'trade').replace('_', ' ')})"
            out["builtin:trade_ref"] = label
    return out


def resolve_note_properties(user_id: str, note: dict[str, Any], conn: sqlite3.Connection) -> list[dict[str, Any]]:
    """The full, ordered property list for ONE note, ready for the frontend:
    every def from `list_property_defs` plus that note's own value (or the
    live-derived value for financial_derived ones). Properties with no value
    AND no derived value are still included with `value: None` -- the
    Properties UI decides what "empty" looks like, this function's job is
    just to resolve truth, never to hide gaps.

    `note["propertiesJson"]` is expected ALREADY PARSED (a dict, per
    `_row_to_note`'s own convention for bodyJson/tags) -- not the raw column
    string (that raw form is only ever read directly off a DB row, in
    `set_note_properties` below)."""
    defs = list_property_defs(user_id, conn=conn)
    values = note.get("propertiesJson") or {}
    derived = _derived_financial_values(user_id, note, conn)
    out = []
    for d in defs:
        if d["source"] == "financial_derived":
            value = derived.get(d["id"])
        else:
            value = values.get(d["id"])
        out.append({**d, "value": value})
    return out


# ── Saved views (mirrors screener_saved_screens.py's shape) ─────────────────

def _view_row_to_dict(r: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": r["id"],
        "name": r["name"],
        "viewType": r["view_type"],
        "spec": json.loads(r["spec_json"]) if r["spec_json"] else {},
        "sortOrder": r["sort_order"],
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
    }


def list_saved_views(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_saved_views WHERE user_id = ? AND deleted_at IS NULL"
            " ORDER BY sort_order, name",
            (user_id,),
        ).fetchall()
        return [_view_row_to_dict(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_saved_view(user_id: str, view_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        r = conn.execute(
            "SELECT * FROM j2_note_saved_views WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (view_id, user_id),
        ).fetchone()
        return _view_row_to_dict(r) if r else None
    finally:
        if owned:
            conn.close()


def create_saved_view(
    user_id: str, name: str, view_type: str, spec: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """`spec` must reference property_id/option_id ONLY -- never a property
    or option NAME/label. This is what makes a saved view survive a rename
    by construction (Wave E checkpoint §13), the same lesson Wave D's
    stable-id note-link established and this session's fresh competitor
    research confirmed is exactly how Notion's own views stay rename-safe
    (never Evernote's saved-query-TEXT shape)."""
    name = (name or "").strip()
    if not name:
        raise PropertyValidationError("View name is required")
    if view_type not in ("list", "table"):
        raise PropertyValidationError(f"Unsupported view type: {view_type!r}")
    owned = conn is None
    conn = conn or get_connection()
    try:
        vid = uuid.uuid4().hex
        now = _now_iso()
        row = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM j2_note_saved_views WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        conn.execute(
            "INSERT INTO j2_note_saved_views"
            " (id, user_id, name, view_type, spec_json, sort_order, created_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (vid, user_id, name, view_type, json.dumps(spec or {}), row["n"], now, now),
        )
        conn.commit()
        return get_saved_view(user_id, vid, conn=conn)
    finally:
        if owned:
            conn.close()


def update_saved_view(
    user_id: str, view_id: str, *, name: str | None = None, spec: dict[str, Any] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = get_saved_view(user_id, view_id, conn=conn)
        if existing is None:
            return None
        new_name = (name or "").strip() if name is not None else existing["name"]
        if not new_name:
            raise PropertyValidationError("View name is required")
        new_spec = spec if spec is not None else existing["spec"]
        conn.execute(
            "UPDATE j2_note_saved_views SET name = ?, spec_json = ?, updated_at = ?"
            " WHERE id = ? AND user_id = ?",
            (new_name, json.dumps(new_spec), _now_iso(), view_id, user_id),
        )
        conn.commit()
        return get_saved_view(user_id, view_id, conn=conn)
    finally:
        if owned:
            conn.close()


def delete_saved_view(user_id: str, view_id: str, conn: sqlite3.Connection | None = None) -> bool:
    """Soft delete (reversible for 30 days, mirroring the note-trash pattern)
    -- tenant-scoped: a foreign user's view id returns False, identically to
    a nonexistent one (never distinguishable, per Wave D's tenant-isolation
    lesson)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_note_saved_views SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (_now_iso(), view_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


# ── Property filter -> SQL (extends notes._notes_filter_sql, never a second
# predicate builder -- notes.list_notes/count_notes call this and AND the
# fragment onto their own WHERE clause) ─────────────────────────────────────

_VALID_OPS = ("eq", "neq", "contains", "gt", "gte", "lt", "lte", "is_empty", "is_not_empty")


def property_filter_sql(
    user_id: str, property_filter: list[dict[str, Any]] | None, conn: sqlite3.Connection,
    *, strict: bool = True,
) -> tuple[str, list[Any]]:
    """AND-only (Wave E checkpoint §10/directive §39-41 -- OR/groups
    explicitly deferred). Every condition validates its property_id AND its
    value against that property's declared type BEFORE building SQL (Wave E
    checkpoint §14/§89) -- an unknown property, an unsupported op, or a value
    that doesn't fit the type raises PropertyValidationError rather than
    silently building a no-op or, worse, a wrong predicate. financial_derived
    properties (Ticker/Sector/Industry/Theme/Trade) are NOT filterable
    through this path -- their existing dedicated filters (ticker=,
    embed_symbol=/symbol_in via sector/theme) already cover them without a
    duplicate mechanism; filtering by one here raises rather than silently
    doing nothing.

    `strict=False` (used only when resolving a SAVED VIEW's own stored spec --
    checkpoint §9 property deletion/recovery) drops a clause referencing a
    property_id that no longer exists instead of raising. A view's spec was
    valid when saved; a property it depended on can be deleted afterward, and
    a saved view whose owner deletes a property should degrade to "that
    condition no longer applies" -- not turn into a permanent 400 with no way
    to fix it short of deleting and recreating the view. `strict=True` (the
    default, used for a live client-supplied filter) still hard-rejects an
    unknown property -- that is a real, actionable mistake in the request
    being made right now, not a dangling reference to heal around."""
    if not property_filter:
        return "", []
    clauses: list[str] = []
    params: list[Any] = []
    for cond in property_filter:
        if not isinstance(cond, dict):
            raise PropertyValidationError("Each filter condition must be an object")
        property_id = cond.get("propertyId")
        op = cond.get("op")
        value = cond.get("value")
        if op not in _VALID_OPS:
            raise PropertyValidationError(f"Unsupported filter operator: {op!r}")
        prop_def = get_property_def(user_id, property_id, conn=conn)
        if prop_def is None:
            if strict:
                raise PropertyValidationError(f"Unknown property: {property_id!r}")
            continue
        if prop_def["source"] != "user_set":
            if strict:
                raise PropertyValidationError(
                    f"{prop_def['name']} is derived and cannot be filtered through property_filter"
                )
            continue
        extract = 'json_extract(properties_json, ?)'
        path_param = f'$."{property_id}"'
        if op == "is_empty":
            clauses.append(f"{extract} IS NULL")
            params.append(path_param)
            continue
        if op == "is_not_empty":
            clauses.append(f"{extract} IS NOT NULL")
            params.append(path_param)
            continue
        if prop_def["type"] == "multi_select" and op == "contains":
            clauses.append(
                f"EXISTS (SELECT 1 FROM json_each({extract}) WHERE json_each.value = ?)"
            )
            params.append(path_param)
            params.append(validate_property_value(prop_def, [value])[0])
            continue
        validated = validate_property_value(prop_def, value)
        sql_op = {"eq": "=", "neq": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}.get(op)
        if sql_op:
            clauses.append(f"{extract} {sql_op} ?")
            params.append(path_param)
            params.append(validated)
        elif op == "contains":  # text substring
            clauses.append(f"{extract} LIKE ?")
            params.append(path_param)
            params.append(f"%{validated}%")
        else:
            raise PropertyValidationError(f"{op!r} is not supported for property type {prop_def['type']!r}")
    if not clauses:
        return "", []
    return " AND (" + " AND ".join(clauses) + ")", params


_VALID_SORT_DIRECTIONS = ("asc", "desc")


def property_sort_sql(
    user_id: str, property_sort: dict[str, Any] | None, conn: sqlite3.Connection,
    *, strict: bool = True,
) -> tuple[str, list[Any]] | None:
    """Returns `(order_by_fragment, params)` -- the fragment goes directly
    after `ORDER BY` (no trailing keyword of its own) -- or None when no
    property sort was requested. A single key only (Wave E checkpoint §11 --
    multi-key sort deferred). The JSON path is a bound parameter, never
    string-interpolated into the SQL text, matching every other predicate in
    this program (directive §14's "no raw client query text" discipline,
    applied even though property_id is already validated against a real
    definition, not literally arbitrary input).

    `strict=False` mirrors `property_filter_sql`'s saved-view healing: a
    saved view sorting by a since-deleted property falls back to no property
    sort (the caller's default sort applies) instead of 400ing forever."""
    if not property_sort:
        return None
    property_id = property_sort.get("propertyId")
    direction = (property_sort.get("direction") or "asc").lower()
    if direction not in _VALID_SORT_DIRECTIONS:
        raise PropertyValidationError(f"Unsupported sort direction: {direction!r}")
    prop_def = get_property_def(user_id, property_id, conn=conn)
    if prop_def is None:
        if strict:
            raise PropertyValidationError(f"Unknown property: {property_id!r}")
        return None
    # NULLS LAST regardless of direction -- an unset property should never
    # dominate the top of an ascending sort just because SQLite treats NULL
    # as smallest (Wave E checkpoint's own "honest empty state" discipline,
    # same spirit as Wave D's foreign/nonexistent-target handling).
    path_param = f'$."{property_id}"'
    direction_sql = "ASC" if direction == "asc" else "DESC"
    fragment = f"(json_extract(properties_json, ?) IS NULL), json_extract(properties_json, ?) {direction_sql}"
    return fragment, [path_param, path_param]


# ── Purge (Wave E checkpoint §28) ────────────────────────────────────────────

PROPERTY_RETENTION_DAYS = 30


def purge_expired_property_defs_and_saved_views(
    retention_days: int = PROPERTY_RETENTION_DAYS,
    conn: sqlite3.Connection | None = None,
) -> tuple[int, int]:
    """Hard-delete every property definition / saved view soft-deleted more
    than `retention_days` ago, across ALL users -- mirrors
    notes.purge_expired_deleted_notes' shape exactly (real, unscoped
    DELETEs; intentionally NOT exposed through any router; call only from
    the scheduler job). Returns (defs_purged, views_purged). Never touches
    j2_notes -- a note that had a since-purged property's value keeps that
    orphaned key in its own properties_json forever (harmless: it was
    already invisible/unresolvable the moment the definition was soft-
    deleted, and resolve_note_properties never looks at note-level values
    for a property id it can't find a live definition for)."""
    import datetime as _dt
    cutoff = (_dt.datetime.now(_dt.timezone.utc) - _dt.timedelta(days=retention_days)).isoformat()
    owned = conn is None
    conn = conn or get_connection()
    try:
        d_cur = conn.execute(
            "DELETE FROM j2_note_properties WHERE deleted_at IS NOT NULL AND deleted_at < ?", (cutoff,),
        )
        v_cur = conn.execute(
            "DELETE FROM j2_note_saved_views WHERE deleted_at IS NOT NULL AND deleted_at < ?", (cutoff,),
        )
        conn.commit()
        return d_cur.rowcount, v_cur.rowcount
    finally:
        if owned:
            conn.close()
