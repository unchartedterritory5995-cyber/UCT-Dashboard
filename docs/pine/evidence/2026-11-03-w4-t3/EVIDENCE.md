# W4 T3 evidence: session and timeframe text constants

Branch `feat/pine-w4-t3-session-text`. Logs live outside the repo under
`C:\Users\pgosz\uct-worktrees\_resume-laptop\runs\` (`w4-t3`, `w4-t3-final`, `w4-t3-fix`,
`w4-t3-fix-final`).

## Result in one line

The change is correct and moves walls, but **no script attached**. Neither expected attach
(`nubia-auto-midas-anchored-vwap-xdecow`, `cm-forex-sessions-highlight-v1`) flipped, because each is
held by something T3 does not own. See "Census".

## SHAs

| what | SHA |
|---|---|
| base master for measure-pair (pine-base) | `52f76f9b4f` |
| round-1 tip (measure-pair and final-tip ran here) | `c271ad658d` |
| master merged in for the fix round | `d8d4f0937d` |
| fix round | the branch head carrying this file |

## What changed

- `pineRuntimeFrontend.js`: `fixedTextOf` (two fixed texts joined with `+`; a `var string` nothing
  reassigns, only when the name resolves at the call site to the main program's own slot),
  `ownTimeframeNameOf` (the chart's own timeframe, binding read first), `constantArgOf`,
  `frameConstNode`, `simpleSpecialisation`, and the `time` lowering in `runtimeClockLowering`.
- `runtimeInputs.js`: v1-v3 `input(type=session|resolution|string)` read as text inputs;
  `constantVarsOf` counts names bound by a tuple statement `[a, b] = f()` as bindings.
- The day mask needed no code: the columnar session clock already serves it (digit d is
  `dayofweek == d`); the rail holds every digit.

## Fix round (review M1, a silent wrong value in round 1)

`var string SESS = "0930-1000:23456"` and a tuple `[SESS, k] = g()` in a block, loop or function:
round 1 read the outer literal there (1,1,1,1,1,1 where Pine reads 0,0,0,1,1,1 inside the block),
because a block local has owner `null` like the `var`, and `constantVarsOf` did not see tuple
bindings. Two guards, each proved alone:

1. the slot the name resolves to at the site must be the main program's own (`sl === root.lookup(name)`);
2. a tuple-bound name counts as a binding in `constantVarsOf`.

New rail group "a block, loop or function that rebinds the name shadows the var" (10 cases): tuple in
an `if` block, in a `for`, in a function, tuple with the read outside the block (conservative refusal),
`:=` in a nested block, same-name local in an `if`/`for`/function, a loop counter, a typed local and a
`var` local, plus a control that the unshadowed shape is served. Every case refuses by name.

## Checks, round 1 (tip `c271ad658d`, base `52f76f9b4f`)

| check | result |
|---|---|
| rails on master (pin) | `w4TextConstants` + `objectDoorGate` copied onto master: 27 failed, 45 passed of 72 (23 in `w4TextConstants`, 4 door cases). Red before the fix. |
| rails on tip | 72 of 72 passed |
| measure-pair production | C18 audit and probes: 0 diffs (395 scripts identical). Harness 336 captures, MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140, verdicts identical to master. |
| measure-pair runtime-on | C18: 0 diffs. Harness MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118, verdicts identical. `adx-and-di-for-v4` attached, steps identical. |
| final-tip | gate pytest 46 passed, hygiene clean, `test_script_engine_version_gate.py` 6 passed, chart+hooks vitest 1333 files passed, 27 skipped, 2 failed (the known baseline files `targetScriptReport.measure` and `pollingSites.rail`) |

Rails that fail on master: the day-mask digit cases (`:1` to `:7`, `:23456`/`:17`), the joined-text and
constant-`var` cases, the `timeframe.period`/`period` parameter cases, the v3 `input(type=...)` cases,
the "no day list", "overnight", "another timezone" and "malformed day list" cases (on master the
held-function refusal fires first, so the named refusal text differs), and the door shapes
`sess_ownTf`, `sess_join`, `sess_var`, `sw_join` ("the runtime pane builds it").

## Mutation table

Round 1, 15 mutations (`runs/w4-t3/mutate.out`, `mutate2.out`):

| id | mutation | result |
|---|---|---|
| M1 | own timeframe never recognised | killed |
| M2 | own names win over a binding (rebound `period`) | survived, new control added, killed on re-run |
| M3 | a slot named like the timeframe accepted | killed |
| M4 | join returns only the left half | killed |
| M5 | join accepts a per-bar right half | killed |
| M6 | join accepts a per-bar left half | killed |
| M7 | constant `var` wins over a same-named parameter | survived, new control added, killed on re-run |
| M8 | constant `var` never read | killed |
| M9 | `time` lowering ignores a fixed own timeframe | killed |
| M10 | call site does not record the fixed own timeframe | killed |
| M11 | frame constant of the own timeframe is a number | killed |
| M12 | object door gets the join | survived, door shape `sw_join` added, killed on re-run |
| M13 | object door gets the own timeframe | survived: **equivalent**, see below |
| M15 | bare v3 input types not read | killed |
| M16 | a reassigned `var` counts as constant | killed |

M13 is an equivalent mutant. The door gate was removed from `ownTimeframeNameOf` on purpose: its only
readers are `runtimeClockLowering` (which returns `null` at the door, so master's own arm answers) and
the call-site constants of a function held on a session clock, which at the door is never held on a
frame name. Nothing observable differs, and the door shape `sess_ownTf` stays refused.
M14 as first written was a no-op edit; the real one is below.

Fix round (`runs/w4-t3-fix/mutate3.out`, `mutate4.out`, `mutate5.out`):

| id | mutation | result |
|---|---|---|
| R2 | shadow guard removed entirely | killed |
| R3 | tuple names not counted as bindings | killed (conservative-read case) |
| A alone | guard 2 off, guard 1 on | repro still refused; only the conservative case fails |
| A downgraded | guard 2 off, guard 1 replaced by the old same-owner check | killed: the `if` and `for` tuple repros read the outer literal |
| R1 | guard 1 replaced by the old same-owner check, guard 2 on | survived: equivalent while guard 2 holds (every other rebinding form is counted, and `for ... in` is refused by `runtime:loop`); the two rows above prove guard 1 does independent work |
| R4 | digit 1 mapped to Monday (spec mutation, in `pine.js`) | killed (`":1" selects Sunday`, weekend case) |
| M14 | object door gets the constant-`var` map | killed (`cv_int` door shapes) |

## Census (runtime-on lane, 974 rows, base vs tip)

No attached, clean or stuck flip on the runtime-on lane from this change, and 0 attach flips on the
production lane. Six step-0 wall moves, none an attach:

| script | base wall | tip wall |
|---|---|---|
| `initial-balance-ib-and-previous-day-week-high-low-close` | `runtime:history-dynamic-offset` (`res`) | `pine:function`, no day list before v5 |
| `cm-forex-sessions-highlight-v1` | `runtime:history-dynamic-offset` (`res`) | `pine:function`, no day list before v5 (overnight windows are behind it) |
| `ict-killzone` | `runtime:history-dynamic-offset` | `pine:function`, no day list before v5 |
| `kz-boxes` | `runtime:history-dynamic-offset` | `pine:function`, no day list before v5 |
| `session-hilo` | `runtime:statement`, session not a literal | `pine:function`, overnight window |
| `trading-session-indicator` | `runtime:history-dynamic-offset` | `pine:function`, overnight window |

Other changes: `sessions-nephew-sam` (a zone text joined with `+` now folds: three `runtime:clock-zone`
peel steps gone, still unattached) and `volume-profile-free-pro-by-rrb` (a v3 `type=string` input is
now text: the end wall moved to `runtime:na-test`). Production-lane peel-step diffs on
`multi-timeframe-trend-indicator` and `halftrend-longshort-signal-engine-bigbeluga` are `pine:timeout`
under machine load, not this change (the production lane never runs this front end).

Not moved: `nubia-auto-midas-anchored-vwap-xdecow` stays on `len`, a `simple int` through `getMidas`
(T2's wall). `volume-profile-v054beta` needs ternary folding of a `var` text. `smart-money-concepts`
stays on `length` in `findOrderBlocks` (T2). The expected-attach list in `W4-BREAKDOWN.md` T3 is
corrected in this change.

## Capture-queue rows

`docs/pine/capture-queue-2026-11-03-w4-t3.md`, probes under `tools/visual_conformance/probes/`:

| row | probe | chart | settles |
|---|---|---|---|
| W4-T1 | `vw-w4-session-daymask.pine` | `AMEX:SPY 60`, `BITSTAMP:BTCUSD 60` | digit map one digit at a time (1 and 7 unwitnessed) |
| W4-T2 | `vw-w4-session-param.pine` | `AMEX:SPY 5` | a session through a parameter, a join, an input, a constant `var` equals the literal |
| W4-T3a | `vw-w4-session-default-days.pine` (+ `-v4`) | `BITSTAMP:BTCUSD 60` | the meaning of a session with no day list before v5 (lifts the refusal behind `ict-killzone`, `kz-boxes`, `cm-forex`) |
| W4-T3b | `vw-w4-session-overnight.pine` | `BITSTAMP:BTCUSD 60` | overnight windows and which weekday the after-midnight part belongs to |

`docs/pine/vendor-harness/capture-queue.json` is derived and was not regenerated here; the integrator
regenerates it after merging.

## Pre-existing, not fixed here

- The same shadow flaw exists on master's `env` path: `SESS = "..."` without `var` is read through
  `env` by name, so a same-named block local or tuple can be read as the outer text.
- The runtime lane ignores `indicator(timeframe="60")`.

## Engine version

The merge needs a `SCRIPT_ENGINE_VERSION` bump (refusals become served values); the coordinator does it.
`RUNTIME_FRONTEND_VERSION` is unchanged. measure-pair was not re-run for the fix round: the fix only
can only remove served shapes relative to round 1 (a shadowed constant `var`, a shape master refused), so a census row can lose a wall move but cannot gain one or attach.

## Fix-round final-tip

Ran on the desktop, heavy lane 2, in parallel with one other heavy job. Tip `572376edf6`
(tested-on-master `d8d4f0937d`, `git merge-base HEAD origin/master`). Worktree `pine-dsk-w4t3`, label `w4t3-r1-final`.

Command (one heavy job):

```
"$UCT_PY" "$HEAVY_LOCK" run --path C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/dsk/heavy-final2.lock --label w4t3-r1-final --timeout 43200 -- bash <run.sh>
# run.sh: bash docs/pine/parity-programme/scripts/final-tip.sh pine-dsk-w4t3 w4t3-r1-final tests/test_script_engine_version_gate.py
```

Results:

- gate pytest: `46 passed` (rc 0)
- hygiene: clean, 34672 tracked files
- version-gate pytest: `6 passed`
- chart+hooks vitest (`--maxWorkers=2`): `Test Files  1 failed | 1334 passed | 27 skipped (1362)`, `Tests  1 failed | 22418 passed | 118 skipped (22537)`
- the 1 failed file is `src/hooks/pollingSites.rail.test.js`, the known desktop baseline failure; nothing else fails.

Logs: `$UCT_RESUME/runs/w4t3-r1-final/` (`job.out`, `gate.log`, `hyg.log`, `py.log`, `js.log`).
Passed earlier on the fix tree: `w4TextConstants` + `objectDoorGate` 81/81, `runtimeInputKinds` + `runtimeInputs` 88/88,
`runtimeClockCalls` + `textInputs` 38/38; fix-round mutations in `runs/w4t3-fix/mutate3-5.out`.
