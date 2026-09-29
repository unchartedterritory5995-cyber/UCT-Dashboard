"""SEC fair access during the V5 rebuild: Retry-After is obeyed, failures are counted,
and a 404 is permanent (never retried, never mistaken for 'no restatement')."""
import email.message
import urllib.error

import pytest

from api.services.fundamentals_pit import sec_client as SEC


class _Resp:
    def __init__(self, body): self.body, self.headers = body, {}
    def read(self): return self.body
    def __enter__(self): return self
    def __exit__(self, *a): return False


def _err(code, retry_after=None):
    h = email.message.Message()
    if retry_after is not None:
        h["Retry-After"] = str(retry_after)
    return urllib.error.HTTPError("https://www.sec.gov/x", code, "x", h, None)


@pytest.fixture(autouse=True)
def _fast(monkeypatch):
    slept = []
    monkeypatch.setattr(SEC.time, "sleep", lambda s: slept.append(s))
    monkeypatch.setattr(SEC, "_wait_turn", lambda: None)
    for k in SEC.STATS:
        SEC.STATS[k] = 0
    return slept


def test_retry_after_is_obeyed_over_our_backoff(_fast):
    seq = [_err(429, retry_after=45), _Resp(b"ok")]
    body = SEC.get_bytes("https://www.sec.gov/x", opener=lambda req, timeout: (_ for _ in ()).throw(seq.pop(0)) if isinstance(seq[0], Exception) else seq.pop(0))
    assert body == b"ok" and _fast == [45.0]
    s = SEC.stats()
    assert (s["requests"], s["ok"], s["http_429"], s["retries"], s["retry_after_waits"], s["bytes"]) == (2, 1, 1, 1, 1, 2)


def test_retry_after_is_capped(_fast):
    seq = [_err(503, retry_after=10_000), _Resp(b"x")]
    SEC.get_bytes("https://www.sec.gov/x", opener=lambda req, timeout: (_ for _ in ()).throw(seq.pop(0)) if isinstance(seq[0], Exception) else seq.pop(0))
    assert _fast == [SEC.RETRY_AFTER_CAP] and SEC.stats()["http_5xx"] == 1


def test_404_is_permanent_and_never_retried(_fast):
    calls = []
    def opener(req, timeout):
        calls.append(1); raise _err(404)
    with pytest.raises(SEC.SecError) as e:
        SEC.get_bytes("https://www.sec.gov/x", opener=opener)
    assert e.value.status == 404 and len(calls) == 1 and _fast == [] and SEC.stats()["not_found"] == 1


def test_a_persistent_transient_failure_gives_up_and_is_counted(_fast):
    def opener(req, timeout):
        raise _err(503)
    with pytest.raises(SEC.SecError):
        SEC.get_bytes("https://www.sec.gov/x", retries=2, opener=opener)
    s = SEC.stats()
    assert (s["requests"], s["http_5xx"], s["retries"], s["gave_up"]) == (3, 3, 2, 1)
