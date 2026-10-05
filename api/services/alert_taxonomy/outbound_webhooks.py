"""Outbound alert webhooks -- an HTTP POST to the member's own endpoint when
one of their S7 alerts fires (FT-033). The INBOUND twin is TERM-086
(`api/services/inbound_alerts.py`); this is the other direction.

THE CONTRACT A RECEIVER SEES.
    POST <member url>          Content-Type: application/json
    X-UCT-Event: alert.fired | webhook.test
    X-UCT-Delivery: <delivery id>          (stable across retries -- dedupe on it)
    X-UCT-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
  The body is the member's OWN fire: what fired, on what, when, and the same
  title/message their bell shows. Nothing from any other member, no vendor
  payload beyond what the alert already said.

THE RULES, each one a requirement of the owner's ruling.
  * OWNER-SCOPED. Every read and write is keyed on the caller's user id; a
    webhook id belonging to someone else is indistinguishable from a missing
    one (404, never 403).
  * SIGNED. A per-webhook secret, minted here, shown ONCE at creation, stored
    encrypted with `crypto_box` (refused if the key is not configured -- an
    unencrypted signing secret at rest is not an option this module offers).
  * SSRF-SAFE. https only, port 443 only, no credentials in the URL, no IP
    literal or hostname that resolves to a private, loopback, link-local,
    multicast, reserved or unspecified address -- checked at creation AND
    again immediately before every send (DNS can change between the two).
    Redirects are never followed. The address test is the one
    `note_connectors.providers.base._is_disallowed_ip` already enforces, not a
    second copy.
  * OFF THE REQUEST PATH, WITH BACKOFF. A fire only ENQUEUES a row; a
    scheduler job (`drain`) does the POST with a 3 s timeout, and a failure
    is retried after 1, 2, 4, 8, 16 minutes, then recorded as failed for good.
  * RATE-LIMITED PER MEMBER. At most `WEBHOOK_HOURLY_CAP` deliveries enqueued
    per member per rolling hour (default 120); past it the delivery is
    recorded as `dropped_rate`, never silently lost. At most `MAX_WEBHOOKS`
    (3) live endpoints per member.
  * DARK: `ALERT_WEBHOOKS_ENABLED` (default off, read per call). Off: no row is
    ever enqueued, the drain sends nothing, the routes answer 404. Revoking a
    webhook stamps `revoked_at`; nothing here deletes member data.
"""
from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import socket
import time
import uuid
from typing import Any, Callable, Optional
from urllib.parse import urlsplit

from api.services.alert_taxonomy import db as _db

FLAG = "ALERT_WEBHOOKS_ENABLED"
MAX_WEBHOOKS = 3
MAX_ATTEMPTS = 6
TIMEOUT_S = 3.0
DEFAULT_HOURLY_CAP = 120
URL_MAX = 2048

_DDL = """
CREATE TABLE IF NOT EXISTS alert_webhooks (
    id                    TEXT PRIMARY KEY,
    user_id               TEXT NOT NULL,
    url                   TEXT NOT NULL,
    secret_enc            TEXT NOT NULL,
    secret_hint           TEXT NOT NULL,
    created_at            REAL NOT NULL,
    revoked_at            REAL,
    last_ok_at            REAL,
    last_error            TEXT,
    consecutive_failures  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_webhooks_user ON alert_webhooks(user_id, revoked_at);
CREATE TABLE IF NOT EXISTS alert_webhook_deliveries (
    id              TEXT PRIMARY KEY,
    webhook_id      TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    fire_id         INTEGER,
    event           TEXT NOT NULL,
    payload         TEXT NOT NULL,
    status          TEXT NOT NULL,     -- pending | delivered | failed | dropped_rate | dropped_revoked
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at REAL,
    last_status     INTEGER,
    last_error      TEXT,
    created_at      REAL NOT NULL,
    delivered_at    REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_awd_once ON alert_webhook_deliveries(webhook_id, fire_id)
    WHERE fire_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_awd_due ON alert_webhook_deliveries(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_awd_user_time ON alert_webhook_deliveries(user_id, created_at);
"""


class WebhookError(ValueError):
    """A sentence the member can act on."""


def is_enabled() -> bool:
    return os.environ.get(FLAG, "0").strip() == "1"


def hourly_cap() -> int:
    try:
        v = int(os.environ.get("WEBHOOK_HOURLY_CAP", DEFAULT_HOURLY_CAP))
        return v if v > 0 else DEFAULT_HOURLY_CAP
    except (TypeError, ValueError):
        return DEFAULT_HOURLY_CAP


def _conn(db_path: str | None):
    c = _db.connect(db_path)
    _db.init_db(c)
    c.executescript(_DDL)
    return c


# ── SSRF guard ──────────────────────────────────────────────────────────────

def _resolve(host: str) -> list[str]:
    """Indirection so tests can supply a resolver; production uses DNS."""
    return [info[4][0] for info in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)]


def _disallowed(addr) -> bool:
    from api.services.journal_two.note_connectors.providers.base import _is_disallowed_ip
    return _is_disallowed_ip(addr)


def check_url(url: str, *, resolver: Callable[[str], list[str]] | None = None) -> str:
    """Return the normalised URL or raise WebhookError naming the reason."""
    resolver = resolver or _resolve
    url = (url or "").strip()
    if not url or len(url) > URL_MAX:
        raise WebhookError("Enter an https:// address (at most 2048 characters).")
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise WebhookError("Webhook addresses must use https://.")
    if parts.username or parts.password:
        raise WebhookError("Put credentials in your receiver, not in the address.")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise WebhookError("That address has no host.")
    if parts.port not in (None, 443):
        raise WebhookError("Webhooks are sent to port 443 only.")
    if host == "localhost" or host.endswith(".localhost") or host.endswith(".internal") \
            or host.endswith(".local"):
        raise WebhookError("That host is not reachable from the public internet.")
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if _disallowed(literal):
            raise WebhookError("That address points at a private or reserved network.")
        return url
    try:
        addrs = resolver(host)
    except Exception:  # noqa: BLE001
        raise WebhookError("That host could not be resolved.")
    if not addrs:
        raise WebhookError("That host could not be resolved.")
    for a in addrs:
        try:
            ip = ipaddress.ip_address(a.split("%", 1)[0])
        except ValueError:
            raise WebhookError("That host resolved to an address we cannot verify.")
        if _disallowed(ip):
            raise WebhookError("That host resolves to a private or reserved network.")
    return url


# ── signing ─────────────────────────────────────────────────────────────────

def sign(secret: str, body: bytes, ts: int) -> str:
    mac = hmac.new(secret.encode("utf-8"), f"{ts}.".encode("ascii") + body, hashlib.sha256)
    return f"t={ts},v1={mac.hexdigest()}"


def verify(secret: str, body: bytes, header: str, *, tolerance_s: int = 300,
           now: float | None = None) -> bool:
    """The receiver's side, published so a member can copy it (and so the
    tests prove the signature is checkable, not merely present)."""
    try:
        fields = dict(p.split("=", 1) for p in header.split(","))
        ts = int(fields["t"])
    except Exception:  # noqa: BLE001
        return False
    if abs((now if now is not None else time.time()) - ts) > tolerance_s:
        return False
    return hmac.compare_digest(sign(secret, body, ts), f"t={ts},v1={fields.get('v1', '')}")


# ── CRUD (owner-scoped) ─────────────────────────────────────────────────────

def _public(r) -> dict:
    return {"id": r["id"], "url": r["url"], "secret_hint": r["secret_hint"],
            "created_at": r["created_at"], "revoked_at": r["revoked_at"],
            "last_ok_at": r["last_ok_at"], "last_error": r["last_error"],
            "consecutive_failures": r["consecutive_failures"]}


def list_webhooks(user_id: str, *, db_path: str | None = None) -> list[dict]:
    c = _conn(db_path)
    try:
        rows = c.execute("SELECT * FROM alert_webhooks WHERE user_id = ? ORDER BY created_at",
                         (str(user_id),)).fetchall()
    finally:
        c.close()
    return [_public(r) for r in rows]


def create(user_id: str, url: str, *, resolver=None, db_path: str | None = None) -> dict:
    from api.services import crypto_box
    url = check_url(url, resolver=resolver)
    if not crypto_box.is_configured():
        raise WebhookError("Webhooks are not available yet (signing key storage is not configured).")
    c = _conn(db_path)
    try:
        live = c.execute("SELECT COUNT(*) FROM alert_webhooks WHERE user_id = ? AND revoked_at IS NULL",
                         (str(user_id),)).fetchone()[0]
        if live >= MAX_WEBHOOKS:
            raise WebhookError(f"You can have at most {MAX_WEBHOOKS} webhooks. Revoke one first.")
        secret = "whsec_" + secrets.token_urlsafe(32)
        wid = "wh_" + uuid.uuid4().hex[:16]
        c.execute("INSERT INTO alert_webhooks (id, user_id, url, secret_enc, secret_hint, created_at)"
                  " VALUES (?, ?, ?, ?, ?, ?)",
                  (wid, str(user_id), url, crypto_box.encrypt(secret), secret[-4:], time.time()))
        c.commit()
        row = c.execute("SELECT * FROM alert_webhooks WHERE id = ?", (wid,)).fetchone()
    finally:
        c.close()
    # ⛔ The secret leaves this module exactly once, here.
    return {**_public(row), "secret": secret}


def revoke(user_id: str, webhook_id: str, *, db_path: str | None = None) -> bool:
    c = _conn(db_path)
    try:
        cur = c.execute("UPDATE alert_webhooks SET revoked_at = ? WHERE id = ? AND user_id = ?"
                        " AND revoked_at IS NULL", (time.time(), webhook_id, str(user_id)))
        c.commit()
        return cur.rowcount > 0
    finally:
        c.close()


def deliveries(user_id: str, webhook_id: str, *, limit: int = 20,
               db_path: str | None = None) -> list[dict] | None:
    c = _conn(db_path)
    try:
        own = c.execute("SELECT 1 FROM alert_webhooks WHERE id = ? AND user_id = ?",
                        (webhook_id, str(user_id))).fetchone()
        if not own:
            return None
        rows = c.execute("SELECT id, fire_id, event, status, attempts, last_status, last_error,"
                         " created_at, delivered_at, next_attempt_at FROM alert_webhook_deliveries"
                         " WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?",
                         (webhook_id, int(limit))).fetchall()
    finally:
        c.close()
    return [dict(r) for r in rows]


# ── enqueue (the only thing a fire does) ────────────────────────────────────

def _enqueue_rows(c, user_id: str, hooks, event: str, payload: dict, fire_id) -> list[str]:
    now = time.time()
    recent = c.execute("SELECT COUNT(*) FROM alert_webhook_deliveries WHERE user_id = ?"
                       " AND created_at > ?", (str(user_id), now - 3600)).fetchone()[0]
    out = []
    for h in hooks:
        did = "whd_" + uuid.uuid4().hex[:20]
        status = "pending" if recent < hourly_cap() else "dropped_rate"
        body = json.dumps({**payload, "delivery_id": did, "webhook_id": h["id"]},
                          separators=(",", ":"), sort_keys=True)
        try:
            c.execute("INSERT INTO alert_webhook_deliveries (id, webhook_id, user_id, fire_id, event,"
                      " payload, status, next_attempt_at, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                      (did, h["id"], str(user_id), fire_id, event, body, status,
                       now if status == "pending" else None, now))
        except Exception:  # noqa: BLE001 -- the (webhook, fire) pair is already queued
            continue
        recent += 1
        out.append(did)
    c.commit()
    return out


def enqueue_fire(user_id: str, fire: dict, *, db_path: str | None = None) -> list[str]:
    """Queue one delivery per live webhook for this fire. Never raises, never
    sends -- `drain` does the network work off the request/sweep path."""
    if not is_enabled() or not user_id:
        return []
    try:
        c = _conn(db_path)
        try:
            hooks = c.execute("SELECT id FROM alert_webhooks WHERE user_id = ? AND revoked_at IS NULL",
                              (str(user_id),)).fetchall()
            if not hooks:
                return []
            payload = {"type": "alert.fired", "fire_id": fire.get("fire_id"),
                       "trigger_type": fire.get("trigger_type"), "entity": fire.get("entity"),
                       "title": fire.get("title"), "message": fire.get("message"),
                       "fired_at": fire.get("fired_at") or time.time(),
                       "research_url": fire.get("research_url")}
            return _enqueue_rows(c, user_id, hooks, "alert.fired", payload, fire.get("fire_id"))
        finally:
            c.close()
    except Exception:  # noqa: BLE001 -- a webhook must never cost the member the alert
        return []


def enqueue_test(user_id: str, webhook_id: str, *, db_path: str | None = None) -> Optional[str]:
    c = _conn(db_path)
    try:
        h = c.execute("SELECT id FROM alert_webhooks WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
                      (webhook_id, str(user_id))).fetchall()
        if not h:
            return None
        ids = _enqueue_rows(c, user_id, h, "webhook.test",
                            {"type": "webhook.test", "message": "Test delivery from UCT Intelligence.",
                             "fired_at": time.time()}, None)
        return ids[0] if ids else None
    finally:
        c.close()


# ── drain (scheduler job; the only code that touches the network) ───────────

def backoff_s(attempts: int) -> int:
    """1, 2, 4, 8, 16 minutes."""
    return 60 * (2 ** max(0, attempts - 1))


def _post(url: str, body: bytes, headers: dict) -> int:
    import httpx
    with httpx.Client(timeout=TIMEOUT_S, follow_redirects=False) as client:
        return client.post(url, content=body, headers=headers).status_code


def drain(*, limit: int = 50, db_path: str | None = None, poster=None, resolver=None,
          now: float | None = None) -> dict:
    """Send every due delivery once. Returns counts. Safe to call when dark
    (sends nothing)."""
    if not is_enabled():
        return {"sent": 0, "delivered": 0, "retry": 0, "failed": 0, "skipped": "dark"}
    from api.services import crypto_box
    poster = poster or _post
    now = time.time() if now is None else now
    out = {"sent": 0, "delivered": 0, "retry": 0, "failed": 0}
    c = _conn(db_path)
    try:
        due = c.execute(
            "SELECT d.*, w.url, w.secret_enc, w.revoked_at FROM alert_webhook_deliveries d"
            " JOIN alert_webhooks w ON w.id = d.webhook_id"
            " WHERE d.status = 'pending' AND d.next_attempt_at <= ? ORDER BY d.next_attempt_at LIMIT ?",
            (now, int(limit))).fetchall()
        for d in due:
            if d["revoked_at"] is not None:
                c.execute("UPDATE alert_webhook_deliveries SET status='dropped_revoked' WHERE id=?", (d["id"],))
                continue
            attempts = d["attempts"] + 1
            code, err = None, None
            try:
                check_url(d["url"], resolver=resolver)          # re-checked at send time
                secret = crypto_box.decrypt(d["secret_enc"])
                body = d["payload"].encode("utf-8")
                headers = {"Content-Type": "application/json", "User-Agent": "UCT-Webhooks/1",
                           "X-UCT-Event": d["event"], "X-UCT-Delivery": d["id"],
                           "X-UCT-Signature": sign(secret, body, int(now))}
                out["sent"] += 1
                code = poster(d["url"], body, headers)
            except WebhookError as e:
                err = str(e)
            except Exception as e:  # noqa: BLE001
                err = type(e).__name__
            if code is not None and 200 <= code < 300:
                c.execute("UPDATE alert_webhook_deliveries SET status='delivered', attempts=?,"
                          " last_status=?, last_error=NULL, delivered_at=? WHERE id=?",
                          (attempts, code, now, d["id"]))
                c.execute("UPDATE alert_webhooks SET last_ok_at=?, last_error=NULL,"
                          " consecutive_failures=0 WHERE id=?", (now, d["webhook_id"]))
                out["delivered"] += 1
                continue
            reason = err or f"HTTP {code}"
            final = attempts >= MAX_ATTEMPTS
            c.execute("UPDATE alert_webhook_deliveries SET status=?, attempts=?, last_status=?,"
                      " last_error=?, next_attempt_at=? WHERE id=?",
                      ("failed" if final else "pending", attempts, code, reason,
                       None if final else now + backoff_s(attempts), d["id"]))
            c.execute("UPDATE alert_webhooks SET last_error=?, consecutive_failures="
                      " consecutive_failures + 1 WHERE id=?", (reason, d["webhook_id"]))
            out["failed" if final else "retry"] += 1
        c.commit()
    finally:
        c.close()
    return out
