# Font Unification — Instrument Sans Everywhere

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every font across the UCT dashboard with Instrument Sans so every surface — body text, data tables, section headers, charts, canvas overlays, and brand elements — uses a single unified typeface.

**Architecture:** Update CSS variables in `tokens.css` first (covers all `var(--font-*)` users automatically), then sweep 28 CSS module files replacing hardcoded font-name strings, then fix JSX inline styles and canvas declarations. Header hierarchy is maintained via weight/spacing/color rather than font variety. `font-variant-numeric: tabular-nums` is added to number cells to preserve column alignment that monospace provided.

**Tech Stack:** React + Vite SPA, CSS Modules, Google Fonts, ECharts, Recharts, TradingView Lightweight Charts v5, HTML5 Canvas API

---

## File Map

**Modified (all changes are CSS/JSX only — no backend):**

| File | Change Type |
|------|-------------|
| `app/src/styles/tokens.css` | CSS variables + Google Fonts URL |
| `app/src/components/NavBar.module.css` | font-family + letter-spacing on .brand |
| `app/src/components/TileCard.module.css` | font-family + letter-spacing + size on .title |
| `app/src/components/MoversSidebar.module.css` | font-family throughout |
| `app/src/components/TickerActions.module.css` | font-family throughout |
| `app/src/components/chart/ChartToolbar.module.css` | font-family throughout |
| `app/src/components/chart/SymbolSearch.module.css` | font-family throughout |
| `app/src/components/chart/ColorPicker.module.css` | font-family throughout |
| `app/src/pages/Screener.module.css` | font-family throughout |
| `app/src/pages/CustomScan.module.css` | font-family throughout |
| `app/src/pages/ThemeTrackerPage.module.css` | font-family throughout |
| `app/src/pages/ModelBook.module.css` | font-family throughout |
| `app/src/pages/CotData.module.css` | font-family throughout |
| `app/src/pages/PostMarket.module.css` | font-family throughout |
| `app/src/pages/OptionsFlow.module.css` | font-family throughout |
| `app/src/pages/DarkPool.module.css` | font-family throughout |
| `app/src/pages/Community.module.css` | font-family throughout |
| `app/src/pages/Traders.module.css` | font-family throughout |
| `app/src/components/tiles/UCT20Performance.module.css` | font-family throughout |
| `app/src/components/tiles/UCT20Backtest.module.css` | font-family throughout |
| `app/src/components/tiles/MARelationship.module.css` | font-family throughout |
| `app/src/components/tiles/EpisodicPivots.module.css` | font-family throughout |
| `app/src/components/tiles/NHNLModal.module.css` | font-family throughout |
| `app/src/components/tiles/IntradayPulse.module.css` | font-family throughout |
| `app/src/pages/journal/tabs/Portfolio.module.css` | font-family throughout |
| `app/src/pages/journal/tabs/Playbooks.module.css` | font-family throughout |
| `app/src/pages/journal/tabs/TradeLog.module.css` | font-family throughout |
| `app/src/pages/journal/tabs/Analytics.module.css` | font-family throughout |
| `app/src/pages/journal/tabs/Overview.module.css` | font-family throughout |
| `app/src/components/AuthGuard.jsx` | inline fontFamily string (line 21) |
| `app/src/pages/journal-2-0/tabs/Analytics.jsx` | ECharts fontFamily in chart configs |
| `app/src/components/tiles/UCT20Backtest.jsx` | Recharts fontFamily in tick labels |
| `app/src/pages/Breadth.jsx` | ECharts fontFamily in configs (grep-locate) |
| `app/src/components/chart/ChartDrawingOverlay.jsx` | canvas ctx.font strings |

---

## Task 1: Token Layer — CSS Variables + Google Fonts

**Files:**
- Modify: `app/src/styles/tokens.css`

- [ ] **Step 1: Update CSS font variables**

Read `app/src/styles/tokens.css`. Find lines 48–51 and replace:

```css
/* BEFORE */
--font-sans: 'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'IBM Plex Mono', 'SF Mono', Consolas, monospace;
--font-display: 'Cinzel', serif;
--font-heading: 'Bebas Neue', sans-serif;
```

```css
/* AFTER */
--font-sans:    'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono:    'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-display: 'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
--font-heading: 'Instrument Sans', -apple-system, BlinkMacSystemFont, sans-serif;
```

- [ ] **Step 2: Update Google Fonts import URL**

Line 1 of `tokens.css` — replace the entire `@import` line:

```css
/* BEFORE */
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&family=Cinzel:wght@700;800;900&family=Bebas+Neue&display=swap');
```

```css
/* AFTER */
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');
```

- [ ] **Step 3: Commit**

```
git add app/src/styles/tokens.css
git commit -m "feat: collapse all font variables to Instrument Sans, trim Google Fonts URL"
```

---

## Task 2: Core Component CSS — NavBar, TileCard, MoversSidebar, TickerActions

**Files:**
- Modify: `app/src/components/NavBar.module.css`
- Modify: `app/src/components/TileCard.module.css`
- Modify: `app/src/components/MoversSidebar.module.css`
- Modify: `app/src/components/TickerActions.module.css`

- [ ] **Step 1: Fix NavBar.module.css**

Read `app/src/components/NavBar.module.css`.

Replace `.brand` block (currently at line 22–32):
```css
/* BEFORE */
.brand {
  font-family: 'Cinzel', serif;
  font-size: 13px;
  font-weight: 700;
  color: var(--ut-green-bright);
  letter-spacing: 3px;
  margin-bottom: 24px;
  padding: 0 18px;
  white-space: nowrap;
  overflow: hidden;
}
```

```css
/* AFTER */
.brand {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 700;
  color: var(--ut-green-bright);
  letter-spacing: 1.5px;
  margin-bottom: 24px;
  padding: 0 18px;
  white-space: nowrap;
  overflow: hidden;
}
```

Replace `.label` font-family (line 83):
```css
/* BEFORE */
.label {
  opacity: 0;
  transition: opacity 0.15s;
  font-family: 'Instrument Sans', sans-serif;
}
```

```css
/* AFTER */
.label {
  opacity: 0;
  transition: opacity 0.15s;
  font-family: var(--font-sans);
}
```

- [ ] **Step 2: Fix TileCard.module.css**

Read `app/src/components/TileCard.module.css`.

Replace `.title` block (lines 29–36):
```css
/* BEFORE */
.title {
  font-family: 'Cinzel', serif;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  color: var(--text-bright);
}
```

```css
/* AFTER */
.title {
  font-family: var(--font-sans);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-bright);
}
```

Replace `.badge` font-family (line 38):
```css
/* BEFORE */
.badge {
  font-family: 'IBM Plex Mono', monospace;
```

```css
/* AFTER */
.badge {
  font-family: var(--font-sans);
```

- [ ] **Step 3: Fix MoversSidebar.module.css**

Read `app/src/components/MoversSidebar.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'Cinzel', serif;` → `font-family: var(--font-sans);`

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

After replacing, find the `.title` rule and ensure it has letter-spacing adjusted:
```css
/* The .title in MoversSidebar — after font-family replace, also update letter-spacing */
```
Find and update the `.title` letter-spacing from 2.5px (or whatever value it has) to 1.5px.

- [ ] **Step 4: Fix TickerActions.module.css**

Read `app/src/components/TickerActions.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

- [ ] **Step 5: Verify — no old font names in these 4 files**

Run:
```powershell
Select-String -Path "app/src/components/NavBar.module.css","app/src/components/TileCard.module.css","app/src/components/MoversSidebar.module.css","app/src/components/TickerActions.module.css" -Pattern "IBM Plex Mono|Cinzel|Bebas Neue"
```

Expected: no matches.

- [ ] **Step 6: Commit**

```
git add app/src/components/NavBar.module.css app/src/components/TileCard.module.css app/src/components/MoversSidebar.module.css app/src/components/TickerActions.module.css
git commit -m "feat: font unification — core component CSS (NavBar, TileCard, MoversSidebar, TickerActions)"
```

---

## Task 3: Chart Component CSS — ChartToolbar, SymbolSearch, ColorPicker

**Files:**
- Modify: `app/src/components/chart/ChartToolbar.module.css`
- Modify: `app/src/components/chart/SymbolSearch.module.css`
- Modify: `app/src/components/chart/ColorPicker.module.css`

- [ ] **Step 1: Fix ChartToolbar.module.css**

Read `app/src/components/chart/ChartToolbar.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(5 occurrences at lines ~208, 241, 292, 305, 314)

- [ ] **Step 2: Fix SymbolSearch.module.css**

Read `app/src/components/chart/SymbolSearch.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(3 occurrences at lines ~16, 61, 95)

- [ ] **Step 3: Fix ColorPicker.module.css**

Read `app/src/components/chart/ColorPicker.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(2 occurrences at lines ~81, 98)

- [ ] **Step 4: Verify**

```powershell
Select-String -Path "app/src/components/chart/ChartToolbar.module.css","app/src/components/chart/SymbolSearch.module.css","app/src/components/chart/ColorPicker.module.css" -Pattern "IBM Plex Mono|Cinzel|Bebas Neue"
```

Expected: no matches.

- [ ] **Step 5: Commit**

```
git add app/src/components/chart/ChartToolbar.module.css app/src/components/chart/SymbolSearch.module.css app/src/components/chart/ColorPicker.module.css
git commit -m "feat: font unification — chart component CSS (ChartToolbar, SymbolSearch, ColorPicker)"
```

---

## Task 4: Screener and CustomScan CSS

**Files:**
- Modify: `app/src/pages/Screener.module.css`
- Modify: `app/src/pages/CustomScan.module.css`

- [ ] **Step 1: Fix Screener.module.css**

Read `app/src/pages/Screener.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(27 occurrences — this is the largest single file)

Also add `font-variant-numeric: tabular-nums;` to any class that displays prices, percentages, or counts. Look for class names like `.price`, `.pct`, `.change`, `.val`, `.stat`, `.count`, `.score`, `.adr`, `.num`. Add it on the line after `font-family: var(--font-sans);` for those classes.

- [ ] **Step 2: Fix CustomScan.module.css**

Read `app/src/pages/CustomScan.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(18 occurrences)

Same as above: add `font-variant-numeric: tabular-nums;` to numeric data classes.

- [ ] **Step 3: Verify**

```powershell
Select-String -Path "app/src/pages/Screener.module.css","app/src/pages/CustomScan.module.css" -Pattern "IBM Plex Mono|Cinzel|Bebas Neue"
```

Expected: no matches.

- [ ] **Step 4: Commit**

```
git add app/src/pages/Screener.module.css app/src/pages/CustomScan.module.css
git commit -m "feat: font unification — Screener and CustomScan CSS"
```

---

## Task 5: Tile CSS — UCT20, MARelationship, EpisodicPivots, NHNLModal, IntradayPulse

**Files:**
- Modify: `app/src/components/tiles/UCT20Performance.module.css`
- Modify: `app/src/components/tiles/UCT20Backtest.module.css`
- Modify: `app/src/components/tiles/MARelationship.module.css`
- Modify: `app/src/components/tiles/EpisodicPivots.module.css`
- Modify: `app/src/components/tiles/NHNLModal.module.css`
- Modify: `app/src/components/tiles/IntradayPulse.module.css`

- [ ] **Step 1: Fix UCT20Performance.module.css**

Read `app/src/components/tiles/UCT20Performance.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`
Replace `font-family: 'Instrument Sans', sans-serif;` → `font-family: var(--font-sans);`

(16 IBM Plex Mono + 2 Instrument Sans hardcodes)

Add `font-variant-numeric: tabular-nums;` to classes displaying return percentages, prices, and NAV values.

- [ ] **Step 2: Fix UCT20Backtest.module.css**

Read `app/src/components/tiles/UCT20Backtest.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(10 occurrences)

- [ ] **Step 3: Fix MARelationship.module.css**

Read `app/src/components/tiles/MARelationship.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(5 occurrences)

Add `font-variant-numeric: tabular-nums;` to percentage distance classes.

- [ ] **Step 4: Fix EpisodicPivots.module.css**

Read `app/src/components/tiles/EpisodicPivots.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(4 occurrences)

- [ ] **Step 5: Fix NHNLModal.module.css**

Read `app/src/components/tiles/NHNLModal.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(4 occurrences)

- [ ] **Step 6: Fix IntradayPulse.module.css**

Read `app/src/components/tiles/IntradayPulse.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(1 occurrence)

- [ ] **Step 7: Verify**

```powershell
Select-String -Path "app/src/components/tiles/UCT20Performance.module.css","app/src/components/tiles/UCT20Backtest.module.css","app/src/components/tiles/MARelationship.module.css","app/src/components/tiles/EpisodicPivots.module.css","app/src/components/tiles/NHNLModal.module.css","app/src/components/tiles/IntradayPulse.module.css" -Pattern "IBM Plex Mono|Cinzel|Bebas Neue"
```

Expected: no matches.

- [ ] **Step 8: Commit**

```
git add app/src/components/tiles/UCT20Performance.module.css app/src/components/tiles/UCT20Backtest.module.css app/src/components/tiles/MARelationship.module.css app/src/components/tiles/EpisodicPivots.module.css app/src/components/tiles/NHNLModal.module.css app/src/components/tiles/IntradayPulse.module.css
git commit -m "feat: font unification — tile CSS (UCT20, MARelationship, EpisodicPivots, NHNLModal, IntradayPulse)"
```

---

## Task 6: Page-Level CSS — ThemeTrackerPage, ModelBook, CotData, PostMarket, OptionsFlow, DarkPool, Community, Traders

**Files:**
- Modify: `app/src/pages/ThemeTrackerPage.module.css`
- Modify: `app/src/pages/ModelBook.module.css`
- Modify: `app/src/pages/CotData.module.css`
- Modify: `app/src/pages/PostMarket.module.css`
- Modify: `app/src/pages/OptionsFlow.module.css`
- Modify: `app/src/pages/DarkPool.module.css`
- Modify: `app/src/pages/Community.module.css`
- Modify: `app/src/pages/Traders.module.css`

- [ ] **Step 1: Fix ThemeTrackerPage.module.css**

Read `app/src/pages/ThemeTrackerPage.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(3 occurrences)

Add `font-variant-numeric: tabular-nums;` to classes displaying return percentages.

- [ ] **Step 2: Fix ModelBook.module.css**

Read `app/src/pages/ModelBook.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(9 occurrences)

- [ ] **Step 3: Fix CotData.module.css**

Read `app/src/pages/CotData.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(1 occurrence)

- [ ] **Step 4: Fix PostMarket.module.css**

Read `app/src/pages/PostMarket.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`
Replace `font-family: 'Cinzel', serif;` → `font-family: var(--font-sans);`

(4 IBM Plex Mono + 1 Cinzel)

Find the page header class that uses Cinzel and add `letter-spacing: 1.5px;` after the font-family change.

- [ ] **Step 5: Fix OptionsFlow.module.css**

Read `app/src/pages/OptionsFlow.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'Cinzel', serif;` → `font-family: var(--font-sans);`

(2 Cinzel occurrences)

Find the page title/header classes and ensure they have `letter-spacing: 1.5px; font-weight: 700; text-transform: uppercase;`.

- [ ] **Step 6: Fix DarkPool.module.css**

Read `app/src/pages/DarkPool.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'Cinzel', serif;` → `font-family: var(--font-sans);`

(2 Cinzel occurrences)

Same as OptionsFlow: ensure header classes have `letter-spacing: 1.5px; font-weight: 700; text-transform: uppercase;`.

- [ ] **Step 7: Fix Community.module.css**

Read `app/src/pages/Community.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'Cinzel', serif;` → `font-family: var(--font-sans);`
Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(1 Cinzel + 9 IBM Plex Mono)

- [ ] **Step 8: Fix Traders.module.css**

Read `app/src/pages/Traders.module.css`. Use Edit with `replace_all: true`:

Replace `font-family: 'Cinzel', serif;` → `font-family: var(--font-sans);`
Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(1 Cinzel + 1 IBM Plex Mono)

- [ ] **Step 9: Verify**

```powershell
Select-String -Path "app/src/pages/ThemeTrackerPage.module.css","app/src/pages/ModelBook.module.css","app/src/pages/CotData.module.css","app/src/pages/PostMarket.module.css","app/src/pages/OptionsFlow.module.css","app/src/pages/DarkPool.module.css","app/src/pages/Community.module.css","app/src/pages/Traders.module.css" -Pattern "IBM Plex Mono|Cinzel|Bebas Neue"
```

Expected: no matches.

- [ ] **Step 10: Commit**

```
git add app/src/pages/ThemeTrackerPage.module.css app/src/pages/ModelBook.module.css app/src/pages/CotData.module.css app/src/pages/PostMarket.module.css app/src/pages/OptionsFlow.module.css app/src/pages/DarkPool.module.css app/src/pages/Community.module.css app/src/pages/Traders.module.css
git commit -m "feat: font unification — page CSS (ThemeTracker, ModelBook, CotData, PostMarket, OptionsFlow, DarkPool, Community, Traders)"
```

---

## Task 7: Journal Tabs CSS

**Files:**
- Modify: `app/src/pages/journal/tabs/Portfolio.module.css` (or journal-2-0 equivalent path — confirm by globbing `**/Portfolio.module.css`)
- Modify: `app/src/pages/journal/tabs/Playbooks.module.css`
- Modify: `app/src/pages/journal/tabs/TradeLog.module.css`
- Modify: `app/src/pages/journal/tabs/Analytics.module.css`
- Modify: `app/src/pages/journal/tabs/Overview.module.css`

> **Note:** The journal tabs live under `app/src/pages/journal/tabs/` OR `app/src/pages/journal-2-0/`. Run `Get-ChildItem -Recurse -Filter "Portfolio.module.css"` to confirm paths before editing.

- [ ] **Step 1: Locate journal tab CSS files**

```powershell
Get-ChildItem -Path "app/src" -Recurse -Filter "*.module.css" | Where-Object { $_.Name -match "Portfolio|Playbooks|TradeLog|Analytics|Overview" } | Select-Object FullName
```

Note the exact paths returned.

- [ ] **Step 2: Fix Portfolio.module.css**

Read the file. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(~22 occurrences)

Add `font-variant-numeric: tabular-nums;` to classes displaying P&L dollars, percentages, and prices (class names like `.pnl`, `.ret`, `.price`, `.val`, `.stat`).

- [ ] **Step 3: Fix Playbooks.module.css**

Read the file. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(~19 occurrences)

- [ ] **Step 4: Fix TradeLog.module.css**

Read the file. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(~16 occurrences)

Add `font-variant-numeric: tabular-nums;` to price, P&L, and percentage classes.

- [ ] **Step 5: Fix Analytics.module.css**

Read the file. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(~10 occurrences)

- [ ] **Step 6: Fix Overview.module.css**

Read the file. Use Edit with `replace_all: true`:

Replace `font-family: 'IBM Plex Mono', monospace;` → `font-family: var(--font-sans);`

(~10 occurrences)

Add `font-variant-numeric: tabular-nums;` to stat/metric display classes.

- [ ] **Step 7: Verify**

```powershell
Get-ChildItem -Path "app/src" -Recurse -Filter "*.module.css" | Where-Object { $_.Name -match "Portfolio|Playbooks|TradeLog|Analytics|Overview" } | Select-String -Pattern "IBM Plex Mono|Cinzel|Bebas Neue"
```

Expected: no matches.

- [ ] **Step 8: Commit**

```
git add -p  # add only the journal tab CSS files
git commit -m "feat: font unification — journal tab CSS (Portfolio, Playbooks, TradeLog, Analytics, Overview)"
```

---

## Task 8: JSX Inline Styles + Chart Library Configs

**Files:**
- Modify: `app/src/components/AuthGuard.jsx`
- Modify: `app/src/components/FeedbackWidget.jsx`
- Modify: `app/src/pages/journal-2-0/tabs/Analytics.jsx` (confirm path)
- Modify: `app/src/components/tiles/UCT20Backtest.jsx`
- Modify: `app/src/pages/Breadth.jsx`

- [ ] **Step 1: Fix AuthGuard.jsx — maintenance page Cinzel**

Read `app/src/components/AuthGuard.jsx`. Line 21 has:
```jsx
fontFamily: "'Cinzel', serif", fontSize: 48, fontWeight: 700,
color: '#c9a84c', letterSpacing: 12, marginBottom: 24,
```

Replace with:
```jsx
fontFamily: "'Instrument Sans', sans-serif", fontSize: 42, fontWeight: 700,
color: '#c9a84c', letterSpacing: 6, marginBottom: 24,
```

(Letter-spacing reduced from 12 → 6 because Instrument Sans is proportional; 12px spacing with Cinzel's tall serif looked intentional, but 12px with a sans-serif will look excessively spaced)

- [ ] **Step 2: Fix Analytics.jsx — ECharts fontFamily**

Locate the Analytics.jsx file under journal-2-0:
```powershell
Get-ChildItem -Path "app/src" -Recurse -Filter "Analytics.jsx" | Select-Object FullName
```

Read the file. Find all occurrences of `fontFamily: 'IBM Plex Mono'` in ECharts tooltip/axis/label config objects (lines ~82, 103, 114, 129).

Replace with `replace_all: true`:
```js
// BEFORE
fontFamily: 'IBM Plex Mono'
// AFTER
fontFamily: 'Instrument Sans'
```

- [ ] **Step 3: Fix UCT20Backtest.jsx — Recharts tick labels**

Read `app/src/components/tiles/UCT20Backtest.jsx`. Find Recharts `<Tick>` or `tick` prop objects at lines ~199, 204, 231, 236, 257 with `fontFamily: 'IBM Plex Mono'`.

Replace with `replace_all: true`:
```js
// BEFORE
fontFamily: 'IBM Plex Mono'
// AFTER
fontFamily: 'Instrument Sans'
```

- [ ] **Step 4: Fix FeedbackWidget.jsx — inline font string**

Read `app/src/components/FeedbackWidget.jsx`. Search for IBM Plex Mono:
```powershell
Select-String -Path "app/src/components/FeedbackWidget.jsx" -Pattern "IBM Plex Mono"
```

For any match found (inline style like `fontFamily: 'IBM Plex Mono, monospace'`), replace with `fontFamily: "'Instrument Sans', sans-serif"` using Edit.

- [ ] **Step 5: Fix Breadth.jsx — ECharts configs**

Read `app/src/pages/Breadth.jsx`. Search for `IBM Plex Mono` within the file:
```powershell
Select-String -Path "app/src/pages/Breadth.jsx" -Pattern "IBM Plex Mono"
```

For each match found, replace `'IBM Plex Mono, monospace'` or `'IBM Plex Mono'` with `'Instrument Sans'` using Edit with `replace_all: true`.

If no matches found, skip this step.

- [ ] **Step 6: Verify all JSX files clean**

```powershell
Select-String -Path "app/src/components/AuthGuard.jsx","app/src/components/FeedbackWidget.jsx","app/src/components/tiles/UCT20Backtest.jsx","app/src/pages/Breadth.jsx" -Pattern "IBM Plex Mono|Cinzel|Bebas Neue"
```

Also check the Analytics.jsx path found in step 2.

Expected: no matches.

- [ ] **Step 7: Commit**

```
git add app/src/components/AuthGuard.jsx app/src/components/FeedbackWidget.jsx app/src/components/tiles/UCT20Backtest.jsx app/src/pages/Breadth.jsx
git add  # add Analytics.jsx path
git commit -m "feat: font unification — JSX inline styles and chart library configs"
```

---

## Task 9: Canvas Sweep — ChartDrawingOverlay

**Files:**
- Modify: `app/src/components/chart/ChartDrawingOverlay.jsx`

- [ ] **Step 1: Read the file and find all ctx.font assignments**

Read `app/src/components/chart/ChartDrawingOverlay.jsx`.

Search for all occurrences:
```powershell
Select-String -Path "app/src/components/chart/ChartDrawingOverlay.jsx" -Pattern "ctx\.font"
```

- [ ] **Step 2: Replace IBM Plex Mono in ctx.font strings**

The confirmed occurrences are at lines 106 and 122:
```js
// BEFORE (both lines)
ctx.font = '10px "IBM Plex Mono", monospace'
```

```js
// AFTER
ctx.font = '10px "Instrument Sans", sans-serif'
```

Use Edit with `replace_all: true`:

old_string: `ctx.font = '10px "IBM Plex Mono", monospace'`
new_string: `ctx.font = '10px "Instrument Sans", sans-serif'`

If the grep found additional `ctx.font` lines with IBM Plex Mono beyond lines 106 and 122, replace those too using the same pattern.

- [ ] **Step 3: Check for text tool font string**

The drawing overlay has a text tool that lets users type annotations. Search for any `fontSize` or `font-size` property used in a `ctx.font` template literal:
```powershell
Select-String -Path "app/src/components/chart/ChartDrawingOverlay.jsx" -Pattern "fontSize.*monospace|IBM Plex"
```

If found (e.g. `` ctx.font = `${drawing.fontSize || 13}px "IBM Plex Mono", monospace` ``), replace the font name:
```js
// BEFORE
ctx.font = `${drawing.fontSize || 13}px "IBM Plex Mono", monospace`
// AFTER
ctx.font = `${drawing.fontSize || 13}px "Instrument Sans", sans-serif`
```

- [ ] **Step 4: Verify**

```powershell
Select-String -Path "app/src/components/chart/ChartDrawingOverlay.jsx" -Pattern "IBM Plex Mono|Cinzel|Bebas Neue"
```

Expected: no matches.

- [ ] **Step 5: Commit**

```
git add app/src/components/chart/ChartDrawingOverlay.jsx
git commit -m "feat: font unification — canvas ctx.font strings in ChartDrawingOverlay"
```

---

## Task 10: Aesthetic Improvements — Brand, Buttons, Ticker Treatment

**Files:**
- Modify: `app/src/components/NavBar.module.css` (brand already fixed in Task 2 — verify gold color option)
- Sweep: any CSS module files with `.btn`, `.button`, `.cta`, `.action` classes using font-weight other than 600

- [ ] **Step 1: Review NavBar brand result**

Read `app/src/components/NavBar.module.css`. Confirm the `.brand` class now reads:
```css
.brand {
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 700;
  color: var(--ut-green-bright);
  letter-spacing: 1.5px;
  ...
}
```

This is correct — green brand identity is preserved with Instrument Sans. No further change needed.

- [ ] **Step 2: Scan for button font-weight inconsistencies**

```powershell
Select-String -Path "app/src" -Include "*.module.css" -Recurse -Pattern "font-weight.*500" | Where-Object { $_.Line -match "btn|button|cta|action|submit" }
```

For each match found where a button-class element uses `font-weight: 500`, update it to `font-weight: 600`. Instrument Sans 500 is slightly too light for interactive elements; 600 gives clean action-weight contrast.

- [ ] **Step 3: Ticker symbol treatment — add font-variant-numeric to remaining key surfaces**

Read `app/src/pages/MorningWire.module.css`. Find `.rd-pick-sym` (ticker symbol class in Top 5 picks):
```css
/* Current */
.rd-pick-sym { font-family: var(--font-mono); font-size: 16px; font-weight: 700; color: #c9a84c; ... }
```

Since `--font-mono` now resolves to Instrument Sans, this is already correct. Add tabular-nums for consistency:
```css
/* Add this property */
font-variant-numeric: tabular-nums;
```

Also check `.rd-pick-flabel` and `.pillValue` classes in MorningWire.module.css — add `font-variant-numeric: tabular-nums;` to any that display dollar amounts or percentages.

- [ ] **Step 4: Add tabular-nums to Admin.module.css**

`Admin.module.css` already uses `var(--font-mono)` (no hardcoded strings — already covered by Task 1's token change). But it needs `font-variant-numeric: tabular-nums` added to its numeric display classes.

Read the file. Find classes like `.statNumber`, `.emailCell`, `.dateCell`, and any class displaying counts or timestamps. Add `font-variant-numeric: tabular-nums;` to each.

- [ ] **Step 5: Commit**

```
git add app/src/pages/MorningWire.module.css
git add  # Admin.module.css and any other files touched in steps 1-4
git commit -m "feat: font unification — aesthetic improvements (button weights, ticker tabular-nums, Admin numeric cells)"
```

---

## Task 11: Full Verification Pass

- [ ] **Step 1: Grep for IBM Plex Mono — must be zero**

```powershell
Select-String -Path "app/src" -Include "*.css","*.jsx","*.js" -Recurse -Pattern "IBM Plex Mono"
```

Expected output: **no matches**. If any matches remain, fix them now before proceeding.

- [ ] **Step 2: Grep for Cinzel — must be zero**

```powershell
Select-String -Path "app/src" -Include "*.css","*.jsx","*.js" -Recurse -Pattern "Cinzel"
```

Expected output: **no matches**. Fix any remaining hits.

- [ ] **Step 3: Grep for Bebas Neue — must be zero**

```powershell
Select-String -Path "app/src" -Include "*.css","*.jsx","*.js" -Recurse -Pattern "Bebas Neue"
```

Expected output: **no matches**.

- [ ] **Step 4: Verify Google Fonts URL only loads Instrument Sans**

Read `app/src/styles/tokens.css` line 1. Confirm:
```
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');
```

No `IBM+Plex+Mono`, `Cinzel`, or `Bebas+Neue` in the URL.

- [ ] **Step 5: Spot-check surfaces (visual checklist)**

After starting the dev server (`cd app && npm run dev`), verify these surfaces look correct and consistent:

- [ ] Dashboard tiles — headers use clean sans-serif (previously Cinzel)
- [ ] NavBar brand "UCT Intelligence" — Instrument Sans, green, tight letter-spacing
- [ ] Screener rows — numbers in price/ADR columns are aligned (tabular-nums working)
- [ ] MorningWire Top 5 Picks — ticker symbols gold, entry/stop/target values aligned
- [ ] Theme Tracker — return percentages in columns aligned
- [ ] Journal 2.0 Add Position modal — matches the look the user approved (this was already using Instrument Sans correctly)
- [ ] Chart drawing overlay horizontal lines — price labels in Instrument Sans
- [ ] Breadth Monitor heatmap tiles — labels in Instrument Sans
- [ ] UCT20 Backtest chart — axis labels in Instrument Sans

- [ ] **Step 6: Final commit**

```
git add -A
git commit -m "feat: font unification verification pass — all old font names removed"
```

---

## Task 12: Deploy to Railway

- [ ] **Step 1: Push to Railway**

```
git push origin master
```

- [ ] **Step 2: Monitor Railway build**

Watch Railway dashboard for successful build and deploy. The change is purely frontend CSS/JSX — no backend restarts, no migrations, no service disruption.

- [ ] **Step 3: Confirm production**

Visit `https://uctintelligence.com` and spot-check the same surfaces listed in Task 11 Step 5.
