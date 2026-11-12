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
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import sys
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
    return re.compile("".join(out) + r"\Z")


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
        return PENDING, "Agent paths changed: waiting for the agent ci push run of this exact SHA"
    if not isinstance(run, dict) or run.get("error"):
        return FAILURE, f"could not read the agent ci run: {(run or {}).get('error', run)}"[:140]
    if run.get("status") != "completed":
        return PENDING, f"agent ci push run is {run.get('status')}"
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
        return FAILURE, f"agent ci push run concluded {run.get('conclusion')}"
    return SUCCESS, f"agent ci push run passed all {len(jobs_required)} required jobs"


def decide(changed_paths, patterns, run, jobs_required) -> str:
    return decide_with_reason(changed_paths, patterns, run, jobs_required)[0]


def combine(states: list[str]) -> str:
    """Several PRs can share one head SHA (different bases); a commit has one status, so the worst wins."""
    for s in (FAILURE, PENDING):
        if s in states:
            return s
    return SUCCESS if states else PENDING


# ---------------------------------------------------------------------------------------------- GitHub API
class Api:
    def __init__(self, token: str, repo: str, base: str = "https://api.github.com"):
        self.token, self.repo, self.base = token, repo, base.rstrip("/")

    def call(self, method: str, path: str, body=None):
        url = path if path.startswith("http") else f"{self.base}/repos/{self.repo}/{path.lstrip('/')}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": f"Bearer {self.token}", "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agent-ci-required"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read() or b"null")
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            raise ApiError(f"{method} {path}: {e}") from e

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
    jobs, page = [], 1
    while True:
        got = api.get(f"actions/runs/{run['id']}/jobs?filter=latest&per_page=100&page={page}").get("jobs", [])
        jobs += [{"name": j.get("name"), "conclusion": j.get("conclusion")} for j in got]
        if len(got) < 100:
            break
        page += 1
    return {"id": run["id"], "status": run.get("status"), "conclusion": run.get("conclusion"),
            "html_url": run.get("html_url"), "jobs": jobs}


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


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--event", required=True, choices=["pull_request", "workflow_run"])
    ap.add_argument("--sha", required=True)
    ap.add_argument("--pr", type=int, action="append", default=[])
    ap.add_argument("--root", default=".")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
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
