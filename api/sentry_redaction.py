"""Keep credentials that ride in a URL out of Sentry (web's ``before_send``).

⛔ THE GAP THIS CLOSES (found in the Trade Exchange News Checkpoint B review).
``sentry_sdk.init`` in ``api/main.py`` had no ``before_send``. The SDK already
drops sensitive HEADERS (Authorization, Cookie, ...) when ``send_default_pii``
is off, but it copies the full request URL into every event -- so an error
raised while serving ``/api/inbound-alerts/hook/<token>`` (TERM-086, the
TradingView receiver, whose per-member secret IS the path) would have put a
live credential into Sentry, and a transaction sample would carry it in its
spans too.

⭐ NARROW, AND ONE AUTHORITY. The paths are ``logging_redaction.
REDACTED_PATH_PREFIXES`` -- the list the access-log backstop already uses -- so
a new credential-in-path route is redacted in both places by one edit. The
only other thing rewritten is the VALUE of a query parameter whose NAME is
credential-shaped (``token``, ``secret``, ``signature``, ``api_key`` ...).
Nothing else in an event is touched: stack traces, tags, breadcrumb messages
and request metadata all keep reaching Sentry exactly as before.

⛔ NEVER RAISES. If redaction itself fails, the URL-bearing fields are dropped
rather than sent unredacted, and the rest of the event is kept.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qsl, urlencode

from api.logging_redaction import PATH_REDACTION, REDACTED_PATH_PREFIXES

SENSITIVE_QUERY_KEYS = frozenset({
    "token", "access_token", "auth", "secret", "signature", "sig", "api_key", "apikey", "key",
})

_PATH_RES = tuple(re.compile(re.escape(p) + r"[^\s\"'?#]*") for p in REDACTED_PATH_PREFIXES)
_QUERY_RE = re.compile(r"(?i)([?&](?:%s)=)[^&#\s\"']*" % "|".join(
    sorted((re.escape(k) for k in SENSITIVE_QUERY_KEYS), key=len, reverse=True)))


def redact_text(text: str) -> str:
    for prefix, rx in zip(REDACTED_PATH_PREFIXES, _PATH_RES):
        if prefix in text:
            text = rx.sub(prefix + PATH_REDACTION, text)
    if "=" in text:
        text = _QUERY_RE.sub(r"\1" + PATH_REDACTION, text)
    return text


def _redact_query_string(qs: Any) -> Any:
    if isinstance(qs, str) and qs:
        pairs = parse_qsl(qs, keep_blank_values=True)
        return urlencode([(k, PATH_REDACTION if k.lower() in SENSITIVE_QUERY_KEYS else v)
                          for k, v in pairs])
    return qs


def _walk(obj: Any) -> Any:
    if isinstance(obj, str):
        return redact_text(obj)
    if isinstance(obj, list):
        return [_walk(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _walk(v) for k, v in obj.items()}
    return obj


def _scrub(event: dict[str, Any]) -> dict[str, Any]:
    try:
        req = event.get("request")
        if isinstance(req, dict):
            if "url" in req:
                req["url"] = _walk(req["url"])
            if "query_string" in req:
                req["query_string"] = _redact_query_string(req["query_string"])
            headers = req.get("headers")
            if isinstance(headers, dict):
                for h in list(headers):
                    if h.lower() == "referer":
                        headers[h] = _walk(headers[h])
        for k in ("transaction", "spans", "breadcrumbs", "exception", "message", "logentry"):
            if k in event:
                event[k] = _walk(event[k])
        return event
    except Exception:  # noqa: BLE001 -- fail closed on the URL fields only
        req = event.get("request")
        if isinstance(req, dict):
            req.pop("url", None)
            req.pop("query_string", None)
        event.pop("spans", None)
        event.pop("breadcrumbs", None)
        return event


def before_send(event: dict[str, Any], _hint: Any = None) -> dict[str, Any]:
    return _scrub(event)


def before_send_transaction(event: dict[str, Any], _hint: Any = None) -> dict[str, Any]:
    return _scrub(event)
