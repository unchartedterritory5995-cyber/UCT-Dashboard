"""The site root must answer HEAD, not only GET.

Obsidian's plugin-directory review probes `manifest.json`'s `authorUrl`
(https://uctintelligence.com) for reachability and reported it as NOT
REACHABLE while that exact URL served HTTP 200 to every GET we tried. The
cause was the SPA catch-all being registered `@app.get(...)` only, so any
HEAD -- the method link checkers and uptime monitors reach for first --
got 405 Method Not Allowed from every page URL on the site.

This rail pins the METHOD SET on the catch-all rather than a status code
from a live request, so it fails the moment someone re-narrows the route
back to GET-only.
"""
from __future__ import annotations


def _spa_routes(app):
    """Every route whose path is the SPA catch-all."""
    return [r for r in app.routes if getattr(r, "path", None) == "/{full_path:path}"]


def test_the_spa_catch_all_answers_head_as_well_as_get():
    from api.main import app

    routes = _spa_routes(app)
    assert routes, "the SPA catch-all route is gone -- this rail is pointing at nothing"
    for r in routes:
        methods = set(r.methods or ())
        assert "GET" in methods, f"{r.path} no longer serves GET"
        # ⛔ THE POINT: a resource that answers GET must answer HEAD. Without
        # this, `curl -I https://uctintelligence.com` is a 405 and every
        # external reachability probe of the site reads as down.
        assert "HEAD" in methods, (
            f"{r.path} serves {sorted(methods)} -- a HEAD probe of any page URL "
            "will 405. Register the catch-all with methods=['GET', 'HEAD']."
        )


def test_head_on_the_root_is_not_a_405(monkeypatch, tmp_path):
    """The behaviour the method set is a proxy for, driven through the app."""
    from fastapi.testclient import TestClient
    from api.main import app

    with TestClient(app) as client:
        r = client.head("/")
        assert r.status_code != 405, (
            f"HEAD / returned 405; the SPA catch-all is GET-only again"
        )
        # A missing dist/index.html in CI yields 404, which is an environment
        # fact, not a routing regression -- 405 is the failure this pins.
        assert r.status_code in (200, 404), f"unexpected status {r.status_code}"
