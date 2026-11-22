"""CHART_SPEED_ENABLED — the server half of the kill switch over BOTH chart speed switches.

One setting the owner flips without a code deploy (docs/feature_flags.json CHART_SPEED_ENABLED) turns
`uct.neighborframes` and `uct.deviceStore` off in every browser, over a member's own local '1'. The browser
learns it from the readable cookie `uct_chart_speed=0` that every auth response sets beside its payload
(api/routers/auth.py::_set_chart_speed_cookie); app/src/lib/chartSpeed.js reads it.

What is load-bearing, and what each test below proves:
  * KILL polarity: unset means "not killed"; only an explicit 0/false/no/off kills.
  * Read PER REQUEST: a flip reaches the running process's next answer without reimporting anything.
  * The cookie rides EVERY response that carries the auth payload (derived from the AST, not listed),
    so a fifth sign-in path cannot seat a member who never learns of a kill.
  * The cookie's NAME is one fact in two files (Python here, JS in lib/chartSpeed.js): pinned equal.
  * It never raises: it rides every sign-in, and a kill switch must never cost a login.
"""

import ast
import importlib
import os
import re

import pytest
from starlette.responses import Response

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTH_PY = os.path.join(REPO, "api", "routers", "auth.py")
CHART_SPEED_JS = os.path.join(REPO, "app", "src", "lib", "chartSpeed.js")
ENV = "CHART_SPEED_ENABLED"


@pytest.fixture
def auth():
    return importlib.import_module("api.routers.auth")


@pytest.fixture
def a_member():
    return {"id": "u1", "email": "m@example.com", "role": "member"}


@pytest.fixture(autouse=True)
def _restore_env():
    before = os.environ.get(ENV)
    yield
    if before is None:
        os.environ.pop(ENV, None)
    else:
        os.environ[ENV] = before


def _set(value):
    if value is None:
        os.environ.pop(ENV, None)
    else:
        os.environ[ENV] = value


def _payload_flag(auth, user, value):
    _set(value)
    return auth._access_payload(user, "free")["chart_speed_enabled"]


def _speed_cookies(response):
    return [h for h in response.headers.getlist("set-cookie") if h.startswith("uct_chart_speed=")]


# ── polarity and the per-request read ─────────────────────────────────────────────────────────────

def test_unset_means_not_killed(auth, a_member):
    assert _payload_flag(auth, a_member, None) is True


@pytest.mark.parametrize("value", ["0", "false", "FALSE", "no", "off", " Off "])
def test_explicit_off_spellings_kill_it(auth, a_member, value):
    assert _payload_flag(auth, a_member, value) is False


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", "", "anything-else"])
def test_everything_else_leaves_speed_on(auth, a_member, value):
    assert _payload_flag(auth, a_member, value) is True


def test_the_flag_is_read_per_request(auth, a_member):
    """Same process, same imported module: a flip must reach the next answer."""
    assert _payload_flag(auth, a_member, "1") is True
    assert _payload_flag(auth, a_member, "0") is False
    assert _payload_flag(auth, a_member, "1") is True


def test_the_default_in_source_is_ON():
    """The LITERAL is pinned too: a default changed to "0" plus a 'fixed' behaviour test would leave every
    browser slow on a variable nobody set, with every other test green."""
    src = open(AUTH_PY, encoding="utf-8").read()
    body = src[src.index("def _chart_speed_enabled"):]
    body = body[:body.index("\ndef ")]
    assert '"CHART_SPEED_ENABLED", "1"' in body


# ── the cookie: what the browser actually reads ───────────────────────────────────────────────────

def test_killed_sets_a_readable_site_wide_cookie(auth):
    _set("0")
    r = Response()
    auth._set_chart_speed_cookie(r)
    [c] = _speed_cookies(r)
    low = c.lower()
    assert c.startswith("uct_chart_speed=0;")
    assert "path=/;" in low or low.endswith("path=/")
    assert "httponly" not in low, "page scripts must be able to read it"
    assert f"max-age={auth.CHART_SPEED_COOKIE_MAX_AGE}" in low
    assert auth.CHART_SPEED_COOKIE_MAX_AGE >= 30 * 86400, "a kill must outlive a month away"


@pytest.mark.parametrize("value", [None, "1"])
def test_not_killed_CLEARS_the_cookie(auth, value):
    """Turning the switch back on must take the kill away from a browser that holds it."""
    _set(value)
    r = Response()
    auth._set_chart_speed_cookie(r)
    [c] = _speed_cookies(r)
    low = c.lower()
    assert "max-age=0" in low, f"a deletion, not a set: {c}"
    assert not c.startswith("uct_chart_speed=0;")
    assert "path=/;" in low or low.endswith("path=/"), "a deletion must name the path the set used"


def test_the_cookie_setter_never_raises(auth, monkeypatch):
    class Broken(Response):
        def set_cookie(self, *a, **k):
            raise RuntimeError("boom")

        def delete_cookie(self, *a, **k):
            raise RuntimeError("boom")

    for value in ("0", "1"):
        _set(value)
        auth._set_chart_speed_cookie(Broken())    # must not raise


def test_me_sets_the_cookie_beside_its_payload(auth, a_member, monkeypatch):
    """The real /me handler, its database reads stubbed: the payload and the cookie agree, both ways."""
    monkeypatch.setattr(auth, "get_user_plan", lambda uid: "pro")
    monkeypatch.setattr(auth, "get_subscription", lambda uid: None)
    monkeypatch.setattr(auth, "_set_chart_edge_cookie", lambda *a, **k: None)
    for value, killed in (("0", True), ("1", False), ("0", True)):
        _set(value)
        r = Response()
        body = auth.me(r, a_member)
        assert body["chart_speed_enabled"] is (not killed)
        [c] = _speed_cookies(r)
        assert c.startswith("uct_chart_speed=0;") is killed


# ── every payload-bearing auth response sets it, derived ─────────────────────────────────────────

def _routes_missing_the_cookie(src):
    """Names of the functions that splice `_access_payload(...)` into a response without calling
    `_set_chart_speed_cookie(response)`, and the names of all that splice it."""
    tree = ast.parse(src)
    splicers, missing = [], []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or node.name == "_access_payload":
            continue
        calls = [n.func.id for n in ast.walk(node) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)]
        if "_access_payload" in calls:
            splicers.append(node.name)
            if "_set_chart_speed_cookie" not in calls:
                missing.append(node.name)
    return splicers, missing


def test_every_response_carrying_the_payload_sets_the_cookie():
    splicers, missing = _routes_missing_the_cookie(open(AUTH_PY, encoding="utf-8").read())
    assert len(splicers) >= 4, f"found only {splicers}: the derivation would pass over an empty set"
    assert {"me", "login", "signup"} <= set(splicers), splicers
    assert not missing, f"these auth responses carry the payload but never send the kill: {missing}"


def test_the_derivation_can_fail():
    """Control: a handler that splices the payload and forgets the cookie is caught by name."""
    src = (
        "def _access_payload(u, p):\n    return {}\n"
        "def good(response):\n    _set_chart_speed_cookie(response)\n    return {**_access_payload(1, 2)}\n"
        "def bad(response):\n    return {**_access_payload(1, 2)}\n"
    )
    splicers, missing = _routes_missing_the_cookie(src)
    assert splicers == ["good", "bad"] and missing == ["bad"]


# ── one name, two files ───────────────────────────────────────────────────────────────────────────

def test_the_cookie_name_is_the_same_on_both_sides(auth):
    js = open(CHART_SPEED_JS, encoding="utf-8").read()
    m = re.search(r"export const CHART_SPEED_COOKIE = '([^']+)'", js)
    assert m, "lib/chartSpeed.js no longer declares CHART_SPEED_COOKIE"
    assert m.group(1) == auth.CHART_SPEED_COOKIE
