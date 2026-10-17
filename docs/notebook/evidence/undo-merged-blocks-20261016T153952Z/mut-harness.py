"""C-1 mutation harness (lane: notebook-undo-merged-blocks). Each mutation is applied
alone to the committed tree, the named rails are run, and the file is restored by
writing back the bytes of `git cat-file blob HEAD:<path>` and verified by hash."""
import hashlib
import subprocess
import sys

WT = r"C:\Users\Patrick\uct-worktrees\notebook-undo-merged-blocks"
APP = WT + r"\app"
EV = sys.argv[1]                      # evidence dir (absolute)
ONLY = sys.argv[2:]                   # optional subset of mutation names

RLS = "app/src/pages/journal-2-0/lib/offline/recoverLocalState.js"
UDN = "app/src/pages/journal-2-0/lib/offline/useDurableNote.js"
NEP = "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx"
NCG = "app/src/pages/journal-2-0/lib/noteContentGuard.js"

R_EDITOR = "src/pages/journal-2-0/lib/offline/undoMergedBlocks.test.jsx"
R_DECIDE = "src/pages/journal-2-0/lib/offline/mergedBlocksDecision.test.js"
R_UNDO = "src/pages/journal-2-0/lib/offline/ordinaryUndoNoPin.test.jsx"

MUTATIONS = [
    ("M1-capture-spill-removed", RLS, [
        ("  if (dropsMergedBlocks(prev, incoming, incoming?.editLineage)) return true\n", ""),
    ], [R_EDITOR, R_DECIDE]),
    ("M2-settle-copy-removed", UDN, [
        ("const copies = (!unsentWork && dropsMergedBlocks(prev, acked, sentFrom))",
         "const copies = (false && dropsMergedBlocks(prev, acked, sentFrom))"),
    ], [R_EDITOR, R_DECIDE]),
    ("M3-containment-text-only", RLS, [
        ("  return !carriesWords(incoming, prev)\n",
         "  return !authoredText(incoming).includes(authoredText(prev))\n"),
    ], [R_EDITOR, R_DECIDE]),
    ("M4-editor-merged-not-recorded", NEP, [
        ("for (const n of missing) { const k = nodeKeyOf(n); if (k) mergedKeysRef.current.add(k) }",
         "for (const n of missing) { const k = nodeKeyOf(n); if (k && false) mergedKeysRef.current.add(k) }"),
        ("          if (k && !localKeys.has(k)) mergedKeysRef.current.add(k)\n",
         "          if (false && k && !localKeys.has(k)) mergedKeysRef.current.add(k)\n"),
    ], [R_EDITOR, R_DECIDE]),
    ("M5-merge-not-flushed", NEP, [
        ("        durableRef.current.flush()\n      }\n      lastSavedRef.current.updatedAt = fresh.updatedAt || null\n",
         "      }\n      lastSavedRef.current.updatedAt = fresh.updatedAt || null\n"),
    ], [R_EDITOR]),
    ("M6-MINOR1-reverted", NCG, [
        ("          const outsideHistory = tr.getMeta('addToHistory') === false\n"
         "            || tr.getMeta('appendedTransaction')?.getMeta('addToHistory') === false\n",
         "          const outsideHistory = tr.getMeta('addToHistory') === false\n"),
    ], [R_UNDO]),
    ("M7-control-c-protect-every-block", RLS, [
        ("  if (!prev || !merged.length) return false\n"
         "  return serverBlocksDropped(prev, incoming).some((k) => merged.includes(k))\n",
         "  if (!prev) return false\n"
         "  return serverBlocksDropped(prev, incoming).length > 0\n"),
    ], [R_EDITOR, R_DECIDE]),
    ("M8-control-d-reconcile-never-forks", NEP, [
        ("    if (plan !== FORK) {\n", "    if (true) {\n"),
    ], [R_EDITOR]),
]


def git(*args):
    return subprocess.run(["git", "-C", WT, *args], capture_output=True, check=True).stdout


def head_blob(path):
    return git("cat-file", "blob", f"HEAD:{path}")


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    status = git("status", "--porcelain").decode()
    if status.strip():
        sys.exit(f"REFUSED: the tree is not clean:\n{status}")
    for name, path, reps, rails in MUTATIONS:
        if ONLY and name not in ONLY:
            continue
        full = WT + "\\" + path.replace("/", "\\")
        original = head_blob(path)
        text = original.decode("utf-8")
        for old, new in reps:
            n = text.count(old)
            if n != 1:
                sys.exit(f"{name}: expected exactly one match, found {n}: {old!r}")
            text = text.replace(old, new)
        mutated = text.encode("utf-8")
        assert mutated != original, name
        try:
            with open(full, "wb") as f:
                f.write(mutated)
            log = f"{EV}\\mut-{name}.log"
            with open(log, "wb") as out:
                out.write(f"MUTATION {name} on {path} (HEAD {git('rev-parse', 'HEAD').decode().strip()})\n".encode())
                for old, new in reps:
                    out.write(f"  - {old!r}\n  + {new!r}\n".encode())
                out.flush()
                rc = subprocess.run(
                    ["npx.cmd", "vitest", "run", "--maxWorkers=1", *rails],
                    cwd=APP, stdout=out, stderr=subprocess.STDOUT,
                ).returncode
                out.write(f"\nVITEST EXIT: {rc}\n".encode())
        finally:
            with open(full, "wb") as f:
                f.write(original)
        with open(full, "rb") as f:
            back = f.read()
        if sha(back) != sha(head_blob(path)):
            sys.exit(f"{name}: RESTORE FAILED for {path}")
        print(f"{name}: vitest exit {rc}; restored {path} sha256 {sha(back)[:16]} == HEAD blob")
    status = git("status", "--porcelain").decode()
    print("tree after:", "clean" if not status.strip() else status)


if __name__ == "__main__":
    main()
