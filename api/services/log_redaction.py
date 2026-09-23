"""Structural redaction of credentials in URL query strings -- for every log line.

⚰️ WHY: several providers take their credential as a QUERY PARAMETER (Massive
`apiKey=`, FMP `apikey=`, UCT's own calendar feed `?token=`). A request URL then
reaches logs by two ordinary routes, both MEASURED:
  * HTTP-client request logging (httpx logs every URL at INFO) -- the first
    fundamentals production run wrote the Massive key into its job log;
  * exception messages -- `httpx.HTTPStatusError` carries the full URL, and
    `logger.info("... failed: %s", e)` prints it (reference_corp_actions does).

Redaction is keyed on the PARAMETER NAME, never on a secret's value: a rotated or
new key is covered the moment it exists, and nothing here ever holds a secret.

install() wraps the process-wide LogRecordFactory, so EVERY record -- any logger,
any handler, uvicorn's access log included -- is redacted at creation: its
message, its formatted traceback, and its stack info. `redact(text)` is for the
places that write text without logging (status files, job reports).
"""
from __future__ import annotations

import logging
import re

# name=value in a query string or form body; the name list is deliberately broad.
_PARAM = re.compile(
    r"(?i)(?P<pre>[?&;]|\b)(?P<name>api[_-]?key|apikey|access[_-]?key|access[_-]?token|auth[_-]?token|"
    r"token|secret|client[_-]?secret|password|passwd|signature|sig|x-amz-signature|x-amz-credential)"
    r"=(?P<val>[^&\s\"'#<>,;)]+)")
MASK = "REDACTED"
_installed = False


def redact(text):
    """Return `text` with every credential-named query value replaced. Non-str
    values are returned unchanged."""
    if not isinstance(text, str) or "=" not in text:
        return text
    return _PARAM.sub(lambda m: f"{m.group('pre')}{m.group('name')}={MASK}", text)


def install() -> bool:
    """Idempotently wrap the global LogRecordFactory. Returns True if newly installed."""
    global _installed
    if _installed:
        return False
    base = logging.getLogRecordFactory()
    fmt = logging.Formatter()

    def factory(*args, **kwargs):
        record = base(*args, **kwargs)
        try:
            msg = record.getMessage()
            clean = redact(msg)
            if clean is not msg and clean != msg:
                record.msg, record.args = clean, None
            if record.exc_info:
                record.exc_text = redact(fmt.formatException(record.exc_info))
            if record.stack_info:
                record.stack_info = redact(record.stack_info)
        except Exception:            # a redaction failure must never lose the log line
            pass
        return record

    logging.setLogRecordFactory(factory)
    _installed = True
    return True
