"""
TOTP two-factor authentication (RFC 6238) + one-time backup codes.

Login flow: POST /api/auth/login answers {requires_totp, challenge_token}
instead of a session when the account has 2FA enabled; the client then posts
the 6-digit authenticator code (or a backup code) together with that token to
/api/auth/login/totp-verify, which issues the real session.

Storage (auth.db):
  user_totp          — one row per enrolled user. The TOTP secret is Fernet-
                       encrypted at rest via crypto_box (BROKER_ENCRYPTION_KEY,
                       the same rail broker userSecrets ride). last_used_step
                       blocks replay of an already-consumed code inside its
                       30-second window.
  user_backup_codes  — 10 single-use recovery codes, stored as SHA-256 digests
                       bound to the user id. Codes are high-entropy random
                       (unlike passwords), so a fast hash is cryptographically
                       sufficient and keeps the login path cheap.

Challenge tokens are stateless HMAC blobs (5-minute TTL), so the login hot
path takes ZERO extra DB writes — see the 2026-07-01 launch-hardening rule
about per-request writes on the auth path.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from datetime import datetime, timezone

import pyotp
import qrcode
import qrcode.image.svg

from api.services import crypto_box
from api.services.auth_db import get_connection

ISSUER = "UCT Intelligence"
CHALLENGE_TTL_SECONDS = 300
TOTP_STEP_SECONDS = 30
BACKUP_CODE_COUNT = 10
# No 0/O, 1/I/L — codes get read off paper.
_BACKUP_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS user_totp (
    user_id          TEXT PRIMARY KEY,
    secret_encrypted TEXT NOT NULL,
    enabled          INTEGER NOT NULL DEFAULT 0,
    last_used_step   INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_backup_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    TEXT NOT NULL,
    code_hash  TEXT NOT NULL,
    used_at    TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user ON user_backup_codes(user_id);
"""

_schema_ready = False


def _ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    conn = get_connection()
    try:
        conn.executescript(_SCHEMA)
        conn.commit()
        _schema_ready = True
    finally:
        conn.close()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_available() -> bool:
    """2FA needs the at-rest encryption key; without it we refuse to enroll
    rather than store TOTP secrets in plaintext."""
    return crypto_box.is_configured()


# ── Status / lookups ─────────────────────────────────────────────────────────

def _load(user_id: str) -> dict | None:
    _ensure_schema()
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT user_id, secret_encrypted, enabled, last_used_step, created_at "
            "FROM user_totp WHERE user_id = ?", (user_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def is_enabled(user_id: str) -> bool:
    row = _load(user_id)
    return bool(row and row["enabled"])


def backup_codes_remaining(user_id: str) -> int:
    _ensure_schema()
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM user_backup_codes "
            "WHERE user_id = ? AND used_at IS NULL", (user_id,)
        ).fetchone()
        return int(row["n"] if row else 0)
    finally:
        conn.close()


def status(user_id: str) -> dict:
    row = _load(user_id)
    enabled = bool(row and row["enabled"])
    return {
        "available": is_available(),
        "enabled": enabled,
        "created_at": row["created_at"] if enabled else None,
        "backup_codes_remaining": backup_codes_remaining(user_id) if enabled else 0,
    }


# ── Enrollment ───────────────────────────────────────────────────────────────

def begin_setup(user_id: str, email: str) -> dict:
    """Issue a fresh pending secret (re-callable until confirmed) and return
    what the setup wizard needs: the otpauth URL, a QR as inline SVG, and the
    base32 secret for manual entry."""
    if not is_available():
        raise RuntimeError("2FA is not available: encryption key unconfigured")
    row = _load(user_id)
    if row and row["enabled"]:
        raise ValueError("Two-factor authentication is already enabled")
    secret = pyotp.random_base32()
    enc = crypto_box.encrypt(secret)
    _ensure_schema()
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO user_totp (user_id, secret_encrypted, enabled, last_used_step, created_at) "
            "VALUES (?, ?, 0, 0, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET secret_encrypted = excluded.secret_encrypted, "
            "enabled = 0, last_used_step = 0, created_at = excluded.created_at",
            (user_id, enc, _now_iso()),
        )
        conn.commit()
    finally:
        conn.close()
    uri = pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=ISSUER)
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage)
    return {"secret": secret, "otpauth_url": uri, "qr_svg": img.to_string(encoding="unicode")}


def confirm_setup(user_id: str, code: str, now: float | None = None) -> list[str]:
    """Verify the first code against the pending secret; on success flip the
    row to enabled and mint the backup codes (returned in plaintext exactly
    once)."""
    row = _load(user_id)
    if not row:
        raise ValueError("Start setup first")
    if row["enabled"]:
        raise ValueError("Two-factor authentication is already enabled")
    secret = crypto_box.decrypt(row["secret_encrypted"])
    step = _match_step(secret, code, now=now)
    if step is None:
        raise ValueError("That code didn't match — check your authenticator app")
    _ensure_schema()
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE user_totp SET enabled = 1, last_used_step = ? WHERE user_id = ?",
            (step, user_id),
        )
        codes = _issue_backup_codes(conn, user_id)
        conn.commit()
        return codes
    finally:
        conn.close()


def disable(user_id: str) -> None:
    """Remove enrollment + all backup codes. Caller is responsible for
    re-authenticating the user (password AND a valid code) first."""
    _ensure_schema()
    conn = get_connection()
    try:
        conn.execute("DELETE FROM user_totp WHERE user_id = ?", (user_id,))
        conn.execute("DELETE FROM user_backup_codes WHERE user_id = ?", (user_id,))
        conn.commit()
    finally:
        conn.close()


# ── Backup codes ─────────────────────────────────────────────────────────────

def _format_code(raw: str) -> str:
    return f"{raw[:4]}-{raw[4:]}"


def _normalize_backup(code: str) -> str:
    return "".join(ch for ch in (code or "").upper() if ch.isalnum())


def _hash_backup(user_id: str, normalized: str) -> str:
    return hashlib.sha256(f"{user_id}:{normalized}".encode("utf-8")).hexdigest()


def _issue_backup_codes(conn, user_id: str) -> list[str]:
    """Replace any existing codes with a fresh set of 10. Uses the caller's
    connection/transaction."""
    conn.execute("DELETE FROM user_backup_codes WHERE user_id = ?", (user_id,))
    now = _now_iso()
    plain: list[str] = []
    for _ in range(BACKUP_CODE_COUNT):
        raw = "".join(secrets.choice(_BACKUP_ALPHABET) for _ in range(8))
        plain.append(_format_code(raw))
        conn.execute(
            "INSERT INTO user_backup_codes (user_id, code_hash, created_at) VALUES (?, ?, ?)",
            (user_id, _hash_backup(user_id, raw), now),
        )
    return plain


def regenerate_backup_codes(user_id: str) -> list[str]:
    row = _load(user_id)
    if not (row and row["enabled"]):
        raise ValueError("Two-factor authentication isn't enabled")
    _ensure_schema()
    conn = get_connection()
    try:
        codes = _issue_backup_codes(conn, user_id)
        conn.commit()
        return codes
    finally:
        conn.close()


# ── Verification ─────────────────────────────────────────────────────────────

def _match_step(secret: str, code: str, now: float | None = None) -> int | None:
    """Return the 30s timestep the code matches (current step ±1 for clock
    skew), or None. Constant-time digit comparison."""
    digits = "".join(ch for ch in (code or "") if ch.isdigit())
    if len(digits) != 6:
        return None
    totp = pyotp.TOTP(secret)
    ts = int(now if now is not None else time.time())
    step_now = ts // TOTP_STEP_SECONDS
    for offset in (0, -1, 1):
        step = step_now + offset
        if hmac.compare_digest(totp.at(step * TOTP_STEP_SECONDS), digits):
            return step
    return None


def verify_login_code(user_id: str, code: str, now: float | None = None) -> bool:
    """Accept a 6-digit TOTP (with replay guard) or an unused backup code
    (consumed on use). Never raises on bad input — just returns False."""
    row = _load(user_id)
    if not (row and row["enabled"]):
        return False
    raw = (code or "").strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    looks_like_totp = len(digits) == 6 and len(_normalize_backup(raw)) <= 6

    if looks_like_totp:
        try:
            secret = crypto_box.decrypt(row["secret_encrypted"])
        except crypto_box.CryptoBoxError:
            return False
        step = _match_step(secret, raw, now=now)
        if step is None or step <= int(row["last_used_step"] or 0):
            return False
        conn = get_connection()
        try:
            conn.execute(
                "UPDATE user_totp SET last_used_step = ? WHERE user_id = ?",
                (step, user_id),
            )
            conn.commit()
        finally:
            conn.close()
        return True

    normalized = _normalize_backup(raw)
    if len(normalized) != 8:
        return False
    conn = get_connection()
    try:
        cur = conn.execute(
            "UPDATE user_backup_codes SET used_at = ? "
            "WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
            (_now_iso(), user_id, _hash_backup(user_id, normalized)),
        )
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


# ── Stateless login challenge tokens ─────────────────────────────────────────

_fallback_secret: bytes | None = None


def _challenge_secret() -> bytes:
    raw = os.environ.get("BROKER_ENCRYPTION_KEY", "")
    if raw:
        return hashlib.sha256(b"uct-totp-challenge|" + raw.encode("ascii", "ignore")).digest()
    # Local dev without the key: per-process secret (challenges die on restart).
    global _fallback_secret
    if _fallback_secret is None:
        _fallback_secret = secrets.token_bytes(32)
    return _fallback_secret


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def mint_challenge(user_id: str, now: float | None = None) -> str:
    payload = _b64e(json.dumps({
        "uid": user_id,
        "exp": int(now if now is not None else time.time()) + CHALLENGE_TTL_SECONDS,
        "n": secrets.token_hex(8),
    }).encode())
    sig = _b64e(hmac.new(_challenge_secret(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def read_challenge(token: str, now: float | None = None) -> str | None:
    """Return the user_id a valid, unexpired challenge token was minted for."""
    try:
        payload, sig = (token or "").split(".", 1)
        expect = _b64e(hmac.new(_challenge_secret(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(sig, expect):
            return None
        data = json.loads(_b64d(payload))
        if int(data.get("exp", 0)) < (now if now is not None else time.time()):
            return None
        uid = data.get("uid")
        return uid if isinstance(uid, str) and uid else None
    except Exception:
        return None
