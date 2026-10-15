# Tier 2 part A: the arming packet

What this is: everything the owner needs to turn on `NOTEBOOK_SMART_CHIPS_ENABLED` after the
Tier 2 part A PR has merged and `web` is serving it, and to turn it off again. Merging and arming are
the owner's. No agent runs a `railway` command.

Status (updated 2026-10-15, round 2, tree `6be4a827a1`): both defects the first landing found are fixed and
re-measured. The first-landing items are CLOSED below. The round-2 six-shard gate still lists 3 NEW names, all in
files this branch does not touch and all timing or ordering reds that pass on re-run (see item 1); they wait for the
controller's ruling, and the PR is not yet open. Nothing here has been run on production.

## Open before merge: the three items Task 12 found, and where each stands

1. Gate. Round 1 (`c57a084a08`, `docs/notebook/gate-runs/t2a-landing/2026-10-15T06-10-20.md`) had 2 NEW failures, both
   this branch's: the `swallowedFetch` census (`screenshotRead.js` gained a `.catch(() => null)`) and `f5Freeze`
   (a second ticker settle call). CLOSED by `1e812a09bd` and `fc32fb88a0`: both are green in round 2.
   Round 2 (`6be4a827a1`, `docs/notebook/gate-runs/t2a-landing-r2/2026-10-15T09-22-53.md`, commit `a4fef24ba6`): 3,439 files
   reconcile, GATE EXIT 1, 3 NEW, none in a file this branch touches:
   `objectLaneCallSites.measure` and `objectLaneDrawerCensus.measure` ("Test timed out in 15000ms", shard 1) and
   `StockChart.smoke` "reports the drawn bar count" (shard 2, an async error from `PatternOverlay.jsx`). The three files pass
   alone; shard 1 re-run as the gate runs it fails only the baseline `jsonFetcher` name; shard 2 re-run passes all 7,010
   tests with one unhandled async error attributed to the same StockChart test. Classification: load-sensitive and
   intermittent, not banked into the baseline. STILL OPEN: the controller's ruling (accept as flake, or re-gate once more).
2. Walk. The screenshot chip was placed below a 1280 x 800 window. CLOSED by `6be4a827a1` (`lib/barPlacement.js`, clamped
   into the viewport, re-places on scroll and resize). Round-2 walk, UNpatched tool, commit `f412158c88`,
   `docs/notebook/evidence/t2a-walk-r2-20261015T095152/`: `VERDICT c2: 11 steps, 0 FAIL`; `smart.screenshot-tag` PASS at
   1280 (800 tall, real click), 820 and 390; three real pastes, three offers, 0 misses. C:\data CLEAN at all four checkpoints.
   Earlier evidence: `t2a-walk-20261015T062932/` (the failure) and `t2a-walk-diag-20261015T063501/` (the box that showed it).
3. NVDA rows 39 to 41: not yet run, waits for the owner to be away. See "Before arming".

Bytes on the final tree: 2,251,768 B (+6,079 over base 2,245,689; ceiling 2,251,833; budget 2,260,793).
Typing: not re-measured after the round-2 fixes (they are off the typing path, no per-keystroke listener was added); the
last measurement is `docs/notebook/evidence/t2a-perf-final-20261015T043054/` with the addendum in
`docs/notebook/perf-runs/t2a/RESULT.md`: no regression from the switch.

Known pre-existing reds (they fail at the base too, none is this branch's):
`tests/test_notebook_flag_parse.py` (2 tests; offenders `tools/notebook_daily_prep_probe.py`,
`tools/runtime_pane_smoke.py`), `tests/test_notebook_route_security_census.py` (P1 rows missing),
`tests/test_user_definitions_auth.py` paid-sentence test, and 4 vitest names inside the gate baseline.

## After the merge: verify before anything else (Step 5)

1. `web` reached SUCCESS on a fresh boot (the deploy record's status, not an uptime), and the merge commit is an
   ancestor of `origin/production`: `git merge-base --is-ancestor <merge-sha> origin/production`.
2. `python tools/hub_nav_smoke.py --auth` (exit 0 PASS, 1 a measured break, 2 INCONCLUSIVE; on 1 the order is
   roll back first, diagnose second, H15).
3. Exercise `/plan NVDA` on production as `smoke@uctintelligence.internal`, in its own Playwright context (never the
   owner's Chrome), and trash the note it made afterwards.

## Before arming

- NVDA rows 39 to 41 (the alert chip and the screenshot tag): not yet run, waits for the owner to be away. Run them
  against the same build, from PowerShell, with the silent config (`%TEMP%\nvda-silent-config`,
  `-m --log-level=12 --log-file=...`), then quit NVDA with `& 'C:/Program Files/NVDA/nvda.exe' -q` and prove it gone
  (`Get-Process nvda -ErrorAction SilentlyContinue` returns nothing). Raw log first, then each row's PASS or FAIL.
  Row 39's phrase "NVDA closes below" also matches the typing echo; the row stays sound through its live-region phrases.
- Open item 1 above is ruled on.

## The command (the owner's)

```
! railway variables --service web --set "NOTEBOOK_SMART_CHIPS_ENABLED=1"
```

`--set` has been measured both ways (it can stage, it can redeploy). Verify a NEW boot, never the CLI.

## Checks after it

1. A NEW boot: a startup line stamped after the set. Only if none appears within about 3 minutes,
   `railway redeploy --service web --yes`.
2. The value in the running process, not `--kv`: read `os.environ.get("NOTEBOOK_SMART_CHIPS_ENABLED")` over
   `railway ssh` (use the pod's `/opt/venv/bin/python`), expect `1`.
3. `/api/auth/me` for the smoke account carries `notebook_smart_chips_enabled: true`.
4. The walk's `smart.alert-chip` against production as the smoke account: type "alert me if NVDA closes below 120",
   the toolbar "Alert suggestion" appears with "NVDA closes below $120.00 (daily)", Alt+Enter opens "Set an alert"
   filled in (Ticker NVDA, Price 120, When "Closes below"), press Cancel only, and confirm the alert count did not
   change. No alert is ever set on production by a tool. (`tools/notebook_fin_walk.py` is a sandbox driver; its
   `smart.alert-chip` step is the script to copy into a smoke-account Playwright context.) Trash the note afterwards.
5. The app-wide client smoke (R-27): `python tools/postdeploy_client_smoke.py`, exit 0 within ten minutes, with the
   opt-in key unset. A failure is H4: roll back first.
6. `docs/feature_flags.json`: move `NOTEBOOK_SMART_CHIPS_ENABLED` to `armed`, put `web` in `where`, and put the flip
   timestamp in the note, in the same docs push that records the flip.

## Rollback

```
! railway variables --service web --set "NOTEBOOK_SMART_CHIPS_ENABLED=0"
```

then verify a new boot and read the value in-process. (`railway variable delete NOTEBOOK_SMART_CHIPS_ENABLED --service web`
also works, but a delete does NOT restart, so follow it with `railway redeploy --service web --yes` and confirm from the pod.)
A tab that is already open keeps the latched answer until it reloads.
