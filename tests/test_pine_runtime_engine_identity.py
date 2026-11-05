"""W5 T4 -- HP-6 engine-identity agreement and HP-7 adapter agreement
(docs/pine/SERVER-RUNTIME-DESIGN.md 2.3 and 8 step 3).

HP-6: the SERVER BUNDLE's engine identity is what the web pod reads as "today's engine"
(`user_definitions.read_script_engine_version()`), and the committed host-parity digests were
recorded under that same identity, so an engine bump that forgets to regenerate
`expected-digests.json` is red here as well as in HP-1.
HP-7: `runtimeWorker.js` and the Node half build the same `computeRuntimeColumns` call, by a
static parse (`tools/pine_runtime_host_parity.mjs --adapters`). W5-INT: the service adapter
(`services/pine_runtime/job.mjs`) has ONE HP-7 rail, `services/pine_runtime/test/adapter.test.mjs`
(budgetMs = the worker's), and this gate file runs it.
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest

from api.services import user_definitions

REPO = Path(__file__).resolve().parent.parent
EXPECTED = REPO / "app/src/components/chart/engine/runtime/__fixtures__/hostParity/expected-digests.json"
TOOL = REPO / "tools/pine_runtime_host_parity.mjs"


@pytest.fixture(scope="module")
def bundle(tmp_path_factory):
    d = tmp_path_factory.mktemp("bundle")
    out = d / "pine-runtime.mjs"
    p = subprocess.run(["node", "app/scripts/build-pine-runtime.mjs", "--out", str(out)], cwd=str(REPO),
                       capture_output=True, text=True, encoding="utf-8")
    assert p.returncode == 0, p.stderr
    probe = ("const m = await import(process.argv[1]); console.log(JSON.stringify({SCRIPT_ENGINE_VERSION: "
             "m.SCRIPT_ENGINE_VERSION, RUNTIME_FRONTEND_LANGUAGE: m.RUNTIME_FRONTEND_LANGUAGE, "
             "RUNTIME_FRONTEND_VERSION: m.RUNTIME_FRONTEND_VERSION, RUNTIME_IR_VERSION: m.RUNTIME_IR_VERSION}))")
    q = subprocess.run(["node", "--input-type=module", "-e", probe, out.as_uri()], cwd=str(d),
                       capture_output=True, text=True, encoding="utf-8")
    assert q.returncode == 0, q.stderr
    manifest = json.loads((d / "pine-runtime.manifest.json").read_text(encoding="utf-8"))
    return {"exports": json.loads(q.stdout), "manifest": manifest, "bytes": out.read_bytes()}


def test_hp6_the_bundle_runs_the_engine_the_web_pod_reads(bundle):
    web = user_definitions.read_script_engine_version()
    assert isinstance(web, int) and web >= 1
    assert bundle["exports"]["SCRIPT_ENGINE_VERSION"] == web


def test_hp6_the_committed_digests_were_recorded_under_todays_engine(bundle):
    ident = json.loads(EXPECTED.read_text(encoding="utf-8"))["identity"]
    ex = bundle["exports"]
    assert str(ident["script_engine"]) == str(user_definitions.read_script_engine_version()), (
        "SCRIPT_ENGINE_VERSION moved: regenerate expected-digests.json with "
        "`node tools/pine_runtime_host_parity.mjs --host node --write` at the bump")
    assert str(ident["runtime_language"]) == str(ex["RUNTIME_FRONTEND_LANGUAGE"])
    assert str(ident["runtime_frontend"]) == str(ex["RUNTIME_FRONTEND_VERSION"])
    assert str(ident["runtime_ir"]) == str(ex["RUNTIME_IR_VERSION"])
    assert ident["bundle_sha256"] == "0" * 64  # artifact-neutral by design (tool header)


def test_hp6_the_manifest_sha_is_the_bundles_own(bundle):
    assert bundle["manifest"]["sha256"] == hashlib.sha256(bundle["bytes"]).hexdigest()


def test_hp6_the_reader_can_disagree(tmp_path):
    """Control: the comparison above can fail -- a declaration of another engine reads as another."""
    f = tmp_path / "scriptEngineVersion.js"
    web = user_definitions.read_script_engine_version()
    f.write_text(f"export const SCRIPT_ENGINE_VERSION = {web + 1}\n", encoding="utf-8")
    assert user_definitions.read_script_engine_version(f) == web + 1


def test_hp7_the_adapters_build_the_same_call():
    p = subprocess.run(["node", str(TOOL), "--adapters"], cwd=str(REPO), capture_output=True, text=True, encoding="utf-8")
    assert p.returncode == 0, p.stdout + p.stderr
    assert "HP-7 GREEN" in p.stdout
    assert "worker: args (def, rows || [], ctx || {}) opts {budgetMs}" in p.stdout
    assert "node: args (c.def, rows, c.ctx) opts {incremental}" in p.stdout
    # W5-INT: the tool compares its own measurement host only; job.mjs has ONE HP-7 rail (below)
    assert "\njob:" not in "\n" + p.stdout


def test_hp7_the_service_adapter_has_one_rail_and_the_gate_runs_it():
    """W5-INT: the service adapter's HP-7 rail (budgetMs = the worker's RUNTIME_PANE_TIME_BUDGET_MS,
    one value, one authority) is a node:test file; the gate runs it here so it cannot rot unseen."""
    rail = str(Path("services") / "pine_runtime" / "test" / "adapter.test.mjs")
    p = subprocess.run(["node", "--test", rail], cwd=str(REPO), capture_output=True, text=True, encoding="utf-8", timeout=120)
    assert p.returncode == 0, p.stdout[-3000:] + p.stderr[-2000:]
    assert "fail 0" in p.stdout and "pass 3" in p.stdout, p.stdout[-2000:]
    # the tool does not read job.mjs, so it cannot hold a second (exempting) rule for it
    assert "'job.mjs'" not in TOOL.read_text(encoding="utf-8")
