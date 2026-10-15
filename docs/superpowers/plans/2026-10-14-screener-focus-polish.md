# Screener Focus Layout — Polish Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Fix every finding from the 2026-10-14 three-way audit (UX walk, performance, code review) of the Focus layout before the owner walk on production, and apply the owner's five design calls.

**Architecture:** All changes stay inside the Focus layout (`app/src/pages/screener/focus/`, `app/src/pages/Screener.jsx`) or add opt-in props/options to shared modules, so the old ScannerShell page, the /charts widget and the Terminal SCR panel behave as before. The two deliberate exceptions are the server-side starter screens (Task 9) and the count batch route (Task 9).

**Tech Stack:** React 19 + Vite + vitest/Testing Library (app/), FastAPI + SQLite + pytest (api/).

**Spec:** `docs/superpowers/specs/2026-10-13-screener-focus-layout-design.md` (still binding; this plan fixes defects against it and applies owner decisions made 2026-10-14).

## Owner decisions (2026-10-14, "lets accomplish all of this")
1. Landing: land on the first pinned screen with at least 10 matches (fall back to the first pinned screen).
2. Filters drawer: "Common" section first (Price, Market cap, RS Rank, Avg volume, Sector), every other category collapsed until opened, enums with more than 12 values as a searchable select, one match count, no "Clear 1", "Edit as code" a muted link.
3. Starter screens default to stocks only (no ETFs / closed-end funds).
4. "Add to watchlist" with no watchlist creates a "Screener picks" list and adds the stock.
5. Plain words instead of jargon ("Avg daily range 4.1%", "Volume 0.6× avg", "vs 50-day avg"); setup tags get a tooltip.

## Global Constraints
- Flag OFF (`SCREENER_FOCUS_LAYOUT_ENABLED` unset) must render exactly what master renders today, except Task 9's starter-screen and count-route changes.
- Terminal rails apply to every file under `pages/screener/focus/`: colours through tokens or `useThemeInk` (no hex literals in JSX), text inputs through `components/ui/Input`, no native `<select>` (use the app's existing select/combobox component — find it with grep, do not hand-roll), sorting via `lib/presentation/dataGrid/gridSort`, coverage via `CoverageLine`.
- Text colour tokens: `--success-ink` / `--danger-ink`, never `--gain` / `--loss` for text. z-index from the `--z-*` scale in tokens.css.
- Run vitest and pytest on NAMED files only, never the whole suite. `npx eslint <files>` clean. `python tools/check_repo_hygiene.py` clean. Preserve each file's line endings.
- `git add` named paths only; never `git add -A`, never `git checkout --`. Commit with `git commit -F - <<'MSG'` ending with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_019wNHrgR9AkxxQYuj7VVqjL`.
- Never set ALLOW_LOCAL_VENDOR_SOCKETS; never write to C:\data. No subagents.
- Every number shown to a member must be true for that stock at the time it claims (spec §6).

## Review Focus
1. A scan answer arriving after the member moved on must never be shown or filed as the newer screen.
2. A count that failed or is unknown must never render as 0.
3. Arrow-key stepping must keep working after any click in the chart pane.
4. Phone (≤640) must get the old ResultCards page, tablet (641–1024) the Focus layout.
5. The old page (flag off) must not change when shared modules gain options.

---

### Task 1: Phone gate and layout fit

**Files:** `app/src/pages/Screener.jsx`, `app/src/pages/Screener.focusSwitch.test.jsx`, `app/src/pages/screener/focus/FocusScreener.module.css`

- **B1 (blocker):** `focusOn` in `Screener.jsx` has no phone check; spec §3 says phones keep the current `ResultCards`. Add `&& !isPhone` using the existing `useIsPhone` (grep `hooks/useBreakpoint`). Test: phone → old shell even with the flag on; tablet → focus.
- **N7:** toast and name-dialog z-index (80/90) sit below `--z-nav`/`--z-fab`; use the modal/toast tokens from tokens.css.
- **B16:** at ≤1024 the floating buttons cover the bottom list rows; add bottom padding (≈72px) to `.list` in that media block.
- **P15:** at 1024 the chart is squeezed to ≈280px because the pane footer takes ≈151px: smaller ticker, hide the industry line, keep the why strip on one line in that media block.
- **P9:** at 1440 the pane footer wraps "Add to watchlist" onto a second line: `.paneFoot` nowrap, flexible `.why`, actions in their own right column.
- **P16:** small targets: list-head link buttons (Sort trigger is 19px tall) get `min-height: 32px`.

### Task 2: Scan answers belong to the spec that asked for them

**Files:** `app/src/pages/screener/shell/useScreenerScan.js` (opt-in only), `app/src/pages/screener/focus/FocusScreener.jsx`, `app/src/pages/screener/focus/ResultList.jsx`, tests under `focus/__tests__/`

- **S1:** `FocusScreener` folds each scan answer with the CURRENT `s.filters`/`s.baseSpec`/`screenSig`, and `useScreenerScan` only advances `seq` when its debounce fires, so an answer for screen A landing after the member moved to B is filed as B (wrong undo target, wrong "from N", ✓ marks for the wrong filters). Fix: carry the spec each answer belongs to (return it from the hook, e.g. `answeredSpec`), fold and derive `rowsKey` from it, and build the why strip from the answered filters.
- **B3:** while the new screen's scan is in flight (`rowsKey !== screenSig`), dim the list, disable its pointer events, and show "…" for the count in the screen button.
- **Perf:** `useScreenerScan` debounces 300ms even for the first request and for a deliberate screen switch. Fire immediately when no timer is pending; debounce only rapid edits. This must be an option (default = current behaviour) so ScannerShell is unchanged.
- **B6:** "Undo that change" disappears after a 0→0 step; keep `lastChange` (the last screen with results and its total) while the total stays 0.
- **B8/N2:** `current` (the named screen) is lost on List→Table→List and is not updated by back/forward, the `S:<id>` door, or a shared link. Persist it (sessionStorage keyed by spec signature or the URL's saved-screen param) and rehydrate it when the normalised spec still matches; clear it when it does not.
- **N3:** Enter navigates to /charts without `s.flush()`; flush first.
- **N1:** appended pages can repeat a ticker; skip tickers already loaded.

### Task 3: Every number is true

**Files:** `focus/whyItsHere.js`, `focus/ResultList.jsx`, `focus/ChartPane.jsx`, `focus/ScreenMenu.jsx`, `focus/useLazyCounts.js`, `focus/FiltersDrawer.jsx`, `focus/SaveMenu.jsx`, `focus/DataReceipt.jsx`, `focus/FocusScreener.jsx`, tests

- **B5/N4:** "Why it's here" shows the snapshot close under the live header price; the row and the chart header choose price/change differently. One shared helper (e.g. `focus/livePrice.js`) used by row, header and why strip; the why strip's price check uses the live price, or labels the snapshot value "at <date> close" when no live price exists.
- **S2:** ranked screens (UCT 50, any `top_n`) show the full eligible count. Show `min(total, top_n)` in the screen button, "1 of N", drawer count and "Show N stocks", screen-menu counts, and the Save hint.
- **S3:** screen-menu counts ignore the member's chosen universe/list. Merge the current universe/list into specs that name none before counting; include it in the count cache key.
- **S4:** the drawer renders `count ?? 0`, so a failed/unknown count shows "0 matches / Show 0 stocks". Pass the count error through; render "Count unavailable" / "Show stocks".
- **P7:** a stale snapshot date ("Sep 5 close" vs "Oct 14 close") changes silently: amber + "stale" when more than one session old.
- **P8:** earnings shows raw ISO: "Earnings Nov 18 (in 35d)", amber within 7 days.
- **P10:** on structure screens the why strip says "○ Matches Base Structure"; use `chipLabel` ("Has a Pocket Pivot").

### Task 4: Rows say what the screen matched, in plain words

**Files:** `focus/setupLine.js`, `focus/ResultList.jsx`, `focus/ChartPane.jsx` (setup tag + facts), `focus/FocusScreener.jsx` (sort keys), `focus/FocusScreener.module.css`, tests

- **B2:** the setup line shows the head of `base_render`, so a "Pocket pivots" screen is led by "Ugly Double Bottom" and "Three weeks tight" shows "Stage 4 Breakdown". When a structure filter is active, show the matched structure first ("Pocket Pivot · also Ugly Double Bottom"); pass the active structure keys from FocusScreener.
- **Owner decision 5 / P2:** plain words in `facts()` and sort labels: "Volume 0.6× avg", "Avg daily range 4.1%" (ADR collides with the "ADRs" type filter), "vs 50-day avg", spell out "Cheat" etc. via a small label map; setup tags get a `title` tooltip from the structure library's description if one exists.
- **B9:** sort offers text columns ("Structure ↓" sorts Z→A). Restrict sort keys to numeric columns.
- **P4:** the selected row hugs the bottom edge; keep two rows of lookahead when scrolling.
- **P5:** hovered rows look more selected than the selection; `.rowSel` is the strongest fill and hover is suppressed while the list has keyboard focus.

### Task 5: Chart pane: loading state, theme, focus, speed

**Files:** `focus/ChartPane.jsx`, `focus/FocusScreener.jsx`, `focus/useFocusSelection.js`, `app/src/utils/prefetchBars.js` (opt-in option only), tests

- **B4:** a cold or failed chart is a blank box. Track loading/ready/error per symbol+timeframe (StockChart's ready callback — grep for it — plus a timeout) and overlay "Loading chart…" / "Chart unavailable · Retry".
- **B14:** light theme leaves the chart black; pass theme-aware chart colours (grep how other pages make StockChart follow the theme; reuse that).
- **B7:** clicking Flag / Add to watchlist leaves focus on the button so ↓ stops. Refocus the list after those actions (as `pickList` does) and forward ↑/↓ from the pane to the selection handler.
- **B13:** the first flag inserts a "Flagged 1" row that pushes the layout down ≈43px; move the flagged actions into the list head so nothing shifts.
- **S5:** every live price tick re-renders StockChart: `memo` ChartPane, pass live price as primitives, stabilise callbacks (`onOpenFilters` is inline).
- **Perf 1:** neighbour prefetch is held by `_holdBackgroundWarm()` until the bars pack ingests (first 30–60s on a new browser). Add an opt-in option to the prefetch function that bypasses the hold for at most 2 symbols, and use it for the next 2 rows. Make the warm radius asymmetric for a downward walk (next 4, previous 1).
- **Perf 2:** each step fires `ticker-ipo`, `bars`, `stream/bars`. Open the live stream / side fetches only once the ticker has settled (~80ms), painting cached bars immediately; cache `ticker-ipo` per symbol (static).

### Task 6: Top bar, menus, help, save

**Files:** `focus/ScreenMenu.jsx`, `focus/FocusTopBar.jsx`, `focus/SaveMenu.jsx`, `focus/HelpMenu.jsx`, `focus/useFocusSelection.js`, `focus/useDescribe.js`, `focus/NameDialog.jsx`, `focus/useWatchlistTarget.js`, `app/src/pages/screener/shell/criteriaApi.js` (memoise only), skip-link component, tests

- **P3:** screen menu repeats pinned screens inside their groups, 0-match screens look like normal choices, the pin glyph reads as a lightbulb. De-duplicate, dim 0-count rows with "none today", use a clear pin icon (existing icon set; grep).
- **B12:** while landing, the screen button says "Custom screen" and Save appears late, shifting "⋯"/Help. Placeholder in the screen button until landed; always render Save (disabled until there is a result).
- **B10/N6:** Help shows a "?" hint but no "?" key is bound, and "Keyboard shortcuts" is a 4.5s toast. Bind "?" (not while typing in an input) to open a small shortcuts sheet (a dialog listing the keys).
- **P11:** Help trigger styled like the other top-bar buttons.
- **P12:** keyboard users need 24 Tabs to reach the list; add a "Skip to results" link first (grep `SkipLinkPortal`).
- **B11:** the Describe error shows the exception name ("(RuntimeError)"); plain copy, and hide the box for the session after a hard failure.
- **B17:** saving a screen with 0 matches gives no warning; note it in the name dialog.
- **Owner decision 4 / B15:** with no watchlist, W / Add to watchlist creates "Screener picks" (via the existing watchlist create API) and adds the stock; toast says so.
- **Perf:** opening Filters sends `grammar` ×2 and `compile` ×2; memoise the probe promise inside `criteriaApi`'s availability functions (reset on failure) and drop `useDescribe`'s private cache. Share one SWR key for watchlists between `useWatchlistTarget` and the app shell if they differ only by key.

### Task 7: Landing on a real list

**Files:** `focus/FocusScreener.jsx` (landing logic), `focus/useLazyCounts.js` (reuse), tests

- **Owner decision 1 / P1:** land on the first pinned screen whose count is ≥10, else the first pinned screen. Use the batch counts (already cached); the existing 3s landing cap still bounds the wait, and on timeout use the first pinned screen.
- **Perf 3:** `landed` waits on saved screens + preferences before count/scan start. Seed the pin decision from the last-known pins in localStorage (try/catch) so count/scan start in parallel; reconcile when the server answers (only switch if the member has not interacted).
- **Perf 4:** `Screener.jsx` statically imports both `ScannerShell` and `FocusScreener`; lazy-load whichever is not rendered (`React.lazy` + `Suspense` with the existing skeleton) so each mode ships only its own code. Keep the focusSwitch tests green.

### Task 8: A calm Filters drawer

**Files:** `focus/FiltersDrawer.jsx`, `app/src/pages/screener/shell/FilterRail.jsx` (new opt-in props only; defaults unchanged), `focus/FocusStates.jsx`, `focus/FocusScreener.module.css`, tests

- **Owner decision 2 / P6:** the drawer today renders 1,245 buttons (Industry ≈150), every category expanded, the match count three times, "Clear all" and "Clear 1", and "Edit as code" as heavy as the primary button. Build: a "Common" section first (Price, Market cap, RS Rank, Avg volume, Sector), every other category collapsed until opened (a category with an active filter starts open), enums with >12 options as a searchable combobox (reuse the app's existing combobox; grep), one match count (the footer button), no "Clear 1", "Edit as code" a muted link. Add these as FilterRail props whose defaults keep the old shell identical.
- **P13:** the empty state shows active filters as removable pills, each with "remove → N matches" from the count route (batch it; at most 8 pills).
- **P14:** in Table mode the old toolbar sits under an otherwise empty Focus bar; fold the List|Table switch into the old toolbar's row so there is one bar.

### Task 9: Server: starters, count batch

**Files:** `api/services/screener/saved_screens.py`, `api/routers/screener.py`, `api/services/screener/query.py` (optional `conn` param), tests in `tests/` (find the existing ones for these modules)

- **Owner decision 3 / P17:** momentum starter screens are topped by QQQ, SPY and closed-end funds. Add the stocks-only security-type filter (grep how the "Type" filter is expressed) to the starter screens. Note: `test_screener_filters.py` has a pre-existing master failure on `security_type`; do not "fix" it here, and do not let it hide a new failure (compare against `git stash`-free master output: run the file on this branch and read which tests fail and why).
- **N8:** three starter descriptions omit criteria ("Tight bases" omits RS ≥ 70 and up/down volume ≥ 1; "Leaders" omits price ≥ $5; "Pullbacks" omits the EMA-stack and low-volume conditions). Make each description name every condition in plain words, short.
- **S6:** `/api/screener/count/batch` swallows unexpected errors with no log; add `log.exception` per failed slot.
- **Perf 5:** each slot opens its own DB connection and recomputes the overlay (≈7ms/spec, 216ms for 30). Reuse one connection and one overlay for the batch, and add a small TTL cache keyed on (normalised spec, user id, snapshot date). Paid gate, 30-spec cap and parameterised SQL stay.

### Task 10: Local verification (controller)

Rebuild `app/dist`, walk the sandbox on localhost:8093 at 390/1024/1440 with Playwright (focus_walk scripts in the scratchpad), confirm every finding above is visibly fixed, axe still 0 violations, then the six-shard gate.
