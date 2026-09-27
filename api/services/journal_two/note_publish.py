"""Publish-to-web: a read-only public page for one note, or for a folder (wave 8, lane 8B).

A publication is a SLUG the member can hand to anyone: `/p/{slug}` in the app, served by
`GET /api/j2/published/{slug}` (router: `api/routers/notebook_publish.py`). It is the share
link's idiom widened to a folder, and every public byte goes through the SAME reducer a share
link does (`public_note_payload.reduce`, `mode="publish"`), so the two surfaces cannot
disagree about what a stranger sees.

The rules, each railed (tests/test_note_publish.py, tests/test_share_publish_authorization.py):

  * GATED. `NOTEBOOK_PUBLISH_ENABLED`, read per request through the one flag parse, default
    OFF (ruling D-B9) -- the router answers 404 for every route while it is off.
  * ONE ACTIVE PUBLICATION PER TARGET. A partial unique index over (user_id, kind, target_id)
    WHERE revoked_at IS NULL. Publishing again returns the live one; an EXPIRED one is retired
    first, so a member can always publish again after a link ran out.
  * NO INTERNAL ID LEAVES. A folder's notes are addressed by `pid` -- the first 22 characters
    of the URL-safe base64 of sha256("{slug}:{note_id}") -- resolved by scanning the CURRENT
    member set. A pid names a note only inside its publication; it is not the note id and
    cannot be turned back into one.
  * A FOLDER'S PUBLIC SET (ruling D-B6) is the snapshot taken at publish (`member_ids`) ∩ the
    notes CURRENTLY in that folder or any folder under it, minus trashed and archived notes.
    It can shrink between refreshes (a note moved out, trashed or archived stops serving at
    once) and it can only GROW on refresh (a note added to the folder is not public until the
    member presses Update). Locked notes are included: a lock guards against edits, not
    readers. At most MEMBER_CAP notes, newest edit first; the owner UI says so.
  * A NOTE PUBLICATION stops serving when its note is trashed or archived, and a folder
    publication when its folder is deleted.
  * ALWAYS NOINDEX (ruling D-B10). The `noindex` column is stored for a later wave; there is no
    toggle in wave 8, and every public response carries `X-Robots-Tag: noindex, nofollow`.
  * NO AUTHOR IDENTITY on a public payload: no user id, no display name, no email.
  * THE PUBLIC READ WRITES NOTHING (`public_note_payload.read_public_note`, never
    `notes.get_note`).

⛔ The table is SELF-ENSURED here (`ensure_publish_schema`), never via db.py, and is listed in
`account_purge._DIRECT_USER_TABLES` so an account deletion takes every publication with it.
"""
from __future__ import annotations

import base64
import hashlib
import json
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import note_shares
from api.services.journal_two import notes as notes_service
from api.services.journal_two import public_note_payload as public
from api.services.notebook_flags import flag_on

#: 16 random bytes = 128 bits: the floor (tests/test_share_publish_authorization.py, test 2).
SLUG_BYTES = 16

#: A pid is this many characters of url-safe base64 (22 chars = 132 bits of the digest).
PID_CHARS = 22

#: The most notes one folder publication serves (the owner UI states it).
MEMBER_CAP = 500

KINDS = ("note", "folder")

#: Where a publication lives IN THE APP. ⛔ The same fact as PUBLISHED_PATH in
#: app/src/pages/journal-2-0/lib/notePublishLink.js; tests/test_note_publish.py parses that
#: file and holds the two equal.
PUBLISHED_PAGE_PATH = "/p"

#: Where the public API serves a publication's images.
PUBLISHED_API = "/api/j2/published"


def enabled() -> bool:
    """The publish gate, read PER CALL through the one Notebook flag parse (ruling D-B9:
    default OFF until the owner's legal sign-off)."""
    return flag_on("NOTEBOOK_PUBLISH_ENABLED", False)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return note_shares._iso(dt)  # one timestamp shape for every column compared as text


# ── The self-ensured table ──────────────────────────────────────────────────────────────

_SCHEMA_READY: set[str] = set()

_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS j2_note_publications (
        slug        TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        kind        TEXT NOT NULL CHECK (kind IN ('note', 'folder')),
        target_id   TEXT NOT NULL,
        member_ids  TEXT NULL,
        noindex     INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        expires_at  TEXT NULL,
        revoked_at  TEXT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_j2_note_publications_target"
    " ON j2_note_publications (user_id, kind, target_id)",
    # ⛔ AT MOST ONE ACTIVE PUBLICATION PER TARGET is the index's job, not a check's: two
    # tabs pressing Publish at once can both pass a SELECT, and only this refuses the second.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_j2_note_publications_active"
    " ON j2_note_publications (user_id, kind, target_id) WHERE revoked_at IS NULL",
)


#: What `_SCHEMA` creates, by name -- all three present means there is nothing to create.
_SCHEMA_OBJECTS = ("j2_note_publications", "idx_j2_note_publications_target",
                   "uq_j2_note_publications_active")


def ensure_publish_schema(conn: sqlite3.Connection) -> None:
    """Create the table and its two indexes if they are missing -- WITHOUT ever committing a
    transaction the caller has open on `conn` (wave-8 final review M-8).

    ⚰️ It ran the three CREATEs and `conn.commit()` on every first call per database, so a
    caller that passed its own connection mid-transaction had that transaction committed
    for it. Now: when all three objects exist it creates nothing and commits nothing; when
    the caller has a transaction open, the CREATEs ride it (committed or rolled back WITH
    the caller's work) and nothing is cached, so a rollback is re-ensured next time; only a
    connection with no transaction open is committed, which commits nothing of anybody's."""
    key = note_shares._db_key(conn)
    if key and key in _SCHEMA_READY:
        return
    marks = ",".join("?" for _ in _SCHEMA_OBJECTS)
    present = {r[0] for r in conn.execute(
        f"SELECT name FROM sqlite_master WHERE name IN ({marks})", _SCHEMA_OBJECTS).fetchall()}
    if present == set(_SCHEMA_OBJECTS):
        if key:
            _SCHEMA_READY.add(key)
        return
    callers_txn = conn.in_transaction
    for stmt in _SCHEMA:
        conn.execute(stmt)
    if callers_txn:
        return
    conn.commit()
    if key:
        _SCHEMA_READY.add(key)


def pid_for(slug: str, note_id: str) -> str:
    digest = hashlib.sha256(f"{slug}:{note_id}".encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii")[:PID_CHARS]


def page_path(slug: str, pid: str | None = None) -> str:
    return f"{PUBLISHED_PAGE_PATH}/{slug}" + (f"/n/{pid}" if pid else "")


# ── Reading the member's own library ────────────────────────────────────────────────────

def _folder_row(conn: sqlite3.Connection, user_id: str, folder_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id, name FROM j2_note_folders WHERE id = ? AND user_id = ?",
        (folder_id, user_id),
    ).fetchone()


def _folder_tree(conn: sqlite3.Connection, user_id: str, folder_id: str) -> list[str]:
    """The folder and every folder under it, the member's own only."""
    rows = conn.execute(
        "WITH RECURSIVE tree(id) AS ("
        " SELECT id FROM j2_note_folders WHERE id = ? AND user_id = ?"
        " UNION"
        " SELECT f.id FROM j2_note_folders f JOIN tree t ON f.parent_id = t.id"
        " WHERE f.user_id = ?"
        ") SELECT id FROM tree",
        (folder_id, user_id, user_id),
    ).fetchall()
    return [r["id"] for r in rows]


def _live_notes_in_tree(conn: sqlite3.Connection, user_id: str, folder_id: str,
                        limit: int | None = None) -> list[sqlite3.Row]:
    """Live (not trashed, not archived) notes in the folder tree, newest edit first.
    Locked notes are included."""
    tree = _folder_tree(conn, user_id, folder_id)
    if not tree:
        return []
    marks = ",".join("?" for _ in tree)
    sql = (f"SELECT id, title, updated_at FROM j2_notes WHERE user_id = ? AND folder_id IN ({marks})"
           " AND deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC, id ASC")
    params: list[Any] = [user_id, *tree]
    if limit is not None:
        sql += " LIMIT ?"
        params.append(limit)
    return conn.execute(sql, params).fetchall()


def _owned_live_note(conn: sqlite3.Connection, user_id: str, note_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id, title FROM j2_notes WHERE id = ? AND user_id = ?"
        " AND deleted_at IS NULL AND archived_at IS NULL",
        (note_id, user_id),
    ).fetchone()


# ── The owner's doors ───────────────────────────────────────────────────────────────────

def _owner_view(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    """What the OWNER sees about one publication (never a public payload)."""
    out: dict[str, Any] = {
        "slug": row["slug"], "kind": row["kind"], "targetId": row["target_id"],
        "path": page_path(row["slug"]), "createdAt": row["created_at"],
        "updatedAt": row["updated_at"], "expiresAt": row["expires_at"],
        "noindex": bool(row["noindex"]),
    }
    if row["kind"] == "folder":
        members = _members(conn, row)
        out["memberCount"] = len(members)
        out["memberCap"] = MEMBER_CAP
    return out


def _retire_expired(conn: sqlite3.Connection, user_id: str, kind: str, target_id: str) -> None:
    """Retire this target's EXPIRED active publication, so the member can publish again.

    ⚰️ Wave-8 final review M-8: this was a bare UPDATE on every publish. An UPDATE takes the
    auth.db write lock even when it matches nothing, and on the common "already published"
    path nothing committed afterwards -- so the lock was held through `_owner_view` (for a
    folder, the whole tree scan) and released only by close's rollback, blocking every
    other writer of auth.db for the duration. Now a plain SELECT decides first; the UPDATE
    runs only when there IS something to retire, and commits at once, so no scan that
    follows ever runs under the write lock."""
    now = _iso(_now())
    due = conn.execute(
        "SELECT 1 FROM j2_note_publications"
        " WHERE user_id = ? AND kind = ? AND target_id = ? AND revoked_at IS NULL"
        " AND expires_at IS NOT NULL AND expires_at <= ? LIMIT 1",
        (user_id, kind, target_id, now),
    ).fetchone()
    if due is None:
        return
    conn.execute(
        "UPDATE j2_note_publications SET revoked_at = ?"
        " WHERE user_id = ? AND kind = ? AND target_id = ? AND revoked_at IS NULL"
        " AND expires_at IS NOT NULL AND expires_at <= ?",
        (now, user_id, kind, target_id, now),
    )
    conn.commit()


def _active_for(conn: sqlite3.Connection, user_id: str, kind: str, target_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM j2_note_publications WHERE user_id = ? AND kind = ? AND target_id = ?"
        " AND revoked_at IS NULL",
        (user_id, kind, target_id),
    ).fetchone()


def _insert(conn: sqlite3.Connection, user_id: str, kind: str, target_id: str,
            member_ids: list[str] | None, days: int | None) -> sqlite3.Row:
    now = _now()
    slug = secrets.token_urlsafe(SLUG_BYTES)
    expires = _iso(now + timedelta(days=days)) if days else None
    try:
        conn.execute(
            "INSERT INTO j2_note_publications"
            " (slug, user_id, kind, target_id, member_ids, noindex, created_at, updated_at, expires_at)"
            " VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)",
            (slug, user_id, kind, target_id,
             json.dumps(member_ids) if member_ids is not None else None,
             _iso(now), _iso(now), expires),
        )
        conn.commit()
    except sqlite3.IntegrityError:
        conn.rollback()           # another tab won the race: theirs is the active one
        existing = _active_for(conn, user_id, kind, target_id)
        if existing is None:
            raise
        return existing
    return conn.execute("SELECT * FROM j2_note_publications WHERE slug = ?", (slug,)).fetchone()


def publish_note(user_id: str, note_id: str, expires_in_days: int | None = None,
                 conn: sqlite3.Connection | None = None) -> dict | None:
    """Publish one note (or return its live publication). None = not the caller's live note."""
    days = note_shares.validate_expiry(expires_in_days)
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_publish_schema(conn)
        if _owned_live_note(conn, user_id, note_id) is None:
            return None
        _retire_expired(conn, user_id, "note", note_id)
        row = _active_for(conn, user_id, "note", note_id) or _insert(conn, user_id, "note", note_id, None, days)
        return _owner_view(conn, row)
    finally:
        if owned:
            conn.close()


def publish_folder(user_id: str, folder_id: str, expires_in_days: int | None = None,
                   conn: sqlite3.Connection | None = None) -> dict | None:
    """Publish a folder: snapshot its live notes (cap MEMBER_CAP). None = not the caller's folder."""
    days = note_shares.validate_expiry(expires_in_days)
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_publish_schema(conn)
        if _folder_row(conn, user_id, folder_id) is None:
            return None
        _retire_expired(conn, user_id, "folder", folder_id)
        row = _active_for(conn, user_id, "folder", folder_id)
        if row is None:
            snap = [r["id"] for r in _live_notes_in_tree(conn, user_id, folder_id, MEMBER_CAP)]
            row = _insert(conn, user_id, "folder", folder_id, snap, days)
        return _owner_view(conn, row)
    finally:
        if owned:
            conn.close()


def _owned_row(conn: sqlite3.Connection, user_id: str, slug: str) -> sqlite3.Row | None:
    """The caller's own, NOT revoked publication (an expired one included: the owner may
    extend it). Another member's slug answers exactly like a missing one."""
    return conn.execute(
        "SELECT * FROM j2_note_publications WHERE slug = ? AND user_id = ? AND revoked_at IS NULL",
        (slug, user_id),
    ).fetchone()


def refresh(user_id: str, slug: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """Update: re-snapshot a folder publication (the only way its set GROWS). A note
    publication has nothing to re-snapshot and is returned unchanged."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_publish_schema(conn)
        row = _owned_row(conn, user_id, slug)
        if row is None:
            return None
        if row["kind"] == "folder":
            if _folder_row(conn, user_id, row["target_id"]) is None:
                return None
            snap = [r["id"] for r in _live_notes_in_tree(conn, user_id, row["target_id"], MEMBER_CAP)]
            conn.execute(
                "UPDATE j2_note_publications SET member_ids = ?, updated_at = ? WHERE slug = ? AND user_id = ?",
                (json.dumps(snap), _iso(_now()), slug, user_id),
            )
            conn.commit()
            row = _owned_row(conn, user_id, slug)
        return _owner_view(conn, row)
    finally:
        if owned:
            conn.close()


def set_expiry(user_id: str, slug: str, expires_in_days: int | None,
               conn: sqlite3.Connection | None = None) -> dict | None:
    """Change when the page stops working (never / 7 / 30 / 90 days from NOW)."""
    days = note_shares.validate_expiry(expires_in_days)
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_publish_schema(conn)
        if _owned_row(conn, user_id, slug) is None:
            return None
        now = _now()
        conn.execute(
            "UPDATE j2_note_publications SET expires_at = ?, updated_at = ? WHERE slug = ? AND user_id = ?",
            (_iso(now + timedelta(days=days)) if days else None, _iso(now), slug, user_id),
        )
        conn.commit()
        return _owner_view(conn, _owned_row(conn, user_id, slug))
    finally:
        if owned:
            conn.close()


def revoke(user_id: str, slug: str, conn: sqlite3.Connection | None = None) -> bool:
    """Unpublish. ⛔ Scoped by the caller: another member's slug touches no row."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_publish_schema(conn)
        cur = conn.execute(
            "UPDATE j2_note_publications SET revoked_at = ? WHERE slug = ? AND user_id = ? AND revoked_at IS NULL",
            (_iso(_now()), slug, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def list_mine(user_id: str, note_id: str | None = None,
              conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Settings → Sharing & publishing: every publication and share link the member has not
    revoked, with its name, dates, expiry and state. With `note_id`, also the context the
    editor's Share door needs for that note (its publication, its share link, its folder)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_publish_schema(conn)
        rows = conn.execute(
            "SELECT * FROM j2_note_publications WHERE user_id = ? AND revoked_at IS NULL"
            " ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
        now = _iso(_now())
        pubs = []
        for r in rows:
            item = _owner_view(conn, r)
            if r["kind"] == "note":
                n = conn.execute("SELECT id, title, deleted_at, archived_at FROM j2_notes"
                                 " WHERE id = ? AND user_id = ?", (r["target_id"], user_id)).fetchone()
                item["name"] = (n["title"] if n else None) or "Untitled"
                state = ("note deleted" if n is None else "note in trash" if n["deleted_at"]
                         else "note archived" if n["archived_at"] else None)
            else:
                f = _folder_row(conn, user_id, r["target_id"])
                item["name"] = f["name"] if f else "Deleted folder"
                state = "folder deleted" if f is None else None
            if state is None:
                state = "expired" if (r["expires_at"] and r["expires_at"] <= now) else "active"
            item["state"] = state
            pubs.append(item)
        out: dict[str, Any] = {"publications": pubs,
                               "shares": note_shares.list_shares(user_id, conn=conn)}
        if note_id:
            n = conn.execute("SELECT id, folder_id, archived_at FROM j2_notes WHERE id = ?"
                             " AND user_id = ? AND deleted_at IS NULL", (note_id, user_id)).fetchone()
            # ⚰️ Wave-8 final review M-3: `exists` alone read true for an ARCHIVED note that
            # `publish_note` refuses with 404 (and that a share link could never serve).
            # `publishable` is the door's answer: the caller's live note, not archived.
            ctx: dict[str, Any] = {"noteId": note_id, "exists": n is not None,
                                   "publishable": n is not None and not n["archived_at"],
                                   "folderId": None, "folderName": None}
            if n is not None and n["folder_id"]:
                f = _folder_row(conn, user_id, n["folder_id"])
                if f is not None:
                    ctx["folderId"], ctx["folderName"] = f["id"], f["name"]
            out["note"] = ctx
        return out
    finally:
        if owned:
            conn.close()


# ── The public read ─────────────────────────────────────────────────────────────────────

def _live_row(conn: sqlite3.Connection, slug: str) -> sqlite3.Row | None:
    """The slug's row when it may serve: not revoked, not expired, and its target alive
    (a note not trashed or archived; a folder not deleted). One predicate for every public
    door. Every miss is the same None."""
    ensure_publish_schema(conn)
    row = conn.execute(
        "SELECT * FROM j2_note_publications WHERE slug = ? AND revoked_at IS NULL"
        " AND (expires_at IS NULL OR expires_at > ?)",
        (slug, _iso(_now())),
    ).fetchone()
    if row is None:
        return None
    if row["kind"] == "note":
        return row if _owned_live_note(conn, row["user_id"], row["target_id"]) else None
    return row if _folder_row(conn, row["user_id"], row["target_id"]) else None


def _members(conn: sqlite3.Connection, row: sqlite3.Row) -> list[sqlite3.Row]:
    """A folder publication's CURRENT public set: snapshot ∩ the folder tree now, minus
    trashed and archived notes, newest edit first."""
    try:
        snap = set(json.loads(row["member_ids"] or "[]"))
    except (TypeError, ValueError):
        snap = set()
    if not snap:
        return []
    return [r for r in _live_notes_in_tree(conn, row["user_id"], row["target_id"]) if r["id"] in snap]


def _member_for_pid(conn: sqlite3.Connection, row: sqlite3.Row, pid: str) -> sqlite3.Row | None:
    for m in _members(conn, row):
        if pid_for(row["slug"], m["id"]) == pid:
            return m
    return None


def _payload_note(conn: sqlite3.Connection, owner_id: str, note_id: str, base: str,
                  note_links: dict[str, tuple[str, str]] | None = None) -> dict | None:
    note = public.read_public_note(conn, owner_id, note_id)
    if note is None:
        return None
    return public.public_note(note, mode="publish", owner_id=owner_id, note_id=note_id,
                              attachment_base=base, facts=public.public_facts(conn, owner_id, note_id),
                              note_links=note_links)


def resolve(slug: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """`GET /published/{slug}`: a note publication's note, or a folder's index. None = the
    one not-found for every miss."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _live_row(conn, slug)
        if row is None:
            return None
        owner = row["user_id"]
        if row["kind"] == "note":
            note = _payload_note(conn, owner, row["target_id"], f"{PUBLISHED_API}/{slug}/att/")
            return {"kind": "note", "note": note} if note else None
        folder = _folder_row(conn, owner, row["target_id"])
        return {
            "kind": "folder",
            "title": folder["name"],
            "notes": [{"pid": pid_for(slug, m["id"]), "title": m["title"] or "Untitled",
                       "updatedAt": m["updated_at"]} for m in _members(conn, row)],
        }
    finally:
        if owned:
            conn.close()


def resolve_member(slug: str, pid: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """`GET /published/{slug}/n/{pid}`: one note inside a folder publication. A link to
    another member of the SAME publication becomes a link to its public page (D-B7)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _live_row(conn, slug)
        if row is None or row["kind"] != "folder":
            return None
        members = _members(conn, row)
        member = next((m for m in members if pid_for(slug, m["id"]) == pid), None)
        if member is None:
            return None
        links = {m["id"]: (page_path(slug, pid_for(slug, m["id"])), m["title"] or "Untitled")
                 for m in members if m["id"] != member["id"]}
        note = _payload_note(conn, row["user_id"], member["id"],
                             f"{PUBLISHED_API}/{slug}/n/{pid}/att/", links)
        if note is None:
            return None
        folder = _folder_row(conn, row["user_id"], row["target_id"])
        return {"kind": "note", "note": note, "folder": {"title": folder["name"], "path": page_path(slug)}}
    finally:
        if owned:
            conn.close()


def resolve_attachment(slug: str, sub: str, filename: str, pid: str | None = None,
                       conn: sqlite3.Connection | None = None):
    """A publication's image: `inline`/`hero` only ('file' attachments never leave), from the
    note the path names -- the published note itself, or the folder member `pid`."""
    if sub not in ("inline", "hero"):
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _live_row(conn, slug)
        if row is None:
            return None
        if pid is None:
            if row["kind"] != "note":
                return None
            note_id = row["target_id"]
        else:
            if row["kind"] != "folder":
                return None
            member = _member_for_pid(conn, row, pid)
            if member is None:
                return None
            note_id = member["id"]
        return notes_service.serve_note_image_path(row["user_id"], note_id, sub, filename)
    finally:
        if owned:
            conn.close()


__all__ = [
    "SLUG_BYTES", "PID_CHARS", "MEMBER_CAP", "KINDS", "PUBLISHED_PAGE_PATH", "PUBLISHED_API",
    "enabled", "ensure_publish_schema", "pid_for", "page_path", "publish_note", "publish_folder",
    "refresh", "set_expiry", "revoke", "list_mine", "resolve", "resolve_member", "resolve_attachment",
]
