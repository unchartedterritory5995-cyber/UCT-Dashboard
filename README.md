# deploy-gate-state

Machine-written state for the master deploy gate. **Not source.** An ORPHAN branch:
it shares no history with `master` and must never be merged into anything.

## Why a branch and not a file on `master` or `production`

- On `master`: every promotion would change `master`, which re-triggers the gate,
  which promotes again. A loop.
- On `production`: `promote-production.yml` is FAST-FORWARD ONLY and refuses to
  force (see its "production is not an ancestor" error). A commit here that is not
  on `master` makes `production` stop being an ancestor of the candidate, and the
  NEXT promotion hard-fails. It would also make the advisory range scan report
  `NOTHING AHEAD` on every run, because HEAD would be contained in the base.
- Here: the gate triggers only on `push: branches: [master, main]`, so writing this
  branch starts nothing. Railway watches `production`, so nothing deploys.

## Files

`last-promotion.json` — written by `promote-production.yml` after a successful
fast-forward. Read anonymously (no token) at:

    https://raw.githubusercontent.com/unchartedterritory5995-cyber/UCT-Dashboard/deploy-gate-state/last-promotion.json

The gate reads it at the start of every run and refuses to proceed if
`production` has moved to something nobody promoted (SD-1.3 C2.2). That control
is DETECTIVE, not preventive, and its cadence is tied to master pushes: a foreign
push to `production` during a quiet period is undetected until the next master
push. Branch protection on `production` (G6) closes both gaps.

`range_scan_state` / `range_scan_verdict` are lifted from the gate run's log, which
is how the advisory range scan's six states become readable without a token.
A log that could not be read records `null` — never a fabricated verdict.
