"""P1 truth matrix, slice "core" -- the SERVER half.

ONE definition -> TYPED OUTPUTS -> MANY SAFE CONSUMERS. The browser owns the
type authority (``outputType.js``) and the shared gate (``evaluability.js``);
the server's ALERT lane stays the authority for alerts (``alert_user_series``).
These cases hold the two together through shared fixtures, so neither lane can
take an output type or an evaluability answer from the other -- or from a
client -- and the two cannot drift.

Every case states ASKED / CLAIMED / DID and its outcome class.
"""
from __future__ import annotations

import json
import pathlib

import pytest

from api.services import alert_user_series as aus
from api.services import ast_interpret
from api.services import scan_definition

ROOT = pathlib.Path(__file__).resolve().parent
ALERT_FIXTURE = json.loads((ROOT / "fixtures" / "ast" / "p1_evaluability_alert.json").read_text("utf-8"))
TYPE_FIXTURE = json.loads((ROOT / "fixtures" / "ast" / "p1_output_types.json").read_text("utf-8"))


def server_alert_answer(definition: dict, plot_key: str) -> dict:
    """What the alert lane does for (definition, plot), WITHOUT bars, the store
    or the node proof: `_gate_lane`, then the per-plot half of admission
    (`plot_admissions`, C45's sibling rule included), in the order
    `admit_user_definition` runs them."""
    def_id = definition["id"]
    try:
        aus._gate_lane({"def_id": def_id, "definition": definition})
        _admissible, withheld = aus.plot_admissions(def_id, definition)
    except aus.AdmissionRefused as exc:
        return {"status": "refused", "gate": exc.gate, "message": str(exc)}
    refused = withheld.get(f"{def_id}.{plot_key}")
    if refused is not None:
        return {"status": "refused", "gate": refused.gate, "message": str(refused)}
    return {"status": "supported", "gate": None, "message": ""}


# ── item 10: sym unsupplied in the alert lane refuses; item 8: the shared gate
# and the server agree on every case of the shared fixture ──────────────────
@pytest.mark.parametrize("case", ALERT_FIXTURE["cases"], ids=lambda c: c["name"])
def test_P1_8_10_browser_gate_and_server_alert_lane_agree(case):
    """ASKED: arm an alert on the fixture's plot.
    CLAIMED (browser `evaluability(def, key, 'alert')`): `case.expect`.
    DID (server): `_gate_lane` + `plot_admissions` -- the same status, the same
    gate, and every code the browser names appears in the server's refusal.
    Class: REFUSAL / VALUE (EXACT agreement)."""
    got = server_alert_answer(case["definition"], case["plotKey"])
    want = case["expect"]
    assert got["status"] == want["status"], got
    assert got["gate"] == want["gate"], got
    for code in want["codes"]:
        assert code in got["message"], (code, got["message"])


def test_P1_10_sym_unsupplied_alert_is_refused_not_starved():
    """ASKED: alert on `close / sym('SPY', close)`.
    CLAIMED: refused at arm (`withheld`, `other-symbol:unsupplied`).
    DID: refused -- never admitted to answer "no number" forever. Class: REFUSAL."""
    case = next(c for c in ALERT_FIXTURE["cases"] if c["name"].startswith("sym SPY ratio"))
    got = server_alert_answer(case["definition"], case["plotKey"])
    assert got["status"] == "refused" and got["gate"] == "withheld"
    assert aus.UNSUPPLIED_OTHER_SYMBOL in got["message"]


def test_P1_8_fixture_is_not_vacuous():
    """The fixture must exercise both answers and every per-plot gate it claims."""
    statuses = {c["expect"]["status"] for c in ALERT_FIXTURE["cases"]}
    gates = {c["expect"]["gate"] for c in ALERT_FIXTURE["cases"]}
    assert statuses == {"supported", "refused"}
    assert {"scalar", "withheld", "plot", "lane"} <= gates


# ── item 20: the server derives the SAME output type from its OWN authorities ──
def server_tree_type(ast: dict) -> dict:
    """The server's reading of a tree's type: `scan_definition.is_boolean_tree`
    (the manifest `yields` resolver this lane already owns) and
    `ast_interpret.unresolved_scalars(tree, None)` (the current-only scalar walk
    the alert/scan doors already ask). No new authority."""
    yields = "bool" if scan_definition.is_boolean_tree(ast) else "num"
    scalars = sorted(ast_interpret.unresolved_scalars(ast, None))
    if scalars:
        kind = "scalar"
    else:
        kind = "condition" if yields == "bool" else "series"
    return {"type": kind, "yields": yields, "scalars": scalars}


@pytest.mark.parametrize("case", TYPE_FIXTURE["cases"], ids=lambda c: c["source"])
def test_P1_20_server_and_client_derive_the_same_type_from_the_tree(case):
    """ASKED: what type is this tree's output?
    CLAIMED (browser `outputType.js::treeOutputType`): `case.expect`.
    DID (server, from its own resolvers): the same type, yields and scalars.
    Neither lane reads a type from the other, so neither can forge one.
    Class: EXACT."""
    assert server_tree_type(case["ast"]) == case["expect"]


def test_P1_20_a_forged_type_field_changes_nothing_on_the_server():
    """ASKED: a client sends a definition whose plot claims `type: "condition"`
    (and an intent `signal`) over a NUMERIC tree, and arms an alert on it.
    CLAIMED: the type is derived from the tree; the claim is ignored.
    DID: the server reads only the tree -- the forged fields are inert -- and the
    tree types `series`. Class: EXACT (claim discarded)."""
    case = next(c for c in ALERT_FIXTURE["cases"] if c["name"].startswith("numeric rsi"))
    forged = json.loads(json.dumps(case["definition"]))
    forged["plots"][0]["type"] = "condition"
    forged["plots"][0]["intent"] = "signal"
    forged.setdefault("meta", {})["outputTypes"] = {"value": "condition"}
    assert server_alert_answer(forged, "value")["status"] == server_alert_answer(case["definition"], "value")["status"]
    assert server_tree_type(forged["compute"]["ast"])["type"] == "series"


def test_P1_11_server_scalar_never_reads_as_series():
    """ASKED: `sma(market_cap, 5)` -- a moving average of a current-only value.
    CLAIMED: SCALAR (no history), never SERIES.
    DID: typed scalar on the server too; the alert lane refuses it (`scalar`).
    Class: REFUSAL."""
    case = next(c for c in TYPE_FIXTURE["cases"] if c["source"] == "sma(market_cap, 5)")
    assert server_tree_type(case["ast"])["type"] == "scalar"
