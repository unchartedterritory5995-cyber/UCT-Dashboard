"""SnapTrade webhook authentication.

SnapTrade's documented scheme (docs.snaptrade.com/docs/webhooks): each
delivery carries a `Signature` header = base64(HMAC-SHA256(consumerKey,
json.dumps(payload, separators=(",", ":"), sort_keys=True))), and events
older than ~300s should be rejected (replay protection). The older
`webhookSecret` payload-field comparison is deprecated for verification but
still delivered — we keep it as a fallback so a scheme drift on SnapTrade's
side can never silently drop real deliveries (mismatched signatures that
pass the legacy check are accepted and logged loudly instead).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("broker_webhook")

MAX_EVENT_AGE_SECONDS = 300.0


def compute_signature(payload: dict[str, Any], consumer_key: str) -> str:
    canonical = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    digest = hmac.new(consumer_key.encode("utf-8"), canonical.encode("utf-8"),
                      hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def _parse_event_ts(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _fresh(body: dict[str, Any], now: datetime | None) -> bool:
    ts = _parse_event_ts(body.get("eventTimestamp"))
    if ts is None:
        # No parseable timestamp — don't reject (SnapTrade includes it, but a
        # missing field must not hard-fail deliveries).
        return True
    now = now or datetime.now(timezone.utc)
    return abs((now - ts).total_seconds()) <= MAX_EVENT_AGE_SECONDS


def verify(body: dict[str, Any], signature_header: str | None, *,
           consumer_key: str | None, legacy_secret: str | None,
           now: datetime | None = None) -> tuple[bool, str]:
    """Returns (accepted, mode). mode ∈ signature | legacy |
    legacy-after-signature-mismatch | rejected | unconfigured."""
    if not consumer_key and not legacy_secret:
        return False, "unconfigured"

    sig_ok = False
    if signature_header and consumer_key:
        # The signed payload may or may not include the (deprecated)
        # webhookSecret field depending on delivery vintage — accept either.
        candidates = [body]
        if "webhookSecret" in body:
            candidates.append({k: v for k, v in body.items() if k != "webhookSecret"})
        for candidate in candidates:
            expected = compute_signature(candidate, consumer_key)
            if hmac.compare_digest(expected, signature_header.strip()):
                sig_ok = True
                break
        if sig_ok:
            if not _fresh(body, now):
                return False, "rejected"  # replay / stale event
            return True, "signature"

    legacy_ok = bool(
        legacy_secret
        and hmac.compare_digest(str(body.get("webhookSecret") or ""), legacy_secret)
    )
    if legacy_ok:
        if signature_header and consumer_key:
            # Signature present but didn't match our computation — accept via
            # legacy so prod never drops real events, but make it visible.
            logger.warning(
                "webhook Signature header mismatch; accepted via legacy secret "
                "(event=%s)", body.get("eventType"))
            return True, "legacy-after-signature-mismatch"
        return True, "legacy"

    return False, "rejected"
