# The Pine ecosystem: from here to "any indicator" (2026-11-21)

The owner's direction: a fully capable, intelligent ecosystem that can **run, write and build** any
TradingView indicator. This page is the one plan for that. It sits above three documents, which stay the
authorities for their own parts:

- the engine build order: [`PARITY-ROADMAP-2026-11-18.md`](PARITY-ROADMAP-2026-11-18.md). Its numbers come
  from [`parity-roadmap-full.json`](parity-roadmap-full.json) (whole population) and
  [`parity-roadmap.json`](parity-roadmap.json) (the 679 comparable line);
- the whole-population census: [`COVERAGE-MAP-FULL-2026-11-20.md`](COVERAGE-MAP-FULL-2026-11-20.md);
- writing indicators (formula and Pine lanes, learning loop): [`studio/STUDIO-TRACK-PLAN.md`](studio/STUDIO-TRACK-PLAN.md),
  especially section 7, *The intelligence and learning architecture*.

Revised the same day after an independent review against the repo's own measurements. Every figure below
carries the measurement it comes from.

## 1. The goal

1. **RUN.** A public Pine script a member pastes draws on our chart as TradingView draws it: on a closed
   chart and on a live one, daily and intraday, with its settings, its alerts and its strategy results. If
   it cannot, it is refused by name. It is never drawn wrong.
2. **WRITE.** An indicator a member describes in words is built right by value. There are two lanes: a
   formula, or a Pine script that the engine judges before the member sees it. If it cannot be built, the
   member is told plainly why and offered the nearest thing we can build.
3. **BUILD.** A member can edit, save, re-open, alert on and share what they made. A script keeps working
   across engine upgrades.

Under all three sit **data** (the series a script reads) and **proof** (every answer graded against
TradingView or against a stated definition).

## 2. Where we stand

### 2a. The scoreboard

| | figure | source |
|---|---|---|
| **RUN, whole population** | **1,831 of 5,091 public open-source scripts served (36.0%)** | full census, engine 87, 2026-11-20 |
| of which graded MATCH by a TradingView capture | 73 (1.4%); the other 1,757 are served on the door's verdict alone | same |
| served on closed-bar history only (refused while a bar is forming) | 203 | same |
| refused, every one by name | 3,260 (64.0%) | same |
| served by Pine version | v1-v3 62.6% · v4 44.7% · v5 32.7% · **v6 24.2%** | same |
| strategies (`strategy()`) | census reads 0 of 418, **but `strategy-decl` is admitted** (engine 78) and the strategy unit serves 7 at engine 87: the census and production disagree (section 4, track 5) | full census; `evidence/2026-11-19-strategy-unit` |
| RUN, the 679 comparable line | 294 served (43.3%): 262 draw fully, 12 with a disclosed gap, 12 unmeasured, 8 diverging. The sample overstates the population by about 7 points | `parity-roadmap.json`, engine 85 |
| parity on committed captures, runtime-on lane | 314 MATCH, 23 MATCH_SUBSTITUTED, 71 DIVERGE, 507 INCONCLUSIVE (915) | engine 84 |
| WRITE | the assistant writes Pine for every account (`CONVERSE_SCRIPT_ENABLED` at `all` since 2026-11-20); the studio's competitor catalogue is 29 of 35 right by value, 2 to our disclosed definition, 1 one-tap question, 3 data walls | `docs/feature_flags.json`; studio round 14, 2026-11-21 (not yet a replayable set: track 7) |
| SPEED, today's member door (translate cut silently at about 10 s a call) | production: p99 1.8 s on the 679 line; the slow served 215: p99 44.4 s, max 52.9 s | `evidence/2026-11-20-door-deadline` |
| SPEED, uncut (what e94's honest budgets will expose) | the slowest served scripts' whole door calls measured about 190 s to 600 s | e93 lane-1 acceptance, 2026-11-21 |
| production engine | 92 | 2026-11-21 |

Engines 88 to 92 shipped after the last full census. Both censuses are due again at engine 93 or 94
(track 5).

**The ceiling is not 100%.** Never-serve scripts need data we will never hold or a licence we will not
cross: crypto and other feeds, tick footprints, non-commercial libraries. On the full population that is
141 scripts, and 39 more wait on data decisions (track 4).

### 2b. Already built (stated so nobody plans it twice)

- **Pasting and running:**
  - host and runtime lanes, routed by cost (`costRoute.js`);
  - capability admission from one registry (`api/data/pine_runtime_allowlist.json`, `admitted_capabilities()`);
  - refusals by name (`refusalCodes.json`; `doorNameCoverage.json` covers 755 Pine names).
- **Editing:**
  - hand-written Pine editing with per-line plain-English errors (`PineEditorStatus.jsx`, armed);
  - Inspect a bar;
  - a per-version verdict on shares;
  - settings for pasted scripts (`runtimeInputs.js`, `runHalfInputs.js`).
- **Libraries:** imports from 8 promoted versions. A non-commercial licence is refused.
- **Upgrades:** saved scripts re-translate on the next chart load after an engine bump (`scriptEngineVersion.js`).
- **Strategies:** admitted (`strategy-decl`, engine 78). The deep daily window shipped in engine 92.
- **The assistant:**
  - writes Pine from the generated `assistantPineReference.json`, with engine-judged repair rounds;
  - routes formula or script by a keyword rule (`script_conversation.py`).
- **Learning loop:** the gap log is on by default (`indicator_support.py`); consented member reports are
  armed with a daily digest; L6 demand mining is merged.

## 3. Tonight: finishing what was in flight

The order is the dependency order.

| # | item | state | next step | holder |
|---:|---|---|---|---|
| 1 | #2029 host-parity digests at engine 92 | master merged; re-record queued on the heavy lock | re-record, merge on green | engine lane |
| 2 | objects grader: orphan line fills, other-symbol supply recorded before the session, v1 MATCH cannot stand over an objectsV2 DIVERGE | committed, not pushed | PR, mutants, one grade diff, merge | engine lane |
| 3 | **train e93** = #2280 Q-CLOSURE, #2302 first-period per bar, #2331 colour cast, #2388 table cell text colour | merged on the train branch | number 93, checks, grade diff, merge, deploy | engine lane |
| 4 | paste chain #2254 -> #2364 -> #2367 -> studio's script check (c): every Pine build off the page's main thread | waits on the re-trace | re-trace (rig), census v3, merge in order, each retargeted to master | rig, then coordinator |
| 5 | **e94** = deterministic translate budgets: a step budget instead of the silent 10 s cut; both last-resort stops scaled to the slowest served uncut call; zero served -> refused | local branch | after row 4: clean slow-lane pass, final stops, acceptance, held regrade | coordinator |
| 6 | math.sin (1 ulp on 123 of 8,511 bars) and Q-CF (TradingView folds pi/180) | capture taken | grade, then rule | rig, coordinator |
| 7 | studio #2389 (last month's value), #2396 (a value that starts on a date starts fresh) | #2389 merged `b56c720144`; #2396 approved | merge on green and its 12 breaks red | studio |

**Why e93 was cut down.** Row 5 lets a translate run to completion. Until row 4 lands, a full translate
on a member's page would run on the main thread for minutes. So e93 ships its four finished fixes, and
e94 follows the chain.

## 4. The road from here: seven tracks

### Track 1: RUN any script (engine)

The order is read from **`parity-roadmap-full.json`** (engine 87, whole population). The 679 line stays
the comparable series. The top units, by scripts unlocked:

| unit | unlocks (full) | state |
|---|---:|---|
| `objects` | 424 | **in progress**: the probe ran 2026-11-18; the run half was built at engine 77; A4/A6 shipped at engine 92 |
| `request` | 119 | **in progress**: `request-other` admitted at engine 84 (closed-bar history only); TF-FOLD at engine 89; settled functions at engine 90 |
| `builtins` | 213 | stateful names wait for `conditional-history` |
| `statements` | 127 | |
| `dynamic-history` | 132 | |
| `output-contract` | 137 | |
| `conditional-history` | 128 | |
| `state-calls` | 107 | |
| `call-mapping` / `functions` / `admit:method-def` / `function-global-state` | 50 / 49 / 54 / 40 | libraries stand on functions, globals and types |

The rules stay as the roadmap states them:
- evidence units run in parallel with engine work: a registry row on two MATCH captures from two scripts,
  at least one of them a community script;
- no unit is built before what it stands on;
- each engine number ships as a train, with a grade diff before merge.

### Track 1a: the live session (a forming bar)

- Three admitted capabilities are refused by name while the chart's newest bar is forming:
  `realtime-state`, `varip` and `request-other` (`rollout_gate.py`, `PINE_CAPABILITY_FORMING_UNGRADED`).
- 203 served scripts are served on closed-bar history only. Every script the `request` unit frees inherits
  that refusal, so a member opening a chart in market hours sees less than the census calls served.
- **Order:** before more of `request` reaches members, take the forming-bar witnesses on the rig (Q-HTF-FORM
  and a barstate forming-bar capture), then lift the closed-bar scope one capability at a time.
- Meet the tick budget B5 (per-tick work no longer rebuilds over all 5,000 bars).

### Track 2: speed (a pasted script answers in seconds)

- Row 4 takes Pine builds off the main thread. Row 5 replaces the silent cut with honest budgets.
- Then the **translator performance unit** starts on the slowest served scripts, named by rank only in public.
- **Done:** the door build is off the main thread for the whole served population; door call p95 is at most
  X s, with X derived from the e94 measurement; run p95 is at most 1 s at 5,000 bars at x4 (B2, today not
  met for 3 of 16 allowlisted scripts); tick p95 is at most 50 ms (B5).

### Track 3: WRITE any indicator from words

- **Owned by `studio/STUDIO-TRACK-PLAN.md`.** This page only sets the bar.
- **Two lanes.** A formula, or a Pine script the engine judges, with two repair rounds.
  - The 2026-11-18 authoring classes ("drawn objects", "pattern search of no fixed length") were counted on
    the formula lane alone.
  - Re-run the capability census through the script lane before calling any class walled.
- **Data the studio measured as missing:**
  - fundamentals as a series, labelled UCT data (track 4);
  - breadth as a chart series;
  - same-time-of-day cumulative volume as a formula;
  - a buy/sell volume split (no data).
- **Engine backlog for WRITE (e94 onward):**
  - a calendar-restarting running value is exact from the first restart it has seen;
  - a **"since a time" primitive**, so a value that starts on a date is exact beyond the 900-bar warm-up
    (studio round 15);
  - the general empty-output guard;
  - the presentation gaps in [`assistant-writes-pine/GAPS.md`](assistant-writes-pine/GAPS.md): `hline`,
    `plotarrow`, `plotbar`, the `ta.vwap` band tuple.
- **New items:**
  - Pine name completions in the editor (today they read only the formula table);
  - adapted copies (an AI rewrite of a refused paste), only under the Studio plan's section 13 conditions;
  - an eval for the formula-or-script routing;
  - the assistant writes v6 once the v6 deltas it depends on are witnessed. Today it writes v5, and v6 is
    the worst-served version.

### Track 4: the data indicators need

Counts are from the whole-population census.

| data | frees (full census) | status |
|---|---:|---|
| breadth under USI: spellings, from our own breadth data | 13 scripts + WRITE's breadth series | owner call |
| indices, one spelling at a time behind a capture witness (SP:SPX first) | 32 | in progress, witness-based |
| corporate events (earnings, dividends, splits as TradingView serves them) | 15 | owner call |
| fundamentals (sales, EPS, estimates) from SEC filings, point in time (#2391) | 0 Pine scripts as TradingView-matching. Our data can never grade MATCH (Studio ruling 2026-11-14), so it serves WRITE and `request.financial` as labelled UCT data, never graded | owner call |
| crypto and other feeds, tick footprints, non-commercial libraries | none | **never** |

The price-history lake work runs alongside: pre-floor split heals, the corrections door for direct readers,
and corrections v5. It is data identity, not Pine, and it keeps every series a script reads right.

### Track 4b: intraday and long history

- The census measures one closed daily bar. Intraday and full-history behaviour are unmeasured.
- `VITE_PINE_LOWER_TF_ENABLED` stays unset until the intraday store is measured against TradingView.
- **Order:**
  1. measure the intraday store against TradingView on 5, 15 and 60 minute charts;
  2. add the census on SPY 15 and SPY 1D from listing to every train;
  3. then `lower-tf`, U-DAILY (previous-day levels) and U-ANCHOR (a running value over the whole history).

### Track 5: proof (every served answer is graded)

- **A census at every train, on both lines:** the whole population and the 679 line. Each one reports served
  by Pine version and served on history only.
- **Fix the census-production disagreement on strategies.** The census reads the strategy serve census, so
  admitted strategies are counted.
- **Three proof tiers, stated per script:** graded MATCH, capability-admitted, disclosed gap.
  - Target: the INCONCLUSIVE share of committed captures falls every train.
  - A sampled audit of N admitted scripts per train grades each at its defaults and at one moved input,
    because captures today are taken at default inputs only.
- **The census also counts presentation notes** (an undrawn `hline`, `plotarrow`, `plotbar`, untitled
  `fill`) per served script. Today "served" counts refusals only.
- **Graders are code.** A grader change ships with its own mutants and a grade diff that shows its blast
  radius. Tonight's grader PR fixes three faults that had read as served wrong pictures.
- **Rig captures are the truth source.** One sign-in, one profile. Every browser run takes the heavy lock.

### Track 6: alerts and the server lane

- A script's `alert()` is not delivered today (`pine.js`, the `alert` note). 91 of 266 committed corpus
  scripts use `alertcondition` and 39 use `alert()`.
- The server-side Pine runtime is dark: `PINE_RUNTIME_SERVER_STAGE` is off and `PINE_RUNTIME_SERVICE_URL` is
  unset. So a script drawn on the runtime lane cannot alert, scan or backtest on the server. That covers
  662 scripts on the full population.
- After an engine bump, a saved script whose member never opens a chart stays withheld server-side
  indefinitely (`scriptEngineVersion.js`). No server re-translate exists.
- **Order:**
  1. arm the server lane in stages: secret, URL, admins, cohort, all;
  2. re-translate saved scripts on the server after each bump;
  3. deliver `alert()`.
- **Done:** every served script that declares an alert fires on the server lane.

### Track 7: intelligence (the system knows what it can do, and learns)

This is what makes the ecosystem intelligent rather than merely large. Most of the parts exist (section 2b).
The loop is what is missing.

1. **One source of truth for capability.**
   - The admission registry decides what is served.
   - The assistant reads only the generated reference.
   - Every new admission ships with its assistant wording (`CAPABILITY_WORDS` in `pine_authoring.py`) and
     one eval case. Today a new capability is silent until someone words it.
2. **Honest by construction.** A refusal names its wall. A served script that leaves something undrawn
   says so. An answer built on UCT data says it is UCT data.
3. **A sealed WRITE eval.** WRITE's "right by value" becomes a measured number:
   - a hidden set, run by a separate session, plus a committed script-lane set, both graded by value
     through the browser engine;
   - re-run on any change to `pine_authoring`, the reference, the recipes, the model or the engine number;
   - the threshold is derived from the first run.
   `tools/converse_eval.py` grades only formula patches today.
4. **Member failures steer the build order.**
   - Weekly, put the distinct-member counts per wall, from the gap log and consented reports, beside the
     TradingView boosts in `demand-ranking.json`. Boosts are published popularity, not our members.
   - Re-rank track 1 from that.
5. **Every engine number re-measures itself:** census, grade diff and the WRITE eval, before it reaches members.

### Strategies

Admitted since engine 78. What remains:
- the broker-rule pins (Q-S1a/i/b);
- the intraday start [B-START] (0 served on SPY 15 and RDDT 60 today);
- the census fix in track 5.

Orders are simulated on our chart and never routed.

## 5. What "done" means

| part | done when |
|---|---|
| RUN | the whole-population served share reaches the ceiling of tracks 1 and 4 (re-derived at each census). Every served script is in a stated proof tier, with the graded-MATCH count rising every train. Forming-bar refusals are zero for every admitted capability. The v6 served rate is reported as a headline |
| WRITE | the sealed eval meets its derived threshold on both lanes. Every build is either right by value or refused by name |
| BUILD | saved scripts survive every engine bump without a chart load; alerts fire from the server lane; shares carry their verdict |
| SPEED | the track 2 budgets hold over the served population |
| PROOF | a census, a grade diff and the WRITE eval stand behind every engine number that reaches members |

## 6. Owner decisions this plan needs

1. **Breadth as a chart series** (USI: spellings from our breadth data): 13 scripts, plus WRITE.
2. **Corporate events as TradingView serves them:** 15 scripts.
3. **Fundamentals as labelled UCT data** (SEC point in time) for WRITE and `request.financial`. They are
   never graded as TradingView, so they free no TradingView-matching script.
4. **Arming the server-side Pine lane** in stages (track 6). It is what alerts, scans and backtests on
   runtime-lane scripts need.

Nothing in section 3 waits on these.

## 7. Sequence after tonight

1. e93 lands.
2. The paste chain lands.
3. e94 lands.
4. **Census at e94** on both lines: by version, history-only, and the strategy census fixed.
5. Forming-bar witnesses (track 1a), with track 6 staged in parallel.
6. Track 1 units in the full-population order, re-ranked by member demand (track 7).
7. Intraday measurement (track 4b).
8. Translator performance (track 2).

The sealed WRITE eval (track 7) starts now in the studio's lane. Nothing above blocks it.
