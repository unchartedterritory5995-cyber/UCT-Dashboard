"""A sign-in request that never completes is INCONCLUSIVE (exit 2), never a measured failure (1).

⚰️ 2026-10-14, twice (04:57:59Z via edge ord1, 15:55:26Z via mia1). The server answered the
smoke's login in under a second and the client received `200 OK` headers, but the response body
never finished arriving, so Playwright raised `TimeoutError` out of `login()`. Uncaught, that
exited 1, which H15 reads as "a break was measured: roll back" while nothing had been measured.
The raw exception was also printed, and its call log carries the response's `set-cookie`, so a
live session for the smoke account landed in the run log twice.
"""
from tools import hub_nav_smoke as H

FAKE_COOKIE = "uct_" + "session=" + "Zq" * 20  # built by concatenation: no literal credential here


class _Resp:
    def __init__(self, ok=True, status=200):
        self.ok, self.status = ok, status


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
    _creds(monkeypatch)
    assert H.login(_Page(_Resp(ok=True)), "https://example.test") is True
    assert H.login(_Page(_Resp(ok=False, status=401)), "https://example.test") is False
    monkeypatch.delenv("SMOKE_PASSWORD")
    assert H.login(_Page(_Resp(ok=True)), "https://example.test") is False


def test_main_maps_an_incomplete_login_to_exit_2(monkeypatch):
    """End to end through main(): with login() answering None, the run exits 2 and clicks nothing."""
    import playwright.sync_api as pw_api

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

    monkeypatch.setattr(pw_api, "sync_playwright", lambda: _PW())
    monkeypatch.setattr(H, "pod_age_seconds", lambda base: 10_000)
    monkeypatch.setattr(H, "login", lambda page, base: None)

    def _no_routes(*a, **k):
        raise AssertionError("no route may be measured after an incomplete sign-in")
    monkeypatch.setattr(H, "check_route", _no_routes)

    assert H.main(["--auth", "--base", "https://example.test"]) == 2
    assert closed == [True]
