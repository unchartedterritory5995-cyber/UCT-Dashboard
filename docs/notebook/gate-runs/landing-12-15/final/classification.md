# Final gate, waves 12 to 15: classification

Written by the landing lane, 2026-10-07. Read the manifests, not this page, for the numbers.

## Verdict

**The gated tree is `0ebbf27ef1`. 11 tests fail. All 11 fail on master too, with the same
message. None is caused by this landing.**

| | Run 1 | Run 2 (the one that counts) |
|---|---|---|
| Tree | `5e5d6c0b0c`, identical at both ends | `0ebbf27ef1`, identical at both ends |
| Manifest | `run1-5e5d6c0b0c/2026-10-07T15-49-03.md` | `2026-10-07T17-16-49.md` |
| Test files | 2,986 on disk, 2,986 run | 2,989 on disk, 2,989 run |
| Tests | 21 failed, 41,518 passed, 41,651 in all | 11 failed, 41,583 passed, 41,706 in all |
| NEW against the baseline | 19 | 9 |
| Wrapper exit | 1 (`NEW_FAILURES`) | 1 (`NEW_FAILURES`) |

Command, both runs, from a clean tree on `feat/notebook-w14-land`:
`python scripts/gate_shards.py --shards 6 --out docs/notebook/gate-runs/landing-12-15/final`.
The box had 16 to 17 GB available and no other test run, build or gate at the start of each.

**Why the wrapper still exits 1.** The committed baseline
(`docs/plans/joystick/gate-baseline.json`) was measured on master `73a4286d0` on 2026-09-24.
Of its 126 rows, 124 no longer fail. So every failure master has gained since then reads as NEW.
This lane did not rewrite the baseline: it is shared, and adopting a new one is a decision.
Instead each failing file was run on master itself, in a separate worktree
(`notebook-w14-master-base`, branch of the same name, at `origin/master`).

## Run 2: the 11 failures, each on master with the same message

Evidence: `rerun-alone-10-files-landing-0ebbf27ef1.log` (this tree, the ten failing files by
name: 11 failed, 124 passed) and `same-10-files-on-master-809f754574.log` (master: 11 failed,
123 passed). The two logs were compared test by test: every assertion message is identical.

| Test | What it names | Owning area |
|---|---|---|
| `__tests__/entryExcludesChartEngine.test.js`, entry chunk | `hooks/usePreferences.js` imports `components/chart/instanceShape.js`, which imports the chart engine. `instanceShape.js` is identical to master's | Charts and indicators |
| same file, Notebook surface | the same chain, reached through `NotebookTab.jsx` | Charts and indicators |
| `__tests__/sourcesAreText.test.js` | a control byte (0x08, twice) in `pages/terminal/L0Strip.test.jsx:105` | Terminal |
| `chart/engine/__tests__/enumerationSites.test.js` | `pages/research/tabs/TechnicalTab.jsx` joined the hand-listed set | Research, Technical tab |
| `chart/engine/__tests__/suiteCoverage.test.js` | a new test folder nobody acknowledged: `components/chart/builder/authoring` | Indicator authoring |
| `provenance/panelAdoption.ratchet.test.js` | `components/settings/StandingAlertsPanel.jsx` shows results with no coverage line | Screener alerts |
| `screener/reachable.test.js` | the `WAVE 2 IN FLIGHT` parking note, expired 2026-10-06, five chart-engine files | Charts and indicator renderer |
| `lib/context/symbolLinkChannels.test.js` | `testing/marketcap/marketCapHarness.jsx` reads a symbol parameter by hand | Market cap |
| `lib/persistence/persistenceManifest.test.js` | two `removeItem` calls in `agent/capabilities/watchlist.js` (lines 109, 126) | Terminal agent |
| `hooks/pollingSites.rail.test.js` (in the old baseline) | `hooks/useTickerIpo.js` polls with no row | IPO data |
| `utils/jsonFetcher.test.js` (in the old baseline) | `pages/UCT20.jsx` is listed as unchecked and no longer is | UCT 20 |

No row is a timeout. `enumerationSites.test.js` has been load-sensitive before; here it fails
alone as well, on a named file, so it is not banked as load.

## Run 1: what the 19 NEW rows were

Evidence in `run1-5e5d6c0b0c/`: the 17 failing files run alone on that tree, the same 17 on
master `7409b339e5`, and the run after the fixes.

- **9 rows are master's.** The nine in the table above that are not in the old baseline.
- **1 row was load.** `pages/charts/widgets/ScanObjectCard.test.jsx` passed alone on this tree
  and on master, and passed in run 2. It is not banked.
- **9 rows, in 7 files, were caused by this landing.** One more was hidden inside
  `pollingSites.rail.test.js`, which master already has red for its own reason. No lane had run
  these files: lanes run named files, and these rails live outside the Notebook's folders or
  scan the whole tree. All were fixed at their cause in `9a83a9df12`, and run 2 is the proof.

| Was red | Cause | Fix |
|---|---|---|
| `journal-2-0/lib/offline/baseline.test.js` | The "why" text's compare-and-set version was chosen with `??` in `WhyPrompt.jsx` (6 places) and `useEntryContext.js` (1). An empty string would survive as a version | All seven go through `usableBaseline`. A product change, in a dark feature |
| `journal-2-0/rawErrorSurface.test.js` | `ImportCsvModal.jsx` built the member's message from the caught error inside three catch blocks | Built outside the catch from the one vetted value, the server's size sentence. Same words on screen |
| `lib/swallowedFetch.census.test.js` | `VisionAttachButton.jsx` and `journal-2-0/lib/importer/commit.js` read a refusal's sentence with `.catch(() => null)` | The app's usual try and catch form. Same behaviour |
| `journal-2-0/components/journalGrids.seedParity.test.jsx` (3 rows) | The keyboard lane's focus landing changed the trades table | Snapshot re-recorded once, by cause. The only difference is `<tbody>` to `<tbody tabindex="-1" data-route-landing="" aria-label="Trades">` |
| `__tests__/entryExcludesChartEngine.test.js`, Journal layout row | The Log Trade dialogs load on first open, so the layout no longer holds the module the test used as its anchor | The anchor is named per route. A new test pins that the lazy dialog is the only path |
| `pages/terminal/TerminalShell.test.jsx` | A row of the shared pop-up menu is a menu item now. The test asked for a button | The test asks for the menu item |
| `pages/terminal/a11y/terminalReachableContrast.test.js` | The Screener skip link is invisible at rest on purpose (opacity 0), so the rail read its text at 1.00 | The file's baseline entry is 4, was 3, with the reason |
| inside `hooks/pollingSites.rail.test.js` | Thesis chips poll with a bare 60 second timer and had no row | A row with its reason |

Two of these fixes edit another workstream's test or baseline (`TerminalShell.test.jsx`, the
Terminal contrast baseline, the polling rail's list). Each is the one line the landing's own
change requires, with its reason beside it.

## After the gate

Commits after `0ebbf27ef1` add this folder, the landing record and the pull request text. They
change no file under `app/`, `api/`, `tests/`, `tools/` or `scripts/`.

Master was 0 commits ahead of the gated tree when this was written.
