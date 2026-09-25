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
import json
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

# ── Limits (wave 7 fix round 1, I-1) ─────────────────────────────────────────
#
# ⛔ ANYONE WHO HOLDS AN ADDRESS CAN SEND TO IT, and an address leaks in
# ordinary ways (a CC, a forwarding rule, a mailing list). Before these limits
# the only bound was the volume-wide import floor in `notes_quota` -- a flood
# to one address could fill the shared /data volume for every member.
#
# Two keys, each with a MESSAGE RATE (per rolling hour) and a VOLUME (bytes of
# signed request body per rolling day):
#   * the ADDRESS -- what a flood to a leaked address hits first;
#   * the MEMBER -- every address they have had, so ROTATING (the member's own
#     remedy for a leak) cannot also be a way to multiply the allowance.
# Over a limit the mail is answered EXACTLY like any other (202, dropped), so
# there is still no oracle, and the drop is RECORDED (a counter row per member,
# day and reason in `j2_inbound_drops`, plus a log line).
#
# ⭐ DURABLE, NOT PER-PROCESS: the window lives in auth.db (`j2_inbound_usage`,
# pruned to one day on every write), so a restart does not reset it and a
# second web process would share it. Changing a limit is a code change.
ADDRESS_MAX_MESSAGES_PER_HOUR = 20
ADDRESS_MAX_BYTES_PER_DAY = 50 * 1024 * 1024
MEMBER_MAX_MESSAGES_PER_HOUR = 40
MEMBER_MAX_BYTES_PER_DAY = 100 * 1024 * 1024
_HOUR = 3600
_DAY = 86400
DROP_RETENTION_DAYS = 30

DROP_ADDRESS_RATE = "address_rate"
DROP_ADDRESS_VOLUME = "address_volume"
DROP_MEMBER_RATE = "member_rate"
DROP_MEMBER_VOLUME = "member_volume"
DROP_NOT_PAID = "not_paid"

_DDL = """
CREATE TABLE IF NOT EXISTS j2_inbound_addresses (
    user_id     TEXT PRIMARY KEY,
    token       TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL,
    rotated_at  TEXT
);
CREATE TABLE IF NOT EXISTS j2_inbound_usage (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      TEXT NOT NULL,
    address_key  TEXT NOT NULL,
    received_at  REAL NOT NULL,
    bytes        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_j2_inbound_usage_user
    ON j2_inbound_usage (user_id, received_at);
CREATE INDEX IF NOT EXISTS idx_j2_inbound_usage_address
    ON j2_inbound_usage (address_key, received_at);
CREATE TABLE IF NOT EXISTS j2_inbound_drops (
    user_id  TEXT NOT NULL,
    day      TEXT NOT NULL,
    reason   TEXT NOT NULL,
    count    INTEGER NOT NULL DEFAULT 0,
    bytes    INTEGER NOT NULL DEFAULT 0,
    last_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, day, reason)
);
CREATE TABLE IF NOT EXISTS j2_inbound_seen (
    signature_key  TEXT PRIMARY KEY,
    expires_at     REAL NOT NULL
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

def get_address(user_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """The member's address, or None when they have never made one. READ-ONLY:
    ⛔ it never mints (whole-branch review M-10) -- viewing Settings must not
    hand a paid member a live write capability they never asked for. The
    member makes one with `rotate` (the POST), which creates the first."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_inbound_schema(conn)
        row = conn.execute(
            "SELECT token, created_at, rotated_at FROM j2_inbound_addresses WHERE user_id = ?",
            (user_id,)).fetchone()
        return _public(row) if row else None
    finally:
        if owned:
            conn.close()


def get_or_create_address(user_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """The member's address, minted if there is none. ⛔ NOT a door any more:
    the address GET answers from `get_address` and never mints (review M-10);
    this stays for callers that must have one (the tests' fixtures)."""
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
    """Create the member's address, or replace it. The address POST's one
    action: the first call makes it (the member's own act -- review M-10), every
    later call rotates it and the old one stops working at once: mail to it is
    accepted and dropped like mail to any address that never existed."""
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
    one that does not match.

    ⛔ AND NO BRANCH RAISES: this runs on an unauthenticated door, and a 500
    there is an answer a caller can tell apart from the bare 401. Header bytes
    arrive as latin-1, so `'²'` (0xB2) passes `isdigit()` and then breaks
    `int()`; a 5,000-digit timestamp breaks `int()` too; and a non-ASCII
    signature makes `compare_digest` raise on two `str`s. Hence ASCII decimal
    digits only, at most 12 of them, and the digests compared as BYTES."""
    if not secret or not timestamp or not signature:
        return False
    if not (timestamp.isascii() and timestamp.isdecimal() and len(timestamp) <= 12):
        return False
    now = time.time() if now is None else now
    if abs(now - int(timestamp)) > REPLAY_WINDOW_SECONDS:
        return False
    try:
        given = signature.strip().lower().encode("ascii")
    except UnicodeEncodeError:
        return False
    expected = expected_signature(secret, timestamp, raw_body).encode("ascii")
    return hmac.compare_digest(expected, given)


# ── One delivery per signature (whole-branch review M-6) ─────────────────────
#
# ⚰️ A captured signed request verifies for its whole window (±5 minutes), so it
# could be REPLAYED -- and every replay passed `admit()`, spending the address's
# rolling 20/hour. The member's genuine mail was then silently dropped for up
# to an hour, besides the note being made twenty times. (The setup doc said a
# replay "would make a second copy of the note".) Now a signature is delivered
# ONCE: the router claims it after it verifies and before anything is parsed
# or charged; a second arrival is answered like any other request (202 -- no
# oracle) and makes nothing. The Email Worker signs every POST afresh, so a
# genuine retry never carries an old signature.
#
# DURABLE (auth.db, `j2_inbound_seen`), holding a HASH of the signature (never
# the signature itself) until the instant it could no longer verify, pruned on
# every claim. It names no member, so it is not in the account purge.

def _signature_key(signature: str) -> str:
    return hashlib.sha256(signature.strip().lower().encode("ascii", "ignore")).hexdigest()[:40]


def claim_delivery(signature: str, timestamp: str, *, now: float | None = None,
                   conn: sqlite3.Connection | None = None) -> bool:
    """True the FIRST time a verified signature is presented, False for every
    later arrival while it could still verify. Call only AFTER
    `verify_signature` passed: an unverified request is never recorded."""
    now = time.time() if now is None else float(now)
    expires = int(timestamp) + REPLAY_WINDOW_SECONDS + 1
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_inbound_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM j2_inbound_seen WHERE expires_at < ?", (now,))
        cur = conn.execute(
            "INSERT OR IGNORE INTO j2_inbound_seen (signature_key, expires_at) VALUES (?, ?)",
            (_signature_key(signature), float(expires)))
        conn.commit()
        return cur.rowcount == 1
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()


# ── Limits ───────────────────────────────────────────────────────────────────

def _address_key(token: str) -> str:
    """The address, as the usage table knows it: a hash, so the table that
    outlives rotations never holds a second copy of a live credential."""
    return hashlib.sha256(token.encode("ascii", "ignore")).hexdigest()[:32]


def admit(user_id: str, token: str, size: int, *, now: float | None = None,
          conn: sqlite3.Connection | None = None) -> str | None:
    """Count one email against its address's and its member's limits.

    Returns None when it is ADMITTED (and counted), or the reason it was
    DROPPED (and recorded). One `BEGIN IMMEDIATE` transaction: read the
    windows, decide, write -- so two emails arriving together cannot both read
    the same count and both slip under it. Dropped mail does not count against
    the allowance (a flood must not keep the window full by itself)."""
    now = time.time() if now is None else float(now)
    size = max(0, int(size))
    key = _address_key(token)
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_inbound_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM j2_inbound_usage WHERE received_at < ?", (now - _DAY,))

        def window(column: str, value: str) -> tuple[int, int]:
            msgs = conn.execute(
                f"SELECT COUNT(*) FROM j2_inbound_usage WHERE {column} = ? AND received_at >= ?",
                (value, now - _HOUR)).fetchone()[0]
            used = conn.execute(
                f"SELECT COALESCE(SUM(bytes), 0) FROM j2_inbound_usage"
                f" WHERE {column} = ? AND received_at >= ?",
                (value, now - _DAY)).fetchone()[0]
            return int(msgs), int(used)

        a_msgs, a_bytes = window("address_key", key)
        m_msgs, m_bytes = window("user_id", user_id)
        reason = None
        if a_msgs >= ADDRESS_MAX_MESSAGES_PER_HOUR:
            reason = DROP_ADDRESS_RATE
        elif a_bytes + size > ADDRESS_MAX_BYTES_PER_DAY:
            reason = DROP_ADDRESS_VOLUME
        elif m_msgs >= MEMBER_MAX_MESSAGES_PER_HOUR:
            reason = DROP_MEMBER_RATE
        elif m_bytes + size > MEMBER_MAX_BYTES_PER_DAY:
            reason = DROP_MEMBER_VOLUME
        if reason is None:
            conn.execute(
                "INSERT INTO j2_inbound_usage (user_id, address_key, received_at, bytes)"
                " VALUES (?, ?, ?, ?)", (user_id, key, now, size))
        else:
            _record_drop(conn, user_id, reason, size, now)
        conn.commit()
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
    if reason is not None:
        log.warning("[inbound-email] dropped for %s: %s (%s bytes)", user_id, reason, size)
    return reason


def _record_drop(conn: sqlite3.Connection, user_id: str, reason: str, size: int,
                 now: float) -> None:
    """One counter row per member, UTC day and reason -- bounded however hard
    the address is flooded -- pruned to `DROP_RETENTION_DAYS`."""
    stamp = datetime.fromtimestamp(now, timezone.utc)
    day = stamp.strftime("%Y-%m-%d")
    cutoff = datetime.fromtimestamp(now - DROP_RETENTION_DAYS * _DAY, timezone.utc).strftime(
        "%Y-%m-%d")
    conn.execute("DELETE FROM j2_inbound_drops WHERE day < ?", (cutoff,))
    conn.execute(
        "INSERT INTO j2_inbound_drops (user_id, day, reason, count, bytes, last_at)"
        " VALUES (?, ?, ?, 1, ?, ?)"
        " ON CONFLICT (user_id, day, reason) DO UPDATE SET"
        " count = count + 1, bytes = bytes + excluded.bytes, last_at = excluded.last_at",
        (user_id, day, reason, size, stamp.isoformat()))


def record_drop(user_id: str, reason: str, size: int, *, now: float | None = None) -> None:
    """Record a drop decided outside `admit` (the plan re-check)."""
    now = time.time() if now is None else float(now)
    conn = get_connection()
    try:
        ensure_inbound_schema(conn)
        _record_drop(conn, user_id, reason, max(0, int(size)), now)
        conn.commit()
    finally:
        conn.close()
    log.warning("[inbound-email] dropped for %s: %s", user_id, reason)


def drops(user_id: str) -> list[dict[str, Any]]:
    """The recorded drops for one member, newest day first."""
    conn = get_connection()
    try:
        ensure_inbound_schema(conn)
        rows = conn.execute(
            "SELECT day, reason, count, bytes, last_at FROM j2_inbound_drops"
            " WHERE user_id = ? ORDER BY day DESC, reason", (user_id,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def _member_can_receive(user_id: str) -> bool:
    """M-12: is this member still on a plan that includes email-in? The SAME
    predicate the address endpoints are gated on (`require_paid` ->
    `is_paid_user` over the user row plus `get_user_plan`), asked per email --
    so a lapsed member's address stops making notes the moment they could no
    longer see or rotate it. Any error answers no (fail closed)."""
    try:
        from api.middleware.auth_middleware import is_paid_user
        from api.services.auth_service import get_user_by_id, get_user_plan
        user = get_user_by_id(user_id)
        if not user:
            return False
        user["plan"] = get_user_plan(user_id)
        return bool(is_paid_user(user))
    except Exception as e:  # noqa: BLE001 — unknown is not paid
        log.warning("[inbound-email] plan check failed: %s", type(e).__name__)
        return False


# ── Building the note ────────────────────────────────────────────────────────

def _truncate_utf8(text: str, limit: int) -> tuple[str, bool]:
    data = text.encode("utf-8")
    if len(data) <= limit:
        return text, False
    return data[:limit].decode("utf-8", errors="ignore"), True


def _para(text: str) -> dict[str, Any]:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


FALLBACK_SENTENCE = "(This email's formatting couldn't be kept, so here is its text.)"
_TAG_RE = re.compile(r"<[^>]*>")


def _converted_body(text: Any, html: Any) -> list[dict[str, Any]]:
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


def _plain_body(text: Any, html: Any) -> list[dict[str, Any]]:
    """The email as plain paragraphs, built with no parser at all: the text
    part if there is one, else the HTML with its tags removed. What is kept
    when the converters cannot cope (see `_body_nodes`)."""
    import html as html_lib

    if isinstance(text, str) and text.strip():
        raw, _cut = _truncate_utf8(text.replace("\r\n", "\n"), MAX_TEXT_BYTES)
    elif isinstance(html, str) and html.strip():
        clipped, _cut = _truncate_utf8(html, MAX_HTML_BYTES)
        raw = html_lib.unescape(_TAG_RE.sub("\n", clipped))
    else:
        return []
    lines = [" ".join(ln.split()) for ln in raw.split("\n")]
    paras = [_para(ln) for ln in lines if ln]
    return [_para(FALLBACK_SENTENCE)] + paras if paras else []


def _body_nodes(text: Any, html: Any) -> list[dict[str, Any]]:
    """The note body for an email, and NEVER a raise.

    ⛔ An email whose body the converters cannot handle still becomes a note.
    ⚰️ `html_to_tiptap` raised RecursionError on 2,000 nested `<div>`s (about
    10 KB of HTML); `ingest` raised, the door answered 500, the worker threw
    and the email bounced with nothing kept -- while a refused ATTACHMENT was
    already "one line, never a failure". The body now falls back to plain
    paragraphs the same way."""
    try:
        return _converted_body(text, html)
    except Exception as e:  # noqa: BLE001 — RecursionError included; keep the words
        log.warning("[inbound-email] body conversion failed (%s); kept as plain text",
                    type(e).__name__)
        return _plain_body(text, html)


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


def _create_email_note(user_id: str, fields: dict[str, Any], body: list[dict[str, Any]],
                       payload: dict[str, Any]) -> dict[str, Any]:
    """`notes.create_note`, falling back to a body that cannot fail: a body the
    Notebook refuses becomes one explanatory line, and one too deeply nested to
    store becomes plain paragraphs."""
    from api.services.journal_two import notes

    def create(nodes: list[dict[str, Any]]) -> dict[str, Any]:
        return notes.create_note(user_id, {**fields, "bodyJson": {"type": "doc", "content": nodes}})

    try:
        return create(body)
    except notes.NoteValidationError:
        return create([_para("This email couldn't be imported as text. "
                             "Its attachments, if any, are below.")])
    except RecursionError:
        return create(_plain_body(payload.get("text"), payload.get("html")))


def ingest(payload: dict[str, Any], *, size: int | None = None) -> dict[str, Any]:
    """Turn one signed, parsed email into a note. Returns what happened; the
    router answers the worker identically whatever it is.

    In order: the address picks the member (unknown -> dropped); the member
    must still be on a plan that includes email-in (M-12); the address's and
    the member's limits are charged (`admit`, I-1); only then is anything
    parsed or written. `size` is the signed request body's length, which is
    what the volume limit counts (a direct caller that omits it is charged the
    payload's JSON length).

    ⛔ The note is made FIRST (an attachment's storage path needs the note's
    id), then its attachments are saved and APPENDED to whatever the note holds
    by then, inside `BEGIN IMMEDIATE` (`note_personal_api.append_nodes`, the
    same read-and-append the personal API uses). ⚰️ It used to REPLACE the body
    with the pre-create body plus the attachments as a compare-and-set, and on
    a conflict only logged: the files stayed on disk, unlinked, and no line in
    the note said so."""
    from api.services.journal_two.note_personal_api import PersonalApiError, append_nodes

    token = recipient_token(payload.get("to"))
    user_id = resolve(token)
    if user_id is None:
        return {"status": "dropped"}
    if size is None:
        size = len(json.dumps(payload).encode("utf-8"))
    if not _member_can_receive(user_id):
        record_drop(user_id, DROP_NOT_PAID, size)
        return {"status": "dropped", "reason": DROP_NOT_PAID}
    reason = admit(user_id, token, size)
    if reason is not None:
        return {"status": "dropped", "reason": reason}

    body = _body_nodes(payload.get("text"), payload.get("html"))
    folder_id = _inbox_folder(user_id)
    fields = {"title": _title(payload.get("subject")), "folderId": folder_id}
    note = _create_email_note(user_id, fields, body, payload)

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
            append_nodes(user_id, note["id"], extra)
        except PersonalApiError as e:
            # The note was deleted or locked in the milliseconds since it was
            # made. The files are saved; say so in the log with the reason.
            log.warning("[inbound-email] attachments not linked (%s): %s", e.status, e.message)
    return {"status": "created", "note_id": note["id"], "user_id": user_id}
