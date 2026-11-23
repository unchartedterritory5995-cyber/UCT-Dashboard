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


def _declared_method_sets():
    """The method set api/main.py DECLARES on the catch-all, read from its source.

    The route is registered inside `if os.path.exists(DIST):`, and no test job builds the front end, so on a checkout
    without app/dist `app.routes` holds no catch-all at all: the live check below then had nothing to read and this
    rail was red for the build state, not for the method set (nightly full suite, run 45066472928)."""
    import ast
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    out = []
    for fn in ast.walk(ast.parse(src)):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for d in fn.decorator_list:
            if not (isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.args
                    and isinstance(d.args[0], ast.Constant) and d.args[0].value == "/{full_path:path}"):
                continue
            if d.func.attr == "api_route":
                kw = {k.arg: k.value for k in d.keywords}
                out.append(set(ast.literal_eval(kw["methods"])) if "methods" in kw else {"GET"})
            else:
                out.append({d.func.attr.upper()})          # @app.get(...) serves GET only
    return out


def test_the_spa_catch_all_answers_head_as_well_as_get():
    declared = _declared_method_sets()
    assert declared, "the SPA catch-all route is gone -- this rail is pointing at nothing"
    for methods in declared:
        assert "GET" in methods, "/{full_path:path} is no longer declared to serve GET"
        assert "HEAD" in methods, (
            f"/{{full_path:path}} is declared with {sorted(methods)} -- a HEAD probe of any page URL "
            "will 405. Register the catch-all with methods=['GET', 'HEAD']."
        )

    from api.main import app

    for r in _spa_routes(app):              # registered only where app/dist exists: the live half, when it can run
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
