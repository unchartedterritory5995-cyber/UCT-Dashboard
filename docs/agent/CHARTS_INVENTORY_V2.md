# Charts inventory v2 (canonical operations)

A new canonical inventory of what a member can do on desktop /charts. It does **not** replace `CHARTS_COVERAGE_MATRIX.md` (the 499-row historical benchmark, unchanged) or any score computed from it.

**Sources, all pinned:**
- rows: `docs/agent/CHARTS_COVERAGE_MATRIX.md` at master 8500e084ac (unchanged since 0bb8f2a585)
- controls: UI source at 8500e084ac (app/src/components, app/src/pages)
- NOT ON /CHARTS and C1-176..179: `docs/agent/CHARTS_EXECUTION_STATUS.md` at 8500e084ac
- walkthrough states: `docs/agent/CHARTS_TEACH_STATUS.md` at agent/pl/teach-cov-5 bcc75626fd (the record behind 295 / 23 / 181)
- read independently of the guide and teach code (nothing under app/src/agent/guide or the teach runner was opened). Prepared by pl-auto, 2026-11-09.

## Totals

| measure | count |
| --- | --- |
| Historical benchmark rows (unchanged) | 499 |
| … walkthrough VERIFIED / ROUTED-BROWSER FAILED / no case (teach-cov-5) | 295 / 23 / 181 |
| Rows UNIQUE / VALID / DUPLICATE / ALTERNATE ROUTE / NOT ON DESKTOP /CHARTS / NOT IN PRODUCT | 430 / 27 / 14 / 8 / 19 / 1 |
| **Canonical unique operations from the 499** (UNIQUE rows; their DUPLICATE and ALTERNATE ROUTE rows folded in) | **430** (C1 147, C2 92, C3 191) |
| … of which walkthrough-VERIFIED (at least one of its rows VERIFIED; phrasings never add) | **268** (62.3%) |
| Confirmed additions (new canonical operations, no walkthrough record yet) | 29 (C1 13, C2 2, C3 14) |
| **Canonical unique operations, v2** (UNIQUE + confirmed additions) | **459**, of which VERIFIED **268** (58.4%) |
| VALID rows (not member operations; never added to the 459) | 27, of which VERIFIED 13 |
| … **READ-ONLY TEACHING** (locate / inspect / understand: member-facing readouts, labels and panels), its own category | **17** (C1 0, C2 5, C3 12), of which VERIFIED **12** |
| … excluded (admin-only, Agent-panel-only, nonexistent, irrelevant), each with its reason below | 10, of which VERIFIED 1 |

**Reconciling the 295.** VERIFIED rows by class: UNIQUE 267, DUPLICATE 10, ALTERNATE ROUTE 3, VALID 13, NOT ON DESKTOP /CHARTS 2. Folding duplicates and alternate routes into their operation gives 268 verified operations: 1 operation(s) are verified only through a folded row.

**Class definitions.**
- UNIQUE: a distinct member operation on desktop /charts; the canonical row for it.
- DUPLICATE: the same operation on the same control as another row (the twin, which is UNIQUE).
- ALTERNATE ROUTE: the same operation by another door (key, menu, right-click, another dialog); cites its primary.
- NOT ON DESKTOP /CHARTS: one of the execution status's 19 rows with no real control on desktop /charts.
- VALID: a real row that is not a member operation on its own; split into READ-ONLY TEACHING (a member-facing readout, label or panel to locate, inspect or understand) and excluded (admin-only, Agent-panel-only, nonexistent, irrelevant). Neither is counted as an operation.

## Corrections (2026-11-10)

From pl-teach INVENTORY-FINDINGS-teach-keys.md (9d0ffdb368), code at master dfc645ccb3; each correction keeps the historical row. The historical row is kept: its original class and wording are shown, nothing is deleted, and the 499 benchmark is unchanged.

| row | kind | class (was → now) | action (was → now) | note |
| --- | --- | --- | --- | --- |
| C3-223 | documentation mismatch | UNIQUE (unchanged) | Toggle the journal shortcut (Ctrl+Alt+J) → Capture the hovered chart to the Journal inbox (Ctrl+Alt+J) | the key captures the hovered chart to the Journal inbox (ChartWidget.jsx:591, ChartsWorkspace.jsx:2843); it toggles nothing; the old citation CW:2678 is stale. Not declared in SHORTCUTS, so absent from the ? overlay. Possible overlap with the right-click Send to Journal addition C1-176 (another route to a journal capture) is noted, not applied |
| C1-123 | alternative access path | NOT ON DESKTOP (unchanged) | Add indicator from menu (unchanged) | the desktop /charts widget menu never had Add indicator (StockChart's ind-add row renders only on the app-root menu); on desktop use the toolbar indicator button, Alt+Shift+A (C1-172) or Chart Settings, Indicators. Owner decision pending on spec section 6 (right-click as a third entry point) |
| C1-175 | documentation mismatch | UNIQUE (unchanged) | Escape to cursor / cancel → Press Esc to return to the cursor or cancel the armed drawing tool | Esc is declared (keyboardShortcuts.js:112, matcher :257) and teachable (held-out HK-9 passes in a real browser); BLOCKED applies to executing Esc (pointer-session state), not to teaching it |
| C3-080 | intentional removal, dead residue | UNIQUE → NOT IN PRODUCT | Remove all starred symbols from a list (unchanged) | the only trigger (toggleStar callers) was removed on purpose in 72482c8400 (2026-07-19, star became the Flagged toggle); the state, helpers and menu row remain as dead code (Watchlists.jsx:930-1003, :3658-3662) and CLAUDE.md:5191 still documents it. Not a defect; restoring would need an owner decision |

## VALID rows: READ-ONLY TEACHING and excluded

A separate category, kept out of the canonical operation count. READ-ONLY TEACHING rows are things a member locates, inspects or needs to understand; a walkthrough can teach them, the Agent never executes them. Excluded rows carry their reason.

| row | category | action | walkthrough (teach-cov-5) | reason |
| --- | --- | --- | --- | --- |
| C2-022 | READ-ONLY TEACHING | See what is on a chart | VERIFIED | the indicator list on a chart (legend and Chart Settings): a member locates and reads it |
| C2-023 | READ-ONLY TEACHING | Read About text | ASSIGNED / NOT REACHED | an indicator's About text, a panel the member opens and reads |
| C2-054 | READ-ONLY TEACHING | List indicator templates | NO ASSIGNED WALKTHROUGH | the indicator template list in the template bar: a member inspects it |
| C2-097 | READ-ONLY TEACHING | List indicator alerts | VERIFIED | the indicator alerts list in the alerts popover |
| C2-100 | READ-ONLY TEACHING | See why an alert cannot fire | ROUTED / BROWSER FAILED | the popover's reason an alert cannot fire: a readout the member needs to understand |
| C3-026 | READ-ONLY TEACHING | See which layout is open | VERIFIED | the open layout's name on the Layout Dock |
| C3-110 | READ-ONLY TEACHING | Read a scan's conditions | VERIFIED | a scan's conditions in the scanner's read-only popover |
| C3-111 | READ-ONLY TEACHING | Read a scan's results | VERIFIED | a scan's results table in the scanner widget |
| C3-127 | READ-ONLY TEACHING | See my alerts | VERIFIED | the member's alert list in the Alerts widget |
| C3-134 | READ-ONLY TEACHING | Read stored headlines for a symbol | VERIFIED | stored headlines for a symbol in the News widget |
| C3-149 | READ-ONLY TEACHING | Ask who reports on a day from Charts | VERIFIED | who reports on a day: the Calendar widget's day view (the row's 'ask' is the member reading it, not an Agent-only path) |
| C3-150 | READ-ONLY TEACHING | Ask when a stock reports from Charts | VERIFIED | when a stock reports: the company dock's earnings tab, the same control C3-216 opens |
| C3-157 | READ-ONLY TEACHING | Read breadth tiles | VERIFIED | the Breadth widget's tiles |
| C3-167 | READ-ONLY TEACHING | Read the flow | VERIFIED | the Options Flow widget's rows |
| C3-179 | READ-ONLY TEACHING | Read the numbers | ASSIGNED / NOT REACHED | the fundamentals numbers in the company dock |
| C3-181 | READ-ONLY TEACHING | Read profile and earnings table | VERIFIED | the profile and earnings table in the company dock |
| C3-185 | READ-ONLY TEACHING | Read market context | NO WALKTHROUGH | the Market Context widget's readout |
| C1-161 | excluded | Reorder (front/back) | NO WALKTHROUGH | nonexistent: the overlay no longer offers drawing reorder (ChartDrawingOverlay.jsx:362); only a store function remains |
| C2-049 | excluded | Copy indicators to another chart | NO ASSIGNED WALKTHROUGH | irrelevant as a separate item: no dedicated copy control; the manual route is the template bar, already C2-052 |
| C3-032 | excluded | Save a layout as a global template (admin) | NO ASSIGNED WALKTHROUGH | admin-only: saving a layout as a global template |
| C3-036 | excluded | Delete a prebuilt template (admin) | NO ASSIGNED WALKTHROUGH | admin-only: deleting a prebuilt template |
| C3-054 | excluded | Save a grid as global (admin) | VERIFIED | admin-only: saving a grid as global |
| C3-093 | excluded | Mark a list prebuilt (admin) | NO ASSIGNED WALKTHROUGH | admin-only: marking a list prebuilt |
| C3-115 | excluded | Create a scanner in the workspace | NO WALKTHROUGH | nonexistent: 'create a scanner' in the workspace is a coming-soon panel |
| C3-116 | excluded | Modify a preset scan's conditions | NO ASSIGNED WALKTHROUGH | nonexistent: preset scan conditions are server-defined and read-only; nothing to modify |
| C3-118 | excluded | Run or refine a screen from the workspace chat | NO WALKTHROUGH | Agent-panel-only: a screen is run by typing to the Agent; there is no human control |
| C3-119 | excluded | Save a screen run from the workspace | NO ASSIGNED WALKTHROUGH | Agent-panel-only: a screen is saved through the Agent; there is no human control |

## Folded rows (DUPLICATE and ALTERNATE ROUTE)

| row | class | twin / primary | action | why |
| --- | --- | --- | --- | --- |
| C1-002 | ALTERNATE ROUTE | C1-001 | Type-to-search on focused chart | Typing on a focused chart opens the same SymbolSearch seeded with the key (ChartPane.jsx:864 searchRef.openWith -> SymbolSearch.jsx:75); the pick is C1-001. |
| C1-007 | ALTERNATE ROUTE | C1-006 | Pick from full timeframe menu | The overflow menu is a second door to the same onTf: ChartTfBar.jsx:53 TimeframeMenu onSelect -> onTf(code) vs bar buttons ChartTfBar.jsx:28 onClick -> onTf(code). Custom-interval add/delete/star are their own rows (C1-008..010). |
| C1-023 | ALTERNATE ROUTE | C1-022 | Toggle log (Shift+L) | Shift+L (keyboardShortcuts.js:139 toggle:log -> StockChart.jsx updateField('logScale')) is a keyboard route to the log scale C1-022 sets; execution status says C1-022's real control is Shift+L plus the view scale controls. |
| C1-033 | ALTERNATE ROUTE | C1-030 | Open date box (Alt+G) | Alt+G (StockChart.jsx:10100 setDateJumpOpen -> date input StockChart.jsx:21700 jumpToDate) is a keyboard route to the same go-to-date the Time Navigator box does (ChartDateNav.jsx goToDate). |
| C1-086 | ALTERNATE ROUTE | C2-020 | Show/hide volume (Ctrl+V, menu) | Ctrl+V (keyboardShortcuts.js:163; StockChart.jsx:10227 flips cs.volume.visible) is a shortcut for the same flip as the legend Volume row Hide/Show (StockChart.jsx:6504 legendRowHidden) and toolbar checkbox (ChartToolbar.jsx:497) cited by C2-020. Execution status: C1-086 is Ctrl+V only on /charts. |
| C1-093 | DUPLICATE | C2-038 | Move a pane | Same pane reorder control in ChartSettingsIndicators (movePane/movePaneTo at ChartSettingsIndicators.jsx:1348/1352, data-guide indicators.movePane :1959); C2-038 cites CSI:1841/1877. Control lives in the indicators part. |
| C1-097 | DUPLICATE | C2-018 | Hide/show an indicator from chip | Same legend chip Hide/Show row: chipMenu.js key 'hidden' -> onToggleHidden (8500e084ac app/src/components/chart/legend/chipMenu.js:194-197); C2-018 cites CM:142 for that row (the Show direction is C2-019). Indicators part owns it. |
| C1-098 | DUPLICATE | C2-036 | Display in another pane from chip | Same legend chip 'Display in' row (chipMenu.js:200-201, key move -> setDisplayTarget); C2-036 cites CM:148 (another indicator's pane is C2-037). |
| C1-099 | DUPLICATE | C2-042 | Duplicate on chart | Same chip 'Duplicate on chart' row (chipMenu.js:275-281, onDuplicate); C2-042 cites CM:205. |
| C1-100 | DUPLICATE | C2-041 | Show latest value in header | Same chip 'Show latest value in header' row (chipMenu.js:242-246, onInfoValue); C2-041 cites CM:172. |
| C1-101 | ALTERNATE ROUTE | C2-088 | Add alert from chip | Chip 'Add alert...' row (chipMenu.js:310-311 onAlerts) calls toolbarRef.openAlerts({instanceId}) (StockChart.jsx:6438): the same indicator alerts popover the toolbar button opens (ChartToolbar.jsx:1472 openAlerts), pre-scoped. Creating the alert is C2-089. |
| C1-102 | DUPLICATE | C2-014 | Delete indicator from chip | Same chip 'Delete' row (chipMenu.js:325-326, key remove -> removeInstance); C2-014 cites CM:255. |
| C1-104 | DUPLICATE | C2-010 | Toggle RSI/MACD/BB/VWAP chord | Same INDICATOR_CHORDS table (keyboardShortcuts.js:29-34: Ctrl+I/O/B, Alt+U) toggling RSI/MACD/BB/VWAP; C2-010 cites keyboardShortcuts.js:29. |
| C1-119 | DUPLICATE | C2-098 | Pause/resume indicator alert | IndicatorAlertManager is read-only (IndicatorAlertManager.jsx:29); the real pause/resume is toggleIndicatorAlert in IndicatorAlertPopover.jsx:865, which C2-098 cites (IAP:862). |
| C1-120 | DUPLICATE | C2-099 | Delete indicator alert | IndicatorAlertManager is read-only (IndicatorAlertManager.jsx:29); the real delete is deleteIndicatorAlert in IndicatorAlertPopover.jsx:872, which C2-099 cites (IAP:869). |
| C1-172 | ALTERNATE ROUTE | C2-001 | Add indicator dialog (Alt+Shift+A) | Alt+Shift+A (StockChart.jsx ~10081 toolbarRef.current.openIndicatorLibrary()) opens the same indicator library as the toolbar opener C2-001 cites (TB:1278). |
| C2-015 | ALTERNATE ROUTE | C2-014 | Delete from Chart Settings | Delete in Chart Settings (CSI) calls the same removeInstance on the same instance as the legend chip Delete (C2-014); same operation, different door. |
| C2-039 | DUPLICATE | C1-094 | Resize pane by divider | Same pane separator drag writing setPaneSizes (StockChart.jsx:17985, engine/paneSizes); C2-039 never located a control, C1-094 cites the SC separator. |
| C3-209 | DUPLICATE | C1-042 | Start replay at a date | Same ReplayPanel Start button (pages/charts/ReplayPanel.jsx:80 onStart(date, tf), date input :45); both rows cite RP:79. Chart-surface part owns replay; lower id. |
| C3-210 | DUPLICATE | C1-045 | Exit replay | Same ReplayPanel 'Exit replay' button (ReplayPanel.jsx:73 onExit); both cite RP:73. |
| C3-211 | DUPLICATE | C1-044 | Pick the cutoff by clicking the chart | Same ReplayPanel pick-on-chart button (ReplayPanel.jsx:55 onArmPick); both cite RP:55. |
| C3-212 | DUPLICATE | C1-043 | Set replay timeframe | Same ReplayPanel Timeframe select (ReplayPanel.jsx:61 setTf); both cite RP:61. |

## Confirmed additions

Each checked in master 8500e084ac UI source. C1-176..179 reuse the ids the execution status already gives them.

| id | part | area | action | control (8500e084ac) | note |
| --- | --- | --- | --- | --- | --- |
| C1-180 | C1 | Compare | Switch the Compare panel to the Rotation view (RS-Ratio x RS-Momentum graph vs SPY) | `app/src/pages/charts/CompareSymbolsPanel.jsx:247` | Tab bar Overlay\|Rotation (TABS at :22-24); Rotation lazy-mounts CompareRotation at :255. Header of CompareRotation.jsx says desktop only. Matrix C1-034..041 cover the Overlay tab only. |
| C1-181 | C1 | Compare | Choose which names the rotation graph plots: the compared symbols, a theme/sector/industry group (type, search, pick), or a watchlist | `app/src/pages/charts/CompareRotation.jsx:148` | Compared :148-149, Group :151-157 with type buttons :177, search :183, pick :187; Watchlist select :159-161. Local state only. |
| C1-182 | C1 | Compare | Switch the rotation graph between weekly and daily closes | `app/src/pages/charts/CompareRotation.jsx:168` | Weekly :168, Daily :169 (setCadence, local state). |
| C2-102 | C2 | Legend / first-add tour | Step forward and back through an indicator's first-add tour cards | `app/src/components/StockChart.jsx:1004` | Next :1004, Back :999. The tour opens on the chip menu (setChipPage('tour:0') :6262) on the first add of a definition with meta.tour; the only one at this commit is UCT RS (nativeRegistry.js:4029 tour: RS_TOUR). The opening is automatic; the member control is the stepping. |
| C2-103 | C2 | Legend / first-add tour | Skip or finish (Done) the tour, which marks it seen for the member | `app/src/components/StockChart.jsx:995` | Skip tour :995, Done :1002; both call onFinish -> useIndicatorTours.markSeen (persisted preference). |
| C1-183 | C1 | Patterns | Toggle the chart patterns (Auto Structures) overlay from the toolbar | `app/src/components/chart/ChartToolbar.jsx:1715` | PatternToolbarButton (aria-label 'Toggle chart patterns overlay'). Shown when useAutoStructuresScope is non-null: admins via AUTO_STRUCTURES_ENABLED, paid members via AUTO_STRUCTURES_MEMBERS_ENABLED (both 'armed' in docs/feature_flags.json). Disabled only in Multi-Chart grid cells (GridChartCell.jsx:549-552), not on the main ChartWidget. Member reach depends on the paid tier and the armed flag; confirm live. |
| C1-184 | C1 | Patterns | Click a drawn pattern to open its detail side panel (summary, context, archive stats) and close it | `app/src/components/StockChart.jsx:22114` | onDetectionClick={setActiveDetection} wired from PatternOverlay.jsx:782/:804; panel mounts at StockChart.jsx:22673; close PatternSidePanel.jsx:189; Context section toggle :237. |
| C1-185 | C1 | Patterns | Rate a detected pattern, add an optional note and submit feedback | `app/src/components/chart/PatternSidePanel.jsx:355` | Rating buttons :351-355, note textarea :366, Submit Feedback :372-375 (server write). |
| C1-186 | C1 | Markers | Click an earnings marker on the chart to read that report in a popover | `app/src/components/StockChart.jsx:19948` | Click hit-test sets earningsPopup at :18987-19015; EarningsMarkerPopover renders at :19948, close at EarningsMarkerPopover.jsx:152. C1-070/071 only turn markers on and colour them. |
| C3-224 | C3 | Company dock / Financials | Pick the statement shown in the Financials tab (Income, Balance, Cash Flow) | `app/src/pages/charts/widgets/DockFinancials.jsx:590` | selectStatement; STATEMENTS :38-41. |
| C3-225 | C3 | Company dock / Financials | Pick the Financials period (Annual, Quarterly, TTM) | `app/src/pages/charts/widgets/DockFinancials.jsx:598` | setPeriod; PERIODS :45-48. |
| C3-226 | C3 | Company dock / Financials | Expand a financial line item to see its detail | `app/src/pages/charts/widgets/DockFinancials.jsx:326` | Row role=button, setOpenKey. |
| C3-227 | C3 | Company dock / Ownership | Expand a holder row in the Ownership tab | `app/src/pages/charts/widgets/DockOwnership.jsx:79` | HolderRow onToggle -> toggleHolder :181, used at :290. |
| C3-228 | C3 | Company dock / Ownership | Show more or fewer holders | `app/src/pages/charts/widgets/DockOwnership.jsx:295` | setAllHolders toggle. |
| C3-229 | C3 | Company dock / Earnings | Switch the Earnings tab between Quarterly and Annual | `app/src/pages/charts/widgets/DockEarnings.jsx:319` | selectMode; MODES :50-52. |
| C3-230 | C3 | Company dock / Earnings | Expand an earnings period row | `app/src/pages/charts/widgets/DockEarnings.jsx:81` | Row onToggle when row.expandable; setOpenKey at :365-367. |
| C3-231 | C3 | Company dock / Earnings | Show more or less earnings history | `app/src/pages/charts/widgets/DockEarnings.jsx:373` | toggleHistory ('Show N more' / 'Show less'). |
| C3-232 | C3 | Company dock | Open or hide the Data & sources (methodology) section in a dock tab | `app/src/pages/charts/widgets/DockEarnings.jsx:385` | Same toggle in three tabs: DockFinancials.jsx:653, DockOwnership.jsx:352, DockEarnings.jsx:385. |
| C3-233 | C3 | Company dock | Open a source filing or the earnings report (external SEC/EDGAR link) | `app/src/pages/charts/widgets/DockFinancials.jsx:467` | Financials filings :467, All filings on EDGAR :474; Earnings 'Open earnings report' DockEarnings.jsx:162, filings :168. Leaves the app (new tab). |
| C3-234 | C3 | Company dock / Overview | Expand the company description (More / Less) | `app/src/pages/charts/widgets/DockProfile.jsx:269` | setProfileOpen. |
| C3-235 | C3 | Company dock / Overview | Read the full company story (Full story / Less) | `app/src/pages/charts/widgets/DockProfile.jsx:309` | setStoryOpen. |
| C3-236 | C3 | Company dock | Drag to resize the earnings strip height under the chart | `app/src/pages/charts/widgets/ChartDetailDock.jsx:156` | resizerH onPointerDown stripResize.onDown :157 (title 'Drag to resize the earnings strip'); committed to opts.dock on release. |
| C3-237 | C3 | Company dock | Drag the company panel divider to resize its width | `app/src/pages/charts/widgets/ChartDetailDock.jsx:167` | resizerV onPointerDown rightResize.onDown; committed to opts.dock. |
| C1-176 | C1 | Right-click | Send chart to Journal | `app/src/pages/charts/widgets/ChartWidget.jsx:902` | handleSendToJournal :566. Matches EXECUTION_STATUS wording exactly. |
| C1-177 | C1 | Right-click | Send chart to Journal, choose where | `app/src/pages/charts/widgets/ChartWidget.jsx:905` | handleSendToJournalChoose :580 -> CaptureMenu :991. |
| C1-178 | C1 | Right-click | Ask AI about the symbol on a bar | `app/src/pages/charts/widgets/ChartWidget.jsx:980` | Shown only when ctxMenu.bar; handleAiSearch :625 navigates to /research/<sym>?section=ai (leaves /charts). |
| C1-179 | C1 | Right-click | Add widget, floating at the click | `app/src/pages/charts/widgets/ChartWidget.jsx:967` | 'Add widget' opens the picker (ctxSub 'add' :800); choosing a type calls floatNewWidget(t, {x,y}) at :811. |
| C1-187 | C1 | Header | Hover or focus the market clock to read the session status and next open/close | `app/src/pages/charts/widgets/ChartMarketClock.jsx:86` | Mounted in ChartIdentityRow.jsx:136. Read-only hover popup; low value. |
| C1-188 | C1 | Drawing | Drag the floating favourites drawing toolbar to a new spot on the chart | `app/src/components/chart/ChartToolbar.jsx:981` | Grip 'Drag to move' in FloatingFavoritesToolbar (:852, mounted :2282); onMove saves position as a fraction of the container. C1-165 covers which tools are favourites, not moving the bar. |

**Proposed and rejected:**

- Strategy report tabs (StrategyReportPanel.jsx:221/234): Dark. The only mount, AttachedStrategyReports.jsx (ChartPane.jsx:1220), returns null unless VITE_PINE_STRATEGY_BROKER_ENABLED==='1', which docs/feature_flags.json marks dark and unset on every service; the note adds that even when on, a chart strategy refuses runtime:strategy-start, so no report shows. Not member-reachable.
- Pane ranks table (pane/PaneRanksTable.jsx, StockChart.jsx:21981): Not a control: a read-only <dl> strip with no handlers. Its on/off switch is the UCT RS indicator input showRanksTable (nativeRegistry.js:4269), already covered by C2-026 (flip a toggle setting).
- indicatorTour.js as such: A pure helper (tourCardsOf/claimTour/isTouredFirstAdd), not a control. The member controls are the tour buttons in StockChart.jsx:995-1004, confirmed above.
- Chart IQ toolbar button (ChartToolbar.jsx:1712): Already row C2-013 (Toggle Chart IQ pattern recognition); also CHART_IQ_ENABLED and CHART_IQ_MEMBERS_ENABLED are dark, so members do not see it.
- 'All/Team' drawing tiers and 'Levels' toolbar buttons (ChartToolbar.jsx:1717-1742): Admin only: rendered only when autoStructuresScope==='all' (admin scope).
- DockProfile ~398 TeamHistoryPanel: Dark: renders only when WISDOM_TICKER_HISTORY_ENABLED rides the auth payload, and that flag is dark in docs/feature_flags.json.
- Retry buttons (DockOwnership.jsx:204, DockEarnings.jsx:352): Error recovery after a failed read, not a distinct member operation. Same for CompareRotation.jsx:218 Retry.
- ChartDetailDock.jsx tab switch :176, search :183, collapse :193, rail expand :233: Already rows C3-216 (switch tab), C3-218 (search), C3-217 (open or collapse).
- Header day gain (ChartIdentityRow.jsx:91-96, ChartDayGain.jsx): Passive display: no handler, hover or focus behaviour. Not a control.
- Drag-reordering indicator series rows (ChartSettingsIndicators.jsx:1689-1712): Already row C2-040 (Reorder series within a pane, cited as CSI:1609 at 179d57570d; same series drag, moved).
- Drag-reordering panes in Arrange (ChartSettingsIndicators.jsx:1921-1934): Already row C2-038 (Reorder pane, CSI:1877/1841 at 179d57570d; movePane/movePaneTo).

## Discovery (candidates, not counted)

| part | area | action | control | why it may be new |
| --- | --- | --- | --- | --- |
| C3 | Company dock / News | Filter the dock's News tab by sentiment (persisted to opts.dock.newsFilter) | `app/src/pages/charts/widgets/DockNews.jsx:326` | No matrix row; C3-133 is the separate News widget. ChartDetailDock.jsx:218 passes onSentiment={setNewsFilter}. |
| C3 | Company dock / News | Search the symbol's news in the dock, and clear the search | `app/src/pages/charts/widgets/DockNews.jsx:307` | No matrix row (clear :312, :337). |
| C3 | Company dock / News | Expand a dock headline, or open the article or related items | `app/src/pages/charts/widgets/DockNews.jsx:73` | No matrix row; open-article link :160, related :150, embed :123. |
| C2 | Add / Research rows | Add or remove the Earnings Strip or Company Info from Add to Chart (Research rows), and open or collapse them there | `app/src/components/chart/ChartSettingsIndicators.jsx:1223` | chartFeatures add :1223, setOpen :2480, remove :2493. The matrix has no Earnings Strip row and no add/remove-Company-Info row; C3-217 is only the dock's own collapse. |
| C2 | Legend / Preset | Pick an indicator preset from the chip menu or the pane right-click Preset flyout | `app/src/components/chart/legend/chipMenu.js:218` | presetSubmenu :108; right-click door ChartWidget.jsx:835-858. No 'preset' row in the matrix for indicators. |
| C2 | Legend | Remove an indicator value from the chart header (x on an info value) | `app/src/components/StockChart.jsx:21349` | handleInfoValueRemove. Matrix C1-100/C2-041 cover showing a value in the header; removal may count as the same toggle row, so decide. |
| C1 | Compare | Expand or collapse a compared group in the chart's compare legend | `app/src/components/StockChart.jsx:20472` | setOpenCmpGroups local toggle; inline remove buttons :20484/:20513/:20548 duplicate C1-036/037. View-only, low value. |
| C1 | Right-click | Open Chart settings at the section matching where you right-clicked (watermark, price axis, MA, candle, canvas) | `app/src/pages/charts/widgets/ChartWidget.jsx:922` | Location-aware item. Nearest rows are C1-127 (open chart settings, generic) and C1-124 (indicator settings); likely another door to C1-127, so decide. |
| C1 | Right-click | Set a price alert at the clicked price from the workspace right-click menu | `app/src/pages/charts/widgets/ChartWidget.jsx:894` | Probably another door to C1-114 (alert at the cursor) with the same outcome; listed so the matrix can cite this door. |

## Every row of the 499

| row | area | action | class | twin / primary | walkthrough (teach-cov-5) | execution (master) |
| --- | --- | --- | --- | --- | --- | --- |
| C1-001 | Symbol | Change ticker by search pick | UNIQUE |  | VERIFIED | VERIFIED |
| C1-002 | Symbol | Type-to-search on focused chart | ALTERNATE ROUTE | C1-001 | ASSIGNED / NOT REACHED | VERIFIED |
| C1-003 | Symbol | Filter search by category chip | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C1-004 | Symbol | Open a free-typed symbol with no result row | UNIQUE |  | ASSIGNED / NOT REACHED | IMPLEMENTED / UNVERIFIED |
| C1-005 | Symbol | Flag current ticker (Shift+F) | UNIQUE |  | VERIFIED | VERIFIED |
| C1-006 | Timeframe | Pick preset timeframe on bar | UNIQUE |  | VERIFIED | VERIFIED |
| C1-007 | Timeframe | Pick from full timeframe menu | ALTERNATE ROUTE | C1-006 | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-008 | Timeframe | Add custom interval | UNIQUE |  | VERIFIED | VERIFIED |
| C1-009 | Timeframe | Delete custom interval | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-010 | Timeframe | Star a favourite timeframe | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-011 | Timeframe | Timeframe keys with repeat-press cycle | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-012 | Timeframe | Change timeframe from right-click | NOT ON DESKTOP |  | NO ASSIGNED WALKTHROUGH | NOT ON /CHARTS |
| C1-013 | Chart type | Choose chart type in settings | UNIQUE |  | VERIFIED | VERIFIED |
| C1-014 | Chart type | Choose chart type from right-click | NOT ON DESKTOP |  | NO ASSIGNED WALKTHROUGH | NOT ON /CHARTS |
| C1-015 | Chart type | Breadth Line/Candles quick toggle | UNIQUE |  | NO ASSIGNED WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C1-016 | Chart type | Heikin Ashi candles | UNIQUE |  | NO ASSIGNED WALKTHROUGH | UNMAPPED |
| C1-017 | Chart type | Candle colour mode | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-018 | Chart type | Thin bars | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-019 | Session | Regular/extended on intraday | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-020 | Session | Regular/extended on D/W/M | UNIQUE |  | VERIFIED | VERIFIED |
| C1-021 | Session | Extended hours from price-axis menu | NOT ON DESKTOP |  | NO ASSIGNED WALKTHROUGH | NOT ON /CHARTS |
| C1-022 | Scale | Arithmetic/log/percent from menu | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-023 | Scale | Toggle log (Shift+L) | ALTERNATE ROUTE | C1-022 | ASSIGNED / NOT REACHED | VERIFIED |
| C1-024 | Scale | Invert scale (Alt+I) | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-025 | Scale | Auto-scale | UNIQUE |  | VERIFIED | MISSING |
| C1-026 | Scale | Drag price axis to compress | UNIQUE |  | NO WALKTHROUGH | BLOCKED |
| C1-027 | View | Reset view | UNIQUE |  | VERIFIED | VERIFIED † |
| C1-028 | View | Zoom in/out (+/-) | UNIQUE |  | VERIFIED | BLOCKED |
| C1-029 | View | Range buttons (3M/6M/YTD/1Y/5Y) | UNIQUE |  | VERIFIED | VERIFIED † |
| C1-030 | Go to date | Type a date in Time Navigator | UNIQUE |  | VERIFIED | VERIFIED † |
| C1-031 | Go to date | Pick date or year in calendar | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-032 | Go to date | Step one bar back/forward | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C1-033 | Go to date | Open date box (Alt+G) | ALTERNATE ROUTE | C1-030 | ASSIGNED / NOT REACHED | VERIFIED † |
| C1-034 | Compare | Add a symbol | UNIQUE |  | VERIFIED | VERIFIED |
| C1-035 | Compare | Add a whole group | UNIQUE |  | VERIFIED | MISSING |
| C1-036 | Compare | Remove one symbol | UNIQUE |  | ASSIGNED / NOT REACHED | IMPLEMENTED / UNVERIFIED |
| C1-037 | Compare | Remove a group | UNIQUE |  | VERIFIED | MISSING |
| C1-038 | Compare | Clear all comparisons | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-039 | Compare | Same/new scale per symbol | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-040 | Compare | Same/new scale for a group | UNIQUE |  | VERIFIED | MISSING |
| C1-041 | Compare | Group only (hide base) | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-042 | Replay | Start from a date | UNIQUE |  | VERIFIED | VERIFIED |
| C1-043 | Replay | Choose replay timeframe | UNIQUE |  | VERIFIED | MISSING |
| C1-044 | Replay | Pick the cutoff on the chart | UNIQUE |  | NO WALKTHROUGH | BLOCKED |
| C1-045 | Replay | Exit replay | UNIQUE |  | ROUTED / BROWSER FAILED | VERIFIED |
| C1-046 | Replay | Legacy bar replay play/step/speed/scrub | UNIQUE |  | NO ASSIGNED WALKTHROUGH | UNMAPPED |
| C1-047 | Settings | Toggle grid | UNIQUE |  | VERIFIED | VERIFIED |
| C1-048 | Settings | Solid/gradient background | UNIQUE |  | VERIFIED | VERIFIED |
| C1-049 | Settings | Solid background colour | UNIQUE |  | VERIFIED | VERIFIED |
| C1-050 | Settings | Gradient colours | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-051 | Settings | Crosshair mode | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-052 | Settings | Crosshair colour/width/style | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-053 | Settings | Magnet crosshair | UNIQUE |  | NO ASSIGNED WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C1-054 | Settings | Price labels / MA labels | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-055 | Settings | Scale text size and colour | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-056 | Settings | Watermark on/off (Alt+Shift+W) | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-057 | Settings | Watermark lines | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-058 | Settings | Watermark alignment | UNIQUE |  | VERIFIED | MISSING |
| C1-059 | Settings | Watermark size/weight/colour/opacity | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-060 | Settings | Move watermark | UNIQUE |  | VERIFIED | VERIFIED |
| C1-061 | Settings | Reset watermark to centre | UNIQUE |  | VERIFIED | MISSING |
| C1-062 | Settings | Title shows ticker/company/both | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-063 | Settings | Day change beside title | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-064 | Settings | Legend mode | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-065 | Settings | Legend bar-info fields | UNIQUE |  | VERIFIED | MISSING |
| C1-066 | Settings | Info-row fields | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C1-067 | Settings | Header colours | UNIQUE |  | VERIFIED | MISSING |
| C1-068 | Settings | Swing labels on/off and sensitivity | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-069 | Settings | Swing label background, tint, colours | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-070 | Settings | Event markers | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-071 | Settings | Earnings beat/miss and IPO colours | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-072 | Settings | Prev-day lines on/off | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-073 | Settings | Prev-day line style/width/colour | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-074 | Settings | Dark-pool levels | UNIQUE |  | VERIFIED | VERIFIED |
| C1-075 | Settings | Bar-close countdown (Shift+C) | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-076 | Settings | Restore defaults | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-077 | Settings | Save / delete a custom colour | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C1-078 | Settings | Light/dark palette (Shift+T) | UNIQUE |  | VERIFIED | MISSING |
| C1-079 | Themes | Apply a theme to one chart | UNIQUE |  | VERIFIED | VERIFIED |
| C1-080 | Themes | Apply a theme to all charts | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-081 | Themes | Apply a theme to all widgets | UNIQUE |  | VERIFIED | MISSING |
| C1-082 | Templates | Apply a template | UNIQUE |  | VERIFIED | VERIFIED |
| C1-083 | Templates | Save a template | UNIQUE |  | VERIFIED | VERIFIED |
| C1-084 | Templates | Delete a template | UNIQUE |  | VERIFIED | VERIFIED |
| C1-085 | Templates | Copy another chart's look | NOT ON DESKTOP |  | NO ASSIGNED WALKTHROUGH | NOT ON /CHARTS |
| C1-086 | Volume | Show/hide volume (Ctrl+V, menu) | ALTERNATE ROUTE | C2-020 | VERIFIED | VERIFIED |
| C1-087 | Volume | Remove volume | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-088 | Volume | Separate pane toggle | NOT ON DESKTOP |  | VERIFIED | NOT ON /CHARTS |
| C1-089 | Volume | Resize volume pane by drag | UNIQUE |  | VERIFIED | VERIFIED |
| C1-090 | Volume | HVC highlight | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-091 | Volume | Volume colours, MA, label, bar style | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-092 | Volume | Overlay indicator on volume | UNIQUE |  | NO ASSIGNED WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C1-093 | Panes | Move a pane | DUPLICATE | C2-038 | ASSIGNED / NOT REACHED | VERIFIED |
| C1-094 | Panes | Resize a pane | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-095 | Panes | Collapse a pane | NOT ON DESKTOP |  | NO WALKTHROUGH | NOT ON /CHARTS |
| C1-096 | Crosshair | Copy price at the cursor | NOT ON DESKTOP |  | NO WALKTHROUGH | NOT ON /CHARTS |
| C1-097 | Legend | Hide/show an indicator from chip | DUPLICATE | C2-018 | VERIFIED | VERIFIED |
| C1-098 | Legend | Display in another pane from chip | DUPLICATE | C2-036 | VERIFIED | VERIFIED |
| C1-099 | Legend | Duplicate on chart | DUPLICATE | C2-042 | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-100 | Legend | Show latest value in header | DUPLICATE | C2-041 | VERIFIED | MISSING |
| C1-101 | Legend | Add alert from chip | ALTERNATE ROUTE | C2-088 | VERIFIED | VERIFIED |
| C1-102 | Legend | Delete indicator from chip | DUPLICATE | C2-014 | VERIFIED | VERIFIED |
| C1-103 | Legend | Hide all indicators (Alt+Shift+I) | UNIQUE |  | VERIFIED | VERIFIED † |
| C1-104 | Legend | Toggle RSI/MACD/BB/VWAP chord | DUPLICATE | C2-010 | ASSIGNED / NOT REACHED | IMPLEMENTED / UNVERIFIED |
| C1-105 | Legend | Toggle moving averages (Ctrl+M) | UNIQUE |  | VERIFIED | VERIFIED |
| C1-106 | Measure | Measure on the chart | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C1-107 | Measure | Bars & Time | UNIQUE |  | VERIFIED | VERIFIED |
| C1-108 | Measure | Price range | UNIQUE |  | NO WALKTHROUGH | VERIFIED |
| C1-109 | Measure | Price Move | UNIQUE |  | VERIFIED | VERIFIED |
| C1-110 | Share | Open share popover (Alt+S) | UNIQUE |  | VERIFIED | BLOCKED |
| C1-111 | Share | Download PNG | UNIQUE |  | VERIFIED | BLOCKED |
| C1-112 | Share | Copy image | UNIQUE |  | VERIFIED | BLOCKED |
| C1-113 | Share | Copy share link | UNIQUE |  | VERIFIED | BLOCKED |
| C1-114 | Alerts | Price alert at the cursor (Alt+N) | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C1-115 | Alerts | Alert on a line, following it | UNIQUE |  | VERIFIED | VERIFIED |
| C1-116 | Alerts | Alert at a line's fixed level | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-117 | Alerts | Alert on a fib level | UNIQUE |  | NO ASSIGNED WALKTHROUGH | VERIFIED |
| C1-118 | Alerts | Position alerts (three lines) | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C1-119 | Alerts | Pause/resume indicator alert | DUPLICATE | C2-098 | VERIFIED | VERIFIED |
| C1-120 | Alerts | Delete indicator alert | DUPLICATE | C2-099 | VERIFIED | VERIFIED |
| C1-121 | Alerts | Move a level line | UNIQUE |  | VERIFIED | VERIFIED |
| C1-122 | Right-click | Draw line at clicked price | NOT ON DESKTOP |  | NO ASSIGNED WALKTHROUGH | NOT ON /CHARTS |
| C1-123 | Right-click | Add indicator from menu | NOT ON DESKTOP |  | ASSIGNED / NOT REACHED | NOT ON /CHARTS |
| C1-124 | Right-click | Open indicator settings | NOT ON DESKTOP |  | VERIFIED | NOT ON /CHARTS |
| C1-125 | Right-click | Clear all drawings | UNIQUE |  | VERIFIED | VERIFIED |
| C1-126 | Right-click | Hide all drawings | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-127 | Settings door | Open chart settings (Alt+,, gear) | UNIQUE |  | VERIFIED | MISSING |
| C1-128 | Drawing | Trendline | UNIQUE |  | VERIFIED | VERIFIED |
| C1-129 | Drawing | Ray | NOT ON DESKTOP |  | NO WALKTHROUGH | NOT ON /CHARTS |
| C1-130 | Drawing | Extended line | UNIQUE |  | VERIFIED | VERIFIED |
| C1-131 | Drawing | Horizontal line | UNIQUE |  | VERIFIED | VERIFIED |
| C1-132 | Drawing | Horizontal ray | UNIQUE |  | VERIFIED | VERIFIED |
| C1-133 | Drawing | Vertical line | UNIQUE |  | VERIFIED | VERIFIED |
| C1-134 | Drawing | Rectangle | UNIQUE |  | VERIFIED | VERIFIED |
| C1-135 | Drawing | Circle | UNIQUE |  | VERIFIED | VERIFIED |
| C1-136 | Drawing | Arrow | UNIQUE |  | VERIFIED | VERIFIED |
| C1-137 | Drawing | Fib retracement | UNIQUE |  | VERIFIED | VERIFIED |
| C1-138 | Drawing | Fib extension | UNIQUE |  | VERIFIED | VERIFIED |
| C1-139 | Drawing | Pitchfork | UNIQUE |  | VERIFIED | VERIFIED |
| C1-140 | Drawing | Parallel channel | UNIQUE |  | VERIFIED | VERIFIED |
| C1-141 | Drawing | Cup curve | UNIQUE |  | VERIFIED | VERIFIED |
| C1-142 | Drawing | Anchored VWAP | UNIQUE |  | VERIFIED | VERIFIED |
| C1-143 | Drawing | Text note | UNIQUE |  | VERIFIED | VERIFIED |
| C1-144 | Drawing | Position calculator | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-145 | Drawing | Eraser | UNIQUE |  | VERIFIED | VERIFIED |
| C1-146 | Drawing | Delete selected (Del, button) | UNIQUE |  | VERIFIED | VERIFIED |
| C1-147 | Drawing | Recolour | UNIQUE |  | VERIFIED | VERIFIED |
| C1-148 | Drawing | Width and line style | UNIQUE |  | VERIFIED | VERIFIED |
| C1-149 | Drawing | Fill and border | UNIQUE |  | VERIFIED | VERIFIED |
| C1-150 | Drawing | Text font, size, bold, italic, background | UNIQUE |  | VERIFIED | VERIFIED |
| C1-151 | Drawing | Fib levels and fills | UNIQUE |  | VERIFIED | VERIFIED |
| C1-152 | Drawing | Reset fib | UNIQUE |  | ROUTED / BROWSER FAILED | VERIFIED |
| C1-153 | Drawing | Measure-label options | UNIQUE |  | ROUTED / BROWSER FAILED | VERIFIED |
| C1-154 | Drawing | Price label on a line | UNIQUE |  | VERIFIED | VERIFIED |
| C1-155 | Drawing | Edit anchors | UNIQUE |  | VERIFIED | VERIFIED |
| C1-156 | Drawing | Make horizontal | UNIQUE |  | VERIFIED | VERIFIED |
| C1-157 | Drawing | Duplicate | UNIQUE |  | VERIFIED | MISSING |
| C1-158 | Drawing | Lock/unlock | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-159 | Drawing | Hide/show one | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C1-160 | Drawing | Save as default | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C1-161 | Drawing | Reorder (front/back) | VALID |  | NO WALKTHROUGH | UNMAPPED |
| C1-162 | Drawing | Undo/redo a drawing | UNIQUE |  | VERIFIED | BLOCKED |
| C1-163 | Drawing | Magnet for drawing | UNIQUE |  | VERIFIED | UNMAPPED |
| C1-164 | Drawing | Repeat drawing mode | UNIQUE |  | VERIFIED | BLOCKED |
| C1-165 | Drawing | Customise tool favourites | UNIQUE |  | VERIFIED | MISSING |
| C1-166 | Drawing | Nudge selected with arrows | UNIQUE |  | VERIFIED | BLOCKED |
| C1-167 | Boards | Switch drawing board | UNIQUE |  | VERIFIED | MISSING |
| C1-168 | Boards | Create a board | UNIQUE |  | VERIFIED | MISSING |
| C1-169 | Boards | Rename a board | UNIQUE |  | VERIFIED | MISSING |
| C1-170 | Boards | Delete a board | UNIQUE |  | VERIFIED | MISSING |
| C1-171 | Keyboard | Add ticker to watchlist (Alt+Q) | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C1-172 | Keyboard | Add indicator dialog (Alt+Shift+A) | ALTERNATE ROUTE | C2-001 | ASSIGNED / NOT REACHED | VERIFIED |
| C1-173 | Keyboard | Cycle grid layout (Alt+\\) | UNIQUE |  | VERIFIED | UNMAPPED |
| C1-174 | Keyboard | Keyboard help (?) | UNIQUE |  | NO WALKTHROUGH | UNMAPPED |
| C1-175 | Keyboard | Press Esc to return to the cursor or cancel the armed drawing tool *(corrected 2026-11-10; was: Escape to cursor / cancel)* | UNIQUE |  | NO WALKTHROUGH | BLOCKED |
| C2-001 | Picker | Open indicator library | UNIQUE |  | VERIFIED | MISSING |
| C2-002 | Picker | Search indicators by name or purpose | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-003 | Picker | Browse by category | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-004 | Add | Add built-in indicator | UNIQUE |  | VERIFIED | VERIFIED |
| C2-005 | Add | Add with chosen settings | UNIQUE |  | VERIFIED | VERIFIED |
| C2-006 | Add | Add another copy with defaults | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-007 | Add | Add own saved indicator | UNIQUE |  | ROUTED / BROWSER FAILED | VERIFIED |
| C2-008 | Add | Add a symbol as a data series from search | UNIQUE |  | VERIFIED | UNMAPPED |
| C2-009 | Add | Add economic series | UNIQUE |  | NO WALKTHROUGH | UNMAPPED |
| C2-010 | Add | Keyboard chord toggles RSI, MACD, BB, VWAP | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-011 | Add | Enable classic overlay average | UNIQUE |  | VERIFIED | MISSING |
| C2-012 | Add | Add Volume Profile | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C2-013 | Add | Toggle Chart IQ pattern recognition | UNIQUE |  | NO WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C2-014 | Remove | Delete indicator from legend | UNIQUE |  | VERIFIED | VERIFIED |
| C2-015 | Remove | Delete from Chart Settings | ALTERNATE ROUTE | C2-014 | ASSIGNED / NOT REACHED | VERIFIED |
| C2-016 | Remove | Delete classic average row | UNIQUE |  | VERIFIED | VERIFIED |
| C2-017 | Remove | Remove an unavailable indicator | UNIQUE |  | VERIFIED | UNMAPPED |
| C2-018 | Visibility | Hide indicator | UNIQUE |  | VERIFIED | VERIFIED |
| C2-019 | Visibility | Show indicator | UNIQUE |  | VERIFIED | VERIFIED |
| C2-020 | Visibility | Hide or show volume | UNIQUE |  | VERIFIED | VERIFIED |
| C2-021 | Visibility | Limit to chosen timeframes | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C2-022 | Read | See what is on a chart | VALID |  | VERIFIED | VERIFIED |
| C2-023 | Read | Read About text | VALID |  | ASSIGNED / NOT REACHED | IMPLEMENTED / UNVERIFIED |
| C2-024 | Inputs | Change numeric setting | UNIQUE |  | VERIFIED | VERIFIED |
| C2-025 | Inputs | Change select setting (MA type, source) | UNIQUE |  | VERIFIED | VERIFIED |
| C2-026 | Inputs | Flip a toggle setting | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-027 | Inputs | Edit session input | UNIQUE |  | NO WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C2-028 | Inputs | Cancel settings, roll back all edits | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C2-029 | Inputs | Set calculation timeframe | UNIQUE |  | VERIFIED | MISSING |
| C2-030 | Style | Change line colour | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C2-031 | Style | Change histogram up / down colours | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-032 | Style | Change line width | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C2-033 | Style | Change line style | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C2-034 | Style | Change plot style | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-035 | Style | Toggle overlap candles | UNIQUE |  | NO ASSIGNED WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C2-036 | Placement | Move to price, volume or own pane | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C2-037 | Placement | Move into another indicator's pane | UNIQUE |  | ASSIGNED / NOT REACHED | IMPLEMENTED / UNVERIFIED |
| C2-038 | Panes | Reorder pane | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C2-039 | Panes | Resize pane by divider | DUPLICATE | C1-094 | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-040 | Panes | Reorder series within a pane | UNIQUE |  | NO ASSIGNED WALKTHROUGH | UNMAPPED |
| C2-041 | Legend | Show latest value in header | UNIQUE |  | VERIFIED | MISSING |
| C2-042 | Legend | Duplicate on chart | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-043 | Legend | Create custom copy | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-044 | Legend | Open Modify with UCT Intelligence | UNIQUE |  | ASSIGNED / NOT REACHED | IMPLEMENTED / UNVERIFIED |
| C2-045 | Legend | Open Edit formula | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C2-046 | Legend | Apply script accuracy upgrade | UNIQUE |  | NO WALKTHROUGH | BLOCKED |
| C2-047 | Legend | Report mismatch with TradingView | UNIQUE |  | NO WALKTHROUGH | BLOCKED |
| C2-048 | Undo | Indicator undo and redo buttons | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-049 | Copy | Copy indicators to another chart | VALID |  | NO ASSIGNED WALKTHROUGH | VERIFIED |
| C2-050 | Copy | Accept or refuse a shared chart's indicators | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C2-051 | Templates | Save indicator template | UNIQUE |  | NO ASSIGNED WALKTHROUGH | VERIFIED |
| C2-052 | Templates | Apply indicator template | UNIQUE |  | NO ASSIGNED WALKTHROUGH | VERIFIED |
| C2-053 | Templates | Delete indicator template | UNIQUE |  | NO ASSIGNED WALKTHROUGH | VERIFIED |
| C2-054 | Templates | List indicator templates | VALID |  | NO ASSIGNED WALKTHROUGH | VERIFIED |
| C2-055 | Create | Open Create Indicator | UNIQUE |  | VERIFIED | VERIFIED |
| C2-056 | Create | Describe an indicator, get a draft | UNIQUE |  | VERIFIED | VERIFIED |
| C2-057 | Create | Refine draft by conversation | UNIQUE |  | ASSIGNED / NOT REACHED | IMPLEMENTED / UNVERIFIED |
| C2-058 | Create | Answer the builder's choice question | UNIQUE |  | NO ASSIGNED WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C2-059 | Create | Undo a draft step | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-060 | Create | Preview draft on chart | UNIQUE |  | NO WALKTHROUGH | VERIFIED |
| C2-061 | Create | Save draft, acknowledge warnings | UNIQUE |  | VERIFIED | VERIFIED |
| C2-062 | Create | Discard draft | UNIQUE |  | VERIFIED | VERIFIED |
| C2-063 | Create | Keep draft and close | UNIQUE |  | NO ASSIGNED WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C2-064 | Builder | Build by conditions | UNIQUE |  | ASSIGNED / NOT REACHED | IMPLEMENTED / UNVERIFIED |
| C2-065 | Builder | Group conditions, any or all | UNIQUE |  | NO ASSIGNED WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C2-066 | Builder | Enter a formula | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-067 | Builder | Add or remove member input | UNIQUE |  | NO WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C2-068 | Builder | Add, remove or restyle output plot | UNIQUE |  | NO WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C2-069 | Builder | Set placement and levels | UNIQUE |  | ASSIGNED / NOT REACHED | IMPLEMENTED / UNVERIFIED |
| C2-070 | Builder | Set signal markers | UNIQUE |  | ROUTED / BROWSER FAILED | IMPLEMENTED / UNVERIFIED |
| C2-071 | Builder | Colour candles or background on a signal | UNIQUE |  | ROUTED / BROWSER FAILED | IMPLEMENTED / UNVERIFIED |
| C2-072 | Builder | Name the draft | UNIQUE |  | VERIFIED | VERIFIED |
| C2-073 | Builder | Ask for an alert from the builder | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C2-074 | Builder | Run Evidence tab | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C2-075 | Builder | Use a starter | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C2-076 | Import | Paste Pine or thinkScript | UNIQUE |  | VERIFIED | MISSING |
| C2-077 | Import | Apply import suggestion | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C2-078 | Import | Change script settings | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C2-079 | Import | Turn script output into a screen | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C2-080 | Image | Read an indicator from a screenshot | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C2-081 | Image | Accept image candidate | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C2-082 | Saved | Open saved definition to edit | UNIQUE |  | ASSIGNED / NOT REACHED | IMPLEMENTED / UNVERIFIED |
| C2-083 | Saved | Delete saved definition | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C2-084 | Saved | Share a definition by link | UNIQUE |  | NO ASSIGNED WALKTHROUGH | BLOCKED |
| C2-085 | Saved | Publish to or withdraw from library | UNIQUE |  | NO ASSIGNED WALKTHROUGH | BLOCKED |
| C2-086 | Saved | Install from a share link | UNIQUE |  | NO ASSIGNED WALKTHROUGH | BLOCKED |
| C2-087 | Saved | Restore an older version | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C2-088 | Alerts | Open indicator alerts popover | UNIQUE |  | VERIFIED | MISSING |
| C2-089 | Alerts | Create threshold alert | UNIQUE |  | VERIFIED | VERIFIED |
| C2-090 | Alerts | Create MA cross alert | UNIQUE |  | VERIFIED | VERIFIED |
| C2-091 | Alerts | Choose plot on a multi-line indicator | UNIQUE |  | ROUTED / BROWSER FAILED | IMPLEMENTED / UNVERIFIED |
| C2-092 | Alerts | Alert on a yes/no signal with trigger policy | UNIQUE |  | ROUTED / BROWSER FAILED | MISSING |
| C2-093 | Alerts | Alert on another timeframe | UNIQUE |  | VERIFIED | VERIFIED |
| C2-094 | Alerts | Limit alert to this chart | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C2-095 | Alerts | Override alert inputs | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C2-096 | Alerts | Choose which instance | UNIQUE |  | VERIFIED | VERIFIED |
| C2-097 | Alerts | List indicator alerts | VALID |  | VERIFIED | VERIFIED |
| C2-098 | Alerts | Pause or resume alert | UNIQUE |  | VERIFIED | VERIFIED |
| C2-099 | Alerts | Delete alert | UNIQUE |  | VERIFIED | VERIFIED |
| C2-100 | Alerts | See why an alert cannot fire | VALID |  | ROUTED / BROWSER FAILED | IMPLEMENTED / UNVERIFIED |
| C2-101 | Mobile | Edit an average or study on phone | NOT ON DESKTOP |  | NO ASSIGNED WALKTHROUGH | NOT ON /CHARTS |
| C3-001 | Board | Add a widget from Widgets ▾ | UNIQUE |  | VERIFIED | VERIFIED |
| C3-002 | Board | Drag a widget to move it, or nudge it | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-003 | Board | Drag a widget edge or merged seam to resize | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-004 | Board | Close a widget | UNIQUE |  | VERIFIED | VERIFIED |
| C3-005 | Board | Merge or unmerge widgets (lock board, drop borders) | UNIQUE |  | VERIFIED | MISSING |
| C3-006 | Link | Cycle a widget's link colour | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-007 | Link | Change a tool panel's colour group | UNIQUE |  | VERIFIED | MISSING |
| C3-008 | Float | Float a widget over another | UNIQUE |  | VERIFIED | MISSING |
| C3-009 | Float | Drag or resize a floating widget | UNIQUE |  | VERIFIED | BLOCKED |
| C3-010 | Float | Dock a floating widget back into the grid | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-011 | Float | Move a floating widget into another widget's tabs | UNIQUE |  | VERIFIED | MISSING |
| C3-012 | Popout | Pop a widget into its own window | UNIQUE |  | VERIFIED | MISSING |
| C3-013 | Popout | Pop out the whole layout | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-014 | Popout | Dock a popped widget or layout back | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-015 | Popout | Close a popped widget | UNIQUE |  | VERIFIED | MISSING |
| C3-016 | Widget tabs | Add a widget as a tab | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-017 | Widget tabs | Switch a widget tab | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-018 | Widget tabs | Rename a widget tab | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-019 | Widget tabs | Close a widget tab | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-020 | Chart tabs | Add a chart tab | UNIQUE |  | VERIFIED | VERIFIED |
| C3-021 | Chart tabs | Switch a chart tab | UNIQUE |  | VERIFIED | VERIFIED |
| C3-022 | Chart tabs | Rename a chart tab | UNIQUE |  | VERIFIED | VERIFIED |
| C3-023 | Chart tabs | Change a chart tab's link colour | UNIQUE |  | ROUTED / BROWSER FAILED | IMPLEMENTED / UNVERIFIED |
| C3-024 | Chart tabs | Close a chart tab | UNIQUE |  | VERIFIED | VERIFIED |
| C3-025 | Layout Dock | Open a saved layout | UNIQUE |  | VERIFIED | VERIFIED |
| C3-026 | Layout Dock | See which layout is open | VALID |  | VERIFIED | VERIFIED |
| C3-027 | Layout Dock | Undo a layout switch from the toast | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-028 | Layout Dock | Create a new layout from the dock | UNIQUE |  | VERIFIED | VERIFIED |
| C3-029 | Layout Dock | Start a new blank board from the Layouts menu | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-030 | Layout Dock | Save the open layout | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-031 | Layout Dock | Save as a new layout | UNIQUE |  | VERIFIED | VERIFIED |
| C3-032 | Layout Dock | Save a layout as a global template (admin) | VALID |  | NO ASSIGNED WALKTHROUGH | BLOCKED |
| C3-033 | Layout Dock | Rename a layout | UNIQUE |  | VERIFIED | VERIFIED |
| C3-034 | Layout Dock | Duplicate a layout | UNIQUE |  | VERIFIED | VERIFIED |
| C3-035 | Layout Dock | Delete a layout | UNIQUE |  | VERIFIED | VERIFIED |
| C3-036 | Layout Dock | Delete a prebuilt template (admin) | VALID |  | NO ASSIGNED WALKTHROUGH | BLOCKED |
| C3-037 | Layout Dock | Pin a layout to the bar | UNIQUE |  | VERIFIED | MISSING |
| C3-038 | Layout Dock | Reorder layouts on the bar | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-039 | Layout Dock | Remove a layout from the bar | UNIQUE |  | VERIFIED | MISSING |
| C3-040 | Layout Dock | View a layout's version history | UNIQUE |  | VERIFIED | MISSING |
| C3-041 | Layout Dock | Restore a layout version | UNIQUE |  | VERIFIED | MISSING |
| C3-042 | Multi Chart | Enter a preset grid | UNIQUE |  | VERIFIED | MISSING |
| C3-043 | Multi Chart | Apply a custom rows × columns grid | UNIQUE |  | VERIFIED | MISSING |
| C3-044 | Multi Chart | Exit Multi Chart | UNIQUE |  | VERIFIED | BLOCKED |
| C3-045 | Multi Chart | Toggle crosshair sync | UNIQUE |  | VERIFIED | BLOCKED |
| C3-046 | Multi Chart | Toggle time-range sync | UNIQUE |  | VERIFIED | BLOCKED |
| C3-047 | Multi Chart | Turn on Groups mode | UNIQUE |  | VERIFIED | BLOCKED |
| C3-048 | Multi Chart | Pick a group for the grid | UNIQUE |  | VERIFIED | BLOCKED |
| C3-049 | Multi Chart | Step or switch group | UNIQUE |  | VERIFIED | BLOCKED |
| C3-050 | Multi Chart | Refresh the group | UNIQUE |  | VERIFIED | BLOCKED |
| C3-051 | Multi Chart | Exit Groups | UNIQUE |  | VERIFIED | BLOCKED |
| C3-052 | Multi Chart | Apply a saved grid | UNIQUE |  | VERIFIED | BLOCKED |
| C3-053 | Multi Chart | Save a grid | UNIQUE |  | VERIFIED | BLOCKED |
| C3-054 | Multi Chart | Save a grid as global (admin) | VALID |  | VERIFIED | BLOCKED |
| C3-055 | Multi Chart | Delete a saved grid | UNIQUE |  | VERIFIED | BLOCKED |
| C3-056 | Multi Chart | Set a cell's timeframe | UNIQUE |  | VERIFIED | BLOCKED |
| C3-057 | Multi Chart | Set a cell's chart style | UNIQUE |  | VERIFIED | BLOCKED |
| C3-058 | Multi Chart | Toggle a cell's session | UNIQUE |  | ROUTED / BROWSER FAILED | BLOCKED |
| C3-059 | Multi Chart | Reset a cell to my chart | UNIQUE |  | VERIFIED | BLOCKED |
| C3-060 | Multi Chart | Maximize or restore a cell | UNIQUE |  | VERIFIED | BLOCKED |
| C3-061 | Multi Chart | Open shared grid settings | UNIQUE |  | VERIFIED | BLOCKED |
| C3-062 | Multi Chart | Set an alert from a cell | UNIQUE |  | VERIFIED | BLOCKED |
| C3-063 | Watchlist | Open a list in a widget (own) | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-064 | Watchlist | Open a prebuilt or community list | UNIQUE |  | VERIFIED | MISSING |
| C3-065 | Watchlist | Open the Flagged list | UNIQUE |  | VERIFIED | MISSING |
| C3-066 | Watchlist | Open a colour-tag list | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-067 | Watchlist | Go back to the list picker | UNIQUE |  | VERIFIED | MISSING |
| C3-068 | Watchlist | Click a row to load the symbol | UNIQUE |  | VERIFIED | VERIFIED |
| C3-069 | Watchlist | Walk the list with arrow keys or space | UNIQUE |  | VERIFIED | VERIFIED |
| C3-070 | Watchlist | Create a list | UNIQUE |  | VERIFIED | VERIFIED |
| C3-071 | Watchlist | Create a list from a template | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-072 | Watchlist | Save a community list to My Lists | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-073 | Watchlist | Rename a list | NOT ON DESKTOP |  | NO ASSIGNED WALKTHROUGH | NOT ON /CHARTS |
| C3-074 | Watchlist | Rename the Flagged list | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C3-075 | Watchlist | Delete a list | UNIQUE |  | VERIFIED | VERIFIED |
| C3-076 | Watchlist | Add a symbol | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C3-077 | Watchlist | Add to Flagged | UNIQUE |  | VERIFIED | VERIFIED |
| C3-078 | Watchlist | Flag or unflag a row (star) | UNIQUE |  | VERIFIED | VERIFIED |
| C3-079 | Watchlist | Remove a symbol | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C3-080 | Watchlist | Remove all starred symbols from a list | NOT IN PRODUCT *(was UNIQUE)* |  | NO ASSIGNED WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C3-081 | Watchlist | Reorder symbols by hand | NOT ON DESKTOP |  | NO WALKTHROUGH | NOT ON /CHARTS |
| C3-082 | Watchlist | Sort by a column | UNIQUE |  | VERIFIED | VERIFIED |
| C3-083 | Watchlist | Show or hide a column | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C3-084 | Watchlist | Apply a column preset | NOT ON DESKTOP |  | NO WALKTHROUGH | NOT ON /CHARTS |
| C3-085 | Watchlist | Reorder columns by drag | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C3-086 | Watchlist | Resize a column | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-087 | Watchlist | Reset columns | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C3-088 | Watchlist | Write or edit a ticker note | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C3-089 | Watchlist | Expand or collapse a list | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C3-090 | Watchlist | Tag a symbol with a colour | NOT ON DESKTOP |  | NO ASSIGNED WALKTHROUGH | NOT ON /CHARTS |
| C3-091 | Watchlist | Share a tag colour or Flagged | UNIQUE |  | NO ASSIGNED WALKTHROUGH | BLOCKED |
| C3-092 | Watchlist | Make a list public | UNIQUE |  | NO ASSIGNED WALKTHROUGH | BLOCKED |
| C3-093 | Watchlist | Mark a list prebuilt (admin) | VALID |  | NO ASSIGNED WALKTHROUGH | BLOCKED |
| C3-094 | Watchlist | Copy a list to the clipboard | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-095 | Watchlist | Export a list as CSV or Excel | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-096 | Watchlist | Import tickers | UNIQUE |  | NO ASSIGNED WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C3-097 | Watchlist | View or restore list version history | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C3-098 | Watchlist | Set a price alert from a row | UNIQUE |  | VERIFIED | VERIFIED |
| C3-099 | Watchlist | Delete an alert from the row popover | UNIQUE |  | VERIFIED | VERIFIED |
| C3-100 | Watchlist | Open Full Research or AI from a row | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-101 | Watchlist | Compare from a row | UNIQUE |  | VERIFIED | VERIFIED |
| C3-102 | Watchlist | Open a row's attention facts | UNIQUE |  | NO ASSIGNED WALKTHROUGH | UNMAPPED |
| C3-103 | Watchlist | Change list appearance (canvas, text, tint) | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-104 | Watchlist | Save or load a watchlist look | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-105 | Watchlist | Track or freeze a linked scan or theme | UNIQUE |  | NO ASSIGNED WALKTHROUGH | BLOCKED |
| C3-106 | Watchlist | Use a saved screen as a list | UNIQUE |  | NO WALKTHROUGH | BLOCKED |
| C3-107 | Scanner | Pick a preset scan | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-108 | Scanner | Leave a scan, back to the picker | UNIQUE |  | VERIFIED | MISSING |
| C3-109 | Scanner | Search the preset list | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-110 | Scanner | Read a scan's conditions | VALID |  | VERIFIED | MISSING |
| C3-111 | Scanner | Read a scan's results | VALID |  | VERIFIED | VERIFIED |
| C3-112 | Scanner | Refresh a scan | UNIQUE |  | VERIFIED | MISSING |
| C3-113 | Scanner | Sort a scan | UNIQUE |  | VERIFIED | VERIFIED |
| C3-114 | Scanner | Change scan columns | UNIQUE |  | VERIFIED | VERIFIED |
| C3-115 | Scanner | Create a scanner in the workspace | VALID |  | NO WALKTHROUGH | BLOCKED |
| C3-116 | Scanner | Modify a preset scan's conditions | VALID |  | NO ASSIGNED WALKTHROUGH | BLOCKED |
| C3-117 | Scanner | Open an AI Search scan in the builder and edit conditions | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-118 | Scanner | Run or refine a screen from the workspace chat | VALID |  | NO WALKTHROUGH | VERIFIED |
| C3-119 | Scanner | Save a screen run from the workspace | VALID |  | NO ASSIGNED WALKTHROUGH | VERIFIED |
| C3-120 | Scanner | Send a scan to Journal | UNIQUE |  | ROUTED / BROWSER FAILED | MISSING |
| C3-121 | Volume Surge | Choose what the scanner watches | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-122 | Volume Surge | Create, rename or delete a scope list | UNIQUE |  | ROUTED / BROWSER FAILED | MISSING |
| C3-123 | Volume Surge | Add a ticker to a scope list | UNIQUE |  | VERIFIED | MISSING |
| C3-124 | Volume Surge | Set thresholds (RVOL, burst, move, $ floor) | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-125 | Volume Surge | Toggle logos | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-126 | Volume Surge | Click a row or remove it from the list | UNIQUE |  | NO ASSIGNED WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C3-127 | Alerts | See my alerts | VALID |  | VERIFIED | VERIFIED |
| C3-128 | Alerts | Create a price alert | UNIQUE |  | VERIFIED | VERIFIED |
| C3-129 | Alerts | Delete an alert | UNIQUE |  | VERIFIED | VERIFIED |
| C3-130 | Alerts | Click an alert to load the symbol | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C3-131 | Alerts | Change Alerts widget appearance | UNIQUE |  | VERIFIED | MISSING |
| C3-132 | Alerts | Send alerts to Journal | UNIQUE |  | VERIFIED | MISSING |
| C3-133 | News | Filter catalysts up, down or all | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-134 | News | Read stored headlines for a symbol | VALID |  | VERIFIED | VERIFIED |
| C3-135 | News | Place a headline on the chart | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-136 | News | Change News widget appearance | UNIQUE |  | ROUTED / BROWSER FAILED | MISSING |
| C3-137 | News | Send the feed to Journal | UNIQUE |  | VERIFIED | MISSING |
| C3-138 | TE News | Search headlines | UNIQUE |  | VERIFIED | MISSING |
| C3-139 | TE News | Filter by category, linked symbol or watchlist | UNIQUE |  | VERIFIED | MISSING |
| C3-140 | TE News | Apply, rename or delete a filter preset | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C3-141 | TE News | Save or unsave a headline | UNIQUE |  | VERIFIED | MISSING |
| C3-142 | TE News | Add or edit a headline note | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-143 | TE News | Manage collections | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-144 | TE News | Add a headline's ticker to a watchlist | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-145 | TE News | Explain a headline or ask about it | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-146 | TE News | Jump to live or browse a past day | UNIQUE |  | ROUTED / BROWSER FAILED | MISSING |
| C3-147 | TE News | Send a headline to Notebook | UNIQUE |  | VERIFIED | MISSING |
| C3-148 | Calendar | Step days in the widget | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-149 | Calendar | Ask who reports on a day from Charts | VALID |  | VERIFIED | MISSING |
| C3-150 | Calendar | Ask when a stock reports from Charts | VALID |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-151 | Calendar | Filter economic events by stars | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-152 | Calendar | Toggle the TBD section | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C3-153 | Calendar | Sort earnings columns | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C3-154 | Calendar | Show all earnings in a section | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-155 | Calendar | Click an earnings row | UNIQUE |  | VERIFIED | VERIFIED |
| C3-156 | Calendar | Send a day to Journal | UNIQUE |  | VERIFIED | MISSING |
| C3-157 | Breadth | Read breadth tiles | VALID |  | VERIFIED | VERIFIED |
| C3-158 | Breadth | Add or remove a reading | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-159 | Breadth | Switch heatmap and ratio view | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C3-160 | Breadth | Change tile style | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-161 | Breadth | Change palette, intensity or background | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-162 | Breadth | Drill into a reading | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-163 | Breadth | Send a snapshot to Journal | UNIQUE |  | VERIFIED | MISSING |
| C3-164 | Options Flow | Switch market or symbol scope | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-165 | Options Flow | Switch the lead view | UNIQUE |  | ASSIGNED / NOT REACHED | IMPLEMENTED / UNVERIFIED |
| C3-166 | Options Flow | Set filters (premium, call/put, type, direction) | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-167 | Options Flow | Read the flow | VALID |  | VERIFIED | MISSING |
| C3-168 | Options Flow | Click a flow row | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C3-169 | Themes | Pick a period or ranking | UNIQUE |  | VERIFIED | MISSING |
| C3-170 | Themes | Flip sort direction | UNIQUE |  | VERIFIED | MISSING |
| C3-171 | Themes | Switch today basis | UNIQUE |  | VERIFIED | MISSING |
| C3-172 | Themes | Open a theme or pick a holding | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-173 | Themes | Search themes or tickers | UNIQUE |  | VERIFIED | MISSING |
| C3-174 | Themes | Pick, rename or delete a theme set | UNIQUE |  | VERIFIED | MISSING |
| C3-175 | Themes | Edit a set (add, hide, reset, custom theme) | UNIQUE |  | VERIFIED | MISSING |
| C3-176 | Themes | Add or remove a stock in a theme | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-177 | Themes | Send the ranking to Journal | UNIQUE |  | VERIFIED | MISSING |
| C3-178 | Fundamentals | Switch view | UNIQUE |  | ASSIGNED / NOT REACHED | VERIFIED |
| C3-179 | Fundamentals | Read the numbers | VALID |  | ASSIGNED / NOT REACHED | VERIFIED |
| C3-180 | Fundamentals | Change appearance or send to Journal | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-181 | Profile | Read profile and earnings table | VALID |  | VERIFIED | VERIFIED |
| C3-182 | Profile | Click a peer ticker | UNIQUE |  | NO ASSIGNED WALKTHROUGH | VERIFIED |
| C3-183 | Indexes | Hide or restore an index | UNIQUE |  | ROUTED / BROWSER FAILED | MISSING |
| C3-184 | Indexes | Send levels to Journal | UNIQUE |  | ROUTED / BROWSER FAILED | MISSING |
| C3-185 | Market Context | Read market context | VALID |  | NO WALKTHROUGH | UNMAPPED |
| C3-186 | Market Context | Send to Journal | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-187 | NH/NL | Add or remove a universe | UNIQUE |  | VERIFIED | MISSING |
| C3-188 | NH/NL | Switch universe tab | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-189 | NH/NL | Expand a row or pick a symbol | UNIQUE |  | NO ASSIGNED WALKTHROUGH | VERIFIED |
| C3-190 | NH/NL | Toggle logos, font, background | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-191 | H/L Pulse | Change Pulse settings | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-192 | Market Map | Pick or remove a universe | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-193 | Market Map | Pick X, Y or size axis | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-194 | Market Map | Follow the linked list | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-195 | Market Map | Cycle labels or zoom | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-196 | AI Search | Ask a question or follow one up | UNIQUE |  | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-197 | AI Search | Change ask mode, stop or retry | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C3-198 | AI Search | Save, reopen or remove an answer | UNIQUE |  | ROUTED / BROWSER FAILED | MISSING |
| C3-199 | AI Search | Copy or speak an answer | UNIQUE |  | ROUTED / BROWSER FAILED | MISSING |
| C3-200 | AI Search | Send the conversation to Journal | UNIQUE |  | ROUTED / BROWSER FAILED | MISSING |
| C3-201 | Notebook | Open or search a note | UNIQUE |  | VERIFIED | MISSING |
| C3-202 | Notebook | Create a note | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-203 | Notebook | Edit a note's title or body | UNIQUE |  | ROUTED / BROWSER FAILED | BLOCKED |
| C3-204 | Notebook | Browse folders | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C3-205 | Period Sort | Start a custom-period sort | UNIQUE |  | VERIFIED | MISSING |
| C3-206 | Period Sort | Choose grouping, replay and start mark | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-207 | Period Sort | Dock the panel or add it as a tab | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-208 | Period Sort | Refresh results | UNIQUE |  | NO WALKTHROUGH | MISSING |
| C3-209 | Replay | Start replay at a date | DUPLICATE | C1-042 | VERIFIED | VERIFIED |
| C3-210 | Replay | Exit replay | DUPLICATE | C1-045 | ROUTED / BROWSER FAILED | VERIFIED |
| C3-211 | Replay | Pick the cutoff by clicking the chart | DUPLICATE | C1-044 | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-212 | Replay | Set replay timeframe | DUPLICATE | C1-043 | VERIFIED | IMPLEMENTED / UNVERIFIED |
| C3-213 | Review | Start Review Charts from a results list | NOT ON DESKTOP |  | NO WALKTHROUGH | NOT ON /CHARTS |
| C3-214 | Review | Step next or previous in a review (mobile only at this commit) | NOT ON DESKTOP |  | NO ASSIGNED WALKTHROUGH | NOT ON /CHARTS |
| C3-215 | Review | Open the review feed card (mobile only) | NOT ON DESKTOP |  | NO WALKTHROUGH | NOT ON /CHARTS |
| C3-216 | Company dock | Switch dock tab | UNIQUE |  | ASSIGNED / NOT REACHED | MISSING |
| C3-217 | Company dock | Open or collapse the dock | UNIQUE |  | VERIFIED | MISSING |
| C3-218 | Company dock | Search company info | UNIQUE |  | NO WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C3-219 | Company dock | Open ETF holdings | UNIQUE |  | ROUTED / BROWSER FAILED | MISSING |
| C3-220 | Company dock | Pick a leveraged or inverse ETF | UNIQUE |  | NO WALKTHROUGH | IMPLEMENTED / UNVERIFIED |
| C3-221 | Workspace | Open the Agent | UNIQUE |  | NO WALKTHROUGH | BLOCKED |
| C3-222 | Workspace | Change a widget's UCT theme section | UNIQUE |  | NO ASSIGNED WALKTHROUGH | MISSING |
| C3-223 | Workspace | Capture the hovered chart to the Journal inbox (Ctrl+Alt+J) *(corrected 2026-11-10; was: Toggle the journal shortcut (Ctrl+Alt+J))* | UNIQUE |  | NO WALKTHROUGH | UNMAPPED |

## Notes

- The NOT ON DESKTOP /CHARTS rows are exactly the execution status's 19.
- Judgement calls (kept UNIQUE where the control or widget differs even if the writer is shared): the flag toggle in the watchlist vs the chart (C3-077, C3-078, C1-005); compare from a watchlist row vs the chart (C3-101, C1-034); price alert from a row, the alerts widget and the chart (C3-098, C3-128, C1-114); the two directions of one chip toggle (C2-018, C2-019); C1-031 (a whole-year jump) apart from C1-030; the eraser (C1-145) apart from Delete selected (C1-146).
- READ-ONLY TEACHING is reported on its own and never added to the canonical operation count; the 499 benchmark and its history are unchanged.
