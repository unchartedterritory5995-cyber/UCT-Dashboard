"""The Trade Exchange webhook's rules, free of HTTP: credential, rate, payload, record.

Everything the hook decides lives here so tests can drive it without a server.

⛔ WHAT TRADE EXCHANGE DOCUMENTS IS ``{"source": "TXNews1", "content": "..."}``
AND NOTHING ELSE. So nothing else is assumed: no publication time (we record
RECEIPT time and call it that), no id (we mint one), no ticker field, no
category. Undocumented keys are KEPT, verbatim, in the journal record's
``extra`` -- never interpreted -- so the first real deliveries can tell us what
the sender actually sends instead of us guessing.

⛔ ``source`` IS NOT AUTHENTICATION. Anyone can type "TXNews1". The allowlist
only stops a misrouted feed being shown as Trade Exchange; the credential is
the path secret, checked before the body is read.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import math
import os
import threading
import time
from datetime import datetime, timezone
from typing import Any

from txn_journal import new_event_id

RECORD_VERSION = 1

DEFAULT_SOURCES = ("TXNews1",)
#: Content prefix a synthetic-only (staging) receiver requires; must match web config.SYNTHETIC_PREFIX.
SYNTHETIC_PREFIX = "SYNTHETIC"
DEFAULT_MAX_BODY_BYTES = 16 * 1024
DEFAULT_MAX_CONTENT_CHARS = 8000
#: A real token is ``txn_`` + 43 base64url chars. Anything far longer is
#: refused before it is hashed, so a scanner cannot make us hash megabytes.
MAX_TOKEN_CHARS = 128

#: Request headers whose VALUES are kept on the journal record, to answer the
#: open provider questions (does Trade Exchange retry? does it send a delivery
#: id?). Everything else is recorded by NAME only. ⛔ Never add Authorization,
#: Cookie or any signature header here -- values are stored.
KEPT_HEADER_VALUES = frozenset({
    "user-agent", "content-type", "content-length",
    "x-request-id", "x-delivery-id", "x-webhook-id", "x-event-id",
    "x-retry-count", "x-retry", "x-attempt", "x-attempt-count",
    "idempotency-key", "x-idempotency-key",
})
#: Header names dropped entirely (not even the name is interesting, or the
#: name itself is noise added by Railway's edge).
DROPPED_HEADER_NAMES = frozenset({"cookie", "authorization", "proxy-authorization", "x-txn-token"})
MAX_HEADER_VALUE_CHARS = 200


class PayloadError(ValueError):
    def __init__(self, status: int, reason: str, label: str | None = None) -> None:
        super().__init__(reason)
        self.status = status
        self.reason = reason
        #: Only set for an allowlist refusal: the rejected ``source`` label, already
        #: passed through ``loggable_label`` (never content, never the payload).
        self.label = label


#: A rejected source label is logged so the real one can be put on the allowlist;
#: capped and reduced to a plain charset so a payload cannot smuggle text into logs.
LABEL_LOG_MAX = 32
_LABEL_CHARS = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 _.-")


def loggable_label(source: str) -> str:
    return "".join(c if c in _LABEL_CHARS else "?" for c in source[:LABEL_LOG_MAX])


# ── configuration ────────────────────────────────────────────────────────────

class Config:
    def __init__(self, env: dict[str, str] | None = None) -> None:
        env = dict(os.environ if env is None else env)
        self.enabled = env.get("TXN_RECEIVER_ENABLED", "") == "1"
        self.token_hashes = tuple(
            h.strip().lower() for h in env.get("TXN_WEBHOOK_TOKEN_SHA256", "").split(",")
            if len(h.strip()) == 64)
        self.sources = tuple(
            s.strip() for s in env.get("TXN_SOURCE_ALLOWLIST", ",".join(DEFAULT_SOURCES)).split(",")
            if s.strip())
        self.max_body_bytes = _int(env, "TXN_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES)
        self.max_content_chars = _int(env, "TXN_MAX_CONTENT_CHARS", DEFAULT_MAX_CONTENT_CHARS)
        self.rate_burst = _int(env, "TXN_RATE_BURST", 60)
        self.rate_per_sec = _float(env, "TXN_RATE_PER_SEC", 2.0)
        self.journal_timeout_s = _float(env, "TXN_JOURNAL_TIMEOUT_S", 4.0)
        self.ack_status = _int(env, "TXN_ACK_STATUS", 200)
        self.auth_modes = frozenset(
            m.strip().lower() for m in env.get("TXN_AUTH_MODES", "path,bearer,basic,header").split(",")
            if m.strip().lower() in AUTH_MODES)
        # ⛔ Real Trade Exchange content is stored (R2 + web) only once its
        # retention/redistribution permission is confirmed in writing (owner rule).
        self.storage_permitted = env.get("TXN_STORAGE_PERMISSION_CONFIRMED", "") == "1"
        # Staging (D2): store ONLY content starting with SYNTHETIC_PREFIX, refuse the rest.
        self.synthetic_only = env.get("TXN_SYNTHETIC_ONLY", "") == "1"
        self.web_ingest_url = env.get(
            "TXN_WEB_INGEST_URL",
            "http://web.railway.internal:8080/api/trade-exchange-news/internal/ingest")
        self.ingest_token = env.get("TXN_INGEST_TOKEN", "")
        self.on_railway = bool(env.get("RAILWAY_ENVIRONMENT"))
        self.allow_ephemeral = env.get("TXN_JOURNAL_ALLOW_EPHEMERAL", "") == "1"
        self.instance = (env.get("RAILWAY_REPLICA_ID") or env.get("HOSTNAME") or "local")[:12]
        self.commit = (env.get("RAILWAY_GIT_COMMIT_SHA") or "unknown")[:9]


def _int(env: dict[str, str], key: str, default: int) -> int:
    try:
        return int(env.get(key, default))
    except (TypeError, ValueError):
        return default


def _float(env: dict[str, str], key: str, default: float) -> float:
    try:
        v = float(env.get(key, default))
        return v if math.isfinite(v) and v > 0 else default
    except (TypeError, ValueError):
        return default


# ── the credential ───────────────────────────────────────────────────────────

def token_sha256(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


#: Where the sender may present the secret. Everything except ``path`` keeps it
#: out of the request line -- and therefore out of Railway's HTTP logs.
AUTH_MODES = ("path", "bearer", "basic", "header")
TOKEN_HEADER = "x-txn-token"


def presented_credential(path_token: str, headers: Any, modes: frozenset[str]) -> str:
    """The secret the request carries, from the first enabled place it is found.

    * ``bearer`` -- ``Authorization: Bearer <secret>``
    * ``basic``  -- ``https://txn:<secret>@host/hook``: an HTTP client that honours
                    URL userinfo sends it as ``Authorization: Basic`` (the password
                    is the secret, the user name is ignored), so the secret is never
                    in the path. Works only if Trade Exchange's client does this.
    * ``header`` -- ``X-TXN-Token: <secret>`` (if the destination allows custom headers)
    * ``path``   -- ``/hook/<secret>``, the fallback that needs nothing of the sender.
    """
    auth = headers.get("authorization", "") or ""
    if "bearer" in modes and auth[:7].lower() == "bearer ":
        return auth[7:].strip()
    if "basic" in modes and auth[:6].lower() == "basic ":
        try:
            decoded = base64.b64decode(auth[6:].strip(), validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return ""
        return decoded.split(":", 1)[1] if ":" in decoded else ""
    if "header" in modes and headers.get(TOKEN_HEADER):
        return str(headers.get(TOKEN_HEADER)).strip()
    if "path" in modes and path_token:
        return path_token
    return ""


def verify_token(token: str, allowed_hashes: tuple[str, ...]) -> bool:
    """Is ``token`` one of the configured webhook secrets?

    ⛔ Only HASHES are configured (``TXN_WEBHOOK_TOKEN_SHA256``), so the
    receiver's own environment cannot leak the URL. Every configured hash is
    compared, with ``hmac.compare_digest``, and the loop does not stop at a
    match -- the answer takes the same time whichever slot (if any) matched.
    Two hashes may be live at once: that is the rotation window.
    """
    if not allowed_hashes or not token or len(token) > MAX_TOKEN_CHARS:
        return False
    digest = token_sha256(token)
    ok = False
    for h in allowed_hashes:
        ok |= hmac.compare_digest(digest, h)
    return ok


# ── the rate ─────────────────────────────────────────────────────────────────

class TokenBucket:
    """One bucket per process. There is ONE sender, so a per-sender key would
    be the same key; what this bounds is a leaked URL being used as a firehose.
    Overlapping instances during a deploy each hold their own bucket."""

    def __init__(self, burst: int, per_sec: float, clock=time.monotonic) -> None:
        self.capacity = float(max(1, burst))
        self.rate = float(per_sec)
        self.tokens = self.capacity
        self.clock = clock
        self.stamp = clock()
        self._lock = threading.Lock()

    def take(self) -> bool:
        with self._lock:
            now = self.clock()
            self.tokens = min(self.capacity, self.tokens + (now - self.stamp) * self.rate)
            self.stamp = now
            if self.tokens >= 1.0:
                self.tokens -= 1.0
                return True
            return False


# ── the payload ──────────────────────────────────────────────────────────────

def parse_payload(raw: bytes, cfg: Config) -> tuple[str, str, dict[str, Any]]:
    """``(source, content, extra)`` or a ``PayloadError``.

    Strict on what is documented, tolerant of what is not: ``source`` and
    ``content`` must be present, strings, and in bounds; any OTHER key is
    carried through untouched. Refusing an undocumented field would turn a
    harmless provider-side addition into lost headlines.
    """
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise PayloadError(400, "body is not UTF-8") from None
    try:
        obj = json.loads(text)
    except ValueError:
        raise PayloadError(400, "body is not JSON") from None
    if not isinstance(obj, dict):
        raise PayloadError(422, "body must be a JSON object")
    source = obj.get("source")
    content = obj.get("content")
    if not isinstance(source, str) or not source.strip():
        raise PayloadError(422, "source must be a non-empty string")
    if not isinstance(content, str) or not content.strip():
        raise PayloadError(422, "content must be a non-empty string")
    source = source.strip()
    if source not in cfg.sources:
        raise PayloadError(422, "source is not on the allowlist", loggable_label(source))
    if len(content) > cfg.max_content_chars:
        raise PayloadError(413, "content is longer than the configured limit")
    extra = {k: v for k, v in obj.items() if k not in ("source", "content")}
    # ⭐ The ORIGINAL content is kept byte-for-byte (no strip, no normalising):
    # what Trade Exchange published is what is journaled and shown.
    return source, content, extra


def delivery_meta(headers: dict[str, str], body_bytes: int, remote: str | None) -> dict[str, Any]:
    names = sorted({k.lower() for k in headers} - DROPPED_HEADER_NAMES)
    kept = {k: str(v)[:MAX_HEADER_VALUE_CHARS] for k, v in
            ((k.lower(), v) for k, v in headers.items()) if k in KEPT_HEADER_VALUES}
    return {"header_names": names, "headers": kept, "body_bytes": body_bytes,
            "remote": (remote or "")[:64]}


def build_record(source: str, content: str, extra: dict[str, Any], meta: dict[str, Any],
                 cfg: Config, now_ms: int | None = None) -> dict[str, Any]:
    ms = int(time.time() * 1000) if now_ms is None else int(now_ms)
    return {
        "v": RECORD_VERSION,
        "id": new_event_id(ms),
        "received_at_ms": ms,
        "received_at": datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
                               .isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "source": source,
        "content": content,
        "extra": extra,
        "delivery": meta,
        "receiver": {"instance": cfg.instance, "commit": cfg.commit},
    }


# ── counters (process-local, names only, never content) ──────────────────────

class Counters:
    NAMES = ("received", "accepted", "refused_unknown", "rate_limited", "refused_oversize",
             "refused_malformed", "refused_source", "journal_failed",
             "forwarded", "forward_failed", "durable_via_journal", "durable_via_web",
             "rejournaled", "rejournal_failed", "refused_unpermitted", "refused_not_synthetic")

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.values = {n: 0 for n in self.NAMES}
        self.last_accepted_ms: int | None = None

    def inc(self, name: str) -> None:
        with self._lock:
            self.values[name] += 1

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {**self.values, "last_accepted_ms": self.last_accepted_ms}
