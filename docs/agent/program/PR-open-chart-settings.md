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

**Priority note (Lead, 11-11): Charts execution first, tutorial expansion paused.** The execution half is the point of
this PR. The walkthrough half was already built before this PR (the `settings` guide row), so it is kept as is. This
PR adds no new walkthrough. It only verifies that row with unit tests and adds right-click / Alt+, to its explain line
and the Agent's door to its "do it" line. No further tutorial work was done.

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

## Count pins that every new action must update

Census of hard-coded registry/manifest/action-count assertions, taken on master `4257661f2e`
(grep of `app/src/agent/**` for `.length/.size … toBe(N)` / `toHaveLength(N)` and of `tests/*.py` for
`len(...) == N`, then filtered to the ones that count registered Agent actions). The Agent's full registry on
master is 157 actions (`contract/manifest.golden.json`).

| # | file:line | what it counts | master 4257661f2e | moves when a new action is… |
|---|---|---|---|---|
| 1 | `app/src/agent/agentRouting.test.jsx:203` | `FULL.length`: every registered action (the whole manifest, = golden manifest names) | **157** | ALWAYS (+1 per action) |
| 2 | `app/src/agent/agentScreener.test.jsx:133` | `manifestFor(CTX).length`: the manifest the Screener test's member context sees (admin, no Create Indicator access) | **151** | almost always: +1 unless the action is gated out of that CTX (e.g. needs Create Indicator access) |
| 3 | `app/src/agent/agentNl1Selection.test.js:55` | NL-1 core size: actions whose `groupOfAction` is `charts`, `indicators`, `screener` or `agent` (minus `NL1_MOVED_FROM_CORE`) | **37** (charts 16 + indicators 12 + screener 8 + agent 1) | only if the action routes to a core group (domain `chart`/`volume`/`indicator`/`screener`/`agent`, or a group `actions:` list moves it in); must stay <= `NL1_CORE_MAX` 45 |
| 4 | `app/src/agent/agentIndicatorsM2.test.jsx:394` | `FULL.filter(groupOfAction === 'indicators')` | **12** | only if the action routes to the `indicators` group (domain `indicator`) |

Not hand-edited pins, but regenerated per action and checked byte-for-byte by
`app/src/agent/qa/capabilityRegression/inventory.test.js` (run with `UPDATE_CAPREG=1`):

| file | what it counts | master 4257661f2e |
|---|---|---|
| `app/src/agent/qa/capabilityRegression/coverage/coverage.json` (`all`, `capabilities`, `applicable`) | capreg catalog (registry incl. dark/gated capabilities) | 176 (`withProductionKinds` 167) |
| `app/src/agent/qa/capabilityRegression/coverage/COVERAGE.md` | rendered from coverage.json | same |
| `app/src/agent/qa/capabilityRegression/coverage/contract.json` | one entry per capability (no count, but a new action must be pinned) | — |
| `app/src/agent/contract/manifest.golden.json` | one entry per action (no count; agentContracts rail) | 157 entries |

Looked at and NOT registry pins (do not move with a new action): `agentNl1Selection.test.js:163-165`
(`NL1_LIMIT` 60 / `NL1_BUDGET` 55 / `NL1_CORE_MAX` 45 constants), `tests/test_uct_agent_nl1.py:184` and
`tests/test_uct_agent_nl1_selection.py:58` (`MAX_CAPABILITIES` 60), `tests/test_uct_agent_v2_corpus_cost.py:27`
(`intents == 158`, the v2 cost corpus `tests/fixtures/agent_v2_corpus_requests.json`, not the registry),
`agentIndicatorsM1.test.jsx:94` (12 indicator instances), `agentCoachVocab.test.js` / `test_uct_agent_coach_vocab.py`
(coach vocab), `qa/f16Rails.test.jsx:71`, `test_uct_agent_qa_f16.py:38` (QA vocab). No server-side (`tests/*.py`)
test pins the Agent action count.

This PR adds one action (`chartSetup.openSettings`), a non-core `chartSetup`-group action visible in the Screener CTX:
pin 1 157 -> 158, pin 2 151 -> 152 (missed at first; failed on AUDIT's merge as `expected 152 to be 151`), pins 3/4 unchanged;
coverage.json 176 -> 177 (regenerated).

## Files (git diff --stat origin/master...HEAD)

     app/src/agent/agentOpenChartSettings.test.jsx                            |  203 ++++++++++++
     app/src/agent/agentRouting.test.jsx                                      |    2 +-
     app/src/agent/capabilities/app.js                                        |    5 +-
     app/src/agent/capabilities/chart.js                                      |   18 +-
     app/src/agent/capabilities/chartSetup.js                                 |   31 ++
     app/src/agent/contract/manifest.golden.json                              |   22 ++
     app/src/agent/discovery.js                                               |    4 +-
     app/src/agent/guide/registry.js                                          |    5 +-
     app/src/agent/host.js                                                    |    9 +
     app/src/agent/qa/capabilityRegression/baseline/baseline.lock.json        |   25 ++
     app/src/agent/qa/capabilityRegression/baseline/corpus.json               |   31 ++
     app/src/agent/qa/capabilityRegression/coverage/COVERAGE.md               |   21 +-
     app/src/agent/qa/capabilityRegression/coverage/contract.json             |   13 +
     app/src/agent/qa/capabilityRegression/coverage/coverage.json             |   94 ++++--
     app/src/agent/qa/capabilityRegression/testing/harness.jsx                |    7 +-
     app/src/agent/qa/capabilityRegression/testing/run.jsx                    |    2 +
     app/src/agent/routing.js                                                 |    4 +-
     app/src/components/chart/pane/ChartPane.jsx                              |    9 +
     app/src/pages/charts/widgets/ChartWidget.jsx                             |   10 +
     app/src/pages/charts/widgets/ChartWidget.openSettings.test.jsx           |  131 ++++++++
     docs/agent/program/PR-open-chart-settings.md                             |   91 ++++++
     docs/agent/program/evidence/open-chart-settings/focused-1.txt            | 1365 ++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
     docs/agent/program/evidence/open-chart-settings/focused-2.txt            |  770 ++++++++++++++++++++++++++++++++++++++++++++
     docs/agent/program/evidence/open-chart-settings/mutant-claims-open.txt   |  557 ++++++++++++++++++++++++++++++++
     docs/agent/program/evidence/open-chart-settings/mutant-no-door-check.txt |   62 ++++
     docs/agent/program/evidence/open-chart-settings/mutant-no-readback.txt   |   62 ++++
     docs/agent/program/evidence/open-chart-settings/pytest.txt               |   20 ++
     docs/agent/program/evidence/open-chart-settings/red-run.txt              |  637 ++++++++++++++++++++++++++++++++++++
     tests/fixtures/nl1_assemble_parity.json                                  |    2 +
     29 files changed, 4171 insertions(+), 41 deletions(-)

Totals: focused vitest batch 1 25 files 3663 passed / 1 todo; batch 2 20 files 2422 passed / 1 todo; mutants 3/3 killed; pytest 13 files 353 passed. Red run 22/28 failed.
