# Notebook P4a: Page Layouts for Today and the Trade Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A member can choose which panels Today and the trade page show, and in what order, from a list with toggles and Move up / Move down. Today keeps a separate layout for premarket, market and after close. Five new Today panels are available: checklist for today, my rules, regime card, today's note, notices. The layout is saved as a preference that falls back to today's layout. All of it is dark behind `JOURNAL_PAGE_LAYOUTS_ENABLED`.

**Architecture:**
- **A registry of panels, metadata only.** `J/lib/pageLayouts.js` declares the panels for each page as `{id, label, defaultShown}`, plus `DEFAULT_LAYOUT`, `normalizeLayout`, `resolvePanels`, `movePanel` and `togglePanel`. It holds no components; each page binds ids to its own render functions, which is the `widgets/registry.js` idiom (`app/src/widgets/registry.js:17-19`).
- **One preference key.** `journal_page_layout` stores one JSON blob, `{version: 1, today: {premarket: [...], market: [...], postclose: [...]}, trade: [...]}`. Each list holds `{id, shown}` entries. It is written by read-modify-write (`setPrefMerged`, `app/src/hooks/usePreferences.js:332`), because `POST /api/auth/preferences` replaces the whole value. A missing or broken blob reads as `DEFAULT_LAYOUT`, which is today's layout exactly. Unknown ids are kept, so a newer client's panel survives an older client's save.
- **The gates stay outside the registry.** Today's loading skeleton, the first-edge-report takeover, zero data, the scope note and the lead are not panels. They render exactly as now, before the panel list (`TodaySurface.jsx:110-178`). The panels are what follows the lead. On the trade page the top bar and the identity header stay fixed, and the sections after them become panels.
- **New panels default to hidden.** `DEFAULT_LAYOUT` shows exactly today's panels in today's order. With the switch off, or with the switch on and no saved layout, the DOM order is unchanged. Railed in Tasks 5 and 6.
- **Bytes.** Today (`App.jsx:123`) and the trade page (`App.jsx:146`) are lazy routes outside the first-open closure. The only first-open addition is one `FLAG_FALLBACKS` row. The editor is a lazy leaf.

**Tech Stack:** React + Vite, vitest + Testing Library, FastAPI (`_PREFERENCE_KEYS`), pytest, Python Playwright.

**Spec:** `docs/superpowers/specs/2026-10-11-notebook-journal-styles-design.md`:
- §P4 (lines 333-341)
- §1, Today's fixed panels (line 64)
- §6 (361-378)

**Code map:** `C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\61625d99-f8db-4269-a728-231c08d3da11\scratchpad\p4-code-map.md`.

**Model plan:** `docs/superpowers/plans/2026-10-17-notebook-p3a-style-library.md`, for shape and Global Constraints.

**Base:** `origin/master` when Task 1 runs. Integration worktree `C:\Users\Patrick\uct-worktrees\notebook-p4a`, branch `notebook-p4a-layouts`, with a `.uct-session-owner` file.

P4a runs **in parallel with P3a**. The two branches share only the flag plumbing files (`auth.py` `NOTEBOOK_FLAGS`, `notebookFlags.js` `FLAG_FALLBACKS`, `tests/test_notebook_flags.py`, `docs/feature_flags.json`). Each adds one row, so the merge is resolved by keeping both rows. Whichever lands second merges master first and re-measures bytes.

Every `file:line` below was read on `b7aff58874`. Task 1 re-reads them.

## Rulings (each also in the ledger and the PR body)

- **R-P4-1: the trade page is `TradeDetailPage.jsx`.**
  - Ruling: "the trade page" is `J/components/trade/TradeDetailPage.jsx` (`/journal-2-0/trade/:id`, `App.jsx:745`). `TradeDrawer`, `PositionDetailPage`, `DayDetailPage` and the trade canvas are out of scope.
  - Why: P0.16's plan-grade placement lives there (`TradeDetailPage.jsx:627`), and it is the routed "unified closed-trade detail page".
  - Cost if wrong: another page gets the same registry later.
- **R-P4-2: today's prep note is a link to today's daily note.**
  - Ruling: the "today's prep note" panel is a card titled "Today's note" with a button "Open today's note", which calls `openDailyNote` (`J/lib/dailyNote.js:22`). It fetches nothing on mount.
  - Why: the daily note is the member's prep surface (Ctrl+Alt+D). The prep-pack blocks live inside a note and need a note's `setParams`.
  - Cost if wrong: a richer preview later.
- **R-P4-3: new panels are hidden by default.**
  - Ruling: the five new panels are `defaultShown: false`, so `DEFAULT_LAYOUT` equals today's layout.
  - Why: the spec says "read-fallback to today's layout", and a dark-to-armed flip must change nothing for a member who never opens Customize.
  - Cost if wrong: a member has to switch on what they want.
- **R-P4-4: the lead and the gates are not panels.**
  - Ruling: the loading skeleton, the first-edge report, zero data, the scope note and the lead stay fixed, above the panels. Zero data still suppresses the secondary panels, as `TodaySurface.jsx:188` does today.
  - Why: they are a state machine, not content. Hiding the lead would leave Today without its point.
  - Cost if wrong: a member who wants the lead lower cannot move it.
- **R-P4-5: trade-page panels are the sections after the identity header.**
  - Ruling: `linkedNotes`, `entryContext`, `planGrade`, `outcome`, `chart`, `beforeAfter`, `story`, `executions`, `review` become panels. The story section stays ONE panel with its five controls inside.
  - Why: those controls share local state and one `<section>` (`TradeDetailPage.jsx:806-889`). Splitting them would be a refactor of the trade page, not a layout feature.
  - Cost if wrong: a member cannot reorder inside the story.
- **R-P4-6: the flag name.**
  - Ruling: the spec's name `JOURNAL_PAGE_LAYOUTS_ENABLED` is kept and registered in `NOTEBOOK_FLAGS` beside its neighbours. The payload key is `journal_page_layouts_enabled`.
  - Why: the spec names it. The table derives the key by `env.lower()` (`auth.py:295-301`).
  - Cost if wrong: one rename. Task 1 V3 checks whether any rail requires the `NOTEBOOK_` prefix. If one does, the controller rules before Task 2.
- **R-P4-7: the server checks the blob's shape, not its ids.**
  - Ruling: `journal_page_layout` gets a named validator in `auth.py`. It must be a JSON object with `version == 1`, at most 16 KB, lists of at most 40 `{id: str ≤40, shown: bool}`. Panel ids are not checked on the server.
  - Why: panel ids are a client fact. A server copy would be a second authority and a ONE-FACT pair with no gain, and unknown ids must survive for a newer client.
  - Cost if wrong: a garbage id is stored and ignored at render.
- **R-P4-8: sharing a layout through the library is P4b.**
  - Ruling: "Shareable through P3 as `page_layout`" waits until P3a has landed, as P4b.
  - Why: the `page_layout` item type extends P3a's `ITEM_TYPES`, and P3a is in build.
  - Cost if wrong: none; P4a is complete without it.
- **R-P4-9: the checklist and my rules need an account.**
  - Ruling: on All Accounts these two panels render one muted line, "Pick an account to see its rules.", instead of their content.
  - Why: the rules and the day's checklist belong to one account (code map gap 7).
  - Cost if wrong: none found.

## Global Constraints

P3a's Global Constraints apply (`docs/superpowers/plans/2026-10-17-notebook-p3a-style-library.md`, "Global Constraints"), with these values:

- **Worktree:** `$WT = C:\Users\Patrick\uct-worktrees\notebook-p4a`.
- **No note writes.** A panel never writes a note. The checklist panel saves through the day-notes door it already uses (`useJ2DayNotesMutation`). My rules is read-only (`editable={false}`).
- **No new key listener.** The editor's keys are its buttons.
- **Bytes.** The first-open closure grows by at most **+120 B** over the base measured in Task 1. That covers the one `FLAG_FALLBACKS` row and nothing else.
- **Commits.** Same procedure and trailers as P3a.

## Review Focus

1. **A member who never opens Customize.**
   - Expected: Today and the trade page render in exactly today's DOM order, switch on or off.
   - Pinned in Task 5, `test_default_layout_renders_todays_order`, and Task 6, `test_default_trade_layout_renders_todays_order`.
2. **A saved layout from a newer client** carrying an unknown panel id.
   - Expected: the id is kept on the next save and not rendered.
   - Pinned in Task 3, `keeps unknown ids through a toggle and a move`.
3. **A corrupt or oversized preference.**
   - Client: reads as `DEFAULT_LAYOUT` and never throws.
   - Server: refuses a blob over 16 KB or the wrong shape with 400.
   - Pinned in Task 3 (`normalizeLayout` cases) and Task 3's pytest.
4. **The phase changing while Today is open** (premarket to market at 9:30).
   - Expected: the panel list switches to the market layout on the next render of `useTodayState`. Nothing is saved.
   - Pinned in Task 5, `switches layouts when the session phase changes`.
5. **Zero data with a custom layout.**
   - Expected: secondary panels stay suppressed, as now.
   - Pinned in Task 5, `zero data suppresses every panel whatever the layout`.
6. **A failed save.**
   - Expected: the editor says "Couldn't save your layout. Nothing was changed." and the page keeps the previous layout.
   - Pinned in Task 7.

---

## File map

`J` = `app/src/pages/journal-2-0`.

| File | Responsibility | Tasks |
|---|---|---|
| `docs/notebook/p4a-verify-before-building.md`, evidence | citations re-read, bytes measured | 1 |
| `api/routers/auth.py`, `J/lib/offline/notebookFlags.js`, `J/lib/pageLayoutsFlag.js` (new) + test, `tests/test_notebook_flags.py`, `tests/test_notebook_flag_parse.py`, `docs/feature_flags.json`, `tools/notebook_contract_fixtures.py` | the switch | 2 |
| `J/lib/pageLayouts.js` (new) + test, `api/routers/auth.py` (`_PREFERENCE_KEYS`, validator), `tests/test_page_layout_preference.py` (new) | the model and the preference | 3 |
| `J/surfaces/today/panels/` (new: `ChecklistTodayPanel.jsx`, `MyRulesPanel.jsx`, `RegimePanel.jsx`, `TodayNotePanel.jsx`, `NoticesPanel.jsx`, `panels.module.css`) + tests | the five new panels | 4 |
| `J/surfaces/TodaySurface.jsx`, `J/surfaces/TodaySurface.layout.test.jsx` (new) | Today renders by layout | 5 |
| `J/components/trade/TradeDetailPage.jsx`, `J/components/trade/TradeDetailPage.layout.test.jsx` (new) | the trade page renders by layout | 6 |
| `J/components/layout/PageLayoutEditor.jsx` (new) + CSS + test, the Customize buttons in both pages | the editor | 7 |
| `J/a11y/notebookSurfaces.js` (or the Journal a11y population V9 names), `J/a11y/pageLayouts.a11y.test.jsx`, `tools/journal_page_layout_walk.py` (new), evidence | a11y, walk, bytes | 8 |
| `docs/notebook/p4a-arming.md`, PR | gate, review, PR, arming | 9 |

---

### Task 1: Verify before building

**Files:** Create `docs/notebook/p4a-verify-before-building.md` and `docs/notebook/evidence/p4a-verify-<run-id>/`.

- [ ] **Step 1: Make the worktree.** Use the same commands as P3a Task 1 Step 1, with path `notebook-p4a`, branch `notebook-p4a-layouts` and base `origin/master`, then the owner file and the 377-count junction.
- [ ] **Step 2: Record the base reds.** Run these vitest files:
  - `J/surfaces/TodaySurface*.test.jsx`
  - `J/components/trade/TradeDetailPage*.test.jsx`
  - `J/components/notebook/NoticesBox.test.jsx`
  - `J/components/calendar/DayRulesChecklist*.test.jsx`
  - `app/src/hooks/usePreferences*.test.js`
  - `app/src/styles/tapFloor.test.js`
  - `app/src/components/screener/reachable.test.js`
  - `app/src/pages/command/keyListenerCensus.test.js`

  And these pytest files: `tests/test_preference_key_validation.py tests/test_notebook_flags.py tests/test_notebook_flag_parse.py tests/test_feature_flag_ledger.py`.

  Use the real file names the globs find. Run each in its own call, in the form `cmd > log 2>&1; code=$?; tail; exit $code`.
- [ ] **Step 3: Answer V1-V10 with a quoted line each.**

  | V | Question | Where |
  |---|---|---|
  | V1 | Base SHA | git |
  | V2 | Today's render block and gates, unchanged since the map | `J/surfaces/TodaySurface.jsx:98-257` |
  | V3 | Does any rail require a `NOTEBOOK_` prefix for a `NOTEBOOK_FLAGS` row? | `tests/test_notebook_flags.py:176`, `tests/test_notebook_flag_parse.py` |
  | V4 | `_PREFERENCE_KEYS`, `_validate_preference` and a named-schema example (`joystick_hub` or `indicator_templates`), plus `test_every_key_the_client_writes_is_still_accepted` | `api/routers/auth.py:2807-2935`, `:3116`, `tests/test_preference_key_validation.py:228` |
  | V5 | `usePreferences` / `parsePref` / `setPrefMerged` signatures and return values | `app/src/hooks/usePreferences.js:28-32`, `:303`, `:332` |
  | V6 | `useJ2DayDetail(date, accountId, basis)` and `useJ2DayNotesMutation(date)` signatures, and what `DayRulesChecklist` needs from them (its `onSave` contract) | `J/hooks/`, `J/components/calendar/DayDetailPage.jsx:177` |
  | V7 | `MyRulesBlock({params, editable})` read-only behaviour, and the `ACCOUNT_LINES` "pick an account" path | `J/components/notebook/blocks/MyRulesBlock.jsx:39` |
  | V8 | Trade page section order, and the state each section reads | `J/components/trade/TradeDetailPage.jsx:567-962` |
  | V9 | Which a11y population covers Journal surfaces (Today / trade page), if any; else the Notebook one | `J/a11y/` |
  | V10 (**measured**) | First-open closure on the base after `npm run build` | `python tools/notebook_perf_budgets.py --dist app/dist` |

- [ ] **Step 4: Commit the doc and the raw output, then push.** Message: `docs(journal): P4a verify-before-building (V1-V10, bytes measured)`.

---

### Task 2: The `JOURNAL_PAGE_LAYOUTS_ENABLED` switch

Same file set and steps as P3a Task 2. Only the values change:
- env `JOURNAL_PAGE_LAYOUTS_ENABLED`; payload key `journal_page_layouts_enabled`;
- helper `J/lib/pageLayoutsFlag.js` exporting `PAGE_LAYOUTS_FLAG` and `pageLayoutsEnabled()`;
- ledger entry label "Journal page layouts", where "Journal".

The ledger note reads: "P4a. Gates the Customize button on Today and the trade page and reading a saved layout. Off: both pages render their fixed layout. Payload key journal_page_layouts_enabled. Arm: railway variables --service web --set JOURNAL_PAGE_LAYOUTS_ENABLED=1 (the owner's). Rollback: 0; saved layouts stay stored and unread."

The client test mirrors P3a Task 2 Step 1, with `pageLayoutsEnabled`. Commit message: `feat(journal): JOURNAL_PAGE_LAYOUTS_ENABLED switch, dark (P4a)`.

---

### Task 3: The layout model and the preference

**Files:**
- Create: `J/lib/pageLayouts.js`, `J/lib/pageLayouts.test.js`, `tests/test_page_layout_preference.py`
- Modify: `api/routers/auth.py`

**Interfaces (produces):**
```js
export const LAYOUT_PREF = 'journal_page_layout'
export const PHASES = Object.freeze(['premarket', 'market', 'postclose'])
export const PHASE_LABELS = Object.freeze({ premarket: 'Premarket', market: 'Market', postclose: 'After close' })
export const PANELS = Object.freeze({
  today: Object.freeze([
    { id: 'coachStrip', label: 'Coach notes', defaultShown: true },
    { id: 'weekStrip', label: 'This week', defaultShown: true },
    { id: 'goalProgress', label: 'Goal progress', defaultShown: true },
    { id: 'quickActions', label: 'Quick actions', defaultShown: true },
    { id: 'checklistToday', label: 'Checklist for today', defaultShown: false },
    { id: 'myRules', label: 'My rules', defaultShown: false },
    { id: 'regime', label: 'Market regime', defaultShown: false },
    { id: 'todayNote', label: "Today's note", defaultShown: false },
    { id: 'notices', label: 'Notices', defaultShown: false },
  ]),
  trade: Object.freeze([
    { id: 'linkedNotes', label: 'Linked notes', defaultShown: true },
    { id: 'entryContext', label: 'Market at entry', defaultShown: true },
    { id: 'planGrade', label: 'Plan vs execution', defaultShown: true },
    { id: 'outcome', label: 'Outcome', defaultShown: true },
    { id: 'chart', label: 'Chart', defaultShown: true },
    { id: 'beforeAfter', label: 'Before and after', defaultShown: true },
    { id: 'story', label: 'The story', defaultShown: true },
    { id: 'executions', label: 'Executions', defaultShown: true },
    { id: 'review', label: 'Compass review', defaultShown: true },
  ]),
})
export const DEFAULT_LAYOUT  // built from PANELS: {version:1, today:{premarket,market,postclose}, trade}
export function normalizeLayout(raw)            // never throws; returns a full layout
export function resolvePanels(layout, page, phase) // -> [{id, shown, label}] in order, registry ids only
export function movePanel(layout, page, phase, id, dir)   // dir 'up' | 'down'; pure
export function togglePanel(layout, page, phase, id)      // pure
export function resetPage(layout, page, phase)            // pure; that page+phase back to default
```
For `trade`, `phase` is ignored and the list is `layout.trade`.

`normalizeLayout` does the following:
- Parse a string with try/catch. A non-object, a wrong `version`, or a missing list falls back to the default for that page and phase.
- Keep a saved entry only when it is `{id: string ≤40, shown: boolean}`.
- Append any registry id missing from a saved list at the END, with its `defaultShown`. A panel added by a later release then appears in the member's layout, hidden by default and at the bottom.
- Keep unknown ids in place.
- De-duplicate by first occurrence.

`resolvePanels` drops unknown ids. `movePanel` moves within the full list, unknown ids included, so a move never reorders the member's hidden future panels unexpectedly.

- [ ] **Step 1: Write the failing client tests** (`J/lib/pageLayouts.test.js`). Each case is a test:
  1. `DEFAULT_LAYOUT` shows exactly `coachStrip, weekStrip, goalProgress, quickActions` in that order for every phase, with the five new panels present and hidden.
  2. `normalizeLayout(null)`, `('not json')`, `({version: 2})` and `({version:1, today:'x'})` each equal `DEFAULT_LAYOUT`.
  3. A saved market list missing `notices` gets `notices` appended, hidden.
  4. **Keeps unknown ids through a toggle and a move:** a saved list with `{id:'futurePanel', shown:true}` keeps it after `togglePanel` of another id and after `movePanel`, and `resolvePanels` never returns it.
  5. `movePanel(..., 'up')` on the first panel and `'down'` on the last return an equal layout. They are not errors.
  6. The functions are pure: the input object is unchanged (deep-frozen fixture).
  7. A trade layout ignores `phase`.
- [ ] **Step 2: Write the failing server test** (`tests/test_page_layout_preference.py`). Use the client the existing preference tests use (V4):
  - posting `journal_page_layout` with a valid blob gives 200, and the value round-trips;
  - posting `"[]"`, `'{"version": 2}'`, a 17 KB blob, and a list of 41 entries each gives 400 with a plain sentence;
  - posting `{"version":1,"today":{"market":[{"id":"x","shown":"yes"}]}}` gives 400.
- [ ] **Step 3: Run both and see them fail.**
- [ ] **Step 4: Implement.**
  - `pageLayouts.js` follows the interfaces above, with no React import.
  - In `auth.py`, add `"journal_page_layout": _validate_page_layout` to `_PREFERENCE_KEYS`, in the named-schema form V4 recorded.
  - The validator parses the JSON and enforces the rules in R-P4-7. On failure it raises the same HTTPException shape the other schemas raise, with the sentence `That page layout could not be saved. Reset it and try again.`
  - Add `journal_page_layout` to whatever list `test_every_key_the_client_writes_is_still_accepted` needs. That rail derives client writers; the client write lands in Task 7, so if the rail requires the key to be written somewhere, it passes once Task 7 lands and stays green here.
- [ ] **Step 5: Run the tests**, including `tests/test_preference_key_validation.py`. Mutation-prove one case per side, restoring the file each time:
  - drop the append-missing-ids step, and test 3 fails;
  - drop the size cap, and the 17 KB case fails.
- [ ] **Step 6: Commit and push.** Message: `feat(journal): page layout model and the journal_page_layout preference (P4a)`.

---

### Task 4: The five new Today panels

**Files:** Create in `J/surfaces/today/panels/`:
- `ChecklistTodayPanel.jsx`
- `MyRulesPanel.jsx`
- `RegimePanel.jsx`
- `TodayNotePanel.jsx`
- `NoticesPanel.jsx`
- `panels.module.css`
- `panels.test.jsx`

**Interfaces:** each panel takes `{account, accountId}` where it needs them. Each renders inside a `TileCard`, with its `icon` prop and a plain-string `title` (the app's tile idiom).
- **`ChecklistTodayPanel`.**
  - Calls `useJ2DayDetail(todayET(), accountId, <basis V6>)` and `useJ2DayNotesMutation(todayET())`.
  - Renders `DayRulesChecklist` with the day's `notes/prepNotes/midDayNotes/recapNotes/attachments/rules` and its `onSave` contract, exactly as `DayDetailPage.jsx:177` passes them.
  - With no account (All Accounts), renders the muted line `Pick an account to see its rules.` (R-P4-9).
  - While loading: one muted line, `Loading today's checklist…`.
- **`MyRulesPanel`.**
  - Renders `MyRulesBlock` with `params={{which: 'active'}}` and `editable={false}`, imported lazily through `lazyLeaf(() => import('../../../components/notebook/blocks/MyRulesBlock'))` so its chunk is shared with the editor's.
  - Without an account, renders the R-P4-9 line.
- **`RegimePanel`.**
  - `useJ2CurrentRegime()`.
  - Shows `regimeWord(regime?.regime ?? regime?.label)` in the shape V6/V7 record from `GET /api/j2/regime`. Check the real field name and say which in the report.
  - Adds one line of the regime's own reason when the payload carries one.
  - When loading or on error: `Market regime is not available right now.` Never a guessed regime.
- **`TodayNotePanel`.**
  - One button, `Open today's note`. It calls `openDailyNote()` (`J/lib/dailyNote.js:22`), then navigates to the note the call returns, the way the existing shortcut does (V-step: read the shortcut's handler and reuse it; never a second copy).
  - On failure it shows `Couldn't open today's note. Try again.`
- **`NoticesPanel`.**
  - Renders `NoticesBox` through `lazyLeaf(() => import('../../../components/notebook/NoticesBox'))`. Research Home imports the same specifier, so the chunk is shared (`ResearchHome.jsx:62-63`).
  - NoticesBox renders null when empty. The panel then renders nothing at all, not an empty card.

- [ ] **Step 1: Write the failing tests** (`panels.test.jsx`). Mock fetch the way the existing Today tests do. Cover:
  1. The checklist renders today's rules from the day detail, and a tick calls the day-notes mutation with the rules list, not a note write.
  2. With no account, the checklist and My rules show exactly `Pick an account to see its rules.`.
  3. The regime shows the regime word from the payload, and `Market regime is not available right now.` on a 500.
  4. The note button calls `openDailyNote` once, and a rejected call shows the failure sentence.
  5. Notices with an empty list renders nothing.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.** Touch targets follow `min-height: var(--tap-min)` inside `@media (max-width: 1024px)`.
- [ ] **Step 4: Run the tests, plus `tapFloor`, `rawErrorSurface` and `keyListenerCensus`.**
- [ ] **Step 5: Commit and push.** Message: `feat(journal): five Today panels for page layouts - checklist, my rules, regime, today's note, notices (P4a)`.

---

### Task 5: Today renders by layout

**Files:** Modify `J/surfaces/TodaySurface.jsx`. Create `J/surfaces/TodaySurface.layout.test.jsx`.

**Change.** Replace the fixed block after `{lead}` (`TodaySurface.jsx:183-199`) with a list rendered from the layout.

```jsx
const layoutsOn = pageLayoutsEnabled()
const { prefs } = usePreferences()
const layout = layoutsOn ? normalizeLayout(prefs?.[LAYOUT_PREF]) : DEFAULT_LAYOUT
const panels = resolvePanels(layout, 'today', session).filter((p) => p.shown)
const render = {
  coachStrip: () => <CoachStrip key="coachStrip" accountId={accountId} />,
  weekStrip: () => !zeroData && <TodayWeekStrip key="weekStrip" />,
  goalProgress: () => !zeroData && account && <GoalProgress key="goalProgress" account={account} progress={overview?.goal_progress} />,
  quickActions: () => !zeroData && <TodayQuickActions key="quickActions" onLogTrade={openTrade} />,
  checklistToday: () => !zeroData && <ChecklistTodayPanel key="checklistToday" account={account} accountId={accountId} />,
  myRules: () => !zeroData && <MyRulesPanel key="myRules" account={account} accountId={accountId} />,
  regime: () => !zeroData && <RegimePanel key="regime" />,
  todayNote: () => !zeroData && <TodayNotePanel key="todayNote" />,
  notices: () => !zeroData && <NoticesPanel key="notices" />,
}
```

Then render `{panels.map((p) => render[p.id]?.())}`.

- `CoachStrip` keeps rendering on zero data, as it does today.
- `session` comes from `useTodayState()`, already in scope.
- With the switch off, `DEFAULT_LAYOUT` reproduces today's order exactly.
- Keep the existing comments next to the panels they describe.

- [ ] **Step 1: Write the failing tests.** Read `data-testid`s or headings in DOM order:
  1. **`test_default_layout_renders_todays_order`.** With the switch off, and then on with no saved pref, the order is CoachStrip, WeekStrip, GoalProgress, QuickActions, exactly as on the base. Take the base order from a render of the unmodified component captured in Step 2 of Task 1, written into the test as the expected list.
  2. With the switch on and a saved market layout `[regime shown, quickActions shown, weekStrip hidden, …]`, the market session renders Regime then QuickActions, and no WeekStrip.
  3. **Switches layouts when the session phase changes.** Mock `useTodayState` to return premarket, then market, and the list changes. Assert that no preference POST was made.
  4. **Zero data suppresses every panel whatever the layout,** except CoachStrip (as now).
  5. With the switch off, a saved layout is ignored.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the new tests plus every existing `TodaySurface*.test.jsx`.** Mutation proof: render the panels without the `shown` filter, and case 2 fails. Restore the file.
- [ ] **Step 5: Commit and push.** Message: `feat(journal): Today renders its panels from the page layout (P4a)`.

---

### Task 6: The trade page renders by layout

**Files:** Modify `J/components/trade/TradeDetailPage.jsx`. Create `J/components/trade/TradeDetailPage.layout.test.jsx`.

**Change.** Inside the component, after the identity header (`:591-615`), replace the fixed sequence of sections `:617-962` with a `render` map keyed by the R-P4-5 ids. Each entry returns exactly the JSX that is there now, moved verbatim, with its existing condition:
- `linkedNotes` keeps `trade.id != null`;
- `planGrade` keeps `planGradingEnabled()`;
- `beforeAfter` keeps the visual-playbook flag and `trade.id`;
- `review` keeps `isPaid`.

`patchError` (`:797`) is not a panel. It renders right after the identity header, so a save error is always seen.

Then render `resolvePanels(layout, 'trade').filter((p) => p.shown).map((p) => <Fragment key={p.id}>{render[p.id]?.()}</Fragment>)`.

The functions close over the component's existing state, so no state moves.

⛔ The move must be verbatim: diff each block before and after. A changed line inside a moved block is out of scope and is reported, not made.

- [ ] **Step 1: Write the failing tests:**
  1. `test_default_trade_layout_renders_todays_order`: with the switch off, and on with no pref, the section order equals the base order.
  2. A saved layout with `story` first and `chart` hidden renders the story before the outcome grid, and no chart card.
  3. A save error still renders below the header when every panel is hidden.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the new tests plus every existing `TradeDetailPage*.test.jsx`.** Then run `git diff -U0 --stat`, and confirm that the only lines removed are the ones moved.
- [ ] **Step 5: Commit and push.** Message: `feat(journal): the trade page renders its sections from the page layout (P4a)`.

---

### Task 7: The editor

**Files:**
- Create: `J/components/layout/PageLayoutEditor.jsx`, `PageLayoutEditor.module.css`, `PageLayoutEditor.test.jsx`
- Modify: `TodaySurface.jsx` and `TradeDetailPage.jsx` (a Customize button each)

**Interfaces:**
- `PageLayoutEditor({page: 'today'|'trade', initialPhase, onClose})`.
- It is opened through `lazyLeaf(() => import('../../components/layout/PageLayoutEditor'))`, from each page's Customize button.
- The button renders only when `pageLayoutsEnabled()`. Its label is `Customize`, with UIcon `settings` (check the registry for the name).
  - Today: the button sits in the surface's header area beside the scope note.
  - Trade page: it sits in the top bar (`:570-588`).
- The editor is a `Sheet` (`app/src/components/mobile/Sheet.jsx`), titled `Customize Today` or `Customize trade page`.
  - For Today, three phase tabs, `Premarket · Market · After close`. They are real buttons with `aria-pressed`, default to the current session.
  - The list of the page or phase's panels. Copy `StyleEditor.jsx`'s row: a checkbox `Show <label>`, `Move <label> up` / `Move <label> down` buttons (disabled at the ends), the polite live region announcing `<label> moved up` / `moved down`, and focus management after a move (`StyleEditor.jsx:~110-135`).
  - `Reset to default` (this page and phase only), `Save` and `Cancel`.
- **Save** calls `setPrefMerged(LAYOUT_PREF, (prev) => <prev normalized, with this page/phase replaced>)`.
  - On success: close, and show `Layout saved.` in the page's own toast host, which outlives the sheet.
  - On failure: stay open and say `Couldn't save your layout. Nothing was changed.`
  - The page keeps its previous layout until success.

- [ ] **Step 1: Write the failing tests.** Assert rendered text, not state:
  1. With the switch off, there is no Customize button on either page.
  2. Opening the editor on market shows the market list in layout order, with the checkbox state matching `shown`.
  3. `Move My rules up` moves it, announces `My rules moved up` in the live region, and keeps focus on the pressed button.
  4. Save posts `journal_page_layout` with only the market list changed. The premarket and postclose lists and any unknown ids are byte-equal to the input.
  5. A failed POST shows the failure sentence and the sheet stays open.
  6. Reset restores this phase's default and leaves other phases as they are.
  7. Every control has an accessible name, and tab order runs the tabs, then the rows, then the actions.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests plus `tapFloor`, `keyListenerCensus`, `reachable` and `tests/test_preference_key_validation.py`.**
- [ ] **Step 5: Commit and push.** Message: `feat(journal): Customize - choose and order the panels on Today and the trade page (P4a)`.

---

### Task 8: Accessibility, the walk, and bytes

- [ ] **Step 1: Accessibility.** Add the editor and the five panels to the a11y population V9 named, with recipes. Write `pageLayouts.a11y.test.jsx` running axe on the editor (each phase tab) and on Today with all five new panels shown. Run it with the coverage rail.
- [ ] **Step 2: The walk.** Write `tools/journal_page_layout_walk.py`. Copy the sandbox and paid-account shape of P3a's walk tool. Its header names the preconditions, with `JOURNAL_PAGE_LAYOUTS_ENABLED=1` in the sandbox env. The steps:
  1. Open Today and record the panel order.
  2. Open Customize, switch on Regime and My rules, move Regime to the top, and save.
  3. Reload. Regime renders first and My rules renders.
  4. Switch the phase tab to Premarket, and its list is still the default.
  5. Open a trade, hide Chart, and move The story first.
  6. Reload, and the order holds.
  7. Reset both.

  Run at 1280 / 820 / 390. Raw output goes under `docs/notebook/evidence/p4a-walk-<run-id>/` and is committed before the summary.
- [ ] **Step 3: Bytes.** Build, measure, and commit the raw output. The figure must be at or under V10 + 120 B.
- [ ] **Step 4: Commit and push.** Message: `test(journal): page layouts a11y, walk and bytes evidence (P4a)`.

---

### Task 9: Gate, review, PR, arming

Same steps as P3a Task 12:
- the gate in its own worktree, on a `notebook-*` branch, run only when no other gate is on the box;
- the final review;
- the arming packet `docs/notebook/p4a-arming.md`. Its checks after arming: the payload key is true; Customize renders; a layout saved as the smoke account; then reset through the product.
- merge master, carry-over, C4 rails and bytes on the landing tree;
- the PR, which the owner merges;
- after the merge, promote, then web SUCCESS, then the smoke.

---

## Self-review (done at write time)

1. **Spec coverage, P4 lines 335-341:**
   - Panel registries for Today and the trade page: Tasks 3, 5, 6.
   - The new panels (checklist for today, my rules, regime card, today's prep note, notices): Task 4.
   - Show/hide and reorder with toggles and up/down, not a grid: Task 7.
   - Phone is one column: Today is already one column; the editor is a `Sheet`.
   - Per session phase: Tasks 3, 5, 7. Today only; the trade page has no phases, ruling R-P4-5 / Task 3.
   - Saved as a page layout preference key with a read-fallback: Task 3.
   - Shareable through P3: P4b (R-P4-8).
   - Dark flag: Task 2.
2. **Placeholders.** None. Where a field name must be read from code, the step says which V-item answers it. Every such case is a fact the implementer reads, not a design left open.
3. **Names.** These are used identically in every task: `LAYOUT_PREF`, `PANELS`, `DEFAULT_LAYOUT`, `normalizeLayout`, `resolvePanels`, `movePanel`, `togglePanel`, `resetPage`, `pageLayoutsEnabled`, `PageLayoutEditor`.
4. **Review Focus.** Each line has its named test.
