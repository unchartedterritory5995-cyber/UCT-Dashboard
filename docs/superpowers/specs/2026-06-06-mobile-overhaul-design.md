# UCT Dashboard — Mobile-Native Overhaul (Design Spec)

**Date:** 2026-06-06
**Status:** Design — awaiting approval before implementation planning
**Companion mockups:** `.superpowers/brainstorm/1301-1780793079/content/` (navigation · home · ticker-hub · breadth · toolkit)

---

## 1. Context

~Half of UCT Dashboard's users are on mobile, but the app was built desktop-first. A prior pass made it **survive** on phones (responsive reflow, zero horizontal overflow across 24 routes — verified by `tools/mobile_audit.py`). That is a floor, not a ceiling: it did not make the app feel **born on the phone**. The user's explicit bar for this work:

> Every surface — and **every clickable, dropdown, and tool *within* each surface** — gets inspected and given a first-class mobile treatment, modeled on how the best competitor apps do it.

This spec defines a true mobile-native overhaul: a new navigation shell, a triaged home, a universal ticker hub, a reframed Breadth surface, and — critically — a **reusable control toolkit** that every one of the app's interactive elements maps onto, backed by an exhaustive per-surface control inventory.

It is a **mobile-tailored presentation layer over the same React app** (same routes, same data, same backend) — not a fork. Desktop is unchanged at ≥1025px.

## 2. Competitive research (what the best apps do)

Five parallel teardowns (TradingView · Webull + thinkorswim · Robinhood + Public + Stocktwits · Koyfin + Finviz + MarketSmith + TC2000 · cross-cutting Apple HIG / Material 3 / NN/g). Convergent findings:

- **Bottom tab bar, 3–5 items; open on a list/home, never a chart.** "More" is a last resort, not a parking lot. (Apple HIG, Material 3, Robinhood, TradingView, Webull, Koyfin.)
- **A universal "ticker hub" per symbol** is the connective tissue every tap funnels into (thinkorswim Quote Details, TradingView Symbol screen, Robinhood detail) — kills tab ping-pong.
- **Home = decision confidence:** *where I stand → what needs attention now → what to do next*, led by an AI one-line digest (Robinhood Cortex, Public Alpha) + a swipeable typed "Cards" strip.
- **Heatmaps don't go mobile-native — nobody cracked it (Finviz shipped no app).** Primary surface becomes a ranked list/cards; the treemap is a *secondary* pinch-zoom-in.
- **Dense tables:** density switcher (Grid/Compact/Detail) on one dataset · opt-in columns behind a gear · tap-header sort · frozen first column + horizontal scroll · row→card · per-row actions in a kebab/long-press (never inline micro-icons) · inline-cell actions where possible · **author-on-desktop, consume-on-mobile** for heavy config (scanners).
- **Charts (TradingView model):** default = pan; **long-press = crosshair/scrub** (tap to exit); **tap-anchor then double-tap** to draw (not drag); tap-select-drag to edit; collapsing one-line legend; curated reduced tool set; chart "activates" then *releases vertical scroll* after idle.
- **Bottom sheets > modals** (25–30% higher engagement); filters become a chip row + a "Filters" sheet. Swipe-actions + long-press as accelerators **with visible fallbacks**; haptics on commit. 16px inputs + numeric keyboards + safe-area + sticky CTA. Skeletons + optimistic UI for flag/tag/watchlist.

Sources captured in the brainstorm transcript (TradingView mobile docs, NN/g Mobile Tables, Apple HIG Tab Bars, Material 3 Bottom Sheets, Robinhood/Public/Koyfin teardowns).

## 3. Goals & non-goals

**Goals**
- A mobile-native shell (bottom nav + triaged Home + Ticker Hub) replacing the hamburger-drawer-only navigation.
- A **reusable control-pattern toolkit** so every interactive element is touch-first and consistent.
- **Exhaustive coverage**: every control on every surface assigned a mobile treatment (§7).
- Near-full feature parity (incl. touch charting) — variations between desktop and mobile are acceptable where they improve the phone UX.
- No regressions on desktop (≥1025px) and no codebase fork.

**Non-goals**
- A separate native app or a separate mobile codebase.
- Changing backend APIs or data models (presentation layer only; a few read endpoints may be reused differently).
- Re-architecting partner-owned files (OptionsFlow.jsx) — additive/rebase-safe only.
- Real-time order execution (the app is intelligence, not a broker).

## 4. Navigation shell — **decided: Option A "workflow spine"**

Bottom tab bar (≤1024px), 5 tabs, thumb-reachable, replacing the hamburger drawer as the primary nav:

| Tab | Contents | Sub-nav |
|---|---|---|
| **⌂ Home** | Triaged daily landing (§5) | — |
| **◳ Markets** | Breadth · Calendar · Options Flow · Dark Pool · Post-Market · Screener · Patterns · Catalysts | Horizontal **chip sub-nav** at top of the tab |
| **📈 Charts** | Charting workspace + Watchlists (the list is the funnel into charts) | Watchlist ⇄ Chart |
| **📓 Journal** | Journal 2.0 (positions/trades/calendar/analytics/notebook/compass) | Scrollable **chip strip** for the 8 J2 tabs |
| **⋯ More** | UCT 20 · Model Book · Setup Library · full Morning Wire · Settings · Admin · Disclaimers | List |

- Desktop (≥1025px) keeps the existing left sidebar (`NavBar`) unchanged. The bottom tab bar renders only on touch/≤1024px, replacing `MobileNav`'s hamburger as the primary surface (hamburger/drawer may remain as a secondary "More" affordance).
- Sub-navigation within a tab is a **segmented control / horizontal chip strip**, never a second tab bar.

## 5. Home tab — **decided: Option A "triage stack"**

Vertical, decision-first stack:
1. **🧭 Compass digest** — one-line AI market read (powered by existing Compass/Morning Wire). The "what's going on + what to do" headline.
2. **⚠ Needs attention** — catalysts/alerts/stops on your lists (tap → Ticker Hub).
3. **Breadth snapshot** — exposure gauge + key metrics (tap → Markets ▸ Breadth).
4. **Movers now** — a swipeable typed **Cards deck** (movers / earnings / breaking) folded in from the Robinhood model; each card → Ticker Hub.
5. **Morning Wire** — top-5 picks entry.

Every card taps through to the Ticker Hub or its source surface. Pull-to-refresh (exists) refreshes all.

## 6. Universal Ticker Hub — **decided: expanding bottom sheet**

One screen per symbol that **every ticker tap funnels into** (Home cards, watchlist rows, catalysts, scan results, tape, chart, calendar). Replaces today's ad-hoc TickerPopup-as-modal.

- **Presentation:** an expanding **bottom sheet** (peek → drag to full) over the current screen; dismiss with swipe-down. Same content is deep-linkable as a **full screen** when arriving from a notification/search.
- **Content:** header (sym · price · %), mini-chart with TF chips, a **5-action row — Chart · Alert · Flag · Journal · Compass** (add-to-watchlist / tag live in the ⋯ overflow), key stats, and a "why it's moving" section (catalysts/news/earnings/patterns) + your open position if any.
- Reuses `Sheet` primitive; supersedes `TickerPopup`'s bespoke modal (TickerPopup becomes a thin caller of the Hub).

## 7. The control toolkit (the reusable patterns)

Every interactive element in the app maps to one of these. This is the mechanism that makes "every clickable competitive" tractable.

| Code | Pattern | Use |
|---|---|---|
| **P1** | **Density switcher** (Cards / Compact / Detailed / Heat on one dataset) | Tables the user reads at varying density (Options Flow, J2 positions, Dark Pool) |
| **P2** | **Frozen first column + horizontal scroll** (sticky ticker/date col, "›" affordance) | Wide comparison grids (Breadth monitor, Options Flow, Screener results) |
| **P3** | **Row → card + ⋮ kebab** | Entity lists (positions, watchlist, catalysts, calendar days, accounts, notes) |
| **P4** | **Long-press / kebab → action sheet** | Every desktop right-click/context menu; per-row actions; chart context menus |
| **P5** | **Filter / dropdown → chips + "Filters" bottom sheet** | All `<select>`/filter bars (CustomScan 40 filters, Calendar filters, OptionsFlow filters, J2 FiltersPanel, tag pickers) |
| **P6** | **Column / metric picker behind a gear** (lean default + presets) | Column choosers, metric selectors (J2 ColumnsPicker, Watchlists perf cols, Breadth metrics, chart color/width/font) |
| **P7** | **Touch-chart controls** (long-press scrub · tap-anchor+double-tap draw · tap-select-drag edit · draw-mode toggle · reduced tool set · collapsing legend · activate-then-release-scroll) | StockChart + all ECharts/Chart.js surfaces |
| **SHEET** | Modal → bottom-sheet (auto) / **FULLSCREEN** for full tasks | All modals/drawers/popovers |
| **SUBNAV** | Tabs → segmented control / scrollable chip strip | Every tab bar (J2 8 tabs, TradeDrawer 6 tabs, Breadth/Calendar views, OptionsFlow sub-tabs) |
| **FORM** | Mobile form kit: 16px inputs, `inputmode` numeric keyboards, safe-area, **sticky bottom CTA**, keyboard-avoidance | Every form/modal (Add/Edit/Close Position, Portfolio Settings, Day Reflection, Notebook) |
| **TAP44** | Enforce ≥44px target | Every button/icon/chip/swatch |
| **HOVER-FIX** | Hover-only affordance → tap/long-press / always-visible | Tooltips, crosshair legend, row-hover, big-print tooltips, recap popovers |
| **DRAG-FIX** | Mouse-drag → Pointer-event touch-drag (or explicit reorder mode) | Drawing edit, watermark, workspace widgets, watchlist reorder |
| **GESTURE** | Swipe-actions (with visible fallback) + haptics | Row swipe (flag/dismiss), sheet drag-dismiss |

Built once in `app/src/components/mobile/` (Sheet, ContextPopover, ResponsiveTable, useLongPress already exist; add: `DensitySwitcher`, `FiltersSheet`, `MobileForm`/`StickyActionBar`, `SegmentedNav`, `useSwipeAction`, haptics helper).

## 8. Per-surface control treatment (exhaustive coverage)

Derived from a full code inventory of every interactive control (the raw inventory lives in the brainstorm transcript). Each surface lists its notable controls + the catch-all rule "every other control → its toolkit pattern." Read-only displays (gauges, badges, prices) are unaffected.

### 8.1 HOME tab
- **Dashboard tiles** (MarketBreadth, CatalystTable, CatalystFlow, FuturesStrip, Leadership, KeyLevels, Regime, IntradayPulse, MARelationship, CompassToday, NewsFeed): the bento grid becomes the **triaged stack** (§5). NH/NL counts, earnings rows, ticker chips → Ticker Hub (SHEET). `CatalystTable` 7-col → P3 cards (thesis-forward; already shipped) + tag filter P5 + 👍/👎 & ⓘ citations TAP44/SHEET. `RegimeTile` 4-col grid → 2-col (shipped).
- **Morning Wire / UCT20:** rundown already single-column; make **cashtags tappable** → Ticker Hub (HOVER-FIX). Read-aloud TAP44. UCT20 cards = P3 expand-in-place.

### 8.2 MARKETS tab
- **Breadth — decided: overview-first (Option A).** Land on **Overview** (gauge + key-metric tiles + ranked movers); chip SUBNAV to Heatmap · Views · Monitor · COT.
  - **Monitor (60-col):** P2 frozen date column + horizontal scroll (shipped) + P1 density switcher + P6 column-preset picker; group/column collapse → P5; drill cell → SHEET; MA-stack hover → P4.
  - **Heatmap:** treemap as **secondary** pinch-zoom-in (P7) with permanent legend + tap-to-drill + a **ranked-list fallback** as the default reading surface; date nav TAP44.
  - **Views (8 styles):** swipeable deck, one per screenful (SUBNAV); per-view customize panel → SHEET (P5/P6); drill → SHEET; right-click → P4.
  - **BreadthCharts / COT:** metric picker → P5/P6 sheet; date range → FORM; ECharts/Chart.js → P7; COT resize handles → drop on touch (fullscreen chart).
- **Calendar:** Feed (default, card list) ; Month → dots + tap-day → DayDetailDrawer SHEET (mobile agenda already exists); filters/source picker → P5 Filters sheet; EarningsModal tabs → SUBNAV + SHEET; expected-move/4Q hover → P4.
- **Options Flow** (partner-owned — additive/CSS only): 7 sub-tabs → SUBNAV; 14-col table → P2 frozen-scroll (+ P1 density later); all filters (cap/CP/DTE/conviction/sort) → P5 Filters sheet; GEX modal → FULLSCREEN; premium bars → P4; expandable rows → P3.
- **Dark Pool / Post-Market:** big-print/row hover tooltips → HOVER-FIX (tap); sortable tables → P2 + tap-header sort; ticker → Hub; PostMarket movers → P3 cards.
- **Screener / CustomScan:** 3-col layout → stacked cards (P3); signal chips → tap-to-explain (HOVER-FIX); **CustomScan 40+ filters → "Filters" sheet (P5) with Technical/Descriptive segments + saved-preset quick buttons** (author-rich, run-on-phone); results table → P3 cards / P2 scroll; right chart → FULLSCREEN; LiveScan feed/watch → SUBNAV (tab between, not side-by-side).
- **Patterns:** category/type filters → P5 chips+sheet; confidence slider → P7/FORM; result cards already card-based.

### 8.3 CHARTS tab (the densest tooling)
- **StockChart canvas:** P7 — long-press scrub + tap-exit; default pan; pinch zoom; chart activates then releases scroll. (Pointer-event drawing already shipped.)
- **Drawing (17 tools):** curated reduced set on phone (cursor, trendline, horizontal, rect, fib, text + "⋯ more" sheet); **tap-anchor → double-tap finish**; tap-select → drag edit (DRAG-FIX); toolbar = bottom strip, 44px (shipped); color/width/font → P6 sheets.
- **Region right-click menu (50+ items):** → P4 long-press → ContextPopover with the same sectioned items (chart type, timeframe, indicators, log scale, magnet, ext-hours, swing labels, volume…).
- **Watermark drag → DRAG-FIX (pointer)**; **settings gear panel → SHEET**; **compare / indicator-alert popovers → P5/SHEET**; replay timeline → P7 scrub; screenshot/help → TAP44/SHEET.
- **Charts workspace:** phone = **tabbed widget stack** (Chart/Watchlist/Themes/Scanner reachable; shipped), defaults to chart; add-widget → sheet menu. RGL drag/resize stays desktop-only.
- **TickerPopup → Ticker Hub** (§6). **TickerActions → P4 long-press → ContextPopover** (shipped; add tag/list submenus as nested sheets).
- **Watchlists:** List ⇄ Chart toggle; rows → P3; reorder → explicit Reorder mode (DRAG-FIX); sort headers TAP44; perf columns → P6; per-symbol notes/star/bulk → P4 kebab; CSV import/export, create → SHEET; right-click list menu → P4.
- **Model Book / Setup Library:** year pills SUBNAV; gallery → P3 cards; Setup/Catalyst/Earnings tabs → SUBNAV; recap hover → HOVER-FIX (long-press); admin add/edit → SHEET FORM; show-all toggles → P1.

### 8.4 JOURNAL tab (most controls in the app)
- **Root 8 tabs → scrollable chip SUBNAV** (shipped). Account selector → P5 sheet; Generate Report / Settings / EOD banner → SHEET.
- **PositionsTable (16-col):** P2 frozen Symbol col (shipped) on tablet; **P3 cards on phone** (header = Symbol+Side+P&L; 2-col stat grid; rest behind "more"); Actions (Edit/Close/Delete/Chart) → P4 kebab/action-sheet; sort headers TAP44.
- **TradeDrawer:** FULLSCREEN on phone (shipped); embedded chart fixed-height + P7; 6 interior tabs → SUBNAV; Notes/Mistakes/Process → FORM; "Talk about this trade" voice retained; **fix nested-scroll** (chart vs tab body) with `overscroll-behavior:contain`.
- **FiltersPanel / ColumnsPicker → P5 / P6 sheets**; ColumnsPicker keeps dnd-kit + ↑/↓ fallback.
- **Calendar tab:** Month/Year/Week → P3 day-cards + DayDetailPage SHEET; DayReflection/RulesChecklist → FORM (16px, sticky CTA, 🎤 retained).
- **Analytics (14 ECharts):** range presets → SUBNAV/chips; dimension selector → P5; charts → P7; one section per screenful.
- **Accounts:** rows → P3; edit/delete/new → SHEET; comparison grid → P2/P3; goals/milestones read-only.
- **Notebook:** folder sidebar → drawer/SUBNAV; note cards → P3; TipTap editor → FULLSCREEN FORM (toolbar wraps, 🎤 + slash menu retained).
- **Compass tab:** Overview read-only; reviews → P3; **CompassChat** → SHEET-aware, suggested prompts P5 chips, action cards → SHEET confirm, input → FORM, **nested-scroll guarded**; onboarding interview → FORM.
- **All position/option/CSV/report modals → SHEET + FORM** (Add/Edit/Close Position, AddOptionStrategy with leg rows, Import/Export CSV, GenerateReport, DeleteAll with type-to-confirm, PortfolioSettings with sticky header/CTA + NoTradeWindows editor).

### 8.5 MORE tab
- **Settings:** every card → stacked FORM; theme/voice-picker → P5 chips; color pickers → P6; sliders → FORM; toggles TAP44; sticky save. Support → FORM. Admin → tables to P2/P3, lowest priority.

## 9. Codebase approach

- **Presentation layer over the same routes/data.** Use the existing breakpoint system (`styles/breakpoints.js`, `hooks/useBreakpoint.js`) and primitives (`components/mobile/`: Sheet, ContextPopover, ResponsiveTable, useLongPress) — extend with the new toolkit components (§7).
- **Shell:** a new `MobileTabBar` + `MobileShell` wraps protected routes at ≤1024px; `Layout.jsx` chooses shell by breakpoint. The Ticker Hub is a global, app-wide `Sheet` host so any surface can open it.
- **Per-surface work reuses the toolkit** rather than bespoke CSS — this is what makes exhaustive coverage feasible.
- **Partner constraint:** OptionsFlow.jsx changes are additive/CSS-only and rebase-safe (memory `project_partner_collab_branch`).
- **Build discipline:** `npm run build` green before each push; Vite `manualChunks` stays object-form.

## 10. Phased implementation roadmap

Each phase is independently shippable to Railway and verifiable via the audit harness + on-device spot checks.

1. **Shell** — MobileTabBar + MobileShell + global Ticker Hub host; wire the 5 tabs + Markets/Journal chip sub-nav. (Foundation everything hangs off.)
2. **Toolkit completion** — DensitySwitcher, FiltersSheet, MobileForm/StickyActionBar, SegmentedNav, useSwipeAction, haptics; tests for each.
3. **Home** — triaged stack + Cards deck + Compass digest.
4. **Ticker Hub** — full sheet content + 5 actions; migrate TickerPopup/TickerActions onto it.
5. **Markets** — Breadth overview-first + Views deck + Monitor density/columns; Calendar; Catalysts; Screener/CustomScan Filters-sheet; Dark Pool/Post-Market; Options Flow (additive).
6. **Charts** — finish P7 chart model (scrub/exit, double-tap finish, draw-mode, reduced toolset) + region menu→P4 + watermark/settings/compare/alerts; Watchlists List⇄Chart + reorder mode; Model Book.
7. **Journal** — PositionsTable cards + kebab actions; modals→SHEET/FORM; TradeDrawer; Calendar; Analytics; Notebook; Compass nested-scroll.
8. **More/Settings** + global polish (gestures, haptics, skeletons, optimistic UI, reduced-motion) + full audit sweep.

## 11. Verification

- **Automated:** `tools/mobile_audit.py` (phone + tablet) per surface — 0 horizontal overflow, sub-44px target report; run after each phase via the local-admin backend loop (documented in CLAUDE.md).
- **Per-control checklist:** each surface's inventory (§8) becomes a checklist; a control isn't "done" until its pattern is wired AND it works by touch.
- **Tests:** vitest for each new toolkit primitive + any refactored logic; keep existing suites green (chart 135, J2 183, etc.). Note: 3 pre-existing failures (NavBar calendar-link, useWatermarkDrag ×2) are from concurrent work, not this initiative.
- **On-device:** real iPhone + Android for the genuinely gesture-dependent pieces — pinch-vs-draw arbitration, long-press scrub, sheet drag-dismiss, swipe-actions.

## 12. Locked invariants (do not regress)

1. Desktop (≥1025px) layout unchanged; no codebase fork.
2. PositionsTable Symbol col frozen/clickable; Actions never hidden (kebab on phone).
3. TradeDrawer fullscreen on phone, single scroll context (no nested-scroll trap); same for Compass chat.
4. Charts: overlay is `pointerEvents:none` with no tool armed (chart keeps native pinch/pan); `touch-action:none` only while a tool is armed.
5. Filters/Columns are sheets/popovers, not blocking modals; close on Escape/outside/backdrop.
6. Native HTML5 date/time inputs on mobile; 16px inputs (no iOS zoom); safe-area insets honored.
7. OptionsFlow.jsx edits additive/rebase-safe (partner co-edits).
8. Ticker Hub is the single ticker-detail surface — new ticker entry points open it, not bespoke modals.
