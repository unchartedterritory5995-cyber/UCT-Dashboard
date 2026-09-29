"""TERM-086 (item 14 WF-B06) -- the inbound alert receiver: TradingView as an
upstream SENSOR, not a destination that replaces us.

WHAT IT DOES
------------
A member authors a condition where they already author conditions (a TradingView
alert), points the alert's webhook at THEIR OWN receiver URL, and the fire lands
in THEIR OWN bell and inbox through the one shipped delivery hook,
``watchlist_alert_service.deliver_alert_payload`` -- never the admin Discord
(TERM-011: a private alert carries a ``user_id``, and ``add_alert`` retires the
Discord leg for every alert that does).

    POST /api/inbound-alerts/hook/<token>      <- TradingView, unauthenticated
    GET|POST|DELETE /api/inbound-alerts/receiver, POST .../receiver/rotate
                                                <- the member, signed in

⛔⛔ INBOUND ONLY. A received alert is INFORMATION. Nothing here reaches a
brokerage, and nothing may (GOVERNING_PRINCIPLES §13, NG-01..NG-03, CARD 25 §2);
``tests/test_term086_inbound_alerts.py`` rails the vocabulary of this module and
its router.

THE CREDENTIAL -- a per-member secret IN THE URL, because the sender cannot hold
any other kind (TradingView posts to a URL you give it; there is no header, no
signature, no session). So the URL IS the password, and everything follows:

* minted from ``secrets.token_urlsafe(32)`` (256 bits), shown to the member
  ONCE, and STORED ONLY AS ITS SHA-256 (``inbound_alert_tokens.token_hash``).
  A lookup by digest needs no constant-time compare: the digest of a guess
  reveals nothing about any stored digest.
* one ACTIVE token per member, enforced by a partial UNIQUE index -- not by a
  read-then-write, which two concurrent mints would both pass;
* ROTATE retires the old token (``revoked_reason='rotated'``) and mints a new
  one in ONE transaction; REVOKE retires it (``'revoked'``). Retired rows are
  KEPT, never deleted -- that is what lets an old sender be refused with a
  NAMED reason ("this URL was replaced") instead of a bare "unknown", which is
  PROD-1's recovery path: the member reads why, copies the new URL, done;
* ⛔ the token is NEVER logged -- not whole, not a prefix beyond the 4-character
  ``hint`` the member's own Settings card shows, not its digest. Log lines carry
  the member id and a verdict word. uvicorn's access line would carry the PATH,
  so ``api/logging_redaction.py`` rewrites the hook path's token segment as a
  backstop (the primary control is that access logging is silenced -- see that
  module).

THE PAYLOAD -- a STRICT schema, because a member writes it by hand in
TradingView's message box (``{{ticker}}``, ``{{close}}``, ``{{timenow}}``):
``ticker`` required; ``title``/``message``/``price``/``time``/``id``/
``interval``/``exchange`` optional, each type- and length-checked; UNKNOWN
FIELDS ARE IGNORED (so a ``user_id`` in the body cannot aim the alert at anyone
-- the token alone names the member); a body past ``MAX_BODY_BYTES`` is refused
before it is parsed.

DEDUP -- a replayed payload never delivers twice. The key is per MEMBER:
``id`` when the member supplied one (held ``ID_DEDUP_WINDOW_S``), else the
canonical parsed payload (held ``BODY_DEDUP_WINDOW_S``, short on purpose: a
condition that fires again tomorrow with the same words is a new fire, not a
replay). The claim is check-and-insert inside ONE ``BEGIN IMMEDIATE``, so two
identical requests racing each other deliver once. ⚠️ Honest scope: the URL is
the credential, so anyone able to replay a captured request could also send a
fresh one; dedup exists to stop DOUBLE DELIVERY (a sender's retry, a doubled
fire), not to defend against a token thief -- rotation is that defence.

THE 3-SECOND BUDGET -- TradingView drops a webhook whose receiver has not
answered in 3 s, and the feature then silently does not work. So the request
does ONLY: verify, rate-check, read (capped), parse, claim. Delivery -- an
email is up to a 10 s Resend call -- runs AFTER the answer, on a small bounded
pool (``api/routers/inbound_alerts.py``); its outcome is written back onto the
receipt row.

DARK -- ``INBOUND_ALERTS_ENABLED`` (default OFF, read per request). Off, every
route of this feature does not MATCH at all, so the app answers exactly what it
would answer if the router were not mounted (404 in a bare checkout, whatever
the SPA catch-all answers in a built one) -- not a hand-made imitation of it.

ROLLBACK = unset ``INBOUND_ALERTS_ENABLED``. Nothing is deleted: tokens and
receipts stay in auth.db, a later re-enable finds every member's URL still
working, and the reversal is "stop accepting", never "delete what members sent".

⚠️ PER-PROCESS STATE: the per-token rate limit lives in the shared
``api/limiter.py`` Limiter's memory and the outcome counters below in this
module; a second web process would double the first and split the second.
⚠️ ``inbound_alert_receipts`` grows by one row per accepted fire, bounded by the
per-token rate limit, with no prune yet (the ``awareness_regime_snapshots``
shape) -- a retention sweep is a follow-up, and must never touch the tokens.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Any

_logger = logging.getLogger(__name__)

FLAG = "INBOUND_ALERTS_ENABLED"

#: What every minted token starts with -- lets a pasted secret be recognised
#: (and a support message say "that is not a receiver URL") without a lookup.
TOKEN_PREFIX = "tvr_"
_TOKEN_BYTES = 32
_HINT_CHARS = 4                     # shown beside the prefix in the member's card
_MAX_TOKEN_LEN = 128                # anything longer is refused unread

#: TradingView's message box is small; 4 KiB is generous for a JSON object of the
#: fields below and far too small to be a vehicle for anything else.
MAX_BODY_BYTES = 4096

RATE_ENV = "INBOUND_ALERTS_RATE"
RATE_DEFAULT = "30/minute"          # per TOKEN, i.e. per member

BODY_DEDUP_WINDOW_S = 300
ID_DEDUP_WINDOW_S = 7 * 86400

#: ``source`` handed to ``deliver_alert_payload`` -- the bell's alert type.
SOURCE = "tradingview_inbound"

VALID, UNKNOWN, ROTATED, REVOKED, STORE_ERROR = (
    "VALID", "UNKNOWN", "ROTATED", "REVOKED", "STORE_ERROR")

# ── the strict schema ────────────────────────────────────────────────────────

#: field -> max length, for the optional string fields. Anything not named here
#: (or ``ticker`` / ``price``) is IGNORED.
_STR_FIELDS = {
    "title": 120,
    "message": 500,
    "time": 40,
    "id": 128,
    "interval": 16,
    "exchange": 32,
}
_SYM_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-/_!]{0,19}$")
_EXCHANGE_RE = re.compile(r"^[A-Z0-9_]{1,32}$")


class PayloadError(ValueError):
    """A refused payload. ``status`` is the HTTP answer, ``args[0]`` the sentence
    the member reads in TradingView's alert log."""

    def __init__(self, status: int, sentence: str):
        super().__init__(sentence)
        self.status = status


# ── configuration (read per call, never captured at import) ──────────────────

def is_enabled() -> bool:
    """Enablement gate -- default OFF, read per request so a flip needs no rebuild."""
    return os.environ.get("INBOUND_ALERTS_ENABLED", "0").strip() == "1"


def rate() -> str:
    """The per-token limit. A value ``limits`` cannot parse falls back to the
    default rather than disabling the limit."""
    raw = (os.environ.get(RATE_ENV) or "").strip()
    if raw:
        try:
            from limits import parse
            parse(raw)
            return raw
        except Exception:  # noqa: BLE001
            _logger.warning("[inbound-alerts] %s=%r does not parse; using %s",
                            RATE_ENV, raw, RATE_DEFAULT)
    return RATE_DEFAULT


# ⭐ The clock is a seam. Tests replace it; nothing here reads time.time() directly.
_clock = time.time


def now() -> float:
    return float(_clock())


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat()


def digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# ── outcome counters (the observability half) ─────────────────────────────────

RECEIVED = "received"
ACCEPTED = "accepted"
DEDUPED = "deduped"
REFUSED_UNKNOWN = "refused_unknown"
REFUSED_ROTATED = "refused_rotated"
REFUSED_REVOKED = "refused_revoked"
REFUSED_OVERSIZE = "refused_oversize"
REFUSED_MALFORMED = "refused_malformed"
RATE_LIMITED = "rate_limited"
STORE_FAILED = "store_failed"
DELIVERED = "delivered"
DELIVERY_FAILED = "delivery_failed"

_lock = threading.Lock()
_COUNTS: Counter = Counter()
_STARTED_AT = time.time()


def count(outcome: str) -> None:
    with _lock:
        _COUNTS[outcome] += 1


def counts() -> dict:
    with _lock:
        return dict(_COUNTS)


def _reset_state() -> None:
    """Tests only."""
    with _lock:
        _COUNTS.clear()


# ── the store (auth.db) ──────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS inbound_alert_tokens (
    token_hash     TEXT PRIMARY KEY,
    user_id        TEXT NOT NULL,
    hint           TEXT NOT NULL,
    created_at     TEXT NOT NULL,
    revoked_at     TEXT,
    revoked_reason TEXT,
    last_used_at   TEXT,
    use_count      INTEGER NOT NULL DEFAULT 0,
    refused_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_inbound_alert_tokens_user
    ON inbound_alert_tokens(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_inbound_alert_tokens_one_active
    ON inbound_alert_tokens(user_id) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS inbound_alert_receipts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    dedup_key   TEXT NOT NULL,
    received_at REAL NOT NULL,
    sym         TEXT NOT NULL,
    status      TEXT NOT NULL,
    channels_ok INTEGER
);
CREATE INDEX IF NOT EXISTS idx_inbound_alert_receipts_dedup
    ON inbound_alert_receipts(user_id, dedup_key, received_at);
"""


def _connect() -> sqlite3.Connection:
    # Resolved at CALL time so a test's patch of auth_db.get_connection reaches it.
    from api.services import auth_db
    conn = auth_db.get_connection()
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    return conn


# ── the token lifecycle ──────────────────────────────────────────────────────

def _new_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(_TOKEN_BYTES)


def _hint_of(token: str) -> str:
    return token[:len(TOKEN_PREFIX) + _HINT_CHARS]


def _insert_token(conn: sqlite3.Connection, user_id: str, token: str, t: float) -> None:
    conn.execute(
        "INSERT INTO inbound_alert_tokens (token_hash, user_id, hint, created_at) "
        "VALUES (?, ?, ?, ?)",
        (digest(token), user_id, _hint_of(token), _iso(t)))


def mint(user_id: str) -> str | None:
    """A NEW receiver token for a member with none active, or None when one is
    already active (the member rotates instead -- two live URLs per member would
    make "which one is TradingView using?" unanswerable)."""
    token = _new_token()
    conn = _connect()
    try:
        try:
            _insert_token(conn, user_id, token, now())
            conn.commit()
        except sqlite3.IntegrityError:
            conn.rollback()
            return None
    finally:
        conn.close()
    _logger.info("[inbound-alerts] receiver minted user=%s", user_id)
    return token


def rotate(user_id: str) -> str:
    """Retire every active token of this member (``rotated``) and mint a new one,
    in ONE transaction. Also the recovery path after a revoke or a lost URL."""
    token = _new_token()
    t = now()
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        conn.execute(
            "UPDATE inbound_alert_tokens SET revoked_at = ?, revoked_reason = 'rotated' "
            "WHERE user_id = ? AND revoked_at IS NULL", (_iso(t), user_id))
        _insert_token(conn, user_id, token, t)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    _logger.info("[inbound-alerts] receiver rotated user=%s", user_id)
    return token


def revoke(user_id: str) -> int:
    """Retire the member's active token (``revoked``). Returns how many were live."""
    conn = _connect()
    try:
        cur = conn.execute(
            "UPDATE inbound_alert_tokens SET revoked_at = ?, revoked_reason = 'revoked' "
            "WHERE user_id = ? AND revoked_at IS NULL", (_iso(now()), user_id))
        conn.commit()
        n = cur.rowcount
    finally:
        conn.close()
    _logger.info("[inbound-alerts] receiver revoked user=%s live=%d", user_id, n)
    return n


def status(user_id: str) -> dict:
    """What the member's Settings card shows. ⛔ Never the token: it is not
    stored, so it cannot be shown again -- only its 4-character hint."""
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT hint, created_at, last_used_at, use_count FROM inbound_alert_tokens "
            "WHERE user_id = ? AND revoked_at IS NULL", (user_id,)).fetchone()
        refused = conn.execute(
            "SELECT COALESCE(SUM(refused_count), 0) FROM inbound_alert_tokens "
            "WHERE user_id = ?", (user_id,)).fetchone()[0]
    finally:
        conn.close()
    if row is None:
        return {"active": False, "hint": None, "created_at": None,
                "last_used_at": None, "use_count": 0,
                "old_url_refusals": int(refused)}
    return {"active": True, "hint": row["hint"], "created_at": row["created_at"],
            "last_used_at": row["last_used_at"], "use_count": int(row["use_count"]),
            "old_url_refusals": int(refused)}


def verify(token: Any) -> tuple[str, str | None, str | None]:
    """``(verdict, user_id, token_hash)`` for a presented token.

    VALID -- an active token of an existing member. ROTATED / REVOKED -- a
    retired token, answered with its NAMED reason and counted on its row.
    UNKNOWN -- anything else, answered identically whatever the reason.
    STORE_ERROR -- the store could not be read: refuse, never admit.
    """
    if not isinstance(token, str) or not token.startswith(TOKEN_PREFIX) \
            or len(token) > _MAX_TOKEN_LEN:
        return UNKNOWN, None, None
    h = digest(token)
    try:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT t.user_id, t.revoked_at, t.revoked_reason "
                "FROM inbound_alert_tokens t JOIN users u ON u.id = t.user_id "
                "WHERE t.token_hash = ?", (h,)).fetchone()
            if row is None:
                return UNKNOWN, None, None
            if row["revoked_at"]:
                conn.execute("UPDATE inbound_alert_tokens SET refused_count = refused_count + 1 "
                             "WHERE token_hash = ?", (h,))
                conn.commit()
                verdict = ROTATED if row["revoked_reason"] == "rotated" else REVOKED
                _logger.info("[inbound-alerts] refused user=%s verdict=%s",
                             row["user_id"], verdict)
                return verdict, row["user_id"], None
            return VALID, row["user_id"], h
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001 -- a store failure refuses, never admits
        _logger.warning("[inbound-alerts] token store unreadable: %s", type(e).__name__)
        return STORE_ERROR, None, None


# ── the payload ──────────────────────────────────────────────────────────────

def _price_of(value: Any) -> float:
    if isinstance(value, bool):
        raise PayloadError(422, "\"price\" must be a number, e.g. {{close}}.")
    if isinstance(value, (int, float)):
        p = float(value)
    elif isinstance(value, str):
        try:
            p = float(value.strip())
        except ValueError:
            raise PayloadError(422, "\"price\" must be a number, e.g. {{close}}.") from None
    else:
        raise PayloadError(422, "\"price\" must be a number, e.g. {{close}}.")
    if not math.isfinite(p):
        raise PayloadError(422, "\"price\" must be a finite number.")
    return p


def parse_payload(raw: bytes) -> dict:
    """The strict schema. Returns ONLY the known fields, normalised; raises
    ``PayloadError`` with the answer and the sentence otherwise."""
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise PayloadError(400, "The alert message must be UTF-8 text.") from None
    try:
        body = json.loads(text)
    except ValueError:
        raise PayloadError(
            400, "The alert message must be JSON, for example "
                 "{\"ticker\": \"{{ticker}}\", \"price\": {{close}}}.") from None
    if not isinstance(body, dict):
        raise PayloadError(422, "The alert message must be a JSON object.")

    ticker = body.get("ticker")
    if not isinstance(ticker, str) or not ticker.strip():
        raise PayloadError(422, "\"ticker\" is required, e.g. \"{{ticker}}\".")
    ticker = ticker.strip().upper()
    exchange = None
    if ":" in ticker:
        exchange, _, ticker = ticker.partition(":")
    if not _SYM_RE.match(ticker):
        raise PayloadError(422, "\"ticker\" is not a symbol this receiver understands.")

    out: dict[str, Any] = {"ticker": ticker}
    for field, cap in _STR_FIELDS.items():
        if field not in body or body[field] is None:
            continue
        value = body[field]
        if not isinstance(value, str):
            raise PayloadError(422, f"\"{field}\" must be text.")
        value = value.strip()
        if len(value) > cap:
            raise PayloadError(422, f"\"{field}\" is longer than {cap} characters.")
        if value:
            out[field] = value
    if "exchange" in out:
        exchange = out["exchange"]
    if exchange:
        exchange = exchange.strip().upper()
        if not _EXCHANGE_RE.match(exchange):
            raise PayloadError(422, "\"exchange\" is not an exchange code.")
        out["exchange"] = exchange
    if body.get("price") is not None:
        out["price"] = _price_of(body["price"])
    return out


# ── dedup + the receipt ──────────────────────────────────────────────────────

def dedup_key(user_id: str, payload: dict) -> tuple[str, int]:
    """``(key, window_seconds)``. Always scoped to the member."""
    if payload.get("id"):
        raw = f"id\x00{user_id}\x00{payload['id']}"
        return "id:" + hashlib.sha256(raw.encode("utf-8")).hexdigest(), ID_DEDUP_WINDOW_S
    canon = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    raw = f"body\x00{user_id}\x00{canon}"
    return "body:" + hashlib.sha256(raw.encode("utf-8")).hexdigest(), BODY_DEDUP_WINDOW_S


def claim_receipt(user_id: str, payload: dict, token_hash: str) -> int | None:
    """Record ONE fire, or None when it is a replay inside its window.

    Check and insert share one ``BEGIN IMMEDIATE`` transaction: a second
    identical request waits on the first's write lock and then SEES its row.
    """
    key, window = dedup_key(user_id, payload)
    t = now()
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        seen = conn.execute(
            "SELECT 1 FROM inbound_alert_receipts "
            "WHERE user_id = ? AND dedup_key = ? AND received_at > ? LIMIT 1",
            (user_id, key, t - window)).fetchone()
        if seen is not None:
            conn.rollback()
            return None
        cur = conn.execute(
            "INSERT INTO inbound_alert_receipts (user_id, dedup_key, received_at, sym, status) "
            "VALUES (?, ?, ?, ?, 'queued')", (user_id, key, t, payload["ticker"]))
        conn.execute(
            "UPDATE inbound_alert_tokens SET use_count = use_count + 1, last_used_at = ? "
            "WHERE token_hash = ?", (_iso(t), token_hash))
        conn.commit()
        return int(cur.lastrowid)
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _set_receipt(receipt_id: int, status_word: str, channels_ok: int | None) -> None:
    try:
        conn = _connect()
        try:
            conn.execute("UPDATE inbound_alert_receipts SET status = ?, channels_ok = ? "
                         "WHERE id = ?", (status_word, channels_ok, receipt_id))
            conn.commit()
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001 -- the outcome record is best-effort
        _logger.warning("[inbound-alerts] receipt %s not updated: %s",
                        receipt_id, type(e).__name__)


# ── delivery ─────────────────────────────────────────────────────────────────

def _compose(payload: dict) -> tuple[str, str]:
    sym = payload["ticker"]
    title = payload.get("title") or f"TradingView alert: {sym}"
    message = payload.get("message") or f"{sym} triggered your TradingView alert."
    if "price" in payload:
        message = f"{message} (price {payload['price']:g})"
    return title, message


def deliver(receipt_id: int, user_id: str, payload: dict) -> dict:
    """Hand one accepted fire to THE shipped delivery hook, to its OWNER only.

    ⛔ ``user_id`` comes from the verified token, never from the payload.
    ⭐ ``severity='info'``: a private alert has no Discord leg at all (TERM-011
    step 7), and ``info`` is also below the severity the webhook ever fired on --
    belt and braces, so a regression of that gate still could not page the
    admin channel with a member's own alert.
    """
    from api.services.watchlist_alert_service import deliver_alert_payload

    title, message = _compose(payload)
    extra = {"origin": "tradingview", "receipt_id": receipt_id}
    for k in ("price", "time", "interval", "exchange"):
        if k in payload:
            extra[k] = payload[k]
    try:
        report = deliver_alert_payload(
            user_id, payload["ticker"], title, message,
            source=SOURCE, extra_data=extra, severity="info")
    except Exception as e:  # noqa: BLE001 -- recorded, never raised into the pool
        _logger.warning("[inbound-alerts] delivery raised user=%s: %s",
                        user_id, type(e).__name__)
        count(DELIVERY_FAILED)
        _set_receipt(receipt_id, "failed", 0)
        return {"claimed": False, "channels": {}, "channels_ok": 0,
                "channels_failed": 0, "errors": {"deliver": type(e).__name__}}
    ok = int(report.get("channels_ok") or 0)
    if ok > 0:
        count(DELIVERED)
        _set_receipt(receipt_id, "delivered", ok)
    else:
        count(DELIVERY_FAILED)
        _set_receipt(receipt_id, "failed", ok)
    return report


# ── the admin read ───────────────────────────────────────────────────────────

def status_snapshot() -> dict:
    out: dict[str, Any] = {"flag": FLAG, "enabled": is_enabled(),
                           "since": _STARTED_AT, "counts": counts()}
    try:
        conn = _connect()
        try:
            out["active_receivers"] = int(conn.execute(
                "SELECT COUNT(*) FROM inbound_alert_tokens WHERE revoked_at IS NULL").fetchone()[0])
            rows = conn.execute(
                "SELECT status, COUNT(*) AS n FROM inbound_alert_receipts GROUP BY status").fetchall()
            out["receipts"] = {r["status"]: int(r["n"]) for r in rows}
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        out["store_error"] = type(e).__name__
    return out
