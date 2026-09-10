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


_FAIL_RE = re.compile(r"^\s*FAIL\s+(?P<id>\S+.*?)\s*$")

BASELINE = REPO / "docs" / "plans" / "joystick" / "gate-baseline.json"


def parse_failures(log_text: str) -> list[str]:
    """Every failing test's full identity — `file > describe > test`.

    ⛔ NAMES, NOT A COUNT. "9 failed" is satisfied by NINE DIFFERENT failures just as happily as by
    the nine known ones, so a count-based gate passes a branch that fixed nine and broke nine. The
    merge ruling rests on this comparison, so it compares identities.
    """
    out = []
    for line in strip_ansi(log_text).split("\n"):
        m = _FAIL_RE.match(line)
        if m:
            ident = m.group("id").strip()
            if ident and ident not in out:
                out.append(ident)
    return sorted(out)


def load_baseline() -> dict:
    """The known-failing set this branch is measured against, or an empty baseline if absent."""
    if not BASELINE.exists():
        return {"measured_at": None, "sha": None, "failures": []}
    return json.loads(BASELINE.read_text(encoding="utf-8"))


def compare_failures(observed: list[str], baseline: list[str]) -> dict:
    """What this run changed about the failing set. `new` is the only one that can block a merge."""
    obs, base = set(observed), set(baseline)
    return {
        "observed_count": len(obs),
        "baseline_count": len(base),
        "new": sorted(obs - base),               # ⛔ regressions — the gate's actual verdict
        "no_longer_failing": sorted(base - obs),  # informational: fixed, or silently stopped running
        "matches_baseline": obs == base,
    }


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
    # ⛔ encoding= IS NOT OPTIONAL. `text=True` alone decodes with the platform default, which is
    # cp1252 on this machine — so a non-ASCII commit message or branch name would take the wrapper
    # down with a UnicodeDecodeError and no obvious cause. Same omission as `_run_shard` below.
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", check=True).stdout.strip()


def tree_state() -> tuple[str, list[str]]:
    """(HEAD, dirty paths). Both halves matter: a clean tree at the wrong commit is still wrong."""
    head = _git(["rev-parse", "HEAD"])
    dirty = [ln for ln in _git(["status", "--porcelain=v1"]).split("\n") if ln.strip()]
    return head, dirty


def count_test_files() -> int:
    """The denominator. A chunked run must be diffed against it before its total is quoted."""
    return sum(1 for p in (APP / "src").rglob("*") if p.suffix in (".js", ".jsx")
               and (".test." in p.name or ".spec." in p.name))


def _capture(cmd: list[str], cwd, *, shell: bool | None = None, timeout=None) -> str:
    """⛔ THE ONE PLACE A SUBPROCESS IS READ, so `encoding=` cannot be omitted in two places.

    It was omitted in one, and that is the entire reason this function exists as a seam: a rail can
    execute THIS for real, which is what rule 10 asks for. Duplicating the `subprocess.run(...)`
    call shape at another site is how the omission comes back.
    """
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
        shell=(sys.platform == "win32") if shell is None else shell,
        timeout=timeout,
    )
    return (proc.stdout or "") + (proc.stderr or "")


def _run_shard(index: int, shards: int, out_dir: pathlib.Path, max_workers: int = 2) -> str:
    log = out_dir / f"shard-{index}.log"
    # ⛔⛔ `encoding="utf-8"` IS THE WHOLE POINT OF THIS LINE. Shipped without it, `text=True`
    # decoded vitest's UTF-8 output as cp1252, the reader thread died on the first check mark
    # (0x90), and SIX SHARDS RAN FOR SIXTEEN MINUTES AND RETURNED EMPTY STDOUT. The wrapper then
    # correctly reported "no totals line" — a true statement about a false cause.
    # `errors="replace"` means a stray undecodable byte degrades one character instead of
    # destroying an entire run.
    text = _capture(
        ["npx", "vitest", "run", f"--shard={index}/{shards}", f"--maxWorkers={max_workers}"], APP)
    log.write_text(text, encoding="utf-8")
    return text


def say(text: str, *, err: bool = False) -> None:
    """⛔ CONSOLE OUTPUT IS AN I/O BOUNDARY TOO, AND THIS IS THE THIRD BODY OF ONE DISEASE.

    First the subprocess READ decoded as cp1252 and destroyed a sixteen-minute run. Then `_git` had
    the same exposure. Now the WRITE: `print(render(manifest))` raised UnicodeEncodeError on the Σ
    in the summary row, and the wrapper died **after a completely successful gate** — manifest
    written, tree verified, zero new failures, exit 1.

    Failing at the last line of a passing run is the least harmful version of this bug and the most
    embarrassing. Every console write goes through here so there is ONE place, and `errors=replace`
    means an unencodable character degrades to `?` instead of taking the process down.
    """
    stream = sys.stderr if err else sys.stdout
    data = (text + "\n").encode("utf-8", "replace")
    buf = getattr(stream, "buffer", None)
    if buf is not None:
        buf.write(data)
        buf.flush()
    else:                                   # a stream with no binary buffer (captured in tests)
        stream.write(data.decode("utf-8", "replace"))
        stream.flush()


class GateError(RuntimeError):
    """Raised for every condition that invalidates a run. The message NAMES the cause."""


def run_gate(shards: int, out_dir: pathlib.Path, *, tree_state_fn=tree_state,
             run_shard_fn=None, file_count_fn=count_test_files, max_workers: int = 2) -> dict:
    """Run the gate, or refuse. Returns the manifest dict.

    Every failure mode raises `GateError` naming itself, so a caller can never mistake one for
    another — and so the test can assert WHICH one fired.
    """
    run_shard_fn = run_shard_fn or (lambda i: _run_shard(i, shards, out_dir, max_workers))

    # ⛔ THE WRAPPER'S OWN OUTPUT IS NOT TREE DRIFT, AND THIS COST A SECOND RUN.
    #
    # `out_dir` lives inside the repo, so the shard logs this script writes show up in
    # `git status` as untracked — and the drift check then fired on the tool's own artifacts:
    # "started clean, ended with 1 uncommitted file(s)", where the file was `gate-runs/` itself.
    # The check was right and its SCOPE was wrong. Drift means the SOURCE changed underneath the
    # run; a log the wrapper wrote on purpose is not that.
    #
    # ⚠️ Deliberately narrow: only paths under `out_dir` are exempt. Anything else that appears
    # mid-run still voids the run, which is the whole point of the check.
    try:
        out_rel = out_dir.resolve().relative_to(REPO).as_posix()
    except (ValueError, OSError):
        out_rel = None

    def _real_dirt(entries: list[str]) -> list[str]:
        if not out_rel:
            return entries
        keep = []
        for e in entries:
            path = e[3:].strip().strip('"') if len(e) > 3 else e
            if not path.startswith(out_rel):
                keep.append(e)
        return keep

    # ⛔ (d) DIRTY START — refuse BEFORE running anything. A gate runs on committed code only;
    # otherwise the artifact it reports on cannot be recovered by anyone reading the manifest.
    start_head, start_dirty = tree_state_fn()
    start_dirty = _real_dirt(start_dirty)
    if start_dirty:
        raise GateError(
            "DIRTY TREE: refusing to start. A gate runs on committed code only, so its result can "
            f"be tied to a hash. Uncommitted: {', '.join(start_dirty[:10])}"
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    per_shard, missing, failures = [], [], []
    for i in range(1, shards + 1):
        text = run_shard_fn(i) or ""
        # ⛔ CAPTURE FAILURE IS NOT PARSE FAILURE, AND CONFLATING THEM COST SIXTEEN MINUTES OF
        # DIAGNOSIS. A shard that ran for minutes and returned NOTHING is a broken pipe between
        # this process and vitest; a shard that returned output with no totals line is a run that
        # died. Different causes, different fixes, so they get different names.
        # ⭐ AND IT ABORTS: five more shards into a pipe already known to be broken is thirteen
        # wasted minutes to reach a conclusion that was available at shard 1.
        if not text.strip():
            raise GateError(
                f"EMPTY CAPTURE from shard {i}: the shard was executed but its output never "
                f"reached this process — a broken pipe, not a failed run (check the subprocess "
                f"decoding). Aborting; the remaining shards were NOT run."
            )
        totals = parse_totals(text)
        # ⛔ (b) A SHARD WITH OUTPUT BUT NO TOTALS LINE DID NOT RUN. Never the exit code.
        if totals is None:
            missing.append(i)
        else:
            per_shard.append({"shard": i, **totals})
            failures.extend(parse_failures(text))

    if missing:
        raise GateError(
            "NO TOTALS LINE from shard(s) "
            + ", ".join(str(i) for i in missing)
            + " — those shards did not run. A test run without a totals line is not a run."
        )

    # ⛔ (c) DRIFT — the tree that finished must be the tree that started.
    end_head, end_dirty = tree_state_fn()
    end_dirty = _real_dirt(end_dirty)
    if end_head != start_head or end_dirty:
        raise GateError(
            # ⛔ NAME WHAT DRIFTED. This said "with N uncommitted file(s)" and a count is not a
            # diagnosis — the reader then has to reconstruct which file moved, which is the same
            # names-not-counts defect the baseline comparison exists to fix.
            f"TREE DRIFT during the run: started at {start_head} clean, ended at {end_head}"
            + (f" with {len(end_dirty)} uncommitted file(s): "
               + ", ".join(e.strip() for e in end_dirty[:10]) if end_dirty else "")
            + ". The tree it ran against is not the tree it would report on; this run is void."
        )

    summed = sum_totals(per_shard)
    declared = file_count_fn()
    base = load_baseline()
    failures = sorted(set(failures))
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
        "failures": failures,
        "baseline_sha": base.get("sha"),
        "baseline_measured_at": base.get("measured_at"),
        "vs_baseline": compare_failures(failures, base.get("failures") or []),
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

    # ⛔ THE VERDICT IS A SET COMPARISON, NOT A COUNT. Nine different failures also count nine.
    v = manifest.get("vs_baseline") or {}
    lines += [
        "",
        f"## Failing set vs baseline (`{manifest.get('baseline_sha') or 'NO BASELINE'}`, "
        f"measured {manifest.get('baseline_measured_at') or '—'})",
        "",
        f"- observed **{v.get('observed_count', 0)}** failing tests, baseline has "
        f"**{v.get('baseline_count', 0)}**",
        f"- **NEW failures (regressions): {len(v.get('new') or [])}**"
        + ("" if v.get("new") else " — none"),
    ]
    for nf in (v.get("new") or []):
        lines.append(f"    - ⛔ {nf}")
    if v.get("no_longer_failing"):
        lines.append(f"- no longer failing: {len(v['no_longer_failing'])} "
                     f"(fixed, or silently stopped running — check which)")
        for nf in v["no_longer_failing"]:
            lines.append(f"    - {nf}")
    lines.append("")
    lines.append("✅ **The failing set matches the baseline exactly.**" if v.get("matches_baseline")
                 else "⛔ **The failing set DIFFERS from the baseline** — read the two lists above.")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--shards", type=int, default=6)
    ap.add_argument("--out", default=str(REPO / "docs" / "plans" / "joystick" / "gate-runs"))
    # ⛔ DEFAULT UNCHANGED AT 2. This exists because this box runs several
    # sessions at once: three worktrees had full suites in flight and the host
    # OOM-killed mine twice. Lowering MY footprint is the only lever that does
    # not require destroying somebody else's 13-minute run.
    ap.add_argument("--max-workers", type=int, default=2,
                    help="vitest workers per shard; lower it when the box is contended")
    args = ap.parse_args(argv)
    out_dir = pathlib.Path(args.out)
    try:
        manifest = run_gate(args.shards, out_dir, max_workers=args.max_workers)
    except GateError as e:
        # ⛔ A REFUSED RUN LEAVES NO ARTIFACT THAT LOOKS LIKE A RUN. The first failure of this
        # wrapper left six 0-byte `shard-*.log` files behind, and a directory of empty logs reads
        # as "a run happened" to anyone who does not know the story. Clear them, and leave ONE
        # file that says INVALID and why.
        removed = 0
        stamp = _dt.datetime.now().isoformat(timespec="seconds").replace(":", "-")
        if out_dir.exists():
            for stale in out_dir.glob("shard-*.log"):
                stale.unlink()
                removed += 1
            (out_dir / f"INVALID-{stamp}.md").write_text(
                f"# Gate run INVALID — {stamp}\n\n"
                f"**No result was produced. This is not a gate run.**\n\n"
                f"> {e}\n\n"
                f"Per-shard logs from the refused attempt were deleted ({removed} file(s)) so an\n"
                f"empty log directory cannot be mistaken for a completed run.\n",
                encoding="utf-8")
        say(f"\n  GATE INVALID: {e}\n", err=True)
        say(f"  (cleared {removed} partial shard log(s); wrote INVALID-{stamp}.md)\n", err=True)
        return 2
    stamp = manifest["at"].replace(":", "-")
    (out_dir / f"{stamp}.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (out_dir / f"{stamp}.md").write_text(render(manifest), encoding="utf-8")
    say(render(manifest))
    # ⚠️ Exit 0 means THE RUN IS VALID, not that the suite is green — this branch gates on "no NEW
    # failures against a measured baseline", which is a judgement the manifest supports and this
    # script deliberately does not make.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
