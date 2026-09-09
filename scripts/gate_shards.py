"""The sharded frontend gate, with the checks that make its result mean something.

⛔ WHY THIS EXISTS AS A COMMITTED SCRIPT rather than a shell loop somebody types.

Three separate times this project has recorded a gate result that was not a gate result:

  1. A run launched with an invalid `--minWorkers` died at argument parsing having executed
     nothing, and the background-task wrapper reported **exit 0**. Nothing distinguished
     "17,000 tests passed" from "the runner never started"
     (`lesson_a_task_status_reports_the_wrappers_exit_not_the_suites`).
  2. A chunked run covered 1,016 of 1,178 files and its total was quoted as the gate. A partial
     suite fails in the FLATTERING direction: fewer files run, fewer failures found.
  3. 2026-09-09: a run's own totals-line assertion was written as `grep '^ *Test Files'` and never
     matched, because vitest prefixes that line with ANSI escapes. It alarmed on six healthy
     shards. **The assertion that exists because exit codes lie was itself unverified.** That is
     the direct reason this file has a test.

And a fourth, found the same day: that run's shards saw 1180 files and then 1181, because a new
test file was created WHILE it ran. A gate whose input changes underneath it is not a gate — so
this script refuses a dirty tree, and records the tree hash at start AND end.

⭐ THE SHAPE THAT MAKES IT TESTABLE: every decision lives in a pure function, and `run_gate` takes
its git and subprocess access as parameters. The test drives all four failure modes without
running a 13-minute suite or dirtying a repo.

Usage:
    python scripts/gate_shards.py                       # 6 shards, manifest to docs/plans/joystick/
    python scripts/gate_shards.py --shards 6 --out DIR
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
APP = REPO / "app"

ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")

# ` Test Files  3 failed | 194 passed (197)`  /  `      Tests  4 failed | 2498 passed (2502)`
_FILES_RE = re.compile(r"^\s*Test Files\s+(?P<body>.+?)\s*$")
_TESTS_RE = re.compile(r"^\s*Tests\s+(?P<body>.+?)\s*$")
_TOTAL_RE = re.compile(r"\((\d+)\)\s*$")
_COUNT_RE = re.compile(r"(\d+)\s+(failed|passed|skipped|todo)")


def strip_ansi(text: str) -> str:
    """⛔ ALWAYS BEFORE MATCHING. Proof (a) in the test feeds this real captured bytes."""
    return ANSI_RE.sub("", text)


def _parse_counts(body: str) -> dict:
    out = {"failed": 0, "passed": 0, "skipped": 0, "todo": 0}
    for n, what in _COUNT_RE.findall(body):
        out[what] = int(n)
    m = _TOTAL_RE.search(body)
    out["total"] = int(m.group(1)) if m else 0
    return out


def parse_totals(log_text: str) -> dict | None:
    """The two totals lines, or None if this log has no run in it.

    ⛔ None is the ALARM, and both lines are required. A log with `Test Files` but no `Tests` is a
    run that died between them, which is exactly the shape that must never read as a pass.
    """
    clean = strip_ansi(log_text)
    files = tests = None
    for line in clean.split("\n"):
        m = _FILES_RE.match(line)
        if m:
            files = _parse_counts(m.group("body"))
            continue
        m = _TESTS_RE.match(line)
        if m and "Test Files" not in line:
            tests = _parse_counts(m.group("body"))
    if files is None or tests is None:
        return None
    return {"files": files, "tests": tests}


def sum_totals(per_shard: list[dict]) -> dict:
    """The summed line a future reader reconciles against, without re-running anything."""
    acc = {"files": {}, "tests": {}}
    for group in ("files", "tests"):
        for k in ("failed", "passed", "skipped", "todo", "total"):
            acc[group][k] = sum(s[group].get(k, 0) for s in per_shard)
    return acc


def blob_hash(path: pathlib.Path) -> str:
    """This script's own git blob hash — the manifest names the version that produced it."""
    data = path.read_bytes()
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()


def _git(args: list[str]) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True,
                          check=True).stdout.strip()


def tree_state() -> tuple[str, list[str]]:
    """(HEAD, dirty paths). Both halves matter: a clean tree at the wrong commit is still wrong."""
    head = _git(["rev-parse", "HEAD"])
    dirty = [ln for ln in _git(["status", "--porcelain=v1"]).split("\n") if ln.strip()]
    return head, dirty


def count_test_files() -> int:
    """The denominator. A chunked run must be diffed against it before its total is quoted."""
    return sum(1 for p in (APP / "src").rglob("*") if p.suffix in (".js", ".jsx")
               and (".test." in p.name or ".spec." in p.name))


def _run_shard(index: int, shards: int, out_dir: pathlib.Path) -> str:
    log = out_dir / f"shard-{index}.log"
    proc = subprocess.run(
        ["npx", "vitest", "run", f"--shard={index}/{shards}", "--maxWorkers=2"],
        cwd=APP, capture_output=True, text=True, shell=(sys.platform == "win32"),
    )
    text = (proc.stdout or "") + (proc.stderr or "")
    log.write_text(text, encoding="utf-8")
    return text


class GateError(RuntimeError):
    """Raised for every condition that invalidates a run. The message NAMES the cause."""


def run_gate(shards: int, out_dir: pathlib.Path, *, tree_state_fn=tree_state,
             run_shard_fn=None, file_count_fn=count_test_files) -> dict:
    """Run the gate, or refuse. Returns the manifest dict.

    Every failure mode raises `GateError` naming itself, so a caller can never mistake one for
    another — and so the test can assert WHICH one fired.
    """
    run_shard_fn = run_shard_fn or (lambda i: _run_shard(i, shards, out_dir))

    # ⛔ (d) DIRTY START — refuse BEFORE running anything. A gate runs on committed code only;
    # otherwise the artifact it reports on cannot be recovered by anyone reading the manifest.
    start_head, start_dirty = tree_state_fn()
    if start_dirty:
        raise GateError(
            "DIRTY TREE: refusing to start. A gate runs on committed code only, so its result can "
            f"be tied to a hash. Uncommitted: {', '.join(start_dirty[:10])}"
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    per_shard, missing = [], []
    for i in range(1, shards + 1):
        totals = parse_totals(run_shard_fn(i))
        # ⛔ (b) A SHARD WITH NO TOTALS LINE DID NOT RUN. Never the exit code — it lies.
        if totals is None:
            missing.append(i)
        else:
            per_shard.append({"shard": i, **totals})

    if missing:
        raise GateError(
            "NO TOTALS LINE from shard(s) "
            + ", ".join(str(i) for i in missing)
            + " — those shards did not run. A test run without a totals line is not a run."
        )

    # ⛔ (c) DRIFT — the tree that finished must be the tree that started.
    end_head, end_dirty = tree_state_fn()
    if end_head != start_head or end_dirty:
        raise GateError(
            f"TREE DRIFT during the run: started at {start_head} clean, ended at {end_head}"
            + (f" with {len(end_dirty)} uncommitted file(s)" if end_dirty else "")
            + ". The tree it ran against is not the tree it would report on; this run is void."
        )

    summed = sum_totals(per_shard)
    declared = file_count_fn()
    return {
        "at": _dt.datetime.now().isoformat(timespec="seconds"),
        "tree_head_start": start_head,
        "tree_head_end": end_head,
        "wrapper": "scripts/gate_shards.py",
        "wrapper_blob": blob_hash(pathlib.Path(__file__)),
        "shards": shards,
        "per_shard": per_shard,
        "summed": summed,
        "test_files_on_disk": declared,
        "file_count_reconciles": summed["files"]["total"] == declared,
    }


def render(manifest: dict) -> str:
    s, f, t = manifest["summed"], manifest["summed"]["files"], manifest["summed"]["tests"]
    lines = [
        f"# Gate run — {manifest['at']}",
        "",
        f"- tree: `{manifest['tree_head_start']}` (start) -> `{manifest['tree_head_end']}` (end)",
        f"- wrapper: `{manifest['wrapper']}` blob `{manifest['wrapper_blob']}`",
        f"- shards: {manifest['shards']}",
        "",
        "| shard | test files | tests |",
        "|---|---|---|",
    ]
    for sh in manifest["per_shard"]:
        lines.append(
            f"| {sh['shard']} | {sh['files']['failed']} failed / {sh['files']['total']} "
            f"| {sh['tests']['failed']} failed / {sh['tests']['passed']} passed / {sh['tests']['total']} |"
        )
    lines += [
        f"| **Σ** | **{f['failed']} failed / {f['total']}** "
        f"| **{t['failed']} failed / {t['passed']} passed / {t['total']}** |",
        "",
        f"- test files on disk: **{manifest['test_files_on_disk']}** — "
        f"{'RECONCILES' if manifest['file_count_reconciles'] else '⛔ DOES NOT RECONCILE'} "
        f"with the summed file total ({f['total']}).",
    ]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--shards", type=int, default=6)
    ap.add_argument("--out", default=str(REPO / "docs" / "plans" / "joystick" / "gate-runs"))
    args = ap.parse_args(argv)
    out_dir = pathlib.Path(args.out)
    try:
        manifest = run_gate(args.shards, out_dir)
    except GateError as e:
        print(f"\n  GATE INVALID: {e}\n", file=sys.stderr)
        return 2
    stamp = manifest["at"].replace(":", "-")
    (out_dir / f"{stamp}.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (out_dir / f"{stamp}.md").write_text(render(manifest), encoding="utf-8")
    print(render(manifest))
    # ⚠️ Exit 0 means THE RUN IS VALID, not that the suite is green — this branch gates on "no NEW
    # failures against a measured baseline", which is a judgement the manifest supports and this
    # script deliberately does not make.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
