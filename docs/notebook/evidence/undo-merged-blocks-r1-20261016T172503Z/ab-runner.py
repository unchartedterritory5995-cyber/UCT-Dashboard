"""C-1 r1 lane: run named rails on HEAD and on 928ba69bd6's four source files; restore
HEAD blob bytes and verify sha256 against git cat-file blob HEAD:<path>."""
import hashlib, subprocess, sys
WT = r"C:\Users\Patrick\uct-worktrees\notebook-undo-merged-blocks"
APP = WT + r"\app"
OUT, TAG = sys.argv[1], sys.argv[2]
FILES = sys.argv[3:]
SRC = ["app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx",
       "app/src/pages/journal-2-0/lib/noteContentGuard.js",
       "app/src/pages/journal-2-0/lib/offline/recoverLocalState.js",
       "app/src/pages/journal-2-0/lib/offline/useDurableNote.js"]
git = lambda *a: subprocess.run(["git", "-C", WT, *a], capture_output=True, check=True).stdout
full = lambda p: WT + "\\" + p.replace("/", "\\")
def run(label):
    with open(OUT + "\\" + f"{TAG}-{label}.log", "wb") as out:
        rc = subprocess.run(["npx.cmd", "vitest", "run", "--maxWorkers=1", *FILES], cwd=APP, stdout=out, stderr=subprocess.STDOUT).returncode
        out.write(f"\nVITEST EXIT: {rc}\n".encode())
    print(label, "exit", rc, flush=True)
head = {p: git("cat-file", "blob", f"HEAD:{p}") for p in SRC}
base = {p: git("cat-file", "blob", f"928ba69bd6:{p}") for p in SRC}
run("on-HEAD")
try:
    for p in SRC:
        open(full(p), "wb").write(base[p])
    run("on-928ba69bd6")
finally:
    for p in SRC:
        open(full(p), "wb").write(head[p])
    for p in SRC:
        assert hashlib.sha256(open(full(p), "rb").read()).digest() == hashlib.sha256(git("cat-file", "blob", f"HEAD:{p}")).digest(), p
    print("restored and verified against HEAD blobs")
