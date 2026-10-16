"""Write a ref's blobs over the worktree's product files, run named vitest files,
restore byte-exact from a backup, and prove the restore against HEAD's blob.

Usage: python swap_blobs_ru.py <ref> <logfile> <test-file> [<test-file> ...]
Never uses git checkout / git stash. Restore is verified two ways: sha256 of the
backup bytes AND equality with `git cat-file blob HEAD:<path>` after CRLF->LF.
"""
import hashlib
import subprocess
import sys
from pathlib import Path

WT = Path(r"C:\Users\Patrick\uct-worktrees\notebook-restore-undo")
FILES = [
    "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx",
    "app/src/pages/journal-2-0/lib/offline/recoverLocalState.js",
    "app/src/pages/journal-2-0/lib/offline/useDurableNote.js",
    "app/src/pages/journal-2-0/lib/offline/notebookDb.js",
    "app/src/pages/journal-2-0/lib/offline/outboxDrain.js",
    "app/src/pages/journal-2-0/lib/offline/useOutboxDrain.js",
    "app/src/pages/journal-2-0/lib/offline/blockedNotes.js",
    "app/src/pages/journal-2-0/lib/offline/noteCopy.js",
]


def git_blob(ref, path):
    return subprocess.run(["git", "-C", str(WT), "cat-file", "blob", f"{ref}:{path}"],
                          check=True, capture_output=True).stdout


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    ref, log = sys.argv[1], sys.argv[2]
    tests = sys.argv[3:]
    backups = {}
    for f in FILES:
        p = WT / f
        b = p.read_bytes()
        head = git_blob("HEAD", f)
        assert b.replace(b"\r\n", b"\n") == head.replace(b"\r\n", b"\n"), f"{f}: working file != HEAD blob before swap"
        backups[f] = b
    try:
        for f in FILES:
            (WT / f).write_bytes(git_blob(ref, f))
        import shutil
        npx = shutil.which("npx")
        assert npx, "npx not found"
        with open(log, "wb") as out:
            r = subprocess.run([npx, "vitest", "run", *tests, "--maxWorkers=2"],
                               cwd=str(WT / "app"), stdout=out, stderr=subprocess.STDOUT)
        print("vitest exit", r.returncode)
    finally:
        for f, b in backups.items():
            (WT / f).write_bytes(b)
        for f, b in backups.items():
            now = (WT / f).read_bytes()
            head = git_blob("HEAD", f)
            assert sha(now) == sha(b), f"{f}: restore sha mismatch"
            assert now.replace(b"\r\n", b"\n") == head.replace(b"\r\n", b"\n"), f"{f}: restored file != HEAD blob"
            print("restored OK", f, sha(now)[:12])


if __name__ == "__main__":
    main()
