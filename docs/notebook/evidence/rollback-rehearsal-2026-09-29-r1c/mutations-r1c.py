"""Mutation harness, lane R1c, 2026-09-29. Lane-unique scratchpad filename per CLAUDE.md's
shared-scratchpad rule. Captures the COMMITTED baseline (HEAD, after this lane's own commits),
applies one mutation, runs the test that should catch it, restores by content hash verified
against `git cat-file blob HEAD:<path>`, and logs everything.
"""
import hashlib
import subprocess
import sys

REPO = r"C:\Users\Patrick\uct-worktrees\notebook-w10-r1c"
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
    # to \n for comparison against the (pure-LF) blob content. This is a COMPARISON read, not a
    # R-2 round-trip write -- the working-tree CRLF-on-checkout convention is not being preserved
    # or copied anywhere; only content equality is being asked.
    with open(f"{REPO}\\{TOOL}", "r", encoding="utf-8") as fh:
        return fh.read()


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def run_test(nodeid):
    r = subprocess.run([sys.executable, "-m", "pytest", nodeid, "-q", "-p", "no:cacheprovider"],
                       cwd=REPO, capture_output=True, text=True, encoding="utf-8")
    return r.returncode, r.stdout[-4000:] + r.stderr[-2000:]


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


def m1_drop_l5(text):
    """Drop L5 from CHAIN entirely."""
    needle = '    ("L5", "0812b5ec3", "wave 10 L5 #252"),\n'
    assert needle in text, "L5 CHAIN line not found"
    return text.replace(needle, "", 1)


def m2_tamper_pin(text):
    """Tamper with the new Support.jsx pin's value."""
    needle = '"app/src/pages/Support.jsx": "7e83b493575ccb6f",'
    assert needle in text, "Support.jsx pin not found"
    return text.replace(needle, '"app/src/pages/Support.jsx": "0000000000000000",', 1)


def m3_remove_reviewed(text):
    """Remove the TERM-039 (e90fddc34) REVIEWED_NOT_LANDINGS entry entirely."""
    needle = (
        '    "e90fddc34bae507c5487837085c41613fa8cf1d4":\n'
        '        "Terminal TERM-039: member-facing feature status; touches api/routers/auth.py (an "\n'
        '        "unrelated _breadth_dc_flags refactor) and adds a FeatureStatusStrip import+render to "\n'
        '        "app/src/pages/Support.jsx (shared files), no Notebook code path changed",\n'
    )
    assert needle in text, "e90fddc34 REVIEWED_NOT_LANDINGS entry not found"
    return text.replace(needle, "", 1)


results = {}
results["drop_L5_from_CHAIN"] = mutate_and_check(
    "drop_L5_from_CHAIN", m1_drop_l5,
    "tests/test_notebook_rollback_chain.py::test_the_chain_names_every_notebook_landing_up_to_MEASURED_AT")
results["tamper_new_pin"] = mutate_and_check(
    "tamper_new_pin", m2_tamper_pin,
    "tests/test_notebook_rollback_chain.py::test_rebuilding_from_MEASURED_AT_reproduces_the_rehearsed_trees")
results["remove_reviewed_ruling"] = mutate_and_check(
    "remove_reviewed_ruling", m3_remove_reviewed,
    "tests/test_notebook_rollback_chain.py::test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed")

print("\n".join(LOG))
print("SUMMARY:", results)
all_killed = all(results.values())
print("ALL KILLED:", all_killed)
sys.exit(0 if all_killed else 1)
