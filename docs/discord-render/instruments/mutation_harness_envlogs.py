"""Mutation proofs for tools/railway_env_logs.py — the two properties that failed once for real:
the paging form (beforeDate returned zero rows) and the known-positive control gate.
Same contract as the other harnesses: one exact replacement, sha-verified restore, control run."""
import hashlib
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()

# ⛔ B4/B5 — ONE shared guard, imported, never copy-pasted (a guard repeated is a guard
# unproved). It refuses to run unless this tree is a sacrificed mutation sandbox, then
# refuses to start an 18-minute run on an anchor that no longer matches its source.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from harness_guard import guard  # noqa: E402

guard(ROOT, __file__)
T = "tests/test_railway_env_logs.py::"
MUTATIONS = [
    {"name": "E1 paging reverts to beforeDate (the form that returned zero rows)",
     "file": "tools/railway_env_logs.py",
     "old": "environmentLogs(environmentId:$env, filter:$f, anchorDate:$anchor, beforeLimit:$limit, afterLimit:0){",
     "new": "environmentLogs(environmentId:$env, filter:$f, beforeDate:$anchor, beforeLimit:$limit){",
     "tests": [T + "test_the_query_uses_the_measured_anchor_form_not_beforeDate",
               T + "test_pages_back_to_since_and_returns_every_line_once_oldest_first"]},
    {"name": "E2 a control that finds nothing no longer stops the run",
     "file": "tools/railway_env_logs.py",
     "old": "        if n == 0:\n",
     "new": "        if False:\n",
     "tests": [T + "test_a_control_that_finds_nothing_is_INCONCLUSIVE_and_writes_nothing"]},
    {"name": "E4 the no-progress guard is removed",
     "file": "tools/railway_env_logs.py",
     "old": "        if oldest == last_oldest and fresh == 0:\n",
     "new": "        if False:\n",
     "tests": [T + "test_a_page_that_cannot_advance_stops_and_says_so_instead_of_looping"]},
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def run(nodes):
    p = subprocess.run([sys.executable, "-m", "pytest", *nodes, "-q", "-p", "no:cacheprovider", "--timeout=60"],
                       cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = p.stdout + p.stderr
    f = re.search(r"(\d+) failed", out); ps = re.search(r"(\d+) passed", out); e = re.search(r"(\d+) error", out)
    return p.returncode, (int(f.group(1)) if f else 0) + (int(e.group(1)) if e else 0), int(ps.group(1)) if ps else 0, bool(f or ps or e)


ok, lines = True, []
for m in MUTATIONS:
    path = ROOT / m["file"]
    orig = path.read_bytes()
    text = orig.decode("utf-8")
    old, new = m["old"], m["new"]
    if "\r\n" in text:
        old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
    if text.count(old) != 1:
        lines.append(f"{m['name']}\n    INCONCLUSIVE: target matched {text.count(old)}x")
        ok = False
        continue
    try:
        path.write_bytes(text.replace(old, new).encode("utf-8"))
        rc, failed, passed, totals = run(m["tests"])
    finally:
        path.write_bytes(orig)
    restored = sha(path.read_bytes()) == sha(orig)
    red = totals and failed >= 1
    ok = ok and red and restored
    lines.append(f"{m['name']}\n    {'RED (rail fired)' if red else ('NO TOTALS LINE' if not totals else 'GREEN UNDER MUTATION')} "
                 f"failed={failed} passed={passed} rc={rc} restored={restored}")
nodes = sorted({t for m in MUTATIONS for t in m["tests"]})
rc, failed, passed, totals = run(nodes)
control = totals and failed == 0 and passed >= len(nodes) and rc == 0
ok = ok and control
print("\n".join(lines))
print(f"CONTROL ({len(nodes)} node ids): passed={passed} failed={failed} rc={rc} -> {'GREEN' if control else 'NOT GREEN'}")
sys.exit(0 if ok else 1)
