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
from api.services import buzz_extract
from api.services.journal_two.note_trade_links import is_valid_trade_ref_type

# Stage A member-validation instrumentation (implementation-plan.md §6):
# aggregate usage signal only — event name + a tiny non-content details blob,
# reusing the existing platform-wide activity_log (auth_service.log_activity,
# already never-raises). NEVER log note bodies, search query text, Ask
# Current Note questions, or any other private research content — see
# decision-log "Stage A→B gate" entry for the instrumentation scope this
# implements. Lazy import (auth_service, not auth_db) avoids a module-load
# cycle; failure is swallowed by log_activity itself, never blocks the
# member-facing action that triggered it.
def _log_notebook_event(user_id: str, event: str, details: dict | None = None) -> None:
    try:
        from api.services.auth_service import log_activity
        log_activity(user_id, f"j2:{event}", json.dumps(details or {})[:500])
    except Exception:  # noqa: BLE001 — analytics must never break the real action
        pass


MAX_TITLE_CHARS = 300
MAX_SUBTITLE_CHARS = 500
MAX_BODY_JSON_BYTES = 1_000_000  # 1MB
MAX_TAG_LENGTH = 40
MAX_TAGS = 30
MAX_TICKER_LENGTH = 16
MAX_FOLDER_DEPTH = 6

# ⛔⛔ session-audit.md A1 (2026-09-02): the Obsidian ingest boundary
# (`note_connectors/obsidian_staging.py::_MAX_BODY_MD_LEN`) used to be its
# OWN independent number (1.5MB), in a file that never referenced this one
# -- so a note could clear the ingest door and then ALWAYS fail this
# storage door, because markdown->TipTap JSON is not 1:1. Measured blowup
# for real note shapes (bullet logs 3.45x, checkbox task lists 4.08x, short
# headed sections 4.65x) tops out at ~4.7x -- so a plain trading-journal
# note of ~210-280KB of markdown was already 5-7x under the OLD ingest cap
# and guaranteed to die at THIS one. `MAX_BODY_MD_CHARS_ESTIMATE` derives
# the honest markdown-side ceiling FROM this byte ceiling and that measured
# worst case, so the two doors can never again disagree about "how big may
# a note be" -- obsidian_staging.py imports this constant rather than
# hardcoding a second number. This is an ESTIMATE, not a guarantee (the
# 4.7x figure is the worst of three measured shapes, not a proven maximum),
# which is exactly why storage-side per-note isolation in `import_confirm`
# below is kept as the backstop rather than relying on this estimate alone.
_MD_TO_JSON_WORST_CASE_BLOWUP = 4.7
MAX_BODY_MD_CHARS_ESTIMATE = int(MAX_BODY_JSON_BYTES / _MD_TO_JSON_WORST_CASE_BLOWUP)

from api.services.journal_two.attachment_root import (
    attachment_root as _attachment_root, read_candidates as _read_candidates,
    read_candidates_with_roots as _read_candidates_with_roots,
)
from api.services.journal_two.notes_quota import (
    NoteQuotaExceeded, assert_import_headroom,
)
from api.services.journal_two.notes_search import fts_match_expr

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
                trade_ref = attrs.get("tradeRef") or None
                trade_ref_type = attrs.get("tradeRefType") or None
                # Degrade, never 500 the note write (same philosophy as the
                # rest of this function): an unrecognized tradeRefType is
                # dropped to NULL (the embed still saves, just as an
                # untyped/legacy-shaped reference) rather than blocking the
                # save. Note save is authoritative; this projection sync is not.
                if trade_ref_type is not None and not is_valid_trade_ref_type(trade_ref_type):
                    trade_ref_type = None
                rows.append({
                    "widget_id": widget_id,
                    "symbol": sym.upper() if isinstance(sym, str) and sym else None,
                    "timeframe": str(tf) if tf is not None else None,
                    "trade_ref": trade_ref,
                    "trade_ref_type": trade_ref_type if trade_ref else None,
                    "mode": attrs.get("mode") or None,
                    "captured_at": attrs.get("capturedAt") or None,
                })
        for child in node.get("content", []) or []:
            walk(child)
    if isinstance(doc, dict):
        walk(doc)
    return rows


def _extract_note_links(doc: dict[str, Any] | None) -> list[str]:
    """Every `noteLink` node's target id, in document order (Wave D). A note
    linking to the same target twice keeps BOTH occurrences (position is part
    of the sidecar's primary key) -- directive §64 wants the backlink UI to
    show one relationship per SOURCE note, not one row per occurrence, and
    that de-dup happens at the QUERY layer (get_note_backlinks), not here, so
    this stays a faithful, ungrouped projection of what the document actually
    contains."""
    ids: list[str] = []
    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        if node.get("type") == "noteLink":
            attrs = node.get("attrs")
            target = attrs.get("noteId") if isinstance(attrs, dict) else None
            if isinstance(target, str) and target:
                ids.append(target)
        for child in node.get("content", []) or []:
            walk(child)
    if isinstance(doc, dict):
        walk(doc)
    return ids


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
            " symbol, timeframe, trade_ref, trade_ref_type, mode, captured_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            [(note_id, user_id, i, r["widget_id"], r["symbol"], r["timeframe"],
              r["trade_ref"], r["trade_ref_type"], r["mode"], r["captured_at"])
             for i, r in enumerate(rows)])


# ── Prose-mention sidecar (j2_note_mentions, P0-3) ───────────────────────────

def _sync_note_mentions(
    conn: sqlite3.Connection, user_id: str, note_id: str, body_plain: str | None,
) -> None:
    """Rebuild the note's j2_note_mentions projection inside the caller's
    transaction (no commit here) — same delete+insert idiom as
    _sync_note_embeds. Cashtag-tier ONLY (see the schema comment in db.py for
    why): scans body_plain, which every caller has already computed via
    extract_plain_text — this never re-derives note text or re-walks
    body_json. Fast and local: buzz_extract is a pure regex/set-membership
    matcher, no network call, so this never makes a note save depend on an
    external provider."""
    conn.execute("DELETE FROM j2_note_mentions WHERE note_id = ?", (note_id,))
    symbols = sorted({
        sym for sym, tier in buzz_extract.extract(body_plain or "")
        if tier == "cashtag"
    })
    if symbols:
        now = _now_iso()
        conn.executemany(
            "INSERT INTO j2_note_mentions (note_id, user_id, symbol, created_at)"
            " VALUES (?,?,?,?)",
            [(note_id, user_id, sym, now) for sym in symbols])


# ── Internal note-link sidecar (j2_note_links, Wave D) ───────────────────────

def _sync_note_links(
    conn: sqlite3.Connection, user_id: str, note_id: str,
    body_json: dict[str, Any] | None,
) -> None:
    """Rebuild the note's j2_note_links projection inside the caller's
    transaction (no commit here) -- same delete+insert idiom as
    _sync_note_embeds/_sync_note_mentions. A `noteLink` node's target id is
    NEVER validated against j2_notes here: a link to a note that doesn't
    exist (foreign tenant, already deleted, malformed id typed via direct API
    use) still gets a sidecar row -- resolving whether that target is real,
    owned, trashed, or purged is the READ path's job (get_note_backlinks /
    the node view's own title lookup), which re-verifies ownership on every
    call. Persisting an unresolvable row here is harmless (directive §33's
    'never silently delete source content' cuts the other way too -- this
    sync must never REJECT a save because a link target looks wrong)."""
    conn.execute("DELETE FROM j2_note_links WHERE note_id = ?", (note_id,))
    target_ids = _extract_note_links(body_json)
    if target_ids:
        conn.executemany(
            "INSERT INTO j2_note_links (note_id, user_id, position, target_note_id)"
            " VALUES (?,?,?,?)",
            [(note_id, user_id, i, tid) for i, tid in enumerate(target_ids)])


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
            # attrs can be ANY shape on an imported/hand-crafted doc — a list
            # here crashed the whole note write (the `or {}` idiom only guards
            # None/falsy, not a truthy non-dict; inherited red's named fix).
            attrs = node.get("attrs")
            attrs = attrs if isinstance(attrs, dict) else {}
            if node.get("type") == "image":
                src = attrs.get("src")
                if isinstance(src, str) and src:
                    return src
            if node.get("type") == "widgetEmbed":
                fb = attrs.get("fallback")
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


def _body_has_import_placeholder(body_json: Any) -> bool:
    """True when this body still carries an unresolved import-time
    placeholder — `import-ref://<ref>` (an image/attachmentChip node whose
    media upload has not yet been confirmed) or `import-link://<key>` (a
    cross-note link not yet rewritten to a real note URL). A raw substring
    scan of the serialized JSON, not a node-type walk: correct regardless of
    which node shape (image, attachmentChip, a link mark nested anywhere in
    the tree) carries the placeholder, and cheap enough to run on every
    import_confirm write. False positive only if a note's OWN authored text
    happens to contain one of these literal strings — harmless: it merely
    stays "pending" one write longer than strictly necessary, never loses
    data (see audit B5 / import_confirm's docstring)."""
    try:
        blob = json.dumps(body_json)
    except (TypeError, ValueError):
        return False
    return "import-ref://" in blob or "import-link://" in blob


# Genuine resource bound on one import-check request — NOT a silent
# data-hiding cap like the [:5000] slice this replaces (audit B1). That
# slice truncated one note past the wave's own 5,000-note benchmark, and
# the truncated tail came back "not existing" -> classified as a fresh
# `create` -> a re-import of a >5,000-note library duplicated everything
# past the cutoff instead of updating it, silently. SQLite's own variable
# limit is handled below by chunking into groups of 500 regardless of the
# total, so THIS cap exists only to bound one request's SQL round-trips
# against a pathological payload (hundreds of thousands of keys). Set high
# enough that a real personal library — the actual member this wave is
# for — is always checked in full; a caller that somehow clears it is told
# so honestly via `truncated`, rather than having its import silently
# reclassify updates as duplicates.
_IMPORT_CHECK_MAX_KEYS = 50_000


def import_check(user_id: str, import_keys: list[str], conn: sqlite3.Connection | None = None) -> dict:
    """Check which import keys already exist for the user.

    Returns: {"existing": {key: {"id", "updatedAt", "importHash"}},
              "checked": int, "total": int, "truncated": bool}
    `truncated` is only ever True past `_IMPORT_CHECK_MAX_KEYS` keys in one
    request — chunking below (SQLite's own variable-count limit) checks
    every key up to that cap, never fewer.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = {}
        keys = [k for k in (import_keys or []) if isinstance(k, str)]
        total = len(keys)
        truncated = total > _IMPORT_CHECK_MAX_KEYS
        if truncated:
            keys = keys[:_IMPORT_CHECK_MAX_KEYS]
        for i in range(0, len(keys), 500):  # SQLite variable limit safety
            chunk = keys[i:i + 500]
            q = ",".join("?" * len(chunk))
            # Wave 0 trash: a soft-deleted note's import_key must read as
            # "doesn't exist" here, not "exists, needs updating" — otherwise
            # a routine re-sync would silently resurrect content the member
            # deliberately trashed. `deleted_at IS NULL` is the same "this
            # note is part of my active notebook" predicate applied
            # everywhere else a note is looked up by identity.
            for row in conn.execute(
                f"SELECT id, import_key, updated_at, import_hash FROM j2_notes "
                f"WHERE user_id = ? AND deleted_at IS NULL AND import_key IN ({q})",
                (user_id, *chunk)):
                existing[row["import_key"]] = {
                    "id": row["id"], "updatedAt": row["updated_at"],
                    "importHash": row["import_hash"]}
        return {"existing": existing, "checked": len(keys), "total": total, "truncated": truncated}
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

    Returns: {"created": [...], "updated": [...], "skipped": [...], "failed": [...]}

    ⛔⛔ audit B5: a fingerprint match alone does NOT mean `skipped` — a note
    whose body still carries an unresolved `import-ref://`/`import-link://`
    placeholder (`import_media_pending`, set here and cleared by
    `update_note`'s `importMediaPending` once the client's post-confirm
    media-upload + link-rewrite phase actually finishes clean) is written
    again and reported via `updated` instead, so a failed media upload gets
    retried on the member's next import attempt rather than silently and
    permanently missing its image forever. See `_body_has_import_placeholder`.

    ⛔⛔ session-audit.md A1/A2: ONE note that cannot be stored (oversized
    body, malformed shape) is isolated to a per-note SAVEPOINT and reported
    in `failed` — it must never roll back its healthy siblings' writes in
    the same batch. Before this fix, ANY note raising here (most commonly
    `_validate_body_json`'s >1MB check, given the Obsidian ingest door used
    to accept markdown up to 5-7x that after conversion) caused a bare
    `conn.rollback(); raise`, discarding the WHOLE batch — measured against
    the real engine: a 200-note batch with one 1.2MB note landed as
    "notes in the member's notebook: 0 of 200", `status: ok`. This mirrors
    the export's own `EXPORT_ISSUES.txt` idiom (per-item try/except, name
    the failure, keep going) and the connectors engine's per-ref failure
    reporting (`fetch failed for {ref!r}: ...`) — the SAME convention,
    applied at the one call site that was still all-or-nothing.
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
        created, updated, skipped, failed = [], [], [], []
        # One import operation = one imported_at timestamp, deliberate
        now = _now_iso()
        path_cache: dict[tuple, str] = {}
        for n in notes:
            raw_key = n.get("importKey")
            key = raw_key if isinstance(raw_key, str) and raw_key else None
            try:
                if key is None:
                    raise NoteValidationError("importKey required on every note")
                body_json = _validate_body_json(n.get("bodyJson"))
                body_plain = extract_plain_text(body_json)
                first_image = _extract_first_image(body_json)
                title = (n.get("title") or "Untitled").strip()[:MAX_TITLE_CHARS]
                tags = _validate_tags(n.get("tags"))
                ticker = _validate_ticker(n.get("ticker"))
                h = _import_payload_hash(n)
                # Folder resolution is shared across notes (path_cache) and
                # deliberately sits OUTSIDE the per-note SAVEPOINT below: a
                # folder a healthy note needs must survive even when a LATER
                # note sharing that same path fails and rolls itself back.
                path = tuple((n.get("folderPath") or [])[:max_path_depth])
                if path not in path_cache:
                    path_cache[path] = (ensure_folder_path(user_id, list(path), dest, conn=conn)
                                        if path else (dest or None))
                folder_id = path_cache[path] or None
                # Wave 0 trash: same reasoning as import_check above — a
                # soft-deleted note's import_key must not match here, so a
                # re-import creates fresh content instead of resurrecting a
                # note the member deliberately trashed.
                row = conn.execute(
                    "SELECT id, import_hash, import_media_pending FROM j2_notes "
                    "WHERE user_id = ? AND deleted_at IS NULL AND import_key = ?",
                    (user_id, key)).fetchone()
                item = {"importKey": key, "id": row["id"] if row else None}
                # audit B5: a fingerprint match alone is NOT "already fully
                # imported" while media_pending is still set from an earlier
                # attempt — that flag means a prior media upload or link
                # rewrite never confirmed success (see update_note's
                # importMediaPending handling), and skipping here is exactly
                # how a failed image upload used to vanish forever: the note
                # re-confirms as `skipped` on every later attempt, so nothing
                # ever retries it. Fall through to the normal write instead,
                # which recomputes media_pending below and reports this note
                # via `updated` so the client's media/link phase runs again.
                if row and row["import_hash"] == h and not row["import_media_pending"]:
                    skipped.append(item)
                    continue
                created_at = _import_date(n.get("createdAt"), now)
                updated_at = _import_date(n.get("updatedAt"), now)
                media_pending = 1 if _body_has_import_placeholder(body_json) else 0

                # This note's write is isolated in its own SAVEPOINT: a note
                # that cannot be stored must not discard any sibling note
                # already written earlier in this same batch, and must not
                # leave a half-applied row + embeds sidecar behind for
                # ITSELF. `RELEASE` folds the savepoint into the still-open
                # outer transaction (nothing is durable until the final
                # `conn.commit()` below); `ROLLBACK TO` undoes only what
                # this note wrote.
                conn.execute("SAVEPOINT j2_import_note")
                try:
                    if row:
                        conn.execute(
                            "UPDATE j2_notes SET title=?, subtitle=?, body_json=?, body_plain=?, "
                            "first_image_url=?, folder_id=?, ticker=?, tags=?, import_hash=?, "
                            "import_media_pending=?, imported_at=?, updated_at=? "
                            "WHERE id=? AND user_id=?",
                            (title, n.get("subtitle") or None, json.dumps(body_json), body_plain,
                             first_image, folder_id, ticker, json.dumps(tags), h, media_pending, now,
                             updated_at, row["id"], user_id))
                        _sync_note_embeds(conn, user_id, row["id"], body_json)
                        _sync_note_mentions(conn, user_id, row["id"], body_plain)
                        _sync_note_links(conn, user_id, row["id"], body_json)
                        conn.execute("RELEASE j2_import_note")
                        updated.append(item)
                    else:
                        new_id = uuid.uuid4().hex
                        conn.execute(
                            "INSERT INTO j2_notes (id, user_id, folder_id, title, subtitle, body_json, "
                            "body_plain, first_image_url, ticker, tags, import_source, import_key, import_hash, "
                            "import_media_pending, imported_at, created_at, updated_at) "
                            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                            (new_id, user_id, folder_id, title, n.get("subtitle") or None,
                             json.dumps(body_json), body_plain, first_image, ticker, json.dumps(tags),
                             source, key, h, media_pending, now, created_at, updated_at))
                        _sync_note_embeds(conn, user_id, new_id, body_json)
                        _sync_note_mentions(conn, user_id, new_id, body_plain)
                        _sync_note_links(conn, user_id, new_id, body_json)
                        conn.execute("RELEASE j2_import_note")
                        item["id"] = new_id
                        created.append(item)
                except Exception:
                    conn.execute("ROLLBACK TO j2_import_note")
                    conn.execute("RELEASE j2_import_note")
                    raise
            except Exception as e:  # noqa: BLE001 -- deliberately broad, see the
                # docstring above: a bad body/tags/ticker/importKey shape
                # (NoteValidationError, the common case) and a bare DB-level
                # error are isolated the same way, so neither can abort a
                # note already committed-pending earlier in this batch.
                failed.append({"importKey": key, "error": str(e)})
                continue
        conn.commit()
        return {"created": created, "updated": updated, "skipped": skipped, "failed": failed}
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
        # Wave 0 trash: present (ISO string) only for a soft-deleted row read
        # via `include_deleted=True` (the restore/trash-detail path) — a
        # normal `get_note` never returns a deleted row at all, so this key
        # is `None` on every other read.
        "deletedAt": row["deleted_at"] if "deleted_at" in row.keys() else None,
    }


# How much body_plain a LIST row carries — enough for a card preview line,
# never the whole document.
_LIST_PLAIN_CHARS = 400


# The LIST projection's SELECT: every column EXCEPT body_json (substr caps
# body_plain in SQL so the big text never crosses the row boundary at all).
_NOTE_SUMMARY_COLS = (
    "id, user_id, account_id, folder_id, title, subtitle, "
    f"substr(coalesce(body_plain, ''), 1, {_LIST_PLAIN_CHARS}) AS body_plain, "
    "hero_image_url, first_image_url, ticker, tags, created_at, updated_at, deleted_at"
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
        # Wave 0 trash: present only in a trash-view list (`deleted=True`);
        # `None` on every normal (active-notes) list row.
        "deletedAt": row["deleted_at"] if "deleted_at" in row.keys() else None,
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

def _notes_filter_sql(
    user_id: str,
    *,
    folder_id: str | None = None,
    tag: str | None = None,
    ticker: str | None = None,
    q: str | None = None,
    embed_symbol: str | None = None,
    embed_widget: str | None = None,
    deleted: bool = False,
    date_from: str | None = None,
    date_to: str | None = None,
    symbol_in: list[str] | None = None,
) -> tuple[str, list[Any]]:
    """The WHERE clause (starting at ``WHERE user_id = ?``) + its bound params
    for "which notes match this filter set". `list_notes` and `count_notes`
    BOTH build off this ONE predicate — two independently-written WHERE
    clauses for the same membership question is a defect shape this codebase
    has been burned by repeatedly: the moment either copy learns a rule the
    other doesn't, the count and the page it counts silently disagree.

    `deleted` (Wave 0 trash): False (default, every existing call site
    unchanged) means the normal, everyday membership question — active
    notes only. True means the trash view's question — soft-deleted notes
    only. There is deliberately no third "both" mode: every caller asks one
    question or the other, never a blend that could double-count or leak a
    deleted note into a normal list.

    Wave 4 (Search Evolution I) additions — both AND onto the same predicate
    chain like every existing filter, composing freely with folder/tag/
    ticker/q:
    `date_from`/`date_to` — inclusive `YYYY-MM-DD` bounds on `created_at`
    ("Note created", never a bare "Date" — see the UI copy requirement in
    the Wave 4 design doc). Router validates the format; this function
    trusts its caller. `date_to` is treated as through-end-of-day UTC.
    `symbol_in` — the sector/theme filter's resolved symbol set (resolved
    ABOVE this function, in `list_notes`/`count_notes` — this stays a pure
    SQL-predicate builder with no ticker_meta/theme_db calls of its own).
    Generalizes the existing single-`embed_symbol` OR-of-two-EXISTS pattern
    to "any of these symbols" via `IN (...)`. An empty list means "no
    symbol in the member's mentioned vocabulary matched the requested
    sector/theme" — filters to zero rows (an honest empty result), never
    silently ignored."""
    sql = " WHERE user_id = ? AND deleted_at IS " + ("NOT NULL" if deleted else "NULL")
    params: list[Any] = [user_id]
    if folder_id == "__unfiled__":
        sql += " AND folder_id IS NULL"
    elif folder_id:
        sql += " AND folder_id = ?"
        params.append(folder_id)
    if ticker:
        sql += " AND ticker = ?"
        params.append(ticker.strip().upper())
    # "Every entry where I traded/mentioned AMD" — the name `embed_symbol`
    # predates P0-3 (Wave 1 Slice 2) and is kept for every existing caller's
    # sake, but it now answers from BOTH sidecars: accepted chart embeds
    # (j2_note_embeds) AND cashtag prose mentions (j2_note_mentions) — an OR
    # of two EXISTS checks, so a note matching either (or both) counts once.
    # Must stay pinned to get_symbol_backlinks' own UNION
    # (test_backlinks_and_the_list_filter_agree) — same membership question,
    # asked two different ways for two different callers' query shapes.
    if embed_symbol:
        sql += (" AND (EXISTS (SELECT 1 FROM j2_note_embeds e"
                " WHERE e.note_id = j2_notes.id AND e.user_id = j2_notes.user_id"
                " AND e.symbol = ?)"
                " OR EXISTS (SELECT 1 FROM j2_note_mentions m"
                " WHERE m.note_id = j2_notes.id AND m.user_id = j2_notes.user_id"
                " AND m.symbol = ?))")
        params.append(embed_symbol.strip().upper())
        params.append(embed_symbol.strip().upper())
    if embed_widget:
        sql += (" AND EXISTS (SELECT 1 FROM j2_note_embeds e"
                " WHERE e.note_id = j2_notes.id AND e.user_id = j2_notes.user_id"
                " AND e.widget_id = ?)")
        params.append(embed_widget.strip())
    if date_from:
        sql += " AND created_at >= ?"
        params.append(date_from)
    if date_to:
        sql += " AND created_at <= ?"
        params.append(f"{date_to}T23:59:59.999999+00:00")
    if symbol_in is not None:
        # Same OR-of-two-EXISTS shape as embed_symbol above, generalized to a
        # set. `symbol_in == []` (every member-mentioned symbol filtered out
        # by the requested sector/theme) deliberately still applies this
        # clause -- `IN ()` matches nothing, an honest empty result rather
        # than silently skipping the filter.
        if symbol_in:
            placeholders = ",".join("?" * len(symbol_in))
            sql += (f" AND (EXISTS (SELECT 1 FROM j2_note_embeds e"
                    f" WHERE e.note_id = j2_notes.id AND e.user_id = j2_notes.user_id"
                    f" AND e.symbol IN ({placeholders}))"
                    f" OR EXISTS (SELECT 1 FROM j2_note_mentions m"
                    f" WHERE m.note_id = j2_notes.id AND m.user_id = j2_notes.user_id"
                    f" AND m.symbol IN ({placeholders})))")
            params.extend(symbol_in)
            params.extend(symbol_in)
        else:
            sql += " AND 0"
    if tag:
        # JSON LIKE — case-insensitive substring of any tag value.
        sql += ' AND lower(tags) LIKE ?'
        params.append(f'%"{tag.lower()}"%')
    if q:
        # FTS5 when the text yields a valid MATCH expression; the old
        # LIKE scan remains the fallback so a query FTS cannot parse
        # still returns results rather than an error. body_plain stays
        # authoritative -- j2_notes_fts is a derived index (db.py).
        #
        # Coverage note (final-review C1): j2_notes_fts indexes ONLY
        # title/body_plain (db.py) — tags and ticker are NOT FTS columns.
        # The pre-Task-11 client-side panel search matched a note's tags and
        # ticker too (it joined title+body+tags+ticker into one string and
        # substring-matched); routing search through this SQL predicate
        # alone would silently drop that coverage for every small,
        # non-migrated library -- making search WORSE for the members we
        # actually have today, in exchange for a benefit (reaching beyond one
        # page) only a migrated member gets. So `q` ALSO matches via the SAME
        # predicates the dedicated `tag=`/`ticker=` filters above already use
        # (one way to ask each question, never a third), ORed alongside the
        # title/body text search. Deliberately NOT added as FTS columns —
        # that would touch the virtual table, its 3 triggers, and the v4
        # backfill, for a scope this OR clause already covers.
        exact_tag_pattern = f'%"{q.strip().lower()}"%'   # same spelling as the `tag` filter above
        # Wave 4 Slice 4 fix: a leading `$` (the natural way to type a
        # cashtag) used to survive into this comparison unstripped, so
        # "$NVDA" never matched a note whose only NVDA signal was the
        # `ticker` field (fts_match_expr already stripped it for the FTS
        # branch, below -- this branch alone was the divergent one). Only
        # the LEADING separator is stripped (mirrors fts_match_expr's own
        # word/non-word split) so an internal hyphen (BRK-B) is untouched.
        exact_ticker = re.sub(r"^[^\w]+", "", q.strip()).upper()
        expr = fts_match_expr(q)
        if expr:
            sql += (" AND (id IN (SELECT note_id FROM j2_notes_fts"
                    " WHERE j2_notes_fts MATCH ? AND user_id = ?)"
                    " OR lower(tags) LIKE ? OR ticker = ?)")
            params.extend([expr, user_id, exact_tag_pattern, exact_ticker])
        else:
            sql += " AND (lower(title) LIKE ? OR lower(body_plain) LIKE ? OR lower(tags) LIKE ? OR ticker = ?)"
            ql = f"%{q.lower()}%"
            params.extend([ql, ql, exact_tag_pattern, exact_ticker])
    return sql, params


def _snippets_for(
    conn: sqlite3.Connection, user_id: str, expr: str, note_ids: list[str],
) -> dict[str, dict[str, str]]:
    """Slice 2: `note_id -> {bodySnippet, titleSnippet}` for a page of
    already-selected results. A SEPARATE query, not a join into the main
    list SQL — SQLite's snippet()/highlight() may only be called within a
    SELECT that itself carries a MATCH constraint on that FTS table, and
    `_NOTE_SUMMARY_COLS`'s own `body_plain` is a truncated (400-char)
    LIST-projection column, not the full text snippet() needs to search
    across. Scoped to just this page's note_ids -- never the whole match
    set -- so cost stays bounded by what's actually rendered."""
    if not note_ids:
        return {}
    placeholders = ",".join("?" * len(note_ids))
    rows = conn.execute(
        "SELECT note_id,"
        " snippet(j2_notes_fts, 3, '<mark>', '</mark>', '…', 12) AS body_snippet,"
        # highlight(), not snippet(), for the title: snippet() truncates to
        # the requested token window regardless of whether THAT column
        # actually matched -- for a body-only match this would render an
        # unrelated title with a spurious "…" if it happened to be long,
        # never explaining anything. highlight() never truncates, so an
        # unmatched title still renders in full (just unmarked) -- the
        # Python filter below then drops it unless the title itself
        # genuinely contains a <mark>, so the frontend contract stays
        # simple: titleSnippet present+non-empty means the TITLE matched.
        " highlight(j2_notes_fts, 2, '<mark>', '</mark>') AS title_highlight"
        " FROM j2_notes_fts"
        f" WHERE j2_notes_fts MATCH ? AND user_id = ? AND note_id IN ({placeholders})",
        [expr, user_id, *note_ids],
    ).fetchall()
    out: dict[str, dict[str, str]] = {}
    for r in rows:
        title_highlight = r["title_highlight"] or ""
        out[r["note_id"]] = {
            "bodySnippet": r["body_snippet"] or "",
            "titleSnippet": title_highlight if "<mark>" in title_highlight else "",
        }
    return out


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
    deleted: bool = False,
    date_from: str | None = None,
    date_to: str | None = None,
    symbol_in: list[str] | None = None,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        where_sql, params = _notes_filter_sql(
            user_id, folder_id=folder_id, tag=tag, ticker=ticker, q=q,
            embed_symbol=embed_symbol, embed_widget=embed_widget, deleted=deleted,
            date_from=date_from, date_to=date_to, symbol_in=symbol_in,
        )
        sql = f"SELECT {_NOTE_SUMMARY_COLS} FROM j2_notes" + where_sql
        # Wave 4 Slice 2: relevance ranking is opt-in (`sort="relevance"`),
        # never silently applied under the existing "updated" default --
        # every pre-Wave-4 caller keeps byte-identical ordering. Requires a
        # valid FTS expression; a relevance request with no `q` (or one
        # that yields no FTS terms) falls back to updated_at DESC exactly
        # like today, rather than erroring or ignoring the sort silently.
        relevance_expr = fts_match_expr(q) if (sort == "relevance" and q) else None
        if relevance_expr:
            # bm25() is only callable within a SELECT that itself carries a
            # MATCH on that FTS table -- this correlated scalar subquery
            # satisfies that per outer row. A row with NO matching FTS entry
            # (a tag/ticker-only match) gets no bm25 score at all (subquery
            # returns no row -> NULL); COALESCE treats "matched on an exact
            # structured field" as the BEST possible rank (a very negative
            # sentinel -- bm25 is ascending, lower = more relevant) rather
            # than losing that precise a match beneath every fuzzy-text hit.
            sql += (
                " ORDER BY COALESCE("
                "(SELECT bm25(j2_notes_fts) FROM j2_notes_fts"
                " WHERE note_id = j2_notes.id AND user_id = j2_notes.user_id"
                " AND j2_notes_fts MATCH ?), -1e9) ASC, updated_at DESC"
            )
            params.append(relevance_expr)
        else:
            order_col = {
                "updated": "updated_at DESC",
                "created": "created_at DESC",
                "title": "title COLLATE NOCASE ASC",
                # Trash view default: most recently deleted first — a member
                # scanning for "the thing I just deleted" shouldn't have to sort.
                "deleted": "deleted_at DESC",
            }.get(sort, "deleted_at DESC" if deleted else "updated_at DESC")
            sql += f" ORDER BY {order_col}"
        sql += " LIMIT ? OFFSET ?"
        params = params + [max(1, min(limit, 500)), max(0, offset)]
        rows = conn.execute(sql, params).fetchall()
        results = [_row_to_note_summary(r) for r in rows]
        # Slice 2: query-aware snippets, scoped to just this page's rows.
        # `relevance_expr` above is gated on sort="relevance"; snippets are
        # a rendering concern independent of ranking choice, so recompute
        # from `q` directly (fts_match_expr is a pure, cheap, deterministic
        # function -- calling it twice is not a second authority, it's the
        # same single translation called from two independent call sites).
        if q and not deleted:
            snip_expr = fts_match_expr(q)
            if snip_expr:
                snippets = _snippets_for(conn, user_id, snip_expr, [r["id"] for r in results])
                for r in results:
                    hit = snippets.get(r["id"])
                    if hit:
                        r["bodySnippet"] = hit["bodySnippet"]
                        r["titleSnippet"] = hit["titleSnippet"]
        if q and not deleted:
            # Stage A validation signal only (never the query text itself).
            # Debounced client-side (~250ms) but not deduped server-side, so
            # this over-counts vs. "search sessions" -- acceptable at
            # validation-cohort scale; see the Wave 4 prep doc.
            _log_notebook_event(user_id, "notebook_search_used", {"hasResults": len(results) > 0})
        return results
    finally:
        if owned:
            conn.close()


def count_notes(
    user_id: str,
    *,
    folder_id: str | None = None,
    tag: str | None = None,
    ticker: str | None = None,
    q: str | None = None,
    embed_symbol: str | None = None,
    embed_widget: str | None = None,
    deleted: bool = False,
    date_from: str | None = None,
    date_to: str | None = None,
    symbol_in: list[str] | None = None,
    conn: sqlite3.Connection | None = None,
) -> int:
    """The TRUE total behind `list_notes`'s same filter set — a real
    ``SELECT COUNT(*)`` over the whole match, never the length of a
    limit/offset page. Migrating a library of thousands of notes must never
    make the member's honest count degrade to "however many fit on one
    page" — that gap is what made a 5,000-note migration look like data
    loss. Built from the SAME `_notes_filter_sql` predicate as `list_notes`
    so the two can never disagree about which notes match."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        where_sql, params = _notes_filter_sql(
            user_id, folder_id=folder_id, tag=tag, ticker=ticker, q=q,
            embed_symbol=embed_symbol, embed_widget=embed_widget, deleted=deleted,
            date_from=date_from, date_to=date_to, symbol_in=symbol_in,
        )
        sql = "SELECT COUNT(*) AS c FROM j2_notes" + where_sql
        row = conn.execute(sql, params).fetchone()
        return int(row["c"] or 0) if row else 0
    finally:
        if owned:
            conn.close()


def tag_counts(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Tag -> note-count across the member's WHOLE library — never derived
    from one loaded page.

    Final-review C5: `FolderSidebar`'s tag cloud counted tags over the
    `notes` prop, which is one 100-row page. Task 11 gave the sidebar an
    honest "All notes" TOTAL, which made that page-derived tag cloud
    visibly self-contradicting on a migrated library (5,000 notes, tag
    counts that sum to at most 100) — and `TAG_CAP = 40` would then pick
    the top 40 of a biased sample (whichever 100 notes happened to load),
    not the real distribution. This is the same fix shape as the honest
    Unfiled total: ask the server for the whole library's answer.

    Scoped exactly like every other read here — `user_id` only, so a
    member never sees another member's tags. `json_each` over the JSON
    `tags` column is the same SQLite JSON1 idiom `filters.py` already uses
    for the (unrelated) mistake/emotion tag facets.

    ⛔ Second-C5 (B3): this used to `GROUP BY je.value` — case-SENSITIVE —
    while the `tag=` filter (`_notes_filter_sql` above) matches via
    `lower(tags) LIKE`, i.e. case-INSENSITIVE. 'Earnings'/'earnings'/
    'EARNINGS' rendered as three chips of count 1, each opening a list of
    all three: two authorities over one value, the exact shape this repo
    keeps getting bitten by. The filter's case-insensitivity is the
    member-facing intent (a member who typed 'Trading' and 'trading' means
    one tag), so THIS query is the one that must fold to match it — never
    the reverse (that would need every stored tag re-cased, and would not
    fix a future note written with a fresh casing anyway). `LOWER(je.value)`
    is the ONE grouping key, mirroring `_validate_tags`'s own per-note
    dedup key (`t2.lower()`, above) and the filter's `tag.lower()` — three
    call sites, one normalization rule. `MAX(je.value)` picks a single
    display casing per group; which variant wins is not load-bearing
    (matching is case-insensitive everywhere a tag is used), only that
    there is exactly one row per case-insensitive tag."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        # Wave 0 trash: a soft-deleted note's tags must not inflate the tag
        # cloud — same "active notebook only" predicate as everywhere else.
        rows = conn.execute(
            "SELECT MAX(je.value) AS tag, LOWER(je.value) AS tag_key, COUNT(*) AS c"
            " FROM j2_notes, json_each(COALESCE(j2_notes.tags, '[]')) je"
            " WHERE j2_notes.user_id = ? AND j2_notes.deleted_at IS NULL"
            " GROUP BY LOWER(je.value)"
            " ORDER BY c DESC, tag_key ASC",
            (user_id,),
        ).fetchall()
        return [{"tag": r["tag"], "count": int(r["c"] or 0)} for r in rows]
    finally:
        if owned:
            conn.close()


def folder_note_counts(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Wave 0 (P0-2, folder-sidebar correctness): the TRUE, whole-library
    note count per folder (plus Unfiled) — ONE query, never derived from a
    capped page.

    Root cause this replaces: the sidebar tree used to derive its leaf-row
    disclosure state (`hasChildren`) from `notesByFolder`, itself built by
    grouping a SINGLE global page of up to 100 notes (sorted by title
    across the ENTIRE unfiltered library) by `folderId`. Any folder whose
    notes all happened to sort alphabetically past position 100 in the
    whole library rendered as an empty, non-expandable folder — no arrow,
    no rows, no signal anything was missing. The trigger was a global
    alphabetical cutoff, not that folder's own size: a 150-note library
    with everything dumped in one catch-all folder could show it; a
    5,000-note library spread evenly across 100 folders might never.

    Fix pattern: the exact one already proven in this same codebase for
    `unfiledTotalFromServer` (FolderSidebar.jsx) — ask the server for the
    real count instead of deriving it from a loaded page. This single
    `GROUP BY` answers every folder (plus Unfiled) in one query, honest
    at any library size."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT folder_id, COUNT(*) AS c FROM j2_notes"
            " WHERE user_id = ? AND deleted_at IS NULL"
            " GROUP BY folder_id",
            (user_id,),
        ).fetchall()
        counts: dict[str, int] = {}
        unfiled = 0
        total = 0
        for r in rows:
            c = int(r["c"] or 0)
            total += c
            if r["folder_id"] is None:
                unfiled = c
            else:
                counts[r["folder_id"]] = c
        return {"counts": counts, "unfiled": unfiled, "total": total}
    finally:
        if owned:
            conn.close()


def notes_for_folders(
    user_id: str,
    folder_ids: list[str],
    limit_per_folder: int = 200,
    conn: sqlite3.Connection | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """Wave 0 (P0-2): the actual note rows for the sidebar tree's inline
    leaf-row rendering, scoped to exactly the folders the caller asks for
    (in practice: the currently-EXPANDED folders only — never the whole
    library in one page, which was the root cause `folder_note_counts`'
    own docstring explains).

    One query per folder (not a window-function fan-out) — `folder_ids` in
    practice is small (a handful of expanded tree nodes, not thousands),
    and per-folder queries are simpler to reason about and cannot silently
    misattribute a row to the wrong folder. Each folder's own notes are
    honestly complete up to `limit_per_folder` (200 — double the sidebar's
    old, silently-wrong global cap of 100 — with `truncated` disclosed
    per-folder rather than a page that quietly stops)."""
    out: dict[str, list[dict[str, Any]]] = {}
    owned = conn is None
    conn = conn or get_connection()
    try:
        for folder_id in folder_ids:
            if not isinstance(folder_id, str) or not folder_id:
                continue
            rows = conn.execute(
                f"SELECT {_NOTE_SUMMARY_COLS} FROM j2_notes"
                " WHERE user_id = ? AND deleted_at IS NULL AND folder_id = ?"
                " ORDER BY title COLLATE NOCASE ASC"
                " LIMIT ?",
                (user_id, folder_id, max(1, min(limit_per_folder, 500))),
            ).fetchall()
            out[folder_id] = [_row_to_note_summary(r) for r in rows]
        return out
    finally:
        if owned:
            conn.close()


def get_notes_linked_to_trade(
    user_id: str, trade_ref: str, trade_ref_type: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Wave 3 (Thesis-Trade Link): notes whose embed(s) reference this exact
    (trade_ref, trade_ref_type) — the reverse direction of
    `note_trade_ref_resolve_endpoint`. See `note_trade_links.notes_linked_to_trade`
    for why this is always typed (never a bare trade_ref lookup) and how a
    legacy/untyped row is included only when it uniquely resolves."""
    from api.services.journal_two import note_trade_links
    owned = conn is None
    conn = conn or get_connection()
    try:
        note_ids = note_trade_links.notes_linked_to_trade(
            conn, user_id, trade_ref, trade_ref_type)
        if not note_ids:
            return []
        placeholders = ",".join("?" * len(note_ids))
        rows = conn.execute(
            f"SELECT {_NOTE_SUMMARY_COLS} FROM j2_notes"
            f" WHERE user_id = ? AND deleted_at IS NULL AND id IN ({placeholders})"
            " ORDER BY updated_at DESC",
            (user_id, *note_ids),
        ).fetchall()
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
    """"Which of my entries reference this ticker?" — answered from TWO
    sidecars, UNIONed and deduplicated by note id: `j2_note_embeds` (accepted
    chart embeds — the STORED tier) and `j2_note_mentions` (cashtag prose
    mentions — P0-3, Wave 1 Slice 2). A note carrying BOTH for the same
    symbol counts once, never twice — the caller does not need to know which
    source(s) produced the match.

    Written on every note save since v1 (embeds) / since P0-3 (mentions),
    read by the notes-list `embed_symbol` filter (same two-source UNION) and
    every ticker surface that shows "4 entries reference AMD" and links
    straight to them.

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
        # Wave 0 trash: `n.deleted_at IS NULL` on BOTH queries below — this
        # function's own docstring says it must agree with the
        # `embed_symbol` list filter (_notes_filter_sql), which already
        # excludes soft-deleted notes via its base WHERE clause. Without
        # this, a trashed note's embed would still count here while the
        # list filter it's pinned against had already stopped counting it.
        row = conn.execute(
            "SELECT COUNT(DISTINCT x.note_id) AS c FROM ("
            "  SELECT note_id FROM j2_note_embeds WHERE user_id = ? AND symbol = ?"
            "  UNION"
            "  SELECT note_id FROM j2_note_mentions WHERE user_id = ? AND symbol = ?"
            ") x"
            " JOIN j2_notes n ON n.id = x.note_id AND n.user_id = ?"
            " WHERE n.deleted_at IS NULL",
            (user_id, sym, user_id, sym, user_id),
        ).fetchone()
        out["count"] = int(row["c"] or 0) if row else 0
        if not out["count"]:
            return out
        # `refs`/`widgetIds` stay embed-only (unchanged meaning: "how many
        # accepted chart embeds, of which kinds") — a prose-only match simply
        # gets refs=0, widgetIds=[], which the one known UI consumer
        # (JournalBacklinks.jsx) already renders as blank, not as a bug (its
        # own `n.refs > 1 ? ... : ''` only ever shows a badge above 1). The
        # membership question (does this note match at all) is answered by
        # the UNION in the outer join; this LEFT JOIN only adds embed detail
        # where it exists.
        rows = conn.execute(
            "SELECT n.id, n.title, n.updated_at,"
            "       COALESCE(e.refs, 0) AS refs,"
            "       e.widgets AS widgets"
            " FROM ("
            "  SELECT note_id FROM j2_note_embeds WHERE user_id = ? AND symbol = ?"
            "  UNION"
            "  SELECT note_id FROM j2_note_mentions WHERE user_id = ? AND symbol = ?"
            " ) x"
            " JOIN j2_notes n ON n.id = x.note_id AND n.user_id = ?"
            " LEFT JOIN ("
            "  SELECT note_id, COUNT(*) AS refs, GROUP_CONCAT(DISTINCT widget_id) AS widgets"
            "  FROM j2_note_embeds WHERE user_id = ? AND symbol = ? GROUP BY note_id"
            " ) e ON e.note_id = n.id"
            " WHERE n.deleted_at IS NULL"
            " ORDER BY n.updated_at DESC"
            " LIMIT ?",
            (user_id, sym, user_id, sym, user_id, user_id, sym, max(1, min(limit, 25))),
        ).fetchall()
        out["notes"] = [{
            "id": r["id"],
            "title": r["title"] or "Untitled",
            "updatedAt": r["updated_at"],
            "refs": int(r["refs"] or 0),
            "widgetIds": sorted((r["widgets"] or "").split(",")) if r["widgets"] else [],
        } for r in rows]
        # P0-3 sector/industry/theme join — read-time only, off the ONE
        # existing 24h ticker-metadata cache (never a fresh call per NOTE;
        # at most one call per distinct SYMBOL LOOKED UP, already the exact
        # pattern every chart header/TickerPopup in this app relies on — no
        # new provider dependency). Only reached when there is at least one
        # matching note, so an unknown/mistyped symbol never pays this cost.
        # Earnings-window is deliberately NOT joined here yet: the awareness
        # engine's `_collect_earnings_window` answers it but is shaped for a
        # multi-symbol scan cycle, not a single-symbol point lookup, and it
        # is not required for the core P0-3 success metric (reverse-index
        # discoverability) — documented follow-up, not silently dropped.
        try:
            from api.services.ticker_meta import get_ticker_meta
            meta = get_ticker_meta(sym)
            out["sector"] = meta.get("sector")
            out["industry"] = meta.get("industry")
            out["theme"] = meta.get("theme")
        except Exception:
            # Never let an enrichment failure break the reverse-index read
            # itself — the notes list above is the part of this response
            # that must never be sacrificed to a metadata-provider hiccup.
            out["sector"] = out["industry"] = out["theme"] = None
        return out
    finally:
        if owned:
            conn.close()


def get_note_backlinks(
    user_id: str, note_id: str, limit: int = 50, conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """"Which of my other notes link TO this one?" (Wave D) -- the reverse
    of j2_note_links' own forward (source -> target) rows. Mirrors
    get_symbol_backlinks' shape one entity level up: note-to-note instead of
    note-to-symbol, including its own "count vs. returned rows" split so the
    UI can show '+N more' past the cap. Deduplicated by SOURCE note
    (directive §64: a note linking here five times is one relationship, not
    five identical rows), with the occurrence count folded in via COUNT(*).

    Deliberately does NOT gate on whether `note_id` ITSELF is trashed --
    "who links here" is a fact about the LINKING notes, independent of
    whatever state the target is currently in (a member browsing Trash may
    still want to see this). Only the SOURCE notes are trash-excluded,
    matching every other "list of my notes" convention in this file."""
    out: dict[str, Any] = {"count": 0, "notes": []}
    if not note_id:
        return out
    owned = conn is None
    conn = conn or get_connection()
    try:
        count_row = conn.execute(
            "SELECT COUNT(DISTINCT l.note_id) AS c FROM j2_note_links l"
            " JOIN j2_notes n ON n.id = l.note_id AND n.user_id = l.user_id"
            " WHERE l.user_id = ? AND l.target_note_id = ? AND n.deleted_at IS NULL",
            (user_id, note_id),
        ).fetchone()
        out["count"] = int(count_row["c"] or 0) if count_row else 0
        if not out["count"]:
            return out
        rows = conn.execute(
            "SELECT n.id, n.title, n.updated_at, COUNT(*) AS refs"
            " FROM j2_note_links l"
            " JOIN j2_notes n ON n.id = l.note_id AND n.user_id = l.user_id"
            " WHERE l.user_id = ? AND l.target_note_id = ? AND n.deleted_at IS NULL"
            " GROUP BY n.id"
            " ORDER BY n.updated_at DESC"
            " LIMIT ?",
            (user_id, note_id, max(1, min(limit, 200))),
        ).fetchall()
        out["notes"] = [{
            "id": r["id"], "title": r["title"] or "Untitled",
            "updatedAt": r["updated_at"], "refs": int(r["refs"] or 0),
        } for r in rows]
        return out
    finally:
        if owned:
            conn.close()


def resolve_note_link_targets(
    user_id: str, note_ids: list[str], conn: sqlite3.Connection | None = None,
) -> dict[str, dict[str, Any]]:
    """Batch-resolve `noteLink` target ids to their CURRENT display state
    (Wave D) -- `{id: {"title": str, "status": "active" | "trashed"}}` for
    every id that resolves to a note this user owns. An id that does NOT
    resolve (foreign tenant, never existed, permanently purged) is simply
    ABSENT from the returned dict -- the caller (the noteLink node view)
    renders a missing key as "unavailable" identically in every one of those
    cases, so this can never leak WHICH case it was (directive §23/§61: an
    unowned id must read exactly like a nonexistent one).

    Batched by design, not per-id (directive §37/§65's own performance
    concern) -- a note with 20 different links must cost ONE request, not 20."""
    out: dict[str, dict[str, Any]] = {}
    ids = [i for i in dict.fromkeys(note_ids) if isinstance(i, str) and i]
    if not ids:
        return out
    owned = conn is None
    conn = conn or get_connection()
    try:
        placeholders = ",".join("?" for _ in ids)
        rows = conn.execute(
            f"SELECT id, title, deleted_at FROM j2_notes"
            f" WHERE user_id = ? AND id IN ({placeholders})",
            (user_id, *ids),
        ).fetchall()
        for r in rows:
            out[r["id"]] = {
                "title": r["title"] or "Untitled",
                "status": "trashed" if r["deleted_at"] else "active",
            }
        return out
    finally:
        if owned:
            conn.close()


def resolve_sector_theme_symbols(
    user_id: str,
    *,
    sector: str | None = None,
    theme: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> list[str] | None:
    """Wave 4 Slice 3 (entity-anchored retrieval): resolves a sector/theme
    filter to the member's own bounded, DISTINCT mentioned-symbol
    vocabulary — never a full-market scan (the design this program's own
    Wave 4 dossier settled on over a denormalized per-mention sector/theme
    column, which would have meant schema growth for the same answer).
    Reuses the SAME 24h `ticker_meta` cache every chart header/TickerPopup
    already relies on (including its own `theme` field — the live
    UCT-taxonomy primary theme, resolved the identical way everywhere else
    in this app) — zero new provider dependency, at most one lookup per
    distinct symbol the member has ever mentioned, typically a small set.

    Returns `None` when neither filter is requested (caller skips the
    `symbol_in` predicate entirely, unchanged from today). Returns a
    (possibly empty) list otherwise — an empty list is an honest "nothing
    in this member's own vocabulary matches," not silently ignored (see
    `_notes_filter_sql`'s `symbol_in=[]` handling). When both `sector` and
    `theme` are given, a symbol must match BOTH (composes as AND, same as
    every other filter in this program)."""
    if not sector and not theme:
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        # Same trash-exclusion join shape as get_symbol_backlinks above —
        # a symbol mentioned only in a trashed note must not widen the
        # member's resolved vocabulary.
        rows = conn.execute(
            "SELECT DISTINCT symbol FROM ("
            "  SELECT e.symbol AS symbol FROM j2_note_embeds e"
            "  JOIN j2_notes n ON n.id = e.note_id AND n.user_id = e.user_id"
            "  WHERE e.user_id = ? AND n.deleted_at IS NULL"
            "  UNION"
            "  SELECT m.symbol AS symbol FROM j2_note_mentions m"
            "  JOIN j2_notes n ON n.id = m.note_id AND n.user_id = m.user_id"
            "  WHERE m.user_id = ? AND n.deleted_at IS NULL"
            ")",
            (user_id, user_id),
        ).fetchall()
        symbols = [r["symbol"] for r in rows if r["symbol"]]
        if not symbols:
            return []
        from api.services.ticker_meta import get_ticker_meta
        sector_l = sector.strip().lower() if sector else None
        theme_l = theme.strip().lower() if theme else None
        matched = []
        for sym in symbols:
            try:
                meta = get_ticker_meta(sym)
            except Exception:
                # Never let one provider hiccup on one symbol break the
                # whole filter — that symbol just doesn't match, same
                # treatment as a symbol with genuinely unknown metadata.
                continue
            if sector_l and (meta.get("sector") or "").strip().lower() != sector_l:
                continue
            if theme_l and (meta.get("theme") or "").strip().lower() != theme_l:
                continue
            matched.append(sym)
        return matched
    finally:
        if owned:
            conn.close()


def get_note(
    user_id: str,
    note_id: str,
    conn: sqlite3.Connection | None = None,
    include_deleted: bool = False,
) -> dict[str, Any] | None:
    """`include_deleted=False` (default, every existing call site unchanged):
    a soft-deleted note reads as 404, matching what the member sees — the
    note is "gone" everywhere except the trash view. `include_deleted=True`
    is for the trash view itself (viewing a deleted note's content before
    deciding to restore it) and the restore endpoint's own lookup."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = "SELECT * FROM j2_notes WHERE id = ? AND user_id = ?"
        if not include_deleted:
            sql += " AND deleted_at IS NULL"
        row = conn.execute(sql, (note_id, user_id)).fetchone()
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
        fav_row = conn.execute(
            "SELECT 1 FROM j2_note_favorites WHERE user_id = ? AND note_id = ?",
            (user_id, note_id),
        ).fetchone()
        note["isFavorite"] = fav_row is not None
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
        _sync_note_mentions(conn, user_id, new_id, body_plain)
        _sync_note_links(conn, user_id, new_id, body_json)
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ?", (new_id,)
        ).fetchone()
        _log_notebook_event(user_id, "notebook_note_created")
        if "thesis" in tags:
            _log_notebook_event(user_id, "notebook_thesis_note_created")
        return _row_to_note(row)
    finally:
        if owned:
            conn.close()


# ── Wave C: Version History ──────────────────────────────────────────────────
# Full snapshots (title/subtitle/body only -- see the build-plan doc's entry
# checkpoint for the field-boundary rationale). Coalescing lives HERE, in
# Python, not a SQL trigger -- this codebase reserves triggers for
# unconditional cascade-cleanup (see the FTS/favorites/recents triggers in
# db.py); coalescing is conditional business logic and belongs in the
# service layer, matching house convention.

J2_VERSION_COALESCE_MINUTES = int(os.environ.get("J2_VERSION_COALESCE_MINUTES", "30"))


def _versioned_content_of(row_like: Any) -> tuple[str, str | None, str]:
    """The exact three fields Wave C versions -- a sqlite3.Row (from j2_notes,
    keyed by column name) or a dict (from a j2_note_versions row) both work
    via [] access."""
    return (row_like["title"] or "", row_like["subtitle"], row_like["body_plain"] or "")


def _maybe_capture_version(
    conn: sqlite3.Connection,
    note_id: str,
    user_id: str,
    existing: sqlite3.Row,
    force: bool = False,
) -> None:
    """Coalescing version-capture hook -- called from update_note BEFORE the
    UPDATE is applied, so `existing` is the pre-edit row (the content about
    to be overwritten). Captures a checkpoint of it ONLY when:

    (a) it differs from the most recently captured version's content (a
        save that only changes ticker/tags/folder must never create a
        version -- title/subtitle/body_plain are unchanged in `existing`
        itself in that case, so this naturally also gates on "did the
        VERSIONED fields actually change since the last checkpoint", not
        merely "did SOMETHING in the patch change"), AND
    (b) no version exists yet for this note, OR the existing row's OWN
        updated_at (when it became the current saved state) is more than
        J2_VERSION_COALESCE_MINUTES past the latest version's created_at.

    This produces one meaningful checkpoint per editing session, not one row
    per 800ms autosave tick: during a burst of typing, every autosave call's
    `existing` was itself captured (or would have been, had it differed) at
    the START of that burst -- so once the burst's first checkpoint lands,
    every subsequent call within the coalescing window sees a `latest`
    version whose timestamp is still "recent" and skips. The version that
    DOES eventually land, once the window elapses, captures whatever content
    was actually stable for that whole quiet period -- not a mid-keystroke
    fragment.

    The captured version's `created_at` is `existing["updated_at"]` (when
    that content became current), never "now" (when we detected it's about
    to change) -- so "version from 4:05 PM" means the note read that way AT
    4:05 PM, not "we noticed at some later time."

    `force=True` (used ONLY by restore_note_version) skips the (b) coalescing-
    window check -- restore is a deliberate, explicit user action, never an
    incidental autosave tick, and directive §20/21's "restore must not erase
    history" requirement is unconditional: a restore performed shortly after
    the previous edit (inside the normal coalescing window) must STILL
    capture the pre-restore state, or that content becomes unrecoverable.
    (a) still applies even when forced -- restoring to the note's own
    current, unchanged content never creates a pointless duplicate version.
    Found via a dedicated test: without this, a restore-immediately-after-
    editing sequence silently dropped the pre-restore state from history.

    Never raises. This runs inside update_note's own transaction, before its
    UPDATE — a bug here must never be able to block the authoritative note
    save (directive §19); any failure here costs a version-history entry,
    never note data.
    """
    try:
        latest = conn.execute(
            "SELECT title, subtitle, body_plain, created_at FROM j2_note_versions"
            " WHERE note_id = ? ORDER BY created_at DESC LIMIT 1",
            (note_id,),
        ).fetchone()
        old_content = _versioned_content_of(existing)
        if latest is not None:
            if old_content == _versioned_content_of(latest):
                return  # nothing versioned actually changed since the last checkpoint
            if not force:
                elapsed = datetime.fromisoformat(existing["updated_at"]) - datetime.fromisoformat(latest["created_at"])
                if elapsed.total_seconds() < J2_VERSION_COALESCE_MINUTES * 60:
                    return  # still inside the same coalescing window -- no new checkpoint
        conn.execute(
            "INSERT INTO j2_note_versions (id, user_id, note_id, title, subtitle,"
            " body_json, body_plain, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                uuid.uuid4().hex, user_id, note_id,
                old_content[0], old_content[1],
                existing["body_json"], old_content[2],
                existing["updated_at"],
            ),
        )
    except Exception:  # noqa: BLE001 — see docstring: never break the real save
        pass


def list_note_versions(
    user_id: str,
    note_id: str,
    limit: int = 200,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Newest-first, title/subtitle/timestamp only (no body_json/body_plain --
    this is the history LIST, matching _row_to_note_summary's own "list view
    never carries full body" convention; the single-version fetch is
    get_note_version). `limit=200` is generous headroom over the coalescing
    window's realistic output, not a hard product cap (directive §38: no
    retention pruning in Wave C)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT id, title, subtitle, created_at FROM j2_note_versions"
            " WHERE user_id = ? AND note_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, note_id, limit),
        ).fetchall()
        return [
            {"id": r["id"], "title": r["title"], "subtitle": r["subtitle"], "createdAt": r["created_at"]}
            for r in rows
        ]
    finally:
        if owned:
            conn.close()


def get_note_version(
    user_id: str,
    note_id: str,
    version_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Tenant-scoped on BOTH user_id AND note_id -- a member must never
    preview/diff another member's version, nor a version that belongs to a
    DIFFERENT note than the one they're asking about, even if they somehow
    guess a real version id (directive §42, §87)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_note_versions WHERE id = ? AND user_id = ? AND note_id = ?",
            (version_id, user_id, note_id),
        ).fetchone()
        if row is None:
            return None
        return {
            "id": row["id"],
            "noteId": row["note_id"],
            "title": row["title"],
            "subtitle": row["subtitle"],
            "bodyJson": json.loads(row["body_json"]),
            "bodyPlain": row["body_plain"],
            "createdAt": row["created_at"],
        }
    finally:
        if owned:
            conn.close()


def restore_note_version(
    user_id: str,
    note_id: str,
    version_id: str,
    expected_updated_at: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Restore is NOT a bespoke write path -- it loads the target version's
    content and calls update_note with it, the exact same function every
    normal edit uses (passing force_version=True -- a restore must ALWAYS
    checkpoint the pre-restore state regardless of the coalescing window;
    see _maybe_capture_version's own docstring for why this is unconditional,
    unlike an ordinary autosave). That gets, for free: (a) the pre-restore state is
    captured as a new version via the SAME coalescing hook (a restore never
    erases history -- directive §20), (b) the SAME optimistic-lock 409 on a
    stale restore (directive §89's multi-tab race), (c) embeds/mentions
    re-derive correctly from the restored body (directive §15/§7 boundary --
    relationships are never separately versioned/restored, they just follow
    whatever body content is current). folder_id/ticker/tags are
    deliberately untouched (never part of the patch below) -- restoring
    content must never silently relocate or re-tag a note.

    Returns None if the version doesn't exist / isn't this note's / isn't
    this user's (tenant/existence check happens via get_note_version, which
    already scopes on user_id AND note_id). Raises NoteConflictError exactly
    like any other update_note call when the note moved since the caller's
    baseline."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        version = get_note_version(user_id, note_id, version_id, conn=conn)
        if version is None:
            return None
        return update_note(
            user_id, note_id,
            {"title": version["title"], "subtitle": version["subtitle"], "bodyJson": version["bodyJson"]},
            conn=conn, expected_updated_at=expected_updated_at, force_version=True,
        )
    finally:
        if owned:
            conn.close()


def update_note(
    user_id: str,
    note_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
    expected_updated_at: str | None = None,
    force_version: bool = False,
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
        # Wave 0 trash: a soft-deleted note reads as 404 here too — editing
        # a trashed note directly (without restoring it first) must not
        # silently work, matching `get_note`'s default behavior.
        existing = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
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
        if "importMediaPending" in patch:
            # audit B5: the import commit pipeline's OWN signal for whether
            # its post-confirm media-upload + link-rewrite phase actually
            # finished clean on THIS note (`droppedMedia.length > 0` in
            # commit.js's runImport) — not something an ordinary editor save
            # ever sends. True keeps (or re-sets) the note as still-pending
            # so import_confirm retries it on the member's next import
            # attempt instead of treating a fingerprint match as "done";
            # False clears it. Absent (every non-import PUT) touches nothing.
            sets.append("import_media_pending = ?")
            params.append(1 if patch["importMediaPending"] else 0)

        if not sets:
            return _row_to_note(existing)

        # Wave C: capture a version checkpoint of the OLD content BEFORE
        # applying this edit -- gated on the ACTUAL new values (not merely
        # "did the patch mention a versioned key"), so a save that re-sends
        # an unchanged title/subtitle/body (e.g. a client re-PUTting the same
        # content) never creates a spurious version. `_maybe_capture_version`
        # itself further gates on the coalescing window.
        new_title = t if "title" in patch else (existing["title"] or "")
        new_subtitle = s if "subtitle" in patch else existing["subtitle"]
        new_body_plain = bp if "bodyJson" in patch else (existing["body_plain"] or "")
        if (new_title, new_subtitle, new_body_plain) != _versioned_content_of(existing):
            _maybe_capture_version(conn, note_id, user_id, existing, force=force_version)

        sets.append("updated_at = ?"); params.append(_now_iso())
        params.extend([note_id, user_id])
        conn.execute(
            f"UPDATE j2_notes SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
            params,
        )
        if "bodyJson" in patch:
            _sync_note_embeds(conn, user_id, note_id, bj)
            _sync_note_mentions(conn, user_id, note_id, bp)
            _sync_note_links(conn, user_id, note_id, bj)
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
        # Wave 0 trash: same as update_note — appending to a trashed note
        # must not silently work.
        row = conn.execute(
            "SELECT body_json FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
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
        _sync_note_mentions(conn, user_id, note_id, body_plain)
        _sync_note_links(conn, user_id, note_id, body_json)
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
            "annotations": json.loads(r["annotations_json"] or "[]"),
            "capturedAt": r["captured_at"],
            "createdAt": r["created_at"],
            "caption": r["caption"] if "caption" in r.keys() else None,
            "tradeRef": r["trade_ref"] if "trade_ref" in r.keys() else None,
            "tradeRefType": r["trade_ref_type"] if "trade_ref_type" in r.keys() else None,
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
    annotations = payload.get("annotations")
    if annotations is not None and not isinstance(annotations, list):
        raise NoteValidationError("annotations must be a list")
    # The ONLY Journal-Widgets write path without a byte ceiling until the
    # launch audit caught it: notes cap at 1MB, but a scripted (or organic —
    # a long aisearch thread) capture could bank arbitrarily large rows in the
    # shared auth.db, x100 rows per user. 256KB comfortably fits every real
    # capture (the largest organic payloads measure ~30KB).
    _size = (len(json.dumps(params or {}).encode("utf-8"))
             + len(json.dumps(annotations or []).encode("utf-8"))
             + len(str(payload.get("searchText") or "").encode("utf-8")))
    if _size > 256 * 1024:
        raise NoteValidationError("capture too large (>256KB)")
    trade_ref = payload.get("tradeRef") or None
    trade_ref_type = payload.get("tradeRefType") or None
    # Same degrade-not-fail philosophy as _extract_embeds: a capture must
    # never be blocked by an unrecognized tradeRefType — it's dropped to
    # NULL (untyped) rather than rejecting the whole capture.
    if trade_ref_type is not None and not is_valid_trade_ref_type(trade_ref_type):
        trade_ref_type = None
    owned = conn is None
    conn = conn or get_connection()
    try:
        cid = uuid.uuid4().hex
        now = _now_iso()
        conn.execute(
            "INSERT INTO j2_capture_inbox (id, user_id, widget_id, params_json,"
            " search_text, fallback_url, annotations_json, captured_at, created_at,"
            " caption, trade_ref, trade_ref_type)"
            " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (cid, user_id, payload["widgetId"], json.dumps(params or {}),
             payload.get("searchText") or None, payload.get("fallbackUrl") or None,
             json.dumps(annotations) if annotations else None,
             payload.get("capturedAt") or now, now,
             payload.get("caption") or None, trade_ref,
             trade_ref_type if trade_ref else None),
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


TRASH_RETENTION_DAYS = 30


def delete_note(
    user_id: str,
    note_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Wave 0 trash: soft delete. `deleted_at` set; the row, its embeds, and
    its FTS index entry are left physically intact — `_notes_filter_sql`'s
    `deleted_at IS NULL` predicate already keeps a soft-deleted note out of
    every normal list/search/count (including FTS-matched search: the
    outer `j2_notes` row is filtered by `deleted_at`, so a stale FTS entry
    for a trashed note can never surface it — no separate FTS cleanup is
    needed here). `purge_expired_deleted_notes` below does the real
    `DELETE` once the retention window passes, which fires the existing
    `AFTER DELETE` trigger and cleans the FTS mirror at that point, exactly
    as the old hard-delete path always did.

    Idempotent in the sense the caller expects: deleting an already-deleted
    (or nonexistent) note returns False, matching the prior hard-delete
    behavior's 404 semantics one layer up in the router."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_notes SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (_now_iso(), note_id, user_id),
        )
        conn.commit()
        ok = cur.rowcount > 0
        if ok:
            _log_notebook_event(user_id, "notebook_note_trashed")
        return ok
    finally:
        if owned:
            conn.close()


def restore_note(
    user_id: str,
    note_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Undo a soft delete. Returns the restored note (full shape, same as
    `get_note`) or None if there was no matching soft-deleted note to
    restore (already restored, already hard-purged, wrong owner, or never
    existed — the caller can't distinguish these and shouldn't need to;
    they all mean "nothing to restore")."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_notes SET deleted_at = NULL, updated_at = ?"
            " WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL",
            (_now_iso(), note_id, user_id),
        )
        conn.commit()
        if not cur.rowcount:
            return None
        _log_notebook_event(user_id, "notebook_note_restored")
        return get_note(user_id, note_id, conn=conn)
    finally:
        if owned:
            conn.close()


def purge_expired_deleted_notes(
    retention_days: int = TRASH_RETENTION_DAYS,
    now: datetime | None = None,
    conn: sqlite3.Connection | None = None,
) -> int:
    """Hard-delete every note soft-deleted more than `retention_days` ago,
    across ALL users — the scheduled sweep behind the trash's retention
    window. Real `DELETE`s (not scoped to one user_id, unlike almost every
    other function in this file) so this is deliberately NOT exposed
    through any router — call only from the scheduler job in main.py.
    Returns the count of notes actually purged, for the job's own log line.

    Reuses the exact hard-delete shape `delete_note` used before Wave 0
    (real DELETE + embeds cleanup, firing the FTS `AFTER DELETE` trigger),
    just widened to a cutoff-date WHERE clause instead of a single id."""
    from datetime import timedelta
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=retention_days)).isoformat()
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT id FROM j2_notes WHERE deleted_at IS NOT NULL AND deleted_at < ?",
            (cutoff,),
        ).fetchall()
        ids = [r["id"] for r in rows]
        for note_id in ids:
            conn.execute("DELETE FROM j2_notes WHERE id = ?", (note_id,))
            conn.execute("DELETE FROM j2_note_embeds WHERE note_id = ?", (note_id,))
            conn.execute("DELETE FROM j2_note_mentions WHERE note_id = ?", (note_id,))
        conn.commit()
        return len(ids)
    finally:
        if owned:
            conn.close()


def register_trash_purge_job(scheduler) -> bool:
    """Nightly trash-purge sweep, 03:20 ET every day — before the 03:40
    attachment GC (attachment_gc.py), so a note hard-deleted here is already
    gone by the time that sweep decides which images are still referenced;
    running it the other order would have the attachment sweep protect
    images for a note this job is about to remove anyway, a harmless but
    pointless ordering, not a correctness bug either way.

    Unlike `attachment_gc`'s dark-by-default rollout, this ships ON by
    default (`J2_TRASH_PURGE_ENABLED` defaults to "1") — the trash feature's
    own promise to members is "restorable for TRASH_RETENTION_DAYS, then
    gone"; shipping the restore half without an active sweep for the
    "then gone" half would leave that promise permanently unfulfilled. The
    env var stays as a kill-switch, not a required opt-in."""
    if os.environ.get("J2_TRASH_PURGE_ENABLED", "1") != "1":
        return False
    from zoneinfo import ZoneInfo
    from apscheduler.triggers.cron import CronTrigger

    def _job() -> None:
        try:
            n = purge_expired_deleted_notes()
            print(f"[j2-trash-purge] purged={n} retention_days={TRASH_RETENTION_DAYS}")
        except Exception as e:  # noqa: BLE001 — a failed sweep must never break the scheduler
            print(f"[j2-trash-purge] sweep failed: {e}")

    scheduler.add_job(
        _job,
        CronTrigger(hour=3, minute=20, timezone=ZoneInfo("America/New_York")),
        id="j2_trash_purge",
        max_instances=1,
        coalesce=True,
    )
    return True


# ── Favorites + Recents (Wave B: High-Frequency Notebook UX) ────────────────
# Both idempotent (re-favoriting / re-opening is a no-op write), both
# trash-aware via the read-side JOIN (a favorited/opened note that gets
# trashed is silently excluded from these lists; Restore un-hides it again
# with no extra reconciliation), both cascade-cleaned on hard delete via the
# j2_notes_favorites_ad / j2_notes_recents_ad triggers in db.py — never via a
# per-call-site DELETE here, same rationale as the FTS triggers.

RECENTS_DEFAULT_LIMIT = 8
FAVORITES_DEFAULT_LIMIT = 50


def add_favorite(
    user_id: str,
    note_id: str,
    conn: sqlite3.Connection | None = None,
) -> None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT 1 FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (note_id, user_id),
        ).fetchone()
        if row is None:
            raise NoteValidationError("note not found")
        conn.execute(
            "INSERT INTO j2_note_favorites (user_id, note_id, created_at) "
            "VALUES (?, ?, ?) ON CONFLICT(user_id, note_id) DO NOTHING",
            (user_id, note_id, _now_iso()),
        )
        if owned:
            conn.commit()
    finally:
        if owned:
            conn.close()


def remove_favorite(
    user_id: str,
    note_id: str,
    conn: sqlite3.Connection | None = None,
) -> None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.execute(
            "DELETE FROM j2_note_favorites WHERE user_id = ? AND note_id = ?",
            (user_id, note_id),
        )
        if owned:
            conn.commit()
    finally:
        if owned:
            conn.close()


def list_favorites(
    user_id: str,
    limit: int = FAVORITES_DEFAULT_LIMIT,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT n.* FROM j2_note_favorites f "
            "JOIN j2_notes n ON n.id = f.note_id AND n.user_id = f.user_id "
            "WHERE f.user_id = ? AND n.deleted_at IS NULL "
            "ORDER BY f.created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [_row_to_note_summary(r) for r in rows]
    finally:
        if owned:
            conn.close()


def record_note_opened(
    user_id: str,
    note_id: str,
    conn: sqlite3.Connection | None = None,
) -> None:
    """Fire-and-forget system-derived recency tracking — the router wraps this
    in a broad try/except so a failure here never surfaces to the member or
    blocks note rendering (see the "opened" endpoint's own docstring)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.execute(
            "INSERT INTO j2_note_recents (user_id, note_id, opened_at) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id, note_id) DO UPDATE SET opened_at = excluded.opened_at",
            (user_id, note_id, _now_iso()),
        )
        if owned:
            conn.commit()
    finally:
        if owned:
            conn.close()


def list_recents(
    user_id: str,
    limit: int = RECENTS_DEFAULT_LIMIT,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT n.* FROM j2_note_recents r "
            "JOIN j2_notes n ON n.id = r.note_id AND n.user_id = r.user_id "
            "WHERE r.user_id = ? AND n.deleted_at IS NULL "
            "ORDER BY r.opened_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [_row_to_note_summary(r) for r in rows]
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
    try:
        assert_import_headroom(len(data))
    except NoteQuotaExceeded as e:
        raise NoteValidationError(str(e)) from e

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
    try:
        assert_import_headroom(len(data))
    except NoteQuotaExceeded as e:
        raise NoteValidationError(str(e)) from e

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


def _is_safe_path_segment(value: str) -> bool:
    """One path segment, same axis `filename` is already checked on below: no
    separators (so it can't smuggle extra path components) and no leading
    dot (so it can't be `.`/`..`). Empty is also unsafe — `Path("") / "x"`
    silently collapses to `"x"`, which is not the segment the caller named."""
    return bool(value) and "/" not in value and "\\" not in value and not value.startswith(".")


def serve_note_image_path(
    user_id: str,
    note_id: str,
    sub: str,
    filename: str,
) -> Path | None:
    if sub not in ("hero", "inline", "file"):
        return None
    # Cheap, precise layer: user_id/note_id/filename must each be a single
    # path segment. This alone would have caught the historical bug, but it
    # is NOT the only guard — see the root-anchored check below.
    if not _is_safe_path_segment(user_id) or not _is_safe_path_segment(note_id):
        return None
    if "/" in filename or "\\" in filename or filename.startswith("."):
        return None
    rel = Path(user_id) / "notes" / note_id / sub
    # Structural layer: containment is checked against the ATTACHMENT ROOT
    # itself (primary or legacy — whichever root this candidate came from),
    # never against `base` (= root/user_id/notes/note_id/sub). `base` is
    # built FROM caller-supplied user_id/note_id, so a containment check
    # anchored on `base` only proves the target sits inside a directory the
    # caller helped construct — it says nothing about the real root. Anchoring
    # on the root is what still holds even if a future caller (e.g. one
    # reading user_id/note_id out of a DB row instead of a validated URL path)
    # skips the segment check above.
    #
    # Primary root first, then the LEGACY repo-relative tree — a box that
    # still holds files in the old location keeps serving them after the
    # root moved. The containment guard is re-applied per candidate, never
    # skipped.
    for root, base in _read_candidates_with_roots(rel):
        target = (base / filename).resolve()
        try:
            target.relative_to(root.resolve())
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
