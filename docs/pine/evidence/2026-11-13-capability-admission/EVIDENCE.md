# WS-I Part 2: admission by capability (2026-11-13)

Plan: ENGINE53-PLAN-2026-11-12 section 3. This is a policy slice, not an engine bump: no document the
member door mints changes. `SCRIPT_ENGINE_VERSION` is unchanged.

**Why.** A member's own copy of a script differs by a byte from any graded copy, so the per-script
sha256 allowlist (`api/data/pine_runtime_allowlist.json` `scripts[]` + `PINE_RUNTIME_ALLOWLIST`)
admits nothing a member brings. With `PINE_RUNTIME_CAPABILITY_ADMISSION=on` the browser pane's
runtime lane also admits a script whose EVERY capability is admitted in the committed registry,
each admitted row carrying vendor-graded MATCH evidence. The kill list stays the safety net.

**Shipped DARK.** `PINE_RUNTIME_CAPABILITY_ADMISSION` defaults `off` (ledgered `dark` in
`docs/feature_flags.json`); with it off every answer is the one before Part 2 (proof below).

## What was built

| piece | where |
|---|---|
| ONE detector: `strip_code` / `FEATURES` / `usage_of` MOVED here; `coverage_map.py` re-imports them | `api/services/pine_capabilities.py` |
| `core` (every readable script), the census FEATURES ids, `obj:*` (line, label, box, table, linefill, polyline, delete, getter, collection), runtime-only ids (varip, calc-bars, realtime-state, request-other); over-declares; closed world (`unreadable` for a source the repaint classifier cannot read) | same |
| registry rule: `admitted: true` + `status: conformant` + >= 2 evidence captures from >= 2 scripts, each `{capture, script, verdict: MATCH, runtimePane: on}`; `obj:*` also needs `objectsV2: MATCH` + `objectsLane: runtime` on each | `api/services/rollout_gate.py::pine_capability_admission` |
| `capability_admitted(source) -> (ok, missing)`, `admitted_capabilities()`, `capability_admission_on()` (read per call, only `on` is on), `PINE_RUNTIME_CAPABILITY_DENY` (subtract-only) | `api/services/runtime_definitions.py` |
| `not_graded` admits by capability when ON (never with `graded_only`), so `stamp_served`, the save door and `allow_report` follow; `server_lane_refusal` stays per-script | same |
| `POST /api/user-definitions/runtime-admission {source} -> {sha256, admitted, missing}`; paid; <= 128 KiB UTF-8 (413); stores nothing; never logs or echoes the source; `GET /runtime-kill` carries `capability_admission: true` ONLY while on | `api/routers/user_definitions.py` |
| per-hash verdicts: LRU 64, 60 s re-ask by a consult holding the source, latched only under the script's own hash, fail closed with its own "still being checked" sentence; allowlist first; the lists' re-read carries the switch | `app/src/components/chart/engine/runtimeKill.js` |
| MemberPane latches the switch from the kill read and asks the verdict (250 ms after the source is still), rebuilding on `killVersion` | `app/src/components/chart/builder/memberPane/MemberPane.jsx` |

**`core`, a decision taken here (not in the plan's table).** Without it a script using no listed
feature names nothing and is admitted vacuously: measured, 41 corpus scripts (4 committed, 7
reference, 30 builtin) were admitted with an EMPTY registry, which also breaks "a bad JSON admits
nothing". Every readable script now declares `core`, admitted only on its own evidence (every
runtime-on MATCH capture the run drew: 26 captures, 18 scripts).

## The admitted registry, re-derived

Evidence = a capture that (1) the member door draws with the RUNTIME lane (`capabilityAdmission.
measure.test.js CAPADMIT_MODE=lanes`, a permitted member, every script graded: 38 of 369 captures
take the runtime lane), (2) is graded MATCH runtime-on, (3) whose script uses the capability
(`capabilities_of`). Runtime-on harness re-run at `5885720335` (lock `capadmit`):
`LANE MEASURED: runtime-on ... runtime drew 38, declined 68`; it agrees with the committed snapshot
`docs/pine/vendor-harness/runtime-on/verdicts.json` on every evidence capture (the only 2 changes
in the whole run are `atr-support-and-resistance-{rddt,spy}` INCONCLUSIVE -> MATCH, host lane, used
as evidence for nothing). Full table: `runs/evidence.json`.

**THE ONE RULE (coordinator ruling 2026-11-13), applied to every capability with no exception in
either direction:** >= 2 MATCH captures from >= 2 scripts, drawn by the runtime lane; an `obj:*`
family also needs objects v2 runtime-on MATCH with the run drawing it.

| capability | captures / scripts | admitted |
|---|---:|---|
| core | 26 / 18 | YES |
| reassign | 24 / 16 | YES |
| ternary | 21 / 13 | YES |
| if-block | 21 / 15 | YES |
| var | 19 / 13 | YES |
| fn-single | 19 / 12 | YES |
| fn-multi | 19 / 12 | YES |
| for | 12 / 8 | YES |
| compound-assign | 7 / 5 | YES |
| while | 4 / 3 (Renko Candles Overlay, UCTPROBE_VW_FORIN_COLLECTIONS, UCTPROBE_VW_LOOP_IN_BLOCK) | YES (ruling) |
| typed-array | 4 / 3 (Kalman Price Filter, vw-h4-loops, UCTPROBE_VW_FORIN_COLLECTIONS) | YES (ruling) |
| method-call | 4 / 3 (AlgoAlpha Trend Targets, UCTPROBE_VW_INT_ARRAY_AVG, UCTPROBE_VW_INT_ARRAY_AVG_NEG) | YES (ruling) |
| history-expr | 3 / 2 (D-RSI, Wyckoff) | YES |
| tuple-destructure | 3 / 2 (D-RSI, AlgoAlpha Trend Targets) | YES |
| generics | 2 / 2 (UCTPROBE_VW_INT_ARRAY_AVG, UCTPROBE_VW_INT_ARRAY_AVG_NEG) | YES (ruling) |
| switch | 2 / 1 | NO: one script (fibonacci-dolphintradebot) |
| max_bars_back | 4 / 2 | NO (ruling) |
| conditional-ta | 7 / 4 | NO: `divergent` (R4); one runtime-drawn DIVERGE (vw-deadband-ticks-brk-a) |
| obj:line / label / box / delete / collection / getter / linefill | 13/8, 11/8, 5/3, 9/5, 5/3, 3/3, 2/1 | NO: v1 only, no objects v2 runtime-on MATCH (engine 54's rail) |
| realtime-state, calc-bars | 5/4, 2/1 | NO: runtime-only ids; a historical capture does not grade them |
| table, polyline, varip, request-other, for-in, udt, method-def, enum, import, strategy-decl, library-decl | 0-1 | NO |

## Reach with the flag ON (tests only; the admins stage)

`capabilityAdmission.measure.test.js CAPADMIT_MODE=admission`: the allowlist EMPTY, capability
admission latched ON, a verdict latched per script from the server's own `capability_admitted`.
The test asserts its control: no NOT-admitted script reaches the runtime lane (0 did).
`runs/report.json`.

| population | scripts | admitted | runtime-lane picture | host lane | refused | core only |
|---|---:|---:|---:|---:|---:|---:|
| committed | 266 | 28 | 8 | 17 | 3 | 4 |
| reference | 271 | 64 | 5 | 50 | 9 | 7 |
| builtin | 142 | 51 | 4 | 42 | 5 | 30 |
| **corpus** | **679** | **143** | **17** | 109 | 17 | 41 |
| vendor captures | 369 | 140 | 16 | 81 | 43 | 31 |

(First pass, before the ruling admitted while/typed-array/method-call/generics: corpus 141 admitted,
16 runtime lane; captures 136 / 12.)

"Admitted" is mostly scripts the host lane already draws; admission changes a member's picture only
for the runtime-lane column (and DIV-4 run colours on a host document).

### THE REACH RULE: no capture drawn by the runtime lane may DIVERGE, and no capture may move MATCH->DIVERGE

Coordinator ruling 2026-11-13. Railed by `tests/test_pine_capability_admission.py` (REACH: over the
committed reach run `runs/report.json` and the committed harness snapshots of BOTH lanes,
`docs/pine/vendor-harness/{production,runtime-on}/verdicts.json`, refreshed here from the
`5885720335` runs by the corpus writer) and `capabilityEvidenceLane.test.js` (re-asks the door for
the lane of every admitted capture, so the report's lanes are the door's). Mutants R1-R4 below.

**The 16 admitted captures the runtime lane draws, production -> runtime-on:** adx-and-di-for-v4 x2,
delta-rsi rddt, h3-alma-v4 x2, kalman-price-filter, r1-strategy-draws-indicator, vw-h4-loops x2,
vw-var-seed: INCONCLUSIVE -> MATCH (10); atr-stepped-pdf-ma-loxx, cc-yata, delta-rsi spy, fvg-trend,
nadaraya-watson, vw-array-na: INCONCLUSIVE -> INCONCLUSIVE (6). **No runtime-lane DIVERGE. 0
captures move MATCH -> DIVERGE** (all 364 graded captures). Nothing had to be dropped.

**Admitted but ungraded (no capture of that source): 122** (95 host lane, 17 refused, 10 runtime
lane). The 10 that would newly draw bar by bar with no capture of their own:
committed one-sided-gaussian-support-resistance-rate-loxx; reference heatmap-volume-xdecow,
kaufman-adaptive-bands, laguerre-rsi-v4-lk, parabolic-sar-alerts-on-close-quantnomad,
twiggs-money-flow-lazybear; builtin fisher-transform, mcginley-dynamic,
time-weighted-average-price, williams-fractal.

**Host-drawn DIVERGEs among admitted captures (not stops: the production picture, unchanged):**

| capture | caps | production | runtime-on | same picture both lanes? |
|---|---|---|---|---|
| vw-bgcolor-barcolor-spy | core, ternary | DIVERGE | DIVERGE | identical |
| vw-time-tf-bitstamp-btcusd | core, fn-single, ternary | DIVERGE | DIVERGE | identical |
| vw-int-cast-spy | core, fn-single, ternary | DIVERGE | DIVERGE | identical |
| vw-nvi-pvi-spy-truncated | core, ternary | DIVERGE | DIVERGE | identical |
| vw-rt6-runtime-colour-rddt | core, if-block, reassign, ternary, var | DIVERGE | DIVERGE | plots identical; paints DIVERGE -> MATCH (DIV-4 run colour now agrees) |
| vw-rt6-runtime-colour-spy | same | DIVERGE | DIVERGE | same |

## Flag OFF is byte-identical to master

1. Differential (`flagoff_diff.py`, kept with the run notes, not committed): origin/master's
   `runtime_definitions.py` + its `pine_runtime_allowlist.json` against this branch's, over 1,036
   sources (679 corpus + every capture + the member copy + empty/None) under 72 env combinations
   (stage unset/admins/all x kill list x `PINE_RUNTIME_ALLOWLIST` x capability flag
   unset/`off`/`1` x deny): `allow_list`, `graded_allow_list`, `allow_report`, `kill_list`,
   `stage`, `not_graded` (both modes), `stamp_served` (runtime row and DIV-4 `ast` row),
   `server_lane_refusal`: **47,279 comparisons, 0 differences.**
2. `GET /runtime-kill` with the flag off has exactly the keys `kill`, `allow`, `save_enabled`
   (rail; mutant F1 killed), so no client ever asks the new door.
3. Client: with `capability_admission` absent a latched ADMITTED verdict is ignored and the
   sentence is master's, character for character (rail; mutants C3, C5 killed).
4. `coverage_map.usage_of` after the move equals the pre-move function on all 679 scripts (and
   `FEATURES`, `STRATEGY_ORDERS` equal).

## Mutants (`runs/mutants.json`, run at `9e93df7e56`, after the second master merge; C0 green for both sets)

Method: copy the file, edit, run the focused tests, restore FROM THE SAVED COPY, then `git
hash-object` == the committed blob (every one matched). `.pyc` cleared, `PYTHONDONTWRITEBYTECODE=1`.
C0 (no edit): every focused run GREEN.

| id | mutant | killed by |
|---|---|---|
| A1a | a row not `conformant` admits | test_pine_capability_admission (A1) |
| A1b | one script's captures admit (>= 2 scripts ignored) | A1 |
| A2 | a capability absent from the registry is not counted missing | A2 |
| A3 | the deny variable ADDS what it names | A3 |
| A4 | the verdict door ignores the kill list | A4 |
| A5 | an unreadable / malformed registry fails OPEN | A5 |
| A6a | the detector drops `obj:getter` | test_pine_capabilities (A6, census snapshot) |
| A6b | the detector drops `switch` from FEATURES | A6 |
| A7 | an `obj:*` family admits on plain runtime-on evidence | A7 |
| A8 | an evidence id names a capture that DIVERGEs (data) | A8 |
| A9 | a server lane admits by capability | A9 |
| F1 | flag off: the kill read always carries the switch | OFF rails |
| F2 | flag off: `1` reads on | OFF rails |
| C1 | client: no verdict draws (fails open) | runtimeCapabilityAdmission.test.js |
| C2 | client: latches an answer naming another hash | same |
| C3 | client: a verdict counts while admission is off | same |
| C4 | client: verdicts unbounded | same |
| C5 | client: the lists' re-read drops the switch-off | same |
| L1 | evidence names a capture the HOST lane drew (data) | capabilityEvidenceLane.test.js |
| R1 | a capture the runtime lane draws is graded DIVERGE (data, runtime-on snapshot) | REACH |
| R2 | a capture moves MATCH -> DIVERGE (data, production snapshot) | REACH |
| R3 | the reach run records a runtime-drawn capture as host (data) | capabilityEvidenceLane.test.js (lane re-ask) |
| R4 | the reach run drops an admitted capture (data) | REACH |

All 23 KILLED.

## Not built here (Before Part 2 notes, carried)

- The chart (outside MemberPane) latches the switch and verdicts only after a MemberPane kill read
  in that tab, exactly as the allowlist does today; a stored RUNTIME row is served by the server's
  stamp and does not wait on it, but DIV-4 run colours on a saved `ast` document read the tab's
  verdict and stay refused (host colours) until one is latched. Fail closed.
- Rail-refusal telemetry per script hash (Before Part 2 item d): FOLLOW-UP, not in this PR by
  coordinator ruling; engine 54 (PR #1202) builds run-half refusal telemetry, and capability
  admission's refusals should ride it.
- Pre-existing, not this slice: the member door took 32 s on one corpus script in the admission
  measurement (p50 19 ms, p95 468 ms); the `catch (e)` unused-variable lint error at `MemberPane.jsx:266` and `reachable.test.js`
  "connected to nothing" are red on master too: CONFIRMED by swapping origin/master's copies of this
  PR's `app/src` files in (MemberPane.jsx, runtimeKill.js; the three new test files removed): eslint
  reports the same error at master's line 240 and reachable fails the same test; every file then
  restored from the saved copy, `git hash-object` == HEAD blob.
