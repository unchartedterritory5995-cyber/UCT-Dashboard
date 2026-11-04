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

### The faithful scripted model

Older scripted-model tests return their plan whatever the request carried. That hides a routing miss, because the
browser re-validates ops against the full registry, so an action the model was never shown still runs in the test.
`testing/harness.jsx faithful()` returns the canonical plan only when every canonical action is in `body.capabilities`.
Otherwise it asks for the missing groups (`need_groups`, the real bounded reroute). If they are still missing after
the reroute, it plans nothing. The fixture server serves the canonical reads with synthetic or empty data:
`instrument.resolve` following instruments.py §4.7.5, alerts with read-back, a screener catalog, and `bars.daily`
reads recorded but not answered. No real market value is ever produced.

### Known gaps are tests that are expected to fail

A failing case is never weakened. It carries `gaps.<a|b|c> = {id, reason, owner, mode}` and runs through
`testing/corpus.js gapIt`. It passes only when the case fails with the RECORDED failure: the label of the failing
assertion must contain `mode`. Examples are `→ chartGrid.set` (that action missing from the routed request), `chart count`,
or for CG-10 the exact wrong reading `read as {"plan":[{"action":"indicator.hide",…`. It fails loudly when:
- the case passes (the fix landed, so remove the marker; no decision is needed), or
- the case fails for any other reason (a harness crash, a different assertion, a changed failure).

So a gap can never hide an unrelated break, the way a bare `it.fails` could. `CAPREG_CAPTURE_GAPS=<file>` records the
actual failure of a new gap.

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
| nl | 40 / 154 | a phrasing reaches it with no gap at (b) or (c) |
| routing | 41 / 154 | the production routed request carries it, and it is not cut by the budget |
| args | 41 / 154 | a canonical op passes shapeError |
| execution | 39 / 154 | it runs through the real panel with its canonical API asserted |
| receipt | 34 / 154 | that run asserts the receipt (a change) or the canonical read (a query) |
| refusal | 8 / 154 | a refusal / must-not-change case |
| permission | 130 / 154 | contract pinned for all; confirm-risk ones also need an Apply-waits case (only `alert.create` has one) |
| undo | 17 / 95 | undo-exact capabilities with a restore assertion |
| multiStep | 9 / 154 | inside a multi-op plan or a multi-step workflow |
| phrasings | 39 / 154 | ≥ 3 gap-free phrasings |

43 of 154 capabilities have a behavioural regression case (22 at PR open; batches C1 to C4 added indicators, alerts, data reads, widgets, layouts and watchlists). The other 111 are in the backlog. Their contract is
pinned, but nothing tests their language or execution yet. That backlog is the honest size of the "silent loss"
exposure.

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
