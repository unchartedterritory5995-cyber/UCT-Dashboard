# The Pine ecosystem: from here to "any indicator" (2026-11-21)

The owner's direction: a platform that can run, write and build any TradingView indicator. This page is
the one plan for that. It sits above [`PARITY-ROADMAP-2026-11-18.md`](PARITY-ROADMAP-2026-11-18.md),
which stays the measured engine build order, with [`parity-roadmap.json`](parity-roadmap.json) as its
authority. This page ties that order to the other halves: writing indicators from words, speed, data
and proof. It also lists what is in flight tonight, and what needs the owner's call.

## 1. The goal, in two halves

1. **RUN.** A public Pine script a member pastes draws on our chart as TradingView draws it. If it
   cannot, it is refused by name. It is never drawn wrong.
2. **WRITE.** An indicator a member describes in words is built on their chart, right by value. If it
   cannot be, the member is told plainly why, with the nearest thing we can build.

Two floors hold both halves up. **Data**: the series an indicator reads. **Proof**: every served answer
graded against TradingView or a stated definition.

## 2. Where we stand (measured, with the date of each figure)

| | figure | measured |
|---|---|---|
| RUN: sample scripts served to members | **294 of 679 (43.3%)** | census at engine 85, 2026-11-19 |
| of which every drawing lands | 262 | same |
| served with a disclosed drawing gap / unmeasured / diverging | 12 / 12 / 8 | same |
| ceiling of the current build order | about 589 (86.7%) | same |
| parity on committed captures, runtime-on lane | 314 MATCH, 23 MATCH_SUBSTITUTED, 71 DIVERGE, 507 INCONCLUSIVE (915) | engine 84 |
| WRITE: competitor catalogue (35 public-docs requests) | 29 right by value, 2 to our disclosed definition, 1 one-tap question, 3 data walls | studio round 14, 2026-11-21 |
| WRITE: requests value-checked | 168 across 14 rounds | 2026-11-21 |
| production engine | 92 | 2026-11-21 |

Engines 86 to 92 shipped after the last census. **The served figure is due a re-measure at engine 93**
(section 5, proof).

The gap between the ceiling and 679 is not engine work:
- **never-serve, 16 scripts:** non-commercial libraries, crypto and other feeds we do not hold, tick
  footprints, and one fundamentals class;
- **strategies, 70:** an owner gate. Orders are simulated, never routed;
- **data decisions, 5:** breadth, indices and corporate events (section 4, track 4).

## 3. Tonight: finishing what was in flight

The order is the dependency order. Each row says who holds it.

| # | item | state | next step | holder |
|---:|---|---|---|---|
| 1 | #2029 host-parity digests at engine 92 | mid-merge of master | conclude, re-record, merge on green | engine lane |
| 2 | objects grader: orphan line fills, supply recorded before the session, v1 MATCH cannot stand over an objectsV2 DIVERGE | committed, not pushed | PR, mutants, one grade diff, merge | engine lane |
| 3 | **train e93** = #2280 Q-CLOSURE, #2302 first-period per bar, #2331 colour cast, #2388 table cell text colour | merged on the train branch | number 93, checks, grade diff, merge, deploy | engine lane |
| 4 | paste chain #2254 -> #2364 -> #2367 -> studio's script check (c): every Pine build off the page's main thread | waits on the re-trace | re-trace (rig), census v3, merge in order, each retargeted to master | rig, then coordinator |
| 5 | **e94** = deterministic translate budgets: a step budget instead of a silent 10 s cut; both last-resort stops scaled to the slowest served uncut call; zero served -> refused | local branch | after row 4: clean slow-lane pass, final stops, acceptance, held regrade | coordinator |
| 6 | math.sin (1 ulp on 123 of 8,511 bars) and Q-CF (TradingView folds pi/180) | capture taken | grade, then rule; rides e94 or later | rig, coordinator |
| 7 | #2389 "last month's value" needs no offset | green | merge | studio |

**Why e93 was cut down.** Row 5 lets a translate run to completion. Until row 4 lands, a full translate on
a member's page would run on the main thread for minutes. Holding four finished fixes behind that chain
helps no one, so e93 ships without it and e94 follows the chain.

## 4. The road from here: five tracks

### Track 1: RUN any script (engine)

The measured build order (engine 85 JSON, sizes are estimates), top ten:

| # | unit | unlocks | note |
|---:|---|---:|---|
| 1 | `objects` | 39 | measure first: probe the runtime lane on attached-dirty rows, then route |
| 2 | `request` | 19 | after `admit:request-other`; U-DAILY rides it |
| 3 | `output-contract` | 12 | |
| 4 | `builtins` | 24 | stateful names wait for `conditional-history` |
| 5 | `dynamic-history` | 13 | |
| 6 | `conditional-history` | 15 | |
| 7 | `statements` | 12 | |
| 8 | `function-global-state` | 5 | libraries stand on 8-10 |
| 9 | `functions` | 3 | |
| 10 | `types` | 0 alone | unlocks `libraries` (27) |

The rules stay as the roadmap states them:
- evidence units run in parallel with engine work: a registry row on two MATCH captures from two
  scripts, one of them a community script;
- no unit is built before what it stands on;
- each engine number ships as a train, with a grade diff before merge.

### Track 2: speed (a pasted script answers in seconds, not minutes)

- Row 4 above takes the cost off the main thread. It does not make translation fast.
- After e94 measures the uncut times, the **translator performance unit** starts on the three slowest
  served scripts. Their whole door calls run from about 70 s up to about 600 s today, and they are named
  by rank only in public.
- The target for a member-door call is set from that measurement, not guessed here.

### Track 3: WRITE any indicator from words (Create Indicator, the Agent)

Capability gaps the studio measured. These are data and engine work, not wording fixes:
1. **Fundamentals as a chart series:** quarterly sales, EPS, estimates, and an earnings-date line. Today the
   answer is a data wall plus an alternative. Three catalogue items need it.
2. **Market breadth as a chart series:** advancers minus decliners, new highs minus new lows. We hold
   breadth; the chart door cannot read it.
3. **Same-time-of-day cumulative volume as a formula.** A script serves it today, right by value; the
   formula vocabulary cannot say it yet.
4. **A buy/sell volume split (cumulative volume delta):** no data for it.

Engine backlog the studio's rounds surfaced, for e94 onward:
- a calendar-restarting running value is exact from the first restart it has seen, whatever the warm-up;
- the general empty-output guard: blank on the chart's last bar, or on nearly all bars, is disclosed or
  refused by name.

Authoring classes still walled (roadmap JSON `authoringClasses`): drawn objects (9 ideas), pattern search
of no fixed length (6), many symbols at once (5). The first rides track 1's `objects`. The second rides
`loops` / `collections` / `conditional-history` on the runtime lane. The third rides track 4.

### Track 4: the data indicators need (owner decisions)

| data | frees | status |
|---|---|---|
| breadth under USI: spellings, from our own breadth data | 1 sample script + track 3 item 2 | owner call |
| indices, one spelling at a time behind a capture witness (SP:SPX first) | 1 sample script | in progress, witness-based |
| corporate events (earnings, dividends, splits as TradingView serves them) | 4 sample scripts | owner call |
| fundamentals series (sales, EPS, estimates, earnings dates) | 3 sample scripts (today never-serve) + 3 catalogue items | owner call |
| crypto and other feeds, tick footprints, non-commercial libraries | none | **never**: no data, or a licence we will not cross |

The price-history lake work runs alongside: the pre-floor split heals, the corrections door for direct
readers, and corrections v5. It is data identity, not Pine, and it keeps every series these scripts read
right.

### Track 5: proof (every served answer is graded)

- **Census at every engine train.** The map is the scoreboard. The next one is at engine 93, under the
  heavy lock.
- **Rig captures are the truth source.** One sign-in, one profile; captures are taken as the rig session
  queues them.
- **Graders are code too.** Tonight's grader PR fixes three grader faults that had read as served wrong
  pictures. A grader change ships with its own mutants and a grade diff showing its blast radius.
- **One evidence tier per product**, negatives included.

### Strategies (owner gate)

There are 70 strategies, 45 of which need only this unit. Orders are simulated on our chart and never routed.
Admission waits on the owner's registry row and the evidence rule. The first two candidates' runtime-on
verdicts are on record.

## 5. What "done" means

- **RUN:** every sample script outside never-serve and strategies is served. Each served script's
  capture grades MATCH, or carries a named, disclosed gap. The census reads the ceiling (about 589 of 679
  at engine 85's sizing), and then the strategy row.
- **WRITE:** the competitor catalogue is right by value on every request except declared data walls.
  Every build is either right or refused by name.
- **SPEED:** the member-door target from track 2's measurement holds for every served script.
- **PROOF:** a census and a grade diff stand behind every engine number that reaches members.

## 6. Owner decisions this plan needs

1. **Fundamentals as chart series** (sales, EPS, estimates, earnings dates): supply them? This moves 3
   catalogue items and 3 sample scripts.
2. **Breadth as a chart series** (USI: spellings from our breadth data): serve it?
3. **Corporate events as TradingView serves them:** serve them?
4. **Strategies:** admit simulated strategies on the evidence rule, one registry row at a time?

Nothing in section 3 waits on these. They decide how far tracks 3 and 4 reach.
