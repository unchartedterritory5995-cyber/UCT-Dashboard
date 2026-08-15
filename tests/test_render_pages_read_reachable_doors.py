"""A headless /r/* page may only fetch endpoints it can actually reach.

🔴 THE MEASUREMENT THIS CLOSES. `9ff74f69` (2026-08-09) gated ~60 previously-public
routes — correctly. Two of them, `GET /api/breadth-monitor` and `GET /api/breadth`,
are fetched by `BreadthRender.jsx` and `InternalsRender.jsx`, which render in a
logged-OUT headless browser. Both pages went blank in production and stayed blank
for a week. Nothing caught it because:

  * the pages fall back to `{}` / `{rows: []}` on a non-ok response, so a 401
    renders as an EMPTY panel, not an error;
  * the screenshotter judges pixels, so an empty panel is simply "no panel";
  * every backend test passed — the ROUTES were correctly gated. The defect lived
    in the CONTRACT between a gate and a caller that could not satisfy it, which is
    the one place a component test cannot look
    (`lesson_built_tested_green_and_unreachable`).

The commit even kept `/api/calendar` open *because* `/r/calendar` needs it. The
reasoning existed; nothing enforced it. This is that enforcement.

⛔ THE PAID SIDE IS DERIVED FROM THE SERVED APP, never from a list retyped here —
a list would go stale the first time a route's gate moved, and would then agree with
whatever it was copied from (`lesson_probe_names_must_be_derived_not_typed`). We walk
`app.routes` and read each route's real dependency tree.
"""
from __future__ import annotations

import pathlib
import re

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[1]

# The headless, logged-OUT pages. Each renders with NO session cookie, so every
# endpoint it fetches must be reachable without one.
_RENDER_PAGES = (
    "app/src/pages/BreadthRender.jsx",
    "app/src/pages/InternalsRender.jsx",
)

# fetch('…') / fetch("…") / fetch(`…`) — the URL up to the first template hole or
# query string. Only same-origin /api/ paths matter; anything else is not our gate.
_FETCH_RE = re.compile(r"""fetch\(\s*[`'"](/api/[^`'"?\$]*)""")


def _fetched_paths(rel: str) -> set[str]:
    src = (_REPO / rel).read_text(encoding="utf-8")
    return {m.group(1).rstrip("/") for m in _FETCH_RE.finditer(src)}


@pytest.fixture(scope="module")
def app():
    from api.main import app as _app
    return _app


def _dep_names(route) -> set[str]:
    """Every dependency function name in this route's real tree."""
    out: set[str] = set()
    stack = [route.dependant]
    while stack:
        d = stack.pop()
        name = getattr(getattr(d, "call", None), "__name__", "")
        if name:
            out.add(name)
        stack.extend(d.dependencies)
    return out


def _gate_names_for(app, path: str) -> set[str] | None:
    """Gate names on GET `path`, or None when no such route is mounted."""
    for r in app.routes:
        if getattr(r, "path", None) == path and "GET" in (getattr(r, "methods", None) or set()):
            return _dep_names(r)
    return None


_LOCKED = {"require_paid", "require_admin", "require_flow_user", "require_flow_admin",
           "get_current_user", "get_current_user_with_plan"}


@pytest.mark.parametrize("rel", _RENDER_PAGES)
def test_a_headless_render_page_never_fetches_a_session_gated_endpoint(app, rel):
    fetched = _fetched_paths(rel)
    assert fetched, (
        f"{rel}: the fetch scraper found NO /api/ calls — the page was rewritten or "
        "the regex rotted. A probe that finds nothing passes vacuously "
        "(`lesson_test_that_passes_vacuously`); fix the scraper, do not delete this.")

    for path in sorted(fetched):
        gates = _gate_names_for(app, path)
        assert gates is not None, (
            f"{rel} fetches {path}, which is MOUNTED NOWHERE on the served app — "
            "it will 404 into the page's soft fallback and render blank.")
        locked = gates & _LOCKED
        assert not locked, (
            f"{rel} fetches {path}, which the served app gates behind "
            f"{sorted(locked)}. This page renders in a logged-OUT headless browser, "
            "so that fetch returns 401/402 and the panel silently renders EMPTY. "
            "Move the read to a token-gated /api/r/* door in render_panels.py.")


def test_the_probe_can_SEE_a_gate_it_is_looking_for(app):
    """Non-vacuity control.

    The test above passes when it finds no gates. That is also what it would do if
    `_dep_names` walked the tree wrong and returned an empty set for everything. So
    point it at a route KNOWN to be paid-gated and require that it reports the gate.
    """
    gates = _gate_names_for(app, "/api/breadth-monitor")
    assert gates is not None, "/api/breadth-monitor is not mounted — control is stale"
    assert "require_paid" in gates, (
        "the gate reader cannot see `require_paid` on a route that demonstrably has "
        f"it (reported: {sorted(gates)}) — every assertion above is vacuous")

    # …and that the door the render pages were moved TO is genuinely not session-gated.
    open_gates = _gate_names_for(app, "/api/r/breadth-monitor")
    assert open_gates is not None, "/api/r/breadth-monitor is not mounted"
    assert not (open_gates & _LOCKED), (
        f"/api/r/breadth-monitor picked up a session gate {sorted(open_gates & _LOCKED)} "
        "— the render pages are unreachable again")


def test_the_render_doors_still_refuse_a_caller_with_no_token(app, monkeypatch):
    """The /r/* doors are effectively public, NOT actually public.

    `_check_token` fails CLOSED when CHART_RENDER_TOKEN is unset, so this asserts
    the refusal with the token SET — otherwise it would pass for the wrong reason.
    """
    from fastapi.testclient import TestClient
    monkeypatch.setenv("CHART_RENDER_TOKEN", "rail-token")
    c = TestClient(app, raise_server_exceptions=False)

    for url in ("/api/r/breadth-monitor?days=10", "/api/r/breadth"):
        assert c.get(url).status_code == 403, f"{url} answered a caller with NO token"
        assert c.get(f"{url}&token=wrong" if "?" in url else f"{url}?token=wrong"
                     ).status_code == 403, f"{url} answered a caller with a WRONG token"
        ok = c.get(f"{url}&token=rail-token" if "?" in url else f"{url}?token=rail-token")
        assert ok.status_code == 200, (
            f"{url} refused the CORRECT token ({ok.status_code}) — the render pages "
            "cannot read it and the panels go blank")
