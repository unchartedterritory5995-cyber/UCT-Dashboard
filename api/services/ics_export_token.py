"""TERM-084 (FB-X2-02) -- an ICS export token that expires, rotates and can be revoked.

WHY THIS EXISTS
---------------
`/api/calendar/export-token` minted ``hmac(PUSH_SECRET, user_id)``: no expiry, no
rotation, and the only way to kill a leaked subscribe link was to change
``PUSH_SECRET``, which kills EVERY member's link at once. A paid session became a
permanent bearer credential (best-of-breed §6.2 item 4; ledger E8).

THE v2 TOKEN
------------
    v2.<b64url(user_id)>.<generation>.<exp>.<b64url(hmac)>

* ``exp`` is a signed unix time, so editing it in the URL breaks the signature.
  It is quantised to the start of the UTC day, so every mint on one day yields
  the SAME link (a member who copies it twice gets one URL, not two).
* ``generation`` is a per-member counter in ``ics_export_token_state``. Rotating
  bumps it, and verification refuses any other generation: every older link of
  that member dies, nobody else's does, and ``PUSH_SECRET`` never changes.

THE MIGRATION PATH FOR LINKS MEMBERS ALREADY SUBSCRIBED
-------------------------------------------------------
Members' calendar apps hold today's legacy HMAC links. With the flag ON:

* a legacy link keeps working (grace period) and EVERY fetch is counted per
  member (``legacy_uses``, ``legacy_last_used_at``), readable by an admin;
* the feed it serves carries one notice event asking the member to re-subscribe;
* rotating also revokes that member's legacy link (a leaked legacy link is
  therefore revocable per member, again without touching ``PUSH_SECRET``);
* the owner closes the grace period by setting ``ICS_LEGACY_TOKEN_GRACE_UNTIL``
  (an ISO date) once the count says nobody is left; from the day after it, a
  legacy link is refused with 401 and the refusal is counted too.

With the flag OFF nothing in this module is consulted for a legacy link, and the
export-token door mints exactly what it minted before (byte-identical).
Rollback = unset ``ICS_TOKEN_V2_ENABLED``; nothing is deleted, the state table
simply stops being read for legacy links.

⛔ A token is never logged -- not whole, not its signature. Log lines carry the
member id and a verdict word, nothing else.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import time
from datetime import date, datetime, timedelta, timezone

_logger = logging.getLogger(__name__)

PREFIX = "v2"
_DOMAIN = b"uct-ics-export-v2|"
DEFAULT_TTL_DAYS = 90
MAX_TTL_DAYS = 365
NOTICE_DAYS = 14          # the feed warns inside this many days of expiry
_DAY = 86400

VALID, EXPIRED, REVOKED, INVALID = "VALID", "EXPIRED", "REVOKED", "INVALID"

# ⭐ The clock is a seam. Tests replace it; nothing reads time.time() directly.
_clock = time.time


def now() -> float:
    return float(_clock())


# ── configuration (read per call, never captured at import) ──────────────────

def is_enabled() -> bool:
    """Enablement gate -- default OFF, read per request so a flip needs no rebuild."""
    return os.environ.get("ICS_TOKEN_V2_ENABLED", "0").strip() == "1"


def ttl_days() -> int:
    raw = os.environ.get("ICS_TOKEN_TTL_DAYS", "").strip()
    try:
        n = int(raw)
    except ValueError:
        return DEFAULT_TTL_DAYS
    return max(1, min(n, MAX_TTL_DAYS))


def legacy_grace_ends_at() -> float | None:
    """Unix time from which a legacy link is refused, or None (grace still open).

    ``ICS_LEGACY_TOKEN_GRACE_UNTIL=2026-12-31`` means legacy links work through
    2026-12-31 UTC and are refused from 2027-01-01 00:00 UTC. An unparseable value
    keeps the grace OPEN and says so loudly: a typo must not silently break every
    member's calendar.
    """
    raw = os.environ.get("ICS_LEGACY_TOKEN_GRACE_UNTIL", "").strip()
    if not raw:
        return None
    try:
        d = date.fromisoformat(raw)
    except ValueError:
        _logger.warning("[ics] ICS_LEGACY_TOKEN_GRACE_UNTIL=%r is not an ISO date; "
                        "legacy grace stays open", raw)
        return None
    end = datetime(d.year, d.month, d.day, tzinfo=timezone.utc) + timedelta(days=1)
    return end.timestamp()


def _secret() -> bytes | None:
    """Same secret precedence as the legacy token, but NO hard-coded fallback:
    a v2 token signed with a public constant would be forgeable for every member."""
    s = os.environ.get("PUSH_SECRET", "") or os.environ.get("VOICE_ACTION_SECRET", "")
    return s.encode("utf-8") if s else None


# ── encoding ─────────────────────────────────────────────────────────────────

def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sign(body: str, secret: bytes) -> str:
    return _b64u(hmac.new(secret, _DOMAIN + body.encode("ascii"), hashlib.sha256).digest())


def is_v2(token: str | None) -> bool:
    return bool(token) and token.startswith(PREFIX + ".")


# ── state store (auth.db) ────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS ics_export_token_state (
    user_id              TEXT PRIMARY KEY,
    generation           INTEGER NOT NULL DEFAULT 0,
    rotated_at           TEXT,
    legacy_revoked_at    TEXT,
    legacy_uses          INTEGER NOT NULL DEFAULT 0,
    legacy_refused       INTEGER NOT NULL DEFAULT 0,
    legacy_first_used_at TEXT,
    legacy_last_used_at  TEXT
)
"""


def _connect():
    # Resolved at CALL time so a test's patch of auth_db.get_connection reaches it.
    from api.services import auth_db
    conn = auth_db.get_connection()
    conn.execute(_SCHEMA)
    return conn


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat()


def _row(conn, user_id: str):
    return conn.execute("SELECT * FROM ics_export_token_state WHERE user_id = ?",
                        (user_id,)).fetchone()


def _generation(conn, user_id: str) -> int:
    r = _row(conn, user_id)
    return int(r["generation"]) if r is not None else 0


def _user_exists(conn, user_id: str) -> bool:
    return conn.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is not None


# ── mint / verify / rotate ───────────────────────────────────────────────────

def mint(user_id: str, at: float | None = None) -> tuple[str, int] | None:
    """(token, exp) for this member's CURRENT generation, or None with no secret."""
    secret = _secret()
    if not secret:
        return None
    t = now() if at is None else at
    exp = int(t // _DAY) * _DAY + ttl_days() * _DAY
    conn = _connect()
    try:
        gen = _generation(conn, user_id)
    finally:
        conn.close()
    body = f"{_b64u(user_id.encode('utf-8'))}.{gen}.{exp}"
    return f"{PREFIX}.{body}.{_sign(body, secret)}", exp


def verify(token: str | None, at: float | None = None) -> tuple[str, str | None, int | None]:
    """Classify a v2 token: (VALID|EXPIRED|REVOKED|INVALID, user_id, exp).

    Signature first, always: nothing attacker-controlled is parsed before it is
    proven ours.
    """
    if not is_v2(token):
        return INVALID, None, None
    secret = _secret()
    if not secret:
        return INVALID, None, None
    parts = token.split(".")
    if len(parts) != 5:
        return INVALID, None, None
    _, uid_b64, gen_s, exp_s, sig = parts
    body = f"{uid_b64}.{gen_s}.{exp_s}"
    try:
        good = hmac.compare_digest(sig.encode("ascii"), _sign(body, secret).encode("ascii"))
    except (UnicodeEncodeError, ValueError):
        return INVALID, None, None
    if not good:
        return INVALID, None, None
    try:
        user_id = _b64u_decode(uid_b64).decode("utf-8")
        gen = int(gen_s)
        exp = int(exp_s)
    except (ValueError, UnicodeDecodeError):
        return INVALID, None, None
    try:
        conn = _connect()
        try:
            if not _user_exists(conn, user_id):
                return INVALID, None, None
            current = _generation(conn, user_id)
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001 -- a store failure refuses, never admits
        _logger.warning("[ics] v2 state read failed: %s", type(e).__name__)
        return INVALID, None, None
    if gen != current:
        return REVOKED, user_id, exp
    t = now() if at is None else at
    if t >= exp:
        return EXPIRED, user_id, exp
    return VALID, user_id, exp


def rotate(user_id: str, at: float | None = None) -> tuple[str, int] | None:
    """Invalidate every existing link of this member (v2 AND legacy); mint a new one."""
    if not _secret():
        return None
    t = now() if at is None else at
    stamp = _iso(t)
    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO ics_export_token_state (user_id, generation, rotated_at, legacy_revoked_at) "
            "VALUES (?, 1, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET generation = generation + 1, "
            "rotated_at = excluded.rotated_at, legacy_revoked_at = excluded.legacy_revoked_at",
            (user_id, stamp, stamp))
        conn.commit()
        gen = _generation(conn, user_id)
    finally:
        conn.close()
    _logger.info("[ics] export link rotated user=%s generation=%d", user_id, gen)
    return mint(user_id, at=t)


def expires_soon(exp: int, at: float | None = None) -> bool:
    t = now() if at is None else at
    return exp - t <= NOTICE_DAYS * _DAY


# ── legacy links: grace, counting, revocation ────────────────────────────────

def legacy_decision(user_id: str, at: float | None = None) -> str:
    """VALID (serve + count), REVOKED (member rotated) or EXPIRED (grace closed).

    Every call is COUNTED -- served uses and refusals separately -- so the owner
    can see how many members still depend on legacy links before closing grace.
    A store failure serves the feed: today's behaviour is the safe fallback for a
    link that is otherwise valid.
    """
    t = now() if at is None else at
    stamp = _iso(t)
    try:
        conn = _connect()
    except Exception as e:  # noqa: BLE001
        _logger.warning("[ics] legacy state unavailable (%s); serving", type(e).__name__)
        return VALID
    try:
        r = _row(conn, user_id)
        if r is not None and r["legacy_revoked_at"]:
            verdict = REVOKED
        else:
            ends = legacy_grace_ends_at()
            verdict = EXPIRED if (ends is not None and t >= ends) else VALID
        if verdict == VALID:
            conn.execute(
                "INSERT INTO ics_export_token_state (user_id, legacy_uses, legacy_first_used_at, "
                "legacy_last_used_at) VALUES (?, 1, ?, ?) "
                "ON CONFLICT(user_id) DO UPDATE SET legacy_uses = legacy_uses + 1, "
                "legacy_first_used_at = COALESCE(legacy_first_used_at, excluded.legacy_first_used_at), "
                "legacy_last_used_at = excluded.legacy_last_used_at",
                (user_id, stamp, stamp))
        else:
            conn.execute(
                "INSERT INTO ics_export_token_state (user_id, legacy_refused) VALUES (?, 1) "
                "ON CONFLICT(user_id) DO UPDATE SET legacy_refused = legacy_refused + 1",
                (user_id,))
        conn.commit()
    finally:
        conn.close()
    if verdict == VALID:
        _logger.debug("[ics] legacy export link served user=%s", user_id)
    else:
        _logger.info("[ics] legacy export link refused user=%s verdict=%s", user_id, verdict)
    return verdict


def legacy_usage(at: float | None = None) -> dict:
    """What the owner reads before closing the grace period."""
    t = now() if at is None else at
    week_ago = _iso(t - 7 * _DAY)
    conn = _connect()
    try:
        r = conn.execute(
            "SELECT COUNT(*) AS members, COALESCE(SUM(legacy_uses), 0) AS uses, "
            "COALESCE(SUM(legacy_refused), 0) AS refused, MAX(legacy_last_used_at) AS last "
            "FROM ics_export_token_state WHERE legacy_uses > 0").fetchone()
        recent = conn.execute(
            "SELECT COUNT(*) FROM ics_export_token_state WHERE legacy_last_used_at >= ?",
            (week_ago,)).fetchone()[0]
        refused_total = conn.execute(
            "SELECT COALESCE(SUM(legacy_refused), 0) FROM ics_export_token_state").fetchone()[0]
    finally:
        conn.close()
    ends = legacy_grace_ends_at()
    return {
        "members": int(r["members"]),
        "members_last_7d": int(recent),
        "uses_total": int(r["uses"]),
        "refused_total": int(refused_total),
        "last_used_at": r["last"],
        "grace_ends_at": _iso(ends) if ends is not None else None,
        "flag_enabled": is_enabled(),
    }
