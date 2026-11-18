"""The headless export runs under a BARE `node` on the web pod (Studio R6: the server computes a
definition's work itself and never trusts a client's number).

`tools/headless_work.mjs` reads one JSON request on stdin and writes `computeHeadless`'s answer on
stdout, importing the SHIPPED engine source through `tools/headless_work_hooks.mjs` (the JSON-import
hook `tools/ast_conformance.py` uses on web, plus extensionless relative imports). The web image
(`Dockerfile.web`) carries the node binary, the source tree and, of node_modules, ONLY `jsep`; these
rails reproduce that layout and run the driver in it:
  1. the driver's import closure needs no npm package but `jsep`, and the runtime stage copies it;
  2. in a directory holding only that closure, the driver fails without `jsep` (the control) and answers
     with it: a definition's lane and work, the same twice, and its lane's ceiling;
  3. a refusal is an answer, by name; a lane with no work counter and a bad request are not;
  4. both lanes' ceilings are read from their declaring modules, never retyped.
"""
from __future__ import annotations

import json
import pathlib
import re
import shutil
import subprocess

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
APP = ROOT / "app"
ENGINE = APP / "src" / "components" / "chart" / "engine"
DRIVER = ("tools/headless_work.mjs", "tools/headless_work_hooks.mjs")
HOUSE = APP / "src" / "components" / "chart" / "house" / "houseIndicators.json"
WEB_DOCKERFILE = ROOT / "Dockerfile.web"

NODE = shutil.which("node")
needs_node = pytest.mark.skipif(NODE is None, reason="node not on PATH")


def _closure() -> dict:
    """The driver's import closure, walked by the server bundle's own walker."""
    script = ("import { walk } from './tools/pine_runtime_closure.mjs'\n"
              f"const w = walk({json.dumps(list(DRIVER))})\n"
              "process.stdout.write(JSON.stringify({ modules: [...w.modules.keys()], json: [...w.json],"
              " bare: [...w.bare.keys()], unresolved: w.unresolved }))\n")
    r = subprocess.run([NODE, "--input-type=module", "-"], input=script, cwd=ROOT, capture_output=True,
                       text=True, encoding="utf-8", timeout=120)
    assert r.returncode == 0, r.stderr[-800:]
    return json.loads(r.stdout)


def _house(slug: str) -> dict:
    doc = json.loads(HOUSE.read_text(encoding="utf-8"))
    return next(i["definition"] for i in doc["indicators"] if i["slug"] == slug)


def _run(cwd: pathlib.Path, request) -> tuple[int, dict]:
    payload = request if isinstance(request, str) else json.dumps(request)
    r = subprocess.run([NODE, str(cwd / DRIVER[0])], input=payload, cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=300)
    try:
        return r.returncode, json.loads(r.stdout)
    except json.JSONDecodeError:
        return r.returncode, {"stdout": r.stdout[-500:], "stderr": r.stderr[-1500:]}


@needs_node
def test_the_driver_closure_needs_only_jsep_and_the_web_image_copies_it():
    c = _closure()
    assert not c["unresolved"], c["unresolved"]
    assert "app/src/components/chart/engine/headlessCompute.js" in c["modules"]
    assert "app/src/components/chart/engine/ast/interpret.js" in c["modules"]
    packages = {b for b in c["bare"] if not b.startswith("node:")}
    assert packages == {"jsep"}, packages
    copy = "COPY --from=frontend /src/app/node_modules/jsep /app/app/node_modules/jsep"
    assert copy in WEB_DOCKERFILE.read_text(encoding="utf-8")


@needs_node
def test_the_driver_answers_under_bare_node_in_the_web_image_layout(tmp_path):
    c = _closure()
    for rel in c["modules"] + c["json"]:
        dst = tmp_path / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, dst)
    request = {"definition": _house("atr_extension"), "reference": True, "values": False}

    code, before = _run(tmp_path, request)
    assert code != 0 and "ERR_MODULE_NOT_FOUND" in before.get("stderr", ""), before  # the control: no jsep

    jsep = APP / "node_modules" / "jsep"
    if not jsep.is_dir():
        pytest.skip("app/node_modules not installed in this checkout")
    shutil.copytree(jsep, tmp_path / "app" / "node_modules" / "jsep")
    code, a = _run(tmp_path, request)
    assert code == 0 and a["ok"] is True, a
    result = a["result"]
    assert result["lane"] == "ast" and isinstance(result["work"], int) and result["work"] > 0
    assert [o["key"] for o in result["outputs"]] == ["ext"] and "values" not in result["outputs"][0]
    assert a["ceiling"]["name"] == "MAX_EVALUATION_UNITS"
    assert a["reference"]["bars"] == 5000
    code, b = _run(tmp_path, request)
    assert code == 0 and b["result"]["work"] == result["work"]          # the same work, every run

    # the series rides when asked for, NaN written as null
    code, full = _run(tmp_path, {"definition": _house("atr_extension"), "reference": True})
    values = full["result"]["outputs"][0]["values"]
    assert len(values) == 5000 and values[0] is None and isinstance(values[-1], float)


@needs_node
def test_a_refusal_is_an_answer_and_a_lane_without_a_counter_is_not():
    stamped = _house("atr_extension")
    stamped = {**stamped, "meta": {**stamped["meta"], "hostKnownDivergence": "this script is not drawn: x"}}
    code, doc = _run(ROOT, {"definition": stamped, "reference": True})
    assert code == 0 and doc["ok"] is True
    assert doc["result"]["refusal"]["code"] == "pine:known-divergence" and doc["result"]["work"] is None

    native = {"id": "sma", "compute": {"fn": "sma"}, "plots": [{"key": "value"}]}
    code, doc = _run(ROOT, {"definition": native, "reference": True})
    assert code == 3 and doc["ok"] is False and doc["lane"] == "native"

    code, doc = _run(ROOT, "{not json")
    assert code == 2 and doc["ok"] is False


def _declared(path: pathlib.Path, pattern: str) -> int:
    m = re.search(pattern, path.read_text(encoding="utf-8"), re.M)
    assert m, f"{path.name} no longer declares {pattern!r} where the server reads it"
    return int(m.group(1))


@needs_node
def test_each_lanes_ceiling_is_read_from_its_declaring_module():
    formula = _declared(ENGINE / "ast" / "interpret.js", r"^export const MAX_EVALUATION_UNITS = (\d+)$")
    runtime = _declared(ENGINE / "runtime" / "limits.js", r"^  TOTAL_INSTRUCTIONS: (\d+),$")
    code, doc = _run(ROOT, {"definition": _house("gap_up_on_volume"), "reference": True, "values": False})
    assert code == 0 and doc["ceiling"] == {
        "name": "MAX_EVALUATION_UNITS", "module": "app/src/components/chart/engine/ast/interpret.js", "value": formula}
    assert runtime > formula > 0
