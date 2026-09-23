"""Credentials in URL query strings never reach a log line (api/services/log_redaction.py).

Keyed on the PARAMETER NAME, so these fixtures use obviously fake values and the
suite needs no secret to prove anything.
"""
import io
import logging

import pytest

from api.services import log_redaction as LR

FAKE = "FAKEKEY0123456789abcdefFAKE"


@pytest.mark.parametrize("text", [
    f"GET https://api.massive.com/v3/reference/splits?cursor=abc&apiKey={FAKE} \"HTTP/1.1 200 OK\"",
    f"https://financialmodelingprep.com/stable/grades?symbol=AAPL&limit=8&apikey={FAKE}",
    f"/api/calendar/export.ics?scope=mine&token={FAKE}",
    f"https://x.example/path?api_key={FAKE}&access_token={FAKE}",
    f"Client error '403 Forbidden' for url 'https://api.massive.com/v2/aggs?apiKey={FAKE}'",
])
def test_every_credential_named_parameter_is_masked(text):
    out = LR.redact(text)
    assert FAKE not in out and "REDACTED" in out


def test_ordinary_text_and_non_credential_parameters_are_untouched():
    for text in ("?symbol=AAPL&limit=8", "monkey=1 turkey=2", "no equals sign", "" ):
        assert LR.redact(text) == text
    assert LR.redact(None) is None and LR.redact(42) == 42


def test_the_record_factory_redacts_messages_args_and_tracebacks():
    LR.install()
    LR.install()                                      # idempotent
    buf = io.StringIO()
    h = logging.StreamHandler(buf)
    h.setFormatter(logging.Formatter("%(message)s"))
    lg = logging.getLogger("test.redaction")
    lg.addHandler(h)
    lg.setLevel(logging.INFO)
    lg.propagate = False
    try:
        # the MEASURED shape: an HTTP status error whose message carries the URL, logged via %s
        err = RuntimeError(f"Client error '403' for url 'https://api.massive.com/v3/x?apiKey={FAKE}'")
        lg.info("[reference-corp-actions] splits fetch failed: %s", err)
        lg.info("HTTP Request: GET https://api.massive.com/v3/x?limit=1&apiKey=%s", FAKE)
        try:
            raise ValueError(f"boom https://h/p?token={FAKE}")
        except ValueError:
            lg.exception("wrapped")
    finally:
        lg.removeHandler(h)
    out = buf.getvalue()
    assert FAKE not in out, out
    assert out.count("REDACTED") >= 3
