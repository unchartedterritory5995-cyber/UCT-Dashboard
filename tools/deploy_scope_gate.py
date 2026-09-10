"""Wave Q1 deploy scope gate — does master's new work touch anything we own?

⛔ THIS REPLACES A TIME FREEZE, AND IT IS ONLY AS GOOD AS ITS PATH LIST.
The freeze it replaces ("stop if master moved at all") was unsatisfiable: a
second session pushed to master EIGHT times in one day, every 15-45 minutes,
while a full Wave Q1 pre-flight takes 30-40 minutes. A pre-flight can never win
a race against a freeze. Every one of those eight commits touched ZERO files
under `app/`, so the freeze was stopping on movement rather than on risk.

⛔ The file list is derived MECHANICALLY from `git diff --name-only`, never from
commit subjects. A subject is a claim about a commit; the file list is the
commit.

Usage:
    python tools/deploy_scope_gate.py <old-sha> <new-sha>
    exit 0 = safe to merge · exit 1 = HARD STOP, wait for the owner
"""
from __future__ import annotations

import re
import subprocess
import sys

# Anything matching these is OURS. A hit is a hard stop, not a judgement call.
GUARDED = [
    (r"^app/", "app/** — the whole frontend the Wave Q1 fix lives in"),
    (r"journal-2-0", "the Notebook wave"),
    (r"lib/offline/", "the offline layer"),
    (r"outboxDrain|useOutboxDrain|outboxLeader", "the outbox / drain"),
    (r"notebookDb|durableWriter|useDurableNote|recoverLocalState", "the durable store"),
    (r"api/.*/notes\.py$|api/.*journal_two", "the notes backend"),
    (r"tiptap|TipTap|NoteEditorPage|widgetEmbed", "the TipTap wiring"),
    (r"offlineFlag", "the feature flag definition"),
]

# The seven files the deploy must not see move underneath it.
SEVEN = [
    "NoteEditorPage.jsx", "outboxDrain.js", "baseline.js", "useDurableNote.js",
    "recoverLocalState.js", "useOutboxDrain.js", "offlineFlag.js",
]


def sh(*args: str) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def main() -> int:
    old, new = sys.argv[1], sys.argv[2]
    files = [f for f in sh("git", "diff", "--name-only", f"{old}..{new}").splitlines() if f.strip()]

    print(f"=== {old[:9]}..{new[:9]} — {len(files)} file(s) ===")
    commits = sh("git", "log", "--format=%h | %an | %ad | %s", "--date=iso", f"{old}..{new}")
    print(commits.rstrip() or "  (no commits)")
    print()
    for f in files:
        print(f"  {f}")
    print()

    hits = []
    for f in files:
        for pat, why in GUARDED:
            if re.search(pat, f):
                hits.append((f, why))
        for name in SEVEN:
            if f.endswith("/" + name):
                hits.append((f, f"one of the seven guarded files ({name})"))

    if hits:
        print("⛔⛔ HARD STOP — master's new work touches something we own:")
        seen = set()
        for f, why in hits:
            if (f, why) in seen:
                continue
            seen.add((f, why))
            print(f"   ! {f}")
            print(f"     -> {why}")
        print()
        print("Do NOT merge. Do NOT deploy. Report and wait for the owner.")
        return 1

    print("✅ CLEAR — no guarded path touched. Safe to merge and continue.")
    # A control: a gate that matches nothing is indistinguishable from a gate
    # that is switched off.
    probe = "app/src/pages/journal-2-0/lib/offline/outboxDrain.js"
    if not any(re.search(p, probe) for p, _ in GUARDED):
        print("FAIL(control): the gate does not recognise its own guarded path")
        return 1
    print("   (control: the gate does recognise a guarded path when shown one)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
