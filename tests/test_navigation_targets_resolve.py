"""🔴 EVERY NAVIGATION TARGET THE BACKEND OWNS MUST RESOLVE TO A REAL ROUTE.

⛔ THE MEASURED DEFECT, TWICE OVER. `api/services/voice_client_action_tools.py`
maps spoken phrases to SPA paths and the client dispatches `navigate(path)`
verbatim. Two of those paths pointed at nothing:

  * `"traders" -> /traders` — `api/routers/traders.py` was mounted and serving
    `GET /api/traders`, `app/src/pages/Traders.jsx` existed and had a green test
    file, and `App.jsx` carried no `/traders` route at all. The voice assistant
    walked members into `NotFound`.
  * `"uct 20" -> /uct20` — the route has always been `/uct-20`. Found by THIS
    rail, not by a human, which is the whole point of writing it.

The same typo sat in a SECOND registry, `api/routers/voice.py::_PAGE_DESCRIPTIONS`,
where it failed even more quietly: that dict is keyed by the pathname the member
is *on*, so a wrong key does not 404 — Compass simply receives no
"=== CURRENT PAGE ===" block for anyone sitting on UCT 20, forever, silently.

⭐ WHY THIS RAIL EXISTS INSTEAD OF THREE HAND-WRITTEN ROUTE TESTS. A component
test of `Traders.jsx` stays green for the entire time no route reaches it —
component tests are structurally blind to a severed wire. Even a per-door render
test only covers the door somebody remembered. This catches the CLASS: it reads
every value out of the registries the shipped code actually iterates and
resolves each one against the route table `App.jsx` actually declares. A new
alias pointing at a path nobody routed fails here on the day it is written.

⛔ DERIVED ON BOTH SIDES, RESTATED ON NEITHER. The targets are the imported dict
objects — not a copy of them — so a rename moves the test with the code. The
routes are parsed out of `App.jsx`. `lesson_probe_names_must_be_derived_not_typed`.

⛔ THE CATCH-ALL IS EXCLUDED, AND THAT IS THE LOAD-BEARING LINE IN THIS FILE.
`App.jsx` ends with `<Route path="*" element={<NotFound />} />`. A resolver that
honoured it would report every conceivable path "reachable" — including the two
broken ones above — and this rail would pass forever while measuring nothing.
`test_the_catch_all_is_not_treated_as_a_route` is the guard on that guard.
"""
import pathlib
import re

import pytest

from api.routers.voice import _PAGE_DESCRIPTIONS
from api.services.voice_client_action_tools import PAGE_ALIASES

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP_JSX = ROOT / "app" / "src" / "App.jsx"
AUTH_GUARD_JSX = ROOT / "app" / "src" / "components" / "AuthGuard.jsx"

# `core.autocrlf` is on in this checkout — normalise at the door.
def _read(p: pathlib.Path) -> str:
    return p.read_text(encoding="utf-8").replace("\r\n", "\n")


# `[^<>]*?` cannot cross into a nested JSX element, so this only ever matches a
# `path=` attribute belonging to the `<Route` that opened it — never one inside
# an `element={<Foo path="…" />}`.
_ROUTE_PATH = re.compile(r"<Route\b[^<>]*?\bpath=\"([^\"]*)\"")
_NAVIGATE_TO = re.compile(r"<Navigate\b[^<>]*?\bto=\"([^\"]*)\"")

#: `<Route path="*">` matches literally everything. See the module docstring.
CATCH_ALL = "*"


def declared_routes(app_src: str) -> set[str]:
    """Absolute route patterns `App.jsx` declares, catch-all excluded.

    Relative child paths (the `/journal` sub-routes) are dropped: composing them
    needs JSX nesting, no navigation target is one, and a target that WERE one
    would fail loudly here rather than pass quietly — the safe direction.
    """
    return {
        p for p in _ROUTE_PATH.findall(app_src)
        if p.startswith("/") and p != CATCH_ALL
    }


def _matches(target: str, pattern: str) -> bool:
    """React-Router path match, parameter segments included (`/research/:sym`)."""
    t, p = target.strip("/").split("/"), pattern.strip("/").split("/")
    if len(t) != len(p):
        return False
    return all(
        (seg.startswith(":") and part != "") or seg == part
        for part, seg in zip(t, p)
    )


def resolves(target: str, routes: set[str]) -> bool:
    """Does a bare pathname land on a declared route? Query/hash stripped."""
    path = target.split("?", 1)[0].split("#", 1)[0]
    return any(_matches(path, r) for r in routes)


def unresolved(targets, routes: set[str]) -> list[str]:
    return sorted({t for t in targets if not resolves(t, routes)})


@pytest.fixture(scope="module")
def routes() -> set[str]:
    return declared_routes(_read(APP_JSX))


# ── The rail ────────────────────────────────────────────────────────────────

def test_every_voice_navigation_target_lands_on_a_real_route(routes):
    """The class assertion. `open_page` hands these straight to `navigate()`."""
    dead = unresolved(PAGE_ALIASES.values(), routes)
    assert dead == [], (
        f"the voice assistant navigates members to {dead}, and App.jsx declares "
        "no route for them — every member who asks for one of these pages by "
        "voice lands on NotFound. Add the <Route>, or repoint the alias in "
        "api/services/voice_client_action_tools.py::PAGE_ALIASES."
    )


def test_every_page_hint_key_is_a_real_route(routes):
    """A wrong key here 404s nothing and costs Compass its page context."""
    dead = unresolved(_PAGE_DESCRIPTIONS.keys(), routes)
    assert dead == [], (
        f"api/routers/voice.py::_PAGE_DESCRIPTIONS is keyed on {dead}, which no "
        "route in App.jsx serves — so no member is ever on one of those "
        "pathnames and Compass silently gets no CURRENT PAGE block there."
    )


def test_every_literal_redirect_target_lands_on_a_real_route(routes):
    """⛔ A REDIRECT TO A DEAD PATH IS A DOOR THAT OPENS ONTO NOTHING.

    `/flow-scoreboard` redirected to `/options-flow?view=scoreboard` for a month
    after the view mode that answered it was deleted — the redirect resolved to
    a *route*, so nothing complained. Query strings are stripped here for that
    reason: this checks the pathname, and `lostDoors.route.test.jsx` renders the
    forward end-to-end because a param a page must honour is not a route fact.
    """
    targets = _NAVIGATE_TO.findall(_read(APP_JSX)) + _NAVIGATE_TO.findall(_read(AUTH_GUARD_JSX))
    dead = unresolved([t for t in targets if t.startswith("/")], routes)
    assert dead == [], f"these <Navigate> targets reach no declared route: {dead}"


def test_the_two_doors_this_rail_was_written_for(routes):
    """⛔ Named on purpose. The sweeps above pass trivially if somebody deletes
    the aliases instead of fixing them, and these are the two paths whose
    unreachability was the measured defect."""
    assert resolves("/traders", routes), (
        "/traders reaches no route. GET /api/traders is mounted and paid-gated, "
        "Traders.jsx renders it, and the voice navigator sends members here."
    )
    assert resolves(PAGE_ALIASES["uct 20"], routes), (
        f"the UCT 20 voice alias points at {PAGE_ALIASES['uct 20']!r}, which "
        "reaches no route."
    )


# ── The controls — a rail nobody has seen fail cannot be trusted ────────────

def test_the_catch_all_is_not_treated_as_a_route():
    """🔴 THE GUARD ON THE GUARD. `path="*"` matches everything; honouring it
    would make every assertion above pass for any path at all, forever."""
    src = _read(APP_JSX)
    assert f'path="{CATCH_ALL}"' in src, (
        "App.jsx no longer declares a catch-all route — this control can no "
        "longer prove the resolver ignores one, and the exclusion may have "
        "silently become dead code"
    )
    assert CATCH_ALL not in declared_routes(src)
    assert not resolves("/nothing-is-routed-here", declared_routes(src)), (
        "the resolver said an invented path resolves — it is matching the "
        "catch-all (or matching everything) and this whole file is decoration"
    )


def test_the_route_table_was_actually_parsed(routes):
    """Non-vacuity. An extractor that collapsed to a handful of routes would
    report real targets dead; one that collapsed to zero would... also fail —
    which is the safe direction, and this states the floor out loud."""
    assert len(routes) > 30, f"only parsed {len(routes)} routes out of App.jsx"
    assert len(PAGE_ALIASES) > 12, "PAGE_ALIASES collapsed — nothing is being checked"
    assert len(_PAGE_DESCRIPTIONS) > 10, "_PAGE_DESCRIPTIONS collapsed"


def test_PLANTED_CUT_removing_the_mount_reds_this_rail_by_name():
    """🔴 THE PROOF THAT CUTTING A WIRE IS VISIBLE HERE.

    Both components stay perfectly correct — `Traders.jsx` renders, `/api/traders`
    serves, the alias is intact. Only the ROUTE is gone, which is exactly the
    state this repo shipped in, and the failure must name what became
    unreachable rather than merely counting to zero.
    """
    src = _read(APP_JSX)
    MOUNT = '<Route path="/traders" element={<Traders />} />'
    # ⛔ NEVER `str.replace` WITHOUT PROVING THE ANCHOR WAS THERE
    # (`lesson_test_that_passes_vacuously`): a mutation that silently failed to
    # apply produces a control that "passes" while measuring the unmutated tree.
    assert MOUNT in src, f"the /traders mount moved — this control cannot cut a wire it cannot find in {APP_JSX}"
    cut = src.replace(MOUNT, "")
    assert cut != src

    after = declared_routes(cut)
    assert len(after) == len(declared_routes(src)) - 1, (
        "the cut removed something other than exactly one route — the control is "
        "measuring the wrong mutation"
    )
    assert "/traders" in unresolved(PAGE_ALIASES.values(), after), (
        "with the /traders route cut, the rail still reports every voice target "
        "resolved — it cannot see a severed wire and every assertion above is "
        "decoration"
    )


def test_a_path_in_prose_is_not_a_route():
    """The grep failure mode, asserted directly: this repo has already measured
    a probe that 'found 5 call sites, all five of them prose'."""
    assert declared_routes('// see <Route path="/traders"> below\n') == {"/traders"}, (
        "guard rewritten? this line documents the ONE thing the extractor cannot "
        "distinguish — prose that is byte-identical to a route declaration"
    )
    assert declared_routes('const p = "/traders"\n// the /traders page\n') == set()
    assert declared_routes('<Route index element={<Today />} />\n') == set()
    assert declared_routes('<Route path="/x" element={<Y path="/z" />} />\n') == {"/x"}
