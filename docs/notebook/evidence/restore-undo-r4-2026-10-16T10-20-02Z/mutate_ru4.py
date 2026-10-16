"""I-A round 4 mutation run (lane-unique name: mutate_ru4.py).

Each mutant edits ONE file by an exact, unique substring replacement, runs the named
rails, and restores the captured bytes. Every restore is verified twice: sha256
against the bytes captured before the edit, AND (CR-stripped) against
`git cat-file blob HEAD:<path>` -- a capture can only be trusted if it equals the
committed blob. Never `git checkout`.

usage: python mutate_ru4.py <out_dir> [mutant ids...]
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(r"C:\Users\Patrick\uct-worktrees\notebook-restore-undo")
APP = ROOT / "app"
OUT = Path(sys.argv[1])
ONLY = set(sys.argv[2:])
OUT.mkdir(parents=True, exist_ok=True)

RC = "app/src/pages/journal-2-0/lib/offline/refusedCopy.js"
OFFER = "app/src/pages/journal-2-0/components/notebook/RefusedCopyOffer.jsx"
NEP = "app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx"
RUK = "app/src/pages/journal-2-0/lib/offline/restoreUndoKeepsWords.test.jsx"
NC_T = "src/pages/journal-2-0/lib/offline/noteCopy.test.js"
RUK_T = "src/pages/journal-2-0/lib/offline/restoreUndoKeepsWords.test.jsx"

# id, file, old, new, [(test file, -t filter or None)]
MUTANTS = [
    ("R4-M1 the offer shows the server's sentence", RC,
     "  if (refusal?.plain) {\n",
     "  if (refusal?.detail) return `${refusal.detail}. ${KEPT}`\n  if (refusal?.plain) {\n",
     [(NC_T, "fix round 4"), (RUK_T, "I-7")]),
    ("R4-M2 a body 400 is not a content refusal", RC,
     "  return SAYS_TOO_BIG.test(detail) ? COPY_TOO_LARGE : COPY_CONTENT\n",
     "  return SAYS_TOO_BIG.test(detail) ? COPY_TOO_LARGE : COPY_OTHER\n",
     [(NC_T, "fix round 4"), (RUK_T, "reason is the BODY|I-7")]),
    ("R4-M3 a 413 is not a content refusal", RC,
     "  if (status === 413) return COPY_TOO_LARGE\n",
     "  if (status === 413) return COPY_OTHER\n",
     [(NC_T, "fix round 4"), (RUK_T, "CONTENT refusal")]),
    ("R4-M4 the plain save sends the rich body", RC,
     "    ? { ...entry, patch: { ...entry.patch, bodyJson: plainParagraphsDoc(entry.patch?.bodyJson) } }\n",
     "    ? entry\n",
     [(NC_T, "fix round 4"), (RUK_T, "CONTENT refusal")]),
    ("R4-M5 a refused plain save stores the flattened body", RC,
     "    await holdRefusedCopy(db, entry, err, { plain })\n",
     "    await holdRefusedCopy(db, sent, err, { plain })\n",
     [(NC_T, "fix round 4"), (RUK_T, "refused AGAIN keeps the copy with its ORIGINAL")]),
    ("R4-M6 plain text is never offered", RC,
     "    offerPlain: !plainRefused && isContentRefusal(kind),\n",
     "    offerPlain: false,\n",
     [(RUK_T, "CONTENT refusal|reason is the BODY")]),
    ("R4-M7 the separate-note retry stays after a content refusal", RC,
     "    offerSeparate: !plainRefused && !isContentRefusal(kind),\n",
     "    offerSeparate: !plainRefused,\n",
     [(RUK_T, "CONTENT refusal|reason is the BODY")]),
    ("R4-M8 every failure reads as offline", RC,
     "  if (err?.status != null) return false\n",
     "  if (err?.status != null) return true\n",
     [(NC_T, "fix round 4"), (RUK_T, "NOT the network")]),
    ("R4-M9 no failure reads as offline", RC,
     "  return /failed to fetch|network|load failed/i.test(String(err?.message || err))\n",
     "  return false\n",
     [(NC_T, "fix round 4"), (RUK_T, "only after a NETWORK failure")]),
    ("R4-M10 an empty line becomes an empty text node", RC,
     "      : { type: 'paragraph' }))\n",
     "      : { type: 'paragraph', content: [{ type: 'text', text: '' }] }))\n",
     [(NC_T, "fix round 4")]),
    ("R4-M11 Copy text leaves out the subtitle", RC,
     "  const head = [view?.title, view?.subtitle]",
     "  const head = [view?.title]",
     [(NC_T, "fix round 4"), (RUK_T, "puts the copy")]),
    ("R4-M12 a refused clipboard selects nothing", OFFER,
     "      if (el && sel) sel.selectAllChildren(el)\n",
     "",
     [(RUK_T, "clipboard that")]),
    ("R4-M13 Copy text never calls the clipboard", OFFER,
     "      pending = navigator.clipboard?.writeText?.(text) ?? null\n",
     "      pending = null\n",
     [(RUK_T, "puts the copy|Discard confirm shows")]),
    ("R4-M14 the Discard confirm shows no words", OFFER,
     "          <CopyPreview copy={copy} previewRef={previewRef} />\n          <p className={styles.copyStatus} role=\"status\">{status}</p>\n          <div className={styles.draftBannerActions}>\n            {copyButton}\n            <button\n",
     "          <p className={styles.copyStatus} role=\"status\">{status}</p>\n          <div className={styles.draftBannerActions}>\n            {copyButton}\n            <button\n",
     [(RUK_T, "Discard confirm shows")]),
    ("R4-M15 focus is never moved", OFFER,
     "    ;(target === 'keep' ? keepRef : discardRef).current?.focus()\n",
     "",
     [(RUK_T, "focus moves INTO")]),
    ("R4-M16 Keep it leaves focus in the confirm", OFFER,
     "  const keep = () => { focusNext.current = 'discard'; setAsking(false) }\n",
     "  const keep = () => { focusNext.current = null; setAsking(false) }\n",
     [(RUK_T, "focus moves INTO")]),
    ("R4-M17 the editor's plain button sends a rich save", NEP,
     "          onSavePlain={(c) => saveRefusedCopyAsNote(c, { plain: true })}\n",
     "          onSavePlain={(c) => saveRefusedCopyAsNote(c)}\n",
     [(RUK_T, "CONTENT refusal")]),
    ("R4-M18 harness: the PUT reads the module server when it lands", RUK,
     "  useJ2Note: () => ({ note: mountedNote, isLoading: false, error: null, update: mountedUpdate, refresh: vi.fn() }),\n",
     "  useJ2Note: () => ({ note: mountedNote, isLoading: false, error: null, update: (p, ...r) => { update(p, ...r); return putInto(server, p) }, refresh: vi.fn() }),\n",
     [(RUK_T, "M-12")]),
    ("R4-M20 harness: the PUT writes the module server after it is released", RUK,
     "  if (patch.bodyJson) s.body = patch.bodyJson\n",
     "  if (patch.bodyJson) server.body = patch.bodyJson\n",
     [(RUK_T, "M-12")]),
    ("R4-M19 harness: the fork's requests read the module server", RUK,
     "const serverNow = () => cellScope.getStore()?.server ?? server\n",
     "const serverNow = () => server\n",
     [(RUK_T, "M-12")]),
]

sha = lambda b: hashlib.sha256(b).hexdigest()
strip = lambda b: b.replace(b"\r", b"")


def head_blob(p):
    return subprocess.run(["git", "-C", str(ROOT), "cat-file", "blob", f"HEAD:{p}"],
                          check=True, capture_output=True).stdout


def totals(text):
    clean = re.sub(r"\x1b\[[0-9;]*m", "", text)
    files = re.search(r"Test Files\s+(.*)", clean)
    tests = re.search(r"^\s+Tests\s+(.*)$", clean, re.M)
    return (files.group(1).strip() if files else None), (tests.group(1).strip() if tests else None)


results = []
for i, (mid, path, old, new, runs) in enumerate(MUTANTS, 1):
    if ONLY and mid.split()[0] not in ONLY:
        continue
    f = ROOT / path
    orig = f.read_bytes()
    assert strip(orig) == strip(head_blob(path)), f"{path} is not the committed blob before {mid}"
    text = orig.decode("utf-8")
    crlf = "\r\n" in text
    o, n = (old.replace("\n", "\r\n"), new.replace("\n", "\r\n")) if crlf else (old, new)
    assert text.count(o) == 1, f"{mid}: anchor found {text.count(o)} times"
    row = {"mutant": mid, "file": path, "runs": []}
    try:
        f.write_bytes(text.replace(o, n).encode("utf-8"))
        for tfile, filt in runs:
            log = OUT / f"m{i:02d}-{Path(tfile).stem}.log"
            cmd = ["npx.cmd", "vitest", "run", tfile, "--maxWorkers=2"] + (["-t", filt] if filt else [])
            with log.open("wb") as fh:
                rc = subprocess.run(cmd, cwd=APP, stdout=fh, stderr=subprocess.STDOUT).returncode
            tf, tt = totals(log.read_text(encoding="utf-8", errors="replace"))
            row["runs"].append({"test": tfile, "filter": filt, "exit": rc, "files": tf, "tests": tt, "log": log.name})
    finally:
        f.write_bytes(orig)
        back = f.read_bytes()
        assert sha(back) == sha(orig), f"restore sha mismatch {path}"
        assert strip(back) == strip(head_blob(path)), f"restore != HEAD blob {path}"
    # killed = at least one run reports failed tests (a run with no totals line is NOT a kill)
    row["killed"] = any(r["tests"] and "failed" in r["tests"] for r in row["runs"])
    row["any_run_without_totals"] = any(not r["tests"] for r in row["runs"])
    results.append(row)
    print(f"{mid}: {'KILLED' if row['killed'] else 'SURVIVED'} " + " | ".join(f"{Path(r['test']).stem}: {r['tests']}" for r in row["runs"]), flush=True)

(OUT / "mutations-summary.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
print("killed", sum(r["killed"] for r in results), "of", len(results))
