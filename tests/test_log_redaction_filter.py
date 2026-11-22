"""A credential in a URL / query string / header never reaches a log line.

2026-11-11: the FMP key was printed in clear text by `rs_history` (a CLI that never
installed the redaction) via `earnings_estimates._fmp_get`, which logged
`requests`' HTTPError text -- URL, query string and all. These tests pin the three
layers (api/services/log_redaction.py): the filter, the record factory, and the
`safe_exc` helper the call sites use so they do not rest on the first two alone.

Every value below is an obvious fake. Never put a real key in this file.
"""
import ast
import http.server
import logging
import pathlib
import re
import threading

import pytest
import requests

from api.services import log_redaction as LR

FAKE = "TESTKEY123"
REPO = pathlib.Path(__file__).resolve().parent.parent


def _record(msg, args=None, exc_info=None):
    """A LogRecord built WITHOUT the (possibly installed) record factory, so these
    tests exercise the filter itself."""
    return logging.LogRecord("t", logging.WARNING, __file__, 1, msg, args, exc_info)


def _filtered_text(record):
    assert LR.RedactSecretsFilter().filter(record) is True
    return logging.Formatter("%(message)s").format(record)


@pytest.fixture
def raw_factory():
    """The plain LogRecord factory for the test: with the global redacting factory
    installed (every app entrypoint does it), a call site that logged a raw URL would
    still look clean in caplog, and these tests would prove nothing about the site."""
    saved = logging.getLogRecordFactory()
    logging.setLogRecordFactory(logging.LogRecord)
    try:
        yield
    finally:
        logging.setLogRecordFactory(saved)


@pytest.fixture
def layers_off(raw_factory, monkeypatch):
    """Factory AND every installed filter off (whatever other tests installed on the
    root handlers, caplog's included): what is left in caplog is what the CALL SITE wrote."""
    monkeypatch.setattr(LR, "_scrub_record", lambda record: None)


# ── the filter ───────────────────────────────────────────────────────────────

def test_filter_redacts_a_key_in_the_message():
    out = _filtered_text(_record(
        f"429 Client Error: Too Many Requests for url: https://financialmodelingprep.com/stable/"
        f"splits?symbol=CAPNU&limit=40&apikey={FAKE}"))
    assert FAKE not in out
    assert "symbol=CAPNU&limit=40&apikey=REDACTED" in out          # the rest of the URL is intact


def test_filter_redacts_percent_style_args():
    out = _filtered_text(_record("fetch %s failed for %s",
                                 (f"https://h/p?apiKey={FAKE}&x=1", "AAPL")))
    assert FAKE not in out and "x=1" in out and "AAPL" in out


def test_filter_redacts_an_exception_message_logged_with_percent_s():
    err = requests.HTTPError(f"500 Server Error for url: https://h/p?symbol=X&api_key={FAKE}")
    out = _filtered_text(_record("FMP %s failed: %s", ("/stable/profile", err)))
    assert FAKE not in out and "api_key=REDACTED" in out


def test_filter_redacts_the_traceback_text_of_exc_info():
    try:
        raise requests.HTTPError(f"boom https://h/p?symbol=X&token={FAKE}")
    except requests.HTTPError:
        import sys
        out = _filtered_text(_record("wrapped", None, sys.exc_info()))
    assert FAKE not in out
    assert "Traceback" in out and "token=REDACTED" in out          # still a traceback, just clean


def test_filter_redacts_bearer_and_authorization_headers():
    for text in (f"Authorization: Bearer {FAKE}",
                 f"sent headers {{'Authorization': 'Bearer {FAKE}', 'Accept': 'x'}}",
                 f"curl -H 'authorization: Basic {FAKE}'",
                 f"retry with Bearer {FAKE} failed"):
        out = _filtered_text(_record(text))
        assert FAKE not in out, text
    assert "Accept" in _filtered_text(_record(f"{{'Authorization': 'Bearer {FAKE}', 'Accept': 'x'}}"))


@pytest.mark.parametrize("name", ["apikey", "api_key", "apiKey", "key", "token", "access_token",
                                  "client_secret", "signature", "auth", "APIKEY"])
def test_every_listed_parameter_name_is_masked_case_insensitively(name):
    out = LR.redact(f"https://h/p?symbol=X&{name}={FAKE}&limit=5")
    assert FAKE not in out and "symbol=X" in out and "limit=5" in out


def test_ordinary_text_is_left_alone():
    for text in ("cache key=abc", "monkey=1 turkey=2", "?symbol=AAPL&limit=8", "no equals", ""):
        assert LR.redact(text) == text                            # bare `key=` is prose, not a query param


def test_filter_is_idempotent():
    for text in (f"retry with Bearer {FAKE} failed", f"u?token={FAKE}", f"x Authorization: Bearer {FAKE}"):
        once = LR.redact(text)
        assert FAKE not in once and LR.redact(once) == once and LR.redact(LR.redact(once)) == once
    rec = _record(f"https://h/p?apikey={FAKE} Authorization: Bearer {FAKE}")
    once = _filtered_text(rec)
    assert LR.redact(once) == once
    again = _filtered_text(rec)                                   # same record through twice
    assert again == once
    f = LR.RedactSecretsFilter()
    r2 = _record(f"u?apikey={FAKE}")
    f.filter(r2)
    f.filter(r2)
    assert FAKE not in r2.getMessage()


class _Boom:
    def __str__(self):
        raise RuntimeError("no str for you")

    __repr__ = __str__


@pytest.mark.parametrize("msg,args", [
    (None, None), (b"bytes apikey=" + FAKE.encode(), None), (12345, None),
    ("%s", (None,)), ("%s", (b"x",)), ("%s", (_Boom(),)), ("%d items", ("not a number",)),
    ("%s %s", ("only one",)), (_Boom(), None), ("%(a)s", ({"a": _Boom()},)),
])
def test_filter_never_raises_and_never_drops_a_record(msg, args):
    rec = _record(msg, args)
    assert LR.RedactSecretsFilter().filter(rec) is True           # keeps the record, never raises
    logging.Formatter("%(message)s").format(rec)                  # and the record still formats


def test_the_filter_returns_true_even_if_the_scrubber_itself_blows_up(monkeypatch):
    def boom(_):
        raise RuntimeError("scrubber exploded")
    monkeypatch.setattr(LR, "_scrub_record", boom)
    assert LR.RedactSecretsFilter().filter(_record("x")) is True


def test_a_failing_filter_falls_back_to_the_generic_text(monkeypatch):
    def boom(_):
        raise RuntimeError("redactor exploded")
    monkeypatch.setattr(LR, "redact", boom)
    rec = _record(f"u?apikey={FAKE}")
    assert LR.RedactSecretsFilter().filter(rec) is True
    assert rec.getMessage() == "[log message redacted: filter error]"


def test_a_non_string_message_is_left_in_place_when_nothing_to_redact():
    assert LR.redact(None) is None and LR.redact(7) == 7 and LR.redact(b"x") == b"x"


def test_install_puts_the_filter_on_root_handlers_once():
    root = logging.getLogger()
    h = logging.StreamHandler()
    root.addHandler(h)
    try:
        LR.install()
        LR.install()
        assert sum(isinstance(f, LR.RedactSecretsFilter) for f in h.filters) == 1
    finally:
        root.removeHandler(h)


def test_a_handler_filter_scrubs_a_record_the_factory_never_saw(raw_factory):
    import io
    buf = io.StringIO()
    h = logging.StreamHandler(buf)
    h.setFormatter(logging.Formatter("%(message)s"))
    h.addFilter(LR.RedactSecretsFilter())
    lg = logging.getLogger("test.filter.only")
    lg.addHandler(h)
    lg.propagate = False
    lg.setLevel(logging.INFO)
    try:
        lg.info("GET https://h/p?apikey=%s", FAKE)
    finally:
        lg.removeHandler(h)
    assert FAKE not in buf.getvalue() and "REDACTED" in buf.getvalue()


# ── safe_exc ─────────────────────────────────────────────────────────────────

class _Stub(http.server.BaseHTTPRequestHandler):
    def do_GET(self):                                             # noqa: N802
        self.send_response(429)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *a):
        pass


@pytest.fixture
def stub_429():
    srv = http.server.HTTPServer(("127.0.0.1", 0), _Stub)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}"
    finally:
        srv.shutdown()
        srv.server_close()


def _real_http_error(base):
    try:
        requests.get(f"{base}/stable/splits", params={"symbol": "CAPNU", "limit": 40, "apikey": FAKE},
                     timeout=5).raise_for_status()
    except requests.HTTPError as exc:
        return exc
    raise AssertionError("stub did not answer 429")


def test_the_real_requests_error_carries_the_key_so_these_tests_mean_something(stub_429):
    exc = _real_http_error(stub_429)
    assert FAKE in str(exc)                                       # the measured defect


def test_safe_exc_keeps_class_status_and_url_without_the_query(stub_429):
    out = LR.safe_exc(_real_http_error(stub_429))
    assert FAKE not in out and "?" not in out
    assert "HTTPError" in out and "status=429" in out and "/stable/splits" in out


def test_safe_exc_on_a_connection_error_message():
    exc = requests.ConnectionError(
        f"HTTPSConnectionPool(host='h', port=443): Max retries exceeded with url: "
        f"/stable/splits?symbol=X&apikey={FAKE} (Caused by NewConnectionError)")
    out = LR.safe_exc(exc)
    assert FAKE not in out and out.startswith("ConnectionError")
    assert FAKE not in LR.safe_exc(requests.ConnectionError(f"https://h/p?apikey={FAKE}"))


def test_safe_exc_never_raises():
    assert isinstance(LR.safe_exc(_Boom()), str)
    assert isinstance(LR.safe_exc(None), str)


# ── the call sites, with the real requests error and caplog ──────────────────

def test_earnings_estimates_fmp_get_logs_no_key(stub_429, monkeypatch, caplog, layers_off):
    """THE measured path: `_fmp_get` ("FMP /stable/splits failed for CAPNU: 429 ...")."""
    from api.services import earnings_estimates as ee
    monkeypatch.setenv("FMP_API_KEY", FAKE)
    real_get = requests.get
    monkeypatch.setattr(ee.requests, "get", lambda url, **kw: real_get(
        url.replace("https://financialmodelingprep.com", stub_429), **kw))
    with caplog.at_level(logging.INFO):
        assert ee._fmp_get("/stable/splits", {"symbol": "CAPNU", "limit": 40}) is None
    assert "FMP /stable/splits failed for CAPNU" in caplog.text
    assert "429" in caplog.text
    assert FAKE not in caplog.text, caplog.text
    assert not any(FAKE in (r.exc_text or "") for r in caplog.records)


def test_fmp_client_network_error_and_body_or_none_log_no_key(monkeypatch, caplog, layers_off):
    from api.services import fmp_client
    monkeypatch.setenv("FMP_API_KEY", FAKE)
    msg = (f"HTTPSConnectionPool(host='financialmodelingprep.com', port=443): Max retries exceeded "
           f"with url: /stable/profile?symbol=X&apikey={FAKE} (Caused by ReadTimeoutError)")

    def boom(*a, **kw):
        raise requests.ConnectionError(msg)

    monkeypatch.setattr(fmp_client._session, "get", boom)
    monkeypatch.setattr(fmp_client, "_take_token", lambda: True)
    monkeypatch.setattr(fmp_client.cache, "get", lambda *a, **k: None)
    with pytest.raises(Exception) as ei:
        fmp_client._get_raw("/stable/profile", {"symbol": "X"})
    assert FAKE not in str(ei.value)                              # the typed error's own text
    with caplog.at_level(logging.INFO):
        assert fmp_client.body_or_none(fmp_client.get_company_profile, "X", timeout=3) is None
    assert "FMP get_company_profile failed for X" in caplog.text
    assert FAKE not in caplog.text, caplog.text


def test_body_or_none_logs_a_raw_requests_error_safely(caplog, layers_off):
    from api.services import fmp_client

    def typed(sym, *, timeout):
        raise requests.ConnectionError(f"Max retries exceeded with url: /stable/splits?symbol={sym}&apikey={FAKE}")

    with caplog.at_level(logging.INFO):
        assert fmp_client.body_or_none(typed, "CAPNU", timeout=3) is None
    assert "failed for CAPNU" in caplog.text and "ConnectionError" in caplog.text
    assert FAKE not in caplog.text, caplog.text


def test_finnhub_and_alphavantage_log_no_key(stub_429, monkeypatch, caplog, layers_off):
    from api.services import alphavantage_client as av
    from api.services import finnhub_client as fh
    real_get = requests.get
    for mod, base_attr in ((av, "_AV_BASE_URL"),):
        monkeypatch.setattr(mod, base_attr, stub_429 + "/query")
    monkeypatch.setattr(av.requests, "get", real_get)
    monkeypatch.setattr(av, "_av_take_token", lambda now=None: True)
    with caplog.at_level(logging.INFO):
        av.av_get_status({"function": "NEWS_SENTIMENT"}, api_key=FAKE)
    assert "AlphaVantage NEWS_SENTIMENT failed" in caplog.text
    assert FAKE not in caplog.text, caplog.text
    assert hasattr(fh, "_safe_exc")                               # same one-line change in finnhub


def test_the_real_logging_stack_end_to_end_with_everything_installed(stub_429, monkeypatch, caplog):
    """Factory + filter + safe call site, as in production."""
    from api.services import earnings_estimates as ee
    LR.install()
    monkeypatch.setenv("FMP_API_KEY", FAKE)
    real_get = requests.get
    monkeypatch.setattr(ee.requests, "get", lambda url, **kw: real_get(
        url.replace("https://financialmodelingprep.com", stub_429), **kw))
    with caplog.at_level(logging.INFO):
        ee._fmp_get("/stable/profile", {"symbol": "CAPNU"})
    assert FAKE not in caplog.text


# ── rails ────────────────────────────────────────────────────────────────────

def test_every_basicconfig_under_api_installs_the_redaction():
    """A process that configures logging must put the redaction on the handlers it just
    made. A new `logging.basicConfig(` in api/ with no install within 8 lines goes red."""
    offenders = []
    for path in sorted((REPO / "api").rglob("*.py")):
        text = path.read_text(encoding="utf-8", errors="replace")
        if "basicConfig" not in text:
            continue
        if not re.search(r"\b(requests|httpx|urllib|aiohttp)\b", text):
            continue                    # no outbound HTTP in the file: no URL to leak
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if re.search(r"\blogging\.basicConfig\(", line) and not line.lstrip().startswith("#"):
                window = "\n".join(lines[i:i + 12])
                if "_install_log_redaction()" not in window and "log_redaction" not in window:
                    offenders.append(f"{path.relative_to(REPO).as_posix()}:{i + 1}")
    assert not offenders, "logging.basicConfig without log_redaction.install(): " + ", ".join(offenders)


def test_the_rs_history_cli_main_installs_the_redaction_itself():
    """`main()` is what a `python -c` over ssh calls; the `__main__` block never runs there."""
    src = (REPO / "api/services/screener/rs_history.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    body = ast.get_source_segment(src, main)
    assert "log_redaction" in body.split("_parser()")[0]


def test_fmp_get_and_fmp_client_use_the_safe_form():
    for rel, needle in (("api/services/earnings_estimates.py", '_safe_exc(exc))'),
                        ("api/services/fmp_client.py", "_safe_exc(exc)")):
        assert needle in (REPO / rel).read_text(encoding="utf-8"), rel
