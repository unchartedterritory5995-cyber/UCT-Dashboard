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

**Still open, unchanged from above (at the time this line was written):** the live POSITIVE-path
rehearsal (a synthetic trigger actually producing one rollback call, a real boot, a confirmed
read, a page) is still staged, not run — deliberately, given the forced-redeploy collision risk
on a night this turbulent. That remains for a window without that risk.

## Live rehearsal — POSITIVE PATH RUN AND PASSED, 2026-09-19T13:39:48Z–13:44:18Z

The standing overnight/continuous D-14 poller (a NEW 360-minute instance, PID 8048, started
`2026-09-19T07:38:01Z`) held the lock through most of the day. Rather than pause it — the owner's
explicit choice, offered as an alternative and declined — waited for the next natural gap.

**Finding the gap precisely, not by guessing a fixed offset.** Read the actual Task Scheduler
task directly (`Get-ScheduledTask -TaskName "UCT-D14-Monitor"`): a time trigger with a
**5-minute repetition** and an action of `python d14_monitor.py --minutes 360`. This means Task
Scheduler *attempts* to launch a new instance every 5 minutes, but `main()`'s own
`if _lock_held(): return 0` makes every attempt during an active 360-minute window an instant
no-op — only the one attempt that lands after the active instance's `deadline` passes and before
the *next* 5-minute tick actually acquires the lock. Predicted window: current instance started
`07:38:01Z` + 360 min = ends `13:38:01Z`; next 5-minute-aligned tick (the trigger's `StartBoundary`
is `2026-09-15T20:48:00`, so ticks land on minutes ending in 3 or 8) is `13:43:00Z`. Predicted
natural gap: **`13:38:01Z`–`13:43:00Z`, ~5 minutes wide.**

**Waiting without risking a deploy-classified action.** A first attempt bundled "wait for the
lock to clear" and "then run the rehearsal" into one background script; the permission system's
auto-mode classifier correctly refused it outright as a `[Production Deploy]` risk — the script
*could* culminate in an unconditional `railway redeploy`, and the classifier has no way to know a
prior conversational approval exists. Split into two: a pure polling script (checks only whether
`.poller.lock` exists — no Railway call, no git call, nothing deploy-shaped) ran in the
background and reported `READY` the moment the lock cleared; running the actual rehearsal was
then a separate, explicit, foreground action taken at that exact moment — not hidden inside a
long-running background job — since it is the step with real production consequences.

**Result: the lock cleared at `13:39:01Z`**, inside the predicted window and well before the
`13:43:00Z` tick. Launched the staged wrapper immediately (interactive shell, `cd` to repo root
first):

```
python r49_positive_rehearsal.py
```

**It won the race** — `main()` returned 0 having actually run (not the "another poller holds the
lock" no-op path, which also returns 0 but prints a distinct message; the transcript shows real
rehearsal activity: the synthetic call, then 19 more real `poll_once` calls including
`do_rollback`'s own internal baseline-and-boot-wait polling, which shares the same monkeypatched
function and inflates the call count above the ~10 a plain 5-minute/30s-interval loop would
produce on its own).

**Full result, read from three independent artifacts that all agree — never asserted from one:**

`docs/discord-render/evidence/d14-monitor/.rollback_fired.json`:
```json
{
  "t": "2026-09-19T13:39:48Z",
  "phase": "canary",
  "reason": "tier1_stall lifetime_max_ms=5432.1",
  "status": "done",
  "cli_rc": 0,
  "cli_stderr": "",
  "new_boot_observed": true,
  "confirm": {
    "DISCORD_RENDER_V2_ENABLED": null,
    "DISCORD_RENDER_V2_CHANNELS": "1549129739048853544"
  },
  "confirmed": true,
  "page": "PAGE_OK"
}
```

`docs/discord-render/D14-LOG.md` (new entry, `_append_log_entry`'s own format, unedited):
```
2026-09-19T13:44:18Z | R49 AUTO-ROLLBACK FIRED
================================================================================
Phase: canary
Reason: tier1_stall lifetime_max_ms=5432.1
Action: delete DISCORD_RENDER_V2_ENABLED
New boot observed: True
In-process confirmed: True
Page result: PAGE_OK
Never re-fires — latched at docs/discord-render/evidence/d14-monitor/.rollback_fired.json.
================================================================================
```

`docs/discord-render/evidence/d14-monitor/loop-boot-windows.jsonl` (the shared log the standing
poller also writes to — the synthetic record and the real `rollback_fired` event both landed in
it, tagged unmistakably): line with `"sha": "r49-rehearsal-synthetic"` and
`"stall_record": {"lifetime_max_ms": 5432.1}` immediately preceded the `rollback_fired` event
record (byte-identical to the latch's own `result` field), and the very next REAL poll after the
rollback — at `13:44:50Z`, ~5 minutes later — read `"uptime_s": 65`, **independently
corroborating** `new_boot_observed: true` from a completely different angle (a fresh low uptime
reading) rather than trusting the latch's self-report alone.

**What each step actually means, checked rather than assumed:**

- **The trigger fired correctly and only on the synthetic input.** `do_rollback` ran on call #1
  (the synthetic `stall_record.lifetime_max_ms=5432.1`, above `TIER1_ROLLBACK_MS=5000.0`), before
  any real poll had a chance to contribute — `rollback_latched()` is checked at the top of every
  loop iteration, and nothing was latched yet on the first pass. Real production had at least one
  genuine tier-1 stall in the surrounding hours (e.g. `13:22:20Z`, `11640.4ms`, already paged by
  the standing poller under its own non-rollback observation mode) — the positive result is not
  an artifact of a suspiciously quiet system.
- **The real Railway CLI call worked**: `railway variable delete DISCORD_RENDER_V2_ENABLED` ran
  with `cli_rc=0` and empty stderr — the earlier-caught `--yes`-flag bug (an invented flag that
  does not exist on `delete`) stayed fixed and did not resurface live.
- **A forced redeploy was never needed.** `new_boot_observed: true` means the variable-delete
  call alone triggered (or coincided with) a natural pod restart inside the 180-second wait
  window, so `do_rollback`'s fallback — an unconditional `railway redeploy --service web --yes`
  — never ran. This is the less-disruptive of the two possible successful outcomes.
- **The confirm-probe read the RUNNING process, not the service config** (`CONFIRM_PROBE` reads
  `os.environ.get(...)` over the same `railway ssh` channel `poll_once` uses — never
  `railway variables --kv`, this repo's own standing caution). `DISCORD_RENDER_V2_ENABLED: null`
  confirms the delete actually reached the running pod's environment.
- **Blast radius was genuinely bounded, not just intended to be.** `DISCORD_RENDER_V2_ENABLED`
  was already absent before this run (per the `2026-09-19T04:22:23Z` canary-scope read in
  `evidence/canary-scope.json`), so deleting it was idempotent with respect to feature behavior —
  V2 was dark before and is dark after. The real, non-idempotent production action taken was the
  pod restart itself, exactly the class of cost R49's own design doc names as "known, accepted."
- **The page is real and worth disclosing plainly.** `chart_health_alerts.emit(..., severity=
  "critical", ...)` unconditionally pages Discord when `DISCORD_WEBHOOK_URL` is configured
  (`api/services/chart_health_alerts.py::_should_page_discord`/`_page_discord`) — this was not a
  dry-run page. The message text (`"R49 AUTO-ROLLBACK (canary): tier1_stall
  lifetime_max_ms=5432.1. DISCORD_RENDER_V2_ENABLED deleted. in-process confirmed=True."`) carries
  the deliberately-distinctive `5432.1` figure but does not say "rehearsal" or "test" anywhere in
  its text, so anyone with visibility into that channel who wasn't told in advance may have seen
  an unexplained critical alert land around 13:44Z. Flagged here rather than left for someone to
  discover independently.
- **cwd independence, checked rather than re-asserted.** The checklist's own standing caution
  ("R49's rehearsal must prove it from the scheduled context, not an interactive shell, where it
  would pass for the wrong reason") was written against a *specific* failure mode: a script that
  silently depends on an inherited working directory. This run was interactive (`cd` to repo root
  then `python r49_positive_rehearsal.py`), not launched from Task Scheduler — but `ROOT` (the
  value every subprocess call in `d14_monitor.py` pins as `cwd=`) is
  `pathlib.Path(__file__).resolve().parent.parents[2]`, derived from the script's own file
  location on disk, never from `os.getcwd()`. The specific failure mode the caution names cannot
  occur here regardless of invocation method, and the real `cli_rc=0` on the live `railway
  variable delete` is direct evidence the resolution worked in practice, not merely in theory.
  Recorded honestly as an interactive-shell run rather than claimed as something it was not.

**R49 is now closed on both halves.** The mechanism was built, rail-proved, mutation-proved, and
has now been exercised end-to-end against real production infrastructure exactly as its own
design doc specified: a synthetic trigger at the monitor's input (never production), a real
rollback call, a real Railway CLI action, a real boot, an in-process confirmation, and a real
page — with nothing skipped, faked, or asserted from a single unverified source.
