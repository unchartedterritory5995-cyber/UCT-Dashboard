"""Lane F5 mutation proofs: each mutation must turn its rail RED; bytes restored and verified.

Usage: python f5_mutate.py [id ...]   (no ids = all)
"""
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

WT = Path(r"C:\Users\Patrick\uct-worktrees\notebook-w10s2")
APP = WT / "app"
J2 = "src/pages/journal-2-0"
NB = f"{J2}/components/notebook"

M = [
    ("M1-stage-ignored", "src/components/voice/FloatingOrb.jsx",
     "const coachmarkOn = showCoachmark && Boolean(firstRunSlot) && !firstRunStageHeld",
     "const coachmarkOn = showCoachmark && Boolean(firstRunSlot)",
     "src/components/voice/FloatingOrb.coachmark.test.jsx"),
    ("M2-portal-to-body", "src/components/voice/FloatingOrb.jsx",
     "createPortal(<OrbCoachmark onDismiss={dismissCoachmark} />, firstRunSlot)",
     "createPortal(<OrbCoachmark onDismiss={dismissCoachmark} />, document.body)",
     "src/components/voice/FloatingOrb.coachmark.test.jsx"),
    ("M3-tour-no-claim", f"{NB}/onboarding/NotebookTour.jsx",
     "  useEffect(() => (tourOpen ? claimFirstRunStage() : undefined), [tourOpen])\n",
     "\n",
     f"{NB}/onboarding/NotebookTour.stage.test.jsx"),
    ("M4-layout-no-slot", "src/components/Layout.jsx",
     '<div ref={registerFirstRunSlot} data-first-run-slot="" />',
     "{null}",
     "src/components/Layout.firstRunSlot.test.jsx"),
    ("M5-hint-absolute", f"{J2}/components/VoiceInputButton.jsx",
     "position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 4,",
     "position: 'absolute', display: 'flex', alignItems: 'flex-start', gap: 4,",
     f"{J2}/components/VoiceInputButton.hintInFlow.test.jsx"),
    ("M6-editor-no-opt-in", f"{NB}/NoteEditorPage.jsx",
     "disabled={!editor.isEditable} holdOnFailure hintInFlow />",
     "disabled={!editor.isEditable} holdOnFailure />",
     f"{J2}/components/VoiceInputButton.hintInFlow.test.jsx"),
    ("M7-search-overlap", f"{NB}/FolderSidebar.module.css",
     "  right: 34px;\n  width: 24px;\n  height: 24px;\n",
     "  right: 6px;\n  width: 24px;\n  height: 24px;\n",
     f"{J2}/a11y/targetFloors.test.js"),
    ("M8-toggle-22", f"{NB}/FolderSidebar.module.css",
     "  right: 6px;\n  width: 24px;\n  height: 24px;\n  display: inline-flex;",
     "  right: 6px;\n  width: 22px;\n  height: 22px;\n  display: inline-flex;",
     f"{J2}/a11y/targetFloors.test.js"),
    ("M9-floor-unscoped", f"{NB}/NoteEditorPage.module.css",
     "@media (min-width: 1025px) {\n  .toolbarRow .toolBtn { min-height: 24px; min-width: 24px; }\n}\n",
     ".toolbarRow .toolBtn { min-height: 24px; min-width: 24px; }\n",
     f"{J2}/a11y/targetFloors.test.js"),
    ("M10-checkbox-16", f"{NB}/NoteCard.module.css",
     "  .selectBox input {\n    width: 24px;\n    height: 24px;\n  }\n",
     "",
     f"{J2}/a11y/targetFloors.test.js"),
    ("M11-switcher-nowrap", f"{J2}/tabs/NotebookTab.module.css",
     "  flex-wrap: wrap;\n  max-width: 100%;\n  border: 1px solid var(--border);",
     "  border: 1px solid var(--border);",
     f"{J2}/tabs/NotebookTab.viewSwitcherFits.test.js"),
    ("M12-hint-opacity", f"{NB}/CaptureDialog.module.css",
     ".hint { margin: 4px 0 0; font-size: 11px; color: var(--text-muted); }",
     ".hint { margin: 4px 0 0; font-size: 11px; opacity: 0.6; }",
     f"{NB}/CaptureDialog.hintContrast.test.js"),
    ("M13-region-untabbable", f"{NB}/PdfDocumentViewer.jsx",
     "      tabIndex={0}\n      role=\"region\"",
     "      role=\"region\"",
     f"{NB}/PdfDocumentViewer.scrollRegion.test.jsx"),
    ("M14-icon-floor", f"{NB}/FolderSidebar.module.css",
     "  min-width: 24px;\n  min-height: 24px;\n  color: var(--text-muted);\n  cursor: pointer;\n  border-radius: 3px;",
     "  color: var(--text-muted);\n  cursor: pointer;\n  border-radius: 3px;",
     f"{J2}/a11y/targetFloors.test.js"),
    ("M15-board-not-contained", f"{NB}/NoteBoardView.module.css",
     "  position: relative;\n  scrollbar-width: thin;",
     "  scrollbar-width: thin;",
     f"{NB}/NoteBoardView.scrollsAlone.test.js"),
    ("M16-board-no-affordance", f"{NB}/NoteBoardView.module.css",
     "  scrollbar-width: thin;\n  scrollbar-color: var(--text-muted) transparent;\n",
     "",
     f"{NB}/NoteBoardView.scrollsAlone.test.js"),
    ("M17-store-release-counts", "src/components/firstRun/firstRunStage.js",
     "    if (!holders.delete(token)) return\n    emit()",
     "    const first = holders.values().next().value\n    holders.delete(first)\n    emit()",
     "src/components/firstRun/firstRunStage.test.jsx"),
    ("M18-store-silent-claim", "src/components/firstRun/firstRunStage.js",
     "  holders.add(token)\n  emit()",
     "  holders.add(token)",
     "src/components/firstRun/firstRunStage.test.jsx"),
    ("M19-card-under-help", "src/components/voice/FloatingOrb.module.css",
     "  .coachmark { margin-right: 48px; }",
     "  .coachmark { margin-right: 20px; }",
     "src/components/voice/FloatingOrb.coachmark.test.jsx"),
    ("M20-faint-thumb", f"{NB}/NoteBoardView.module.css",
     "  scrollbar-color: var(--text-muted) transparent;",
     "  scrollbar-color: var(--border) transparent;",
     f"{NB}/NoteBoardView.scrollsAlone.test.js"),
    # ---- F5 fix round 1 ----
    ('M21-sheet-keeps-card', 'src/components/voice/FloatingOrb.jsx', '  if (scrollLocked && !inSession) return null\n', '  if (scrollLocked && !inSession) return <>{null}{coachmarkPortal}</>\n', 'src/components/voice/FloatingOrb.coachmark.test.jsx'),
    ('M22-audio-keeps-card', 'src/components/voice/FloatingOrb.jsx', "  if (voice.mode === 'a' && voice.status === 'playing') return null\n", "  if (voice.mode === 'a' && voice.status === 'playing') return <>{null}{coachmarkPortal}</>\n", 'src/components/voice/FloatingOrb.coachmark.test.jsx'),
    ('M23-sheet-dismisses', 'src/components/voice/FloatingOrb.jsx', '  const coachmarkUp = coachmarkOn && !inSessionLive && !minimized\n', '  const coachmarkUp = coachmarkOn && !inSessionLive && !minimized\n  useEffect(() => { if (scrollLocked && showCoachmark) dismissCoachmark() }, [scrollLocked, showCoachmark, dismissCoachmark])\n', 'src/components/voice/FloatingOrb.coachmark.test.jsx'),
    ('M24-audio-dismisses', 'src/components/voice/FloatingOrb.jsx', '  const coachmarkUp = coachmarkOn && !inSessionLive && !minimized\n', "  const coachmarkUp = coachmarkOn && !inSessionLive && !minimized\n  const _playing = voice.mode === 'a' && voice.status === 'playing'\n  useEffect(() => { if (_playing && showCoachmark) dismissCoachmark() }, [_playing, showCoachmark, dismissCoachmark])\n", 'src/components/voice/FloatingOrb.coachmark.test.jsx'),
    ('M25-tuck-with-card', 'src/components/voice/FloatingOrb.jsx', ' && !dragging && !hovered && !coachmarkUp\n', ' && !dragging && !hovered\n', 'src/components/voice/FloatingOrb.coachmark.test.jsx'),
    ('M26-slot-rule-removed', 'src/components/voice/FloatingOrb.module.css', ':global(html[data-mobile-chart-shell] [data-first-run-slot]) { display: none; }\n', '\n', 'src/components/voice/FloatingOrb.chartShellSlot.test.js'),
    ('M27-slot-rule-phone-only', 'src/components/voice/FloatingOrb.module.css', ':global(html[data-mobile-chart-shell] [data-first-run-slot]) { display: none; }\n', '@media (max-width: 640px) {\n  :global(html[data-mobile-chart-shell] [data-first-run-slot]) { display: none; }\n}\n', 'src/components/voice/FloatingOrb.chartShellSlot.test.js'),
    ('M28-slot-rule-wrong-attr', 'src/components/voice/FloatingOrb.module.css', ':global(html[data-mobile-chart-shell] [data-first-run-slot]) { display: none; }\n', ':global(html[data-mobile-chart-shell] [data-first-run]) { display: none; }\n', 'src/components/voice/FloatingOrb.chartShellSlot.test.js'),
]


def sha(b):
    return hashlib.sha256(b).hexdigest()


def run_one(mid, rel, old, new, test):
    p = APP / rel
    raw = p.read_bytes()
    crlf = b"\r\n" in raw
    text = raw.decode("utf-8").replace("\r\n", "\n")
    n = text.count(old)
    if n != 1:
        return {"id": mid, "error": f"anchor found {n} times in {rel}"}
    mutated = text.replace(old, new)
    if crlf:
        mutated = mutated.replace("\n", "\r\n")
    before = sha(raw)
    try:
        p.write_bytes(mutated.encode("utf-8"))
        r = subprocess.run(["npx.cmd", "vitest", "run", test], cwd=APP, capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=600)
        out = r.stdout + r.stderr
        tot = [ln for ln in out.splitlines() if re.search(r"\bTests\b", ln) and ("passed" in ln or "failed" in ln)]
        return {"id": mid, "file": rel, "test": test, "exit": r.returncode,
                "totals": re.sub(r"\x1b\[[0-9;]*m", "", tot[-1]).strip() if tot else None, "red": r.returncode != 0 and bool(tot)}
    finally:
        p.write_bytes(raw)
        after = sha(p.read_bytes())
        assert after == before, f"RESTORE FAILED for {rel}"


if __name__ == "__main__":
    ids = set(sys.argv[1:])
    results = []
    for m in M:
        if ids and m[0] not in ids:
            continue
        res = run_one(*m)
        print(json.dumps(res), flush=True)
        results.append(res)
    bad = [r for r in results if not r.get("red")]
    print("ALL RED" if not bad else f"NOT RED: {[r['id'] for r in bad]}")
    sys.exit(0 if not bad else 1)
