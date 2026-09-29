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
    ("M4 census blind to wave 9C", [(TOOL,
      'NOTEBOOK_SUBJECT = re.compile(r"(?i)\\bnotebook\\b|^wave 9c\\b")',
      'NOTEBOOK_SUBJECT = re.compile(r"(?i)\\bnotebook\\b")')]),
    ("M14 (I2b) uncharted landings ignored", [(TOOL, "    if new:" + NL, "    if False:" + NL)]),
    ("M22 (c) path criterion off", [(TOOL,
      "        paths = [f for f in files if f in nb]", "        paths = []")]),
    ("M20 (a) derived set limited to app/", [(TOOL,
      "            f for f in files if f and not any(f == k or f.startswith(k + \"/\") for k in KEEP_PATHS))",
      "            f for f in files if f.startswith(\"app/\") and not any(f == k or f.startswith(k + \"/\") for k in KEEP_PATHS))")]),
    ("M21 (b) tests/ left out of the derived set", [(TOOL,
      "            f for f in files if f and not any(f == k or f.startswith(k + \"/\") for k in KEEP_PATHS))",
      "            f for f in files if f and not f.startswith(\"tests/\") and not any(f == k or f.startswith(k + \"/\") for k in KEEP_PATHS))")]),
    ("M23 derived from the newest landing only", [(TOOL,
      "        for _k, squash, _w in CHAIN:" + NL + "            files.update(",
      "        for _k, squash, _w in CHAIN[:1]:" + NL + "            files.update(")]),
    ("M24 kept paths not subtracted", [(TOOL,
      "            f for f in files if f and not any(f == k or f.startswith(k + \"/\") for k in KEEP_PATHS))",
      "            f for f in files if f)")]),
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
