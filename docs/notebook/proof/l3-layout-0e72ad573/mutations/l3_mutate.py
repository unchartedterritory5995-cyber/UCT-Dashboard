"""L3 mutation harness: capture bytes, apply one regex (must match once), run the rail,
restore the captured bytes, verify the restore by sha256 AND against the committed blob
(CR-normalised; the checkout is CRLF, the blob LF). Never git checkout.

Usage: python l3_mutate.py <all|M1,M2,...> [rail]"""
import hashlib, re, subprocess, sys, json, pathlib

APP = pathlib.Path(r"C:/Users/Patrick/uct-worktrees/notebook-w10s2/app")
REPO = APP.parent
NB = APP / "src/pages/journal-2-0/components/notebook"
RAIL = sys.argv[2] if len(sys.argv) > 2 else "src/pages/journal-2-0/a11y/targetFloors.test.js"
NL = "<NL>"  # newline placeholder, resolved per file
MUTS = {
    "M1-timeline-floor-removed": (NB / "NoteTimelineView.module.css",
                                  r"\.chip \{<NL>  min-height: 24px;<NL>\}<NL>", ""),
    "M2-timeline-floor-after-touch": (NB / "NoteTimelineView.module.css",
                                      r"\.chip \{<NL>  min-height: 24px;<NL>\}<NL>(?P<rest>[\s\S]*)\Z",
                                      r"\g<rest>.chip {<NL>  min-height: 24px;<NL>}<NL>"),
    "M3-tag-remove-20": (NB / "NoteTagsField.module.css",
                         r"  width: 24px;<NL>  height: 24px;<NL>", "  width: 20px;<NL>  height: 20px;<NL>"),
    "M4-calendar-floor-removed": (NB / "NoteCalendarView.module.css",
                                  r"  min-height: 24px;<NL>  cursor: pointer;", "  cursor: pointer;"),
    # fix round 1
    "M5-calendar-touch-floor-removed": (NB / "NoteCalendarView.module.css",
                                        r"  \.chip \{<NL>    min-height: var\(--tap-min\);<NL>  \}<NL>", ""),
    "M6-fab-clearance-removed": (NB / "NoteEditorPage.module.css",
                                 r"  \.toolbarRow \{ padding-left: 60px; \}<NL>", ""),
    "M7-fab-clearance-all-widths": (NB / "NoteEditorPage.module.css",
                                    r"  \.toolbarRow \{ padding-left: 60px; \}<NL>(?P<rest>[\s\S]*)\Z",
                                    r"\g<rest>.toolbarRow { padding-left: 60px; }<NL>"),
    "M8-fab-moved": (APP / "src/pages/journal-2-0/JournalLayout.module.css",
                     r"position: fixed;<NL>    left: 14px;", "position: fixed;<NL>    left: 20px;"),
}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def run():
    p = subprocess.run(f"npx vitest run {RAIL} --maxWorkers=2", cwd=APP, shell=True,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = re.sub(r"\x1b\[[0-9;]*m", "", p.stdout + p.stderr)
    tot = [l.strip() for l in out.splitlines() if l.strip().startswith("Tests ")]
    return p.returncode, (tot[-1] if tot else "NO TOTALS LINE")


def committed(path):
    rel = path.relative_to(REPO).as_posix()
    return subprocess.run(["git", "-C", str(REPO), "cat-file", "blob", f"HEAD:{rel}"],
                          capture_output=True).stdout


which = list(MUTS) if len(sys.argv) < 2 or sys.argv[1] == "all" else sys.argv[1].split(",")
for name in which:
    path, pat, rep = MUTS[name]
    orig = path.read_bytes()
    h0 = sha(orig)
    text = orig.decode("utf-8")
    nl = "\r\n" if "\r\n" in text else "\n"
    pat_re = pat.replace(NL, r"\r?\n")
    rep_s = rep.replace(NL, nl.replace("\\", "\\\\"))
    n = len(re.findall(pat_re, text))
    if n != 1:
        print(json.dumps({"mutation": name, "result": f"INVALID ({n} matches)"}), flush=True)
        continue
    path.write_bytes(re.sub(pat_re, rep_s, text, count=1).encode("utf-8"))
    try:
        rc, tot = run()
    finally:
        path.write_bytes(orig)
    back = path.read_bytes()
    print(json.dumps({"mutation": name, "file": path.name, "rc": rc, "totals": tot,
                      "verdict": "RED" if rc != 0 else "SURVIVED",
                      "restored_sha_ok": sha(back) == h0,
                      "restored_equals_committed": back.replace(b"\r\n", b"\n") == committed(path)}), flush=True)
rc, tot = run()
print(json.dumps({"control_all_restored": {"rc": rc, "totals": tot}}), flush=True)
