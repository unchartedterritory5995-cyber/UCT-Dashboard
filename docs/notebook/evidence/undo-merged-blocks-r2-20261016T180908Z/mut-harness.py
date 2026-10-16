"""C-1 fix round 1 mutation harness (lane: notebook-undo-merged-blocks). Each mutation is
applied alone to the committed tree, the named rails are run, and the file is restored
by writing back the bytes of `git cat-file blob HEAD:<path>` and verified by hash."""
import hashlib
import subprocess
import sys

WT = r"C:\Users\Patrick\uct-worktrees\notebook-undo-merged-blocks"
APP = WT + r"\app"
EV = sys.argv[1]
ONLY = sys.argv[2:]
NL = chr(10)

RLS = "app/src/pages/journal-2-0/lib/offline/recoverLocalState.js"
UDN = "app/src/pages/journal-2-0/lib/offline/useDurableNote.js"
NEP = "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx"

R_EDITOR = "src/pages/journal-2-0/lib/offline/undoMergedBlocks.test.jsx"
R_DECIDE = "src/pages/journal-2-0/lib/offline/mergedBlocksDecision.test.js"
R_SWAP = "src/pages/journal-2-0/lib/offline/undoAcrossServerSwap.test.jsx"

M4_CALL_OLD = "    if (!restoredNote) return" + NL + "    captureOutgoingPage()" + NL
M4_CALL_NEW = "    if (!restoredNote) return" + NL
M4_SPILL_OLD = "        spillNextCaptureRef.current = true   // C-1 r2 (m4): the next capture is a swap capture" + NL
M4_SPILL_NEW = ""

MUTATIONS = [
    ("R2-M1-m4-reverted", NEP, [(M4_CALL_OLD, M4_CALL_NEW), (M4_SPILL_OLD, M4_SPILL_NEW)], [R_SWAP]),
    ("R2-M2-settle-asks-acked-rerun", UDN, [
        ("    const copies = dropsMergedBlocks(prev, record, mergedNow)" + NL,
         "    const copies = dropsMergedBlocks(prev, acked, mergedNow)" + NL),
    ], [R_SWAP]),
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
        sys.exit("REFUSED: the tree is not clean:" + NL + status)
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
            log = EV + "\\" + f"mut-{name}.log"
            with open(log, "wb") as out:
                out.write(f"MUTATION {name} on {path} (HEAD {git('rev-parse', 'HEAD').decode().strip()}){NL}".encode())
                for old, new in reps:
                    out.write(f"  - {old!r}{NL}  + {new!r}{NL}".encode())
                out.flush()
                rc = subprocess.run(
                    ["npx.cmd", "vitest", "run", "--maxWorkers=1", *rails],
                    cwd=APP, stdout=out, stderr=subprocess.STDOUT,
                ).returncode
                out.write(f"{NL}VITEST EXIT: {rc}{NL}".encode())
        finally:
            with open(full, "wb") as f:
                f.write(original)
        with open(full, "rb") as f:
            back = f.read()
        if sha(back) != sha(head_blob(path)):
            sys.exit(f"{name}: RESTORE FAILED for {path}")
        print(f"{name}: vitest exit {rc}; restored {path} sha256 {sha(back)[:16]} == HEAD blob", flush=True)
    print("tree after:", git("diff", "--stat").decode().strip() or "no content diff")


if __name__ == "__main__":
    main()
