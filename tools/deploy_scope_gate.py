"""Wave Q1 deploy scope gate — THREE TIERS, decided by file paths alone.

⛔ THIS REPLACES A TIME FREEZE, AND IT IS ONLY AS GOOD AS ITS PATH LISTS.
The freeze it replaced ("stop if master moved at all") was unsatisfiable: other
sessions pushed to master EIGHT times in one day, every 15-45 minutes, while a
full Wave Q1 pre-flight takes 30-40 minutes. A pre-flight can never win a race
against a freeze — and every one of those eight commits touched ZERO files under
`app/`, so the freeze was stopping on MOVEMENT rather than on RISK.

⛔ Paths come from `git diff --name-only`, NEVER from commit subjects. A subject
is a claim about a commit; the file list IS the commit.

THE THREE TIERS
---------------
TIER 1 — HARD STOP. Wait for the owner.
    The Wave Q1 surface itself. If master changed this, the branch's fix is no
    longer being deployed onto the code it was verified against.

TIER 2 — MERGE + FULL RE-VERIFY, then continue the loop.
    Anything else under `app/**`. It cannot touch the Notebook sync path, but
    the frontend suite READS it, so the inherited-red ledger's "identical by
    construction" argument stops holding and has to be re-established:
      a) journal-2-0 at rest, alone   b) backend baseline rail
      c) full frontend suite          d) ledger re-verified against the new master
    ⛔ In that order. Never full-suite-then-journal-2-0 — that ordering
    manufactures a population of timeouts that say nothing about the code.

TIER 3 — FAST LOOP, then continue.
    Everything else (backend, docs, tooling). Merge · flag check · backend rail
    if `api/**` moved · journal-2-0 at rest · refresh the packet.

Usage:
    python tools/deploy_scope_gate.py <old-sha> <new-sha>
    exit 0 = tier 3 (fast) · 2 = tier 2 (full re-verify) · 1 = tier 1 (HARD STOP)
    python tools/deploy_scope_gate.py --self-check    # prove each tier can fire
"""
from __future__ import annotations

import re
import subprocess
import sys

# ── TIER 1: the Wave Q1 surface. A hit here is a hard stop. ──────────────────
TIER1 = [
    (r"(^|/)lib/offline/", "the offline layer (lib/offline/**)"),
    (r"api/.*/notes\.py$", "the notes backend (api/**/notes.py)"),
    (r"journal-2-0", "anything under journal-2-0"),
    (r"outboxDrain|useOutboxDrain|outboxLeader", "the outbox / drain"),
    (r"notebookDb|durableWriter|useDurableNote|recoverLocalState", "the durable store"),
    (r"offlineFlag", "the feature-flag definition"),
    (r"tiptap|TipTap|NoteEditorPage|widgetEmbed", "the TipTap wiring"),
    (r"(^|/)(service-?worker|sw)\.[jt]s$|serviceWorker", "the service worker"),
]
# The seven files the deploy must not see move underneath it.
SEVEN = [
    "NoteEditorPage.jsx", "outboxDrain.js", "baseline.js", "useDurableNote.js",
    "recoverLocalState.js", "useOutboxDrain.js", "offlineFlag.js",
]

# ── TIER 2: the rest of the frontend. The test suite reads it. ───────────────
TIER2 = [(r"^app/", "app/** — the frontend suite reads it, so the ledger must be re-verified")]

HARD_STOP, FULL_REVERIFY, FAST = 1, 2, 0


def sh(*args: str) -> str:
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def classify(files: list[str]) -> tuple[int, list[tuple[str, str]]]:
    """Return (tier, reasons). Highest severity wins."""
    hits1, hits2 = [], []
    for f in files:
        for pat, why in TIER1:
            if re.search(pat, f):
                hits1.append((f, why))
        for name in SEVEN:
            if f.endswith("/" + name):
                hits1.append((f, f"one of the seven guarded files ({name})"))
        for pat, why in TIER2:
            if re.search(pat, f):
                hits2.append((f, why))
    if hits1:
        return HARD_STOP, hits1
    if hits2:
        return FULL_REVERIFY, hits2
    return FAST, []


def dedup(pairs):
    seen, out = set(), []
    for p in pairs:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def self_check() -> int:
    """⭐ Prove each tier can fire. A gate nobody has watched fire is not a gate."""
    cases = [
        (["app/src/pages/journal-2-0/lib/offline/outboxDrain.js"], HARD_STOP, "tier 1: the drain"),
        (["app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx"], HARD_STOP, "tier 1: a guarded file"),
        (["app/public/sw.js"], HARD_STOP, "tier 1: the service worker"),
        (["api/services/journal_two/notes.py"], HARD_STOP, "tier 1: the notes backend"),
        (["app/src/components/chart/watermarkPrimitive.js"], FULL_REVERIFY, "tier 2: other frontend"),
        (["api/main.py", "tests/test_x.py"], FAST, "tier 3: backend only"),
        (["docs/notebook/whatever.md"], FAST, "tier 3: docs only"),
        # A mixed set must take the HIGHEST severity, not the first match.
        (["docs/a.md", "api/main.py", "app/src/pages/journal-2-0/x.js"], HARD_STOP, "mixed -> tier 1 wins"),
        (["docs/a.md", "app/src/components/chart/x.js"], FULL_REVERIFY, "mixed -> tier 2 wins"),
    ]
    bad = 0
    for files, want, label in cases:
        got, _ = classify(files)
        ok = got == want
        print(f"  {'ok ' if ok else 'FAIL'}  {label}: got tier {got}, want {want}")
        bad += 0 if ok else 1
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 0 if not bad else 1


def main() -> int:
    if "--self-check" in sys.argv:
        return self_check()

    old, new = sys.argv[1], sys.argv[2]
    files = [f for f in sh("git", "diff", "--name-only", f"{old}..{new}").splitlines() if f.strip()]

    print(f"=== {old[:9]}..{new[:9]} — {len(files)} file(s) ===")
    print((sh("git", "log", "--format=%h | %an | %ad | %s", "--date=iso", f"{old}..{new}").rstrip()
           or "  (no commits)"))
    print()
    for f in files:
        print(f"  {f}")
    print()

    tier, hits = classify(files)

    if tier == HARD_STOP:
        print("⛔⛔ TIER 1 — HARD STOP. Master changed the Wave Q1 surface itself.")
        for f, why in dedup(hits):
            print(f"   ! {f}\n     -> {why}")
        print("\nDo NOT merge. Do NOT deploy. Report and wait for the owner.")
        return HARD_STOP

    if tier == FULL_REVERIFY:
        print("⚠️  TIER 2 — MERGE, THEN FULL RE-VERIFY before continuing the loop.")
        for f, why in dedup(hits):
            print(f"   · {f}\n     -> {why}")
        print("\n   a) journal-2-0 at rest, alone   b) backend baseline rail")
        print("   c) full frontend suite          d) ledger re-verified vs the NEW master")
        print("   ⛔ in that order — never full-suite-then-journal-2-0")
        return FULL_REVERIFY

    print("✅ TIER 3 — FAST LOOP. Nothing under app/, nothing we own.")
    print("   merge · flag check · backend rail if api/** moved · journal-2-0 at rest · refresh packet")
    return FAST


if __name__ == "__main__":
    sys.exit(main())
