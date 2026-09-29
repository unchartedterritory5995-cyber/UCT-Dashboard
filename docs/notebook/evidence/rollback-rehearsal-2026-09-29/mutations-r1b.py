"""Mutation proof for lane R1b's pieces of tools/notebook_rollback_chain.py (2026-09-29).

Each mutation edits the tool's text, runs tests/test_notebook_rollback_chain.py, and must turn it
RED. The file is restored from the bytes captured before the run, and the restore is proved
against the COMMITTED blob (`git cat-file blob HEAD:<path>`, compared with line endings removed),
never against the capture alone -- a capture taken while another process had the file mutated
would restore the mutation and still match itself (CLAUDE.md, the shared-scratchpad race).

    python docs/notebook/evidence/rollback-rehearsal-2026-09-29/mutations-r1b.py > <log>
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
TOOL = ROOT / "tools" / "notebook_rollback_chain.py"
REL = "tools/notebook_rollback_chain.py"
TEST = "tests/test_notebook_rollback_chain.py"

MUTATIONS = [
    ("drop L2 from CHAIN",
     '    ("L2", "f4cec49be", "wave 10 L2 #242"),\n', ""),
    ("tamper the new L1a writing-help pin",
     '"api/routers/notebook_writing_help.py": "ecb06e27a7c24dea"',
     '"api/routers/notebook_writing_help.py": "ecb06e27a7c24deb"'),
    ("tamper the new wave-7 daily_counters pin",
     '"api/services/daily_counters.py": "258b54f4a653f1c3"',
     '"api/services/daily_counters.py": "258b54f4a653f1c4"'),
    ("tamper the new wave-5 paywall-test pin",
     '"tests/test_paywall_gate_free_tier.py": "3033a4865ff1c3ba"',
     '"tests/test_paywall_gate_free_tier.py": "3033a4865ff1c3bb"'),
    ("fingerprint fix reverted (ours pinned by its absent hunks)",
     'if rule in ("delete", "ours"):', 'if rule == "delete":'),
    ("L1a rule theirs -> ours (keep the autofill route)",
     '"4f708a0d2": {"api/routers/notebook_writing_help.py": ("hunks", ["theirs"])}',
     '"4f708a0d2": {"api/routers/notebook_writing_help.py": ("hunks", ["ours"])}'),
    ("wave-7 daily_counters ours -> delete",
     '"api/services/daily_counters.py": "ours",', '"api/services/daily_counters.py": "delete",'),
    ("one reviewed ruling removed (TERM-089)",
     '    "c26c8f8634152af58e289b769069cfbb730debdc":\n', '    "c26c8f8634152af58e289b769069cfbb730debdX":\n'),
    ("the landing itself filed as reviewed",
     'REVIEWED_NOT_LANDINGS: dict[str, str] = {\n',
     'REVIEWED_NOT_LANDINGS: dict[str, str] = {\n'
     '    "f4cec49be44d2a050b8b4a91c65fd7c7314f0cf0": "a landing wrongly filed as a neighbour here",\n'),
]


def committed_text() -> bytes:
    r = subprocess.run(["git", "-C", str(ROOT), "cat-file", "blob", f"HEAD:{REL}"], capture_output=True, check=True)
    return r.stdout.replace(b"\r\n", b"\n")


def main() -> int:
    original = TOOL.read_bytes()
    assert original.replace(b"\r\n", b"\n") == committed_text(), "the tool differs from HEAD before any mutation"
    sha = hashlib.sha256(original).hexdigest()
    nl = "\r\n" if b"\r\n" in original else "\n"
    text = original.decode("utf-8").replace("\r\n", "\n")
    killed = 0
    try:
        # control: the unmutated file is GREEN, or no red below means anything
        r = subprocess.run([sys.executable, "-m", "pytest", TEST, "-q", "-p", "no:cacheprovider",
                            "-W", "ignore::DeprecationWarning"], cwd=ROOT, capture_output=True, text=True)
        print(f"CONTROL rc={r.returncode} :: {r.stdout.strip().splitlines()[-1]}", flush=True)
        assert r.returncode == 0, "control is not green"
        for name, old, new in MUTATIONS:
            assert text.count(old) == 1, f"{name}: the anchor occurs {text.count(old)} times"
            TOOL.write_bytes(text.replace(old, new).replace("\n", nl).encode("utf-8"))
            r = subprocess.run([sys.executable, "-m", "pytest", TEST, "-q", "-p", "no:cacheprovider",
                                "-W", "ignore::DeprecationWarning"], cwd=ROOT, capture_output=True, text=True)
            TOOL.write_bytes(original)
            assert hashlib.sha256(TOOL.read_bytes()).hexdigest() == sha
            failed = [l.split("::", 1)[1].split(" ")[0] for l in r.stdout.splitlines() if l.startswith("FAILED")]
            verdict = "KILLED" if r.returncode != 0 else "SURVIVED"
            killed += r.returncode != 0
            print(f"{verdict} rc={r.returncode} :: {name} :: {r.stdout.strip().splitlines()[-1]}", flush=True)
            for f in failed:
                print(f"    red: {f}", flush=True)
    finally:
        TOOL.write_bytes(original)
    restored = TOOL.read_bytes()
    assert hashlib.sha256(restored).hexdigest() == sha
    assert restored.replace(b"\r\n", b"\n") == committed_text(), "restore does not match the committed blob"
    print(f"RESTORED: sha256 {sha[:16]} and equal to HEAD:{REL} (line endings aside)")
    print(f"TOTAL: {killed}/{len(MUTATIONS)} killed")
    return 0 if killed == len(MUTATIONS) else 1


if __name__ == "__main__":
    sys.exit(main())
