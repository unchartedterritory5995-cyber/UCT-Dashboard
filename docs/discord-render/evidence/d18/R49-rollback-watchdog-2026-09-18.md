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

## Live rehearsal — attempted 16:16 ET, blocked by a mechanical conflict, not a judgment call

Checked the moment the 16:20 ET gate was about to open. Two things changed the plan:

1. **Traced `do_rollback`'s own positive-path mechanics before touching anything**: if the
   synthetic trigger fires and no natural boot appears within 180s, it issues an
   **unconditional `railway redeploy --service web --yes`** — forcing an immediate production
   restart, entirely outside the pre-push guard's protections (a direct Railway CLI call, not
   a git push, so none of today's recency/burst/settle checks apply). Given today's persistent,
   unpredictable concurrent deploy activity from other workstreams (the exact reason R62 never
   found a clean window all day), this could collide with someone else's in-flight deploy —
   the same D-05 shape the push guard exists to prevent, reached by a door the guard cannot see.
   Put to the owner; the owner delegated the call. Judgment: run the NEGATIVE control (passive,
   zero writes) today; hold the POSITIVE path (forces a real redeploy) for a window without
   this collision risk.

2. **The negative control itself cannot run right now, for a reason the staging doc did not
   anticipate.** `d14_monitor.py`'s own lock (`OUT_DIR/.poller.lock`) is held by a LIVE,
   ALREADY-RUNNING process: `python d14_monitor.py --minutes 360`, PID 25724, started
   14:23:01 ET (confirmed via `Get-CimInstance Win32_Process`), which will run until ~20:23 ET.
   This is the standing overnight/continuous D-14 observability poller (not started this pass),
   and `main()`'s own lock check (`if _lock_held(): ... return 0`) means a SECOND invocation —
   my rehearsal — would silently exit doing nothing the instant it tried to run, which would be
   indistinguishable from "ran cleanly, nothing fired" unless checked for exactly this.
   **Not killed.** That process is a concurrent session's active, standing infrastructure, not
   mine to interrupt without coordination — the same rule this repo applies to reaping any
   other workstream's live process (signature + age + worktree, never by convenience, never
   mid-observation).

**Consequence: R49's live rehearsal, BOTH halves, is deferred again today** — not because the
mechanism isn't ready (it is, rail-proved, sha-verified), and not purely because of deploy
turbulence, but because the staged procedure's own lock file is legitimately busy with standing
work. **Next window: after ~20:23 ET when the current 360-minute poller window ends naturally,
or the weekend, or a coordinated pause of the overnight poller if the owner wants it sooner.**
Nothing about this changes R49's own readiness — the gate is external, not the tool.

⛔ **The "~20:23 ET" figure above was wrong by exactly one hour — this box's Windows clock is
Central Time, not Eastern** (`Get-TimeZone` → `Central Standard Time` / UTC-6 base, CDT active).
`Get-Process`'s `StartTime` for PID 25724 read `2:23:01 PM` and was taken at face value as ET; it
is CDT, i.e. **3:23:01 PM ET**. True deadline with `--minutes 360`: **21:23 ET**, not 20:23 ET.
Confirmed against the poller's own UTC-stamped `poller_started` log line
(`2026-09-18T19:23:01Z` = 15:23:01 ET) — the artifact, not the OS API's local-time field, is what
resolved it. Worth a look at any other "ET" timestamp in this evidence tree derived the same way.

## Live rehearsal — NEGATIVE CONTROL RUN AND PASSED, 2026-09-19T01:24:26Z–01:29:42Z (21:24–21:29 ET)

The moment the corrected deadline passed, PID 25724 exited cleanly (`poller_window_ended` at
`2026-09-19T01:23:48Z`, lock file gone). Ran the staged command exactly as written above:

```
python docs/discord-render/instruments/d14_monitor.py --minutes 5 --interval 30 --rollback-phase canary
```

**Result: clean pass, negative control confirmed.**
- `poller_started` (`rollback_phase: canary`) → 10 polls at the configured 30s interval, zero
  gaps, zero `probe_*` errors → `poller_window_ended`. Full 5-minute window, nothing truncated.
- `.rollback_fired.json` was never created — checked directly (`find`, not inferred from log
  silence) — confirming the armed watchdog never had cause to act, exactly the expected outcome
  with `DISCORD_RENDER_V2_ENABLED` unset and no real tier-1 stall or blindness condition landing
  in this specific 5-minute window (tonight's stall log shows several real tier-1 events at OTHER
  times, so this was a genuine — not guaranteed — pass, not a vacuous one).
- Ran with the owner's explicit go-ahead, having been told the real risk beforehand: a genuine
  stall landing inside the window would have made this a REAL rollback, not a rehearsal.

**Still open, unchanged from above:** the live POSITIVE-path rehearsal (a synthetic trigger
actually producing one rollback call, a real boot, a confirmed read, a page) is still staged, not
run — deliberately, given the forced-redeploy collision risk on a night this turbulent. That
remains for a window without that risk.
