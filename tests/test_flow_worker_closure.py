"""`api.main` must stay OUT of flow-worker's import closure.

⚰️ **WHAT THIS GUARDS, AND WHY A COMMENT WOULD NOT HAVE.**
`api/services/indicator_alert_evaluator.py` read one boolean with a lazy
`from api.main import rs_history_enabled`. That single line put the whole web app
inside flow-worker's closure: `tools/flow_worker_watch_coverage.py` measured
**1,654 files reachable against 24 watched** (the deploy-windows runbook says
154/133). Cutting it on 2026-11-15 took the closure to **985**.

Two things made it worth a rail rather than a fix-and-move-on:

1. It was INVISIBLE. Nothing failed, nothing slowed down that anyone noticed; the
   only symptom was a guard rail quietly losing its ability to discriminate.
2. It had already reclassified live code. The S7 `alert_taxonomy/price_level*`
   modules came in with `api.main`, and under GATE-S7-PRICE-LEVEL's CP3 ruling a
   reachable module is BEHAVIOUR-CHANGING — so a change to one needed a deploy
   window and a marker bump that nobody knew to give it. On this estate a
   flow-worker deploy inside market hours is how the live options tape is lost.

⭐ The same import can come back by ANY route, not just the one that was cut, so
this measures the closure rather than grepping for the old line.
"""
from __future__ import annotations

import ast
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools import flow_worker_watch_coverage as wc  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAF = "api/services/rs_history_flag.py"


@pytest.fixture(scope="module")
def reach():
    return wc.reachable_paths(ROOT)


def test_api_main_is_not_in_flow_workers_closure(reach):
    """The invariant. A module flow-worker reaches drags its whole graph in."""
    # NON-VACUITY FIRST: an empty or broken closure would pass every "not in"
    # below, and this rail would report coverage it never performed.
    assert "api/services/indicator_alert_evaluator.py" in reach, (
        "the closure does not contain a module known to be in it — this probe is "
        "broken, not green")

    assert "api/main.py" not in reach, (
        "api/main.py is BACK in flow-worker's import closure, and the whole web app "
        "comes with it (1,654 files vs 24 watched when this last happened).\n"
        "Find the edge:  python tools/flow_worker_watch_coverage.py\n"
        "Read a boolean from a leaf module, never from api.main — see "
        "api/services/rs_history_flag.py.")


def test_the_s7_price_level_modules_stay_out(reach):
    """They entered only via `api.main`; they are the visible cost of that edge.

    ⛔ Under GATE-S7-PRICE-LEVEL CP3, reachable means BEHAVIOUR-CHANGING: a change
    to one would need a deploy window and a marker bump. Letting them back in
    silently changes how a whole family of changes must be shipped.
    """
    for mod in ("price_level", "price_level_compare", "price_level_projection"):
        path = "api/services/alert_taxonomy/%s.py" % mod
        assert path not in reach, (
            "%s is reachable from flow-worker again — see "
            "tests/test_flow_worker_watch_coverage.py for what that reclassifies"
            % path)


def test_the_flag_module_is_a_leaf():
    """It must import nothing from `api`, or it stops being cheap to import.

    Parsed rather than imported: importing it to inspect it would prove nothing
    about what it COSTS to import.
    """
    tree = ast.parse(open(os.path.join(ROOT, LEAF), encoding="utf-8").read())
    offenders = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            offenders += [a.name for a in node.names if a.name.startswith("api")]
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.module.startswith("api"):
                offenders.append(node.module)
    assert not offenders, (
        "%s must stay a leaf — it grew an api import: %s. The whole point is that "
        "reading this boolean costs nothing." % (LEAF, offenders))


def test_api_main_still_re_exports_the_flag():
    """`api.main.rs_history_enabled` must keep resolving.

    Two readers still spell it that way and neither is in this change's blast
    radius: `api/routers/screener.py` imports it, and
    `api/services/screener/filters.py::_rs_history_on` reads it off `sys.modules`.
    Dropping the re-export would make the screener's switch read FALSE for ever,
    silently — the dark answer, which looks exactly like the flag being off.

    ⛔ Checked by parsing `api/main.py`, NOT by importing it: importing api.main
    builds the whole app, which is the cost this entire change exists to avoid.

    ⚰️ **THE `asname` CHECK IS THE WHOLE TEST, and it was missing on the first
    draft.** `from api.services.rs_history_flag import rs_history_enabled as _moved`
    leaves `a.name` exactly as it was while `api.main.rs_history_enabled` stops
    existing — so the first version of this test passed against a mutation that
    broke the very thing it guards. The bound NAME is what the readers resolve, not
    the imported one.
    """
    tree = ast.parse(open(os.path.join(ROOT, "api/main.py"), encoding="utf-8").read())
    bound = {
        (a.asname or a.name)
        for n in ast.walk(tree)
        if isinstance(n, ast.ImportFrom) and n.module == "api.services.rs_history_flag"
        for a in n.names
        if a.name == "rs_history_enabled"
    }
    assert "rs_history_enabled" in bound, (
        "api/main.py no longer binds the name `rs_history_enabled` from "
        "api.services.rs_history_flag (bound instead: %s).\n"
        "api.main.rs_history_enabled is what api/routers/screener.py imports and "
        "what filters.py's sys.modules read resolves against; without it the "
        "screener's switch reads FALSE for ever, which looks exactly like the flag "
        "being off." % (sorted(bound) or "nothing"))


@pytest.mark.parametrize("value,expected", [
    ("1", True),
    ("0", False),
    ("true", False),      # the `_wire_enabled` convention: only "1" arms it
    ("yes", False),
    ("", False),
    (None, False),        # unset
])
def test_the_flag_reads_exactly_as_it_did_in_api_main(monkeypatch, value, expected):
    """Moving the definition must not change a single answer."""
    from api.services.rs_history_flag import rs_history_enabled
    if value is None:
        monkeypatch.delenv("RS_HISTORY_ENABLED", raising=False)
    else:
        monkeypatch.setenv("RS_HISTORY_ENABLED", value)
    assert rs_history_enabled() is expected
