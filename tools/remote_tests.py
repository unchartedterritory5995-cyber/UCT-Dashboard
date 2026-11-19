"""Run focused tests on GitHub's runners instead of the one dev PC (`remote tests` workflow).

WHY (2026-11-16, GitHub Pro rollout): every session's heavy test run queues on ONE Windows box under
`uct-clips/tools/heavy_lock.py`, one job at a time, with hard RAM limits (feedback_pc_load_limits). The repo is
public, so standard runners are free and the account now runs 40 jobs at once. This sends a session's tests there.

HOW (what the tool does, in order):
  1. tests the COMMITTED state of HEAD (uncommitted edits are NOT included; the tool says so if the tree is dirty);
  2. pushes HEAD to `refs/remote-tests/<id>`: a ref OUTSIDE refs/heads, so no push-triggered workflow fires and
     nothing deploys. The repo is PUBLIC, so the commit is readable like any branch push (push protection still runs);
  3. dispatches `.github/workflows/remote-tests.yml` ON MASTER with that ref and the test paths. The workflow
     definition therefore always comes from master: a branch cannot change how its own tests are run;
  4. waits, prints each job's verdict and the failing test ids, then deletes the ref (`--keep-ref` keeps it).

Usage (from a uct-dashboard checkout, after committing):
    python tools/remote_tests.py --pytest tests/test_a.py tests/test_b.py::test_x
    python tools/remote_tests.py --vitest src/pages/charts src/agent/nl --shards 4
    python tools/remote_tests.py --pytest tests/test_a.py --vitest src/lib --label "my change"
    # a measurement that writes output (2026-11-18): allowlisted env only, outputs under remote-out/ come back
    python tools/remote_tests.py --vitest src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js \
        --env VENDOR_HARNESS_RUNTIME_ON=1 --env VENDOR_HARNESS_OUT=../remote-out/runtime-on --download out
Exit: 0 all green, 1 a test job failed, 2 the lane itself could not run (bad input, push/dispatch error, timeout).

The workflow's `plan` job runs `python tools/remote_tests.py --validate-inputs` (master's copy) on the dispatch
inputs, so this file is the ONE authority on what an acceptable path, ref and shard count are.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path

WORKFLOW = "remote-tests.yml"
REF_PREFIX = "refs/remote-tests/"
#: at most 6 shards per request, and the workflow runs at most 4 of them at once (`max-parallel`): the 40-job pool is
#: shared with the master deploy gate (14 jobs), and session runs must not starve deploys.
MAX_SHARDS = 6
#: a path or a pytest node id: no spaces, no shell metacharacters. (What keeps a path from being an OPTION is the
#: required `PYTEST_ROOTS` / `src/` prefix in validate(), the one rule for that; a second leading-character rule here
#: could never fire on its own, so it is not kept.)
_SAFE = re.compile(r"^[A-Za-z0-9_./:\[\]=-]+$")
_REF = re.compile(r"^(refs/remote-tests/[A-Za-z0-9._-]{1,80}|refs/heads/[A-Za-z0-9._/-]{1,120})$")
#: the folders a pytest path may start with: pytest.ini's `testpaths`, one prefix each. ⚰️ 2026-11-18 this was `tests/`
#: alone, so the 203 suites under `api/**` -- run by no other job either -- could not be sent here at all. The plan job
#: has only this file checked out, so the list lives here; tests/test_remote_tests_lane.py pins it to pytest.ini.
PYTEST_ROOTS = ("tests/", "api/")
OK, FAIL, LANE = 0, 1, 2
#: (2026-11-18, D1) The ONLY environment variables a request may set for its tests: the measurement switches and
#: paths the opt-in census / harness tests read (`process.env.X` in app/src), so a run that measures something can
#: run here instead of under the one PC's heavy lock. ⛔ NO SECRETS EVER: this workflow has none and must stay that
#: way; a name not on this list is refused, whatever it is. ⛔ Licence-held data stays OFF runners (the repo is
#: public): `PINE_LIBRARY_STORE` and the TradingView reference paths are deliberately absent.
#: tests/test_remote_tests_lane.py checks every name here is really read somewhere (no dead entries).
ENV_ALLOWLIST = frozenset({
    "VENDOR_HARNESS_DIR", "VENDOR_HARNESS_OUT", "VENDOR_HARNESS_RUNTIME_ON", "VENDOR_HARNESS_PAINTS",
    "VENDOR_HARNESS_OBJECT_COLOUR", "VENDOR_BATCH_CENSUS", "VENDOR_BATCH_CENSUS_OUT", "VENDOR_BATCH_CENSUS_RUNTIME",
    "CAPABILITY_CENSUS_OUT", "HISTORY_CENSUS_OUT", "VOCAB_CENSUS", "VOCAB_CENSUS_OUT", "VAR_READ_CENSUS",
    "VAR_READ_CENSUS_ONLY", "VAR_READ_CENSUS_OUT", "VAR_SEED_CENSUS", "VAR_SEED_CENSUS_OUT", "PINE_COLOUR_CENSUS",
    "PINE_COLOUR_CENSUS_DIR", "PINE_COLOUR_CENSUS_OUT", "RUNTIME_PERF_CENSUS", "PARTIAL_CENSUS_RUNTIME_ON",
    "PERSISTENCE_CENSUS_STRICT", "UIE_LIMITS_CENSUS", "RUN_HALF_SAMPLE", "RUN_HALF_OUT", "RUN_HALF_REACH",
    "RUN_HALF_INPUTS_FULL",
})
#: a value: no spaces, quotes, `$`, backticks, backslashes, globs or newlines (it travels through $GITHUB_ENV).
_ENV_VALUE = re.compile(r"^[A-Za-z0-9_./:;,=+-]{0,200}$")
MAX_ENV = 8
#: Everything a test writes under remote-out/ is uploaded as an artifact; an *_OUT variable must point inside it
#: (repo-relative for pytest, `../remote-out/` for vitest, which runs in app/), or its output would be lost.
OUT_DIR = "remote-out"
_OUT_PREFIXES = (f"{OUT_DIR}/", f"../{OUT_DIR}/")


def validate_env(pairs: list[str]) -> list[str]:
    """Every reason these KEY=VALUE pairs are refused (empty list = accepted)."""
    errs = []
    if len(pairs) > MAX_ENV:
        errs.append(f"{len(pairs)} env pairs; at most {MAX_ENV}")
    seen = set()
    for p in pairs:
        name, sep, value = p.partition("=")
        if not sep:
            errs.append(f"env {p!r} is not KEY=VALUE")
            continue
        if name not in ENV_ALLOWLIST:
            errs.append(f"env {name!r} is not on the allowlist (measurement switches and paths only; never a secret)")
        if not _ENV_VALUE.match(value):
            errs.append(f"env {name} value has characters outside [A-Za-z0-9_./:;,=+-] or is over 200 long")
        if name.endswith("_OUT") and not value.startswith(_OUT_PREFIXES):
            errs.append(f"env {name}={value!r} must point inside {OUT_DIR}/ (it is the only folder uploaded)")
        if name in seen:
            errs.append(f"env {name} given twice")
        seen.add(name)
    return errs


# ---- validation: the ONE authority, shared by the workflow's plan job -------------------------------------------------
def validate(ref: str, pytest_paths: list[str], vitest_paths: list[str], shards: str | int,
             env_pairs: list[str] | None = None) -> list[str]:
    """Every reason these inputs are refused (empty list = accepted)."""
    errs = validate_env(env_pairs or [])
    if not _REF.match(ref or ""):
        errs.append(f"ref {ref!r} is not refs/remote-tests/<id> or refs/heads/<branch>")
    if not pytest_paths and not vitest_paths:
        errs.append("nothing to run: give --pytest and/or --vitest paths")
    for p in pytest_paths:
        if not _SAFE.match(p) or ".." in p:
            errs.append(f"pytest path {p!r} has characters outside [A-Za-z0-9_./:[]=-] or a '..'")
        elif not p.startswith(PYTEST_ROOTS):
            errs.append(f"pytest path {p!r} must start with one of {', '.join(PYTEST_ROOTS)} (repo-relative)")
    for p in vitest_paths:
        if not _SAFE.match(p) or ".." in p:
            errs.append(f"vitest path {p!r} has characters outside [A-Za-z0-9_./:[]=-] or a '..'")
        elif not p.startswith("src/"):
            errs.append(f"vitest path {p!r} must start with src/ (app-relative, as vitest prints it)")
    try:
        n = int(str(shards))
        if not 1 <= n <= MAX_SHARDS:
            errs.append(f"shards {n} outside 1..{MAX_SHARDS}")
    except ValueError:
        errs.append(f"shards {shards!r} is not an integer")
    return errs


def _validate_inputs_from_env() -> int:
    """The workflow's plan job: read the dispatch inputs from env (never interpolated into shell), refuse or emit."""
    ref = os.environ.get("RT_REF", "")
    py = os.environ.get("RT_PYTEST", "").split()
    js = os.environ.get("RT_VITEST", "").split()
    shards = os.environ.get("RT_SHARDS", "1").strip() or "1"
    env_pairs = os.environ.get("RT_ENV", "").split()
    errs = validate(ref, py, js, shards, env_pairs)
    for e in errs:
        print(f"::error::{e}")
    if errs:
        return FAIL
    out = os.environ.get("GITHUB_OUTPUT")
    lines = [f"has_pytest={'true' if py else 'false'}",
             f"has_vitest={'true' if js else 'false'}",
             f"shards={json.dumps(list(range(1, int(shards) + 1)))}",
             f"shard_count={int(shards)}",
             # validated above: single spaces between KEY=VALUE pairs, no newline, nothing a shell would expand
             f"env={' '.join(env_pairs)}"]
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return OK


# ---- the session side ---------------------------------------------------------------------------------------------
def _run(cmd: list[str], check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(cmd, capture_output=capture, text=True)
    if check and r.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd[:4])} ... failed ({r.returncode}): {(r.stderr or r.stdout).strip()[:400]}")
    return r


def ref_name(sha: str, label: str, now: float | None = None) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", label or "run").strip("-")[:30] or "run"
    return f"{REF_PREFIX}{time.strftime('%Y%m%d-%H%M%S', time.gmtime(now))}-{sha[:10]}-{slug}"


def failing_tests(junit_dir: Path) -> list[str]:
    """`<classname>::<name> - first line of the message` for every failed/errored case in every junit file."""
    out = []
    for f in sorted(junit_dir.rglob("*.xml")):
        if any(part.startswith(f"{OUT_DIR}-") for part in f.relative_to(junit_dir).parts):
            continue                       # a test's own output (remote-out/), never a junit file
        try:
            root = ET.parse(f).getroot()
        except ET.ParseError:
            out.append(f"{f.name}: unreadable junit file")
            continue
        for case in root.iter("testcase"):
            bad = case.find("failure") if case.find("failure") is not None else case.find("error")
            if bad is not None:
                msg = (bad.get("message") or (bad.text or "")).strip().splitlines()
                out.append(f"{case.get('classname', '')}::{case.get('name', '')} - {msg[0][:160] if msg else ''}")
    return out


def read_verdicts(artifact_dir: Path) -> dict[str, str]:
    """{'pytest' | 'vitest-<n>': 'success' | 'failure' | ...} from the `*-verdict*.txt` files the test jobs upload."""
    out = {}
    for f in sorted(artifact_dir.rglob("remote-*-verdict*.txt")):
        name = f.stem.replace("remote-", "").replace("-verdict", "")
        out[name] = f.read_text(encoding="utf-8", errors="replace").strip()
    return out


def collect_outputs(artifact_dir: Path, dest: Path | None) -> list[Path]:
    """The `remote-out-*` artifacts the test jobs uploaded (what the tests wrote under remote-out/). With `dest`,
    each is copied to dest/<artifact name>/ and those copies are returned; without it, the downloaded folders."""
    found = sorted(p for p in artifact_dir.glob(f"{OUT_DIR}-*") if p.is_dir())
    if dest is None:
        return found
    out = []
    for p in found:
        target = dest / p.name
        shutil.copytree(p, target, dirs_exist_ok=True)
        out.append(target)
    return out


def decide(run_conclusion: str | None, test_jobs: int, verdicts: dict[str, str]) -> tuple[int, str]:
    """The verdict. A red TEST result no longer fails the run (so it sends no failure email); the run fails only
    when the lane itself broke. So: run not green -> LANE; any test verdict not success -> FAIL; every test job
    must have left a verdict, or the answer is unknown -> LANE."""
    if run_conclusion != "success":
        return LANE, f"the lane itself failed (run {run_conclusion}): checkout, install or validation"
    if len(verdicts) < test_jobs:
        return LANE, f"only {len(verdicts)} of {test_jobs} test jobs left a verdict"
    bad = sorted(k for k, v in verdicts.items() if v != "success")
    if bad:
        return FAIL, "tests failed in: " + ", ".join(f"{k} ({verdicts[k]})" for k in bad)
    return OK, f"{len(verdicts)} test job(s) green"


def _find_run(ref: str, timeout_s: int = 120) -> str | None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        r = _run(["gh", "run", "list", "--workflow", WORKFLOW, "--limit", "20",
                  "--json", "databaseId,displayTitle"], check=False)
        if r.returncode == 0:
            for run in json.loads(r.stdout or "[]"):
                if ref in (run.get("displayTitle") or ""):
                    return str(run["databaseId"])
        time.sleep(4)
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--pytest", nargs="*", default=[], help="repo-relative pytest paths / node ids (tests/... or api/...)")
    ap.add_argument("--vitest", nargs="*", default=[], help="app-relative vitest paths (src/...)")
    ap.add_argument("--shards", type=int, default=1, help=f"split the vitest files over N runners (1..{MAX_SHARDS})")
    ap.add_argument("--label", default="", help="free text in the run name")
    ap.add_argument("--keep-ref", action="store_true", help="do not delete refs/remote-tests/<id> afterwards")
    ap.add_argument("--timeout-min", type=int, default=60)
    ap.add_argument("--env", action="append", default=[], metavar="KEY=VALUE",
                    help=f"an allowlisted measurement variable for the tests (repeatable; *_OUT must be under {OUT_DIR}/)")
    ap.add_argument("--download", metavar="DIR", help=f"copy what the tests wrote under {OUT_DIR}/ into DIR")
    ap.add_argument("--validate-inputs", action="store_true", help=argparse.SUPPRESS)
    a = ap.parse_args(argv)
    if a.validate_inputs:
        return _validate_inputs_from_env()

    for tool in ("git", "gh"):
        if not shutil.which(tool):
            print(f"remote tests: `{tool}` is not on PATH"); return LANE
    sha = _run(["git", "rev-parse", "HEAD"]).stdout.strip()
    ref = ref_name(sha, a.label)
    errs = validate(ref, a.pytest, a.vitest, a.shards, a.env)
    if errs:
        print("remote tests: refused\n  " + "\n  ".join(errs)); return LANE
    if _run(["git", "status", "--porcelain", "--untracked-files=no"]).stdout.strip():
        print("remote tests: NOTE the tree has uncommitted edits; only the committed HEAD is tested")

    print(f"remote tests: pushing {sha[:10]} to {ref} (no workflow triggers on this ref)")
    try:
        _run(["git", "push", "--quiet", "origin", f"{sha}:{ref}"])
        _run(["gh", "workflow", "run", WORKFLOW, "--ref", "master",
              "-f", f"ref={ref}", "-f", f"pytest={' '.join(a.pytest)}", "-f", f"vitest={' '.join(a.vitest)}",
              "-f", f"vitest_shards={a.shards}", "-f", f"label={a.label}", "-f", f"env={' '.join(a.env)}"])
        run_id = _find_run(ref)
        if not run_id:
            print("remote tests: dispatched, but the run did not appear within 2 min"); return LANE
        repo = _run(["gh", "repo", "view", "--json", "url", "-q", ".url"]).stdout.strip()
        print(f"remote tests: run {repo}/actions/runs/{run_id}")
        deadline, last = time.time() + a.timeout_min * 60, ""
        while True:
            v = json.loads(_run(["gh", "run", "view", run_id, "--json", "status,conclusion,jobs"]).stdout)
            done = sum(1 for j in v["jobs"] if j.get("status") == "completed")
            line = f"  {v['status']}: {done}/{len(v['jobs'])} jobs done"
            if line != last:
                print(line); last = line
            if v["status"] == "completed":
                break
            if time.time() > deadline:
                print(f"remote tests: still running after {a.timeout_min} min"); return LANE
            time.sleep(15)
        test_jobs = [j for j in v["jobs"] if j.get("name", "").startswith(("pytest", "vitest"))
                     and j.get("conclusion") != "skipped"]
        tmp = Path(tempfile.mkdtemp(prefix="remote-tests-"))
        _run(["gh", "run", "download", run_id, "-D", str(tmp)], check=False)
        verdicts = read_verdicts(tmp)
        outs = collect_outputs(tmp, Path(a.download) if a.download else None)
        if outs:
            print(f"remote tests: {OUT_DIR}/ outputs: " + ", ".join(str(o) for o in outs))
        for j in sorted(v["jobs"], key=lambda j: j.get("name", "")):
            print(f"  {j.get('conclusion') or j.get('status'):<9} {j.get('name')}")
        for k in sorted(verdicts):
            print(f"  verdict   {k}: {verdicts[k]}")
        code, why = decide(v.get("conclusion"), len(test_jobs), verdicts)
        if code == OK:
            print(f"remote tests: GREEN ({why})"); return OK
        bad = failing_tests(tmp)
        label = "RED" if code == FAIL else "LANE ERROR"
        print(f"remote tests: {label}: {why}; {len(bad)} failing test(s)")
        for b in bad[:60]:
            print("  " + b)
        if len(bad) > 60:
            print(f"  ... {len(bad) - 60} more; artifacts in {tmp}")
        if code == FAIL and not bad:
            print(f"  no junit failures parsed; read the logs in {tmp}")
        return code
    except RuntimeError as e:
        print(f"remote tests: {e}"); return LANE
    finally:
        if not a.keep_ref:
            subprocess.run(["git", "push", "--quiet", "origin", f":{ref}"], capture_output=True, text=True)


if __name__ == "__main__":
    # ⛔ A failing test's NAME can hold any character (an em dash, a "⛔"). On a Windows console the
    # stream is cp1252, and on 2026-11-16 printing one raised UnicodeEncodeError half way through the
    # verdict: the rest of the failing ids were never printed and the exit code was the traceback's,
    # not the verdict's. Replace what the console cannot show; the run's own artifacts keep the text.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
