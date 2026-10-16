"""Round-3 mutation harness. For each mutation: assert the file equals HEAD's blob
(CRLF->LF), apply ONE textual replacement (must match exactly once), run the named
rails, restore the captured bytes, verify sha256 AND equality with
`git cat-file blob HEAD:<path>`. Never git checkout / git stash.
Usage: python mutate_ru3.py <outdir> [mutation-id ...]
"""
import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

WT = Path(r"C:\Users\Patrick\uct-worktrees\notebook-restore-undo")
APP = WT / "app"
OFF = "app/src/pages/journal-2-0/lib/offline/"
NEP = "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx"
UDN = OFF + "useDurableNote.js"
NDB = OFF + "notebookDb.js"
DRN = OFF + "outboxDrain.js"
UOD = OFF + "useOutboxDrain.js"
BLK = OFF + "blockedNotes.js"
NC = OFF + "noteCopy.js"
RC = OFF + "refusedCopy.js"
RAILS = [
    "src/pages/journal-2-0/lib/offline/noteCopy.test.js",
    "src/pages/journal-2-0/lib/offline/useOutboxDrain.test.jsx",
    "src/pages/journal-2-0/lib/offline/restoreUndoKeepsWords.test.jsx",
]
ANSI = re.compile(r"\x1b\[[0-9;]*m")

MUTATIONS = {
    "R3-M1-suffix-not-fitted": (NC, [(
        "  const kept = chars.length > room ? chars.slice(0, room).join('').trimEnd() : base\n",
        "  const kept = base\n")]),
    "R3-M2-cut-by-utf16-unit": (NC, [(
        "chars.slice(0, room).join('').trimEnd()",
        "base.slice(0, room).trimEnd()")]),
    "R3-M3-sweep-fork-raw-title": (UOD, [(
        "      title: conflictedCopyTitle(entry.patch?.title),\n",
        "      title: `${entry.patch?.title || 'Untitled note'} (conflicted copy)`.trim(),\n")]),
    "R3-M4-any-4xx-refused": (RC, [(
        "COPY_REFUSED_STATUSES.includes(err?.status)",
        "(err?.status >= 400 && err?.status < 500)")]),
    "R3-M5-phase-ignored": (RC, [(
        "  err?.phase === CREATE_PHASE && COPY_REFUSED_STATUSES",
        "  COPY_REFUSED_STATUSES")]),
    "R3-M6-create-error-untagged": (UOD, [(
        "    if (err && typeof err === 'object') err.phase = CREATE_PHASE\n",
        "")]),
    "R3-M7-copy-blocks-its-source": (BLK, [(
        "    if (isNoteCopy(e)) continue\n",
        "    if (isNoteCopy(e)) { if (isBlockedEntry(e) && e.copyOf) ids.add(e.copyOf); continue }\n")]),
    "R3-M8-refusal-put-unconditional": (NDB, [(
        "    if (req.result) { store.put(entry); wrote = true }\n",
        "    store.put(entry); wrote = true\n")]),
    "R3-M9-held-copy-reposted": (DRN, [(
        "      if (entry.copyRefused) {\n",
        "      if (false) {\n")]),
    "R3-M10-held-reported-blocked": (DRN, [(
        "        results.push({ mutationId: entry.mutationId, noteId: entry.copyOf, outcome: HELD, copy: true })\n",
        "        results.push({ mutationId: entry.mutationId, noteId: entry.copyOf, outcome: BLOCKED, copy: true })\n")]),
    "R3-M11-save-keeps-copy": (RC, [(
        "  await clearOutboxEntry(db, mutationId)\n  return { outcome: 'saved' }\n",
        "  return { outcome: 'saved' }\n")]),
    "R3-M12-refused-again-deletes-copy": (RC, [(
        "    await holdRefusedCopy(db, entry, err)\n    const now",
        "    await clearOutboxEntry(db, mutationId)\n    const now")]),
    "R3-M13-discard-without-confirm": (NEP, [(
        "onClick={() => setCopyAsk(copy.mutationId)}",
        "onClick={() => discardRefusedCopyConfirmed(copy)}")]),
    "R3-M14-discard-deletes-nothing": (RC, [(
        "export async function discardRefusedCopy(db, mutationId) {\n  await clearOutboxEntry(db, mutationId)\n}",
        "export async function discardRefusedCopy(db, mutationId) {\n  void db; void mutationId\n}")]),
    "R3-M15-copies-never-offered": (UDN, [(
        "        refusedCopies = refusedCopiesOf(entries, noteId)\n",
        "        refusedCopies = []\n")]),
    "R3-M16-reason-not-rendered": (NEP, [(
        "                {copy.reason}\n",
        "                {''}\n")]),
    "R3-M17-M2-skip-removed": (UOD, [(
        "        if (r?.outcome !== FORKED || r.copy) continue\n",
        "        if (r?.outcome !== FORKED) continue\n")]),
    "R3-M18-save-writes-into-source": (NEP, [(
        "      const res = await durableRef.current.saveCopy(copy.mutationId, { fork: forkConflictedCopy })\n",
        "      await update({ title: copy.title, subtitle: copy.subtitle, bodyJson: copy.bodyJson })\n"
        "      const res = await durableRef.current.saveCopy(copy.mutationId, { fork: forkConflictedCopy })\n")]),
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
    log = out / f"{mid}.log"
    try:
        p.write_bytes(data)
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


def check():
    for mid, (path, edits) in MUTATIONS.items():
        s = lf(blob(path)).decode("utf-8")
        print(mid, [s.count(o) for o, _ in edits])


def main():
    if sys.argv[1] == "--check":
        check()
        return
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for mid in sys.argv[2:] or list(MUTATIONS):
        run(out, mid)


if __name__ == "__main__":
    main()
