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

The order is the dependency order. The table is the plan as written; section 8 records what has
moved since.

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

**Answered 2026-11-22: YES to all four** (section 8). Still open: the breadth licence question (ESC-03).

1. **Breadth as a chart series** (USI: spellings from our breadth data): 13 scripts, plus WRITE.
2. **Corporate events as TradingView serves them:** 15 scripts.
3. **Fundamentals as labelled UCT data** (SEC point in time) for WRITE and `request.financial`. They are
   never graded as TradingView, so they free no TradingView-matching script.
4. **Arming the server-side Pine lane** in stages (track 6). It is what alerts, scans and backtests on
   runtime-lane scripts need.

Nothing in section 3 waits on these.

## 7. Sequence after tonight

1. e93 lands. **Done 11-22:** production serves engine 93.
2. **e94 lands:** the paste chain and the deterministic budgets, in one train (ruled 11-22).
3. **Census at e94** on both lines: by version, history-only, and the strategy census fixed.
4. **U-DAILY** (track 4b), moved up on 11-22 to the next engine unit. It covers a daily value on an
   intraday chart, together with intraday markers or another symbol in the same script. Its acceptance
   cases are the requests the day-length guard can only answer with a question today.
5. Forming-bar witnesses (track 1a), with track 6 staged in parallel.
6. Track 1 units in the full-population order, re-ranked by member demand (track 7).
7. Intraday measurement (track 4b).
8. Translator performance (track 2).

The sealed WRITE eval (track 7) starts now in the studio's lane. Nothing above blocks it.

## 8. Progress log

### 2026-11-22 (the night of 11-21)

**Merged.**
- #2394, the objects grader: orphan line fills; supply recorded before the session; a v1 MATCH cannot
  stand over an objectsV2 DIVERGE. The grade diff moved only the expected rows. Member-visible: none.
- #2029: host-parity digests re-recorded at engine 92 (167 of 167).
- #2405: Agent CI now runs on the licensing register the data-terminal suites read. This was a latent red
  on master.
- #2411: a script held back on a forming bar names the server's reason ("reads another symbol or
  timeframe", varip, or barstate), not always barstate.
- Studio:
  - #2389: last month's value with no offset;
  - #2396: a value that starts on a date starts fresh;
  - #2398, #2402, #2404, #2408, #2412: the WRITE eval, units 1 to 4 plus the j06 oracle fix;
  - #2413: the door refuses a timeframe or symbol read of a constant, and a placeholder reply;
  - #2410: a cross-timeframe or cross-symbol read the member did not ask for is sent back once.
- #2422: FMP deep intraday history for SPX and NDX. Settled sessions come from FMP, the live tail stays on
  yfinance, and half-days, the seam and the atomic store are railed. It fixes Fred RS's intraday line,
  which was blank before about 60 days back.

**Train e93** (#2418): #2280, #2302, #2331, #2388.
- Prod ratchet 60 = 60. Runtime-on 93 -> 96, with 0 lost.
- HP-0 moved nothing.

**The WRITE eval** is on master and gates every PR that touches the door or the engine. The record now:

| lane | right | the miss |
|---|---|---|
| formula | 101 of 101 | none |
| wall | 28 of 28 | none |
| script | 16 of 17 | j06, named |

Its findings, each now fixed or in a PR:
- **j06, oracle drift.** The rule was mirroring the script's `[1]`. A look-back placed outside
  `request.security` made the value a whole period stale. Fix: rule 12, #2423.
- **y02, a constant read as a timeframe.** The door accepted a placeholder reply and a `tf(0, W)`. Fixed
  in #2413.
- **Written dates.** The model's own epoch arithmetic was 4 days off, and when unsure it asked the member
  for epoch seconds. Fix: the door resolves written dates, #2421.
- **`plotchar` for numbers.** It draws nothing. Fix: a sentence telling the assistant to use a label
  (queued).
- **`request-other` written without being offered.** It stays not offered until track 1a's evidence lands.
  A script that reads one the member did not ask for is repaired (#2410).

**The paste chain (track 2).** The worker removes the main-thread stalls: A from 120 s to 3-5 s, B from
40 s to 1 s.
- But 3 of 6 AFTER runs were refused: the translator's 10 s wall window, and a clock-dependent door
  answer.
- **RULED: e94 = the paste chain (#2254, #2364, #2367) + the deterministic translate budgets, shipped
  together.**
- The next trace is taken with source maps. Its bar: 0 refusals, no door or translate task over 50 ms on
  the main thread, and wall time within 10% of before or explained.

**The live session (track 1a).**
- `barstate.isnew` is refused on both lanes (RULING-0927: it needs per-tick evaluation). That becomes a
  future unit.
- Monday 11-23 Q-BSF: the barstate probe on SPY and QQQ (1D and 5) plus the community witness
  renko-candles-overlay on SPY, QQQ, IWM and DIA (5).
- Tuesday and Wednesday: Q-HTF-FORM v2, including an object-program table that reads another timeframe
  (j06). That table draws all session with ungraded values, and this witnesses them.

**Data.**
- The 13-symbol pre-floor split heal was confirmed NOT served (the reboot killed the publish). The dry
  re-check passed; the publish was re-run on the owner's go.
- New evidence for track 4b: a 14-day ATR on a 5-minute chart is the U-DAILY wall.
- New evidence for track 1: an event-latched `var` together with another symbol is the
  `request-with-state` wall.

**Next.**
1. e93 lands, then the census at e93 on both lines.
2. The e94 combined train.
3. The first full live WRITE run, as bench@.
4. Monday's captures.
5. The engine follow-ups:
   - the run-colour and run-half guard sentences take their reason from #2411's builder;
   - the host door grades bars before an other-symbol supply begins as `na` instead of withholding them
     (`SERIES_UNKNOWN_BEFORE_FIRST`).

### 2026-11-22, later (to 05:30Z)

**Live.** Production serves engine 93 (checked 01:22Z). #2424, the entry above, merged after its gate.

**Merged since the entry above.**
- #2423, rule 12: a value on another timeframe is read as it stands. A look-back goes inside the request
  only for "last week's". This closes the j06 oracle drift.
- #2427: run colours and run halves say the server's forming-bar reason (the follow-up to #2411).
- #2426: Fred RS's weekly re-take, with SPX held after the close. The weekly labels grade
  MATCH_SUBSTITUTED.
- #2430: the sin/asin composition's one-ulp difference (123 of 8,511 bars) is filed as a NAMED
  divergence, not a defect. Row 6's math.sin half is closed; Q-CF stays open.
- #2409, #2414: the j06 other-timeframe table evidence, and Monday's probe revised. The first community
  witness was refused on both lanes, so another one replaced it.

**Data.**
- **The 13-symbol heal is served and checked.**
  - 34 of 35 checked closes match TradingView.
  - The false split cliffs on ONB and TMP are gone.
  - Six control symbols did not move.
  - The one miss: ODC's 27 July 1983 bar is in the published file but not served, so a read-side filter
    drops it. It predates the heal and is logged as a data item.
- **The next batch, v3, is staged:** 13 more symbols, 10 pre-floor split corrections and 3 vendor split
  dates, each checked against TradingView. The order is dry run, publish, then a served check.
- **60-minute index history stays Yahoo's 730 days.**
  - FMP's hourly series matched TradingView on 32% of bars, against Yahoo's 71%, and FMP's 5-minute
    roll-up is no better.
  - So Fred RS's 60-minute line stays blank before about two years back, until an hourly source that
    matches TradingView exists.
  - The limit is stated in #2422.
- **#2429 (rides e94): a bar before another symbol's first held row is withheld.**
  - Such a bar is withheld by name, never read as `na`. Its words: "Not drawn before <date>: UCT intraday
    history of SPX starts there".
  - SPY 5/30/60 `na` mismatches: 9,203 / 21,275 / 11,969 -> 0.

**WRITE.**
- **Ruled: a disclosed stand-in is not a build.** Sometimes the member's words need something the engine
  cannot build, such as a 14-day ATR on a 5-minute chart. Then:
  - the door refuses by name;
  - it offers the nearest builds as one-tap choices;
  - it builds only what the member picks.
- **The day-length guard (ruled B).**
  - It covers requests like "the 50 day average" on a 5-minute chart. 61 of 200 recorded requests write an
    explicit day length, and the guard had zero false positives on them.
  - About half can be built on a daily calc timeframe. The rest, a marker or another symbol in the same
    script, can only end at a question today.
  - So the guard ships with a good question: two choices, with spans in trader words ("50 five-minute bars,
    about 4 hours").
  - U-DAILY moves up to the next engine unit after e94 (section 7). Its 11 own-round requests are public
    acceptance cases: walls today, each must build right when U-DAILY lands.
- **Studio queue:** #2421 (written dates; green, merging) -> `plotchar` -> the intraday unit -> the
  day-length guard -> (c), the authoring check on the worker.
- **The first full live run** (bench@, at most $20):
  - the wall lane is running;
  - the script lane can start now that rule 12 is served;
  - the formula lane waits on #2421.

**e94.**
- **Built:** master -> #2254 -> #2364 -> #2367 -> the budgets -> #2429. It adds an interim 10 s
  main-thread cap on the studio's authoring check, which refuses by name until (c) moves the check to the
  worker.
- **Census v3, lane 0** (852 scripts, today's clock): 0 served -> refused in the worker. 14 time out on
  both clocks, the same as master.
- **The slow-lane basis for the final stops is being measured one run at a time.**
  - A first 3-run pass hit its 80-minute cap. That is about 1.1-1.3x earlier runs of the same script (each
    run is a report and a door call), so it is not a regression.
  - Each finished call is now written as it ends, so a cap kill keeps what finished.
  - A control run on e93's base is queued if a door call exceeds twice e93's measurement.
  - No stop value is written before the basis table is read.

**Open for the owner.** Section 6's four decisions are unchanged. One more question: 19 day-length
requests come from the catalogue, so they stay private under the owner's rule. Should they be published?

**Next.**
1. **e94:**
   - the slow-lane basis, then the final stops;
   - acceptance: 0 served -> refused on both lanes;
   - the rig re-trace with source maps;
   - the regen guard, then merge.
2. The e93 snapshot regen, with the rulings applied, and its PR.
3. The v3 publish and its served check.
4. Monday 11-23: the Q-BSF captures.
5. The live run's script and formula lanes.
6. After e94: the census at e94, then U-DAILY.

### 2026-11-22, day (to 17:00Z)

**The owner's decisions (section 6): all four are YES.** "Everything", "full anything and everything: any
TradingView Pine script able to be converted by anyone". The stages below are the safety path, not open
questions. One licence question remains (breadth, below).

**Track 6, the server lane: armed at `admins`, proven end to end.**
- A new `pine-runtime` service (2 vCPU / 2 GB, internal only) is wired to web, with identity checks on
  both sides (#2434, #2457, #2460, #2463, #2464).
- A runtime-lane alert fired from the server with no chart open. A scan of 20 symbols and a backtest ran.
  0 withheld; service p95: alert 81 ms, scan 64 ms, backtest 36 ms; memory peak 0.21 GB.
- The server lanes admit by evidence-backed capability, the same as the chart (#2441). The kill list
  applies everywhere. Forming-bar-only capabilities are refused by name on lanes that can see a forming
  bar.
- **Nightly sweep, fixed:**
  - per-document isolation: one member's multi-plot script crashed every sweep (#2477);
  - a boot catch-up for a missed sweep (#2475);
  - fairness: members' ordinary definitions always come before runtime docs (#2482);
  - a 10.6x web-side speed-up from reading and encoding each symbol's bars once per chunk (#2485);
  - a named withhold counts as an answer, so receipts are filed; refusals are remembered (#2486).
- **Load test (L-cohort at `admins`): every bar passed except the sweep time.** That is re-measured on
  the 11-23 05:00 ET sweep.
- **Web restarts:** a member read now waits ~25 s at a web swap, down from 45 s, via a bounded graceful
  exit (#2473, #2478, #2484).
- **Next:** `all` after the 72 h soak and the sweep bar. alert() delivery (AL1-AL3) rides e95. The
  nightly server re-translate of saved scripts is designed (#2489 store, dark); its parity rail waits
  for e94's worker door.

**Track 4, data.**
- **Corporate events:**
  - E0 witnesses (#2439), and the E1 dark supply `/api/pine/events` (#2443);
  - E2, the engine read of `request.earnings/dividends/splits`, as an e95 draft (#2465);
  - against production: splits and NVDA dividends can match; earnings diverge by vendor record (named),
    so they never grade MATCH;
  - earnings are cut to TradingView's window (2001-09-01); ETFs read no earnings.
- **Breadth:** B1 is built dark (#2456). Serving it waits on the licence question ESC-03: does the data
  vendor's grant reach derived works such as breadth? That is the owner's call.
- **Fundamentals (F1):** started.

**Engine, train e95 (drafts, NUMBER PENDING):**
- #2465 events; #2466 a named other-symbol read followed on the runtime lane (a silent `na` closed);
  #2474 input-kind (the VWAP anchor setting);
- #2461 / #2476 / #2487 alert() delivery; #2496 other-symbol reads on custom timeframes (4h etc. read
  nothing before);
- in progress: computed number formats named and folded; TradingView's built-in VWAP (4 of 6 Session
  captures MATCH, on a carried kernel); the anchor as a live setting; text constants in `var`.

**Train e94:**
- Lane-0 census: 0 served -> refused. No translate regression on master: the apparent 2x was the
  harness's clocks.
- The final stops come from e94's own code. A per-call speed difference between the e93 budgets branch
  and the train is being bisected, but it does not block e94.

**WRITE (the studio):**
- Merged: #2433 (literal formats, interim), #2435 (another publisher's number named as theirs), #2462
  (rule 12 removed, by measurement), #2468 (the intraday unit), #2471 (the day-length guard), #2472
  (fill-in settings draw nothing until filled), #2479 (round 17: nine capability cases, rules first).
- The live L10 run as a member: script 18 of 19 right (j06 is the engine's forming-bar wall); wall 26 of 28
  before the fixes; spend $2.41 of $20. The thresholds come from answers given after every fix.

**Data identity.** The 13-symbol v3 correction is published and verified served (33/33 closes; 6 controls
unchanged). SPX intraday history is deep again (691 sessions on 5/30 minutes, 1-minute from May), with
filled slots named.

**Infrastructure.**
- heavy_lock gained a shared mode for non-timing jobs, and refuses Windows' TIMEOUT.EXE.
- The daily disk sweep's 20-minutes-per-file walk is fixed: it also could have unlinked an unrelated
  same-named junction.

**Next.**
1. e94: basis -> stops -> acceptance -> re-trace -> merge.
2. e95: the units above, then the train.
3. Track 6 at `all` after the soak.
4. The L10 thresholds PR.
5. Fundamentals F1.
6. The breadth licence decision.
