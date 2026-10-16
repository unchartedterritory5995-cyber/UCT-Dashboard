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
RAILS = [
    "src/pages/journal-2-0/lib/offline/restoreUndoKeepsWords.test.jsx",
    "src/pages/journal-2-0/lib/offline/swapLineageRotation.test.jsx",
]
ANSI = re.compile(r"\x1b\[[0-9;]*m")

MUTATIONS = {
    "M1-helper-never-keeps": (RLS, [(
        "  if (!displaced) return false\n",
        "  if (!displaced || true) return false\n")]),
    "M2-no-crossing-gate": (NEP, [(
        "    if (!ed.state.doc.eq(swap.preDoc) && !tr.before.eq(swap.preDoc)) return\n",
        "")]),
    "M3-no-closeHistory": (NEP, [(
        "    try { ed.view.dispatch(closeHistory(ed.state.tr)) } catch { /* a boundary is an aid, never the guard */ }\n",
        "")]),
    "M4-no-flush-before-restore": (NEP, [
        ("    durableRef.current.flush()\n    if (draftBodyJson) markRestoreSwap(editorRef.current)\n",
         "    if (draftBodyJson) markRestoreSwap(editorRef.current)\n"),
        ("    if (!auto) {\n      durableRef.current.flush()\n      markRestoreSwap(editor)\n",
         "    if (!auto) {\n      markRestoreSwap(editor)\n"),
    ]),
    "M5-no-flush-after-displaced": (NEP, [(
        "      durableRef.current.schedule({ ...snapshot, displaced })\n      durableRef.current.flush()\n",
        "      durableRef.current.schedule({ ...snapshot, displaced })\n")]),
    "M6-always-prev-base": (UDN, [(
        "      if (displaced) baseFrom = keepPrevBase ? prev.baseUpdatedAt : displaced.baseUpdatedAt\n",
        "      if (displaced) baseFrom = prev?.baseUpdatedAt ?? displaced.baseUpdatedAt\n")]),
    "M7-displaced-takes-incoming-lineage": (UDN, [(
        "      if (displaced) lineageStamp = editorLineageStamp(record, displaced.editLineage)\n",
        "      if (displaced) lineageStamp = editorLineageStamp(record, state?.editLineage)\n")]),
    "M10-onUpdate-never-notes-crossing": (NEP, [(
        "        noteRestoreCrossing(transaction)\n", "")]),
    "M11-adoption-restore-not-marked": (NEP, [(
        "      durableRef.current.flush()\n      markRestoreSwap(editor)\n",
        "      durableRef.current.flush()\n")]),
    "M12-no-base-restore-not-marked": (NEP, [(
        "    if (draftBodyJson) markRestoreSwap(editorRef.current)\n", "")]),
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
