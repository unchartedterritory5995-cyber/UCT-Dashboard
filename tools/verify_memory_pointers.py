"""MANDATORY GATE on any edit to the auto-memory index (MEMORY.md).

⚰️ WHY THIS EXISTS
==================
On 2026-09-09 a size-pressure compaction of MEMORY.md **truncated 15 lines at
their first `·` separator and dropped 26 pointers — with ZERO lines deleted.**
Among them: the entire standing-preferences list (`_autonomy`, `_always_push`,
`_ship_then_polish`, `_no_generic_emoji`, `_check_railway_vars_first`,
`_opus_for_synthesis`, `_fix_core_experience_not_chrome`,
`feedback_explicit_ship_gate`, `feedback_prose_questions_over_modal`) and a
⛔⛔ NEVER rule. A future session would simply not have loaded any of them.

⛔ **A LINE-COUNT CHECK WOULD NOT HAVE CAUGHT IT.** Every entry was still there;
each had merely lost its tail. Byte size went down, entry count did not move,
and the index still read as complete. Only a comparison of the POINTER SET can
tell "compacted" from "silently lopped".

⛔ The compaction rule that caused it kept "head + first hard warning" and threw
the rest away — backwards, because pointers live in the LATER segments. Any
future compaction must drop only segments carrying neither a pointer nor a hard
warning: prose is the compressible part of an index.

HOW IT DECIDES
==============
The gate is a BASELINE diff, not an archive diff. The archives are history —
older ones legitimately hold entries that were retired on purpose, so "in an
archive and not in the index" is a normal state and cannot be the test. The
baseline (`tools/memory_pointer_baseline.txt`) is the set of pointers the index
is known to carry; losing one is a FAILURE, and removing one from the baseline
has to be a deliberate, reviewable edit.

⛔ Names are NORMALISED before comparison. The index writes both
`[[feedback_always_push]]` and the shorthand `` `_always_push` `` for the same
memory. The first version of this gate compared them as raw strings and reported
~20 false losses — a gate that cries wolf gets muted, which is the same outcome
as no gate.

USAGE
=====
    python tools/verify_memory_pointers.py                 # exit 1 on any loss
    python tools/verify_memory_pointers.py --update-baseline   # deliberate, review the diff
    python tools/verify_memory_pointers.py --self-check     # prove the gate can FAIL
"""
from __future__ import annotations

import argparse
import pathlib
import re
import sys

DEFAULT_MEMORY_DIR = pathlib.Path(
    r"C:\Users\Patrick\.claude\projects\C--Users-Patrick\memory"
)
BASELINE = pathlib.Path(__file__).with_name("memory_pointer_baseline.txt")

WIKILINK = re.compile(r"\[\[([a-z0-9_]+)\]\]")
BACKTICKED = re.compile(r"`([a-z_][a-z0-9_]{6,})`")


def normalise(name: str, existing: set[str]) -> str | None:
    """Resolve a pointer to the memory file it names, or None if it names none.

    Handles the index's shorthand: `_always_push` is feedback_always_push.
    """
    if name in existing:
        return name
    for cand in ("feedback" + name, "feedback_" + name.lstrip("_")):
        if cand in existing:
            return cand
    return None


def pointers(text: str, existing: set[str]) -> set[str]:
    raw = set(WIKILINK.findall(text)) | set(BACKTICKED.findall(text))
    return {n for n in (normalise(r, existing) for r in raw) if n}


def load_baseline() -> set[str]:
    if not BASELINE.exists():
        return set()
    return {
        ln.strip()
        for ln in BASELINE.read_text(encoding="utf-8").splitlines()
        if ln.strip() and not ln.startswith("#")
    }


def write_baseline(names: set[str]) -> None:
    header = (
        "# Pointers the auto-memory index (MEMORY.md) is known to carry.\n"
        "# tools/verify_memory_pointers.py FAILS if any of these leaves the index.\n"
        "# Removing a line here is a DELIBERATE retirement — say why in the commit.\n"
        "# Regenerate with: python tools/verify_memory_pointers.py --update-baseline\n"
    )
    BASELINE.write_text(header + "\n".join(sorted(names)) + "\n", encoding="utf-8")


def run(memory_dir: pathlib.Path, quiet: bool = False) -> tuple[int, set[str]]:
    index_path = memory_dir / "MEMORY.md"
    if not index_path.exists():
        print(f"FAIL: no index at {index_path}")
        return 1, set()

    live = index_path.read_text(encoding="utf-8")
    existing = {p.stem for p in memory_dir.glob("*.md")}
    live_p = pointers(live, existing)

    base = load_baseline()
    lost = sorted(base - live_p)
    added = sorted(live_p - base)
    dangling = sorted({n for n in WIKILINK.findall(live) if normalise(n, existing) is None})

    ok = not lost and not dangling

    if not quiet:
        print(f"index    : {index_path}")
        print(f"size     : {len(live.encode('utf-8'))} bytes")
        print(f"pointers : {len(live_p)} live, {len(base)} in baseline")
        print()
        print(f"LOST (in baseline, gone from the index): {len(lost)}")
        for n in lost:
            print(f"   ! {n}")
        print(f"DANGLING (in the index, no such memory file): {len(dangling)}")
        for n in dangling:
            print(f"   ? {n}")
        if added:
            print(f"NEW since baseline (fine — run --update-baseline to adopt): {len(added)}")
            for n in added:
                print(f"   + {n}")
        print()
        print("PASS" if ok else "FAIL — restore the missing pointers before committing")

    # Controls: this gate must never pass by reading nothing.
    if len(live_p) < 50:
        print(f"FAIL(control): only {len(live_p)} pointers parsed — the parser is not seeing the index")
        return 1, live_p
    if not base:
        print("FAIL(control): no baseline — this gate cannot detect a loss without one")
        return 1, live_p

    return (0 if ok else 1), live_p


def self_check(memory_dir: pathlib.Path) -> int:
    """Prove the gate can FAIL. A gate nobody has watched fail is not a gate."""
    import tempfile
    import shutil

    live = (memory_dir / "MEMORY.md").read_text(encoding="utf-8")
    existing = {p.stem for p in memory_dir.glob("*.md")}
    base = load_baseline()
    if not base:
        print("self-check: no baseline to mutate against")
        return 1

    victim = sorted(base)[0]
    with tempfile.TemporaryDirectory() as td:
        tmp = pathlib.Path(td)
        for p in memory_dir.glob("*.md"):
            shutil.copy2(p, tmp / p.name)
        # MUTATION: drop every mention of one pointer, exactly as a truncating
        # compaction would.
        mutated = re.sub(r"\[\[%s\]\]" % re.escape(victim), "", live)
        mutated = re.sub(r"`%s`" % re.escape(victim), "", mutated)
        short = "_" + victim[len("feedback"):].lstrip("_")
        mutated = re.sub(r"`%s`" % re.escape(short), "", mutated)
        (tmp / "MEMORY.md").write_text(mutated, encoding="utf-8")

        code, _ = run(tmp, quiet=True)
        print(f"self-check: dropped `{victim}` -> gate exit {code} "
              f"({'RED, as it must be' if code == 1 else 'GREEN — THE GATE IS BLIND'})")
        if code != 1:
            return 1

    # And the control: unmutated must be green.
    code, _ = run(memory_dir, quiet=True)
    print(f"self-check: unmutated -> gate exit {code} "
          f"({'GREEN, as it must be' if code == 0 else 'RED — the gate fails on a clean index'})")
    return 0 if code == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--memory-dir", default=str(DEFAULT_MEMORY_DIR))
    ap.add_argument("--update-baseline", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    d = pathlib.Path(args.memory_dir)

    if args.self_check:
        return self_check(d)

    if args.update_baseline:
        live = (d / "MEMORY.md").read_text(encoding="utf-8")
        existing = {p.stem for p in d.glob("*.md")}
        names = pointers(live, existing)
        before = load_baseline()
        write_baseline(names)
        print(f"baseline updated: {len(names)} pointers "
              f"(+{len(names - before)} / -{len(before - names)})")
        for n in sorted(before - names):
            print(f"   RETIRED: {n}")
        return 0

    code, _ = run(d, quiet=args.quiet)
    return code


if __name__ == "__main__":
    sys.exit(main())
