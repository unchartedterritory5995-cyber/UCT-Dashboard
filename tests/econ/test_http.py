"""http.py: retries, Retry-After, conditional GET, soft failures, stats, and the
key-leak rail (with a mutation control proving the leak assertion can fail)."""
from __future__ import annotations

import email.utils
import json
import logging
from urllib.parse import quote

import pytest

from api.services.econ import http as econ_http
from api.services.econ import secrets
from api.services.econ.http import HttpClient, Request, TransportError
from api.services.econ.model import SourceUnavailable

from .test_secrets import KEYS, assert_no_leak


# --------------------------------------------------------------------------- fakes

class FakeResp:
    def __init__(self, status=200, headers=None, content=b""):
        self.status_code = status
        self.headers = headers or {}
        self.content = content


class FakeClock:
    def __init__(self, t=1_000_000.0):
        self.t = t
        self.sleeps: list[float] = []

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.sleeps.append(s)
        self.t += s


class ScriptTransport:
    """Returns scripted responses in order; records every Request."""

    def __init__(self, *steps):
        self.steps = list(steps)
        self.requests: list[Request] = []

    def __call__(self, req: Request):
        self.requests.append(req)
        step = self.steps.pop(0) if len(self.steps) > 1 else self.steps[0]
        if isinstance(step, BaseException):
            raise step
        return step


class EchoTransport:
    """Echoes the request (URL + headers + body) back in a 500 body + headers."""

    def __init__(self, status=500):
        self.status = status
        self.calls = 0

    def __call__(self, req: Request):
        self.calls += 1
        echo = json.dumps({"url": req.url, "headers": req.headers,
                           "body": (req.body or b"").decode()}).encode()
        return FakeResp(self.status, {"X-Echo-Url": req.url}, echo)


def client(transport, clock=None, **kw):
    clock = clock or FakeClock()
    kw.setdefault("host_intervals", {})
    kw.setdefault("default_interval", 0)
    kw.setdefault("rng", lambda: 1.0)
    return HttpClient(transport=transport, sleep=clock.sleep, clock=clock, **kw), clock


@pytest.fixture
def keys(monkeypatch):
    for k, v in KEYS.items():
        monkeypatch.setenv(k, v)
    return KEYS


# --------------------------------------------------------------------------- the leak rail

ECON_LOGGERS = ["api.services.econ", "api.services.econ.http", "api.services.econ.ingest",
                "api.services.econ.adapters.bea", "api.econ_main"]


def run_leak_scenario(keys, caplog) -> str:
    """Exercise every door a key could leak through; return all captured text."""
    caplog.set_level(logging.DEBUG)
    for name in ECON_LOGGERS:
        caplog.set_level(logging.DEBUG, logger=name)
    texts = []
    echo = EchoTransport(500)
    c, _ = client(echo, max_retries=2)
    doors = [
        lambda: c.get("https://apps.bea.gov/api/data/",
                      params={"UserID": keys["BEA_API_KEY"], "method": "GetData"}),
        lambda: c.post_json("https://api.bls.gov/publicAPI/v2/timeseries/data/",
                            {"seriesid": ["CUSR0000SA0"], "registrationkey": keys["BLS_API_KEY"]}),
        lambda: c.get("https://api.census.gov/data/timeseries/eits",
                      params={"get": "cell_value", "key": keys["CENSUS_API_KEY"]}),
        lambda: c.post_form("https://api.eia.gov/v2/x", {"api_key": keys["EIA_API_KEY"]}),
    ]
    for door in doors:
        with pytest.raises(SourceUnavailable) as ei:
            door()
        texts.append(str(ei.value))
        texts.append(repr(ei.value))
    assert echo.calls == 4 * 3                 # bounded: 1 + max_retries each

    # logger.exception on an error whose MESSAGE carries the raw key URL
    raw_url = f"https://apps.bea.gov/api/data/?UserID={keys['BEA_API_KEY']}&method=GetData"
    for name in ECON_LOGGERS:
        lg = logging.getLogger(name)
        try:
            raise RuntimeError(f"provider failed at {raw_url} body={json.dumps({'registrationkey': keys['BLS_API_KEY']})}")
        except RuntimeError:
            lg.exception("fetch failed for %s (census %s)", raw_url, keys["CENSUS_API_KEY"])
        lg.error("eia %s", {"api_key": keys["EIA_API_KEY"]})
    texts.append(caplog.text)
    texts.extend(r.getMessage() for r in caplog.records)
    texts.extend(str(r.exc_text or "") for r in caplog.records)
    return "\n".join(texts)


def test_no_key_leaks_in_exceptions_or_logs(keys, caplog):
    text = run_leak_scenario(keys, caplog)
    assert "RuntimeError" in text and "failed after 3 attempt(s)" in text
    assert "status 500" in text
    assert_no_leak(text)
    # response/request bodies never reach the message
    assert "seriesid" not in text.split("\n")[0]


def test_mutation_control_identity_redact_is_caught(keys, caplog, monkeypatch):
    """With redact() disabled the SAME scenario must leak -- else the rail cannot fail."""
    monkeypatch.setattr(secrets, "redact", lambda text: "" if text is None else str(text))
    text = run_leak_scenario(keys, caplog)
    with pytest.raises(AssertionError):
        assert_no_leak(text)


def test_exception_not_chained_to_raw_transport_error(keys):
    def boom(req):
        raise ConnectionError(f"cannot reach {req.url}")
    c, _ = client(boom, max_retries=1)
    with pytest.raises(SourceUnavailable) as ei:
        c.get("https://apps.bea.gov/api/data/", params={"UserID": keys["BEA_API_KEY"]})
    assert ei.value.__cause__ is None and ei.value.__suppress_context__
    assert "ConnectionError" in str(ei.value)
    assert_no_leak(str(ei.value))


def test_non_transient_exception_not_retried(keys):
    t = ScriptTransport(ValueError(f"weird {KEYS['BLS_API_KEY']}"))
    c, clock = client(t)
    with pytest.raises(SourceUnavailable) as ei:
        c.get("https://api.bls.gov/x")
    assert len(t.requests) == 1 and "ValueError" in str(ei.value)
    assert_no_leak(str(ei.value))


def test_request_repr_is_redacted(keys):
    r = Request("GET", f"https://x/?api_key={keys['EIA_API_KEY']}")
    assert_no_leak(repr(r))


# --------------------------------------------------------------------------- retries

def test_429_retry_after_seconds_honored_and_bounded():
    t = ScriptTransport(FakeResp(429, {"Retry-After": "7"}))
    c, clock = client(t, max_retries=3)
    with pytest.raises(SourceUnavailable) as ei:
        c.get("https://api.bls.gov/x")
    assert len(t.requests) == 4
    assert clock.sleeps == [7.0, 7.0, 7.0]
    assert "status 429" in str(ei.value) and "4 attempt(s)" in str(ei.value)


def test_429_retry_after_http_date_and_cap():
    clock = FakeClock()
    when = email.utils.formatdate(clock.t + 12, usegmt=True)
    t = ScriptTransport(FakeResp(429, {"Retry-After": when}), FakeResp(200, {}, b"ok"))
    c, clock = client(t, clock=clock)
    r = c.get("https://api.bls.gov/x")
    assert r.status == 200 and r.attempts == 2
    assert 11.0 <= clock.sleeps[0] <= 12.0
    t2 = ScriptTransport(FakeResp(429, {"Retry-After": "99999"}), FakeResp(200, {}, b"ok"))
    c2, clock2 = client(t2, backoff_cap=30)
    c2.get("https://api.bls.gov/x")
    assert clock2.sleeps == [30.0]


def test_5xx_backoff_exponential_full_jitter_bounded():
    t = ScriptTransport(FakeResp(503))
    c, clock = client(t, max_retries=4, backoff_base=1.0, backoff_cap=5, rng=lambda: 1.0)
    with pytest.raises(SourceUnavailable):
        c.get("https://x.example/a")
    assert len(t.requests) == 5
    assert clock.sleeps == [1.0, 2.0, 4.0, 5.0]           # capped
    t2 = ScriptTransport(FakeResp(502))
    c2, clock2 = client(t2, max_retries=3, rng=lambda: 0.5)
    with pytest.raises(SourceUnavailable):
        c2.get("https://x.example/a")
    assert clock2.sleeps == [0.5, 1.0, 2.0]               # jittered fraction of ceiling


def test_5xx_then_success_and_transport_errors_retried():
    t = ScriptTransport(FakeResp(500), TransportError("ReadTimeout"), TimeoutError(),
                        FakeResp(200, {}, b"data"))
    c, clock = client(t, max_retries=4)
    r = c.get("https://x.example/a")
    assert r.status == 200 and r.content == b"data" and r.attempts == 4
    assert len(clock.sleeps) == 3


@pytest.mark.parametrize("status", [400, 401, 403, 404])
def test_4xx_not_retried(status):
    t = ScriptTransport(FakeResp(status, {}, b"nope"))
    c, clock = client(t, max_retries=4)
    r = c.get("https://x.example/a")
    assert r.status == status and len(t.requests) == 1 and clock.sleeps == []
    with pytest.raises(SourceUnavailable):
        r.raise_for_status()


def test_408_is_retried():
    t = ScriptTransport(FakeResp(408), FakeResp(200, {}, b"x"))
    c, _ = client(t)
    assert c.get("https://x.example/a").attempts == 2


# --------------------------------------------------------------------------- conditional GET

class MemValidators:
    def __init__(self):
        self.d = {}
        self.puts = 0

    def get(self, key):
        return self.d.get(key)

    def put(self, key, etag, last_modified):
        self.puts += 1
        self.d[key] = (etag, last_modified)


def test_conditional_get_304_path():
    store = MemValidators()
    lm = "Wed, 10 Sep 2026 12:30:00 GMT"
    t = ScriptTransport(FakeResp(200, {"ETag": '"abc"', "Last-Modified": lm}, b"payload"),
                        FakeResp(304, {}, b""))
    c, _ = client(t, validator_store=store)
    r1 = c.get("https://x.example/a", conditional_key="fake:a")
    assert r1.status == 200 and not r1.not_modified
    assert "If-None-Match" not in t.requests[0].headers
    assert store.d["fake:a"] == ('"abc"', lm)
    r2 = c.get("https://x.example/a", conditional_key="fake:a")
    assert r2.not_modified and r2.status == 304
    assert t.requests[1].headers["If-None-Match"] == '"abc"'
    assert t.requests[1].headers["If-Modified-Since"] == lm
    assert r2.raise_for_status() is r2


def test_conditional_get_deferred_validators():
    store = MemValidators()
    t = ScriptTransport(FakeResp(200, {"ETag": '"v1"'}, b"bad payload"))
    c, _ = client(t, validator_store=store)
    r = c.get("https://x.example/a", conditional_key="k", defer_validators=True)
    assert store.puts == 0 and r.validators == ('"v1"', None)
    c.commit_validators("k", r)
    assert store.d["k"] == ('"v1"', None)


def test_no_conditional_headers_without_key():
    store = MemValidators()
    store.d["k"] = ('"x"', None)
    t = ScriptTransport(FakeResp(200, {}, b"x"))
    c, _ = client(t, validator_store=store)
    c.get("https://x.example/a")
    assert "If-None-Match" not in t.requests[0].headers


# --------------------------------------------------------------------------- soft failures

def test_census_302_error_redirect_detected_not_followed(keys):
    loc = "https://api.census.gov/data/missing_key.html"
    t = ScriptTransport(FakeResp(302, {"Location": loc, "X-DataWebAPI-KeyError": "1"}, b""))
    c, _ = client(t)
    r = c.get("https://api.census.gov/data/timeseries/eits",
              params={"key": keys["CENSUS_API_KEY"]})
    assert len(t.requests) == 1 and t.requests[0].allow_redirects is False
    assert r.status == 302 and r.location == loc
    assert econ_http.is_error_redirect(r)
    assert "key" in econ_http.soft_failure(r)
    assert_no_leak(r.url_redacted)
    # a redirect without the markers is still a soft failure, just not "key"
    t2 = ScriptTransport(FakeResp(301, {"Location": "https://x.example/b"}))
    c2, _ = client(t2)
    r2 = c2.get("https://x.example/a")
    assert not econ_http.is_error_redirect(r2)
    assert econ_http.soft_failure(r2) == "unexpected redirect 301"


@pytest.mark.parametrize("body,empty", [(b"", True), (b"  \n", True), (b"[]", True),
                                        (b"{}", True), (b"null", True), (b"[1]", False),
                                        (b'{"a":1}', False)])
def test_is_empty_body(body, empty):
    r = econ_http.Response(status=200, headers={}, content=body, url_redacted="u")
    assert econ_http.is_empty_body(r) is empty
    assert (econ_http.soft_failure(r) == "empty body") is empty


# --------------------------------------------------------------------------- politeness + stats

def test_per_host_politeness_interval():
    t = ScriptTransport(FakeResp(200, {}, b"x"))
    clock = FakeClock()
    c = HttpClient(transport=t, sleep=clock.sleep, clock=clock,
                   host_intervals={"api.bls.gov": 0.3}, default_interval=0.25)
    c.get("https://api.bls.gov/a")
    c.get("https://api.bls.gov/b")
    c.get("https://api.bea.gov/a")            # different host: no wait
    c.get("https://api.bea.gov/b")
    assert clock.sleeps == [pytest.approx(0.3), pytest.approx(0.25)]


def test_default_host_intervals_include_bls():
    c = HttpClient(transport=lambda r: FakeResp())
    assert c.host_intervals["api.bls.gov"] == 0.3 and c.default_interval == 0.25


def test_stats_counts_by_host_and_status():
    t = ScriptTransport(FakeResp(503), TransportError("x"), FakeResp(200), FakeResp(404),
                        FakeResp(304))
    c, _ = client(t)
    c.get("https://api.bls.gov/a")            # 503, error, 200
    c.get("https://api.bea.gov/a")            # 404
    c.get("https://api.bea.gov/a")            # 304
    s = c.stats()
    assert s["by_host"]["api.bls.gov"] == {"503": 1, "error:TransportError": 1, "200": 1}
    assert s["by_host"]["api.bea.gov"] == {"404": 1, "304": 1}
    assert s["total"] == 5
    s["by_host"].clear()
    assert c.stats()["total"] == 5            # returned a copy
    c.reset_stats()
    assert c.stats()["total"] == 0


def test_user_agent_and_bodies_sent():
    t = ScriptTransport(FakeResp(200, {}, b"{}"))
    c, _ = client(t)
    c.post_json("https://api.bls.gov/x", {"a": 1})
    c.post_form("https://x.example/f", {"b": "2 3"})
    c.get("https://x.example/g", params={"q": "a b"})
    r0, r1, r2 = t.requests
    assert r0.headers["User-Agent"].startswith("UCT-Intelligence")
    assert json.loads(r0.body) == {"a": 1} and r0.headers["Content-Type"] == "application/json"
    assert r1.body == b"b=2+3"
    assert r2.url == "https://x.example/g?q=a+b" and r2.method == "GET"
    assert quote("a b") == "a%20b"  # sanity: urlencode uses '+'


def test_response_headers_lowercased_and_json():
    t = ScriptTransport(FakeResp(200, {"Content-Type": "application/json"}, b'{"x": 1}'))
    c, _ = client(t)
    r = c.get("https://x.example/a")
    assert r.headers == {"content-type": "application/json"} and r.json() == {"x": 1}
