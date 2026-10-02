"""Mutation harness, lane R1h, 2026-10-01. Lane-unique scratchpad filename per CLAUDE.md's
shared-scratchpad rule. Captures the COMMITTED baseline (HEAD, after this lane's own commits),
applies one mutation, runs the test that should catch it, restores by content hash verified
against `git cat-file blob HEAD:<path>`, and logs everything.
"""
import hashlib
import os
import subprocess
import sys

REPO = r"C:\Users\Patrick\uct-worktrees\notebook-w10-r1h"
TOOL = "tools/notebook_rollback_chain.py"
LOG = []


def git(*a, **kw):
    return subprocess.run(["git", "-C", REPO, *a], capture_output=True, text=True, encoding="utf-8", **kw)


def head_blob():
    r = git("cat-file", "blob", f"HEAD:{TOOL}")
    assert r.returncode == 0, r.stderr
    return r.stdout


def write_tool(text):
    # R-2: write with the line endings GIT ALREADY STORES for this path -- pure LF (the blob has
    # zero CR bytes; see check below). newline="\n" means NO translation on write.
    with open(f"{REPO}\\{TOOL}", "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def read_tool():
    # Universal-newline text mode: translates any \r\n on disk (autocrlf checkout artifact) back
    # to \n for comparison against the (pure-LF) blob content. This is a COMPARISON read, not an
    # R-2 round-trip write -- the working-tree CRLF-on-checkout convention is not being preserved
    # or copied anywhere; only content equality is being asked.
    with open(f"{REPO}\\{TOOL}", "r", encoding="utf-8") as fh:
        return fh.read()


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def run_test(nodeid):
    # errors="replace": a pytest subprocess piped (not a real console) can emit a byte the
    # declared encoding rejects, which otherwise crashes the reader thread and leaves
    # r.stdout/r.stderr None (measured by lane R1e). PYTHONIOENCODING pins the CHILD's own
    # stdio encoding so this is belt and braces, not a guess.
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    r = subprocess.run([sys.executable, "-m", "pytest", nodeid, "-q", "-p", "no:cacheprovider"],
                       cwd=REPO, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", env=env)
    return r.returncode, (r.stdout or "")[-4000:] + (r.stderr or "")[-2000:]


def mutate_and_check(name, mutate_fn, nodeid):
    baseline = head_blob()
    baseline_sha = sha(baseline)
    on_disk = read_tool()
    assert sha(on_disk) == baseline_sha, f"{name}: working tree does not match HEAD before mutating"
    mutated = mutate_fn(baseline)
    assert mutated != baseline, f"{name}: mutation produced no change"
    write_tool(mutated)
    rc, out = run_test(nodeid)
    verdict = "RED (killed)" if rc != 0 else "GREEN (SURVIVED -- BAD)"
    LOG.append(f"=== {name} ===\nnode: {nodeid}\npytest rc: {rc} -> {verdict}\n---tail---\n{out}\n")
    # restore: write the committed bytes back, verify by content hash against git's own blob
    write_tool(baseline)
    restored = read_tool()
    ok = sha(restored) == baseline_sha == sha(head_blob())
    LOG.append(f"restore verified against git cat-file blob HEAD:{TOOL}: {'OK' if ok else 'MISMATCH'}\n")
    assert ok, f"{name}: restore did not match HEAD blob"
    return rc != 0


def m1_drop_l15(text):
    """Drop L15 from CHAIN entirely. MEASURED_AT == L15's own sha, so this hits BOTH the
    "unruled" clause and the "newest landing is the measured tip" clause of the same test."""
    needle = '    ("L15", "b529c8a78", "wave 10 L15 #262"),\n'
    assert needle in text, "L15 CHAIN line not found"
    return text.replace(needle, "", 1)


def m2_remove_reviewed_charts_commit(text):
    """Remove the 726586201 (feat(charts): Technical library Tier 1) REVIEWED_NOT_LANDINGS entry
    entirely."""
    needle = (
        '    "7265862018f7a2fee21771fce86e5dea580e87c7":\n'
        '        "feat(charts): Technical library Tier 1 -- 33 studies, 9 MA types, real fixed scales; "\n'
        '        "touches app/src/pages/Settings.jsx only to widen the Moving Average overlay\'s type "\n'
        '        "<select> from a hardcoded SMA/EMA pair to the full MA_TYPES kit for an ADOPTED "\n'
        '        "(engine-instance) overlay slot (shared file); every other shipped file "\n'
        '        "(movingAverages.js, technicalStudies.js, technicalCategories.js, indicatorCatalog.js, "\n'
        '        "the chart engine\'s readout/sourceRef/registrySizes modules) is outside the derived "\n'
        '        "Notebook set, no Notebook route touched",\n'
    )
    assert needle in text, "726586201 REVIEWED_NOT_LANDINGS entry not found"
    return text.replace(needle, "", 1)


results = {}
results["drop_L15_from_CHAIN"] = mutate_and_check(
    "drop_L15_from_CHAIN", m1_drop_l15,
    "tests/test_notebook_rollback_chain.py::test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed")
results["remove_726586201_reviewed_ruling"] = mutate_and_check(
    "remove_726586201_reviewed_ruling", m2_remove_reviewed_charts_commit,
    "tests/test_notebook_rollback_chain.py::test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed")

print("\n".join(LOG))
print("SUMMARY:", results)
all_killed = all(results.values())
print("ALL KILLED:", all_killed)
sys.exit(0 if all_killed else 1)
