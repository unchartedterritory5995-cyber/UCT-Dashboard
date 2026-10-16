"""I-A fix round 5 mutations. Each mutant replaces ONE exact snippet (asserted to occur
exactly once), runs the two rail files, records the totals, and restores the captured
bytes. Every restore is checked twice: sha256 of the captured bytes AND, CR-stripped,
against `git cat-file blob HEAD:<path>`. Never git checkout / git stash.

Usage: python mutate_ru5.py <outdir> [<id> ...]
"""
import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(r"C:\Users\Patrick\uct-worktrees\notebook-restore-undo")
APP = REPO / "app"
ANSI = re.compile(r"\x1b\[[0-9;]*m")
RC = "app/src/pages/journal-2-0/lib/offline/refusedCopy.js"
RCO = "app/src/pages/journal-2-0/components/notebook/RefusedCopyOffer.jsx"
NEP = "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx"
RAILS = [
    "src/pages/journal-2-0/lib/offline/noteCopy.test.js",
    "src/pages/journal-2-0/lib/offline/restoreUndoKeepsWords.test.jsx",
]

MUTANTS = [
    ("R5-M1", RC, "  if (plain) return markPlainSaved(db, entry)\n", "",
     "C-4 reverted: a landed plain save clears the copy again"),
    ("R5-M2", RC, "  const marked = {\n    ...entry,\n",
     "  const marked = {\n    ...entry,\n    patch: { ...entry.patch, bodyJson: plainParagraphsDoc(entry.patch?.bodyJson) },\n",
     "the kept copy stores the FLATTENED body"),
    ("R5-M3", RC, "  const done = Boolean(refusal?.plain) || Boolean(plainSaved)\n",
     "  const done = Boolean(refusal?.plain)\n",
     "a plain-saved copy offers a second plain save (a duplicate note)"),
    ("R5-M4", RC, "      return alt ? `[image: ${alt}]` : ''\n", "      return ''\n",
     "the walk drops an image's description"),
    ("R5-M5", RC, "      return head && url ? `${head} (${url})` : head || url\n", "      return ''\n",
     "the walk drops a link preview"),
    ("R5-M6", RC, "    if (run) out += href && run.trim() !== href ? `${run} (${href})` : run\n",
     "    if (run) out += run\n", "the walk drops a link's address"),
    ("R5-M7", RC, "  const own = citationLeafText({ type: { name: type }, attrs })\n  if (own) return own\n",
     "", "the walk ignores the app's own leaf text (date, maths, file, canvas)"),
    ("R5-M8", RC, "  if (!detail) return COPY_OTHER\n", "", "M-18 reverted: a detail-less 400/422 is content"),
    ("R5-M9", RC, "  if (NAMES_ANOTHER_FIELD.test(detail)) {\n    return 'A copy",
     "  if (false) {\n    return 'A copy", "the other class's field sentence is dropped (falls to the generic one)"),
    ("R5-M10", RC, "    + 'Save as a separate note sends it to the server once more. If that is refused too, Copy text puts '\n",
     "    + 'Save as a separate note tries again. If that is refused too, Copy text puts '\n",
     "the generic other sentence says 'tries again'"),
    ("R5-M11", RC, "    hiddenItems: copyHasHiddenItems(bodyJson),\n", "    hiddenItems: false,\n",
     "items with no words are not reported"),
    ("R5-M12", RC, "  } catch {\n    present = true\n  }\n",
     "  } catch {\n    return { outcome: 'failed', offline: false }\n  }\n",
     "a plain save whose mark cannot be written reports 'failed' (a retry duplicates)"),
    ("R5-M13", RCO, "const SELECTED = 'Your browser didn’t allow copying. The words are selected. '\n  + 'Use your device’s copy command to copy them.'\n",
     "const SELECTED = 'Your browser didn’t allow copying, so the words are selected instead. '\n  + 'Press Ctrl+C (⌘C on a Mac) to copy them.'\n",
     "the Copy-text fallback assumes a keyboard again"),
    ("R5-M14", RCO, "      <p className={styles.copyStatus} role=\"status\">{status}</p>\n    </section>",
     "      <p key={asking ? 'confirm' : 'offer'} className={styles.copyStatus} role=\"status\">{status}</p>\n    </section>",
     "the status line re-mounts with the confirm swap"),
    ("R5-M15", RCO, "    if (now && !wasPlainSaved.current) reasonRef.current?.focus()\n", "",
     "focus is left on the removed plain-save button"),
    ("R5-M16", RCO, "  const question = copy.plainSaved\n", "  const question = false\n",
     "the Discard confirm of a plain-saved copy says its words are saved nowhere"),
    ("R5-M17", NEP, "      {(refusedCopies.length > 0 || copySavedNotice) && (\n", "      {copySavedNotice && (\n",
     "M-19 reverted: the live region arrives already holding its text"),
    ("R5-M18", NEP, "    if (!copyFocusAfterRef.current) return\n    copyFocusAfterRef.current = false\n",
     "    return\n", "focus falls to the body after a save or Discard"),
    ("R5-M19", NEP, "      if (res?.outcome === 'plain-saved') {\n",
     "      if (res?.outcome === 'plain-saved-never') {\n",
     "the editor does not handle a landed plain save (reads as a transient failure)"),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def head_blob(rel):
    return subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", f"HEAD:{rel}"],
                          capture_output=True, check=True).stdout


def main():
    out = Path(sys.argv[1])
    want = set(sys.argv[2:])
    out.mkdir(parents=True, exist_ok=True)
    npx = shutil.which("npx")
    results = []
    for mid, rel, old, new, what in MUTANTS:
        if want and mid not in want:
            continue
        path = REPO / rel
        orig = path.read_bytes()
        text = orig.decode("utf-8")
        # git's autocrlf can re-check-out a file as CRLF after a commit (the blob stays
        # LF): match the snippets in the endings the working file has.
        if "\r\n" in text:
            old, new = old.replace("\n", "\r\n"), new.replace("\n", "\r\n")
        n = text.count(old)
        if n != 1:
            results.append(f"{mid} SKIPPED: snippet occurs {n} times ({what})")
            print(results[-1], flush=True)
            continue
        log = out / f"{mid}.log"
        try:
            path.write_bytes(text.replace(old, new, 1).encode("utf-8"))
            with open(log, "wb") as fh:
                subprocess.run([npx, "vitest", "run", *RAILS, "--maxWorkers=2"], cwd=str(APP),
                               stdout=fh, stderr=subprocess.STDOUT)
        finally:
            path.write_bytes(orig)
        back = path.read_bytes()
        assert sha(back) == sha(orig), f"{mid}: restore sha mismatch"
        assert back.replace(b"\r", b"") == head_blob(rel).replace(b"\r", b""), f"{mid}: restore differs from HEAD"
        body = ANSI.sub("", log.read_text(encoding="utf-8", errors="replace"))
        totals = [ln.strip() for ln in body.splitlines() if re.match(r"\s*Tests\s", ln)]
        verdict = "KILLED" if totals and "failed" in totals[0] else ("SURVIVED" if totals else "NO TOTALS LINE")
        results.append(f"{mid} {verdict} :: {totals[0] if totals else '-'} :: {what} :: restore sha+HEAD ok")
        print(results[-1], flush=True)
    (out / "summary.txt").write_text("\n".join(results) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
