"""Required-check aggregators: does this PR touch a workflow's paths, and did every needed job pass?

WHY (2026-11-10, REQUIRED-CHECKS, AUDIT-approved design). A workflow skipped by a `pull_request.paths` filter never
creates its checks, so a REQUIRED check would wait "Expected" forever. A job skipped by `if:` reports SUCCESS, so
requiring a real job's name passes a PR that ran nothing (agent ci did that on 11 of 21 agent-touching PRs).
So each required, path-filtered workflow runs on EVERY PR and carries two small jobs around its real jobs:

  changes   `match`: is the PR diff relevant to this workflow? The truth is the workflow's own `on.push.paths`
            (GitHub already path-matches pushes, so on a push the answer is always relevant=true).
  required  `verdict`: the one check the branch ruleset requires, named "<workflow> (required)", `if: always()`.

⛔ THE TWO HALVES FAIL IN OPPOSITE DIRECTIONS, ON PURPOSE.
  * `match` FAILS SAFE TO relevant=TRUE. Unreadable YAML, no push.paths, a glob it does not understand (`!`, `?`,
    `[`, `{`, `+`, `\\`, `paths-ignore`), an empty diff, a missing SHA, a git failure, ANY exception: the real jobs
    run. A wrong `true` costs runner minutes; a wrong `false` lets an untested change merge. Every error branch goes
    through `_fail_safe()`, and tests/test_ci_paths_match.py proves a mutant `_fail_safe() -> false` turns red.
  * `verdict` FAILS CLOSED. Bad JSON, a missing `needs` entry, a `changes` job that did not succeed, or any real job
    whose result is not exactly `success` (skipped, cancelled, neutral, failure, absent) when relevant: exit 1.

Globs (GitHub filter-pattern subset): `**` crosses `/`, `*` does not, everything else is literal. Dotfiles are matched
like any other name (the conservative direction: more paths relevant, never fewer).

    python tools/ci_paths_match.py match --workflow .github/workflows/x.yml --event pull_request --base B --head H
    NEEDS='${{ toJSON(needs) }}' python tools/ci_paths_match.py verdict --expect changes,job-a,job-b

`match` always exits 0 and prints `relevant=true|false` as its LAST line; the workflow treats anything other than a
clean exit plus that exact `relevant=false` line as true. Standard library, plus PyYAML (requirements.txt) for
`match` only, imported lazily so `verdict` runs on a bare runner python.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass

#: Files whose change makes EVERY aggregated workflow relevant, on top of its own push.paths: the matcher itself and the
#: workflow file being judged. An edit to the gating machinery must run the real jobs it gates (vite build args'
#: push.paths, for one, does not list its own file). Only ever adds relevance.
ALWAYS_RELEVANT = ("tools/ci_paths_match.py",)

#: Characters with a meaning in GitHub filter patterns that this converter does NOT implement. Seeing one is an error,
#: and an error is relevant=true. (`*` is the only special character handled.)
UNSUPPORTED = set("!?[]{}+\\")


class UnsupportedGlob(ValueError):
    pass


@dataclass(frozen=True)
class Decision:
    relevant: bool
    reason: str


def _fail_safe(reason: str) -> Decision:
    """THE single exit for every error path. It must say relevant=True: see the module docstring."""
    return Decision(True, "fail-safe: " + reason)


def glob_to_regex(pattern: str) -> re.Pattern:
    """A GitHub `paths:` pattern as an anchored regex: `**` matches anything (including `/`), `*` anything but `/`."""
    if not isinstance(pattern, str) or not pattern:
        raise UnsupportedGlob(f"not a non-empty string: {pattern!r}")
    bad = sorted(set(pattern) & UNSUPPORTED)
    if bad:
        raise UnsupportedGlob(f"{pattern!r} uses {''.join(bad)!r}, which this converter does not implement")
    out, i, n = [], 0, len(pattern)
    while i < n:
        if pattern.startswith("**", i):
            j = i + 2
            while j < n and pattern[j] == "*":   # `***` is `**`
                j += 1
            at_start = i == 0 or pattern[i - 1] == "/"
            if at_start and j < n and pattern[j] == "/":
                out.append("(?:.*/)?")           # `**/` also matches zero directories
                j += 1
            else:
                out.append(".*")
            i = j
        elif pattern[i] == "*":
            out.append("[^/]*")
            i += 1
        else:
            out.append(re.escape(pattern[i]))
            i += 1
    return re.compile("".join(out) + r"\Z")


def compile_patterns(patterns) -> list[re.Pattern]:
    if not isinstance(patterns, list) or not patterns:
        raise UnsupportedGlob(f"not a non-empty list: {patterns!r}")
    return [glob_to_regex(p) for p in patterns]


def matches_any(path: str, compiled: list[re.Pattern]) -> bool:
    return any(rx.match(path) for rx in compiled)


def push_paths(workflow_file: str) -> list[str]:
    """`on.push.paths` of a workflow file. Raises on anything unexpected; the caller turns that into relevant=true."""
    import yaml   # lazily: `verdict` must not need PyYAML

    with open(workflow_file, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    if not isinstance(doc, dict):
        raise ValueError(f"{workflow_file} is not a mapping")
    on = doc.get("on", doc.get(True))      # YAML 1.1 reads the `on:` key as True
    if not isinstance(on, dict) or not isinstance(on.get("push"), dict):
        raise ValueError(f"{workflow_file} has no on.push mapping")
    push = on["push"]
    if push.get("paths-ignore"):
        raise UnsupportedGlob(f"{workflow_file} uses push.paths-ignore, which this tool does not implement")
    paths = push.get("paths")
    if not isinstance(paths, list) or not paths:
        raise ValueError(f"{workflow_file} has no on.push.paths list")
    return paths


def changed_files(base: str, head: str, cwd: str = ".", run=subprocess.run) -> list[str]:
    """Files the PR changes: `git diff --name-only --no-renames base...head` (merge base to head, as GitHub's own PR
    path filter compares). `--no-renames` reports a rename as BOTH its old and its new path. Raises on any failure."""
    sha = re.compile(r"\A[0-9a-fA-F]{7,64}\Z")
    if not (base and head and sha.match(base) and sha.match(head)):
        raise ValueError(f"missing or malformed SHA: base={base!r} head={head!r}")
    proc = run(["git", "diff", "--name-only", "--no-renames", "-z", f"{base}...{head}"],
               cwd=cwd, capture_output=True, timeout=120)
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace") if isinstance(proc.stderr, bytes) else str(proc.stderr)
        raise RuntimeError(f"git diff exited {proc.returncode}: {err.strip()[:300]}")
    out = proc.stdout.decode("utf-8", "replace") if isinstance(proc.stdout, bytes) else str(proc.stdout)
    files = [f for f in out.split("\0") if f]
    if not files:
        raise ValueError("the diff is empty (an empty diff is never evidence of irrelevance)")
    return files


def decide(*, workflow: str, event: str, base: str = "", head: str = "", repo_name: str = "", head_repo: str = "",
           base_ref: str = "", same_repo_pr_bases: str = "", cwd: str = ".", run=subprocess.run) -> Decision:
    """relevant or not, with the reason. Never raises: every error is `_fail_safe()`."""
    try:
        if event != "pull_request":
            return Decision(True, f"event {event!r}: not a PR, GitHub already path-matched it (or it is manual)")
        patterns = push_paths(workflow)
        compiled = compile_patterns(patterns)
        own = workflow.replace("\\", "/")
        own = own[2:] if own.startswith("./") else own
        always = list(ALWAYS_RELEVANT) + [own]
        files = changed_files(base, head, cwd=cwd, run=run)
        hits = [f for f in files if f in always or matches_any(f, compiled)]
        if not hits:
            return Decision(False, f"none of the {len(files)} changed file(s) match {workflow}'s push.paths")
        bases = [b.strip() for b in (same_repo_pr_bases or "").split(",") if b.strip()]
        if bases:
            # agent ci only: same-repo PRs into any other base (agent/int) keep today's push-run-only behaviour.
            if not (repo_name and head_repo and base_ref):
                return _fail_safe("same-repo-pr-bases given without repo-name / head-repo / base-ref")
            if head_repo == repo_name and base_ref not in bases:
                return Decision(False, f"a same-repo PR into {base_ref!r}: the branch's push run carries the verdict "
                                       f"(real jobs run on PRs into {bases} and on fork PRs)")
        return Decision(True, f"{len(hits)} changed file(s) match, e.g. {hits[0]}")
    except Exception as exc:   # noqa: BLE001 — ANY error is relevant=true, by design
        return _fail_safe(f"{type(exc).__name__}: {exc}")


# ── verdict ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def verdict(needs_json: str, expect: list[str]) -> tuple[bool, list[str]]:
    """(ok, explanation lines). Fails closed: see the module docstring."""
    lines: list[str] = []
    try:
        needs = json.loads(needs_json)
    except Exception as exc:   # noqa: BLE001
        return False, [f"FAIL: needs is not JSON ({exc})"]
    if not isinstance(needs, dict):
        return False, [f"FAIL: needs is not an object: {type(needs).__name__}"]
    if "changes" not in expect:
        return False, ["FAIL: --expect must include the `changes` job"]
    missing = [j for j in expect if j not in needs]
    if missing:
        return False, [f"FAIL: expected job(s) missing from needs: {missing} (an absent job proves nothing)"]
    for job, val in sorted(needs.items()):
        lines.append(f"  {job}: {(val or {}).get('result') if isinstance(val, dict) else val!r}")
    changes = needs["changes"] if isinstance(needs["changes"], dict) else {}
    if changes.get("result") != "success":
        return False, [f"FAIL: the `changes` job did not succeed ({changes.get('result')!r})"] + lines
    relevant = (changes.get("outputs") or {}).get("relevant")
    real = {j: (v.get("result") if isinstance(v, dict) else None) for j, v in needs.items() if j != "changes"}
    if relevant == "false":
        bad = {j: r for j, r in real.items() if r not in ("skipped", "success")}
        if bad:
            return False, [f"FAIL: not relevant, yet job(s) ended {bad}"] + lines
        return True, ["PASS: this change does not touch the workflow's paths; its real jobs were not needed"] + lines
    # relevant is "true" — or empty / garbage, which is treated as true
    bad = {j: r for j, r in real.items() if r != "success"}
    if not real:
        return False, ["FAIL: relevant, but no real job is in needs"] + lines
    if bad:
        return False, [f"FAIL: relevant (outputs.relevant={relevant!r}) and job(s) did not succeed: {bad}. "
                       "skipped, cancelled and neutral are failures here."] + lines
    return True, [f"PASS: relevant and all {len(real)} real job(s) succeeded"] + lines


def main(argv=None) -> int:
    try:
        sys.stdout.reconfigure(newline="\n")
    except Exception:   # noqa: BLE001
        pass
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("match")
    m.add_argument("--workflow", required=True)
    m.add_argument("--event", required=True)
    for opt in ("--base", "--head", "--repo-name", "--head-repo", "--base-ref", "--same-repo-pr-bases"):
        m.add_argument(opt, default="")
    v = sub.add_parser("verdict")
    v.add_argument("--expect", required=True, help="comma-separated job ids; must equal the job's `needs`")
    a = ap.parse_args(argv)
    if a.cmd == "match":
        d = decide(workflow=a.workflow, event=a.event, base=a.base, head=a.head, repo_name=a.repo_name,
                   head_repo=a.head_repo, base_ref=a.base_ref, same_repo_pr_bases=a.same_repo_pr_bases)
        print(d.reason)
        print("relevant=" + ("true" if d.relevant else "false"))
        return 0
    try:
        ok, lines = verdict(os.environ.get("NEEDS", ""), [j.strip() for j in a.expect.split(",") if j.strip()])
    except Exception as exc:   # noqa: BLE001
        ok, lines = False, [f"FAIL: verdict crashed: {type(exc).__name__}: {exc}"]
    for ln in lines:
        print(("::error::" if not ok and ln.startswith("FAIL") else "") + ln)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
