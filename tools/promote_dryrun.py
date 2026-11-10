"""A real dry run of promote-production.yml's promote job, on a SIMULATED clock, with no credentials and no remote.

It runs the job's REAL `run:` blocks, extracted from the YAML, in order. They run in a throwaway git repository whose
`origin` is a local bare repository holding `production`, a gated `master` commit (the candidate) and a NEWER master
commit with no successful gate. The settings:
  * dry_run=yes;
  * now=<the simulated clock>;
  * `gh` replaced by a stub that always fails, so no GitHub API call is made: the pending-record I/O is DRY RUN, and
    the gating poll's verdict is a stand-in (its code is promotion_gate.py, tested on its own).
It prints every step's output and the job summary, and checks the CONTROL: the decision's target is the gated
candidate, never the ungated master tip, and production is unchanged. Exit 0 only when the control holds.

The `pull_request` dry-run job of promote-production.yml runs this, so the PR's own checks show a real Actions dry run.

    python tools/promote_dryrun.py --now 2026-11-10T14:31:00Z [--summary "$GITHUB_STEP_SUMMARY"]
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[1]
COPY = ["tools/promote_decision.py", "tools/deploy_freeze.py", "tools/promote_facts.sh", "tools/promote_state.sh",
        "tools/promotion_gate.py", ".github/workflows/master-deploy-gate.yml", "api/services/measurement_window.py"]
STEPS = ["cand", "freeze0", "facts0", "Record the SHA as PENDING (before waiting)", "wait", "freeze", "dec",
         "Update the pending record", "Fast-forward `production`", "Already promoted, or refused", "Summary"]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--now", required=True)
    ap.add_argument("--summary", default="")
    a = ap.parse_args(argv)
    wf = yaml.safe_load((ROOT / ".github/workflows/promote-production.yml").read_text(encoding="utf-8"))
    steps = {s.get("id") or s.get("name"): s for s in wf["jobs"]["promote"]["steps"]}
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="promote-dryrun-"))
    bare, work, runner, shim = tmp / "origin.git", tmp / "work", tmp / "runner", tmp / "shim"
    for d in (runner, shim):
        d.mkdir()
    sh = lambda c, cwd=work: subprocess.run(c, cwd=cwd, shell=True, check=True, capture_output=True, text=True).stdout.strip()  # noqa: E731
    sh(f'git init -q --bare "{bare}"', tmp)
    sh(f'git init -q -b master "{work}"', tmp)
    for rel in COPY:
        (work / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / rel, work / rel)
    g = "git -c user.email=dryrun@example.invalid -c user.name=dryrun"
    sh(f"{g} add -A && {g} commit -q -m \"base (production)\"")
    prod = sh("git rev-parse HEAD")
    (work / "gated.txt").write_text("the gated change\n")
    sh(f"{g} add -A && {g} commit -q -m \"the gated change\"")
    cand = sh("git rev-parse HEAD")
    (work / "ungated.txt").write_text("a newer master commit with NO successful gate\n")
    sh(f"{g} add -A && {g} commit -q -m \"newer, ungated\"")
    tip = sh("git rev-parse HEAD")
    sh(f'git remote add origin "{bare}" && git push -q origin master && git push -q origin {prod}:refs/heads/production')
    sh(f"git checkout -q --detach {cand}")
    (shim / "gh").write_text('#!/usr/bin/env bash\necho "gh: stubbed in the dry run" >&2\nexit 1\n')
    os.chmod(shim / "gh", 0o755)
    if os.name == "nt" or not shutil.which("python3"):  # a Windows dev box (its python3 may be a Store stub); the runner has python3
        (shim / "python3").write_text('#!/usr/bin/env bash\nexec python "$@"\n')
        os.chmod(shim / "python3", 0o755)
    summary = runner / "summary.md"
    summary.write_text("")
    (runner / "pending.json").write_text("null")
    (runner / "env").write_text("")
    env = dict(os.environ, RUNNER_TEMP=str(runner), GITHUB_STEP_SUMMARY=str(summary), GITHUB_ENV=str(runner / "env"),
               GITHUB_REPOSITORY="dryrun/dryrun", DRY_RUN="yes", PYTHONIOENCODING="utf-8", GH_TOKEN="",
               PATH=str(shim) + os.pathsep + os.environ["PATH"])
    ctx = {"inputs.dry_run": "yes", "inputs.now": a.now, "inputs.freeze_override": "", "inputs.sha": "", "inputs.resume": "",
           "github.event_name": "workflow_run", "github.event.workflow_run.id": "dry-run",
           "github.event.workflow_run.head_sha": cand, "github.event.workflow_run.conclusion": "success",
           "github.token": "", "secrets.GITHUB_TOKEN": ""}
    out = {"gate": {"verdict": "PROMOTE", "own": "yes"}, "exists": {"exists": "yes"}}

    def ev(expr: str) -> str:
        expr = expr.strip()
        m = re.fullmatch(r"(.+?)\s*\|\|\s*'([^']*)'", expr)
        if m and "&&" not in expr:
            return ev(m.group(1)) or m.group(2)
        m = re.fullmatch(r"steps\.([\w-]+)\.outputs\.([\w-]+)", expr)
        if m:
            return out.get(m.group(1), {}).get(m.group(2), "")
        if expr in ctx:
            return ctx[expr]
        if "steps.wait.outputs.sim_now" in expr:
            return out.get("wait", {}).get("sim_now") or a.now
        if expr == "inputs.dry_run == 'yes' && inputs.now || ''":
            return a.now
        return ""

    def cond(expr: str | None) -> bool:
        if not expr:
            return True
        e = re.sub(r"steps\.([\w-]+)\.outputs\.([\w-]+)", lambda m: repr(out.get(m.group(1), {}).get(m.group(2), "")), expr)
        e = re.sub(r"env\.(\w+)", lambda m: repr(env.get(m.group(1), "")), e)
        e = e.replace("always()", "True").replace("&&", " and ").replace("||", " or ").replace("!=", " != ")
        return bool(eval(e, {"__builtins__": {}}, {}))  # noqa: S307 -- our own workflow's expressions

    log = [f"simulated clock {a.now}; candidate (gated) {cand[:10]}; master tip (UNGATED) {tip[:10]}; production {prod[:10]}"]
    for sid in STEPS:
        s = steps[sid]
        if not cond(s.get("if")):
            log.append(f"--- {sid}: skipped (if: {s.get('if')})")
            continue
        script = re.sub(r"\$\{\{(.*?)\}\}", lambda m: ev(m.group(1)), s["run"])
        e = dict(env, **{k: re.sub(r"\$\{\{(.*?)\}\}", lambda m: ev(m.group(1)), str(v)) for k, v in (s.get("env") or {}).items()})
        o = runner / "out.txt"
        o.write_text("")
        e["GITHUB_OUTPUT"] = str(o)
        p = subprocess.run(["bash", "-c", script], cwd=work, env=e, capture_output=True, text=True)
        out[sid] = dict(l.split("=", 1) for l in o.read_text().splitlines() if "=" in l)
        for l in (runner / "env").read_text().splitlines():
            if "=" in l:
                env[l.split("=", 1)[0]] = l.split("=", 1)[1]
        log.append(f"--- {sid}: exit {p.returncode}\n{(p.stdout + p.stderr).strip()}\n    outputs: {out[sid]}")
    dec = json.loads((runner / "decision.json").read_text()) if (runner / "decision.json").exists() else {}
    prod_after = sh("git ls-remote origin refs/heads/production").split()[0]
    ok = dec.get("target") == cand and dec.get("target") != tip and prod_after == prod
    control = (f"CONTROL: target {str(dec.get('target'))[:10]} == gated candidate {cand[:10]}: {dec.get('target') == cand}; "
               f"!= ungated master tip {tip[:10]}: {dec.get('target') != tip}; production unchanged: {prod_after == prod}")
    shas = (f"SHAS: target={dec.get('target')} gated={cand} ungated_tip={tip} "
            f"production_before={prod} production_after={prod_after}")
    text = "\n".join(log) + "\n\n===== JOB SUMMARY =====\n" + summary.read_text() + "\n" + shas + "\n" + control
    print(text)
    if a.summary:
        with open(a.summary, "a", encoding="utf-8") as f:
            f.write(f"### Dry run, simulated clock `{a.now}`\n\n" + summary.read_text() + f"\n- `{shas}`\n- {control}\n\n")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
