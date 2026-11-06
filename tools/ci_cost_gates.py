#!/usr/bin/env python3
"""Classify master gate runs for the batching model, from a ci_cost_report snapshot and local git. Stdlib only.

  agent-batchable  merged from an agent/** branch, may share a gate (max 3 PRs per batch)
  agent-solo       agent/** merge AUDIT says is never batched: spend, limits, schema, workflow or gate change
  non-agent-pr     merged from any other branch through a PR. Cannot be batched; gets a light merge-candidate run.
  non-agent-direct pushed straight to master. Cannot be batched; no PR, so no merge-candidate run exists.

The master gate's own rule: a run's commit is the master tip that triggered it, so a merge subject names the branch.
"""
from __future__ import annotations

import fnmatch
import re
import subprocess

AGENT_BRANCH = re.compile(r"Merge pull request #\d+ from [^/\s]+/(agent/\S+)")
AGENT_MERGE = re.compile(r"Merge (?:remote-tracking )?branch '(?:origin/)?(agent/[^']+)'")
SOLO_WORDS = re.compile(r"(spend|limit|schema|migrat|budget|billing|quota)", re.I)
SOLO_PATHS = (".github/workflows/*", "tools/promotion_gate*", "tools/pre_push_guard*", "tools/deploy_freeze*",
              "*/migrations/*", "*schema*")


def commit_facts(root: str, sha: str) -> dict | None:
    out = subprocess.run(["git", "-C", root, "log", "-1", "--format=%P%x00%s", sha], capture_output=True,
                         text=True, encoding="utf-8", errors="replace")
    if out.returncode:
        return None
    parents, subject = out.stdout.strip().split("\x00", 1)
    files = subprocess.run(["git", "-C", root, "show", "--name-only", "--format=", "-m", "--first-parent", sha],
                           capture_output=True, text=True, encoding="utf-8", errors="replace")
    return {"parents": parents.split(), "subject": subject,
            "files": [line for line in files.stdout.splitlines() if line.strip()]}


def classify(facts: dict | None) -> str:
    if facts is None:
        return "unknown"
    subject = facts["subject"]
    hit = AGENT_BRANCH.match(subject) or AGENT_MERGE.match(subject)
    if not hit:
        return "non-agent-pr" if subject.startswith("Merge pull request") else "non-agent-direct"
    branch = hit.group(1)
    solo_file = any(fnmatch.fnmatchcase(path, pattern) for path in facts["files"] for pattern in SOLO_PATHS)
    return "agent-solo" if SOLO_WORDS.search(branch) or solo_file else "agent-batchable"


def gate_runs(snapshot: dict, root: str) -> list[dict]:
    out = []
    for run in snapshot["runs"]:
        if run["name"] != "master deploy gate":
            continue
        out.append({"created_at": run["created_at"], "kind": classify(commit_facts(root, run["head_sha"]))})
    return sorted(out, key=lambda row: row["created_at"])
