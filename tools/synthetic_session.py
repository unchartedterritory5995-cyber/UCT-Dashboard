"""Sign in as a synthetic account -- and ALWAYS sign out again. ONE copy, for every tool.

⚰️ **2026-11-17: `smoke@uctintelligence.internal` held 301 live sessions** created since 2026-10-23.
Every one was a working bearer login to a production ADMIN account. Cause: the tools that sign
in as a synthetic account (CLAUDE.md "Testing -> Smoke") POSTed `/api/auth/login` and never
POSTed `/api/auth/logout`; of ~44 files that read the credentials, two signed out. A session
the tool forgets is not harmless residue: it is a credential that outlives the run, sits in a
browser profile or a cookie jar, and is valid for 30 days.

⛔ **THE RULE THIS FILE ENCODES: a tool never POSTs `/api/auth/login` itself.** It calls one of
the `sign_in_*` functions below, which

  * read the credentials from the environment by NAME (`SMOKE_*`, `BENCH_*`, `MEMBER_SMOKE_*`,
    `FREE_SMOKE_*`) -- or take explicit ones, which are refused on any non-loopback base unless
    the address is `@uctintelligence.internal`;
  * refuse an address outside `@uctintelligence.internal` BEFORE any request is sent;
  * after the login, ask `/api/auth/me` who the session is, and sign out + raise if it is not
    the account that was asked for;
  * return a `SyntheticSession` that is a context manager: `close()` POSTs `/api/auth/logout`
    and then proves `/api/auth/me` refuses the session.

**Every session is signed out, however the tool ends.** Inside a `with`, on leaving the block.
Without one (a sign-in buried in a helper whose session outlives it), at interpreter exit:
the session is registered with `atexit`, which runs on a normal return, `sys.exit`, an uncaught
exception and Ctrl-C (`KeyboardInterrupt`). The sign-out is a plain HTTPS request carrying the
session cookie, so it does not depend on the tool's browser or client still being open.
(Nothing runs on `os._exit`, SIGKILL or a power cut; nothing could.)

⛔ **A failed sign-out is LOUD, never swallowed:** one `SIGN-OUT FAILED` line on stderr naming
the first six characters of the session id and why. No credential, cookie or token is ever
printed -- `repr()` of a session shows neither.

Forms (pick the one matching the client the tool already uses; its semantics are kept):

    with S.http_session(base, "smoke") as s:          # a fresh urllib opener: s.opener
        s.opener.open(...)
    s = S.sign_in_urllib(opener, base, "smoke")        # an opener the tool already built;
                                                       # an HTTP refusal raises HTTPError, as urllib does
    s = S.sign_in_playwright(ctx, base, "bench")       # BrowserContext / Page / APIRequestContext:
    if not s.ok: ... s.status ...                      # the cookie lands in that context; a refusal
                                                       # is s.ok False, as Playwright answers
    s = S.sign_in_client(httpx_client, base, "smoke")  # httpx / requests: s.response

The rail is `tests/test_synthetic_session_signout.py`.
"""
from __future__ import annotations

import atexit
import http.cookiejar
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

SYNTHETIC_DOMAIN = "@uctintelligence.internal"
# Env-var prefix of each synthetic account (CLAUDE.md "Testing -> Smoke",
# docs/runbooks/rig-credential-hygiene.md "The three caller classes").
ACCOUNTS = {
    "smoke": "SMOKE",                # admin
    "bench": "BENCH",                # member
    "member_smoke": "MEMBER_SMOKE",  # paid member
    "free_smoke": "FREE_SMOKE",      # free member
}
_COOKIE = "uct_" + "session"
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
# Cloudflare 1010-blocks the default urllib User-Agent on the production host.
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
TIMEOUT_S = 30
_LOGOUT_ATTEMPTS = 2


class SignInError(RuntimeError):
    """The sign-in did not produce a usable synthetic session (no session is left behind)."""


class MissingCredentials(SignInError):
    pass


class NotSynthetic(SignInError):
    pass


class TotpRequired(SignInError):
    pass


class IdentityMismatch(SignInError):
    pass


# ── credentials ──────────────────────────────────────────────────────────────────────────────

def _names(account: str) -> tuple[str, str]:
    try:
        prefix = ACCOUNTS[account]
    except KeyError:
        raise ValueError(f"unknown synthetic account {account!r}; one of {sorted(ACCOUNTS)}") from None
    return f"{prefix}_EMAIL", f"{prefix}_PASSWORD"


def has_credentials(account: str) -> bool:
    """Both env vars for `account` are set (values never read out)."""
    e, p = _names(account)
    return bool(os.environ.get(e)) and bool(os.environ.get(p))


def env_credentials(account: str) -> tuple[str, str]:
    e, p = _names(account)
    email, password = os.environ.get(e), os.environ.get(p)
    if not email or not password:
        raise MissingCredentials(f"{e} / {p} are not in the environment")
    return email, password


def is_synthetic(email: str) -> bool:
    return bool(email) and email.strip().lower().endswith(SYNTHETIC_DOMAIN)


def is_loopback(base: str) -> bool:
    host = urllib.parse.urlsplit(base if "//" in base else "//" + base).hostname or ""
    return host.lower() in LOOPBACK_HOSTS


def _resolve(base: str, account: str | None, credentials) -> tuple[str, str]:
    if (account is None) == (credentials is None):
        raise TypeError("pass exactly one of `account` (an env-named synthetic account) or `credentials`")
    if account is not None:
        email, password = env_credentials(account)
        if not is_synthetic(email):
            e, _p = _names(account)
            raise NotSynthetic(f"{e} is not a {SYNTHETIC_DOMAIN} address; refusing to sign in")
        return email, password
    email, password = credentials
    if not email or not password:
        raise MissingCredentials("no credentials were given")
    if not is_synthetic(email) and not is_loopback(base):
        raise NotSynthetic(f"only a {SYNTHETIC_DOMAIN} account may sign in on a non-loopback base")
    return email, password


# ── the wire (stdlib only: the sign-out must not depend on the tool's client) ───────────────

def _brief(exc: BaseException) -> str:
    try:
        from tools.secret_scrub import brief  # noqa: PLC0415 -- package import
    except ImportError:
        try:
            from secret_scrub import brief  # noqa: PLC0415 -- script import (tools/ on sys.path)
        except ImportError:
            return type(exc).__name__
    return brief(exc, limit=160)


def _http(method: str, url: str, token: str | None = None, body=None,
          timeout: float = TIMEOUT_S) -> tuple[int, object]:
    """One request with the session cookie. -> (status, parsed JSON or None). Transport errors raise."""
    headers = {"User-Agent": UA, "Accept": "application/json"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Cookie"] = f"{_COOKIE}={token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 -- http(s) base only
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, None
    try:
        return status, json.loads(raw or b"null")
    except ValueError:
        return status, None


def _loud(text: str) -> None:
    line = f"SIGN-OUT FAILED: {text}\n"
    try:
        sys.stderr.write(line)
        sys.stderr.flush()
    except Exception:  # noqa: BLE001 -- a closed stderr at exit: fall back to the fd
        try:
            os.write(2, line.encode("ascii", "replace"))
        except OSError:
            pass


# ── the session ──────────────────────────────────────────────────────────────────────────────

_LIVE: set = set()
_LIVE_LOCK = threading.Lock()


class SyntheticSession:
    """One signed-in session. A context manager; `close()` signs it out (idempotent)."""

    def __init__(self, base: str, email: str):
        self.base = base.rstrip("/")
        self.email = email
        self.ok = False
        self.status: int | None = None
        self.payload = None     # the login answer's JSON body, when it was read
        self.response = None    # the client's own login response (Playwright / httpx / requests)
        self.opener = None      # the urllib opener carrying the cookie (urllib forms)
        self.signed_out: bool | None = None
        self._token: str | None = None
        self._lock = threading.Lock()

    def __repr__(self) -> str:
        return (f"<SyntheticSession {self.session_id_prefix or '-'} on {self.base} "
                f"ok={self.ok} signed_out={self.signed_out}>")

    @property
    def session_id_prefix(self) -> str:
        return (self._token or "")[:6]

    @property
    def live(self) -> bool:
        return bool(self._token) and self.signed_out is None

    def __enter__(self) -> "SyntheticSession":
        return self

    def __exit__(self, *exc) -> bool:
        self.close()
        return False

    def _adopt(self, token: str | None) -> None:
        if token and not self._token:
            self._token = token
            with _LIVE_LOCK:
                _LIVE.add(self)

    def _whoami(self, timeout: float) -> None:
        status, me = _http("GET", self.base + "/api/auth/me", self._token, timeout=timeout)
        user = (me.get("user") or me) if isinstance(me, dict) else {}
        who = str(user.get("email") or "") if isinstance(user, dict) else ""
        if status != 200 or who.strip().lower() != self.email.strip().lower():
            raise IdentityMismatch(f"/api/auth/me answered HTTP {status} for a different or no account; "
                                   "the session was signed out")

    def close(self) -> bool:
        """POST /api/auth/logout, then prove /api/auth/me refuses the session. Never raises."""
        with self._lock:
            if self.signed_out is not None:
                return self.signed_out
            if not self._token:
                self.signed_out = True
                return True
            self.signed_out = False
        with _LIVE_LOCK:
            _LIVE.discard(self)
        where = f"session {self.session_id_prefix}... on {self.base}"
        why = None
        for attempt in range(_LOGOUT_ATTEMPTS):
            try:
                status, _ = _http("POST", self.base + "/api/auth/logout", self._token)
            except Exception as exc:  # noqa: BLE001 -- reported below, never swallowed
                why = f"the logout request did not complete ({_brief(exc)})"
            else:
                if 200 <= status < 300:
                    why = None
                    break
                why = f"logout answered HTTP {status}"
                if status < 500:
                    break
            if attempt + 1 < _LOGOUT_ATTEMPTS:
                time.sleep(1.5)
        if why is None:
            try:
                after, _ = _http("GET", self.base + "/api/auth/me", self._token)
            except Exception:  # noqa: BLE001 -- the logout itself answered 2xx
                after = None
            if after == 200:
                why = "logout answered 2xx but /api/auth/me still accepts the session"
        if why:
            _loud(f"{where}: {why}. It is still a live login to a synthetic account; "
                  "it must be revoked.")
            return False
        self.signed_out = True
        return True


def close_all() -> int:
    """Sign out every session still open. Returns how many sign-outs FAILED. Runs at exit."""
    with _LIVE_LOCK:
        pending = list(_LIVE)
    return sum(0 if s.close() else 1 for s in pending)


atexit.register(close_all)


def _finish(s: SyntheticSession, status: int, token: str | None, payload, timeout: float) -> SyntheticSession:
    s.status = status
    s._adopt(token)
    if not 200 <= status < 300:
        s.close()   # a refusal carries no session; if one arrived anyway, it goes
        return s
    if not token:
        if isinstance(payload, dict) and payload.get("requires_totp"):
            raise TotpRequired("the account has TOTP enabled; a script cannot complete that sign-in")
        raise SignInError(f"login answered HTTP {status} but no session cookie came back")
    try:
        s._whoami(timeout)
    except BaseException:
        s.close()
        raise
    s.ok = True
    return s


def _token_from_jar(jar) -> str | None:
    for c in jar or ():
        if c.name == _COOKIE and c.value:
            return c.value
    return None


def _jar_of(opener) -> http.cookiejar.CookieJar:
    for h in getattr(opener, "handlers", ()):
        if isinstance(h, urllib.request.HTTPCookieProcessor):
            return h.cookiejar
    raise TypeError("the opener has no HTTPCookieProcessor; the session cookie would be lost")


def _cookie_value(set_cookie: str) -> str | None:
    head = (set_cookie or "").split(";", 1)[0].strip()
    name, sep, value = head.partition("=")
    if not sep or name.strip() != _COOKIE:
        return None
    return value.strip().strip('"') or None


# ── the forms ───────────────────────────────────────────────────────────────────────────────

def sign_in_urllib(opener, base: str, account: str | None = None, *, credentials=None,
                   timeout: float = TIMEOUT_S) -> SyntheticSession:
    """Sign in through `opener` (its cookie jar keeps the session). An HTTP refusal raises
    `urllib.error.HTTPError`, exactly as `opener.open` would."""
    email, password = _resolve(base, account, credentials)
    jar = _jar_of(opener)
    before = _token_from_jar(jar)   # a session the jar already held is not this sign-in's
    s = SyntheticSession(base, email)
    s.opener = opener
    req = urllib.request.Request(
        s.base + "/api/auth/login",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"Content-Type": "application/json", "User-Agent": UA})
    try:
        with opener.open(req, timeout=timeout) as r:
            status, raw = r.status, r.read()
    except BaseException:
        # Half a sign-in: the headers (and with them the cookie) may have landed before the failure.
        s._adopt(_new(_token_from_jar(jar), before))
        s.close()
        raise
    try:
        payload = json.loads(raw or b"null")
    except ValueError:
        payload = None
    s.payload = payload
    return _finish(s, status, _new(_token_from_jar(jar), before), payload, timeout)


def http_session(base: str, account: str | None = None, *, credentials=None,
                 timeout: float = TIMEOUT_S) -> SyntheticSession:
    """A fresh cookie-carrying urllib opener, signed in. `with S.http_session(...) as s: s.opener`."""
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    opener.addheaders = [("User-Agent", UA)]
    return sign_in_urllib(opener, base, account, credentials=credentials, timeout=timeout)


def _new(token: str | None, before: str | None) -> str | None:
    return token if token and token != before else None


def _playwright_jar_token(request_context) -> str | None:
    try:
        for c in (request_context.storage_state() or {}).get("cookies", []):
            if c.get("name") == _COOKIE and c.get("value"):
                return c["value"]
    except Exception:  # noqa: BLE001 -- a fake, or a context already closed
        pass
    return None


def _playwright_token(resp) -> str | None:
    try:
        for h in (getattr(resp, "headers_array", None) or []):
            if str(h.get("name", "")).lower() == "set-cookie":
                v = _cookie_value(h.get("value", ""))
                if v:
                    return v
    except Exception:  # noqa: BLE001
        pass
    return None


def sign_in_playwright(target, base: str, account: str | None = None, *, credentials=None,
                       timeout: float | None = None) -> SyntheticSession:
    """Sign in through a Playwright BrowserContext, Page or APIRequestContext, so the cookie lands
    in THAT context. A refusal is `s.ok is False` with `s.status` (Playwright does not raise on a
    status); `s.response` is the login APIResponse."""
    email, password = _resolve(base, account, credentials)
    request_context = getattr(target, "request", target)
    before = _playwright_jar_token(request_context)
    s = SyntheticSession(base, email)
    kwargs = {"data": json.dumps({"email": email, "password": password}),
              "headers": {"Content-Type": "application/json"}}
    if timeout is not None:
        kwargs["timeout"] = timeout
    try:
        resp = request_context.post(s.base + "/api/auth/login", **kwargs)
    except BaseException:
        s._adopt(_new(_playwright_jar_token(request_context), before))
        s.close()
        raise
    s.response = resp
    status = int(resp.status)
    token = _playwright_token(resp) or _new(_playwright_jar_token(request_context), before)
    payload = None
    if 200 <= status < 300 and not token:
        try:
            payload = resp.json()
        except Exception:  # noqa: BLE001
            payload = None
    return _finish(s, status, token, payload, TIMEOUT_S)


def adopt_playwright(target, base: str, account: str | None = None, *, credentials=None) -> SyntheticSession:
    """For a sign-in the PRODUCT made -- a walk that types into the login form because the form is
    what it measures. Takes the session the context now holds so it is signed out like any other.
    No session cookie (the form did not sign in) is `s.ok is False`, not an error; a session that
    is not the expected account is signed out and raises `IdentityMismatch`.

    ⛔ Only for a context the tool created FRESH for this sign-in. Never for a persistent profile
    whose session predates the run (the window_check rig's 30-day sign-in): adopting it would
    sign that out too."""
    email, _password = _resolve(base, account, credentials)
    s = SyntheticSession(base, email)
    token = _playwright_jar_token(getattr(target, "context", target))  # Page -> its BrowserContext
    if not token:
        return s
    return _finish(s, 200, token, None, TIMEOUT_S)


def sign_in_client(client, base: str, account: str | None = None, *, credentials=None,
                   timeout: float = TIMEOUT_S) -> SyntheticSession:
    """Sign in through an httpx / requests client (its jar keeps the cookie). The login response
    is `s.response`; a refusal is NOT raised (call `s.response.raise_for_status()` as before)."""
    email, password = _resolve(base, account, credentials)
    s = SyntheticSession(base, email)

    def jar_token():
        try:
            return client.cookies.get(_COOKIE)
        except Exception:  # noqa: BLE001
            return None
    before = jar_token()
    try:
        resp = client.post(s.base + "/api/auth/login", json={"email": email, "password": password})
    except BaseException:
        s._adopt(_new(jar_token(), before))
        s.close()
        raise
    s.response = resp
    status = int(resp.status_code)
    try:
        token = resp.cookies.get(_COOKIE) or _new(jar_token(), before)
    except Exception:  # noqa: BLE001
        token = _new(jar_token(), before)
    payload = None
    if 200 <= status < 300 and not token:
        try:
            payload = resp.json()
        except Exception:  # noqa: BLE001
            payload = None
    return _finish(s, status, token, payload, timeout)
