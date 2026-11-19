"""``tools/door_browser_sweep.py``: the measure-only sweep of the door against the browser.

It is NOT a gate and asserts nothing about the tallies: they move whenever the door or the browser
learns a rule, which is the point of re-running it. What is pinned here is that the instrument can
be trusted: it sweeps every operation the patch contract defines (a new operation cannot be left
out silently), every patch it sends is one the contract allows (so a refusal is a rule, never a
malformed patch), and a short run through the real door and the shipped browser modules finishes
and can see all three verdicts' ingredients.
"""
from __future__ import annotations

import io
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import door_browser_sweep as sweep  # noqa: E402

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="node not on PATH")
SCHEMA = ROOT / "app" / "src" / "components" / "chart" / "builder" / "authoring" / "patchSchema.json"


def _contract_ops():
    defs = json.loads(io.open(SCHEMA, encoding="utf-8").read())["$defs"]
    return {v["properties"]["op"]["const"] for k, v in defs.items()
            if k.startswith("op_") and "const" in v.get("properties", {}).get("op", {})}


def test_every_operation_of_the_contract_is_swept():
    swept = {o["op"] for o in sweep.follow_ops().values()} | {b["op"] for b in sweep.BASES.values()}
    contract = _contract_ops()
    assert contract, "the contract's operations were not found: this test would pass on nothing"
    assert swept == contract, {"not swept": sorted(contract - swept), "not in the contract": sorted(swept - contract)}


def test_every_patch_it_sends_is_one_the_contract_allows():
    from api.services import definition_conversation as conv
    validator = Draft202012Validator(conv.composed_schema())
    ops = sweep.follow_ops()
    bad = {}
    for base_name, base in sweep.BASES.items():
        for name, op in ops.items():
            errors = [e.message[:120] for e in validator.iter_errors(sweep.env(0, [base, op]))]
            if errors:
                bad[f"{base_name}+{name}"] = errors[:2]
    assert not bad, dict(list(bad.items())[:6])
    assert set(sweep.PAIR_OPS) <= set(ops) and set(sweep.PAIR_BASES) <= set(sweep.BASES)


def test_one_browser_rule_is_one_line_whatever_the_output_is_called():
    a = sweep.sentence('refused: paint:refused: EMA 10: A signal colour reads a yes/no. Nothing on the chart changed.')
    b = sweep.sentence('refused: paint:refused: RSI 14: A signal colour reads a yes/no. Nothing on the chart changed.')
    assert a == b == "paint:refused: X: A signal colour reads a yes/no."
    assert sweep.sentence('refused: output:unknown: There is no output "b".') == "output:unknown: There is no output X."


def test_a_patch_that_reads_another_symbol_is_sent_with_words_that_name_it():
    assert sweep.words_for([sweep.BASES["sym"]]) == sweep.WORDS_NAMING and "SPY" in sweep.WORDS_NAMING
    assert sweep.words_for([sweep.BASES["line"]]) == sweep.WORDS and "SPY" not in sweep.WORDS


@needs_node
def test_a_short_sweep_runs_through_the_real_door_and_the_shipped_browser(tmp_path):
    rows_path = tmp_path / "rows.jsonl"
    proc = subprocess.run([sys.executable, str(ROOT / "tools" / "door_browser_sweep.py"), "--limit", "60",
                           "--out", str(rows_path)], capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=600, cwd=str(ROOT))
    assert proc.returncode == 0, proc.stdout[-2000:] + proc.stderr[-2000:]
    last = [line for line in proc.stdout.splitlines() if line.strip()][-1]
    assert last.startswith("SWEEP DONE 60 "), last
    tally = json.loads(last[len("SWEEP DONE 60 "):])
    rows = [json.loads(line) for line in io.open(rows_path, encoding="utf-8")]
    assert len(rows) == 60 and sum(tally.values()) == 60
    assert {r["verdict"] for r in rows} <= {"agree", "ACCEPT-THEN-REFUSE", "DOOR-STRICTER"}, {r["verdict"] for r in rows}
    # the instrument can see both halves: something both accept, and something the browser answers
    # in its own words (were the door refusing everything, or the browser accepting everything,
    # every row would read the same and the sweep would measure nothing)
    assert any(r["verdict"] == "agree" and r.get("browser") == "applied" for r in rows)
    assert any(str(r.get("browser", "")).startswith("refused: ") and ":" in r["browser"][9:] for r in rows)
    assert not any("cost:" in str(r.get("door", "")) or "model:" in str(r.get("door", "")) for r in rows), \
        "the sweep ran into a cap or the scripted model, so it compared nothing"


class _FakeLane:
    """Answers the lane's commands from a script: what the browser does with each door answer."""

    def __init__(self, model_answers):
        self.model_answers = list(model_answers)

    def call(self, cmd, **kw):
        if cmd == "body":
            return {"body": {"message": kw["words"], "view": {"revision": 0}}}
        if cmd == "model":
            return self.model_answers.pop(0)
        return {}


class _FakeRun:
    def __init__(self, server):
        self.client = self
        self.conv = self
        self.server = server

    def arm(self, _answers):
        pass

    def converse(self, *_a, **_kw):
        return dict(self.server)


ACCEPTED = {"ok": True, "disposition": "change", "envelope": {"ops": []}}
REFUSED_AT_THE_DOOR = {"ok": False, "gate": "envelope:reference", "reason": "names a part that does not exist"}
ASKS_AGAIN = {"needsServer": {"browser_refusal": {"errors": ["paint:refused: a colour reads a yes/no"]}}}
OLD_REFUSAL = {"changed": False, "entries": [{"lines": ["A colour reads a yes/no.", "Nothing on the chart changed."]}]}


@pytest.mark.parametrize("server, browser, verdict, said", [
    (ACCEPTED, [{"changed": True}], "agree", "applied"),
    (ACCEPTED, [ASKS_AGAIN], "ACCEPT-THEN-REFUSE", "refused: paint:refused: a colour reads a yes/no"),
    (ACCEPTED, [OLD_REFUSAL], "ACCEPT-THEN-REFUSE", "refused: A colour reads a yes/no. Nothing on the chart changed."),
    # the door refused: the first browser answer is to that refusal (nothing to apply); the second is
    # the browser ALONE, given the patch the door refused
    (REFUSED_AT_THE_DOOR, [{"changed": False}, {"changed": True}], "DOOR-STRICTER", "applied"),
    (REFUSED_AT_THE_DOOR, [{"changed": False}, ASKS_AGAIN], "agree", "refused: paint:refused: a colour reads a yes/no"),
])
def test_the_four_verdicts(server, browser, verdict, said):
    row = sweep.one(_FakeRun(server), _FakeLane(browser), "line", ("marker:a",), sweep.follow_ops(), "create")
    assert row["verdict"] == verdict and row["browser"] == said
    assert row["door"] == ("accept" if server["ok"] else "refuse envelope:reference")
