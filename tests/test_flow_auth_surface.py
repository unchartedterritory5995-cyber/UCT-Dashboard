"""Every mutating route on the flow surface must carry an auth dependency.

WHY THIS EXISTS
---------------
This class of bug has now shipped to production twice:

  2026-07-06  all 8 POSTs on live_massive_router were unauthenticated and
              internet-reachable (force-push arbitrary Discord alerts, rewrite
              the Alpha-Gold thresholds, trigger heavy DB / paid-API work).
  2026-07-26  the auth-surface audit found four more that the first sweep
              missed, including POST /api/flow-reconcile/insert (arbitrary
              writes into the production flow.db) and GET
              /api/flow-reconcile/preview, whose caller-supplied `source_tag`
              was bound into an unbounded `SELECT * FROM flow WHERE source = ?`
              — `?source_tag=stocks` would fetchall() the entire ~1.45M-row
              tape on the pod that owns the single-slot OPRA websocket.

Both times the gap was invisible: the endpoints returned 200, nothing errored,
and no test covered "is this route reachable by a stranger". A read-only test
mandate never probes POSTs, so the surface needs its own explicit assertion.

This test reads the SOURCE rather than starting an app, so it cannot be fooled
by import-order or by a router that fails to mount. It is deliberately blunt:
if you add a mutating route, you must either gate it or add it to ALLOWED_OPEN
with a written reason.

⚠️ A gate on a PROXIED router (flow_proxy.PROXY_PREFIXES) is NOT enforced by a
web deploy — those requests bypass web and hit the FLOW-WORKER's own copy of the
router. Gating flow_reconcile requires `railway up -s flow-worker`. This test
passing means the code is right, NOT that production is protected.
"""
import ast
import pathlib

import pytest

API = pathlib.Path(__file__).resolve().parents[1] / "api"

# Routers whose mutating surface must be gated.
ROUTERS = [
    "flow_router.py",
    "flow_reconcile_router.py",
    "liveflow_router.py",
    "live_massive_router.py",
    "oi_snapshot_router.py",
    "flow_summary.py",
]

GUARDS = {
    "require_flow_admin",
    "require_flow_user",
    "require_admin",
    "get_current_user",
    "verify_push_secret",
}

MUTATING = {"post", "put", "delete", "patch"}

# Routes intentionally left open, each with the reason it is safe.
ALLOWED_OPEN: set[tuple[str, str]] = set()


def _decorator_paths(dec):
    """(methods, path) for a @router.<verb>(...) / @router.api_route(...)."""
    fn = dec.func
    if not isinstance(fn, ast.Attribute):
        return None
    verb = fn.attr
    path = None
    if dec.args and isinstance(dec.args[0], ast.Constant):
        path = dec.args[0].value
    if verb == "api_route":
        methods = set()
        for kw in dec.keywords:
            if kw.arg == "methods" and isinstance(kw.value, (ast.List, ast.Tuple)):
                methods = {
                    e.value.lower() for e in kw.value.elts
                    if isinstance(e, ast.Constant) and isinstance(e.value, str)
                }
        return methods, path
    return {verb}, path


def _has_guard(fnode, src_seg):
    """A guard in the signature defaults, or router-level dependencies."""
    return any(g in src_seg for g in GUARDS)


def _collect(path: pathlib.Path):
    """-> list of (path, methods, guarded) for every route in the file."""
    src = path.read_text(encoding="utf-8")
    tree = ast.parse(src)
    lines = src.split("\n")

    # A router built with dependencies=[Depends(require_...)] gates everything.
    router_level_guard = False
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "APIRouter":
            seg = ast.get_source_segment(src, node) or ""
            if any(g in seg for g in GUARDS):
                router_level_guard = True

    out = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            got = _decorator_paths(dec)
            if not got:
                continue
            methods, route = got
            if not methods:
                continue
            # signature source = the def line through the closing paren
            sig_end = node.body[0].lineno - 1 if node.body else node.lineno
            sig = "\n".join(lines[node.lineno - 1: sig_end])
            guarded = router_level_guard or _has_guard(node, sig)
            out.append((route, methods, guarded))
    return out


@pytest.mark.parametrize("fname", ROUTERS)
def test_every_mutating_route_is_gated(fname):
    path = API / fname
    if not path.exists():
        pytest.skip(f"{fname} not present")

    ungated = []
    for route, methods, guarded in _collect(path):
        if not (methods & MUTATING):
            continue
        if guarded:
            continue
        if (fname, route) in ALLOWED_OPEN:
            continue
        ungated.append(f"{sorted(methods)} {route}")

    assert not ungated, (
        f"{fname} has UNAUTHENTICATED mutating route(s): {ungated}\n"
        "Add Depends(require_flow_admin) (or require_flow_user for routes the "
        "normal member UI must call), or add it to ALLOWED_OPEN with a reason.\n"
        "If this router is in flow_proxy.PROXY_PREFIXES the fix also needs "
        "`railway up -s flow-worker` — a web push will NOT enforce it."
    )


def test_reconcile_preview_is_gated_and_bounded():
    """/preview binds a caller-supplied source_tag into a SELECT over `flow`.

    Ungated and unbounded it is a full dump of the paid dataset and an OOM of
    the pod that owns the OPRA websocket, so it needs BOTH a guard and a LIMIT.
    """
    src = (API / "flow_reconcile_router.py").read_text(encoding="utf-8")
    assert "require_flow_admin" in src, "/api/flow-reconcile is completely ungated"

    body = src[src.index("def reconcile_preview"):]
    body = body[: body.index("\n@") if "\n@" in body else len(body)]
    assert "_auth" in body, "reconcile_preview lost its auth dependency"
    assert body.count("LIMIT") >= 2, (
        "reconcile_preview must LIMIT both query branches — an unbounded "
        "fetchall() over `flow` loads the entire tape into memory"
    )


def test_clear_before_date_is_gated():
    """Its confirm token is not a secret — the error body discloses it, and the
    route accepts GET, so before the gate one URL could wipe alert history."""
    src = (API / "liveflow_router.py").read_text(encoding="utf-8")
    body = src[src.index("def admin_clear_before_date"):]
    body = body[: body.index("\n@") if "\n@" in body else len(body)]
    assert "require_flow_admin" in body, (
        "clear-before-date is destructive and GET-reachable; a confirm string "
        "that the endpoint itself prints is not access control"
    )
