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
     The wait spends the account's shared API quota sparingly (one conditional request per poll, 30/60/90 s backoff,
     a rate-limit answer is slept off) and prints the quota left at the start and the end: see "the GitHub API budget".

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
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime
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


# ---- the GitHub API budget (2026-11-19) -------------------------------------------------------------------------------
#: ⚰️ 2026-11-19 ~07:45Z the account's REST quota (5,000/hour, shared by EVERY session and agent on the PC) hit 0 and
#: blocked everyone's checks and merges. This tool was the main spender. Measured with GH_DEBUG=api: the old wait loop's
#: `gh run view --json status,conclusion,jobs` is THREE requests (the run, its workflow, its jobs), sent every 15 s =
#: 720/hour per waiting session; `gh run list --workflow` (finding the run, every 4 s) is two. A 15-40 min run spent
#: ~190-500 requests, and several sessions wait at once. Now: the dispatch returns the run id (one request), each poll is
#: ONE conditional request (a 304 Not Modified does not count against the quota), the polls back off, and a rate-limit
#: answer is slept off until the reset instead of failing the lane. tests/test_remote_tests_lane.py rails all of it.
POLL_FAST_S = 15                       # the test steps are done; only the uploads are left
POLL_EARLY_S, POLL_EARLY_UNTIL_S = 30, 120
POLL_MID_S, POLL_MID_UNTIL_S = 60, 600
POLL_LATE_S = 90
RUN_CHECK_EVERY = 10                   # also read the run itself every Nth poll (a run cancelled before any job)
FIND_RUN_POLL_S = 5
FRESH_RUN_GRACE_S = 90                 # a just-dispatched run may answer 404 for this long before it is readable
DISPATCH_5XX_GRACE_S = 120             # a dispatch answered 5xx may still have started a run: look this long for it
SECONDARY_LIMIT_WAIT_S = 60            # a secondary (abuse) limit with no Retry-After: GitHub's documented minimum
MAX_RATE_LIMIT_WAIT_S = 3700           # the primary window is one hour
RATE_LIMIT_RETRIES = 4
_TEST_STEPS = ("pytest", "vitest")     # the step names in remote-tests.yml (railed by the workflow tests above)


def poll_interval(elapsed_s: float, near_done: bool = False) -> int:
    """Seconds to wait before the next poll: 30 s for the first 2 min, 60 s to 10 min, 90 s after; 15 s once every
    unfinished job is past its test step (the answer is seconds away, so the result is never held up by the backoff)."""
    if near_done:
        return POLL_FAST_S
    if elapsed_s < POLL_EARLY_UNTIL_S:
        return POLL_EARLY_S
    if elapsed_s < POLL_MID_UNTIL_S:
        return POLL_MID_S
    return POLL_LATE_S


def near_done(jobs: list[dict]) -> bool:
    """Every job finished, or every unfinished one has finished its test step (only the verdict uploads are left)."""
    left = [j for j in jobs if j.get("status") != "completed"]
    if not jobs:
        return False
    return all(any(s.get("name") in _TEST_STEPS and s.get("status") == "completed" for s in (j.get("steps") or []))
               for j in left)


def parse_include(stdout: str) -> tuple[int, dict[str, str], str]:
    """`gh api --include` output -> (HTTP status, lower-cased headers, body). Status 0 when there is no status line
    (gh never reached GitHub: no network, not signed in)."""
    head, _, body = (stdout or "").replace("\r\n", "\n").partition("\n\n")
    lines = head.split("\n")
    m = re.match(r"HTTP/\S+\s+(\d{3})", lines[0] if lines else "")
    if not m:
        return 0, {}, stdout or ""
    headers = {}
    for ln in lines[1:]:
        k, sep, v = ln.partition(":")
        if sep:
            headers[k.strip().lower()] = v.strip()
    return int(m.group(1)), headers, body


def _gh_api_subprocess(method: str, path: str, headers: dict[str, str], body: dict | None) -> tuple[int, dict, str]:
    """One `gh api` request. gh resolves `{owner}/{repo}` from the checkout's remote locally (no request for it)."""
    cmd = ["gh", "api", "--include", "--method", method, path]
    for k, v in headers.items():
        cmd += ["-H", f"{k}: {v}"]
    if body is not None:
        cmd += ["--input", "-"]
    r = subprocess.run(cmd, input=json.dumps(body) if body is not None else None, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    status, hdrs, text = parse_include(r.stdout)
    if status == 0 or status >= 400:
        text = f"{text}\n{r.stderr or ''}".strip()
    return status, hdrs, text


def _json_or_none(text: str):
    try:
        return json.loads(text) if text and text.strip() else None
    except ValueError:
        return None


class GitHubApi:
    """Every REST request this tool sends, counted. A conditional GET sends the ETag of the last answer to the same
    path and a 304 answers from that copy (free); a 403/429 rate-limit answer sleeps until the reset and retries."""

    def __init__(self, runner=None, sleep=time.sleep, now=time.time, log=print):
        self._runner = runner or _gh_api_subprocess
        self.sleep, self.now, self._log = sleep, now, log
        self._etags: dict[str, tuple[str, object]] = {}
        self.sent = 0                  # requests that cost quota
        self.not_modified = 0          # 304s: free
        self.rate_limit_waits = 0
        self.remaining: int | None = None
        self.reset: int | None = None

    def _note_quota(self, headers: dict[str, str]) -> None:
        if headers.get("x-ratelimit-remaining", "").isdigit():
            self.remaining = int(headers["x-ratelimit-remaining"])
        if headers.get("x-ratelimit-reset", "").isdigit():
            self.reset = int(headers["x-ratelimit-reset"])

    def rate_limit_wait(self, status: int, headers: dict[str, str], text: str) -> float | None:
        """Seconds to sleep when this answer is a rate limit (None when it is not one)."""
        if status not in (403, 429):
            return None
        exhausted = headers.get("x-ratelimit-remaining") == "0"
        if not (exhausted or status == 429 or "rate limit" in (text or "").lower()):
            return None                # a real 403 (no access): not something waiting fixes
        retry_after = headers.get("retry-after", "")
        if retry_after.isdigit():
            wait = float(retry_after)
        elif exhausted and headers.get("x-ratelimit-reset", "").isdigit():
            wait = int(headers["x-ratelimit-reset"]) - self.now() + 5
        else:
            wait = SECONDARY_LIMIT_WAIT_S
        return min(max(wait, 5.0), MAX_RATE_LIMIT_WAIT_S)

    def request(self, method: str, path: str, body: dict | None = None, conditional: bool = False,
                wait_out_limits: bool = True):
        """(HTTP status, parsed JSON body or None). `wait_out_limits=False` returns a rate-limit answer as it is
        (an exit path must not sleep for up to an hour)."""
        for attempt in range(RATE_LIMIT_RETRIES + 1 if wait_out_limits else 1):
            cached = self._etags.get(path) if conditional else None
            hdrs = {"If-None-Match": cached[0]} if cached else {}
            status, headers, text = self._runner(method, path, hdrs, body)
            self._note_quota(headers)
            if status == 304 and cached:
                self.not_modified += 1
                return 200, cached[1]
            if status:
                self.sent += 1
            wait = self.rate_limit_wait(status, headers, text)
            if wait is None or not wait_out_limits:
                data = _json_or_none(text)
                if conditional and status == 200 and headers.get("etag"):
                    self._etags[path] = (headers["etag"], data)
                if data is None and (status == 0 or status >= 400):
                    data = {"message": (text or "").strip()[:400]}
                return status, data
            if attempt == RATE_LIMIT_RETRIES:
                break
            self.rate_limit_waits += 1
            until = time.strftime("%H:%M:%SZ", time.gmtime(self.now() + wait))
            self._log(f"remote tests: GitHub API rate limit (HTTP {status}); sleeping {int(wait)} s until {until}, "
                      "then retrying (the run keeps going on GitHub meanwhile)")
            self.sleep(wait)
        raise RuntimeError(f"GitHub API still rate limited after {RATE_LIMIT_RETRIES} waits: {method} {path}")

    def quota(self) -> dict | None:
        """The core quota. `GET /rate_limit` does not count against it."""
        try:
            _status, headers, text = self._runner("GET", "rate_limit", {}, None)
        except OSError:
            return None
        core = ((_json_or_none(text) or {}).get("resources") or {}).get("core")
        if core:
            self.remaining, self.reset = core.get("remaining"), core.get("reset")
        return core

    def wait_for_budget(self, need: int) -> None:
        """Before a burst we cannot make conditional (`gh run download`): sleep to the reset if it would not fit."""
        if self.remaining is None or self.reset is None or self.remaining >= need:
            return
        wait = min(self.reset - self.now() + 5, MAX_RATE_LIMIT_WAIT_S)
        if wait > 0:
            self.rate_limit_waits += 1
            self._log(f"remote tests: {self.remaining} API requests left, {need} needed; sleeping {int(wait)} s "
                      "until the quota resets")
            self.sleep(wait)


def quota_line(core: dict | None) -> str:
    if not core:
        return "quota unreadable"
    reset = time.strftime("%H:%M:%SZ", time.gmtime(core.get("reset") or 0))
    return f"{core.get('remaining')}/{core.get('limit')} left, resets {reset}"


# ---- admission: wait for room before enqueueing (2026-11-20) ----------------------------------------------------------
#: ⚰️ 2026-11-20 the account's 40-job pool was full for hours: master deploy gate jobs waited up to 21.6 min for a
#: runner (run 44857170200: a ~16 min gate took 44) while session runs sat in the same queue. GitHub has no job
#: priority, so the only lever is not to enqueue: before pushing its ref this tool waits while the gate has a job
#: waiting for a runner (rule A), or while MAX_REMOTE_IN_FLIGHT remote runs are going and other runs are queued
#: (rule B). It fails open and is capped (wait_for_room). Plan: docs/superpowers/plans/2026-11-20-remote-tests-admission.md
#: each remote run holds at most 4 vitest runners (`max-parallel`) plus pytest, so 4 runs hold at most 20 of 40 slots
MAX_REMOTE_IN_FLIGHT = 4
#: a run created longer ago than this is ignored: GitHub keeps 11 runs from 2026-11-11 "queued" with 0 jobs (cancel
#: answers 409, delete 403), one a master deploy gate run, which would otherwise hold rule A shut forever
FRESH_RUN_S = 6 * 3600


def _epoch(iso: str | None) -> float | None:
    """GitHub's `2026-11-21T03:00:00Z` -> epoch seconds; None when missing or unparseable."""
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp() if iso else None
    except ValueError:
        return None


def _fresh(runs: list[dict], now: float) -> list[dict]:
    out = []
    for r in runs or []:
        t = _epoch(r.get("created_at"))
        if t is not None and now - t <= FRESH_RUN_S:
            out.append(r)
    return out


def room_to_dispatch(gate_runs: list[dict], gate_jobs: dict[str, list[dict]], remote_runs: list[dict],
                     queued_runs: list[dict], now: float) -> tuple[bool, str]:
    """(may we enqueue now, why). A: a fresh deploy gate run is queued, or in progress with a job waiting for a
    runner (jobs are created only once their `needs:` finish, so a listed `queued` job IS waiting for a runner; a
    `pending` run waits on the previous gate, not on a runner). B: MAX_REMOTE_IN_FLIGHT fresh remote runs are
    queued or in progress AND some fresh run is queued (the pool is full)."""
    for run in _fresh(gate_runs, now):
        if run.get("status") == "queued":
            return False, f"deploy gate run {run.get('id')} is queued"
        if run.get("status") == "in_progress":
            waiting = sum(1 for j in gate_jobs.get(str(run.get("id")), []) if j.get("status") == "queued")
            if waiting:
                return False, f"deploy gate run {run.get('id')} has {waiting} job(s) waiting for a runner"
    in_flight = [r for r in _fresh(remote_runs, now) if r.get("status") in ("queued", "in_progress")]
    queued = [r for r in _fresh(queued_runs, now) if r.get("status") == "queued"]
    if len(in_flight) >= MAX_REMOTE_IN_FLIGHT and queued:
        return False, f"{len(in_flight)} remote runs in flight and {len(queued)} run(s) queued"
    return True, "room"


GATE_WORKFLOW = "master-deploy-gate.yml"


@dataclass
class Load:
    gate_runs: list[dict]
    gate_jobs: dict[str, list[dict]]
    remote_runs: list[dict]
    queued_runs: list[dict]


def read_load(api: GitHubApi) -> Load | None:
    """What room_to_dispatch needs, in at most 4 conditional requests (a 304 is free): the gate's recent runs, the
    jobs of a fresh in-progress gate run (normally 0 or 1 of them), the recent remote runs, the queued runs. None on
    ANY answer it cannot use: the caller then dispatches (fail open), and a rate limit is never slept on here."""
    def get(path: str, key: str) -> list | None:
        status, data = api.request("GET", path, conditional=True, wait_out_limits=False)
        if status != 200 or not isinstance(data, dict) or not isinstance(data.get(key), list):
            return None
        return data[key]

    try:
        gate_runs = get(f"{_REPO}/actions/workflows/{GATE_WORKFLOW}/runs?per_page=10", "workflow_runs")
        if gate_runs is None:
            return None
        gate_jobs: dict[str, list[dict]] = {}
        for run in _fresh(gate_runs, api.now()):
            if run.get("status") == "in_progress":
                jobs = get(f"{_REPO}/actions/runs/{run.get('id')}/jobs?per_page=100", "jobs")
                if jobs is None:
                    return None
                gate_jobs[str(run.get("id"))] = jobs
        remote_runs = get(f"{_REPO}/actions/workflows/{WORKFLOW}/runs?per_page=50", "workflow_runs")
        if remote_runs is None:
            return None
        queued_runs = get(f"{_REPO}/actions/runs?status=queued&per_page=100", "workflow_runs")
        if queued_runs is None:
            return None
    except (RuntimeError, OSError):
        return None
    return Load(gate_runs, gate_jobs, remote_runs, queued_runs)


ROOM_POLL_S = 60
#: up to this much extra per poll, so sessions waiting at once do not all re-check (and dispatch) in lockstep
ROOM_JITTER_S = 15


def wait_for_room(api: GitHubApi, max_wait_s: float, log=print, rand=random.random) -> str:
    """Wait until room_to_dispatch says yes. 'room', 'skipped' (max_wait_s <= 0: no request at all), 'unreadable'
    (fail open: any error reading the load dispatches now) or 'waited-out' (the cap: the request is never dropped).
    Called BEFORE the ref is pushed, so a wait that is stopped leaves no ref and no run behind."""
    if max_wait_s <= 0:
        return "skipped"
    start, last = api.now(), ""
    while True:
        try:
            load = read_load(api)
            if load is None:
                log("remote tests: CI load unreadable; dispatching now")
                return "unreadable"
            ok, why = room_to_dispatch(load.gate_runs, load.gate_jobs, load.remote_runs, load.queued_runs, api.now())
        except Exception as e:  # noqa: BLE001 -- fail open: a bug here must never hold a session's tests back
            log(f"remote tests: CI load check failed ({type(e).__name__}: {e}); dispatching now")
            return "unreadable"
        if ok:
            return "room"
        waited = api.now() - start
        if why != last:
            log(f"remote tests: waiting for CI room ({why}); {waited / 60:.0f} of up to {max_wait_s / 60:.0f} min")
            last = why
        if waited >= max_wait_s:
            log(f"remote tests: waited {waited / 60:.0f} min for room; dispatching anyway")
            return "waited-out"
        api.sleep(ROOM_POLL_S + rand() * ROOM_JITTER_S)


_REPO = "repos/{owner}/{repo}"


class RunState:
    """What the exit path must know before it may delete the ref: was a run dispatched, which one, has it ended."""

    def __init__(self):
        self.dispatched = False
        self.run_id: str | None = None
        self.done = False


def dispatch(api: GitHubApi, inputs: dict[str, str], find_timeout_s: int = 120,
             state: RunState | None = None) -> tuple[str, str] | None:
    """Dispatch the workflow on master; (run id, run URL). `return_run_details` makes the dispatch answer with the
    run, so no request is spent looking for it; an older API (204, no body) falls back to listing the runs."""
    state = state or RunState()
    status, data = api.request("POST", f"{_REPO}/actions/workflows/{WORKFLOW}/dispatches",
                               body={"ref": "master", "inputs": inputs, "return_run_details": True})
    if status >= 500:
        # ⚰️ 2026-11-19 (run 44552655327): GitHub answered HTTP 500 to the dispatch, this tool exited 2 and abandoned
        # the ref, and the run HAD started: it ran on that ref with nobody watching. A 5xx says the ANSWER failed, not
        # that the dispatch did (the same class as the fresh-run 404 above). So look for a run on OUR ref (the run name
        # carries it) for DISPATCH_5XX_GRACE_S; one that appears is followed as normal. None appearing is a failure,
        # and the ref is KEPT (state.dispatched): a run that shows up later must still find it.
        state.dispatched = True
        api._log(f"remote tests: dispatch answered HTTP {status}; looking for a run on {inputs['ref']} for "
                 f"{DISPATCH_5XX_GRACE_S} s before concluding")
        found = _find_run(api, inputs["ref"], DISPATCH_5XX_GRACE_S)
        if found:
            state.run_id = found[0]
            api._log(f"remote tests: the dispatch DID start run {found[0]}; following it")
            return found
        raise RuntimeError(f"dispatch failed (HTTP {status}) and no run on {inputs['ref']} appeared within "
                           f"{DISPATCH_5XX_GRACE_S} s: {(data or {}).get('message', '')}"[:400])
    if status not in (200, 204):
        raise RuntimeError(f"dispatch failed (HTTP {status}): {(data or {}).get('message', '')}"[:400])
    state.dispatched = True                             # from here a run may be live and reading the ref
    if status == 200 and isinstance(data, dict) and data.get("workflow_run_id"):
        state.run_id = str(data["workflow_run_id"])
        return state.run_id, str(data.get("html_url") or data.get("run_url") or "")
    found = _find_run(api, inputs["ref"], find_timeout_s)
    if found:
        state.run_id = found[0]
    return found


def _find_run(api: GitHubApi, ref: str, timeout_s: int = 120) -> tuple[str, str] | None:
    path = f"{_REPO}/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=20"
    deadline = api.now() + timeout_s
    while True:
        status, data = api.request("GET", path, conditional=True)
        if status == 200:
            for run in (data or {}).get("workflow_runs", []):
                if ref in (run.get("display_title") or ""):
                    return str(run["id"]), str(run.get("html_url") or "")
        if api.now() >= deadline:
            return None
        api.sleep(FIND_RUN_POLL_S)


def wait_for_run(api: GitHubApi, run_id: str, timeout_s: float, log=print) -> tuple[dict, list[dict]] | None:
    """Poll until the run completes: (run, jobs), or None at the timeout. ONE conditional request per poll (the jobs
    list); the run itself is read only when every job looks done, and every RUN_CHECK_EVERY-th poll."""
    base = f"{_REPO}/actions/runs/{run_id}"
    start = api.now()
    last, tick = "", 0
    answered: set[str] = set()         # the reads that have answered 200 at least once

    def not_yet(path: str, status: int) -> bool:
        """⚰️ 2026-11-19 (e83 train, run 44506488391): GitHub answered 404 for a run the dispatch had just
        returned, the tool exited 2, deleted its ref and stranded the run. A just-created run can be unreadable
        for a moment, so a 404 on a read that has never answered is retried for FRESH_RUN_GRACE_S."""
        if status == 404 and path not in answered and api.now() - start <= FRESH_RUN_GRACE_S:
            log(f"  run {run_id} not readable yet (HTTP 404); retrying")
            api.sleep(poll_interval(api.now() - start))
            return True
        if status == 200:
            answered.add(path)
        return False

    while True:
        tick += 1
        status, data = api.request("GET", f"{base}/jobs?per_page=100", conditional=True)
        if not_yet("jobs", status):
            continue
        if status != 200:
            raise RuntimeError(f"reading the run's jobs failed (HTTP {status}): {(data or {}).get('message', '')}")
        jobs = (data or {}).get("jobs") or []
        done = sum(1 for j in jobs if j.get("status") == "completed")
        phase = "in_progress" if any(j.get("status") != "queued" for j in jobs) else "queued"
        line = f"  {phase}: {done}/{len(jobs)} jobs done"
        if line != last:
            log(line)
            last = line
        if (jobs and done == len(jobs)) or tick % RUN_CHECK_EVERY == 0:
            status, run = api.request("GET", base, conditional=True)
            if not_yet("run", status):
                continue
            if status != 200:
                raise RuntimeError(f"reading the run failed (HTTP {status}): {(run or {}).get('message', '')}")
            if run.get("status") == "completed":
                if done != len(jobs) or not jobs:           # the snapshot predates the end: one more (often a 304)
                    status, data = api.request("GET", f"{base}/jobs?per_page=100", conditional=True)
                    jobs = (data or {}).get("jobs") or jobs
                return run, jobs
        if api.now() - start > timeout_s:
            return None
        api.sleep(poll_interval(api.now() - start, near_done(jobs)))


def _delete_ref(ref: str) -> None:
    subprocess.run(["git", "push", "--quiet", "origin", f":{ref}"], capture_output=True, text=True)


def release_ref(api: GitHubApi, ref: str, state: RunState, keep_ref: bool, delete=None, log=print) -> str:
    """Delete our ref, unless a run we dispatched may still be live and reading it. Then the run is cancelled
    FIRST (one request; a 409 means it already finished), and if that cannot be confirmed the ref is KEPT and
    the cleanup is printed. Returns 'deleted' or 'kept'. ⚰️ 2026-11-19: a fatal exit deleted the ref under a
    run that was still starting, which stranded it."""
    delete = delete or _delete_ref
    if keep_ref:
        return "kept"
    if state.dispatched and not state.done:
        cancelled = False
        if state.run_id:
            try:
                status, _ = api.request("POST", f"{_REPO}/actions/runs/{state.run_id}/cancel",
                                        wait_out_limits=False)
                cancelled = status in (202, 409)
            except (RuntimeError, OSError):
                cancelled = False
            if cancelled:
                log(f"remote tests: cancelled run {state.run_id} before deleting its ref")
        if not cancelled:
            which = f"run {state.run_id}" if state.run_id else "the dispatched run (id unknown)"
            log(f"remote tests: KEPT {ref}: {which} may still be live and reading it. Clean up when it is done:\n"
                + (f"  gh run cancel {state.run_id}\n" if state.run_id else "")
                + f"  git push origin :{ref}")
            return "kept"
    delete(ref)
    return "deleted"


def _download(api: GitHubApi, run_id: str, dest: Path, artifacts_hint: int) -> None:
    """`gh run download`: one request to list the artifacts plus one per artifact, none conditional."""
    api.wait_for_budget(artifacts_hint + 2)
    r = _run(["gh", "run", "download", run_id, "-D", str(dest)], check=False)
    if r.returncode != 0 and "rate limit" in f"{r.stdout}{r.stderr}".lower():
        api.quota()
        api.wait_for_budget(10 ** 6)                       # sleep to the reset, then one more try
        _run(["gh", "run", "download", run_id, "-D", str(dest)], check=False)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--pytest", nargs="*", default=[], help="repo-relative pytest paths / node ids (tests/... or api/...)")
    ap.add_argument("--vitest", nargs="*", default=[], help="app-relative vitest paths (src/...)")
    ap.add_argument("--shards", type=int, default=1, help=f"split the vitest files over N runners (1..{MAX_SHARDS})")
    ap.add_argument("--label", default="", help="free text in the run name")
    ap.add_argument("--keep-ref", action="store_true", help="do not delete refs/remote-tests/<id> afterwards")
    ap.add_argument("--timeout-min", type=int, default=60)
    ap.add_argument("--max-wait-min", type=int, default=30,
                    help="wait up to N min for CI room before dispatching (0 = do not wait; production incidents only)")
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

    api = GitHubApi()
    print(f"remote tests: GitHub API {quota_line(api.quota())} (shared by every session on this account)")
    # BEFORE the push (S1): a wait that is stopped leaves no ref and no run behind
    print(f"remote tests: admission {wait_for_room(api, a.max_wait_min * 60)}")
    print(f"remote tests: pushing {sha[:10]} to {ref} (no workflow triggers on this ref)")
    state = RunState()
    try:
        _run(["git", "push", "--quiet", "origin", f"{sha}:{ref}"])
        found = dispatch(api, {"ref": ref, "pytest": " ".join(a.pytest), "vitest": " ".join(a.vitest),
                               "vitest_shards": str(a.shards), "label": a.label, "env": " ".join(a.env)},
                         state=state)
        if not found:
            print("remote tests: dispatched, but the run did not appear within 2 min"); return LANE
        run_id, url = found
        print(f"remote tests: run {url or run_id}")
        got = wait_for_run(api, run_id, a.timeout_min * 60)
        if got is None:
            print(f"remote tests: still running after {a.timeout_min} min"); return LANE
        run, jobs = got
        state.done = True
        test_jobs = [j for j in jobs if j.get("name", "").startswith(("pytest", "vitest"))
                     and j.get("conclusion") != "skipped"]
        tmp = Path(tempfile.mkdtemp(prefix="remote-tests-"))
        _download(api, run_id, tmp, 2 * len(test_jobs))
        verdicts = read_verdicts(tmp)
        outs = collect_outputs(tmp, Path(a.download) if a.download else None)
        if outs:
            print(f"remote tests: {OUT_DIR}/ outputs: " + ", ".join(str(o) for o in outs))
        for j in sorted(jobs, key=lambda j: j.get("name", "")):
            print(f"  {j.get('conclusion') or j.get('status'):<9} {j.get('name')}")
        for k in sorted(verdicts):
            print(f"  verdict   {k}: {verdicts[k]}")
        code, why = decide(run.get("conclusion"), len(test_jobs), verdicts)
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
        release_ref(api, ref, state, a.keep_ref)
        print(f"remote tests: GitHub API {quota_line(api.quota())}; this run sent {api.sent} request(s) "
              f"(+{api.not_modified} answered 304, free; gh run download not counted), "
              f"{api.rate_limit_waits} rate-limit wait(s)")


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
