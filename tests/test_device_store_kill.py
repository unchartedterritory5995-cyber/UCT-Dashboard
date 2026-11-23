"""DEVICE_STORE_ENABLED -- the server half of the on-device bar store's OWN kill switch (review of #2537, M9).

CHART_SPEED_ENABLED turns off BOTH chart speed switches (neighbor frames, ON by default, and the device store); the
device store needs a lever of its own, through the same channel: every auth response that carries the access payload
sets the readable cookie `uct_device_store=0` while DEVICE_STORE_ENABLED is off and clears it otherwise. It rides
`_set_chart_speed_cookie`, so tests/test_chart_speed_kill.py's AST rail (every payload-bearing auth response calls it)
covers this cookie too. app/src/lib/chartSpeed.js reads it (`deviceStoreKilled`, `deviceStoreKilledNow`).

TWO KILL VALUES (review of #2563, MEDIUM-2). 0/false/no/off: the store OFF, its packs KEPT in every browser (lifting
it costs nobody a download). `purge`: the store OFF and each browser DELETES its packs (cookie `uct_device_store=purge`,
app/src/data/deviceStore/source.js). The chart-speed kill never deletes.

What each test proves:
  * KILL polarity: unset means "not killed"; only an explicit 0/false/no/off kills, and `purge` kills and purges.
    The default literal is pinned.
  * Read PER REQUEST: a flip reaches the running process's next answer.
  * The cookie: readable, site-wide, long-lived when killed; a deletion when not; independent of the chart speed kill.
  * It rides /me beside the payload's readout, both ways.
  * The name is one fact in two files: pinned equal to chartSpeed.js's DEVICE_STORE_COOKIE.
  * It never raises: it rides every sign-in.
"""

import importlib
import os
import re

import pytest
from starlette.responses import Response

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTH_PY = os.path.join(REPO, "api", "routers", "auth.py")
CHART_SPEED_JS = os.path.join(REPO, "app", "src", "lib", "chartSpeed.js")
ENV = "DEVICE_STORE_ENABLED"
SPEED_ENV = "CHART_SPEED_ENABLED"


@pytest.fixture
def auth():
    return importlib.import_module("api.routers.auth")


@pytest.fixture
def a_member():
    return {"id": "u1", "email": "m@example.com", "role": "member"}


@pytest.fixture(autouse=True)
def _restore_env():
    before = {k: os.environ.get(k) for k in (ENV, SPEED_ENV)}
    yield
    for k, v in before.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def _set(name, value):
    if value is None:
        os.environ.pop(name, None)
    else:
        os.environ[name] = value


def _cookies(response, name):
    return [h for h in response.headers.getlist("set-cookie") if h.startswith(f"{name}=")]


def _readout(auth, user, value):
    _set(ENV, value)
    return auth._access_payload(user, "free")["device_store_enabled"]


def _purge_readout(auth, user, value):
    _set(ENV, value)
    return auth._access_payload(user, "free")["device_store_purge"]


# -- polarity and the per-request read ----------------------------------------------------------

def test_unset_means_not_killed(auth, a_member):
    assert _readout(auth, a_member, None) is True


@pytest.mark.parametrize("value", ["0", "false", "FALSE", "no", "off", " Off "])
def test_explicit_off_spellings_kill_it(auth, a_member, value):
    assert _readout(auth, a_member, value) is False


@pytest.mark.parametrize("value", ["1", "true", "yes", "on", "", "anything-else", "purged", "purg"])
def test_everything_else_leaves_it_on(auth, a_member, value):
    assert _readout(auth, a_member, value) is True
    assert _purge_readout(auth, a_member, value) is False


@pytest.mark.parametrize("value", ["purge", "PURGE", " Purge "])
def test_purge_kills_AND_purges(auth, a_member, value):
    assert _readout(auth, a_member, value) is False
    assert _purge_readout(auth, a_member, value) is True


@pytest.mark.parametrize("value", [None, "0", "off", "1"])
def test_only_purge_purges(auth, a_member, value):
    assert _purge_readout(auth, a_member, value) is False


def test_the_flag_is_read_per_request(auth, a_member):
    assert _readout(auth, a_member, "1") is True
    assert _readout(auth, a_member, "0") is False
    assert _readout(auth, a_member, "1") is True


def test_the_default_in_source_is_ON():
    """A default changed to "0" would switch the store off (and delete every seed) on a variable nobody set."""
    src = open(AUTH_PY, encoding="utf-8").read()
    body = src[src.index("def _device_store_kill"):]
    body = body[:body.index("\ndef ")]
    assert '"DEVICE_STORE_ENABLED", "1"' in body


# -- the cookie ------------------------------------------------------------------------------------

def test_killed_sets_a_readable_site_wide_cookie(auth):
    _set(ENV, "0")
    r = Response()
    auth._set_chart_speed_cookie(r)
    [c] = _cookies(r, "uct_device_store")
    low = c.lower()
    assert c.startswith("uct_device_store=0;")
    assert "path=/;" in low or low.endswith("path=/")
    assert "httponly" not in low, "page scripts must be able to read it"
    assert f"max-age={auth.CHART_SPEED_COOKIE_MAX_AGE}" in low


@pytest.mark.parametrize("value", ["purge", " PURGE "])
def test_purge_sets_the_purge_cookie(auth, value):
    _set(ENV, value)
    r = Response()
    auth._set_chart_speed_cookie(r)
    [c] = _cookies(r, "uct_device_store")
    low = c.lower()
    assert c.startswith("uct_device_store=purge;")
    assert "path=/;" in low or low.endswith("path=/")
    assert "httponly" not in low
    assert f"max-age={auth.CHART_SPEED_COOKIE_MAX_AGE}" in low


@pytest.mark.parametrize("value", [None, "1"])
def test_not_killed_CLEARS_the_cookie(auth, value):
    _set(ENV, value)
    r = Response()
    auth._set_chart_speed_cookie(r)
    [c] = _cookies(r, "uct_device_store")
    low = c.lower()
    assert "max-age=0" in low, f"a deletion, not a set: {c}"
    assert not c.startswith("uct_device_store=0;")
    assert "path=/;" in low or low.endswith("path=/")


@pytest.mark.parametrize("speed, device", [("1", "0"), ("0", "1"), ("0", "0"), ("1", "1"), ("0", "purge"), ("1", "purge")])
def test_the_two_kills_are_independent(auth, speed, device):
    _set(SPEED_ENV, speed)
    _set(ENV, device)
    r = Response()
    auth._set_chart_speed_cookie(r)
    [s] = _cookies(r, "uct_chart_speed")
    [d] = _cookies(r, "uct_device_store")
    assert s.startswith("uct_chart_speed=0;") is (speed == "0")
    assert d.startswith("uct_device_store=0;") is (device == "0")
    assert d.startswith("uct_device_store=purge;") is (device == "purge")


def test_the_cookie_setter_never_raises(auth):
    class Broken(Response):
        def set_cookie(self, *a, **k):
            raise RuntimeError("boom")

        def delete_cookie(self, *a, **k):
            raise RuntimeError("boom")

    for value in ("0", "1"):
        _set(ENV, value)
        _set(SPEED_ENV, value)
        auth._set_chart_speed_cookie(Broken())    # must not raise


def test_a_chart_speed_cookie_failure_does_not_lose_the_device_kill(auth):
    """Two cookies, two tries: a set that fails for one must not skip the other."""
    class FirstSetFails(Response):
        calls = 0

        def set_cookie(self, *a, **k):
            FirstSetFails.calls += 1
            if FirstSetFails.calls == 1:
                raise RuntimeError("boom")
            return super().set_cookie(*a, **k)

    _set(SPEED_ENV, "0")
    _set(ENV, "0")
    r = FirstSetFails()
    auth._set_chart_speed_cookie(r)
    assert [c for c in r.headers.getlist("set-cookie") if c.startswith("uct_device_store=0;")]


def test_me_sets_the_cookie_beside_its_payload(auth, a_member, monkeypatch):
    monkeypatch.setattr(auth, "get_user_plan", lambda uid: "pro")
    monkeypatch.setattr(auth, "get_subscription", lambda uid: None)
    monkeypatch.setattr(auth, "_set_chart_edge_cookie", lambda *a, **k: None)
    for value, cookie in (("0", "0"), ("1", None), ("purge", "purge"), ("0", "0"), ("1", None)):
        _set(ENV, value)
        r = Response()
        body = auth.me(r, a_member)
        assert body["device_store_enabled"] is (cookie is None)
        assert body["device_store_purge"] is (cookie == "purge")
        [c] = _cookies(r, "uct_device_store")
        if cookie is None:
            assert "max-age=0" in c.lower()
        else:
            assert c.startswith(f"uct_device_store={cookie};")


# -- one name, two files -----------------------------------------------------------------------------

def test_the_cookie_name_is_the_same_on_both_sides(auth):
    js = open(CHART_SPEED_JS, encoding="utf-8").read()
    m = re.search(r"export const DEVICE_STORE_COOKIE = '([^']+)'", js)
    assert m, "lib/chartSpeed.js no longer declares DEVICE_STORE_COOKIE"
    assert m.group(1) == auth.DEVICE_STORE_COOKIE == "uct_device_store"


def test_the_purge_value_is_the_same_on_both_sides(auth):
    js = open(CHART_SPEED_JS, encoding="utf-8").read()
    m = re.search(r"export const DEVICE_STORE_PURGE = '([^']+)'", js)
    assert m, "lib/chartSpeed.js no longer declares DEVICE_STORE_PURGE"
    assert m.group(1) == auth.DEVICE_STORE_PURGE == "purge"
