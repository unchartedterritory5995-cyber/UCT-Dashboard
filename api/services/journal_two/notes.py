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
from api.services.journal_two.notebook_schema import check_body_write
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
# Which node types are leaves / inline leaves / textblocks: ONE table, owned by
# the citation text and pinned against the real schema (see extract_plain_text).
from api.services.journal_two.note_citation_text import (
    _ATOM_TEXT as _CITATION_ATOM_TEXT,
    _INLINE_LEAF_TYPES as _CITATION_INLINE_LEAF_TYPES,
    _LEAF_TYPES as _CITATION_LEAF_TYPES,
    _is_textblock as _citation_is_textblock,
    node_type as _citation_node_type,
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


# What a LEAF node reads as in body_plain: the citation text's own leaf table
# (note_citation_text._ATOM_TEXT -- attachment chip, excerpt, widget, hard
# break, formulas) plus the ONE leaf the search text reads and a citation does
# not: a video timestamp, searchable as "[1:15]". Derived, never restated --
# WHICH types are leaves, which leaves are inline and which blocks are
# textblocks comes from the same module, pinned against the app's real
# ProseMirror schema by askCitation.schemaParity.test.js. The client twin is
# lib/tiptap.js::plainLeafText (citationLeafText + the same one extra), and
# tests/fixtures_plain_text.json pins the two serializers together.
#   · a formula reads as its LaTeX source; an empty one as nothing.
#   · widgetEmbed carries its line pre-computed in attrs.searchText: the CLIENT
#     derives it from the widget registry at the only moments params change
#     (insert / toolbar edit), so this side never re-owns 13 per-widget formats.
#   · documentExcerpt: the excerpt's durable text lives in j2_note_excerpts and
#     is searchable through its own FTS index, so the body carries a marker.
#   · every other leaf (image, rule, fact, noteLink, askCitation) reads as "".
_PLAIN_LEAF_TEXT = {
    **_CITATION_ATOM_TEXT,
    "videoTimestamp": lambda a: f"[{_fmt_secs(a.get('seconds'))}]",
}

# One space between blocks: FTS5 tokenizes on non-alphanumerics, so the
# separator only has to keep two blocks' words apart.
PLAIN_TEXT_BLOCK_SEPARATOR = " "


def extract_plain_text(doc: dict[str, Any] | None) -> str:
    """The note's plain text -- ProseMirror's own
    ``doc.textBetween(0, size, " ", leafText)``, walked over the stored JSON.

    This writes body_plain -- the notebook search index and the text History
    diffs -- so it MUST stay in lockstep with the client serializer
    (lib/tiptap.js extractPlainText). It is PINNED, not promised: both read
    tests/fixtures_plain_text.json (tests/test_plain_text_parity.py ⇄
    lib/plainText.parity.test.js), and each rail fails on a leaf one side reads
    and the other does not.

    The rules are textBetween's, verbatim, and the same ones the citation text
    uses (note_citation_text.flatten, with a newline where this has a space):
      · text runs inside one textblock join with NOTHING -- a mark (bold,
        highlight, link) is invisible, so "**NV**DA" reads "NVDA" and a
        highlighted phrase mid-sentence keeps single spaces around it;
      · every textblock (an EMPTY one included) is preceded by one separator,
        except the first thing in the document to earn one;
      · a container that is not a textblock (list, quote, table, toggle, ...)
        adds nothing of its own;
      · a BLOCK leaf is preceded by a separator only when it reads as text; an
        INLINE leaf never is.
    ⚰️ Until 2026-09-23 every text node was joined with a space, so a partly
    bold word was indexed as two words and a search for it missed the note.

    attrs and type may be any JSON shape (permissive body validator + importer
    round trip) -- a non-dict attrs degrades to {}, a non-string type reads as
    an unknown node (note_citation_text.node_type), and neither 500s the note
    write."""
    if not isinstance(doc, dict):
        return ""
    parts: list[str] = []
    state = {"first": True}

    def separator() -> None:
        # textBetween: `if (first) first = false; else text += blockSeparator`
        if state["first"]:
            state["first"] = False
            return
        parts.append(PLAIN_TEXT_BLOCK_SEPARATOR)

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        # A type that is not a string is an UNKNOWN node, never a table key:
        # `{"type": ["x"]}` hashed here and 500'd create/update (R23-N3).
        ntype = _citation_node_type(node)
        attrs = node.get("attrs")
        if not isinstance(attrs, dict):
            attrs = {}
        if ntype == "text":
            t = node.get("text")
            if isinstance(t, str):
                parts.append(t)
            return
        if ntype in _CITATION_LEAF_TYPES:
            maker = _PLAIN_LEAF_TEXT.get(ntype)
            leaf = maker(attrs) if maker is not None else ""
            if leaf and ntype not in _CITATION_INLINE_LEAF_TYPES:
                separator()
            parts.append(leaf)
            return
        if _citation_is_textblock(node):
            separator()
        children = node.get("content")
        if isinstance(children, list):
            for child in children:
                walk(child)

    children = doc.get("content")
    if isinstance(children, list):
        for child in children:
            walk(child)
    return "".join(parts)


# ── Combined note-content sidecar sync (Performance QW-2, 2026-09-22) ───────
#
# All FIVE of a note's content-derived sidecar projections (j2_note_embeds,
# j2_note_mentions, j2_note_links, j2_note_fact_refs, j2_note_excerpt_refs)
# used to be kept in sync by five separate functions, invoked back-to-back at
# every one of this file's seven bodyJson-writing call sites. Four of those
# five (everything except mentions) independently walked the SAME body_json
# document tree -- once each for widgetEmbed, noteLink, financialFact and
# documentExcerpt nodes -- to answer what is really one question asked four
# times over: "what does this tree contain, node by node?" For a large
# document (the audit's own named case: a big, mostly-prose or imported note)
# that is 4x the walk cost of what the answer actually requires, paid on
# every save that touches the body.
#
# ⛔ What this does NOT change, and why: the audit's literal framing was
# "skip a full DELETE + INSERT when there's nothing to sync." That premise is
# false for this schema -- every one of these 5 tables (db.py) declares
# `note_id` as the LEADING column of its composite PRIMARY KEY, so SQLite
# serves `DELETE ... WHERE note_id = ?` from that index. A delete against a
# note with zero existing sidecar rows (the common case the audit worried
# about) is a single index probe that deletes nothing -- there is no table
# scan to avoid, and a SELECT EXISTS pre-check to skip it would spend a round
# trip to save a round trip that was already nearly free. The real,
# measurable cost was the redundant walk, and that's what this fixes: same
# DELETE-then-conditionally-INSERT shape per table, computed from ONE walk
# instead of four.
def _sync_note_mentions(
    conn: sqlite3.Connection, user_id: str, note_id: str, body_plain: str | None,
) -> None:
    """Rebuild one note's `j2_note_mentions` inside the caller's transaction.
    Cashtag-tier ONLY (see the schema comment in db.py for why): scans
    body_plain, which every caller has already computed via
    extract_plain_text -- this never re-derives note text or re-walks
    body_json. Fast and local: buzz_extract is a pure regex/set-membership
    matcher, no network call, so this never makes a note save depend on an
    external provider. Called by `_sync_note_sidecars` on every save, and by
    the body_plain backfill for a note whose text it re-derived."""
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


def _sync_note_sidecars(
    conn: sqlite3.Connection, user_id: str, note_id: str,
    body_json: dict[str, Any] | None, body_plain: str | None,
) -> None:
    """Rebuild all 5 note-content sidecar projections inside the caller's
    transaction (no commit here). Replaces the old _sync_note_embeds /
    _sync_note_mentions / _sync_note_links / _sync_note_fact_refs /
    _sync_note_excerpt_refs quintet, which every call site invoked together
    in this exact order -- see the module comment above for why combining
    them is a real perf win and not just tidying."""
    embeds: list[dict[str, Any]] = []
    link_ids: list[str] = []
    fact_ids: list[str] = []
    excerpt_ids: list[str] = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        ntype = node.get("type")
        if ntype == "widgetEmbed":
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
                embeds.append({
                    "widget_id": widget_id,
                    "symbol": sym.upper() if isinstance(sym, str) and sym else None,
                    "timeframe": str(tf) if tf is not None else None,
                    "trade_ref": trade_ref,
                    "trade_ref_type": trade_ref_type if trade_ref else None,
                    "mode": attrs.get("mode") or None,
                    "captured_at": attrs.get("capturedAt") or None,
                })
        elif ntype == "noteLink":
            # Wave D. A note linking to the same target twice keeps BOTH
            # occurrences (position is part of the sidecar's primary key) --
            # directive §64 wants the backlink UI to show one relationship
            # per SOURCE note, not one row per occurrence, and that de-dup
            # happens at the QUERY layer (get_note_backlinks), not here, so
            # this stays a faithful, ungrouped projection of what the
            # document actually contains.
            attrs = node.get("attrs")
            target = attrs.get("noteId") if isinstance(attrs, dict) else None
            if isinstance(target, str) and target:
                link_ids.append(target)
        elif ntype == "financialFact":
            # Wave F.
            attrs = node.get("attrs")
            fid = attrs.get("factId") if isinstance(attrs, dict) else None
            if isinstance(fid, str) and fid:
                fact_ids.append(fid)
        elif ntype == "documentExcerpt":
            # Wave J. Mirrors financialFact exactly.
            attrs = node.get("attrs")
            eid = attrs.get("excerptId") if isinstance(attrs, dict) else None
            if isinstance(eid, str) and eid:
                excerpt_ids.append(eid)
        for child in node.get("content", []) or []:
            walk(child)
    if isinstance(body_json, dict):
        walk(body_json)

    # j2_note_embeds -- delete+insert; document order (position) is the PK.
    conn.execute("DELETE FROM j2_note_embeds WHERE note_id = ?", (note_id,))
    if embeds:
        conn.executemany(
            "INSERT INTO j2_note_embeds (note_id, user_id, position, widget_id,"
            " symbol, timeframe, trade_ref, trade_ref_type, mode, captured_at)"
            " VALUES (?,?,?,?,?,?,?,?,?,?)",
            [(note_id, user_id, i, r["widget_id"], r["symbol"], r["timeframe"],
              r["trade_ref"], r["trade_ref_type"], r["mode"], r["captured_at"])
             for i, r in enumerate(embeds)])

    # j2_note_mentions -- the one projection derived from body_plain, not
    # body_json; its own function so the body_plain backfill
    # (db.run_notebook_migration_v7) rebuilds it through this same code.
    _sync_note_mentions(conn, user_id, note_id, body_plain)

    # j2_note_links -- a `noteLink` node's target id is NEVER validated
    # against j2_notes here: a link to a note that doesn't exist (foreign
    # tenant, already deleted, malformed id typed via direct API use) still
    # gets a sidecar row -- resolving whether that target is real, owned,
    # trashed, or purged is the READ path's job (get_note_backlinks / the
    # node view's own title lookup), which re-verifies ownership on every
    # call. Persisting an unresolvable row here is harmless (directive §33's
    # 'never silently delete source content' cuts the other way too -- this
    # sync must never REJECT a save because a link target looks wrong).
    conn.execute("DELETE FROM j2_note_links WHERE note_id = ?", (note_id,))
    if link_ids:
        conn.executemany(
            "INSERT INTO j2_note_links (note_id, user_id, position, target_note_id)"
            " VALUES (?,?,?,?)",
            [(note_id, user_id, i, tid) for i, tid in enumerate(link_ids)])

    # j2_note_fact_refs -- facts are note-owned (Wave F checkpoint decision
    # 24): a factId this note no longer references simply drops out of the
    # sidecar; the owning j2_fact_observations row is untouched here
    # (removal-as-deletion is note_facts.delete_fact_observation's job,
    # called explicitly by the editor when a member removes a financialFact
    # node, never inferred from a save diff -- inferring it here would
    # delete a fact the member only temporarily cut mid-edit).
    conn.execute("DELETE FROM j2_note_fact_refs WHERE note_id = ?", (note_id,))
    if fact_ids:
        conn.executemany(
            "INSERT INTO j2_note_fact_refs (note_id, user_id, position, fact_id)"
            " VALUES (?,?,?,?)",
            [(note_id, user_id, i, fid) for i, fid in enumerate(fact_ids)])

    # j2_note_excerpt_refs -- mirrors j2_note_fact_refs exactly. An
    # excerptId this note no longer references simply drops out of the
    # sidecar; the owning j2_note_excerpts row is untouched here
    # (removal-as-deletion is note_excerpts.delete_excerpt's job, an
    # explicit action never inferred from a save diff).
    conn.execute("DELETE FROM j2_note_excerpt_refs WHERE note_id = ?", (note_id,))
    if excerpt_ids:
        conn.executemany(
            "INSERT INTO j2_note_excerpt_refs (note_id, user_id, position, excerpt_id)"
            " VALUES (?,?,?,?)",
            [(note_id, user_id, i, eid) for i, eid in enumerate(excerpt_ids)])


# ── Validation ───────────────────────────────────────────────────────────────

def _normalize_tag_path(tag: str) -> str:
    """Nested tags (Obsidian's `a/b/c`): every level trimmed, empty levels
    dropped — so "Research / Semis", "research//semis" and a stray leading or
    trailing slash all name ONE place in the tag tree. A flat tag (no `/`)
    comes back exactly as `str.strip()` would give it: nothing else changes
    for the tags every member already has."""
    t = tag.strip()
    if "/" not in t:
        return t
    return "/".join(seg.strip() for seg in t.split("/") if seg.strip())


def tag_key(tag: Any) -> str:
    """A tag's IDENTITY — the one key every comparison of two tags uses: the
    tag tree's node keys, its counts, the `tag=` filter (both halves), the
    search box's tag match and the bulk bar's add/remove.

    Nested-path normalised, then lower-cased by PYTHON, which folds Unicode
    ("Élan" -> "élan"). ⛔ Never SQLite's `lower()` for this: it folds ASCII
    only, so "Élan" and "élan" were two tags to SQL and one to Python.
    ⛔ And never the STORED spelling: a tag saved before nested tags ("Q3 / Q4",
    the old validator only stripped it) is the same tag as "Q3/Q4" — the tree
    counted it under "q3/q4" while the filter compared the raw text and found
    nothing (review S2)."""
    if tag is None:
        return ""
    return _normalize_tag_path(str(tag)).lower()


def _sql_tag_match(value: Any, key: str) -> int:
    """SQL `j2_tag_match(value, key)`: 1 when a stored tag IS `key` or sits
    below it (`key/…`) — a tag is the parent of its children (Obsidian)."""
    if value is None or not key:
        return 0
    k = tag_key(value)
    return 1 if (k == key or k.startswith(key + "/")) else 0


def _sql_tag_is(value: Any, key: str) -> int:
    """SQL `j2_tag_is(value, key)`: 1 when a stored tag IS `key` (no children)."""
    if value is None or not key:
        return 0
    return 1 if tag_key(value) == key else 0


def register_note_sql_functions(conn: sqlite3.Connection) -> sqlite3.Connection:
    """Register the Python functions this module's SQL calls. Every
    connection that runs a `_notes_filter_sql` predicate MUST pass through
    here first — `no such function` otherwise.
    Deterministic, per-connection and idempotent; cheap enough to call on
    every read."""
    conn.create_function("j2_tag_match", 2, _sql_tag_match, deterministic=True)
    conn.create_function("j2_tag_is", 2, _sql_tag_is, deterministic=True)
    return conn


def _tag_prefilter(key: str) -> tuple[str, list[Any]]:
    """A cheap SUPERSET test on the raw `tags` JSON text, run before the
    per-tag Python match so a 50k-note library does not pay one Python call
    per tag per note. Sound WHATEVER THE WRITER, by construction:
      · a row that is pure ASCII (no byte above 0x7F) with no `\\u`
        escape is where SQLite's `lower()` and Python's agree, and JSON
        escaping is per character — so the JSON-escaped first segment of
        the key appears in `lower(tags)` whenever a stored tag's key matches;
      · every other row passes through to the exact check: one WITH an
        escape (`json.dumps`' default for a non-ASCII tag), AND one holding
        raw UTF-8 (`ensure_ascii=False`, SQLite's own JSON functions, an
        import) — `length(CAST(x AS BLOB))` counts bytes and `length(x)`
        characters, so the two differ exactly when a byte above 0x7F is there.
    ⚰️ Until fix round 3 only the escape passed, so soundness rested on an
    unwritten rule that every writer escapes: a raw-UTF-8 `["Élan"]` was
    counted by the tree and NOT found by `tag=élan` (review R1-N1)."""
    first = key.split("/", 1)[0]
    needle = json.dumps(first)[1:-1]
    return ("(instr(lower(j2_notes.tags), ?) > 0 OR instr(j2_notes.tags, '\\u') > 0"
            " OR length(CAST(j2_notes.tags AS BLOB)) != length(j2_notes.tags))",
            [needle])


def _symbol_note_ids_sql(user_id: str, symbols: list[str]) -> tuple[str, list[Any]]:
    """`SELECT note_id ...` for the member's notes that carry a chart embed OR a
    cashtag mention of any of `symbols`: the ONE answer to "which notes relate to
    this symbol". The list filters (`ticker=`, `embed_symbol=`, the sector/theme
    `symbol_in`) and `get_symbol_backlinks` all read this one set.

    ⛔⛔ NON-CORRELATED, ON PURPOSE. This used to be two correlated
    `EXISTS (... WHERE e.note_id = j2_notes.id AND e.user_id = j2_notes.user_id
    AND e.symbol = ?)`. With no ANALYZE statistics (production runs none), the
    planner answered each EXISTS from `idx_j2_note_embeds_user_sym`
    `(user_id, symbol)` because it has two equality columns. That index holds
    EVERY embed of the symbol, so the check scanned all of them once PER NOTE.
    Measured at `acf1eb51e` (tools/notebook_scale_benchmark.py): `GET /notes?
    embed_symbol=` list+count took 717 ms p95 at 10k notes and ~14.8 s at 50k.
    As an `IN (subquery)` it is computed ONCE into an ephemeral index and each
    note is one probe."""
    marks = ",".join("?" * len(symbols))
    return (f"SELECT note_id FROM j2_note_embeds WHERE user_id = ? AND symbol IN ({marks})"
            f" UNION SELECT note_id FROM j2_note_mentions WHERE user_id = ? AND symbol IN ({marks})",
            [user_id, *symbols, user_id, *symbols])


def _tag_clause(user_id: str, key: str) -> tuple[str, list[Any]]:
    """The note-carries-this-tag-or-one-below-it predicate, for a NON-EMPTY
    `tag_key`: the cheap prefilter, then the exact per-tag match. ⛔ ONE copy,
    used by the list/count predicate (`_notes_filter_sql`) and by the tag
    rename's roster (`tag_member_notes`) — a rename that found its notes by a
    different rule than the filter shows them would miss some, or touch others.

    Wave 7 (lane I): phrased as a ROWID SET (`_tag_rowid_set_sql`), not a
    per-row test. See there for why."""
    set_sql, set_params = _tag_rowid_set_sql(user_id, key, "j2_tag_match")
    return f"j2_notes.rowid IN ({set_sql})", set_params


def _tag_rowid_set_sql(user_id: str, key: str, match_fn: str) -> tuple[str, list[Any]]:
    """`SELECT rowid ...` of the member's notes (any status: the caller's own
    WHERE decides live / trash / archive) whose tags satisfy `match_fn(tag, key)`
    -- `j2_tag_match` (the tag or one below it) or `j2_tag_is` (exactly it).

    ⛔⛔ A SET, NOT A PER-ROW TEST. As a correlated predicate the match read the
    `tags` column of every candidate note, and `tags` sits after the ~2 KB body,
    on an overflow page. As a set it is computed ONCE, from
    `idx_j2_notes_live_cover` alone (db.py), and the outer query tests only
    `rowid`, which every index carries. Measured at acf1eb51e, 50k notes: the
    `q=` list for a term matching one note took 176 ms p95, walking every note's
    overflow chain to test its tags (docs/notebook/perf-budgets.md §2)."""
    pre_sql, pre_params = _tag_prefilter(key)
    return (f"SELECT rowid FROM j2_notes WHERE user_id = ? AND {pre_sql}"
            " AND EXISTS (SELECT 1 FROM json_each(COALESCE(j2_notes.tags, '[]')) jt"
            f" WHERE {match_fn}(jt.value, ?))",
            [user_id, *pre_params, key])


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
        t2 = _normalize_tag_path(t)
        if not t2:
            continue
        if len(t2) > MAX_TAG_LENGTH:
            raise NoteValidationError(f"tag exceeds {MAX_TAG_LENGTH} chars")
        key = tag_key(t2)
        if key in seen:
            continue
        seen.add(key)
        out.append(t2)
    return out


def patched_tag_list(existing: Any, add: list[str], remove: list[str]) -> list[str] | None:
    """Wave 6 (lane E) — a tag DELTA applied to a STORED list (`PATCH
    /notes/{id}/tags`): drop every tag whose identity (`tag_key`) is in
    `remove` — exactly that tag, a parent's children stay — then append each
    `add` the list does not already hold. → the new list, or None when nothing
    would change (so an idempotent request moves no revision). Pure: no SQL;
    the length and cap checks stay `_validate_tags`' (update_note runs it)."""
    before = list(existing or [])
    gone = {tag_key(t) for t in remove}
    out = [t for t in before if tag_key(t) not in gone]
    have = {tag_key(t) for t in out}
    for t in add:
        k = tag_key(t)
        if k and k not in have:
            out.append(t)
            have.add(k)
    return None if out == before else out


def renamed_tag_list(existing: Any, from_tag: str, to_tag: str) -> list[str] | None:
    """Wave 6 (lane E, item 8) — rename `from_tag`, AND every tag below it, to
    `to_tag` in one note's list: `a` -> `x` makes `a/b` -> `x/b` (a tag is the
    parent of its `tag/…` children, as the tree and the `tag=` filter read it).
    Matched by identity (`tag_key`), whole levels only ("researcher" is not
    below "research"); a child keeps its OWN spelling below the renamed part.
    Two tags that become one are one (the first kept). → the new list, or None
    when nothing changes. Pure; a renamed child that outgrows the tag length is
    refused by `_validate_tags` when update_note writes it."""
    before = list(existing or [])
    fk = tag_key(from_tag)
    depth = len(fk.split("/"))
    out: list[str] = []
    seen: set[str] = set()
    for t in before:
        k = tag_key(t)
        if k == fk:
            t2 = to_tag
        elif k.startswith(fk + "/"):
            t2 = "/".join([to_tag, *_normalize_tag_path(str(t)).split("/")[depth:]])
        else:
            t2 = t
        k2 = tag_key(t2)
        if k2 in seen:
            continue
        seen.add(k2)
        out.append(t2)
    return None if out == before else out


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
        # ⛔ THIS STRING REACHES A MEMBER VERBATIM, TWICE OVER, BY DESIGN —
        # never re-word it at a display site. `NoteEditorPage`'s own
        # `friendlySaveError` deliberately shows a real backend detail
        # UNCHANGED (its own regression test: "a real backend-authored
        # detail ... is preserved verbatim"), and the import wizard's
        # "Needs attention" list renders `item.error` the same way
        # (commit.js). Measured 2026-09-21 against a real note that grew
        # past the cap while already open in the editor: the member saw
        # "Save failed: body_json too large (>1MB)" — an internal field
        # name, with no idea what to do about it. One raise site fixes
        # both surfaces; a per-surface translation would fix neither for
        # the other and would be a second authority over this sentence.
        raise NoteValidationError(
            "This note is too long to save as one page. "
            "Split it into two or more notes and try again.")
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
                        _sync_note_sidecars(conn, user_id, row["id"], body_json, body_plain)
                        conn.execute("RELEASE j2_import_note")
                        # Wave Q1 (2026-09-12): ADDITIVE — the revision this write
                        # created travels back. `import_confirm` advances
                        # `updated_at` on every note it touches, and a member can
                        # absolutely have unsent offline work in a note an import
                        # UPDATES (re-importing an export they already have). A
                        # browser cannot record a revision it was never told.
                        item["id"] = row["id"]
                        item["updatedAt"] = updated_at
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
                        _sync_note_sidecars(conn, user_id, new_id, body_json, body_plain)
                        conn.execute("RELEASE j2_import_note")
                        item["id"] = new_id
                        # ⭐ A note created by this call has nothing queued against
                        # it — it did not exist a moment ago — so this revision is
                        # for completeness and costs nothing. The `updated` branch
                        # above is the one that matters.
                        item["updatedAt"] = updated_at
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
        # Wave 6 archive: ISO time the note was archived, None while it is in
        # the library. Archive is not trash — an archived note still opens.
        "archivedAt": row["archived_at"] if "archived_at" in row.keys() else None,
        # Wave 6 lock: only an explicit lock is a lock (a row from before the
        # column existed reads unlocked). The server never enforces it — the
        # editor does (see the column in db.py).
        "locked": bool(row["locked"]) if "locked" in row.keys() else False,
        # Wave 6 daily note: the ET day this note is the member's daily note
        # for, or None. Set only at creation (note_daily.open_daily_note).
        "dailyDate": row["daily_date"] if "daily_date" in row.keys() else None,
        # Wave E: user-set property VALUES only, keyed by property_id --
        # parsed (matching bodyJson/tags' own convention) but NOT resolved
        # into display form (names/labels/derived values) here; that
        # resolution is note_properties.resolve_note_properties's job, kept
        # out of this pure row-mapper.
        "propertiesJson": (
            json.loads(row["properties_json"]) if row["properties_json"] and "properties_json" in row.keys() else {}
        ),
    }


# How much body_plain a LIST row carries — enough for a card preview line,
# never the whole document.
_LIST_PLAIN_CHARS = 400


# The LIST projection's SELECT: every column EXCEPT body_json (substr caps
# body_plain in SQL so the big text never crosses the row boundary at all).
_NOTE_SUMMARY_COLS = (
    "id, user_id, account_id, folder_id, title, subtitle, "
    f"substr(coalesce(body_plain, ''), 1, {_LIST_PLAIN_CHARS}) AS body_plain, "
    "hero_image_url, first_image_url, ticker, tags, created_at, updated_at, deleted_at, "
    "properties_json, archived_at, locked"
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
        # Wave 6 archive: set only on a row listed under the Archived entry.
        "archivedAt": row["archived_at"] if "archived_at" in row.keys() else None,
        # Wave 6: the card/row lock glyph reads this.
        "locked": bool(row["locked"]) if "locked" in row.keys() else False,
        # Wave E: user-set values only (parsed) -- the list card's compact
        # property-chip row reads directly off this; NOT the full resolved
        # (name/label/derived) form, which is a per-note-editor concern.
        "propertiesJson": (
            json.loads(row["properties_json"]) if row["properties_json"] and "properties_json" in row.keys() else {}
        ),
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
    # Wave 6 archive. `folder_id="__archived__"` is the sidebar's Archived entry
    # (a sentinel, exactly like `__unfiled__` below and the client's own
    # `__trash__`): archived notes only, from every folder. Every OTHER ordinary
    # question leaves archived notes out. The trash is the one exception: a
    # trashed note is listed there whether or not it was archived first, because
    # the trash answers "what can I restore", and that note can be restored.
    # ⛔ One predicate for the list AND its count, like every clause here.
    archived_view = folder_id == "__archived__"
    if archived_view:
        folder_id = None
    if not deleted:
        sql += " AND archived_at IS " + ("NOT NULL" if archived_view else "NULL")
    if folder_id == "__unfiled__":
        sql += " AND folder_id IS NULL"
    elif folder_id:
        sql += " AND folder_id = ?"
        params.append(folder_id)
    if ticker:
        # Wave H: this must answer the SAME "which notes relate to this
        # ticker" question ticker_research._notes_for_symbols answers for the
        # research workspace (ticker column OR embed OR cashtag mention) —
        # not just the note's own `ticker` property. A strict-equality-only
        # version of this clause let the Notebook list's `?ticker=` chip (the
        # workspace's own "View all Notes" link) disagree with the workspace
        # it was linked from: a note whose only NVDA relationship was a
        # `$NVDA` mention in its body showed up in the NVDA workspace but not
        # in this same-ticker filtered list — two implementations of one
        # membership question, the exact defect shape this file's own
        # docstring above warns about.
        t = ticker.strip().upper()
        ids_sql, ids_params = _symbol_note_ids_sql(user_id, [t])
        sql += f" AND (ticker = ? OR id IN ({ids_sql}))"
        params.extend([t, *ids_params])
    # "Every entry where I traded/mentioned AMD" — the name `embed_symbol`
    # predates P0-3 (Wave 1 Slice 2) and is kept for every existing caller's
    # sake, but it now answers from BOTH sidecars: accepted chart embeds
    # (j2_note_embeds) AND cashtag prose mentions (j2_note_mentions) — an OR
    # of two EXISTS checks, so a note matching either (or both) counts once.
    # Must stay pinned to get_symbol_backlinks' own UNION
    # (test_backlinks_and_the_list_filter_agree) — same membership question,
    # asked two different ways for two different callers' query shapes.
    if embed_symbol:
        ids_sql, ids_params = _symbol_note_ids_sql(user_id, [embed_symbol.strip().upper()])
        sql += f" AND id IN ({ids_sql})"
        params.extend(ids_params)
    if embed_widget:
        # Same non-correlated shape as the symbol set above (and for the same
        # reason: `idx_j2_note_embeds_user_widget` made the correlated EXISTS
        # scan every embed of that widget once PER NOTE).
        sql += " AND id IN (SELECT note_id FROM j2_note_embeds WHERE user_id = ? AND widget_id = ?)"
        params.extend([user_id, embed_widget.strip()])
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
            ids_sql, ids_params = _symbol_note_ids_sql(user_id, list(symbol_in))
            sql += f" AND id IN ({ids_sql})"
            params.extend(ids_params)
        else:
            sql += " AND 0"
    if tag:
        # A note carries this tag, or a tag BELOW it (Wave 5 nested tags: a
        # tag is the parent of every `tag/…` tag, the Obsidian convention, so
        # "research" also finds notes tagged only "research/semis").
        # ⛔ Both sides compared by `tag_key` (review S2 + N2): the tree counts
        # by that key, so the filter must find by it too — a legacy
        # "Q3 / Q4", an "Élan" (stored as a `\u` escape the JSON text cannot
        # fold), a `tag=` with a stray trailing slash. Decoded values, never
        # a LIKE on the JSON text, so `%` and `_` in a tag are text.
        # ⛔ ONE predicate for the list AND its count — both build off this;
        # callers run it on a connection from `register_note_sql_functions`.
        key = tag_key(tag)
        if key:
            tag_sql, tag_params = _tag_clause(user_id, key)
            sql += f" AND {tag_sql}"
            params.extend(tag_params)
        else:
            # A tag that normalises to nothing names no tag: an honest empty
            # result, never a silently ignored filter.
            sql += " AND 0"
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
        # The search box finds a note whose tag IS the text typed -- the same
        # `tag_key` identity the `tag=` filter uses (never its children: a
        # search for "research" is not a request for the whole subtree).
        # ⛔ Wave 7 (lane I): every branch of the `q` match below is a ROWID SET,
        # computed once, never a per-row test -- the tag and ticker columns sit
        # after the body, on an overflow page (see `_tag_rowid_set_sql`).
        q_key = tag_key(q)
        if q_key:
            tag_set_sql, tag_params = _tag_rowid_set_sql(user_id, q_key, "j2_tag_is")
            tag_sql = f"j2_notes.rowid IN ({tag_set_sql})"
        else:
            tag_sql, tag_params = "0", []
        # Wave 4 Slice 4 fix: a leading `$` (the natural way to type a
        # cashtag) used to survive into this comparison unstripped, so
        # "$NVDA" never matched a note whose only NVDA signal was the
        # `ticker` field (fts_match_expr already stripped it for the FTS
        # branch, below -- this branch alone was the divergent one). Only
        # the LEADING separator is stripped (mirrors fts_match_expr's own
        # word/non-word split) so an internal hyphen (BRK-B) is untouched.
        exact_ticker = re.sub(r"^[^\w]+", "", q.strip()).upper()
        expr = fts_match_expr(q)
        ticker_sql = "j2_notes.rowid IN (SELECT rowid FROM j2_notes WHERE user_id = ? AND ticker = ?)"
        if expr:
            # The FTS match maps to note ids through `j2_notes_fts_map` (indexed
            # both ways), never by reading `note_id` back out of each match's
            # FTS content row -- that read, not the MATCH, was the cost of a
            # dense term (~40 ms of ~46 ms for 15k hits at 50k notes).
            # No user filter inside the set: the FTS index is one table for every
            # member, so the set can hold another member's rowids, and the outer
            # query's own `user_id = ?` drops them. Mapping by primary key is
            # ~27 ms for 15k hits; filtering by user here forced a scan of the
            # member's whole index instead (~44 ms).
            sql += (" AND (j2_notes.rowid IN (SELECT n.rowid FROM j2_notes n WHERE"
                    " n.id IN (SELECT m.note_id FROM j2_notes_fts_map m WHERE m.fts_rowid IN"
                    " (SELECT rowid FROM j2_notes_fts WHERE j2_notes_fts MATCH ?)))"
                    f" OR {tag_sql} OR {ticker_sql})")
            params.extend([expr, *tag_params, user_id, exact_ticker])
        else:
            sql += (f" AND (lower(title) LIKE ? OR lower(body_plain) LIKE ? OR {tag_sql}"
                    f" OR {ticker_sql})")
            ql = f"%{q.lower()}%"
            params.extend([ql, ql, *tag_params, user_id, exact_ticker])
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
    # This page's FTS rowids, through the map (never by reading the UNINDEXED
    # `note_id` / `user_id` back out of FTS content: that read, for EVERY match,
    # was ~40 ms of a dense term's 48 ms at 50k notes).
    by_rowid = {r[1]: r[0] for r in conn.execute(
        f"SELECT note_id, fts_rowid FROM j2_notes_fts_map WHERE note_id IN ({placeholders})",
        note_ids,
    ).fetchall()}
    if not by_rowid:
        return {}
    rids = list(by_rowid)
    rph = ",".join("?" * len(rids))
    # ⛔ ONE pass over the MATCH, snippet()/highlight() computed only for this
    # page's rows. Constraining FTS5 by `rowid IN (...)` instead made it re-seek
    # the MATCH per rowid, which measured SLOWER (~43 ms) than scanning every
    # match and skipping the rows off the page (~6 ms). Same functions, same
    # arguments, same row: the text is identical either way.
    rows = conn.execute(
        "SELECT rid, body_snippet, title_highlight FROM ("
        " SELECT rowid AS rid,"
        f" CASE WHEN rowid IN ({rph}) THEN"
        " snippet(j2_notes_fts, 3, '<mark>', '</mark>', '…', 12) END AS body_snippet,"
        # highlight(), not snippet(), for the title: snippet() truncates to
        # the requested token window regardless of whether THAT column
        # actually matched -- for a body-only match this would render an
        # unrelated title with a spurious "…" if it happened to be long,
        # never explaining anything. highlight() never truncates, so an
        # unmatched title still renders in full (just unmarked) -- the
        # Python filter below then drops it unless the title itself
        # genuinely contains a <mark>, so the frontend contract stays
        # simple: titleSnippet present+non-empty means the TITLE matched.
        f" CASE WHEN rowid IN ({rph}) THEN"
        " highlight(j2_notes_fts, 2, '<mark>', '</mark>') END AS title_highlight"
        " FROM j2_notes_fts WHERE j2_notes_fts MATCH ?"
        ") WHERE body_snippet IS NOT NULL",
        [*rids, *rids, expr],
    ).fetchall()
    out: dict[str, dict[str, str]] = {}
    for r in rows:
        title_highlight = r["title_highlight"] or ""
        out[by_rowid[r["rid"]]] = {
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
    property_filter: list[dict[str, Any]] | None = None,
    property_sort: dict[str, Any] | None = None,
    property_filter_strict: bool = True,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    owned = conn is None
    conn = conn or get_connection()
    register_note_sql_functions(conn)
    try:
        where_sql, params = _notes_filter_sql(
            user_id, folder_id=folder_id, tag=tag, ticker=ticker, q=q,
            embed_symbol=embed_symbol, embed_widget=embed_widget, deleted=deleted,
            date_from=date_from, date_to=date_to, symbol_in=symbol_in,
        )
        if property_filter:
            from api.services.journal_two.note_properties import property_filter_sql
            prop_where, prop_params = property_filter_sql(
                user_id, property_filter, conn, strict=property_filter_strict,
            )
            where_sql += prop_where
            params += prop_params
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
            prop_sort_result = None
            if property_sort:
                from api.services.journal_two.note_properties import property_sort_sql
                prop_sort_result = property_sort_sql(
                    user_id, property_sort, conn, strict=property_filter_strict,
                )
            if prop_sort_result:
                prop_order_fragment, prop_order_params = prop_sort_result
                sql += f" ORDER BY {prop_order_fragment}"
                params += prop_order_params
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
    property_filter: list[dict[str, Any]] | None = None,
    property_filter_strict: bool = True,
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
    register_note_sql_functions(conn)
    try:
        where_sql, params = _notes_filter_sql(
            user_id, folder_id=folder_id, tag=tag, ticker=ticker, q=q,
            embed_symbol=embed_symbol, embed_widget=embed_widget, deleted=deleted,
            date_from=date_from, date_to=date_to, symbol_in=symbol_in,
        )
        if property_filter:
            from api.services.journal_two.note_properties import property_filter_sql
            prop_where, prop_params = property_filter_sql(
                user_id, property_filter, conn, strict=property_filter_strict,
            )
            where_sql += prop_where
            params += prop_params
        sql = "SELECT COUNT(*) AS c FROM j2_notes" + where_sql
        row = conn.execute(sql, params).fetchone()
        return int(row["c"] or 0) if row else 0
    finally:
        if owned:
            conn.close()


_ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


def _sqlite_lower(value: str) -> str:
    """SQLite's built-in `LOWER()`: ASCII letters only (no ICU). The tag counts
    have always grouped by exactly this before folding by `tag_key`."""
    return value.translate(_ASCII_LOWER)


def _tag_scan(conn: sqlite3.Connection, user_id: str) -> list[tuple[Any, set[int]]]:
    """ONE pass over every tag of every live note: `(tag value, {note rowids})`
    per DISTINCT stored spelling.

    Served from `idx_j2_notes_live_cover` (db.py) alone -- `tags` is in it -- so
    no note row, and no row's overflow page, is read. Grouped by the exact
    spelling in SQL and handed back as one comma-joined rowid list per spelling:
    a library repeats a handful of spellings across thousands of notes, and
    materialising ~90k `(rowid, value)` tuples in Python cost more than the scan
    (measured at 50k notes: ~38 ms grouped + ~8 ms to parse, against ~50 ms for
    the raw rows before any Python work)."""
    rows = conn.execute(
        "SELECT je.value, group_concat(j2_notes.rowid)"
        " FROM j2_notes, json_each(COALESCE(j2_notes.tags, '[]')) je"
        " WHERE j2_notes.user_id = ? AND j2_notes.deleted_at IS NULL"
        " AND j2_notes.archived_at IS NULL"
        " GROUP BY je.value",
        (user_id,),
    ).fetchall()
    return [(r[0], set(map(int, str(r[1]).split(",")))) for r in rows if r[0] is not None]


def _tag_index(scan: list[tuple[Any, set[int]]]) -> tuple[dict[str, list], list[tuple[str, set[int]]]]:
    """`(by_lk, nested)`: `by_lk[LOWER(tag)] = [MAX(tag), {rowids}]` -- what the
    old SQL `GROUP BY LOWER(je.value)` returned, with the note SET kept rather than
    reduced to a count -- and `nested` = the `(tag, {rowids})` spellings holding a
    '/'. SQLite compares text by UTF-8 bytes and Python by code point, which order
    strings identically, so `max` here is the old `MAX(je.value)`."""
    by_lk: dict[str, list] = {}
    nested: list[tuple[str, set[int]]] = []
    for value, ids in scan:
        v = str(value)
        lk = _sqlite_lower(v)
        e = by_lk.get(lk)
        if e is None:
            by_lk[lk] = [v, set(ids)]
        else:
            e[1] |= ids
            if v > e[0]:
                e[0] = v
        if "/" in v:
            nested.append((v, ids))
    return by_lk, nested


def _fold_tag_index(by_lk: dict[str, list], *, flat_only: bool) -> dict[str, dict[str, Any]]:
    """Fold the per-`LOWER(tag)` groups by `tag_key`, the key the tree and the
    filter compare by: `tag_key -> {"tag", "c", "lks", "ids"}`. The two keys agree
    for almost every tag; where they do not (a legacy "Q3 / Q4" beside "Q3/Q4", or
    "Élan" beside "élan", which SQLite's ASCII-only LOWER keeps apart) the count is
    the UNION of the notes, so a note carrying two spellings of one tag counts once.
    (That recount used to take another whole-library scan; the scan now keeps the
    note sets, so the union is free.)"""
    groups: dict[str, dict[str, Any]] = {}
    for lk, (maxv, ids) in by_lk.items():
        if flat_only and "/" in lk:
            continue
        key = tag_key(lk)
        if not key:
            continue
        g = groups.get(key)
        if g is None:
            groups[key] = {"tag": maxv, "lks": [lk], "ids": ids}
        else:
            g["tag"] = max(g["tag"], maxv)
            g["lks"].append(lk)
            g["ids"] = g["ids"] | ids
    for g in groups.values():
        g["c"] = len(g["ids"])
    return groups


def _tag_groups(
    conn: sqlite3.Connection, user_id: str, *, flat_only: bool = False,
) -> dict[str, dict[str, Any]]:
    """`tag_key -> {"tag": display spelling, "c": DISTINCT notes, "lks": [...]}`
    over the member's active notes (flat tags only when `flat_only`)."""
    by_lk, _nested = _tag_index(_tag_scan(conn, user_id))
    return _fold_tag_index(by_lk, flat_only=flat_only)


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
    fix a future note written with a fresh casing anyway). `tag_key` is the
    ONE grouping key (`_tag_groups` folds SQL's groups by it) — the same function
    `_validate_tags` dedups by and the `tag=` filter finds by (wave 5 fix
    round: it replaced SQLite's ASCII-only `LOWER`, which split "Élan" from
    "élan"). Counts are DISTINCT notes. `MAX(je.value)` picks a single
    display casing per group; which variant wins is not load-bearing
    (matching is case-insensitive everywhere a tag is used), only that
    there is exactly one row per case-insensitive tag."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        # Wave 0 trash: a soft-deleted note's tags must not inflate the tag
        # cloud — same "active notebook only" predicate as everywhere else.
        return _counts_from_groups(_tag_groups(conn, user_id))
    finally:
        if owned:
            conn.close()


def _counts_from_groups(groups: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(groups.items(), key=lambda kv: (-kv[1]["c"], kv[0]))
    return [{"tag": g["tag"], "count": g["c"]} for _k, g in ordered]


def tag_counts_and_tree(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, list[dict[str, Any]]]:
    """`{"tags": tag_counts(...), "tree": tag_tree(...)}` from ONE connection and
    ONE scan: what `GET /notes/tags` returns.

    Wave 7 (lane I). The route used to call `tag_counts` and `tag_tree`
    separately, each on its own connection; between them they made four
    whole-library `json_each` passes (two groupings, the nested rows, the parents'
    recount), each reading every note's `tags` off its overflow page. Measured at
    acf1eb51e, 50k notes: 984 ms p95. Now one pass over the covering index feeds
    both halves. ⛔ The answer must equal the two separate calls AND a from-scratch
    recomputation; tests/test_journal_two_tag_counts_combined.py pins both on a
    library holding every tag shape the fold treats specially."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        by_lk, nested = _tag_index(_tag_scan(conn, user_id))
        return {"tags": _counts_from_groups(_fold_tag_index(by_lk, flat_only=False)),
                "tree": _tree_from_index(by_lk, nested)}
    finally:
        if owned:
            conn.close()


def tag_tree(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Wave 5 nested tags — every node of the member's tag tree with its
    counts: `[{path, key, own, total}]`.

    `path` is the display spelling ("Research/Semis"), `key` its case-folded
    identity (the same case-insensitive rule `tag_counts` and the `tag=`
    filter use). A parent that no note carries by itself ("research" when only
    "research/semis" exists) is still a node, with `own` 0 — otherwise the
    tree would have a child with no parent to hang from.

    ⛔ `total` is DISTINCT NOTES in the subtree, never a sum of child counts: a
    note tagged both "research" and "research/semis" is one note under
    "research", and a summed count would claim two — the same honest-count
    discipline as `tag_counts`. It is what filtering by that tag returns.

    ⭐ One pass (wave 7): the same `_tag_scan` rows `tag_counts` folds, read
    from the covering index; every tag spelling is parsed once, not once per
    note (see `_tree_from_index`)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        by_lk, nested = _tag_index(_tag_scan(conn, user_id))
        return _tree_from_index(by_lk, nested)
    finally:
        if owned:
            conn.close()


def _tree_from_index(by_lk: dict[str, list], nested: list[tuple[str, set[int]]]) -> list[dict[str, Any]]:
    """`tag_tree`'s body (see `tag_tree` for the rules), from `_tag_index`."""
    flat_groups = _fold_tag_index(by_lk, flat_only=True)
    own: dict[str, int] = {}
    spelled: dict[str, str] = {}      # explicit spellings win
    implied: dict[str, str] = {}      # a parent named only through a child
    for key, g in flat_groups.items():
        own[key] = own.get(key, 0) + g["c"]
        spelled[key] = max(spelled.get(key, ""), _normalize_tag_path(g["tag"]))

    # Per DISTINCT nested spelling (with the set of notes carrying it), never per
    # note: the scan already grouped them. Same rules, same result.
    under: dict[str, set[int]] = {}   # key -> notes tagged it OR anything below it
    own_nested: dict[str, set[int]] = {}
    for tag, ids in nested:
        path = _normalize_tag_path(tag)
        if not path:
            continue
        segs = path.split("/")
        for i in range(1, len(segs) + 1):
            prefix = "/".join(segs[:i])
            pkey = prefix.lower()
            under.setdefault(pkey, set()).update(ids)
            if i < len(segs):
                implied[pkey] = max(implied.get(pkey, ""), prefix)
        own_nested.setdefault(path.lower(), set()).update(ids)
        spelled[path.lower()] = max(spelled.get(path.lower(), ""), path)

    # A flat tag that is also a PARENT: its own notes join its subtree. The scan
    # kept every flat tag's note set, so this is a union, never another scan.
    for k in [k for k in under if "/" not in k and k in flat_groups]:
        under[k] |= flat_groups[k]["ids"]

    for k, ids in own_nested.items():
        own[k] = own.get(k, 0) + len(ids)

    out: list[dict[str, Any]] = []
    for key in set(own) | set(under):
        out.append({
            "path": spelled.get(key) or implied.get(key) or key,
            "key": key,
            "own": own.get(key, 0),
            "total": len(under[key]) if key in under else own.get(key, 0),
        })
    out.sort(key=lambda n: (-n["total"], n["key"]))
    return out


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
            " WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL"
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
                " WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL"
                " AND folder_id = ?"
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
        # The SAME note-id set the list filter reads (`_symbol_note_ids_sql`),
        # driven from the set: CROSS JOIN pins it as the outer loop. Left to
        # itself the planner walked every live note and probed the set per note
        # (~160 ms at 50k, acf1eb51e); from the set it is one PK lookup per hit.
        ids_sql, ids_params = _symbol_note_ids_sql(user_id, [sym])
        row = conn.execute(
            f"SELECT COUNT(*) AS c FROM ({ids_sql}) x"
            " CROSS JOIN j2_notes n ON n.id = x.note_id"
            " WHERE n.user_id = ? AND n.deleted_at IS NULL",
            (*ids_params, user_id),
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
            f" FROM ({ids_sql}) x"
            " CROSS JOIN j2_notes n ON n.id = x.note_id"
            " LEFT JOIN ("
            "  SELECT note_id, COUNT(*) AS refs, GROUP_CONCAT(DISTINCT widget_id) AS widgets"
            "  FROM j2_note_embeds WHERE user_id = ? AND symbol = ? GROUP BY note_id"
            " ) e ON e.note_id = n.id"
            " WHERE n.user_id = ? AND n.deleted_at IS NULL"
            " ORDER BY n.updated_at DESC"
            " LIMIT ?",
            (*ids_params, user_id, sym, user_id, max(1, min(limit, 25))),
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


_LINK_CONTEXT_CHARS = 140


def _link_context_snippets(body_json: Any, target_note_id: str) -> list[str]:
    """The Wave D closure-pass residual debt, closed 2026-09-22: Obsidian's
    "show more context" for a backlink -- a short piece of the SOURCE note's
    own prose surrounding each `noteLink` reference to `target_note_id`, in
    document order (one entry per occurrence).

    `noteLink` is an ATOMIC, TITLE-LESS node by design (see
    noteLinkNode.jsx's own docstring: it stores only an id and resolves the
    live title elsewhere, so renaming a target never needs rewriting notes
    that link to it) -- it carries no text of its own, so "context" can only
    come from its SIBLINGS in the enclosing block. This walks the tree
    tracking each node's DIRECT content array; when a `noteLink` child
    matches, the snippet is that array's OWN flattened text (the enclosing
    paragraph/heading/listItem's line), never the whole document.

    Deliberately its own small walk, not a branch inside `extract_plain_
    text`: that function answers "what does the whole document say," this
    answers "what does ONE specific block say," and conflating them would
    mean threading a target-match state through a walk built for something
    else entirely."""
    if not isinstance(body_json, dict) or not target_note_id:
        return []
    snippets: list[str] = []

    def flatten_block(nodes: list, skip_index: int) -> str:
        # `skip_index` excludes the ONE noteLink occurrence this snippet is
        # FOR -- it should never mark itself as a quiet "…" inside its own
        # context. A DIFFERENT noteLink sibling (a different target, or even
        # the same one linked twice in one block) still gets marked; only
        # the specific occurrence being reported on is silent.
        out: list[str] = []
        for i, n in enumerate(nodes):
            if i == skip_index or not isinstance(n, dict):
                continue
            t = n.get("type")
            if t == "text":
                v = n.get("text")
                if isinstance(v, str):
                    out.append(v)
            elif t == "noteLink":
                out.append("…")
            elif t in ("videoTimestamp", "attachmentChip", "documentExcerpt", "widgetEmbed"):
                out.append("[…]")
        # Collapsed, not just stripped: a real note commonly has a trailing
        # space before an inline atom and a leading space after it (e.g.
        # "second " + <atom> + " third") -- skipping the atom without
        # collapsing would leave the double space in the reader-facing
        # snippet, a real cosmetic artifact, not a hypothetical one.
        text = re.sub(r"\s+", " ", "".join(out)).strip()
        if len(text) > _LINK_CONTEXT_CHARS:
            text = text[:_LINK_CONTEXT_CHARS].rstrip() + "…"
        return text

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        content = node.get("content")
        if not isinstance(content, list):
            return
        for idx, child in enumerate(content):
            if not isinstance(child, dict):
                continue
            if child.get("type") == "noteLink":
                attrs = child.get("attrs")
                if isinstance(attrs, dict) and attrs.get("noteId") == target_note_id:
                    text = flatten_block(content, idx)
                    if text:  # a link entirely alone in its block has no context to show
                        snippets.append(text)
            else:
                walk(child)

    walk(body_json)
    return snippets


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
            "SELECT n.id, n.title, n.updated_at, n.body_json, COUNT(*) AS refs"
            " FROM j2_note_links l"
            " JOIN j2_notes n ON n.id = l.note_id AND n.user_id = l.user_id"
            " WHERE l.user_id = ? AND l.target_note_id = ? AND n.deleted_at IS NULL"
            " GROUP BY n.id"
            " ORDER BY n.updated_at DESC"
            " LIMIT ?",
            (user_id, note_id, max(1, min(limit, 200))),
        ).fetchall()
        out["notes"] = []
        for r in rows:
            # A context snippet is a nice-to-have on top of the count/title
            # this row already had -- a note whose body_json fails to parse
            # (never expected, but this projection must not 500 the whole
            # backlinks list over one bad row) degrades to no snippet, same
            # philosophy as _sync_note_sidecars' own "note save is
            # authoritative, this projection is not."
            context = None
            try:
                doc = json.loads(r["body_json"] or "{}")
                found = _link_context_snippets(doc, note_id)
                context = found[0] if found else None
            except Exception:  # noqa: BLE001
                context = None
            out["notes"].append({
                "id": r["id"], "title": r["title"] or "Untitled",
                "updatedAt": r["updated_at"], "refs": int(r["refs"] or 0),
                "context": context,
            })
        return out
    finally:
        if owned:
            conn.close()


def get_note_related_from(
    user_id: str, note_id: str, conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Wave 6 (lane E, item 5): "Related from" — the member's live notes whose
    RELATION property holds `note_id`, newest edit first, once per note with the
    names of the relations that hold it: `{count, notes: [{id, title,
    updatedAt, properties}]}`.

    Owner-scoped on both the notes and the property definitions; a trashed
    source and a deleted relation property are left out, and so is the note
    itself (a note related to itself is not news on its own page). Archived
    sources stay, as they do in "Linked from": archive is not trash."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            "SELECT n.id, n.title, n.updated_at, d.name AS prop_name"
            " FROM j2_notes n"
            " JOIN json_each(COALESCE(n.properties_json, '{}')) p"
            " JOIN j2_note_properties d"
            "   ON d.id = p.key AND d.user_id = n.user_id"
            "  AND d.type = 'relation' AND d.deleted_at IS NULL"
            " WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.id != ?"
            "   AND p.type = 'array'"
            "   AND EXISTS (SELECT 1 FROM json_each(p.value) v WHERE v.value = ?)"
            " ORDER BY n.updated_at DESC, d.name",
            (user_id, note_id, note_id),
        ).fetchall()
        by_id: dict[str, dict[str, Any]] = {}
        for r in rows:
            entry = by_id.setdefault(r["id"], {
                "id": r["id"], "title": r["title"] or "Untitled",
                "updatedAt": r["updated_at"], "properties": [],
            })
            if r["prop_name"] not in entry["properties"]:
                entry["properties"].append(r["prop_name"])
        notes = list(by_id.values())
        return {"count": len(notes), "notes": notes}
    finally:
        if owned:
            conn.close()


def get_note_graph(
    user_id: str, limit: int = 1500, conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """The whole note-link graph for one member: `{nodes: [...], edges: [...]}`.

    ⛔ TWO QUERIES, NEVER N+1. `get_note_backlinks` answers "who links to THIS
    note" and is the right shape for a note page; asking it once per note to
    draw a graph would be one round trip per node. This reads the edge list and
    the node list once each, which is the whole difference between a graph that
    opens instantly and one that hammers the pod.

    ⛔ A NODE IS EVERY NOTE, NOT EVERY LINKED NOTE. An unlinked note is a real
    and interesting fact about a member's notebook — it is the thing a graph
    view exists to make visible — so isolated nodes are returned rather than
    filtered out by an inner join against the edges.

    ⛔ TRASH IS EXCLUDED ON BOTH ENDS. `get_note_backlinks` deliberately does
    NOT gate on the target being trashed, because "who links here" is a fact
    about the LINKING notes. A graph is the opposite case: drawing an edge to a
    trashed note would render a node the member cannot open, so both ends are
    gated here. The two functions disagree on purpose.

    ⛔ AND `degree` GATES TRASH THE SAME WAY THE EDGES DO — the `m` join is
    there for exactly that. Counting a link whose far end is in the trash leaves
    the surviving note with degree 1 and no line attached, so the renderer draws
    it as LINKED while the member's real situation is that it has just become an
    orphan. The two halves of one picture have to agree about what exists.

    ⚠️ `degree` is deliberately NOT capped the way the edges are: a note linked
    to a live note that fell outside `limit` still counts as linked, because it
    IS. That can leave a node with degree 2 and one drawn line on a truncated
    graph, which is why `truncated` is returned and said out loud on screen —
    the alternative, reporting a real link as no link, is the worse lie.

    `degree` is computed in SQL rather than by counting edges client-side, so
    the renderer can size nodes without walking the edge list twice.
    """
    out: dict[str, Any] = {"nodes": [], "edges": [], "truncated": False}
    owned = conn is None
    conn = conn or get_connection()
    try:
        # ⛔⛔ 2000 IS A MEASURED CEILING, NOT A ROUND NUMBER. The renderer's
        # layout is O(n^2) over 220 ticks on the main thread; benchmarked with
        # its real constants: 1500 -> 5.5ms/frame, 2000 -> 10.3ms (both inside
        # the 16ms budget), 3000 -> 24.7ms janky, 5000 -> ~80ms, which is
        # ~18 SECONDS of blocked main thread. This used to allow 5000.
        # ⚠️ THE CEILING IS ABOUT TWO THINGS, NOT ONE. It was first set from
        # timings alone, and timings alone said 2000 was fine while the
        # renderer was drawing every one of those 2000 notes onto the border of
        # the canvas. `tools/graph_layout_bench.mjs` now prints the shape of
        # the layout next to its cost; a future raise needs both to hold.
        # ⚠️ Raising it is a promise about the RENDERER, not about this query --
        # re-run the benchmark before you do, and read NoteGraphView's header.
        cap = max(1, min(limit, 2000))
        rows = conn.execute(
            "SELECT n.id, n.title, n.folder_id, n.updated_at,"
            "       (SELECT COUNT(*) FROM j2_note_links l"
            "          JOIN j2_notes m"
            "            ON m.user_id = l.user_id"
            "           AND m.id = CASE WHEN l.note_id = n.id"
            "                           THEN l.target_note_id ELSE l.note_id END"
            "          WHERE l.user_id = n.user_id"
            "            AND (l.note_id = n.id OR l.target_note_id = n.id)"
            "            AND m.deleted_at IS NULL AND m.archived_at IS NULL) AS degree"
            " FROM j2_notes n"
            " WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.archived_at IS NULL"
            " ORDER BY n.updated_at DESC"
            " LIMIT ?",
            (user_id, cap + 1),
        ).fetchall()
        # ⭐ cap + 1 so "there are more" is a MEASUREMENT, not an assumption that
        # hitting the cap exactly means truncation.
        out["truncated"] = len(rows) > cap
        rows = rows[:cap]
        out["nodes"] = [{
            "id": r["id"],
            "title": r["title"] or "Untitled",
            "folderId": r["folder_id"],
            "updatedAt": r["updated_at"],
            "degree": int(r["degree"] or 0),
        } for r in rows]

        ids = {r["id"] for r in rows}
        if not ids:
            return out
        # ⛔ DEDUPLICATED BY PAIR. A note linking to another five times is ONE
        # relationship with weight 5, not five overlapping lines — the same
        # ruling get_note_backlinks applies to its own rows (directive §64).
        edge_rows = conn.execute(
            "SELECT l.note_id AS s, l.target_note_id AS t, COUNT(*) AS w"
            " FROM j2_note_links l"
            " JOIN j2_notes a ON a.id = l.note_id        AND a.user_id = l.user_id"
            " JOIN j2_notes b ON b.id = l.target_note_id AND b.user_id = l.user_id"
            " WHERE l.user_id = ?"
            "   AND a.deleted_at IS NULL AND b.deleted_at IS NULL"
            " GROUP BY l.note_id, l.target_note_id",
            (user_id,),
        ).fetchall()
        out["edges"] = [
            {"source": e["s"], "target": e["t"], "weight": int(e["w"] or 0)}
            for e in edge_rows
            # ⛔ Both ends must be in the RETURNED node set. When the node list
            # is capped, an edge to a note that did not make the cut would be a
            # line to nothing — a renderer cannot draw it and should not have to
            # guess what it meant. ⭐ This is also the ONE place an archived
            # note leaves the edges (wave 6): it is not a node (the query above),
            # so no edge touches it -- a second archived_at test in the edge SQL
            # was a copy of this rule that no rail could tell apart from it.
            if e["s"] in ids and e["t"] in ids
        ]
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


def _member_mentioned_symbols(user_id: str, conn: sqlite3.Connection) -> list[str]:
    """The member's own bounded, DISTINCT mentioned-symbol vocabulary
    (widget embeds + cashtag mentions, trash excluded) — the shared query
    behind resolve_sector_theme_symbols and get_sector_theme_facets, pulled
    out so the two can never drift on what "mentioned" means. Same
    trash-exclusion join shape as get_symbol_backlinks — a symbol mentioned
    only in a trashed note must not widen the member's resolved vocabulary."""
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
    return [r["symbol"] for r in rows if r["symbol"]]


def bulk_member_mentioned_symbols(conn: sqlite3.Connection) -> dict[str, set[str]]:
    """The ALL-USERS shape of `_member_mentioned_symbols`, for a caller that
    needs every member's vocabulary in one pass rather than one query per
    member (the Awareness Engine's own `_bulk_load_user_contexts` — "no
    N+1 per-user" is that module's own stated design constraint, and
    calling the per-user query once per member would be exactly that).

    Same UNION shape as `_member_mentioned_symbols`, with the `user_id`
    predicate dropped and `user_id` added to the SELECT instead — kept as
    a near-literal twin (not a from-scratch rewrite) specifically so the
    two are easy to eyeball against each other; `test_bulk_member_mentioned_
    symbols_agrees_with_the_per_user_version` is the real guarantee they
    cannot drift on what "mentioned" means."""
    rows = conn.execute(
        "SELECT user_id, symbol FROM ("
        "  SELECT e.user_id AS user_id, e.symbol AS symbol FROM j2_note_embeds e"
        "  JOIN j2_notes n ON n.id = e.note_id AND n.user_id = e.user_id"
        "  WHERE n.deleted_at IS NULL"
        "  UNION"
        "  SELECT m.user_id AS user_id, m.symbol AS symbol FROM j2_note_mentions m"
        "  JOIN j2_notes n ON n.id = m.note_id AND n.user_id = m.user_id"
        "  WHERE n.deleted_at IS NULL"
        ")"
    ).fetchall()
    out: dict[str, set[str]] = {}
    for r in rows:
        if not r["symbol"]:
            continue
        out.setdefault(r["user_id"], set()).add(r["symbol"])
    return out


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
        symbols = _member_mentioned_symbols(user_id, conn)
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


def get_sector_theme_facets(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> dict[str, list[str]]:
    """Competitive-audit UX #9 (2026-09-22): the distinct sector/theme
    VALUES a member can actually filter by — i.e. exactly the labels
    `resolve_sector_theme_symbols` above would accept and get at least one
    match for. Backs the Notebook search panel's Sector/Theme filters,
    which shipped as free-text inputs against an EXACT (if
    case-insensitive) match with no way for a member to discover a valid
    value — almost every typed guess matched nothing, silently, and the
    filter read as broken rather than as "you have to know the exact
    string."

    ⛔ Deliberately NOT sourced from themes_taxonomy.json. That file lists
    every sector/theme in the firm's whole taxonomy; offering one this
    member has zero mentioned symbols in would be a dropdown option
    guaranteed to return no results — worse than the free-text box it
    replaces, which at least let a member who already knew the exact
    string get a real answer. This reuses the SAME bounded,
    member's-own-vocabulary scan as resolve_sector_theme_symbols (shared
    via `_member_mentioned_symbols` so the two can never disagree about
    what counts as a valid filter value), just inverted: instead of asking
    which symbols match a given sector/theme, it asks which sectors/themes
    this member's symbol set actually has."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        symbols = _member_mentioned_symbols(user_id, conn)
        if not symbols:
            return {"sectors": [], "themes": []}
        from api.services.ticker_meta import get_ticker_meta
        sectors: set[str] = set()
        themes: set[str] = set()
        for sym in symbols:
            try:
                meta = get_ticker_meta(sym)
            except Exception:
                continue
            sec = (meta.get("sector") or "").strip()
            if sec:
                sectors.add(sec)
            th = (meta.get("theme") or "").strip()
            if th:
                themes.add(th)
        return {"sectors": sorted(sectors), "themes": sorted(themes)}
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
    *,
    daily_date: str | None = None,
    properties: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """`daily_date` and `properties` are INTERNAL (never read from `payload`,
    so `POST /notes` cannot set them): the daily note is made in ONE insert,
    with its day and its template's property values, so there is no second
    write — no revision a caller would have to land. A second note for a day
    is refused by the database (`idx_j2_notes_daily`), as `sqlite3.IntegrityError`."""
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
        properties_json = None
        if properties:
            from api.services.journal_two.note_properties import (
                set_note_properties, PropertyValidationError,
            )
            try:
                properties_json = set_note_properties(user_id, new_id, properties, conn, replace=True)
            except PropertyValidationError as e:
                raise NoteValidationError(str(e)) from e
        conn.execute(
            """
            INSERT INTO j2_notes (
                id, user_id, account_id, folder_id, title, subtitle,
                body_json, body_plain, hero_image_url, first_image_url, ticker, tags,
                created_at, updated_at, daily_date, properties_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id, user_id, account_id, folder_id, title, subtitle,
                json.dumps(body_json), body_plain, hero, first_image, ticker,
                json.dumps(tags), now, now, daily_date, properties_json,
            ),
        )
        _sync_note_sidecars(conn, user_id, new_id, body_json, body_plain)
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


def _versioned_content_of(row_like: Any) -> tuple[str, str | None, str, str | None]:
    """The exact fields Wave C (+ Wave E's property extension) versions -- a
    sqlite3.Row (from j2_notes, keyed by column name) or a dict (from a
    j2_note_versions row) both work via [] access. `properties_json` compares
    as the RAW stored string (never re-serialized/normalized here) -- same
    raw-string-equality treatment as body_plain; a byte-identical resave
    never spuriously versions, and key-order drift across two logically-equal
    property sets costs at most one extra (harmless) checkpoint, never a
    missed one."""
    return (
        row_like["title"] or "", row_like["subtitle"], row_like["body_plain"] or "",
        row_like["properties_json"] if "properties_json" in _row_keys(row_like) else None,
    )


def _row_keys(row_like: Any) -> Any:
    """`.keys()` works on both sqlite3.Row and dict; a plain dict without the
    key must never KeyError here (only sqlite3.Row raises on a missing
    column, and even that shouldn't happen post-migration -- this is belt
    and suspenders for a version row fetched with an explicit column list
    that omitted properties_json)."""
    try:
        return row_like.keys()
    except AttributeError:
        return []


def _maybe_capture_version(
    conn: sqlite3.Connection,
    note_id: str,
    user_id: str,
    existing: sqlite3.Row,
    force: bool = False,
    restored_from_version_id: str | None = None,
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

    `restored_from_version_id` (Wave G checkpoint §24, passed only by
    restore_note_version via update_note) is stamped onto the row THIS call
    captures -- i.e. the pre-restore state being preserved -- recording which
    version the note was restored TO. It marks this checkpoint as the direct
    result of a restore so the Wave G changelog can render "Restored from
    version X" as a distinct, auditable event instead of an ordinary edit.
    """
    try:
        latest = conn.execute(
            "SELECT title, subtitle, body_plain, properties_json, created_at FROM j2_note_versions"
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
            " body_json, body_plain, properties_json, created_at, restored_from_version_id)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                uuid.uuid4().hex, user_id, note_id,
                old_content[0], old_content[1],
                existing["body_json"], old_content[2], old_content[3],
                existing["updated_at"], restored_from_version_id,
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
            # Wave E: parsed (matching every other JSON field's convention);
            # None for both "no properties at that checkpoint" and "captured
            # before this column existed" -- both read identically as
            # "nothing to restore," which is correct for either case.
            "propertiesJson": json.loads(row["properties_json"]) if row["properties_json"] else None,
            "restoredFromVersionId": row["restored_from_version_id"] if "restored_from_version_id" in _row_keys(row) else None,
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
            {
                "title": version["title"], "subtitle": version["subtitle"], "bodyJson": version["bodyJson"],
                # Wave E checkpoint §26: properties are versioned too, restored
                # via the REPLACE form (never merge -- see set_note_properties'
                # own docstring for why restore must fully replace, not stack).
                # A version captured before this column existed has
                # propertiesJson=None, which correctly restores to "no
                # properties" (that note genuinely had none at that point).
                "propertiesReplace": version["propertiesJson"] or {},
            },
            conn=conn, expected_updated_at=expected_updated_at, force_version=True,
            restored_from_version_id=version_id,
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
    restored_from_version_id: str | None = None,
    client_schema: int | None = None,
) -> dict[str, Any] | None:
    """`client_schema` is the schema the CLIENT that sent this patch can read
    (`notebook_schema.declared_schema` of its `X-UCT-Notebook-Schema` header —
    0 when absent). A body write from a client older than the STORED body is
    refused with `NotebookSchemaTooOld` before anything else is checked: that
    client may be holding the note as an EMPTY document it could not parse
    (H14). None = not a client's body (a version restore, a server append).
    ⛔ Never reverted with the features: see notebook_schema.py.

    `expected_updated_at` (optional) makes the write a compare-and-set:
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
        if "bodyJson" in patch:
            check_body_write(existing["body_json"], client_schema)
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
        if "locked" in patch:
            # Wave 6 lock. ⛔ Written ONLY through `PATCH /notes/{id}/lock` (the
            # PUT strips the key): one door for the value, so a stale PUT the
            # outbox replays can never unlock a note behind the member's back.
            # Only a change is a write — re-locking a locked note moves no
            # revision. ⛔ And NOTHING here refuses a body write to a locked
            # note: see the column in db.py.
            want = patch["locked"]
            if not isinstance(want, bool):
                raise NoteValidationError("locked must be true or false")
            if bool(existing["locked"]) != want:
                sets.append("locked = ?"); params.append(1 if want else 0)
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
        if "properties" in patch or "propertiesReplace" in patch:
            # Wave E: "properties" is {property_id: value | null}, MERGED
            # into the note's current values (the normal editor-save path --
            # setting one property never clobbers another this client didn't
            # know about). "propertiesReplace" (Wave C restore ONLY) is the
            # same shape but starts from empty, so restoring to an old
            # snapshot clears anything set after that snapshot rather than
            # stacking on top of it. A patch may use only one of the two.
            from api.services.journal_two.note_properties import (
                set_note_properties, PropertyValidationError,
            )
            replace = "propertiesReplace" in patch
            raw = patch["propertiesReplace"] if replace else patch["properties"]
            if not isinstance(raw, dict):
                raise NoteValidationError("properties must be an object")
            try:
                new_properties_json = set_note_properties(user_id, note_id, raw, conn, replace=replace)
            except PropertyValidationError as e:
                raise NoteValidationError(str(e)) from e
            sets.append("properties_json = ?"); params.append(new_properties_json)

        if not sets:
            return _row_to_note(existing)

        # Wave C: capture a version checkpoint of the OLD content BEFORE
        # applying this edit -- gated on the ACTUAL new values (not merely
        # "did the patch mention a versioned key"), so a save that re-sends
        # an unchanged title/subtitle/body (e.g. a client re-PUTting the same
        # content) never creates a spurious version. `_maybe_capture_version`
        # itself further gates on the coalescing window. Wave E extends this
        # to properties_json (checkpoint §26) on the identical principle.
        new_title = t if "title" in patch else (existing["title"] or "")
        new_subtitle = s if "subtitle" in patch else existing["subtitle"]
        new_body_plain = bp if "bodyJson" in patch else (existing["body_plain"] or "")
        new_properties_for_compare = (
            new_properties_json if ("properties" in patch or "propertiesReplace" in patch)
            else (existing["properties_json"] if "properties_json" in _row_keys(existing) else None)
        )
        if (new_title, new_subtitle, new_body_plain, new_properties_for_compare) != _versioned_content_of(existing):
            _maybe_capture_version(
                conn, note_id, user_id, existing, force=force_version,
                restored_from_version_id=restored_from_version_id,
            )

        sets.append("updated_at = ?"); params.append(_now_iso())
        params.extend([note_id, user_id])
        conn.execute(
            f"UPDATE j2_notes SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
            params,
        )
        if "bodyJson" in patch:
            _sync_note_sidecars(conn, user_id, note_id, bj, bp)
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
        _sync_note_sidecars(conn, user_id, note_id, body_json, body_plain)
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


def append_financial_fact(
    user_id: str,
    note_id: str,
    fact_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Wave F — the server half of a "Save price to Notebook" capture from a
    surface OUTSIDE the note editor (e.g. TickerPopup): append one
    financialFact node referencing an already-created fact observation to a
    note's body. Mirrors append_widget_embed exactly (atomic load/append/save
    in one transaction, same sidecar syncs, same trash guard). The fact row
    itself must already exist (created via note_facts.create_fact_observation
    against this SAME note_id) -- this function only places the NODE; it
    never creates or validates the fact's value."""
    if not fact_id:
        raise NoteValidationError("factId required")
    owned = conn is None
    conn = conn or get_connection()
    try:
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
        content.append({"type": "financialFact", "attrs": {"factId": fact_id}})
        doc["content"] = content
        body_json = _validate_body_json(doc)
        body_plain = extract_plain_text(body_json)
        conn.execute(
            "UPDATE j2_notes SET body_json = ?, body_plain = ?, updated_at = ?"
            " WHERE id = ? AND user_id = ?",
            (json.dumps(body_json), body_plain, _now_iso(), note_id, user_id),
        )
        _sync_note_sidecars(conn, user_id, note_id, body_json, body_plain)
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


def append_document_excerpt(
    user_id: str,
    note_id: str,
    excerpt_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Wave J — the server half of "Save excerpt" when the destination note
    is NOT the one currently open in an editor (the PDF viewer is reached
    from the Ticker Research Workspace's Documents section just as often as
    from an open note, per the entry checkpoint's own fast-path decisions —
    that surface has no live editor instance to insert a node into client-
    side). Mirrors `append_financial_fact` exactly (atomic load/append/save,
    same sidecar syncs, same trash guard). The excerpt row itself must
    already exist (created via note_excerpts.create_excerpt against this
    SAME note_id) -- this function only places the NODE."""
    if not excerpt_id:
        raise NoteValidationError("excerptId required")
    owned = conn is None
    conn = conn or get_connection()
    try:
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
        content.append({"type": "documentExcerpt", "attrs": {"excerptId": excerpt_id}})
        doc["content"] = content
        body_json = _validate_body_json(doc)
        body_plain = extract_plain_text(body_json)
        conn.execute(
            "UPDATE j2_notes SET body_json = ?, body_plain = ?, updated_at = ?"
            " WHERE id = ? AND user_id = ?",
            (json.dumps(body_json), body_plain, _now_iso(), note_id, user_id),
        )
        _sync_note_sidecars(conn, user_id, note_id, body_json, body_plain)
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
    # Same degrade-not-fail philosophy as _sync_note_sidecars' widgetEmbed
    # branch: a capture must never be blocked by an unrecognized
    # tradeRefType — it's dropped to NULL (untyped) rather than rejecting
    # the whole capture.
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


def set_note_archived(
    user_id: str,
    note_id: str,
    archived: bool,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Wave 6 (lane E, item 1): archive or unarchive one note. Returns the note
    (the `get_note` shape, with `archivedAt`), or None when there is no such
    note of this member's in the library — a trashed note is not archivable
    (restore it first), the same 404 an edit of it gets.

    ⛔ ARCHIVE IS NOT TRASH. Nothing is deleted, the note keeps its folder, its
    tags and its properties, and it still opens; it only leaves the default
    surfaces (`_notes_filter_sql` owns that rule). Unarchive therefore restores
    it EXACTLY where it was.

    ⛔⛔ AND IT NEVER ADVANCES `updated_at`. Archive is a visibility flag, like a
    favourite, not an edit of the note: moving the revision would turn the next
    save of an editor that has this note open — in this tab or another — into a
    409 against a write nobody in that editor made, and the offline layer forks
    a note on exactly that. Keeping the revision also keeps "exactly where it
    was" true of the list's recently-updated order. (Contrast the LOCK, which
    DOES advance it: a lock must reach another tab's editor, and a newer
    revision is how it gets there.) Idempotent: archiving an archived note keeps
    its first archive time."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        stamp = _now_iso() if archived else None
        # Only a live note, and only when the flag actually changes.
        cur = conn.execute(
            "UPDATE j2_notes SET archived_at = ?"
            " WHERE id = ? AND user_id = ? AND deleted_at IS NULL"
            " AND (archived_at IS NULL) = ?",
            (stamp, note_id, user_id, 1 if archived else 0),
        )
        conn.commit()
        if cur.rowcount:
            _log_notebook_event(
                user_id, "notebook_note_archived" if archived else "notebook_note_unarchived")
        return get_note(user_id, note_id, conn=conn)
    finally:
        if owned:
            conn.close()


def find_daily_note_id(user_id: str, daily_date: str, conn: sqlite3.Connection) -> str | None:
    """The member's LIVE note for this day (archived counts: it still opens)."""
    row = conn.execute(
        "SELECT id FROM j2_notes WHERE user_id = ? AND daily_date = ? AND deleted_at IS NULL",
        (user_id, daily_date),
    ).fetchone()
    return row["id"] if row else None


def release_trashed_daily_date(user_id: str, daily_date: str, conn: sqlite3.Connection) -> None:
    """A TRASHED note that was this day's daily note gives the day up, so a new
    one can be made — and restoring the old one later brings back an ordinary
    note, never a second note for the day. A bookkeeping column on a trashed
    row, so the revision (and so the offline layer) is untouched. No commit:
    the caller's transaction owns it."""
    conn.execute(
        "UPDATE j2_notes SET daily_date = NULL"
        " WHERE user_id = ? AND daily_date = ? AND deleted_at IS NOT NULL",
        (user_id, daily_date),
    )


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
        try:
            # Wave E: rides the SAME nightly sweep -- two small tables, no
            # reason for a second scheduler registration. Independent
            # try/except so a failure here can never suppress the note-trash
            # sweep above (or vice versa).
            from api.services.journal_two.note_properties import purge_expired_property_defs_and_saved_views
            defs_n, views_n = purge_expired_property_defs_and_saved_views()
            print(f"[j2-trash-purge] property_defs_purged={defs_n} saved_views_purged={views_n}")
        except Exception as e:  # noqa: BLE001
            print(f"[j2-trash-purge] property/saved-view sweep failed: {e}")

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
            "WHERE f.user_id = ? AND n.deleted_at IS NULL AND n.archived_at IS NULL "
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
            "WHERE r.user_id = ? AND n.deleted_at IS NULL AND n.archived_at IS NULL "
            "ORDER BY r.opened_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [_row_to_note_summary(r) for r in rows]
    finally:
        if owned:
            conn.close()


# ── Quick switcher (title search over the WHOLE library) ─────────────────────
#
# The Ctrl/Cmd+K palette used to reach only favourites and recents. This is the
# lean read it needs to jump to ANY note by title as the member types.
#
# ⛔ NOT `list_notes(q=...)`. That is the FTS search over title AND body, ranked
# by bm25, returning a 400-char body preview per row and logging a
# `notebook_search_used` event per call. A switcher asks a different question
# ("which note is CALLED this?"), is fired on every debounced keystroke of an
# app-wide palette, and must rank a title that STARTS with the query above one
# that merely mentions it in paragraph nine.
#
# ⛔ EVERY LIVE TITLE IS RANKED — never a capped sample — for the tiers that
# ask "is the typed text IN the title" (0-5). A one-letter query can match most
# of a 50k-note library; ranking "the newest 2,000 matches" would silently lose
# an EXACT title on an older note. What makes that affordable on every
# keystroke is the covering index `idx_j2_notes_switcher` (db.py): one
# member's titles read from the index alone, newest edit first — measured on
# 50,000 notes, ~30 ms where the same read off the table took ~150 ms — and
# ranked HERE, in Python, which also folds case the way a member reads it
# ("Élan" is found by "élan"; SQLite's lower() folds ASCII only — review N2).
#
# The two FUZZY tiers (6, 7) are the one bounded exception, and they say so:
# they read only the member's SWITCHER_FUZZY_SCOPE most recently edited notes
# (plus every recent and favourite), because letters-in-order and one-typo
# tests cost far more per title than a substring test — and they run only when
# the tiers above left room on the page.
#
# ⛔ Substring tests, never LIKE, for the member's text: `%` and `_` are text.
SWITCHER_DEFAULT_LIMIT = 8
SWITCHER_MAX_LIMIT = 50
_SWITCHER_MAX_QUERY_CHARS = 120
_SWITCHER_MAX_TOKENS = 6
# A title "word" can begin after a space or after one of these. Replaced by a
# space in BOTH the title and the query before the word-start test, so
# "NVDA-Q3 plan" word-starts "q3" and "$NVDA thesis" word-starts "nvda".
_SWITCHER_WORD_BREAKS = ("-", "_", "/", "(", "[", "$", ":", ".", ",", "#", "|")
_SWITCHER_BREAK_TABLE = str.maketrans({ch: " " for ch in _SWITCHER_WORD_BREAKS})

# Tier numbers — lower ranks first.
SWITCHER_TIER_EXACT = 0
SWITCHER_TIER_PREFIX = 1
SWITCHER_TIER_WORD_START = 2
SWITCHER_TIER_ALL_WORDS_START = 3
SWITCHER_TIER_SUBSTRING = 4
SWITCHER_TIER_ALL_WORDS = 5
SWITCHER_TIER_FUZZY = 6   # the letters in order, the first starting a word ("nvth")
SWITCHER_TIER_TYPO = 7    # every word present, or one slip from a title word's start
# A row at or above this tier is a title that IS, STARTS WITH, or has a WORD
# STARTING WITH the query — `strong: true` in the response. The palette lets a
# strong note outrank ticker rows and a weak one never. It reads the FLAG, never
# a tier number, so renumbering the tiers cannot silently re-place rows among
# tickers (review S3: the client used to restate this as a constant).
SWITCHER_STRONG_TIER_MAX = SWITCHER_TIER_WORD_START
SWITCHER_FUZZY_MIN_CHARS = 3     # fewer letters in order is noise, not a match
SWITCHER_TYPO_MIN_LETTERS = 4    # a slip is only forgiven in a word this long
SWITCHER_FUZZY_SCOPE = 5000      # most recently edited notes the fuzzy tiers read


# The three reads a keystroke costs. Module constants so a rail can ask
# SQLite how it will run THESE statements (test_journal_two_notes_switcher_
# router.py): the scan must be served by the covering index alone, and the
# recents/favourites reads must start from the member's own (small) lists.
_SWITCHER_SCAN_SQL = (
    "SELECT rowid, title FROM j2_notes"
    " WHERE user_id = ? AND deleted_at IS NULL AND archived_at IS NULL"
    " ORDER BY updated_at DESC, title ASC, rowid ASC"
)
# CROSS JOIN pins the recents/favourites table as the OUTER loop — left to
# itself the planner chose to walk all 50k notes and probe each one (~115 ms).
_SWITCHER_RECENTS_SQL = (
    "SELECT n.rowid, r.opened_at FROM j2_note_recents r"
    " CROSS JOIN j2_notes n ON n.id = r.note_id AND n.user_id = r.user_id"
    " WHERE r.user_id = ? AND n.deleted_at IS NULL AND n.archived_at IS NULL"
)
_SWITCHER_FAVORITES_SQL = (
    "SELECT n.rowid FROM j2_note_favorites f"
    " CROSS JOIN j2_notes n ON n.id = f.note_id AND n.user_id = f.user_id"
    " WHERE f.user_id = ? AND n.deleted_at IS NULL AND n.archived_at IS NULL"
)


def _switcher_word_text(text: str) -> str:
    return " ".join(text.translate(_SWITCHER_BREAK_TABLE).split())


def _typo_eligible(word: str) -> bool:
    """A word earns typo tolerance at SWITCHER_TYPO_MIN_LETTERS letters. Digits
    never count: "4999" one digit off is a different number, not a slip."""
    return sum(ch.isalpha() for ch in word) >= SWITCHER_TYPO_MIN_LETTERS


def _one_edit_apart(a: str, b: str) -> bool:
    """At most ONE insertion, deletion, substitution or adjacent swap turns
    `a` into `b`. Linear time — never a general edit-distance table."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    i = 0
    m = min(la, lb)
    while i < m and a[i] == b[i]:
        i += 1
    if la == lb:
        if a[i + 1:] == b[i + 1:]:
            return True
        return (i + 1 < la and a[i] == b[i + 1] and a[i + 1] == b[i]
                and a[i + 2:] == b[i + 2:])
    if la > lb:
        return a[i + 1:] == b[i:]
    return a[i:] == b[i + 1:]


def _typo_starts_word(token: str, word: str) -> bool:
    """`token` is one slip away from how `word` STARTS — so a half-typed word
    with a typo still finds it ("earbin" -> "earnings")."""
    n = len(token)
    return any(0 < k <= len(word) and _one_edit_apart(token, word[:k])
               for k in (n, n - 1, n + 1))


def _in_order_from_word_start(word_title: str, letters: str) -> bool:
    """The letters appear in order in the title, the first one starting a word.
    Greedy from the EARLIEST word-start hit, which is optimal for an in-order
    test — and linear, never a backtracking regex a hostile title could stall."""
    at = word_title.find(" " + letters[0])
    if at < 0:
        return False
    pos = at + 2
    for ch in letters[1:]:
        pos = word_title.find(ch, pos)
        if pos < 0:
            return False
        pos += 1
    return True


def _folder_paths(conn: sqlite3.Connection, user_id: str) -> dict[str, str]:
    """folder_id -> "Parent / Child" for every folder the member owns. One
    query; a cycle or a dangling parent stops the walk rather than looping."""
    rows = conn.execute(
        "SELECT id, name, parent_id FROM j2_note_folders WHERE user_id = ?",
        (user_id,),
    ).fetchall()
    by_id = {r["id"]: (r["name"] or "", r["parent_id"]) for r in rows}
    out: dict[str, str] = {}
    for fid in by_id:
        parts: list[str] = []
        cur, seen = fid, set()
        while cur and cur in by_id and cur not in seen and len(parts) <= MAX_FOLDER_DEPTH:
            seen.add(cur)
            name, parent = by_id[cur]
            parts.append(name)
            cur = parent
        out[fid] = " / ".join(reversed(parts))
    return out


def switcher_search(
    user_id: str,
    q: str,
    limit: int = SWITCHER_DEFAULT_LIMIT,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Notes whose TITLE matches `q`, best first. Returns
    `{"notes": [...], "hasMore": bool, "prefixExhausted": bool}`; a blank query
    is an empty answer, never an error.

    Ranking, in order (`matchTier`, lower first):
      0 exact title · 1 title starts with the query · 2 a title word starts
      with the query · 3 (several words typed) every word starts a title word
      · 4 the query appears anywhere · 5 every typed word appears somewhere
      · 6 the letters appear in order, the first starting a word ("nvth" finds
      "NVDA thesis") · 7 every word is present, or one slip from the start of
      a title word, for words of 4+ letters ("semsi" finds "Semis").
    Inside a tier: the note opened most recently first (the recents boost),
    then favourites, then the most recently edited — so among equally good
    matches the one the member is working in wins. Equal on all three: title,
    then the order the notes were created.

    Each row says `strong` (tier ≤ SWITCHER_STRONG_TIER_MAX) and `exact`
    (tier 0) so the palette places it without knowing the tier numbers.

    `prefixExhausted`: no note matches this query, AND none can match any
    longer query that starts with it — so the palette may skip asking while
    the member keeps typing. Only claimed when that is sound: every test above
    only gets stricter as letters are appended, except that a word reaching
    SWITCHER_TYPO_MIN_LETTERS starts forgiving a slip and a query reaching
    SWITCHER_FUZZY_MIN_CHARS starts the in-order tier — so both must already
    apply to the word being typed.

    Scoped like every other read here: `user_id` in SQL, active notes only
    (a trashed note cannot be opened, so offering it would be a dead row)."""
    text = " ".join(str(q or "").lower().split())[:_SWITCHER_MAX_QUERY_CHARS]
    if not text:
        return {"notes": [], "hasMore": False, "prefixExhausted": False}
    limit = max(1, min(int(limit or SWITCHER_DEFAULT_LIMIT), SWITCHER_MAX_LIMIT))
    tokens = text.split()[:_SWITCHER_MAX_TOKENS]
    word_query = _switcher_word_text(text)
    word_tokens = [t for t in (_switcher_word_text(tok) for tok in tokens) if t]
    words = word_query.split()          # every typed word, breaks split out
    letters = "".join(words)
    run_fuzzy = len(letters) >= SWITCHER_FUZZY_MIN_CHARS
    single = tokens[0] if len(tokens) == 1 else None

    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.cursor()
        cur.row_factory = None           # plain tuples: 50k Row objects cost real time
        # Served from idx_j2_notes_switcher alone (a rail pins the plan).
        live = cur.execute(_SWITCHER_SCAN_SQL, (user_id,)).fetchall()
        recent_at = dict(cur.execute(_SWITCHER_RECENTS_SQL, (user_id,)).fetchall())
        favs = {rid for (rid,) in cur.execute(_SWITCHER_FAVORITES_SQL, (user_id,)).fetchall()}

        tiers: list[list[int]] = [[] for _ in range(SWITCHER_TIER_TYPO + 1)]
        # Recents and favourites lead their tier, so they are noted as they are
        # placed; everything else is read lazily, in newest-edit order, only as
        # far as the page needs.
        specials = set(recent_at) | favs
        special_in: dict[int, list[int]] = {}
        special_pos: set[int] = set()

        def _place(pos: int, rid: int, tier: int) -> None:
            tiers[tier].append(pos)
            if rid in specials:
                special_in.setdefault(tier, []).append(pos)
                special_pos.add(pos)

        misses: list[tuple[int, str]] = []   # (position, lowered title) no exact tier matched
        needle = " " + word_query
        for pos, (rid, title) in enumerate(live):
            t = (title or "").lower()
            if single is not None:
                hit = single in t
            else:
                hit = all(tok in t for tok in tokens)
            if not hit:
                misses.append((pos, t))
                continue
            if t == text:
                tier = SWITCHER_TIER_EXACT
            elif t.startswith(text):
                tier = SWITCHER_TIER_PREFIX
            elif word_query and needle in " " + t:
                # A word starts with it before any break is even replaced —
                # the common case, found without building the word text.
                tier = SWITCHER_TIER_WORD_START
            else:
                wt = " " + t.translate(_SWITCHER_BREAK_TABLE)
                if word_query and needle in wt:
                    tier = SWITCHER_TIER_WORD_START
                elif len(word_tokens) > 1 and all((" " + w) in wt for w in word_tokens):
                    tier = SWITCHER_TIER_ALL_WORDS_START
                elif text in t:
                    tier = SWITCHER_TIER_SUBSTRING
                else:
                    tier = SWITCHER_TIER_ALL_WORDS
            _place(pos, rid, tier)

        def _ranked(tier: int):
            """One tier in display order: recents (last opened first), then
            favourites, then everything else — each in newest-edit order."""
            sp = special_in.get(tier, [])
            rec = [p for p in sp if live[p][0] in recent_at]
            fav = [p for p in sp if live[p][0] not in recent_at]
            rec.sort(key=lambda p: (live[p][0] not in favs, p))
            rec.sort(key=lambda p: recent_at[live[p][0]], reverse=True)
            yield from rec
            yield from fav
            for p in tiers[tier]:
                if p not in special_pos:
                    yield p

        picked: list[tuple[int, int]] = []

        def _take(tier: int) -> bool:
            for p in _ranked(tier):
                picked.append((p, tier))
                if len(picked) > limit:
                    return True
            return False

        full = False
        for tier in range(SWITCHER_TIER_ALL_WORDS + 1):
            if _take(tier):
                full = True
                break

        if not full and words and misses:
            # ── the bounded fuzzy tiers ──
            scope = [(p, t) for p, t in misses
                     if p < SWITCHER_FUZZY_SCOPE or live[p][0] in recent_at or live[p][0] in favs]
            typo_words = [w for w in words if _typo_eligible(w)]
            slip_memo: dict[tuple[str, str], bool] = {}
            for p, t in scope:
                wt = " " + t.translate(_SWITCHER_BREAK_TABLE)
                if run_fuzzy and _in_order_from_word_start(wt, letters):
                    _place(p, live[p][0], SWITCHER_TIER_FUZZY)
                    continue
                title_words = None
                ok = True
                for w in words:
                    if w in t:
                        continue
                    if w not in typo_words:
                        ok = False
                        break
                    if title_words is None:
                        title_words = wt.split()
                    found = False
                    for tw in title_words:
                        key = (w, tw)
                        hit = slip_memo.get(key)
                        if hit is None:
                            hit = slip_memo[key] = _typo_starts_word(w, tw)
                        if hit:
                            found = True
                            break
                    if not found:
                        ok = False
                        break
                if ok:
                    _place(p, live[p][0], SWITCHER_TIER_TYPO)
            for tier in (SWITCHER_TIER_FUZZY, SWITCHER_TIER_TYPO):
                if _take(tier):
                    break

        has_more = len(picked) > limit
        picked = picked[:limit]
        prefix_exhausted = (not picked and run_fuzzy and bool(words)
                            and _typo_eligible(words[-1]))
        if not picked:
            return {"notes": [], "hasMore": False, "prefixExhausted": prefix_exhausted}

        rowids = [live[p][0] for p, _tier in picked]
        placeholders = ",".join("?" * len(rowids))
        detail = {r["rowid"]: r for r in conn.execute(
            "SELECT rowid, id, title, folder_id, ticker, updated_at FROM j2_notes"
            f" WHERE rowid IN ({placeholders}) AND user_id = ?",
            [*rowids, user_id],
        ).fetchall()}
        paths = (_folder_paths(conn, user_id)
                 if any(r["folder_id"] for r in detail.values()) else {})
        notes = []
        for p, tier in picked:
            rid = live[p][0]
            r = detail.get(rid)
            if r is None:                # deleted between the two reads
                continue
            notes.append({
                "id": r["id"],
                "title": r["title"] or "",
                "folderId": r["folder_id"],
                "folderPath": paths.get(r["folder_id"]) if r["folder_id"] else None,
                "ticker": r["ticker"],
                "updatedAt": r["updated_at"],
                "isRecent": rid in recent_at,
                "isFavorite": rid in favs,
                "matchTier": tier,
                "strong": tier <= SWITCHER_STRONG_TIER_MAX,
                "exact": tier == SWITCHER_TIER_EXACT,
            })
        return {"notes": notes, "hasMore": has_more, "prefixExhausted": False}
    finally:
        if owned:
            conn.close()


# ── Bulk operations: the reads a batch needs before it writes ────────────────
#
# ⛔ READS ONLY. The batch route (`POST /notes/batch`, journal_two.py) performs
# every write through the ordinary single-note doors — `update_note`,
# `delete_note`, `restore_note`, `add_favorite`, `remove_favorite` — so each
# write keeps that door's validation, versioning and sidecar sync, and the
# door-enumeration rail (lib/offline/doorEnumeration.test.js) derives the
# batch route as a door from the call it can see in the router. A bulk UPDATE
# here would be an eighth advancing function that rail does not know about.

_BATCH_READ_CHUNK = 400  # stays well under SQLite's bound-parameter limit


def tag_member_notes(
    user_id: str,
    tag: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Wave 6 (lane E, item 8) — the notes a rename of `tag` touches:
    `[{id, title}]` of this member's notes carrying the tag or a tag below it,
    most recently updated first. ⛔ LIVE notes, ARCHIVED ones included — an
    archive is a shelf, and unarchiving a note must not bring the old name
    back — and never a trashed one (the batch refuses to write those anyway).
    The tag match is the list filter's own clause (`_tag_clause`)."""
    key = tag_key(tag)
    if not key:
        return []
    owned = conn is None
    conn = conn or get_connection()
    try:
        register_note_sql_functions(conn)
        tag_sql, tag_params = _tag_clause(user_id, key)
        rows = conn.execute(
            "SELECT id, title FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
            f" AND {tag_sql} ORDER BY updated_at DESC",
            [user_id, *tag_params],
        ).fetchall()
        return [{"id": r["id"], "title": r["title"] or ""} for r in rows]
    finally:
        if owned:
            conn.close()


def parse_tag_patch(payload: Any) -> tuple[list[str], list[str]]:
    """Wave 6 (controller-added, lane D's M14) — validates a `PATCH
    /notes/{id}/tags` body `{add, remove}` BEFORE the note is even read: each
    half accepts the same shape `_validate_tags` already enforces for a
    note's own tag list (a list of strings, each under the length cap), and
    the two halves must ask for genuinely different tags — asking to add and
    remove the same identity in one request is refused rather than resolved
    by silently picking a winner. -> (add, remove), both validated and
    normalised. Raises NoteValidationError; a request this refuses writes
    nothing."""
    if not isinstance(payload, dict):
        raise NoteValidationError("body must be an object")
    add = _validate_tags(payload.get("add") or [])
    remove = _validate_tags(payload.get("remove") or [])
    if not add and not remove:
        raise NoteValidationError("add or remove is required")
    if {tag_key(t) for t in add} & {tag_key(t) for t in remove}:
        raise NoteValidationError("a tag cannot be both added and removed")
    return add, remove


def patch_note_tags(
    user_id: str,
    note_id: str,
    add: list[str],
    remove: list[str],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Wave 6 (controller-added, lane D's M14) — `PATCH /notes/{id}/tags`:
    applies a tag DELTA to the note's STORED list, read and written inside
    ONE transaction so a second device's own concurrent tag write cannot
    land between this request's read and its write and be silently
    overwritten by a list computed before it existed (the two-device case).
    `BEGIN IMMEDIATE` takes the write lock before the read, not after — a
    plain SELECT takes no lock at all, so a lock taken only at the later
    UPDATE would still let a racing writer's commit land in between.

    Answers with the note at its NEW revision (`update_note`'s own shape,
    same serializer the lock endpoint uses) so the client can settle it; a
    change that changes nothing moves no revision. None for a trashed note,
    another member's, or none at all."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
            (note_id, user_id),
        ).fetchone()
        if row is None:
            conn.rollback()
            return None
        existing_tags = json.loads(row["tags"] or "[]")
        patched = patched_tag_list(existing_tags, add, remove)
        if patched is None:
            conn.rollback()
            return _row_to_note(row)
        return update_note(user_id, note_id, {"tags": patched}, conn=conn)
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


def note_batch_heads(
    user_id: str,
    note_ids: list[str],
    conn: sqlite3.Connection | None = None,
) -> dict[str, dict[str, Any]]:
    """`note_id -> {folderId, tags, updatedAt, deleted, archived}` for the ids this
    member OWNS, active or trashed. An id that is not theirs (or does not
    exist) is simply absent — the caller reports it as not found, which is
    also what it must say about another member's note (never "forbidden":
    that would confirm the id exists)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        out: dict[str, dict[str, Any]] = {}
        ids = list(dict.fromkeys(i for i in note_ids if isinstance(i, str) and i))
        for start in range(0, len(ids), _BATCH_READ_CHUNK):
            chunk = ids[start:start + _BATCH_READ_CHUNK]
            placeholders = ",".join("?" * len(chunk))
            rows = conn.execute(
                "SELECT id, folder_id, tags, updated_at, deleted_at, archived_at FROM j2_notes"
                f" WHERE user_id = ? AND id IN ({placeholders})",
                [user_id, *chunk],
            ).fetchall()
            for r in rows:
                out[r["id"]] = {
                    "folderId": r["folder_id"] or None,
                    "tags": json.loads(r["tags"] or "[]"),
                    "updatedAt": r["updated_at"],
                    "deleted": r["deleted_at"] is not None,
                    "archived": r["archived_at"] is not None,
                }
        return out
    finally:
        if owned:
            conn.close()


def favorite_note_ids(
    user_id: str,
    note_ids: list[str],
    conn: sqlite3.Connection | None = None,
) -> set[str]:
    """Which of `note_ids` this member has favourited — so a bulk favourite
    can say "already a favourite" instead of reporting a write that changed
    nothing."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        out: set[str] = set()
        ids = list(dict.fromkeys(i for i in note_ids if isinstance(i, str) and i))
        for start in range(0, len(ids), _BATCH_READ_CHUNK):
            chunk = ids[start:start + _BATCH_READ_CHUNK]
            placeholders = ",".join("?" * len(chunk))
            rows = conn.execute(
                "SELECT note_id FROM j2_note_favorites"
                f" WHERE user_id = ? AND note_id IN ({placeholders})",
                [user_id, *chunk],
            ).fetchall()
            out.update(r["note_id"] for r in rows)
        return out
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
    moved_out: list | None = None,
) -> bool:
    """Delete folder; re-parents children and notes to the deleted folder's parent.
    Root deletion (parent_id='') sends notes to Unfiled (NULL).

    `moved_out`, when given, is filled with `[{noteId, updatedAt}]` for every note
    the cascade re-parented — the revisions this call created.

    ⛔ AN OUT-PARAM, NOT A RETURN-SHAPE CHANGE AND NOT MODULE STATE. Six callers
    read the bool; widening the return would touch all of them for one caller's
    benefit, and a module-level dict would be shared across requests on a pod
    that serves every member from one process. This mirrors `compute_metrics`'s
    `members` out-dict, which exists for exactly this reason.
    """
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
        # Wave Q1 (2026-09-12): READ THE AFFECTED IDS BEFORE THE UPDATE.
        #
        # ⛔⛔ THIS CASCADE IS A DOOR, AND IT WAS A SILENT ONE. The bulk UPDATE
        # below advances `updated_at` on every note in the folder, so a member
        # with unsent offline work in ANY of them met a revision their browser
        # had never heard of, concluded somebody else wrote it, and got a
        # `(conflicted copy)` of their own note for deleting a folder.
        #
        # ⛔ BEFORE, not after: once `folder_id` has moved, the rows can no
        # longer be found by the folder they used to be in. Reading them after
        # would return an empty list and land nothing, which is exactly the
        # shape of a fix that looks present and does nothing.
        moved = [r["id"] for r in conn.execute(
            "SELECT id FROM j2_notes WHERE folder_id = ? AND user_id = ?",
            (folder_id, user_id)).fetchall()]
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
        # ⭐ ONE revision for all of them: the cascade is a single UPDATE, so every
        # moved note carries the SAME `updated_at`. The caller lands one revision
        # per note id and the browser stops mistaking its own folder delete for a
        # stranger's write.
        if moved_out is not None:
            moved_out.extend({"noteId": n, "updatedAt": now} for n in moved)
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def ensure_folder_path(user_id: str, path_parts: list[str], dest_folder_id: str = "", conn=None) -> str:
    """Upsert a folder chain under dest_folder_id; returns leaf folder id.
    Truncates each segment to the 80-char folder-name cap.

    Handed a connection, it writes inside the caller's transaction and leaves the
    commit to the caller (the importer and the personal API commit after the note
    write). Handed none, it owns the connection and COMMITS before closing it.
    ⚰️ It used not to: `create_folder` commits only a connection IT opened, and it
    is handed this function's, so the chain was written in a transaction nobody
    committed and thrown away on close. The caller got back an id for a folder
    that did not exist (lane G, wave 7: "The note wasn't saved: folder not found").
    tests/test_journal_two_ensure_folder_path_commits.py reads the result from a
    fresh connection."""
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
        if owned:
            conn.commit()
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
        # WAVE P POST-CLOSURE: the byte cap is the ONLY member-facing
        # authority. `_MAX_PAGES = 500` is an internal secondary ceiling and
        # must never be quoted as an upload guarantee: how many scanned
        # pages fit inside 25 MB moves with DPI, colour depth, compression
        # and page composition. Measured on the Wave P fixture it was ~145
        # pages — which is exactly why no page number appears here.
        raise NoteValidationError(
            "File is larger than the 25 MB limit. How many scanned pages "
            "fit depends on scan quality and compression.")
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
