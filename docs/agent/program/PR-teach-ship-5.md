# teach-ship-5: the visual-teaching browser runner, givens and status (test tooling + docs)

Base: teach-ship-4. Stack position: 5 of 5. Master `25f049554f` is merged in through the stack. Local only; pushed by the Lead. Evidence: LOCAL native Windows Node v24, BROWSER-MOCK-MODEL / SIMULATED.

**Production: not yet verified.** This slice is test tooling and documentation. It holds one product line, listed below.

## Behaviour
- **Product: one line in `guide/controls.js`.** The layout library's Delete row no longer takes words about prebuilt, template or global layouts. Those are admin rows with their own controls.
- **Test tooling: `app/src/testing/agent/guide/teach.mjs`.** It follows each walkthrough in headless Chrome on the agent harness, with the scripted model. A row passes only when the gold ring sits on the last step's primary control.
  - Right-clicks are region-aware.
  - The page reports a hover-capable pointer.
  - A hot-reloaded page is reported as a harness fault.
- **`given.mjs`.** Declared pre-state, built through the app's own prefs, routes and stores: drawings, price and indicator alerts, a Multi Chart board, chart and widget tabs, Theme Tracker data and sets, News & Catalysts, Breadth, and saved grids.
- **`cases.inventory.json`, `expected.json`, `status.mjs`.** Cases are the inventory's own words that reach the walkthrough a person assigned. `status.mjs` writes `docs/agent/CHARTS_TEACH_STATUS.md`. The inventory probe gains its case export (`agentGuideInventory.test.js`).
- **Docs.** `CHARTS_TEACH_STATUS.md` from one complete run (210 of 255 VERIFIED at the time), and the PR-teach-gen-1 draft for history.

## Files (against teach-ship-4)
- `app/src/agent/guide/controls.js` (1 line)
- `app/src/agent/agentGuideInventory.test.js`
- `app/src/testing/agent/guide/`: `README.md`, `teach.mjs`, `given.mjs`, `status.mjs`, `cases.inventory.json`, `expected.json`, `runs/2026-11-07.final.results.json`
- `docs/agent/CHARTS_TEACH_STATUS.md`
- `docs/agent/program/PR-teach-gen-1.md`
- This doc

## Touches useAgent / deixis / host / runtime
No.

## Verification (SIMULATED)
- **Full suite before the restack** (at `e603936b25`): Test Files 266 passed | 5 skipped (271), Tests 9299 passed | 6 skipped (9305).
- **AUDIT review (11-08):** ACCEPTED.
- **Post-restack full suite:** run on teach-ship-5 `9a689f56b7`, which contains ship-2 through ship-5 on master `25f049554f`. Path set: `src/agent` plus pl-exec's 9 paths; BelowNormal; LOCAL / SIMULATED. Result: `Test Files 299 passed | 5 skipped (304)`, `Tests 9830 passed | 6 skipped (9836)`. No failures.
- **Still owner's call:** whether raw run files (`runs/*.results.json`) belong in the repo.
