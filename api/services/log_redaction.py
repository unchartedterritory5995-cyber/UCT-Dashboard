"""Structural redaction of credentials in URL query strings -- for every log line.

⚰️ WHY: several providers take their credential as a QUERY PARAMETER (Massive
`apiKey=`, FMP `apikey=`, UCT's own calendar feed `?token=`). A request URL then
reaches logs by two ordinary routes, both MEASURED:
  * HTTP-client request logging (httpx logs every URL at INFO) -- the first
    fundamentals production run wrote the Massive key into its job log;
  * exception messages -- `httpx.HTTPStatusError` / `requests.HTTPError` carry the
    full URL, and `logger.info("... failed: %s", e)` prints it
    (reference_corp_actions did; so did `earnings_estimates._fmp_get`, 2026-11-11:
    the FMP key reached the web pod's logs through the standalone `rs_history`
    CLI, a process that never imported the web app and so never installed the
    factory below).

Redaction is keyed on the PARAMETER NAME, never on a secret's value: a rotated or
new key is covered the moment it exists, and nothing here ever holds a secret.

Three layers:
  1. `install()` wraps the process-wide LogRecordFactory, so EVERY record -- any
     logger, any handler, uvicorn's access log included -- is redacted at creation:
     its message, its formatted traceback, and its stack info.
  2. `RedactSecretsFilter` sits on every ROOT HANDLER (`install()` attaches it; a CLI
     that calls `logging.basicConfig` AFTER `install()` calls `install()` again).
  3. `safe_exc(exc)`: a call site that logs an outbound HTTP failure logs THIS
     instead of the raw exception, so the protection does not rest on 1 and 2 alone.
`redact(text)` is for the places that write text without logging (status files,
job reports).
"""
from __future__ import annotations

import logging
import re

# name=value in a query string or form body; the name list is deliberately broad.
_PARAM = re.compile(
    r"(?i)(?P<pre>[?&;]|\b)(?P<name>api[_-]?key|apikey|access[_-]?key|access[_-]?token|auth[_-]?token|"
    r"token|secret|client[_-]?secret|password|passwd|signature|sig|x-amz-signature|x-amz-credential)"
    r"=(?P<val>[^&\s\"'#<>,;)]+)")
# Short, common words: a credential only INSIDE a query string (`?key=` / `&auth=`),
# never as bare prose such as "cache key=abc".
_QPARAM = re.compile(r"(?i)(?P<pre>[?&;])(?P<name>key|auth)=(?P<val>[^&\s\"'#<>,;)]+)")
# JSON / dict-repr form: "apikey": "abc"  /  'access_token': 'abc'
_JSONISH = re.compile(
    r"(?i)(?P<pre>[\"'](?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|client[_-]?secret|"
    r"secret|password|signature)[\"']\s*:\s*[\"'])(?P<val>[^\"']+)(?P<post>[\"'])")
# `Authorization: Bearer abc` (also the dict repr `'Authorization': 'Bearer abc'`)
_AUTH_HDR = re.compile(
    r"(?i)(?P<pre>\b(?:proxy-)?authorization[\"']?\s*[:=]\s*[\"']?)"
    r"(?:(?:bearer|basic|token)\s+)?[^\s\"',;}]+")
_BEARER = re.compile(r"(?i)\b(?P<pre>bearer\s+)[A-Za-z0-9._~+/=\-]+")
_URL_QUERY = re.compile(r"(?P<base>https?://[^\s?#\"'<>]+)\?[^\s\"'<>#]*")
MASK = "REDACTED"
FILTER_ERROR_TEXT = "[log message redacted: filter error]"
_installed = False


def redact(text):
    """Return `text` with every credential replaced by REDACTED, the rest of the URL
    intact. Non-str values are returned unchanged. Idempotent; never raises."""
    if not isinstance(text, str) or not text:
        return text
    try:
        out = text
        if "=" in out:
            out = _PARAM.sub(lambda m: f"{m.group('pre')}{m.group('name')}={MASK}", out)
            out = _QPARAM.sub(lambda m: f"{m.group('pre')}{m.group('name')}={MASK}", out)
        if ":" in out or "=" in out:
            out = _AUTH_HDR.sub(lambda m: m.group("pre") + MASK, out)
            out = _JSONISH.sub(lambda m: m.group("pre") + MASK + m.group("post"), out)
        if "earer" in out or "EARER" in out:
            out = _BEARER.sub(lambda m: m.group("pre") + MASK, out)
        return out
    except Exception:                 # a redaction failure must never lose the log line
        return FILTER_ERROR_TEXT


def strip_query(text):
    """Cut the query string off every http(s) URL in `text`. For error text where even
    the non-secret parameters are not needed. Never raises."""
    if not isinstance(text, str) or "?" not in text:
        return text
    try:
        return _URL_QUERY.sub(lambda m: m.group("base"), text)
    except Exception:
        return FILTER_ERROR_TEXT


def safe_exc(exc, limit: int = 300) -> str:
    """A log-safe description of an exception from an outbound HTTP call:
    `ClassName status=429 url=<url with the query stripped>`, falling back to the
    redacted, query-stripped message. THE form to put in `logger.*("...: %s", ...)`
    for anything that talks to a vendor -- `requests`/`httpx` put the full URL, query
    string and all, in the message, and a vendor key often rides in that query."""
    try:
        name = type(exc).__name__
        resp = getattr(exc, "response", None)
        req = getattr(exc, "request", None)
        status = getattr(resp, "status_code", None)
        url = getattr(resp, "url", None) or getattr(req, "url", None)
        if status is not None or url is not None:
            parts = [name]
            if status is not None:
                parts.append(f"status={status}")
            if url is not None:
                parts.append(f"url={strip_query(redact(str(url)))}")
            return " ".join(parts)[:limit]
        return f"{name}: {strip_query(redact(str(exc)))}"[:limit]
    except Exception:
        return FILTER_ERROR_TEXT


_FMT = logging.Formatter()


def _scrub_record(record: logging.LogRecord) -> None:
    """Redact `record` in place: message (args folded in), formatted traceback, stack."""
    if getattr(record, "_uct_redacted", False):
        return
    try:
        msg = record.getMessage()
        clean = redact(msg)
        if clean != msg:
            record.msg, record.args = clean, None
        if record.exc_info:
            record.exc_text = redact(_FMT.formatException(record.exc_info))
        elif record.exc_text:
            record.exc_text = redact(record.exc_text)
        if record.stack_info:
            record.stack_info = redact(record.stack_info)
        record._uct_redacted = True
    except Exception:
        # args that cannot be formatted, an exception whose __str__ raises, ...: keep
        # the record (never drop or break logging) but with a generic body.
        try:
            record.msg, record.args = FILTER_ERROR_TEXT, None
            record.exc_info, record.exc_text, record.stack_info = None, None, None
            record._uct_redacted = True
        except Exception:
            pass


class RedactSecretsFilter(logging.Filter):
    """Handler/logger filter: credentials never reach the emitted text. Never raises,
    never drops a record, idempotent."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            _scrub_record(record)
        except Exception:
            pass
        return True


def install_on_root_handlers() -> int:
    """Attach `RedactSecretsFilter` to every root-logger handler that lacks one.
    Returns how many were added. Call again after `logging.basicConfig`."""
    n = 0
    for h in list(logging.getLogger().handlers):
        if not any(isinstance(f, RedactSecretsFilter) for f in h.filters):
            h.addFilter(RedactSecretsFilter())
            n += 1
    return n


def install() -> bool:
    """Idempotently wrap the global LogRecordFactory AND put the filter on the root
    logger's handlers. Returns True if the factory was newly installed."""
    global _installed
    install_on_root_handlers()
    if _installed:
        return False
    base = logging.getLogRecordFactory()

    def factory(*args, **kwargs):
        record = base(*args, **kwargs)
        _scrub_record(record)
        return record

    logging.setLogRecordFactory(factory)
    _installed = True
    return True
