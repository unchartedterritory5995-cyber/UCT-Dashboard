# Screener Focus Layout — design

**Date:** 2026-10-13 · **Status:** approved by owner in chat (design "A · refined"), spec awaiting review
**Branch:** `feat/screener-focus-layout` · **Mockups:** https://claude.ai/artifact/MtVijq63ATyrJAfB458LTy (page "A · refined", artboards A1–A4)
**Research behind it:** https://claude.ai/artifact/1vYVdUj6hCnqJ5w6ZHXgwh (20 screeners compared)

## 1. Why

The Screener is the deepest tool we have and the hardest to use. Measured on prod at 1568×698
(13 Oct): the first result row starts 51% of the way down the page, under 8 stacked bands: 30 equal-weight
preset chips, an 11-button toolbar, 4 save buttons, a coverage receipt line and a paragraph of
"already on your radar". The filter rail offers three different ways to write a filter. Members find it
intimidating; the owner calls it "noisy and messy".

The owner's statement of the job: **"a good list shows up, then run through the charts by just clicking down."**

## 2. Goal and success criteria

One screen that does that job and nothing else by default. Depth stays, one click away.

1. On load, a member sees a named screen, a list of stocks and the selected stock's chart. Nothing else
   competes for attention: one top bar, one list, one chart.
2. ↑/↓ (or a click) changes the chart with no visible wait for the six stocks above and below.
3. Every number or label on the default screen is true for that stock (see §6 "honesty rules").
4. Nothing the current page can do is lost: every control maps to a place in the new layout (§9).
5. Ships behind an owner-only flag; today's page and its tests are untouched until cutover.

## 3. Non-goals (this spec)

- Phone layout (own pass; the current `ResultCards` stays for phones).
- Terminal SCR panel and other embedded mounts (keep `ScannerShell` there).
- The Options tab (`OptionsScreener`) — untouched.
- A shaded base box / buy zone on the chart (needs base geometry the backend does not save).
- Changing what any filter computes, or the nightly snapshot build.

## 4. Layout (desktop, ≥1024 px)

```
┌ Top bar (60px) ─────────────────────────────────────────────────────────────────┐
│ [Power Plays 214 ▾] [≡ Filters 4]          ● Live · Oct 12 close ⓘ [List|Table] [Save ▾] [⋯] [?] │
├ List (340px) ───────────┬ Chart pane ──────────────────────────────────────────┤
│ Sort: RS rank ↓  1 of 214│ MU  Micron Technology · Semiconductors   956.12 −3.7% │
│ ● MU   Flat base · …  ▌  │ [Flat base · 3.2% below pivot 988]  Vol 0.8× · …  D|W │
│   ECO  Gap-up            │                                                       │
│   …                      │            StockChart (daily, pivot line)             │
│                          │                                                       │
│ ↑↓ move ⇧F flag W watch ↵│ WHY IT'S HERE ✓ RS rank ≥ 80 94 · ✓ … · ○ In UCT Univ │
│                          │                              [Flag] [Add to watchlist]│
└──────────────────────────┴───────────────────────────────────────────────────────┘
```

### 4.1 Top bar
| Element | Behaviour |
|---|---|
| **Screen menu** "Power Plays 214 ▾" | Opens the screen menu (§5). Shows the current screen's name and match count. An unsaved, edited screen reads "Power Plays (edited)". A screen with no name reads "Custom screen". |
| **Filters N** | Opens the filters drawer (§7). Badge = number of active filters, excluding the universe. |
| **Data status** "● Live · Oct 12 close ⓘ" | Snapshot date from `result.snapshot_date`; dot green when the live tier is on. ⓘ opens the data receipt (§8.3). |
| **List \| Table** | List = this layout (default). Table = today's results table (`VirtualResults` + column sets + charts grid), inside the same top bar. Choice persists in localStorage `uct.screener.layout`. |
| **Save ▾** | Save menu (§8.1). |
| **⋯** | More menu (§8.2). |
| **?** | Help menu (§8.2). |

### 4.2 List
- Header row: sort control (opens a menu of the sortable columns, default RS rank ↓) and position "1 of 214".
- Row (≈56 px): radar dot · ticker (15px bold) · setup line (12px muted) · price · change %.
- Selected row: tinted background + 3px gold inset bar; `role="listbox"` / `role="option"` + `aria-selected`.
- More rows load as the member nears the bottom (existing `s.loadMore` paging); no "Load more" button.
- Footer: key hints `↑↓ move · ⇧F flag · W watchlist · ↵ full chart`.

### 4.3 Chart pane
- One `StockChart`, `sym` swapped in place (no `key`), using the `ScreenerReviewOverlay` prop recipe:
  `tf="D" showDrawingTools={false} showSavedDrawings hideReplay hidePatterns hideCompare hideCountdown
  disablePatterns backgroundWarm={false} liveUpdates dailyDefaultBars={126} volumeSeparatePane
  volumePaneHeightPct={9}` plus `hotkeysActive` false while the list owns focus. D/W timeframe toggle.
- Header: ticker, company · industry, price, change (abs and %), setup tag, a short facts line
  (vol ×, ADR %, days to earnings — only facts present on the row).
- Pivot line via the `priceLines` prop, **phase 2 only** (§6).
- "Why it's here" strip + Flag + Add to watchlist (§6.3).
- Instant swap: `useNeighborWarm(orderedSymbols, selectedSym, 'D')` warms ±6 neighbours; keep the existing
  `prefetchBars` of the first 30 rows.

## 5. Screen menu (replaces PresetChips, UniverseBar and the ScreensManager dropdown)

- Search box at the top ("Search screens…").
- Sections, in order: **Pinned** · **Momentum leaders** · **Breakouts & entries** · **My screens** ·
  **More** (→ Bases & chart patterns; → My scans).
- Each item: pin toggle, name, one-line description, match count. The current screen is highlighted gold.
- Pinned replaces the `screener_favorite_screens` / `screener_preset_chips` prefs as one ordered list
  (migrate both on first load; keep read fallback).
- My screens rows: ⋯ with Rename, Share link, History, Delete (existing `ScreensManager` actions).
- My scans: "Use as filter" (existing `onUseScan`), overnight alert toggle, Edit — reuse `ScreensManager`'s My scans block.
- Footer: Save changes to "<name>" · Save as new… · Rename · + New screen (opens the drawer empty).
- **Counts:** phase 1 fetches counts when the menu opens, one `POST /api/screener/count` per visible item,
  capped at 12 concurrent, cached per spec for the session. Phase 2 replaces this with a batch endpoint.
- **Grouping and descriptions:** phase 1 groups by a client-side map from starter `id` to group, and shows
  no description where none exists. Phase 2 adds `group` and `description` to `saved_screens.starters()`.

## 6. Honesty rules for the list and chart

### 6.1 Setup line
- Phase 1: head of `base_render` only (`base_render.split(' (')[0]`, drop `+N`).
- **No pivot distance in phase 1.** `pattern_entry_dist_pct` comes from the pattern engine's best detection,
  which is not the detection that names `base_render`; showing them together can pair a base with a pivot
  that is not its own.
- Phase 2: backend stores the pivot price and its detection id with the base (§11); the row shows
  "· 3.2% below pivot" only when both come from the same detection; the chart draws the pivot line.
- `base_render` null (under 60 bars) → "Not enough history for a base".
- Last bar volume 0 (`vol_ratio === 0`) → setup line reads "No trades today", change shows "—", row at 70% opacity.

### 6.2 Radar dot
Gold dot when the member already follows the name (the existing member-interest data behind
`MemberInterestNotice`, flag `member_interest_screener_enabled`). Replaces the "Already on your radar" paragraph.
Flag off → no dot.

### 6.3 "Why it's here"
For each active filter, one item:
- **Checkable threshold** (`range`/`bool`/`enum` on one column, op `gte|lte|between|eq|in|not_in`): ✓ + label
  from `chipLabel()` + the row's value formatted by `COLUMN_DEFS`. The list requests these columns in
  `columns` so the value is on the row.
- **Pool** (`universe`, `list`): ○ "In UCT Universe" / "In <list name>".
- **Not checkable per row** (`scan`, `logic` with any/none/not, `rank`, `arith`, `*_col`, `base_structure`
  contains): one plain sentence, e.g. "In My Scan *Pocket pivots* as of Oct 12", "Ranked 12 of 214 by your
  weights", "Matches your custom criteria". Never a ✓.
- Max 5 items; overflow "+2 more" opens the drawer.

## 7. Filters drawer (replaces FilterRail-as-rail, CriteriaBox, FilterChips row)

Slides over the list from the left, 460 px, Esc/× closes, focus trapped.
1. Header: "Filters" + live match count (`useScreenerCount`).
2. **Describe a setup** input. Shown only when `/api/screener/compile` is available (paid + both NL flags).
   Result handling: a pure all-of tree of plain leaves becomes ordinary `filters` (pills). Anything else
   (any/none/not, `*_col`, `arith`) stays as `logic` and is shown as one pill "Custom criteria · Edit as code".
3. **Active**: universe pill first ("All stocks" when none; opens a small menu: All stocks / UCT Universe /
   a watchlist / combine lists), then one removable pill per filter (`chipLabel`), "Clear all".
4. **Find a filter… /** — existing FilterRail search, `/` focuses it.
5. Categories as collapsible sections with active-count pips (existing FilterRail data and localStorage keys).
   Each filter shows its presets as small buttons (Any · ≥70 · ≥80 · ≥90 · Custom) instead of a `<select>`;
   Custom reveals the existing min/max inputs. `security_type` keeps `TypeFilterControl`.
6. Footer: **Edit as code** (existing CriteriaBox grammar textarea, shown only when `SCREENER_LOGIC_ENABLED`)
   and **Show N stocks** (closes the drawer).
Filters apply live, as today.

## 8. Menus and states

### 8.1 Save ▾ — four outcomes
| Item | Existing mechanism | Shown when |
|---|---|---|
| Save as a screen | `useSavedScreens.create` | signed in, paid |
| Save today's list | `POST /api/screener/to-watchlist` (PromoteButton) — name asked inline, not `window.prompt` | `SCREENER_PROMOTE_ENABLED` |
| Alert me on new names | save-fork `standing_alert` (`spec_alerts`) | `SCREENER_SPEC_ALERTS_ENABLED` |
| Add to Notebook | `SaveToNotebookButton` / `buildScreenerCapture` | result loaded |
Unavailable items are omitted, never shown-then-failing. After any save, the screen menu refreshes.
The skip link "Skip to save results" targets the Save button.

### 8.2 ⋯ and ?
- ⋯: Export CSV · Export Excel (server export when `exportQuota()` answers, else client CSV, as today) ·
  Re-sort by live price (existing live-sort toggle) · Row density · Show company names.
- ?: How to use this screen (HowToChecklist content) · Methodology · Structure library · What each filter means ·
  Keyboard shortcuts. Methodology and Structure library open the existing Sheets.

### 8.3 Data receipt (ⓘ)
Snapshot date, live-tier note, and the coverage counts (`result.coverage`, scan-join receipts).
**If any stock was dropped or not computable, the receipt shows inline above the list** instead of only in ⓘ.

### 8.4 States
- **Loading:** list skeleton (6 rows) + chart placeholder; the chart mounts when the first row lands.
- **Empty:** "No stocks match all N filters." If the last change emptied it: "Your last change, <pill>,
  took the list from 31 to 0" + **Undo that change** + Open filters. (Client keeps the previous spec and count.)
- **Error (scan):** "The screen didn't load" + reason from `scanErrorText` + Try again (existing retry nonce).
- **Error (meta):** "Filters couldn't be loaded" + Retry; list still renders with the current screen.
- **Flagged:** when anything is flagged, a slim bar above the list: "3 flagged · Move to watchlist · Review · Clear"
  (existing `FlaggedActions`).

## 9. Where every current control goes

| Today | New home |
|---|---|
| Page title + Stocks/Options | Title dropped on the Stocks layout (top bar names the screen); Stocks/Options strip unchanged when its flag is on |
| "How to trade with this" bar | ? → How to use this screen |
| Universe / Watchlist / Combo bar | First pill in the drawer |
| 30 preset chips + chip "Edit" | Screen menu (Pinned + groups) |
| "Screener ▾" saved-screens menu | Screen menu |
| Describe it · Criteria · rail | Filters drawer |
| Overview tab, column presets, Columns | Table mode |
| CSV · Excel | ⋯ |
| Structure library · Methodology | ? |
| Review charts N | Is the layout itself (the overlay stays available in Table mode) |
| Save scan · Save… · Promote · Save to Notebook | Save ▾ |
| To watchlist · Flagged N | Add to watchlist (chart pane) · flagged bar |
| Coverage line | ⓘ, inline when something dropped |
| "Already on your radar" | Gold dot |
| Re-sort loaded rows live | ⋯ |
| Structure pills in rows | Setup line |

## 10. Keyboard

| Key | Action |
|---|---|
| ↑ ↓ / k j | Previous / next row; chart follows; list scrolls to keep the row visible |
| ⇧F | Flag / unflag (`useFlagged`) — matches the app-wide `SHIFT_F` chord |
| W | Add to the default watchlist (`POST /api/watchlists/{id}/items`); a toast offers "Change list" |
| ↵ | Open full chart (`chartsLinkPath({symbol, tf})`) |
| / | Open drawer and focus "Find a filter" |
| Esc | Close menu/drawer |
Bound through `shortcutRegistry.js` + `registerShortcuts()` or JSX `onKeyDown` on the list — **no new raw
window/document listeners** (`keyListenerCensus` ceiling). Keys ignored while focus is in a text field.
The joystick hub's screener section keeps working: the list exposes the same `scrollToIndex` handle and
`itemProps` as `VirtualResults`, and its selection follows the hub cursor index.

## 11. Phases

**Phase 1 — frontend on existing data (this spec's build):** flag, layout, list, chart pane with neighbour warm,
setup line rules, radar dot, why-it's-here, screen menu with lazy counts and client grouping, filters drawer,
universe pill (§12), Save/⋯/? menus, data receipt, all states, keyboard, Table mode.

**Phase 2 — small backend additions:**
1. Persist `base_pivot_px` and `base_pivot_detection` alongside `base_render` in `bases.classify()` /
   snapshot; expose distance; pivot line in the chart pane; distance on the setup line.
2. `POST /api/screener/count/batch` (loop specs on one connection, cap 30).
3. `group` + `description` on `starters()`; descriptions written for all 12 base starters.
4. NL compile → pills server-side helper (flatten pure all-of trees) so every client gets the same answer.

**Later:** base box/buy zone overlay prop on StockChart; phone layout; Terminal panel adoption.

## 12. Flag and delivery

- Backend env `SCREENER_FOCUS_LAYOUT_ENABLED` with scope values `0|1|admin` (pattern: `_breadth_dc_scope`
  in `api/routers/auth.py`), surfaced on the auth payload as `screener_focus_layout: true` only when on for
  this user. Ledger row in `docs/feature_flags.json`.
- Client: `SERVER_FLAGS` entry in `AuthContext.jsx`; `Screener.jsx` renders `<FocusScreener/>` when
  `useContext(AuthContext)?.screenerFocusLayout === true && !embedded && !inPanel`, else `<ScannerShell/>`.
- Rollout: `admin` (owner) → `1` (everyone) after a browser walk on prod; old shell removed in a later cleanup.
- The universe pill's label is derived client-side from the spec (`universe.value === 'uct'` → "UCT Universe",
  `list.label`, else "All stocks"). No `universe` meta entry: adding one to the filter registry would route the
  key through the generic column path, while the query handles it specially (`query._universe_clauses`).

## 13. Code structure

New folder `app/src/pages/screener/focus/`:
- `FocusScreener.jsx` — orchestrator; reuses `useScreenerMeta`, `useScreenSpec`, `useScreenerScan`,
  `useScreenerCount`, `useRealtimePrices`. No direct fetches (panelAdoption ratchet).
- `FocusTopBar.jsx`, `ResultList.jsx` (+ row), `ChartPane.jsx`, `WhyItsHere.jsx` + `whyItsHere.js` (pure),
  `setupLine.js` (pure), `ScreenMenu.jsx`, `FiltersDrawer.jsx`, `SaveMenu.jsx`, `MoreMenu.jsx`, `HelpMenu.jsx`,
  `DataReceipt.jsx`, `FocusStates.jsx`, `useFocusSelection.js` (index, neighbour warm, keys).
- `Focus*.module.css` — tokens only (`--bg`, `--text`, `--ut-gold`…); zero rules on the contrast baseline.
`ScannerShell.jsx` and its children are not modified in phase 1 except where a shared helper is extracted.

## 14. Testing

- Pure units: `setupLine` (null base, zero volume, `+N` stripping), `whyItsHere` (every filter class in §6.3,
  including "never ✓ for scan/logic/rank"), save-menu item gating, empty-state undo bookkeeping.
- Component tests: list selection + keys, drawer pill add/remove, screen menu sections, flag off renders
  `ScannerShell` unchanged (existing suite stays green untouched).
- Rails respected: `keyListenerCensus`, `panelAdoption.ratchet`, contrast baseline, `test_feature_flag_ledger`,
  `AuthContext.test` flag paths.
- **Browser walk (required before every merge):** local sandbox, flag on, 1440×900 and 1024×768: load
  Power Plays, arrow through 20 rows and confirm the chart follows with no blank frames, open each menu,
  add/remove filters, empty state + Undo, Save menu items, Table toggle, flag off shows today's page.
  Screenshots attached to the PR.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Chart swap stutters on cold symbols | Neighbour warm ±6; first-30 prefetch; measure in the browser walk |
| Selection and hub cursor disagree | One selection index, driven by the hub cursor store when the hub is eligible |
| Why-it's-here shows a value that is stale vs live price | Use live price only for price; label others with the snapshot date in the receipt |
| Lazy counts flood `/count` | 12 concurrent cap, session cache, phase-2 batch endpoint |
| Members miss the old toolbar | Table mode keeps it; flag rollout owner-first |
