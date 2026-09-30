"""secrets.py: key lookup, redact(), logging redaction."""
from __future__ import annotations

import json
import logging
from urllib.parse import quote, quote_plus

import pytest

from api.services.econ import secrets

KEYS = {
    "BLS_API_KEY": "blsSECRETkey0001",
    "BEA_API_KEY": "BEA-5ecret+Key/77=",
    "CENSUS_API_KEY": "census KEY&abc 999",
    "EIA_API_KEY": 'eia"QUOTE\\slash42',
}


def key_forms(v: str) -> set[str]:
    return {v, quote(v, safe=""), quote_plus(v), json.dumps(v)[1:-1]}


def assert_no_leak(text: str, keys=KEYS) -> None:
    for env, v in keys.items():
        for f in key_forms(v):
            assert f not in text, f"{env} leaked in form {f!r}"


@pytest.fixture
def keys(monkeypatch):
    for k, v in KEYS.items():
        monkeypatch.setenv(k, v)
    return KEYS


def test_provider_key_and_configured(monkeypatch):
    for env in secrets.KEY_ENV.values():
        monkeypatch.delenv(env, raising=False)
    monkeypatch.setenv("BLS_API_KEY", "  abc123456  ")
    monkeypatch.setenv("BEA_API_KEY", "   ")
    assert secrets.provider_key("bls") == "abc123456"
    assert secrets.provider_key("bea") is None
    assert secrets.provider_key("nope") is None
    conf = secrets.configured()
    assert conf == {"bls": True, "bea": False, "census": False, "eia": False}
    assert "abc123456" not in repr(conf)


def test_redact_configured_values_all_forms(keys):
    for v in keys.values():
        for f in key_forms(v):
            out = secrets.redact(f"before {f} after")
            assert f not in out and "[REDACTED]" in out
    blob = json.dumps({"k": [keys["EIA_API_KEY"]]})
    assert_no_leak(secrets.redact(blob))


def test_redact_generic_secret_envs(monkeypatch):
    monkeypatch.setenv("SOME_OTHER_TOKEN", "tok-zzzzzzzzzz")
    monkeypatch.setenv("SHORT_KEY", "abc")          # trivial -> not a value scrub
    out = secrets.redact("x tok-zzzzzzzzzz y abc")
    assert "tok-zzzzzzzzzz" not in out
    assert "abc" in out


def test_redact_urls(keys):
    urls = [
        f"https://apps.bea.gov/api/data/?UserID={keys['BEA_API_KEY']}&method=GetData",
        f"https://api.census.gov/data/timeseries/eits?get=cell_value&key={quote(keys['CENSUS_API_KEY'])}",
        f"https://api.eia.gov/v2/petroleum?api_key={quote_plus(keys['EIA_API_KEY'])}&frequency=weekly",
    ]
    for u in urls:
        out = secrets.redact(u)
        assert_no_leak(out)
        assert "[REDACTED]" in out
    # names alone, value NOT configured anywhere -> still scrubbed
    for u in ["https://x/?UserID=unknownvalue1&a=1", "https://x/?userid=unknownvalue1",
              "https://x/?API_KEY=unknownvalue1", "https://x/?apikey=unknownvalue1",
              "https://x/?key=unknownvalue1#frag", "https://x/?a=1&token=unknownvalue1",
              "https://x/?registrationKey=unknownvalue1"]:
        out = secrets.redact(u)
        assert "unknownvalue1" not in out, u
    # an unrelated param that merely ENDS in 'key' is left alone
    assert secrets.redact("https://x/?monkey=banana") == "https://x/?monkey=banana"
    assert "a=1" in secrets.redact("https://x/?UserID=unknownvalue1&a=1")


def test_redact_urlencoded_nested():
    s = "next=https%3A%2F%2Fx%2F%3FUserID%3Dnotconfigured9%26a%3D1"
    out = secrets.redact(s)
    assert "notconfigured9" not in out
    assert "a%3D1" in out


def test_redact_json_and_form_bodies(keys):
    body = json.dumps({"seriesid": ["CUSR0000SA0"], "registrationkey": "unconfiguredBLSkey",
                       "startyear": "2016"})
    out = secrets.redact(body)
    assert "unconfiguredBLSkey" not in out and "CUSR0000SA0" in out
    body2 = json.dumps({"registrationKey": keys["BLS_API_KEY"], "UserID": 12345678})
    out2 = secrets.redact(body2)
    assert_no_leak(out2)
    assert "12345678" not in out2
    form = "registrationkey=formvalue42&seriesid=CUSR0000SA0"
    out3 = secrets.redact(form)
    assert "formvalue42" not in out3 and "seriesid=CUSR0000SA0" in out3


def test_redact_headers_dict_repr(keys):
    headers = {"Authorization": "Bearer hdrsecretvalue", "X-Api-Key": "hdrapikeyvalue",
               "api_key": keys["EIA_API_KEY"], "Accept": "application/json"}
    out = secrets.redact(repr(headers))
    assert "hdrsecretvalue" not in out and "hdrapikeyvalue" not in out
    assert_no_leak(out)
    assert "application/json" in out
    assert "hdrsecretvalue" not in secrets.redact("Authorization: Bearer hdrsecretvalue\r\n")


def test_redact_is_idempotent_and_total(keys):
    s = f"?UserID={keys['BEA_API_KEY']}"
    once = secrets.redact(s)
    assert secrets.redact(once) == once
    assert secrets.redact(None) == ""
    assert secrets.redact(b"key=bytesval1") == "key=[REDACTED]"


def test_safe_exc_one_line(keys):
    e = RuntimeError(f"boom\n at https://x/?UserID={keys['BEA_API_KEY']}")
    s = secrets.safe_exc(e)
    assert "\n" not in s and s.startswith("RuntimeError: ")
    assert_no_leak(s)


def test_logging_filter_on_handler(keys):
    """RedactingFilter on a plain handler scrubs msg, args and exc text."""
    records = []

    class H(logging.Handler):
        def emit(self, record):
            records.append(self.format(record))

    lg = logging.getLogger("tests.econ.plainlogger")
    h = H()
    h.addFilter(secrets.RedactingFilter())
    lg.addHandler(h)
    lg.propagate = False
    try:
        lg.warning("url %s", f"https://x/?api_key={keys['EIA_API_KEY']}")
        try:
            raise ValueError(f"bad {keys['BLS_API_KEY']}")
        except ValueError:
            lg.exception("failed %s", keys["CENSUS_API_KEY"])
    finally:
        lg.removeHandler(h)
    text = "\n".join(records)
    assert "ValueError" in text
    assert_no_leak(text)
