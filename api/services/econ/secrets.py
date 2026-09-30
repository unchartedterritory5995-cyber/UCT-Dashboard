"""Provider API keys + secret redaction for the econ package.

THE RULE: a provider key never reaches a log line, an exception message, a
``request_key``, an ``acquisition.error`` row or an artifact. UCT already has
an open incident class of plaintext provider keys in bars-api logs; econ does
not repeat it.

Where the keys travel (so the scrubber knows what to look for):
    BLS v2   POST JSON body   {"registrationkey": "<key>"}
    BEA      query string     ?UserID=<key>
    Census   query string     ?key=<key>
    EIA      query string     ?api_key=<key>

Two independent scrubbers, both applied by :func:`redact`:
  (a) VALUE scrub  -- every currently configured secret value (the four provider
      envs + any env var named ``*_API_KEY``/``*_KEY``/``*_TOKEN``/``*_SECRET``
      whose value is >= 8 chars), in raw, URL-encoded and JSON-escaped forms,
      wherever it appears.
  (b) NAME scrub   -- known secret parameter names in URLs / query strings /
      form bodies / JSON / Python dict reprs have their VALUE replaced with
      ``[REDACTED]`` even when the value is not a configured secret (a stale or
      foreign key is still a key).

``configured()`` reports presence only -- it never returns a value.
"""
from __future__ import annotations

import json
import logging
import os
import re
import traceback
from urllib.parse import quote, quote_plus

REDACTED = "[REDACTED]"

KEY_ENV = {
    "bls": "BLS_API_KEY",
    "bea": "BEA_API_KEY",
    "census": "CENSUS_API_KEY",
    "eia": "EIA_API_KEY",
}

# Env-var name suffixes whose values are treated as secrets for the VALUE scrub.
# ("_KEY" already covers every *_API_KEY; spelling "_API_KEY" out here would read
# as an env-var NAME to the hub-sandbox key census, tests/test_hub_sandbox_model_keys.py.)
_SECRET_ENV_SUFFIXES = ("_KEY", "_TOKEN", "_SECRET")
_MIN_SECRET_LEN = 8

# Parameter / field names whose VALUES are always redacted (case-insensitive).
SECRET_PARAM_NAMES = ("registrationkey", "userid", "api_key", "apikey", "key", "token",
                      "access_token", "api-key", "x-api-key", "authorization")

_NAMES_RE = "|".join(re.escape(n) for n in sorted(SECRET_PARAM_NAMES, key=len, reverse=True))

# name=value in a URL / query string / form body. The name must start at a
# boundary (start, ?, &, ;, whitespace, quote, or '(' ) so "monkey=" is not "key=".
_QS_RE = re.compile(
    r"(?i)(^|[?&;\s\"'(,])(" + _NAMES_RE + r")=([^&;\s#\"'<>),]*)")
# URL-encoded query inside another string: key%3Dvalue (value up to %26 / delimiter)
_QS_ENC_RE = re.compile(
    r"(?i)(^|%3F|%26|[?&;\s\"'(,])(" + _NAMES_RE + r")%3D((?:(?!%26)[^&;\s#\"'<>),])*)")
# "name": "value"  (JSON) -- value may contain escaped chars
_JSON_STR_RE = re.compile(
    r'(?i)("(?:' + _NAMES_RE + r')"\s*:\s*)"((?:[^"\\]|\\.)*)"')
# "name": 12345 / true (JSON non-string scalar)
_JSON_BARE_RE = re.compile(
    r'(?i)("(?:' + _NAMES_RE + r')"\s*:\s*)(-?[0-9A-Za-z_.+-]+)')
# 'name': 'value'  (Python dict repr, e.g. a headers dict or params dict)
_REPR_RE = re.compile(
    r"(?i)('(?:" + _NAMES_RE + r")'\s*:\s*)'((?:[^'\\]|\\.)*)'")
# Authorization: Bearer xxx  (header line form)
_AUTH_LINE_RE = re.compile(r"(?i)(\bauthorization\s*:\s*)([^\r\n,}]+)")


# --------------------------------------------------------------------------- keys

def provider_key(adapter: str) -> str | None:
    """The configured key for ``adapter`` (``"bls"`` ...), stripped; empty -> None."""
    env = KEY_ENV.get((adapter or "").lower())
    if not env:
        return None
    val = (os.environ.get(env) or "").strip()
    return val or None


def configured() -> dict[str, bool]:
    """{adapter: key present?}. NEVER values."""
    return {a: provider_key(a) is not None for a in KEY_ENV}


def _secret_values() -> list[str]:
    vals: set[str] = set()
    for env in KEY_ENV.values():
        v = (os.environ.get(env) or "").strip()
        if v:
            vals.add(v)          # provider keys are always scrubbed, any length
    for name, v in os.environ.items():
        if not name.upper().endswith(_SECRET_ENV_SUFFIXES):
            continue
        v = (v or "").strip()
        if len(v) >= _MIN_SECRET_LEN:
            vals.add(v)
    return list(vals)


def _value_forms(v: str) -> set[str]:
    forms = {v, quote(v, safe=""), quote_plus(v), quote(v)}
    try:
        forms.add(json.dumps(v)[1:-1])
        forms.add(json.dumps(v, ensure_ascii=False)[1:-1])
    except Exception:  # pragma: no cover
        pass
    # repr() escaping (e.g. a key that contains a quote or backslash)
    forms.add(repr(v)[1:-1])
    return {f for f in forms if f}


# --------------------------------------------------------------------------- redact

def redact(text) -> str:
    """Scrub secrets from ``text`` (any object is ``str()``-ed first)."""
    if text is None:
        return ""
    if isinstance(text, bytes):
        text = text.decode("utf-8", "replace")
    elif not isinstance(text, str):
        text = str(text)
    if not text:
        return text

    # (a) configured secret values, longest form first so a longer form is
    # never half-replaced by a shorter one.
    forms: set[str] = set()
    for v in _secret_values():
        forms |= _value_forms(v)
    for f in sorted(forms, key=len, reverse=True):
        if f in text:
            text = text.replace(f, REDACTED)
        # case-insensitive percent-encoding (%2f vs %2F)
        if "%" in f and f.lower() != f:
            text = re.sub(re.escape(f), REDACTED, text, flags=re.IGNORECASE)

    # (b) known secret parameter names
    text = _QS_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}={REDACTED}", text)
    text = _QS_ENC_RE.sub(lambda m: f"{m.group(1)}{m.group(2)}%3D{REDACTED}", text)
    text = _JSON_STR_RE.sub(lambda m: f'{m.group(1)}"{REDACTED}"', text)
    text = _JSON_BARE_RE.sub(lambda m: f'{m.group(1)}"{REDACTED}"', text)
    text = _REPR_RE.sub(lambda m: f"{m.group(1)}'{REDACTED}'", text)
    text = _AUTH_LINE_RE.sub(lambda m: f"{m.group(1)}{REDACTED}", text)
    return text


def safe_exc(e: BaseException) -> str:
    """One-line, redacted ``Type: message`` for storage (acquisition.error) / logs."""
    msg = redact(str(e))
    msg = " ".join(msg.split())
    return f"{type(e).__name__}: {msg}" if msg else type(e).__name__


# --------------------------------------------------------------------------- logging

ECON_LOGGERS = ("api.services.econ", "api.econ_main")


def _scrub_record(record: logging.LogRecord) -> logging.LogRecord:
    if getattr(record, "_econ_redacted", False):
        return record
    # NB: module-level lookup of ``redact`` on every call (tests mutate it).
    _redact = globals()["redact"]
    try:
        msg = record.getMessage()
    except Exception:
        msg = f"{record.msg!r} % {record.args!r}"
    record.msg = _redact(msg)
    record.args = ()
    if record.exc_info:
        try:
            et, ev, tb = record.exc_info
            formatted = "".join(traceback.format_exception(et, ev, tb)).rstrip("\n")
        except Exception:
            formatted = repr(record.exc_info[1])
        record.exc_text = _redact(formatted)
        # Drop the live exception so no downstream formatter re-renders it raw.
        record.exc_info = None
    elif record.exc_text:
        record.exc_text = _redact(record.exc_text)
    if record.stack_info:
        record.stack_info = _redact(record.stack_info)
    record._econ_redacted = True
    return record


class RedactingFilter(logging.Filter):
    """Redacts msg+args (merged), exception text and stack info. Always passes."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: A003
        _scrub_record(record)
        return True


_installed_prefixes: set[str] = set()
_factory_installed = False
_FILTER = RedactingFilter()


def _in_scope(name: str) -> bool:
    return any(name == p or name.startswith(p + ".") for p in _installed_prefixes)


def install_logging_redaction(logger_names=ECON_LOGGERS) -> None:
    """Redact every record logged anywhere in the econ logger tree.

    Logger- and handler-level filters alone do not cover a record created on a
    CHILD logger and propagated to the ROOT handlers (logger filters only run on
    the originating logger). So in addition to attaching :class:`RedactingFilter`
    to the named loggers and their handlers, this chains a LogRecord factory
    that scrubs records whose logger is inside the named trees at creation
    time. Idempotent; records outside the econ tree are untouched.
    """
    global _factory_installed
    for name in logger_names:
        _installed_prefixes.add(name)
        lg = logging.getLogger(name)
        if _FILTER not in lg.filters:
            lg.addFilter(_FILTER)
        for h in lg.handlers:
            if _FILTER not in h.filters:
                h.addFilter(_FILTER)
    if not _factory_installed:
        prev = logging.getLogRecordFactory()

        def _factory(*args, **kwargs):
            rec = prev(*args, **kwargs)
            if _in_scope(rec.name):
                _scrub_record(rec)
            return rec

        _factory._econ_redacting = True  # type: ignore[attr-defined]
        logging.setLogRecordFactory(_factory)
        _factory_installed = True
