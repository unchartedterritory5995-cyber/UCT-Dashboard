"""S7_FILING_WATCH_ENABLED — the server half of the filing-watch gate.

⛔ THE BRANCH THIS GATES SHIPPED WITH NO FLAG AT ALL. Its own commit message said
"(dark, unmerged)" while the diff contained no env read, no gate and no payload
field: being UNMERGED was the only thing hiding it. Merging it in that state
would have put a member-facing control on three surfaces at once, with
revert-and-deploy as the only rollback.

Two load-bearing properties, and neither is "false hides the button":

  * the value is read AT REQUEST TIME, so a flip needs no code change (a
    module-level capture would look present and do nothing);
  * the default is OFF, and it is an ENABLEMENT gate, not a kill switch -- an
    unset variable must never expose a surface nobody decided to release. That
    is the opposite polarity to HUB_PREVIEW_ENABLED, deliberately, and the
    literal default is pinned so it cannot be flipped and the test "fixed" to
    match.
"""

import importlib
import os

import pytest

FLAG = "S7_FILING_WATCH_ENABLED"
KEY = "s7_filing_watch_enabled"


@pytest.fixture
def access_payload():
    mod = importlib.import_module("api.routers.auth")
    return mod._access_payload


@pytest.fixture
def a_member():
    return {"id": "u1", "email": "m@example.com", "role": "member"}


@pytest.fixture(autouse=True)
def _restore_env():
    before = os.environ.get(FLAG)
    yield
    if before is None:
        os.environ.pop(FLAG, None)
    else:
        os.environ[FLAG] = before


def _flag(payload_fn, user, value):
    if value is None:
        os.environ.pop(FLAG, None)
    else:
        os.environ[FLAG] = value
    return payload_fn(user, "free")[KEY]


def test_unset_is_OFF(access_payload, a_member):
    """An enablement gate's unset state is 'not released', never 'released'."""
    assert _flag(access_payload, a_member, None) is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on", " 1 "])
def test_explicit_on_values_enable_it(access_payload, a_member, value):
    assert _flag(access_payload, a_member, value) is True


@pytest.mark.parametrize("value", ["0", "false", "no", "off", "", "maybe", "2"])
def test_everything_else_stays_OFF(access_payload, a_member, value):
    """⛔ Unlike the hub KILL switch, an unrecognised value must NOT enable.
    'maybe' and '2' are typos, and a typo must fail closed on a dark feature."""
    assert _flag(access_payload, a_member, value) is False


def test_the_flag_is_read_per_request(access_payload, a_member):
    """THE LOAD-BEARING ONE. The environment changes between two calls and
    nothing is reimported; a module-level capture passes every test above and
    fails this one, which is exactly the bug that would make the documented
    rollback a fiction."""
    assert _flag(access_payload, a_member, "1") is True
    assert _flag(access_payload, a_member, "0") is False
    assert _flag(access_payload, a_member, "1") is True


def test_the_default_in_source_is_OFF_and_cannot_be_flipped_unnoticed():
    """Pins the LITERAL, not just the behaviour. Without this, someone could
    change the default to "1" and update the tests above to match, and every
    assertion would still be green while the gate had inverted."""
    import inspect
    src = inspect.getsource(importlib.import_module("api.routers.auth")._access_payload)
    assert '"%s", "0"' % FLAG in src, (
        "the default for this enablement gate must be the literal \"0\"")
