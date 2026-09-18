# R49 — deterministic rollback watchdog, built and rail-proved

## What shipped

`docs/discord-render/instruments/d14_monitor.py` extended, opt-in via `--rollback-phase
{canary,member}`. With the flag unset (everything the overnight poller has always done),
behavior is unchanged — pure observation, zero Railway writes. Full design rationale is in the
module's own extended docstring; summary:

- **Two trigger classes**: a tier-1-class stall (`stall_record.lifetime_max_ms >= 5000ms`,
  mirroring — never importing — `observe.py`'s own R34 tier-1 threshold, deliberately, per
  today's R71 near-miss lesson about this branch's checkout differing from what's deployed), and
  BLINDNESS (3 consecutive unreadable polls — rollback in member phase, page-only in canary
  phase, exactly per R49's own text).
- **Never a re-flip**: a durable, on-disk latch (`.rollback_fired.json`) is written the MOMENT a
  rollback is decided, before the Railway call runs, so a mid-action crash-and-restart can never
  fire twice. Clearing it is a manual, owner-only action.
- **Real restart, not `--skip-deploys`**: both V2 flags are read via a bare
  `os.environ.get(...)` per call — there's no in-process cache to invalidate, but an env var also
  cannot reach an already-running process without a restart. Follows this repo's own documented
  "set → watch for a new boot → explicit redeploy if none appears within ~3 min → confirm
  in-process" procedure, not a guess.
- **Known, accepted cost, stated explicitly**: every rollback trades a brief boot-window
  degradation (today's own R62-F3-attempt measured this at up to ~20 min, peaking past 60-110s)
  for getting off a broken path. Correct trade, and exactly why the action is one-shot.

## Rails + mutation proof — done, sha-verified restore

`--self-check` now covers 11 cases (3 original + 8 new pure-function cases for R49), all
touching zero Railway state. Baseline sha256:
`22a849e7d1d2c4fb1967a4b9bb3faff9e37e28767f68dc55db2c6d1cd44207a6`.

| mutation | result | why |
|---|---|---|
| M1: `TIER1_ROLLBACK_MS = 5000.0` → `float("inf")` | **RED** (1 failed) | the >=5000ms synthetic case stops firing |
| M2: member-phase `var` swapped `DISCORD_RENDER_V2_CHANNELS` → `DISCORD_RENDER_V2_ENABLED` | **RED** (1 failed) | the derived command no longer names the channels var |
| M3: blindness-counter increment (`n = n + 1 if is_gap(rec) else 0`) → `pass` | **RED** (2 failed) | both the 3-gap count and the reset-on-success case fail |

All three restored, sha re-verified identical to baseline after each. 3/3 mutations RED, controls
green (the un-mutated self-check PASSES 11/11 before and after).

## A real bug caught before it could matter, not guessed around

The first draft's `variable_cmd()` for the delete path included a `--yes` flag. Checked directly
against `railway variable delete --help` (not assumed): **no such flag exists** — `delete` takes
a bare positional `<KEY>` and nothing else. Left in, this would have made every CANARY-phase
rollback (`railway variable delete DISCORD_RENDER_V2_ENABLED`) fail on an unrecognized-flag parse
error at the exact moment it mattered most — the automation would have reported "attempting" in
its latch file and then silently done nothing. Fixed; `set`'s syntax was independently confirmed
correct against `railway variable set --help` and matches this session's own earlier working
example (OI-13 step 6).

## Live rehearsal — deliberately NOT run yet, staged instead

R49's own text calls for "a LIVE rehearsal in a settled window, both paths," and the new
directive asks for it "from the scheduled-task context... against the smoke channel only."
**Not run today, on purpose**: this session's own R71/R62 work today already measured two
UNPLANNED web deploys colliding with the market-open acceptance window, each costing up to ~20
minutes of degraded screener-sweep performance. Running a live rehearsal now — which, per the
design above, DELIBERATELY triggers a real pod restart to prove the env change reaches a running
process — would be a third deploy on an already-turbulent day, and would further muddy the
still-pending R62 retry. This is a judgment call, not a blocker: the mechanism is fully built and
rail-proved; only the LIVE half is deferred.

**Staged procedure, ready to run from a scheduled-task context once the window is genuinely
settled** (no other pending deploys, market either closed or well clear of the open):

```
# From Windows Task Scheduler (NOT an interactive shell — R49's own cwd lesson: the
# Railway CLI resolves its linked project from cwd, which a scheduled task starts without).
# Registers as UCT-D14-Rollback-Rehearsal, working directory pinned to the repo root.
python docs\discord-render\instruments\d14_monitor.py --minutes 5 --interval 30 --rollback-phase canary
```

With `DISCORD_RENDER_V2_ENABLED` currently unset (V2 dark everywhere) and no synthetic tier-1
stall or blindness condition present, this SHOULD run its full 5 minutes and exit cleanly with
`poller_window_ended`, never touching `.rollback_fired.json` — the negative control. The positive
path (does it actually fire and confirm) needs a synthetic trigger injected at the monitor's
INPUT, never production — e.g., a modified `poll_once` returning a canned tier-1 `stall_record`
for one test run, which is the next concrete step before treating this rehearsal as complete.

## What this does NOT settle

- The live positive-path rehearsal (does a real trigger really produce exactly one rollback call,
  a real boot, a confirmed read, and a page) — staged, not run.
- Whether `chart_health_alerts.emit` is importable at `/app` on the live pod exactly as
  `PAGE_PROBE` assumes (`sys.path.insert(0, "/app")` then `from api.services import
  chart_health_alerts`) — mirrors the existing `poll_once` SSH pattern's assumptions but has not
  itself been exercised against the live pod.
