# Final gate, waves 12 to 15: classification

Written by the landing lane, 2026-10-07. Read the manifests, not this page, for the numbers.

## Verdict

**The gated tree is `ef3fcccd19` (run 4). 13 tests failed. 12 fail on master too, with the same
message. 1 is load and passes alone. None is caused by this landing.**

**Carry-over ruling (controller, 2026-10-07 21:55 CT): stop re-gating; the gate result is
carried.** Its evidence: the branch head has no difference from `ef3fcccd19` under `app`, `api`,
`tests`, `tools` or `scripts`; master's newer commits share no file with this branch's 4,609
changed files; a trial merge is clean. C2 (the import graph) cannot be evaluated and is recorded
as an accepted risk, backed by the post-deploy smoke. Pull request #281.

Every commit after `ef3fcccd19` leaves `app/` byte for byte the same, so the carry-over tool
answers CARRIES for the final tip (`python tools/gate_carry_over.py ef3fcccd19 HEAD origin/master`:
"C0: IDENTICAL over GATE_READ_PATHS"). The Python side was run again on the final tip; its totals
are in `docs/notebook/LANDING-12-15.md` section 5.

Four runs, each from a clean tree on `feat/notebook-w14-land`, each with
`python scripts/gate_shards.py --shards 6 --out docs/notebook/gate-runs/landing-12-15/final`.
The box had 14 to 18 GB available and no other test run, build or gate at each start. Every
manifest is valid: the tree is identical at both ends and the file count reconciles.

| Run | Tree | Manifest | Files | Tests | NEW against the old baseline | What it showed |
|---|---|---|---|---|---|---|
| 1 | `5e5d6c0b0c` | `run1-5e5d6c0b0c/2026-10-07T15-49-03.md` | 2,986 | 21 failed, 41,518 passed, 41,651 | 19 | 9 caused by the landing (fixed), 9 master's, 1 load |
| 2 | `0ebbf27ef1` | `run2-0ebbf27ef1/2026-10-07T17-16-49.md` | 2,989 | 11 failed, 41,583 passed, 41,706 | 9 | 11 master's, 0 the landing's |
| 3 | `aa5f43f2ec` | `run3-aa5f43f2ec/2026-10-07T19-45-42.md` | 2,991 | 14 failed, 41,605 passed, 41,731 | 12 | 12 master's, 2 load |
| 4 | `ef3fcccd19` | `2026-10-07T20-47-06.md` | 2,991 | 13 failed, 41,606 passed, 41,731 | 11 | 12 master's, 1 load |

Why there are four: master moved three times while this was being gated. After run 2 the
carry-over tool answered RE-GATE for the eighth master merge (C1 and C3 failed). After run 3 it
answered RE-GATE for the ninth (C1 and C3 passed; C2 needs an import graph that nothing in the
repository produces, and unknown is never a pass). Both outputs are in `run3-aa5f43f2ec/`.

**Why the wrapper still exits 1.** The committed baseline
(`docs/plans/joystick/gate-baseline.json`) was measured on master `73a4286d0` on 2026-09-24.
Of its 126 rows, 124 no longer fail. So every failure master has gained since then reads as NEW.
This lane did not rewrite the baseline: it is shared, and adopting a new one is a decision.
Instead each failing file was run on master itself, in a separate worktree
(`notebook-w14-master-base`, branch of the same name), and the two logs were compared test by
test.

## Run 4: the 13 failures

Evidence: `rerun-alone-12-files-landing-ef3fcccd19.log` (the twelve failing files by name on this
tree: 12 failed, 133 passed) and `same-12-files-on-master-18676e3ece.log` (master: 12 failed, 132
passed). Every one of the twelve assertion messages is identical on both sides.

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
| `lib/persistence/persistenceManifest.test.js` | two `removeItem` calls in `agent/capabilities/watchlist.js` | Terminal agent |
| `lib/swallowedFetch.census.test.js` | `components/admin/AlertOpsPanel.jsx` gained a site. It came with the eighth master merge. The landing's own two sites were fixed in `9a83a9df12` and are not named | Alerts admin |
| `hooks/pollingSites.rail.test.js` (in the old baseline) | `hooks/useTickerIpo.js` polls with no row | Calendar, IPO data |
| `utils/jsonFetcher.test.js` (in the old baseline) | `pages/UCT20.jsx` is listed as unchecked and no longer is | UCT 20 |

The thirteenth: `pages/charts/widgets/ScanObjectCard.test.jsx`, "lands in the Formula field on
the Conditions tab". It is master's file. It passes alone here and on master, passed in runs 2
and 3, and failed the same way in run 1. Load. It is not banked.

## Run 3: the three rows that were not in run 2

1. **`ChartPlanPanel.asOfDay.test.jsx`, "a stop hit on the first session after a 9 pm Eastern
   plan IS reported". Load, not the hour.** The shard ran between 8 and 9 pm Eastern, which is
   the hour the test is about, so the clock was the first suspect. What was done:
   - Run alone at 20:49 Eastern, three times: passed each time. It also passed in run 4, whose
     shards ran from about 8:45 to 9:45 pm Eastern.
   - A matrix that opens the same replay with the clock faked (Date only) to 14 instants: 10:00,
     16:30, 20:30, 21:00, 23:30 and 00:30 Eastern; 9 pm on the day before, of and after both 2026
     daylight-saving changes; the evening the plan was written; the next session. **14 of 14
     report the stop hit** (`hour-matrix-run-14-of-14.log`).
   - The product reads the clock in `ChartPlanPanel.jsx` in two places only: a new line's id,
     and a fallback when a block has no capture time. Neither is on the replay path. The answer
     for an evening plan comes from the note's own Eastern day and the bars.
   - The failure itself was a `findByText` that timed out, in the same shard and minute as the
     Desk row below.
   The matrix is written as a test, but it is NOT in the gated tree: the carry-over tool answers
   RE-GATE for any branch change under `app/src` after the gate, a test-only one included
   (`carry-over-tree-plus-test-commit.txt`), and a fifth gate would have been superseded by
   master again. It was committed (`77a22bf7ee`), reverted (`e3d454870e`), and is filed as
   `hour-matrix-ChartPlanPanel.asOfDay.patch` for the follow-up pull request.
   Sweep of the other 170 test files this landing adds, for a clock read with no faked clock:
   four have one. None asserts on an hour or a day. `NotebookTour.coldReplay.test.jsx` measures
   elapsed time against the tour's 8 second wait. `WidgetEmbedView.toolbarOneStop.test.jsx` and
   `WidgetEmbedView.chartPlan.test.jsx` pass "now" as a chart block's end time and never read it
   back. `ResearchHome.checklist.test.jsx` stamps a fixture note with "now".
2. **`lib/swallowedFetch.census.test.js`. Master's.** It names
   `components/admin/AlertOpsPanel.jsx`, which arrived with the eighth master merge and is
   identical to master's. Same message on master.
3. **`pages/desk/ArticlesSection.native.test.jsx`, "clearing the query brings the full archive
   back". Load.** Another workstream's file. It passes alone here (four runs) and on master, and
   passed in runs 1, 2 and 4. Of the shared pieces it renders, `components/mobile/Sheet.jsx` and
   `components/ui/Input.jsx` are identical to master's. It does not use the pop-up menu the
   landing changed.

## Run 1: what the 19 NEW rows were

Evidence in `run1-5e5d6c0b0c/`: the 17 failing files run alone on that tree, the same 17 on
master `7409b339e5`, and the run after the fixes.

- **9 rows were master's.** They are in the table above.
- **1 row was load.** `ScanObjectCard.test.jsx`, as above.
- **9 rows, in 7 files, were caused by this landing.** One more was hidden inside
  `pollingSites.rail.test.js`, which master already has red for its own reason. No lane had run
  these files: lanes run named files, and these rails live outside the Notebook's folders or
  scan the whole tree. All were fixed at their cause in `9a83a9df12`, and runs 2, 3 and 4 are
  the proof.

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

Three of these fixes edit another workstream's test or baseline (`TerminalShell.test.jsx`, the
Terminal contrast baseline, the polling rail's list). Each is the one line the landing's own
change requires, with its reason beside it.

## Master, when this was written

`origin/master` was 4 commits ahead of the gated tree (`30f564d4e6`: a Breadth category in
symbol search, the Agent's cross-domain composition, a monitor schedule fix). They are NOT
merged. A trial merge has no file in common with this branch, and the carry-over tool still
answers RE-GATE for it (`carry-over-trial-merge-of-master-30f564d4e6.txt`; that output was taken
while the hour-matrix test commit was still on the branch, so its C1 names that file, and C2
cannot be evaluated either way). Master moved about once an hour today and
a gate takes 65 minutes, so a gate on the merged tree cannot finish before master moves again.
The controller ruled on it: see the carry-over ruling at the top.
