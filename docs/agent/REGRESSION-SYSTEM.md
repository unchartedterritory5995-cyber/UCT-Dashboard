# UCT Agent — capability regression system and root-cause analysis (Missions 2 and 8)

Owner's mission: **UCT Agent must never silently lose previously working functionality.**
Branch `agent/qa/capability-regression` (base master `edd353fc06`, which includes hotfix #766). Test-only: no product
file is changed. Suite: `app/src/agent/qa/capabilityRegression/` + `tests/test_uct_agent_capreg_baseline.py`.

## 1. What the system is

| Part | File(s) | What it guarantees |
|---|---|---|
| Canonical registry | `testing/registry.js` | The catalog is built by the REAL register functions (`registerBuiltins` + `registerServerGatedBuiltins`), under production's data kinds (corpus) and with every gated kind on (inventory, so a dark capability is inventoried the day it ships). No hand list. |
| Capability inventory + coverage | `inventory.test.js`, `testing/inventory.js`, `coverage/coverage.json`, `coverage/COVERAGE.md` | Per capability: which of the ten protections exist (§2). The report is generated and the test fails when it is stale. |
| New-capability rail | `inventory.test.js` rail 1, `baseline/regressionEntries.json` | A capability with no corpus intent / golden workflow and no backlog entry fails the build. A backlog entry added after the initial inventory needs `### BACKLOG:<name>` in `COMPATIBILITY-DECISIONS.md`. A covered capability must leave the backlog. |
| Contract rail | rail 2, `coverage/contract.json` | Removing a capability, `risk` confirm → local, `undo` exact → none, irreversible → reversible, or a query becoming a change needs `### CAP:<name>`. |
| Arg validity | rail 3 | Every canonical op in the data passes the registry's own `shapeError`. |
| Stale descriptions | rail 6 | No summary / hint / shape names an action that is not registered. |
| NL equivalence corpus | `baseline/corpus.json` (46 intent groups, 233 phrasings, 4 refusal cases) | Each phrasing is checked at three levels (§3). The owner's own sentences are pinned by a Python test so they can't be paraphrased away. |
| Golden workflows | `baseline/goldenWorkflows.json` (18) | Previously verified workflows: live production acceptance 11-03 (E-01, E-01′, P-07, A-10a, A-13, C-08, P-09, B-07), hotfix #766 T1–T3, owner acceptance (exact Undo), and the AUDIT live passes of 11-04. Each is replayed through the real panel. |
| Baseline lock | `baseline/baseline.lock.json`, `tests/test_uct_agent_capreg_baseline.py` | Removing an entry or phrasing, adding a known gap, or changing an entry's assertions needs a `### BASELINE:<id>` decision **bound to that exact change** (`- Binds: <old digest>-><new digest or removed>`, plus a real `Date:` and a named `Decided by:`; fenced examples never count). The corpus is held both to the lock in the same tree AND to the lock at the merge base with origin/master, so a hand-edited lock in the same PR cannot hide a weakening. A change of the lock's digest format (`LOCK_FORMAT`) against master needs its own `### LOCKFORMAT:<n>` decision. Adding entries and removing gaps is free (`--update` re-locks, and refuses while an undecided weakening exists). Self-tested on in-memory mutations. |
| CI | `.github/workflows/agent-ci.yml` job `capability-regression` | A named check: pytest baseline (with master fetched for the merge-base comparison) + `vitest run src/agent/qa/capabilityRegression`, about 7 minutes, no model or key. **It cannot be made a required check: branch protection is not available on this plan (the API answers 403).** The enforcement that does exist: the master deploy gate runs `npx vitest run src/agent` (every file of this suite) before promotion, and the server job runs `tests/test_uct_agent*.py` (the baseline rail). The files also run in the four Agent CI shards (union rail). Paid live-model evals (`tools/agent_eval_*`) stay separate and are never run here. |
| Code owners | `.github/CODEOWNERS` | The baseline folder (`baseline/`, including `baseline.lock.json`), `docs/agent/COMPATIBILITY-DECISIONS.md` and `tests/test_uct_agent_capreg_baseline.py` are owned by the repo owner. **Without branch protection, CODEOWNERS only requests the owner's review; it does not block a merge.** Deploy-gate enforcement still comes from the master gate's full Agent run (`npx vitest run src/agent` + `tests/test_uct_agent*.py`) before promotion. |

### A pinned market clock (2026-11-04 incident)

At the 09:30 ET open the master deploy gate went red. Its 5 `session.extended` cases failed because "show extended
hours" on a DAILY chart is legitimately refused during the regular session (capabilities/chart.js `extWindowOpen()`,
utils/extSession.js), and the suite read the wall clock.

Now every capreg test file pins Date (`testing/clock.js` `pinClock()`):
- The instant is chosen by `CAPREG_CLOCK`: `post` (default) is Tue 2026-11-03 17:00 ET, after the close; `rth` is
  11:00 ET, in the regular session.
- Only Date is faked; it advances from that instant.
- Agent CI runs the suite at both instants, in parallel (a matrix leg each, its own 20 min timeout), with one aggregate check `capability-regression`.
- An answer that legitimately differs by instant is written down explicitly in `baseline/clockExpectations.json`
  (locked like every entry). `session.extended @ rth` expects the refusal, nothing changed, and no receipt. It is not
  marked as a gap.
- Inventory rail 8 fails a test file that does not pin the clock.

The rest of the corpus was audited for wall-clock dependence:
- Breadth "today", earnings "this week", screens and data reads are answered by fixtures that do not depend on the date.
- Drawing anchors, go-to-date and replay use absolute dates inside the synthetic history, which ends 2026-10-30,
  before both pinned instants.

### The faithful scripted model

Older scripted-model tests return their plan whatever the request carried. That hides a routing miss, because the
browser re-validates ops against the full registry, so an action the model was never shown still runs in the test.
`testing/harness.jsx faithful()` returns the canonical plan only when every canonical action is in `body.capabilities`.
Otherwise it asks for the missing groups (`need_groups`, the real bounded reroute). If they are still missing after
the reroute, it plans nothing. The fixture server serves the canonical reads with synthetic or empty data:
`instrument.resolve` following instruments.py §4.7.5, alerts with read-back, a screener catalog, and `bars.daily`
reads recorded but not answered. No real market value is ever produced.

### Dark entries (`"kinds": "ALL"`, PKG2)

An intent, golden workflow or refusal case whose capability rides on a data kind production does not list yet
(`history.eventStudy` → `history.afterEvent`, the `index.quote` / `commodity.quote` / `crypto.quote` kinds) carries
`"kinds": "ALL"`. The production suites skip it; `corpus.dark.test.jsx` runs it at levels (a), (b) and (c) with every
gated kind on, so what the owner gets on enabling the kind is pinned before the flip. The fixture answers those kinds
with a made-up study and the asset kinds' honest decline. When a kind joins production's list, drop the marker.

### Known gaps are tests that are expected to fail

A failing case is never weakened. It carries `gaps.<a|b|c> = {id, reason, owner, mode}` and runs through
`testing/corpus.js gapIt`. It passes only when the case fails with the RECORDED failure: the label of the failing
assertion must contain `mode`. Examples are `→ chartGrid.set` (that action missing from the routed request), `chart count`,
or for CG-10 the exact wrong reading `read as {"plan":[{"action":"indicator.hide",…`. It fails loudly when:
- the case passes (the fix landed, so remove the marker; no decision is needed), or
- the case fails for any other reason (a harness crash, a different assertion, a changed failure).

So a gap can never hide an unrelated break, the way a bare `it.fails` could. `CAPREG_CAPTURE_GAPS=<file>` records the
actual failure of a new gap.

### When a fix lands: flipping known gaps

A product fix (for example #771 for CG-1 to CG-16) makes each gap it closes fail with
`KNOWN GAP <id> no longer fails — the fix landed: remove the gap marker`. That failure is the signal. In the same PR
as the fix, or right after it lands on master:

1. Remove the `gaps.<level>` object from each fixed phrasing in `baseline/corpus.json`. For a routing collision,
   remove it from the row in `baseline/routingCollisions.json`; for a workflow, remove its `gap`. Never delete the
   phrasing or loosen its `expect`: removing a gap is a strengthening and needs no decision.
2. Re-lock with `python tests/test_uct_agent_capreg_baseline.py --update`. It accepts a removed gap and still refuses
   any undecided weakening.
3. Regenerate the generated files with `UPDATE_CAPREG=1 npx vitest run src/agent/qa/capabilityRegression/inventory.test.js`
   (run in `app/`). This rewrites `coverage/coverage.json`, `coverage/COVERAGE.md` and, for a new capability,
   `coverage/contract.json`. These files are generated from the registry and the data; never edit them by hand.
   Inventory rail 4 fails while they are stale.
4. Run `npx vitest run src/agent/qa/capabilityRegression` and `pytest tests/test_uct_agent_capreg_*.py`. Commit the
   data, the lock and the regenerated files together.

A fix that only PARTLY closes a gap fails differently: `failed for an UNRELATED reason — expected the mode …`. Then
re-capture the new failure with `CAPREG_CAPTURE_GAPS=<file>` and update that gap's `mode`. The mode is part of the lock (format 3),
so the change needs a bound `BASELINE:` decision. If the case now fails in a way that hides a regression, treat it as one.

### What counts as covered

A capability counts as exercised only when an assertion actually runs it (`testing/inventory.js exercisedBy`):
- the faithful model's canonical ops;
- the intent's deterministic plan;
- what the deterministic layers read for a scripted step (a compound read step by step);
- a routing assertion;
- or an explicit `refuses`.

Each golden workflow is credited step by step: a protection comes only from the step whose own plan runs the
capability. Listing a name in `capabilities` is not enough. Inventory rail 1b fails an entry that lists a capability
none of its assertions run (this moved `layout.rename` in GW-07 to `refuses`, and dropped `indicatorStyle.set` from
GW-12, whose deterministic plan does not run it).

### Known limits of the enforcement (review #769)

1. **Where the merge-base check runs.**
   - It is STRICT only on pushes to `agent/**` branches (Agent CI): there, an unresolvable origin/master fails it.
   - Everywhere else it is lenient: a PR merge ref, or a local run, prints a notice instead.
   - On master itself it SKIPS with a printed notice: `GITHUB_REF=refs/heads/master`, or HEAD == origin/master. The
     master deploy gate checks out master shallow with `CI` set, and comparing master with itself is meaningless, so
     this rail can never turn the release gate red (`test_merge_base_check_never_blocks_the_master_gate` simulates it).
   - A moved or renamed lock is refused wherever a merge base exists: master has the capreg corpus but no lock at the
     expected path.
2. **It is not a required check.** Branch protection is not available on this plan. A PR can be merged by hand with
   the capability-regression job red. The backstop is that the master deploy gate runs `vitest run src/agent` and the
   server job's `test_uct_agent*.py` before promotion.
3. **`Decided by:` is free text.** The rail checks that a decider is named, not that the owner actually decided. An
   agent could write the owner's name.
   - **Recommendation (an owner decision):** add CODEOWNERS for
     `app/src/agent/qa/capabilityRegression/baseline/` and `docs/agent/COMPATIBILITY-DECISIONS.md`, so a change to
     the baseline or a decision needs the owner's review.
   - CODEOWNERS only binds with branch protection, which this plan doesn't offer (limit 2). Until then it is
     notification, not enforcement.
4. **Gap modes are locked.** A known gap's recorded failure `mode` is part of the lock (format 3), so loosening what
   "fails as expected" means needs a bound `BASELINE:` decision like any other weakening.
5. **`refuses` is credited only for a refusal that names the capability.** The refusal case must assert
   `expect.refusedAction`: the turn's own outcome row must say `refused…` with that action.

## 2. Protections (coverage today)

`coverage/COVERAGE.md` has the per-capability table. Totals (154 capabilities with every gated kind on, 145 with
production's kinds):

| protection | covered / applicable | meaning |
|---|---|---|
| nl | 94 / 154 | a phrasing reaches it with no gap at (b) or (c) |
| routing | 94 / 154 | the production routed request carries it, and it is not cut by the budget |
| args | 94 / 154 | a canonical op passes shapeError |
| execution | 94 / 154 | it runs through the real panel with its canonical API asserted |
| receipt | 69 / 154 | that run asserts the receipt (a change) or the canonical read (a query) |
| refusal | 27 / 154 | a refusal / must-not-change case |
| permission | 146 / 154 | contract pinned for all; confirm-risk ones also need an Apply-waits case (only `alert.create` has one) |
| undo | 43 / 95 | undo-exact capabilities with a restore assertion |
| multiStep | 21 / 154 | inside a multi-op plan or a multi-step workflow |
| phrasings | 94 / 154 | ≥ 3 gap-free phrasings |

94 of 154 capabilities have a behavioural regression case (22 at #769's open; batches C1 to C4 added indicators, alerts, data reads, widgets, layouts and watchlists; batches D1 to D6 on #774 added indicator alerts, drawings, chart tabs, chart look, definitions and the indicator draft flow; D7 and D8 added app settings and chart templates through the preference writer; E1 to E6 added saved screens, watchlist and layout management, breadth variants, volume / indicator listing / drawing visibility / widget links, and the multi-step golden workflows GW-19 to GW-21; F1 and F2 added the time-anchored drawings, promoted settings, Replay Mode, go-to-date and custom timeframes over a synthetic bar-history fixture; F3 added an approval-and-Dismiss refusal case for every approval-gated intent plus the forbidden families; F4 added cross-turn combos GW-22 to GW-24). The other 60 are in the backlog: see §2a. Their contract is
pinned, but nothing tests their language or execution yet. That backlog is the honest size of the "silent loss"
exposure.

## 2a. What is still uncovered, and why (60 capabilities, 2026-11-04)

The backlog (`baseline/regressionEntries.json`) is listed here by reason, highest member value first. Every entry has
its approval / undo contract pinned (rail 2), so none can lose its approval or Undo silently. What it lacks is a
language and execution case.

| Group | Capabilities | Why not yet | Value / next step |
|---|---|---|---|
| Chart-setup extras | chartSetup.copyLook, compareDisplay, favoriteTimeframe, removeTimeframe; chart.selectTab, chart.linkTab | Cheap with the current fixture (two charts / chart tabs); not reached yet. | Medium. Next batch, no new fixture needed. |
| Widget internals | widget.addTab, closeTab, renameTab, selectTab, move, resize, setOption, showList, showScan | Tabs and options of NON-chart widgets (watchlist / news / themes widgets). The fixture board has no such widget state yet. | Medium: setOption and resize are member-facing. Needs widget-option fixtures. |
| Indicator setup | indicatorCopy.copyTo, indicatorCopy.duplicate, indicatorStyle.placeIn, pane.move, pane.resize | Covered by the Indicators P2 suites (agentIndicatorsP2), not yet by owner-language intents. | Medium. Cheap: the current fixture carries indicator instances. |
| Indicator draft sub-steps | indicator.previewDraft, saveDraft, undoDraft, discardDraft, openCreate | The END-TO-END draft flow is covered (D6: build → save → on the chart → Undo). The individual draft verbs are a multi-turn conversation. | Low-medium. |
| Navigation and "open" | app.open, watchlist.open, watchlist.show, screener.openSaved, layout.saveCurrent | They open a page or a widget (host navigation), which the fixture records nowhere. | Low-medium. Needs a navigation spy. |
| Definitions management | definition.describe, definition.delete, definition.duplicate | The definitions server fixture exists (D6). Not reached yet. | Low-medium. |
| Market-data extras | stock.themes | Served in production. Needs a `themes` kind fixture. | Medium. |
| Read-only meta and guidance | agent.capabilities, guide.explain, guide.show, settings.show, layout.current, screener.state | They change nothing and answer from the registry or the page. A regression shows as wrong words, which this suite deliberately never asserts. | **Low.** Covered by agentGuide* / discovery tests. |
| Rare admin | settings.setWatchlistDigest | One switch, a rarely used setting. | Low. |
| Dark or other surfaces (not on /charts in production) | coach.consent, coach.explain, journal.createNote, journal.listNotes, journal.proposeNote, journal.reviewTrades, playbook.explain, playbook.setup, playbook.record, research.ask, history.afterEvent, breadth.page, screener.page, calendar.day, calendar.nextReport | Registered only while their server flag serves them (coach, knowledge, research, event studies), or only on another page's surface. The corpus runs the production /charts configuration. | Cover each when its flag is activated. The new-capability rail already forces an entry the day one ships. |

Two protections were thin and were raised in batch F3 / F4:
- **refusal (8 → 27):** every approval-gated intent now has a refusal case (`refuse.<intent>.dismissed`). Even when
  the model plans the action as `apply`, the case asserts that it waits on a card, that nothing is written before
  Apply, and that Dismiss leaves the state exactly as it was. Added alongside: trading requests (unsupported), a plan
  aimed at a chart that is not on the board, and a chart change on an empty board.
- **multiStep (18 → 19):** cross-turn combos GW-22 to GW-24:
  - a new chart then an indicator on "it" (CG-34, a known gap);
  - weekly + an EMA then one "undo all of that";
  - a grid, then every chart weekly.
  Multi-step credit stays strict: a capability counts only from a step whose own plan runs it.

The bar-history fixture (`testing/harness.jsx`: `BAR_DAYS`, `SYNTH_BARS`) is synthetic and deterministic:
- a weekday calendar from 2025-01-02 to 2026-10-30;
- a smooth made-up price path, never a market value.

It serves the chart's Time Navigator read-out and the `bars.daily` kind, so time anchors, go-to-date and Replay Mode
all resolve against the same bars.

## 3. Corpus levels

* **(a) routing**: `testing/route.js` builds the request exactly as useAgent's legacy routed request does (the Charts
  catalog, server limit 60, budget 55, member names, lexicon typo readings, the last change's actions). Every needed
  action must be present and its group must not be in `overBudget`. With `ownWords`, the group must also be named by
  the message's own words, because reaching it through the unrecognised-message budget fill is luck.
* **(b) deterministic**: `multiChartPlan` → `fastParse` → `planCompound` (useAgent's order). A claimed reading must
  match the canonical plan (ticker case ignored). `det: required` phrasings must be claimed.
* **(c) final state**: the real panel (AgentPanel + useAgent + routing + policy + runtime + receipts + Undo) over the
  fixture board and the real Indicators mutation interface. It asserts the effective board (cells, symbol,
  timeframe, merged settings), indicators, canonical reads and writes, and receipt / proposal / refusal structure.
  It never compares exact prose.

## 4. Known gaps (fix tasks for the routing / NL builders)

> **Status after release train 4 (master 993ef96a2a, #771 + #776; reconciled on #774 2026-11-04).** Every gap below
> CG-1 to CG-36 (with CG-3a and CG-7b) now passes. Each case reported "no longer fails" and its marker was removed
> (no decision needed), then the lock and coverage were regenerated.
>
> Two ROUTING-COLLISION rows still fail as recorded:
> - **CG-4:** "add the relative strength index" is still also selected by the screener words.
> - **CG-13:** "how does NVDA stack up against AMD" is still also selected by the charts compare words.
>
> Both are now additive: the owner group is named, and the steal only costs request budget. The table below is kept as
> the history of what each gap was.

| id | level | phrasing(s) | owner |
|---|---|---|---|
| CG-1 | a | "Show SPY, QQQ, NVDA and TSLA in four equal panels." The words "panels" and "equal" (without "size") are not grid words, so chartGrid is never sent. | agent-core |
| CG-2 | a | "Make a 2×2 chart layout with …". The grid words match 2x2 but not "×" (U+00D7). | agent-core |
| CG-3a | a | "Put four charts on my screen.", "Create four charts.", "Make a 2×2 chart layout.". A chart count without tickers routes chartGrid (which needs tickers) but not workspace. | agent-core |
| CG-3 | c | Those three plus "give me a 2x2 grid of charts", "I want four equal charts on the board", "four charts, same size, please". No single plan can make N equal charts without tickers: add + arrange-existing is refused by executor.js's mixed-request rule, and chartGrid.set requires tickers. | agent-core |
| CG-4 | a | "add the relative strength index". "relative strength" is a screener word, so indicator.add is not sent. | agent-core |
| CG-5 | a | "what's the setup here". The chartSetup words need describe / summarise. This is masked today by describeSetup's own fast matcher. | agent-core |
| CG-6 | a | "show me NVDA's recent pullbacks", "nvda pullbacks", "how far has NVDA pulled back". No data-group word names pullbacks, so the data group is reached only by the budget fill. Production omitted it for the possessive form (AUDIT 11-04). | nlfix |
| CG-7 | a | "NVDA drawdowns this year". `draw\w*` routes this to the drawings group. | nlfix |
| CG-7b | a | "NVDA distance from the 52-week high" routes to the screener, not data. | nlfix |
| CG-8 | c | "undo the change you made to my layout" right after chartGrid.set is refused with "not a layout change". | nlfix |
| CG-9 | a + c | "put my layout back" is not an Undo phrase. | nlfix |
| CG-10 | b + c | **Wrong execution:** "unhide the 50 sma" is read deterministically as indicator.hide; the follow-up reader matches "hide" inside "unhide". | agent-core (conversation.js) |
| CG-11 | a | "how much is NVDA right now" sends no stock.quote. | nlfix |
| CG-12 | a | "tell me about TSM the company": "tell me" is an alerts word, so routing is [alerts] and stock.profile is not sent. | nlfix |
| CG-13 | a | "how does NVDA stack up against AMD": "against" is a charts compare word, so stock.compare is not sent. | nlfix |
| CG-14 | a | "get rid of the AMD chart": "get rid of" is not a workspace verb, so widget.remove is not sent. | nlfix |
| CG-15 | b + c | **Wrong execution:** "trade places with the left and right charts" is claimed by the quote fast reader as a quote for PLACES / LEFT / CHARTS. | agent-md (marketDataQuote.js) |
| CG-16 | a | "give me new charts for AAPL and MSFT" routes chartGrid but not widget.addCharts. The owner should rule which one is canonical. | nlfix |
| CG-17 | c | MA-cross alert on four default charts (EMA 9/20 under the same ids on every chart) is refused "say which chart", although the member named the NVDA chart; no chart-qualified id exists. AUDIT live defect. | nlfix |
| CG-18 to CG-21 | collision | Additive routing collisions, which only spend request budget: "momentum" in a screen name pulls in indicators; "50 day" in a breadth question pulls in indicators; a layout named "Swing" pulls in charts; "news widget" pulls in data. | nlfix |
| CG-22 | b + c | **Wrong execution:** "move the 200 line up to 210" is claimed by the quote fast reader as a quote for LINE. | agent-md |
| CG-23 | b + c | **Wrong execution:** "make the up candles blue and the down candles orange" and "blue up candles, orange down candles" are claimed as quotes. | agent-md |
| CG-24 | a | "are there any volatility indicators" does not route definition.search. | nlfix |
| CG-25 | a | "use the light theme": "theme" alone is a charts word, so settings.setAppTheme is not sent. | nlfix |
| CG-26 | a | "new charts should open on the weekly" names no settings word, so it is routed as a chart timeframe change. | nlfix |
| CG-27 | a | "turn off alert sounds": the settings word is `sound`, and the plural "sounds" does not match, so it routes to alerts only. | nlfix |
| CG-28 | a | "which studies do I have on here": "studies" is not an indicators word, so indicator.list is not sent. | nlfix |
| CG-29 | a | "connect … with a trend line" and "draw a line from <date> … to <date>" do not route drawing.addTrendline: the drawingTools words need a draw verb plus a tool name. | nlfix |
| CG-30 | a | "fib retracement sep 2 100 to oct 28 180" has no draw verb and no from/between word, so drawing.addFib is not sent. | nlfix |
| CG-31 | a | "write breakout on the chart at …": "write" is not a drawingTools verb, so drawing.addText is not sent. | nlfix |
| CG-32 | a | "anchor a vwap to oct 1" matches neither "anchored vwap" nor "avwap". | nlfix |
| CG-33 | a | **Replay is never routed.** chart.replay sits in the chartSetup group by action name, and that group has no replay words ("replay", "as of", "hide what came after"). This is the live LT-7 cause and it is still open; all four replay phrasings fail. | nlfix |
| CG-34 | workflow | After "open a chart for AMD", "add rsi to it" asks "Which chart do you mean?": a chart the conversation just CREATED is not "it". | agent-core |
| CG-35 | a | "what's on the calendar this week" matches no group and falls back to every group. On /charts the earnings week is a screen (the calendar.* capabilities exist only on the Calendar page). | nlfix |
| CG-36 | a | "averages for the S&P" matches no group, so it falls back to every group. "how are the moving averages looking for the market" is caught by the indicators words. Canonical: breadth.show, where "averages" means % above moving averages. | nlfix |
| CG-37 | c | **Wrong target (still open after train 4):** a reference in the same request to a chart that request CREATES lands on the EXISTING chart instead. "open TSLA on a new chart and switch it to the weekly" makes NVDA weekly; "add a chart for META and make it a line chart" turns NVDA into a line chart; "add a chart for AMD and put the 50 SMA on it" puts the 50 SMA on NVDA. Found by the NLM-1 held-out acceptance (P02 / P15). | agent-core (train-4 fixes branch) |

Observations that are not marked as gaps because they need an owner ruling:

* A plain "undo" after "add the 9 and 20 EMAs" removes one EMA. Each indicator is its own Undo entry; "undo all of
  that" removes both. Is one request supposed to be one Undo?
* "hows breadth today" and "whats the breadth like", typed without the apostrophe, miss the deterministic breadth
  reader. The typo corrector reads "hows" as "how", not "how's". The model path still answers them.

## 5. Root-cause analysis (Mission 8): why the registry, planner, routing and tests let these gaps exist

Each candidate cause was checked against the code at `edd353fc06`.

1. **Incomplete capability exposure: YES, structural.** Routing (routing.js) decides what the model sees from
   hand-written regexes per group. A capability exists (`chartGrid.set`, `widget.add`, `stock.dailyBars`,
   `agent.undo` before #766) but is invisible to the model whenever the owner's words miss the regex (CG-1/2/3a/4/6/7).
   The reroute (`need_groups`) is the safety net, but it depends on the model noticing that a group is missing. On
   11-03 the live Haiku planner chose chart tabs instead of asking. Nothing tested exposure per phrasing.
2. **Catalog truncation (routing budget / fill): YES, latent.** The catalog has 154 capabilities and a request
   carries at most 55. An unrecognised message gets a smallest-first fill with `fillLast` groups last, so whether
   `data` arrives depends on the sizes of the other groups (CG-6: "pullbacks" only works by fill). Adding one action
   to any group can silently push another group out. No test pinned "needed group not over budget" until rail (a)
   and `ownWords`.
3. **Conflicting routing / refusal rules: YES.** Vocabulary collides across groups: "relative strength" (screener vs
   RSI, CG-4), `draw\w*` (drawdowns → drawings, CG-7), "52-week" (screener vs offHigh, CG-7b), "rename … to" (layouts
   vs tabs, LT-9). Groups are tuned one at a time with no cross-group corpus, so a fix in one group's words shadows
   another group.
4. **Broad multi-action restrictions: YES.** executor.js refuses any creating plan that also touches an existing
   target ("Adding widgets and changing existing ones…"). This one rule blocks "four equal charts" on any non-empty
   board (CG-3). #766 added a narrow conversion (adds + tickers → chartGrid) instead of narrowing the rule, so every
   variant without tickers still fails.
5. **Action-state awareness: PARTLY fixed.** Receipts reported "Already Daily" for charts that did not exist (#766 T1),
   and the planner targeted a non-existent chart on an empty board (LT-1). The executor now carries new-target
   defaults, and honest no-ops are verified (GW-02, GW-18). The planner still sees no "what exists now" summary for
   empty or new targets.
6. **Undo availability: YES until #766.** Undo was a browser button with no planner action, so the model told the
   owner that Undo was impossible. `agent.undo` now exists as an add-only, rides-along group, but its phrases are a
   closed list (CG-9) and the named-kind check does not map a grid to "layout" (CG-8).
7. **Test prompts vs owner language: YES, the main cause.** Tests used developer phrasings ("put spy, qqq, nvda and
   tsla on four charts"). #766 added three of the owner's 11-03 sentences after they failed live. The others ("Put four charts on my
   screen.", "four equal panels", "2×2 chart layout") appeared in no test before this suite. Unicode, possessives, missing apostrophes and synonyms
   (panels, drawdowns) were never exercised.
8. **Integration coverage: YES.** 34 panel test files script the model, and only 9 of them inspect `body.capabilities`. A scripted
   model that answers regardless of what it was sent makes routing misses invisible end to end. The faithful model
   closes that hole for the corpus.
9. **Stale capability descriptions: PARTLY.** No hint names a missing action today (rail 6 passes). But comments and
   hints drift: routing.js's header still says "51 after Batch 4 against the server's 60" while the catalog is 154,
   and chartGrid's hint covers only named tickers. LT-4's "can't create them yet" came from the model, which did not
   have `indicatorAlert.create` in its request.
10. **Unverified workspace state: in tests, YES. In the product, mostly no.** The runtime checks that each change
    landed (alerts re-read, board write confirmation). But many tests asserted the receipt's sentence rather than the
    board, and the fixture alert server did not read back. A test that asserts prose would pass while the board is
    wrong. The corpus asserts state only.

**The common thread:** each layer (registry, routing words, executor rules, planner hints, tests) was verified on its
own, against its author's phrasings. Nothing checked, for the owner's words, that the needed capability is offered,
that the plan is allowed, and that the board ends up right, all in one test. Capabilities were added faster than
language and integration coverage; 132 of 154 still have none.

## 6. Lightweight protections

Implemented here (test-side):
1. The faithful scripted model, which makes routing misses visible end to end.
2. Per-phrasing routing that includes the budget-cut check, plus `ownWords` for intents that must not depend on the
   fill.
3. Final-state assertions on the effective board instead of prose.
4. The new-capability rail and the backlog with decisions.
5. The approval / undo contract snapshot.
6. The baseline lock with COMPATIBILITY-DECISIONS.
7. The stale-description rail.
8. The owner's exact sentences pinned.
9. A named CI job.

Proposed (product-side, for the routing / NL owners; not done here because those files are owned by another
builder):
1. Every routing group owns a phrase list. Each new capability adds three or more owner-style phrasings to
   `baseline/corpus.json` in the same PR, and the new-capability rail enforces this by refusing the backlog route
   without a decision.
2. Normalise input before routing: unicode × → x, curly quotes, a dropped apostrophe → `'s`.
3. Narrow the mixed-request refusal to the cases that need rollback; allow "add N charts + re-tile".
4. Make one request one Undo (scope `request`), or rule otherwise explicitly.
5. Give a capability that a message names by its own words a reserved slot in the budget, so a full fill can never
   drop it.
6. When the planner says "I can't" while a registered capability matches, route it to the reroute instead of
   showing it to the member.
