# Tier 2 part A: the arming packet

What this is: everything the owner needs to turn on `NOTEBOOK_SMART_CHIPS_ENABLED` after the
Tier 2 part A PR has merged and `web` is serving it, and to turn it off again. Merging and arming are
the owner's. No agent runs a `railway` command.

Status when written (2026-10-15): the PR is NOT yet open, because the six-shard gate found two NEW
failures on this branch and the walk found that the screenshot chip is unreachable on a 1280 x 800
window. See "Open before merge" below. Nothing here has been run on production.

## What ships on merge, and what stays dark

| Surface | On merge | Switch | Rollback |
|---|---|---|---|
| `/plan <TICKER>` in the slash menu | LIVE for every member who has the journal styles switch (`NOTEBOOK_JOURNAL_STYLES_ENABLED`, already armed on web) | the styles switch | revert the PR. There is no schema change, and notes already made stay ordinary Trade plan notes |
| The alert chip (type "alert me if NVDA closes below 120", press Alt+Enter, a pre-filled sheet, the member presses "Set alert") | DARK | `NOTEBOOK_SMART_CHIPS_ENABLED`, unset = off | leave it unset or set it to `0` |
| The screenshot tag chip ("Tag NVDA - Daily" on a pasted chart screenshot) | DARK | the same switch, and ALSO `NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED` (already armed on web) | the same |
| `POST /api/j2/smart-chips/tickers` | answers one 404 while the switch is off | the same | the same |

With the switch off nothing new runs: no plugin work beyond one latched flag read, no poll, no route.

## Open before merge (found by Task 12, 2026-10-15)

1. Gate: 2 NEW failures against the recorded baseline (`docs/notebook/gate-runs/t2a-landing/2026-10-15T06-10-20.md`,
   GATE EXIT 1). Both are this branch's, and both fail alone:
   - `src/lib/swallowedFetch.census.test.js`: `pages/journal-2-0/lib/screenshotRead.js` gains a
     `.catch(() => null)` site (0 -> 1; line 35). The census is shrink-only.
   - `src/pages/journal-2-0/lib/offline/f5Freeze.test.js`: the screenshot tag adds a second ticker
     `settleMetadataRevision(await update({ ticker ... }))` call in `NoteEditorPage.jsx` (`setTickerFromTag`,
     near line 1986); the rail allows exactly the three metadata doors (folder, tags, ticker).
2. Walk: the screenshot chip is offered but cannot be reached on a 1280 x 800 window. The chip is
   `position: fixed` at `top = image.bottom + 6` with no viewport clamp (`ScreenshotTagOffer.jsx` lines 79 to 82).
   Measured chip box at 1280 x 800: y = 991 to 1018, below the window. At 820 x 1180 and 390 x 844 it is on
   screen. Evidence: `docs/notebook/evidence/t2a-walk-20261015T062932/` (the failing row, with Playwright's
   "element is outside of the viewport" call log) and `docs/notebook/evidence/t2a-walk-diag-20261015T063501/`
   (the same walk with the click forced, boxes recorded).
3. NVDA rows 39 to 41: not yet run, waits for the owner to be away. See "Before arming".

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
- Open items 1 and 2 above are closed, and the gate is re-run on the final tree.

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
