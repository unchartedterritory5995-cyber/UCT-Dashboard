# Teach givens: declared starting state for walkthrough cases

> LOCAL, agent harness, BROWSER-MOCK-MODEL (scripted model, synthetic bars, fixtures): real headless Chrome with real CDP input. This is not production or gate evidence. Branch `agent/pl/teach-givens`, base master `dfc645ccb3`.

## What it is
- A case declares the state it needs: `given: [...]` on the case, or by row id in `caseGivens.json`, because the inventory cases file is generated.
- One registry, `app/src/testing/agent/guide/givens.mjs`, maps each name to its build. An unknown name throws.
- Two kinds:
  - **Given via store/route seed.** The app's own stores and routes hold the state: the board pref, prefs, fixture routes answering the app's own requests, harness query, the alert catalog, or a page setup through the app's modules or routes.
  - **Given via real-input prelude.** The member's own act, with real CDP input on the product's controls. It is used only for session state that no store holds. Approved by the Lead 2026-11-10.

| Given | Kind | Built from | Rows |
|---|---|---|---|
| aiAnswer | real-input prelude | AI Search widget on the board. The member asks; `/api/ai-search` answers with a fixture, and the stream route is refused. | C3-198, C3-199, C3-200 |
| noteOpen | store/route seed | Notebook widget `opts.noteId`, with the note on `/api/j2/notes/<id>` | C3-203 |
| replayRunning | real-input prelude | Tools ▾ → Replay Mode → the date typed as digit keys → Start replay | C1-045, C3-210 |
| savedIndicator | store/route seed | GET `/api/user-definitions` returns `{ definitions: [row] }`, using the authoring fixture `styled_markers` | C2-007 |
| alertFormMultiLine | store/route seed | the alert catalog lists MACD (3 plots) first, and the form opens on `catalog[0]` | C2-091 |
| alertFormSignal | store/route seed | the catalog lists a member's yes/no formula (`output_type: condition`) first | C2-092 |
| blockedAlert | store/route seed | an indicator alert, created on the alerts route, naming an indicator the catalog lacks | C2-100 |

## Result: 10 rows unblocked
Evidence is under `evidence/teach-givens/`. Raw runner output was committed before it was read, and failed attempts are kept in `attempt-N/`.

- **BEFORE:** the 14 pre-state rows went 0/14.
- **AFTER:** 10 rows pass. They are C1-045, C2-007, C2-091, C2-092, C2-100, C3-198, C3-199, C3-200, C3-203 and C3-210.
- **Held-out set** (`cases.givens.heldout.json`):
  - The givens pass on every held-out case that reaches its walkthrough.
  - Routing misses that are not about givens: HG-12 ("which line my alert watches" routes to the drawing menu), HG-14, HG-15 and HG-17 (why-questions about an alert reach no walkthrough).
- **Routing family fix** (`words.js` `answer`): an AI answer named indirectly ("the response", "what the AI said / wrote / told me") went from 0/5 to 5/5 (HG-03 and HG-18 to HG-21). C3-198 to C3-200 still pass after it.
  - "response" carries the answer concept ONLY when "AI" is in the request (`words.js` `answer`). Railed for AUDIT in `agentGuideAnswerWords.test.js`: "show me the response time", "response from support" (and copy/save forms) carry no answer and reach no AI Search walkthrough; positive control: "show me how to copy / save the AI response" and "how do I reopen a saved AI response" do. Mutant (plain `respons\w*`): 9 of 30 fail. Not built: bare "show me the AI response" (no copy/save/reopen) opens no walkthrough, on this branch and before it (it.todo).

## Walkthrough-gap families (after the first doc, 2026-11-10)
Held-out first (`4001ec8cd0`), BEFORE raw (`ea3689276a`), fixes in `c5586a7b1c` and `4111ddec2a`, AFTER raw with attempts 1-4 kept.
- **A signal's in-sheet steps (C2-070, C2-071).** The walkthrough types a yes/no formula ("such as close > open") and chooses Signal, by the choice's own label (`INTENT_LABELS.signal`, railed), before the last step.
- **Portaled widget menus (C3-122).** `w()` has a `portaled` flag: the target is found in a menu on the page, outside every board cell, and never in another widget. The Volume Surge walkthrough opens the list picker first.
- **Which line an alert watches (`ALERT_LINE_ASK`).** "Which line / plot / series an alert watches" is an indicator's line (the alert form's Plot), never a drawn line.
- **Runner (test-only, `4111ddec2a`).**
  - It types real keys into the one visible editor inside a ring. CodeMirror reads key input, not a value.
  - It wheels a covered control clear before clicking.
  - The `intent-*` test-id branch of `agentGuideTargets` was removed with the target that used it. The Signal step is now a label, railed against the product's own copy in `agentGuideGapFamilies`.

## Final numbers (LOCAL, BROWSER-MOCK-MODEL, fresh Vite)
| set | head | result | evidence |
|---|---|---|---|
| the 14 pre-state rows | `4111ddec2a` | **13/14**. C3-219 is still failing: its last step shows the fallback "View Holdings shows on a chart of an ETF or an index", so the harness chart is not one. It needs an ETF-chart given, not built. | `final/inventory.results.json` |
| held-out (`cases.givens.heldout.json`) | `4111ddec2a` | **24/27**. HG-14, HG-15 and HG-17 are why-questions about an alert. They reach no walkthrough (a routing family, not givens). | `final/heldout.results.json` |
| the runner change: the 24 cases with a typing step that last passed (runs 11-07..11-09, matched by id) | `4111ddec2a` | **24/24**. None missing, none extra. | `final/runner-regression-typing.results.json` |
| the runner change: the whole inventory (318 cases) | `4111ddec2a` | **308/318, local, simulated, unpaired.** No comparison against master and no regression claim (AUDIT T1 ruling, 2026-11-11). The 10 failing rows: C1-152, C1-153, C3-023, C3-058, C3-120, C3-136, C3-146, C3-183, C3-184, C3-219. | `final/inventory-full-318.results.json` |

**Known failures, all pre-existing** (failing in every run since 2026-11-07, from `final` through `cov5b`): C1-152 and C1-153 (no point of the named region opens the row), C3-023, C3-058, C3-120, C3-136, C3-146, C3-183, C3-184 and C3-219.

## Findings still open (nothing fixed)
- **C3-219 (ETF holdings):** it needs a given for an ETF or index chart. Not built.
- **Harness defect (test-only): FIXED in `c5586a7b1c`.** `agentHarness.jsx ?defs=1` answered GET `/api/user-definitions` with a bare array. It now answers `{ definitions: [...] }`, the shape the app's fetcher requires. In the teach runner the live relay still takes every `/api/user-definitions` call first, so `savedIndicator` serves its row on that route.
