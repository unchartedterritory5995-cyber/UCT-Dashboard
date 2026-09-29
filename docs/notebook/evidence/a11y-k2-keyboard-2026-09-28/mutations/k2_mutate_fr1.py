"""Lane K2 mutation harness: each mutation is applied as an exact text replacement, the named
suites are run, the totals line is read, and the file is restored from the bytes captured before
the mutation. After the restore the file is checked against the COMMITTED blob (git), not only
against the capture."""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w10s1")
APP = REPO / "app"
J2 = "src/pages/journal-2-0"
NB = f"{J2}/components/notebook"
OUT = Path(sys.argv[1])

T_HOOK = f"{J2}/lib/useDisclosureFocus.test.jsx"
T_EXPORT = f"{NB}/NoteExportControls.test.jsx"
T_OUTLINE = f"{NB}/NoteOutline.test.jsx"
T_MENU = f"{NB}/NoteMenuActions.test.jsx"
T_MORE = f"{NB}/NoteEditorPage.moreMenu.test.jsx"
T_FLOORS = f"{J2}/a11y/targetFloors.test.js"

T_MM = f"{NB}/NoteMoreMenu.test.jsx"
M = [
    ("R1", f"{NB}/NoteMoreMenu.jsx", "  if (left < gutter) return gutter - left" + chr(10), "  if (left < gutter) return 0" + chr(10),
     "a box off the LEFT edge is not moved (the I-1 defect)", [T_MM, T_MORE]),
    ("R2", f"{NB}/NoteMoreMenu.jsx", "  useLayoutEffect(() => { if (open) place() })", "  useLayoutEffect(() => { if (open) place() }, [open])",
     "placed only when it opens, not after a re-render (the Lock-while-open jump)", [T_MM]),
    ("R3", f"{NB}/NoteMoreMenu.jsx", "    window.addEventListener('resize', place)" + chr(10), "",
     "a resize does not re-place it", [T_MM]),
    ("R4", f"{NB}/NoteMoreMenu.jsx", "      if (document.querySelector('[aria-modal=\"true\"]')) return" + chr(10), "",
     "a press on the Delete question (or its backdrop) closes the panel (M-3)", [T_MORE]),
    ("R5", f"{J2}/lib/useDisclosureFocus.js", "    e.preventDefault()" + chr(10) + "    e.stopPropagation()" + chr(10), "    e.preventDefault()" + chr(10),
     "Escape not stopped at the disclosure: the page's find-bar Escape also runs (M-2; the round-0 M5)", [T_MORE]),
    ("R6", f"{NB}/NoteEditorPage.jsx", "      {editor && !locked && (" + chr(10) + "        <div className={styles.toolbarRow}", "      {editor && (" + chr(10) + "        <div className={styles.toolbarRow}",
     "a locked note renders the toolbar row again (M-4)", [T_MORE]),
]


TOTALS = re.compile(r"Tests\s+(?:\x1b\[[0-9;]*m)*\s*(.*?)\((\d+)\)")


def run(tests):
    p = subprocess.run(["npx.cmd", "vitest", "run", "--maxWorkers=2", *tests], cwd=APP,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = re.sub(r"\x1b\[[0-9;]*m", "", p.stdout + p.stderr)
    line = next((l.strip() for l in out.splitlines() if l.strip().startswith("Tests ")), None)
    return p.returncode, line, out


def committed_sha(rel):
    blob = subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", f"HEAD:app/{rel}"], capture_output=True).stdout
    return hashlib.sha256(blob.replace(b"\r\n", b"\n")).hexdigest()


results = []
for mid, rel, old, new, what, tests in M:
    path = APP / rel
    orig = path.read_bytes()
    text = orig.decode("utf-8")
    nl = "\r\n" if "\r\n" in text else "\n"
    norm = text.replace("\r\n", "\n")
    n = norm.count(old)
    if n != 1:
        results.append({"id": mid, "what": what, "error": f"anchor found {n} times"})
        print(mid, "ANCHOR", n, flush=True)
        continue
    path.write_bytes(norm.replace(old, new).replace("\n", nl).encode("utf-8"))
    try:
        code, line, out = run(tests)
    finally:
        path.write_bytes(orig)
    restored = hashlib.sha256(path.read_bytes().replace(b"\r\n", b"\n")).hexdigest() == committed_sha(rel)
    fails = [l.strip() for l in out.splitlines() if l.strip().startswith("×") or l.strip().startswith("FAIL ")][:12]
    results.append({"id": mid, "file": rel, "what": what, "exit": code, "totals": line, "red": code != 0,
                    "restored_equals_committed_blob": restored, "failing": fails})
    print(mid, "RED" if code else "SURVIVED", line, "restored==HEAD:", restored, flush=True)
    OUT.write_text(json.dumps(results, indent=1), encoding="utf-8")

code, line, _ = run([T_MM, T_MORE, T_HOOK])
results.append({"id": "CONTROL", "what": "every file restored: the same suites, unmutated", "exit": code, "totals": line})
print("CONTROL", code, line, flush=True)
OUT.write_text(json.dumps(results, indent=1), encoding="utf-8")
