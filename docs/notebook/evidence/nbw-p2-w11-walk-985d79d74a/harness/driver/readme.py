"""Builds the evidence README.md from the raw walk.json (written AFTER the raw evidence; a description, not a verdict
source). Usage: python readme.py <evidence dir>"""
import json, sys, os
from pathlib import Path

EVD = Path(sys.argv[1])
w = json.loads((EVD / "walk.json").read_text(encoding="utf-8"))
steps = w["steps"]
ORDER = ["W11.0", "W11.1", "W11.2", "W11.3", "W11.4", "W11.5", "W11.6", "W11.7", "W11.8", "W11.9", "W11.10", "W11.11",
         "W11.12", "W11.13", "W11.14", "W11.15", "W11.16", "W11.17", "FDEF", "FDEF2", "R1", "PUTPROBE"]
VPS = ["1200", "820", "390"]
L = []
L.append("# Task 11.20 browser walk, nbw-p2-impl `985d79d74a` (R-RAW)\n")
L.append("Raw evidence of the hand-driven Playwright walk of `walk-11-20-plan.md` (ledger "
         "`.superpowers/sdd/2026-10-24-notebook-widgets-p2-w11/`). `walk.json` and `steps/*.json` were written by the walker "
         "after every step, before this file. Verdicts are the walker's own (`ev.py`): FAIL = any failed check or any "
         "axe serious/critical, overflow, touch-tier tap-floor, or raw `{{block:` finding; console/HTTP events are listed "
         "but do not by themselves fail a step. INCONCLUSIVE is never a pass.\n")
L.append("## Build and sandbox\n")
L.append("- Tip under test: `985d79d74a90a21c9c0caa4f1f9d67fdc75e3633` (feat/notebook-widgets-p2), frozen; `app/dist/index.html` "
         "mtime 2026-10-27 02:29:46 -05:00, after the tip's commit time 02:24:23 -05:00. Re-checked before the commit.")
L.append("- Sandbox: recipe B (never C:\\data): `seed_members.py --seed 20261024 --schema-via-clock-launcher` into "
         "`<scratchpad>\\sbx\\walk`, members P01 P04 P08 P25 P28 P29 P35 P36 P40 P45 (plan §1) plus P14 and P46 (the F-DEF-1 "
         "D-W11-001 retest personas). `seed-walk.log`.")
L.append("- Every boot: `sandbox_clock.py` (the SAFE launcher) through `boot_sandbox.py` (in this folder), which applies "
         "`run_campaign.campaign_env(campaign_flag_sets(fw), overrides)` as the process environment (hermetic, review I6) "
         "and arms the walk's `lockwatch` instrumentation (harness only, no product code): every sqlite3 connection is "
         "wrapped; a write transaction or statement held > 2 s, and every SQLITE_BUSY/LOCKED error, prints the holder's db, "
         "thread, live stack and the in-flight HTTP requests into the boot's stdout log.")
L.append("- Files: `walk.json`, `steps/<vp>-<step>.json`, `<vp>/<step>-<surface>.png` (viewport-size), `logs/boot-<mode>.{out,err}.log` + `.identity.json` (each server's own stdout/stderr, kept whole), `logs/walker-<mode>.txt` (the walker's console), `logs/seed-walk.log`, `harness/` (the boot helper, `sbx.ps1` and the walk driver, scratchpad copies).")
L.append("- ON / W11OFF / ON-again on 127.0.0.1:8151; every clock instant on 127.0.0.1:8161. One server at a time on the "
         "data dir; each stopped by its recorded PID only.\n")
L.append("| Boot | PID | instant (identity `clock_shift.instant`) | now ET | identity nonce | logs |")
L.append("|---|---|---|---|---|---|")
seen = set()
for bt in w["boots"]:
    k = (bt["pid"], bt["identity_nonce"])
    if k in seen:
        continue
    seen.add(k)
    L.append(f"| {bt['mode'].split('+')[-1]} | {bt['pid']} | `{bt['instant']}` | `{bt['now_et']}` | `{bt['identity_nonce']}` | {', '.join('`logs/' + x.replace('walk-', 'boot-', 1) + '`' for x in bt['logs'])} |")
fl = next((b["flags"] for b in w["boots"] if b.get("flags")), "")
L.append(f"\nFlags served (ON; W11OFF adds `NOTEBOOK_WIDGETS_W11_ENABLED=0`): `{fl}`\n")
L.append("## Step x viewport\n")
L.append("| Step | 1200 | 820 | 390 |")
L.append("|---|---|---|---|")
for s in ORDER:
    cells = []
    for vp in VPS:
        d = steps.get(f"{vp}-{s}")
        cells.append(f"[{d['verdict']}](steps/{vp}-{s.replace('.', '_')}.json)" if d else "-")
    L.append(f"| {s} | " + " | ".join(cells) + " |")
L.append("\n## Defects recorded by the walker\n")
for i, d in enumerate(w["defects"], 1):
    L.append(f"{i}. **{d['severity']}** {d['viewport']} {d['step']}: `{d['selector']}`. Expected: {d['expected']}. Saw: {d['saw']}. "
             f"Screenshot: `{d.get('screenshot')}`")
L.append("\n## OPEN for the owner\n")
L.append("- **VoiceOver on iOS Safari 17 (BrowserStack Live): OPEN.** Plan Step 2: the adoption sheet, the share preview and "
         "the 3rd-day line, by the operator who runs it. Not attempted here.")
L.append("- The real soft keyboard (W11.13 emulates it by a 390 x 464 viewport) and a real-device touch pass: OPEN.")
L.append("- Production was not touched: every request went to 127.0.0.1.")
(EVD / "README.md").write_text("\n".join(L) + "\n", encoding="utf-8")
print("README written", len(L), "lines")
