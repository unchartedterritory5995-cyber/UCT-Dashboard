# WS-I Part 2: admission by capability (2026-11-13)

Plan: ENGINE53-PLAN-2026-11-12 section 3. A policy slice, not an engine bump: no document the
member door mints changes, and `SCRIPT_ENGINE_VERSION` is unchanged.

**Why.** A member's own copy of a script differs by a byte from any graded copy, so the per-script
sha256 allowlist (`api/data/pine_runtime_allowlist.json` `scripts[]` plus `PINE_RUNTIME_ALLOWLIST`)
admits nothing a member brings. With `PINE_RUNTIME_CAPABILITY_ADMISSION=on`, the browser pane's
runtime lane also admits a script when EVERY capability it uses is admitted in the committed
registry, and each admitted row carries vendor-graded MATCH evidence. The kill list stays the
safety net.

**Shipped DARK.** `PINE_RUNTIME_CAPABILITY_ADMISSION` defaults to `off` and is ledgered `dark` in
`docs/feature_flags.json`. With it off, every answer is the one before Part 2 (proof below).

This document reflects:
- the coordinator's rulings;
- the CHANGES-REQUIRED review of PR #1204 at head 3799bb8ab5: B1, C1, C2, C3, the
  evidence-quality ruling, the endpoint notes and the D note;
- the re-verify at 4e30752e41: the serving cost with the flag on, and the evidence-classifier
  hardening;
- the final verify at 761c0747f6 (approved to merge dark): the process-wide detector gate, the
  0.9 s edge, the pending wording, and the notes before arming;
- the re-review at 94daaefe6c: F1 (the save door), F2 (verdict-door starvation), F3 and F4.

## What was built

| piece | where |
|---|---|
| ONE detector. `strip_code` / `FEATURES` / `usage_of` MOVED here from `coverage_map.py`, which re-imports them. | `api/services/pine_capabilities.py` |
| Vocabulary: `core` (every readable script), the census FEATURES ids, `obj:*`, `collections:{array,matrix,map}`, and the runtime-only ids. It over-declares. CLOSED WORLD: `unreadable` is returned for a source over 128 KiB or one the repaint classifier cannot read. | same |
| **LINEAR (B1).** `conditional-ta` is a line scan (`conditional_ta_in`, with a stack of open block indents). Every line-anchored FEATURES row opens with a possessive `^[ \t]*+`. Wrapped lines are folded first (`join_continuations`, C2). | same |
| Registry rule: `admitted: true` + `status: conformant` + at least 2 captures from at least 2 DISTINCT script families, at least one of them a COMMUNITY script. Each entry is `{capture, script, community, verdict: MATCH, runtimePane: on}`. An `obj:*` entry also needs `objectsV2: MATCH` + `objectsLane: runtime`. | `api/services/rollout_gate.py::pine_capability_admission`, `pine_evidence_script` |
| `capability_admitted(source) -> (ok, missing)`; `admitted_capabilities()`; `capability_admission_on()` (read per call; only `on` is on); `PINE_RUNTIME_CAPABILITY_DENY` (subtract-only) | `api/services/runtime_definitions.py` |
| `not_graded` admits by capability while ON (never with `graded_only`). `stamp_served`, the save door and `allow_report` therefore follow. `server_lane_refusal` stays per-script. | same |
| **Serving cost (re-verify).** Each source's capability set is computed ONCE and PERSISTED (`runtime_capabilities` in user_definitions.db: source sha256, `pine_capabilities.DETECTOR_VERSION`, the ids; no member identifier). It is written at the save door (flag on) and backfilled on first serve. In front of it sits a TRUE LRU (4096), a fallback only. A request does at most `DETECTOR_RUNS_PER_REQUEST` = 8 fresh detector runs, and starts none after `DETECTOR_SECONDS_PER_REQUEST` = 0.3 s of detector time. A row past the budget is served fail-closed ("still being checked") and fills on a later request. History asks the capability question of the LATEST version only. The verdict door computes but stores nothing (`persist=False`). With the flag OFF, none of this runs and the table is never created. | `api/services/runtime_definitions.py` (`capabilities_for`, `DetectorBudget`), `api/routers/user_definitions.py` (list, history) |
| `DETECTOR_VERSION` + `detector_fingerprint()`: a sha256 over every FEATURES row, the vocabulary, every compiled pattern, the namespaces, the cap and the repaint rule table. The rail is red while the recorded fingerprint and the version disagree, so a changed regex can never be served from sets an older detector computed. | `api/services/pine_capabilities.py` |
| `POST /api/user-definitions/runtime-admission {source} -> {sha256, admitted, missing}`. Paid-only. **Rate-limited per member: `RUNTIME_ADMISSION_MAX_PER_MINUTE` = 60/min** (`_charge_runtime_admission`, charged before any work). At most 128 KiB UTF-8 (413). The body is any JSON, checked by hand, so a non-object body or a script is never echoed. Stores nothing and never logs. **With the flag OFF it answers `{admitted: false, missing: []}` without running the detector.** `GET /runtime-kill` carries `capability_admission: true` ONLY while the flag is on. | `api/routers/user_definitions.py` |
| Per-hash verdicts: LRU 64; re-asked after 60 s by a consult that holds the source; latched only under the script's own hash; fails closed with its own "still being checked" sentence; allowlist first; the lists' re-read carries the switch. | `app/src/components/chart/engine/runtimeKill.js` |
| MemberPane latches the switch from the kill read, asks for the verdict once the source has been still for 250 ms, and rebuilds via `killVersion`. | `app/src/components/chart/builder/memberPane/MemberPane.jsx` |

**`core` (accepted by ruling).** Without it, a script using no listed feature would name nothing and be
admitted vacuously, even by an empty or unreadable registry. Every readable script now declares
`core`, and `core` is admitted only on its own evidence.

**What `core` covers, plainly (C1).** Core admits every built-in the runtime implements: ta.*, str.*,
math.*, timeframe.*, plotshape, and the rest. The exceptions are the collection namespaces, which
are their own capabilities here: `collections:array` is admitted on its own evidence, while
`collections:matrix` and `collections:map` have zero runtime-on captures and are not admitted.
For the other built-ins the safety net is:
- the runtime front end's named refusals (`pine:builtin`, `runtime:conditional-history`, ...);
- the graph/runtime differential.

**FOLLOW-UP:** per-built-in evidence. Nothing in this slice grades an individual built-in.

## The admitted registry, re-derived

Evidence is a capture that meets all three conditions:
1. The member door draws it with the RUNTIME lane (`capabilityAdmission.measure.test.js
   CAPADMIT_MODE=lanes`: a permitted member, every script graded; 38 of 369 captures).
2. It is graded MATCH runtime-on (harness re-run at `5885720335`; the snapshot in
   `docs/pine/vendor-harness/runtime-on/verdicts.json` is that run).
3. Its script uses the capability (`capabilities_of`).

**THE ONE RULE (coordinator rulings 2026-11-13).** It applies to every capability, with no exception
in either direction:
- at least 2 MATCH captures from at least 2 DISTINCT scripts. A probe and its own variant are one
  script: `UCTPROBE_VW_INT_ARRAY_AVG` and `..._AVG_NEG`, or `_V5`;
- at least one counted script is a COMMUNITY script, not a `UCTPROBE_` / `vw-` probe. Probes still
  count as captures;
- an `obj:*` family additionally needs objects v2 runtime-on MATCH with the run drawing it.

The full table is in `runs/evidence.json`.

| capability | captures / distinct scripts / community | admitted |
|---|---:|---|
| core | 26 / 17 / 10 | YES |
| reassign | 24 / 16 / 10 | YES |
| ternary | 21 / 13 / 10 | YES |
| if-block | 21 / 14 / 9 | YES |
| var | 19 / 13 / 8 | YES |
| fn-single | 19 / 11 / 8 | YES |
| fn-multi | 19 / 11 / 8 | YES |
| collections:array | 15 / 9 / 6 | YES (C1) |
| for | 12 / 8 / 4 | YES |
| compound-assign | 7 / 5 / 3 | YES |
| while | 4 / 3 / 1 (Renko; probes VW_FORIN, VW_LOOP_IN_BLOCK) | YES |
| typed-array | 4 / 3 / 1 (Kalman; probes vw-h4-loops, VW_FORIN) | YES |
| method-call | 4 / 2 / 1 (AlgoAlpha Trend Targets; probe family VW_INT_ARRAY_AVG) | YES |
| history-expr | 3 / 2 / 2 (D-RSI, Wyckoff) | YES |
| tuple-destructure | 3 / 2 / 2 (D-RSI, Trend Targets) | YES |
| generics | 2 / 1 / 0 (one probe family) | NO: no community script, one family |
| collections:matrix, collections:map | 0 | NO: no capture |
| switch | 2 / 1 / 1 | NO: one script |
| max_bars_back | 4 / 2 / 2 | NO (ruling) |
| conditional-ta | 7 / 4 / 4 | NO: `divergent` (R4); one runtime-drawn DIVERGE (vw-deadband-ticks-brk-a) |
| obj:line / label / box / delete / collection / getter / linefill | v1 only | NO: no objects v2 runtime-on MATCH (waits for engine 54's rail) |
| realtime-state, calc-bars, varip, request-other | | NO: runtime-only; a historical capture does not grade them |

## Reach with the flag ON (tests only; the admins stage)

`capabilityAdmission.measure.test.js CAPADMIT_MODE=admission` runs with the allowlist EMPTY,
capability admission latched ON, and a verdict latched per script from the server's own
`capability_admitted`. Its control holds: no NOT-admitted script reaches the runtime lane.
Results: `runs/report.json`.

| population | scripts | admitted | runtime-lane picture | host lane | refused | core only |
|---|---:|---:|---:|---:|---:|---:|
| committed | 266 | 26 | 7 | 17 | 2 | 4 |
| reference | 271 | 64 | 5 | 50 | 9 | 7 |
| builtin | 142 | 51 | 4 | 42 | 5 | 30 |
| **corpus** | **679** | **141** | **16** | 109 | 16 | 41 |
| vendor captures | 369 | 139 | 15 | 81 | 43 | 31 |

How the reach moved:
- Earlier passes: 141 / 16 (first build), then 143 / 17 (while, typed-array, method-call and
  generics admitted).
- This review pass removes one-sided-gaussian-loxx (it uses matrix) and the vw-array-na capture
  (generics).

### THE REACH RULE: no capture drawn by the runtime lane may DIVERGE, and no capture may move MATCH->DIVERGE

The rule comes from the coordinator ruling of 2026-11-13. Two rails enforce it:
- `tests/test_pine_capability_admission.py` (REACH) reads the committed reach run and the committed
  harness snapshots of BOTH lanes.
- `capabilityEvidenceLane.test.js` re-asks the door for the lane of every admitted capture.

**The 15 admitted captures drawn by the runtime lane, production -> runtime-on:**
- INCONCLUSIVE -> MATCH (10): adx-and-di-for-v4 x2, delta-rsi rddt, h3-alma-v4 x2,
  kalman-price-filter, r1-strategy-draws-indicator, vw-h4-loops x2, vw-var-seed.
- INCONCLUSIVE -> INCONCLUSIVE (5): atr-stepped-pdf-ma-loxx, cc-yata, delta-rsi spy, fvg-trend,
  nadaraya-watson.
- **0 runtime-lane DIVERGE. 0 MATCH -> DIVERGE** across all 364 graded captures.

**Admitted but ungraded (no capture of that exact source): 120.** 95 are host lane, 16 refused, and
9 runtime lane. The 9 that would newly draw bar by bar without a capture of their own:
- reference: heatmap-volume-xdecow, kaufman-adaptive-bands, laguerre-rsi-v4-lk,
  parabolic-sar-alerts-on-close-quantnomad, twiggs-money-flow-lazybear;
- builtin: fisher-transform, mcginley-dynamic, time-weighted-average-price, williams-fractal.

The review checked these against independent reference implementations and found agreement to 1e-6.

**D note: heatmap-volume-xdecow's five default `fill()` heatmap zones.** They are not drawn on the
runtime lane, and the member door DISCLOSES that. It is not a silent drop. Its "Not drawn by this
pane" note reads:

> This script also writes a fill between two plots, which a script drawn bar by bar does not draw
> here yet. Its lines are drawn; those are not.

This is how every runtime-lane fill is handled (WS-E, `memberPaneDefinition.js`, the `undrawn`
note). The wording is kind-level and singular: it says "a fill" for five zones and does not name
them by title.

**FOLLOW-UP:** name each undrawn fill by title. That changes the documents the door mints, so it
needs an engine bump and is out of this slice.

**Host-drawn DIVERGEs among admitted captures.** These are not stops: each is the production
picture, unchanged.

| capture | production | runtime-on | same picture both lanes? |
|---|---|---|---|
| vw-bgcolor-barcolor-spy | DIVERGE | DIVERGE | identical |
| vw-time-tf-bitstamp-btcusd | DIVERGE | DIVERGE | identical |
| vw-int-cast-spy | DIVERGE | DIVERGE | identical |
| vw-nvi-pvi-spy-truncated | DIVERGE | DIVERGE | identical |
| vw-rt6-runtime-colour-rddt | DIVERGE | DIVERGE | plots identical; paints DIVERGE -> MATCH (DIV-4 run colour now agrees) |
| vw-rt6-runtime-colour-spy | DIVERGE | DIVERGE | same |

**FOLLOW-UP (proposed, not built): a scheduled re-measure.** REACH reads COMMITTED snapshots. An
engine change that makes a runtime-lane capture DIVERGE is therefore caught only when someone
refreshes them. Proposal: a weekly job under the heavy lock that does three things:
1. re-runs both harness lanes and the reach run;
2. diffs the result against the committed snapshots;
3. raises an alert (not a commit) on any runtime-lane DIVERGE or MATCH->DIVERGE.

## B1: one request must never freeze the pod (review blocker)

**Cause.**
- `runtime_admission` ran the detector before it read the flag.
- `COND_TA_RX` was a lazy group of block lines over a back-referenced indentation, and it
  backtracked super-linearly.
- The `^\s*` FEATURES rows under `re.M` restarted from every blank line, which is quadratic.
- Python `re` holds the GIL and the route is sync, so one paid POST stalled the single uvicorn
  process.

**Measured on the pre-fix detector:**
- the reported shape (`x = if c` at indent 160): 0.18 s / 0.77 s / 3.33 s at 4 / 8 / 17 KB
  (super-linear);
- the review measured 15.3 s at 33.8 KB and 230 s at 126 KB through the endpoint;
- 16 KB of blank lines: 56 s.

**Fixes:**
- (a) Flag OFF: the door answers a constant without the detector (railed: a detector that raises
  is never called).
- (b) The line scan and possessive anchors, plus an audit of every regex in the module and in the
  code it shares with `tools/pine_coverage`. Each remaining pattern is anchored or bounded:
  `METHOD_CALL_RX` and the identifier scan start only at word starts and never fail-backtrack;
  `[^()]*` and `[\w\s,]+` stop at the next bracket; `\?[^?:\n]+:` stops at the next `?`.
- (c) The per-member rate limit (60/min).
- (d) The time rail, described next.
- (e) The size bound: the detector reads at most 128 KiB, the runtime document's own cap, and
  returns `unreadable` past it. Per-row paths (`stamp_served`, `not_graded`) run the detector only
  while ON, only after an allowlist miss, cached per source sha256, linear and capped.

**The time rail** is in `tests/test_pine_capabilities.py`:
- B1_0: the reported 33.8 KB shape, under 250 ms (measured ~0.03 s).
- B1_1: blank lines and whitespace lines, under 250 ms.
- B1_2: fourteen adversarial 128 KiB shapes, each under 1 s. The shapes: deep indentation,
  repeated `x = if c`, one long line, long spaced words, nested brackets, blank and whitespace
  lines, unclosed calls, tuple opens, `?` runs, function headers, else chains, wrapped
  continuations.
- B1_3: linear scaling, at most 8x the time for 4x the source.

Locally every 128 KiB shape takes 0.17 to 0.30 s. About half of that is the repaint classifier's
lexer, which is linear (0.05 / 0.10 / 0.24 s at 32 / 64 / 128 KB) and already runs on master's save
path. The 1 s bound leaves headroom for a slower CI runner.

**Census impact.** `usage_of` was identical after the move. The B1/C1/C2 changes then widened it on
purpose:
- `generics` +36 and `conditional-ta` +1 (a wrapped function header);
- the collection namespaces are new;
- 7 scripts over 128 KiB now read as `unreadable`.

Nothing else was lost. The A6 census snapshot was regenerated, and the detector never names fewer
capabilities than the census, except the over-cap scripts, which are admitted as nothing.

## Serving cost with the flag ON (re-verify of #1204 at 4e30752e41)

**Before.** The reviewer measured these, all flag ON:
- `stamp_served` over 200 near-128 KiB rows: 53 s cold;
- 300 rows: 79 s, then 87 s on the second pass (the 256-entry FIFO missed every source again);
- history stamped every stored version; the list stamped up to 50 rows (about 13 s cold);
- the cache was process-wide.

**After** (`serve_timings.py`, kept with the run notes; 100 KB sources):

| case | time |
|---|---:|
| list, 50 near-cap rows, cold, flag ON (server-lane stamp held still, below) | **0.53 s** (filled after 24 requests; warm 0.12 s) |
| `stamp_served` 200 rows with one request budget: cold / second pass | 0.76 s / 0.68 s |
| `stamp_served` 300 rows with one request budget: cold / second pass | 0.84 s / 0.84 s |
| verdict-door path (LRU, nothing stored), 300 near-cap sources: first / second pass | 51.4 s / **0.03 s** |
| history, 300 versions, cold | under 1 s (rail), 1 detector run |

**The rails** in `tests/test_pine_capability_admission.py`, all flag ON:
- SERVE list: 50 near-cap rows, cold, under 1 s; at most 8 runs; the rest are served "still being
  checked"; they fill on later requests; each source is computed exactly once.
- SERVE history: 300 versions under 1 s, with exactly 1 detector run.
- SERVE sweep: 300 sources twice; the second pass takes at most 1/4 of the first.
- Also railed: the true-LRU eviction order; the budget's run and time limits; a row saved with the
  flag on is never re-run on the hot path; a set stored by an older `DETECTOR_VERSION` is
  recomputed; the fingerprint.

Mutants S1-S8 are below.

**Pre-existing master cost, not admission (reported, not changed here).** With the flag OFF, the
list endpoint over the same 50 near-cap runtime rows takes **9.7 s**:
- The cost is `svc.server_lanes_stamp`: `server_lane_composition` calls `request_reads`, which
  calls `runtime_repaint_of`, three lexer runs per runtime row (150 calls).
- It is master code, unrelated to this flag, which is why the list rail holds it still.
- **FOLLOW-UP:** persist `request_reads` per source sha256, on the same pattern as the capability
  sets. **DONE 2026-11-13** as an in-process memo of the repaint lex: see "The repaint memo" below.

**Evidence classifier hardening.**
- `PINE_PROBE_PREFIXES` = `uctprobe`, `vw-`, `probe-`, `uct-`, compared lowercased on the title or
  the capture id.
- Variant suffixes: `v<n>` / NEG / POS / ALT after `_`, `-` or a space.
- These now classify as ours, not community:
  - `probe-default-colour-v3/v4/v6` and `probe-sparse-rows`;
  - the legacy `uct-dmi`, `rsi-atr`, `sma-ema`, `hma-macd`, `rma-wma` and `stoch-parity-v1`
    captures;
  - `UCTPROBE L1 library import`.
- Railed. Re-derived: `runs/evidence.json` and the registry are byte-identical, so **no admitted
  capability changes**. None of those captures is runtime-lane evidence.

## Final verify of #1204 (761c0747f6): concurrency, the 0.9 s edge, pending rows

**A2 concurrency.** Measured by the reviewer: 8 members x 50 distinct cold rows, threadpool 8,
3.5-5.1 s per request. The per-request budget bounds one request, but the detector holds the GIL.
Two process-wide controls, both NON-BLOCKING:
- **The gate.** A `threading.Semaphore(1)` taken without waiting, so one detector run at a time.
- **A duty cycle on top of it.** After a run of cost c, no run starts for 2c, so the detector uses
  at most 1/3 of wall time. The gate alone was not enough: 8 cold lists each took 3.8 s, because
  they took the gate in turn and each waited out the other seven runs under the GIL.

A request that finds the gate busy, or the detector cooling down, serves the row "still being
checked" and moves on.

How each door behaves when the gate is busy or cooling (as revised by the re-review, below):
- **The save door** waits at most `SAVE_WAIT_SECONDS` = 0.7 s for the gate and the cool-down and
  runs the detector once. If it still cannot, it is refused as busy: `CapabilityCheckBusy`, a 503
  with Retry-After and "try again in a moment", and nothing is saved. **D6 holds: an unadmitted
  runtime row is never stored** (re-review F1; the earlier "store it and backfill" is withdrawn).
- **The verdict door** answers `missing: ["pending"]`. The client never latches that answer; it asks
  again (5 x 1.5 s), and until then the row reads "still being checked" (fail closed).

**The 0.9 s edge.**
- A run is PROJECTED before it starts: source bytes times a running per-byte estimate (an
  exponential average of measured runs, seeded at 5 us/byte). It does not start if spent plus
  projected would exceed 0.3 s.
- The first run of a request is always allowed; otherwise a large source would never be checked.
- A source over 64 KiB gets at most ONE fresh run per request.

**Pending rows.**
- A pending row is stamped `meta.runtimePending: true` beside the "still being checked"
  `meta.runtimeNotGraded`. The flag is dropped with the other run-read stamps by the share strip.
- The install door words it on its own: "it is being checked, and it will draw once the check
  completes" (never "comes back when it is taken off the list").
- **It clears by itself.** The definitions list had NO periodic read: SWR, no `refreshInterval`,
  `revalidateOnFocus: false`. It now re-reads every 15 s ONLY while a row is pending
  (`useUserDefinitions.pendingRefreshInterval`; polls pause while the app is hidden, through the
  app-wide `isVisible`). Otherwise there is no periodic read, as before.
- A cold member with 50 adversarial near-cap rows is fully checked after 50 list reads, one big
  source per read, so about 12.5 minutes of 15 s re-reads.

**Serving costs cut on the way.** A stamped row copies only `meta`, instead of a JSON round trip
of the whole script. The list prefetches its stored sets in ONE query (misses are not looked up
again). The admitted set is read once per request.

**Timings (flag ON; `timings_final.py`, kept with the run notes):**

| case | time |
|---|---:|
| detector on adversarial near-cap shapes (unclosed calls, spaced words, eq runs, tuple opens; 126 KB) | 0.22-0.36 s here (the reviewer saw up to 0.63 s) |
| list, 50 adversarial near-cap rows, cold, one request | **0.44 s** |
| rail: 8 concurrent cold lists x 12 adversarial rows | each **< 1 s** (about 0.5 s), exactly 1 detector run |
| 8 concurrent cold lists x 50 adversarial near-cap rows, flag ON | 0.88-0.94 s each in the final run; 1.1-1.3 s in earlier runs on this shared box |
| the same 8 x 50, flag OFF (no detector at all) | 0.62-0.85 s each: pre-existing list work under the GIL |

That last load sits near 1 s whatever admission does: the plain list work alone is ~0.75 s, and one
0.3 s detector run per burst is shared by every concurrent request through the GIL.
**FOLLOW-UP:** run the detector in a worker process, off the request GIL, if admission ever serves
members with many near-cap scripts.

**Rails (flag ON), all in `tests/test_pine_capability_admission.py`:**
- GATE 8 concurrent: each request < 1 s, exactly 1 detector run.
- GATE run in progress: deterministic; a second run is refused at once while one holds the gate.
- GATE busy gate: the row is served pending, without waiting, and the verdict door answers pending.
- GATE save while busy: the row is stored, nothing is persisted, and the first serve computes the
  set.
- GATE projected: a 60 KB row first, then no big run after it.
- GATE one big source per request.

Client rails:
- `runtimeCapabilityPending.test.js`: the install-door wording; the refresh only while a row is
  pending; the hook is wired.
- `runtimeCapabilityAdmission.test.js`: a pending verdict is never latched and is retried.

Mutants G1-G9 and the re-run of S1-S8 are listed below.

**Re-checked after engine 54 landed** (origin/master merged in at `6a7fbceca4`). The runtime-on
harness was re-run under the heavy lock: `runtime drew 38, declined 68`, the same as before.
- Only 2 verdicts changed: `atr-support-and-resistance-{rddt,spy}` went MATCH -> INCONCLUSIVE.
  Neither is admitted, and it is the same pair that flipped the other way between the 11-10 and
  11-13 snapshots.
- 0 admitted runtime-lane DIVERGE, 0 MATCH -> DIVERGE, and every evidence capture is still MATCH.
- The live lane rail re-derived all 140 admitted captures' lanes under engine 54: unchanged.

## Re-review of #1204 (94daaefe6c): F1-F4

- **F1, the save door (MEDIUM).** Previously a save stored an unadmitted source while the gate was
  busy or cooling, which broke D6. Now the save waits, bounded, then refuses retryably:
  `not_graded_at_save` -> `not_graded_reason(wait=0.7)` -> `capabilities_for(wait=...)` (a blocking
  `acquire(timeout)`, then waiting out the cool-down if that fits the deadline). Still busy:
  `CapabilityCheckBusy` -> 503 + Retry-After. Rails:
  - gate held 1.7 s: the save is refused within the bound, nothing is stored, no set is persisted,
    and the route answers 503;
  - gate held 0.2 s: the save waits, checks and stores, and the set is persisted;
  - an unadmitted script: refused, nothing stored.
- **F2, verdict-door starvation (MEDIUM).** Three changes:
  - A per-member budget: `VERDICT_MEMBER_SECONDS` = 3 s of detector time in a rolling
    `VERDICT_MEMBER_WINDOW` = 60 s, answering pending when exhausted. The route passes the caller's
    id.
  - Persisted work has priority. The verdict door runs only when the gate is free and the persisted
    cool-down has passed; it has its OWN cool-down (`VERDICT_DUTY_CYCLE` = 1/6 of wall time); and a
    verdict run does NOT extend the persisted cool-down.
  - The client re-asks no-verdict sources on the 60 s recheck (`runtimeNotGradedOf`, at most once
    per interval per hash). MemberPane keeps asking through `watchRuntimeAdmission` until a verdict
    lands, so the preview recovers without an edit or remount.
  - Rails:
    - one member hammering the verdict door with distinct near-cap sources cannot stop another
      member's save (stored, never refused as busy) or another member's serve (checked within a few
      reads); the hammer itself is held back (pending) and stays inside its budget;
    - the member budget;
    - a verdict run yields to a serve;
    - the route charges the caller;
    - the client re-ask and the watcher, and that the watcher is wired into MemberPane.
- **F3 (LOW).** `_not_graded_for_stamp` with no budget (`GET /{def_id}`, the share view) now returns
  `not_graded_reason(...)` while the flag is on, so pending rows are marked `runtimePending` there
  too (railed).
- **F4 (LOW).** The served stamps (`runtimeKilled` / `runtimeNotGraded` / `runtimePending`) are
  scrubbed from a runtime row at save (`_save_runtime` -> `scrub_served_stamps`) and on the runtime
  serve path (`stamp_served` drops them before applying today's), so a written-back stamp can never
  pin a row (railed).
  - ⚠️ This is the one deliberate flag-OFF behaviour change in the PR. A runtime row that carries a
    stamp a client wrote back is now stored and served without it. Master stored it and served it
    as-is, which refused a graded script forever. The `ast` run-read path already dropped stale
    stamps on master. The flag-off differential (rows carrying no written-back stamp) still shows 0
    differences.
- **Mutants F1a-F4b** (12 in all) are listed below, all KILLED. The gate set G1-G9 was re-run on
  this code: G1 and G2 were re-anchored to the new acquire path; G5 was retired because the
  store-on-busy behaviour it guarded is gone, and F1b covers the save door now.

## Before arming (notes; not built here)

- ~~**HARD PRECONDITION before `PINE_RUNTIME_SAVE_ENABLED` is ever set:** the server-lane stamp's
  cost.~~ **MET 2026-11-13 (PR perf/pine-runtime-stamp-memo): "The repaint memo" below.** Was: Listing 50 near-cap runtime rows costs 16.8 s (the reviewer's measure, flag on or off; 9.7 s
  measured here). The cause: `svc.server_lanes_stamp` -> `server_lane_composition` ->
  `request_reads` -> `runtime_repaint_of`, which re-lexes each runtime row three times per serve.
  **Named follow-up: "memoise the repaint lex per source hash"** (the same pattern as the
  persisted capability sets). It is master code and needs no capability admission to bite.
- **Optional:** garbage-collect `runtime_capabilities` rows whose source hash no live row (or live
  run half) references. Today they accumulate one small row per distinct source ever served or
  saved with the flag on.

## The repaint memo (2026-11-13): the precondition before `PINE_RUNTIME_SAVE_ENABLED`, MET

**What.** `runtime_repaint.runtime_repaint_of` is memoised per source in ONE bounded LRU
(`_MEMO`, `REPAINT_MEMO_MAX` = 2048 entries), keyed by `(sha256 of the source, CLASSIFIER_VERSION,
sha256 of RULES)`. Every server consumer of the classifier already went through that function (the
save door's `validate`, `repaint_stamp`, `request_reads` once per server lane, and
`pine_capabilities.capabilities_of`), so there is one cache and no caller changed. The classifier
itself is `_classify` (uncached), called only by the memo. The cache holds the small answer, never
the source, and every call returns a deep copy, so a caller cannot mutate what the next one reads.
`SCRIPT_ENGINE_VERSION` and `DETECTOR_VERSION` are not in the key: the answer depends on neither
(it is a function of the text, this module's rules and its table; the clock leaves' reach is the
host linter's per-process constant, `_HOST_CLOCK`). A rule change bumps `CLASSIFIER_VERSION`.

**Bounded in bytes (review of #1226).** The answer's `reads` carry identifier text from the source,
so a hostile 128 KiB script answers with megabytes. The review measured 10,922 distinct identifiers
at 3.64 MB per entry, and one 128 KiB identifier at 263 KB. The verdict door lets any paid member
ask about a fresh source.
- An answer over `REPAINT_MEMO_MAX_ANSWER_BYTES` (4 KiB serialised), or with more than
  `REPAINT_MEMO_MAX_READS` (64) reads, is never memoised: it is computed, returned and forgotten,
  the cost before the memo.
- The LRU is bounded by `REPAINT_MEMO_MAX_BYTES` (32 MiB) as well as by entries, so it holds at
  most ~8 MiB in practice.
- No identifier text is truncated: the answer stays the JS module's, byte for byte.
- `_RULES_FP` is one tuple computed at import and swapped whole.
- Rail M6 now walks `api/`, `tools/` and `scripts/` by AST and sees every way of reaching `lex`
  or `_classify`: a `from ... import` of the name, a module alias, a dotted path or `getattr`.

**Measured** (50 distinct near-cap 100 KiB runtime rows; `stamp_served` + `server_lanes_stamp`
per row, as the list serves them; flag OFF; one heavy-lock hold, A/B interleaved, two rounds; the
box was shared, so the spread is load):

| | lexes | cold | warm (second pass) |
|---|---|---|---|
| before (memo bypassed) | 150 per pass | 11.0 s / 8.9 s | 8.4 s / 7.7 s (150 lexes again) |
| after | 50 (one per distinct source) | 2.7 s / 4.0 s | **0.069 s / 0.067 s** (0 lexes) |

The cold pass is now exactly one lex per distinct source; what remains cold is the lexer itself
(~50-80 ms per 100 KiB, a char-by-char mirror of the JS `lexRepaint`, unchanged here). The full
list endpoint over the same 50 rows, server lanes included: one lex per row on the first request,
none on the second, same body (`test_SERVE_the_list_with_50_near_cap_rows_lexes_each_source_once_server_lanes_included`,
5.0 s for the whole test including two requests and the 50-row seed).

**Flag-off output is byte-identical.** A differential over every runtime fixture (the 266 corpus
scripts' `runtime_repaint_of` + `capabilities_of`; the 6 runtime documents and each corpus script
as a runtime document through `request_reads`, `repaint_stamp`, `validate`, `server_lanes_stamp`,
`stamp_served` and `consumer_refusal` for six consumers; plus a warm second pass) was written to
JSON from master's code and from this branch's: **6,833,325 bytes, `cmp` identical.**

**Rails** (`tests/test_runtime_repaint_memo.py`, plus the list rail in
`tests/test_pine_capability_admission.py`):
- M1 one lex per distinct source across every server consumer, none warm (50 near-cap rows: the
  call count is exact; wall-clock bounds are generous, warm < 1 s); the same source in ten rows
  lexes once.
- M2 a `CLASSIFIER_VERSION` bump recomputes; a different `RULES` table recomputes and answers by it.
- M3 the LRU is bounded and evicts the least recently USED; it holds no source text.
- M4 a caller mutating its answer does not change the next answer.
- M5 the memoised answer equals `_classify` for all 266 corpus scripts, cold and warm (and an
  unreadable source is answered the same both ways).
- M6 one authority: nothing in `api/` calls `runtime_repaint.lex` or `_classify` but the memo.

**Mutants (all KILLED):** listed in the PR body with each one's failing rail.

## C2 / C3 / endpoint

- **C2.** `join_continuations` folds Pine's wrapped lines before scanning: a line where `(` or `[`
  is still open, or one indented deeper by a non-multiple of 4. It folds them into the logical
  line they continue. Railed:
  - `f(a,\n  b) =>\n    ta.sma(a,b)` -> conditional-ta;
  - `x = c\n  ? a\n  : b` and `x = c ?\n  a :\n  b` -> ternary;
  - a wrapped `if` header;
  - a continuation at top level is NOT a block.
- **C3.**
  - An unterminated-string source (where the repaint classifier returns `ok: false`) comes back
    from `capabilities_of` with `unreadable`, and from `capability_admitted` as
    `(False, ['unreadable'])`.
  - An id outside the vocabulary counts as missing, even when a registry row of that name looks
    admitted.
- **Endpoint.** None of these echo the source: a JSON string, a list, `{"source": [...]}`, a
  number or invalid JSON (rail). The rate limit is named in the ledger and above.

## Flag OFF is byte-identical to master

1. **Differential, re-run after the review fixes** (`flagoff_diff.py`, kept with the run notes and
   not committed). It compares origin/master's `runtime_definitions.py` plus its
   `pine_runtime_allowlist.json` against this branch's:
   - inputs: 1,036 sources under 72 env combinations;
   - functions: `allow_list`, `graded_allow_list`, `allow_report`, `kill_list`, `stage`,
     `not_graded` (both modes), `stamp_served` (a runtime row and a DIV-4 `ast` row),
     `server_lane_refusal`;
   - result: **47,279 comparisons, 0 differences.** The review's own differential found 2.1M
     comparisons with 0 differences.
2. `GET /runtime-kill` with the flag off has exactly the keys `kill`, `allow`, `save_enabled`.
3. `POST /runtime-admission` with the flag off is a constant and never runs the detector.
4. Client: with `capability_admission` absent, a latched ADMITTED verdict is ignored, and the
   sentence is master's character for character.

## Mutants

The method:
1. copy the file;
2. edit it;
3. run the focused tests (`-x`);
4. restore FROM THE SAVED COPY;
5. confirm `git hash-object` == the committed blob.

`.pyc` files are cleared and `PYTHONDONTWRITEBYTECODE=1` is set. C0 (no edit) is green for every
set. The record is `runs/mutants.json`.

Sets 1-3 ran at `549deeb910` (38 mutants). Set 4 (S1-S8, serving cost) ran at `f344fbd526`, and again at `193dce412e` after the final-verify changes (S6 retargeted to the run limit). Set 5 (G1-G9, final verify) ran at `316c46b7e9`, and again at `0f32d61635` after the re-review changes (G1/G2/G6/G9 re-anchored; G5 retired). Set 6 (F1a-F4b, re-review) ran at `0f32d61635`. 66 mutants in all, every one KILLED; C0 green for every set. Two survived a first pass and their rails were strengthened: G1 (gate removed) survived a timing-only burst, so a deterministic gate rail was added; G3 (no projection) was masked by the cool-down, so that rail isolates the projection.

| id | mutant | killed by |
|---|---|---|
| A1a / A1b | a row not `conformant` admits / one script's captures admit | test_pine_capability_admission (A1) |
| A2 | a capability absent from the registry is not counted missing | A2 |
| A3 | the deny variable ADDS what it names | A3 |
| A4 | the verdict door ignores the kill list | A4 |
| A5 | an unreadable / malformed registry fails OPEN | A5 |
| A6a / A6b | the detector drops `obj:getter` / drops `switch` from FEATURES | test_pine_capabilities (A6 census snapshot) |
| A7 | an `obj:*` family admits on plain runtime-on evidence | A7 |
| A8 | an evidence id names a capture that DIVERGEs (data) | A8 |
| A9 | a server lane admits by capability | A9 |
| F1 / F2 | flag off: the kill read always carries the switch / `1` reads on | OFF rails |
| C1-C5 | client: no verdict draws; another hash's verdict latched; verdict counts while off; unbounded; lists' re-read drops the switch-off | runtimeCapabilityAdmission.test.js |
| L1 | evidence names a capture the HOST lane drew (data) | capabilityEvidenceLane.test.js |
| R1 | a capture the runtime lane draws is graded DIVERGE (data) | REACH |
| R2 | a capture moves MATCH -> DIVERGE (data) | REACH |
| R3 | the reach run records a runtime-drawn capture as host (data) | capabilityEvidenceLane.test.js (lane re-ask) |
| R4 | the reach run drops an admitted capture (data) | REACH |
| **B1a** | **the OLD conditional-ta regex restored** | **B1_0 (the reported shape exceeds 250 ms)** |
| B1b | a line-anchored row back to `^\s*` (var) | B1_1 (blank lines) |
| B1c | flag off: the door runs the detector | B1 flag-off spy (first version SURVIVED: a raising stub is swallowed by `capability_admitted`; now a call-counting spy plus exact body) |
| B1d / B1e | the rate limit never trips / the route does not charge | B1c rate-limit rails |
| B1f | the detector reads past the 128 KiB cap | over-the-cap rail |
| C1a / C1b | no collection namespace declared / generics misses `<ns>.new<T>` | declares-at-least (C1 cases) |
| C2a | wrapped lines are not folded | C2 cases |
| C3a / C3b | an unreadable source is not `unreadable` / an id outside the vocabulary is not missing | C3 rails |
| E1 / E2 | scripts counted per capture, not family / no community script required | A1 (evidence quality) |
| E3 / E4 | evidence calls a probe a community script / names a probe variant as its own script (data) | A8 |
| S1 | the FIFO cache restored (256, no touch on a hit) | SERVE sweep (second pass not faster) |
| S2 | history stamps every version with the capability question | SERVE history (8 runs, not 1) |
| S3 | the list has no detector budget | SERVE list (over 1 s; more than 8 runs) |
| S4 | a computed set is not persisted | SERVE saved row (re-run on the hot path) |
| S5 | a stored set is read whatever detector computed it | SERVE older detector |
| S6 | the budget allows any number of runs (was: ignores time; now G3) | SERVE budget |
| S7 | probe- and uct- captures read as community | EVIDENCE classifier |
| S8 | the detector changes without a version bump | SERVE fingerprint |
| G1 | the process-wide gate removed | GATE rails (deterministic: a run in progress refuses a second) |
| G2 | the duty cycle (cool-down) removed | GATE 8 concurrent (each over 1 s) |
| G3 | a run is not projected before it starts | GATE projected (a second, big run) |
| G4 | no limit of one big source per request | GATE one big source |
| G5 | (retired by the re-review: a busy save is now refused, not stored; see F1b) | - |
| G6 | a pending row is not stamped `runtimePending` | GATE busy gate |
| G7 | the install door says "taken off the list" for a pending row | runtimeCapabilityPending.test.js |
| G8 | a pending verdict is latched | runtimeCapabilityAdmission.test.js |
| G9 | the list never re-reads while a row is pending | runtimeCapabilityPending.test.js (wiring) |
| F1a | the save door does not wait for the check | F1 save waits out a short busy spell |
| F1b | a busy save stores the unadmitted row | F1 save never stores while busy |
| F1c | the router answers a busy save with a plain 400 | F1 (503 + Retry-After) |
| F2a | the verdict door ignores the member's budget | F2 member budget |
| F2b | a verdict run delays persisted work | F2 a verdict run yields |
| F2c | the verdict door ignores its own cool-down | F2 a verdict run yields |
| F2d | the route does not pass the member | F2 the route charges the caller |
| F2e | the client stops asking after one pending answer | runtimeCapabilityAdmission.test.js (watcher) |
| F2f | a consult with no verdict never re-asks | runtimeCapabilityAdmission.test.js (re-ask) |
| F3 | a single-row serve stamps pending without `runtimePending` | F3 |
| F4a | a written-back stamp is stored | F4 |
| F4b | a written-back stamp is served | F4 |


## Not built here (follow-ups)

- **Per-hash refusal telemetry** (Before Part 2, item d). It is not in this PR, by coordinator
  ruling: engine 54 (PR #1202) builds run-half refusal telemetry, and capability admission's
  refusals should ride on it.
- **Per-built-in evidence for `core`** (see C1 above).
- **A scheduled REACH re-measure** (see above).
- ~~**Persist `request_reads` per source.**~~ DONE 2026-11-13: "The repaint memo" below.
- **Naming each undrawn fill by title** (D note; needs an engine bump).
- **The chart outside MemberPane.** It latches the switch and the verdicts only after a MemberPane
  kill read in that tab, exactly as the allowlist does today.
  - A stored RUNTIME row is served by the server's stamp and does not wait.
  - DIV-4 run colours on a saved `ast` document read the tab's verdict and stay refused (host
    colours) until one is latched. This fails closed.
- **Pre-existing reds, confirmed on origin/master.** `reachable.test.js` "connected to nothing" and
  the eslint unused `e` at `MemberPane.jsx:266` (line 240 on master) both fail with origin/master's
  copies of this PR's `app/src` files swapped in. Every file was then restored blob-equal.
