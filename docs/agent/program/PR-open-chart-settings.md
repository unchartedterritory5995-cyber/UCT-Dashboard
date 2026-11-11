# PR: C1-127, "open Chart Settings" (Agent execution + walkthrough)

Branch `agent/pl/open-chart-settings`, from origin/master `381f91acbd`. Worker pl-grid.

## What it does

The Agent can now open a chart's own Chart Settings dialog: "open chart settings", "open the settings for the AAPL
chart", "show me the settings panel for the top-left chart". The walkthrough ("how do I open chart settings") already
existed and still teaches the same door.

## Design

* **One door, no parallel UI.** The gear on the chart header, right-click → Chart settings and Alt+, all call
  `ChartPane.openSettings`. The Agent calls that same function:
  `chartSetup.openSettings` → chart target kind patch `{ openSettings: true }` → `host.charts.openSettings(ref)` →
  ChartWidget adapter `api.agent.openSettings()` → `paneRef.current.openSettings()`. This is the same
  host/adapter pattern as `openIndicatorDoor` / `openCreateIndicator`.
* **Read-back.** ChartPane's handle now exposes `isSettingsOpen()` (a ref of its own `settingsOpen` state) and
  `canOpenSettings()` (the gear's own predicate: not mini, not the own-chart surface). The host snapshot carries
  `settingsOpen` / `canOpenSettings`, and the receipt says "Opened Chart Settings" only after the pane reports the
  dialog open (`chartKind.landed`).
* **Targeting** is the chart kind's existing rule (the deixis words, the clicked chart, "Which chart?"). This PR adds no
  targeting code and does not touch `deixis.js`, `spatialCheck.js` or `clickRef.js`.
* **Undo is not applicable.** Opening a dialog changes no setting. The capability declares `undo: 'none'` and the
  receipt says: "Opening Chart Settings changes nothing, so there's nothing to undo: close it with ✕ or Esc." If the
  open is asked for together with a real change ("weekly, and open its settings"), that change keeps its own Undo.
* **Words.** There is a fast-path phrase (no model call) for open/show/bring up/pull up + chart settings or a settings
  dialog/panel word. Bare "open settings" stays the Settings page (`app.open`). `app.open` now declines "settings" when
  the sentence names a chart: before this PR, "open the settings for the AAPL chart" reached `app.open` as
  "open the settings" once the chart words were lifted off. The routing words for the chartSetup group name it for
  model-path wordings, and the group title is unchanged.
* **Walkthrough.** The guide row `settings` ("Finding chart settings") already existed. C1-127 passed in the
  teach runs of 11-09 (cov2-cov5). It is verified here by unit tests: the sentence matches the row, its first step
  targets `chart.settings` (the gear), and that gear's `onClick` is the `openSettings` the Agent's handle hands out. The
  row's explain now mentions right-click and Alt+, and its "do it" line says "Say “open chart settings” and I’ll open
  them".

## Requests the owner can try (on /charts)

1. One chart on the board: **"open chart settings"**. The dialog opens, and the receipt says nothing was changed and
   there is no Undo.
2. Two charts, AAPL and MSFT: **"open the settings for the AAPL chart"**. Only AAPL's dialog opens.
3. A 2×2 board: **"show me the settings panel for the top-left chart"**.
4. Two charts, none clicked: **"open chart settings"**. It asks "Which chart?" and opens nothing.
5. **"how do I open chart settings"**. The walkthrough highlights the gear and waits for the dialog.

## Tests

* Red first: `a45a1d6a74`, evidence `evidence/open-chart-settings/red-run.txt` (22 of 28 failed before any product change).
* `app/src/agent/agentOpenChartSettings.test.jsx`: the real panel through the fast path. It covers the phrase family, a
  named ticker, a position, the clicked chart, two charts asking, a chart without a door refusing, a dialog that did not
  open getting no success, the already-open case as a no-op, the no-Undo statement, words that are not this door, and
  the walkthrough.
* Excluded-chart controls: "the chart that is not NVDA" with the model aiming at NVDA opens nothing and asks. "The other
  chart" (NVDA clicked) with the model aiming at NVDA opens nothing; with the model on AMD, AMD opens.
* `app/src/pages/charts/widgets/ChartWidget.openSettings.test.jsx`: the real ChartWidget and ChartPane. The adapter
  opens the pane's own dialog, the read-back follows the member closing it, end to end through the host and runtime,
  and nothing is written to opts.
* Capability-regression corpus intent `chartSetup.openSettings` (TIMED board, `expect.settingsOpen`), contract pin,
  coverage regenerated, golden manifest, NL-1 parity fixture, catalog count 157 → 158.

## Known limits

* **Multi Chart grid cells** have no per-cell door (the grid has ONE shared Chart Settings, C3-061). There the Agent
  refuses honestly and points at the gear. The C3-061 grid-settings door is not built here.
* It opens the dialog on its default tab. Opening a given tab ("open the canvas settings") is not built, although
  `openSettings(target)` takes a section.
* **Pre-existing on master, shared targeting (not this capability):** in "<request>, not the NVDA chart" the lifted
  qualifier names NVDA and the negation is not read. A model op aimed at NVDA lands on NVDA, and one aimed at AMD
  is asked about. Probed with `volume.setState` too ("hide volume, not the NVDA chart" hides NVDA's). This sits in the
  #988 targeting area and is not special-cased here. It is recorded as an `it.todo` in agentOpenChartSettings.test.jsx.
* The browser walkthrough was not re-run for this PR. The last real-UI teach run with C1-127 passing is 11-09 cov5.
  The Agent's opening of the dialog has jsdom coverage on the real ChartWidget and ChartPane, but no real-browser
  check yet.

## Merge notes

* `manifest.golden.json`: one hunk (the chartSetup region, ~line 5902). #1059 changes ~359-449 and #1027 ~1643/3620.
* `agentRouting.test.jsx` pins `FULL.length` (now 158): any other PR adding a capability edits the same line.
* `coverage/COVERAGE.md` / `coverage.json` totals are generated. On a conflict, regenerate with `UPDATE_CAPREG=1`.
* `chartSettings.outcome.test.jsx`'s C1-127 `it.todo` is deliberately left alone (#1059 rewrites that line). Drop it
  after both merge.

## Files (git diff --stat origin/master...HEAD)

FILES_PLACEHOLDER
