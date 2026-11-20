# One deadline for a whole member-door call (evidence, 2026-11-20)

Branch `fix/pine-door-deadline`, cut from master `f2581397fe` (`SCRIPT_ENGINE_VERSION = 89`). NUMBER PENDING (train
e91). The licence-held scripts this unit measured are never committed: the rails use synthetic slow scripts, and the
per-script timings stay in private evidence (the coordinator has them). This page carries the method, the aggregates
and the verdicts.

## 1. Answer first

- **The defect.** The full-population census (engine 87-89) found public scripts that hold a member's tab on the main
  thread for minutes before the member door refuses them by name. `MemberPane.jsx` builds the door synchronously
  (`useMemo`), and every bound the translator had was PER TRANSLATION: `beginTranslateBudget` opens a fresh 10 s
  window for each `translatePine`, and a Resolver built outside a window (the runtime lane's front end) starts its own
  10 s at construction. The door runs many in a row, so one paste bought ~40 budgets. The worker watchdogs start only
  after the door has answered. And one walk had no budget at all: the growing-window fold (section 2).
- **The fix.** ONE deadline bounds the whole `memberPaneDefinition` call, `MEMBER_DOOR_BUDGET_MS = 300000` (5
  minutes). Past it the script is refused BY NAME (`pine:timeout`, the existing code) with a member-readable sentence,
  and a call that ran out of time is refused whole: a picture built while the clock ran out is never served.
- **Why 5 minutes, and why that is a backstop and not a smoothness bar.** Scripts the door SERVES today take up to
  2.6 minutes in this same call on the dev PC (section 3). Any deadline under that refuses served scripts: 60 s would
  refuse 1, 30 s 7, 10 s 14 (runtime-on lane, measured). 5 minutes is about twice the slowest served call, so served
  -> refused is 0. Lowering it is a ruling (it takes pictures away), not a tuning.
- **What moves.** served -> refused: **0** (section 5). Hang -> refused by name: the 3 freezing scripts each refuse
  within the deadline, by name (section 4).
- **The main thread.** No deadline can keep this door under a long task (50 ms): a quarter to a third of the served 679
  line already takes longer (section 6). Taking the build off the main thread is the unit that fixes the freeze; this one
  bounds it.

## 2. The mechanism

- `engine/ast/doorDeadline.js` (a leaf: no imports, no clock of its own) holds the open door window: its deadline, its
  clock, and whether it has TRIPPED. `pine.js::withDoorDeadline(budgetMs, fn, now)` opens one around `fn`.
- While a window is open, every clock limb of `pine:timeout` also asks it: a Resolver's sampled check
  (`checkClock`, every 4,096 steps), the printer's tick, and the output loop's and object pass's
  `translateBudgetExpired`. Once it has tripped, every later resolution step refuses at once (`checkBudget`), with one
  refusal per window thrown again (a fresh refusal captured a stack per catch-and-retry: profiled, ~0.6 s of a 3 s
  trip).
- The walks that did the most work outside a Resolver, found by CPU profile, ask the same window:
  - the round trip's `parse.js` walks (`stableStringify`, `assertCanonical`, `canonicalise`'s `offencesIn` /
    `convert`) tick it: on a synthetic slow script `verifyRoundTrip` held 5.2 s of a 6.4 s call;
  - the growing-window fold (`pine.js::resolveWindowReadOnce`, `step`): a window an `unshift` fills and a
    `while ... pop` bounds is reduced by a fold built by copying tokens, and its running value appears in both arms,
    so the copy doubles each slot. On a public script it was most of a door call of minutes, in no Resolver step and
    under no budget. `step` now charges the door the tokens it carries before the copies are made; the copies are the
    spreads of master, unchanged. ⚰️ Two first attempts, measured and dropped: a copy token by token with a tick per
    token ran that script's call on to the deadline where the spread had finished; a bulk `Array.prototype.concat`
    made the vitest worker exit at once, every time.
  - and the door's own phase boundaries (after the host translation, at the runtime lane's entry).
- `memberPaneDefinition` runs its whole body inside one window and, when it tripped, answers
  `{ ok: false, guard: 'pine:timeout', reason: doorTimeoutSentence(), doorTimedOut: true }` whatever its lanes answered.
- `savedScriptUpgrade.retranslateRow` reads `doorTimedOut` as **inconclusive** (the stored picture is drawn), never as a
  refusal: a deadline is a fact about the device's check, not the script, and a `refused` upgrade is recorded
  server-side and stops drawing the saved copy.
- Closed (no window open: every caller but the member door), nothing reads a clock and every limb answers as before.

The sentence: *"this script is not drawn: checking it took longer than 5 minutes, and the chart stops a check that long
rather than keep the page waiting. That is a limit of this engine, not a mistake in the script."*

## 3. The deadline, chosen from the door times

Measured on the dev PC under the heavy lock, nothing else heavy running, base `f2581397fe`, the promoted library store
(8 versions), the census's flag state per lane, ONE `memberPaneDefinition` call per script (the census row time also
holds peeling, binds and installs). Two populations: the 679 line, and every script of the full population
(`docs/pine/census-full`, PR #2176) that the door served in either lane and whose census row ran over 2 s (215). The
other 2,469 served scripts' census rows ran under 2 s on a runner, which bounds their door call.

| lane | population | served | door p50 | p90 | p99 | max |
|---|---|---:|---:|---:|---:|---:|
| runtime-on | 679 line | 374 | 23 ms | 263 ms | 2.4 s | 22.7 s |
| runtime-on | slow served (215) | 215 | 0.57 s | 4.3 s | 51.9 s | 157 s |
| production | 679 line | 297 | 16 ms | 172 ms | 1.8 s | 2.1 s |
| production | slow served (215) | 113 | 0.39 s | 4.8 s | 44.4 s | 52.9 s |

Served scripts a deadline would refuse (both populations, by lane):

| deadline | runtime-on | production |
|---|---:|---:|
| 10 s | 14 | 9 |
| 30 s | 7 | 4 |
| 60 s | 1 | 0 |
| 120 s | 1 | 0 |
| 200 s | 0 | 0 |
| **300 s** | **0** | **0** |

The slowest served call (157 s, runtime-on) is a script the host lane draws: production answers it in 0.3 s with the
same document (digest equal), so its runtime-on time is the door's exploration of a run half that it then declines.
The next ones (53, 52, 45, 45 s ...) are slow in both lanes: host translations that serve.

## 4. The three scripts that froze

Before (the census agent's probe logs, measured on the dev PC through this same door, 2026-11-20): each was refused
by name only after the tab had been held for minutes (in one lane, over seven). After (head, the same PC, the
promoted store, both lanes):

- with the real deadline, each refuses by name within it: one by the door's own deadline sentence (`pine:timeout`,
  `doorTimedOut`) where it had run for over seven minutes, the others by their own refusals as before, which come
  sooner than the deadline;
- with a 3 s deadline (a probe of the mechanism, not the shipped value), each is refused by name, with the door
  sentence, within 2.3 s of it, in both lanes. The largest overrun is one step of the window fold (its copies are
  made whole once a step has started) plus the unwinding after the trip.

The per-script timings are private evidence (the scripts are licence-held).

## 5. Scoped census, base vs head, both lanes

Every script of both populations, one member-door call each, base `f2581397fe` and head, both lanes, on the dev PC
under the heavy lock (section 3's method). The verdict is the door's answer (`ok`, guard, runtime decline) and a digest
of the whole answer (document, notes, rows, reason).

| lane | population | served base | served head | served -> refused | refused -> served | documents that differ |
|---|---|---:|---:|---:|---:|---:|
| runtime-on | 679 line | 374 | 374 | **0** | 0 | 0 |
| production | 679 line | 297 | 297 | **0** | 0 | 0 |
| runtime-on | slow served (215) | 215 | 215 | **0** | 0 | 2 |
| production | slow served (215) | 113 | 113 | **0** | 0 | 0 |

- The two runtime-on documents that differ are both still served, on the runtime-on lane only (their production
  documents are byte for byte equal), and BASE ITSELF does not repeat them, measured: each run twice at base and
  twice at head, the first gives four different documents in four runs, base and head alike (the host lane draws it
  every time); the second is drawn by the host lane in one base run and by the runtime lane in the other base run and
  in both head runs. So neither difference is this change; both are answers the door gives differently from one
  run to the next (an engine follow-up: a door verdict should not depend on the machine's load). Neither call came
  near the door's deadline.
- The rest of the full population's served scripts (2,469) had census rows under 2 s on a runner, so their door call
  is under the deadline by two orders of magnitude.
- On GitHub runners, the committed corpus (266 scripts) through the door with its window OPEN and with no window,
  interleaved, 3 rounds, both lanes: every document identical (0 of 266 differ, both lanes), and the open window costs
  nothing measurable (total of the per-script minimum: production 48.4 s open vs 48.4 s closed, runtime-on 61.2 s vs
  61.3 s; median per-script ratio 1.002 and 1.003). The pine heavy coverage ratchet checks the same corpus on this PR.
- Base vs head, interleaved, on the dev PC under the heavy lock (the 62 scripts of the 679 line over 200 ms,
  production lane, two rounds each, 4 GB heap): head 76.0 s vs base 81.7 s (sum of each script's faster run; the two
  rounds differ from each other by up to 20%, so this is no change), and all 62 documents equal in all four runs. A
  first comparison of runs made 45 minutes apart read head 17-21% slower: that was the machine, not the change.

## 6. The main-thread block, and whether the build should leave the main thread

The app's long-task bar is the W3C long task, 50 ms (`engine/hostLaneCost.js`). On the 679 line, 119 of the 374
served scripts (runtime-on) and 71 of 297 (production) already take longer than that in this one call; 12 and 5 take
over a second. A deadline is a wall a call runs INTO: it can only bound a block, never shorten one, and every value
that keeps served scripts (section 3) leaves blocks of seconds to minutes on the main thread. So, measured: **the
single deadline cannot keep the main-thread block under the long-task bar**, and the build should leave the main
thread. Not built here (it is not narrow: the door's answer feeds `MemberPane`'s render synchronously, and the kill
list, admission verdicts and library registry it reads live on the page): the next unit, sized by these numbers. Off
the main thread the same window becomes the worker's watchdog, and the deadline can be generous without freezing
anyone.

## 7. Rails and mutants

`builder/memberPane/doorDeadline.test.js` (synthetic scripts only):

- wall clock: a chain whose every line doubles the tree it reads (`a1 = a0 + a0[1]`, depth 17; served, slowly, when
  let finish) is refused by name with the door sentence, after at least the deadline (400 ms) and within the deadline
  plus a 1.5 s slack;
- wall clock: a 19-slot `unshift` window, reduced and guarding a drawing, is refused by name within the same slack
  (on a GitHub runner: 466 ms with the door charge, 4.5 s without it, mutant D7);
- a clock that advances one unit per read (time = the door's own checks, the same on every machine): a chain spread
  over the door's several translations is stopped within 8 checks of half its whole call, so a deadline that restarted
  per translation would serve it;
- controls: a fast script answers byte for byte as under a deadline that never comes; with no window open no clock is
  read and no walk throws; a throw that is not the deadline propagates; a trip never leaks into the next call;
- a saved script whose re-check ran out of time is `inconclusive`, and a real refusal stays `refused`.
- each limb on its own, on a door clock that leaps past any deadline on every read: a Resolver's sampled check asks
  the door (its own clock never moves); the round trip's hash walk ticks it (a 16,383-node canonical tree); a tripped
  call is refused whole even when a lane hands back a document after the trip (`doorAnswer`). ⚰️ Added after the
  first mutant run on the PR: D3, D4 and D5 survived, because the wall-clock rails stop at whichever limb fires first.

Mutants: `ci/mutants/u-door-deadline.json`: D1 no door window, D2 the deadline per translation again, D3 a tripped call
served (a document handed back after the trip), D4 the Resolver's check not asking the door, D5 no `parse.js` walk
ticking, D6 a timed-out saved script refused, D7 the window fold not charging the door. Each was proved red on a
GitHub runner (D1, D2, D6 and D7 by the pine heavy mutant job on the first push; D3, D4, D5 and D7 again by a remote
run of the rail on a detached mutant commit after the limb rails).
