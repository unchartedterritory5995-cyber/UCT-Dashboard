"""OI-35 — V2 can be narrowed to named channels, which is the only thing that makes a canary possible.

⚰️ WHY THIS EXISTS. 03-architecture §2.1 specified a per-channel V2 flag. What shipped was
`enabled()` — one global boolean — plus `command_enabled()`, which splits by COMMAND. There was no
channel dimension anywhere, so "flip the canary channel" could not be done: setting
DISCORD_RENDER_V2_ENABLED sends every member's /chart in #chart-flow-requests to V2 in the same
instant. The flip packet's precondition table had been written against the spec rather than against
the code, and nobody had tried to execute it until tonight.

⛔ THE DEFAULT IS "EVERY CHANNEL". This is a NARROWING control, not a second kill switch. A default
of "no channels" would mean a deployment that set the master flag and forgot this one renders V2 to
nobody while every check reports it on — off-and-unset indistinguishable from off-on-purpose.
"""
from __future__ import annotations

import pytest

from api.services.discord_render import commands

CANARY = "1549129739048853544"    # #render-smoke, private, admins + bot only
MEMBER = "1546563720702853280"    # #chart-flow-requests, where the members are


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv("DISCORD_RENDER_V2_CHANNELS", raising=False)
    yield


def _i(channel: str) -> dict:
    return {"channel_id": channel}


def test_unset_means_every_channel(monkeypatch):
    """The state production is in right now. Must be untouched."""
    assert commands.v2_channels() == ()
    assert commands.channel_allowed(_i(MEMBER)) is True
    assert commands.channel_allowed(_i(CANARY)) is True


def test_a_canary_of_one_channel_excludes_the_member_channel(monkeypatch):
    """⛔⛔ THE WHOLE POINT. If this row is green, an admin-only canary is possible with
    organic members exposed = 0. If it is red, flipping V2 is a member flip."""
    monkeypatch.setenv("DISCORD_RENDER_V2_CHANNELS", CANARY)
    assert commands.channel_allowed(_i(CANARY)) is True
    assert commands.channel_allowed(_i(MEMBER)) is False


def test_several_channels_are_allowed(monkeypatch):
    monkeypatch.setenv("DISCORD_RENDER_V2_CHANNELS", f"{CANARY},{MEMBER}")
    assert commands.channel_allowed(_i(CANARY)) is True
    assert commands.channel_allowed(_i(MEMBER)) is True


def test_whitespace_and_empty_parts_are_tolerated(monkeypatch):
    monkeypatch.setenv("DISCORD_RENDER_V2_CHANNELS", f" {CANARY} , ,")
    assert commands.v2_channels() == (CANARY,)
    assert commands.channel_allowed(_i(CANARY)) is True
    assert commands.channel_allowed(_i(MEMBER)) is False


def test_only_separators_means_unrestricted_not_a_dead_gate(monkeypatch):
    """⛔ " , " must not parse to ("",), which would compare against the empty string and
    refuse every channel — V2 flipped on and answering nowhere."""
    monkeypatch.setenv("DISCORD_RENDER_V2_CHANNELS", " , ")
    assert commands.v2_channels() == ()
    assert commands.channel_allowed(_i(MEMBER)) is True


def test_an_interaction_with_no_channel_is_refused_when_a_canary_is_set(monkeypatch):
    """A DM or a malformed payload carries no channel_id. With a canary set, "unknown" is
    not the canary, so it falls through to the pre-V2 path — which is the safe direction."""
    monkeypatch.setenv("DISCORD_RENDER_V2_CHANNELS", CANARY)
    assert commands.channel_allowed({}) is False


# --- the wiring, not just the predicate -------------------------------------------------

def test_the_gate_is_actually_wired_into_handle():
    """⛔ A predicate nobody calls is not a gate. This reads the SOURCE of `handle` and
    asserts the call is present, with a non-vacuity control proving the probe can tell the
    difference between a function that calls it and one that does not.

    ⭐ Read from the AST, never a grep over the whole file — a grep would match the import,
    the docstring, or this test's own name."""
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(commands.handle))
    called = {n.func.id for n in ast.walk(tree)
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "channel_allowed" in called, "handle() does not consult the canary gate"

    # non-vacuity: the same probe over a function that does NOT call it must say so
    other = ast.parse(inspect.getsource(commands.command_enabled))
    other_called = {n.func.id for n in ast.walk(other)
                    if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "channel_allowed" not in other_called


def test_renderhealth_is_exempt_from_the_canary_gate():
    """⛔ /renderhealth is answered whatever the master flag says, because it is the
    read-only diagnostic an admin uses while V2 is dark. If the canary gate caught it, it
    would break in every channel the moment a canary was set — a regression introduced by
    a change that is supposed to REDUCE reach."""
    import ast
    import inspect

    src = inspect.getsource(commands.handle)
    tree = ast.parse(src)
    guard = None
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and any(
            isinstance(c, ast.Call) and isinstance(c.func, ast.Name)
            and c.func.id == "channel_allowed" for c in ast.walk(node.test)
        ):
            guard = node
            break
    assert guard is not None, "no if-guard calls channel_allowed"
    # the guard's condition must also mention the renderhealth command name
    names = {n.attr for n in ast.walk(guard.test) if isinstance(n, ast.Attribute)}
    assert "RENDERHEALTH_COMMAND" in names, (
        "the canary guard does not exempt /renderhealth")
