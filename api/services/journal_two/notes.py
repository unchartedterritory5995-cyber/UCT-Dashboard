"""
Journal 2.0 — Notebook (replaces Playbook 2026-05-26).

Free-form Substack-style notes with TipTap doc body, folders, tags,
optional ticker, hero image. Spec:
docs/superpowers/specs/2026-05-26-notebook-design.md
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from api.services.auth_db import get_connection

MAX_TITLE_CHARS = 300
MAX_SUBTITLE_CHARS = 500
MAX_BODY_JSON_BYTES = 1_000_000  # 1MB
MAX_TAG_LENGTH = 40
MAX_TAGS = 30
MAX_TICKER_LENGTH = 16
MAX_FOLDER_DEPTH = 6

from api.services.journal_two.attachment_root import (
    attachment_root as _attachment_root, read_candidates as _read_candidates,
)

# ⛔ Was `<repo>/data/j2_attachments` — ephemeral container storage on Railway;
# every redeploy wiped every note image. One authority now (attachment_root.py).
_ATTACHMENT_ROOT = _attachment_root()
_ALLOWED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_ALLOWED_FILE_MIMES = {
    "application/pdf", "text/plain", "text/csv", "text/markdown",
    "application/zip", "audio/mpeg", "audio/mp4",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    # xlsx's real MIME is "...spreadsheetml.sheet" — ".document" was a typo
    # (copy-pasted from the docx entry above). Accept both: "sheet" is what a
    # real browser/frontend sends; "document" stays for back-compat with
    # anything already relying on the old (wrong) value.
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.document",
}
_MAX_FILE_BYTES = 25 * 1024 * 1024


class NoteValidationError(ValueError):
    """Raised when note payload is malformed."""


class NoteConflictError(Exception):
    """Raised when a compare-and-set update loses: the note's updated_at no
    longer matches the baseline the client edited from (A15 — a server-side
    'Send to Journal' append or a second tab wrote in between). The router
    maps this to 409; the editor reconciles and retries."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Body plain-text extraction ───────────────────────────────────────────────

def _fmt_secs(secs: Any) -> str:
    """Mirror of the client's playerUtils.fmtTime — m:ss, h:mm:ss past an hour.
    A display-format micro-mirror, pinned by test against the client's output."""
    try:
        s = max(0, int(secs or 0))
    except (TypeError, ValueError):
        s = 0
    h, m, sec = s // 3600, (s % 3600) // 60, s % 60
    return f"{h}:{m:02d}:{sec:02d}" if h else f"{m}:{sec:02d}"


def extract_plain_text(doc: dict[str, Any] | None) -> str:
    """Recursively walk a TipTap ProseMirror doc and concatenate all text
    nodes (space-separated), plus the search lines of the custom atom nodes.
    This writes body_plain — the notebook search index — so it MUST stay in
    lockstep with the client serializer (lib/tiptap.js extractPlainText).

    widgetEmbed carries its line pre-computed in attrs.searchText: the CLIENT
    derives it from the widget registry at the only moments params change
    (insert / toolbar edit), so this side never re-owns 13 per-widget formats
    it could drift on. Missing/blank searchText degrades to '[widget]'."""
    if not isinstance(doc, dict):
        return ""
    out: list[str] = []
    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        ntype = node.get("type")
        # attrs may be any JSON shape (permissive body validator + importer
        # round-trip) — a truthy NON-dict (list/string/number) must not reach
        # .get() in the branches below, or every save of the note 500s. The
        # widgetEmbed branch got this guard in the review fix pass; a non-dict
        # on videoTimestamp/attachmentChip crashed identically.
        attrs = node.get("attrs")
        if not isinstance(attrs, dict):
            attrs = {}
        if ntype == "text":
            t = node.get("text")
            if isinstance(t, str):
                out.append(t)
        elif ntype == "videoTimestamp":
            out.append(f"[{_fmt_secs(attrs.get('seconds'))}]")
        elif ntype == "attachmentChip":
            out.append(f"[file: {attrs.get('name') or 'file'}]")
        elif ntype == "widgetEmbed":
            # attrs may be any JSON shape (the body validator is deliberately
            # permissive and the importer round-trips arbitrary HTML) — a
            # non-dict here must degrade, never 500 the note write.
            st = attrs.get("searchText") if isinstance(attrs, dict) else None
            out.append(st if isinstance(st, str) and st else "[widget]")
        for child in node.get("content", []) or []:
            walk(child)
    walk(doc)
    return " ".join(s for s in out if s)


# ── Widget-embed sidecar (j2_note_embeds) ────────────────────────────────────

def _extract_embeds(doc: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Every widgetEmbed node in document order, flattened to sidecar rows."""
    rows: list[dict[str, Any]] = []
    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "widgetEmbed":
            attrs = node.get("attrs")
            if not isinstance(attrs, dict):
                attrs = {}
            params = attrs.get("params")
            if not isinstance(params, dict):
                params = {}
            widget_id = attrs.get("widgetId")
            if isinstance(widget_id, str) and widget_id:
                sym = params.get("symbol")
                tf = params.get("tf")
                rows.append({
                    "widget_id": widget_id,
                    "symbol": sym.upper() if isinstance(sym, str) and sym else None,
                    "timeframe": str(tf) if tf is not None else None,
                    "trade_ref": attrs.get("tradeRef") or None,
                    "mode": attrs.get("mode") or None,
                    "captured_at": attrs.get("capturedAt") or None,
                })
        for child in node.get("content", []) or []:
            walk(child)
    if isinstance(doc, dict):
        walk(doc)
    return rows


def _sync_note_embeds(
    conn: sqlite3.Connection, user_id: str, note_id: str,
    body_json: dict[str, Any] | None,
) -> None:
    """Rebuild the note's j2_note_embeds projection inside the caller's
    transaction (no commit here). Delete + insert: the row set is tiny and
    document order (position) is the primary key."""
    conn.execute("DELETE FROM j2_note_embeds WHERE note_id = ?", (note_id,))
    rows = _extract_embeds(body_json)
    if rows:
        conn.executemany(
            "INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id,"
            " symbol, timeframe, trade_ref, mode, captured_at)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            [(note_id, user_id, i, r["widget_id"], r["symbol"], r["timeframe"],
              r["trade_ref"], r["mode"], r["captured_at"])
             for i, r in enumerate(rows)])


# ── Validation ───────────────────────────────────────────────────────────────

def _validate_tags(raw: Any) -> list[str]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise NoteValidationError("tags must be a list")
    if len(raw) > MAX_TAGS:
        raise NoteValidationError(f"tags exceeds cap of {MAX_TAGS}")
    out: list[str] = []
    seen: set[str] = set()
    for t in raw:
        if not isinstance(t, str):
            raise NoteValidationError("tag entries must be strings")
        t2 = t.strip()
        if not t2:
            continue
        if len(t2) > MAX_TAG_LENGTH:
            raise NoteValidationError(f"tag exceeds {MAX_TAG_LENGTH} chars")
        key = t2.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(t2)
    return out


def _validate_body_json(raw: Any) -> dict[str, Any]:
    if raw is None or raw == "":
        return {"type": "doc", "content": []}
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            raise NoteValidationError("body_json must be valid JSON")
    if not isinstance(raw, dict):
        raise NoteValidationError("body_json must be an object")
    if raw.get("type") != "doc":
        raise NoteValidationError("body_json must be a TipTap doc")
    serialized = json.dumps(raw)
    if len(serialized.encode("utf-8")) > MAX_BODY_JSON_BYTES:
        raise NoteValidationError("body_json too large (>1MB)")
    return raw


def _extract_first_image(body_json: Any) -> str | None:
    """The `src` of the FIRST picture in a TipTap doc (document order, depth
    first), else None. Cached to `first_image_url` so the notebook card can show
    a preview glyph without loading the whole body. Matches, in document order:
      - the standard '@tiptap/extension-image' node (type=='image', attrs.src)
      - a 'widgetEmbed' chart/widget node's captured snapshot (attrs.fallback.url)
        — so a note whose only content is a /chart still gets a thumbnail."""
    def walk(nodes: Any) -> str | None:
        if not isinstance(nodes, list):
            return None
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if node.get("type") == "image":
                src = (node.get("attrs") or {}).get("src")
                if isinstance(src, str) and src:
                    return src
            if node.get("type") == "widgetEmbed":
                fb = (node.get("attrs") or {}).get("fallback")
                if isinstance(fb, dict) and isinstance(fb.get("url"), str) and fb["url"]:
                    return fb["url"]
            found = walk(node.get("content"))
            if found:
                return found
        return None
    if not isinstance(body_json, dict):
        return None
    return walk(body_json.get("content"))


def _validate_ticker(raw: Any) -> str | None:
    if raw is None or raw == "":
        return None
    if not isinstance(raw, str):
        raise NoteValidationError("ticker must be a string")
    t = raw.strip().upper()
    if not t:
        return None
    if len(t) > MAX_TICKER_LENGTH:
        raise NoteValidationError("ticker too long")
    if not re.match(r"^[A-Z0-9.\-]+$", t):
        raise NoteValidationError("ticker has invalid characters")
    return t


# ── Import support ───────────────────────────────────────────────────────────

def _import_payload_hash(note: dict) -> str:
    """Compute a SHA256 hash of the note's immutable content for fingerprinting."""
    basis = json.dumps({
        "title": note.get("title") or "",
        "subtitle": note.get("subtitle") or None,
        "bodyJson": note.get("bodyJson") or {},
        "tags": sorted(note.get("tags") or []),
        "ticker": note.get("ticker") or None,
        "folderPath": note.get("folderPath") or [],
        "updatedAt": note.get("updatedAt") or "",
    }, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()


def _import_date(value, fallback):
    """Validate and return an ISO date string, or fallback if invalid."""
    if not value or not isinstance(value, str):
        return fallback
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value
    except ValueError:
        return fallback


def import_check(user_id: str, import_keys: list[str], conn: sqlite3.Connection | None = None) -> dict:
    """Check which import keys already exist for the user.

    Returns: {"existing": {key: {"id", "updatedAt", "importHash"}}}
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = {}
        keys = [k for k in (import_keys or []) if isinstance(k, str)][:5000]
        for i in range(0, len(keys), 500):  # SQLite variable limit safety
            chunk = keys[i:i + 500]
            q = ",".join("?" * len(chunk))
            for row in conn.execute(
                f"SELECT id, import_key, updated_at, import_hash FROM j2_notes "
                f"WHERE user_id = ? AND import_key IN ({q})", (user_id, *chunk)):
                existing[row["import_key"]] = {
                    "id": row["id"], "updatedAt": row["updated_at"],
                    "importHash": row["import_hash"]}
        return {"existing": existing}
    finally:
        if owned:
            conn.close()


def import_confirm(user_id: str, payload: dict, conn: sqlite3.Connection | None = None) -> dict:
    """Transactional upsert of notes by fingerprint.

    Payload shape: {
        "source": str,
        "destFolderId": str|None,
        "notes": [{importKey, title, subtitle?, bodyJson, tags, ticker?,
                   createdAt?, updatedAt?, folderPath: [str, ...]}]
    }

    Returns: {"created": [...], "updated": [...], "skipped": [...]}
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("notes"), list):
        raise NoteValidationError("invalid import payload")
    notes = payload["notes"]
    if len(notes) > 500:
        raise NoteValidationError("too many notes in one batch (max 500)")
    raw_source = payload.get("source")
    if raw_source is not None and not isinstance(raw_source, str):
        raise NoteValidationError("source must be a string")
    source = (raw_source or "file")[:40]
    dest = payload.get("destFolderId") or ""
    owned = conn is None
    conn = conn or get_connection()
    try:
        if dest:
            ok = conn.execute("SELECT 1 FROM j2_note_folders WHERE id = ? AND user_id = ?",
                              (dest, user_id)).fetchone()
            if not ok:
                raise NoteValidationError("destination folder not found")
        # A deep folderPath used to be truncated to MAX_FOLDER_DEPTH segments
        # and then created UNDER destFolderId — so a dest at depth >=1 plus a
        # path already at the cap raised "folder nesting too deep" and 400'd
        # the whole batch. Clamp against how much room dest actually leaves:
        # a dest at depth 1 (root) permits MAX_FOLDER_DEPTH-1 more segments,
        # no dest (root import) permits the full MAX_FOLDER_DEPTH. Overflow
        # segments are dropped — the note lands at the deepest allowed
        # folder instead of failing the batch.
        dest_depth = _folder_depth(conn, user_id, dest) if dest else 0
        max_path_depth = max(0, MAX_FOLDER_DEPTH - dest_depth)
        created, updated, skipped = [], [], []
        # One import operation = one imported_at timestamp, deliberate
        now = _now_iso()
        path_cache: dict[tuple, str] = {}
        for n in notes:
            key = n.get("importKey")
            if not key or not isinstance(key, str):
                raise NoteValidationError("importKey required on every note")
            body_json = _validate_body_json(n.get("bodyJson"))
            body_plain = extract_plain_text(body_json)
            first_image = _extract_first_image(body_json)
            title = (n.get("title") or "Untitled").strip()[:MAX_TITLE_CHARS]
            tags = _validate_tags(n.get("tags"))
            ticker = _validate_ticker(n.get("ticker"))
            h = _import_payload_hash(n)
            path = tuple((n.get("folderPath") or [])[:max_path_depth])
            if path not in path_cache:
                path_cache[path] = (ensure_folder_path(user_id, list(path), dest, conn=conn)
                                    if path else (dest or None))
            folder_id = path_cache[path] or None
            row = conn.execute(
                "SELECT id, import_hash FROM j2_notes WHERE user_id = ? AND import_key = ?",
                (user_id, key)).fetchone()
            item = {"importKey": key, "id": row["id"] if row else None}
            if row and row["import_hash"] == h:
                skipped.append(item); continue
            created_at = _import_date(n.get("createdAt"), now)
            updated_at = _import_date(n.get("updatedAt"), now)
            if row:
                conn.execute(
                    "UPDATE j2_notes SET title=?, subtitle=?, body_json=?, body_plain=?, "
                    "first_image_url=?, folder_id=?, ticker=?, tags=?, import_hash=?, "
                    "imported_at=?, updated_at=? "
                    "WHERE id=? AND user_id=?",
                    (title, n.get("subtitle") or None, json.dumps(body_json), body_plain,
                     first_image, folder_id, ticker, json.dumps(tags), h, now, updated_at,
                     row["id"], user_id))
                _sync_note_embeds(conn, user_id, row["id"], body_json)
                updated.append(item)
            else:
                new_id = uuid.uuid4().hex
                conn.execute(
                    "INSERT INTO j2_notes (id, user_id, folder_id, title, subtitle, body_json, "
                    "body_plain, first_image_url, ticker, tags, import_source, import_key, import_hash, "
                    "imported_at, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (new_id, user_id, folder_id, title, n.get("subtitle") or None,
                     json.dumps(body_json), body_plain, first_image, ticker, json.dumps(tags),
                     source, key, h, now, created_at, updated_at))
                _sync_note_embeds(conn, user_id, new_id, body_json)
                item["id"] = new_id
                created.append(item)
        conn.commit()
        return {"created": created, "updated": updated, "skipped": skipped}
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


# ── Row mapping ──────────────────────────────────────────────────────────────

def _row_to_note(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "accountId": row["account_id"],
        "folderId": row["folder_id"],
        "title": row["title"] or "",
        "subtitle": row["subtitle"],
        "bodyJson": json.loads(row["body_json"] or '{"type":"doc","content":[]}'),
        "bodyPlain": row["body_plain"] or "",
        "heroImageUrl": row["hero_image_url"],
        "firstImageUrl": row["first_image_url"],
        "ticker": row["ticker"],
        "tags": json.loads(row["tags"] or "[]"),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


# How much body_plain a LIST row carries — enough for a card preview line,
# never the whole document.
_LIST_PLAIN_CHARS = 400


# The LIST projection's SELECT: every column EXCEPT body_json (substr caps
# body_plain in SQL so the big text never crosses the row boundary at all).
_NOTE_SUMMARY_COLS = (
    "id, user_id, account_id, folder_id, title, subtitle, "
    f"substr(coalesce(body_plain, ''), 1, {_LIST_PLAIN_CHARS}) AS body_plain, "
    "hero_image_url, first_image_url, ticker, tags, created_at, updated_at"
)


def _row_to_note_summary(row: sqlite3.Row) -> dict[str, Any]:
    """LIST-row projection: everything EXCEPT the document body. A widget-embed
    note carries its multi-KB frozen settings blob in body_json, so a 100-note
    list response was shipping megabytes nobody read — the list UI renders
    title/subtitle/tags/hero only, and the editor fetches the single note
    (which keeps full bodyJson). bodyJson is deliberately ABSENT (not {}):
    an empty doc would look loadable."""
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "accountId": row["account_id"],
        "folderId": row["folder_id"],
        "title": row["title"] or "",
        "subtitle": row["subtitle"],
        "bodyPlain": row["body_plain"] or "",
        "heroImageUrl": row["hero_image_url"],
        "firstImageUrl": row["first_image_url"],
        "ticker": row["ticker"],
        "tags": json.loads(row["tags"] or "[]"),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _row_to_folder(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "name": row["name"],
        "sortOrder": row["sort_order"],
        "createdAt": row["created_at"],
        "parentId": row["parent_id"] or None,
    }


def _folder_depth(conn: sqlite3.Connection, user_id: str, folder_id: str) -> int:
    """1-based depth of folder_id. Walks up; a cycle or missing parent stops the walk."""
    depth, cur, seen = 0, folder_id, set()
    while cur and cur not in seen:
        seen.add(cur)
        row = conn.execute(
            "SELECT parent_id FROM j2_note_folders WHERE id = ? AND user_id = ?",
            (cur, user_id)).fetchone()
        if row is None:
            break
        depth += 1
        cur = row["parent_id"]
    return depth


# ── Notes CRUD ───────────────────────────────────────────────────────────────

def list_notes(
    user_id: str,
    *,
    folder_id: str | None = None,
    tag: str | None = None,
    ticker: str | None = None,
    q: str | None = None,
    embed_symbol: str | None = None,
    embed_widget: str | None = None,
    sort: str = "updated",
    limit: int = 100,
    offset: int = 0,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = f"SELECT {_NOTE_SUMMARY_COLS} FROM j2_notes WHERE user_id = ?"
        params: list[Any] = [user_id]
        if folder_id == "__unfiled__":
            sql += " AND folder_id IS NULL"
        elif folder_id:
            sql += " AND folder_id = ?"
            params.append(folder_id)
        if ticker:
            sql += " AND ticker = ?"
            params.append(ticker.strip().upper())
        # Widget-embed filters ("every entry where I traded AMD" / "every entry
        # with a breadth widget") — answered from the j2_note_embeds sidecar.
        if embed_symbol:
            sql += (" AND EXISTS (SELECT 1 FROM j2_note_embeds e"
                    " WHERE e.note_id = j2_notes.id AND e.user_id = j2_notes.user_id"
                    " AND e.symbol = ?)")
            params.append(embed_symbol.strip().upper())
        if embed_widget:
            sql += (" AND EXISTS (SELECT 1 FROM j2_note_embeds e"
                    " WHERE e.note_id = j2_notes.id AND e.user_id = j2_notes.user_id"
                    " AND e.widget_id = ?)")
            params.append(embed_widget.strip())
        if tag:
            # JSON LIKE — case-insensitive substring of any tag value.
            sql += ' AND lower(tags) LIKE ?'
            params.append(f'%"{tag.lower()}"%')
        if q:
            sql += " AND (lower(title) LIKE ? OR lower(body_plain) LIKE ?)"
            ql = f"%{q.lower()}%"
            params.extend([ql, ql])
        order_col = {
            "updated": "updated_at DESC",
            "created": "created_at DESC",
            "title": "title COLLATE NOCASE ASC",
        }.get(sort, "updated_at DESC")
        sql += f" ORDER BY {order_col} LIMIT ? OFFSET ?"
        params.extend([max(1, min(limit, 500)), max(0, offset)])
        rows = conn.execute(sql, params).fetchall()
        return [_row_to_note_summary(r) for r in rows]
    finally:
        if owned:
            conn.close()


def get_symbol_backlinks(
    user_id: str,
    symbol: str,
    limit: int = 5,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """"Which of my entries reference this ticker?" — answered from the
    j2_note_embeds sidecar (indexed on (user_id, symbol)).

    The sidecar has been written on every note save since v1 and read by
    exactly ONE consumer: the notes-list `embed_symbol` filter. This is the
    read that lets the REST of the app see the journal — a ticker surface
    anywhere can say "4 entries reference AMD" and link straight to them.

    ⚠️ Same membership question as that list filter, so
    `test_backlinks_and_the_list_filter_agree` pins the two together: if one
    ever learns a rule the other doesn't, it goes red rather than quietly
    disagreeing about which notes mention a symbol."""
    sym = (symbol or "").strip().upper()
    out: dict[str, Any] = {"symbol": sym, "count": 0, "notes": []}
    if not sym:
        return out
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT COUNT(DISTINCT e.note_id) AS c FROM j2_note_embeds e"
            " JOIN j2_notes n ON n.id = e.note_id AND n.user_id = e.user_id"
            " WHERE e.user_id = ? AND e.symbol = ?",
            (user_id, sym),
        ).fetchone()
        out["count"] = int(row["c"] or 0) if row else 0
        if not out["count"]:
            return out
        rows = conn.execute(
            "SELECT n.id, n.title, n.updated_at,"
            "       COUNT(*) AS refs,"
            "       GROUP_CONCAT(DISTINCT e.widget_id) AS widgets"
            " FROM j2_note_embeds e"
            " JOIN j2_notes n ON n.id = e.note_id AND n.user_id = e.user_id"
            " WHERE e.user_id = ? AND e.symbol = ?"
            " GROUP BY n.id"
            " ORDER BY n.updated_at DESC"
            " LIMIT ?",
            (user_id, sym, max(1, min(limit, 25))),
        ).fetchall()
        out["notes"] = [{
            "id": r["id"],
            "title": r["title"] or "Untitled",
            "updatedAt": r["updated_at"],
            "refs": int(r["refs"] or 0),
            "widgetIds": sorted((r["widgets"] or "").split(",")) if r["widgets"] else [],
        } for r in rows]
        return out
    finally:
        if owned:
            conn.close()


def get_note(
    user_id: str,
    note_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        ).fetchone()
        if row is None:
            return None
        note = _row_to_note(row)
        # Lazy backfill of the card thumbnail for notes saved before the
        # first_image_url column existed. Writes ONLY that column (never
        # updated_at, so opening a note can't shift its "updated" time). No-op
        # once populated or when the note has no image.
        if row["first_image_url"] is None:
            first = _extract_first_image(note["bodyJson"])
            if first:
                conn.execute(
                    "UPDATE j2_notes SET first_image_url = ? WHERE id = ? AND user_id = ?",
                    (first, note_id, user_id),
                )
                conn.commit()
                note["firstImageUrl"] = first
        return note
    finally:
        if owned:
            conn.close()


def create_note(
    user_id: str,
    payload: dict[str, Any] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    payload = payload or {}
    title = (payload.get("title") or "").strip()
    if len(title) > MAX_TITLE_CHARS:
        raise NoteValidationError("title too long")
    subtitle = payload.get("subtitle")
    if subtitle is not None:
        if not isinstance(subtitle, str):
            raise NoteValidationError("subtitle must be a string")
        subtitle = subtitle.strip() or None
        if subtitle and len(subtitle) > MAX_SUBTITLE_CHARS:
            raise NoteValidationError("subtitle too long")
    body_json = _validate_body_json(payload.get("bodyJson"))
    body_plain = extract_plain_text(body_json)
    first_image = _extract_first_image(body_json)
    folder_id = payload.get("folderId") or None
    ticker = _validate_ticker(payload.get("ticker"))
    tags = _validate_tags(payload.get("tags"))
    hero = payload.get("heroImageUrl") or None
    account_id = payload.get("accountId") or None

    owned = conn is None
    conn = conn or get_connection()
    try:
        new_id = uuid.uuid4().hex
        now = _now_iso()
        if folder_id:
            ok = conn.execute(
                "SELECT 1 FROM j2_note_folders WHERE id = ? AND user_id = ?",
                (folder_id, user_id),
            ).fetchone()
            if not ok:
                raise NoteValidationError("folder not found")
        conn.execute(
            """
            INSERT INTO j2_notes (
                id, user_id, account_id, folder_id, title, subtitle,
                body_json, body_plain, hero_image_url, first_image_url, ticker, tags,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id, user_id, account_id, folder_id, title, subtitle,
                json.dumps(body_json), body_plain, hero, first_image, ticker,
                json.dumps(tags), now, now,
            ),
        )
        _sync_note_embeds(conn, user_id, new_id, body_json)
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ?", (new_id,)
        ).fetchone()
        return _row_to_note(row)
    finally:
        if owned:
            conn.close()


def update_note(
    user_id: str,
    note_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
    expected_updated_at: str | None = None,
) -> dict[str, Any] | None:
    """`expected_updated_at` (optional) makes the write a compare-and-set:
    when it no longer matches the row's updated_at, another writer (the
    'Send to Journal' server append, a second tab) got there first and a
    blind full-doc PUT would silently delete their write — the A15 clobber.
    Raise instead; the editor pulls the fresh note, merges, and retries.
    None (client didn't send a baseline) keeps last-writer-wins."""
    if not isinstance(patch, dict):
        raise NoteValidationError("patch must be an object")
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        ).fetchone()
        if existing is None:
            return None
        if expected_updated_at is not None and existing["updated_at"] != expected_updated_at:
            raise NoteConflictError("note changed since the client's baseline")

        sets: list[str] = []
        params: list[Any] = []

        if "title" in patch:
            t = (patch["title"] or "").strip()
            if len(t) > MAX_TITLE_CHARS:
                raise NoteValidationError("title too long")
            sets.append("title = ?"); params.append(t)
        if "subtitle" in patch:
            s = patch["subtitle"]
            if s is not None:
                if not isinstance(s, str):
                    raise NoteValidationError("subtitle must be a string")
                s = s.strip() or None
                if s and len(s) > MAX_SUBTITLE_CHARS:
                    raise NoteValidationError("subtitle too long")
            sets.append("subtitle = ?"); params.append(s)
        if "bodyJson" in patch:
            bj = _validate_body_json(patch["bodyJson"])
            bp = extract_plain_text(bj)
            sets.append("body_json = ?"); params.append(json.dumps(bj))
            sets.append("body_plain = ?"); params.append(bp)
            sets.append("first_image_url = ?"); params.append(_extract_first_image(bj))
        if "folderId" in patch:
            f = patch["folderId"] or None
            if f:
                ok = conn.execute(
                    "SELECT 1 FROM j2_note_folders WHERE id = ? AND user_id = ?",
                    (f, user_id),
                ).fetchone()
                if not ok:
                    raise NoteValidationError("folder not found")
            sets.append("folder_id = ?"); params.append(f)
        if "ticker" in patch:
            sets.append("ticker = ?"); params.append(_validate_ticker(patch["ticker"]))
        if "tags" in patch:
            sets.append("tags = ?"); params.append(json.dumps(_validate_tags(patch["tags"])))
        if "heroImageUrl" in patch:
            h = patch["heroImageUrl"] or None
            if h is not None and not isinstance(h, str):
                raise NoteValidationError("heroImageUrl must be string or null")
            sets.append("hero_image_url = ?"); params.append(h)

        if not sets:
            return _row_to_note(existing)

        sets.append("updated_at = ?"); params.append(_now_iso())
        params.extend([note_id, user_id])
        conn.execute(
            f"UPDATE j2_notes SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
            params,
        )
        if "bodyJson" in patch:
            _sync_note_embeds(conn, user_id, note_id, bj)
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ?", (note_id,)
        ).fetchone()
        return _row_to_note(row)
    finally:
        if owned:
            conn.close()


def append_widget_embed(
    user_id: str,
    note_id: str,
    attrs: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Append one widgetEmbed node to a note's body — the server half of
    'Send to Journal' from an on-screen widget. Atomic: load, append, and
    save in one transaction, riding the same body_plain + sidecar sync every
    body write gets. `attrs` is a complete client-built attr set
    (buildWidgetEmbedAttrs output); minimal shape checks only, matching the
    deliberately-permissive body validation."""
    if not isinstance(attrs, dict) or not isinstance(attrs.get("widgetId"), str) or not attrs["widgetId"]:
        raise NoteValidationError("attrs.widgetId required")
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT body_json FROM j2_notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        ).fetchone()
        if row is None:
            return None
        try:
            doc = json.loads(row["body_json"] or "{}")
        except (TypeError, ValueError):
            doc = {}
        if not isinstance(doc, dict) or doc.get("type") != "doc":
            doc = {"type": "doc", "content": []}
        content = doc.get("content")
        if not isinstance(content, list):
            content = []
        content.append({"type": "widgetEmbed", "attrs": attrs})
        doc["content"] = content
        body_json = _validate_body_json(doc)
        body_plain = extract_plain_text(body_json)
        conn.execute(
            "UPDATE j2_notes SET body_json = ?, body_plain = ?, updated_at = ?"
            " WHERE id = ? AND user_id = ?",
            (json.dumps(body_json), body_plain, _now_iso(), note_id, user_id),
        )
        _sync_note_embeds(conn, user_id, note_id, body_json)
        conn.commit()
        out = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ?", (note_id,)
        ).fetchone()
        return _row_to_note(out)
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


# ── Capture inbox ────────────────────────────────────────────────────────────

# One cap, two queries: the tray lists the newest N, and create_capture prunes
# past the same N — the table was made a table BECAUSE prefs had no size cap
# (db.py's schema note), so the cap must hold on the INSERT side too. Without
# the prune, rows past the newest N were invisible to the tray and therefore
# undeletable through the only delete path the UI exposes: unbounded growth,
# one layer down from the hazard the table was created to avoid.
_CAPTURE_INBOX_CAP = 100


def list_captures(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_capture_inbox WHERE user_id = ?"
            " ORDER BY created_at DESC LIMIT ?",
            (user_id, _CAPTURE_INBOX_CAP),
        ).fetchall()
        return [{
            "id": r["id"],
            "widgetId": r["widget_id"],
            "params": json.loads(r["params_json"] or "{}"),
            "searchText": r["search_text"],
            "fallbackUrl": r["fallback_url"],
            "capturedAt": r["captured_at"],
            "createdAt": r["created_at"],
        } for r in rows]
    finally:
        if owned:
            conn.close()


def create_capture(
    user_id: str,
    payload: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict) or not isinstance(payload.get("widgetId"), str) or not payload["widgetId"]:
        raise NoteValidationError("widgetId required")
    params = payload.get("params")
    if params is not None and not isinstance(params, dict):
        raise NoteValidationError("params must be an object")
    # The ONLY Journal-Widgets write path without a byte ceiling until the
    # launch audit caught it: notes cap at 1MB, but a scripted (or organic —
    # a long aisearch thread) capture could bank arbitrarily large rows in the
    # shared auth.db, x100 rows per user. 256KB comfortably fits every real
    # capture (the largest organic payloads measure ~30KB).
    _size = len(json.dumps(params or {}).encode("utf-8")) + len(str(payload.get("searchText") or "").encode("utf-8"))
    if _size > 256 * 1024:
        raise NoteValidationError("capture too large (>256KB)")
    owned = conn is None
    conn = conn or get_connection()
    try:
        cid = uuid.uuid4().hex
        now = _now_iso()
        conn.execute(
            "INSERT INTO j2_capture_inbox (id, user_id, widget_id, params_json,"
            " search_text, fallback_url, captured_at, created_at)"
            " VALUES (?,?,?,?,?,?,?,?)",
            (cid, user_id, payload["widgetId"], json.dumps(params or {}),
             payload.get("searchText") or None, payload.get("fallbackUrl") or None,
             payload.get("capturedAt") or now, now),
        )
        # Keep only the newest _CAPTURE_INBOX_CAP rows — anything older is
        # unreachable through the tray anyway (see the cap's comment above).
        conn.execute(
            "DELETE FROM j2_capture_inbox WHERE user_id = ? AND id NOT IN ("
            " SELECT id FROM j2_capture_inbox WHERE user_id = ?"
            " ORDER BY created_at DESC LIMIT ?)",
            (user_id, user_id, _CAPTURE_INBOX_CAP),
        )
        conn.commit()
        return {"id": cid, "createdAt": now}
    finally:
        if owned:
            conn.close()


def delete_capture(
    user_id: str, capture_id: str, conn: sqlite3.Connection | None = None,
) -> bool:
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM j2_capture_inbox WHERE id = ? AND user_id = ?",
            (capture_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def delete_note(
    user_id: str,
    note_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "DELETE FROM j2_notes WHERE id = ? AND user_id = ?",
            (note_id, user_id),
        )
        if cur.rowcount:
            conn.execute("DELETE FROM j2_note_embeds WHERE note_id = ?", (note_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


# ── Folders CRUD ─────────────────────────────────────────────────────────────

def list_folders(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_note_folders WHERE user_id = ? "
            "ORDER BY sort_order ASC, name COLLATE NOCASE ASC",
            (user_id,),
        ).fetchall()
        return [_row_to_folder(r) for r in rows]
    finally:
        if owned:
            conn.close()


def create_folder(
    user_id: str,
    name: str,
    sort_order: int = 0,
    parent_id: str = "",
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    if not isinstance(name, str) or not name.strip():
        raise NoteValidationError("folder name is required")
    n = name.strip()
    if len(n) > 80:
        raise NoteValidationError("folder name too long")
    owned = conn is None
    conn = conn or get_connection()
    try:
        # Validate parent if truthy
        if parent_id:
            parent_row = conn.execute(
                "SELECT 1 FROM j2_note_folders WHERE id = ? AND user_id = ?",
                (parent_id, user_id)).fetchone()
            if parent_row is None:
                raise NoteValidationError("parent folder not found")
            # Check depth cap
            parent_depth = _folder_depth(conn, user_id, parent_id)
            if parent_depth + 1 > MAX_FOLDER_DEPTH:
                raise NoteValidationError("folder nesting too deep")

        new_id = uuid.uuid4().hex
        now = _now_iso()
        try:
            conn.execute(
                "INSERT INTO j2_note_folders (id, user_id, name, sort_order, parent_id, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (new_id, user_id, n, sort_order, parent_id, now),
            )
        except sqlite3.IntegrityError:
            raise NoteValidationError("folder with that name already exists")
        if owned:
            conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_note_folders WHERE id = ?", (new_id,)
        ).fetchone()
        return _row_to_folder(row)
    finally:
        if owned:
            conn.close()


def update_folder(
    user_id: str,
    folder_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT * FROM j2_note_folders WHERE id = ? AND user_id = ?",
            (folder_id, user_id),
        ).fetchone()
        if existing is None:
            return None
        sets: list[str] = []
        params: list[Any] = []
        if "name" in patch:
            n = (patch["name"] or "").strip()
            if not n:
                raise NoteValidationError("folder name cannot be empty")
            if len(n) > 80:
                raise NoteValidationError("folder name too long")
            sets.append("name = ?"); params.append(n)
        if "sortOrder" in patch:
            so = patch["sortOrder"]
            if not isinstance(so, int):
                raise NoteValidationError("sortOrder must be integer")
            sets.append("sort_order = ?"); params.append(so)
        if not sets:
            return _row_to_folder(existing)
        params.extend([folder_id, user_id])
        try:
            conn.execute(
                f"UPDATE j2_note_folders SET {', '.join(sets)} "
                f"WHERE id = ? AND user_id = ?",
                params,
            )
        except sqlite3.IntegrityError:
            raise NoteValidationError("folder with that name already exists")
        if owned:
            conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_note_folders WHERE id = ?", (folder_id,)
        ).fetchone()
        return _row_to_folder(row)
    finally:
        if owned:
            conn.close()


def delete_folder(
    user_id: str,
    folder_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Delete folder; re-parents children and notes to the deleted folder's parent.
    Root deletion (parent_id='') sends notes to Unfiled (NULL)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT parent_id FROM j2_note_folders WHERE id = ? AND user_id = ?",
            (folder_id, user_id)).fetchone()
        if row is None:
            return False
        parent = row["parent_id"] or ""

        # Detect name collisions BEFORE any mutations
        # Exclude the deleted folder itself from the destination set to avoid self-referential false positives
        collision = conn.execute(
            "SELECT name FROM j2_note_folders WHERE user_id = ? AND parent_id = ? AND id != ? AND name IN "
            "(SELECT name FROM j2_note_folders WHERE user_id = ? AND parent_id = ?)",
            (user_id, parent, folder_id, user_id, folder_id)).fetchone()
        if collision:
            raise NoteValidationError(
                f"cannot delete: a folder named '{collision['name']}' already exists at the destination — rename it first")

        now = _now_iso()
        # Delete the folder first to avoid UNIQUE constraint violations when re-parenting
        cur = conn.execute(
            "DELETE FROM j2_note_folders WHERE id = ? AND user_id = ?", (folder_id, user_id))
        # notes climb to the parent; at root ('' parent) they go Unfiled (NULL)
        conn.execute(
            "UPDATE j2_notes SET folder_id = ?, updated_at = ? WHERE folder_id = ? AND user_id = ?",
            (parent or None, now, folder_id, user_id))
        conn.execute(
            "UPDATE j2_note_folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?",
            (parent, folder_id, user_id))
        if owned:
            conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def ensure_folder_path(user_id: str, path_parts: list[str], dest_folder_id: str = "", conn=None) -> str:
    """Upsert a folder chain under dest_folder_id; returns leaf folder id.
    Truncates each segment to the 80-char folder-name cap."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        pid = dest_folder_id or ""
        for raw in path_parts:
            name = (raw or "").strip()[:80] or "Untitled"
            row = conn.execute(
                "SELECT id FROM j2_note_folders WHERE user_id = ? AND parent_id = ? AND name = ?",
                (user_id, pid, name)).fetchone()
            if row:
                pid = row["id"]
            else:
                pid = create_folder(user_id, name, parent_id=pid, conn=conn)["id"]
        return pid
    finally:
        if owned:
            conn.close()


# ── Image upload ─────────────────────────────────────────────────────────────

def save_note_image_bytes(
    user_id: str,
    note_id: str,
    data: bytes,
    filename: str,
    content_type: str,
    *,
    kind: str = "inline",  # "inline" or "hero"
) -> dict[str, Any]:
    """Sync bytes-level image save. Validate + persist image bytes to disk.
    Returns {url, width, height}. Caller is responsible for setting
    hero_image_url on the note row (if kind=hero) or inserting an
    image node in body_json (if kind=inline).

    Note: filename parameter is unused; extension is derived from content_type."""
    if content_type not in _ALLOWED_IMAGE_MIMES:
        raise NoteValidationError("Only PNG/JPG/GIF/WebP images allowed")
    if len(data) > _MAX_IMAGE_BYTES:
        raise NoteValidationError("Image must be < 5 MB")
    if len(data) == 0:
        raise NoteValidationError("Empty file")

    ext_map = {
        "image/png": ".png", "image/jpeg": ".jpg",
        "image/gif": ".gif", "image/webp": ".webp",
    }
    ext = ext_map.get(content_type, ".png")

    sub = "hero" if kind == "hero" else "inline"
    target_dir = _ATTACHMENT_ROOT / user_id / "notes" / note_id / sub
    target_dir.mkdir(parents=True, exist_ok=True)
    # Content-hash filename (post-v1 dedupe, designed for from day one via the
    # fallback.url indirection): an identical byte-for-byte upload — e.g. the
    # embed self-archive re-capturing an unchanged chart — lands on the SAME
    # path and is a no-op instead of a new file. Truncated sha256 keeps the
    # exact 32-hex shape uuid4().hex had, so the attachment GC's upload-name
    # filter and every stored URL stay valid; changed pixels = new hash = new
    # file, and the orphaned old one ages into the GC.
    new_id = hashlib.sha256(data).hexdigest()[:32]
    target_path = target_dir / f"{new_id}{ext}"
    if not target_path.exists():
        target_path.write_bytes(data)

    public_url = (
        f"/api/j2/notes/attachments/{user_id}/{note_id}/{sub}/{new_id}{ext}"
    )
    # Width/height: only computed if Pillow can read it; otherwise skip.
    width = height = None
    try:
        from PIL import Image
        with Image.open(target_path) as im:
            width, height = im.size
    except Exception:
        pass
    return {"url": public_url, "width": width, "height": height}


def save_note_attachment_bytes(
    user_id: str,
    note_id: str,
    data: bytes,
    filename: str,
    content_type: str,
) -> dict[str, Any]:
    """Sync bytes-level file save. Validate + persist file bytes to disk.
    Returns {url, name, size}. File is stored under _ATTACHMENT_ROOT/{user_id}/notes/{note_id}/file/

    Empty filename defaults to "attachment"."""
    if content_type not in _ALLOWED_FILE_MIMES:
        raise NoteValidationError(f"MIME type {content_type} not allowed")
    if len(data) > _MAX_FILE_BYTES:
        raise NoteValidationError("File must be < 25 MB")
    if len(data) == 0:
        raise NoteValidationError("Empty file")

    # Fallback: empty filename becomes "attachment"
    filename = filename or "attachment"

    # Extract extension from filename; default to .bin if not in allowlist
    ext_map = {
        ".pdf": ".pdf", ".txt": ".txt", ".csv": ".csv", ".md": ".md",
        ".zip": ".zip", ".mp3": ".mp3", ".m4a": ".m4a",
        ".docx": ".docx", ".xlsx": ".xlsx",
    }
    # Get extension from filename (case-insensitive)
    file_ext = ""
    if "." in filename:
        file_ext = filename[filename.rfind("."):].lower()
    ext = ext_map.get(file_ext, ".bin")

    sub = "file"
    target_dir = _ATTACHMENT_ROOT / user_id / "notes" / note_id / sub
    target_dir.mkdir(parents=True, exist_ok=True)
    new_id = uuid.uuid4().hex
    target_path = target_dir / f"{new_id}{ext}"
    target_path.write_bytes(data)

    public_url = (
        f"/api/j2/notes/attachments/{user_id}/{note_id}/{sub}/{new_id}{ext}"
    )
    return {"url": public_url, "name": filename, "size": len(data)}


async def save_note_image(
    user_id: str,
    note_id: str,
    upload,
    *,
    kind: str = "inline",  # "inline" or "hero"
) -> dict[str, Any]:
    """Validate + persist an image attached to a note. Returns
    {url, width, height}. Caller is responsible for setting
    hero_image_url on the note row (if kind=hero) or inserting an
    image node in body_json (if kind=inline)."""
    # Validate MIME type BEFORE reading to reject bad-MIME uploads without buffering
    if upload.content_type not in _ALLOWED_IMAGE_MIMES:
        raise NoteValidationError("Only PNG/JPG/GIF/WebP images allowed")
    raw = await upload.read()
    return save_note_image_bytes(
        user_id, note_id, raw, upload.filename or "image", upload.content_type, kind=kind
    )


async def save_note_attachment(
    user_id: str,
    note_id: str,
    upload,
) -> dict[str, Any]:
    """Validate + persist a non-image file attached to a note. Returns
    {url, name, size}. File is stored under _ATTACHMENT_ROOT/{user_id}/notes/{note_id}/file/"""
    # Validate MIME type BEFORE reading to reject bad-MIME uploads without buffering
    if upload.content_type not in _ALLOWED_FILE_MIMES:
        raise NoteValidationError(f"MIME type {upload.content_type} not allowed")
    raw = await upload.read()
    filename = getattr(upload, "filename", "") or "attachment"
    return save_note_attachment_bytes(
        user_id, note_id, raw, filename, upload.content_type
    )


def serve_note_image_path(
    user_id: str,
    note_id: str,
    sub: str,
    filename: str,
) -> Path | None:
    if sub not in ("hero", "inline", "file"):
        return None
    if "/" in filename or "\\" in filename or filename.startswith("."):
        return None
    rel = Path(user_id) / "notes" / note_id / sub
    # Primary root first, then the LEGACY repo-relative tree — a box that still
    # holds files in the old location keeps serving them after the root moved.
    # The traversal guard is re-applied per candidate, never skipped.
    for base in _read_candidates(rel):
        target = (base / filename).resolve()
        try:
            target.relative_to(base.resolve())
        except ValueError:
            continue
        if target.exists():
            return target
    return None


# ── Playbook → TipTap converter (used by migration in db.py) ─────────────────

def convert_playbook_to_tiptap(entry: dict[str, Any]) -> dict[str, Any]:
    """Build a TipTap ProseMirror doc from a legacy playbook entry dict
    (the shape returned by the old playbook.py `_row_to_entry`).
    Returns {"type":"doc","content":[...]} ready to JSON-encode."""
    content: list[dict[str, Any]] = []

    # H1: symbol — observedDate
    symbol = entry.get("symbol") or ""
    observed = entry.get("observedDate") or ""
    heading_text = (
        f"{symbol} — {observed}" if symbol and observed else (symbol or observed or "Note")
    )
    content.append({
        "type": "heading",
        "attrs": {"level": 1},
        "content": [{"type": "text", "text": heading_text}],
    })

    # Levels table
    levels = entry.get("levels") or {}
    if isinstance(levels, dict) and any(levels.get(k) is not None for k in
                                         ("trigger", "support", "resistance", "stop", "target")):
        rows = []
        header_cells = []
        body_cells = []
        for key, label in [
            ("trigger", "Trigger"), ("support", "Support"),
            ("resistance", "Resistance"), ("stop", "Stop"), ("target", "Target"),
        ]:
            v = levels.get(key)
            if v is None:
                continue
            header_cells.append({
                "type": "tableHeader",
                "content": [{"type": "paragraph",
                             "content": [{"type": "text", "text": label}]}],
            })
            body_cells.append({
                "type": "tableCell",
                "content": [{"type": "paragraph",
                             "content": [{"type": "text", "text": f"${v}"}]}],
            })
        rows.append({"type": "tableRow", "content": header_cells})
        rows.append({"type": "tableRow", "content": body_cells})
        content.append({"type": "table", "content": rows})

    # Thesis paragraph (only if non-empty)
    thesis = (entry.get("thesis") or "").strip()
    if thesis:
        content.append({
            "type": "paragraph",
            "content": [{"type": "text", "text": thesis}],
        })

    # Attachments: images become image nodes, links become paragraph w/ link.
    for att in (entry.get("attachments") or []):
        if not isinstance(att, dict):
            continue
        url = att.get("url")
        if not url:
            continue
        if att.get("kind") == "image":
            content.append({"type": "image", "attrs": {"src": url, "alt": ""}})
        elif att.get("kind") == "link":
            label = att.get("label") or url
            content.append({
                "type": "paragraph",
                "content": [{
                    "type": "text",
                    "text": label,
                    "marks": [{"type": "link", "attrs": {"href": url}}],
                }],
            })

    # Additional notes
    notes = (entry.get("notes") or "").strip()
    if notes:
        content.append({
            "type": "paragraph",
            "content": [{"type": "text", "text": notes}],
        })

    return {"type": "doc", "content": content}
