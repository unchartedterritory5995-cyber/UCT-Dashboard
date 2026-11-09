# teach-ship-5: the visual-teaching browser runner, givens and status (test tooling + docs)

Base: ship-4. Stack position: 5 of 5. Local only; not pushed. Test tooling and documentation only: no product behaviour change.

## Changes
- **`app/src/testing/agent/guide/teach.mjs`.** It follows each walkthrough in headless Chrome on the agent harness (scripted model). A row passes only when the gold ring sits on the last step's primary control.
  - Region-aware right-clicks: the chart library's own layout, or the drawing layer's own pixels, each accepted only when the product's region menu answers.
  - The page reports a hover-capable pointer.
  - A hot-reloaded page is reported as a harness fault.
- **`given.mjs`.** Declared pre-state built through the app's own prefs, routes and stores: drawings, price and indicator alerts, a Multi Chart board, chart and widget tabs, Theme Tracker data and theme sets, News & Catalysts, Breadth and its live row, saved grids.
- **`cases.inventory.json`, `expected.json`, `status.mjs`.** Cases are the inventory's own words that reach the walkthrough a person assigned. `status.mjs` writes `docs/agent/CHARTS_TEACH_STATUS.md` from a run. The inventory probe's case export is in ship-1.
- **`docs/agent/CHARTS_TEACH_STATUS.md`** from one complete run, BROWSER-MOCK-MODEL. The PR-teach-gen-1 draft is included for history.
- **`runs/*.results.json`.** Whether raw run files belong in the repo is the owner's call.

## Note
Taking the final tooling at the first conflict collapsed the later givens commits into the "Theme Tracker and News" commit. The tooling is byte-identical to teach-on-b's.

## Touches deixis / useAgent / runtime / host
No.
