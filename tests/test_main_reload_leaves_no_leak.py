"""🔴 A RELOAD OF `api.main` MUST LEAVE THE SHARED APP EXACTLY AS IT FOUND IT.

WHY THIS FILE EXISTS
--------------------
`tests/test_backtest_endpoint.py` passed 8/8 alone and failed 8/8 with
`assert 401 == 200` in the branch's own 52-file baseline, while neither it nor
`api/routers/backtest.py` had a single commit on the branch. Nothing about the
route had changed; a neighbour had reloaded `api.main`.

The mechanism, measured rather than reasoned (2026-08-27):

  * `importlib.reload(api.main)` rebinds `api.main.app` to a **NEW** FastAPI
    object — 0x14BEA23C740 before, 0x14BFA1B2AB0 after;
  * it leaves `api.middleware.auth_middleware`, `get_current_user`,
    `get_current_user_with_plan` and even the `require_paid` object hanging off
    `/api/backtest`'s dependant **byte-identical**. The dependency identities do
    not move at all;
  * a victim module does `from api.main import app` + `TestClient(app)` at
    IMPORT — pytest imports every test module during collection, so it pins the
    old app before any test runs — while `tests/authclients.py::_main_app()`
    re-imports per call and therefore writes `dependency_overrides` onto the NEW
    one.

⭐ SO THE FAILURE IS NOT A MISMATCHED KEY. The override is correct, the gate is
correct, the route is correct — the override is simply installed on an app
nobody is driving, and `require_paid` runs for real on the app that IS driven.
⛔ Which is why a fix that "restores the module" by reloading once more cannot
work: a third reload builds a THIRD app. Only putting the ORIGINAL object back
restores anybody.

WHAT THIS FILE ASSERTS, AND WHY IN THIS SHAPE
---------------------------------------------
Two rails that fail for different reasons, and neither replaces the other:

  1. the BEHAVIOUR — a client bound before a reload still sees an `authclients`
     override afterwards. That is the member-visible sentence (401 vs 200), not
     a proxy for it;
  2. the CENSUS — an AST over `tests/**` naming any module that reloads
     `api.main` outside `tests/mainreload.py`. Rail 1 can only see the leak on a
     path it drives itself; the census is what makes a NEW offender fail by name
     instead of by poisoning somebody three files later.

⛔ AND EACH CARRIES ITS OWN NON-VACUITY CONTROL. "Nothing changed" is the same
observation as "nothing happened", so a helper that quietly stopped reloading
would satisfy every identity assertion here by doing no work at all.
"""
from __future__ import annotations

import ast
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import api.main  # noqa: E402
from api.main import app as app_pinned_at_import  # noqa: E402  <- the victim's idiom
from fastapi.testclient import TestClient  # noqa: E402

from tests.authclients import PAID_MEMBER, _DEPS, signed_in_as  # noqa: E402
from tests.mainreload import app_built_with  # noqa: E402

#: A gated route on the app this file pinned at import. GET and read-only, so
#: `lesson_never_probe_a_mutating_endpoint_to_test_auth` does not apply.
PAID_ROUTE = "/api/backtest/strategies"

#: Any flag `api/main.py` reads at module level does here — this file is about
#: what a reload MOVES, not about what the flag gates.
A_FLAG = "SCREEN_BACKTEST_ENABLED"


def _dep_calls(app, path_needle: str) -> list:
    """The dependency callables the LIVE route table holds for a path."""
    out = []
    for r in getattr(app, "routes", []):
        if path_needle not in (getattr(r, "path", "") or ""):
            continue
        dependant = getattr(r, "dependant", None)
        for d in getattr(dependant, "dependencies", None) or []:
            out.append(d.call)
    return out


# -- 1. the objects a reload must not move -----------------------------------

def test_CONTROL_the_helper_really_reloads_and_hands_back_a_DIFFERENT_app():
    """⛔ FIRST, BECAUSE EVERY ASSERTION BELOW IS "NOTHING MOVED".

    A helper that had quietly stopped reloading — an early return, a cached
    result, a flag it no longer honours — would pass every identity check in
    this file by doing nothing at all. This is the one assertion that
    distinguishes *restored* from *never touched*.

    ⛔ It compares against the app PINNED AT IMPORT, not against the live
    `api.main.app`, on purpose: the live one is what rail 2 is about, and a
    control that also moves when the restore is deleted would be measuring the
    defect twice instead of guarding the other three.
    """
    built = app_built_with(**{A_FLAG: "1"})
    assert built is not app_pinned_at_import, (
        "app_built_with() handed back the app this module already held, so it "
        "did not reload anything — every 'identity is preserved' assertion in "
        "this file is now vacuous")
    routes = len(getattr(built, "routes", []))
    assert routes > 500 and _dep_calls(built, PAID_ROUTE), (
        f"the app it built has {routes} routes — it is not a real api.main "
        f"app, so 'it is a different app' means nothing")


def test_a_reload_leaves_api_main_app_the_IDENTICAL_object():
    """⭐ THE DEFECT ITSELF, IN ONE LINE."""
    before = api.main.app
    app_built_with(**{A_FLAG: "1"})
    assert api.main.app is before, (
        "api.main.app is a DIFFERENT object after a reload. Every module that "
        "did `from api.main import app` at import time — pytest imports them "
        "all during collection — is now driving an app that "
        "tests/authclients.py can no longer reach, and their paid routes 401. "
        "Restore api.main's namespace in tests/mainreload.py::app_built_with.")
    assert sys.modules["api.main"] is api.main, (
        "sys.modules['api.main'] was replaced, not reloaded in place")


def test_a_reload_leaves_the_DEPENDENCY_IDENTITIES_identical():
    """The overrides in `tests/authclients.py` are keyed on FUNCTION OBJECTS.

    Measured today, a reload of `api.main` does not touch them — it never
    re-executes `api/middleware/auth_middleware`. This pins that, so a future
    helper that reloaded the auth module too (or left a half-restored
    namespace) fails HERE, naming the identity that moved, rather than 400
    assertions later in somebody else's file.
    """
    before_deps = [id(d) for d in _DEPS]
    before_route = [id(c) for c in _dep_calls(app_pinned_at_import, PAID_ROUTE)]
    assert before_route, (
        f"no dependency hangs off {PAID_ROUTE} on the pinned app — this rail "
        f"would pass by describing nothing")

    app_built_with(**{A_FLAG: "1"})

    assert [id(d) for d in _DEPS] == before_deps, (
        "tests/authclients.py::_DEPS hold different function objects after a "
        "reload — every `signed_in_as` override is now keyed on a dependency "
        "no route depends on")
    assert [id(c) for c in _dep_calls(app_pinned_at_import, PAID_ROUTE)] == before_route, (
        f"the dependency objects on {PAID_ROUTE} moved under the pinned app")


# -- 2. the sentence a member would have seen --------------------------------

def test_a_client_bound_BEFORE_a_reload_still_sees_an_authclients_override():
    """⭐⭐ THE ASSERTION THAT EARNED ITS PLACE — the 401 itself.

    Everything above is about object identity, and identity is a mechanism.
    THIS is the outcome: the `assert 401 == 200` that eight untouched tests
    reported. It drives the exact two idioms that disagreed — a client pinned
    at import, an override resolved per call — across a reload.
    """
    client = TestClient(app_pinned_at_import, raise_server_exceptions=False)

    # ⛔ THE CONTROL, AND IT IS NOT OPTIONAL. If this route had quietly stopped
    # being `require_paid`, the assertion below would read 200 whether the
    # override arrived or not, and this rail would be
    # `lesson_gate_that_cannot_fail`.
    assert client.get(PAID_ROUTE).status_code in (401, 402, 403), (
        f"{PAID_ROUTE} answers an anonymous caller — it is no longer gated, so "
        f"'the override reached it' is unprovable here")

    app_built_with(**{A_FLAG: "1"})

    with signed_in_as(PAID_MEMBER):
        r = client.get(PAID_ROUTE)
    assert r.status_code == 200, (
        f"{PAID_ROUTE} answered {r.status_code} to a signed-in PAID member "
        f"after api.main was reloaded. The override from tests/authclients.py "
        f"landed on api.main.app while this client dispatches on the app it "
        f"was handed at import — a reload left the two pointing at different "
        f"objects. This is the leak that made all 8 assertions in "
        f"tests/test_backtest_endpoint.py read `assert 401 == 200`.")

    # ...and the override is gone again afterwards, so this rail leaves nothing
    # behind either (`lesson_teardown_must_undo_what_setup_created`).
    assert client.get(PAID_ROUTE).status_code in (401, 402, 403)


# -- 3. the census: nobody reloads api.main on their own ---------------------

def _test_files() -> list:
    root = os.path.dirname(os.path.abspath(__file__))
    out = []
    for dirpath, _dirs, names in os.walk(root):
        for n in names:
            if n.endswith(".py"):
                out.append(os.path.join(dirpath, n))
    return sorted(out)


def _rel(path: str) -> str:
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.relpath(path, repo).replace(os.sep, "/")


def api_main_reload_sites(source: str) -> list:
    """Every line in `source` that reloads `api.main`, read with an AST.

    ⛔ AN AST, NEVER A GREP (`lesson_probe_names_must_be_derived_not_typed`): a
    grep for "reload" here reports this file's own prose, and a grep for
    "api.main" reports the ~20 modules that legitimately IMPORT it. Only a
    `reload(...)` call whose argument RESOLVES to the `api.main` module is a
    site — including through whatever alias the importer chose, which is why
    the binding names are collected first.
    """
    tree = ast.parse(source)

    aliases = {"api.main"}
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            for a in n.names:
                if a.name == "api.main":
                    aliases.add(a.asname or "api")
        elif isinstance(n, ast.ImportFrom) and n.module == "api":
            for a in n.names:
                if a.name == "main":
                    aliases.add(a.asname or "main")

    def _name_of(node) -> str:
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            base = _name_of(node.value)
            return f"{base}.{node.attr}" if base else ""
        if isinstance(node, ast.Subscript):          # sys.modules["api.main"]
            idx = node.slice
            if isinstance(idx, ast.Constant) and isinstance(idx.value, str):
                return idx.value
        return ""

    hits = []
    for n in ast.walk(tree):
        if not isinstance(n, ast.Call):
            continue
        if _name_of(n.func) not in ("importlib.reload", "reload"):
            continue
        if n.args and _name_of(n.args[0]) in aliases:
            hits.append(n.lineno)
    return sorted(hits)


def test_CONTROL_the_census_reader_SEES_a_reload_and_IGNORES_what_is_not_one():
    """⛔ A DETECTOR THAT MATCHES NOTHING REPORTS A CLEAN REPO."""
    assert api_main_reload_sites(
        "import importlib\nimport api.main\nimportlib.reload(api.main)\n") == [3]
    assert api_main_reload_sites(
        "import importlib\nimport api.main as m\nimportlib.reload(m)\n") == [3]
    assert api_main_reload_sites(
        "import importlib, sys\nimportlib.reload(sys.modules['api.main'])\n") == [2]
    # a reload of something else is not a site
    assert api_main_reload_sites(
        "import importlib\nimport api.services.cache as c\nimportlib.reload(c)\n") == []
    # importing api.main without reloading it is not a site
    assert api_main_reload_sites("import api.main as m\nm.app\n") == []
    # prose is not a site
    assert api_main_reload_sites("# importlib.reload(api.main) is banned here\n") == []


def test_only_tests_mainreload_reloads_api_main():
    """⭐ THE ONE THAT FAILS BY NAME ON THE NEXT OFFENDER.

    The rails above prove the helper is safe; they cannot prove anybody used
    it. A module that reloads `api.main` itself has no teardown that could
    restore the ORIGINAL app object, so it poisons whatever pytest runs after
    it — silently, in a different file, with an assertion that has nothing to
    do with the change. That is a two-day debugging bill, so it is refused here
    by name.
    """
    files = _test_files()
    assert len(files) > 100, (
        f"only {len(files)} python files found under tests/ — the census did "
        f"not read the tree and would report a clean repo for the wrong reason")

    sanctioned = "tests/mainreload.py"
    offenders = []
    seen_sanctioned = False
    for path in files:
        rel = _rel(path)
        try:
            with open(path, "r", encoding="utf-8") as fh:
                sites = api_main_reload_sites(fh.read())
        except (SyntaxError, UnicodeDecodeError) as exc:
            # ⛔ An unreadable file is a HOLE in this census, not a clean file.
            offenders.append(f"{rel}: unreadable ({exc.__class__.__name__})")
            continue
        if not sites:
            continue
        if rel == sanctioned:
            seen_sanctioned = True
            continue
        offenders.extend(f"{rel}:{ln}" for ln in sites)

    assert seen_sanctioned, (
        f"the census found no reload of api.main in {sanctioned} — the one "
        f"sanctioned site. Either the helper stopped reloading (and the mount "
        f"rails are measuring a LOCAL FastAPI() again) or this reader is "
        f"broken; either way the emptiness below proves nothing")
    assert not offenders, (
        f"these test modules reload `api.main` themselves: {offenders}.\n"
        f"A reload rebinds `api.main.app`, and every module that did "
        f"`from api.main import app` at import — pytest imports them all "
        f"during collection — keeps the OLD object while tests/authclients.py "
        f"writes its overrides onto the NEW one, so their paid routes 401 in "
        f"company and pass alone. Use `from tests.mainreload import "
        f"app_built_with`, which puts the namespace back before it returns.")
