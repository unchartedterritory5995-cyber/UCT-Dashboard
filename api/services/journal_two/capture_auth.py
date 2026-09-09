"""Wave L Slice 3 — the scoped Browser Capture credential.

⛔ WHAT THIS IS NOT. It is not a session, not a PAT, not an API key, and not a
general-purpose bearer. It authorizes exactly the external-capture operations
the browser extension performs and nothing else, for exactly one member, until
it expires or is revoked. `get_current_user` is deliberately untouched: an
extension credential must never satisfy an ordinary authenticated endpoint, so
the resolver here is reached ONLY through `require_capture_scope`, which only
the allow-listed Browser Capture routes depend on.
`tests/test_capture_auth_boundary.py` is the structural rail on that.

⛔ THE PRIOR ART IS A TRAP, NAMED HERE SO IT IS NOT "REUSED" LATER. The calendar
export token is `hmac(PUSH_SECRET, user_id)` — its own comment says "Stable per
user (no TTL)". Copying that shape would produce a derived, never-expiring,
non-revocable WRITE credential: revoking it means rotating `PUSH_SECRET`, which
breaks every member's calendar subscription at once. It protects a read-only
feed. This does not copy it.

DAMAGE CONTAINMENT, NOT SECRECY (the honest security claim). An extension
compromise CAN steal this token — it lives in `chrome.storage.local`, which
extension JavaScript can read by definition. What the design buys is the
ceiling on what a stolen one is worth: authorized external Notebook capture for
that one member, until expiry or revocation, with no read of their notes, no
account access, and no session.

TTL — DERIVED, NOT PICKED (§3). The session cookie this credential is strictly
weaker than is `max_age=30 days` (`auth.py::_set_session_cookie`). A capture
token that outlived the session would be the longest-lived member credential in
the system, which inverts the whole point, so 30 days is the ceiling and is what
is used. It is an ABSOLUTE expiry, not a sliding one: use does not extend it, so
a stolen token's worth is bounded by a wall-clock date rather than by how
quietly it is used.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from api.services.auth_db import get_connection

# ── Scopes ───────────────────────────────────────────────────────────────────
# Two, and they are separate on purpose (§18). Writing a capture and reading the
# list of places one may go are different authorities; a single "capture" scope
# that also read the Notebook is exactly the casual widening the ruling forbids.
SCOPE_CAPTURE_WRITE = "notebook:capture:write"
SCOPE_DESTINATIONS_READ = "notebook:capture:destinations:read"

# What connecting the extension grants. Deliberately a frozen literal rather
# than "whatever the client asked for" — a client does not choose its own
# authority.
GRANTED_SCOPES = (SCOPE_CAPTURE_WRITE, SCOPE_DESTINATIONS_READ)
KNOWN_SCOPES = frozenset(GRANTED_SCOPES)

CLIENT_TYPE = "browser_capture_extension"
CLIENT_ID = "uct-browser-capture"

# ── Lifetimes ────────────────────────────────────────────────────────────────
TOKEN_TTL_DAYS = 30            # see module docstring — bounded BY the session's own TTL
AUTH_CODE_TTL_SECONDS = 120    # a hand-off, not a credential: seconds, not minutes
# The 524 lesson (`auth_service._should_write_last_login`): never do an
# unthrottled per-request DB write on an auth path. `last_used_at` is a
# diagnostic, so it is worth 5-minute granularity and not one write per capture.
LAST_USED_WRITE_INTERVAL_SECONDS = 300

TOKEN_PREFIX = "uctcap_"       # a LABEL, never a claim: the server trusts nothing in it


class CaptureAuthError(Exception):
    """Refused. The message is member-safe and names no secret."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _parse(ts: str | None) -> Optional[datetime]:
    if not ts:
        return None
    try:
        parsed = datetime.fromisoformat(ts)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _hash(secret: str) -> str:
    """SHA-256 hex of the bearer secret. THE DATABASE STORES ONLY THIS.

    Lookup is BY digest, so verification is an indexed equality on a
    fixed-length hash of the presented value — there is no comparison of a raw
    secret against a stored one anywhere, which is what makes the timing
    question moot rather than merely handled. A database leak yields digests of
    256-bit random strings: not usable credentials, and not brute-forcible.
    """
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


# ── Redirect-URI policy (the confused-deputy boundary, §15) ──────────────────
# Chromium hands `chrome.identity.launchWebAuthFlow` a redirect target of
# https://<extension-id>.chromiumapp.org/ — an origin only THAT extension can
# receive on. Validating it is what stops an arbitrary page from steering a
# freshly minted code to itself: the member's own click cannot deliver a code
# anywhere but to the extension it was minted for.
_REDIRECT_RE = re.compile(r"^https://([a-p]{32})\.chromiumapp\.org/?$")


def allowed_extension_ids() -> frozenset[str]:
    """Extension ids permitted to complete the handshake.

    Unset means "any well-formed chromiumapp.org id", which is the right
    default for local development and for an unlisted extension whose id is not
    yet fixed — the redirect can still only reach an extension, never a web
    page. Set `CAPTURE_EXTENSION_IDS` in production to pin it to ours.
    """
    raw = os.environ.get("CAPTURE_EXTENSION_IDS", "")
    return frozenset(p.strip() for p in raw.split(",") if p.strip())


def validate_redirect_uri(redirect_uri: str | None) -> str:
    if not redirect_uri or not isinstance(redirect_uri, str):
        raise CaptureAuthError("A redirect target is required")
    m = _REDIRECT_RE.match(redirect_uri.strip())
    if not m:
        raise CaptureAuthError("That redirect target is not a browser extension")
    allowed = allowed_extension_ids()
    if allowed and m.group(1) not in allowed:
        raise CaptureAuthError("That extension is not authorized")
    return redirect_uri.strip()


# ── Schema ───────────────────────────────────────────────────────────────────
# Idempotent DDL, called from db.ensure_schema (which runs on every boot) and
# safe to call directly from a test.
_CAPTURE_AUTH_DDL = """
CREATE TABLE IF NOT EXISTS j2_capture_tokens (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    token_hash    TEXT NOT NULL UNIQUE,
    scopes        TEXT NOT NULL,
    client_type   TEXT NOT NULL,
    label         TEXT,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    revoked_at    TEXT,
    last_used_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_j2_capture_tokens_user
    ON j2_capture_tokens(user_id);

CREATE TABLE IF NOT EXISTS j2_capture_auth_codes (
    code_hash     TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    client_id     TEXT NOT NULL,
    redirect_uri  TEXT NOT NULL,
    scopes        TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    consumed_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_j2_capture_auth_codes_user
    ON j2_capture_auth_codes(user_id);
"""


def ensure_capture_auth_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_CAPTURE_AUTH_DDL)


# ── The handshake ────────────────────────────────────────────────────────────

def mint_authorization_code(
    user_id: str,
    redirect_uri: str,
    client_id: str = CLIENT_ID,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Step 1. A first-party, session-authenticated member deliberately
    connecting the extension. Returns a single-use code, NOT a credential."""
    redirect_uri = validate_redirect_uri(redirect_uri)
    if client_id != CLIENT_ID:
        raise CaptureAuthError("Unknown client")
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_capture_auth_schema(conn)
        now = _now()
        code = secrets.token_urlsafe(32)
        conn.execute(
            "INSERT INTO j2_capture_auth_codes "
            "(code_hash, user_id, client_id, redirect_uri, scopes, created_at, expires_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (_hash(code), user_id, client_id, redirect_uri, " ".join(GRANTED_SCOPES),
             _iso(now), _iso(now + timedelta(seconds=AUTH_CODE_TTL_SECONDS))),
        )
        conn.commit()
        return {"code": code, "expiresIn": AUTH_CODE_TTL_SECONDS}
    finally:
        if owned:
            conn.close()


def exchange_authorization_code(
    code: str,
    redirect_uri: str,
    client_id: str = CLIENT_ID,
    label: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Step 2. Code → scoped token, ONCE.

    ⛔ The code is consumed by a CONDITIONAL UPDATE, not by a read-then-write:
    `WHERE consumed_at IS NULL` makes the claim atomic, so two simultaneous
    exchanges of one code cannot both win. A replay is refused because the row
    is already spent, not because we happened to look first.
    """
    if not code or not isinstance(code, str):
        raise CaptureAuthError("Authorization code is required")
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_capture_auth_schema(conn)
        now = _now()
        code_hash = _hash(code)
        cur = conn.execute(
            "UPDATE j2_capture_auth_codes SET consumed_at = ? "
            "WHERE code_hash = ? AND consumed_at IS NULL",
            (_iso(now), code_hash),
        )
        if not cur.rowcount:
            conn.commit()
            # ONE message for "no such code", "already used" and "expired": a
            # caller learns nothing about which, and there is nothing here worth
            # a distinguishable answer.
            raise CaptureAuthError("That authorization is no longer valid")
        row = conn.execute(
            "SELECT * FROM j2_capture_auth_codes WHERE code_hash = ?", (code_hash,)
        ).fetchone()
        expires = _parse(row["expires_at"])
        if expires is None or expires <= now:
            conn.commit()   # stays consumed: an expired code is spent, not reusable
            raise CaptureAuthError("That authorization is no longer valid")
        if row["client_id"] != client_id or row["redirect_uri"] != (redirect_uri or "").strip():
            conn.commit()
            raise CaptureAuthError("That authorization is no longer valid")

        token = TOKEN_PREFIX + secrets.token_urlsafe(32)
        token_id = secrets.token_hex(16)
        expires_at = now + timedelta(days=TOKEN_TTL_DAYS)
        conn.execute(
            "INSERT INTO j2_capture_tokens "
            "(id, user_id, token_hash, scopes, client_type, label, created_at, expires_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (token_id, row["user_id"], _hash(token), row["scopes"], CLIENT_TYPE,
             (label or "Browser Capture")[:80], _iso(now), _iso(expires_at)),
        )
        conn.commit()
        return {
            "token": token,
            "tokenId": token_id,
            "scopes": row["scopes"].split(),
            "expiresAt": _iso(expires_at),
        }
    finally:
        if owned:
            conn.close()


# ── Resolution ───────────────────────────────────────────────────────────────

def resolve_token(
    presented: str | None,
    conn: sqlite3.Connection | None = None,
) -> Optional[dict[str, Any]]:
    """Presented bearer → the ONE member it belongs to, or None.

    Fails closed on every path: unknown, malformed, revoked, expired. The
    caller never supplies a user id — this is the only thing that produces one
    for an extension request, which is what keeps tenant isolation exactly
    where Slice 1 put it.
    """
    if not presented or not isinstance(presented, str):
        return None
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_capture_auth_schema(conn)
        row = conn.execute(
            "SELECT * FROM j2_capture_tokens WHERE token_hash = ?",
            (_hash(presented.strip()),),
        ).fetchone()
        if row is None:
            return None
        if row["revoked_at"]:
            return None
        expires = _parse(row["expires_at"])
        now = _now()
        if expires is None or expires <= now:
            return None
        last = _parse(row["last_used_at"])
        if last is None or (now - last).total_seconds() >= LAST_USED_WRITE_INTERVAL_SECONDS:
            conn.execute("UPDATE j2_capture_tokens SET last_used_at = ? WHERE id = ?",
                         (_iso(now), row["id"]))
            conn.commit()
        return {
            "user_id": row["user_id"],
            "token_id": row["id"],
            "scopes": frozenset(row["scopes"].split()),
            "client_type": row["client_type"],
        }
    finally:
        if owned:
            conn.close()


# ── Member-facing management (§16) ───────────────────────────────────────────

def list_connections(user_id: str, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """What the member sees in Settings. NEVER the token, and never its hash —
    a hash of a live credential is still a fact about that credential and has
    no place in a UI response."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_capture_auth_schema(conn)
        rows = conn.execute(
            "SELECT id, label, client_type, created_at, expires_at, revoked_at, last_used_at, scopes "
            "FROM j2_capture_tokens WHERE user_id = ? AND revoked_at IS NULL "
            "ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
        now = _now()
        out = []
        for r in rows:
            expires = _parse(r["expires_at"])
            out.append({
                "id": r["id"],
                "label": r["label"] or "Browser Capture",
                "clientType": r["client_type"],
                "createdAt": r["created_at"],
                "expiresAt": r["expires_at"],
                "lastUsedAt": r["last_used_at"],
                "scopes": r["scopes"].split(),
                "expired": bool(expires is None or expires <= now),
            })
        return out
    finally:
        if owned:
            conn.close()


def revoke_connection(user_id: str, token_id: str, conn: sqlite3.Connection | None = None) -> bool:
    """Revoke ONE credential. Scoped by user_id in the WHERE clause, so a member
    can only ever revoke their own — and revoking it logs nobody out, rotates no
    shared secret, and touches no other member or device."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        ensure_capture_auth_schema(conn)
        cur = conn.execute(
            "UPDATE j2_capture_tokens SET revoked_at = ? "
            "WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
            (_iso(_now()), token_id, user_id),
        )
        conn.commit()
        return bool(cur.rowcount)
    finally:
        if owned:
            conn.close()


def purge_user(user_id: str, conn: sqlite3.Connection) -> None:
    """Account deletion (§4). Both tables are also listed in
    `account_purge._DIRECT_USER_TABLES`, which is where deletion is actually
    wired; this helper exists for direct callers and for tests."""
    ensure_capture_auth_schema(conn)
    conn.execute("DELETE FROM j2_capture_tokens WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM j2_capture_auth_codes WHERE user_id = ?", (user_id,))
