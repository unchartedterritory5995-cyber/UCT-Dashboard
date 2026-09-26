"""Public share links for notebook notes (post-v1 round 2; hardened by wave 8 lane 8B).

The screener-share idiom, applied to notes: the token IS the credential, the
public payload is SANITIZED and read-only, and the whole public surface is
flag-gated (J2_SHARE_LINKS_ENABLED, default OFF — nothing is reachable until
the flag flips, and revoking a link kills it instantly).

What a shared page serves — and deliberately does NOT:
- title / subtitle / bodyJson / hero / updatedAt. No user id, no tags, no
  folder, no ticker: the reader gets the DOCUMENT, not the account.
- The body passes through the ONE public reducer (`public_note_payload.reduce`,
  `mode="share"`) — the same reducer publish-to-web uses. It is the authority on
  what each node becomes; read its `NODE_POLICY` and vendor table, not a summary here.
- Attachment URLs inside the body are REWRITTEN to the token-scoped proxy
  (`/api/j2/shared/{token}/att/...`): the real attachment route is owner-only
  and must stay that way. Only image subs (inline/hero) are proxied — 'file'
  attachments (PDFs, CSVs) never leave; a shared page is a reading surface,
  not a file drop.

Wave 8 (lane 8B) adds, per `docs/notebook/share-links-authorization-proof.md`:
- an optional EXPIRY per link (never / 7 / 30 / 90 days; ruling D-B2). The
  `expires_at` column is SELF-ENSURED here (`ensure_share_schema`), never via db.py;
- an ARCHIVED note stops serving, exactly as a trashed one does (F-ARCHIVED);
- the image proxy re-checks the note, so a trashed or archived note's images stop too;
- `list_shares` for Settings → Sharing & publishing.
"""

from __future__ import annotations

import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import notes as notes_service
from api.services.journal_two import public_note_payload as public
from api.services.notebook_flags import flag_on

#: The expiry a member may choose (ruling D-B2). `None` = never.
EXPIRY_CHOICES: tuple[int | None, ...] = (None, 7, 30, 90)
EXPIRY_SENTENCE = "Choose when the link stops working: never, or after 7, 30 or 90 days."

#: 24 random bytes = 192 bits (the floor is 128; tests/test_share_publish_authorization.py).
TOKEN_BYTES = 24

SHARED_ATTACHMENT_BASE = "/api/j2/shared/{token}/att/"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    """ONE timestamp shape for every column this module compares as text:
    microseconds always present, so string order is time order."""
    return dt.astimezone(timezone.utc).isoformat(timespec="microseconds")


def _now_iso() -> str:
    return _iso(_now())


def enabled() -> bool:
    """The share gate, read PER CALL through the one Notebook flag parse.

    ⚰️ This was `os.environ.get(...) == "1"` — the ONLY value that meant ON —
    while the auth payload accepted `1/true/yes/on`. Once the flag rides the
    payload (wave 8, S8-1) that difference is a Share button whose routes 404.
    `tests/test_notebook_flag_parse.py` pins the payload and this gate together.
    ⛔ Ruling D-B9: the default stays OFF until the owner's legal sign-off.
    """
    return flag_on("J2_SHARE_LINKS_ENABLED", False)


# ── The self-ensured expiry column ──────────────────────────────────────────────
#
# ⛔ NEVER db.py. `PRAGMA table_info`, then `ALTER TABLE … ADD COLUMN`, idempotent.
# Cached per process after the first success, keyed by the DATABASE FILE — a
# per-process boolean would be wrong the moment one process opens two databases
# (every test file does), and an in-memory database is never cached at all.
_SCHEMA_READY: set[str] = set()


def _db_key(conn: sqlite3.Connection) -> str:
    try:
        for row in conn.execute("PRAGMA database_list").fetchall():
            if row[1] == "main":
                return str(row[2] or "")
    except sqlite3.Error:
        return ""
    return ""


def ensure_share_schema(conn: sqlite3.Connection) -> None:
    key = _db_key(conn)
    if key and key in _SCHEMA_READY:
        return
    cols = {r[1] for r in conn.execute("PRAGMA table_info(j2_note_shares)").fetchall()}
    if not cols:
        return  # the j2 schema has not run here: nothing to alter (and nothing to read)
    if "expires_at" not in cols:
        try:
            conn.execute("ALTER TABLE j2_note_shares ADD COLUMN expires_at TEXT")
            conn.commit()
        except sqlite3.OperationalError as e:  # a concurrent ensure won the race
            if "duplicate column" not in str(e).lower():
                raise
    if key:
        _SCHEMA_READY.add(key)


def _active_sql(alias: str = "") -> str:
    p = f"{alias}." if alias else ""
    return f"{p}revoked_at IS NULL AND ({p}expires_at IS NULL OR {p}expires_at > ?)"


def validate_expiry(value: Any) -> int | None:
    """`expiresInDays` as sent -> the days, or ValueError(EXPIRY_SENTENCE).
    ⛔ Exactly `None`, 7, 30 or 90 — a bool, a float or a string is refused, never coerced."""
    if value is None:
        return None
    if type(value) is int and value in EXPIRY_CHOICES:
        return value
    raise ValueError(EXPIRY_SENTENCE)


def _owned(conn: sqlite3.Connection, user_id: str, note_id: str) -> bool:
    # Wave 0 trash: a soft-deleted note must not be shareable — creating a
    # new share link for a note already in the trash would be surprising,
    # and `resolve_share` (below) already stops SERVING an existing share
    # the moment its note is deleted, via `notes_service.get_note`'s own
    # default `deleted_at IS NULL` filter — this closes the symmetric gap
    # on the creation side.
    row = conn.execute(
        "SELECT 1 FROM j2_notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL",
        (note_id, user_id),
    ).fetchone()
    return row is not None


def _public_row(row: sqlite3.Row) -> dict[str, Any]:
    return {"token": row["token"], "createdAt": row["created_at"], "expiresAt": row["expires_at"]}


def get_share(user_id: str, note_id: str, conn: sqlite3.Connection | None = None) -> dict | None:
    """The note's ACTIVE share token (not revoked, not expired), or None."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_share_schema(conn)
        row = conn.execute(
            "SELECT token, created_at, expires_at FROM j2_note_shares"
            f" WHERE note_id = ? AND user_id = ? AND {_active_sql()}",
            (note_id, user_id, _now_iso()),
        ).fetchone()
        return _public_row(row) if row else None
    finally:
        if owned:
            conn.close()


def create_share(user_id: str, note_id: str, conn: sqlite3.Connection | None = None,
                 expires_in_days: int | None = None) -> dict | None:
    """Mint (or return the existing active) share token. None = not the
    caller's note. An existing active link keeps its own expiry: to change it,
    revoke and create again (the old URL must die, not quietly live longer)."""
    days = validate_expiry(expires_in_days)
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_share_schema(conn)
        if not _owned(conn, user_id, note_id):
            return None
        existing = get_share(user_id, note_id, conn=conn)
        if existing:
            return existing
        token = secrets.token_urlsafe(TOKEN_BYTES)
        now = _now()
        expires = _iso(now + timedelta(days=days)) if days else None
        conn.execute(
            "INSERT INTO j2_note_shares (token, note_id, user_id, created_at, expires_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (token, note_id, user_id, _iso(now), expires),
        )
        conn.commit()
        return {"token": token, "createdAt": _iso(now), "expiresAt": expires}
    finally:
        if owned:
            conn.close()


def revoke_share(user_id: str, note_id: str, conn: sqlite3.Connection | None = None) -> bool:
    """⛔ Scoped by the caller: another member's revoke touches no row (rail:
    tests/test_share_publish_authorization.py, owner-only)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        cur = conn.execute(
            "UPDATE j2_note_shares SET revoked_at = ?"
            " WHERE note_id = ? AND user_id = ? AND revoked_at IS NULL",
            (_now_iso(), note_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


def _live_share_row(conn: sqlite3.Connection, token: str) -> sqlite3.Row | None:
    """The token's row when it may serve: not revoked, not expired, and its note
    neither trashed nor archived. One predicate for the page and its images."""
    ensure_share_schema(conn)
    row = conn.execute(
        "SELECT s.note_id, s.user_id FROM j2_note_shares s"
        " JOIN j2_notes n ON n.id = s.note_id AND n.user_id = s.user_id"
        f" WHERE s.token = ? AND {_active_sql('s')}"
        " AND n.deleted_at IS NULL AND n.archived_at IS NULL",
        (token, _now_iso()),
    ).fetchone()
    return row


def resolve_share(token: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """The SANITIZED public payload for a live token, or None (every miss alike)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _live_share_row(conn, token)
        if not row:
            return None
        # ⛔ Never notes.get_note here: its lazy first_image_url backfill would make a
        # stranger's GET write the owner's row (F-READ-WRITES).
        note = public.read_public_note(conn, row["user_id"], row["note_id"])
        if not note:
            return None
        return public.public_note(
            note, mode="share", owner_id=row["user_id"], note_id=row["note_id"],
            attachment_base=SHARED_ATTACHMENT_BASE.format(token=token),
            facts=public.public_facts(conn, row["user_id"], row["note_id"]),
        )
    finally:
        if owned:
            conn.close()


def resolve_share_attachment(token: str, sub: str, filename: str,
                             conn: sqlite3.Connection | None = None):
    """Filesystem path for a token-scoped attachment — images only ('file'
    attachments stay private). `row["user_id"]`/`row["note_id"]` come from a
    DB row here, not a validated URL segment, so this call cannot rely on a
    router having already checked them. What actually holds: `serve_note_image_path`
    validates user_id/note_id/filename as single path segments AND independently
    anchors containment on the real attachment root (never on a directory built
    from those same values) — either guard alone would refuse a malformed row,
    and losing one still leaves the other."""
    if sub not in ("inline", "hero"):
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = _live_share_row(conn, token)
        if not row:
            return None
        return notes_service.serve_note_image_path(row["user_id"], row["note_id"], sub, filename)
    finally:
        if owned:
            conn.close()


def list_shares(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """The member's share links that have not been revoked, newest first, with the
    note's title and the link's state — for Settings → Sharing & publishing.
    State: `active`, `expired`, `note in trash` or `note archived` (the last three
    do not serve)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_share_schema(conn)
        rows = conn.execute(
            "SELECT s.token, s.note_id, s.created_at, s.expires_at,"
            " n.id AS nid, n.title, n.deleted_at, n.archived_at"
            " FROM j2_note_shares s"
            " LEFT JOIN j2_notes n ON n.id = s.note_id AND n.user_id = s.user_id"
            " WHERE s.user_id = ? AND s.revoked_at IS NULL"
            " ORDER BY s.created_at DESC",
            (user_id,),
        ).fetchall()
    finally:
        if owned:
            conn.close()
    now = _now_iso()
    out = []
    for r in rows:
        if r["nid"] is None:
            state = "note deleted"
        elif r["deleted_at"]:
            state = "note in trash"
        elif r["archived_at"]:
            state = "note archived"
        elif r["expires_at"] and r["expires_at"] <= now:
            state = "expired"
        else:
            state = "active"
        out.append({
            "kind": "share", "token": r["token"], "noteId": r["note_id"],
            "title": r["title"] or "Untitled", "createdAt": r["created_at"],
            "expiresAt": r["expires_at"], "state": state,
        })
    return out
