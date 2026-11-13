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

This document reflects the coordinator's rulings and the CHANGES-REQUIRED review of PR #1204
(head 3799bb8ab5): B1, C1, C2, C3, the evidence-quality ruling, the endpoint notes and the D note.

## What was built

| piece | where |
|---|---|
| ONE detector. `strip_code` / `FEATURES` / `usage_of` MOVED here from `coverage_map.py`, which re-imports them. | `api/services/pine_capabilities.py` |
| Vocabulary: `core` (every readable script), the census FEATURES ids, `obj:*`, `collections:{array,matrix,map}`, and the runtime-only ids. It over-declares. CLOSED WORLD: `unreadable` is returned for a source over 128 KiB or one the repaint classifier cannot read. | same |
| **LINEAR (B1).** `conditional-ta` is a line scan (`conditional_ta_in`, with a stack of open block indents). Every line-anchored FEATURES row opens with a possessive `^[ \t]*+`. Wrapped lines are folded first (`join_continuations`, C2). | same |
| Registry rule: `admitted: true` + `status: conformant` + at least 2 captures from at least 2 DISTINCT script families, at least one of them a COMMUNITY script. Each entry is `{capture, script, community, verdict: MATCH, runtimePane: on}`. An `obj:*` entry also needs `objectsV2: MATCH` + `objectsLane: runtime`. | `api/services/rollout_gate.py::pine_capability_admission`, `pine_evidence_script` |
| `capability_admitted(source) -> (ok, missing)`; `admitted_capabilities()`; `capability_admission_on()` (read per call; only `on` is on); `PINE_RUNTIME_CAPABILITY_DENY` (subtract-only) | `api/services/runtime_definitions.py` |
| `not_graded` admits by capability while ON (never with `graded_only`). `stamp_served`, the save door and `allow_report` therefore follow. `server_lane_refusal` stays per-script. | same |
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

Run at `549deeb910`. 38 mutants, all KILLED; C0 green for each of the three sets.

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


## Not built here (follow-ups)

- **Per-hash refusal telemetry** (Before Part 2, item d). It is not in this PR, by coordinator
  ruling: engine 54 (PR #1202) builds run-half refusal telemetry, and capability admission's
  refusals should ride on it.
- **Per-built-in evidence for `core`** (see C1 above).
- **A scheduled REACH re-measure** (see above).
- **Naming each undrawn fill by title** (D note; needs an engine bump).
- **The chart outside MemberPane.** It latches the switch and the verdicts only after a MemberPane
  kill read in that tab, exactly as the allowlist does today.
  - A stored RUNTIME row is served by the server's stamp and does not wait.
  - DIV-4 run colours on a saved `ast` document read the tab's verdict and stay refused (host
    colours) until one is latched. This fails closed.
- **Pre-existing reds, confirmed on origin/master.** `reachable.test.js` "connected to nothing" and
  the eslint unused `e` at `MemberPane.jsx:266` (line 240 on master) both fail with origin/master's
  copies of this PR's `app/src` files swapped in. Every file was then restored blob-equal.
