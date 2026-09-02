"""⛔⛔ A LIVE ACCUMULATOR CANNOT ANSWER A DAILY SWEEP, AND THE TREE SAYS SO.

Before this gate existed, the corpus fixture ``17-above-vwap`` translated
cleanly, passed every gate in ``assert_scannable``, was offered to members under
My Scans, and then — measured on the real 3,742-symbol universe against the real
bars store::

    17-above-vwap   answered=0  dropped=986  not_computable=2756  hits=0  21.9s
    drop detail: {'reason': 'not-computable', 'detail': 'no value for vwap'}

on every evaluable symbol, while the other 33 scripts in the same run answered
2,669–2,756 each. Every night, forever, ~22 seconds spent on a formula that was
decidably empty from the tree alone.

⭐ "Above VWAP" is one of the most common screens anyone writes, so the failure
was not exotic — it was the ordinary case, answered with an honest but
unactionable receipt a night later.

⛔ THE REASON IS THE MANIFEST'S OWN. ``vwap`` and ``avwap`` declare
``cadence: "live"`` and ``lookback: "session"``; the sweep runs ``DEFAULT_TF =
"D"``, and one daily bar has no session inside it to accumulate over.

⚠️ AND IT IS A SCAN-TIME PROPERTY, NOT A TRANSLATE-TIME ONE. ``ta.vwap`` remains
a perfectly good column on an intraday chart; refusing it in the Pine door would
take a working chart indicator away in order to fix a screen.
"""

import json
import pathlib

import pytest

from api.services import ast_table
from api.services import scan_definition as sd

ROOT = pathlib.Path(__file__).resolve().parents[1]
COLUMNS = ROOT / "tests" / "fixtures" / "ast" / "screener_columns.json"


def _definition(ast, source="x"):
    d = {"compute": {"kind": "ast", "ast": ast, "source": source}}
    d["compute"]["fn"] = sd.def_hash(d)
    return d


def _tree(name):
    """``<name>(...) > 0`` — the smallest WELL-FORMED tree that reads one function.

    ⚠️ THE ARGUMENTS COME FROM THE MANIFEST, not from a guess. A bare ``avwap()``
    refuses at the earlier arity gate and never reaches the one under test — the
    first draft of this file did exactly that and reported a false pass for
    ``vwap`` alongside a failure that was about the fixture, not the gate.
    """
    spec = ast_table.load_manifest()["functions"][name]
    args = []
    for kind in (spec.get("args") or []):
        args.append({"type": "series", "name": "close"} if kind == "series"
                    else {"type": "num", "value": 20260101})
    return {"type": "op", "name": ">", "args": [
        {"type": "call", "name": name, "args": args},
        {"type": "num", "value": 0},
    ]}


def test_the_live_set_is_derived_from_the_manifest_not_typed():
    """⭐ A HAND-LIST HERE WOULD BE A SECOND AUTHORITY over a declaration that
    sits beside the thing it describes. This recomputes the set straight from the
    manifest and requires the accessor to agree, so a third live function starts
    refusing the day it is DECLARED rather than the day someone remembers it.
    """
    manifest = ast_table.load_manifest()
    expected = {
        name for name, spec in manifest["functions"].items()
        if spec.get("cadence") == "live"
    }
    assert ast_table.live_cadence_functions() == expected
    # ⛔ NON-VACUITY: the set is not empty, and it is not everything.
    assert expected, "no function declares cadence 'live' — this gate guards nothing"
    assert len(expected) < len(manifest["functions"])


@pytest.mark.parametrize("name", sorted(ast_table.live_cadence_functions()))
def test_every_live_cadence_function_is_refused_by_name(name):
    """Both members of the set, not just the one that was measured."""
    with pytest.raises(sd.ScanRefused) as excinfo:
        sd.assert_scannable(_definition(_tree(name)))
    message = str(excinfo.value)
    assert "[gate:cadence]" in message
    assert name in message
    # ⭐ AND IT SAYS WHAT STILL WORKS. A refusal that only closes a door leaves a
    # member with nothing to do; this one names where the column is still right.
    assert "intraday" in message


def test_an_ordinary_tree_is_untouched():
    """⛔ NON-VACUITY. Without this, a gate that refused everything would satisfy
    every assertion above."""
    tree = {"type": "op", "name": ">", "args": [
        {"type": "series", "name": "close"},
        {"type": "call", "name": "sma", "args": [
            {"type": "series", "name": "close"}, {"type": "num", "value": 20}]},
    ]}
    out = sd.assert_scannable(_definition(tree, "close > sma(close, 20)"))
    assert out["yields"] == "bool"


def test_the_gate_is_measured_against_the_real_screener_corpus():
    """⭐⭐ THE WHOLE MEMBER CORPUS, THROUGH THE SHIPPED DOOR.

    ``tests/fixtures/ast/screener_columns.json`` is generated from the ``.pine``
    fixtures and re-derived on every frontend run, so this cannot drift into
    asserting something about formulas the doors stopped producing.

    ⛔ THE EXPECTATION IS A ROSTER, NOT A COUNT: exactly the vwap script is
    refused, and it is refused by THIS gate. A count would stay green if one
    script started failing while another was fixed.
    """
    cases = json.loads(COLUMNS.read_text(encoding="utf-8"))["cases"]
    assert len(cases) >= 36, "the generated fixture shrank; this would prove little"

    refused = {}
    for case in cases:
        definition = _definition(case["ast"], case["source"])
        try:
            sd.assert_scannable(definition)
        except sd.ScanRefused as exc:
            refused[case["id"]] = str(exc)

    assert sorted(refused) == ["17-above-vwap"], (
        "the cadence gate refuses a different set than expected: "
        + ", ".join(sorted(refused))
    )
    assert "[gate:cadence]" in refused["17-above-vwap"]
