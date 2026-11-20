"""Rails for the nightly full suite running at least daily (full-suite-report.yml, 2026-11-18).

Measured before this file: the nightly had not run for two nights (its plan job refused a thin timing file, and
every pytest and vitest shard was skipped), and GitHub created its one 07:30 UTC cron 6.9-9.7 h late or not at
all. These pin the repairs:

  * R4 — three crons, and a first `today` job (tools/full_suite_latch.py) whose explicit `false` is the ONLY
    thing that skips a run; no new permission anywhere in the workflow;
  * R1 — the plan restores the newest timings from actions/cache, hands that exact file to every shard as one
    artifact, and `publish` saves the night's merged timings under the same key prefix;
  * R3 — every ci_inventory call in `publish` reads a bounded record window.

Stdlib + PyYAML; the latch's decision table is its own --self-check, run here.
"""
from __future__ import annotations

import importlib.util
import pathlib

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
WF = ROOT / ".github" / "workflows" / "full-suite-report.yml"


def _doc():
    return yaml.safe_load(WF.read_text(encoding="utf-8"))


def _latch():
    spec = importlib.util.spec_from_file_location("full_suite_latch_under_test", ROOT / "tools" / "full_suite_latch.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _runs(job):
    return "\n".join(str(s.get("run") or "") for s in _doc()["jobs"][job]["steps"] if isinstance(s, dict))


def _uses(job, action):
    return [s for s in _doc()["jobs"][job]["steps"] if str(s.get("uses", "")).startswith(action)]


# ------------------------------------------------------------------ R4: the latch

def test_the_latch_decision_table_holds():
    assert _latch().main(["--self-check"]) == 0


def test_three_crons_and_a_hand_dispatch():
    on = _doc().get("on", _doc().get(True))
    crons = [c["cron"] for c in on["schedule"]]
    assert len(crons) >= 3 and len(set(crons)) == len(crons), crons
    assert "workflow_dispatch" in on


def test_the_latch_is_the_first_job_and_only_an_explicit_false_skips():
    jobs = _doc()["jobs"]
    today = jobs["today"]
    assert today["outputs"]["run"] == "${{ steps.latch.outputs.run }}"
    assert "tools/full_suite_latch.py" in _runs("today") and "$GITHUB_OUTPUT" in _runs("today")
    assert jobs["plan"]["needs"] == "today"
    for job in ("plan", "publish", "gate"):
        cond = jobs[job]["if"]
        needs = jobs[job]["needs"]
        assert "today" in (needs if isinstance(needs, list) else [needs]), job
        # ⛔ `!= 'false'`, never `== 'true'`: a latch that broke leaves no output, and the suite must still run
        assert "needs.today.outputs.run != 'false'" in cond and "== 'true'" not in cond, (job, cond)
    # every suite job hangs off the plan, so a skipped plan skips them all
    for job in ("vitest", "pytest", "collect_profile"):
        assert jobs[job]["needs"] == "plan", job


def test_no_new_permission():
    doc = _doc()
    assert doc["permissions"] == {"contents": "read"}, doc["permissions"]
    assert "permissions" not in doc["jobs"]["today"]
    assert "permissions" not in doc["jobs"]["plan"]
    assert doc["jobs"]["publish"]["permissions"] == {"contents": "write", "actions": "read"}


# ------------------------------------------------------------------ R1: one timing file per run

def test_the_plan_restores_the_newest_timings_and_hands_that_file_to_every_shard():
    restore = _uses("plan", "actions/cache/restore@")
    assert len(restore) == 1
    w = restore[0]["with"]
    assert w["restore-keys"] == "pytest-shard-timings-" and w["key"].startswith("pytest-shard-timings-${{ github.run_id")
    assert "cp .pytest-timings/pytest_shard_timings.json tools/pytest_shard_timings.json" in _runs("plan")
    up = [s for s in _uses("plan", "actions/upload-artifact@") if s["with"]["name"] == "pytest-shard-timings"]
    assert len(up) == 1 and up[0]["with"]["path"] == "tools/pytest_shard_timings.json"
    steps = _doc()["jobs"]["plan"]["steps"]
    names = [s.get("name") or s.get("uses") for s in steps]
    assert names.index("The newest recorded shard timings") < names.index("Prove the partition, then emit it") \
        < names.index("Hand the exact timing file to every shard"), names


def test_every_shard_cuts_from_the_plans_own_file_and_refuses_to_guess():
    steps = _doc()["jobs"]["pytest"]["steps"]
    dl = [i for i, s in enumerate(steps) if str(s.get("uses", "")).startswith("actions/download-artifact@")
          and s["with"].get("name") == "pytest-shard-timings"]
    cp = [i for i, s in enumerate(steps) if "cp .pytest-timings/pytest_shard_timings.json tools/" in str(s.get("run"))]
    run = [i for i, s in enumerate(steps) if s.get("name") == "Run"]
    assert dl and cp and run and dl[0] < cp[0] < run[0], (dl, cp, run)
    assert "exit 1" in steps[cp[0]]["run"]          # a missing file fails the shard, never the committed fallback


def test_publish_saves_the_merged_timings_under_the_prefix_the_plan_restores():
    save = _uses("publish", "actions/cache/save@")
    assert len(save) == 1 and save[0]["with"]["key"].startswith("pytest-shard-timings-")
    run = _runs("publish")
    assert "--record-timings shards/*/pytest-junit.xml" in run and "--merge-into effective-timings/" in run
    assert "shard_plan.json" in run                  # the record says which partition ran


# ------------------------------------------------------------------ R3: a bounded record window

def test_every_ci_inventory_call_in_publish_reads_a_bounded_window():
    calls = [ln for ln in _runs("publish").splitlines() if "tools/ci_inventory.py" in ln]
    blocks = _runs("publish").split("python tools/ci_inventory.py")[1:]
    assert calls and len(blocks) >= 3, calls
    for b in blocks:
        head = b.split("\n\n")[0][:600]
        if "--self-check" in head:
            continue
        assert "--window 14" in head, head
