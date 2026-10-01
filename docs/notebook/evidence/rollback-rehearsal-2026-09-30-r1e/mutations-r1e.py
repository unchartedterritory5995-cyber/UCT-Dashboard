"""Mutation harness, lane R1e, 2026-09-30. Lane-unique scratchpad filename per CLAUDE.md's
shared-scratchpad rule. Captures the COMMITTED baseline (HEAD, after this lane's own commits),
applies one mutation, runs the test that should catch it, restores by content hash verified
against `git cat-file blob HEAD:<path>`, and logs everything.
"""
import hashlib
import os
import subprocess
import sys

REPO = r"C:\Users\Patrick\uct-worktrees\notebook-w10-r1e"
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
    # declared encoding rejects (measured here -- byte 0x97, an em dash in cp1252, arriving on
    # a pipe declared utf-8), which otherwise crashes the reader thread and leaves r.stdout/
    # r.stderr None. PYTHONIOENCODING pins the CHILD's own stdio encoding so this is belt and
    # braces, not a guess.
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


def m1_drop_l12(text):
    """Drop L12 from CHAIN entirely. MEASURED_AT == L12's own sha, so this hits BOTH the
    "unruled" clause and the "newest landing is the measured tip" clause of the same test."""
    needle = '    ("L12", "599cd44f1", "wave 10 L12 #258"),\n'
    assert needle in text, "L12 CHAIN line not found"
    return text.replace(needle, "", 1)


def m2_drop_l10(text):
    """Drop L10 from CHAIN entirely. A CHAIN_BY_PATH_ONLY entry (never subject-selected), so
    only the "unruled" clause of test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_
    reviewed can see it -- same shape R1d found for L8 in round 2."""
    needle = '    ("L10", "8eb7f008b", "wave 10 L10 #257"),\n'
    assert needle in text, "L10 CHAIN line not found"
    return text.replace(needle, "", 1)


def m3_drop_l9(text):
    """Drop L9 from CHAIN entirely. Also CHAIN_BY_PATH_ONLY (ships no app/api file at all, the
    same reason as L6/L8), caught the same way as L10."""
    needle = '    ("L9", "89390fb85", "wave 10 L9 #256"),\n'
    assert needle in text, "L9 CHAIN line not found"
    return text.replace(needle, "", 1)


def m4_remove_reviewed_df82f7a1e(text):
    """Remove the df82f7a1e (wave-3 Pine-engine revert, the controller-handed-down ruling)
    REVIEWED_NOT_LANDINGS entry entirely."""
    needle = (
        '    "df82f7a1e97d6a00a25a5a7f5ca0ff638618ac4c":\n'
        '        "Revert of another workstream\'s wave-3 Pine-engine integrate merge a3afa840d (a 2-parent "\n'
        '        "merge commit, never itself selected by the census); its widgetEmbed.test.jsx/"\n'
        '        "widgetEmbedCore.js hunk removes a lazy-load-the-Pine-engine optimisation for "\n'
        '        "stampChartSettings, reverting to synchronous settings resolution -- a Pine-engine byte-"\n'
        '        "budget change to a Notebook-owned file, not a Notebook feature or fix",\n'
    )
    assert needle in text, "df82f7a1e REVIEWED_NOT_LANDINGS entry not found"
    return text.replace(needle, "", 1)


def m5_shrink_reason_below_6_words(text):
    """Shrink the 326d070c0 REVIEWED_NOT_LANDINGS reason to under 6 words -- caught by
    test_a_reviewed_commit_is_real_selected_by_path_only_and_never_a_landing's word-count
    assertion, a DIFFERENT clause than the "unruled" one the other four mutations hit."""
    needle = (
        '    "326d070c0d21b1bb575d121c9a342bcf6318f2fd":\n'
        '        "feat(econ): 10 economic-data source adapters, member API and serving, isolated from stock "\n'
        '        "bars; touches only api/main.py among shared files (router mounts + lifespan wiring), no "\n'
        '        "Notebook route touched",\n'
    )
    replacement = (
        '    "326d070c0d21b1bb575d121c9a342bcf6318f2fd":\n'
        '        "econ adapters",\n'
    )
    assert needle in text, "326d070c0 REVIEWED_NOT_LANDINGS entry not found"
    return text.replace(needle, replacement, 1)


results = {}
results["drop_L12_from_CHAIN"] = mutate_and_check(
    "drop_L12_from_CHAIN", m1_drop_l12,
    "tests/test_notebook_rollback_chain.py::test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed")
results["drop_L10_from_CHAIN"] = mutate_and_check(
    "drop_L10_from_CHAIN", m2_drop_l10,
    "tests/test_notebook_rollback_chain.py::test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed")
results["drop_L9_from_CHAIN"] = mutate_and_check(
    "drop_L9_from_CHAIN", m3_drop_l9,
    "tests/test_notebook_rollback_chain.py::test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed")
results["remove_df82f7a1e_reviewed_ruling"] = mutate_and_check(
    "remove_df82f7a1e_reviewed_ruling", m4_remove_reviewed_df82f7a1e,
    "tests/test_notebook_rollback_chain.py::test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed")
results["shrink_326d070c0_reason_below_6_words"] = mutate_and_check(
    "shrink_326d070c0_reason_below_6_words", m5_shrink_reason_below_6_words,
    "tests/test_notebook_rollback_chain.py::test_a_reviewed_commit_is_real_selected_by_path_only_and_never_a_landing")

print("\n".join(LOG))
print("SUMMARY:", results)
all_killed = all(results.values())
print("ALL KILLED:", all_killed)
sys.exit(0 if all_killed else 1)
