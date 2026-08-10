"""The Schwab OAuth callback used to accept any `code` from anyone.

🔴 THE ATTACK, WRITTEN OUT, because a test whose name says "state is required" does
not tell the next reader what was at stake. There is exactly ONE Schwab token file
for the whole firm. An unauthenticated stranger could complete a Schwab login
against THEIR OWN brokerage account, hand us the resulting `code` at
`/api/schwab/callback`, and every server-side Schwab call from that moment on would
be reading their account. No session, no header, no state — just a GET.

⛔ `test_the_attack_is_refused` IS THE ONE THAT MATTERS. Everything else in this
file supports it.
"""
import importlib
import time

import pytest

san = importlib.import_module("api.services.schwab_oauth_state")


@pytest.fixture(autouse=True)
def _clean():
    san._reset_for_tests()
    yield
    san._reset_for_tests()


# --------------------------------------------------------------------------- #
# the attack
# --------------------------------------------------------------------------- #

def test_the_attack_is_refused():
    """A stranger's callback carries no state we issued, so it cannot be redeemed."""
    for forged in (None, "", "anything", "a.b.c", "x." + str(int(time.time())) + ".sig"):
        ok, _why = san.verify_and_burn(forged)
        assert ok is False, f"a forged state was accepted: {forged!r}"


def test_a_state_we_issued_is_accepted():
    """⛔ THE CONTROL. Without it, `verify_and_burn` could be `return False, "no"`
    and every assertion above would pass while the real flow was broken."""
    ok, why = san.verify_and_burn(san.issue())
    assert ok is True, why


# --------------------------------------------------------------------------- #
# the three properties, each with the failure it prevents
# --------------------------------------------------------------------------- #

def test_a_state_is_single_use_so_a_captured_url_cannot_be_replayed():
    # The callback URL sits in browser history, in proxy logs and in a referrer.
    # Single use is what makes finding it later worthless.
    state = san.issue()
    assert san.verify_and_burn(state)[0] is True
    ok, why = san.verify_and_burn(state)
    assert ok is False and why == "replayed"


def test_a_stale_state_is_refused():
    state = san.issue()
    nonce, issued_at, sig = state.split(".")
    old = f"{nonce}.{int(issued_at) - san._TTL_SECONDS - 5}"
    # ⛔ RE-SIGNED, NOT HAND-EDITED. Editing the timestamp under the old signature
    # would fail on the signature and the test would pass for the wrong reason —
    # it would never reach the clock at all.
    ok, why = san.verify_and_burn(f"{old}.{san._sign(old)}")
    assert ok is False and why == "expired"


def test_a_FUTURE_timestamp_is_refused_too():
    """⚠️ A signed future timestamp cannot come from this server, so it means the
    clock moved — and admitting it would let a state outlive its TTL by however far
    the clock jumped."""
    nonce = "abc"
    future = f"{nonce}.{int(time.time()) + 10_000}"
    ok, why = san.verify_and_burn(f"{future}.{san._sign(future)}")
    assert ok is False and why == "expired"


def test_the_signature_is_what_rejects_a_tampered_payload():
    state = san.issue()
    nonce, issued_at, sig = state.split(".")
    ok, why = san.verify_and_burn(f"{nonce}tampered.{issued_at}.{sig}")
    assert ok is False and why == "bad-signature"


def test_two_issued_states_are_different():
    """A predictable state is a forgeable one."""
    assert len({san.issue() for _ in range(50)}) == 50


# --------------------------------------------------------------------------- #
# the burn table cannot be turned off by filling it
# --------------------------------------------------------------------------- #

def test_a_full_burn_table_still_burns():
    """🔴 THE FAILURE THIS PREVENTS IS SILENT. An unauthenticated endpoint feeds
    this table, so a caller controls its size — and an eviction path that gave up
    and skipped the burn would switch replay protection OFF for exactly the caller
    who filled it."""
    for _ in range(san._MAX_BURNED + 20):
        san.verify_and_burn(san.issue())
    assert len(san._BURNED) <= san._MAX_BURNED

    state = san.issue()
    assert san.verify_and_burn(state)[0] is True
    ok, why = san.verify_and_burn(state)
    assert ok is False and why == "replayed", "a full table stopped burning"


# --------------------------------------------------------------------------- #
# the router actually calls it — component tests are blind to the wire
# --------------------------------------------------------------------------- #

def test_the_CALLBACK_verifies_state_and_the_LOGIN_issues_it():
    """⛔ THE WIRE, NOT THE COMPONENT. This module can be perfect and the router can
    go on ignoring it — that is this repo's most-repeated defect, fourteen times
    over. Asserted against the SHIPPED source by name, so deleting either call site
    lands red while both halves stay individually correct.
    """
    import inspect
    import api.schwab_router as r

    login = inspect.getsource(r.schwab_login)
    callback = inspect.getsource(r.schwab_callback)
    assert "oauth_state.issue()" in login, "/login stopped minting a state"
    assert "state=" in login, "/login stopped putting the state on the auth URL"
    assert "oauth_state.verify_and_burn" in callback, "/callback stopped checking the state"
    # ⛔ AND THE CHECK MUST PRECEDE THE EXCHANGE. Verifying after the token has been
    # written is a check that reports on damage already done.
    assert callback.index("verify_and_burn") < callback.index("exchange_code")


def test_login_and_refresh_are_ADMIN_GATED_and_callback_is_NOT():
    """⚠️ THE ASYMMETRY IS DELIBERATE AND EASY TO 'FIX' WRONGLY. `/callback` is
    reached by a cross-site top-level redirect from Schwab, so a cookie dependency
    there would make the flow hostage to `SameSite`. `state` is the correct gate for
    a callback; a session is the correct gate for the two endpoints a human calls.
    """
    import api.schwab_router as r

    def deps(fn):
        import inspect
        return str(inspect.signature(fn))

    assert "require_flow_admin" in deps(r.schwab_login), "/login is not admin-gated"
    assert "require_flow_admin" in deps(r.schwab_refresh), "/refresh is not admin-gated"
    assert "require_flow_admin" not in deps(r.schwab_callback), (
        "/callback became session-gated — see the docstring: the cross-site redirect "
        "from Schwab may not carry the cookie, and `state` is the gate that belongs here")


def test_the_callback_no_longer_echoes_the_raw_exception_or_the_url():
    """The exception came from an HTTP call carrying the app secret and the auth
    code; `str(e)` on an httpx error can hand the request URL back to the caller.
    The old handler also returned `str(request.url)` — which contains the `code`."""
    import ast
    import inspect
    import api.schwab_router as r

    # ⛔ COMMENTS AND DOCSTRINGS ARE STRIPPED, AND THIS RAIL LEARNED IT THE HARD
    # WAY: the handler's own comment EXPLAINS why `str(e)` must not be returned, and
    # a raw substring check went red on the explanation. A rail that cannot tell
    # code from prose about code reports the fix as the defect.
    tree = ast.parse(inspect.getsource(r.schwab_callback).strip())
    fn = tree.body[0]
    if (fn.body and isinstance(fn.body[0], ast.Expr)
            and isinstance(fn.body[0].value, ast.Constant)
            and isinstance(fn.body[0].value.value, str)):
        fn.body = fn.body[1:]
    code = ast.unparse(fn)

    assert "str(e)" not in code, "the raw exception is being returned again"
    assert "str(request.url)" not in code, "the callback URL (with the code) is echoed again"
    assert "logger.exception" in code, "the failure stopped being logged at all"

    # ⭐ AND THE POSITIVE CONTROL, so the three lines above cannot pass vacuously
    # against an empty or mis-parsed body.
    assert "exchange_code" in code and "JSONResponse" in code
