"""Bullflow is retired. The web pod must not dial it.

"live flow is from massive, bullflow is no more" — owner, 2026-07-27.

Two rails that reach the same rail differently, DEAD vs LIVE:

    DEAD:  Bullflow SSE → liveflow_worker → /api/live/alerts/recent → LiveFlow.jsx
    LIVE:  Massive WS  → massive_ws_worker → FlowDB → /api/live/massive/recent
                                                    → LiveFlowMassive.jsx

Left running, the dead one dialled a retired endpoint every 30 seconds forever on
the single process that serves every member, logging `403 API subscription
inactive`. It was read as a lapsed subscription at least twice — the log line
says "subscription", so that is the story it tells — which is precisely why the
decision needs a test rather than a comment.

⛔ NOT gated on `BULLFLOW_API_KEY` being unset. That works (`run_forever`
early-returns without a key) but it makes a retired integration's silence depend
on a Railway variable STAYING absent, which is not a decision anyone can read in
the code, and not something this test could check.
"""
from __future__ import annotations

import ast
import pathlib

REPO = pathlib.Path(__file__).resolve().parents[1]
MAIN = REPO / "api" / "main.py"


def _main_src() -> str:
    return MAIN.read_text(encoding="utf-8")


def test_the_web_pod_does_not_start_the_bullflow_worker():
    """The load-bearing assertion: no call to liveflow_worker_threaded.start()."""
    tree = ast.parse(_main_src())
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "start"
                and isinstance(node.func.value, ast.Name)
                and "liveflow_worker" in node.func.value.id):
            raise AssertionError(
                "api/main.py starts the Bullflow worker again (line "
                f"{getattr(node, 'lineno', '?')}). Bullflow is retired — it dials "
                "a dead endpoint every 30s on the member-serving pod. Live flow "
                "comes from the Massive rail."
            )


def test_the_probe_can_see_a_start_call_at_all():
    """Non-vacuity control.

    The test above asserts an ABSENCE by walking for a shape. If that walk were
    broken it would pass forever. Prove the same matcher finds a real
    `<something>.start()` call elsewhere in the same file.
    """
    tree = ast.parse(_main_src())
    found = [
        n for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
        and n.func.attr == "start" and isinstance(n.func.value, ast.Name)
    ]
    assert found, (
        "the AST probe found NO `<name>.start()` calls in api/main.py — it is "
        "not discriminating, so the assertion above proves nothing"
    )


def test_the_retirement_says_why_not_just_that_it_is_off():
    """A silent deletion invites a well-meaning re-enable.

    The next person to see `/api/live/alerts/*` mounted with no worker feeding it
    should find the reason at the site, not have to reconstruct it from a log
    line that says "subscription".
    """
    src = _main_src()
    assert "bullflow is no more" in src.lower() or "Bullflow) NOT started" in src, (
        "the retirement is not explained at the startup site"
    )


def test_the_worker_module_is_kept_for_rollback():
    """Stop calling it, delete later — the trades.py retirement idiom.

    Removing the module, its threaded wrapper and the /api/live/alerts/* routes
    is flow-family work to coordinate with the partner, not a unilateral
    deletion. So the files must still be here.
    """
    assert (REPO / "api" / "liveflow_worker.py").exists()
    assert (REPO / "api" / "liveflow_worker_threaded.py").exists()


def test_the_shutdown_hook_tolerates_a_worker_that_never_started():
    """It stops what it started — and it started nothing.

    The hook resolves `stop` defensively via getattr, so a never-started worker
    is a no-op rather than an AttributeError during lifespan shutdown. Pinning it
    because a shutdown-path exception is exactly the kind that only shows up on a
    deploy, when nobody is watching the logs.
    """
    src = _main_src()
    assert 'getattr(_lf_threaded, "stop", None)' in src, (
        "the shutdown hook no longer resolves stop defensively; a retired worker "
        "could raise during shutdown"
    )
