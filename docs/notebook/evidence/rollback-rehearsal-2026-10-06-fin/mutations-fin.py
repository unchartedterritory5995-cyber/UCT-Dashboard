"""Mutation harness, lane ROLLBACK, 2026-10-06 (the wave 12-15 finish program).

For each mutation: check the file equals the COMMITTED blob, apply one change, run the one test
that should catch it, then put the captured bytes back and prove the restore against git
(`git diff --quiet HEAD -- <path>`), never against this script's own capture alone.

Only the rollback tool and one test file are mutated. No file under `api/` or `app/src` is
touched: the "old code" cases for the never-revert rail are measured on the rehearsal trees
instead (landing/ beside this file).

Two runs are recorded. `mutations-fin-run1-one-survivor.log` (at f626d0e5e0) killed ten of
eleven: the mutation that puts the bare skip back in tests/test_notebook_sample_size.py SURVIVED,
because a skip raised inside a test skips the test and sails through `pytest.raises`. The test
was fixed to turn that skip into a failure, and `mutations-fin.log` is the run after the fix.

Run from the repository root, with a clean tree:
    python docs/notebook/evidence/rollback-rehearsal-2026-10-06-fin/mutations-fin.py
"""
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
TOOL = "tools/notebook_rollback_chain.py"
SAMPLE = "tests/test_notebook_sample_size.py"
CHAIN_T = "tests/test_notebook_rollback_chain.py"
KEEP_T = "tests/test_notebook_rollback_never_revert.py"
LOG: list[str] = []


def git(*a):
    return subprocess.run(["git", "-C", str(REPO), *a], capture_output=True)


def clean(path: str) -> bool:
    return git("diff", "--quiet", "HEAD", "--", path).returncode == 0


def run_test(nodeid: str):
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    for name in ("CI", "GITHUB_ACTIONS", "UCT_REQUIRE_NODE"):
        env.pop(name, None)
    r = subprocess.run([sys.executable, "-m", "pytest", nodeid, "-q", "-p", "no:cacheprovider", "-W", "ignore"],
                       cwd=str(REPO), capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
    tail = [ln for ln in (r.stdout or "").splitlines() if ln.strip()][-6:]
    return r.returncode, "\n".join(tail)


def mutate_and_check(name: str, path: str, old: str, new: str, nodeid: str) -> bool:
    assert clean(path), f"{name}: {path} differs from HEAD before mutating"
    target = REPO / path
    original = target.read_bytes()
    crlf = original.count(b"\r\n") > 0
    text = original.decode("utf-8").replace("\r\n", "\n")
    assert text.count(old) == 1, f"{name}: needle found {text.count(old)} times in {path}"
    mutated = text.replace(old, new)
    target.write_bytes((mutated.replace("\n", "\r\n") if crlf else mutated).encode("utf-8"))
    try:
        assert not clean(path), f"{name}: the mutation changed nothing git can see"
        rc, tail = run_test(nodeid)
    finally:
        target.write_bytes(original)
    restored = clean(path) and target.read_bytes() == original
    verdict = "RED (killed)" if rc == 1 else ("GREEN (SURVIVED -- BAD)" if rc == 0 else f"rc {rc} (NOT A TEST RESULT)")
    LOG.append(f"=== {name} ===\nfile: {path}\nnode: {nodeid}\npytest rc: {rc} -> {verdict}\n"
               f"--- last lines ---\n{tail}\nrestore proved by `git diff --quiet HEAD -- {path}`: "
               f"{'OK' if restored else 'MISMATCH'}\n")
    assert restored, f"{name}: restore did not match HEAD"
    return rc == 1


M = [
    ("drop_W11_from_CHAIN", TOOL,
     '    ("W11", "f473d00b3", "wave 10 L16 + wave 11 #263"),\n', "",
     f"{CHAIN_T}::test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed"),
    ("remove_the_dd7bf82c3_reviewed_ruling", TOOL,
     '    "dd7bf82c3f1c179340689525046626a9a7fa532b":\n'
     '        "feat(research) COV-04: filing-to-filing blackline, dark; mounts a router in api/main.py "\n'
     '        "and adds a flag reader + payload key in api/routers/auth.py (shared files), no Notebook "\n'
     '        "route touched",\n', "",
     f"{CHAIN_T}::test_every_commit_since_the_previous_measurement_is_in_CHAIN_or_reviewed"),
    ("apply_step_ignores_the_per_landing_keep", TOOL,
     "    keep_at_tip = KEEP_AT_TIP + tuple(k for k in keep if k not in KEEP_AT_TIP)\n",
     "    keep_at_tip = KEEP_AT_TIP\n",
     f"{CHAIN_T}::test_landing_mode_reverts_a_pending_landing_and_keeps_the_keep_list"),
    ("the_chain_step_never_passes_its_landing_keep", TOOL,
     "pick=pick, pins=pins, keep=KEEP_WITH_LANDING.get(key, ()))", "pick=pick, pins=pins)",
     f"{CHAIN_T}::test_the_landing_keep_list_applies_at_its_own_chain_step_and_at_no_other"),
    ("the_purge_list_leaves_the_landing_keep_list", TOOL,
     '    LANDING_12_15: ("api/services/journal_two/account_purge.py",\n'
     '                    "tests/test_journal_two_account_purge.py",',
     '    LANDING_12_15: ("tests/test_journal_two_account_purge.py",',
     f"{KEEP_T}::test_the_tool_keeps_both_schema_files_their_two_rails_and_the_purge_list"),
    ("a_schema_table_leaves_KEEP_AT_TIP", TOOL,
     'SCHEMA_FILES = ("app/src/pages/journal-2-0/lib/notebookSchema.js",\n'
     '                "api/services/journal_two/notebook_schema.py")',
     'SCHEMA_FILES = ("app/src/pages/journal-2-0/lib/notebookSchema.js",)',
     f"{KEEP_T}::test_the_tool_keeps_both_schema_files_their_two_rails_and_the_purge_list"),
    ("landing_mode_resolves_by_a_recorded_rule", TOOL,
     "    saved = RULES.pop(squash, None)             # landing mode never resolves by rule\n",
     "    saved = None\n",
     f"{CHAIN_T}::test_landing_mode_stops_on_a_product_conflict_and_never_uses_a_recorded_rule"),
    ("the_pending_squash_sits_on_the_moved_base", TOOL,
     '    base = _out("merge-base", onto, landing_tip).strip()\n',
     '    base = _out("rev-parse", onto).strip()\n',
     f"{CHAIN_T}::test_landing_mode_says_when_the_landing_has_not_merged_the_base"),
    ("landing_mode_accepts_a_merge_commit", TOOL,
     "        if len(_parents(squash)) != 1:\n", "        if False:\n",
     f"{CHAIN_T}::test_landing_mode_refuses_what_is_not_a_landing_there"),
    ("landing_mode_stops_naming_later_commits", TOOL,
     "                later.append({", "                ({",
     f"{CHAIN_T}::test_landing_mode_names_a_later_commit_that_merged_clean_on_the_landings_files"),
    ("a_missing_node_goes_back_to_a_bare_skip", SAMPLE,
     "    if _must_have_node():\n", "    if False:\n",
     f"{SAMPLE}::test_a_missing_node_FAILS_the_parity_rail_where_node_is_required"),
]

# The control first: the same tests on the unmutated tree. A kill means nothing if they were red anyway.
results = {}
env_nodes = sorted({m[4] for m in M})
r = subprocess.run([sys.executable, "-m", "pytest", *env_nodes, "-q", "-p", "no:cacheprovider", "-W", "ignore"],
                   cwd=str(REPO), capture_output=True, text=True, encoding="utf-8", errors="replace",
                   env={k: v for k, v in os.environ.items() if k not in ("CI", "GITHUB_ACTIONS", "UCT_REQUIRE_NODE")})
tail = "\n".join([ln for ln in (r.stdout or "").splitlines() if ln.strip()][-3:])
LOG.append(f"=== CONTROL: all {len(env_nodes)} target tests on the unmutated tree ===\npytest rc: {r.returncode} -> "
           f"{'GREEN (as it must be)' if r.returncode == 0 else 'NOT GREEN -- the kills below prove nothing'}\n"
           f"--- last lines ---\n{tail}\n")
ok_control = r.returncode == 0
for name, path, old, new, nodeid in M:
    results[name] = mutate_and_check(name, path, old, new, nodeid)

print("\n".join(LOG))
print("HEAD:", git("rev-parse", "HEAD").stdout.decode().strip())
print("SUMMARY:", results)
print("CONTROL GREEN:", ok_control)
all_killed = ok_control and all(results.values())
print("ALL KILLED:", all_killed)
sys.exit(0 if all_killed else 1)
