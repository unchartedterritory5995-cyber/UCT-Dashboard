"""U-DAILY part B (train e96): the capability `request-daily-expression` is admitted by the registry's rule, and the
browser's twin answers every row the way the server's function does.

The ONE authority is `api/services/rollout_gate.py::pine_capability_admission`. The run lane asks a JavaScript twin
(`app/src/components/chart/engine/dailyExpressionGate.js`), since the browser cannot import the server. The rows in
`tests/fixtures/ast/daily_expression_admission_cases.json` are written to pass and to fail the rule. This file holds
the server's function to each row's `admitted`. `dailyExpressionAbove.test.js` holds the twin to the same rows, so a
drift in either lane is red.
"""
import copy
import hashlib
import json
import os

from api.services import rollout_gate, user_definitions

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES = os.path.join(REPO, "tests", "fixtures", "ast", "daily_expression_admission_cases.json")
WITNESS = os.path.join(REPO, "app", "src", "components", "chart", "engine", "dailyExpressionWitness.json")
PROBE_SHA = "2cb53948cc329196f03eba247ee76a930d1f0a384da18f9def447e34c9ae173a"


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _with_engine(row):
    row = copy.deepcopy(row)
    for e in row.get("evidence") or []:
        if e.get("scriptEngineVersion") == "CURRENT":
            e["scriptEngineVersion"] = user_definitions.SCRIPT_ENGINE_VERSION
    return row


def test_every_case_is_answered_by_the_registrys_own_function_as_written():
    doc = _load(CASES)
    name = doc["capability"]
    assert name == "request-daily-expression"
    assert len(doc["cases"]) >= 8
    assert {c["admitted"] for c in doc["cases"]} == {True, False}, "rows written to pass AND to fail"
    for c in doc["cases"]:
        reasons = rollout_gate.pine_capability_admission(name, _with_engine(c["row"]))
        assert (reasons == []) is c["admitted"], (c["name"], reasons)


def test_control_a_case_flipped_is_red():
    # the rail can fail: the passing row with its community script turned into a probe is not admitted
    doc = _load(CASES)
    ok = next(c for c in doc["cases"] if c["admitted"] is True and "ledger" not in json.dumps(c["row"]))
    row = _with_engine(ok["row"])
    assert rollout_gate.pine_capability_admission(doc["capability"], row) == []
    for e in row["evidence"]:
        e["community"] = False
    assert rollout_gate.pine_capability_admission(doc["capability"], row) != []


def test_the_committed_witness_row_is_not_admitted_and_pins_the_rigs_probe():
    row = _load(WITNESS)
    assert row["capability"] == "request-daily-expression"
    assert row["admitted"] is False
    reasons = rollout_gate.pine_capability_admission(row["capability"], row)
    assert reasons, "the committed row must not admit the capability"
    assert row["queueRow"] == "Q-DAILY-1"
    assert row["probeSha256"] == PROBE_SHA
    with open(os.path.join(REPO, row["probe"]), "rb") as f:
        body = f.read()
    assert b"\r" not in body, "the probe is committed with LF line endings"
    assert hashlib.sha256(body).hexdigest() == PROBE_SHA, "the probe must hash as the rig pinned it"
