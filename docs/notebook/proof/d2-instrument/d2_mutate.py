"""Wave 10 lane D2 -- mutation proofs for the D-1 / D-4 rails.

Each mutation: capture the file's bytes and sha256, check they equal the COMMITTED blob
(`git cat-file blob HEAD:<path>` -- a restore is proved against the commit, never only
against our own capture), apply one regex substitution (it must match exactly once),
run the named vitest file(s) with --maxWorkers=2, record the totals line, then write the
captured bytes back and re-verify the sha against BOTH the capture and the committed blob.
Never `git checkout`.

    python d2_mutate.py --set d1 --log <out.log>
    python d2_mutate.py --set d4 --log <out.log>
"""
from __future__ import annotations

import argparse
import hashlib
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
APP = REPO / "app"
J2 = "app/src/pages/journal-2-0/"

T_PHONE = "src/pages/journal-2-0/tabs/NotebookTab.phoneNote.test.jsx"
T_HEADER = "src/pages/journal-2-0/JournalLayout.compactHeader.test.jsx"
T_GALLERY = "src/pages/journal-2-0/components/notebook/TemplatePicker.gallery.test.jsx"
T_TAB = "src/pages/journal-2-0/tabs/NotebookTab.test.jsx"
T_TRAIL = "src/pages/journal-2-0/lib/noteReturnTrail.test.js"

# (id, file, regex, replacement, tests, what it breaks)
SETS = {
    "d1": [
        ("M1", J2 + "tabs/NotebookTab.jsx", r"data-note-open=\{noteId \? 'true' : undefined\}",
         "data-note-opened={noteId ? 'true' : undefined}", [T_PHONE],
         "the note-open marker is not on the box the phone rule targets"),
        ("M2", J2 + "tabs/NotebookTab.module.css", r"(\.wrap\[data-note-open\] \.sidebarSlot \{\r?\n\s*display: )none;",
         r"\1block;", [T_PHONE], "the phone rule no longer hides the folder panel"),
        # M3 (the note-id back) retired in fix round 1: the code it mutated is gone; R1-R5 replace it.
        ("M4", J2 + "tabs/NotebookTab.module.css", r"(\.phoneBack \{\r?\n\s*display: )none;",
         r"\1inline-flex;", [T_PHONE], "the back control shows at every width"),
        # M5 (a prefix match folds /journal/notebookx) retired in fix round 1: the predicate is now matchPath; R17 is its successor.
        ("M6", J2 + "JournalLayout.jsx", r'aria-controls="journal-header-tools"',
         'aria-controls="journal-tools"', [T_HEADER], "the disclosure names an element that does not exist"),
        ("M7", J2 + "JournalLayout.module.css", r"(:not\(\[data-tools-open\]\) \.headerTools \{\r?\n\s*display: )none;",
         r"\1contents;", [T_HEADER], "the phone fold hides nothing"),
        ("M8", J2 + "JournalLayout.module.css", r"(\.toolsToggle \{\r?\n\s*display: )none;",
         r"\1inline-flex;", [T_HEADER], "the disclosure shows at every width"),
        ("M9", J2 + "JournalMobileNav.module.css", r"flex: 1 0 auto;",
         "flex: 0 0 auto;", [T_HEADER], "the six tabs stop sharing the phone row"),
        ("M10", J2 + "JournalLayout.jsx", r"setToolsOpen\(\(x\) => !x\)",
         "setToolsOpen((x) => x)", [T_HEADER], "the disclosure never opens"),
    ],
    "d4": [
        ("G1", J2 + "components/notebook/TemplatePicker.jsx", r"templatesByFamily\(fam\.key\)\.map\(\(tpl\) => \{",
         "templatesByFamily(fam.key).slice(1).map((tpl) => {", [T_GALLERY], "the gallery drops a template per family"),
        ("G2", J2 + "components/notebook/TemplatePicker.jsx", r"const lines = templatePreview\(tpl\)",
         "const lines = templatePreview(templatesByFamily(fam.key)[0])", [T_GALLERY],
         "a card previews ANOTHER template's body"),
        ("G3", J2 + "lib/notebookTemplates.js", r"return \(tpl\.build\(\{\}\)\?\.content \|\| \[\]\)\.filter",
         "return [].filter", [T_GALLERY], "no card has a preview (retargeted in fix round 1: the preview reads templateStructure)"),
        ("G4", J2 + "components/notebook/TemplatePicker.jsx", r"onClick=\{\(\) => onPick\(tpl\)\}",
         "onClick={() => onPick(templatesByFamily(fam.key)[0])}", [T_GALLERY], "a card creates the wrong template's note"),
        ("G5", J2 + "components/notebook/TemplatePicker.jsx", r"onClick=\{\(\) => onPick\(tpl\)\}",
         "onClick={() => onPick({ ...tpl, tags: [] })}", [T_GALLERY, T_TAB],
         "the note made loses the template's preset tags"),
        ("G6", J2 + "components/notebook/TemplatePicker.jsx", r"ArrowRight: 1,", "ArrowRight: 0,", [T_GALLERY], "ArrowRight does not move"),
        ("G7", J2 + "components/notebook/TemplatePicker.jsx", r"else if \(e\.key === 'End'\) to = cards\[cards\.length - 1\]",
         "else if (e.key === 'End') to = cards[0]", [T_GALLERY], "End does not reach the last card"),
        ("G8", J2 + "components/notebook/TemplatePicker.jsx", r"data-template-key=\{tpl\.key\}",
         "data-template-key={tpl.key} tabIndex={-1}", [T_GALLERY], "the cards leave the Tab order"),
        ("G9", J2 + "components/notebook/TemplatePicker.jsx", r"aria-label=\{tpl\.label\}",
         "data-label={tpl.label}", [T_GALLERY], "a card is not named by its template's name"),
        ("G10", J2 + "lib/notebookTemplates.js", r"return TEMPLATES\.filter\(\(t\) => t\.family === familyKey\)",
         "return TEMPLATES.filter((t) => t.family !== familyKey + 'x')", [T_GALLERY], "every family lists every template"),
    ],
    # Fix round 1 (review wave10-D2-review.md): I-1, M-1..M-5.
    "r1": [
        ("R1", J2 + "lib/noteReturnTrail.js", r"return trail\.at \+ 1\r?\n",
         "return 1\n", [T_PHONE, T_TRAIL], "I-1: back goes ONE entry whatever was pushed inside the note (the note-id bug)"),
        ("R2", J2 + "lib/noteReturnTrail.js", r"    keys\[trail\.at\] = key\r?\n",
         "", [T_PHONE, T_TRAIL], "I-1: a replace inside the note is not followed (Ask citation strip)"),
        ("R3", J2 + "lib/noteReturnTrail.js", r"const keys = trail\.keys\.slice\(0, trail\.at \+ 1\)\.concat\(key\)\r?\n    return \{ keys, at: keys\.length - 1 \}",
         "return trail", [T_PHONE, T_TRAIL], "I-1: a same-note push is not followed"),
        ("R4", J2 + "lib/noteReturnTrail.js", r"if \(fromList\) return \{ keys: \[key\], at: 0 \}",
         "if (false) return { keys: [key], at: 0 }", [T_PHONE, T_TRAIL], "I-1: leaving a list starts no trail (list -> note -> back)"),
        ("R5", J2 + "tabs/NotebookTab.jsx", r"leavingListRef\.current = !noteId",
         "leavingListRef.current = false", [T_PHONE], "I-1: openNote never marks the entry it pushes"),
        ("R6", J2 + "JournalLayout.jsx", r"    setToolsPath\(pathname\)\r?\n    setToolsOpen\(false\)\r?\n",
         "    setToolsPath(pathname)\n", [T_HEADER], "M-1: the tools stay open across a route change"),
        ("R7", J2 + "lib/notebookTemplates.js", r"for \(const node of templateStructure\(tpl\)\)",
         "for (const node of (tpl.build({})?.content || []))", [T_GALLERY], "M-2: the preview reads the no-data branch"),
        ("R8", J2 + "lib/notebookTemplates.js", r"  regimeLine: `\$\{MARK\}regime`,\r?\n",
         "", [T_GALLERY], "M-2: the probe misses a field a template reads"),
        ("R9", J2 + "components/notebook/TemplatePicker.jsx", r'aria-hidden="true" data-template-preview=""',
         'data-template-preview=""', [T_GALLERY], "M-3: the preview is read aloud"),
        ("R10", J2 + "components/notebook/TemplatePicker.jsx", r"aria-describedby=\{`\$\{id\}-when \$\{id\}-desc`\}",
         "aria-describedby={`${id}-desc`}", [T_GALLERY], "M-3: the when line no longer describes the card"),
        ("R11", J2 + "components/notebook/TemplatePicker.jsx", r"\.filter\(\(c\) => !c\.disabled\)",
         "", [T_GALLERY], "M-4: the arrows land on disabled cards"),
        ("R12", J2 + "lib/compactHeaderRoute.js", r"caseSensitive: false",
         "caseSensitive: true", [T_HEADER], "M-5: /Journal/Notebook renders unfolded"),
        ("R13", J2 + "lib/compactHeaderRoute.js", r"end: false",
         "end: true", [T_HEADER], "M-5: the Ticker Research page does not fold"),
        # R14 RETIRED in fix round 2: it targeted `<Route path={NOTEBOOK_SEGMENT} `, which no
        # longer exists -- App.jsx keeps its LITERAL routes (manifest/Support rails read them).
        # The inverted tie rail is mutation-proved by set "r2" (F1-F4) below.
        ("R15", J2 + "JournalLayout.jsx", r"\{ to: NOTEBOOK_PATH, label: 'Notebook'",
         "{ to: '/journal/notebook', label: 'Notebook'", [T_HEADER], "M-5: PRIMARY_NAV restates the route"),
        ("R16", J2 + "JournalMobileNav.jsx", r"\{ to: NOTEBOOK_PATH, label: 'Notebook'",
         "{ to: '/journal/notebooks', label: 'Notebook'", [T_HEADER], "M-5: the phone strip links somewhere the fold does not key on"),
        ("R17", J2 + "lib/compactHeaderRoute.js", r"return matchPath\(\{ path: NOTEBOOK_PATH, caseSensitive: false, end: false \}, pathname \|\| ''\) !== null",
         "return (pathname || '').toLowerCase().startsWith(NOTEBOOK_PATH)", [T_HEADER], "M-5: a prefix match folds a sibling route (/journal/notebookx)"),
    ],
    # Fix round 2: App.jsx keeps LITERAL Notebook routes; the tie rail asserts they EQUAL the
    # journalRoutes constants. Moving either side alone must turn it red.
    "r2": [
        ("F1", "app/src/App.jsx", r'<Route path="notebook" element=\{<NotebookSurface />\} />',
         '<Route path="notebooks" element={<NotebookSurface />} />', [T_HEADER],
         "R2: App.jsx's Notebook literal drifts from NOTEBOOK_SEGMENT"),
        ("F2", "app/src/App.jsx", r'<Route path="notebook/research/:symbol" element=\{<TickerResearchSurface />\} />',
         '<Route path="notebook/research/:ticker" element={<TickerResearchSurface />} />', [T_HEADER],
         "R2: App.jsx's research literal drifts from NOTEBOOK_RESEARCH_SEGMENT"),
        ("F3", J2 + "lib/journalRoutes.js", r"export const NOTEBOOK_SEGMENT = 'notebook'",
         "export const NOTEBOOK_SEGMENT = 'notebooks'", [T_HEADER],
         "R2: the constant drifts from App.jsx's literal"),
        ("F4", J2 + "lib/journalRoutes.js", r"/research/:symbol`",
         "/research/:ticker`", [T_HEADER],
         "R2: the research constant drifts from App.jsx's literal"),
    ],
}


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def committed(path: str) -> bytes:
    return subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", f"HEAD:{path}"],
                          capture_output=True, check=True).stdout


def same_as_head(b: bytes, path: str) -> bool:
    """The working file equals the committed blob once line endings are set aside
    (core.autocrlf=true here: the blob is LF, the checkout CRLF)."""
    crlf, lf = bytes([13, 10]), bytes([10])
    return b.replace(crlf, lf) == committed(path).replace(crlf, lf)


def run_tests(tests: list[str]) -> tuple[int, str]:
    npx = "npx.cmd" if sys.platform == "win32" else "npx"
    p = subprocess.run([npx, "vitest", "run", *tests, "--maxWorkers=2"], cwd=str(APP),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = p.stdout + p.stderr
    totals = [ln.strip() for ln in re.sub(r"\x1b\[[0-9;]*m", "", out).splitlines()
              if ln.strip().startswith(("Test Files", "Tests "))]
    return p.returncode, " | ".join(totals) if totals else "NO TOTALS LINE"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--set", required=True, choices=sorted(SETS))
    ap.add_argument("--log", required=True)
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()
    lines = []
    ok = True
    muts = SETS[a.set]
    for mid, path, pat, rep, tests, what in muts:
        if a.only and mid not in a.only:
            continue
        f = REPO / path
        orig = f.read_bytes()
        if not same_as_head(orig, path):
            lines.append(f"{mid} REFUSED: {path} differs from HEAD before mutation")
            ok = False
            continue
        text = orig.decode("utf-8")
        new, n = re.subn(pat, rep, text)
        if n != 1:
            lines.append(f"{mid} INVALID: pattern matched {n} times in {path}")
            ok = False
            continue
        try:
            f.write_bytes(new.encode("utf-8"))
            rc, totals = run_tests(tests)
        finally:
            f.write_bytes(orig)
        back = f.read_bytes()
        restored = sha(back) == sha(orig) and same_as_head(back, path)
        verdict = "RED" if rc != 0 else "SURVIVED"
        if rc == 0 or not restored:
            ok = False
        lines.append(f"{mid} {verdict} rc={rc} [{what}] {path} :: {totals} :: restored sha {sha(back)[:12]} "
                     f"== capture == HEAD: {restored}")
        print(lines[-1], flush=True)
    # control: the unmutated tree is green on the same tests
    all_tests = sorted({t for m in muts for t in m[4] if not a.only or m[0] in a.only})
    rc, totals = run_tests(all_tests)
    lines.append(f"CONTROL unmutated tree rc={rc} :: {totals}")
    print(lines[-1], flush=True)
    if rc != 0:
        ok = False
    Path(a.log).write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
