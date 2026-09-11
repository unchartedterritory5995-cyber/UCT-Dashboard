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
        ROOT / ".pytest_chunks" / stamp)
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
    (out_dir / "summary.json").write_text(
        json.dumps({"chunks": results, "totals": total, "killed": killed, "red": red},
                   indent=2), encoding="utf-8")
    print("summary:", out_dir / "summary.json")

    return 1 if (killed or red) else 0


def io_open(p: pathlib.Path):
    return open(p, "w", encoding="utf-8", errors="replace")


if __name__ == "__main__":
    raise SystemExit(main())
