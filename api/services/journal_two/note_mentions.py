"""Unlinked mentions — "which of my other notes NAME this one without linking it?"

Obsidian's unlinked-mentions pane, over the Notebook. For one note, list the
member's OTHER notes whose body contains the note's title, matched
case-insensitively on word boundaries, with a snippet around the first match.

What is excluded, and why each one
----------------------------------
* **Titles under `MIN_TITLE_CHARS` (3).** "AI" or "Q3" would match half the
  notebook; a pane full of noise teaches a member to ignore it.
* **Notes that already link to this one** — they are backlinks, and the
  backlinks section already lists them. Read from `j2_note_links`, the
  projection every save maintains.
* **Trash** (`deleted_at`) and **archive** (`archived_at`). ⚠️ `archived_at`
  is added by the organization lane and may not exist yet: its presence is
  READ from the table (`PRAGMA table_info`), never assumed, so this works on
  both sides of that migration and starts excluding archived notes the day the
  column lands.
* **The note itself.**

How it stays cheap
------------------
The body is matched in Python, on the note's own `body_json` walked block by
block — never on `body_plain`, which joins text nodes with a space and so
splits a word whose middle carries a mark. Parsing every note's JSON would be
linear in the notebook, so candidates are PRE-FILTERED through the existing FTS
index with the title as a phrase (FTS tokenises the phrase the same way it
tokenised the body, so identical text always matches). The prefilter only has
to be a superset: the word-boundary test in Python decides.

⚠️ RESIDUAL, stated: a title split mid-word by a mark in the OTHER note
("NV**DA**") is invisible to the FTS phrase and is not reported. Rare, and the
failure direction is a missed suggestion, never a wrong one.

READ-ONLY. There is deliberately no "link it" write here — see
`components/notebook/UnlinkedMentions.jsx` for why.
"""
from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from api.services import auth_db

MIN_TITLE_CHARS = 3
SNIPPET_CONTEXT = 60
MAX_CANDIDATES = 500

# Inline atoms that carry no text of their own but sit inside a sentence.
_ATOMS_AS_ELLIPSIS = ("noteLink",)
_ATOMS_AS_GAP = ("videoTimestamp", "attachmentChip", "documentExcerpt", "widgetEmbed",
                 "dateMention", "hardBreak", "inlineMath", "financialFact")


def has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    return any(r[1] == column for r in conn.execute(f"PRAGMA table_info({table})").fetchall())


def title_pattern(title: str) -> re.Pattern | None:
    """Case-insensitive, word-bounded, whitespace-tolerant. None if too short.

    Word boundaries are `\\w`-based and apply only at the ends that ARE word
    characters: "S&P 500" still matches inside "the S&P 500 fell", while
    "NVDA" does not match inside "NVDAX"."""
    t = (title or "").strip()
    if len(t) < MIN_TITLE_CHARS or not re.search(r"\w", t):
        return None
    parts = [re.escape(p) for p in t.split()]
    body = r"\s+".join(parts)
    left = r"(?<!\w)" if re.match(r"\w", t) else ""
    right = r"(?!\w)" if re.search(r"\w$", t) else ""
    return re.compile(left + body + right, re.IGNORECASE)


def _block_texts(doc: Any) -> list[str]:
    """Each text block's own text, in document order. Text nodes are joined
    WITHOUT a separator (a mark boundary is not a word boundary)."""
    out: list[str] = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        content = node.get("content")
        if not isinstance(content, list):
            return
        if any(isinstance(c, dict) and c.get("type") == "text" for c in content):
            buf: list[str] = []
            for c in content:
                if not isinstance(c, dict):
                    continue
                t = c.get("type")
                if t == "text" and isinstance(c.get("text"), str):
                    buf.append(c["text"])
                elif t in _ATOMS_AS_ELLIPSIS:
                    buf.append(" … ")
                elif t in _ATOMS_AS_GAP:
                    buf.append(" ")
                elif isinstance(c.get("content"), list):
                    walk(c)
            text = re.sub(r"\s+", " ", "".join(buf)).strip()
            if text:
                out.append(text)
            return
        for c in content:
            walk(c)

    walk(doc)
    return out


def find_mentions(doc: Any, pattern: re.Pattern) -> tuple[int, dict[str, str] | None]:
    """(occurrences, first snippet) of `pattern` in a TipTap doc."""
    total = 0
    first: dict[str, str] | None = None
    for text in _block_texts(doc):
        matches = list(pattern.finditer(text))
        if not matches:
            continue
        total += len(matches)
        if first is None:
            m = matches[0]
            start = max(0, m.start() - SNIPPET_CONTEXT)
            end = min(len(text), m.end() + SNIPPET_CONTEXT)
            before = text[start:m.start()]
            after = text[m.end():end]
            first = {
                "before": ("…" if start > 0 else "") + before,
                "match": m.group(0),
                "after": after + ("…" if end < len(text) else ""),
            }
    return total, first


def _fts_phrase(title: str) -> str | None:
    t = (title or "").strip()
    if not re.search(r"\w", t):
        return None
    return 'body_plain : "' + t.replace('"', '""') + '"'


def get_unlinked_mentions(
    user_id: str, note_id: str, limit: int = 50, conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {"title": None, "count": 0, "notes": [], "skipped": None}
    if not user_id or not note_id:
        return out
    owned = conn is None
    conn = conn or auth_db.get_connection()
    try:
        archived = has_column(conn, "j2_notes", "archived_at")
        live = " AND n.deleted_at IS NULL" + (" AND n.archived_at IS NULL" if archived else "")
        row = conn.execute(
            "SELECT n.title FROM j2_notes n WHERE n.id = ? AND n.user_id = ?" + live,
            (note_id, user_id),
        ).fetchone()
        if row is None:
            return out
        title = (row["title"] or "").strip()
        out["title"] = title
        pattern = title_pattern(title)
        if pattern is None:
            out["skipped"] = "short-title"
            return out

        base = (
            "SELECT n.id, n.title, n.updated_at, n.body_json FROM j2_notes n"
            " WHERE n.user_id = ? AND n.id != ?" + live +
            " AND NOT EXISTS (SELECT 1 FROM j2_note_links l WHERE l.note_id = n.id"
            " AND l.user_id = n.user_id AND l.target_note_id = ?)"
        )
        params: list[Any] = [user_id, note_id, note_id]
        phrase = _fts_phrase(title)
        rows: list[sqlite3.Row] = []
        if phrase:
            try:
                rows = conn.execute(
                    base + " AND n.id IN (SELECT note_id FROM j2_notes_fts"
                    " WHERE j2_notes_fts MATCH ? AND user_id = ? LIMIT ?)"
                    " ORDER BY n.updated_at DESC",
                    (*params, phrase, user_id, MAX_CANDIDATES),
                ).fetchall()
            except sqlite3.OperationalError:
                phrase = None  # an expression FTS refuses: scan instead
        if not phrase:
            rows = conn.execute(
                base + " ORDER BY n.updated_at DESC LIMIT ?", (*params, MAX_CANDIDATES),
            ).fetchall()

        found: list[dict[str, Any]] = []
        for r in rows:
            try:
                doc = json.loads(r["body_json"] or "{}")
            except (ValueError, TypeError):
                continue
            n, snippet = find_mentions(doc, pattern)
            if n:
                found.append({
                    "id": r["id"], "title": r["title"] or "Untitled",
                    "updatedAt": r["updated_at"], "occurrences": n, "snippet": snippet,
                })
        out["count"] = len(found)
        out["notes"] = found[: max(1, min(int(limit), 200))]
        return out
    finally:
        if owned:
            conn.close()
