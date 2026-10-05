# AlertBell mobile dropdown overflow — fix evidence

**Branch:** `fix/alertbell-mobile-overflow` (based on `origin/master` `25d503a324`)

## Bug

`AlertBell.module.css`'s `@media (max-width: 640px)` rule set `right: -40px` on
`.dropdown`. The bell is the rightmost item in `MobileNav`'s fixed top bar
(`topBarRight`, 12px from the bar's own right edge), so `right: 0` keeps the
panel flush with its anchor — but `right: -40px` pushes the panel's right edge
40px **past** that anchor, off the right edge of a phone screen, on every open.

Original finding (lane W15-UCT, branch `feat/notebook-w15-uct`):
`docs/notebook/gate-runs/wave15/shots/r103146-g153-390-dropdown.png` +
`docs/notebook/gate-runs/wave15/walk-uct-674012eb1.json`.

## Fix

Deleted the `@media (max-width: 640px) { .dropdown { ... } }` override. The
base (non-media) `.dropdown` rule already declares `right: 0` and
`width: min(320px, calc(100vw - 24px))`, which is viewport-safe at every width
from 320px up (the override restated the identical `width` and only added the
harmful `right: -40px` — once that's gone the block is a no-op duplicate of
the base rule, so it is removed rather than rewritten). No new breakpoint
literal was introduced; `app/src/components/AlertBell.module.css:224` now
carries a comment pointing future readers at the rail below instead of a
phone-only rule.

## Rail

`app/src/components/AlertBell.dropdownOverflow.test.js` — a CSS-reading test
(jsdom performs no layout, so a rendered-geometry assertion cannot see this
class of bug; see the file's own header). It parses `.dropdown`'s declared
`right` value at 320/390/640/820/1024px and asserts it never goes negative.
Proved against the real regression (not a sanitized stand-in): temporarily
restoring the deleted block locally and re-running the rail failed 3/8 cases
exactly at 320/390/640px and passed at 820/1024px — matching the measured
geometry below. Restored via writing back captured clean bytes (not
`git checkout --`), verified with `git diff` showing only the intended fix.

## Real-browser verification (local sandbox, branch tip)

`scripts/hub_sandbox_boot.py --data-dir <scratchpad> --port 8705` (sandbox
ports 8705-8709; never `C:\data`, never port 8077) + a one-off Playwright
script against `/dashboard`, admin account, touch viewports. `C:\data`
confirmed byte-identical at pre-boot / +15s / +120s (past the walk) —
`docs/plans/joystick/sandbox-runs/2026-10-04T10-53-37.md`.

Raw measurements: `evidence/raw-measurements.json`; screenshots:
`evidence/bell-open-{320,390,820}px.png`.

| viewport | window.innerWidth | dropdown right edge | overflow_right_px | fully inside |
|---|---|---|---|---|
| 320px (phone) | 320 | 308 | -12 | yes |
| 390px (phone, the reported break) | 390 | 378 | -12 | yes |
| 820px (tablet) | 820 | 808 | -12 | yes |

All three fully inside the viewport, with the dropdown's right edge
consistently 12px inside the window edge (matching `MobileNav`'s
`padding-right: 12px` on the top bar) — the tablet tier (641-1024px) was never
hit by the original bug (the override only applied at ≤640px) and stays
unaffected by this fix.

## Tests run

- `npx vitest run src/components/AlertBell.test.jsx src/components/AlertBell.delivery.test.jsx src/components/AlertBell.dropdownOverflow.test.js src/styles/tapFloor.test.js --maxWorkers=1` from `app/` — 4 files, 31 tests, all green.
