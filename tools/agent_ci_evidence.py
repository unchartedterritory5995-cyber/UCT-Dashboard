"""Exact merge-tree evidence for an agent/** PR into master (P2 2026-11-17; P2b: self-built merge, same day).

WHY: agent-ci.yml's push run proves the PR HEAD (on its old base); the tree that lands on master is the MERGE of that
head with master's current tip. agent-ci.yml runs its full jobs on `pull_request` into master for same-repo agent/**
heads (on refs/pull/N/merge as GitHub computed it when the event fired), and on a RE-ARM `repository_dispatch`
(event_type agent-ci-evidence, P2c: the ONE re-arm path; workflow_dispatch is no longer a trigger and never accepted) from
tools/agent_ci_rearm.py, which runs on a merge commit the tool built ITSELF (`git merge-tree --write-tree` +
`git commit-tree -p <master tip> -p <PR head>`) and pushed to the tool-owned ref refs/agent-ci-evidence/pr-<N>.
A repository_dispatch run's GITHUB_SHA is master's TIP, never the tested commit: a record's `sha` is always
`git rev-parse HEAD` after checkout, and the payload's merge_sha is only checked against it.
GitHub's refs/pull/N/merge is never relied on to be current: it goes stale while master moves (P2b). Every required
job uploads one evidence record (`agent-ci-evidence-pr<N>-<job key>`): the commit it tested, its tree, its two parents
(base tip, PR head) and the failed test names per suite. This tool turns those records into a PASS/FAIL for ONE PR and
ONE expected tree. It trusts the tested commit's CONTENT (parents + tree read from the commit object in CI), never a
ref name or an author: whoever built the commit, it counts only if its parents are the master tip and PR head AT
VERIFY TIME and its tree is the tree the caller computed.

    python tools/agent_ci_evidence.py verify --pr <n> --tree <expected tree sha> [--accept-dispatch] [--root <master checkout>]
    python tools/agent_ci_evidence.py record --job-key <key> [--junit f.xml] [--vitest-json f.json ...] --out evidence.json
        (`record` runs inside agent-ci.yml; stdlib only, so it works in jobs that never install PyYAML)

`verify` reads the PR, the base branch tip, the agent ci runs and their artifacts through the `gh` CLI (read-only
`gh api` GETs + `gh run download`), plus (with --accept-dispatch) refs/agent-ci-evidence/pr-<N> by `git ls-remote`, and prints PASS with the evidence, or FAIL with the reason. Exit 0 = PASS only.
It FAILS CLOSED on every one of these (each is a named guard; tests/test_agent_ci_evidence.py drives each one):
  pr-not-open / pr-not-master / pr-not-agent-head   the PR is not an open same-repo agent/** PR into master
  self-protected-diff the PR edits a file its own run executes (workflows, tools/agent_ci_*.py, the suite lock, the
                      shard planner + timings, vitest / vite config + setupFiles + the configs' relative imports,
                      app/scripts/**, app/package*.json, pytest.ini, conftest.py, requirements*.txt), or
                      its diff is unreadable: its run could vouch for itself, so AUDIT's local evidence decides instead
  no-run              no pull_request (or, with --accept-dispatch, rearm) agent ci run for this PR
  run-in-progress     the newest such run (or any dispatch run, with --accept-dispatch) is not completed
  non-pr-event        the chosen run, or any record in it, is not a pull_request (/ rearm) run of THIS PR
  dispatch-ref        a re-arm run whose workflow did not come from master's .github/workflows/agent-ci.yml, whose
                      head_sha (the workflow commit) is not on master's current history, or a re-arm record whose
                      GITHUB_REF is not refs/heads/master
  missing-job         a required job (agent-ci.yml, matrix-expanded) is absent from the run
  job-not-success     a required job, or the run, did not conclude success
  missing-artifact    a required job's evidence record is absent or unreadable
  record-mismatch     the records disagree on the merge commit / tree, or name another run or PR
  wrong-parents       the tested commit is not a two-parent merge
  stale-base          its first parent is not master's tip NOW (master moved: re-arm)
  stale-head          its second parent is not the PR head NOW (the PR moved: re-arm)
  tree-mismatch       its tree is not the expected tree (e.g. a forged commit with the right parents)
  evidence-ref        a re-arm run whose commit is not what refs/agent-ci-evidence/pr-<N> points at now (absent,
                      unreadable, or overwritten by a later re-arm): only the tool's latest merge for this PR counts
Any API / download error is a FAIL (`api-error`).

MERGE QUEUE (2026-11-22; inert until a queue exists on master): agent-ci-queue.yml calls agent-ci.yml on a `merge_group`
event. There GITHUB_SHA IS the commit under test (GitHub's merge group commit: first parent = the queue's base, second =
the PR head), so `record` compares HEAD to it and to the event's merge_group.head_sha, and reads the PR number from the
queue's branch name (queue_pr). `verify --pr --tree` does not read those records: it accepts pull_request (/ rearm) runs
only, so a merge_group record can never pass it. The queue's own verdict is tools/agent_ci_required.py follow_verdict.

    python tools/agent_ci_evidence.py verify --pr <n> --merge-group <landed master commit> [--root <master checkout>]

is the WRITTEN TRAIL for a PR that landed through the queue (AUDIT 8.3 on #2495; decide_merge_group): PASS only when
the landed commit is on master's first-parent chain and is the head_sha of a merge_group run of agent-ci-queue.yml, the
queue ref names the PR, all the required jobs' records agree on sha, tree and parents and name that commit, and the PR
head is the second parent. It reads through `gh` like the other mode, plus `git fetch origin master` + `git rev-list
--first-parent` in --root (the local object store and FETCH_HEAD only; never the remote).

The required jobs are read from agent-ci.yml under --root, which should be a MASTER checkout: a PR cannot drop a job
from its own verdict (the same reason agent-ci-required runs the default branch's copy).
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

SCHEMA = "uct.agent-ci-evidence/v1"
ARTIFACT_PREFIX = "agent-ci-evidence-pr"
WORKFLOW_FILE = "agent-ci.yml"
PR_EVENT, DISPATCH_EVENT = "pull_request", "repository_dispatch"
#: the repository_dispatch event_type agent-ci.yml listens for (its `types:`) and tools/agent_ci_rearm.py sends
DISPATCH_TYPE = "agent-ci-evidence"
PR_RE = re.compile(r"[1-9][0-9]{0,6}\Z")
SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
#: a merge-queue run: agent-ci-queue.yml calls agent-ci.yml, and a called workflow sees its caller's event
MERGE_GROUP_EVENT = "merge_group"
#: the temporary branch GitHub builds ONE queued PR into master on (rehearsed 2026-11-22). It is the only place a
#: merge_group event names its PR; any other shape names none (fail closed)
QUEUE_REF_RE = re.compile(r"(?:refs/heads/)?gh-readonly-queue/master/pr-([1-9][0-9]{0,6})-[0-9a-f]{40}\Z")


class ApiError(RuntimeError):
    pass


def queue_pr(head_ref) -> int | None:
    """The PR number in a merge group's head_ref (`refs/heads/gh-readonly-queue/master/pr-<N>-<sha>`), else None."""
    m = QUEUE_REF_RE.match(head_ref) if isinstance(head_ref, str) else None
    return int(m.group(1)) if m else None


# ============================================================================================ record (runs in CI)
def _git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout.strip()


def commit_parents(rev: str = "HEAD") -> list[str]:
    """Parents from the commit object itself, so a shallow checkout (fetch-depth 1) still answers."""
    body = _git("cat-file", "-p", rev)
    return [ln.split()[1] for ln in body.split("\n\n", 1)[0].splitlines() if ln.startswith("parent ")]


def junit_failures(path: str) -> list[str]:
    """`file::name` of every failed / errored testcase in a pytest --junitxml report."""
    out = []
    for case in ET.parse(path).getroot().iter("testcase"):
        if any(child.tag in ("failure", "error") for child in case):
            cls, name = case.get("classname", ""), case.get("name", "")
            out.append(f"{cls}::{name}" if cls else name)
    return sorted(set(out))


def rA_failures(text: str) -> list[str]:
    """`FAILED x::y` / `ERROR x::y` lines of a `pytest -rA` short test summary (the reason after ` - ` is dropped)."""
    out = []
    for ln in text.splitlines():
        m = re.match(r"(FAILED|ERROR) (\S+)", ln)
        if m:
            out.append(m.group(2))
    return sorted(set(out))


def vitest_failures(path: str) -> list[str]:
    """`<file> > <full test name>` of every failed assertion in a vitest --reporter=json report; a file that failed
    to load (no assertions, status failed) is listed by its file name alone."""
    data = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    out = []
    for f in data.get("testResults") or []:
        name = re.sub(r"^.*?/app/", "app/", str(f.get("name", "")).replace("\\", "/"))
        failed = [a for a in f.get("assertionResults") or [] if a.get("status") == "failed"]
        out += [f"{name} > {a.get('fullName') or a.get('title')}" for a in failed]
        if not failed and f.get("status") == "failed":
            out.append(name)
    return sorted(set(out))


def build_record(job_key: str, env: dict, event: dict, head: str, tree: str, parents: list[str],
                 junit=None, vitest=(), rA_logs=()) -> dict:
    ev = env.get("GITHUB_EVENT_NAME", "")
    if ev == PR_EVENT:
        pr = (event.get("pull_request") or {}).get("number")
        want_sha = env.get("GITHUB_SHA", "")
    elif ev == DISPATCH_EVENT:
        # P2c: client_payload is attacker-controlled; it only NAMES what should have been checked out. GITHUB_SHA is
        # master's tip here, so it is never the comparison; `head` (git rev-parse HEAD after checkout) is what is recorded.
        payload = event.get("client_payload") if isinstance(event.get("client_payload"), dict) else {}
        pr, want_sha = payload.get("pr"), payload.get("merge_sha")
        want_sha = want_sha if isinstance(want_sha, str) else ""
    elif ev == MERGE_GROUP_EVENT:
        # merge queue: GITHUB_SHA is the merge group's commit, i.e. the commit under test (unlike a dispatch, where it
        # is master's tip). The PR is named only by the queue's branch; nothing in the event is a payload to trust.
        group = event.get("merge_group") if isinstance(event.get("merge_group"), dict) else {}
        pr, want_sha = queue_pr(group.get("head_ref")), env.get("GITHUB_SHA", "")
    else:
        pr, want_sha = None, env.get("GITHUB_SHA", "")
    suites, missing = {}, []
    for kind, paths, parse in (("pytest", [junit] if junit else [], junit_failures), ("vitest", list(vitest), vitest_failures),
                               ("pytest-rA", list(rA_logs), lambda p: rA_failures(pathlib.Path(p).read_text(encoding="utf-8", errors="replace")))):
        for p in paths:
            try:
                suites.setdefault(kind, []).extend(parse(p))
            except (OSError, ValueError, ET.ParseError):
                missing.append(p)
    errors = []
    if not SHA_RE.match(want_sha or "") or head != want_sha:
        errors.append(f"checked-out HEAD {head} is not the event's merge commit {want_sha!r}")
    if ev == PR_EVENT and not re.fullmatch(r"[1-9][0-9]*", str(pr or "")):
        errors.append(f"no PR number on a {ev} event: {pr!r}")
    if ev == DISPATCH_EVENT:
        if type(pr) not in (int, str) or not PR_RE.match(str(pr)):   # never a bool / float / list
            errors.append(f"client_payload.pr is not a PR number: {pr!r}"[:200])
            pr = None
        if event.get("action") != DISPATCH_TYPE:
            errors.append(f"repository_dispatch event_type {event.get('action')!r} is not {DISPATCH_TYPE!r}"[:200])
    if ev == MERGE_GROUP_EVENT:
        if pr is None:
            errors.append(f"the merge group's head_ref names no queued PR: {group.get('head_ref')!r}"[:200])
        if group.get("head_sha") != head:
            errors.append(f"checked-out HEAD {head} is not the merge group's head_sha {group.get('head_sha')!r}"[:200])
    return {
        "schema": SCHEMA, "job_key": job_key, "event": ev, "pr": int(pr) if re.fullmatch(r"[0-9]+", str(pr or "")) else None,
        "ref": env.get("GITHUB_REF", ""), "sha": head, "tree": tree, "parents": parents,
        "base_sha": parents[0] if len(parents) == 2 else None, "head_sha": parents[1] if len(parents) == 2 else None,
        "payload_base_sha": (event.get("pull_request") or {}).get("base", {}).get("sha"),
        "payload_head_sha": (event.get("pull_request") or {}).get("head", {}).get("sha"),
        "run_id": int(env["GITHUB_RUN_ID"]) if str(env.get("GITHUB_RUN_ID", "")).isdigit() else None,
        "run_attempt": int(env["GITHUB_RUN_ATTEMPT"]) if str(env.get("GITHUB_RUN_ATTEMPT", "")).isdigit() else None,
        "failed": {k: sorted(set(v)) for k, v in suites.items()}, "reports_unreadable": missing, "errors": errors,
    }


def cmd_record(a) -> int:
    env = dict(os.environ)
    event = {}
    if env.get("GITHUB_EVENT_PATH") and pathlib.Path(env["GITHUB_EVENT_PATH"]).is_file():
        event = json.loads(pathlib.Path(env["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    rec = build_record(a.job_key, env, event, _git("rev-parse", "HEAD"), _git("rev-parse", "HEAD^{tree}"),
                       commit_parents(), junit=a.junit, vitest=a.vitest_json, rA_logs=a.pytest_log)
    pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(a.out).write_text(json.dumps(rec, indent=1, sort_keys=True), encoding="utf-8")
    print(json.dumps({k: rec[k] for k in ("job_key", "event", "pr", "sha", "tree", "base_sha", "head_sha", "errors")}))
    for suite, names in rec["failed"].items():
        print(f"{suite}: {len(names)} failed" + "".join(f"\n  {n}" for n in names[:50]))
    return 1 if rec["errors"] else 0


# ============================================================================================ required job keys
def required_keys(doc: dict) -> dict[str, str]:
    """{job display name (as the Actions API reports it): evidence key}. Keys are the job id, + `-<matrix value>`
    for a matrix job; the names come from tools/agent_ci_required.required_jobs (the one expansion rule)."""
    from tools import agent_ci_required as acr   # PyYAML lives behind this import; `record` never needs it
    out: dict[str, str] = {}
    for jid, job in (doc.get("jobs") or {}).items():
        names = acr.required_jobs({"jobs": {jid: job}})
        matrix = (job.get("strategy") or {}).get("matrix") or {}
        if len(names) == 1 and not re.search(r"\$\{\{\s*matrix\.", job.get("name", jid)):
            out[names[0]] = jid
            continue
        (var, values), = matrix.items()
        for name, value in zip(names, values):
            out[name] = f"{jid}-{value}"
    return out


# ============================================================================================ self-protected paths
#: F1 (AUDIT T2 of #1644): a pull_request run executes the MERGE REF's workflow, record tool, test config and
#: dependencies. A PR that edits any of them could manufacture its own PASS, so its evidence is never accepted here
#: (`self-protected-diff`); such a PR falls back to AUDIT's local evidence. Glob semantics: tools/agent_ci_required.matches.
SELF_PROTECTED = (
    ".github/workflows/**",
    # AUDIT review 2 of #2501, finding 4: a local action is code a job executes. No Agent job uses one today; the day
    # one does, it must already be protected (the queue's follower trusts the Agent jobs' conclusions only because
    # every file they execute is self-protected).
    ".github/actions/**",
    # finding 2: the rails that hold the Agent CI workflows, the verdict and these tools. They are Agent paths too
    # (agent-ci.yml `paths:`), so an edit to one is Agent + self-protected: AUDIT decides.
    "tests/test_ci_agent_merge_ref.py", "tests/test_agent_ci_required.py", "tests/test_agent_ci_evidence.py",
    "tools/agent_ci_*.py", "tools/agent_suite_lock.py",
    # F4: the browser job executes the shard planner and reads its committed timings
    "tools/agent_vitest_shards.py", "tools/agent_vitest_shard_timings.json",
    # F4: code the configs import (vite.config.js imports ./scripts/chartLibraryPatch.mjs); config_imports() also
    # derives every relative import of the configs, transitively, wherever it lives
    "app/scripts/**",
    "app/package*.json", "app/vite*.config.*", "app/vitest*.config.*",
    "pytest.ini", "conftest.py", "**/conftest.py",
    "requirements*.txt", "**/requirements*.txt",
)
WF_PATH = ".github/workflows/" + WORKFLOW_FILE


_SF_LIT = r"\[[^\]]*\]|'[^']*'|\"[^\"]*\"|`[^`]*`"


def vitest_setup_files(root: str | pathlib.Path = ".") -> list[str]:
    """Repo paths of every vitest `setupFiles` entry in app/vite*.config.* and app/vitest*.config.* under `root`
    (a MASTER checkout). A config that names setupFiles in a shape this cannot read, or no setupFiles anywhere, raises
    (verify turns that into a FAIL): an unread setup file is an unprotected one."""
    app = pathlib.Path(root) / "app"
    configs = sorted({*app.glob("vite*.config.*"), *app.glob("vitest*.config.*")})
    out: list[str] = []
    for cfg in configs:
        text = cfg.read_text(encoding="utf-8", errors="replace")
        # Every `setupFiles:` occurrence must be a literal, or a conditional `<cond> ? <literal> : <literal>` whose
        # condition holds no string / bracket; both branches are protected (a superset is the safe side).
        for occ in re.finditer(r"setupFiles\s*:", text):
            at = text[occ.end():]
            t = re.match(r"\s*([^?'\"`\[\]{},;]+?)\s*\?\s*(" + _SF_LIT + r")\s*:\s*(" + _SF_LIT + r")(?=\s*[,}])", at)
            m = re.match(r"\s*(" + _SF_LIT + r")(?=\s*[,}])", at)   # nothing may follow the literal (.concat(X), + X, ...)
            lits = [t.group(2), t.group(3)] if t else [m.group(1)] if m else None
            if lits is None:
                raise ValueError(f"{cfg.name}: setupFiles is not a literal this can read")
            for lit in lits:
                names = re.findall(r"'([^']+)'|\"([^\"]+)\"|`([^`]+)`", lit)
                rest = re.sub(r"'[^']*'|\"[^\"]*\"|`[^`]*`|[\s,\[\]]", "", lit)
                if not names or rest:   # an identifier / spread / call in the list: a file this cannot name
                    raise ValueError(f"{cfg.name}: unreadable setupFiles {lit[:60]!r}")
                for groups in names:
                    rel = next(g for g in groups if g)
                    out.append(os.path.normpath(os.path.join("app", rel)).replace("\\", "/"))
    if not out:
        raise ValueError("no vitest setupFiles found in app/vite*.config.* / app/vitest*.config.*")
    return sorted(set(out))


_IMPORT_RE = re.compile(r"""(?:\bimport\s+(?:[^'"`;]*?\s+from\s+)?|\bexport\s+[^'"`;]*?\s+from\s+|\brequire\s*\(\s*|\bimport\s*\(\s*)(['"`])([^'"`]+)\1""")
_DYNAMIC_RE = re.compile(r"""\b(?:require|import)\s*\(\s*(?!['"`])""")
_EXTS = ("", ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts", ".jsx", ".tsx", ".json", "/index.js", "/index.mjs", "/index.ts")


def config_imports(root: str | pathlib.Path = ".") -> list[str]:
    """F4: repo paths of every file the vite / vitest configs import by a RELATIVE specifier, followed transitively
    through the imported files. Fail closed (raises): a relative import that resolves to no file, or a require() /
    import() whose argument is not a string literal, in any file of that closure. Bare package imports are covered by
    app/package*.json."""
    root = pathlib.Path(root).resolve()
    app = root / "app"
    todo = sorted({*app.glob("vite*.config.*"), *app.glob("vitest*.config.*")})
    seen: set[pathlib.Path] = set()
    out: set[str] = set()
    while todo:
        f = todo.pop()
        if f in seen:
            continue
        seen.add(f)
        text = f.read_text(encoding="utf-8", errors="replace")
        text = re.sub(r"/[*].*?[*]/", "", text, flags=re.S)           # block comments
        text = re.sub(r"(?m)(^|\s)//.*$", r"\1", text)                 # line comments (not the // of a URL in a string)
        if _DYNAMIC_RE.search(text):
            raise ValueError(f"{f.relative_to(root).as_posix()}: a require()/import() of a non-literal: imports unreadable")
        for _, spec in _IMPORT_RE.findall(text):
            if not spec.startswith("."):
                continue
            base = (f.parent / spec)
            hit = next((pathlib.Path(str(base) + e) for e in _EXTS if pathlib.Path(str(base) + e).is_file()), None)
            if hit is None:
                raise ValueError(f"{f.relative_to(root).as_posix()}: relative import {spec!r} resolves to no file")
            hit = hit.resolve()
            try:
                out.add(hit.relative_to(root).as_posix())
            except ValueError:
                raise ValueError(f"{f.relative_to(root).as_posix()}: relative import {spec!r} leaves the repository") from None
            todo.append(hit)
    return sorted(out)


def protected_patterns(root: str | pathlib.Path = ".") -> list[str]:
    return [*SELF_PROTECTED, *vitest_setup_files(root), *config_imports(root)]


def self_protected_hits(changed_paths, patterns) -> list[str] | None:
    """The PR's changed paths that are self-protected; None when the diff is unknown (unreadable / truncated)."""
    if changed_paths is None:
        return None
    from tools import agent_ci_required as acr
    return [f for f in changed_paths if acr.matches(f, list(patterns))]


# ============================================================================================ verify (pure)
def _fail(code: str, why: str) -> tuple[str, str, dict]:
    return "FAIL", f"{code}: {why}", {}


EVIDENCE_NS = "refs/agent-ci-evidence/"


def evidence_ref(n: int) -> str:
    """The tool-owned ref a re-arm of PR <n> pushes its merge commit to (tools/agent_ci_rearm.py writes it)."""
    return f"{EVIDENCE_NS}pr-{int(n)}"


def decide(pr: dict, base_tip: str, runs: list[dict], keys: dict[str, str], expected_tree: str,
           accept_events=(PR_EVENT,), dispatch_busy: bool = False, changed_paths=None, protected=SELF_PROTECTED,
           evidence_ref_sha: str | None = None):
    """pr: {number, state, head_sha, head_ref, head_repo, repo, base_ref}. base_tip: the base branch tip now.
    runs: candidate agent ci runs for THIS PR (pull_request runs of the PR, + rearm dispatch runs naming it), each
      {id, event, status, conclusion, created_at, html_url, head_branch, path, head_sha, jobs: [{name, conclusion}],
      records: {key: record|None}}; a dispatch run also carries head_on_master (its head_sha is an ancestor of base_tip,
      read by gather()).
    keys: required job name -> evidence key. changed_paths: the PR's files vs its merge base (None = unknown).
    protected: protected_patterns(master root). evidence_ref_sha: where refs/agent-ci-evidence/pr-<N> points now (None =
      absent / unread). changed_paths is the PR's diff vs its merge base with master, NOT the evidence commit's diff:
      building the merge ourselves never narrows the self-protected check. Returns (PASS|FAIL, reason, evidence)."""
    n = pr.get("number")
    if pr.get("state") != "open":  # guard: pr-not-open
        return _fail("pr-not-open", f"PR #{n} is {pr.get('state')}")
    if pr.get("base_ref") != "master":  # guard: pr-not-master
        return _fail("pr-not-master", f"PR #{n} targets {pr.get('base_ref')!r}, not master")
    if pr.get("head_repo") != pr.get("repo") or not str(pr.get("head_ref") or "").startswith("agent/"):  # guard: pr-not-agent-head
        return _fail("pr-not-agent-head", f"PR #{n} head {pr.get('head_repo')}:{pr.get('head_ref')} is not a same-repo agent/** branch")
    hits = self_protected_hits(changed_paths, protected)
    if hits is None:  # guard: diff-unknown
        return _fail("self-protected-diff", f"PR #{n}'s changed-file list is unreadable or truncated: use AUDIT's local evidence")
    if hits:  # guard: self-protected-diff
        return _fail("self-protected-diff", f"PR #{n} edits {len(hits)} self-protected path(s) ({hits[0]}): its own run "
                     "could vouch for itself; use AUDIT's local evidence")
    if not keys:  # guard: no-required-jobs
        return _fail("missing-job", "no required jobs could be read from agent-ci.yml")
    cands = [r for r in runs if r.get("event") in accept_events]
    if not cands:  # guard: no-run
        return _fail("no-run", f"no {'/'.join(accept_events)} agent ci run for PR #{n}")
    run = max(cands, key=lambda r: (r.get("created_at") or "", r.get("id") or 0))
    if run.get("status") != "completed":  # guard: run-in-progress
        return _fail("run-in-progress", f"the newest run {run.get('id')} is {run.get('status')}")
    if dispatch_busy and DISPATCH_EVENT in accept_events:  # guard: dispatch-in-progress
        return _fail("run-in-progress", "a repository_dispatch agent ci run is still in progress (it may be a rearm of this PR)")
    if run.get("event") not in (PR_EVENT, DISPATCH_EVENT):  # guard: non-pr-event-run
        return _fail("non-pr-event", f"run {run.get('id')} is a {run.get('event')} run")
    if run.get("event") == DISPATCH_EVENT and run.get("head_branch") != "master":  # guard: dispatch-not-master
        return _fail("dispatch-ref", f"re-arm run {run.get('id')} ran the workflow from {run.get('head_branch')!r}, not master")
    if run.get("event") == DISPATCH_EVENT and run.get("path") != WF_PATH:  # guard: dispatch-wrong-workflow
        return _fail("dispatch-ref", f"re-arm run {run.get('id')} ran {run.get('path')!r}, not {WF_PATH}")
    if run.get("event") == DISPATCH_EVENT and run.get("head_on_master") is not True:  # guard: dispatch-head-not-on-master
        return _fail("dispatch-ref", f"re-arm run {run.get('id')} ran the workflow at {run.get('head_sha')!r}, which is not "
                     f"an ancestor of master's tip {base_tip}")
    by_name: dict[str, list] = {}
    for j in run.get("jobs") or []:
        by_name.setdefault(j.get("name"), []).append(j.get("conclusion"))
    missing = [name for name in keys if name not in by_name]
    if missing:  # guard: missing-job
        return _fail("missing-job", f"{len(missing)} required job(s) absent from run {run.get('id')}: {missing[0]}")
    bad = [name for name in keys if any(c != "success" for c in by_name[name])]
    if bad:  # guard: job-not-success
        return _fail("job-not-success", f"{len(bad)} required job(s) not success: {bad[0]} ({by_name[bad[0]]})")
    if run.get("conclusion") != "success":  # guard: run-not-success
        return _fail("job-not-success", f"run {run.get('id')} concluded {run.get('conclusion')}")
    records = run.get("records") or {}
    absent = [k for k in keys.values() if not isinstance(records.get(k), dict)]
    if absent:  # guard: missing-artifact
        return _fail("missing-artifact", f"{len(absent)} evidence record(s) missing: {ARTIFACT_PREFIX}{n}-{absent[0]}")
    recs = [records[k] for k in keys.values()]
    for k, rec in zip(keys.values(), recs):
        if rec.get("schema") != SCHEMA or rec.get("job_key") != k:  # guard: record-schema
            return _fail("missing-artifact", f"record {k} is not a {SCHEMA} record for that job")
        if rec.get("event") != run.get("event") or rec.get("event") not in accept_events:  # guard: non-pr-event-record
            return _fail("non-pr-event", f"record {k} is from a {rec.get('event')!r} run")
        if rec.get("pr") != n or rec.get("run_id") != run.get("id"):  # guard: record-other-run
            return _fail("record-mismatch", f"record {k} names PR {rec.get('pr')} run {rec.get('run_id')}, not PR #{n} run {run.get('id')}")
        if rec.get("event") == DISPATCH_EVENT and rec.get("ref") != "refs/heads/master":  # guard: dispatch-record-ref
            return _fail("dispatch-ref", f"re-arm record {k} ran from {rec.get('ref')!r}, not refs/heads/master")
        if rec.get("errors"):  # guard: record-errors
            return _fail("record-mismatch", f"record {k} reports: {rec['errors'][0]}")
    if len({(r.get("sha"), r.get("tree")) for r in recs}) != 1:  # guard: records-disagree
        return _fail("record-mismatch", "the jobs' records name different merge commits / trees")
    rec = recs[0]
    if len(rec.get("parents") or []) != 2:  # guard: not-a-merge
        return _fail("wrong-parents", f"{rec.get('sha')} has parents {rec.get('parents')}, not a two-parent merge")
    if rec["parents"][0] != base_tip:  # guard: stale-base
        return _fail("stale-base", f"merged onto base {rec['parents'][0]}, but {pr.get('base_ref')} is now {base_tip}: rearm")
    if rec["parents"][1] != pr.get("head_sha"):  # guard: stale-head
        return _fail("stale-head", f"merged PR head {rec['parents'][1]}, but the PR head is now {pr.get('head_sha')}: rearm")
    if rec.get("tree") != expected_tree:  # guard: tree-mismatch
        return _fail("tree-mismatch", f"merge tree {rec.get('tree')} != expected {expected_tree}")
    if run.get("event") == DISPATCH_EVENT and (not SHA_RE.match(str(evidence_ref_sha or "")) or evidence_ref_sha != rec.get("sha")):  # guard: evidence-ref
        return _fail("evidence-ref", f"re-arm commit {rec.get('sha')} is not what {evidence_ref(n)} points at ({evidence_ref_sha})")
    failed = {}
    for r in recs:
        for suite, names in (r.get("failed") or {}).items():
            failed.setdefault(suite, []).extend(names)
    evidence = {"pr": n, "run_id": run.get("id"), "run_url": run.get("html_url"), "event": run.get("event"),
                "merge_sha": rec.get("sha"), "tree": rec.get("tree"), "base_sha": rec["parents"][0],
                "head_sha": rec["parents"][1], "jobs": len(keys), "records": len(recs),
                "failed_tests": {k: sorted(set(v)) for k, v in failed.items()}}
    return "PASS", f"run {run.get('id')} passed all {len(keys)} required jobs on merge tree {rec.get('tree')}", evidence


# ============================================================================================ verify --merge-group (pure)
#: how far back along master's first-parent chain `verify --merge-group` looks for the landed commit by default
FIRST_PARENT_LIMIT = 5000


def decide_merge_group(pr: dict, landed: str, on_first_parent, runs: list[dict], keys: dict[str, str]):
    """The written trail for ONE PR that landed through the merge queue (AUDIT 8.3 on #2495): was `landed`, a commit on
    master, the commit its Agent jobs tested? pr: {number, head_sha} (the PR as it is now; it is closed once landed).
    on_first_parent: True when `landed` is on master's first-parent chain (False / None: it is not, or it was not read).
    runs: the agent-ci-queue.yml runs whose head_sha is `landed`, each {id, event, status, conclusion, created_at,
    html_url, head_branch, path, head_sha, jobs: [{name, conclusion}], records: {key: record|None}}.
    keys: required job name -> evidence key (master's agent-ci.yml). Returns (PASS|FAIL, reason, evidence).
    AUDIT's four points, each a named guard, plus the same job and record guards `decide` has:
      not-landed       `landed` is not on master's first-parent chain                                   (point 1)
      no-run           no merge_group run of agent-ci-queue.yml tested exactly `landed`                 (point 1)
      queue-ref        the run's queue branch, or a record's ref, does not name this PR                 (point 2)
      record-mismatch  the 18 records disagree on sha / tree / parents, name another run or PR, are not
                       merge_group records, report an error, or name a commit that is not `landed`      (point 3)
      wrong-parents / stale-head   the tested commit is not a two-parent merge / its second parent is
                       not the PR head                                                                  (point 4)
      run-in-progress, missing-job, job-not-success, missing-artifact   as in `decide`."""
    from tools import agent_ci_required as acr
    n = pr.get("number")
    if not SHA_RE.match(str(landed or "")):  # guard: mg-landed-not-a-sha
        return _fail("not-landed", f"{landed!r} is not a full 40-hex commit")
    if on_first_parent is not True:  # guard: mg-not-on-first-parent
        return _fail("not-landed", f"{landed} is not on master's first-parent chain (or the chain could not be read)")
    cands = [r for r in runs if r.get("event") == MERGE_GROUP_EVENT and r.get("path") == acr.QUEUE_WORKFLOW.as_posix()
             and r.get("head_sha") == landed]
    if not cands:  # guard: mg-no-run
        return _fail("no-run", f"no merge_group run of {acr.QUEUE_WORKFLOW.as_posix()} tested {landed}")
    run = max(cands, key=lambda r: (r.get("created_at") or "", r.get("id") or 0))
    if run.get("status") != "completed":  # guard: mg-run-in-progress
        return _fail("run-in-progress", f"the newest run {run.get('id')} is {run.get('status')}")
    if type(n) is not int or queue_pr(run.get("head_branch")) != n:  # guard: mg-queue-ref-run
        return _fail("queue-ref", f"run {run.get('id')} ran on {run.get('head_branch')!r}, which does not name PR #{n}")
    if not keys:  # guard: mg-no-required-jobs
        return _fail("missing-job", "no required jobs could be read from agent-ci.yml")
    prefix = acr.QUEUE_CALL_JOB + " / "
    by_name: dict[str, list] = {}
    for j in run.get("jobs") or []:
        if str(j.get("name") or "").startswith(prefix):
            by_name.setdefault(j["name"][len(prefix):], []).append(j.get("conclusion"))
    missing = [name for name in keys if name not in by_name]
    if missing:  # guard: mg-missing-job
        return _fail("missing-job", f"{len(missing)} required job(s) absent from run {run.get('id')}: {missing[0]}")
    bad = [name for name in keys if any(c != "success" for c in by_name[name])]
    if bad:  # guard: mg-job-not-success
        return _fail("job-not-success", f"{len(bad)} required job(s) not success: {bad[0]} ({by_name[bad[0]]})")
    records = run.get("records") or {}
    absent = [k for k in keys.values() if not isinstance(records.get(k), dict)]
    if absent:  # guard: mg-missing-artifact
        return _fail("missing-artifact", f"{len(absent)} evidence record(s) missing: {ARTIFACT_PREFIX}{n}-{absent[0]}")
    recs = [records[k] for k in keys.values()]
    for k, rec in zip(keys.values(), recs):
        if rec.get("schema") != SCHEMA or rec.get("job_key") != k:  # guard: mg-record-schema
            return _fail("missing-artifact", f"record {k} is not a {SCHEMA} record for that job")
        if rec.get("event") != MERGE_GROUP_EVENT:  # guard: mg-record-event
            return _fail("record-mismatch", f"record {k} is from a {rec.get('event')!r} run, not a merge_group one")
        if rec.get("pr") != n or rec.get("run_id") != run.get("id"):  # guard: mg-record-other-run
            return _fail("record-mismatch", f"record {k} names PR {rec.get('pr')} run {rec.get('run_id')}, not PR #{n} run {run.get('id')}")
        if queue_pr(rec.get("ref")) != n:  # guard: mg-queue-ref-record
            return _fail("queue-ref", f"record {k} ran on {rec.get('ref')!r}, which does not name PR #{n}")
        if rec.get("errors"):  # guard: mg-record-errors
            return _fail("record-mismatch", f"record {k} reports: {rec['errors'][0]}")
    if len({(r.get("sha"), r.get("tree"), tuple(r.get("parents") or [])) for r in recs}) != 1:  # guard: mg-records-disagree
        return _fail("record-mismatch", "the jobs' records name different commits / trees / parents")
    rec = recs[0]
    if rec.get("sha") != landed:  # guard: mg-record-not-landed
        return _fail("record-mismatch", f"the records name {rec.get('sha')}, not the landed commit {landed}")
    if len(rec.get("parents") or []) != 2:  # guard: mg-not-a-merge
        return _fail("wrong-parents", f"{rec.get('sha')} has parents {rec.get('parents')}, not a two-parent merge")
    if not SHA_RE.match(str(pr.get("head_sha") or "")) or rec["parents"][1] != pr.get("head_sha"):  # guard: mg-stale-head
        return _fail("stale-head", f"the tested commit merged {rec['parents'][1]}, but PR #{n}'s head is {pr.get('head_sha')}")
    failed = {}
    for r in recs:
        for suite, names in (r.get("failed") or {}).items():
            failed.setdefault(suite, []).extend(names)
    evidence = {"pr": n, "run_id": run.get("id"), "run_url": run.get("html_url"), "event": run.get("event"),
                "landed_sha": landed, "merge_sha": rec.get("sha"), "tree": rec.get("tree"), "base_sha": rec["parents"][0],
                "head_sha": rec["parents"][1], "queue_ref": run.get("head_branch"), "jobs": len(keys), "records": len(recs),
                "failed_tests": {k: sorted(set(v)) for k, v in failed.items()}}
    return "PASS", (f"PR #{n} landed as {landed}: run {run.get('id')} passed all {len(keys)} required jobs on that commit "
                    f"(tree {rec.get('tree')})"), evidence


# ============================================================================================ GitHub reads (gh)
class GhApi:
    """Read-only: `gh api` GETs, `gh run download` and `git ls-remote`. Never posts, pushes, dispatches or reruns anything."""

    def __init__(self, repo: str):
        self.repo = repo

    def get(self, path: str):
        url = path if path.startswith("repos/") else f"repos/{self.repo}/{path.lstrip('/')}"
        p = subprocess.run(["gh", "api", "-X", "GET", url], capture_output=True, text=True, encoding="utf-8")
        if p.returncode != 0:
            raise ApiError(f"GET {url}: {p.stderr.strip()[:200]}")
        try:
            return json.loads(p.stdout or "null")
        except ValueError as e:
            raise ApiError(f"GET {url}: {e}") from e

    def remote_ref(self, ref: str) -> str | None:
        """The sha `ref` points at on the remote (read-only `git ls-remote`), or None when it does not exist."""
        p = subprocess.run(["git", "ls-remote", f"https://github.com/{self.repo}.git", ref], capture_output=True, text=True, encoding="utf-8")
        if p.returncode != 0:
            raise ApiError(f"ls-remote {ref}: {p.stderr.strip()[:200]}")
        hits = [ln.split("\t") for ln in p.stdout.splitlines() if ln.endswith("\t" + ref)]
        return hits[0][0] if len(hits) == 1 else None

    def on_first_parent(self, root, sha: str, limit: int = FIRST_PARENT_LIMIT) -> bool:
        """Is `sha` one of the newest `limit` commits of master's FIRST-PARENT chain? Asked of git in `root` after a
        fetch of master (local objects and FETCH_HEAD only): the REST API lists a branch's commits in no such order."""
        for argv in (["fetch", "--no-tags", "--quiet", f"https://github.com/{self.repo}.git", "refs/heads/master"],
                     ["rev-list", "--first-parent", f"--max-count={int(limit)}", "FETCH_HEAD"]):
            p = subprocess.run(["git", "-C", str(root), *argv], capture_output=True, text=True, encoding="utf-8")
            if p.returncode != 0:
                raise ApiError(f"git {argv[0]} (master's first-parent chain): {p.stderr.strip()[:200]}")
        return sha in p.stdout.split()

    def download(self, run_id: int, name: str, dest: str) -> None:
        p = subprocess.run(["gh", "run", "download", str(run_id), "-R", self.repo, "-n", name, "-D", dest],
                           capture_output=True, text=True, encoding="utf-8")
        if p.returncode != 0:
            raise ApiError(f"download {name} of run {run_id}: {p.stderr.strip()[:200]}")


def _pr_info(api, n: int) -> dict:
    p = api.get(f"pulls/{n}") or {}
    return {"number": p.get("number"), "state": p.get("state"), "head_sha": (p.get("head") or {}).get("sha"),
            "head_ref": (p.get("head") or {}).get("ref"), "head_repo": ((p.get("head") or {}).get("repo") or {}).get("full_name"),
            "repo": ((p.get("base") or {}).get("repo") or {}).get("full_name"), "base_ref": (p.get("base") or {}).get("ref")}


def _jobs(api, run_id: int) -> list[dict]:
    jobs, page = [], 1
    while True:
        got = (api.get(f"actions/runs/{run_id}/jobs?filter=latest&per_page=100&page={page}") or {}).get("jobs", [])
        jobs += [{"name": j.get("name"), "conclusion": j.get("conclusion")} for j in got]
        if len(got) < 100:
            return jobs
        page += 1


def _records(api, run_id: int, n: int, keys: dict[str, str]) -> dict:
    """{key: record or None}. An artifact that is absent, expired or unreadable is None (missing-artifact)."""
    arts = {a.get("name"): a for a in (api.get(f"actions/runs/{run_id}/artifacts?per_page=100") or {}).get("artifacts", [])}
    out = {}
    with tempfile.TemporaryDirectory() as tmp:
        for k in keys.values():
            name = f"{ARTIFACT_PREFIX}{n}-{k}"
            a = arts.get(name)
            if not a or a.get("expired"):
                out[k] = None
                continue
            dest = os.path.join(tmp, name)
            api.download(run_id, name, dest)
            f = pathlib.Path(dest) / "evidence.json"
            try:
                out[k] = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                out[k] = None
    return out


def _is_ancestor(api, sha, tip) -> bool:
    """Is `sha` (a dispatch run's workflow commit) on `tip`'s history? Read-only compare; anything unreadable is False."""
    if not SHA_RE.match(str(sha or "")) or not SHA_RE.match(str(tip or "")):
        return False
    c = api.get(f"compare/{sha}...{tip}?per_page=1") or {}
    return c.get("status") in ("ahead", "identical") and (c.get("merge_base_commit") or {}).get("sha") == sha


def gather(api, n: int, keys: dict[str, str], accept_dispatch: bool):
    pr = _pr_info(api, n)
    base_tip = ((api.get(f"git/ref/heads/{pr.get('base_ref')}") or {}).get("object") or {}).get("sha") if pr.get("base_ref") else None
    wf = f"actions/workflows/{WORKFLOW_FILE}/runs"
    runs = []
    for r in (api.get(f"{wf}?event={PR_EVENT}&branch={pr.get('head_ref')}&per_page=50") or {}).get("workflow_runs", []):
        nums = [p.get("number") for p in r.get("pull_requests") or []]
        if r.get("event") == PR_EVENT and (n in nums or (not nums and r.get("head_branch") == pr.get("head_ref"))):
            runs.append(r)
    dispatch_busy = False
    if accept_dispatch:
        for r in (api.get(f"{wf}?event={DISPATCH_EVENT}&per_page=30") or {}).get("workflow_runs", []):
            if r.get("status") != "completed":
                dispatch_busy = True
                continue
            names = {a.get("name") for a in (api.get(f"actions/runs/{r['id']}/artifacts?per_page=100") or {}).get("artifacts", [])}
            if any(str(x).startswith(f"{ARTIFACT_PREFIX}{n}-") for x in names):   # a rearm of THIS PR (records re-checked)
                runs.append(r)
    newest = max(runs, key=lambda r: (r.get("created_at") or "", r.get("id") or 0)) if runs else None
    out = []
    for r in runs:
        item = {k: r.get(k) for k in ("id", "event", "status", "conclusion", "created_at", "html_url", "head_branch", "path", "head_sha")}
        if r is newest and r.get("status") == "completed":   # only the run decide() will judge is read in full
            item["jobs"] = _jobs(api, r["id"])
            item["records"] = _records(api, r["id"], n, keys)
            if r.get("event") == DISPATCH_EVENT:
                item["head_on_master"] = _is_ancestor(api, r.get("head_sha"), base_tip)
        out.append(item)
    from tools import agent_ci_required as acr
    changed = acr.pr_changed_paths(api, n)   # pulls/N/files: the diff vs the merge base; None when truncated
    ref_sha = api.remote_ref(evidence_ref(n)) if accept_dispatch else None
    return pr, base_tip, out, dispatch_busy, changed, ref_sha


def gather_merge_group(api, n: int, landed: str, keys: dict[str, str], root, limit: int = FIRST_PARENT_LIMIT):
    """(pr, on_first_parent, runs) for decide_merge_group. Only the newest completed run is read in full."""
    from tools import agent_ci_required as acr
    pr = _pr_info(api, n)
    wf = f"actions/workflows/{acr.QUEUE_WORKFLOW.name}/runs"
    found = [r for r in (api.get(f"{wf}?event={MERGE_GROUP_EVENT}&head_sha={landed}&per_page=50") or {}).get("workflow_runs", [])
             if r.get("head_sha") == landed]
    newest = max(found, key=lambda r: (r.get("created_at") or "", r.get("id") or 0)) if found else None
    runs = []
    for r in found:
        item = {k: r.get(k) for k in ("id", "event", "status", "conclusion", "created_at", "html_url", "head_branch", "path", "head_sha")}
        if r is newest and r.get("status") == "completed":
            item["jobs"] = _jobs(api, r["id"])
            item["records"] = _records(api, r["id"], n, keys)
        runs.append(item)
    return pr, api.on_first_parent(root, landed, limit), runs


def cmd_verify_merge_group(a) -> int:
    import yaml
    doc = yaml.safe_load((pathlib.Path(a.root) / ".github" / "workflows" / WORKFLOW_FILE).read_text(encoding="utf-8"))
    keys = required_keys(doc)
    if not SHA_RE.match(a.merge_group):
        print(f"FAIL usage: --merge-group must be the landed commit's full 40-hex sha, got {a.merge_group!r}")
        return 1
    try:
        pr, on_chain, runs = gather_merge_group(GhApi(a.repo), a.pr, a.merge_group, keys, a.root, a.first_parent_limit)
        verdict, reason, evidence = decide_merge_group(pr, a.merge_group, on_chain, runs, keys)
    except (ApiError, OSError, ValueError, KeyError, TypeError) as e:
        verdict, reason, evidence = "FAIL", f"api-error: {e}"[:300], {}
    print(f"{verdict} PR #{a.pr}: {reason}")
    if evidence:
        print(json.dumps(evidence, indent=1, sort_keys=True))
    return 0 if verdict == "PASS" else 1


def cmd_verify(a) -> int:
    import yaml
    if a.merge_group is not None:
        if a.tree is not None or a.accept_dispatch:
            print("FAIL usage: --merge-group takes neither --tree nor --accept-dispatch (the landed commit is the evidence)")
            return 1
        return cmd_verify_merge_group(a)
    doc = yaml.safe_load((pathlib.Path(a.root) / ".github" / "workflows" / WORKFLOW_FILE).read_text(encoding="utf-8"))
    keys = required_keys(doc)
    try:
        protected = protected_patterns(a.root)
    except (OSError, ValueError) as e:
        print(f"FAIL PR #{a.pr}: self-protected-diff: cannot read the protected path list: {e}"[:300])
        return 1
    accept = (PR_EVENT, DISPATCH_EVENT) if a.accept_dispatch else (PR_EVENT,)
    if not SHA_RE.match(a.tree):
        print(f"FAIL usage: --tree must be a full 40-hex tree sha, got {a.tree!r}")
        return 1
    try:
        pr, base_tip, runs, busy, changed, ref_sha = gather(GhApi(a.repo), a.pr, keys, a.accept_dispatch)
        verdict, reason, evidence = decide(pr, base_tip, runs, keys, a.tree, accept, busy, changed, protected, ref_sha)
    except (ApiError, OSError, ValueError, KeyError, TypeError) as e:
        verdict, reason, evidence = "FAIL", f"api-error: {e}"[:300], {}
    print(f"{verdict} PR #{a.pr}: {reason}")
    if evidence:
        print(json.dumps(evidence, indent=1, sort_keys=True))
    return 0 if verdict == "PASS" else 1



def _this_repo(fallback: str) -> str:
    """owner/name of this repository: $GITHUB_REPOSITORY in Actions, else this checkout's origin remote.

    Derived, never hardcoded, so moving the repository to another owner needs no edit here. `fallback`
    is used only when neither answers (no git, no origin)."""
    env = os.environ.get("GITHUB_REPOSITORY", "").strip()
    if env:
        return env
    try:
        url = subprocess.run(["git", "-C", str(pathlib.Path(__file__).resolve().parent), "remote", "get-url", "origin"],
                             capture_output=True, text=True, timeout=10).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        url = ""
    m = re.search(r"github\.com[:/]+([^/\s]+/[^/\s]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else fallback


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify", help="PASS/FAIL the merge-tree evidence of one PR")
    v.add_argument("--pr", type=int, required=True)
    v.add_argument("--tree", help="the expected merge tree (git rev-parse <merge>^{tree}); required unless --merge-group")
    v.add_argument("--merge-group", metavar="LANDED_SHA",
                   help="merge-queue mode: the commit on master this PR landed as (the merge group's commit)")
    v.add_argument("--first-parent-limit", type=int, default=FIRST_PARENT_LIMIT,
                   help="--merge-group: how far back along master's first-parent chain to look for the landed commit")
    v.add_argument("--repo", default=_this_repo("northstar-quarry/UCT-Dashboard"))
    v.add_argument("--root", default=".", help="a MASTER checkout: its agent-ci.yml names the required jobs")
    v.add_argument("--accept-dispatch", action="store_true",
                   help="also accept a repository_dispatch rearm run of this PR (tools/agent_ci_rearm.py); off by default")
    r = sub.add_parser("record", help="(agent-ci.yml) write this job's evidence record")
    r.add_argument("--job-key", required=True)
    r.add_argument("--junit")
    r.add_argument("--vitest-json", action="append", default=[])
    r.add_argument("--pytest-log", action="append", default=[], help="a `pytest -rA` console log")
    r.add_argument("--out", default="evidence/evidence.json")
    a = ap.parse_args(argv)
    if a.cmd == "verify" and a.merge_group is None and a.tree is None:
        ap.error("the following arguments are required: --tree")      # argparse's own words and exit code, as before
    return cmd_verify(a) if a.cmd == "verify" else cmd_record(a)


if __name__ == "__main__":
    if str(pathlib.Path(__file__).resolve().parents[1]) not in sys.path:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    sys.exit(main())
