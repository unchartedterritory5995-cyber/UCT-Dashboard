"""COND-TA (coordinator ruling 2026-11-15): THE PINE-IMPORT HOLD, server half.

A Pine import saved by the Builder's Apply door is a FORMULA document with no script
(`pine_source`) and, before COND-TA, no engine stamp. The translator that wrote those formulas
served a `ta.*` call that runs only on some bars as its every-bar number (and #1326's block-local
`x[1]` the same way); which saved formulas hold that shape cannot be told without the script. So
such a row applied before `PINE_IMPORT_FIX_ENGINE` is withheld by name on every server lane
(`user_definitions.engine_withheld_reason`, the one question alerts, the sweep, on-demand runs,
backtests and the scannable stamp ask), and the chart holds it too
(`scriptEngineVersion.js::pineImportHeld`, railed by `pineImportHold.test.js`). Re-applying the
import stamps `importedFrom.engine` and lifts it. A formula that is not a Pine import is untouched.
"""
from __future__ import annotations

import copy
import re
from pathlib import Path

import pytest

from api.services import user_definitions as svc

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "app" / "src" / "components" / "chart" / "engine" / "scriptEngineVersion.js"

S = lambda name: {"type": "series", "name": name}  # noqa: E731
CALL = lambda name, *a: {"type": "call", "name": name, "args": [{"value": x} for x in a]}  # noqa: E731
OP = lambda name, *a: {"type": "op", "name": name, "args": list(a)}  # noqa: E731
NUM = lambda v: {"type": "num", "value": v}  # noqa: E731
NA = OP("/", NUM(0), NUM(0))
UP = OP(">", S("close"), S("open"))
#: what the old screener lane printed for `if close > open` / `v := ta.sma(close, 3)`: a CANDIDATE
BLOCK_SMA = OP("?:", UP, CALL("sma", S("close"), NUM(3)), NA)
#: #1326's block-local `x[1]`: an offset under a `?:` arm
ARM_OFFSET = OP("?:", UP, {"type": "offset", "value": 1, "args": [OP("*", S("close"), NUM(2))]}, NA)
#: v4 `iff(c, sma(…), close)`
IFF_CALL = CALL("iff", UP, CALL("sma", S("close"), NUM(3)), S("close"))
#: NOT candidates: no conditional at all, a call in the TEST only, an offset outside any arm
PLAIN = OP("-", CALL("sma", S("close"), NUM(3)), {"type": "offset", "value": 1, "args": [S("close")]})
CALL_IN_TEST = OP("?:", OP(">", CALL("rsi", S("close"), NUM(14)), NUM(50)), S("close"), S("open"))
ARMS_PLAIN = OP("?:", UP, S("high"), S("low"))
#: an offset under an `iff` arm is not the ruling's shape (only a call is)
IFF_OFFSET = CALL("iff", UP, {"type": "offset", "value": 1, "args": [S("close")]}, S("close"))

FORMULA = {"id": "u_imported", "compute": {"kind": "ast", "ast": BLOCK_SMA}, "meta": {"name": "imported"}}


def row(importedFrom=None, pine_source=None, engine_status=None, ast=None, trees=None):
    d = copy.deepcopy(FORMULA)
    if ast is not None:
        d["compute"]["ast"] = ast
    if trees is not None:
        d["compute"]["trees"] = trees
    if importedFrom is not None:
        d["meta"]["importedFrom"] = importedFrom
    r = {"def_id": "u_imported", "definition": d}
    if pine_source is not None:
        r["pine_source"] = pine_source
    if engine_status is not None:
        r["engine_status"] = engine_status
    return r


OLD = {"dialect": "pine", "via": "apply", "sourceLength": 40, "sourceFingerprint": "fnv1a:0123456789abcdef"}
SENTENCE = "This script was imported from Pine before a calculation fix. Re-apply the import to update it."


def test_the_fix_engine_is_the_browsers_declaration_and_the_sentence_is_its_word_for_word():
    text = JS.read_text(encoding="utf-8")
    assert svc.PINE_IMPORT_FIX_ENGINE == int(re.search(r"^export const PINE_IMPORT_FIX_ENGINE = (\d+)$", text, re.M).group(1))
    assert svc.PINE_IMPORT_FIX_ENGINE <= svc.SCRIPT_ENGINE_VERSION
    assert svc.PINE_IMPORT_HELD_SENTENCE == SENTENCE
    js = re.search(r"PINE_IMPORT_HELD_SENTENCE = '([^']*)'\s*\+\s*'([^']*)'", text)
    assert js and js.group(1) + js.group(2) == SENTENCE
    # the fix engine is the engine whose history line is COND-TA's (renumbered together)
    assert re.search(rf"/\*\* {svc.PINE_IMPORT_FIX_ENGINE} = COND-TA", text)


def test_an_old_pine_import_with_no_script_is_HELD_by_name():
    why = svc.engine_withheld_reason(row(OLD))
    assert why == f"engine-refused: {SENTENCE}"
    # an import stamped by an OLDER engine is held too
    assert svc.engine_withheld_reason(row(dict(OLD, engine=svc.PINE_IMPORT_FIX_ENGINE - 1)))


def test_a_RE_APPLIED_import_is_served():
    assert svc.engine_withheld_reason(row(dict(OLD, engine=svc.PINE_IMPORT_FIX_ENGINE))) is None
    assert svc.engine_withheld_reason(row(dict(OLD, engine=svc.PINE_IMPORT_FIX_ENGINE + 3))) is None


@pytest.mark.parametrize("r", [
    row(None),                                                   # a native formula
    row({"dialect": "thinkscript", "via": "apply"}),             # another dialect
    row(OLD, pine_source="//@version=6\nindicator('x')\nplot(close)"),   # it holds its script
])
def test_what_is_UNTOUCHED(r):
    assert svc.engine_withheld_reason(r) is None
    assert svc.pine_import_stale(r) is False


@pytest.mark.parametrize("tree", [BLOCK_SMA, ARM_OFFSET, IFF_CALL])
def test_NARROWED_a_structural_candidate_is_held(tree):
    assert svc.conditional_history_candidate({"compute": {"ast": tree}}) is True
    assert svc.engine_withheld_reason(row(OLD, ast=tree))


@pytest.mark.parametrize("tree", [PLAIN, CALL_IN_TEST, ARMS_PLAIN, IFF_OFFSET])
def test_NARROWED_a_pine_import_with_no_conditional_history_is_SERVED(tree):
    assert svc.conditional_history_candidate({"compute": {"ast": tree}}) is False
    assert svc.engine_withheld_reason(row(OLD, ast=tree)) is None


def test_NARROWED_every_plot_tree_is_read_not_only_the_scan_plot():
    assert svc.engine_withheld_reason(row(OLD, ast=PLAIN, trees={"value": PLAIN, "out2": BLOCK_SMA}))
    assert svc.engine_withheld_reason(row(OLD, ast=PLAIN, trees={"value": PLAIN, "out2": ARMS_PLAIN})) is None


def test_NARROWED_a_tree_too_deep_to_read_fails_closed():
    deep = S("close")
    for _ in range(600):
        deep = OP("-", deep, NUM(1))
    assert svc.conditional_history_candidate({"compute": {"ast": deep}}) is True


def test_a_pine_v1_import_is_served_a_v1_arm_is_eager_and_no_door_stamp_stays_held():
    assert svc.engine_withheld_reason(row(OLD))
    for v in (None, 1):
        r = row(OLD)
        r["definition"]["meta"]["pineVersion"] = v
        assert svc.engine_withheld_reason(r) is None, v
    r = row(OLD)
    r["definition"]["meta"]["pineVersion"] = 4
    assert svc.engine_withheld_reason(r)


def test_an_engine_flag_that_is_not_an_integer_never_lifts_it():
    for bad in ("55", 55.0, True, None):
        assert svc.engine_withheld_reason(row(dict(OLD, engine=bad))), bad


def test_an_unreadable_fix_engine_FAILS_CLOSED(tmp_path):
    p = tmp_path / "scriptEngineVersion.js"
    p.write_text("export const SCRIPT_ENGINE_VERSION = 55\n", encoding="utf-8")
    assert svc.read_pine_import_fix_engine(p) is None
    assert svc.pine_import_stale(row(dict(OLD, engine=99)), fix_engine=None) is True


def test_a_recorded_refusal_still_wins_with_its_own_sentence():
    st = {"status": "refused", "engine": svc.SCRIPT_ENGINE_VERSION, "reason": "pine:block — x"}
    assert "pine:block — x" in svc.engine_withheld_reason(row(OLD, engine_status=st))


def test_the_server_lanes_hold_it_alerts_and_the_scannable_stamp():
    from api.services import alert_user_series as aus
    with pytest.raises(aus.AdmissionRefused) as exc:
        aus._gate_engine(row(OLD), "u_imported")
    assert SENTENCE in str(exc.value)
    aus._gate_engine(row(dict(OLD, engine=svc.PINE_IMPORT_FIX_ENGINE)), "u_imported")   # served: no raise
    from api.routers import user_definitions as router_mod
    out = router_mod._stamped(dict(row(OLD), requirements="[]"))
    assert out["scannable"] is False and out["scan_refusal"] == {"gate": "withheld", "detail": f"engine-refused: {SENTENCE}"}
