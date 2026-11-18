"""Rails for the whole-app engine rails: .github/workflows/whole-app-engine-rails.yml, its list
(tools/whole_app_engine_rails.txt), the check that derives it (tools/ci_whole_app_rails.py) and the read capture
it is derived from (app/src/test-read-capture.cjs + .js, wired by app/vite.config.js), 2026-11-17.

WHY: engine tests that read files OUTSIDE the engine ran only in pine heavy, which triggers on engine paths, so
#1662 and #1670 merged green while breaking memberPaneGate and suiteCoverage. What must stay true, each a test:

  * the PR job is PR-only, cost-railed (paths, SHA-grouped PR cancel), read-only, secret-free, and runs the list
    with the capture on, then checks what it captured (if: always());
  * pine heavy captures on EVERY engine leg (both harness lanes included), uploads the captures where `union`
    downloads them and nowhere the union rail reads, and `union` runs the check with both controls;
  * each workflow triggers on the files that define the other's half (the list, the tool, the capture);
  * vite.config.js adds the capture to setupFiles under UCT_READ_CAPTURE_DIR (CODE, NEVER PROSE);
  * the capture records an ESM named-import read and a node child's read, against the right test file, and
    nothing when no test file is running (EXECUTED under node, not read);
  * the check can fail both ways (--self-check), the static scan finds the `?raw` rails and refuses prose, and no
    engine file uses import.meta.glob (the one read form neither half models);
  * the checkout depth answers the listed rails that read git history (derived, both ways);
  * the master deploy gate runs the same list, from the same file.

Standard library + PyYAML.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import shutil
import subprocess
import sys

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "tests"))

import ci_whole_app_rails as W  # noqa: E402

WF = ROOT / ".github" / "workflows" / "whole-app-engine-rails.yml"
PINE = ROOT / ".github" / "workflows" / "pine-heavy.yml"
GATE = ROOT / ".github" / "workflows" / "master-deploy-gate.yml"
CAPTURE = ROOT / "app" / "src" / "test-read-capture.cjs"
CONTROLS = ("app/src/components/chart/engine/__tests__/memberPaneGate.test.js",
            "app/src/components/chart/engine/__tests__/suiteCoverage.test.js")


def _load(p: pathlib.Path) -> dict:
    return yaml.safe_load(p.read_text(encoding="utf-8"))


def _on(doc: dict) -> dict:
    return doc.get("on", doc.get(True))


def _runs(job: dict) -> str:
    return "\n".join(str(s.get("run") or "") for s in job.get("steps") or [])


# ── the PR job ────────────────────────────────────────────────────────────────

def test_the_pr_job_is_pr_only_cost_railed_read_only_and_secret_free():
    text = WF.read_text(encoding="utf-8")
    doc = _load(WF)
    assert text.splitlines()[0].startswith("# promotion-gate: no")
    assert set(_on(doc)) == {"pull_request"}, sorted(_on(doc))
    assert _on(doc)["pull_request"]["branches"] == ["master"]
    code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
    assert "pull_request_target" not in code and "secrets." not in code
    assert doc["permissions"] == {"contents": "read"}
    conc = doc["concurrency"]
    assert "github.event.pull_request.number" in conc["group"] and "github.sha" in conc["group"]
    assert conc["cancel-in-progress"] == "${{ github.event_name == 'pull_request' }}"
    for name, job in doc["jobs"].items():
        assert 0 < job["timeout-minutes"] <= 20, name


def test_the_pr_job_triggers_on_app_src_and_on_its_own_definition():
    rxs = [W.glob_rx(g) for g in _on(_load(WF))["pull_request"]["paths"]]
    for p in ("app/src/main.jsx", "app/src/pages/formulas/deviceDrawTime.js", "app/src/components/StockChart.jsx",
              ".github/workflows/whole-app-engine-rails.yml", "tools/whole_app_engine_rails.txt",
              "tools/ci_whole_app_rails.py", "tools/ci_offline.sh", "tests/test_ci_whole_app_rails.py",
              ".github/actions/pine-heavy-setup/action.yml", "app/src/test-read-capture.cjs"):
        assert any(rx.match(p) for rx in rxs), p


def test_the_pr_job_runs_the_list_with_the_capture_on_and_checks_it_whatever_the_run_said():
    steps = _load(WF)["jobs"]["rails"]["steps"]
    run = next(s for s in steps if "vitest run" in str(s.get("run")))
    body = run["run"]
    assert "--print-list" in body and "npx vitest run $files" in body
    assert "UCT_READ_CAPTURE_DIR=" in body and "ci_offline.sh" in body
    assert "--outputFile=../whole-app-out/report.json" in body
    check = next(s for s in steps if "--expected-list" in str(s.get("run")))
    assert check.get("if") == "always()"
    assert "--ran whole-app-out/report.json" in check["run"] and "--captures read-capture" in check["run"]
    assert any("--verify-list" in str(s.get("run")) for s in steps)
    assert any("pytest tests/test_ci_whole_app_rails.py" in str(s.get("run")) for s in steps)
    assert any(str(s.get("uses", "")).endswith("pine-heavy-setup") for s in steps), "not pine heavy's environment"
    env = _load(WF)["env"]
    assert env["UCT_VENDOR_CAPTURE_STORE"] == _load(PINE)["env"]["UCT_VENDOR_CAPTURE_STORE"]
    assert env["UCT_HARNESS_SUPPLY_STORE"] == _load(PINE)["env"]["UCT_HARNESS_SUPPLY_STORE"]


# ── pine heavy derives the list ───────────────────────────────────────────────

def test_every_engine_leg_of_pine_heavy_captures_and_uploads_its_reads():
    jobs = _load(PINE)["jobs"]
    for name in ("vitest", "harness-runtime-on"):
        steps = jobs[name]["steps"]
        run = next(s for s in steps if "vitest run" in str(s.get("run")))
        assert "/read-capture/" in str((run.get("env") or {}).get("UCT_READ_CAPTURE_DIR", "")), name
        up = [s for s in steps if "upload-artifact" in str(s.get("uses"))
              and str((s.get("with") or {}).get("name", "")).startswith("pine-heavy-reads-")]
        assert len(up) == 1, name
        assert up[0]["with"]["path"] == "read-capture/" and up[0]["with"]["if-no-files-found"] == "error", name
        assert up[0].get("if") == "always()", name


def test_union_downloads_the_captures_apart_from_what_the_union_rail_reads_and_runs_the_check():
    steps = _load(PINE)["jobs"]["union"]["steps"]
    pats = {s["with"]["pattern"]: s["with"]["path"] for s in steps if "download-artifact" in str(s.get("uses"))}
    assert pats.get("pine-heavy-reads-*") == "captures", pats
    for leg in [l["leg"] for l in _load(PINE)["jobs"]["vitest"]["strategy"]["matrix"]["include"]] + ["harness-runtime-on"]:
        name = f"pine-heavy-reads-{leg}"
        others = [p for p in pats if p != "pine-heavy-reads-*" and re.fullmatch(p.replace("*", ".*"), name)]
        assert not others, f"{name} would also land in {others}"
    run = _runs(_load(PINE)["jobs"]["union"])
    assert "ci_whole_app_rails.py\" --check --repo . --captures captures" in run
    assert "--expected expected-files.txt --root app" in run
    for c in CONTROLS:
        assert c in run.split("ci_whole_app_rails.py", 1)[1], c


def test_each_workflow_triggers_on_what_defines_the_other_half():
    pine = _on(_load(PINE))["pull_request"]["paths"]
    for p in ("app/src/test-read-capture*", "tools/ci_whole_app_rails.py", "tools/whole_app_engine_rails.txt",
              ".github/workflows/whole-app-engine-rails.yml", "tests/test_ci_whole_app_rails.py"):
        assert p in pine, p
    rxs = [W.glob_rx(g) for g in pine]
    for f in ("app/src/test-read-capture.cjs", "app/src/test-read-capture.js"):
        assert any(rx.match(f) for rx in rxs), f
    assert "tests/test_ci_whole_app_rails.py" in _runs(_load(PINE)["jobs"]["rails"])


def test_vite_config_adds_the_capture_only_when_asked():
    text = (ROOT / "app" / "vite.config.js").read_text(encoding="utf-8")
    code = W._code(text)
    m = re.search(r"setupFiles:\s*process\.env\.UCT_READ_CAPTURE_DIR\s*\?\s*\[([^\]]*)\]\s*:\s*'([^']+)'", code)
    assert m, "vite.config.js no longer adds src/test-read-capture.js under UCT_READ_CAPTURE_DIR"
    assert "'./src/test-read-capture.js'" in m.group(1) and "'./src/test-setup.js'" in m.group(1)
    assert m.group(2) == "./src/test-setup.js"
    assert (ROOT / "app" / "src" / "test-read-capture.js").is_file() and CAPTURE.is_file()


# ── the capture, executed ─────────────────────────────────────────────────────

@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")
def test_the_capture_records_named_imports_and_node_children_against_the_running_test(tmp_path):
    a, b, c = tmp_path / "a.txt", tmp_path / "b.txt", tmp_path / "c.txt"
    for f in (a, b, c):
        f.write_text("x", encoding="utf-8")
    out = tmp_path / "caps"
    script = tmp_path / "drive.mjs"
    script.write_text(f"""
import {{ createRequire }} from 'node:module'
const cap = createRequire(import.meta.url)({json.dumps(str(CAPTURE))})
const fs = await import('node:fs')
fs.readFileSync({json.dumps(str(c))})                       // before any test file: charged to nobody
cap.beginTestFile({json.dumps(str(out))}, '/repo/app/src/components/chart/engine/x.test.js')
const {{ readFileSync, existsSync }} = await import('node:fs')     // the ESM named binding sees the wrapper
readFileSync({json.dumps(str(a))}, 'utf8')
existsSync('/definitely/not/here')
const {{ spawnSync }} = await import('node:child_process')
const r = spawnSync(process.execPath, ['-e', "require('fs').readFileSync(" + JSON.stringify({json.dumps(str(b))}) + ")"], {{ encoding: 'utf8' }})
if (r.status !== 0) {{ console.error(r.stderr); process.exit(3) }}
cap.endTestFile('/repo/app/src/components/chart/engine/x.test.js')
""", encoding="utf-8")
    p = subprocess.run(["node", str(script)], capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr
    recs = [W.read_record(f) for f in sorted(out.glob("*.jsonl"))]
    kinds = {head["kind"]: reads for head, reads in recs}
    assert set(kinds) == {"worker", "child"}, recs
    norm = lambda s: os.path.normcase(os.path.abspath(s))  # noqa: E731
    worker = {norm(r) for r in kinds["worker"]}
    assert norm(str(a)) in worker and norm("/definitely/not/here") in worker
    assert norm(str(c)) not in worker, "a read before any test file began was charged to one"
    assert norm(str(b)) in {norm(r) for r in kinds["child"]}, "the child's read was not captured"
    assert all(h["file"] == "/repo/app/src/components/chart/engine/x.test.js" for h, _ in recs)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not on PATH")
def test_a_test_file_that_never_ends_still_leaves_its_record(tmp_path):
    """The record is written as reads happen: a process killed before afterAll (an all-skipped isolated fork)
    still leaves the header and every read so far (2026-11-17: 28 of 30 skipped files had none)."""
    a = tmp_path / "a.txt"
    a.write_text("x", encoding="utf-8")
    out = tmp_path / "caps"
    script = tmp_path / "drive.cjs"
    script.write_text(f"""
const cap = require({json.dumps(str(CAPTURE))})
cap.beginTestFile({json.dumps(str(out))}, '/repo/app/src/components/chart/engine/y.test.js')
require('node:fs').readFileSync({json.dumps(str(a))})
process.kill(process.pid, 'SIGKILL')
""", encoding="utf-8")
    subprocess.run(["node", str(script)], capture_output=True, text=True, timeout=60)
    recs = [W.read_record(f) for f in out.glob("*.jsonl")]
    assert len(recs) == 1 and recs[0] is not None, recs
    head, reads = recs[0]
    assert head["file"].endswith("/y.test.js")
    assert os.path.normcase(str(a)) in {os.path.normcase(r) for r in reads}


# ── the check ─────────────────────────────────────────────────────────────────

def test_the_check_can_fail_both_ways():
    p = subprocess.run([sys.executable, str(ROOT / "tools" / "ci_whole_app_rails.py"), "--self-check"],
                       capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stdout + p.stderr
    assert "BAD" not in p.stdout


def test_the_static_scan_finds_the_text_import_rails_and_no_glob_import():
    static, globbers = W.static_text_reads(ROOT)
    for t in ("dataSourcesRevalidate.test.jsx", "markerHost.test.js", "secondarySourcesRevalidate.test.jsx"):
        hit = [k for k in static if k.endswith("/__tests__/" + t)]
        assert hit and "app/src/components/StockChart.jsx" in static[hit[0]], (t, sorted(static))
    assert not globbers, f"import.meta.glob under the engine is not modelled by the check: {globbers}"
    # and the derivation keeps them: StockChart.jsx is outside pine heavy's trigger
    rails = W.derive({}, static, W.pr_paths(PINE))
    assert len(rails) >= 3


def test_the_list_is_well_formed_and_holds_the_controls():
    listed = W.read_list(W.LIST)
    assert W.verify_list(listed, ROOT) == []
    for c in CONTROLS:
        assert c[len("app/"):] in listed, c
    # the static half alone: every ?raw rail is listed (the runtime half is judged by pine heavy's `union`)
    static, _ = W.static_text_reads(ROOT)
    missing = [t for t in W.derive({}, static, W.pr_paths(PINE)) if t[len("app/"):] not in listed]
    assert not missing, missing


def _depth(job: dict):
    steps = [st for st in job["steps"] if str(st.get("uses", "")).startswith("actions/checkout") and "path" not in (st.get("with") or {})]
    assert len(steps) == 1, steps
    return (steps[0].get("with") or {}).get("fetch-depth", 1)


def test_the_checkout_depth_answers_every_listed_rail_that_reads_git_history():
    """A listed rail that reads an older commit (`git show <sha>:...`) needs the full history; a depth-1
    checkout makes it throw by name. Pine heavy's own derivation of the readers, reused."""
    import test_ci_pine_heavy as PH  # noqa: E402
    readers = PH._history_readers()
    assert readers, "the history derivation found nothing: it is not looking"
    listed = {"app/" + l for l in W.read_list(W.LIST)}
    need_full = sorted(set(readers) & listed)
    for wf, job in ((WF, "rails"), (GATE, "whole-app-engine-rails")):
        depth = _depth(_load(wf)["jobs"][job])
        if need_full:
            assert depth == 0, f"{wf.name}:{job} is depth {depth} but these listed rails read history: {need_full}"
        else:
            assert depth == 1, f"{wf.name}:{job} fetches the full history and no listed rail reads it"


# ── the master gate runs the same list ────────────────────────────────────────

def test_the_master_gate_runs_the_list_and_its_verdict_needs_it():
    jobs = _load(GATE)["jobs"]
    job = jobs["whole-app-engine-rails"]
    assert 0 < job["timeout-minutes"] <= 20
    run = _runs(job)
    assert "ci_whole_app_rails.py --print-list" in run and "npx vitest run $files" in run
    assert "ci_whole_app_rails.py --verify-list" in run
    assert "continue-on-error" not in json.dumps(job)
    assert "whole-app-engine-rails" in jobs["verdict"]["needs"]
    verdict = _runs(jobs["verdict"])
    assert "needs.whole-app-engine-rails.result" in verdict.split("Explain", 1)[0]
