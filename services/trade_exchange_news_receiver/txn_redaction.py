"""Keep the webhook secret out of logs and Sentry.

The hook's path segment IS the credential, so any surface that records a URL
records the secret. Three layers, because each one alone has a hole:

  1. uvicorn's access log is OFF (``txn_serve.py``) -- it prints every path.
  2. ``PathSecretFilter`` rewrites ``/hook/<anything>`` in every log record
     that reaches a root handler, so a future ``logger.info(request.url)``
     cannot leak it either.
  3. ``scrub_event`` is Sentry's ``before_send`` / ``before_send_transaction``:
     it redacts the URL, and drops headers, cookies, query and body outright.
     Sentry also runs with ``send_default_pii=False``, local variables off and
     request bodies never captured.

⚠️ NOT COVERED HERE: Railway's own edge "HTTP Logs" record request paths for
anyone with access to the Railway project. That is a platform property; it is
listed in the Checkpoint B report as a residual exposure.
"""
from __future__ import annotations

import logging
import re
from typing import Any

REDACTED = "[REDACTED]"
_HOOK_RE = re.compile(r"(/hook/)[^\s\"'?#/]+")


def redact(text: str) -> str:
    return _HOOK_RE.sub(r"\1" + REDACTED, text)


class PathSecretFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003 -- logging's name
        try:
            msg = record.getMessage()
        except Exception:  # noqa: BLE001 -- a broken format string must still log
            return True
        clean = redact(msg)
        if clean != msg:
            record.msg, record.args = clean, None
        return True


def install_log_redaction() -> None:
    f = PathSecretFilter()
    for name in ("", "uvicorn", "uvicorn.error", "uvicorn.access", "txn"):
        lg = logging.getLogger(name)
        lg.addFilter(f)
        for h in lg.handlers:
            h.addFilter(f)


def _scrub(obj: Any) -> Any:
    if isinstance(obj, str):
        return redact(obj)
    if isinstance(obj, list):
        return [_scrub(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _scrub(v) for k, v in obj.items()}
    return obj


def scrub_event(event: dict[str, Any], _hint: Any = None) -> dict[str, Any]:
    req = event.get("request")
    if isinstance(req, dict):
        for k in ("headers", "cookies", "data", "query_string", "env"):
            req.pop(k, None)
    # Everything else (url, transaction name, breadcrumbs, messages, exception
    # values) is walked and redacted rather than enumerated -- a field added
    # by a newer SDK is covered without anyone remembering to list it.
    return _scrub(event)


def init_sentry(dsn: str) -> bool:
    if not dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(dsn=dsn, send_default_pii=False, include_local_variables=False,
                    max_request_body_size="never", traces_sample_rate=0.0,
                    before_send=scrub_event, before_send_transaction=scrub_event,
                    before_breadcrumb=lambda crumb, _h: _scrub(crumb))
    return True
