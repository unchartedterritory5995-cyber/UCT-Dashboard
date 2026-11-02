"""Link keys and the link heal pass -- connector fidelity Plan A Task 4 (spec §5.1).

An imported note links to another imported note through a placeholder mark,
`import-link://<key>`, until the note the key names exists; then the mark becomes a
real in-app link (`/journal?j2tab=notebook&note=<id>`). Two things live here:

`resolve_link_keys` -- which note a key names, for one member:
  * an exact import key (`fake:graph/p2`, `notion:<id>`, `obsidian:...`) -> the
    member's non-trashed note with that `import_key` (`notes.import_check`);
  * `evernote-title:<title>` -> the member's ONE non-trashed Evernote note with that
    title. Evernote exports link by title, not by id. `import_source` is matched
    case-insensitively (`EVERNOTE_SOURCE`): the file importer stores the label
    'Evernote', a live connector would store 'evernote', and SQLite `=` is
    case-sensitive. Titles compare after trim + whitespace-collapse on both sides;
    two or more matches resolve to nothing (a guess would link the wrong note);
  * any other kind resolves to nothing. (`name:obsidian:` arrives in Task 13.)

`heal_pending_links` -- rewrite the marks that can resolve NOW, in notes imported
earlier. It is what makes "pending" mean "something can still resolve": the engine runs
it at the end of every import round (`engine._import_remote_notes`), and the member's
heal door (`POST /api/j2/notes/import/heal-links`) runs it for the notes Plan B's file
importer names. Invariants:
  * member-scoped: it reads and writes only `user_id`'s own notes;
  * bounded: the sweep reads at most `limit` notes, through
    `idx_j2_notes_links_pending`; named notes are bounded by the door (<= 500);
  * a note the member has edited since import (`import_provenance.edited_since_import`)
    is never rewritten -- its marks are reported, not resolved; and the sweep does not
    spend its budget on such notes;
  * timestamp-neutral and safe against a concurrent edit: every write goes through
    `engine._apply_resolved_body` (optimistic lock on `updated_at`, no `updated_at`
    bump, link sidecars rebuilt so a healed link is a backlink and a graph edge);
  * an unresolved mark is never stripped and a pending MEDIA placeholder is never
    dropped (`rewrite_body` would drop an `import-ref://` node it has no URL for, so the
    heal hands each one back to itself).
"""
from __future__ import annotations

import json
import sqlite3
from typing import Any, Iterable

from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.import_provenance import (
    SQL_FUNCTION as EDITED_SQL_FUNCTION, edited_since_import, register_sql_function,
)
from api.services.journal_two.note_connectors.convert import LINK_PREFIX, REF_PREFIX, rewrite_body

#: `j2_notes.import_source` of an Evernote note, compared on `lower(import_source)`.
EVERNOTE_SOURCE = "evernote"
#: The key kind an Evernote title link carries: `evernote-title:<title>`.
EVERNOTE_TITLE_KIND = "evernote-title:"
#: The most notes one heal sweep reads, and the most notes the heal door may name.
HEAL_LIMIT = 500

_SELECT = "SELECT id, body_json, updated_at, imported_at FROM j2_notes"
_CANDIDATE = "user_id = ? AND deleted_at IS NULL AND imported_at IS NOT NULL"


def _norm_title(t: Any) -> str:
    return " ".join(t.split()) if isinstance(t, str) else ""


def resolve_link_keys(conn: sqlite3.Connection, user_id: str, keys: Iterable[str]) -> dict[str, str]:
    """`{key: note_id}` for every key in `keys` that names exactly one of `user_id`'s notes."""
    wanted = list(dict.fromkeys(k for k in keys if isinstance(k, str) and k))
    title_keys = [k for k in wanted if k.startswith(EVERNOTE_TITLE_KIND)]
    exact = [k for k in wanted if not k.startswith(EVERNOTE_TITLE_KIND)]
    out: dict[str, str] = {}
    if exact:
        found = notes_svc.import_check(user_id, exact, conn=conn)["existing"]
        out.update({k: v["id"] for k, v in found.items()})
    if title_keys:
        by_title: dict[str, list[str]] = {}
        for row in conn.execute(
            "SELECT id, title FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL"
            " AND lower(import_source) = ?", (user_id, EVERNOTE_SOURCE),
        ):
            by_title.setdefault(_norm_title(row["title"]), []).append(row["id"])
        for k in title_keys:
            ids = by_title.get(_norm_title(k[len(EVERNOTE_TITLE_KIND):]), [])
            if len(ids) == 1:
                out[k] = ids[0]
    return out


def _link_runs(doc: Any) -> dict[str, str]:
    """`{key: display text}` for every `import-link://` mark, in document order. The text
    is the first run carrying the key, joined with the adjacent text nodes that carry the
    same mark (a label split by a bold word is still one label)."""
    out: dict[str, str] = {}

    def key_of(node: Any) -> str | None:
        if not isinstance(node, dict) or node.get("type") != "text":
            return None
        for m in node.get("marks") or []:
            href = (m.get("attrs") or {}).get("href") if isinstance(m, dict) else None
            if isinstance(m, dict) and m.get("type") == "link" and isinstance(href, str) \
                    and href.startswith(LINK_PREFIX):
                return href[len(LINK_PREFIX):]
        return None

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        content = node.get("content")
        if not isinstance(content, list):
            return
        open_key: str | None = None  # the key whose FIRST run is being read at this level
        for child in content:
            k = key_of(child)
            if k is not None and k == open_key:
                out[k] += child.get("text") or ""
            elif k is not None and k not in out:
                out[k] = child.get("text") or ""
                open_key = k
            else:
                open_key = None
            walk(child)

    walk(doc)
    return out


def _media_passthrough(doc: Any) -> dict[str, str]:
    """`{ref: its own placeholder}` for every `import-ref://` media node, so `rewrite_body`
    keeps a still-pending image or attachment exactly as it is instead of dropping it."""
    out: dict[str, str] = {}

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            attrs = node.get("attrs") or {}
            for attr in ("src", "href"):
                v = attrs.get(attr) if isinstance(attrs, dict) else None
                if isinstance(v, str) and v.startswith(REF_PREFIX):
                    out[v[len(REF_PREFIX):]] = v
            for child in node.get("content") or []:
                walk(child)

    walk(doc)
    return out


def heal_pending_links(
    user_id: str, *, note_ids: list[str] | None = None,
    conn: sqlite3.Connection | None = None, limit: int = HEAL_LIMIT,
) -> dict:
    """Rewrite every `import-link://` mark that resolves now, in the notes named by
    `note_ids` (member-scoped) PLUS a sweep of up to `limit` of the member's notes with
    `import_links_pending = 1` that the member has not edited since import.

    Returns `{"healed": notes rewritten, "checked": notes read, "unresolved": [{"noteId",
    "key", "text"}] for the NAMED notes only, "failures": [named per-note failures]}`."""
    from api.services.journal_two.note_connectors import engine  # engine imports this module

    owned = conn is None
    conn = conn or get_connection()
    try:
        named = list(dict.fromkeys(n for n in (note_ids or []) if isinstance(n, str) and n))
        named_set = set(named)
        rows: list[sqlite3.Row] = []
        for i in range(0, len(named), 500):  # SQLite variable limit
            chunk = named[i:i + 500]
            rows.extend(conn.execute(
                f"{_SELECT} WHERE {_CANDIDATE} AND id IN ({','.join('?' * len(chunk))})",
                (user_id, *chunk)).fetchall())
        register_sql_function(conn)
        rows.extend(r for r in conn.execute(
            f"{_SELECT} WHERE {_CANDIDATE} AND import_links_pending = 1"
            f" AND NOT {EDITED_SQL_FUNCTION}(updated_at, imported_at) LIMIT ?",
            (user_id, max(0, int(limit)))).fetchall() if r["id"] not in named_set)

        unresolved: list[dict[str, str]] = []
        failures: list[str] = []
        parsed: list[tuple[sqlite3.Row, Any, dict[str, str]]] = []
        for row in rows:
            raw = row["body_json"] or ""
            if LINK_PREFIX not in raw:
                continue
            try:
                doc = json.loads(raw)
            except (TypeError, ValueError) as e:
                failures.append(f"link heal: unreadable stored body for note {row['id']!r}: {e}")
                continue
            parsed.append((row, doc, _link_runs(doc)))

        def report(row: sqlite3.Row, runs: dict[str, str], resolved: dict[str, str]) -> None:
            if row["id"] in named_set:
                unresolved.extend({"noteId": row["id"], "key": k, "text": t}
                                  for k, t in runs.items() if k not in resolved)

        healable: list[tuple[sqlite3.Row, Any, dict[str, str]]] = []
        for row, doc, runs in parsed:
            # THE guard: a note the member has edited since import is never rewritten
            # (a named one reports every mark instead). The sweep's SQL above only keeps
            # such notes from spending its budget; it is not what protects them.
            if edited_since_import(row["updated_at"], row["imported_at"]):
                report(row, runs, {})
                continue
            healable.append((row, doc, runs))
        id_by_key = resolve_link_keys(conn, user_id, {k for _r, _d, runs in healable for k in runs})

        healed = 0
        for row, doc, runs in healable:
            mine = {k: id_by_key[k] for k in runs if k in id_by_key}
            if not mine:
                report(row, runs, {})
                continue
            body, _dropped = rewrite_body(doc, _media_passthrough(doc), mine,
                                          strip_unresolved_links=False)
            try:
                notes_svc._validate_body_json(body)
                applied = engine._apply_resolved_body(
                    conn, user_id, row["id"], body, expected_updated_at=row["updated_at"])
            except Exception as e:  # noqa: BLE001 -- one note never stops the pass
                failures.append(f"link heal: write failed for note {row['id']!r}: {e}")
                report(row, runs, {})
                continue
            if applied:
                healed += 1
                report(row, runs, mine)
            else:
                report(row, runs, {})  # edited in the meantime: the member's write stands
        return {"healed": healed, "checked": len(rows), "unresolved": unresolved,
                "failures": failures}
    finally:
        if owned:
            conn.close()
