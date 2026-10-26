# Notebook widgets phase 2 — ship walk raw evidence (waves 8, 9, 10)

Raw output of `tools/notebook_widgets_p2_walk.py` (plan Task 8.19 Step 4, Task 9.20 Step 4, Task 10.22 Step 1),
committed before any summary (R-RAW). The summary is `.superpowers/sdd/2026-10-24-notebook-widgets-p2-w10/ship-walk-report.md`
(local, gitignored).

- Tip under test: `5cdeba87ee` (feat/notebook-widgets-p2); `app/dist` built at `493769b120`, the only later commit is docs.
- Sandbox: `scripts/hub_sandbox_boot.py` via `notebook_perf_harness.Sandbox`, data dir `C:\data-nbw-walk`, port 8093,
  flags = production's armed set from `docs/feature_flags.json` plus `NOTEBOOK_WIDGETS_W8/W9/W10_ENABLED`.
- Phases (each its own boot of the SAME data dir): `on` (W8=1 W9=1 W10=1), `w9off` (W9=0), `w10off` (W10=0); then two
  `--resume` passes (`on`+`w9off`, steps W9.5 and W9.12, 820 and 390) after a walk-tool fix (the `/track` row pick).
  Rows a resume re-ran are kept under `superseded` in `walk.json`.
- Snapshot rail: every checkpoint of every boot CLEAN (`integrity-*.md`). The first `on`/`w9off` integrity files were
  overwritten by resume 1 and were restored verbatim from the launcher's own logs
  (`docs/plans/joystick/sandbox-runs/2026-10-25T16-37-10.md`, `...T16-52-20.md`); `sandbox-on.log`/`sandbox-w9off.log`
  of the first pass were overwritten (the resume logs are kept as `*-resume1.log`).
- Files: `walk.json` (every step, rewritten after each), `steps/<vp>-<step>.json` (one per step), `<vp>/*.png`
  (screenshots, public pages, the archived notes-list image), `state.json` (sandbox seed ids, no secrets).
- The walk ran on Sunday 2026-10-25 ET (not a market session): routine consistency and reminder bells cannot be
  produced on such a day (see W9.3 and W9.7, INCONCLUSIVE).

## OPEN for the owner

- **VoiceOver on iOS Safari 17 (BrowserStack Live)** — operator-only, not attempted by this tool: the builder name field
  (8.19), the routine and tracker blocks (9.20), the formula box, its autocomplete and one dedicated embed's table
  alternative (10.22 Step 2). To be recorded in this directory by the operator who runs it.
