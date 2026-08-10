"""A local process must not steal production's one vendor connection slot.

🔴 2026-08-10: six stale `uvicorn api.main:app` dev servers on the owner's PC held
Finnhub connections with the PRODUCTION key. Finnhub allows ~1 connection per key,
so production connected, subscribed 33 tickers, was kicked ~1 s later, and cycled
into a circuit breaker for hours. Live charts were dead and every symptom pointed
at the pod.

⭐ THE DEV BOX ALWAYS WINS. Production redeploys and reconnects; a forgotten laptop
process never does — so killing them one at a time does nothing, the next takes the
slot immediately. The only durable fix is refusing to open the socket at all.
"""
import importlib

import pytest

g = importlib.import_module("api.services.vendor_socket_guard")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("RAILWAY_ENVIRONMENT", raising=False)
    monkeypatch.delenv("ALLOW_LOCAL_VENDOR_SOCKETS", raising=False)


def test_production_may_open_the_socket(monkeypatch):
    """⛔ THE CONTROL THAT MATTERS MOST. If this ever fails, the guard has
    silenced the LIVE feed — a far worse outage than the one it prevents."""
    monkeypatch.setenv("RAILWAY_ENVIRONMENT", "production")
    allowed, reason = g.may_open("finnhub")
    assert allowed is True and reason == ""
    assert g.refuse_if_local("finnhub") is False


def test_a_local_process_is_REFUSED(monkeypatch):
    allowed, reason = g.may_open("finnhub")
    assert allowed is False
    assert g.refuse_if_local("finnhub") is True


def test_the_refusal_tells_the_developer_WHY_and_HOW(monkeypatch):
    """⚠️ A developer whose local charts went quiet must be told the reason and
    the fix in the same line, or they spend the afternoon debugging the stream."""
    _, reason = g.may_open("finnhub")
    assert "ALLOW_LOCAL_VENDOR_SOCKETS" in reason, "no escape hatch named"
    assert "finnhub" in reason, "the vendor is not named"
    assert "ONE" in reason or "one" in reason, "the cause is not explained"
    # ⛔ AND IT MUST SAY THAT THIS WAS DELIBERATE. A mutation that gutted the
    # opening clause survived the three checks above, because they only sample
    # tokens from the LATER segments of a concatenated message. Without this,
    # a developer reads a truncated line and cannot tell a refusal from a crash.
    assert "REFUS" in reason.upper(), "the message never says it is refusing"


def test_the_escape_hatch_is_opt_IN(monkeypatch):
    """⛔ Opt-in, not opt-out: the failure direction must be a quiet LOCAL chart,
    never a production outage."""
    monkeypatch.setenv("ALLOW_LOCAL_VENDOR_SOCKETS", "1")
    assert g.may_open("finnhub")[0] is True


@pytest.mark.parametrize("val", ["", "0", "true", "yes", "TRUE"])
def test_only_the_literal_1_opens_the_hatch(val, monkeypatch):
    """⛔ A loose truthiness check ('any non-empty value') would let a stray
    `ALLOW_LOCAL_VENDOR_SOCKETS=0` — the thing an operator sets to mean OFF —
    turn the guard off. Same shape as the env-flag traps already in this repo."""
    monkeypatch.setenv("ALLOW_LOCAL_VENDOR_SOCKETS", val)
    assert g.may_open("finnhub")[0] is False


def test_production_signal_is_the_SAME_one_auth_already_trusts():
    """⛔ NOT A PRIVATE 'am I in prod?' FLAG. `RAILWAY_ENVIRONMENT` is already
    load-bearing for COOKIE_SECURE, so if it ever stopped being set we would learn
    it from insecure session cookies long before a missing price feed. A second
    signal would drift and then disagree with the first at the worst moment."""
    import inspect

    from api.routers import auth as auth_router

    assert "RAILWAY_ENVIRONMENT" in inspect.getsource(g.on_production)
    assert "RAILWAY_ENVIRONMENT" in inspect.getsource(auth_router).split("\n\n")[0] \
        or "RAILWAY_ENVIRONMENT" in inspect.getsource(auth_router)


# --------------------------------------------------------------------------- #
# the wire — both sockets must actually consult it
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize("module,vendor", [
    ("api.services.realtime_stream", "finnhub"),
    ("api.services.bar_stream", "massive-bars"),
])
def test_BOTH_live_sockets_consult_the_guard(module, vendor):
    """⭐ THE TEST THAT REDS WHEN THE WIRE IS CUT. The guard can be perfect and
    still protect nothing if a socket never calls it — the exact failure shape the
    2026-08-08 audit found eight times over.

    ⛔ Asserted over the AST, not a grep: a grep matches the explanatory comment
    that sits directly above each call site and would pass with the call deleted.
    """
    import ast
    import importlib

    mod = importlib.import_module(module)
    tree = ast.parse(ast.unparse(ast.parse(open(mod.__file__, encoding="utf-8").read())))
    calls = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
        and n.func.attr == "refuse_if_local"
    ]
    assert calls, f"{module} never asks the guard before opening its socket"
    args = [a.value for c in calls for a in c.args if isinstance(a, ast.Constant)]
    assert vendor in args, f"{module} does not identify itself as {vendor!r}"
