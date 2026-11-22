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

WHO POSTS (2026-11-22): every status under this context, on a pull request's head or on a merge group's commit, is
POSTed with a GitHub App's installation token (env AGENT_CI_VERDICT_TOKEN), never with GITHUB_TOKEN, which only reads.
At the merge-queue cutover the ruleset pins the required check to that App; a status under the same context from any
other identity does not count, and posted after the App's it would block the pull request again (last writer wins).

MERGE QUEUE (2026-11-22; inert until a queue exists on master). The same status on a merge group's commit, decided by
MASTER's copy of this file in two places:
  scope    (.github/workflows/agent-ci-queue.yml, INSIDE the merge group; it writes no status and nobody trusts it: it
           only decides whether the Agent jobs are started) the queued PR's OWN diff (git: the merge group's base_sha..head_sha; nothing of the PR is checked out or
           run) -> no-agent-paths | agent-paths | self-protected | unknown. `self-protected` = an Agent path AND a
           path the PR's own run executes; a PR that touches NO Agent path needs no Agent evidence and is
           no-agent-paths whatever else it touches (as on a pull request today) and whatever the protected list
           says, even unreadable, with that said in the detail. An Agent-path PR is `unknown` when that list is
           unreadable, or when its sources differ between master and the entry's base (an entry ahead edits them).
  follow   (.github/workflows/agent-ci-queue-verdict.yml: `workflow_run` on that workflow, so master's copy of the
           file, on master, in an environment only master may use; AUDIT F1 on #2501) the TRUSTED verdict. It reads
           nothing the merge group's run says about itself: it recomputes the scope from the commit, and posts with a
           GitHub App's token. success ONLY for no-agent-paths, or for agent-paths when (a) no self-protected path
           differs between the commit and the master commit the group is built on (an entry AHEAD may have edited the
           Agent CI machinery), (b) the clock is outside the weekday deploy freeze windows, and (c) every required
           Agent job (master's agent-ci.yml) is success under the queue workflow's call in that run. self-protected is
           ALWAYS failure (AUDIT's local evidence decides), and so is anything unreadable. Never pending.
           Whatever goes wrong while deciding is POSTED as a failure; API calls are tried 3 times (transport / 5xx /
           429 only). Only a POST that still fails leaves the commit without a status. A run that is not the queue
           workflow's own merge-group run gets NO status from it (exit 2).

    python tools/agent_ci_required.py --event merge_group --stage scope  --sha <head> --base <base> --head-ref <ref>
    python tools/agent_ci_required.py --event merge_group --stage follow --sha <run head_sha> --run-id <id> \
        --head-ref <run head_branch> --run-event <run event>     (env: GITHUB_TOKEN reads, AGENT_CI_VERDICT_TOKEN posts)
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
#: (2026-11-22; inert until a queue exists) .github/workflows/agent-ci-queue.yml runs INSIDE the merge group (scope ->
#: agent) and writes no status. .github/workflows/agent-ci-queue-verdict.yml follows it (workflow_run, so master's copy
#: of that file, on master) and posts agent-ci-required with a GitHub App's token: the trusted identity (AUDIT F1).
QUEUE_WORKFLOW = pathlib.Path(".github") / "workflows" / "agent-ci-queue.yml"
FOLLOWER_WORKFLOW = pathlib.Path(".github") / "workflows" / "agent-ci-queue-verdict.yml"
#: the branch the queue builds into (agent_ci_evidence.QUEUE_REF_RE pins the same name)
QUEUE_BASE_BRANCH = "master"
#: where the follower keeps master's tip while it works (a private ref of its own throwaway checkout)
FOLLOW_MASTER_REF = "refs/agent-ci-verdict/master"
#: how many first-parent commits of master and of the merge group the follower fetches to find the master commit the
#: group is built on. More entries ahead than this, or a master that moved further, is `unknown` (failure).
FOLLOW_DEPTH = 50
#: the environment variable that holds the GitHub App's installation token: the ONLY token the follower POSTs with
VERDICT_TOKEN_ENV = "AGENT_CI_VERDICT_TOKEN"
#: D2.1 (AUDIT on #2495): deploy freeze windows, weekdays, wall clock in FREEZE_TZ, both ends included. An entry that
#: needs Agent evidence is failed inside one. ⚠️ The clock is read when the VERDICT is decided, which is seconds
#: before the entry lands; and this knows no market holiday (a holiday that falls on a weekday is treated as a
#: trading day: an Agent entry is refused in the window for nothing, which is the safe side).
FREEZE_TZ = "America/New_York"
FREEZE_WINDOWS = (((9, 20), (9, 45)), ((15, 30), (16, 15)))
MACHINERY_EDITED = "; an entry ahead edits the Agent CI machinery: AUDIT decides"
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


def commit_parents(git, what: str, sha: str):
    """The parents of `sha`, read from the commit object itself (a shallow history still answers); None = unreadable."""
    commit = git(what, "cat-file", "commit", sha)
    if commit is None:
        return None
    header = commit.decode("utf-8", "replace").split("\n\n", 1)[0]
    return [ln.split()[1] for ln in header.splitlines() if ln.startswith("parent ") and len(ln.split()) == 2]


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
    parents = commit_parents(git, "the queued PR's diff, reading the merge group's commit", head_sha)
    if parents is None:
        return None
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
    commit). The caller is the trusted follower (follow_verdict), and every argument is something IT established:
    scope_result: "success" when its own recompute of the scope ran (anything else: no answer, failure);
    scope_code / scope_detail: that recompute's answer, never the merge group's own scope job's;
    agent_result: what the call into agent-ci.yml must have been for that code ("skipped" for no-agent-paths: nothing
    of the run is needed; "success" for agent-paths: the per-job rule below then proves it);
    jobs: the merge group run's jobs as the API lists them, [{"name", "conclusion"}], or anything else when they could
    not be read. jobs_required is read only for `agent-paths` (the caller need not load it for any other code).
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


def freeze_window(now) -> str | None:
    """The deploy freeze window the instant `now` falls in, as "09:20-09:45 ET", or None. `now` is an AWARE datetime
    (a naive one raises: a clock that cannot be placed is not a clock). Weekdays only, both ends included, read in
    FREEZE_TZ's wall clock, so the UTC instants move with daylight saving. No market holiday is known here."""
    import zoneinfo
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("freeze_window needs an aware datetime")
    local = now.astimezone(zoneinfo.ZoneInfo(FREEZE_TZ))
    if local.weekday() >= 5:
        return None
    at = (local.hour, local.minute, local.second)
    for (h1, m1), (h2, m2) in FREEZE_WINDOWS:
        if (h1, m1, 0) <= at <= (h2, m2, 0):
            return f"{h1:02d}:{m1:02d}-{h2:02d}:{m2:02d} ET"
    return None


def _utcnow():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc)


def master_base(git, head_sha: str, depth: int = FOLLOW_DEPTH):
    """The master commit a merge group is built on: the first commit on head_sha's FIRST-PARENT chain, after head_sha
    itself, that is on master's first-parent chain (FOLLOW_MASTER_REF). With merge method MERGE that chain is this
    group, the groups ahead of it, then master, so this is `git merge-base head master` when the history is whole; this
    form needs only the two chains, so a shallow history cannot make it name another commit. None = not found within
    `depth` commits, or unreadable (the caller fails closed)."""
    chains = []
    for what, tip in (("master's first-parent chain", FOLLOW_MASTER_REF), ("the merge group's first-parent chain", head_sha)):
        out = git(what, "rev-list", "--first-parent", f"--max-count={int(depth)}", tip)
        if out is None:
            return None
        chains.append(out.decode("ascii", "replace").split())
    on_master, group = set(chains[0]), chains[1]
    if not group or group[0] != head_sha:
        return None
    return next((c for c in group[1:] if c in on_master), None)


def machinery_edits(git, base: str, head_sha: str, protected):
    """Every self-protected path that is not byte-identical between `base` (the master commit the group is built on)
    and head_sha: this entry's edits AND those of every entry ahead of it in the group, which a scope of this entry's
    own diff cannot see. Tree entries are compared (blob ids), so no file content is read. None = unreadable."""
    out = git("the Agent CI machinery, master against the merge group", "diff", "--no-renames", "--name-only", "-z", base, head_sha)
    if out is None:
        return None
    return _evidence().self_protected_hits([p for p in out.decode("utf-8", "surrogateescape").split("\0") if p], protected)


def follow_verdict(root, api: Api, run_id, head_sha: str, head_ref: str, now, run=subprocess.run, log=_job_log) -> tuple[str, str]:
    """`agent-ci-required` for one merge group commit, decided by the trusted follower from MASTER's checkout at `root`.
    NOTHING the merge group's run says about itself is read: not its scope job's outputs, not its conclusion. The
    follower fetches the commit, RECOMPUTES the scope with master's code (same rule: a two-parent merge, the diff
    against its first parent), and for an entry that needs Agent evidence it also requires, in this order:
      * every self-protected path byte-identical between the commit and the master commit the group is built on
        (machinery_edits: an entry AHEAD may have edited what this entry's jobs ran with);
      * the clock outside the deploy freeze windows (freeze_window);
      * every required Agent job (master's agent-ci.yml) listed under the queue workflow's call in THAT run, success.
    An entry that touches no Agent path needs none of this and is success. Anything unreadable is failure."""
    ev = _evidence()
    git = _git_reader(root, run, log)
    if git("the merge group and master, fetching", "fetch", "--no-tags", "--quiet", "--filter=blob:none", f"--depth={FOLLOW_DEPTH}",
           "origin", f"+refs/heads/{QUEUE_BASE_BRANCH}:{FOLLOW_MASTER_REF}", head_sha) is None:
        return FAILURE, "fail closed: the merge group's commit and master could not be fetched"
    parents = commit_parents(git, "the merge group's commit", head_sha)
    if parents is None or len(parents) != 2:
        log(f"{head_sha} has parents {parents}: not a two-parent merge (merge method MERGE is the only one judged)")
        return FAILURE, "fail closed: the merge group's commit is not a two-parent merge"
    doc = load_agent_ci(root)
    scope = queue_scope(root, doc, head_sha, parents[0], head_ref, head_sha, fetch=False)
    code, detail = scope["code"], scope["detail"]
    log(f"recomputed scope for PR {scope['pr']}: {code} ({detail})")
    jobs, required = None, []
    if code == SCOPE_AGENT:
        base = master_base(git, head_sha)
        if base is None:
            return FAILURE, f"fail closed: the master commit this merge group is built on was not found within {FOLLOW_DEPTH} commits"
        hits = machinery_edits(git, base, head_sha, ev.protected_patterns(root))
        if hits is None:
            return FAILURE, "fail closed: the Agent CI machinery could not be compared with master's"
        if hits:
            head = f"{len(hits)} self-protected path(s) differ from master, e.g. {hits[0]}"
            return FAILURE, head[:140 - len(MACHINERY_EDITED)] + MACHINERY_EDITED
        window = freeze_window(now)
        if window:
            return FAILURE, f"deploy freeze window {window} on weekdays: an Agent entry does not land in it; queue it again afterwards"
        required = required_jobs(doc)
        try:
            jobs = run_jobs(api, run_id)
        except ApiError as e:
            jobs = {"error": str(e)}
    return decide_queue(SUCCESS, code, detail, SUCCESS if code == SCOPE_AGENT else "skipped", jobs, required)


def follow(read: Api, a, now, run=subprocess.run, log=_job_log):
    """What the follower posts for one completed run that fired it: (state, reason), or None = post NOTHING.
    From the workflow_run payload it takes only the run id, head_sha, head_branch and event (a.run_id, a.sha, a.head_ref,
    a.run_event); the run's workflow path is read from the API.
    None (nothing is posted, the job exits non-zero) when this is not the queue workflow's own merge-group run for a
    commit: no 40-hex commit, an event other than merge_group (a status on a PR head would overwrite the pull-request
    side's), a run whose workflow file is not QUEUE_WORKFLOW (any workflow may NAME itself "agent ci queue"; only that
    file's run is the judge's, and its own follower run speaks for the commit), or a run the API describes otherwise.
    FAILURE (posted) when it IS that run but cannot be judged: the run could not be read, its branch names no pull
    request into master, or anything at all goes wrong while deciding (a verdict that dies leaves no status, and the
    queue then holds every entry behind this one until its check timeout)."""
    sha, branch = a.sha or "", a.head_ref or ""
    if not _SHA.match(sha) or a.run_event != "merge_group" or not a.run_id:
        log(f"not a merge group's run (event {a.run_event!r}, run {a.run_id!r}, a 40-hex commit: {bool(_SHA.match(sha))}): nothing is posted")
        return None
    try:
        described = read.get(f"actions/runs/{int(a.run_id)}") or {}
    except ApiError as e:
        log(f"run {a.run_id} could not be read: {e}"[:400])
        return FAILURE, "fail closed: the merge group's run could not be read"
    theirs = {k: described.get(k) for k in ("path", "event", "head_sha", "head_branch")}
    if theirs != {"path": QUEUE_WORKFLOW.as_posix(), "event": "merge_group", "head_sha": sha, "head_branch": branch}:
        log(f"run {a.run_id} is not {QUEUE_WORKFLOW.as_posix()}'s merge-group run for {sha} on {branch!r} ({theirs}): nothing is posted")
        return None
    try:
        if _evidence().queue_pr(branch) is None:
            return FAILURE, "fail closed: the merge group's branch names no pull request into master"
        return follow_verdict(a.root, read, int(a.run_id), sha, branch, now, run=run, log=log)
    except Exception as e:  # noqa: BLE001  fail closed AND say so on the commit
        log(f"the verdict could not be computed: {type(e).__name__}: {e}"[:400])
        return FAILURE, f"the verdict could not be computed ({type(e).__name__}): fail closed"[:140]


def _main_merge_group(a) -> int:
    """scope (inside the merge group, agent-ci-queue.yml): prints the answer and writes the job outputs; exit 0 whatever
    the code. It decides only whether the Agent jobs are worth starting; it writes no status and nobody trusts it.
    follow (agent-ci-queue-verdict.yml, master's copy on master): decides and POSTS agent-ci-required on the merge
    group's commit with the App's token (VERDICT_TOKEN_ENV), then exits 0 for success and 1 for failure. It exits 2
    without posting when the run that fired it is not the queue workflow's merge-group run. Reads use GITHUB_TOKEN.
    Nothing but the POST itself can leave a judged commit without a status: whatever goes wrong while deciding is
    posted as a failure, and every API call is tried RETRY_ATTEMPTS times. A POST that still fails raises."""
    if a.stage == "scope":
        out = queue_scope(a.root, load_agent_ci(a.root), a.sha, a.base, a.head_ref, os.environ.get("GITHUB_SHA", ""))
        print(json.dumps({"stage": "scope", "sha": a.sha, **out}))
        write_outputs({"code": out["code"], "pr": out["pr"] or "", "detail": out["detail"]})
        return 0
    if a.stage != "follow":
        print("merge_group needs --stage scope or --stage follow", file=sys.stderr)
        return 2
    repo, base = os.environ["GITHUB_REPOSITORY"], os.environ.get("GITHUB_API_URL", "https://api.github.com")
    post_token = os.environ[VERDICT_TOKEN_ENV]          # read first: without the App's token there is nothing to do
    verdict = follow(Api(os.environ["GITHUB_TOKEN"], repo, base, attempts=RETRY_ATTEMPTS), a, _utcnow())
    if verdict is None:
        return 2
    state, reason = verdict
    body = {"state": state, "context": CONTEXT, "description": reason[:140], "target_url": os.environ.get("TARGET_URL") or None}
    body = {k: v for k, v in body.items() if v is not None}
    print(json.dumps({"stage": "follow", "sha": a.sha, "run_id": a.run_id, **body}))
    if not a.dry_run:
        Api(post_token, repo, base, attempts=RETRY_ATTEMPTS).call("POST", f"statuses/{a.sha}", body)
    return 0 if state == SUCCESS else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", required=True, choices=["pull_request", "workflow_run", "merge_group"])
    ap.add_argument("--sha", required=True)
    ap.add_argument("--pr", type=int, action="append", default=[])
    ap.add_argument("--root", default=".")
    ap.add_argument("--dry-run", action="store_true")
    # merge_group only: scope (agent-ci-queue.yml) and follow (agent-ci-queue-verdict.yml)
    ap.add_argument("--stage", choices=["scope", "follow"])
    ap.add_argument("--base")
    ap.add_argument("--head-ref")
    ap.add_argument("--run-id", type=int)
    ap.add_argument("--run-event", default="")
    a = ap.parse_args(argv)
    if a.event == "merge_group":
        return _main_merge_group(a)
    repo, base = os.environ["GITHUB_REPOSITORY"], os.environ.get("GITHUB_API_URL", "https://api.github.com")
    api = Api(os.environ["GITHUB_TOKEN"], repo, base)          # READS only: the job's own token cannot write a status
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
        # 2026-11-22: the App's token, and no other, posts this context (the ruleset pins the required check to the
        # App, and a later status from any other identity under the same context would block the pull request again)
        app_token = os.environ.get(VERDICT_TOKEN_ENV, "")
        if not app_token:
            # an OLDER copy of agent-ci-required.yml (a branch that has not taken master's yet: it still runs on
            # `pull_request` with its own token) checks out master's copy of this tool and hands it no App token.
            # Then NOTHING is posted, and never with GITHUB_TOKEN: no status is not a success anywhere.
            print(f"::warning::{VERDICT_TOKEN_ENV} is not set: no {CONTEXT} status is posted for {a.sha} (only the App posts it). "
                  "The workflow file that ran this is older than master's agent-ci-required.yml.")
            return 0
        Api(app_token, repo, base).call("POST", f"statuses/{a.sha}", body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
