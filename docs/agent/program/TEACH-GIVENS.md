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
  - Known widening: "response" now carries the answer concept, so a request like "response time" does too. It routes nowhere new in the 30 guide rail files.

## Still failing, and why (findings, nothing fixed)
- **C2-070 and C2-071 (builder signal options): a walkthrough gap, not a given.**
  - The options show only after the member types a yes/no formula and picks Signal inside the sheet the walkthrough itself opens (New formula resets it).
  - Proposal: add a "type a formula such as close > open" step and a "choose Signal" step before the last step.
- **C3-122 (Volume Surge Delete or Rename list): a walkthrough gap, not a product bug.**
  - The member's list is present (the existing `volume_scan_lists` rule). Delete list and Rename are inside the list picker's menu (`VolumeScanLists.jsx`, `open &&`), which is portaled to `document.body`.
  - The walkthrough has no step that opens the picker, and its target is scoped to the widget (`w()` adds `widgetType`), so it can't find the portaled row.
  - Proposal: an `open` step on the existing `data-guide="volumeScan.scope"`, and a final target that is not widget-scoped. No new attribute is needed.
- **C3-219 (ETF holdings):** not investigated.
- **Harness defect (test-only):** `agentHarness.jsx ?defs=1` answers GET `/api/user-definitions` with a bare array. The app's fetcher requires `{ definitions: [...] }` and rejects anything else as malformed. In the teach runner the live relay also takes every `/api/user-definitions` call first.
