"""I-A round 4: run the new rails with the PRODUCT files written back from HEAD
(9878e3bbd7), then restore the round-4 bytes. Restores are verified by sha256
against the bytes captured before the swap, and the HEAD swap is verified against
`git cat-file blob HEAD:<path>`."""
import hashlib
import subprocess
import sys
from pathlib import Path

ROOT = Path(r"C:\Users\Patrick\uct-worktrees\notebook-restore-undo")
OUT = Path(sys.argv[1])
PRODUCT = [
    "app/src/pages/journal-2-0/lib/offline/refusedCopy.js",
    "app/src/pages/journal-2-0/lib/offline/useDurableNote.js",
    "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx",
    "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css",
]
TESTS = [
    "src/pages/journal-2-0/lib/offline/noteCopy.test.js",
    "src/pages/journal-2-0/lib/offline/restoreUndoKeepsWords.test.jsx",
]
sha = lambda b: hashlib.sha256(b).hexdigest()


def head_blob(p):
    return subprocess.run(["git", "-C", str(ROOT), "cat-file", "blob", f"HEAD:{p}"],
                          check=True, capture_output=True).stdout


saved = {p: (ROOT / p).read_bytes() for p in PRODUCT}
try:
    for p in PRODUCT:
        blob = head_blob(p)
        (ROOT / p).write_bytes(blob)
        # autocrlf: the working file may be CRLF while the blob is LF; compare CR-stripped
        assert (ROOT / p).read_bytes().replace(b"\r", b"") == blob.replace(b"\r", b""), p
    npx = "npx.cmd"
    with OUT.open("wb") as fh:
        rc = subprocess.run([npx, "vitest", "run", *TESTS, "--maxWorkers=2"], cwd=ROOT / "app",
                            stdout=fh, stderr=subprocess.STDOUT).returncode
    print("vitest exit", rc)
finally:
    for p, b in saved.items():
        (ROOT / p).write_bytes(b)
    for p, b in saved.items():
        got = (ROOT / p).read_bytes()
        assert sha(got) == sha(b), f"restore mismatch {p}"
        assert got.replace(b"\r", b"") != head_blob(p).replace(b"\r", b""), f"{p} still equals HEAD"
    print("restored, sha256 verified:", ", ".join(f"{Path(p).name}={sha(b)[:12]}" for p, b in saved.items()))
