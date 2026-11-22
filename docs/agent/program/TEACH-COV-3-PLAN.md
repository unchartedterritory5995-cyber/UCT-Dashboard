# TEACH-COV-3 plan: the 39 cases cov-2 did not verify, by root cause

> **BROWSER-MOCK-MODEL / SIMULATED.** Every count below is from the local agent harness with a scripted model (LOCAL native Windows Node v24, headless Chrome). It is not production evidence and not gate evidence.

Source: teach-cov-2 @ `aca5984473`, `app/src/testing/agent/guide/runs/2026-11-09.cov2.results.json`. That run verified 245 of 284 cases, so 39 were not VERIFIED. Each failure below is read from the run's own record (`why`, its last steps, and its given).

## The four root causes

| Root cause | Cases | What it means |
|---|---|---|
| A. Harness: missing pre-state | 21 | The walkthrough is right, and its last step honestly says the control appears only once something exists, such as a saved indicator, a running replay or a loaded feed. The run gave no such state. |
| B. Harness: runner can't do the person's action | 9 | The step asks for something the runner doesn't do: press a key chord, type a name, pick from a list, or right-click on a drawing's own pixels. A person would get past it. |
| C. Guide gap: control not addressable as taught | 6 | The guide points somewhere the control can't be reached at that moment: off-screen in a tab, on a cell too narrow to show it, or behind a widget tab it never opens. |
| D. Release switch off: correctly "unavailable" | 3 | The control is behind Wave R's capture switch, which is off by default. The truthful result is "not available yet" and no ring. One case already does this (C3-120). Two cases (Indexes) still say "I can't see …", which is a guide gap of the C3-120 kind. |

### A. Missing pre-state (21): the walkthrough is right; the run lacked the state
| Case | Walkthrough | Needed given |
|---|---|---|
| C1-009 | Deleting a custom timeframe | a custom interval (the timeframe menu's own pref) |
| C1-038 | Clearing all comparisons | a compared symbol on the chart |
| C1-045, C3-210 | Leaving replay | replay running, through the app's own `chart.replay` capability with a scripted plan |
| C2-007 | Adding your own indicator | a saved indicator definition |
| C2-092 | When a signal alert fires | a yes/no-signal indicator chosen in the alert form |
| C2-100 | Why an alert can't fire | a blocked indicator alert (simulated `/api/indicator-alerts`) |
| C3-059 | Resetting a chart in the grid | a cell with settings of its own (`multichart_state`) |
| C3-122, C3-123 | Volume Surge list delete and add | one of the member's own scope lists |
| C3-141, C3-144, C3-147 | TE News headline actions | a loaded TE feed (fixture route) |
| C3-150, C3-217 | Company panel (when it reports; collapse) | Company Info on the chart |
| C3-219 | An ETF's holdings | a chart on an ETF symbol |
| C3-151, C3-155 | Calendar economic stars; earnings row | a calendar day with events and reporters (fixture routes) |
| C3-198, C3-199, C3-200 | AI Search answer save, copy, Journal | an answered question (scripted answer) |
| C3-203 | Editing a note | an open note (simulated Notebook route) |

### B. The runner can't do the person's action (9)
| Case | Step it stops on | Runner ability needed |
|---|---|---|
| C2-066, C2-073, C2-076 | "Click the chart, then press Alt+Shift+A" (Formula Builder) | press the chord the card names, through CDP key input on the chart |
| C3-070 | "Type a name for the list", after which Create stays greyed out | type a placeholder into a field step, then go on |
| C2-091 | the alert Plot list appears once MACD is chosen | pick the option the step names in a select |
| C1-152, C1-153 | a fib's or measure's own menu row | right-click on the drawing's own pixels (as for a line), not its bounding box |
| C3-136, C3-146 | after the Place step, "Looking for it…" | follow a placed widget to its new cell before ringing |
| C3-001 | "Click any of these" ends the walkthrough before the ring check | grade the step on the press, as the overlay does |

### C. Guide gaps: control not addressable as taught (6)
| Case | What happens | Proposed fix |
|---|---|---|
| C1-018 Thin bars | "It's on this tab: scroll down" | scroll the settings tab to the row (as `unclip` does for toolbars) before ringing |
| C3-019 Closing a widget tab | "This widget has no extra tabs" on a board that has one | ring the watchlist's own second tab: select it first, then its × |
| C3-023 A chart tab's link colour | "I can't see the tab's dot" | open the chart's tab strip, then ring the dot |
| C3-058 One chart's session in the grid | "This chart is too narrow" | at harness size, maximize the cell first (the walkthrough's own Maximize step) |
| C3-183, C3-184 Indexes | "I can't see Hide …", "… Send these index levels …" | **these move to D**: the Indexes widget is a Wave R capture widget. Apply the C3-120 release rail so the guide says "not available yet" while the switch is off |

### D. Release switch off: correct as "unavailable" (C3-120, plus C3-183/184 once railed)
These stay unVERIFIED while the switch is off. That is the truthful state, not a gap.

## teach-cov-3: ranked, with expected gains
Each item is its own commit, with held-out phrasings first where routing changes.

| # | Work | Kind | Expected cases gained |
|---|---|---|---|
| 1 | **Routing for the next families** (branch started: held-out set `fe0a699e9b`, routing 5/21 before): comparisons by "overlay" / "comparison" / "own scale"; the indicator draft by "draft" and "when … true"; widget controls named by what they do (theme sort and basis, fundamentals view, flow filters by call/put/premium, breadth readings, new-highs universes); going to a year; more two-part asks | guide (routing) | about **+12–18** inventory rows from ASSIGNED / NOT REACHED: compare 5, builder 6–9, widgets 4–6, date 1–2. Each also needs its given where marked in A. |
| 2 | **Givens batch** (A): TE feed, AI Search answer, calendar day, company panel and ETF chart, comparison, custom interval, saved indicator, own Volume Surge list, open note, replay running, cell with own settings, blocked alert | runner givens, through the app's own routes and stores | **+19** (C3-059 counts only if its cell given lands; C2-092 needs its select ability, item 3) |
| 3 | **Runner abilities** (B): chord key press, type a placeholder, pick a select option, right-click on drawing pixels, follow a placed widget, grade the step on the press | runner | **+9** |
| 4 | **Release rail for Indexes** (C3-183/184): reuse `guide/releases.js` with the capture switch | guide (truthfulness) | 0 VERIFIED (correctly). Removes two false "can't see" answers. |
| 5 | **Guide gaps** (C): scroll a settings row into view; select a widget tab before its ×; open the chart tab strip; maximize a narrow cell first | guide | **+4** |
| 6 | **Version history behind its server switch** (cov-2 finding): feed the release rail from `probeArtifactVersions`' cached answer | guide (truthfulness) | 0 VERIFIED. Correct when the store is off. |

**Expected after cov-3:** about 245 + 12–18 (new rows) + 19 + 9 + 4 ≈ **289–295 VERIFIED of about 300 cases**. The remainder would be D (release switch off) and rows whose inventory words stay ambiguous on purpose ("log", "take RSI off", "show that one").

## Order and gates
- Items 4 and 6 first (truthfulness, small). Then 1 (held-out set already committed), then 2 and 3 together (one fresh full runner pass), then 5.
- No lock slot until the Lead clears it. Targeted vitest only until then.
- Each branch still needs its full suite, PR doc, and before/after counts before it is reviewable.

## Request to the builder/Pine team: an anchor for the formula's intent (owner to route)
The guide can only point at controls the product names with a `data-guide` anchor. In `components/chart/builder/BuilderSheet.jsx`, the "What is it for?" radiogroup (Plot / Signal / Value, inside `data-testid="intent-section"`) has none. That leaves the guide no honest walkthrough for signal markers and signal colours. Those options (`builder.signalLook`) appear only after the member types a yes/no formula and chooses **Signal**. A walkthrough that can't point at Signal either rings a control that isn't there yet, or skips the step the member needs.

**Request:** add one attribute-only anchor, `data-guide="builder.intent"`, on that radiogroup. No behaviour change is needed. The guide would then teach the whole path: the formula box ("such as close > open"), then Signal, then the marker and colour options.

This unblocks 4 cases, which today correctly show the honest sentence "These show once the formula gives a yes or no…":
- C2-070 Set signal markers
- C2-071 Colour candles or background on a signal
- held-out H3-09 "show a dot under the bar when my condition is true"
- held-out H3-10 "paint the candles when the signal is true"

The Lead's ruling (option c) leaves the anchor to the builder team, because #982 just changed that file and more may be in flight.
