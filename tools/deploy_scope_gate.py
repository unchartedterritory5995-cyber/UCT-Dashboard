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

import pathlib
import re
import sys as _sys

# ⛔ THE GATE PRINTS ITS OWN VERDICT IN ⛔/⭐/· AND WINDOWS STDOUT IS cp1252.
# Reading a file with the locale codec was already a bug here (it turned an
# UNREADABLE guarded file into one that looked unchanged); this is the same
# defect pointed the other way, and it is worse: the gate assessed every region
# correctly and then died mid-sentence while SAYING SO. A verdict nobody can
# read is not a verdict, and a crash at the print is indistinguishable, to a
# caller reading an exit code, from a gate that refused the deploy.
for _s in (_sys.stdout, _sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # a pipe or a stream that cannot be reconfigured
        pass
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import gate_regions  # noqa: E402

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
# TIER 1.5 exits 3: a guarded file moved, but every PROTECTED REGION was left
# alone. Merge + full re-verify, same as tier 2, then continue.
GUARDED_SAFE = 3


def sh(*args: str) -> str:
    # ⛔⛔ EXPLICIT ENCODING. `text=True` alone decodes with the LOCALE codec —
    # cp1252 here — and every source file in this wave is full of ⛔/⭐, so the
    # read threw and the caller's except turned an unreadable file into "no
    # changes". Fail-closed caught it; a weaker eligibility rule would have
    # merged a guarded file unexamined (`lesson_a_swallowed_error_becomes_a_
    # confident_finding`).
    return subprocess.run(args, capture_output=True, text=True, check=True,
                          encoding="utf-8", errors="replace").stdout


class ReadFailed(Exception):
    """The tool could not read what it must judge. ⛔ Never the same thing as
    "there was nothing there"."""


def _side(fn, *args) -> str:
    """One side of a diff. A path absent in that revision is legitimately empty;
    ⛔ anything else RAISES, because a read this gate cannot perform must never
    be reported as an absence of change."""
    try:
        return fn(*args) or ""
    except subprocess.CalledProcessError as e:
        err = (e.stderr or "")
        if "exists on disk, but not in" in err or "does not exist" in err or "unknown revision" in err:
            return ""
        raise ReadFailed(err.strip()[:200] or "git failed") from e


def _is_guarded(f: str) -> bool:
    if any(f.endswith("/" + n) for n in SEVEN):
        return True
    return any(re.search(pat, f) for pat, _ in TIER1)


def classify(files: list[str], regions=None) -> tuple[int, list[tuple[str, str]]]:
    """Return (tier, reasons). Highest severity wins.

    `regions` maps a guarded path -> the assessment from `gate_regions.assess`.
    A guarded file whose assessment says `eligible` is demoted to TIER 1.5; one
    without an assessment, or whose assessment says otherwise, stays TIER 1.
    ⛔ Absent evidence is never treated as evidence of absence.
    """
    regions = regions or {}
    hits1, hits2, safe = [], [], []
    for f in files:
        guarded = []
        for pat, why in TIER1:
            if re.search(pat, f):
                guarded.append((f, why))
        for name in SEVEN:
            if f.endswith("/" + name):
                guarded.append((f, f"one of the seven guarded files ({name})"))
        if guarded:
            a = regions.get(f)
            if a and a.get("eligible"):
                safe.append((f, "guarded, but every protected region untouched"))
            else:
                hits1 += guarded
        for pat, why in TIER2:
            if re.search(pat, f):
                hits2.append((f, why))
    if hits1:
        return HARD_STOP, hits1
    if safe:
        return GUARDED_SAFE, safe + hits2
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

    # ── TIER 1.5: the regions decide, and they are found by signature ────────
    # Driven against the REAL NoteEditorPage.jsx so the locators are exercised
    # on the file they will actually meet, not on a fixture that agrees with
    # them by construction.
    import pathlib as _pl
    editor = "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx"
    text = (_pl.Path(__file__).resolve().parent.parent / editor).read_text(encoding="utf-8")
    regions, missing = gate_regions.locate(editor, text)
    ok = not missing
    print(f"  {'ok ' if ok else 'FAIL'}  every protected region is findable by signature"
          + ("" if ok else f" — MISSING {missing}"))
    bad += 0 if ok else 1

    def _synth(lo, hi):
        """A diff whose only hunk covers new-side lines lo..hi."""
        return f"@@ -{lo},{hi - lo + 1} +{lo},{hi - lo + 1} @@\n"

    inside = next((r for r in regions if r[0] == "scheduleAutosave"), None)
    fonts = [i + 1 for i, l in enumerate(text.splitlines()) if "FONT_OPTIONS" in l]
    cases15 = []
    if inside and fonts:
        a = gate_regions.assess(editor, _synth(inside[1], inside[1] + 1), text, text)
        cases15.append(("a hunk INSIDE scheduleAutosave -> TIER 1",
                        classify([editor], {editor: a})[0] == HARD_STOP))
        b = gate_regions.assess(editor, _synth(fonts[0], fonts[0]), text, text)
        cases15.append(("the same hunk on FONT_OPTIONS -> TIER 1.5",
                        classify([editor], {editor: b})[0] == GUARDED_SAFE))
        c = gate_regions.assess(editor, _synth(min(fonts[0], inside[1]), max(fonts[0], inside[2])), text, text)
        cases15.append(("a hunk intersecting BOTH -> TIER 1",
                        classify([editor], {editor: c})[0] == HARD_STOP))
        cases15.append(("a guarded file with NO assessment stays TIER 1",
                        classify([editor], {})[0] == HARD_STOP))
        cases15.append(("a MISSING region forces TIER 1 even with no intersection",
                        classify([editor], {editor: {**b, "missing": ["scheduleAutosave"],
                                                     "eligible": False}})[0] == HARD_STOP))
        drain = "app/src/pages/journal-2-0/lib/offline/outboxDrain.js"
        d = gate_regions.assess(drain, _synth(1, 2), "x\ny\n", "x\ny\n")
        cases15.append(("lib/offline/** is protected in FULL -> TIER 1",
                        classify([drain], {drain: d})[0] == HARD_STOP))
    else:
        cases15.append(("locators found scheduleAutosave and FONT_OPTIONS", False))

    for name, good in cases15:
        print(f"  {'ok ' if good else 'FAIL'}  {name}")
        bad += 0 if good else 1

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

    # ⛔ Region assessment runs for every guarded file BEFORE classifying, so
    # the decision and the evidence for it are produced together.
    regions = {}
    for f in files:
        if not _is_guarded(f):
            continue
        try:
            regions[f] = gate_regions.assess(
                f,
                _side(sh, "git", "diff", "--unified=0", f"{old}..{new}", "--", f),
                _side(sh, "git", "show", f"{old}:{f}"),
                _side(sh, "git", "show", f"{new}:{f}"),
            )
        except ReadFailed as e:
            regions[f] = {"path": f, "checked": [], "missing": [f"COULD NOT READ: {e}"],
                          "old_hunks": [], "new_hunks": [], "intersections": [],
                          "eligible": False}
    for f, a in regions.items():
        print(f"  regions checked in {f}:")
        for name in a["checked"]:
            print(f"     · {name}")
        if a["missing"]:
            print(f"     ⛔ NOT FOUND (forces TIER 1): {', '.join(a['missing'])}")
        print(f"     hunks old={a['old_hunks']} new={a['new_hunks']}")
        for name, side, rng, hunk in a["intersections"]:
            print(f"     ⛔ INTERSECTS {name} [{side} {rng[0]}-{rng[1]}] with hunk {hunk[0]}-{hunk[1]}")
        print(f"     -> {'eligible for TIER 1.5' if a['eligible'] else 'TIER 1'}")
    if regions:
        print()

    tier, hits = classify(files, regions)

    if tier == GUARDED_SAFE:
        print("⚠️  TIER 1.5 — a GUARDED file moved, but every PROTECTED REGION was untouched.")
        for f, why in dedup(hits):
            print(f"   · {f}")
            print(f"     -> {why}")
        print()
        print("   Merge, then the SAME full re-verify as tier 2:")
        print("   a) journal-2-0 at rest, alone   b) backend baseline rail")
        print("   c) full frontend suite          d) ledger re-verified vs the NEW master")
        print("   ⛔ AND every Wave Q1 rail by name green + every mutation reddening,")
        print("      on master AND post-merge. A guarded drift that dulls a mutation is")
        print("      TIER 1 no matter where its hunks sit.")
        return GUARDED_SAFE

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
