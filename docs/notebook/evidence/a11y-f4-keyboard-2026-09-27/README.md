# F4 keyboard re-walk — raw evidence (wave 10 follow-up F4, 2026-09-27)

Raw output only, committed before any summary (R-RAW). The interpretation is in the lane's
report, not here.

## What ran

| file | instrument | against |
|---|---|---|
| `walk-all.json`, `shots/s*.png` | lane 10E-2's `keyboard_walk.py` + `kbd_more.py` + `kbd_lib.py`, all sections (S1–S6) | the F4 branch tip, sandbox `C:\data-w10f4` on `:8219` |
| `walk-f4.json`, `shots/f4-*.png` | `kbd_f4.py` (this lane): skip link order and layout on five pages, dialog names read through `aria-labelledby` and Playwright's accessibility snapshot, the editor ToolButtons by keyboard | the same sandbox, after the walk |
| `kbd_f4.py` | the F4 probe itself | — |
| `sandbox-integrity-*.md` | the launcher's shared-data-root integrity log (copied from `docs/plans/joystick/sandbox-runs/`) | `C:\data` |

The 10E-2 scripts are NOT copied here: they live on branch `feat/notebook-w10-e2`
(`docs/notebook/evidence/a11y-second-review-2026-09-27/`, commits `4951b6e58` and
`90907a53c`) and land with it. They ran from a scratch copy with three path shims and no
other change:

- `e2_common.py` / `e2_sandbox.py`: `REPO` points at the F4 worktree (the copy is not inside
  a repo, so `parents[4]` resolves nowhere);
- `keyboard_walk.py`: `PROOF` points at the copy's own directory (where `e2_common.py`
  sits), and the recorded `tip` is read from `F4_TIP` instead of the literal `d9e887ca0`.

The "before" for every step is lane 10E-2's own record at `d9e887ca0`
(`walk-all.json` and, for S2b/S2c, the rerun `walk-S2b-S2c.json`, both on
`feat/notebook-w10-e2`). `d9e887ca0` is an ancestor of this branch's base `0bbfd3f68`, and
none of the files the F4 fixes touch changed between the two (7 commits, measured with
`git diff --stat d9e887ca0 0bbfd3f68 -- <those files>`: empty).

## Preconditions (as 10E-2's walk requires)

- `app/dist` rebuilt from the F4 tip before the boot;
- a census-pinned `scripts/hub_sandbox_boot.py` boot (through 10E-2's `e2_sandbox.py`, the
  perf harness's `Sandbox`), identity proved by `scripts/sandbox_identity.verify` before any
  request;
- the walk account is a paid-equivalent sandbox member (`e2-kbd@local.dev`), never production.
