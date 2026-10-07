# UCT Terminal — function completeness audit, 2026-10-07

Branch `terminal/fn7-audit` (from `origin/master` 6db0e50cf). Lane tf7-audit.

The population is the registry itself: `app/src/pages/terminal/functions.js` → `FUNCTIONS`
(73 codes, 82 variants: 54 mount a panel or page, 28 are doors). It was read by import and AST,
never typed. Every panel module was then read by hand (four read-only passes, one per module
group) for loading / error / empty / number / currency / list behaviour.

**The rail that keeps this true:** `app/src/pages/terminal/completeness.rail.test.jsx`. It derives
the function list from the registry each run and asserts, per code: (a) it parses in every form
its variants take, echoes without an error, has an argument shape, accepts a sample of every
argument kind it declares, and HELP prints it with its label; (b) every mounted module has a test
file AND a test that makes its read fail (shrink-only ledgers `NO_PANEL_TEST` = empty,
`NO_FAILED_READ_TEST` = four `no-read:` adapters/shell text); (c) every mounted module is in the
population `panelProvenance.rail.test.js` examines. Columns (d) and (e) are already railed
(`themeColours.rail.test.js`, `a11y/*`); (h) is a shell property railed by `phoneSwitcher.test.jsx`.

## Legend

`pass` meets the bar · `fixed` was short and is fixed on this branch (with a test) ·
`blocked(reason)` cannot be fixed in this lane · `owner` needs an owner decision ·
`open` a real gap, left for a follow-up (named below) · `n/a` a door (opens a page; mounts nothing).

Columns: **a** registered + HELP + parse/args tests · **b** panel test covers loading,
error-with-retry and genuine empty · **c** provenance (source + as-of) · **d** theme ·
**e** a11y · **f** number formatting / currency labels · **g** linking (follows group / publishes
rows) · **h** phone (works as the single visible panel).

| Code | Variant → module | a | b | c | d | e | f | g | h |
|---|---|---|---|---|---|---|---|---|---|
| CAL | Calendar | pass | pass | pass | pass | fixed (loading label) | pass | pass (URL-owning) | pass |
| MYST | door /calendar/mystocks | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| ERN | Calendar (earnings modal) | pass | pass | pass | blocked(EarningsResearchModal.module.css debt — tf7-themedebt) | pass | pass | pass | pass |
| DES | OverviewPanel → OverviewTab | pass | fixed (fn8-retry: loading state; a vendor failure carries `status` → error + Retry, a genuine empty says so) | pass | pass | pass | open (raw P/E, beta, 52w floats) | pass | pass |
| GP | ChartPanel → StockChart | pass | fixed (adapter test) | blocked(chart lane owns the as-of) | pass | pass | pass | pass | pass |
| CN | NewsTab | pass | fixed (402 = paid gate, not "Couldn't load") | pass | pass | pass | pass | pass | pass |
| CATS | CatalystsTab | pass | pass | pass | pass | pass | pass | pass | pass |
| MOVE | MovePanel | pass | fixed (PanelState error + Retry) | pass | pass | pass | pass | pass (onRows) | pass |
| WIIM | MovePanel | pass | fixed (as MOVE) | pass | pass | pass | pass | pass (onRows) | pass |
| TECH | TechnicalTab | pass | pass | pass | pass | pass | pass | pass | pass |
| FA | FinancialsDeep | pass | pass | pass | pass | pass | owner (unknown currency prints "$") | pass | pass |
| EE | ConsensusEstimates | pass | fixed (fn8-retry: the fallback reason is worded per case) | pass | pass | pass | owner (unknown currency prints "$") | pass | pass |
| EEH | EstimateHistoryTab | pass | pass | pass | pass | pass | pass | pass | pass |
| ANR | AnalystRatingsTab | pass | fixed (402 = paid gate) | pass | pass | pass | owner (price target always "$") | pass | pass |
| RTG | RatingsTab | pass | fixed (402 = paid gate) | pass | pass | pass | pass | pass | pass |
| OWN | OwnershipTab | pass | fixed (402 = paid gate) | pass | pass | pass | owner (Yahoo holder value always "$") | pass | pass |
| PPL | PeopleTab | pass | pass | pass | pass | pass | fixed (hand-made money formatter) | pass | pass |
| TRAN | CallsTab | pass | fixed (fn8-retry: the recap error is the first block, PanelState + Retry) | pass | pass | pass | pass | pass | pass |
| MB (sec) | ModelBookTab | pass | pass | pass | pass | pass | pass | pass | pass |
| MB (mkt) | door /model-book | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| DR | DecisionRecordTab | pass | fixed (Unavailable had no Retry) | pass | pass | pass | pass | pass | pass |
| HIS | HistoryTab | pass | fixed (unavailable had no Retry) | pass | pass | pass | pass | pass | pass |
| SEAS | SeasonalityTab | pass | fixed (fn8-retry: Retry resets the re-ask counter; one read per answer) | pass | pass | pass | open (raw `% up`) | pass | pass |
| CF | FilingsTab | pass | pass | pass | pass | pass | pass | pass | pass |
| FEED | FilingsFeedTab | pass | pass | pass | pass | pass | pass | pass | pass |
| FIL | FilingChangesTab | pass | pass | pass | pass | pass | pass | pass | pass |
| RSCH | MyResearchPanel → TickerResearchWorkspace | pass | fixed (adapter test) | pass (exempt: no sourced value) | pass | pass | blocked(journal-2-0 owns `fmtFactValue`) | pass | pass |
| CMP | door /research/{sym}/compare/{arg0} | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| RES | door /research/{sym} | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| ASK (sec) | AskAiTab | pass | fixed (model outage drawn as "not enough evidence") | pass | pass | pass | pass | pass | pass |
| ASK (mkt) | door /ai-search | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| DPTH | DepthPanel → DepthTab | pass | fixed (adapter test; fn8-retry: no panel enabled → a plain `locked` PanelState) | pass | pass | pass | pass | pass | pass |
| EVTS | EventsPanel | pass | pass | pass | pass | pass | pass | pass | pass |
| FSRC | FilingSearchPanel | pass | pass | pass | pass | pass | pass | pass | pass |
| ERX | EarningsReactionPanel | pass | fixed (failed read + Retry test; empty quarters; blank reason) | pass | pass | pass | open (raw `pct_up%`) | pass | pass |
| FTD | FtdPanel | pass | fixed (failed read + Retry test; blank reason) | pass | pass | pass | pass | pass | pass |
| ATTN | MentionSeriesPanel | pass | fixed (failed read + Retry test; blank reason) | pass | pass | pass | open (raw `%`) | pass | pass |
| BRKE | BrokerEstimatesPanel | pass | fixed (failed read + Retry test; empty periods / actions) | pass | pass | pass | fixed (low–high unlabelled for foreign currency) | pass | pass |
| OMON | OptionsChainTab | pass | fixed (Retry refetched expirations, not the chain) | pass | pass | pass | pass | pass | pass |
| OVS | OptionsChainTab (vol surface) | pass | fixed (as OMON) | pass | pass | pass | pass | pass | pass |
| IVH | IvHistoryPanel | pass | fixed (fn8-retry: Retry on the failed read) | pass | pass | pass | pass | pass | pass |
| VOL | VolPanels › VolStatsPanel | pass | fixed (fn8-retry: `useDarkSection` returns `retry`; one Retry re-asks every failed read) | pass | pass | pass | open (raw `toLocaleString`, `%`) | pass | pass |
| POS | PositioningPanel | pass | fixed (fn8-retry: Retry per block; an empty levels answer is said) | pass | pass | pass | open (hand-made `±$`) | pass | pass |
| OHIS | OptionsHistoryPanel | pass | fixed (fn8-retry: Retry per block) | pass | pass | pass | open (hand-made `$` straddle) | pass | pass |
| OBT | BacktestPanel | pass | fixed (fn8-retry: poll error Retry; a catalog failure is said, with Retry) | pass | pass | pass | open (`optionBacktest.money`) | pass | pass |
| OSCR | OptionsScreener | pass | fixed (ok with 0 rows drew a header-only table; fn8-retry: Retry on each read) | pass | pass | pass | pass | open (publishes no list) | pass |
| FLOW (sec) | FlowTab | pass | pass | pass | pass | pass | pass | pass | pass |
| FLOW (mkt) | door /options-flow | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| GEX | doors /options-flow?view=gex | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| TIDE | MarketTidePanel | pass | fixed (fn8-retry: Retry on each read; one loading line standalone) | pass | pass | pass | pass | pass | pass |
| STRS | StrategyScreensPanel | pass | fixed (results loading was a header over nothing; fn8-retry: Retry on each read) | pass | pass | pass | open (`perContract`, block premium) | pass | pass |
| LIVE | door /live-massive | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| DP | door /dark-pool | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| FREC | FlowScoreboard | pass | pass | pass | pass | pass | open (hand-made `$` strike) | open (publishes no list) | pass |
| WIRE | MorningWire | pass | fixed (owner note save said "Saved" on failure) | pass | pass | pass | pass | open (catalyst rail publishes no list) | pass |
| BRD | Breadth | pass | fixed (Daily tab: failed read read "No session recorded yet"; fn8-retry: Monitor grid failures said, with Retry) | pass | blocked(heatmapMetrics.js / TreemapView.jsx debt — tf7-themedebt) | pass | open (raw `%`, `toLocaleString`) | pass | fixed (Daily is the phone default) |
| SCR | Screener | pass | pass | pass | pass | pass | pass | pass (usePanelList) | pass |
| U20 | UCT20 | pass | fixed (holdings read failure blanked DAYS / SINCE ADD silently) | pass | pass | pass | open (hand-made `Entry $`, exposure `%`) | open (publishes no list) | pass |
| DASH | door /dashboard | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| CHRT | door /charts | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| PMKT | door /post-market | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| CATH | CatalystsHistory | pass | pass | pass | pass | pass | pass | open (publishes no list) | pass |
| SETL | door /setup-library | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| FORM | door /formulas/reference | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| DESK | door /desk | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| JRNL | door /journal | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| NB | door /journal/notebook | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| RISK | PortfolioHeat | pass | fixed (ok:false had no Retry / PanelState) | pass | pass | pass | open (raw `%`) | open (positions publish no list) | pass |
| COMM | door /community | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| EXP | door /settings?section=legal | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| HELP | HelpPanel | pass | pass (no read) | pass (exempt: shell text) | pass | pass | n/a | pass (onRows) | pass |
| RRG | RrgPanel | pass | fixed (every name failing read "Not enough common history") | pass | pass | pass | pass | pass (onRows) | pass |
| REL | RelPanel | pass | fixed (no shared session was an error with "retry") | pass | pass | pass | pass | open (publishes no rows; overlap tf7-ux BOARD) | pass |
| CORR | CorrPanel | pass | pass | pass | pass | pass | pass | open (publishes no rows; overlap tf7-ux BOARD) | pass |
| MOST | MoversPanel | pass | pass | pass | pass | pass | pass (owner-of-UX: tf7-ux) | pass (onRows + BoardFromList) | pass |
| IMOV | ImovPanel | pass | pass | pass | pass | pass | pass | pass (onRows) | pass |

(The table lists each variant that mounts something once; RRG, REL, CORR and IMOV have the same
module behind both variants.)

## Counts (57 table rows that mount something; the 19 door rows are n/a in b–h)

A row can be both `fixed` and `open` (one gap closed, another left), so b and f sum past 57.

| Column | pass | fixed | blocked | owner | open |
|---|---|---|---|---|---|
| a parse + HELP (all 73 codes, doors included) | 73 | — | — | — | — |
| b panel tests / loading · error+retry · empty | 21 | 36 | — | — | 0 (14 closed by `terminal/fn8-retry`) |
| c provenance (2 of the passes are reasoned exemptions: HELP, RSCH) | 56 | — | 1 (GP) | — | — |
| d theme | 55 | — | 2 (ERN, BRD → tf7-themedebt) | — | — |
| e a11y | 56 | 1 (CAL) | — | — | — |
| f numbers / currency | 36 | 2 (BRKE, PPL) | 1 (RSCH) | 4 (FA, EE, ANR, OWN) | 13 |
| g linking | 49 | — | — | — | 8 |
| h phone | 56 | 1 (BRD) | — | — | — |

## Fixed on this branch (each with a test)

1. **BRD Daily tab** (the phone default): a failed breadth read and the first load both read "No
   session recorded yet". Now the error banner + Retry, or a loading state. Mutation-checked.
2. **CN / ANR / OWN / RTG**: the backend 402s these four; a free member read "Couldn't load …" with a
   Retry that could never work. Hooks report `paywalled`; tabs say "requires a paid plan".
3. **ASK**: a model outage (200 refusal carrying `error`) was drawn as "not enough evidence" with no
   Ask again. Now the error turn.
4. **WIRE**: an owner note the server refused showed "Saved" and closed — the note was lost.
   Mutation-checked.
5. **U20**: a failed holdings read blanked DAYS / SINCE ADD and dropped NEW marks silently; the side
   reads no longer parse a 402/5xx body as data.
6. **OMON / OVS**: the chain's Retry refetched the expirations list, not the chain.
7. **RRG**: every plotted name failing read as "Not enough common history" (empty); now an error naming them.
8. **REL**: two names with no shared session were an error with retry copy; now a genuine empty.
9. **MOVE / WIIM**: failure was a plain div ("type it again"); now PanelState error + Retry.
10. **HIS, DR**: unavailable states had no Retry.
11. **RISK**: `ok:false` had no Retry and no PanelState in a panel.
12. **ERX / ATTN / FTD / BRKE**: no test made their read fail (now: 503 → unavailable + working
    Retry); a non-ok state with no reason printed a blank note; empty quarters / periods / firm
    actions drew header-only tables; BRKE's low–high EPS range lacked the reporting currency.
13. **PPL**: hand-made money formatter (case-sensitive `USD`) → shared primitives.
14. **STRS**: results loading was a header over nothing. **OSCR**: ok with 0 rows drew a header-only table.
15. **CAL**: the week skeleton announced "Loading UCT Terminal" on a generic div → a named status.
16. **GP / RSCH / DPTH**: no test file existed at all → `panels/adapterPanels.test.jsx`.

## Remaining — blocked, owner decisions, open follow-ups

**Blocked**
- GP provenance: the bars' as-of lives in StockChart / `components/chart/**` (another lane; existing EXEMPT).
- RSCH `fmtFactValue` hand-made `$`: `journal-2-0/**` is off-limits to this lane.
- ERN / BRD colour debt: `EarningsResearchModal.module.css`, `breadth/heatmapMetrics.js`,
  `breadth/views/TreemapView.jsx` — tf7-themedebt's ledger.

**Owner decisions**
- FA / EE: `depthFormat.fmtMoney` prints "$" when the payload carries no currency (deliberate:
  "USD or unknown renders $ exactly as before"); EstimateHistory chose the opposite ("never a guessed
  $"). One rule should win.
- ANR price target and OWN Yahoo holder value always "$" (no currency on those payloads); low risk
  for US listings, unlabelled for foreign ones.

**Open follow-ups (not done here)**
- ~~The b-column (error / retry) gaps~~ — **closed 2026-10-07 on `terminal/fn8-retry`**, each with a
  test that fails against the old code: `useDarkSection` returns `retry` and every options section's
  failure is a PanelState with Retry (IVH, VOL, POS, OHIS, TIDE, STRS, OSCR, OBT poll + catalog;
  `optionsAnalytics/failedRead.retry.test.jsx`); DES — `/api/fundamentals/{ticker}` carries
  `status` ("ok" / "unavailable" / "empty", `tests/test_fundamentals_router.py::TestFundamentalsStatus`)
  and the key-stats card says loading / error + Retry / nothing on file
  (`research/tabs/OverviewTab.statsStates.test.jsx`); EE fallback reason worded per case
  (`fmpDepth/FmpDepth.test.jsx`); TRAN recap error first (`CallsTab.test.jsx`); SEAS Retry resets the
  counter and reads once (`SeasonalityTab.retry.test.jsx`); DPTH no-panel explanation
  (`depth/DepthTab.none.test.jsx`); BRD Monitor grid failures said with Retry
  (`breadth/useMonitorGrid.failures.test.jsx`, `breadth/monitorGridError.test.jsx`). The completeness
  rail's ledgers could not shrink: `NO_PANEL_TEST` was already empty and the four
  `NO_FAILED_READ_TEST` lines are `no-read:` adapters/shell text, none of which these fixes change.
- Raw number formatting (listed in the f column): VOL, POS, OHIS, OBT, STRS, FREC, U20, BRD, RISK,
  ERX, ATTN, SEAS, DES — mechanical moves onto `presentationPrimitives`.
- (g) list panels that publish neither `onRows` nor `usePanelList`: REL, CORR, U20, FREC, CATH, RISK,
  OSCR, WIRE's catalyst rail. **Overlap:** tf7-ux owns BOARD / scan-to-board UX — adding REL/CORR to
  `COMMAND_PANELS` is theirs to sequence.

## Overlaps with concurrent lanes

- **tf7-ink** (`--loss`/`--gain` text colours): nothing here touches colour tokens.
- **tf7-themedebt** (colour literals): this branch adds no literal (theme rail green); ERN/BRD debt is theirs.
- **tf7-ux** (MOST / IMOV / BOARD / window UX): MoversPanel and ImovPanel were audited only, not
  edited; CorrPanel was left unchanged; the (g) list-publishing gaps are noted for them.

## Test totals (this branch, scoped runs, `--maxWorkers=1`)

- Every test file this branch adds or edits, plus the terminal rails (provenance, theme, a11y,
  functions, phoneSwitcher) and MovePanel.copy: `Test Files 28 passed (28)` · `Tests 477 passed (477)`.
- `src/pages/terminal` + `src/components/terminal`: `Test Files 52 passed (52)` · `Tests 905 passed (905)`.
- `src/pages/research`, `optionsAnalytics`, `screener/options`, `breadth`, `calendar`, U20 / RISK / WIRE /
  BRD state tests, `src/components/research`, `src/components/provenance`: `Test Files 320 passed, 1 skipped`
  plus two reds — `panelAdoption.ratchet` (pre-existing: StandingAlertsPanel) and a transform error in
  this branch's own StrategyScreensPanel test title, fixed and re-run green
  (`Test Files 2 passed (2)` · `Tests 24 passed (24)`).
