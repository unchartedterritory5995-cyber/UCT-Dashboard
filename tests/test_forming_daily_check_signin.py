"""tools/forming_daily_check.py signs in to PRODUCTION as the synthetic smoke account. These rails hold the
three things that sign-in must do, with no network: it goes through tools/synthetic_session.py, its login
request carries a timeout (the helper passes none, and a requests session has no default one), and the
session is signed out even when the login is refused.

tests/test_synthetic_session_signout.py is the static half (no tool POSTs the login itself); this is the
behavioural half for this one tool."""
from __future__ import annotations

import pytest
import requests

from tools import forming_daily_check as chk
from tools import synthetic_session as S


@pytest.fixture
def wire(monkeypatch):
    """Every request the tool's session makes is recorded and refused (401); the helper is a stand-in that
    posts through the client it is handed, exactly as sign_in_client does."""
    sent, helper_calls, closed = [], [], []

    def fake_request(self, method, url, **kw):
        sent.append({"method": method, "url": url, "timeout": kw.get("timeout")})
        r = requests.Response()
        r.status_code = 401
        r.url = url
        return r

    monkeypatch.setattr(requests.Session, "request", fake_request)

    class _Session:
        response = None

        def close(self):
            closed.append(True)
            return True

    def fake_sign_in_client(client, base, account=None, **kw):
        helper_calls.append({"base": base, "account": account})
        s = _Session()
        s.response = client.post(base + "/sign-in-door", json={"email": "x", "password": "y"})
        return s

    monkeypatch.setattr(S, "sign_in_client", fake_sign_in_client)
    return sent, helper_calls, closed


def test_the_login_goes_through_the_helper_as_the_smoke_account_and_carries_a_timeout(wire):
    sent, helper_calls, _closed = wire
    with pytest.raises(requests.HTTPError):
        chk.main([])
    assert helper_calls == [{"base": chk.BASE, "account": "smoke"}]
    assert [(x["method"], x["timeout"]) for x in sent] == [("POST", 30)], (
        "the login request must carry a timeout: without one it waits as long as production takes")


def test_a_refused_login_is_still_signed_out_and_nothing_else_is_asked(wire):
    sent, _helper_calls, closed = wire
    with pytest.raises(requests.HTTPError):
        chk.main([])
    assert closed == [True], "the session must be signed out in a finally, whatever the login answered"
    assert len(sent) == 1, "a refused login must stop the run before any read"
