"""Rails for .github/workflows/pine-host-parity-chromium.yml: the host-parity rail's Chromium half in CI (2026-11-19).

Until 2026-11-19 only the Node half (HP-1, HP-4) ran in CI (the master deploy gate); the Chromium half ran by hand,
so a red there (`h_varip_window@listing`, the harness blind to calc_bars_count windows since engine 59) sat unseen.
What must stay true, each a test below:

  * it is advisory: no master push, no secrets, a read-only token; PRs that touch the engine, the parity tools,
    the corpus or the codec run it, and so does a nightly master schedule
  * a superseded PR run is cancelled; a scheduled run is never cancelled by a PR
  * Playwright's Chromium is installed BEFORE the offline step, and the tool runs under tools/ci_offline.sh
  * the job fails on any exit but 0 (1 = a case differs, 2 = inconclusive): the tool's code is the step's code
  * committed fixtures only: the licence-held stores are pinned empty and checked by the shared setup action
  * the paths it names exist (a renamed file would silently stop triggering it)

Standard library + PyYAML.
"""
from __future__ import annotations

import os
import pathlib
import shutil
import subprocess

import pytest
import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / ".github" / "workflows" / "pine-host-parity-chromium.yml"


def _doc() -> dict:
    return yaml.safe_load(WF.read_text(encoding="utf-8"))


def _on(doc: dict) -> dict:
    return doc.get("on", doc.get(True))


def _steps() -> list[dict]:
    return _doc()["jobs"]["chromium-half"]["steps"]


def test_it_is_advisory_pr_nightly_and_dispatch_with_a_read_only_token():
    text = WF.read_text(encoding="utf-8")
    on = _on(_doc())
    assert set(on) == {"pull_request", "schedule", "workflow_dispatch"}, sorted(on)
    assert "push" not in on
    assert on["pull_request"]["branches"] == ["master"]
    assert on["schedule"] and all("cron" in s for s in on["schedule"])
    assert _doc()["permissions"] == {"contents": "read"}
    code = "\n".join(l for l in text.splitlines() if not l.lstrip().startswith("#"))
    assert "secrets." not in code and "pull_request_target" not in code
    assert text.splitlines()[0].startswith("# promotion-gate: no")


def test_the_pr_trigger_covers_the_engine_the_tools_the_corpus_and_the_codec():
    paths = _on(_doc())["pull_request"]["paths"]
    for p in ("app/src/components/chart/engine/**", "tools/pine_runtime_host_parity.mjs",
              "tools/pine_runtime_host_parity.py", "api/services/pine_runtime_codec.py",
              ".github/workflows/pine-host-parity-chromium.yml", "tests/test_ci_host_parity_chromium.py"):
        assert p in paths, p
    # the corpus and its committed digests live under the engine glob
    corpus = "app/src/components/chart/engine/runtime/__fixtures__/hostParity/corpus.json"
    assert corpus.startswith("app/src/components/chart/engine/")


def test_every_named_path_exists():
    proc = subprocess.run(["git", "-C", str(ROOT), "ls-files"], capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0
    tracked = proc.stdout.splitlines()
    assert len(tracked) > 5000
    for p in _on(_doc())["pull_request"]["paths"]:
        if p.endswith("/**"):
            assert any(t.startswith(p[:-2]) for t in tracked), p
        else:
            assert p in tracked or (ROOT / p).exists(), p


def test_a_superseded_pr_run_is_cancelled_and_nothing_else_is():
    conc = _doc()["concurrency"]
    assert conc["cancel-in-progress"] == "${{ github.event_name == 'pull_request' }}"
    assert "github.event.pull_request.number" in conc["group"] and "github.sha" in conc["group"]


def test_chromium_is_installed_before_the_offline_run_and_the_run_is_offline():
    steps = _steps()
    runs = [str(s.get("run") or "") for s in steps]
    install = next(i for i, r in enumerate(runs) if "playwright install" in r)
    tool = next(i for i, r in enumerate(runs) if "pine_runtime_host_parity.py" in r)
    assert install < tool
    assert "ci_offline.sh" not in runs[install]
    line = next(l for l in runs[tool].splitlines() if "pine_runtime_host_parity.py" in l)
    assert line.strip().startswith("bash tools/ci_offline.sh python tools/pine_runtime_host_parity.py --dist app/dist")
    build = next(i for i, r in enumerate(runs) if "vite build" in r)
    assert build < tool


def test_the_step_fails_on_any_exit_but_zero(tmp_path):
    """The run step is EXECUTED with a stub in place of the wrapped tool: 0 passes; 1 and 2 fail."""
    bash = shutil.which("bash")
    if not bash:
        pytest.skip("no bash on this machine (CI has one)")
    run = next(str(s.get("run")) for s in _steps() if "pine_runtime_host_parity.py" in str(s.get("run") or ""))
    wrapped = "bash tools/ci_offline.sh python tools/pine_runtime_host_parity.py"
    assert wrapped in run
    for code, ok in ((0, True), (1, False), (2, False)):
        stub = tmp_path / f"stub{code}.sh"
        stub.write_text(f"exit {code}\n", encoding="utf-8", newline="\n")
        script = tmp_path / f"step{code}.sh"
        script.write_text(run.replace(wrapped, f"bash {stub.as_posix()}"), encoding="utf-8", newline="\n")
        env = dict(os.environ, RUNNER_TEMP=tmp_path.as_posix(), GITHUB_STEP_SUMMARY=(tmp_path / "summary.md").as_posix())
        proc = subprocess.run([bash, str(script)], capture_output=True, text=True, timeout=60, env=env)
        assert (proc.returncode == 0) is ok, f"tool exit {code}: step exit {proc.returncode} ({proc.stderr[:200]})"


def test_committed_fixtures_only_and_the_budget():
    doc = _doc()
    for v in ("UCT_VENDOR_CAPTURE_STORE", "UCT_HARNESS_SUPPLY_STORE"):
        assert str(doc["env"].get(v, "")).startswith("/tmp/"), v
    steps = _steps()
    assert any(str(s.get("uses", "")).endswith("pine-heavy-setup") for s in steps)
    job = doc["jobs"]["chromium-half"]
    assert 0 < job["timeout-minutes"] <= 30
    assert "continue-on-error" not in str(job)
