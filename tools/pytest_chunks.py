"""Run the FULL backend suite in sequential chunks, on a box that will OOM-kill it.

⛔⛔ WHY THIS EXISTS, AND IT IS NOT A CONVENIENCE. On 2026-09-10 three separate
unscoped ``pytest tests/`` runs on this machine were OOM-killed by the host, one
of them at **15.9 GB**, and they took other sessions' background work down with
them. The repo already SAID the real runners were "chunked suite runners" --
``pytest.ini`` says so in a comment, ``tools/tests_reaching.py`` says the suite
"has to be chunked" -- but no chunk runner was ever committed. A rule that lives
only in prose is a rule that gets skipped by whoever has not read that prose.

⭐⭐ THE MEMORY IS SPENT IN COLLECTION, NOT EXECUTION, WHICH IS WHY CHUNKING
WORKS AT ALL. Measured by a peer session the same night: ``--collect-only`` ALONE
reaches ~4.5 GB. ``api/main.py`` is ~9,800 lines and mounts ~986 routes, so any
collected module that imports ``api.main`` at module scope pays that cost, and
the repo-root ``conftest.py`` additionally runs an AST census over ``api/**``,
``scripts/`` and ``tools/`` at import. So ``-k`` and ``--timeout`` cannot contain
it -- they filter AFTER collection. Only giving pytest FEWER FILES does.

⛔ THE FILE LIST COMES FROM THE FILESYSTEM, NEVER FROM ``--collect-only``.
Asking pytest to enumerate the suite is the very thing that blows up. This walks
``pytest.ini::testpaths`` directly, which costs nothing.

⛔ SEQUENTIAL, NEVER PARALLEL. Parallel chunks multiply the peak rather than
divide it, and the peak is what kills the box. `-n auto` here would be worse
than the unscoped run it replaces.

⭐⭐ AND EVERY CHUNK'S STATUS IS READ FROM THE PROCESS, NEVER THROUGH A PIPE.
``pytest ... | tail`` reports TAIL's exit code. That is not a footnote: it hid
all three OOM kills, twice on the same night, because a killed pytest behind a
pipe leaves an empty log and a zero exit -- which reads first as "still running"
and then as "finished quietly". Here each chunk redirects to its own file and
the runner keeps ``proc.returncode``.

⛔ A CHUNK THAT PRODUCED NO SUMMARY LINE IS AN OOM KILL UNTIL PROVEN OTHERWISE.
pytest always prints a summary when it runs to completion, whatever the result.
Its absence means the process died before it could -- so this reports that chunk
as KILLED rather than folding it into "0 failed", which is the reading that let
three kills pass as quiet successes.

USAGE::

    python tools/pytest_chunks.py                  # all 12 chunks, sequential
    python tools/pytest_chunks.py --chunks 12
    python tools/pytest_chunks.py --only 3         # just chunk 3 (1-based)
    python tools/pytest_chunks.py --out-dir <dir>  # where the per-chunk logs go
"""
from __future__ import annotations

import argparse
import configparser
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _make_own_output_utf8() -> None:
    """⛔⛔ THE RUNNER'S OWN STDOUT, NOT THE CHILD'S (2026-09-12).

    ⚰️ RUN 4 DIED HERE, AT CHUNK 2 OF 12. This module already set
    ``PYTHONIOENCODING=utf-8`` on the *subprocess* env — and then printed its own
    ⛔ warnings through a parent stdout that a background capture had handed it
    as **cp1252**. The first ⛔ it tried to write raised
    ``UnicodeEncodeError: 'charmap' codec can't encode character '\\u26d4'`` and
    took the whole run with it, ten chunks unrun.

    ⛔ AND THE WARNING IT DIED PRINTING WAS THE KILLED-CHUNK WARNING — the single
    most important line this tool emits. An instrument whose failure mode is
    "crashes while reporting a failure" reports success by omission.

    ⭐ IT IS FIXED IN THE RUNNER, NOT IN THE CALLER'S ENVIRONMENT, deliberately:
    a rule that lives in whoever-remembers-to-export is the rule this whole file
    exists because nobody remembered.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError, OSError):
            # A stream that cannot be reconfigured must not stop the run — but it
            # must not be able to kill it later either, which `errors="replace"`
            # above is what guarantees when it works. Nothing else to do here.
            pass


def worktree_roots() -> list[pathlib.Path]:
    """Every git worktree root this checkout knows about, resolved.

    ⛔ ASKED OF GIT, NEVER GUESSED FROM THE PATH. A sibling checkout can live
    anywhere; only git knows where they all are."""
    try:
        out = subprocess.run(
            ["git", "worktree", "list", "--porcelain"],
            cwd=str(ROOT), capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return [ROOT]
    roots = [pathlib.Path(line[len("worktree "):].strip()).resolve()
             for line in out.stdout.splitlines() if line.startswith("worktree ")]
    return roots or [ROOT]


#: The ONE place inside a worktree a log directory may live: that worktree's own
#: gitignored `.pytest_chunks/`. Named so the default and an explicit
#: `--out-dir` are judged by the SAME rule rather than the default being exempt.
SANCTIONED_IN_TREE = ".pytest_chunks"


def refuse_out_dir(out_dir: pathlib.Path, roots: list[pathlib.Path]):
    """``None`` if this log directory is safe, else the sentence to refuse with.

    ⛔⛔ WHY A LOG DIRECTORY IS GUARDED AT ALL (owner ruling, 2026-09-12). On
    2026-09-12 this worktree was emptied WHILE a run was in flight — 1,399 files
    enumerated at start, 332 ``ModuleNotFoundError: spec not found`` in chunk 1,
    and chunk 2 refusing to start on a path that no longer existed. This module
    was exonerated by reading it (it performs no delete of any kind), but the
    standing rule from that day is that a tool must not be *able* to point its
    writes at a checkout. So the check is structural rather than a promise.

    Three refusals, and the third is the one that matters most:
      * the directory IS a worktree root
      * the directory is INSIDE a worktree, other than that worktree's own
        gitignored ``.pytest_chunks/``
      * the directory is ABOVE a worktree root — a parent of a checkout is the
        blast radius that took this session's worktree with it
    """
    out_dir = out_dir.resolve()
    for root in roots:
        if out_dir == root:
            return f"--out-dir IS a git worktree root: {out_dir}"
        if root in out_dir.parents:
            rel = out_dir.relative_to(root)
            if rel.parts and rel.parts[0] == SANCTIONED_IN_TREE:
                continue
            return (f"--out-dir is inside the git worktree {root} at {out_dir}. "
                    f"The only sanctioned in-tree location is "
                    f"{root / SANCTIONED_IN_TREE}, which is gitignored.")
        if out_dir in root.parents:
            return (f"--out-dir {out_dir} is ABOVE the git worktree root {root}. "
                    "A parent of a checkout is never a log directory.")
    return None

#: pytest's own documented exit codes. Anything else is the OS, not pytest.
#: 0 all passed · 1 tests failed · 2 interrupted · 3 internal error
#: 4 usage error · 5 no tests collected
PYTEST_EXIT_CODES = {0, 1, 2, 3, 4, 5}

SUMMARY = re.compile(
    r"^=+\s.*?(\d+\s+(?:passed|failed|error|skipped)).*?\s=+$|"
    r"^\s*\d+\s+(?:passed|failed|error)\b",
    re.MULTILINE,
)
COUNT = re.compile(r"(\d+)\s+(passed|failed|error|errors|skipped|xfailed|xpassed|deselected)")


def testpaths() -> list[str]:
    """The roots ``pytest.ini`` declares. ⛔ READ, never typed here -- a second
    copy of that list is the second-authority defect this repo keeps paying for,
    and ``tests/test_test_discovery_coverage.py`` already fails by name on any
    collectable file outside them."""
    cfg = configparser.ConfigParser()
    cfg.read(ROOT / "pytest.ini")
    raw = cfg.get("pytest", "testpaths", fallback="tests")
    return [p.strip() for p in raw.split() if p.strip()]


def test_files() -> list[str]:
    """Every test file under the declared roots, POSIX-relative and sorted.

    ⭐ Sorted so the chunking is DETERMINISTIC: chunk 7 holds the same files on
    every run and on every machine, which is what makes "chunk 7 is red" a
    reproducible statement rather than a coincidence of walk order."""
    out: set[str] = set()
    for root in testpaths():
        base = ROOT / root
        if not base.is_dir():
            continue
        for p in base.rglob("*.py"):
            n = p.name
            if n.startswith("test_") or n.endswith("_test.py"):
                if "__pycache__" in p.parts:
                    continue
                out.add(p.relative_to(ROOT).as_posix())
    return sorted(out)


def chunk(items: list[str], n: int, i: int) -> list[str]:
    """Contiguous slice ``i`` of ``n`` -- NOT round-robin.

    ⭐ Contiguous keeps a package's files together, so one chunk imports one
    neighbourhood of the app rather than every corner of it. That is the whole
    memory argument: round-robin would have each chunk touch all of ``api/**``."""
    size, rem = divmod(len(items), n)
    start = i * size + min(i, rem)
    end = start + size + (1 if i < rem else 0)
    return items[start:end]


#: pytest's final line, wherever it ended up. The ``in <n>s`` clause is what
#: makes it the SUMMARY rather than any other line that mentions "3 failed".
SUMMARY_LINE = re.compile(
    r"^.*?\b\d+\s+(?:passed|failed|error|errors)\b.*?\bin\s+[\d.]+s.*$",
    re.MULTILINE,
)


def summary_line(text: str):
    """The LAST summary pytest printed, searched over the WHOLE log.

    ⚰️⚰️ THIS USED TO READ ``text[-4000:]`` AND IT LOST A WHOLE CHUNK.
    Measured 2026-09-10 on the first full run: chunk 11 printed
    ``6 failed, 1870 passed`` at line 407, and then a **daemon thread started by
    an imported ``api.main``** logged 4 MB after it, pushing the summary far
    outside the tail. The chunk reported ``(no counts)``, so its 1,870 passes
    and 6 failures contributed NOTHING to TOTALS — the run under-reported itself
    and looked tidy doing it.

    ⛔ SAME DEFECT CLASS AS THE ONE R7 EXISTS FOR. A killed chunk lies by
    printing nothing; this one lied by printing too much. An instrument that
    quietly drops a number is worse than one that fails outright, because the
    total still looks like a total.
    """
    hits = SUMMARY_LINE.findall(text)
    return hits[-1] if hits else None


def parse_counts(text: str) -> dict:
    #: Parse the located summary line ONLY — counting over a whole log would sum
    #: every "N passed" pytest printed along the way.
    line = summary_line(text)
    if line is None:
        line = text[-4000:]
    got: dict[str, int] = {}
    for m in COUNT.finditer(line):
        k = m.group(2).rstrip("s") if m.group(2) != "passed" else "passed"
        got[k] = max(got.get(k, 0), int(m.group(1)))
    return got


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--chunks", type=int, default=12)
    ap.add_argument("--only", type=int, default=None, help="1-based chunk index")
    ap.add_argument("--out-dir", default=None)
    args = ap.parse_args()

    files = test_files()
    if not files:
        print("REFUSED: found no test files under", testpaths())
        return 1

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = pathlib.Path(args.out_dir) if args.out_dir else (
        ROOT / SANCTIONED_IN_TREE / stamp)
    # ⛔⛔ JUDGED BEFORE IT IS CREATED. `mkdir(parents=True)` on a bad path would
    # already have made directories somewhere it should never write.
    bad = refuse_out_dir(out_dir, worktree_roots())
    if bad:
        print("REFUSED:", bad)
        print("VERDICT: FAIL (refused before any chunk ran)")
        return 2
    out_dir.mkdir(parents=True, exist_ok=True)

    idxs = [args.only - 1] if args.only else list(range(args.chunks))
    print(f"{len(files)} test files -> {args.chunks} chunks, SEQUENTIAL")
    print(f"logs: {out_dir}\n")

    results = []
    env = dict(os.environ, PYTHONIOENCODING="utf-8")

    for i in idxs:
        part = chunk(files, args.chunks, i)
        if not part:
            continue
        log = out_dir / f"chunk-{i + 1:02d}.log"
        # ⛔ NO PIPE. The status must come from the process, not from a filter
        # downstream of it.
        with io_open(log) as fh:
            proc = subprocess.run(
                [sys.executable, "-m", "pytest", "-q", "-p", "no:randomly", *part],
                cwd=str(ROOT), stdout=fh, stderr=subprocess.STDOUT, env=env,
            )
        text = log.read_text(encoding="utf-8", errors="replace")
        has_summary = bool(SUMMARY.search(text))
        counts = parse_counts(text)

        # ⛔⛔ THE KILL TEST. A chunk that ran prints a summary whatever happened.
        # No summary => the process died before pytest could speak, and the
        # commonest cause on this box is the host OOM-killer.
        killed = (not has_summary) or (proc.returncode not in PYTEST_EXIT_CODES)
        state = "KILLED" if killed else ("ok" if proc.returncode == 0 else "red")
        results.append({
            "chunk": i + 1, "files": len(part), "exit": proc.returncode,
            "state": state, "hasSummary": has_summary, "bytes": len(text),
            "counts": counts, "log": str(log),
        })
        print(f"  chunk {i + 1:02d}/{args.chunks}  {len(part):4d} files  "
              f"exit={proc.returncode:<6} {state:<6} {counts if counts else '(no counts)'}")
        if has_summary and not counts:
            # ⛔ A CHUNK THAT RAN BUT WHOSE NUMBERS DID NOT PARSE MUST SHOUT.
            # Contributing 0 to TOTALS in silence is how a run under-reports
            # itself while still printing something that looks like a total.
            print("     ⛔ SUMMARY FOUND BUT COUNTS UNPARSED — this chunk's numbers "
                  f"are MISSING from TOTALS. Read it by hand: {log}")
        if killed:
            print(f"     ⛔ NO SUMMARY LINE and/or a non-pytest exit code — treat as an "
                  f"OOM kill. Log is {len(text)} bytes: {log}")

    total = {}
    for r in results:
        for k, v in r["counts"].items():
            total[k] = total.get(k, 0) + v
    killed = [r["chunk"] for r in results if r["state"] == "KILLED"]
    red = [r["chunk"] for r in results if r["state"] == "red"]

    print("\n" + "=" * 60)
    print("TOTALS:", total or "(none)")
    print("red chunks:", red or "none")
    print("KILLED chunks:", killed or "none")
    if killed:
        print("⛔ A KILLED CHUNK IS NOT A PASS. Its tests did not run and its counts "
              "are missing from the totals above.")
    # ⛔⛔ A RUN WITH NO TOTALS LINE IS NOT A RUN (owner ruling, 2026-09-12).
    # Run 4 printed a per-chunk line for chunk 1, died mid-report on chunk 2, and
    # its wrapper reported exit 0. Three separate ways that could read as success
    # are now three ways to fail, each named:
    #   * no counts at all           — nothing was measured
    #   * a chunk that ran but whose numbers did not parse — silently missing
    #   * fewer chunks than asked for — the run did not finish
    unparsed = [r["chunk"] for r in results if r["hasSummary"] and not r["counts"]]
    asked = len(idxs)
    short = asked - len(results)
    verdict_reasons = []
    if not total:
        verdict_reasons.append("NO TOTALS — nothing was measured")
    if unparsed:
        verdict_reasons.append(f"counts unparsed in chunks {unparsed} — their "
                               "numbers are MISSING from the totals above")
    if short > 0:
        verdict_reasons.append(f"{short} of {asked} chunks produced no result at all")
    if killed:
        verdict_reasons.append(f"KILLED chunks {killed}")
    if red:
        verdict_reasons.append(f"red chunks {red}")

    (out_dir / "summary.json").write_text(
        json.dumps({"chunks": results, "totals": total, "killed": killed, "red": red,
                    "unparsed": unparsed, "asked": asked, "reasons": verdict_reasons},
                   indent=2), encoding="utf-8")
    print("summary:", out_dir / "summary.json")

    # ⭐ THE LAST LINE IS ALWAYS A VERDICT, so a run read through a pipe — whose
    # exit status belongs to the pipe, not to this process — is still legible.
    # That is exactly how run 4's failure reached a reader as "exit 0".
    if verdict_reasons:
        print("VERDICT: FAIL — " + "; ".join(verdict_reasons))
        return 1
    print("VERDICT: PASS")
    return 0


def io_open(p: pathlib.Path):
    return open(p, "w", encoding="utf-8", errors="replace")


if __name__ == "__main__":
    # ⛔⛔ A CRASHED RUNNER EXITS NONZERO AND SAYS SO ON ITS LAST LINE.
    # Run 4's traceback went to stderr and its exit status went to `tail`; the
    # reader saw "[exited with code 0]". An uncaught exception already exits 1,
    # but the VERDICT line is what survives a pipe, so it is printed here too.
    _make_own_output_utf8()
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except BaseException:
        import traceback
        traceback.print_exc()
        print("VERDICT: FAIL — the runner itself crashed; chunks after the last "
              "one reported above DID NOT RUN")
        raise SystemExit(3)
