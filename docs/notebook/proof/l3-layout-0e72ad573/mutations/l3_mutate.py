"""L3 mutation harness: capture bytes, apply one regex (must match once), run the rail,
restore the captured bytes, verify the restore by sha256. Never git checkout."""
import hashlib, re, subprocess, sys, json, pathlib

APP = pathlib.Path(r"C:/Users/Patrick/uct-worktrees/notebook-w10s2/app")
NB = APP / "src/pages/journal-2-0/components/notebook"
RAIL = sys.argv[2] if len(sys.argv) > 2 else "src/pages/journal-2-0/a11y/targetFloors.test.js"
NL = "<NL>"  # newline placeholder, resolved per file (the checkout is CRLF, the blob LF)
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
}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def run():
    p = subprocess.run(f"npx vitest run {RAIL} --maxWorkers=2", cwd=APP, shell=True,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = re.sub(r"\x1b\[[0-9;]*m", "", p.stdout + p.stderr)
    tot = [l.strip() for l in out.splitlines() if l.strip().startswith("Tests ")]
    return p.returncode, (tot[-1] if tot else "NO TOTALS LINE")


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
    print(json.dumps({"mutation": name, "file": path.name, "rc": rc, "totals": tot,
                      "verdict": "RED" if rc != 0 else "SURVIVED",
                      "restored_sha_ok": sha(path.read_bytes()) == h0}), flush=True)
rc, tot = run()
print(json.dumps({"control_all_restored": {"rc": rc, "totals": tot}}), flush=True)
