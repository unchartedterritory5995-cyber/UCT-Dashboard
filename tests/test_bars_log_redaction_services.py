"""Massive `apiKey=` never reaches a log line on ANY service that imports bars_fetch.

The bars-api, worker and flow-worker entrypoints never import api.main (the only
place that used to install the log redactor), so an httpx request log or an
HTTPStatusError text carrying the Massive URL went out verbatim. Fake key only.
"""
import logging
import subprocess
import sys
from pathlib import Path

import httpx
import pytest

FAKE = "FAKEKEY0123456789abcdefFAKE"
ROOT = Path(__file__).resolve().parents[1]
URL = f"https://api.massive.com/v2/aggs/ticker/X/range/1/minute/2026-11-09/2026-11-10?adjusted=true&apiKey={FAKE}"


def _status_error():
    req = httpx.Request("GET", URL)
    return httpx.HTTPStatusError("Client error '403 Forbidden' for url '%s'" % URL,
                                 request=req, response=httpx.Response(403, request=req))


def test_fetch_intraday_massive_error_log_is_redacted(monkeypatch, caplog):
    from api.services import bars_fetch as bf

    class _C:
        _api_key = FAKE

        def _get(self, url):
            raise _status_error()

    monkeypatch.setattr(bf, "_get_client", lambda: _C())
    caplog.set_level(logging.INFO)
    assert bf._fetch_intraday_massive("ZZTEST", "1", 10) == []
    text = caplog.text
    assert "HTTPStatusError" in text
    assert FAKE not in text and "REDACTED" in text


_PROBE = r"""
import io, logging, sys
import {mod}
buf = io.StringIO()
h = logging.StreamHandler(buf); h.setFormatter(logging.Formatter("%(message)s"))
lg = logging.getLogger("httpx"); lg.addHandler(h); lg.setLevel(logging.INFO); lg.propagate = False
lg.info('HTTP Request: GET %s "HTTP/1.1 403 Forbidden"', sys.argv[1])
try:
    raise RuntimeError("Client error '403' for url '%s'" % sys.argv[1])
except RuntimeError as e:
    lg.error("[bars] failed: %s", e)
sys.stdout.write(buf.getvalue())
"""


@pytest.mark.parametrize("mod", ["api.bars_api_main", "api.worker_main",
                                 "api.flow_worker_main", "api.services.bars_fetch"])
def test_every_bars_fetch_service_entrypoint_installs_redaction(mod):
    # Fresh interpreter per entrypoint: proves the module ITSELF installs the
    # redactor (this test process may already have it installed via other imports).
    r = subprocess.run([sys.executable, "-c", _PROBE.replace("{mod}", mod), URL],
                       cwd=str(ROOT), capture_output=True, text=True, timeout=180)
    assert r.returncode == 0, r.stderr[-2000:]
    assert "HTTP Request" in r.stdout and "[bars] failed" in r.stdout
    assert FAKE not in r.stdout, "credential leaked from " + mod
    assert r.stdout.count("REDACTED") >= 2
