"""Lane D3P mutation harness (the L3 recipe): capture a file's bytes, apply ONE regex (it must
match exactly once, or the mutation is INVALID and nothing is written), run the rails, write the
captured bytes back, and verify the restore two ways -- by sha256 against the capture AND against
the committed blob (CR-normalised: the checkout is CRLF, the blob LF). Never `git checkout`.

The rails are the D3P files: the rendered toolbar, the structural one, and (round 2) the
rendered first-run deferral through the real editor, orb and mic.

    python d3p_mutate.py all            # every mutation, then a control run with all restored
    python d3p_mutate.py M1,M4          # a subset
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[4]
APP = REPO / "app"
NB = APP / "src/pages/journal-2-0/components/notebook"
RAILS = ("src/pages/journal-2-0/components/notebook/NoteEditorPage.phoneFormat.test.jsx "
         "src/pages/journal-2-0/a11y/targetFloors.test.js "
         "src/pages/journal-2-0/components/notebook/NoteEditorPage.firstRunDefer.test.jsx")
EDITOR = NB / "NoteEditorPage.jsx"
CSS = NB / "NoteEditorPage.module.css"
MORE = NB / "NoteMoreMenu.module.css"
JOURNAL = APP / "src/pages/journal-2-0/JournalLayout.module.css"
HUB = APP / "src/hub/constants.js"
MIC = APP / "src/pages/journal-2-0/components/VoiceInputButton.jsx"
NL = "<NL>"   # a newline, resolved to the file's own ending

MUTS = {
    # ── the phone toolbar (CSS) ──
    "M1-collapse-rule-removed": (CSS, r"  \.toolbarRow:not\(\[data-format-open\]\) \.formatRun \{ display: none; \}<NL>", ""),
    "M2-collapse-rule-at-every-width": (CSS, r"(?P<base>\.formatRun \{ display: contents; \}<NL>)",
                                        r"\g<base>.toolbarRow:not([data-format-open]) .formatRun { display: none; }<NL>"),
    "M3-toggle-shown-at-every-width": (CSS, r"\.formatToggle \{ display: none; \}", ".formatToggle { display: inline-flex; }"),
    # ── the phone toolbar (DOM) ──
    "M4-bullet-list-moved-into-a-run": (EDITOR,
        r"(label=\"H2\"<NL>            />)<NL>            </span>(?P<list><NL>            <ToolButton<NL>              active=\{editor\.isActive\('bulletList'\)\}[\s\S]*?label=\"• List\"<NL>            />)",
        r"\1\g<list><NL>            </span>"),
    "M5-font-run-unwrapped": (EDITOR,
        r"<span className=\{styles\.formatRun\} id=\{`\$\{formatRunId\}-a`\} data-format-run=\"\"><NL>(?P<body>            <select<NL>              className=\{styles\.fontSelect\}[\s\S]*?</select><NL>)            </span><NL>",
        r"\g<body>"),
    "M6-no-focus-in-on-open": (EDITOR, r"    if \(formatOpen\) firstFormatControl\(\)\?\.focus\?\.\(\)<NL>", ""),
    "M7-no-keyboard-contract": (EDITOR, r"          \{\.\.\.\(formatOpen \? formatDisclosureProps : \{\}\)\}<NL>", ""),
    "M8-desktop-order-changed": (EDITOR,
        r"(?P<font><select<NL>              className=\{styles\.fontSelect\}[\s\S]*?</select>)(?P<gap><NL>            )(?P<size><select<NL>              className=\{styles\.fontSizeSelect\}[\s\S]*?</select>)",
        r"\g<size>\g<gap>\g<font>"),
    # the mic ruling: move the last run's opening tag up above the mic, so the mic goes behind
    # Format while the run count, the order and every other control stay exactly as they are
    "M13-mic-moved-into-a-run": (EDITOR,
        r"(?P<close>            </span><NL>)(?P<mic>            \{/\* Wave 7 lane H1: dictation[\s\S]*?</Suspense><NL>            \)\}<NL>)(?P<rest>[\s\S]*?)(?P<open>            <span className=\{styles\.formatRun\} id=\{`\$\{formatRunId\}-d`\} data-format-run=\"\"><NL>)",
        r"\g<close>\g<open>\g<mic>\g<rest>"),
    # ── the More panel (N-3) ──
    "M9-panel-bottom-inside-the-band": (MORE, r"bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 160px\);",
                                        "bottom: calc(env(safe-area-inset-bottom, 0px) + 120px);"),
    "M10-panel-not-pinned": (MORE, r"  \.panel \{<NL>    position: fixed;<NL>", "  .panel {<NL>"),
    "M11-log-fab-moves-up": (JOURNAL, r"bottom: calc\(70px \+ env\(safe-area-inset-bottom, 0px\)\);",
                             "bottom: calc(130px + env(safe-area-inset-bottom, 0px));"),
    "M12-hub-pad-grows": (HUB, r"export const PAD_PX = 84", "export const PAD_PX = 100"),
    # ── fix round 1 ──
    # M-5: locking the note no longer closes the disclosure, so unlock brings it back expanded
    "M14-no-reset-on-lock": (EDITOR, r"    if \(locked\) setFormatOpen\(false\)<NL>", ""),
    # M-4a: the close-on-widen effect deleted outright
    "M15-no-close-on-widen": (EDITOR,
        r"  useEffect\(\(\) => \{<NL>    if \(!formatOpen \|\| typeof window === 'undefined'[\s\S]*?\}, \[formatOpen\]\)<NL>", ""),
    # M-4c: a sign flipped. The cap ADDS its offset back; the panel's bottom is subtracted.
    "M16-cap-sign-flipped": (MORE, r"(?P<head>max-height: calc\(100dvh[^;]*?)- 168px\);", r"\g<head>+ 168px);"),
    "M17-panel-bottom-sign-flipped": (MORE, r"bottom: calc\(env\(safe-area-inset-bottom, 0px\) \+ 160px\);",
                                      "bottom: calc(env(safe-area-inset-bottom, 0px) - 160px);"),
    # ── round 2: the phone editor defers the first-run card and hint ──
    # (i) the phone gate removed: the editor never defers
    "M18-no-phone-gate": (EDITOR, r"const deferFirstRun = useIsPhone\(\)", "const deferFirstRun = false"),
    # (ii) the gate applied at every width
    "M19-gate-at-every-width": (EDITOR, r"const deferFirstRun = useIsPhone\(\)", "const deferFirstRun = true"),
    # (iii) deferral writes "seen": the coach flag on the editor side, the hint flag in the mic
    "M20-deferral-marks-coach-seen": (EDITOR,
        r"  useEffect\(\(\) => \(deferFirstRun \? claimFirstRunStage\(\) : undefined\), \[deferFirstRun\]\)",
        "  useEffect(() => { if (!deferFirstRun) return undefined; try { localStorage.setItem('voice.orb.coachmarkSeen', '1') } catch { /* noop */ } return claimFirstRunStage() }, [deferFirstRun])"),
    "M21-deferral-marks-hint-seen": (MIC, r"(?P<line>  const hintVisible = showHint && !recording && !uploading && !hintDeferred<NL>)",
                                     r"  if (hintDeferred && showHint) markHintSeen()<NL>\g<line>"),
    # the editor stops telling its mic to wait; the mic stops listening to it
    "M22-hint-prop-not-passed": (EDITOR, r" hintDeferred=\{deferFirstRun\}", ""),
    "M23-mic-ignores-hintDeferred": (MIC, r" && !hintDeferred<NL>", "<NL>"),
}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def run():
    p = subprocess.run(f"npx vitest run {RAILS} --maxWorkers=2", cwd=APP, shell=True,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = re.sub(r"\x1b\[[0-9;]*m", "", p.stdout + p.stderr)
    tot = [l.strip() for l in out.splitlines() if l.strip().startswith("Tests ")]
    failed = sorted({l.strip()[:160] for l in out.splitlines() if l.strip().startswith(("×", "FAIL"))})[:8]
    return p.returncode, (tot[-1] if tot else "NO TOTALS LINE"), failed


def committed(path):
    rel = path.relative_to(REPO).as_posix()
    return subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", f"HEAD:{rel}"],
                          capture_output=True).stdout


args = [a for a in sys.argv[1:] if not a.startswith("--")]
DRY = "--dry" in sys.argv   # match counts only: nothing is written and nothing is run
which = list(MUTS) if not args or args[0] == "all" else \
    [k for k in MUTS if any(k.startswith(s + "-") or k == s for s in args[0].split(","))]
for name in which:
    path, pat, rep = MUTS[name]
    orig = path.read_bytes()
    h0 = sha(orig)
    text = orig.decode("utf-8")
    nl = "\r\n" if "\r\n" in text else "\n"
    pat_re = pat.replace(NL, r"\r?\n")
    rep_s = rep.replace(NL, nl.replace("\\", "\\\\"))
    n = len(re.findall(pat_re, text))
    if DRY:
        print(json.dumps({"mutation": name, "matches": n}), flush=True)
        continue
    if n != 1:
        print(json.dumps({"mutation": name, "result": f"INVALID ({n} matches)"}), flush=True)
        continue
    path.write_bytes(re.sub(pat_re, rep_s, text, count=1).encode("utf-8"))
    try:
        rc, tot, failed = run()
    finally:
        path.write_bytes(orig)
    back = path.read_bytes()
    print(json.dumps({"mutation": name, "file": path.name, "rc": rc, "totals": tot,
                      "verdict": "RED" if rc != 0 else "SURVIVED", "failed": failed,
                      "restored_sha_ok": sha(back) == h0,
                      "restored_equals_committed": back.replace(b"\r\n", b"\n") == committed(path)},
                     ensure_ascii=False), flush=True)
if DRY:
    sys.exit(0)
rc, tot, failed = run()
print(json.dumps({"control_all_restored": {"rc": rc, "totals": tot, "failed": failed}}, ensure_ascii=False), flush=True)
