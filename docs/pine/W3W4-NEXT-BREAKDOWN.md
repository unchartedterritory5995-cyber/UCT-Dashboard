# W3 + W4 next: the two largest sole walls, decomposed, and the tasks that unblock them

Written 2026-11-05 by a desktop planning session, docs only. Same shape and rules as
`docs/pine/W4-BREAKDOWN.md`, which this document follows and does not repeat: read its
section 2 (rules every task follows) before building anything below.

Citations:
- Every line citation is at `origin/master` **`3168501f22`**. No engine, builder or coverage-tool
  file changed between the census tip `04b49bd61e` and `3168501f22`
  (`git log 04b49bd61e..3168501f22 -- app/src/components/chart/engine app/src/components/chart/builder tools/pine_coverage`
  is empty), so the census describes this code.
- `FE` means `app/src/components/chart/engine/ast/pineRuntimeFrontend.js` (12,310 lines).
- `PJ` means `app/src/components/chart/engine/ast/pine.js` (30,494 lines).
- `MPD` means `app/src/components/chart/builder/memberPane/memberPaneDefinition.js`.
- `CEN` means `app/src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js`.
- `CM` means `tools/pine_coverage/coverage_map.py`.

The measurement read is the engine-17 census on `origin/docs/pine-coverage-2026-11-05` @
`de4371e1e9`: `docs/pine/COVERAGE-MAP-2026-11-05.md`, `docs/pine/coverage-map.json` and
`docs/pine/coverage-targets-2026-11-05.json`. Its TOP WALLS table ranks:

| # | wall | wave | sole | blocks |
|---:|---|---|---:|---:|
| 1 | `[drawing-objects]` | W3 | **56** | 115 |
| 2 | `[imperative]` | W4 | **41** | 178 |

Every count below is reproducible with appendix A (stdlib Python over those committed files plus
`docs/pine/census/w3-object-why-2026-11-02.json`).

**The goal is the language, not the sample.** A task implements a capability for every script
that uses it. Script names are the rows expected to move, never a special case.

## 0. What the measurements say (read this first)

Five findings change how this work is planned.

1. **Both buckets are mostly not the language feature their name says.**
   - `[drawing-objects]` is assigned in three places in `CM:376-448`:
     - a step with no named drop (`:443`);
     - `pine:objects-only` (`CM:68`);
     - `pine:no-output` on a script whose items include a drawing constructor (`:441-443`).
   - The third rule carries **39 of the 56**. `pine:no-output` there means the object program
     **dropped every op**: `PJ:27046-27050` picks `pine:objects-only` only when some op survives
     (`draws` counts surviving ops), and otherwise says "offers no plot and no alert condition".
     That is true, but it hides the fact that matters.
   - The drops on a refused step are never read. `CM:426-431` reads `dropReasons`, `unsupported`,
     `outOfScope` and `loopBlockedCalls` only when `st.get("attached")`. The census records them
     on every step (`CEN:167-173`). So the 39 carry the generic bucket even though the census holds
     their drop keys.
   - `[imperative]` is the host lane's `pine:state` / `pine:reassign` / `pine:block` /
     `pine:cycle` / `pine:undefined` (`CM:48-49`). The programme's answer to all of them is the
     runtime lane, so a production unblock needs the runtime pane armed (W2) **and** the runtime
     lane clean for that script.

2. **`guard:<op>` is not an object operation.** It is the host expression reader refusing the
   op's condition. `PJ:23164-23180` drops the op when `guardOf` returns `undefined`.
   `noteGuardRefusal` (`PJ:22393-22412`) records which host guard threw.
   - So W3.1 "conditional create" and W3.4 "conditional delete/update" are not object-op slices.
     The object program already handles conditional create when it can read the condition.
   - What it cannot read is `pine:state` (a function's own mutable local), `pine:reassign`,
     `pine:collection`, `pine:function`, and so on.
   - Rebuilding those in the host reader would be a second implementation of the execution model.
     The runtime lane already executes them: RT5 / WS-E draws from the run, with `objectsInRun`
     (`builder/memberPane/runtimeObjectsDoor.js:59-96`, `engine/runtime/objectStore.js`).

3. **The committed per-op reasons were measured in the wrong lane.**
   - `w3ObjectWhy.measure.test.js:28` calls `translatePine(src, {})`. That is the **screener**
     lane. The member door uses `strict: true` (`MPD:156-158`).
   - Several host answers differ by lane, for example:
     - `time(tf, session)` is served only when `this.strict` (`PJ:13949`). On the screener it
       refuses with the "SESSION CLOCK … a screen does not" sentence (`PJ:2716-2720`);
     - `PJ:10907`, `:10925` and `:13876` also branch on `this.strict`.
   - So the "session clock" reason (8 touches, 3 sole) in the why file is at least partly an
     instrument artefact. It also predates engine 17 (11-02, before W3 S1 and the W4 train).
   - Use the why file to see **which construct** sits behind a drop. Do not use it to count what
     the door does today. T0 re-measures it in the door's lane.

4. **Half of the [imperative] sole set needs no language work at all.**
   - 19 of the 41 already **transfer in the runtime-on lane** (`runtimeClean`).
   - So do 3 of the 56 drawing scripts (`fair-value-gap`, `order-blocks`,
     `auto-fibonacci-and-gann-fanretracements-combo`).
   - What blocks these 22 is the production flag state: the runtime pane is dark, and the member
     door draws only graded-MATCH scripts on the starter allowlist (`MPD:1337-1342`,
     `engine/runtimeKill.js:102-160`).
   - That is an owner action, gated on captures (track A, section 3). No builder can move it.

5. **W4's language tasks have all landed except the capture-gated ones.**
   - `git log origin/master` shows the 11-05 landing train merged W4-T0, T1, T2, T3, T4, T7, T8,
     T9, T10, T11, T12, T13, T14, T15 and T17 (`51c59324ff` … `5cbffbe620`,
     `SCRIPT_ENGINE_VERSION` 17).
   - T5 and T6 are the only W4 tasks not built. Both are capture-gated.
   - The imperative residue below is therefore mostly T5/T6, plus walls that belong to W6, W7 and
     W9.

## 1. Decomposition

### 1.1 `[drawing-objects]`: 56 sole (production lane)

**(a) Where each script stops in production** (`firstGuards`):

| step-0 guard | scripts | what it really means |
|---|---:|---|
| `pine:no-output` | 39 | the object program dropped every op (finding 1) |
| `pine:objects-only` | 7 | some ops drawn, some dropped; refused because the program is dirty |
| (attached, no guard) | 7 | attached, but dirty: a dropped op, a withheld object, or a **withheld paint** (`CM:426-443`; a withheld paint is bucketed as drawings) |
| `pine:constant-only` | 3 | every plot is constant; the bucket moved to drawings by `DRAWING_CTORS` |

**(b) The route that can unblock each one.** Read off the runtime-on lane, which is what draws
these scripts once armed:

| runtime-on answer | sole | touches | owner |
|---|---:|---:|---|
| **transfers runtime-on already** (arming only) | **3** | 3 | track A (owner, captures) |
| attached and dirty in both lanes, no runtime wall | **8** | 8 | T0 names the wall; then D5 |
| `runtime:call-undeclared-builtin-state` | 3 | 9 | D3 |
| `runtime:no-output` (the drawing build lowered no drawing op) | 2 | 5 | D2 |
| `runtime:request-with-state` | 2 | 5 | W7 |
| `host:pine:constant-only` | 2 | 2 | other (output contract) |
| `runtime:conditional-history` | 1 | 8 | **D1** |
| `runtime:block-value` | 1 | 6 | I6 (W4 residue) |
| `runtime:history-dynamic-offset` | 1 | 3 | I6 (W4 residue) |
| `pine:function` | 1 | 12 | W1 |
| `runtime:loop` | 1 | 4 | W6 (`for … in`) |
| two or more runtime walls | 31 | | combinations; judge every landing by wall counts moving |

Touches with no sole script, for planning: `pine:builtin` 13, `runtime:statement` 9,
`runtime:array` 7, `runtime:expression-statement` 5, `pine:request` 4,
`runtime:history-expression` 3.

**(c) The construct behind each object drop.** Source: the 11-02 why file. These are step-0
reasons in the **screener** lane, so a reason here is a lead to re-measure, not a count of the door.

| construct (host guard named by `guardRefusalWhy` / `createDropWhy` / `cellTextWhy`) | sole | touches | route |
|---|---:|---:|---|
| 0 ops dropped: the wall is not in the object program | 9 | 9 | T0 (`unsupported` / `outOfScope` / withheld paint) |
| `pine:function`: session clock `time(tf, session)` | 3 | 8 | **likely a lane artefact** (finding 3); T0 decides |
| `pine:state`: a function's own mutable local read outside its run | 3 | 6 | runtime drawing build (exists) |
| `pine:reassign` | 2 | 9 | runtime drawing build (exists) |
| `pine:text-value` (label text) | 2 | 3 | D4 (host text reader, capture-gated) |
| `pine:function`: `timestamp` missing on the host | 2 | 2 | runtime lane already serves it (`runtime/clockFns.js:109`); never on the host |
| `coll:diverged` (a drawing held in a collection) | 1 | 10 | runtime drawing build (exists) |
| `pine:collection`: array written in a block or function | 1 | 6 | runtime drawing build |
| `fn:conditional-history` | 1 | 5 | D1 (it is per-call-site history) |
| `pine:collection`: array never created | 1 | 4 | runtime drawing build |
| `fn:in-expression` | 1 | 1 | runtime drawing build (it runs calls in source order) |
| `guard:partial`, no refusal named | 1 | 1 | T0 (the C33 latch's unread term is not named) |
| `pine:builtin` `chart.left_visible_bar_time` | 1 | 1 | **never served**: it depends on the visible range, which TradingView sets and the chart does not mirror |
| `pine:request` | 1 | 1 | W7 |
| `update:props` 9, `loop:empty` 7, `pine:block` 5, `pine:type` 4, `coll:push` 3, `pine:undefined` 3, and others | 0 | | runtime drawing build |

**What the bucket hides, said plainly.**
- Of the 56 "drawing" scripts, at most **4** are stopped by something the host object program
  itself should own: `pine:text-value` ×2, `guard:partial` ×1 and `fn:in-expression` ×1, all
  from the screener-lane why file.
- The rest are stopped by one of:
  - the execution model (state, reassignment, collections, per-call-site history), which the
    runtime lane owns;
  - another wave's wall (W1, W6, W7);
  - an unnamed wall that T0 must name.

**The per-op rows.** These are separate walls with their own sole scripts, not part of the 56. All
nine are attached and dirty in both lanes, with no runtime wall recorded. In each, the host guard
behind the drop is a request (3), a `pine:text-value` (2), `ta.barssince` (1), `pine:reassign` (1),
`pine:collection` (1) or `pine:block` (1).

| row | sole | blocks |
|---|---:|---:|
| `object op dropped: create:label` | 4 | 44 |
| `object op dropped: cell:text` | 3 | 55 |
| `object op dropped: guard:loop` | 1 | 26 |
| `object op dropped: guard:update` | 1 | 25 |

T0 must say why the runtime lane did not replace these partial host programs: WS-E replaces a
partial host picture only when the drawing build stands (`runtimeObjectsDoor.js:76-90`).

### 1.2 `[imperative]`: 41 sole (production lane)

**(a) Step-0 host guard:**

| guard | scripts |
|---|---:|
| `pine:state` | 18 (+1 beside `pine:hidden-only`) |
| `pine:reassign` | 11 (+1 beside `pine:block`) |
| `pine:block` | 6 |
| `pine:cycle` | 3 (all TradingView built-ins: MACD, PVO, Price Oscillator) |
| `pine:undefined` | 1 |

**(b) Route** (runtime-on lane):

| runtime-on answer | sole | touches | owner |
|---|---:|---:|---|
| **transfers runtime-on already** (arming only) | **19** | 19 | track A |
| `runtime:conditional-history` | 3 | 4 | I1 (W4-T5), I2 (W4-T6) |
| `runtime:function-global-state` | 1 | 1 | I3 |
| `pine:state` (the run's own reader) | 1 | 2 | I4 |
| `runtime:history-expression` | 1 | 1 | I1 (H9) |
| `runtime:array` | 1 | 3 | W6 |
| `runtime:udt-method` | 1 | 1 | W6 |
| `pine:strategy-call` | 1 | 1 | W9 |
| two or more runtime walls | 13 | | combinations (mostly W1/W7 plus a W4 wall) |

The 19 arming-only scripts:
- 8 TradingView built-ins: Fisher Transform, McGinley Dynamic, MACD, Parabolic SAR Strategy,
  Percentage Volume Oscillator, Price Oscillator, Time Weighted Average Price, Williams Fractal.
- `adx-and-di-for-v4` and `inside-bar-range-mother-candle-…`: already MATCH in the runtime-on
  harness.
- `fvg-trend`, `inside-bar-boxes`, `nadaraya-watson-rational-quadratic-kernel-…`,
  `trend-targets-algoalpha`, `volume-divergence-by-mm`, `laguerre-rsi-v4-lk`,
  `non-repainting-swing-highlow-signals`, `twiggs-money-flow-lazybear`,
  `uptrick-volatility-adjusted-trail`.

**The single-wall rows, named:**

| script | wall | task |
|---|---|---|
| `relative-strength-index` (TradingView built-in) | `runtime:conditional-history` | I1 |
| `williams-vix-fix-bottoms-and-tops` | `runtime:conditional-history` | I1 |
| `ema-92150-vwap-macd-rsi-pro-v6` | `runtime:conditional-history` | I2 |
| `bolingger-bands-inside-bar-boxes` | `runtime:function-global-state` | I3 |
| `coral-trend-indicator-lazybear` (v1) | `pine:state` | I4 |
| `flying-buddha-inside-bars-indicator-v1` (v3) | `runtime:history-expression` | I1 (H9) |
| `one-sided-gaussian-support-resistance-rate-loxx` | `runtime:array` | W6 |
| `price-divergence-detector-v32-…` | `runtime:udt-method` | W6 |
| `swing-parabolic-sar-strategy` | `pine:strategy-call` | W9 |

**What the bucket hides.**
- `[imperative]` names the host lane's refusal. The host lane will never serve these: the
  programme routes them to the runtime lane.
- So the 41 split into:
  - **19 ready** (arming);
  - **6 W4 language rows**, all capture-gated except where noted (I1–I4);
  - **3 other-wave rows**;
  - **13 combinations**.
- Planning should read the runtime-on wall, never the host guard.

### 1.3 Expected yield (upper bound; production lane; each needs arming for that script)

| task | sole scripts unblocked | capture-gated? |
|---|---:|---|
| A (arming, owner) | **22** (19 imperative + 3 drawing) | yes: one MATCH per script |
| D3 | 3 (names first) | build no; serve per name |
| D2 | 2 (spike first) | build no |
| I1 | 3 | yes (H1-H4, H9) |
| D4 | 2 (host lane: no arming) | yes (per text shape) |
| D1 | 1 (8 touches) | no new capture if the existing witnesses MATCH |
| I2 | 1 | yes (H7) |
| I3 | 1 | yes (new row) |
| I4 | 1 (names first) | build no |
| D5, I6 | unknown until T0 | |

Every runtime-lane row counts in the production lane only after track A grades and allowlists the
script. A task's merge moves the runtime-on number at once and the production number later.

## 2. What already exists (reuse it; never build a second one)

| slice (WAVE-TASKS on `docs/pine-parity-programme`) | state on master | what remains |
|---|---|---|
| W3.1 conditional create (`guard:create`) | **Not a slice** (finding 2). The host reader handles readable conditions; C17 names the unreadable ones (`PJ:22359-22412`). | Route the execution-model walls to the runtime drawing build (RT5 `runtimeObjectsDoor.js`, WS-E partial replacement). Its remaining walls are D1-D3 and I6. |
| W3.2 labels per bar, pool limits, creation order, ids | Pool and collector rules measured (C7) in `engine/objectPool.js:71` (`POOL_LIMITS`), imported by the run's store (`objectStore.js:28`) | The 2 `pine:text-value` label rows: D4 |
| W3.3 `table.cell` text | **W3 S1 landed** (`5f7da680d0` … `4ab4df812d`, merged `619abef90c`, engine 8). The 22 unnamed cells are refused BY NAME. `{N,number,percent}` is gated on Q-W3-3 (`pineTextFormat.js::PERCENT_CAPTURED = false`). Nothing new is drawn. | Q-W3-1 … Q-W3-7 (`capture-queue-2026-11-02-w3.md`). The per-pass shapes are W3.5's engine work. |
| W3.4 conditional delete / update | Same as W3.1 | Same as W3.1 |
| W3.5 drawings in loops | The host runs runtime-pass loops (C18, `PJ:23130-23160`, `loop:runtime`). The run executes loops natively. | Per-pass text shapes (Q-W3-4 … Q-W3-6); otherwise the runtime drawing build |
| W3.6 collection-held drawings (`coll:diverged`) | The host counts and withholds them (C16, `PJ:23815-23868`). The run executes collections (RT5, `objectStore.js:1-26`). | Nothing on the host. The runtime route is blocked by W6 (`runtime:array`) on some scripts. |
| W3.7 `polyline`, `chart.point`, `linefill` | `linefill` is in `RUN_FAMILIES` (`objectStore.js:39`). `polyline` is refused by name: the render state has no polyline (`objectStore.js:36-38`). | A renderer task (outside W3's engine scope); none of the 56 needs it. |
| W3.8 paint-only output contract | **Landed** (B1): `paintOnlyWin`, `PJ:27110`; the run's paints, `MPD:1625-1652` | Withheld paints are mislabelled as drawings in the census (T0 item 3) |
| W4-T0 … T4, T7 … T15, T17 | **Landed**, 11-05 train, engine 17 | — |
| W4-T5 conditional history beyond the witnessed set; drawing runs | Not built. `conditionalHistoryGuard` refuses every stateful call under `objectsInRun` at `condDepth > 0` (`FE:1905-1916`). `servedCondCall` exits on `objectsInRun` (`FE:2393`). | D1 (its item 1), I1 (items 2-3) |
| W4-T6 v6 lazy `and`/`or` | Not built (H7) | I2 |

**Reuse map**, the one authority per value:
- **Runtime drawings:** `objectStore.js` (families, setters, the withholding rule), rendered by
  the host's `objectRenderState`.
- **Pool rules:** `objectPool.js`.
- **Per-call-site served set:** `SERVED_COND` / `ARM_ONLY_SERVED_COND` (`FE:2387-2391`).
- **Clock functions:** `runtime/clockFns.js`.
- **Text formats:** `pineTextFormat.js` and `runtime/text.js`.
- **Loss classes:** `objectLoss.js` (`GUARD_KINDS` `:147-176`, `FN_REFUSALS` `:191-203`).

## 3. Tasks

Sizes: S ≤ 1 day, M 2-3 days. Model tiers per AGENT-RULES:
- Sonnet builds from a precise spec;
- Opus builds engine-semantic fixes and does every merge-gating review;
- Fable only after Opus fails twice.

Every task follows W4-BREAKDOWN section 2:
- built dark;
- the C18 object door verdict diff stays 0;
- `adx-and-di-for-v4` stays byte-identical;
- refuse by name what no capture settles;
- the coordinator bumps `SCRIPT_ENGINE_VERSION` (builders never do);
- ship loop per WAVE-TASKS section 1;
- heavy jobs only under the lock.

**Mutation rails.** `docs/pine/parity-programme/scripts/mutate.py` (branch
`docs/pine-parity-programme`). Every mutation set includes one **no-op control**: a whitespace-only
or comment-only change to the guarded file, which must SURVIVE. If the control is "killed", the
harness is reading something other than the rails (a stale `__pycache__`, a cached transform), and
the round is void.

**The rule throughout: never draw where TradingView hides.**
- An `na` colour is transparent. C37 version colour defaults decide an uncoloured object
  (`objectProgram.js:1109`).
- `objectPool` limits and the collector decide which objects survive (`POOL_LIMITS`,
  `collectsAbove`).
- Where no capture settles a rule, the run's store withholds the family by name
  (`objectStore.js:297-309`).
- No task below adds a family, a default or a limit. Each reads the existing authority.

### T0 Census honesty for `[drawing-objects]` and `[imperative]` (W0-owned tooling) | S | Sonnet

- **Owns:**
  - `CM:376-448` (`walls_of`);
  - `CM:509-516` (`_wall_tags`);
  - `CEN:123-181` (`oneDoor`);
  - `app/src/components/chart/engine/ast/w3ObjectWhy.measure.test.js:20-40`;
  - `tools/pine_coverage/w0/targets.py:44-60` (`rt_wave`);
  - `tools/pine_coverage/w0/gen_md.py`;
  - a new rail `tests/test_pine_coverage_w3w4_t0_honesty.py`, beside
    `tests/test_pine_coverage_w4_t0_honesty.py`;
  - a new committed `docs/pine/census/wall-detail-<date>.json`.
- **Delivers:**
  1. **Read the drops on refused steps too.** `walls_of` reads `dropReasons`, `unsupported`,
     `outOfScope` and `loopBlockedCalls` on every step, not only `attached` ones. A
     `pine:no-output` or `pine:objects-only` step then names its drops instead of falling to
     `[drawing-objects]`.
  2. **Resolve each `guard:<op>`, `create:<family>` and `cell:text` drop to its host guard.**
     - `CEN` already holds `t.objectDiagnostics` (`:140`). Add `guardRefusals` and the guard name
       and token of each `createDropWhy` / `cellTextWhy` entry, identifiers only (no message text,
       no source).
     - Key it as `object op dropped: guard:create <- pine:state`, with the capability of the host
       guard's bucket (`GUARD_BUCKET`).
     - `[drawing-objects]` then keeps only true object-op walls: `coll:*`, `loop:*`, `fn:*`,
       `update:props`, geometry and content.
  3. **A withheld paint is not a drawing.** `withheldPaints > 0` with nothing else named gets
     `paint withheld` (W4, `text-colour-values`), not `[drawing-objects]` (`CM:426-443`).
  4. **Measure the why file in the door's lane.** `w3ObjectWhy.measure.test.js` translates with
     the member door's options (`memberInputTranslation(translatePine, src, {paramManifest: true,
     strict: true, colourInputs: true, guardInputs: true})`, as `MPD:156-158`). Better still,
     retire it in favour of item 2, so the census is the one source.
  5. **Commit the wall detail.** Per script and per step:
     - the guard, the token, the op kind and the line number, and for the runtime lane
       `runtimeDeclined.code` and the probe token;
     - identifiers only, the same licensing as the committed why file.
     
     This makes the next breakdown reproducible without the licence-held `census.jsonl`, which
     this one could not be for the runtime tokens (D3, I4 and I6 need them).
  6. **A runtime decline on a drawing script is labelled by the build that declined.**
     `runtime:no-output` from the drawing build (`FE:12178`, zero ops lowered) is tagged
     `drawing-build-empty` in `_wall_tags`. The wall label is unchanged (same as W4-T0's tags).
- **Semantics:** none (measurement).
- **Rails** (each fixture is a synthetic census row):
  - a `pine:no-output` step with `dropReasons {guard:create: 3}` and
    `guardRefusals ["create@9: pine:state …"]`: the walls are `object op dropped: guard:create
    <- pine:state` (capability `imperative`), not `[drawing-objects]`;
  - an attached, clean-object step with `withheldPaints: 1`: the wall is `paint withheld`;
  - an attached step with a genuinely unnamed loss stays `[drawing-objects]` (the control that
    the old path still works);
  - a runtime-on row whose drawing build declined `runtime:no-output` carries the tag.
- **Mutations:**
  - restore the `attached` guard on the drop read: rail 1 goes red;
  - drop the guard resolution: rail 1 reads `guard:create` with capability `drawing-objects`;
  - drop the paint split: rail 2 goes red;
  - plus the no-op control.
- **measure-pair:** no engine diff. The next W0 run should show `[drawing-objects]` sole
  shrinking well below 56 and the host-guard keys appearing. Record both before and after in the
  map.
- **Capture-gating:** none.
- **Depends:** none. Coordinate with W0's next re-run and with `feat/pine-w9-t0-census`, which
  also edits `CM` and `targets.py`: merge one, rebase the other.

### T1 The door says when a drawing program lost every op | S | Sonnet

- **Owns:**
  - `PJ:27024-27060` (the `resolved.length === 0` refusal);
  - `REFUSALS['pine:no-output']` and `['pine:objects-only']` (`PJ:411-418`);
  - `builder/editorStatus.js:117` and `supportLoop/importGaps.js:57-58` (classification lists,
    read only unless a new guard name is added);
  - a new rail `engine/ast/drawingLostRefusal.test.js`.
- **Delivers:**
  - When the object program attempted ops and dropped every one (`droppedOps === attemptedOps
    > 0`), the refusal names that fact and carries the count. It stays `ok: false` with the same
    screener contract.
  - The guard stays `pine:no-output`, so `paneGate.js:111` (`pine:objects-only` with ops > 0)
    still cannot admit an empty program. Only the sentence changes: "it draws objects, and none of
    the n this chart read could be drawn: …" plus the first `guardRefusals` entry.
  - Today the member is told "offers no plot". That is true, and it is not the reason.
- **Semantics:** none (refusal text). Same precedent as W4-T1.
- **Rails:**
  - a script whose every `label.new` is guarded by an unreadable condition reads the new sentence;
  - a script with no drawing call still reads the old sentence;
  - the pane still refuses both.
- **Mutations:**
  - test `droppedOps > 0` instead of `=== attemptedOps`: a partly drawn program (which is
    `objects-only`) is mis-worded, and its rail goes red;
  - plus the no-op control.
- **measure-pair:** 0 attach changes and 0 C18 verdict diffs. Refusal text changes on the 39
  `pine:no-output` drawing rows.
- **Engine bump:** no. Refusal text only; the translator output's ops and columns are unchanged.
- **Capture-gating:** none.
- **Depends:** none.

### D1 The drawing build serves the per-call-site set the plot lane already serves (W4-T5 item 1) | M | Opus build

- **Owns:**
  - `FE:1905-1916` (`conditionalHistoryGuard`);
  - `FE:1917-1920` (`topLevelHistory`);
  - `FE:2392-2440` (`servedCondCall`; its `objectsInRun` exit is at `:2393`);
  - `FE:1969-1976` (`r4Guard`'s `objectsInRun` exit), read-only unless the served set is shared;
  - a new rail `engine/runtime/__tests__/w3nDrawCondHistory.test.js`;
  - a case in `runtime/__tests__/objectDoorGate.test.js`.
- **Delivers:**
  - Under `objectsInRun`, a drawing whose value reads a stateful call inside a block is lowered
    through the **same** `servedCondCall`: `SERVED_COND` `sma`/`ema`/`rma`, and
    `ARM_ONLY_SERVED_COND` `change` in a `?:` arm.
  - It uses the same per-run windows and carried state, instead of refusing every stateful call at
    `condDepth > 0`.
  - A block local's `[1]` read by a drawing is served exactly where the plot lane serves it.
  - Every other shape keeps `runtime:conditional-history` by name: `stdev`, `highest`, `x[k≥2]`,
    a loop body, and so on.
  - One served set, two builds. **No second table.**
- **Pine semantics:** a function call in a branch that does not run keeps no history for that bar.
  Its history is the history of its runs (execution model). A drawing made in that branch reads
  the same value a plot would.
  - Execution model: https://www.tradingview.com/pine-script-docs/language/execution-model/
  - Witnessed: C48 `vw-call-site-history-*-2026-10-01` (probe
    `tools/visual_conformance/probes/vw-call-site-history.pine`) and the drawing-arm witness
    `tests/fixtures/vendor/harness/vw-rt5-arm-draw-block-history-rddt-1d-2026-10-03.json` (probe
    `vw-rt5-arm-draw-block-history.pine`).
- **Rails:**
  - The rt5 witness MATCHes through the drawing build: a vendor rail through
    `runtimeOwnObjectsOf`, runtime-on.
  - A differential: the drawing's y equals the plot lane's value of the same expression on every
    bar the block runs. The block must skip bars, or the rail cannot tell the two apart.
  - `ta.stdev` under the same block still refuses.
- **Mutations:**
  - share one ring across two drawing sites: the two-site rail goes red;
  - read the every-bar column instead of the per-run window: the differential goes red on skipped
    bars;
  - admit `stdev`: the refusal rail goes red;
  - plus the no-op control.
- **measure-pair:**
  - Runtime-on: the first wall moves on `trendlinesample` (sole, expected to attach),
    `market-structure-inducements-ict-…` (next wall `runtime:history-expression`),
    `auto-harmonic-patterns-open-source`, `support-and-resistance` (`c4792aabd0`),
    `volumized-order-blocks-flux-charts`, `fibonacci-retracement-statistics-by-volprofex`,
    `market-sessions-and-volume-profile-by-leviathan` and `session-liquidity`.
  - The production lane is unchanged (dark).
- **Capture-gating:**
  - **First step, before building:** confirm the two witnesses cover a DRAWING whose y reads the
    served set inside an `if`.
  - If they do, no rig time is needed.
  - If they do not, queue row **W3N-D1**. Probe `vw-w3n-draw-block-history.pine` on
    `NYSE:RDDT 1D` and `AMEX:SPY 1D`: inside `if close > open`, `label.new(bar_index,
    ta.sma(close, 3))`, `label.new(bar_index, ta.ema(close, 3))` and a block local `x = close * 2`
    drawn at `x[1]`, each beside the same value plotted. Serve only the rows that MATCH.
- **Engine bump:** yes.
- **Depends:** none. It conflicts with I1 on the same functions: merge D1 first.

### D2 The drawing build that lowers nothing (`runtime:no-output` on drawing scripts) | S spike + M | Sonnet

- **Owns:**
  - spike: read-only, run locally on the licence-held sample, nothing committed but identifiers;
  - build: the drawing lowering `FE:3083-3330`, the no-output exit `FE:12176-12180`, and
    `runtimeObjectsDoor.js:59-96`;
  - a new rail `engine/runtime/__tests__/w3nDrawingBuildEmpty.test.js`.
- **Delivers:**
  1. **Spike (S).** For the 5 drawing scripts the runtime lane declines `runtime:no-output`, name
     the drawing call shape that `objectsInRun` did not lower (`objectOpsLowered === 0` at
     `FE:12178`). The 5 are `strong-start-rvol-dashboard` and `rth-opening-range-with-extensions`
     (sole), plus `trading-sessions` (TradingView built-in), `session-tpo-profile` and
     `power-of-3-ict-01-…`.
     - Candidates to check, in order:
       - `objectPassOwnsDrawing` claiming the calls (`FE:1245`);
       - a `var table` made in `if barstate.islast`;
       - a drawing inside a UDF;
       - a call form the lowering does not recognise.
     - Output: one line per script (shape, `FE` line). These go into the task's own rails.
  2. **Build (M).** Lower that shape under `objectsInRun` through the existing `objectStore` spec
     table (`objectStore.js:149-203`, `buildOps`), with no new family.
     - If the shape is a call form the store already mints, this is a lowering fix only.
     - If it needs a store rule no capture settles, the family is withheld by name
       (`objectStore.js:309`). The script then declines with that name, never `runtime:no-output`.
- **Pine semantics:** `table.new` / `table.cell` are drawn on the last bar's state.
  `barstate.islast`: https://www.tradingview.com/pine-script-reference/v6/#var_barstate.islast .
  Tables: https://www.tradingview.com/pine-script-docs/visuals/tables/
- **Rails:**
  - a probe-shaped document of each named shape builds with `objectOps > 0`;
  - a control document with no drawing still declines `runtime:no-output`.
- **Mutations:**
  - restore the zero-lowering path: the shape rail declines `runtime:no-output`;
  - plus the no-op control.
- **measure-pair:**
  - Runtime-on: those 5 move off `runtime:no-output`.
  - Attach is expected only if the store needs no withheld family. `strong-start-rvol-dashboard`
    also needs W3 S1's cell-text names to stay refused-by-name, never drawn.
- **Capture-gating:**
  - None to build.
  - Cell text in a table stays under the Q-W3 rows (`capture-queue-2026-11-02-w3.md`).
  - Session windows read by these scripts stay under W4-T3's rows (`capture-queue-2026-11-03-w4-t3.md`:
    W4-T3a no-day-list, W4-T3b overnight).
- **Engine bump:** yes, if the build changes lowering.
- **Depends:** none. It conflicts with **W6-T3b** (`origin/feat/pine-w6-t3b-expr-type` edits
  `FE:3111`, `:3197`, `:3233-3244`, `:3294`, `:3306`): build D2 after W6-T3b merges, or rebase
  onto it.

### D3 Undeclared names inside drawing scripts (`runtime:call-undeclared-builtin-state`) | S spike + S | Sonnet

- **Owns:**
  - spike: local read of the census rows;
  - build: FE `builtinStateFamily` (`FE:5449-5516`, relabelled by W4-T1; the return is at `:5513`);
  - the closed table only through the coordinator (standing ruling 9: one owner at a time);
  - a new rail `engine/runtime/__tests__/w3nUndeclaredInDrawings.test.js`.
- **Delivers:**
  - **Spike:** the token behind the wall for the 3 sole scripts (`correlation-matrix`,
    `previous-day-high-and-low-separators-dailyweekly`, `volume-profile-auto-line-v2`) and the 6
    others it touches.
  - **Build:**
    - for each token that is a Pine built-in the run's kernels already compute under another
      spelling, map it;
    - for a held user function, rethrow the definition's refusal (`deferredFnRefusals`, already
      on master);
    - for a library alias, use `runtime:library`;
    - a real missing built-in goes to W1's list, never to a new kernel here.
- **Pine semantics:** per name, from the v6 Reference Manual entry for that name.
- **Rails:**
  - one fixture per token class;
  - a real missing name stays `undeclared` (the control).
- **Mutations:**
  - drop each mapping: its case reads `undeclared` again;
  - plus the no-op control.
- **measure-pair:**
  - runtime-on, the first wall moves on the 9;
  - 0 C18 verdict diffs.
- **Capture-gating:** none to build. A name whose value no capture or reference rule settles keeps
  a by-name refusal and gets a row in this doc's queue (section 5).
- **Engine bump:** yes if any name is served; no if refusals are only renamed.
- **Depends:** T0 item 5 helps (the token committed). The spike can read the local census without
  it.

### D4 Label text the host reader refuses as `pine:text-value` | S spike + S per shape | Sonnet | capture-gated

- **Owns:**
  - the host text reader `PJ` `textNodeOf` / `loopTextOf` (the W3 S1 band; locate with
    `grep -n "const textNodeOf\|loopTextOf" PJ`);
  - `pineTextFormat.js` for formats only;
  - rails beside `ast/textRefusalNames.test.js`.
- **Delivers:**
  - **Spike:** name the text shape behind `create label … text: pine:text-value` on
    `camarilla-screener` and `supertrend-mtf-heatmap` (sole), and `williams-r-rsi-ema-tendance`
    and `cryptosignalscanner-…` (the per-op rows).
  - Each shape is refused by name (S1's pattern) and gets a capture row.
  - **Build:** serve a shape only after its row MATCHes.
  - Host lane: these move the production number with no arming.
- **Pine semantics:** Strings: https://www.tradingview.com/pine-script-docs/concepts/strings/ ;
  `str.format`: https://www.tradingview.com/pine-script-reference/v6/#fun_str.format
- **Rails:**
  - per served shape, the capture's label texts in order;
  - every other shape keeps its name.
- **Mutations:**
  - per served shape, one character rule broken (for example rounding): its capture rail goes red;
  - plus the no-op control.
- **measure-pair:** first wall and attach on the named rows, production lane.
- **Capture-gating:** **W3N-X1 … X<n>**, one per shape the spike names. Probe
  `vw-w3n-label-text-<shape>.pine` on `AMEX:SPY 1D`: the label's text drawn on the last 20 bars.
  These go in the same doc as Q-W3-1 … 7, and Q-W3-1 … 7 are reused where the shape is already
  queued.
- **Engine bump:** yes, per served shape.
- **Depends:** none.

### D5 The eight drawing scripts that are dirty in both lanes and name nothing | S | Sonnet

- **Owns:** nothing until T0 lands. Then the owning file of each named wall.
- **The 8:**
  - `heat-map-seasons` (DIVERGE capture);
  - `high-low-open-mid-ranges` (**MATCH capture**, 1 op of 171 dropped as `guard:partial`);
  - `supertrend-strategy` (DIVERGE);
  - `dot-dynamics`;
  - `dual-supertrend-ichimoku-and-dmi-…`;
  - `inside-bar-setup`;
  - `money-flow-index` (`3LM5J3rc0O`);
  - `relative-strength-index-divergences-libertus`.
  
  Five drop no object op at all (why file), so their wall is probably a withheld paint (T0 item 3,
  then W4-T12's queue W4-P2) or an `unsupported` / `outOfScope` call.
- **Delivers:** after T0, one line per script naming the wall and its owning task. Only
  `high-low-open-mid-ranges`' `guard:partial` is W3's own: the C33 latch's unread `and` term
  (`PJ:24164-24180`), named by T0.
- **Capture-gating:** as named. `high-low-open-mid-ranges` already has a MATCH capture, so serving
  its one term is graded on an existing capture.
- **Depends:** T0.

### I1 Conditional history in blocks and function bodies, and expression history in a block (W4-T5 items 2-3) | M | Opus build | capture-gated

- **Owns:**
  - `FE:1969-1990` (`r4Guard`);
  - `FE:2387-2440` (the served set);
  - the history-expression refusals `FE:6394`, `:7155`, `:7268`;
  - rail `RT/__tests__/w4CondHistoryWide.test.js`, as W4-BREAKDOWN names it.
- **Delivers:** W4-T5 as specified in `W4-BREAKDOWN.md` section 3: family by family, as each
  capture lands. Item 1 (the drawing build) is D1 here.
- **measure-pair (runtime-on):**
  - `relative-strength-index` (TradingView built-in; its `ma()` helper's `switch` arms run
    `ta.*`);
  - `williams-vix-fix-bottoms-and-tops`;
  - `flying-buddha-inside-bars-indicator-v1` (H9).
- **Capture-gating:**
  - `capture-queue-2026-10-31-wsc-history.md` rows H1 (`stdev`/`sum`/`median`), H2
    (`change`/`mom`/`roc`/`swma` in blocks), H3 (`atr`/`rsi`), H4 (`x[k≥2]`) and H9
    (`(expr)[n]` in a block), on `NYSE:RDDT 1D` and `AMEX:SPY 1D`. **Probes still to write**
    (NEEDS_PROBE).
  - H5 (extremes) and H8 (loops) stay refused.
  - RSI's helper reads `ta.rma` / `ta.sma` / `ta.ema` / `ta.wma` / `ta.vwma` in arms. Which
    family gates it is named by the spike reading the local census (T0 item 5).
- **Depends:** D1 (same functions).

### I2 v6 lazy `and`/`or` (W4-T6) | S | Sonnet | capture-gated

- **As specified in W4-BREAKDOWN** (T6).
- **Owns:** FE `lazyArmContext` (`:2272`), `armHistoryGuard`, `RT/lowerIr.js`.
- **measure-pair:** attach expected `ema-92150-vwap-macd-rsi-pro-v6`.
- **Capture-gating:** H7 (probe `vw-andor-history.pine` exists).
- **Depends:** D1 merged first (adjacent region).

### I3 A function body's view of a global's history | S | Sonnet | capture-gated

- **Owns:**
  - the refusals at `FE:6409-6412`, `:7157-7160`, `:7275-7278`;
  - `outerSlot` (`FE:1723-1726`), read-only;
  - a new rail `RT/__tests__/w3nFnGlobalHistory.test.js`.
- **Delivers:**
  - Plain reads of a global from a function body are served on master (C11, `readGlobal`).
  - What still refuses is `g[k]`, a window, or a change over a global, read from inside a body.
    `outerSlot`'s comment says why: "whose past a global's history inside a frame is has not been
    measured on a chart".
  - Serve it once the capture says whose past it is: the global's own every-bar series (likely)
    or the call site's runs.
- **Pine semantics:** User-defined functions:
  https://www.tradingview.com/pine-script-docs/language/user-defined-functions/
- **Rails:**
  - The capture rows MATCH.
  - A two-site call: one site called on every bar, one inside an `if`. It distinguishes "the
    global's series" from "the site's runs".
- **Mutations:**
  - read per-site runs where the capture says series, or the reverse: the two-site rail goes red;
  - plus the no-op control.
- **measure-pair:** attach expected `bolingger-bands-inside-bar-boxes`.
- **Capture-gating:** new row **W3N-G1**. Probe `vw-w3n-fn-global-history.pine` on
  `AMEX:SPY 1D`: `var float g = 0.0`, `g := close`, `f() => g[1] + ta.sma(g, 3)`, plotted from an
  every-bar call and from a call under `if close > open`.
- **Engine bump:** yes.
- **Depends:** none. It is adjacent to W6-T3b's `FE:7001-7011` hunk: rebase.

### I4 The v1-v3 self-referencing state residue (`pine:state` on the run) | S | Sonnet

- **Owns:**
  - the run's reader of v1-v3 running totals (W4-T10 landed `cum` and the
    `x = iff(start, a, x[1] + a)` shape);
  - `ast/interpret.js` CARRIED rows only through the coordinator, with the Python mirror
    `api/services/ast_interpret.py`. **Conflict:** `origin/feat/pine-w9-t14a-t2` edits
    `ast_interpret.py:542` (a REFUSALS entry); merge it first.
- **Delivers:**
  - Name the residual shape on `coral-trend-indicator-lazybear` (v1; sole) and
    `thelark-lma-v2-laguerre` (v1; also W7). Use the spike locally, or T0 item 5's committed token.
  - Serve it if it is a carried recurrence the reference defines (the Laguerre / Coral filters
    are fixed-coefficient recurrences over `x[1]`). Otherwise refuse it by name.
- **Rails:**
  - a differential against the hand-unrolled recurrence over 5,000 bars;
  - the Python mirror's parity rail stays green.
- **Mutations:**
  - seed with 0 instead of `na`: the seed rail goes red;
  - plus the no-op control.
- **Capture-gating:** none if the recurrence is the reference's arithmetic. A seed rule the
  reference does not state needs a row.
- **Depends:** T0 item 5 or a local spike.

### I6 W4 residue on drawing scripts: `runtime:block-value` and `runtime:history-dynamic-offset` | S spike | Sonnet

- **Delivers:**
  - Name the shapes on `fvg-detector-tradingfinder-…` (block-value, sole) and
    `zigzag-multi-time-frame-with-fibonacci-retracement` (dynamic offset, sole), plus the 6 + 3
    touches.
  - Map each to the landed W4 task whose remainder it is: T14 (v6 bool), T2/T8/T9 (folding and
    lengths), or T17 (integer division, capture D1).
  - Write a spec in this doc's format. Do not build here.
- **Capture-gating:** inherits the W4 rows (Q-A3, W4-S1, D1/M1-M5).
- **Depends:** T0 item 5 or a local spike.

### Track A Arming: the 22 scripts that already transfer runtime-on (owner) | no build

- **What:**
  - W2 stage 2. The member door draws a runtime script only with the pane enabled and the script
    graded MATCH (`MPD:1337-1342`, `engine/runtimeKill.js:102-160`, `PINE_RUNTIME_ALLOWLIST`).
  - **No builder sets a Railway variable or opens TradingView.**
- **Capture list.** Rig time, owner, local-evidence mode for TradingView built-ins
  (LICENCE_HOLD). Each row is one script's own capture on `AMEX:SPY 1D`; add `NYSE:RDDT 1D` where
  the script's repaint class is not `none`.
  - TradingView built-ins (8): Fisher Transform, McGinley Dynamic, MACD, Parabolic SAR Strategy
    (note: `strategy()`; its orders are W9, so grade the plots only), Percentage Volume Oscillator,
    Price Oscillator, Time Weighted Average Price (intraday chart: `AMEX:SPY 5`), Williams Fractal.
  - Committed and reference (11): `fvg-trend` and `nadaraya-watson-rational-quadratic-kernel-…`
    and `trend-targets-algoalpha` (re-grade: INCONCLUSIVE today), `inside-bar-boxes`,
    `volume-divergence-by-mm`, `laguerre-rsi-v4-lk`, `non-repainting-swing-highlow-signals`,
    `twiggs-money-flow-lazybear`, `uptrick-volatility-adjusted-trail` (W4-T13's candle row, queue
    W4-P1).
  - Already MATCH runtime-on (2): `adx-and-di-for-v4` (stage 1) and
    `inside-bar-range-mother-candle-…`. These need the allowlist entry only.
  - Drawing scripts (3): `fair-value-gap`, `order-blocks`,
    `auto-fibonacci-and-gann-fanretracements-combo`. The capture grades the run's drawings:
    object positions, colours and count on the last 300 bars, under the pool limits.
- **Yield:** up to 22 production sole unblocks. It is the largest single lever in this document,
  and it is not a build.

## 4. Planning tables

### 4.1 What each task owns, and the open branches

| task | files / regions at `3168501f22` |
|---|---|
| T0 | `CM:376-448`, `:509-516`; `CEN:123-181`; `w3ObjectWhy.measure.test.js`; `w0/targets.py:44-60`; `w0/gen_md.py`; `tests/test_pine_coverage_w3w4_t0_honesty.py`; `docs/pine/census/` (no engine file) |
| T1 | `PJ:411-418`, `PJ:27024-27060`; new rail |
| D1 | `FE:1905-1920`, `FE:2392-2440`; new rail; `objectDoorGate.test.js` case |
| D2 | `FE:3083-3330`, `FE:12176-12180`; `runtimeObjectsDoor.js:59-96`; new rail |
| D3 | `FE:5449-5516`; new rail |
| D4 | `PJ` text reader (W3 S1 band); `pineTextFormat.js`; rails beside `textRefusalNames.test.js` |
| I1 | `FE:1969-1990`, `FE:2387-2440`, `FE:6394`, `:7155`, `:7268` |
| I2 | `FE:2272` and the arm guard; `RT/lowerIr.js` |
| I3 | `FE:6409-6412`, `:7157-7160`, `:7275-7278` |
| I4 | `ast/interpret.js` CARRIED rows; `api/services/ast_interpret.py` |

Open branches that touch the same files (`git diff origin/master...<branch>`):

| branch | touches | overlaps |
|---|---|---|
| `origin/feat/pine-w6-t3b-expr-type` | FE `:73`, `:1017`, `:1777` (insert), `:2716-2922`, `:3111-3660` (many hunks), `:7001-7011`, `:9255`, `:10525-11349`, `:12227`; `RT/vm.js:29`, `:984`; new `typeDescriptor.js` | **D2** (direct: `:3111-3306`); **I3** (adjacent: `:7001-7011`); **D1** (adjacent: insert at `:1777` beside `condDepth` `:1787`) |
| `origin/feat/pine-w9-t14a-t2` | `api/services/ast_interpret.py:542`; `api/services/bars_window.py`; `tools/vendor_harness/compare.mjs:1118+`, `evidence_engine.py:1153+`, `:1237+`; `runtime/brokerPins*` | **I4** (`ast_interpret.py`). A new capture row needs `evidence_engine.py queue` only, which does not edit that file. |
| `origin/feat/pine-w9-t0-census` | `CM`, `w0/targets.py` | **T0** |

### 4.2 Merge order

| pair | why | order |
|---|---|---|
| W6-T3b → D2 | `FE:3111-3306` | W6-T3b first; D2 rebases |
| D1 → I1 → I2 | `conditionalHistoryGuard`, `servedCondCall`, `r4Guard`, the arm guard | D1 first |
| W6-T3b ⟂ D1, I3 | adjacent hunks | merge one, rebase the other |
| W9-T0 ⟂ T0 | `CM`, `targets.py` | merge one, rebase the other |
| W9-T14a/T2 → I4 | `ast_interpret.py` | W9 first |
| T0 → D5, I4, I6 | they read T0's named walls (or a local spike) | T0 first |
| T1 ⟂ D4 | both in `PJ`, disjoint regions (`:27024-27060` vs the text reader) | either order |

### 4.3 Parallel lanes

At most 3 Opus or Fable agents at once, and only 3 agents while free RAM is under 4 GB. Heavy jobs
are serialized through the lock.

- **Batch 1 (now, no capture):** T0, D3 (spike, then build), D2 (spike now; build after
  W6-T3b), D1 (step 1: confirm the witnesses).
- **Batch 2:** T1, D5 and I6 (after T0), I4 (after W9-T14a/T2), the D4 spike.
- **Capture-gated, as captures land:** I1 (H1-H4, H9), I2 (H7), I3 (W3N-G1), D4 (W3N-X*), D1 only
  if W3N-D1 is needed, and track A (one capture per script).

## 5. Captures (for the owner's rig schedule)

All new rows go in one queue doc, `docs/pine/capture-queue-2026-11-0X-w3w4-next.md`, in the
evidence engine's format (`EVIDENCE-ENGINE-DESIGN.md` 2.1). Then run
`python tools/vendor_harness/evidence_engine.py queue`. Existing rows are reused by their ids.
No builder signs in, opens TradingView or runs the rig.

| row | probe | chart | gates | settles |
|---|---|---|---|---|
| A-1 … A-22 | none (each script's own source; built-ins in local-evidence mode) | `AMEX:SPY 1D` (TWAP: `AMEX:SPY 5`); `NYSE:RDDT 1D` for non-`none` repaint | track A | the script's own plots / drawings |
| W3N-D1 (only if the witnesses do not cover it) | `vw-w3n-draw-block-history.pine` (new) | `NYSE:RDDT 1D`, `AMEX:SPY 1D` | D1 | a drawing's y over per-run `sma`/`ema`/`rma`/`x[1]` in a block |
| H1, H2, H3, H4, H9 (`capture-queue-2026-10-31-wsc-history.md`) | to write (NEEDS_PROBE) | `NYSE:RDDT 1D`, `AMEX:SPY 1D` | I1 | per-run windows, carried state, `x[k]`, `(expr)[n]` in blocks |
| H7 (same doc) | `vw-andor-history.pine` (exists) | same | I2 | v6 lazy `and`/`or` |
| W3N-G1 | `vw-w3n-fn-global-history.pine` (new) | `AMEX:SPY 1D` | I3 | a global's `[1]` and window read inside a function body: series or runs |
| W3N-X1 … | `vw-w3n-label-text-<shape>.pine` (new, after the D4 spike) | `AMEX:SPY 1D` | D4 | label text characters per shape |
| Q-W3-1 … Q-W3-7 (`capture-queue-2026-11-02-w3.md`) | as listed there | `AMEX:SPY 1D` | D2 (table cells), D4 | cell-text formats and per-pass text |
| W4-P2 (`W4-BREAKDOWN.md` section 5) | `vw-w4-paint-switch.pine` | `AMEX:SPY 1D` | D5 (if T0 names withheld paints) | colour typing and hiding |

**Rig priority by unblock:** track A rows first (22 scripts, no build), then H1-H4/H9 (I1: 3),
then W3N-G1 and H7 (1 each), then D4's rows.

## 6. The first batch to launch now

These four tasks share no region, need no capture to build, and are ranked by sole-blocker unblock:

| # | task | tier | why now |
|---|---|---|---|
| 1 | **D3** undeclared names in drawing scripts | Sonnet | 3 sole drawing scripts, 9 touches; a spike, then S. No capture to build. |
| 2 | **D2** the drawing build that lowers nothing | Sonnet | 2 sole, 5 touches (incl. the TradingView built-in Trading Sessions). The spike runs now; the build waits for W6-T3b only if the shape sits in `FE:3111-3306`. |
| 3 | **D1** per-call-site history in the drawing build | Opus | 1 sole, **8 touches**, the widest drawing wall. It reuses the served set and the existing witnesses. Step 1 confirms coverage, with no rig time. |
| 4 | **T0** census honesty | Sonnet | Tooling only. Until it lands, `[drawing-objects]` overstates the drawing work and hides the walls behind 9 + 8 + 9 scripts. Hand it to the W0 lane. |

In parallel, outside the builders: **the owner schedules track A's captures.** That is 22 sole
unblocks, more than every build task in this document combined.

If free RAM is under 4 GB at launch, run D1, D3 and T0, and queue D2's build behind W6-T3b. The
integrator runs measure-pair once per merge, not per task.

## 7. How these numbers were taken

Read-only Python over committed files. No vitest, census, harness or engine run was made for this
document.
- `git show origin/docs/pine-coverage-2026-11-05:docs/pine/coverage-map.json`: per-script
  `walls`, `firstGuards`, `runtimeAttached`, `runtimeClean`, `vendorVerdict`.
- `git show origin/docs/pine-coverage-2026-11-05:docs/pine/coverage-targets-2026-11-05.json`:
  `runtimeWalls` (wall → scripts, every peel step), `verifiedByLane`.
- `docs/pine/census/w3-object-why-2026-11-02.json` (on master): the per-op drop reasons and the
  host refusals behind them. **Screener lane, step 0, engine before W3 S1** (finding 3).

A script is **sole** for a wall when that wall is its only production wall (`walls == [wall]`), as
`COVERAGE-MAP-2026-11-05.md` counts it. A route row is **sole** when the script's runtime-on wall
set has exactly that one member. The runtime-lane tokens (which name, which shape) are in the
licence-held `census.jsonl` only. That is why D3, I4 and I6 start with a spike, and why T0 item 5
commits them.

### Appendix A: the script

Run from the repo root with Python 3.

```python
import collections as C, json, re, subprocess
B = "origin/docs/pine-coverage-2026-11-05"
show = lambda p: json.loads(subprocess.run(["git", "show", f"{B}:{p}"], capture_output=True, check=True).stdout.decode("utf-8"))
cm, tg = show("docs/pine/coverage-map.json"), show("docs/pine/coverage-targets-2026-11-05.json")
why = {r["key"]: r for r in json.load(open("docs/pine/census/w3-object-why-2026-11-02.json", encoding="utf-8"))}
rw = C.defaultdict(set)
for w, ks in tg["runtimeWalls"].items():
    for k in ks: rw[k].add(w)
def table(title, per):
    sole, touch = C.Counter(), C.Counter()
    for f in per.values():
        touch.update(f)
        if len(f) == 1: sole.update(f)
    print(f"\n## {title}")
    for k in sorted(touch, key=lambda k: (-sole[k], -touch[k], k)): print(f"| {k} | {sole[k]} | {touch[k]} |")
def route(s):
    if s["runtimeClean"]: return {"(arming only: transfers runtime-on)"}
    return rw.get(s["key"]) or {"(no runtime wall: host attached, dirty)"}
def host(t):
    g = (re.search(r"(pine:[a-z-]+)", t) or [None, "?"])[1]
    if g == "pine:function":
        if "SESSION CLOCK" in t: return "pine:function / session clock time(tf, session)"
        m = re.search(r"declares — `([^`]+)`", t)
        return f"pine:function / missing `{m[1]}`" if m else "pine:function / other"
    if g == "pine:state" and ("reassigned inside" in t or "changes as the function" in t):
        return "pine:state / a function's own mutable local read outside its run"
    if g == "pine:collection":
        return "pine:collection / " + ("array never created" if "nothing in this script creates it" in t
                                       else "array written in a block or function" if "written at line" in t else "other")
    if g == "pine:builtin":
        m = re.search(r"— `([^`]+)`", t); return f"pine:builtin / `{m[1] if m else '?'}`"
    return g
def objfeat(w):
    f = {host(t) for k in ("guardRefusalWhy", "createDropWhy", "cellTextWhy") for t in (w.get(k) or [])}
    for k in w.get("reasons") or {}:
        if k.startswith("guard:"):
            if not w.get("guardRefusalWhy"): f.add(f"{k} (no refusal named)")
        elif k.startswith("create:") or k == "cell:text":
            if not (w.get("createDropWhy") or w.get("cellTextWhy")): f.add(f"{k} (no refusal named)")
        else: f.add(k.split(":")[0] + ":" + k.split(":")[1])
    return f or {"(0 ops dropped: wall not in the object program)"}
for wall in ("[drawing-objects]", "[imperative]"):
    sole = [s for s in cm["scripts"] if s["walls"] == [wall]]
    print(f"\n# {wall}: {len(sole)} sole")
    table("production step-0 guard", {s["key"]: {",".join(s["firstGuards"]) or "(attached, dirty)"} for s in sole})
    table("runtime-on lane walls", {s["key"]: route(s) for s in sole})
    if wall == "[drawing-objects]":
        table("object-drop reasons (11-02 why file, screener lane, step 0)", {s["key"]: objfeat(why[s["key"]]) for s in sole})
```

It prints the tables of section 1, as `| key | sole | touches |`. The per-op rows of section 1.1
are the scripts with `len(walls) == 1` and `walls[0].startswith("object op dropped")`.
