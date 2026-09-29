"""R1 fix round 1: mutation proofs for tests/test_notebook_rollback_chain.py. Each: capture bytes
of every file it may touch, apply ONE textual mutation set (each anchor must match exactly once),
run the rail, restore bytes, verify the restore against the COMMITTED blob when the file is
unchanged vs HEAD, else against the capture."""
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w10s1")
TOOL = ROOT / "tools" / "notebook_rollback_chain.py"
TEST = ROOT / "tests" / "test_notebook_rollback_chain.py"
DOC = ROOT / "docs" / "notebook" / "wave5-rollback.md"
NL = "\n"
ROW8 = "| `wave8` | `caf6d1b9e` | wave 8 #198 | |" + NL
ROW9C = "| `9C` | `2e0598bfa` | wave 9C #197, the soak instrument | |" + NL

MUTATIONS = [
    ("M1 drop #201 from CHAIN", [(TOOL,
      '    ("201", "7e3f9e117", "#201 H14: the pane heading never moves the toolbar"),' + NL, "")]),
    ("M2 tools/ no longer kept", [(TOOL,
      'KEEP_PATHS = ("docs", "CLAUDE.md", "tools", "scripts")', 'KEEP_PATHS = ("docs", "CLAUDE.md", "scripts")')]),
    ("M3 tables and rails not restored", [(TOOL,
      "        for p in KEEP_AT_TIP:" + NL + "            put_from(tip, p)" + NL, "")]),
    ("M11 rails not kept (round-1 behaviour)", [(TOOL,
      "KEEP_AT_TIP = SCHEMA_FILES + SCHEMA_RAILS", "KEEP_AT_TIP = SCHEMA_FILES")]),
    ("M4 census blind to wave 9C", [(TOOL,
      'NOTEBOOK_SUBJECT = re.compile(r"(?i)\\bnotebook\\b|^wave 9c\\b")',
      'NOTEBOOK_SUBJECT = re.compile(r"(?i)\\bnotebook\\b")')]),
    ("M5 wave8 and 9C swapped in CHAIN", [(TOOL,
      '    ("wave8", "caf6d1b9e", "wave 8 #198"),' + NL + '    ("9C", "2e0598bfa", "wave 9C #197: the soak instrument"),' + NL,
      '    ("9C", "2e0598bfa", "wave 9C #197: the soak instrument"),' + NL + '    ("wave8", "caf6d1b9e", "wave 8 #198"),' + NL)]),
    ("M6 stale procedure: measured at #225, L1c left out", [
      (TOOL, 'MEASURED_AT = "38bb9a421"', 'MEASURED_AT = "4bba30b73"'),
      (TOOL, '    ("L1c", "38bb9a421", "wave 10 L1c #228"),' + NL, "")]),
    ("M7 wave-8 main.py ours_drop keeps one wave-8 router line", [(TOOL,
      '"notebook_export_router.router", "notebook_onboarding_router.router"]]),',
      '"notebook_export_router.router"]]),')]),
    ("M8 doc chain table rows swapped", [(DOC, ROW8 + ROW9C, ROW9C + ROW8)]),
    ("M9 doc drops the kept mark on #203", [(DOC,
      "| `203` | `c6a8a9d3a` | #203 H14: depth cap, Word intake, PDF extraction budget | **kept** |",
      "| `203` | `c6a8a9d3a` | #203 H14: depth cap, Word intake, PDF extraction budget | |")]),
    ("M10 tool keeps #204 only", [(TOOL, 'KEPT = {"2ab637644", "c6a8a9d3a"}', 'KEPT = {"2ab637644"}')]),
    # ── fix round 1 ──
    ("M12 (I1) pins not enforced", [(TOOL,
      "            elif PINS.get(squash, {}).get(p) != fp:", "            elif False:")]),
    ("M13 (I2a) ancestry refusal disabled", [(TOOL,
      '    if _git("merge-base", "--is-ancestor", measured, start_sha, ok=(0, 1)).returncode != 0:',
      '    if False:')]),
    ("M14 (I2b) uncharted landings ignored", [(TOOL, "    if new:" + NL, "    if False:" + NL)]),
    ("M15 (M6) path criterion removed", [(TOOL,
      "        paths = [f for f in files if NOTEBOOK_PATHS.match(f)]", "        paths = []")]),
    ("M16 (M4) kept-key refusal removed", [(TOOL,
      "    if through in kept and not revert_hotfixes:", "    if False:")]),
    ("M17 (I3) doc recommends picking 82c56dd63 in step 2", [(DOC,
      "#   ^ must print NOTHING (the tables and their two rails stay at the tip)",
      "#   ^ must print NOTHING (the tables and their two rails stay at the tip)" + NL
      + "git cherry-pick 82c56dd63     # then re-apply the third guard commit too")]),
    ("M18 (I3) doc loses the NEVER sentence", [(DOC,
      "NEVER hand-pick `82c56dd63` below wave 5", "Take care with `82c56dd63` below wave 5")]),
    ("M19 (I3) doc keep-list says re-apply it", [(DOC,
      "3. **`82c56dd63` rides along above wave 5, and is NOT re-applied below it.**",
      "3. **`82c56dd63` rides along above wave 5, and is re-applied below it.**")]),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


results = []
for name, edits in MUTATIONS:
    saved = {p: p.read_bytes() for p in (TOOL, TEST, DOC)}
    try:
        for path, old, new in edits:
            s = path.read_bytes().decode("utf-8")
            assert s.count(old) == 1, f"{name}: anchor found {s.count(old)} times in {path.name}"
            path.write_bytes(s.replace(old, new).encode("utf-8"))
        r = subprocess.run([sys.executable, "-m", "pytest", str(TEST), "-q", "-p", "no:cacheprovider",
                            "-W", "ignore::DeprecationWarning"], cwd=str(ROOT), capture_output=True, text=True)
        fails = [l.split(" - ")[0].split("::")[-1] for l in r.stdout.splitlines() if l.startswith("FAILED")]
        total = [l for l in r.stdout.splitlines() if " passed" in l or " failed" in l][-1:]
        line = f"{name}: rc {r.returncode} | {total[0] if total else '(no totals line)'} | red: {fails}"
        print(line, flush=True)
        results.append(r.returncode)
    finally:
        for p, b in saved.items():
            p.write_bytes(b)
            assert sha(p.read_bytes()) == sha(b), f"restore of {p} FAILED"
print("restored:", {p.name: sha(p.read_bytes())[:12] for p in (TOOL, TEST, DOC)})
print("all red:", all(rc != 0 for rc in results), f"({sum(rc != 0 for rc in results)}/{len(results)})")
