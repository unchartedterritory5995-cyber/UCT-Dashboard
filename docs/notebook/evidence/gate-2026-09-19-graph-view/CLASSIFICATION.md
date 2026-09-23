# Gate 2026-09-19T19:03:02 — the 31 "new" failures are MASTER'S, not this branch's

`VERDICT=NEW_FAILURES exit=1 new=31` on tree `a26905b67`
(manifest: `docs/plans/joystick/gate-runs/2026-09-19T19-03-02.md`).

## The measurement

The gate's own instruction is to classify by DIRECTION before treating a red as
a regression: *"a failure the BASE also has is master's; one only this branch
has BLOCKS."* So the 22 distinct files carrying the 31 failures were run twice,
same box, same command, same `--maxWorkers=2`, minutes apart:

| tree | what it is | result |
|---|---|---|
| `a26905b67` | this branch (graph view, 4 commits) | **22 files failed · 29 failed / 108 passed** |
| `aae997317` | the merge-base — pure master, **none** of my commits | **22 files failed · 29 failed / 108 passed** |

**Byte-identical.** Raw logs are beside this file:
`failing-22-ON-BRANCH-a26905b67.log` · `failing-22-AT-BASE-aae997317.log`.

⭐ The base run was done by detaching this worktree to the merge-base, which was
safe to do because every commit was already pushed and `node_modules` is
gitignored (so a checkout cannot disturb it). It was verified mid-run that
`NoteGraphView.jsx` was ABSENT at the base — otherwise the "control" would have
been the branch wearing a different hash.

## Why the gate went red anyway

⛔ **THE BASELINE IS FIVE DAYS STALE.** It was measured 2026-09-14 on master
`1216958ed`; this run is 2026-09-19. The suite has grown from ~1180 test files
to **1617** in that window. The 31 are master's accumulated drift across five
days of four other workstreams landing — the Pine/indicator engine, the chart
builder, Layout, Login TOTP, the surfaces manifest. Not one of them is in a file
this branch touches, and the intersection of {failing files} and {files this
branch changed} is **empty**.

⚠️ This is [[lesson kind 3b]] — a record that was true when written, with the
world moved underneath it. Nothing was red; the baseline simply stopped
describing master. It is **not this branch's to fix**: re-baselining is a
repo-wide artifact change that belongs to whoever is landing next, and doing it
from here would bury a real regression somebody else is about to introduce.
Recorded so the next reader does not re-derive it.

## Verdict for this branch

Gate criterion in this repo is **"no NEW failures against a measured baseline"**,
never a green suite — the repo is not green and this branch cannot make it so.
Measured against the base directly rather than against the stale record:

> **0 new failures. The branch does not move the failing set at all.**
