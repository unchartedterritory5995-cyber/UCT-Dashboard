"""TIER 1½ — PROTECTED REGIONS, located mechanically.

A guarded file moving under a deploy is normally a hard stop. But a guarded file
is not uniformly dangerous: `NoteEditorPage.jsx` holds the autosave gate, the
save path and every `setContent` call, and it also holds a toolbar font list.
A change to the second is not a change to the first, and stopping the wave for
one is a freeze wearing a gate's clothes.

⛔⛔ THE DISTINCTION IS DRAWN BY THE TOOL, NEVER BY READING A COMMIT MESSAGE.
A subject is a claim about a commit; the hunks ARE the commit. Every region below
is found by its CURRENT SIGNATURE in the file — never by line number, which drifts
the moment anyone edits above it (this repo has been bitten by line-numbered
references three times).

⛔ REGIONS ARE FAIL-CLOSED. A region whose signature cannot be found is reported
as MISSING and forces TIER 1: a protected region that has been renamed or removed
is exactly when you least want the tool to say "no intersection, carry on".
"""
from __future__ import annotations

import re

WHOLE_FILE = "*"

# ── what is protected, and how to find it ────────────────────────────────────
#   ("name", kind, pattern)
#     block : the anchor line plus its brace-balanced body
#     line  : every matching line, on its own
#     all   : the entire file
PROTECTED: dict[str, list[tuple]] = {
    "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx": [
        ("hydratedRef declaration", "line", r"\bhydratedRef\b"),
        ("scheduleAutosave", "block", r"const\s+scheduleAutosave\s*="),
        ("commitSave / the save path", "block", r"const\s+(commitSave|doSave|saveNow)\s*="),
        ("markSynced call sites", "line", r"\bmarkSynced\s*\("),
        ("settleLandedSave call sites", "line", r"\bsettleLandedSave\s*\("),
        ("restoreDraft", "block", r"const\s+(restoreDraft|applyDraft|acceptRecovery)\s*="),
        ("the reconcile / conflict handler", "line", r"\b(recovery|setRecovery|conflict|sync-conflict)\b"),
        ("every setContent call", "line", r"\.setContent\s*\("),
        ("EMIT_NOTHING", "line", r"\bEMIT_NOTHING\b"),
        ("useEditor construction / keying", "block", r"const\s+editor\s*=\s*useEditor\("),
        ("the durable / outbox hooks", "line", r"\b(useDurableNote|useOutboxDrain|useBlockedNotes)\s*\("),
    ],
    "app/src/pages/journal-2-0/lib/offline/outboxDrain.js": [("the whole drain", "all", WHOLE_FILE)],
    "app/src/pages/journal-2-0/lib/offline/useOutboxDrain.js": [("the whole drain hook", "all", WHOLE_FILE)],
    "app/src/pages/journal-2-0/lib/offline/offlineFlag.js": [("the flag definition", "all", WHOLE_FILE)],
    "api/routers/journal_two.py": [
        ("the telemetry allow-list", "block", r"_J2_TELEMETRY_EVENTS\s*=\s*\{"),
        ("the notes save / CAS path", "line", r"baseUpdatedAt|base_updated_at|def update_note|409"),
    ],
}

# Everything under lib/offline/** is protected in full, whether or not it is
# named above — a new module added there tomorrow is protected the day it lands.
PROTECTED_PREFIXES = ["app/src/pages/journal-2-0/lib/offline/"]


def _block_end(lines: list[str], start: int) -> int:
    """From the anchor line, extend over its brace-balanced body."""
    depth, seen = 0, False
    for i in range(start, len(lines)):
        for ch in lines[i]:
            if ch == "{":
                depth += 1
                seen = True
            elif ch == "}":
                depth -= 1
        if seen and depth <= 0:
            return i + 1
        if not seen and lines[i].rstrip().endswith(";"):
            return i + 1
    return len(lines)


def locate(path: str, text: str) -> tuple[list[tuple], list[str]]:
    """→ ([(name, start, end)], [missing region names]). 1-indexed, inclusive."""
    specs = PROTECTED.get(path)
    if specs is None and any(path.startswith(p) for p in PROTECTED_PREFIXES):
        specs = [("the offline layer (whole file)", "all", WHOLE_FILE)]
    if not specs:
        return [], []
    lines = text.splitlines()
    found, missing = [], []
    for name, kind, pattern in specs:
        if kind == "all":
            found.append((name, 1, max(len(lines), 1)))
            continue
        rx = re.compile(pattern)
        hits = [i for i, l in enumerate(lines) if rx.search(l)]
        if not hits:
            missing.append(name)
            continue
        for i in hits:
            if kind == "block":
                found.append((name, i + 1, _block_end(lines, i)))
            else:
                found.append((name, i + 1, i + 1))
    return found, missing


HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


def hunk_ranges(diff_text: str) -> tuple[list[tuple], list[tuple]]:
    """→ (old-side ranges, new-side ranges), 1-indexed inclusive."""
    old, new = [], []
    for line in diff_text.splitlines():
        m = HUNK.match(line)
        if not m:
            continue
        os_, ol, ns, nl = int(m.group(1)), int(m.group(2) or 1), int(m.group(3)), int(m.group(4) or 1)
        if ol:
            old.append((os_, os_ + ol - 1))
        if nl:
            new.append((ns, ns + nl - 1))
    return old, new


def overlaps(a: tuple, b: tuple) -> bool:
    return a[0] <= b[1] and b[0] <= a[1]


def assess(path: str, diff_text, old_text, new_text) -> dict:
    """Does this guarded file's diff stay outside every protected region?

    ⛔ BOTH SIDES ARE CHECKED. A hunk that DELETES a protected region shows up
    only on the old side; one that adds into it, only on the new. Checking one
    side would let a deletion through.
    """
    # A file that is new on one side has no text there; a missing capture is an
    # empty string, never None, so a read failure can never look like "no hunks".
    diff_text, old_text, new_text = diff_text or "", old_text or "", new_text or ""
    old_ranges, new_ranges = hunk_ranges(diff_text)
    old_regions, missing_old = locate(path, old_text)
    new_regions, missing_new = locate(path, new_text)

    intersect = []
    for regions, ranges, side in ((old_regions, old_ranges, "old"), (new_regions, new_ranges, "new")):
        for name, rs, re_ in regions:
            for hs, he in ranges:
                if overlaps((rs, re_), (hs, he)):
                    intersect.append((name, side, (rs, re_), (hs, he)))

    # ⛔ MISSING MEANS "THIS DRIFT REMOVED OR RENAMED A PROTECTED REGION", which
    # is a hard stop — not "the region does not exist on either side of it". A
    # region the BRANCH introduced (settleLandedSave, say) has never existed on
    # master, and demanding it there would make every future drift a TIER 1 for a
    # reason that has nothing to do with the drift.
    #
    # ⛔ The other half of this check lives in the gate's self-check, which
    # locates every region in the WORKING TREE file: a locator that matches
    # nothing anywhere is caught there. Two checks, two different failures.
    missing = sorted(set(missing_old) ^ set(missing_new))
    return {
        "path": path,
        "checked": sorted({n for n, _, _ in new_regions} | {n for n, _, _ in old_regions}),
        "missing": missing,
        "old_hunks": old_ranges,
        "new_hunks": new_ranges,
        "intersections": intersect,
        # ⛔ Fail closed on a region we could not find.
        "eligible": not intersect and not missing,
    }
