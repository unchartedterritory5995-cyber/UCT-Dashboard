# PR draft: agent/pl/teach-gen-1. Generalized visual teaching for the Charts workspace

Status: review candidate, local only. Not pushed, no PR opened. Pushing waits on the owner's release decision. AUDIT reviews this read-only from the local ref.
Evidence label: LOCAL native Windows Node v24, BROWSER-MOCK-MODEL / SIMULATED. No paid model calls, no backend, no pytest run.

## Summary

The Agent's "show me how to…" walkthroughs now teach the Charts workspace's long tail through general mechanisms instead of a rule per phrase:

- **A concept lexicon** reads the member's words.
- **A catalog** describes each control by the name the product already gives it.
- **Steps are built** from where the control lives.
- **Ambiguous words get a question**, never a guess.

The teaching count is now measured by a committed browser runner, so it can be reproduced. The 2026-11-05 runner was never committed.

**Browser-VERIFIED teaching (BROWSER-MOCK-MODEL): 206 of 499 inventory rows.** That is from one complete run of 255 cases (206 pass) on the final code, 8631b1f329, (`app/src/testing/agent/guide/runs/2026-11-07.final.results.json`). The 2026-11-05 figure was 283 from an unreproducible runner. Measured with this runner: round 2 had 152 and round 3 had 195. Every one of these counts (152 → 195 → 203 → 206) is BROWSER-MOCK-MODEL: the local agent harness, a scripted model, synthetic bars and fixtures. None is production evidence or gate evidence.

**Base branch.** The branch was created from `agent/pl/guide-followup-1` at `1059f6483b`, which is not on master. That base carries PR #864's follow-ups (named-chart resolution, bare tickers, Multi Chart rows): 9 commits, 12 files, including `guide/namedChart.js`, `guide/slots.js` and `widgets/TradeExchangeNewsParts.jsx`. Master was merged in, the latest being `7304620153` (merge `e8c124d5c0`), always by merge and never by rebase.

## Mechanisms

### `app/src/agent/guide/words.js`: concept lexicon
- A request is read as concepts: synonym stems and phrases (delete / remove / get rid of; export / download / csv).
- Any word no concept knows is kept as itself, so a product name such as "watermark" or "heikin" matches only itself.
- Key chords ("Alt+Shift+W") are stripped first.
- **OBJECT concepts:** a request naming an object the control doesn't act on is not about that control. "Delete a ticker from my list" is not "delete a list".

### `app/src/agent/guide/controls.js`: the named-control catalog
- **What an entry is:** a control the product already names (data-guide anchor, accessible name, tooltip or label), plus its place, plus what it needs (`need`, `any`, `also`, `not`). The control's own name counts toward the match.
- **Steps are built from the place:**
  - a widget, added from Widgets ▾ if absent;
  - a Watchlist widget's list or picker;
  - the layout library, or a layout's menu on the bar;
  - a drawing's menu, generated from `drawingSettingsSchema` (which drawing types carry each row);
  - a Chart Settings tab;
  - the chart's toolbar and the panels it opens.
- **Controls that appear later** (Send to Journal with no data, watermark options while it is off) ring where they will appear and say why.
- **Never guessing:**
  - A control fully described in a place the words name is shown.
  - Several equal fits get a "Which one do you mean…?" question.
  - Words that don't name the control's place only ever produce a question. That happens only when no other walkthrough took the words, and only when every word is one the catalog understands.
  - A drawing type that lacks the control is said, never swapped for another.
- **Watchlists:** only controls the Charts Watchlist widget actually shows are taught. Pick mode hides the list header (`.pickMode .wlHeader { display: none }`, an owner product decision, left untouched), so deleting a list is taught through the picker's own bin.

### Overlay and target fixes (`GuideOverlay.jsx`, `placement.js`, `targets.js`, `capabilities/guide.js`)
- **Pressed control finishes its step.** A step with nothing to wait for now moves on, or ends, when its control is pressed, even if the control stays on screen. No ring is left behind (pl-auto howto-10).
- **Card never under the pointer.** The card is never placed under the member's pointer. A hover menu (Layouts ▾ → Multi Chart) used to close when the card landed under the pointer.
- **Named chart wins over the click.** The words always reach `answer()`, which resolves the chart named against the real board. Before, the fast path dropped "the top right chart" when it couldn't see the board (selection oracle `flow-ring-named`).
- **Rename and Version history** ring the member's own layout on the bar by name, or say they have none.
- **New target forms:** `nameRe` (accessible name or tooltip by pattern), `lead` (label prefix), and `within: '@chart'`. A chart-scoped `@chart` box never takes the same control from another chart.

### The browser runner (`app/src/testing/agent/guide/`)
- **`teach.mjs`.** One headless Chrome per case on the agent harness, scripted model, temp profile deleted. It types the words into the real composer and follows the card with real CDP input. A case passes only when the gold ring sits on the last step's primary control, read with the guide's own store and target reader in the page. A greyed-out control counts; a fallback does not.
- **Region-aware input.** A right-click goes to the region the card names. Candidate points come from the chart library's own pane, price-axis and time-axis layout, or from the drawing layer's own painted pixels. A candidate is accepted only when the product's own region menu answers with the row the step waits for. For a non-chart control, the runner also tries the ringed element's own cells: a list row's menu is on its symbol cell.
- **Hover-capable pointer.** The page reports a hover-capable mouse. Headless Chrome reports none, and the drawing layer hit-tests only under a hovering pointer.
- **`given.mjs`.** Declared pre-state, built through the app's own prefs, its simulated /api routes and its stores:
  - a drawing of a given type (drawings store, on the chart's own bars);
  - price alerts and indicator alerts;
  - a Multi Chart board;
  - a chart's or a widget's second tab.
- **`cases.inventory.json`, `expected.json`, `status.mjs`.**
  - Cases are the inventory's own words that reach the walkthrough a person assigned to the row. Assignments in `expected.json` come from the 11-05 matrix's Guide feature column plus rows reviewed by hand.
  - `status.mjs` writes `docs/agent/CHARTS_TEACH_STATUS.md` from a run.
  - The commands are in `README.md`.

## Teaching count method
1. Every inventory row (`CHARTS_COVERAGE_MATRIX.md`) is asked in its own words: "how do I " + its Human action, or "show me how to " + its Example phrase (`agentGuideInventory.test.js`, routing).
2. A row becomes a browser case only when those words reach its assigned walkthrough.
3. VERIFIED counts only browser passes. Every other column is routing only, with the reason in the row.
4. A family walkthrough (one feature, many rows) is matched at the feature.

## Held-out results (honest independence)

| Set | Written | First run | After fixes |
|---|---|---|---|
| Round 1: `agentGuideHeldOutControls.test.js` (49 rings, 3 asks, 7 left alone) | before the catalog, commit `5d1fb7211f` | 37/49 · 2/3 · 7/7 = **46/59** | 47/49 · 2/3 · 7/7, then 7 rows WITHDRAWN (see below) |
| Round 3: `agentGuideHeldOutControls2.test.js` (10 rings, 5 left alone) | before its entries, commit `51458b2a4d` | 1/10 before the entries; **6/10 · 4/5** after | 10/10 · 5/5 |

- "After fixes" is not independent: the fixes followed the misses.
- Recorded misses are kept as `it.fails`:
  - "bookmark a news headline" is an authoring error; the guide rings the right Save headline button.
  - "line the watermark up" reads "line" as a drawing.
  - "delete a list" shows the watchlist delete rather than asking.
- The 7 WITHDRAWN rows name list-header controls the browser proved unreachable on /charts. They now assert those controls are never rung.

## Shared-golden changes
- `app/src/agent/contract/manifest.golden.json`: the `guide.show` `feature` enum gains `"control"` (first position). Its `hints` gain ", and control for any other named control (a widget's button, a list's or a drawing's menu row: detail = the member's words)".
- `api/services/uct_agent/scan/sat/section_b_requests.json`: the same two changes in its copy of `guide.show`. The copy equals the golden.
- No other golden changed.

## Tests
- Full `src/agent` vitest suite, through the suite lock: green on the release candidate (totals in the round-5 report).
- Guide test files: 791 tests.
- Browser runner: 203/255 cases.

## Raw run files

`app/src/testing/agent/guide/runs/2026-11-07.final.results.json` (labelled `mode: BROWSER-MOCK-MODEL` in the file) and the generated `cases.inventory.json` are committed, so the count can be reproduced and checked. Whether raw run files belong in the repository at all, or should be kept outside it with only the generator and the status file committed, is **the owner's call**.

## AUDIT T1 / T2: relative and negated chart references (addressed, re-review needed)

- **Base.** `agent/pl/target-plus-multichart` @ `30d1633b23` is merged in (commit `47194b2c45`). If AUDIT changes that chain, it is merged again.
- **The fix.** `guide/namedChart.js` calls deixis.js's exported `relativeChart` and `negatedPointer`. There is no copy. `showFeature` passes the clicked chart as the anchor.
  - "the chart below this one" rings the clicked chart's neighbour.
  - "every chart except this one" is asked about, never walked on the click.
  - A relation with no neighbour, or with two, is said or asked.
  - A bare "this" stays the click.
- **Tests** (`agentGuideRelational.test.jsx`): 6 relation, 3 negation and 2 bare-"this" cases.
- **T2 agreement test.** The same 14 probes run through `namedChart` and `deixis.chartsNamedBy`. When execution names one chart, the guide rings that chart. When execution names none, the guide picks none. A negated reference never yields a chart.
- **Pending: "the other chart".** deixis reads it (`OTHER_CHART`) but does not export it. pl-exec would need to export it. The test is skipped, and nothing is copied.

## pl-auto tutorial defects (BROWSER-MOCK)

| Defect | State |
|---|---|
| P1 stale ring (the walkthrough's chart closed) | Fixed. Chart-scoped targets no longer fall back to another chart; the walkthrough pauses and says so. |
| P2 another chart's settings window advances the step | Fixed. While another chart has the same control, the step advances only on a press of its own control. |
| P2 a new request mid-walkthrough | Partly fixed. The Send button press ends it. Enter in the message box needs `useAgent` to call `guideStore.endForNewRequest()` (pl-exec; the hook is exported). |
| P2 Escape with focus on the board | Pending a shared change. `guideStore.escapeOnBoard()` decides it. It needs an Escape observer declared in `pages/command/shortcutRegistry.js`: the board's handlers stop the key before the guide hears it, and observers get no event. No raw key listener was added (`keyListenerCensus`). |
| A click elsewhere does not end the walkthrough | Unchanged: owner decision. |

## Owed / not done
- **pytest (not run here, by rule) for the readers of the golden:** `tests/test_uct_agent_contract.py`, `test_agent_eval_proxy.py`, `test_agent_eval_run.py`, `test_uct_agent_acceptance_stabilization.py`, `test_uct_agent_args_live_shapes.py`, `test_uct_agent_autoapply.py`, `test_uct_agent_breadth*.py`, plus whatever reads `section_b_requests.json` (`api/services/uct_agent/scan/sat`).
- **`agentBreadthTiming`** (not owned here) asserts wall clock including CPU queueing. The proposal is to assert a `performance.measure` around the local path instead.
- **52 routed rows still fail in the browser.** Each reason is in `CHARTS_TEACH_STATUS.md`: widget data missing on the harness, replay running, company panel, saved grids, builder steps, and others.
- Instance resolution for two widgets of the same type, and a list named only by its own name ("export Momentum").
