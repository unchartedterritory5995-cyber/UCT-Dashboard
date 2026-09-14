"""The adapter boundary: only `adapters/**` may speak to the network (step 2.4b P2.1, 03 §3.8).

> Timeouts, retries, breakers and fallback live in an adapter. A command handler asks an adapter for
> data; it never holds a client, a timeout, or a retry loop of its own.

⛔ WHY A RAIL AND NOT A CONVENTION. Every failure this closes was "the policy lives in the caller",
and each was correct in the one place somebody remembered it and wrong in the next caller:
a fixed 1.5 s bars retry that re-synchronised every caller that failed together; a `/flow` handler
whose single `except` turned four causes into one sentence wrong for three of them (C-08); a
renderer call with no ceiling at all, which is how a 21-second page load became a member's spinner.

⛔ THE WALK IS AN AST, NEVER A GREP. A grep for `import httpx` matches the sentence in this
docstring, the comment above a call site, and a string in a test fixture — this repo has six
recorded instances of a literal-hunting check reporting a property of ITSELF
(`CODE, NEVER PROSE`, CLAUDE.md). `_imports_of` reads the parse tree, so prose cannot trip it and a
re-export cannot hide from it.
"""
from __future__ import annotations

import ast
import pathlib

import pytest

PKG = pathlib.Path(__file__).resolve().parents[1] / "api" / "services" / "discord_render"
ADAPTERS = PKG / "adapters"

#: A network client is a network client whatever it is called. `urllib`/`http` are listed because
#: "we only used the stdlib" is how a second transport gets in without anybody calling it a client.
#: ⚠️ `socket` is deliberately NOT here. `runtime.py:163` imports it for `socket.gethostname()` in a
#: lease owner id — no network, and a rail that reds on a correct line is a rail people delete
#: (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`). The predicate is "holds a CLIENT".
NETWORK_MODULES = {
    "httpx", "requests", "aiohttp", "urllib", "urllib3", "http", "websockets",
    "boto3", "botocore", "yfinance", "finnhub", "playwright",
}

#: Everything under `adapters/` may hold a client — that is the whole point of the directory.
ALLOWED_TO_SPEAK = {"adapters"}

#: The two modules outside `adapters/` that legitimately hold a client, each with the reason. They
#: are DISCORD-outbound, not one of the five upstreams, so they are not provider adapters — but they
#: are the same idea: one module owns one transport, with its own timeout.
#:
#: ⛔ THIS IS A LIST OF TWO, AND IT IS THE POINT OF THE RAIL THAT IT STAYS AT TWO. An exemption set
#: that grows whenever the rail goes red is a rail that has been turned off one line at a time; the
#: test below pins the membership, so adding a third is a deliberate, reviewable act.
TRANSPORTS = {
    # §3.4 — the single owner of every Discord write. Its own timeout (delivery.TIMEOUT_S) and its
    # own 429/5xx policy live with it, which is exactly the shape this rail is enforcing elsewhere.
    "delivery.py": "the Discord client (§3.4) — one module owns the interaction-token transport",
    # §3.9 — the alert webhook. ⛔ It must never use `delivery.py`: an alert about delivery failing
    # cannot be routed through the thing that is failing.
    "observe.py": "the #render-alerts webhook (§3.9), deliberately independent of delivery.py",
}


def _modules(root: pathlib.Path):
    """Every .py under the package, as (relative-path-string, parse tree)."""
    for path in sorted(root.rglob("*.py")):
        yield path.relative_to(PKG).as_posix(), ast.parse(path.read_text(encoding="utf-8"), str(path))


def _imports_of(tree: ast.AST) -> set[str]:
    """Top-level module names this tree imports, from BOTH forms, including inside a function —
    a deferred `import httpx` inside a handler is exactly the shape this is looking for."""
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            found.add(node.module.split(".")[0])
    return found


def _under_adapters(rel: str) -> bool:
    return rel.split("/")[0] in ALLOWED_TO_SPEAK


# ── the boundary ────────────────────────────────────────────────────────────

def _speakers() -> dict[str, list[str]]:
    """Every module that holds a network client, with the clients it holds — DERIVED, never typed."""
    out = {}
    for rel, tree in _modules(PKG):
        hit = _imports_of(tree) & NETWORK_MODULES
        if hit:
            out[rel] = sorted(hit)
    return out


def test_no_module_outside_adapters_imports_a_network_client():
    offenders = {rel: mods for rel, mods in _speakers().items()
                 if not _under_adapters(rel) and rel not in TRANSPORTS}
    assert not offenders, (
        "a module outside adapters/ holds a network client:\n  "
        + "\n  ".join(f"{k}: {', '.join(v)}" for k, v in sorted(offenders.items()))
        + "\n\nMove the call into an adapter and return a Result. The timeout, the retry policy and "
          "the breaker belong with the client, not with whoever happened to need the data. If it is "
          "genuinely a transport and not a provider, add it to TRANSPORTS with the reason.")


def test_the_transport_exemption_list_is_exactly_the_modules_that_need_it():
    """⛔ BOTH DIRECTIONS. An exemption for a module that no longer holds a client is dead cover that
    silently starts excusing whatever lands at that path next; and a module that holds one without an
    exemption is caught by the test above. Together they pin the set at exactly the real speakers."""
    speakers = _speakers()
    for rel, why in TRANSPORTS.items():
        assert rel in speakers, (
            f"{rel} is exempted as a transport but holds no network client any more — drop the "
            f"exemption rather than leaving cover for a future import. (reason on file: {why})")
        assert (PKG / rel).is_file(), f"{rel} is exempted but does not exist"
    outside = {rel for rel in speakers if not _under_adapters(rel)}
    assert outside == set(TRANSPORTS), (
        f"the set of client-holding modules outside adapters/ is {sorted(outside)}, "
        f"but TRANSPORTS names {sorted(TRANSPORTS)}")


def test_every_transport_carries_its_own_timeout():
    """A transport is exempt from the ADAPTER boundary, not from the rule the boundary exists for.
    `lesson_a_guard_that_tests_the_adjacent_thing`: exempting the module and not checking the reason
    for the exemption is how a 60-second call ends up behind a 15-second deadline."""
    import re
    for rel in TRANSPORTS:
        src = (PKG / rel).read_text(encoding="utf-8")
        # Strip strings and comments so a docstring mentioning "timeout" cannot satisfy this.
        code = ast.parse(src)
        calls = [n for n in ast.walk(code)
                 if isinstance(n, ast.Call) and any(k.arg == "timeout" for k in n.keywords)]
        assert calls, (
            f"{rel} holds a network client and passes no timeout= to any call. An unbounded "
            "outbound call on this path is C-02: it pins a worker until the socket gives up.")
        assert re.search(r"\bTIMEOUT[_A-Z]*_S\b|timeout_s\b", src), (
            f"{rel} passes a timeout but not from a named constant or parameter — a literal buried "
            "in a call cannot be found, reviewed, or changed against the job deadline")


def test_the_walk_actually_examined_the_package():
    """⛔ NON-VACUITY. The assertion above passes over an empty file list — a moved package, a typo
    in PKG — and a clean result there means nothing (`lesson_a_fixture_that_cannot_distinguish...`)."""
    seen = [rel for rel, _ in _modules(PKG)]
    assert len(seen) >= 6, f"only {len(seen)} module(s) walked; the package moved or PKG is wrong"
    for expected in ("commands.py", "runtime.py", "freshness.py", "breakers.py"):
        assert expected in seen, f"{expected} is not in the walk, so the boundary is not being checked"


def test_the_walker_can_see_a_planted_client(tmp_path):
    """⛔ THE CONTROL. Both import forms, and one deferred inside a function — the shape a handler
    actually takes when somebody needs 'just one call'."""
    planted = tmp_path / "planted.py"
    planted.write_text(
        "import os\n"
        "from typing import Any\n"
        "def go():\n"
        "    import httpx\n"
        "    return httpx.get('https://example.invalid')\n"
        "from requests import Session\n", encoding="utf-8")
    found = _imports_of(ast.parse(planted.read_text(encoding="utf-8")))
    assert {"httpx", "requests"} <= found, "the walker missed a real import"
    assert "os" in found and "typing" in found, "the control: it sees ordinary imports too"
    assert found & NETWORK_MODULES == {"httpx", "requests"}


def test_prose_naming_a_client_is_not_an_import():
    """⛔ CODE, NEVER PROSE. A grep-based version of this rail would fail on its own docstring."""
    tree = ast.parse('"""We must never import httpx here."""\n'
                     '# import requests  -- deliberately not\n'
                     'CLIENT_NAME = "aiohttp"\n')
    assert _imports_of(tree) & NETWORK_MODULES == set()


# ── the other half: the boundary must have something on the far side ────────

def test_the_adapters_package_exists_and_is_the_one_that_speaks():
    """A boundary with nothing behind it is not a boundary — it is a directory that happens to be
    empty, and it would keep this file green forever."""
    assert ADAPTERS.is_dir(), "api/services/discord_render/adapters/ does not exist"
    assert (ADAPTERS / "result.py").is_file(), "the Result envelope is missing"


# ── the kill switch ─────────────────────────────────────────────────────────

def test_the_adapter_switch_defaults_ON_because_it_is_a_kill_switch(monkeypatch):
    """⛔ A kill switch that defaults OFF makes 'nobody set it' and 'somebody deliberately shut it
    down' indistinguishable from outside the repo — the ambiguity the flag ledger exists to prevent.
    There is nothing to kill while the V2 master is unset, because V2 is the only caller."""
    from api.services.discord_render.adapters import switch
    monkeypatch.delenv(switch.ENV, raising=False)
    assert switch.adapters_enabled() is True, "unset must mean ON"
    for off in ("0", "false", "FALSE", " no ", "off", "Off"):
        monkeypatch.setenv(switch.ENV, off)
        assert switch.adapters_enabled() is False, f"{off!r} must turn it off"
    for on in ("1", "true", "yes", "anything", ""):
        monkeypatch.setenv(switch.ENV, on)
        assert switch.adapters_enabled() is True, f"{on!r} must leave it on"


def test_the_switch_is_read_per_call_and_not_captured_at_import(monkeypatch):
    """⛔ THE LOAD-BEARING ONE. A module-level capture passes every other test in this file and makes
    the no-redeploy rollback a fiction: the pod would keep whatever the variable said when it
    booted. Same rail, same reason, as `test_the_flag_is_read_per_request` for HUB_PREVIEW_ENABLED."""
    from api.services.discord_render.adapters import switch
    monkeypatch.delenv(switch.ENV, raising=False)
    assert switch.adapters_enabled() is True
    monkeypatch.setenv(switch.ENV, "0")
    assert switch.adapters_enabled() is False, "the value changed after import and was not seen"
    monkeypatch.delenv(switch.ENV, raising=False)
    assert switch.adapters_enabled() is True, "and back again, without a reload"


def test_the_switch_is_declared_in_the_flag_ledger():
    """A gate the ledger does not know is a gate nobody can audit from outside the repo."""
    import json
    import pathlib
    from api.services.discord_render.adapters import switch
    ledger = json.loads((pathlib.Path(__file__).resolve().parents[1] / "docs" /
                         "feature_flags.json").read_text(encoding="utf-8"))
    assert switch.ENV in ledger["flags"], f"{switch.ENV} has no row in docs/feature_flags.json"
    row = ledger["flags"][switch.ENV]
    assert row["status"] == "dark", "nothing is set on any service until the owner flips it"


# ── the pre-V2 path is isolated from all of this ────────────────────────────
#
# THE P2 GROUND RULE: with `DISCORD_RENDER_V2_ENABLED` unset, member-visible behaviour is unchanged.
# ⭐ The cheapest proof is STRUCTURAL, not a golden: the pre-V2 path cannot behave differently if it
# cannot reach the new code. A golden diff proves the two runs agreed on the inputs somebody chose;
# this proves there is no path at all, for every input.

PRE_V2 = ("api/services/discord_interactions.py", "api/routers/discord_interactions.py")


@pytest.mark.parametrize("rel", PRE_V2)
def test_the_pre_v2_path_cannot_reach_the_adapters(rel):
    root = pathlib.Path(__file__).resolve().parents[1]
    tree = ast.parse((root / rel).read_text(encoding="utf-8"), rel)
    reached = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(
                "api.services.discord_render.adapters"):
            reached.add(node.module)
        if isinstance(node, ast.Import):
            reached |= {a.name for a in node.names
                        if a.name.startswith("api.services.discord_render.adapters")}
    assert not reached, (
        f"{rel} imports {sorted(reached)}. The adapters are reachable ONLY from commands.py, which "
        "runs only on the V2 path — that is what makes 'V2 unset behaves exactly as before' a fact "
        "about the code rather than a claim about a test run.")


def test_that_isolation_check_can_actually_see_an_import():
    """⛔ NON-VACUITY: the assertion above is an absence, and an absence is only evidence if the
    instrument could have seen a presence."""
    planted = ast.parse("from api.services.discord_render.adapters import bindings\n"
                        "import api.services.discord_render.adapters.bars\n")
    reached = set()
    for node in ast.walk(planted):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(
                "api.services.discord_render.adapters"):
            reached.add(node.module)
        if isinstance(node, ast.Import):
            reached |= {a.name for a in node.names
                        if a.name.startswith("api.services.discord_render.adapters")}
    assert len(reached) == 2


def test_the_v2_command_layer_is_the_one_that_reaches_them():
    """The other half: if `commands.py` stopped importing the bindings, the adapters would be built,
    tested, green and unwired — this programme's costliest recurring shape."""
    root = pathlib.Path(__file__).resolve().parents[1]
    src = (root / "api" / "services" / "discord_render" / "commands.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    assert any(isinstance(n, ast.ImportFrom) and (n.module or "").startswith(
        "api.services.discord_render.adapters") for n in ast.walk(tree)), (
        "commands.py no longer imports the adapters — the hot path is unwired")


@pytest.mark.parametrize("name", sorted(NETWORK_MODULES))
def test_every_listed_network_module_is_a_plausible_top_level_name(name):
    """The list is matched against top-level import names, so an entry like `urllib.request` would
    silently never match. This pins the shape rather than the membership."""
    assert "." not in name and name == name.strip() and name
