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
RAILS = [
    "src/pages/journal-2-0/lib/offline/restoreUndoKeepsWords.test.jsx",
    "src/pages/journal-2-0/lib/offline/swapLineageRotation.test.jsx",
    "src/pages/journal-2-0/lib/offline/noteCopy.test.js",
]
ANSI = re.compile(r"\x1b\[[0-9;]*m")

MUTATIONS = {
    "R1-M1-never-spill": (RLS, [("  if (!spillRequested) return false\n  return editorStateDiscardsUnsentWork(prev, incoming)\n", "  return false\n")]),
    "R1-M2-spill-ignores-containment": (RLS, [("  if (!spillRequested) return false\n  return editorStateDiscardsUnsentWork(prev, incoming)\n", "  if (!spillRequested) return false\n  return Boolean(prev?.dirty)\n")]),
    "R1-M3-spill-without-request": (RLS, [("  if (!spillRequested) return false\n  return editorStateDiscardsUnsentWork(prev, incoming)\n", "  return editorStateDiscardsUnsentWork(prev, incoming)\n")]),
    "R1-M4-no-base-restore-not-captured": (NEP, [("      closeUndoStep(editorRef.current)\n      captureSwapNow()\n", "      closeUndoStep(editorRef.current)\n")]),
    "R1-M5-adoption-capture-not-swap": (NEP, [("      closeUndoStep(editor)\n      spillNextCaptureRef.current = true\n", "      closeUndoStep(editor)\n")]),
    "R1-M6-crossing-skips-outgoing-page": (NEP, [("    durableRef.current.schedule({\n      title: titleRef.current,", "    if (false) durableRef.current.schedule({\n      title: titleRef.current,")]),
    "R1-M7-crossing-incoming-not-swap": (NEP, [("    durableRef.current.flush()\n    spillNextCaptureRef.current = true\n  }\n", "    durableRef.current.flush()\n  }\n")]),
    "R1-M8-swap-capture-not-flushed": (NEP, [("      durableRef.current.schedule({ ...snapshot, spill: true })\n      durableRef.current.flush()\n", "      durableRef.current.schedule({ ...snapshot, spill: true })\n")]),
    "R1-M9-no-close-after-no-base-restore": (NEP, [("      closeUndoStep(editorRef.current)\n      captureSwapNow()\n", "      captureSwapNow()\n")]),
    "R1-M10-no-close-before-restore": (NEP, [("    restoreSwapRef.current = { preDoc: ed.state.doc }\n    closeUndoStep(ed)\n", "    restoreSwapRef.current = { preDoc: ed.state.doc }\n")]),
    "R1-M11-no-flush-before-no-base-restore": (NEP, [("    durableRef.current.flush()\n    if (draftBodyJson) markRestoreSwap(editorRef.current)\n", "    if (draftBodyJson) markRestoreSwap(editorRef.current)\n")]),
    "R1-M12-no-flush-before-with-base-restore": (NEP, [("      durableRef.current.flush()\n      markRestoreSwap(editor)\n", "      markRestoreSwap(editor)\n")]),
    "R1-M13-always-prev-base": (UDN, [("      if (spill && keepPrevBase) baseFrom = prev.baseUpdatedAt\n", "      if (spill) baseFrom = prev.baseUpdatedAt\n")]),
    "R1-M14-copies-not-written-by-persist": (UDN, [("      await putNoteWithIntent(db, record, intent, { copies })\n", "      await putNoteWithIntent(db, record, intent, { copies: [] })\n")]),
    "R1-M15-adapter-drops-copies": (NDB, [("  for (const copy of copies) outbox.put(copy)\n", "")]),
    "R1-M16-drain-clears-without-forking": (DRN, [("        await fork({ ...entry, noteId: entry.copyOf })\n", "")]),
    "R1-M17-drain-treats-copy-as-update": (DRN, [("    if (isNoteCopy(entry)) {\n", "    if (false && isNoteCopy(entry)) {\n")]),
    "R1-M18-no-crossing-gate": (NEP, [("    if (!ed.state.doc.eq(swap.preDoc) && !tr.before.eq(swap.preDoc)) return\n", "")]),
    "R1-M19-onUpdate-never-notes-crossing": (NEP, [("        noteRestoreCrossing(transaction)\n", "")]),
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
