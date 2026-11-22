"""`agent-ci-required`: ONE commit status that says "this PR head carries its Agent CI".

WHY (2026-11-12, release safety): agent-ci.yml runs its jobs on `pull_request` only for FORK PRs; a same-repo
`agent/**` branch gets Agent CI only from its `push` run, and that trigger is path-filtered. A merge-only push
(no Agent path in the PUSHED diff) therefore gets no Agent run at all, the PR's Agent checks read "skipping", and
branch protection treats skipping as passing: a green PR could carry zero Agent CI on its final head.

The status is `success` ONLY when
  (a) the PR's diff against its base touches no Agent path (the push `paths:` list read from agent-ci.yml at run
      time, never a hand copy), OR
  (b) the agent-ci PUSH run for the exact head SHA is completed, concluded success, and every required Agent job
      (the job names in agent-ci.yml, matrix-expanded) is present with conclusion success.
Everything else fails closed: an API error, no push run, a run still in progress, a missing / skipped / failed
job, or a changed-file list too long to read whole.

    python tools/agent_ci_required.py --event pull_request   --sha <head> --pr <n>
    python tools/agent_ci_required.py --event workflow_run   --sha <head>
    (env: GITHUB_TOKEN, GITHUB_REPOSITORY; optional GITHUB_API_URL, TARGET_URL; --dry-run prints, posts nothing)

MERGE QUEUE (2026-11-22; inert until a queue exists on master). .github/workflows/agent-ci-queue.yml runs on
`merge_group` and posts this same status on the merge group's commit, in two stages, both from MASTER's copy of this file:
  scope    the queued PR's OWN diff (git: the merge group's base_sha..head_sha; nothing of the PR is checked out or
           run) -> no-agent-paths | agent-paths | self-protected | unknown. `self-protected` = an Agent path AND a
           path the PR's own run executes; a PR that touches NO Agent path needs no Agent evidence and is
           no-agent-paths whatever else it touches (as on a pull request today) and whatever the protected list
           says, even unreadable, with that said in the detail. An Agent-path PR is `unknown` when that list is
           unreadable, or when its sources differ between master and the entry's base (an entry ahead edits them).
  verdict  success ONLY for no-agent-paths, or for agent-paths when every required Agent job (agent-ci.yml, called by
           that workflow on the merge group's commit) is success in that run. self-protected is ALWAYS failure
           (AUDIT's local evidence decides), and so is an unreadable diff, a scope job that did not succeed, a missing /
           skipped / cancelled / failed job or an API error. Never pending: it is the last word on that commit.
           Whatever goes wrong while deciding is POSTED as a failure; the jobs GET and the status POST are tried 3
           times (transport / 5xx / 429 only). Only a POST that still fails leaves the commit without a status.

    python tools/agent_ci_required.py --event merge_group --stage scope   --sha <head> --base <base> --head-ref <ref>
    python tools/agent_ci_required.py --event merge_group --stage verdict --sha <head> --run-id <id> \
        --scope-result <needs.scope.result> --scope-code <code> --scope-detail <text> --agent-result <needs.agent.result>
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import yaml

CONTEXT = "agent-ci-required"
AGENT_CI = pathlib.Path(".github") / "workflows" / "agent-ci.yml"
SUCCESS, PENDING, FAILURE = "success", "pending", "failure"
#: the pulls/{n}/files API stops at 3000 entries; a list that long cannot be proven Agent-free
MAX_PR_FILES = 3000
#: the agent-ci run events that can be evidence: `push` for agent/** heads, `pull_request` for other same-repo heads
#: (evidence_event picks per PR; agent-ci's jobs skip the PR event for agent/** heads, so it is never accepted for them)
RUN_EVENTS = ("push", "pull_request")


class ApiError(RuntimeError):
    pass


# ---------------------------------------------------------------------------------------------- agent-ci.yml
def _on(doc: dict) -> dict:
    return doc.get("on", doc.get(True)) or {}   # YAML 1.1 parses the `on:` key as True


def load_agent_ci(root: pathlib.Path | str = ".") -> dict:
    return yaml.safe_load((pathlib.Path(root) / AGENT_CI).read_text(encoding="utf-8"))


def agent_paths(doc: dict) -> list[str]:
    """The agent-ci PUSH trigger's paths list: the one authority for "is this an Agent change"."""
    paths = (_on(doc).get("push") or {}).get("paths")
    if not paths:
        raise ValueError("agent-ci.yml push trigger has no paths list")
    return list(paths)


def required_jobs(doc: dict) -> list[str]:
    """Every job's display name as the Actions API reports it, matrix legs expanded (one key per matrix)."""
    names: list[str] = []
    for key, job in (doc.get("jobs") or {}).items():
        name = job.get("name", key)
        matrix = (job.get("strategy") or {}).get("matrix") or {}
        refs = set(re.findall(r"\$\{\{\s*matrix\.(\w+)\s*\}\}", name))
        if not refs:
            names.append(name)
            continue
        if len(refs) != 1 or len(matrix) != 1 or next(iter(refs)) not in matrix:
            raise ValueError(f"job {key!r}: cannot expand name {name!r} with matrix {matrix!r}")
        var = next(iter(refs))
        for value in matrix[var]:
            names.append(re.sub(r"\$\{\{\s*matrix\.%s\s*\}\}" % var, str(value), name))
    return names


# ---------------------------------------------------------------------------------------------- path matching
def _glob_re(pattern: str) -> re.Pattern:
    """GitHub filter-pattern semantics: `**` any characters, `*` any except `/`, `?` one non-`/` character."""
    out, i = [], 0
    while i < len(pattern):
        if pattern.startswith("**", i):
            out.append(".*")
            i += 2
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    # re.S (2026-11-22): `**` crosses a newline too. A file name may hold one, and without this such a path matched no
    # `**` pattern at all, i.e. it was neither an Agent path nor a self-protected one. It only widens what matches.
    return re.compile("".join(out) + r"\Z", re.S)


def matches(path: str, patterns: list[str]) -> bool:
    """GitHub order semantics: the last pattern that matches decides; a `!` pattern excludes."""
    hit = False
    for p in patterns:
        neg = p.startswith("!")
        if _glob_re(p[1:] if neg else p).match(path):
            hit = not neg
    return hit


def touches_agent(changed_paths, patterns: list[str]) -> bool:
    """None = the changed list is unknown (unreadable / truncated): fail closed, treat it as an Agent change."""
    if changed_paths is None:
        return True
    return any(matches(p, patterns) for p in changed_paths)


# ---------------------------------------------------------------------------------------------- the decision
def decide_with_reason(changed_paths, patterns, run, jobs_required) -> tuple[str, str]:
    """changed_paths: list of repo paths in the PR diff, or None (unknown).
    run: None (no push run for the SHA), {"error": msg} (API failure), or
         {"id", "status", "conclusion", "jobs": [{"name", "conclusion"}], ...}."""
    if not touches_agent(changed_paths, patterns):
        return SUCCESS, "no Agent paths changed"
    if run is None:
        return PENDING, "Agent paths changed: waiting for the agent ci run of this exact SHA"
    if not isinstance(run, dict) or run.get("error"):
        return FAILURE, f"could not read the agent ci run: {(run or {}).get('error', run)}"[:140]
    if run.get("status") != "completed":
        return PENDING, f"agent ci run is {run.get('status')}"
    by_name: dict[str, list] = {}
    for j in run.get("jobs") or []:
        by_name.setdefault(j.get("name"), []).append(j.get("conclusion"))
    missing = [n for n in jobs_required if n not in by_name]
    bad = [n for n in jobs_required if n in by_name and any(c != SUCCESS for c in by_name[n])]
    if not jobs_required:
        return FAILURE, "no required Agent jobs could be read from agent-ci.yml"
    if missing:
        return FAILURE, f"{len(missing)} required Agent job(s) missing: {missing[0]}"[:140]
    if bad:
        return FAILURE, f"{len(bad)} Agent job(s) not success: {bad[0]}"[:140]
    if run.get("conclusion") != SUCCESS:
        return FAILURE, f"agent ci run concluded {run.get('conclusion')}"
    return SUCCESS, f"agent ci run passed all {len(jobs_required)} required jobs"


def decide(changed_paths, patterns, run, jobs_required) -> str:
    return decide_with_reason(changed_paths, patterns, run, jobs_required)[0]


def combine(states: list[str]) -> str:
    """Several PRs can share one head SHA (different bases); a commit has one status, so the worst wins."""
    for s in (FAILURE, PENDING):
        if s in states:
            return s
    return SUCCESS if states else PENDING


# ---------------------------------------------------------------------------------------------- GitHub API
#: (merge queue) how often one API call is tried there, and the pause in seconds before each further try. The
#: pull_request / workflow_run paths keep ONE attempt, as before.
RETRY_ATTEMPTS, RETRY_PAUSE_S = 3, (2, 5)


def retryable(exc) -> bool:
    """A failure worth another try: no answer at all (transport, timeout), a 5xx, or a 429. Never any other 4xx: that
    is the server saying no, and asking again does not change it."""
    if isinstance(exc, urllib.error.HTTPError):
        return exc.code == 429 or 500 <= exc.code <= 599
    return isinstance(exc, (urllib.error.URLError, TimeoutError))


class Api:
    def __init__(self, token: str, repo: str, base: str = "https://api.github.com", attempts: int = 1,
                 sleep=time.sleep, opener=urllib.request.urlopen):
        self.token, self.repo, self.base = token, repo, base.rstrip("/")
        self.attempts, self.sleep, self.opener = max(1, int(attempts)), sleep, opener

    def call(self, method: str, path: str, body=None):
        url = path if path.startswith("http") else f"{self.base}/repos/{self.repo}/{path.lstrip('/')}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agent-ci-required"})
        for attempt in range(1, self.attempts + 1):
            try:
                with self.opener(req, timeout=30) as r:
                    return json.loads(r.read() or b"null")
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                if attempt >= self.attempts or not retryable(e):
                    raise ApiError(f"{method} {path}: {e}") from e
                self.sleep(RETRY_PAUSE_S[min(attempt, len(RETRY_PAUSE_S)) - 1])

    def get(self, path: str):
        return self.call("GET", path)


def pr_changed_paths(api: Api, number: int):
    """Every filename (and pre-rename name) in the PR's diff against its base; None when the list is truncated."""
    paths, page = [], 1
    while True:
        batch = api.get(f"pulls/{number}/files?per_page=100&page={page}")
        for f in batch:
            paths.append(f["filename"])
            if f.get("previous_filename"):
                paths.append(f["previous_filename"])
        if len(batch) < 100:
            break
        page += 1
    n_files = len({p for p in paths})
    if n_files >= MAX_PR_FILES or page * 100 > MAX_PR_FILES:
        return None
    return paths


def evidence_event(head_ref: str | None) -> str:
    """Which agent-ci run is the evidence for a PR head (AUDIT option B, 2026-11-12): agent/** heads → its PUSH run (the PR
    event skips the jobs for them); any other same-repo head → its PULL_REQUEST run (agent-ci's jobs run there for non-agent/**
    heads, path-filtered on the PR's OWN diff, so a branch that only merges master never starts an Agent run)."""
    return "push" if str(head_ref or "").startswith("agent/") else "pull_request"


def push_run_for(api: Api, sha: str):
    """The newest agent-ci PUSH run for exactly this SHA (see run_for)."""
    return run_for(api, sha, "push")


def run_for(api: Api, sha: str, event: str):
    """The newest agent-ci run of `event` for exactly this SHA, with its latest-attempt jobs; None when there is none."""
    if event not in RUN_EVENTS:
        raise ValueError(f"not an evidence event: {event}")
    q = urllib.parse.urlencode({"head_sha": sha, "event": event, "per_page": 100})
    runs = [r for r in api.get(f"actions/workflows/agent-ci.yml/runs?{q}").get("workflow_runs", [])
            if r.get("head_sha") == sha and r.get("event") == event]
    if not runs:
        return None
    run = max(runs, key=lambda r: (r.get("created_at") or "", r.get("id") or 0))
    return {"id": run["id"], "status": run.get("status"), "conclusion": run.get("conclusion"),
            "html_url": run.get("html_url"), "jobs": run_jobs(api, run["id"])}


def run_jobs(api: Api, run_id) -> list[dict]:
    """One run's latest-attempt jobs, every page, as [{"name", "conclusion"}]."""
    jobs, page = [], 1
    while True:
        got = api.get(f"actions/runs/{run_id}/jobs?filter=latest&per_page=100&page={page}").get("jobs", [])
        jobs += [{"name": j.get("name"), "conclusion": j.get("conclusion")} for j in got]
        if len(got) < 100:
            return jobs
        page += 1


def open_prs_for(api: Api, sha: str) -> list[int]:
    return [p["number"] for p in api.get(f"commits/{sha}/pulls")
            if p.get("state") == "open" and (p.get("head") or {}).get("sha") == sha]


def evaluate(api: Api, sha: str, prs: list[int], doc: dict) -> tuple[str, str, str | None]:
    patterns, jobs_required = agent_paths(doc), required_jobs(doc)
    try:
        # (paths, head ref) per PR; no PR found: unknown diff and head, fail closed (evidence = push, as before)
        changed = [(pr_changed_paths(api, n), ((api.get(f"pulls/{n}") or {}).get("head") or {}).get("ref")) for n in prs] or [(None, None)]
    except ApiError as e:
        return FAILURE, f"could not read the PR diff: {e}"[:140], None
    runs: dict = {}
    results, link = [], None
    for paths, ref in changed:
        run = None
        if touches_agent(paths, patterns):
            ev = evidence_event(ref) if ref else "push"
            if ev not in runs:
                try:
                    runs[ev] = run_for(api, sha, ev)
                except ApiError as e:
                    runs[ev] = {"error": str(e)}
            run = runs[ev]
            if isinstance(run, dict) and run.get("html_url"):
                link = link or run["html_url"]
        results.append(decide_with_reason(paths, patterns, run if touches_agent(paths, patterns) else None, jobs_required))
    state = combine([s for s, _ in results])
    reason = next(r for s, r in results if s == state)
    return state, reason, link


# ---------------------------------------------------------------------------------------------- merge queue
#: (2026-11-22; inert until a queue exists) .github/workflows/agent-ci-queue.yml: scope -> agent -> verdict.
QUEUE_WORKFLOW = pathlib.Path(".github") / "workflows" / "agent-ci-queue.yml"
#: that workflow's job that CALLS agent-ci.yml. The Actions API reports a called workflow's jobs as
#: "<calling job's name> / <job name>" (and the calling job alone, by its bare name, when it was skipped), so the
#: required jobs are matched under exactly this prefix; the calling job carries no `name:` (a rail holds that).
QUEUE_CALL_JOB = "agent"
#: what the scope stage answers for one queued PR; anything else in its place is read as no answer (fail closed)
SCOPE_CLEAR, SCOPE_AGENT, SCOPE_PROTECTED, SCOPE_UNKNOWN = "no-agent-paths", "agent-paths", "self-protected", "unknown"
SCOPE_CODES = (SCOPE_CLEAR, SCOPE_AGENT, SCOPE_PROTECTED, SCOPE_UNKNOWN)
_SHA = re.compile(r"[0-9a-f]{40}\Z")
_UNSAFE = re.compile(r"[^A-Za-z0-9 _./,()@+:'-]")
AUDIT_DECIDES = "; its own run could vouch for itself: AUDIT's local evidence decides"
NO_AGENT_PATHS = "no Agent paths changed"
#: the pathspecs of the files the DERIVED protected list is read from, besides the files those import
CONFIG_PATHSPECS = (":(glob)app/vite*.config.*", ":(glob)app/vitest*.config.*")


def _evidence():
    """tools/agent_ci_evidence.py: SELF_PROTECTED with its derived lists, and the queue-branch parser. ONE authority
    for both; imported late because that module imports this one."""
    root = str(pathlib.Path(__file__).resolve().parents[1])
    if root not in sys.path:
        sys.path.insert(0, root)
    from tools import agent_ci_evidence
    return agent_ci_evidence


def _job_log(message: str) -> None:
    """One line for the JOB LOG (stderr). Never a job output: it can carry git's own words about a queued PR's refs."""
    print(f"[agent-ci-queue] {message}", file=sys.stderr)


def _git_reader(root, run=subprocess.run, log=_job_log):
    """`git(what, *args)` -> stdout bytes, or None when git could not answer. A failure is logged with WHICH step it
    was and git's stderr, so a red verdict that says "could not be read" can be diagnosed from the job log."""
    def git(what: str, *args):
        try:
            p = run(["git", "-C", str(root), *args], capture_output=True, timeout=300)
        except (OSError, subprocess.SubprocessError) as e:
            log(f"{what}: git {args[0]} could not run: {type(e).__name__}: {e}"[:400])
            return None
        if p.returncode != 0:
            err = (getattr(p, "stderr", b"") or b"").decode("utf-8", "replace").strip()
            log(f"{what}: git {args[0]} exited {p.returncode}: {err}"[:400])
            return None
        return p.stdout
    return git


def merge_group_changed_paths(root, base_sha, head_sha, fetch: bool = True, run=subprocess.run, log=_job_log):
    """The queued PR's OWN diff: every path that differs between a merge group's base_sha and its head_sha, read from
    git objects in the checkout at `root` (master's). Nothing of the PR is checked out or executed, and a rename lists
    both names. None = unknown (the caller fails closed): a value that is not a 40-hex commit (git never sees it), a
    failed fetch, a head that is not a two-parent merge whose FIRST parent is base_sha (so the diff could hold the
    entries ahead, or less than the PR), or a failed diff. An empty list is a real answer: the range was proved.
    Every None is explained in the job log (`log`), never in a job output."""
    if not (isinstance(base_sha, str) and isinstance(head_sha, str) and _SHA.match(base_sha) and _SHA.match(head_sha)):
        log("the queued PR's diff: base_sha / head_sha is not a 40-hex commit; git was not asked")
        return None
    git = _git_reader(root, run, log)
    # depth 2 = the merge group's commit and its parents (base_sha is the first). blob:none: commits and trees are all a
    # name-only diff reads (a sparse actions/checkout is already such a clone; a server without filters ignores it)
    if fetch and git("the queued PR's diff, fetching the merge group", "fetch", "--no-tags", "--quiet", "--depth=2",
                     "--filter=blob:none", "origin", head_sha) is None:
        return None
    commit = git("the queued PR's diff, reading the merge group's commit", "cat-file", "commit", head_sha)
    if commit is None:
        return None
    header = commit.decode("utf-8", "replace").split("\n\n", 1)[0]
    parents = [ln.split()[1] for ln in header.splitlines() if ln.startswith("parent ") and len(ln.split()) == 2]
    if len(parents) != 2 or parents[0] != base_sha:
        log(f"the queued PR's diff: {head_sha} has parents {parents}, not a two-parent merge whose first parent is {base_sha}")
        return None
    out = git("the queued PR's diff, comparing base_sha with head_sha", "diff", "--no-renames", "--name-only", "-z", base_sha, head_sha)
    if out is None:
        return None
    return [p for p in out.decode("utf-8", "surrogateescape").split("\0") if p]


def protected_sources_differ(root, base_sha, imported, run=subprocess.run, log=_job_log):
    """STACKED ENTRIES. The derived half of the protected list is read from the checkout (master's tip): every vite /
    vitest config under app/ and every file those import (`imported`: agent_ci_evidence.config_imports(root)). An entry
    AHEAD in the queue that edits one of them changes what the entry behind it executes, and master does not have it
    yet. True when any of those files differs between the checkout's HEAD and base_sha (the tree this entry is built
    on), False when none does, None when git could not say."""
    if not (isinstance(base_sha, str) and _SHA.match(base_sha)):
        return None
    specs = [*CONFIG_PATHSPECS, *(f":(literal){p}" for p in imported)]
    out = _git_reader(root, run, log)("the protected list's sources, master against this entry's base",
                                      "diff", "--no-renames", "--name-only", "-z", "HEAD", base_sha, "--", *specs)
    if out is None:
        return None
    differing = [p for p in out.decode("utf-8", "surrogateescape").split("\0") if p]
    if differing:
        log(f"the protected list's sources differ between master and base {base_sha}: {differing[:5]}")
    return bool(differing)


def decide_scope(changed_paths, patterns, protected) -> tuple[str, str]:
    """(code, detail) for one queued PR. changed_paths: its own diff, or None (unknown). patterns: agent_paths().
    protected: agent_ci_evidence.protected_patterns(master root), or None (unreadable). The rule, in this order:
      1. an unreadable diff is `unknown` (fail closed);
      2. NO Agent path: `no-agent-paths`, whatever else it touches and whatever the protected list says, even
         unreadable. It needs no Agent evidence, exactly as on a pull request today; the detail says so when it
         touches a self-protected path, or when that list could not be read, so the status shows it. (An unreadable
         list must not fail these: the pull request that repairs the list is one of them.)
      3. an Agent path and an unreadable protected list: `unknown` (fail closed);
      4. an Agent path AND a self-protected path: `self-protected`. The PR needs Agent evidence and its own run could
         vouch for itself, so AUDIT's local evidence decides (the rule `verify` applies today as self-protected-diff);
      5. an Agent path, no self-protected path: `agent-paths`."""
    if changed_paths is None:
        return SCOPE_UNKNOWN, "the queued PR's own diff could not be read"
    hits = _evidence().self_protected_hits(changed_paths, protected) if protected is not None else None
    if not touches_agent(changed_paths, patterns):
        if hits is None:
            return SCOPE_CLEAR, f"{NO_AGENT_PATHS} (the self-protected path list is unreadable, no Agent evidence needed)"
        if hits:
            return SCOPE_CLEAR, f"{NO_AGENT_PATHS} ({len(hits)} self-protected path(s) touched, no Agent evidence needed)"
        return SCOPE_CLEAR, NO_AGENT_PATHS
    if hits is None:
        return SCOPE_UNKNOWN, "the self-protected path list could not be read"
    if hits:
        return SCOPE_PROTECTED, f"{len(hits)} self-protected path(s), e.g. {hits[0]}"
    return SCOPE_AGENT, "Agent paths changed"


def queue_scope(root, doc, head_sha, base_sha, head_ref, tested_sha, fetch: bool = True) -> dict:
    """{"code", "pr", "detail"} for a merge group. `root` is a MASTER checkout (its agent-ci.yml is `doc`; its configs
    give the protected list). tested_sha is GITHUB_SHA: the commit the called Agent jobs check out, and the commit the
    verdict's status lands on, must be the event's head_sha."""
    ev = _evidence()
    pr = ev.queue_pr(head_ref)
    if pr is None:
        return {"code": SCOPE_UNKNOWN, "pr": None, "detail": "the merge group's head_ref names no queued pull request"}
    if not (isinstance(head_sha, str) and _SHA.match(head_sha)) or head_sha != tested_sha:
        return {"code": SCOPE_UNKNOWN, "pr": pr, "detail": "the merge group's head_sha is not the commit this run tests"}
    changed = merge_group_changed_paths(root, base_sha, head_sha, fetch=fetch)
    try:
        protected, imported = ev.protected_patterns(root), ev.config_imports(root)
    except (OSError, ValueError) as e:
        _job_log(f"the self-protected path list could not be derived from master's configs: {e}"[:400])
        protected = imported = None
    code, detail = decide_scope(changed, agent_paths(doc), protected)
    # only an entry that needs Agent evidence depends on the derived list being the right one for ITS tree
    if code == SCOPE_AGENT and protected_sources_differ(root, base_sha, imported) is not False:
        code, detail = SCOPE_UNKNOWN, "the protected list's sources differ between master and this entry's base (or are unreadable)"
    return {"code": code, "pr": pr, "detail": detail}


def decide_queue(scope_result, scope_code, scope_detail, agent_result, jobs, jobs_required) -> tuple[str, str]:
    """`agent-ci-required` for a merge group's commit: SUCCESS or FAILURE, never pending (it is the last word on that
    commit). scope_result / agent_result: the two jobs' `needs.<job>.result`. jobs: THIS run's jobs as the API lists
    them, [{"name", "conclusion"}], or anything else when they could not be read. jobs_required is read only for
    `agent-paths` (the caller need not load it for any other code).
    SUCCESS only when the scope job succeeded AND (it answered no-agent-paths and the Agent call was skipped, OR it
    answered agent-paths, the call concluded success, and every required job is listed under the call with conclusion
    success). The call's own result is not enough: a job skipped inside it would not turn it red."""
    if scope_result != SUCCESS or scope_code not in SCOPE_CODES:
        return FAILURE, f"the scope job gave no answer (result {scope_result!r}, code {scope_code!r}): fail closed"[:140]
    detail = str(scope_detail or scope_code)
    if scope_code == SCOPE_PROTECTED:
        return FAILURE, detail[:140 - len(AUDIT_DECIDES)] + AUDIT_DECIDES
    if scope_code == SCOPE_UNKNOWN:
        return FAILURE, f"fail closed: {detail}"[:140]
    if scope_code == SCOPE_CLEAR:
        if agent_result != "skipped":
            return FAILURE, f"no Agent paths changed, yet the Agent jobs were not skipped ({agent_result!r}): fail closed"[:140]
        # the scope stage's own sentence when it is one (it may add that self-protected paths were touched), else the plain one
        return SUCCESS, detail[:140] if detail.startswith(NO_AGENT_PATHS) else NO_AGENT_PATHS
    if agent_result != SUCCESS:
        return FAILURE, f"the Agent jobs concluded {agent_result!r} on the merge group's commit"[:140]
    if not isinstance(jobs, list):
        return FAILURE, f"could not read this run's jobs: {(jobs or {}).get('error', jobs) if isinstance(jobs, dict) else jobs}"[:140]
    prefix = QUEUE_CALL_JOB + " / "
    called = [{"name": str(j.get("name"))[len(prefix):], "conclusion": j.get("conclusion")}
              for j in jobs if isinstance(j, dict) and str(j.get("name") or "").startswith(prefix)]
    # the same per-job rule as a PR head's run (decide_with_reason): every required name present, none but success
    state, reason = decide_with_reason(None, [], {"status": "completed", "conclusion": SUCCESS, "jobs": called}, jobs_required)
    if state != SUCCESS:
        return FAILURE, reason
    return SUCCESS, f"all {len(jobs_required)} Agent jobs passed on the merge group's commit"


def _safe(value, limit: int = 100) -> str:
    """One line of plain characters. A job output travels through $GITHUB_OUTPUT as a `key=value` line, and the detail
    names a path from the queued PR: a newline in a file name must never become a second output."""
    return _UNSAFE.sub("?", str(value))[:limit]


def write_outputs(values: dict, path=None) -> None:
    path = path or os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8", newline="\n") as fh:
        for key, value in values.items():
            fh.write(f"{key}={_safe(value)}\n")


def queue_verdict(api: Api, a) -> tuple[str, str]:
    """The verdict stage's decision. agent-ci.yml's job names and this run's job list are read ONLY for `agent-paths`:
    every other code is decided without touching the workflow file or the API, so neither can fail those entries.
    ANY exception in here is a FAILURE with a short reason, never a crash: a verdict that dies before its POST leaves no
    status, and the queue then holds every entry behind this one until its check timeout."""
    try:
        jobs, required = None, []
        if a.scope_code == SCOPE_AGENT:
            required = required_jobs(load_agent_ci(a.root))
            try:
                jobs = run_jobs(api, a.run_id)
            except ApiError as e:
                jobs = {"error": str(e)}
        return decide_queue(a.scope_result, a.scope_code, a.scope_detail, a.agent_result, jobs, required)
    except Exception as e:  # noqa: BLE001  fail closed AND say so on the commit
        _job_log(f"the verdict could not be computed: {type(e).__name__}: {e}"[:400])
        return FAILURE, f"the verdict could not be computed ({type(e).__name__}): fail closed"[:140]


def _main_merge_group(a) -> int:
    """scope: prints the answer and writes the job outputs; exit 0 whatever the code (the verdict stage judges it).
    verdict: posts the status, then exits 0 for success and 1 for failure, so the run is red when the status is.
    Nothing but the POST itself can leave the commit without a status: whatever goes wrong while deciding is posted as
    a failure (queue_verdict), and the jobs GET and the status POST are each tried RETRY_ATTEMPTS times. A POST that
    still fails raises: no status at all, and the queue's own check timeout removes the entry."""
    if a.stage == "scope":
        out = queue_scope(a.root, load_agent_ci(a.root), a.sha, a.base, a.head_ref, os.environ.get("GITHUB_SHA", ""))
        print(json.dumps({"stage": "scope", "sha": a.sha, **out}))
        write_outputs({"code": out["code"], "pr": out["pr"] or "", "detail": out["detail"]})
        return 0
    if a.stage != "verdict" or not _SHA.match(a.sha or "") or not a.run_id:
        print("merge_group needs --stage scope, or --stage verdict with a 40-hex --sha and a --run-id", file=sys.stderr)
        return 2
    api = Api(os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"], os.environ.get("GITHUB_API_URL", "https://api.github.com"),
              attempts=RETRY_ATTEMPTS)
    state, reason = queue_verdict(api, a)
    body = {"state": state, "context": CONTEXT, "description": reason[:140], "target_url": os.environ.get("TARGET_URL") or None}
    body = {k: v for k, v in body.items() if v is not None}
    print(json.dumps({"stage": "verdict", "sha": a.sha, **body}))
    if not a.dry_run:
        api.call("POST", f"statuses/{a.sha}", body)
    return 0 if state == SUCCESS else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", required=True, choices=["pull_request", "workflow_run", "merge_group"])
    ap.add_argument("--sha", required=True)
    ap.add_argument("--pr", type=int, action="append", default=[])
    ap.add_argument("--root", default=".")
    ap.add_argument("--dry-run", action="store_true")
    # merge_group only (agent-ci-queue.yml)
    ap.add_argument("--stage", choices=["scope", "verdict"])
    ap.add_argument("--base")
    ap.add_argument("--head-ref")
    ap.add_argument("--run-id", type=int)
    ap.add_argument("--scope-result", default="")
    ap.add_argument("--scope-code", default="")
    ap.add_argument("--scope-detail", default="")
    ap.add_argument("--agent-result", default="")
    a = ap.parse_args(argv)
    if a.event == "merge_group":
        return _main_merge_group(a)
    api = Api(os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"], os.environ.get("GITHUB_API_URL", "https://api.github.com"))
    doc = load_agent_ci(a.root)
    prs = a.pr
    if a.event == "workflow_run" and not prs:
        try:
            prs = open_prs_for(api, a.sha)
        except ApiError as e:
            state, reason, link = FAILURE, f"could not list PRs for the SHA: {e}"[:140], None
            prs = None
    if prs is not None:
        state, reason, link = evaluate(api, a.sha, prs, doc)
    body = {"state": state, "context": CONTEXT, "description": reason[:140],
            "target_url": link or os.environ.get("TARGET_URL") or None}
    body = {k: v for k, v in body.items() if v is not None}
    print(json.dumps({"sha": a.sha, "prs": prs, **body}))
    if not a.dry_run:
        api.call("POST", f"statuses/{a.sha}", body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
