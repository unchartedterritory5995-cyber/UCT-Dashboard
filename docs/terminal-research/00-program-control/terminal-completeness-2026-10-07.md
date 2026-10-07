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
| DES | OverviewPanel → OverviewTab | pass | open (no loading state; "—" for loading/empty) | pass | pass | pass | fixed (fn8: two-place P/E, beta, 52w; % yield) | pass | pass |
| GP | ChartPanel → StockChart | pass | fixed (adapter test) | blocked(chart lane owns the as-of) | pass | pass | pass | pass | pass |
| CN | NewsTab | pass | fixed (402 = paid gate, not "Couldn't load") | pass | pass | pass | pass | pass | pass |
| CATS | CatalystsTab | pass | pass | pass | pass | pass | pass | pass | pass |
| MOVE | MovePanel | pass | fixed (PanelState error + Retry) | pass | pass | pass | pass | pass (onRows) | pass |
| WIIM | MovePanel | pass | fixed (as MOVE) | pass | pass | pass | pass | pass (onRows) | pass |
| TECH | TechnicalTab | pass | pass | pass | pass | pass | pass | pass | pass |
| FA | FinancialsDeep | pass | pass | pass | pass | pass | owner (unknown currency prints "$") | pass | pass |
| EE | ConsensusEstimates | pass | open ("FMP did not answer" when FMP answered empty) | pass | pass | pass | owner (unknown currency prints "$") | pass | pass |
| EEH | EstimateHistoryTab | pass | pass | pass | pass | pass | pass | pass | pass |
| ANR | AnalystRatingsTab | pass | fixed (402 = paid gate) | pass | pass | pass | owner (price target always "$") | pass | pass |
| RTG | RatingsTab | pass | fixed (402 = paid gate) | pass | pass | pass | pass | pass | pass |
| OWN | OwnershipTab | pass | fixed (402 = paid gate) | pass | pass | pass | owner (Yahoo holder value always "$") | pass | pass |
| PPL | PeopleTab | pass | pass | pass | pass | pass | fixed (hand-made money formatter) | pass | pass |
| TRAN | CallsTab | pass | open (recap error renders below the transcript) | pass | pass | pass | pass | pass | pass |
| MB (sec) | ModelBookTab | pass | pass | pass | pass | pass | pass | pass | pass |
| MB (mkt) | door /model-book | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| DR | DecisionRecordTab | pass | fixed (Unavailable had no Retry) | pass | pass | pass | pass | pass | pass |
| HIS | HistoryTab | pass | fixed (unavailable had no Retry) | pass | pass | pass | pass | pass | pass |
| SEAS | SeasonalityTab | pass | open (Retry does not reset the re-ask counter; double fetch) | pass | pass | pass | fixed (fn8: shared primitives) | pass | pass |
| CF | FilingsTab | pass | pass | pass | pass | pass | pass | pass | pass |
| FEED | FilingsFeedTab | pass | pass | pass | pass | pass | pass | pass | pass |
| FIL | FilingChangesTab | pass | pass | pass | pass | pass | pass | pass | pass |
| RSCH | MyResearchPanel → TickerResearchWorkspace | pass | fixed (adapter test) | pass (exempt: no sourced value) | pass | pass | blocked(journal-2-0 owns `fmtFactValue`) | pass | pass |
| CMP | door /research/{sym}/compare/{arg0} | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| RES | door /research/{sym} | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| ASK (sec) | AskAiTab | pass | fixed (model outage drawn as "not enough evidence") | pass | pass | pass | pass | pass | pass |
| ASK (mkt) | door /ai-search | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| DPTH | DepthPanel → DepthTab | pass | fixed (adapter test) · open (no panel enabled → blank) | pass | pass | pass | pass | pass | pass |
| EVTS | EventsPanel | pass | pass | pass | pass | pass | pass | pass | pass |
| FSRC | FilingSearchPanel | pass | pass | pass | pass | pass | pass | pass | pass |
| ERX | EarningsReactionPanel | pass | fixed (failed read + Retry test; empty quarters; blank reason) | pass | pass | pass | fixed (fn8: "% up" was "—%" when absent) | pass | pass |
| FTD | FtdPanel | pass | fixed (failed read + Retry test; blank reason) | pass | pass | pass | pass | pass | pass |
| ATTN | MentionSeriesPanel | pass | fixed (failed read + Retry test; blank reason) | pass | pass | pass | fixed (fn8: shared primitives) | pass | pass |
| BRKE | BrokerEstimatesPanel | pass | fixed (failed read + Retry test; empty periods / actions) | pass | pass | pass | fixed (low–high unlabelled for foreign currency) | pass | pass |
| OMON | OptionsChainTab | pass | fixed (Retry refetched expirations, not the chain) | pass | pass | pass | pass | pass | pass |
| OVS | OptionsChainTab (vol surface) | pass | fixed (as OMON) | pass | pass | pass | pass | pass | pass |
| IVH | IvHistoryPanel | pass | open (no Retry: `useDarkSection` exposes no mutate) | pass | pass | pass | pass | pass | pass |
| VOL | VolPanels › VolStatsPanel | pass | open (no Retry, as IVH) | pass | pass | pass | fixed (fn8: shared primitives) | pass | pass |
| POS | PositioningPanel | pass | open (no Retry; empty levels draw an empty list) | pass | pass | pass | fixed (fn8: shared primitives) | pass | pass |
| OHIS | OptionsHistoryPanel | pass | open (no Retry) | pass | pass | pass | fixed (fn8: shared primitives) | pass | pass |
| OBT | BacktestPanel | pass | open (poll error has no Retry; catalog failure silent) | pass | pass | pass | fixed (fn8: shared primitives) | pass | pass |
| OSCR | OptionsScreener | pass | fixed (ok with 0 rows drew a header-only table) · open (no Retry) | pass | pass | pass | pass | fixed (fn8: publishes rows + list) | pass |
| FLOW (sec) | FlowTab | pass | pass | pass | pass | pass | pass | pass | pass |
| FLOW (mkt) | door /options-flow | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| GEX | doors /options-flow?view=gex | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| TIDE | MarketTidePanel | pass | open (no Retry; two loading lines standalone) | pass | pass | pass | pass | pass | pass |
| STRS | StrategyScreensPanel | pass | fixed (results loading was a header over nothing) · open (no Retry) | pass | pass | pass | fixed (fn8: shared primitives) | pass | pass |
| LIVE | door /live-massive | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| DP | door /dark-pool | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| FREC | FlowScoreboard | pass | pass | pass | pass | pass | fixed (fn8: shared primitives) | fixed (fn8: publishes rows + list) | pass |
| WIRE | MorningWire | pass | fixed (owner note save said "Saved" on failure) | pass | pass | pass | pass | fixed (fn8: publishes rows + list) | pass |
| BRD | Breadth | pass | fixed (Daily tab: failed read read "No session recorded yet") · open (Monitor grid swallows its errors) | pass | blocked(heatmapMetrics.js / TreemapView.jsx debt — tf7-themedebt) | pass | fixed (fn8: shared primitives) | pass | fixed (Daily is the phone default) |
| SCR | Screener | pass | pass | pass | pass | pass | pass | pass (usePanelList) | pass |
| U20 | UCT20 | pass | fixed (holdings read failure blanked DAYS / SINCE ADD silently) | pass | pass | pass | fixed (fn8: shared primitives) | fixed (fn8: publishes rows + list) | pass |
| DASH | door /dashboard | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| CHRT | door /charts | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| PMKT | door /post-market | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| CATH | CatalystsHistory | pass | pass | pass | pass | pass | pass | fixed (fn8: publishes rows + list) | pass |
| SETL | door /setup-library | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| FORM | door /formulas/reference | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| DESK | door /desk | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| JRNL | door /journal | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| NB | door /journal/notebook | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| RISK | PortfolioHeat | pass | fixed (ok:false had no Retry / PanelState) | pass | pass | pass | fixed (fn8: shared primitives) | fixed (fn8: publishes rows + list) | pass |
| COMM | door /community | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| EXP | door /settings?section=legal | pass | n/a | n/a | n/a | n/a | n/a | n/a | n/a |
| HELP | HelpPanel | pass | pass (no read) | pass (exempt: shell text) | pass | pass | n/a | pass (onRows) | pass |
| RRG | RrgPanel | pass | fixed (every name failing read "Not enough common history") | pass | pass | pass | pass | pass (onRows) | pass |
| REL | RelPanel | pass | fixed (no shared session was an error with "retry") | pass | pass | pass | pass | fixed (fn8: publishes rows + list) | pass |
| CORR | CorrPanel | pass | pass | pass | pass | pass | pass | fixed (fn8: publishes rows + list) | pass |
| MOST | MoversPanel | pass | pass | pass | pass | pass | pass (owner-of-UX: tf7-ux) | pass (onRows + BoardFromList) | pass |
| IMOV | ImovPanel | pass | pass | pass | pass | pass | pass | pass (onRows) | pass |

(The table lists each variant that mounts something once; RRG, REL, CORR and IMOV have the same
module behind both variants.)

## Counts (57 table rows that mount something; the 19 door rows are n/a in b–h)

A row can be both `fixed` and `open` (one gap closed, another left), so b and f sum past 57.

| Column | pass | fixed | blocked | owner | open |
|---|---|---|---|---|---|
| a parse + HELP (all 73 codes, doors included) | 73 | — | — | — | — |
| b panel tests / loading · error+retry · empty | 21 | 26 | — | — | 14 |
| c provenance (2 of the passes are reasoned exemptions: HELP, RSCH) | 56 | — | 1 (GP) | — | — |
| d theme | 55 | — | 2 (ERN, BRD → tf7-themedebt) | — | — |
| e a11y | 56 | 1 (CAL) | — | — | — |
| f numbers / currency | 36 | 15 (BRKE, PPL; fn8: VOL, POS, OHIS, OBT, STRS, FREC, U20, BRD, RISK, ERX, ATTN, SEAS, DES) | 1 (RSCH) | 4 (FA, EE, ANR, OWN — awaiting the owner) | — |
| g linking | 49 | 8 (fn8: REL, CORR, U20, FREC, CATH, RISK, OSCR, WIRE) | — | — | — |
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

**Owner decisions** — awaiting the owner; deliberately left as they are (re-checked unchanged on
`terminal/fn8-fmtrows`, 2026-10-07).
- FA / EE: `depthFormat.fmtMoney` prints "$" when the payload carries no currency (deliberate:
  "USD or unknown renders $ exactly as before"); EstimateHistory chose the opposite ("never a guessed
  $"). One rule should win.
- ANR price target and OWN Yahoo holder value always "$" (no currency on those payloads); low risk
  for US listings, unlabelled for foreign ones.

**Open follow-ups (not done here)**
- No Retry on any `useDarkSection` failure (IVH, VOL, POS, OHIS, TIDE, STRS, OSCR, OBT poll): the hook
  exposes no `mutate`. One hook change + a Retry per section.
- DES: OverviewTab has no loading state ("will appear here once available" while loading); a vendor
  failure on `/api/fundamentals` arrives as a 200 empty dict (backend).
- EE "FMP did not answer" when FMP answered with zero rows; TRAN recap error renders below the
  transcript; SEAS Retry does not reset its re-ask counter (and the fetcher reads twice); DPTH blank
  when no depth panel is enabled; BRD Monitor grid swallows `/dates` and block failures.
- ~~Raw number formatting (listed in the f column): VOL, POS, OHIS, OBT, STRS, FREC, U20, BRD, RISK,
  ERX, ATTN, SEAS, DES~~ — **closed on `terminal/fn8-fmtrows`** (below).
- ~~(g) list panels that publish neither `onRows` nor `usePanelList`: REL, CORR, U20, FREC, CATH, RISK,
  OSCR, WIRE's catalyst rail~~ — **closed on `terminal/fn8-fmtrows`** (below). REL/CORR were NOT added
  to `COMMAND_PANELS` (tf7-ux's to sequence); they publish through the same context hook as the
  embedded pages.

## Closed on `terminal/fn8-fmtrows` (lane tf8-fmtrows, from 862866d47)

**(g) rows + lists.** `components/terminal/terminalPanel.js` gains `usePanelRows(rows)` — the
embedded-component twin of the `onRows` prop (pages/tabs are never forked to take props) — and
`usePanelSymbolRows(syms, label)`, which publishes one `$SYM` row per visible row (repeats kept: row N
is the Nth row on screen) and the de-duplicated names through `usePanelList`. The shell's panel list
API carries `publishRows`, the same focused-only `onRows` the command panels get, so only the focused
panel's rows are addressable and focusing a panel re-publishes them. Each of REL, CORR (table/matrix
rows), U20 (rank order, matching its `#` column; the board list follows the sort), FREC (the honest
tape), CATH (the day's rows), RISK (open positions), OSCR (the view on screen, by underlying) and WIRE
(the catalyst rail's visible rows; CatalystTable is a no-op outside a panel) publishes, renders the
shared "Board of" control, and has a `*.rows.test.jsx`; `TerminalShell.embeddedRows.test.jsx` proves
row <GO> and `BOARD` reach an embedded list (and that an unfocused list is not addressable).

**(f) numbers.** Two primitives extended (defaults unchanged byte for byte): `formatCurrency({grouping})`
for money totals and `formatPercentAsSent` for a percent the server already rounded. VOL/POS/OHIS/STRS
through `optionsFormat` (`pctNum`, `signedPct`, `count`, `dollars`, `signedPremium`; `MarketTidePanel.money`
is `signedPremium`); OBT `money`; U20 entry/stop titles and exposure; BRD price/int/close/count,
analogue match and forward returns; ERX "% up" and realized vol; ATTN share of room; SEAS "% up"; DES
key stats; FREC strike (`formatNumber` ungrouped + `currencyPrefix`); RISK percents. Oracle tests
(`pages/terminal/panelFormat.oracle.test.jsx`, `FlowScoreboard.rows.test.jsx`,
`PortfolioHeat.rows.test.jsx`) run each old body against its replacement over sampled ranges.
**Deliberate edge changes, all pinned:** a missing value is one em dash (was "—%", "$—", "null%",
"NaN", or a false "0" / "0%"); a value that rounds to zero has no minus ("-0.00%", "-$0" gone); a
currency sign sits inside the minus ("-$125", was "$-125"); grouped whole-dollar halves round away
from zero; the signed premium's sub-$1K negative halves round as the terminal ladder does; a FREC
strike with more than three decimals caps at three; DES P/E, beta and 52-week levels always print two
places (the range grouped) and the dividend yield prints two places. The census baseline
(magnitude-suffix only) did not move: none of these files carried a K/M/B/T suffix by hand.

**Owner decisions — unchanged, awaiting the owner:** FA/EE "$" on an unknown currency, ANR price
targets and OWN Yahoo holder values in "$" were deliberately not touched.

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
