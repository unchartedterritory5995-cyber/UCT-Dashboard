# teach-cov-1: walkthrough coverage — indicator settings and appearance, Watchlist rows and columns, the Scanner's controls

Base: `agent/pl/teach-ship-5-runner` @ `eddf82a426` (its head, with its PR doc). Local only; not pushed. Evidence: LOCAL native Windows Node v24, BROWSER-MOCK-MODEL / SIMULATED. Not gate evidence.

## Held-out (written first: `9eb3a86819`, `app/src/agent/agentGuideHeldOutCov1.test.js`)
27 phrasings in this file's own words, each naming the last step's control.
- Routing, before the entries: 14/27. After: 27/27.
- Browser, first single run after: 26/27. H1-13 ("put NVDA on my watchlist") failed. The walkthrough was right, but the runner did not click a list for "Click the list to add to." After the runner's list-pick fix: 27/27 on its own single run. The final pass's result is in the status section.

## Behaviour changes (guide only: `guide/registry.js`, `guide/actions.js`)
- **Indicator settings.** Once the words name an indicator, these reach its settings (`indicatorEdit`), as well as the setting words that already did:
  - a value it is set to or uses ("set my RSI to 21", "so it uses 9 bars", "make RSI 7")
  - where it is worked out ("calculate this RSI on the weekly")
  - how it is drawn ("as a histogram instead of a line")
- **A named part of an indicator** ("the signal line", "the upper band") reaches its settings even without the indicator's name. It no longer hides the whole indicator from the legend menu.
- **Indicator colour.** A colour by its name reaches the colour walkthrough ("make my moving average red", "MACD bars blue").
- **Plot style.** "plot style" alone reaches the plot-style row.
- **Watchlist:**
  - Opening one of your lists ("show my Momentum list"). This is a new row that rings the picker.
  - A ticker put on a list by its name ("put NVDA on my watchlist"); a ticker taken off one ("take TSLA off my list"); adding to Flagged.
  - A Volume Surge list is excluded, so it keeps its own control.
- **Scanner:**
  - A new row for a scan's columns.
  - Sort also by "order" or "rank".
  - Conditions also by "screening for", "looking for" or "rules".
  - Columns, conditions and sort now sit ahead of "its results", whose words they share.

## Re-judged by hand
- **C3-063 "Open a list in a widget (own)".** It is reassigned to the new "Opening one of your lists". The matrix's "Using watchlists" rings no list.

## Runner (test tooling)
- **`--cases <file>`:** runs a held-out set's own phrasings.
- **List picking:** the runner picks a list when the step says "Click the list…".
- **New `scan` given:** a Scanner widget with a preset scan open (its own `opts.scanKey`), with results on the scan's own route.
- **`cases.inventory.json`:** regenerated, 255 → 263.

## C3-120 "Send a scan to Journal" (Lead ruling, `15f1235016`)
- **Why:** the scan's Journal buttons are behind the Wave R capture release switch (`captureEnabled()`, off by default). The guide used to say "Pick a scan first" for a button no member could see.
- **Now:** `guide/releases.js` reads the same accessor when the walkthrough starts.
  - OFF: nothing is rung, and the member is told it isn't available yet.
  - ON: the walkthrough runs as designed.
- **Rail:** `agentGuideRelease.test.jsx` covers both states and an accessor that throws.
- **Browser:** both states checked in single runs.
- **Status:** C3-120 stays unVERIFIED while the switch is off, which is the truthful state.

## Touches deixis / useAgent / runtime / host
No.

## Owed
No pytest is owed by this slice (no golden changes).
