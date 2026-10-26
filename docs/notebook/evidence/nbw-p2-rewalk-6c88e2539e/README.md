# Notebook widgets phase 2: re-walk raw evidence, after walk fix rounds 1 to 4

Raw output of `tools/notebook_widgets_p2_walk.py`, committed before any summary (R-RAW). The summary is
`.superpowers/sdd/2026-10-24-notebook-widgets-p2-w10/rewalk-report.md` (local, gitignored).

- Tip under test: `6c88e2539e` (feat/notebook-widgets-p2). `app/dist` was rebuilt from it before the run
  (`npm run build`, exit 0).
- Sandbox: `scripts/hub_sandbox_boot.py` via `notebook_perf_harness.Sandbox`, data dir `C:\data-nbw-rewalk`, port
  8097. Flags: production's armed set from `docs/feature_flags.json`, plus `NOTEBOOK_WIDGETS_W8/W9/W10_ENABLED=1`.
  One phase (`on`). The snapshot rail read CLEAN at every checkpoint (`integrity-on.md`).
- Steps: `--only W8.1,W8.2,W8.3,W8.7,W8.8,W9.1,W9.5,R73,W10.3,W10.4,W10.5,W10.6,W10.7,W10.8,R74`.
  "R73" also selects R73.I2. W8.1 to W8.3, W9.1, W9.5, W10.5 and W10.6 seed the steps the brief names.
- Tool changes in the same commit: W8.7 reads the public widget from the server's params, with no author controls
  and no archived image. W8.8 reads the Example and Yours marks. W10.3 checks for "trades" in notes-source copy.
  W10.4 reads the "What changes" list. W10.7 shares AND publishes a notes list with distinctive titles and a
  by-account widget, then checks the DOM text, every attribute, the image alts and the payload response the page
  fetched. W10.8 uses 390x400, checks the box against the sticky footer, and checks when the name error appears.
  New steps: R73, R73.I2 and R74.
- The run was on Sunday 2026-10-25 ET. A routine made that day has no scheduled day yet, so R73's routine widget
  had no figures. Its public check rests on its title, its items and the hidden sentence. The tracker widget had
  figures: six Sleep values, five of them logged on the week's nights through `PUT /api/j2/trackers/{id}/days/{day}`.
- Files: `walk.json` (every step), `steps/<vp>-<step>.json`, `<vp>/*.png` (screenshots and public pages),
  `state.json` (sandbox seed ids, no secrets), `sandbox-on.log`.
