"""A sign-in request that never completes is INCONCLUSIVE (exit 2), never a measured failure (1).

⚰️ 2026-10-14, twice (04:57:59Z via edge ord1, 15:55:26Z via mia1). The server answered the
smoke's login in under a second and the client received `200 OK` headers, but the response body
never finished arriving, so Playwright raised `TimeoutError` out of `login()`. Uncaught, that
exited 1, which H15 reads as "a break was measured: roll back" while nothing had been measured.
The raw exception was also printed, and its call log carries the response's `set-cookie`, so a
live session for the smoke account landed in the run log twice.
"""
from tools import hub_nav_smoke as H
from tools import synthetic_session as S

FAKE_COOKIE = "uct_" + "session=" + "Zq" * 20  # built by concatenation: no literal credential here


class _Resp:
    def __init__(self, ok=True, status=200):
        self.ok, self.status = ok, status
        # A real sign-in answers with the session cookie; tools/synthetic_session.py reads it
        # from here so it can sign the session out when the run ends.
        self.headers_array = [{"name": "Set-Cookie", "value": FAKE_COOKIE + "; Path=/"}] if ok else []


class _Req:
    def __init__(self, outcome):
        self.outcome = outcome

    def post(self, *a, **k):
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class _Page:
    def __init__(self, outcome):
        self.request = _Req(outcome)


def _creds(monkeypatch):
    monkeypatch.setenv("SMOKE_EMAIL", "smoke@uctintelligence.internal")
    monkeypatch.setenv("SMOKE_PASSWORD", "not-a-real-password")
    # No network: /api/auth/me names the smoke account while signed in; the sign-out answers 200
    # and /me then refuses.
    state = {"out": False}

    def fake_http(method, url, token=None, body=None, timeout=None):
        if url.endswith("/api/auth/logout"):
            state["out"] = True
            return 200, {"ok": True}
        if state["out"]:
            return 401, None
        return 200, {"user": {"email": "smoke@uctintelligence.internal"}}
    monkeypatch.setattr(S, "_http", fake_http)
    return state


def _timeout_with_call_log():
    # The shape Playwright raises: first line, then a call log that includes the response headers.
    return TimeoutError(
        "APIRequestContext.post: Timeout 30000ms exceeded.\n"
        "Call log:\n"
        "  - ← 200 OK\n"
        f"    - set-cookie: {FAKE_COOKIE}; Path=/; HttpOnly\n"
    )


def test_a_login_request_that_never_completes_is_None_not_an_exception(monkeypatch, capsys):
    _creds(monkeypatch)
    assert H.login(_Page(_timeout_with_call_log()), "https://example.test") is None
    out = capsys.readouterr()
    text = out.out + out.err
    assert "INCONCLUSIVE" in text
    assert "TimeoutError" in text  # the cause is named ...
    assert "Zq" * 20 not in text and "Call log" not in text  # ... and the call log never printed


def test_the_other_two_answers_are_unchanged(monkeypatch, capsys):
    """Controls: a real 200 still signs in, a real HTTP refusal still falls back to unauthenticated."""
    state = _creds(monkeypatch)
    assert H.login(_Page(_Resp(ok=True)), "https://example.test") is True
    assert S.close_all() == 0 and state["out"] is True   # the session is signed out at the end
    assert H.login(_Page(_Resp(ok=False, status=401)), "https://example.test") is False
    monkeypatch.delenv("SMOKE_PASSWORD")
    assert H.login(_Page(_Resp(ok=True)), "https://example.test") is False


def test_main_maps_an_incomplete_login_to_exit_2(monkeypatch):
    """End to end through main(): with login() answering None, the run exits 2 and clicks nothing.

    Playwright is stubbed AT THE IMPORT BOUNDARY (`sys.modules`), not by patching the real package:
    main() does a function-local `from playwright.sync_api import sync_playwright`, and the GitHub
    runner has no playwright installed, so importing the real module first made this test red there
    for a reason that has nothing to do with the exit code it pins. The stub is the whole surface
    main() touches before the sign-in answer (launch, new_context, new_page, close)."""
    import sys
    import types

    closed = []

    class _Br:
        def new_context(self, **k):
            class _Ctx:
                def new_page(self_inner):
                    return _Page(_Resp())
            return _Ctx()

        def close(self):
            closed.append(True)

    class _PW:
        def __enter__(self):
            class _Chromium:
                def launch(self_inner, **k):
                    return _Br()
            self.chromium = _Chromium()
            return self

        def __exit__(self, *a):
            return False

    pw_pkg = types.ModuleType("playwright")
    pw_api = types.ModuleType("playwright.sync_api")
    pw_api.sync_playwright = lambda: _PW()
    pw_pkg.sync_api = pw_api
    monkeypatch.setitem(sys.modules, "playwright", pw_pkg)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", pw_api)
    monkeypatch.setattr(H, "pod_age_seconds", lambda base: 10_000)
    monkeypatch.setattr(H, "login", lambda page, base: None)

    def _no_routes(*a, **k):
        raise AssertionError("no route may be measured after an incomplete sign-in")
    monkeypatch.setattr(H, "check_route", _no_routes)

    assert H.main(["--auth", "--base", "https://example.test"]) == 2
    assert closed == [True]
