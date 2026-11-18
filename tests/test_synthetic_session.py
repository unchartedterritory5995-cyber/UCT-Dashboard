"""Unit tests of `tools/synthetic_session.py`: a synthetic sign-in is ALWAYS signed out.

Everything runs against a fake auth server on 127.0.0.1 (or a fake Playwright request context):
never production, never a real credential. The fake keeps a set of live session tokens, so
"signed out" is measured as the server's answer, not as "close() was called".
"""
from __future__ import annotations

import http.server
import json
import secrets
import subprocess
import sys
import textwrap
import threading
import urllib.error
from pathlib import Path

import pytest

from tools import synthetic_session as S

REPO = Path(__file__).resolve().parents[1]
EMAIL = "smoke@uctintelligence.internal"
PASSWORD = "pw-" + "x" * 12  # a fake, assembled so it is never a literal credential
COOKIE = "uct_" + "session"


class _Auth:
    def __init__(self):
        self.live: set[str] = set()
        self.issued: list[str] = []
        self.logouts: list[str] = []
        self.requests: list[str] = []
        self.mode = "ok"            # ok | refuse | totp | wrong_me | half | logout_500
        self.lock = threading.Lock()


def _handler(auth: _Auth):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _token(self):
            for part in (self.headers.get("Cookie") or "").split(";"):
                k, _, v = part.strip().partition("=")
                if k == COOKIE:
                    return v
            return None

        def _json(self, status, body, cookie=None):
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            if cookie:
                self.send_header("Set-Cookie", f"{COOKIE}={cookie}; Path=/; HttpOnly")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_POST(self):
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"null") if n else None
            with auth.lock:
                auth.requests.append("POST " + self.path)
            if self.path == "/api/auth/login":
                if auth.mode == "refuse":
                    return self._json(401, {"detail": "Invalid email or password"})
                if auth.mode == "totp":
                    return self._json(200, {"requires_totp": True, "challenge_token": "c"})
                tok = secrets.token_urlsafe(48)
                with auth.lock:
                    auth.live.add(tok)
                    auth.issued.append(tok)
                if auth.mode == "half":
                    # Headers (with the cookie) arrive; the body never finishes.
                    self.send_response(200)
                    self.send_header("Set-Cookie", f"{COOKIE}={tok}; Path=/; HttpOnly")
                    self.send_header("Content-Length", "1000")
                    self.end_headers()
                    self.wfile.write(b'{"user":')
                    self.wfile.flush()
                    self.close_connection = True
                    return
                return self._json(200, {"user": {"email": body["email"], "role": "admin"}}, cookie=tok)
            if self.path == "/api/auth/logout":
                tok = self._token()
                with auth.lock:
                    auth.logouts.append(tok)
                if auth.mode == "logout_500":
                    return self._json(500, {"detail": "boom"})
                with auth.lock:
                    auth.live.discard(tok)
                return self._json(200, {"ok": True})
            return self._json(404, {})

        def do_GET(self):
            with auth.lock:
                auth.requests.append("GET " + self.path)
            if self.path == "/api/auth/me":
                tok = self._token()
                if tok not in auth.live:
                    return self._json(401, {"detail": "Not authenticated"})
                who = "someone-else@uctintelligence.internal" if auth.mode == "wrong_me" else EMAIL
                return self._json(200, {"user": {"email": who}})
            return self._json(404, {})

    return H


@pytest.fixture
def server():
    auth = _Auth()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _handler(auth))
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    auth.base = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        yield auth
    finally:
        srv.shutdown()
        srv.server_close()


@pytest.fixture
def creds(monkeypatch):
    monkeypatch.setenv("SMOKE_EMAIL", EMAIL)
    monkeypatch.setenv("SMOKE_PASSWORD", PASSWORD)
    monkeypatch.setattr(S, "_LOGOUT_ATTEMPTS", 1)


# ── the three ways a run ends ─────────────────────────────────────────────────────────────────

def test_normal_exit_signs_out(server, creds):
    with S.http_session(server.base, "smoke") as s:
        assert s.ok and s.status == 200
        assert len(server.live) == 1                     # the session was real while in use
        with s.opener.open(server.base + "/api/auth/me") as r:
            assert r.status == 200                       # ... and the opener carries it
    assert server.live == set()
    assert server.logouts == server.issued
    assert s.signed_out is True


def test_an_exception_inside_the_block_signs_out_and_propagates(server, creds):
    with pytest.raises(ZeroDivisionError):
        with S.http_session(server.base, "smoke"):
            1 / 0
    assert server.issued and server.live == set()


def test_a_half_failed_login_still_signs_out(server, creds):
    """The cookie arrived with the headers, then the body broke: the session exists server-side
    and the client holds it -- it must be signed out before the error propagates."""
    server.mode = "half"
    with pytest.raises(Exception):  # noqa: B017 -- IncompleteRead / a reset: whatever urllib raises
        S.http_session(server.base, "smoke")
    assert len(server.issued) == 1
    assert server.live == set()
    assert server.logouts == server.issued


def test_the_wrong_identity_is_signed_out_then_refused(server, creds):
    server.mode = "wrong_me"
    with pytest.raises(S.IdentityMismatch):
        S.http_session(server.base, "smoke")
    assert server.issued and server.live == set()


def test_a_refused_login_raises_like_urllib_and_leaves_nothing(server, creds):
    server.mode = "refuse"
    with pytest.raises(urllib.error.HTTPError) as e:
        S.http_session(server.base, "smoke")
    assert e.value.code == 401
    assert server.issued == [] and server.logouts == []


def test_totp_is_refused_and_no_session_exists(server, creds):
    server.mode = "totp"
    with pytest.raises(S.TotpRequired):
        S.http_session(server.base, "smoke")
    assert server.live == set()


# ── the account guard ────────────────────────────────────────────────────────────────────────

def test_a_non_synthetic_address_is_refused_before_any_request(server, monkeypatch):
    monkeypatch.setenv("SMOKE_EMAIL", "owner@gmail.com")
    monkeypatch.setenv("SMOKE_PASSWORD", PASSWORD)
    with pytest.raises(S.NotSynthetic):
        S.http_session(server.base, "smoke")
    # explicit credentials: a real-looking address only on loopback, never on a remote base
    with pytest.raises(S.NotSynthetic):
        S.http_session("https://example.invalid", credentials=("owner@gmail.com", PASSWORD))
    assert server.requests == []


def test_missing_credentials_are_refused_before_any_request(server, monkeypatch):
    monkeypatch.delenv("BENCH_EMAIL", raising=False)
    monkeypatch.delenv("BENCH_PASSWORD", raising=False)
    assert S.has_credentials("bench") is False
    with pytest.raises(S.MissingCredentials):
        S.http_session(server.base, "bench")
    assert server.requests == []


def test_explicit_local_credentials_work_on_loopback(server, monkeypatch):
    monkeypatch.setattr(S, "_LOGOUT_ATTEMPTS", 1)
    with S.http_session(server.base, credentials=(EMAIL, PASSWORD)) as s:
        assert s.ok
    assert server.live == set()


# ── a failed sign-out is loud, and nothing secret is printed ─────────────────────────────────

def test_a_failed_logout_is_loud_and_prints_no_secret(server, creds, capsys):
    server.mode = "logout_500"
    s = S.http_session(server.base, "smoke")
    token = server.issued[0]
    assert s.close() is False
    err = capsys.readouterr().err
    assert "SIGN-OUT FAILED" in err
    assert token[:6] in err                      # the session id PREFIX names it ...
    assert token not in err and token[:12] not in err and PASSWORD not in err   # ... nothing more
    assert token not in repr(s) and PASSWORD not in repr(s)
    server.mode = "ok"
    server.live.discard(token)                   # tidy the fake; the real one is the owner's call


def test_CONTROL_a_logout_that_answers_but_leaves_the_session_is_also_loud(server, creds, capsys,
                                                                           monkeypatch):
    s = S.http_session(server.base, "smoke")
    real = S._http

    def logout_noop(method, url, token=None, body=None, timeout=S.TIMEOUT_S):
        if url.endswith("/api/auth/logout"):
            return 200, {"ok": True}                 # claims success, deletes nothing
        return real(method, url, token, body, timeout)
    monkeypatch.setattr(S, "_http", logout_noop)
    assert s.close() is False
    assert "still accepts the session" in capsys.readouterr().err


# ── interpreter exit: no `with`, and the run dies three ways ─────────────────────────────────

@pytest.mark.parametrize("ending", ["return", "exception", "sys_exit", "keyboard_interrupt"])
def test_a_session_without_a_with_is_signed_out_at_interpreter_exit(server, ending):
    script = textwrap.dedent(f"""
        import sys
        sys.path.insert(0, {str(REPO)!r})
        from tools import synthetic_session as S
        S._LOGOUT_ATTEMPTS = 1
        s = S.http_session({server.base!r}, "smoke")
        assert s.ok
        ending = {ending!r}
        if ending == "exception":
            raise RuntimeError("the tool crashed")
        if ending == "sys_exit":
            sys.exit(3)
        if ending == "keyboard_interrupt":
            raise KeyboardInterrupt
    """)
    env = {**__import__("os").environ, "SMOKE_EMAIL": EMAIL, "SMOKE_PASSWORD": PASSWORD,
           "PYTHONIOENCODING": "utf-8"}
    p = subprocess.run([sys.executable, "-c", script], env=env, capture_output=True, text=True,
                       timeout=60)
    assert len(server.issued) == 1, p.stderr
    assert server.live == set(), f"exit={p.returncode} stderr={p.stderr[-400:]}"
    assert server.logouts == server.issued
    assert "SIGN-OUT FAILED" not in p.stderr


# ── the Playwright form, against a fake request context ──────────────────────────────────────

class _PwResp:
    def __init__(self, status, token=None, body=None):
        self.status, self.ok = status, 200 <= status < 300
        self.headers_array = ([{"name": "Set-Cookie", "value": f"{COOKIE}={token}; Path=/"}]
                              if token else [])
        self._body = body or {}

    def json(self):
        return self._body


class _PwRequest:
    """Forwards the login to the fake server the way a context's request API would."""

    def __init__(self, auth, explode_after_cookie=False, held=None):
        self.auth, self.explode, self.jar = auth, explode_after_cookie, held
        self.posts = []

    def storage_state(self):
        return {"cookies": [{"name": COOKIE, "value": self.jar}] if self.jar else []}

    def post(self, url, data=None, headers=None, timeout=None):
        self.posts.append(url)
        body = json.loads(data)
        st, _ = S._http("POST", url, body=body)         # no cookie: the fake issues a new one
        tok = self.auth.issued[-1] if st == 200 and self.auth.issued else None
        if tok:
            self.jar = tok
        if self.explode:
            raise TimeoutError("APIRequestContext.post: Timeout 30000ms exceeded.")
        return _PwResp(st, tok)


class _Ctx:
    def __init__(self, request):
        self.request = request


def test_playwright_form_signs_in_through_the_context_and_out_on_exit(server, creds):
    req = _PwRequest(server)
    with S.sign_in_playwright(_Ctx(req), server.base, "smoke") as s:
        assert s.ok and s.response.status == 200
        assert req.posts == [server.base + "/api/auth/login"]   # through the CONTEXT's request
        assert req.jar in server.live
    assert server.live == set()


def test_playwright_refusal_is_ok_False_not_an_exception(server, creds):
    server.mode = "refuse"
    s = S.sign_in_playwright(_PwRequest(server), server.base, "smoke")
    assert s.ok is False and s.status == 401 and server.issued == []


def test_playwright_half_failure_signs_out_the_new_session_only(server, creds):
    """The post raised after the cookie landed in the context: that NEW session is signed out,
    and a session the context already held (a rig profile's) is never touched."""
    held = "held-" + "q" * 20
    server.live.add(held)
    req = _PwRequest(server, explode_after_cookie=True, held=held)
    with pytest.raises(TimeoutError):
        S.sign_in_playwright(req, server.base, "smoke")
    assert server.issued and server.issued[0] not in server.live
    assert held in server.live and held not in server.logouts


class _BrowserCtx:
    """A BrowserContext after the PRODUCT's login form signed it in (tools/t12_smoke_runner.py)."""

    def __init__(self, token):
        self.token = token

    def storage_state(self):
        return {"cookies": [{"name": COOKIE, "value": self.token}] if self.token else []}


class _Page:
    def __init__(self, ctx):
        self.context = ctx


def test_adopt_takes_a_form_made_session_and_signs_it_out(server, creds):
    st, _ = S._http("POST", server.base + "/api/auth/login", body={"email": EMAIL, "password": PASSWORD})
    assert st == 200
    token = server.issued[-1]
    with S.adopt_playwright(_Page(_BrowserCtx(token)), server.base, credentials=(EMAIL, PASSWORD)) as s:
        assert s.ok and token in server.live
    assert token not in server.live


def test_adopt_with_no_session_is_ok_False_and_touches_nothing(server, creds):
    s = S.adopt_playwright(_Page(_BrowserCtx(None)), server.base, credentials=(EMAIL, PASSWORD))
    assert s.ok is False and s.close() is True and server.requests == []


# ── httpx / requests clients ─────────────────────────────────────────────────────────────────

def test_client_form_signs_out(server, creds):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=server.base) as c:
        with S.sign_in_client(c, server.base, "smoke") as s:
            assert s.ok and s.response.status_code == 200
            assert c.get("/api/auth/me").status_code == 200
    assert server.issued and server.live == set()
