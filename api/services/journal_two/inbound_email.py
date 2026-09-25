"""Wave 7 lane G (G3) — email-in: a member forwards an email to their private
Notebook address and it becomes a note in their `Inbox` folder.

The path, end to end:

    sender -> Cloudflare Email Routing (rule `notes+*@<domain>`)
           -> the Email Worker in cloudflare/inbound-email-worker/
              (parses the MIME with postal-mime, signs, POSTs)
           -> POST /api/j2/inbound-email   (api/routers/notebook_inbound_email.py)
           -> `ingest` below

⛔ DARK. `NOTEBOOK_INBOUND_EMAIL_ENABLED` unset means every route 404s and no
address is ever minted. It stays dark until the owner approves the Privacy page
sentence naming Cloudflare as the processor of these emails (drafted in
docs/notebook/email-in-setup.md) and sets the routing rule and the secret.

⛔ THE ADDRESS IS THE ONLY THING THAT PICKS THE MEMBER. `notes+<token>@<domain>`
— the token is 96 random bits, looked up in `j2_inbound_addresses`. Nothing in
the email (From, headers, body) is trusted to say whose it is. An unknown token
is ACCEPTED AND DROPPED: the worker is told the same thing as for a real one,
so no answer anywhere can be used to test whether an address exists.

⛔ THE SIGNATURE IS CHECKED BEFORE ANYTHING IS READ. HMAC-SHA256 with
`NOTEBOOK_INBOUND_EMAIL_SECRET` over `<timestamp>.<raw body>` — the timestamp
is inside the signed bytes so a captured request cannot be replayed with a
fresh `X-UCT-Timestamp`, and a request older than five minutes is refused.
Constant-time compare. No secret configured means NOTHING verifies (fail
closed), never "no check".

⛔ NOTHING IS FETCHED. An image referenced by URL in an email's HTML becomes a
text marker, exactly as in the personal API. Only the attachments the email
itself carried are saved, through the Notebook's own save functions and limits.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import logging
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

log = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────────────
INBOUND_GATE = "NOTEBOOK_INBOUND_EMAIL_ENABLED"
SECRET_ENV = "NOTEBOOK_INBOUND_EMAIL_SECRET"
# The mail domain the routing rule lives on. A SETTING, not a gate: it exists
# so the owner can put Email Routing on a subdomain (Email Routing replaces the
# MX records of the zone it is enabled on — see email-in-setup.md).
DOMAIN_ENV = "NOTEBOOK_INBOUND_EMAIL_DOMAIN"
DEFAULT_DOMAIN = "uctintelligence.com"
LOCAL_PART = "notes"
_GATE_ON_VALUES = {"1", "true", "yes", "on"}

REPLAY_WINDOW_SECONDS = 300
TOKEN_BYTES = 12                     # 24 lowercase hex characters, 96 bits
_TOKEN_RE = re.compile(r"^[0-9a-f]{24}$")
_ADDR_RE = re.compile(r"notes\+([0-9a-zA-Z]+)@([0-9A-Za-z.\-]+)", re.IGNORECASE)

INBOX_FOLDER = "Inbox"
MAX_TEXT_BYTES = 200 * 1024          # same ceiling the personal API applies
MAX_HTML_BYTES = 1024 * 1024
MAX_ATTACHMENTS = 20

_DDL = """
CREATE TABLE IF NOT EXISTS j2_inbound_addresses (
    user_id     TEXT PRIMARY KEY,
    token       TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL,
    rotated_at  TEXT
);
"""


def inbound_email_enabled() -> bool:
    raw = os.environ.get(INBOUND_GATE)
    return raw is not None and raw.strip().lower() in _GATE_ON_VALUES


def mail_domain() -> str:
    return (os.environ.get(DOMAIN_ENV) or DEFAULT_DOMAIN).strip().lower()


def ensure_inbound_schema(conn: sqlite3.Connection) -> None:
    """Self-ensured on every call (the `ensure_capture_auth_schema` idiom):
    the table exists wherever this code runs, and db.py is not touched."""
    conn.executescript(_DDL)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def address_for(token: str) -> str:
    return f"{LOCAL_PART}+{token}@{mail_domain()}"


def _public(row: sqlite3.Row | dict) -> dict[str, Any]:
    return {
        "address": address_for(row["token"]),
        "createdAt": row["created_at"],
        "rotatedAt": row["rotated_at"],
    }


# ── Addresses ────────────────────────────────────────────────────────────────

def get_or_create_address(user_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """The member's address, minted the first time it is asked for."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_inbound_schema(conn)
        row = conn.execute(
            "SELECT token, created_at, rotated_at FROM j2_inbound_addresses WHERE user_id = ?",
            (user_id,)).fetchone()
        if row is None:
            conn.execute(
                "INSERT OR IGNORE INTO j2_inbound_addresses (user_id, token, created_at)"
                " VALUES (?, ?, ?)",
                (user_id, secrets.token_hex(TOKEN_BYTES), _now_iso()))
            conn.commit()
            row = conn.execute(
                "SELECT token, created_at, rotated_at FROM j2_inbound_addresses WHERE user_id = ?",
                (user_id,)).fetchone()
        return _public(row)
    finally:
        if owned:
            conn.close()


def rotate(user_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Replace the member's address. The old one stops working at once: mail
    to it is accepted and dropped like mail to any address that never
    existed."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_inbound_schema(conn)
        now = _now_iso()
        token = secrets.token_hex(TOKEN_BYTES)
        cur = conn.execute(
            "UPDATE j2_inbound_addresses SET token = ?, rotated_at = ? WHERE user_id = ?",
            (token, now, user_id))
        if not cur.rowcount:
            conn.execute(
                "INSERT INTO j2_inbound_addresses (user_id, token, created_at) VALUES (?, ?, ?)",
                (user_id, token, now))
        conn.commit()
        row = conn.execute(
            "SELECT token, created_at, rotated_at FROM j2_inbound_addresses WHERE user_id = ?",
            (user_id,)).fetchone()
        return _public(row)
    finally:
        if owned:
            conn.close()


def resolve(token: str | None, conn: sqlite3.Connection | None = None) -> str | None:
    """Token -> the ONE member it belongs to, or None."""
    if not isinstance(token, str) or not _TOKEN_RE.match(token):
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_inbound_schema(conn)
        row = conn.execute(
            "SELECT user_id FROM j2_inbound_addresses WHERE token = ?", (token,)).fetchone()
        return row["user_id"] if row else None
    finally:
        if owned:
            conn.close()


def recipient_token(to: Any) -> str | None:
    """The token from the first `notes+<token>@<our domain>` recipient.

    `to` is the worker's ENVELOPE recipient (a string), but a list or a
    display-name form (`Notes <notes+…@…>`) is read too. A `notes+` address on
    any other domain is not ours and names nobody."""
    items = to if isinstance(to, list) else [to]
    domain = mail_domain()
    for item in items:
        if not isinstance(item, str):
            continue
        for m in _ADDR_RE.finditer(item):
            if m.group(2).lower().rstrip(".") == domain:
                return m.group(1).lower()
    return None


# ── The signature ────────────────────────────────────────────────────────────

def expected_signature(secret: str, timestamp: str, raw_body: bytes) -> str:
    """Hex HMAC-SHA256 over `<timestamp>.<raw body>`. The worker's `signBody`
    (cloudflare/inbound-email-worker/src/sign.js) computes the same bytes;
    tests/test_notebook_inbound_email.py holds the two to each other."""
    msg = timestamp.encode("ascii") + b"." + raw_body
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def verify_signature(
    secret: str | None, timestamp: str | None, signature: str | None,
    raw_body: bytes, *, now: float | None = None,
) -> bool:
    """True only for a request the worker signed within the last five minutes.

    ⛔ Every branch fails closed: no secret, no timestamp, a timestamp that is
    not a whole number, one outside the window (either side), no signature, or
    one that does not match."""
    if not secret or not timestamp or not signature:
        return False
    if not timestamp.isdigit():
        return False
    now = time.time() if now is None else now
    if abs(now - int(timestamp)) > REPLAY_WINDOW_SECONDS:
        return False
    expected = expected_signature(secret, timestamp, raw_body)
    return hmac.compare_digest(expected, signature.strip().lower())


# ── Building the note ────────────────────────────────────────────────────────

def _truncate_utf8(text: str, limit: int) -> tuple[str, bool]:
    data = text.encode("utf-8")
    if len(data) <= limit:
        return text, False
    return data[:limit].decode("utf-8", errors="ignore"), True


def _para(text: str) -> dict[str, Any]:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def _body_nodes(text: Any, html: Any) -> list[dict[str, Any]]:
    """text/plain through `mddoc.md_to_tiptap` when there is any, else the HTML
    through mddoc's HTML walk. Either way media refs become text markers."""
    from api.services.journal_two.note_connectors.convert.mddoc import html_to_tiptap
    from api.services.journal_two.note_personal_api import _strip_media, markdown_nodes

    if isinstance(text, str) and text.strip():
        clean, cut = _truncate_utf8(text.replace("\r\n", "\n"), MAX_TEXT_BYTES)
        nodes = markdown_nodes(clean)
    elif isinstance(html, str) and html.strip():
        clean, cut = _truncate_utf8(html, MAX_HTML_BYTES)
        doc = html_to_tiptap(clean)["doc"]
        stripped = _strip_media(doc, "") or {"type": "doc", "content": []}
        nodes = list(stripped.get("content") or [])
    else:
        return []
    if cut:
        nodes.append(_para("(The rest of this email was cut: it was over the size limit.)"))
    return nodes


def _title(subject: Any) -> str:
    from api.services.journal_two import note_tasks, notes
    s = " ".join(subject.split()) if isinstance(subject, str) else ""
    if s:
        return s[:notes.MAX_TITLE_CHARS]
    return f"Email {note_tasks.today_et()}"


def _inbox_folder(user_id: str) -> str:
    """`Inbox` at the Notebook's top level, made the first time. On OUR
    connection, committed: `ensure_folder_path` with no connection never
    commits the folders it makes."""
    from api.services.journal_two import notes
    conn = get_connection()
    try:
        folder_id = notes.ensure_folder_path(user_id, [INBOX_FOLDER], conn=conn)
        conn.commit()
        return folder_id
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        conn.close()


def _decode(b64: Any, limit: int) -> bytes:
    if not isinstance(b64, str) or not b64:
        raise ValueError("it was empty")
    # The decoded size is known from the encoded length: refuse before decoding.
    if (len(b64) * 3) // 4 > limit + 3:
        raise OverflowError("it is larger than the limit")
    try:
        return base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ValueError("it could not be read") from e


def _save_attachment(user_id: str, note_id: str, att: Any) -> dict[str, Any]:
    """One attachment -> {"node": <body node>} or {"line": <refusal sentence>}.
    ⛔ NEVER RAISES: a refused attachment is one line in the note, never a
    failed email."""
    from api.services.journal_two import document_extraction, notes

    if not isinstance(att, dict):
        return {"line": "Attachment not saved: it could not be read."}
    name = str(att.get("name") or "attachment").strip()[:200] or "attachment"
    ctype = str(att.get("content_type") or "").split(";")[0].strip().lower()
    if ctype in ("image/heic", "image/heif"):
        return {"line": f"Attachment not saved: {name} — HEIC photos aren't accepted. "
                        "Send it as a JPEG instead."}
    is_image = ctype in notes._ALLOWED_IMAGE_MIMES
    if not is_image and ctype not in notes._ALLOWED_FILE_MIMES:
        return {"line": f"Attachment not saved: {name} — this kind of file isn't accepted."}
    limit = notes._MAX_IMAGE_BYTES if is_image else notes._MAX_FILE_BYTES
    try:
        data = _decode(att.get("base64"), limit)
    except (ValueError, OverflowError) as e:
        return {"line": f"Attachment not saved: {name} — {e}."}
    try:
        if is_image:
            saved = notes.save_note_image_bytes(user_id, note_id, data, name, ctype, kind="inline")
            node = {"type": "image", "attrs": {"src": saved["url"], "alt": name}}
        else:
            saved = notes.save_note_attachment_bytes(user_id, note_id, data, name, ctype)
            node = {"type": "attachmentChip",
                    "attrs": {"href": saved["url"], "name": saved["name"], "size": saved["size"]}}
    except notes.NoteValidationError as e:
        return {"line": f"Attachment not saved: {name} — {e}"}
    except Exception as e:  # noqa: BLE001 — one attachment, never the email
        log.warning("[inbound-email] attachment save failed: %s", type(e).__name__)
        return {"line": f"Attachment not saved: {name} — it could not be stored."}
    # Like any other upload: the seam decides whether it becomes a searchable
    # document (PDF today; image OCR and docx behind their own gate).
    try:
        document_extraction.on_attachment_saved(
            user_id, note_id, saved, ctype, kind="image" if is_image else "file")
    except Exception as e:  # noqa: BLE001 — extraction never costs the attachment
        log.warning("[inbound-email] document hand-off failed: %s", type(e).__name__)
    return {"node": node}


def ingest(payload: dict[str, Any]) -> dict[str, Any]:
    """Turn one signed, parsed email into a note. Returns what happened; the
    router answers the worker identically whatever it is.

    ⛔ The note is made FIRST (an attachment's storage path needs the note's
    id), then its attachments are saved and the body is written once more with
    them, as a compare-and-set against the revision just created."""
    from api.services.journal_two import notes

    user_id = resolve(recipient_token(payload.get("to")))
    if user_id is None:
        return {"status": "dropped"}
    body = _body_nodes(payload.get("text"), payload.get("html"))
    folder_id = _inbox_folder(user_id)
    fields = {"title": _title(payload.get("subject")), "folderId": folder_id}
    try:
        note = notes.create_note(user_id, {**fields, "bodyJson": {"type": "doc", "content": body}})
    except notes.NoteValidationError:
        body = [_para("This email couldn't be imported as text. Its attachments, if any, are below.")]
        note = notes.create_note(user_id, {**fields, "bodyJson": {"type": "doc", "content": body}})

    atts = payload.get("attachments") or []
    if not isinstance(atts, list):
        atts = []
    extra: list[dict[str, Any]] = []
    for att in atts[:MAX_ATTACHMENTS]:
        out = _save_attachment(user_id, note["id"], att)
        extra.append(out["node"] if "node" in out else _para(out["line"]))
    if len(atts) > MAX_ATTACHMENTS:
        extra.append(_para(f"{len(atts) - MAX_ATTACHMENTS} more attachments were not saved "
                           f"(the limit is {MAX_ATTACHMENTS} per email)."))
    if extra:
        try:
            notes.update_note(
                user_id, note["id"], {"bodyJson": {"type": "doc", "content": body + extra}},
                expected_updated_at=note["updatedAt"])
        except notes.NoteConflictError:
            log.warning("[inbound-email] note changed before its attachments were linked")
    return {"status": "created", "note_id": note["id"], "user_id": user_id}
