# teach-cov-2: walkthrough coverage — two-part asks, drawing tools and edits, indicator alerts, Multi Chart and layout controls

Base: `agent/pl/teach-cov-1` @ `42a07b210f`, which includes the C3-120 release-switch fix. Local only; not pushed. Evidence: LOCAL native Windows Node v24, BROWSER-MOCK-MODEL / SIMULATED. Not gate evidence.

## Held-out (written first: `810765e977`, `app/src/agent/agentGuideHeldOutCov2.test.js`)
26 phrasings in this file's own words.
- Routing: 6/26 before the entries, 26/26 after.
- Browser, first single run: 25/26. H2-26 (layout version history) failed only for a missing runner given: the version store's status route. With that given added: pass.
- Final single run: 26/26.

## Behaviour changes (guide only)
- **Two-part asks** (`guide/sequence.js`, `capabilities/guide.js`), e.g. "how do I add an RSI and then change its length":
  - One walkthrough: the first part's steps, then the second's.
  - A second part that points back ("change ITS length", "flag IT") takes the first part's thing.
  - Both parts must reach a walkthrough, or the ask is read whole as before.
  - The first part's controls no longer end the walkthrough.
  - It starts within the first part.
  - Its title reads "A, then b".
  - Rail: `agentGuideSequence.test.js`.
- **Drawing tools by their own names**: pitchfork, parallel channel, vertical line, horizontal ray, extended line, anchored VWAP (also "anchor a VWAP"), text note, position calculator, price move, bars & time (also "count the bars between…"), cup curve.
  - Arrow, circle, channel and measure count when a verb places them on the chart.
  - "Extended line" is no longer read as extended hours.
  - A Formula Builder signal marker ("an arrow … when true") stays the builder's.
- **One drawing's own edits by name**: colour by a colour name ("make that trendline pink"), hiding just one ("hide just that fib"), moving one point. Trendline, box, channel, arrow and circle now count as drawings for those edits.
- **Indicator alerts by their indicator**: "delete my RSI alert" now goes to the indicator alert's own Delete, not the price-alerts widget.
- **Multi Chart's layout controls without the word "grid"**:
  - sync the crosshair(s) or the time range across charts
  - next/previous, refresh and exit groups
  - "get out of groups mode"
  - These are guide rows only. The Multi Chart family code is not touched.
- **Timeframe**: "switch this chart to weekly" reaches the timeframe walkthrough.
- **Drawing titles** take "an" where needed ("Drawing an Arrow").

## Re-judged by hand
- **C1-119 and C1-120**: from the matrix's `alertIndicator` (the form) to the indicator alert's own Pause and Delete rows.

## Runner (test tooling)
- A grid filled from a group, for the group rows.
- The version store switched on, for a layout's Version history rows.
- `cases.inventory.json` regenerated: 263 → 284.

## Found, not changed (for the Lead)
- **Version history behind a server switch.** A layout's Version history row shows only while the server's version store answers `enabled` (`probeArtifactVersions`). When it is off, the walkthrough would ring a menu without that row. This is the same class as C3-120, but the switch is a server probe (async), not a local accessor. Proposed: the same release rail, fed by the probe's cached answer.

## Status (one fresh full runner pass)
- **Result:** 245 VERIFIED of 284 cases, up from 222 of 263. None lost; 23 rows added.
- **New cases passing:** C1-107, C1-109, C1-119, C1-120, C1-130, C1-132, C1-133, C1-139, C1-140, C1-142, C1-143, C1-144, C1-146, C1-147, C1-159, C2-099, C3-045, C3-046, C3-049, C3-050, C3-051.
- **Previously failing, now passing:** C3-040 and C3-041.
- **Program total:** 245 of 499.
- **How the pass ran:** each case was run once. Vite died 110 cases in, so the pass finished in two invocations on the same code, with Vite restarted fresh.

## Touches deixis / useAgent / runtime / host
No. Goldens are unchanged (no new feature ids).
