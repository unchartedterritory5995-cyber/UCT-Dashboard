"""Mutation harness for the I-A fix. For each mutation: assert the file equals
HEAD's blob (CRLF->LF), apply ONE textual replacement (must match exactly once),
run the named rails, restore the captured bytes, verify sha256 AND equality with
`git cat-file blob HEAD:<path>`. Never git checkout / git stash.
Usage: python mutate_ru.py <outdir> [mutation-id ...]
"""
import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

WT = Path(r"C:\Users\Patrick\uct-worktrees\notebook-restore-undo")
APP = WT / "app"
NEP = "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx"
RLS = "app/src/pages/journal-2-0/lib/offline/recoverLocalState.js"
UDN = "app/src/pages/journal-2-0/lib/offline/useDurableNote.js"
NDB = "app/src/pages/journal-2-0/lib/offline/notebookDb.js"
DRN = "app/src/pages/journal-2-0/lib/offline/outboxDrain.js"
UOD = "app/src/pages/journal-2-0/lib/offline/useOutboxDrain.js"
BLK = "app/src/pages/journal-2-0/lib/offline/blockedNotes.js"
RAILS = [
    "src/pages/journal-2-0/lib/offline/restoreUndoKeepsWords.test.jsx",
    "src/pages/journal-2-0/lib/offline/swapLineageRotation.test.jsx",
    "src/pages/journal-2-0/lib/offline/noteCopy.test.js",
    "src/pages/journal-2-0/lib/offline/f5p1OwnerSendsQueued.test.jsx",
]
ANSI = re.compile(r"\x1b\[[0-9;]*m")

MUTATIONS = {
    "R2-M1-fork-drops-subtitle": (UOD, [("    subtitle: entry.patch?.subtitle || undefined,\n", "")]),
    "R2-M2-no-base-restore-skips-outgoing": (NEP, [("    captureOutgoingPage()\n    viewReplaced()   // hotfix 2026-10-15: a Restore replaces", "    viewReplaced()   // hotfix 2026-10-15: a Restore replaces")]),
    "R2-M3-adoption-skips-outgoing": (NEP, [("    if (!auto) captureOutgoingPage()\n", "")]),
    "R2-M4-outgoing-captures-a-clean-page": (NEP, [("    if (!baseHasNoBody(lastSavedRef.current) && unsentInEditor().length === 0) return\n", "")]),
    "R2-M5-persist-retires-nothing": (UDN, [("{ copies, retire })", "{ copies, retire: [] })")]),
    "R2-M6-adapter-ignores-retire": (NDB, [("  for (const mutationId of retire) outbox.delete(mutationId)\n", "")]),
    "R2-M7-refused-copy-reposted": (DRN, [("      if (entry.copyRefused) {\n", "      if (false) {\n")]),
    "R2-M8-gone-source-strands-copy": (UOD, [("  } else if (!(res.status === 404 && isNoteCopy(entry))) {", "  } else {")]),
    "R2-M9-never-refused-for-good": (DRN, [("const copyRefusedForGood = (e) => Number.isFinite(e?.status) && e.status >= 400 && e.status < 500\n  && ![401, 408, 429].includes(e.status)\n", "const copyRefusedForGood = (e) => false\n")]),
    "R2-M10-always-refused-for-good": (DRN, [("const copyRefusedForGood = (e) => Number.isFinite(e?.status) && e.status >= 400 && e.status < 500\n  && ![401, 408, 429].includes(e.status)\n", "const copyRefusedForGood = (e) => true\n")]),
    "R2-M11-blocked-copy-not-on-source": (BLK, [("    if (isBlockedEntry(e) && isNoteCopy(e) && e.copyOf) ids.add(e.copyOf)\n    else if", "    if")]),
    "R2-M12-refused-copy-never-offered": (UDN, [("    if (!decision.unsynced && refusedCopy) {", "    if (false) {")]),
    "R2-M13-restore-forgets-retire": (NEP, [("captureSwapNow(recovery?.retiresCopy ? { retiresCopy: recovery.retiresCopy } : {})", "captureSwapNow({})")]),
    "R2-M14-retire-ungated": (UDN, [("(state?.retiresCopy && source === state)", "(state?.retiresCopy)")]),
    "R2-M15-bodyless-draft-not-captured": (NEP, [("    if (draftBodyJson) closeUndoStep(editorRef.current)\n    captureSwapNow(", "    if (draftBodyJson) closeUndoStep(editorRef.current)\n    if (draftBodyJson) captureSwapNow(")]),
    "R2-M16-crossing-plain-schedule": (NEP, [("    scheduleSwapCapture({\n      title: titleRef.current,", "    durableRef.current.schedule({\n      title: titleRef.current,")]),
}


def blob(path):
    return subprocess.run(["git", "-C", str(WT), "cat-file", "blob", f"HEAD:{path}"],
                          check=True, capture_output=True).stdout


def lf(b):
    return b.replace(b"\r\n", b"\n")


def run(out, mid):
    path, edits = MUTATIONS[mid]
    p = WT / path
    orig = p.read_bytes()
    assert lf(orig) == lf(blob(path)), f"{path} differs from HEAD before {mid}"
    crlf = b"\r\n" in orig
    s = lf(orig).decode("utf-8")
    for old, new in edits:
        assert s.count(old) == 1, f"{mid}: pattern matched {s.count(old)} times"
        s = s.replace(old, new)
    data = s.encode("utf-8")
    if crlf:
        data = data.replace(b"\n", b"\r\n")
    try:
        p.write_bytes(data)
        log = out / f"{mid}.log"
        with open(log, "wb") as fh:
            subprocess.run([shutil.which("npx"), "vitest", "run", *RAILS, "--maxWorkers=2"],
                           cwd=str(APP), stdout=fh, stderr=subprocess.STDOUT)
    finally:
        p.write_bytes(orig)
        now = p.read_bytes()
        assert hashlib.sha256(now).hexdigest() == hashlib.sha256(orig).hexdigest()
        assert lf(now) == lf(blob(path)), f"{path} restore != HEAD blob"
    text = ANSI.sub("", log.read_text(encoding="utf-8", errors="replace"))
    totals = " | ".join(l.strip() for l in text.splitlines() if re.match(r"\s*(Test Files|Tests)\s", l))
    red = sorted({l.strip()[:150] for l in text.splitlines() if re.match(r"\s*×\s", l)})
    print(f"{mid}: {totals or 'NO TOTALS LINE'}  [restored OK]")
    for r in red:
        print("    ", r)


def main():
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    ids = sys.argv[2:] or list(MUTATIONS)
    for mid in ids:
        run(out, mid)


if __name__ == "__main__":
    main()
