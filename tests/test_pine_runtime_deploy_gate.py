"""The master deploy gate RUNS the pine-runtime rails of docs/pine/SERVER-RUNTIME-DESIGN.md section 8,
in order, and cannot quietly stop doing so (W5-T19).

Reads the REAL workflow (never a copy). Fails if a section-8 step disappears, becomes conditional or
optional, runs out of order, runs on a Node that is not the image's Node, or if a pine-runtime test
file / tool appears that the gate does not name. The two deferrals (T2 closure, the image copies for
T9's canary) are self-arming: the day the file exists, the rail demands the wiring.
"""
from __future__ import annotations

import glob
import os
import pathlib
import re
import shutil
import stat
import subprocess

import pytest
import yaml

REPO = pathlib.Path(__file__).resolve().parents[1]
WORKFLOW = REPO / ".github" / "workflows" / "master-deploy-gate.yml"
IMAGE = REPO / "services" / "pine_runtime" / "Dockerfile"
WEB = REPO / "Dockerfile.web"
JOB = "pine-runtime"
INSTALL = "Install the app's dependencies (for the Pine runtime bundle)"
DEPS = "Pine runtime - the production dependency set"

NODE_STEP = "Pine runtime - this runner's Node is the image's Node"
S1 = "Pine runtime - the server bundle builds and imports under bare Node"
S2 = "Pine runtime - host parity, Node half (HP-1, HP-4 control, HP-5)"
S3 = "Pine runtime - engine identity and adapters agree (HP-6, HP-7)"
S4 = "Pine runtime - the closure stays host-neutral"
S5 = "Pine runtime - service unit rails"
S6 = "Pine runtime - client, codec and composition rails"
S7 = "Pine runtime - the image agrees with Dockerfile.web"
ORDERED = [DEPS, NODE_STEP, S1, S2, S3, S4, S5, S6, S7]


def _doc() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _steps() -> list[dict]:
    """The steps of the pine-runtime JOB (its own checkout, Node and npm ci), never of `gate`."""
    return _doc()["jobs"][JOB]["steps"]


def _names() -> list[str]:
    return [s.get("name") or "" for s in _steps()]


def _step(name: str) -> dict:
    hits = [s for s in _steps() if s.get("name") == name]
    assert len(hits) == 1, f"the deploy gate has {len(hits)} steps named {name!r} (renamed or removed?)"
    return hits[0]


def _pine_text() -> str:
    return "\n".join(_step(n).get("run", "") for n in ORDERED)


def _pin(dockerfile: pathlib.Path) -> str:
    m = re.search(r"(?m)^FROM node:(\d+\.\d+\.\d+)-", dockerfile.read_text(encoding="utf-8"))
    assert m, f"no `FROM node:X.Y.Z-` in {dockerfile}"
    return m.group(1)


def test_the_pine_runtime_job_exists_runs_unconditionally_and_the_verdict_waits_for_it():
    doc = _doc()
    job = doc["jobs"][JOB]
    assert set(job) <= {"name", "runs-on", "timeout-minutes", "steps"}, set(job)   # no if:, no needs:, no continue-on-error
    verdict = doc["jobs"]["verdict"]
    assert JOB in verdict["needs"], "a pine-runtime red must reach the verdict job"
    assert verdict["if"] == "always()"
    text = " ".join(s.get("run", "") for s in verdict["steps"])
    assert "needs.pine-runtime.result" in text and "pine-runtime=" in text
    assert text.count("needs.pine-runtime.result") >= 2, "the verdict must test the result, not only print it"
    assert "gate" in verdict["needs"] and "agent-browser" in verdict["needs"], "another team's job left the verdict"
    assert "pine_runtime" not in json_dump(doc["jobs"]["gate"]) and "Pine runtime" not in json_dump(doc["jobs"]["agent-browser"])


def json_dump(x) -> str:
    import json
    return json.dumps(x)


def test_every_section_8_step_exists_after_the_npm_install_in_its_own_job():
    names = _names()
    for n in ORDERED:
        assert names.count(n) == 1, f"{n!r} appears {names.count(n)} times"
    idx = [names.index(n) for n in ORDERED]
    assert idx == sorted(idx), f"the pine-runtime steps are out of order: {[names[i] for i in sorted(idx)]}"
    assert names.index(INSTALL) < idx[0], "the steps need app/node_modules from this job's own npm ci"
    assert _step(INSTALL)["run"].strip() == "npm ci" and _step(INSTALL)["working-directory"] == "app"
    assert names[idx[0]:idx[-1] + 1] == ORDERED, "another step sits between the pine-runtime steps"


@pytest.mark.parametrize("name", ORDERED)
def test_no_pine_runtime_step_is_conditional_or_optional(name):
    st = _step(name)
    assert set(st) <= {"name", "run", "working-directory"}, f"{name!r} has {set(st)}"
    if name == DEPS:
        assert "-r requirements.txt" in st["run"] and "pytest httpx" in st["run"]
    assert "if" not in st and "continue-on-error" not in st
    run = st["run"]
    assert "|| true" not in run and "passWithNoTests" not in run and "set +e" not in run
    assert not re.search(r"(?m)^\s*#", run), "a commented-out command inside a step"


def test_step_1_builds_then_imports_the_bundle_from_app():
    st = _step(S1)
    assert st["working-directory"] == "app"
    run = st["run"]
    assert run.index("node scripts/build-pine-runtime.mjs") < run.index("import('./dist-server/pine-runtime.mjs')")
    assert (REPO / "app" / "scripts" / "build-pine-runtime.mjs").is_file()


def test_step_2_runs_hp1_and_the_hp4_control_and_keeps_chromium_out_of_the_gate():
    run = _step(S2)["run"]
    cmds = [ln.strip() for ln in run.splitlines() if ln.strip()]
    assert cmds == ["node tools/pine_runtime_host_parity.mjs --host node --check",
                    "node tools/pine_runtime_host_parity.mjs --host node --mutation-control"]
    assert (REPO / "tools" / "pine_runtime_host_parity.mjs").is_file()
    # HP-2/HP-3 (Chromium) and the smoke are NOT gate steps: heavy / need a live service
    assert "pine_runtime_host_parity.py" not in _pine_text()
    # train (W5-T19 x W5-T9): the LIVE smoke tool is not a gate step; its offline rail
    # tests/test_pine_runtime_service_smoke.py (no service needed) is, by the every-file rule
    assert "tools/pine_runtime_service_smoke.py" not in _pine_text()


def test_step_3_names_the_engine_identity_file_and_it_exists():
    assert "tests/test_pine_runtime_engine_identity.py" in _step(S3)["run"]
    assert (REPO / "tests" / "test_pine_runtime_engine_identity.py").is_file()


def test_step_5_runs_every_service_unit_test_file_by_glob():
    run = _step(S5)["run"].strip()
    assert run == "node --test services/pine_runtime/test/*.test.mjs"
    assert glob.glob(str(REPO / "services" / "pine_runtime" / "test" / "*.test.mjs")), "the glob matches nothing"


def test_every_pine_runtime_test_file_is_named_by_a_gate_step():
    """A NEW tests/test_pine_runtime_*.py (T12's server stage, T17's composition) that no step runs
    would be a rail the gate never executes."""
    text = _pine_text()
    files = sorted(os.path.basename(f) for f in glob.glob(str(REPO / "tests" / "test_pine_runtime_*.py")))
    assert len(files) >= 7, files
    unnamed = [f for f in files if f"tests/{f}" not in text]
    assert not unnamed, f"tests/test_pine_runtime_*.py not run by the gate: {unnamed}"
    assert "tests/test_pine_runtime_deploy_gate.py" in _step(S6)["run"], "this rail must run in the gate it guards"
    assert "tests/test_pine_runtime_dockerfile.py" in _step(S7)["run"]
    # design section 8 step 6 names the composition rail (W5-T17). The step names it BEFORE T17 is on this
    # branch, on purpose: one rule, and the merge order is T17 before T19.
    assert "tests/test_pine_runtime_composition.py" in _step(S6)["run"]


def test_a_python_step_uses_the_production_dependency_set():
    for n in (S3, S6, S7):
        assert "/tmp/prodvenv/bin/python -m pytest" in _step(n)["run"]
    names = _names()
    assert names.index(DEPS) < names.index(NODE_STEP) < names.index(S3)


# -- the Node pin: ONE authority, read, never retyped ---------------------------------

def test_the_gate_node_major_equals_the_images_pin_which_equals_dockerfile_web():
    assert _pin(IMAGE) == _pin(WEB)
    major = _pin(IMAGE).split(".")[0]
    steps = _steps()
    setups = [s for s in steps if str(s.get("uses", "")).startswith("actions/setup-node")]
    assert len(setups) == 1, "exactly one setup-node in this job: two pins are two authorities"
    # and every OTHER job that pins a Node (the Agent shards) pins the same major
    for jid, j in _doc()["jobs"].items():
        for st in j.get("steps", []):
            if str(st.get("uses", "")).startswith("actions/setup-node"):
                assert str(st["with"]["node-version"]) == major, f"job {jid} pins a Node other than the image's"
    assert str(setups[0]["with"]["node-version"]) == major
    assert steps.index(setups[0]) < _names().index(NODE_STEP)


def _fake_node(tmp: pathlib.Path, version: str) -> None:
    major = version.split(".")[0]
    script = tmp / "node"
    script.write_text(
        "#!/bin/sh\n"
        'case "$*" in\n'
        f'  "-v") echo v{version};;\n'
        f'  *split*) echo {major};;\n'
        '  *v8*) echo 11.3.244.8-node.23;;\n'
        "esac\n", encoding="utf-8", newline="\n")
    script.chmod(script.stat().st_mode | stat.S_IEXEC)


def _bash() -> str:
    bash = shutil.which("bash")
    assert bash, "bash is required to execute the gate's shell step (the gate runs it on ubuntu)"
    return bash


@pytest.mark.parametrize("fake,ok", [("PIN", True), ("19.9.0", False), ("22.1.0", False)])
def test_the_node_step_passes_on_the_images_major_and_fails_on_any_other(tmp_path, fake, ok):
    version = _pin(IMAGE) if fake == "PIN" else fake
    _fake_node(tmp_path, version)
    env = dict(os.environ, PATH=str(tmp_path) + os.pathsep + os.environ["PATH"])
    p = subprocess.run([_bash(), "-ec", _step(NODE_STEP)["run"]], cwd=REPO, env=env, capture_output=True, text=True)
    assert (p.returncode == 0) is ok, (p.returncode, p.stdout, p.stderr)


def test_the_node_step_fails_when_the_image_has_no_node_from_line(tmp_path):
    _fake_node(tmp_path, _pin(IMAGE))
    run = _step(NODE_STEP)["run"].replace("services/pine_runtime/Dockerfile", "Dockerfile.nonexistent")
    assert "Dockerfile.nonexistent" in run
    env = dict(os.environ, PATH=str(tmp_path) + os.pathsep + os.environ["PATH"])
    p = subprocess.run([_bash(), "-ec", run], cwd=REPO, env=env, capture_output=True, text=True)
    assert p.returncode != 0, "an unreadable image pin must fail the gate, not pass it"


# -- the two deferrals arm themselves ------------------------------------------------------

def test_step_4_runs_the_closure_check_between_identity_and_unit_rails():
    """Section 8 step 4. The tool lives on W5-T2; on a tree without it the step is red, by design, so
    this rail checks the step's presence, command and position, not the tool's presence."""
    assert _step(S4)["run"].strip() == "node tools/pine_runtime_closure.mjs --check"
    names = _names()
    assert names.index(S3) + 1 == names.index(S4) and names.index(S4) + 1 == names.index(S5)


def test_the_image_ships_what_the_canary_imports_the_day_t9_lands():
    """T10's open item: canary.mjs imports tools/pine_runtime_host_parity.mjs, which reads
    runtime/columnDigest.js and runtime/__fixtures__/hostParity/**. Absent from the image, the
    service does not boot with its canary."""
    needed = ["tools/pine_runtime_host_parity.mjs",
              "app/src/components/chart/engine/runtime/columnDigest.js",
              "app/src/components/chart/engine/runtime/__fixtures__/hostParity"]
    assert all((REPO / n).exists() for n in needed), "a file the canary needs is missing from the tree"
    copies = [ln for ln in IMAGE.read_text(encoding="utf-8").splitlines() if ln.startswith("COPY ") and "--from" not in ln]
    if (REPO / "services" / "pine_runtime" / "canary.mjs").exists():
        for n in needed:
            assert any(n in c for c in copies), f"the image does not COPY {n}, which canary.mjs needs at boot"


# -- the runbook cannot drift from the files it describes -----------------------------

RUNBOOK = REPO / "docs" / "runbooks" / "pine-runtime-service.md"
DEPLOY_WINDOWS = REPO / "docs" / "runbooks" / "deploy-windows.md"


def test_the_runbook_lists_the_railway_watch_patterns_the_service_json_declares():
    import json
    pats = json.loads((REPO / "services" / "pine_runtime" / "railway.json").read_text(encoding="utf-8"))["build"]["watchPatterns"]
    text = RUNBOOK.read_text(encoding="utf-8")
    missing = [p for p in pats if f"`{p}`" not in text]
    assert not missing, f"the owner's Railway steps omit watch paths the service declares: {missing}"


def test_the_runbook_names_every_gate_command_the_owner_may_need_to_reproduce():
    text = RUNBOOK.read_text(encoding="utf-8")
    for needle in ("node tools/pine_runtime_host_parity.mjs --host node --check", "--mutation-control",
                   "node --test services/pine_runtime/test/*.test.mjs", "tests/test_pine_runtime_engine_identity.py",
                   "tests/test_pine_runtime_dockerfile.py", "tools/pine_runtime_service_smoke.py",
                   "PINE_RUNTIME_SERVICE_SECRET", "PINE_RUNTIME_SERVICE_URL", "PINE_RUNTIME_SERVER_STAGE",
                   "tools/pine_runtime_host_parity.mjs", "runtime/columnDigest.js", "__fixtures__/hostParity",
                   "never been built"):
        assert needle in text, f"the runbook no longer mentions {needle!r}"


def test_deploy_windows_points_at_the_runbook_and_the_runbook_file_exists():
    assert RUNBOOK.is_file()
    assert "docs/runbooks/pine-runtime-service.md" in DEPLOY_WINDOWS.read_text(encoding="utf-8")
