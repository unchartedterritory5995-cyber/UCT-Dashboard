"""Mutation proofs for the B4 refusal guard and the B5 anchor checker.

Same contract as every other harness here: one mutation at a time, ONE exact replacement
that must match exactly once, EOL-aware, byte-restore verified by sha256, control run at
the end. ⛔ Never `git checkout` to restore — it would also revert uncommitted work in the
same file (`feedback_mutation_check_never_git_checkout`, two incidents behind it).

⛔ IT IS ITSELF GUARDED. This file edits real source files in place, which is exactly the
class B4 exists to contain, so it refuses to run outside a sacrificed worktree like any
other harness. Proving a guard by exempting yourself from it is not a proof.

    python docs/discord-render/instruments/prove_b45_rails.py .

⭐ Note which way each proof points. Most remove a guard and assert the rail goes RED.
Three point elsewhere and each covers a different way this set could pass for the wrong
reason (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`):

  P14  makes the code mask STRICTER (`any` -> `all`), so an anchor that legitimately
       contains a comment reads stale. It proves the anti-FALSE-POSITIVE control bites —
       a checker that cried wolf would be muted inside a week.
  P16  keeps the defect COUNT and drops the names, proving "report names, never a count".
  P18  removes the guard's ability to say YES. A guard that could only ever refuse would
       pass every other proof here while being useless, so this is the control on the
       whole set.
"""
from __future__ import annotations

import hashlib
import re
import subprocess
import sys
from pathlib import Path

_ARGS = [a for a in sys.argv[1:] if not a.startswith("-")]
ROOT = Path(_ARGS[0]).resolve() if _ARGS else Path(__file__).resolve().parents[3]

sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness_guard import require_throwaway_worktree  # noqa: E402

require_throwaway_worktree(ROOT, __file__)

SUITE = ["tests/test_mutation_harness_hygiene.py"]

GUARD = "docs/discord-render/instruments/harness_guard.py"
CHECK = "docs/discord-render/instruments/anchor_check.py"
HARNESS = "docs/discord-render/instruments/mutation_harness.py"
IGNORE = ".gitignore"

PROOFS = [
    # ── B4: the refusal guard ───────────────────────────────────────────────
    {"name": "P01 a harness stops calling the shared guard", "file": HARNESS,
     "old": "guard(ROOT, __file__)", "new": "pass  # guard removed",
     "expect": "test_every_mutation_harness_imports_the_shared_guard"},

    {"name": "P02 the marker's token is no longer required", "file": GUARD,
     "old": "    if not marker_has_token:\n",
     "new": "    if False:\n",
     "expect": "test_the_guard_decides_each_tree_shape_correctly"},

    {"name": "P03 the marker file itself is no longer required", "file": GUARD,
     "old": "    if not marker_exists:\n",
     "new": "    if False:\n",
     "expect": "test_the_guard_decides_each_tree_shape_correctly"},

    {"name": "P04 the MAIN CHECKOUT denial is removed", "file": GUARD,
     "old": '    if git_kind == "dir":\n',
     "new": "    if False:\n",
     "expect": "test_the_guard_decides_each_tree_shape_correctly"},

    {"name": "P05 a near-miss override value is honoured", "file": GUARD,
     "old": '    if env.get(OVERRIDE_ENV, "").strip() == OVERRIDE_VALUE:\n',
     "new": '    if env.get(OVERRIDE_ENV, "").strip():\n',
     "expect": "test_the_override_is_deliberate_and_a_near_miss_is_refused"},

    {"name": "P06 the refusal exit code collides with a test result", "file": GUARD,
     "old": "EXIT_REFUSED_TREE = 86\n", "new": "EXIT_REFUSED_TREE = 1\n",
     "expect": "test_the_refusal_is_loud_exits_with_a_distinct_code"},

    {"name": "P07 the refusal stops naming the tree it saw", "file": GUARD,
     "old": '        f"  mutation root : {verdict.root}",\n',
     "new": '        "  mutation root : (withheld)",\n',
     "expect": "test_the_refusal_is_loud_exits_with_a_distinct_code"},

    {"name": "P08 the marker is no longer gitignored", "file": IGNORE,
     "old": "\n.mutation-sandbox", "new": "\n#.mutation-sandbox",
     "expect": "test_the_marker_is_gitignored_so_it_can_never_arrive_by_checkout"},

    {"name": "P09 the guard is copy-pasted instead of imported", "file": CHECK,
     "old": "HARNESS_GLOB = \"mutation_harness*.py\"\n",
     "new": "HARNESS_GLOB = \"mutation_harness*.py\"\n\n\ndef inspect_tree(root, env=None):\n"
            "    return None\n",
     "expect": "test_the_guard_has_exactly_one_definition"},

    # ── B5: the anchor checker ──────────────────────────────────────────────
    {"name": "P10 comment/docstring masking is ignored (the six-instruments defect)",
     "file": CHECK,
     "old": "    code_hits = sum(1 for s in starts if any(mask[s:s + len(needle)]))\n",
     "new": "    code_hits = raw_probe = len(starts)\n",
     "expect": "test_the_three_outcomes_are_distinct_and_never_collapsed"},

    {"name": "P11 AMBIGUOUS is collapsed into STALE", "file": CHECK,
     "old": "    if raw > 1:\n        return AMBIGUOUS, raw, code_hits, (\n",
     "new": "    if raw > 1:\n        return STALE, raw, code_hits, (\n",
     "expect": "test_the_three_outcomes_are_distinct_and_never_collapsed"},

    {"name": "P12 the non-vacuity control is removed", "file": CHECK,
     "old": "    if total == 0:\n        p(\"\")\n",
     "new": "    if False:\n        p(\"\")\n",
     "expect": "test_zero_controls_is_a_failed_invocation_not_a_quiet_pass"},

    {"name": "P13 an UNREADABLE control is quietly scored OK", "file": CHECK,
     "old": "                rep.findings.append(Finding(ctl, UNREADABLE, detail=ctl.note or\n",
     "new": "                rep.findings.append(Finding(ctl, OK, detail=ctl.note or\n",
     "expect": "test_an_unresolvable_anchor_is_UNREADABLE_and_never_OK"},

    {"name": "P14 ⭐ an anchor CONTAINING a comment is wrongly called stale", "file": CHECK,
     "old": "any(mask[s:s + len(needle)])", "new": "all(mask[s:s + len(needle)])",
     "expect": "test_the_three_outcomes_are_distinct_and_never_collapsed"},

    {"name": "P15 stale preludes stop being enumerated", "file": CHECK,
     "old": "            if isinstance(pre, ast.Tuple) and pre.elts:\n",
     "new": "            if False:\n",
     "expect": "test_a_stale_prelude_is_reported_as_its_own_control"},

    {"name": "P16 ⭐ the report counts defects but stops naming them", "file": CHECK,
     "old": "        for f in sorted(defects, key=lambda x: (x.outcome, x.control.harness, x.control.name)):\n            p(f.line())\n",
     "new": "        p(f\"({len(defects)} defects)\")\n",
     "expect": "test_the_checker_enumerates_every_real_harness_and_reports_names"},

    {"name": "P17 the B5 preflight no longer stops the run", "file": GUARD,
     "old": "    _write(stream, \"\\n\".join(lines))\n    exit_fn(EXIT_REFUSED_STALE_ANCHORS)\n"
            "    return EXIT_REFUSED_STALE_ANCHORS\n",
     "new": "    _write(stream, \"\\n\".join(lines))\n    return 0\n",
     "expect": "test_a_marked_sandbox_passes_B4_and_is_then_stopped_by_B5"},

    {"name": "P18 ⭐ the guard loses its ability to say YES (the control on every red above)",
     "file": GUARD,
     "old": "    return v(True, f\"{MARKER_NAME} declares this tree throwaway, and it is a linked worktree\")\n",
     "new": "    return v(False, \"refusing everything\")\n",
     "expect": "test_a_marked_sandbox_with_current_anchors_is_allowed_through"},
]


def say(text: str = "", **kw) -> None:
    """⚠️ Windows consoles are cp1252 and these proof names are not ASCII.

    ⚰️ The first run of this file DIED at `print("… ⭐ …")` with a UnicodeEncodeError, at
    P14 of 18. It cost nothing only because the byte-restore is in a `finally` that runs
    BEFORE the reporting — `git status` was clean and the hygiene gate green afterwards.
    Had the restore been in the reporting path instead, a harness proving the anti-left-
    behind-mutation guard would have left a mutation behind.
    """
    kw.setdefault("flush", True)
    try:
        print(text, **kw)
    except UnicodeEncodeError:
        print(text.encode("ascii", "replace").decode("ascii"), **kw)


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def run() -> tuple[int, int, int, bool, str]:
    p = subprocess.run([sys.executable, "-m", "pytest", *SUITE, "-q", "-p", "no:cacheprovider"],
                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=900)
    out = p.stdout + p.stderr
    f = re.search(r"(\d+) failed", out)
    ps = re.search(r"(\d+) passed", out)
    e = re.search(r"(\d+) error", out)
    # ⛔ A RUN WITHOUT A TOTALS LINE IS NOT A RUN, whatever the exit code says.
    totals = bool(f or ps or e)
    failed = (int(f.group(1)) if f else 0) + (int(e.group(1)) if e else 0)
    return p.returncode, failed, int(ps.group(1)) if ps else 0, totals, out


def main() -> int:
    results, ok_all = [], True

    # `--only P08,P15` re-proves a fixed rail without paying for all 18 again. ⚠️ A filtered
    # run is NOT a full proof and says so in its own TOTALS line — never quote it as one.
    only = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--only=")), "")
    chosen = [m for m in PROOFS
              if not only or any(m["name"].startswith(p.strip()) for p in only.split(","))]
    if only and not chosen:
        say(f"⛔ --only={only!r} selected ZERO proofs. That is a failed invocation, not a "
            f"clean run.")
        return 2

    say(f"Proving {len(chosen)} of {len(PROOFS)} mutations against {' '.join(SUITE)}"
        f"{f'  [--only={only}]' if only else ''}\n")
    for m in chosen:
        path = ROOT / m["file"]
        original = path.read_bytes()
        text = original.decode("utf-8")
        eol = "\r\n" if "\r\n" in text else "\n"
        old, new = m["old"].replace("\n", eol), m["new"].replace("\n", eol)
        n = text.count(old)
        if n != 1:
            results.append((m["name"], f"NOT APPLIED ({n} matches) — re-aim this anchor", ""))
            ok_all = False
            say(f"  {m['name']:<72} NOT APPLIED ({n})", flush=True)
            continue
        try:
            path.write_bytes(text.replace(old, new, 1).encode("utf-8"))
            rc, failed, passed, totals, out = run()
        finally:
            path.write_bytes(original)
        restored = sha(path.read_bytes()) == sha(original)

        named = m["expect"] in out
        verdict = ("NO TOTALS LINE (not a run)" if not totals else
                   "GREEN UNDER MUTATION (the rail cannot fail)" if failed == 0 else
                   "RED (rail fired)" if named else
                   f"RED, but the NAMED rail did not fire ({m['expect']})")
        ok = verdict == "RED (rail fired)" and restored
        ok_all = ok_all and ok
        results.append((m["name"], f"{verdict} failed={failed} passed={passed} "
                                   f"restored={restored}", ""))
        say(f"  {m['name']:<72} {verdict} (failed={failed}, restored={restored})",
              flush=True)

    rc, failed, passed, totals, _ = run()
    control = totals and failed == 0 and rc == 0
    ok_all = ok_all and control

    say()
    say(f"CONTROL (restored tree): passed={passed} failed={failed} rc={rc} -> "
          f"{'GREEN' if control else 'NOT GREEN'}")
    reds = sum(1 for _, v, _ in results if v.startswith("RED (rail fired)"))
    partial = "  ** PARTIAL RUN - not a full proof **" if len(chosen) != len(PROOFS) else ""
    say(f"TOTALS: proofs_run={len(chosen)} of {len(PROOFS)} red={reds} "
          f"not_red={len(chosen) - reds} control={'green' if control else 'NOT GREEN'}"
          f"{partial}")
    return 0 if ok_all else 1


if __name__ == "__main__":
    sys.exit(main())
