# ChartPane Phase A — extract the shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the `/charts` ChartWidget shell (identity row, session toggle, market clock, TF bar, market-cap/earnings/UCT-rating meta, settings modal) into a reusable `ChartPane`, with `ChartWidget` becoming a thin workspace adapter over it — and `/charts` rendering pixel-identically throughout.

**Architecture:** Leaf-first extraction. Each task lifts exactly one region into its own component and *immediately* rewires `ChartWidget` to consume it, so the two never hold duplicate markup. Extracted components are presentational and take callbacks as props; the settings-resolution logic is lifted last, once its consumers are already components. Phase A ships no behavior change — it is a refactor whose deliverable is a `ChartPane` that Phase B mounts on every other chart surface.

**Tech Stack:** React 18 · Vite · vitest 4.0.18 + @testing-library/react · CSS Modules · lightweight-charts v5

**Spec:** `docs/superpowers/specs/2026-08-04-chart-pane-universal-design.md`

## Global Constraints

- **Worktree:** work only in `.worktrees/chart-pane` on branch `feat/chart-pane-universal`. Never edit the main checkout.
- **Rebase before every commit:** `git fetch origin && git rebase origin/master`. `ChartWidget.jsx` averages ~1 commit/day from another session.
- **Never `git add -A`.** Commit named paths only.
- **Do not edit** `ChartWidget.test.jsx`, `ChartWidget.session.test.jsx`, or `ChartWidget.volumepane.test.jsx`. They are the behavior-preservation rail; if a change makes them fail, the change is wrong. (Task 1 adds a *new* file alongside them.)
- **Behavior change is out of scope.** Phase A is a pure refactor. Any visual or functional difference on `/charts` is a defect.
- **CSS:** extracted components import the existing `ChartsWorkspace.module.css` by relative path. Do **not** copy rules into a new module — CSS-module class names are hashed per source file, so a copy silently produces different class names and duplicate/drifting rules. (Moving the CSS is deliberate Phase-C debt, noted at the end.)
- **Test runner:** `npx vitest run --pool=threads <paths>` from `app/`. Read the verdict from vitest's own `Tests N passed|failed` summary line — **never** from `$?` after a pipe (`| tail` makes `$?` report tail's status, which is always 0).
- **Canonical breakpoints only** (640 / 1024). No new media-query literals.
- **No emoji as icons** — use `<UIcon name="..." />`.

---

### Task 1: Build the regression rail that can actually fail

The existing three suites are 15 tests for 786 lines and assert none of the regions this plan extracts (they mock `ChartMarketClock`, `ChartDayGain` and `TimeframeMenu` to stubs, and `useFundamentalSnapshot` to `{data: null}` so the meta row renders only em-dashes). Without this task, every later task could be done wrong and stay green.

**Files:**
- Create: `app/src/pages/charts/widgets/ChartWidget.header.test.jsx`

**Interfaces:**
- Consumes: nothing (asserts against current `ChartWidget`).
- Produces: the characterization rail every later task runs unchanged.

- [ ] **Step 1: Write the characterization tests**

Create `app/src/pages/charts/widgets/ChartWidget.header.test.jsx`:

```jsx
import { render, screen, fireEvent, within } from '@testing-library/react'
import { useState } from 'react'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'

// Same mock surface as ChartWidget.test.jsx, EXCEPT: the clock, day gain,
// timeframe menu and fundamentals are left real (or given real data) because
// they are exactly what this file exists to pin.
vi.mock('../../../components/StockChart', () => ({
  default: ({ sym }) => <div><span data-testid="chart-sym">{sym}</span></div>,
}))
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef(({ displayLabel }, ref) => {
      useImperativeHandle(ref, () => ({ openWith: () => {} }))
      return <span data-testid="sym-label">{displayLabel}</span>
    }),
  }
})
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => <span>share</span> }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({
  default: ({ open }) => (open ? <div data-testid="settings-modal" /> : null),
}))
vi.mock('./ChartMarketClock', () => ({ default: () => <span data-testid="market-clock">clock</span> }))
vi.mock('./ChartDayGain', () => ({ default: ({ sym }) => <span data-testid="day-gain">{sym}</span> }))
vi.mock('./AiSearchWidget', () => ({ default: () => null }))
vi.mock('./TimeframeMenu', () => ({ default: () => <div data-testid="tf-menu" /> }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
// Real-shaped fundamentals so the meta row renders VALUES, not em-dashes.
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({
  default: () => ({
    data: { metrics: { market_cap: '$1.2T' }, next_earnings: '2026-08-28', composite: 61 },
    isLoading: false,
  }),
}))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => ({ name: 'SPDR S&P 500 ETF Trust' }) }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
// Deterministic session so the extended-hours button label is stable.
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))

import ChartWidget from './ChartWidget'

function Wrap({ opts = {}, onOptsChange = () => {} }) {
  const [groupSyms, setGroupSyms] = useState({ A: 'SPY', B: null, C: null, D: null })
  const value = {
    groupSyms,
    setGroupSym: (c, s) => setGroupSyms(prev => ({ ...prev, [c]: s })),
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }
  return (
    <WorkspaceContext.Provider value={value}>
      <ChartWidget color="A" opts={opts} onOptsChange={onOptsChange} />
    </WorkspaceContext.Provider>
  )
}

// ── Meta row ───────────────────────────────────────────────────────────────
test('meta row renders market cap, next earnings and UCT rating', () => {
  render(<Wrap />)
  expect(screen.getByText('Market Cap')).toBeTruthy()
  expect(screen.getByText('$1.2T')).toBeTruthy()
  expect(screen.getByText('Next Earnings')).toBeTruthy()
  expect(screen.getByText('8/28/2026')).toBeTruthy()   // ISO -> M/D/YYYY
  expect(screen.getByText('UCT Rating')).toBeTruthy()
  expect(screen.getByText('61')).toBeTruthy()
})

test('meta row is hidden entirely when all three items are toggled off', () => {
  render(<Wrap opts={{ settings: { header: { showMarketCap: false, showNextEarnings: false, showUctRating: false } } }} />)
  expect(screen.queryByText('Market Cap')).toBeNull()
  expect(screen.queryByText('Next Earnings')).toBeNull()
  expect(screen.queryByText('UCT Rating')).toBeNull()
})

// ── Identity row ───────────────────────────────────────────────────────────
test('identity row shows the company name, the day gain and the market clock', () => {
  render(<Wrap />)
  expect(screen.getByTestId('sym-label').textContent).toBe('SPDR S&P 500 ETF Trust')
  expect(screen.getByTestId('day-gain').textContent).toBe('SPY')
  expect(screen.getByTestId('market-clock')).toBeTruthy()
})

test('titleMode "both" renders TICKER (Company)', () => {
  render(<Wrap opts={{ settings: { header: { titleMode: 'both' } } }} />)
  expect(screen.getByTestId('sym-label').textContent).toBe('SPY (SPDR S&P 500 ETF Trust)')
})

// ── Session toggle ─────────────────────────────────────────────────────────
test('on a daily timeframe the session toggle offers Regular Hours + the post-market include', () => {
  render(<Wrap opts={{ tf: 'D' }} />)
  const group = screen.getByRole('group', { name: 'Chart session view' })
  expect(within(group).getByText('Regular Hours')).toBeTruthy()
  expect(within(group).getByText('Include post-market')).toBeTruthy()
})

test('on an intraday timeframe the toggle switches to Regular / Extended Hours', () => {
  render(<Wrap opts={{ tf: '5' }} />)
  const group = screen.getByRole('group', { name: 'Chart extended hours' })
  expect(within(group).getByText('Regular Hours')).toBeTruthy()
  expect(within(group).getByText('Extended Hours')).toBeTruthy()
  expect(screen.queryByRole('group', { name: 'Chart session view' })).toBeNull()
})

// ── Timeframe bar ──────────────────────────────────────────────────────────
test('the timeframe bar renders every favorited interval', () => {
  render(<Wrap opts={{ tf: 'D' }} />)
  for (const label of ['1m', '5m', '15m', '30m', '1h', '1D', '1W', '1M']) {
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
  }
})

test('clicking a timeframe button reports the new code to the host', () => {
  const onOptsChange = vi.fn()
  render(<Wrap opts={{ tf: 'D' }} onOptsChange={onOptsChange} />)
  fireEvent.click(screen.getByRole('button', { name: '1W' }))
  expect(onOptsChange).toHaveBeenCalledWith(expect.objectContaining({ tf: 'W' }))
})

test('the more-timeframes chevron opens the timeframe menu', () => {
  render(<Wrap opts={{ tf: 'D' }} />)
  expect(screen.queryByTestId('tf-menu')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'More timeframes' }))
  expect(screen.getByTestId('tf-menu')).toBeTruthy()
})

// ── Settings gear ──────────────────────────────────────────────────────────
test('the gear opens the chart settings modal', () => {
  render(<Wrap />)
  expect(screen.queryByTestId('settings-modal')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Chart settings' }))
  expect(screen.getByTestId('settings-modal')).toBeTruthy()
})
```

- [ ] **Step 2: Run the new file and make it pass against the CURRENT widget**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/widgets/ChartWidget.header.test.jsx`
Expected: `Tests 11 passed`.

These characterize existing behavior, so they must pass immediately. If one fails, the assertion is wrong about today's code — fix the *test* to match reality (read the source), do not change `ChartWidget.jsx` in this task.

- [ ] **Step 3: Prove each assertion group can fail (mutation check with a control)**

For each mutation below: apply it to `ChartWidget.jsx`, run the file, confirm it FAILS, then restore with `git checkout -- app/src/pages/charts/widgets/ChartWidget.jsx`.

| # | Mutation in `ChartWidget.jsx` | Must fail |
|---|---|---|
| 1 | Change `{showAnyMeta && (` to `{false && (` | meta row tests |
| 2 | Change `hdr.showUctRating &&` to `false &&` | UCT rating test |
| 3 | Change `{isDWMtf && (` to `{false && (` | daily session-toggle test |
| 4 | Change `{!isDWMtf && (` to `{false && (` | intraday session-toggle test |
| 5 | Delete the `<ChartMarketClock />` line | market-clock test |
| 6 | Change `visibleTfs.map` to `visibleTfs.slice(0, 2).map` | TF-bar render test |
| 7 | Change the ⌄ button's `onClick` to a no-op `() => {}` | timeframe-menu test |
| 8 | Change the gear button's `onClick` to `() => {}` | settings-modal test |

**Control:** with `ChartWidget.jsx` restored, the same command must report `Tests 11 passed`. Record the pass/fail line for all 8 mutations plus the control in the commit body. A mutation that stays green means the corresponding test is decorative — fix it before continuing.

- [ ] **Step 4: Confirm the pre-existing rail is untouched**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/widgets/`
Expected: `Test Files 4 passed`, `Tests 26 passed` (15 existing + 11 new).

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/widgets/ChartWidget.header.test.jsx
git commit -m "test(charts): characterize the ChartWidget shell before extracting it

11 tests pinning the meta row, identity row, session toggle, timeframe bar
and settings gear -- none of which the existing 15 tests touch. All 8
mutations verified lethal with an unmutated control green."
```

---

### Task 2: Extract `ChartMetaRow`

The purest leaf: three label/value spans with per-item color overrides and visibility flags.

**Files:**
- Create: `app/src/components/chart/pane/ChartMetaRow.jsx`
- Modify: `app/src/pages/charts/widgets/ChartWidget.jsx` (replace the `showAnyMeta` block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `<ChartMetaRow marketCap={string|null} nextEarnings={string|null} uctRating={number|null} show={{marketCap:bool,nextEarnings:bool,uctRating:bool}} colors={object} styles={object} />` — renders `null` when every `show` flag is false.

- [ ] **Step 1: Rebase**

```bash
git fetch origin && git rebase origin/master
```

- [ ] **Step 2: Create the component**

Create `app/src/components/chart/pane/ChartMetaRow.jsx`:

```jsx
// The chart header's info strip: Market Cap / Next Earnings / UCT Rating.
// Presentational only — the host resolves the values and the visibility flags.
// `styles` is injected so this renders with the caller's CSS-module classes
// (CSS-module names are hashed per source file; a local copy of the rules
// would produce different class names and silently drift).

// Default = the price-candle up-green (CHART_DEFAULTS.candles.upColor), so the
// rating matches the candles out of the box.
const UCT_RATING_DEFAULT = '#1ae51a'

export default function ChartMetaRow({
  marketCap = null,
  nextEarnings = null,
  uctRating = null,
  show = {},
  colors = {},
  styles,
}) {
  if (!show.marketCap && !show.nextEarnings && !show.uctRating) return null
  return (
    <div className={styles.chartMeta}>
      {show.marketCap && (
        <span className={styles.chartMetaItem}>
          <span className={styles.chartMetaLabel}>Market Cap</span>
          <span className={styles.chartMetaVal} style={{ color: colors.marketCap || '#c9a84c' }}>{marketCap || '—'}</span>
        </span>
      )}
      {show.nextEarnings && (
        <span className={styles.chartMetaItem}>
          <span className={styles.chartMetaLabel}>Next Earnings</span>
          <span className={styles.chartMetaVal} style={{ color: colors.nextEarnings || '#6ba3be' }}>{nextEarnings || '—'}</span>
        </span>
      )}
      {show.uctRating && (
        <span className={styles.chartMetaItem}>
          <span className={styles.chartMetaLabel}>UCT Rating</span>
          <span className={styles.chartMetaVal} style={{ color: colors.uctRating || UCT_RATING_DEFAULT }}>{uctRating != null ? uctRating : '—'}</span>
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Rewire ChartWidget**

In `ChartWidget.jsx`, add the import beside the other chart imports:

```jsx
import ChartMetaRow from '../../../components/chart/pane/ChartMetaRow'
```

Replace the whole `{showAnyMeta && ( … )}` block inside `tfBar` with:

```jsx
<ChartMetaRow
  marketCap={mktCap}
  nextEarnings={nextEarnStr}
  uctRating={uctRating}
  show={{ marketCap: hdr.showMarketCap, nextEarnings: hdr.showNextEarnings, uctRating: hdr.showUctRating }}
  colors={hdrColors}
  styles={styles}
/>
```

Then delete the now-unused `showAnyMeta` const and the `UCT_RATING_DEFAULT` const from `ChartWidget.jsx` (the component owns the default now).

- [ ] **Step 4: Run the rail**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/widgets/`
Expected: `Tests 26 passed`, with **no test file edited**.

- [ ] **Step 5: Prove the extraction is still covered**

Mutate `ChartMetaRow.jsx`: change `if (!show.marketCap && !show.nextEarnings && !show.uctRating) return null` to `return null`. Re-run — the meta row tests must FAIL. Restore, re-run, confirm `Tests 26 passed`.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/chart/pane/ChartMetaRow.jsx app/src/pages/charts/widgets/ChartWidget.jsx
git commit -m "refactor(charts): extract ChartMetaRow from ChartWidget

Pure move. Rail green at 26/26 with no test edited; mutation confirmed lethal."
```

---

### Task 3: Extract `ChartIdentityRow`

The ticker/company line: symbol search, day change (with the theme-index variant), the session toggle pair, and the market clock.

**Files:**
- Create: `app/src/components/chart/pane/ChartIdentityRow.jsx`
- Modify: `app/src/pages/charts/widgets/ChartWidget.jsx` (replace the `chartHeaderTop` block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```
<ChartIdentityRow
  searchRef                 // ref forwarded to SymbolSearch (openWith)
  sym, displayLabel, labelColor, logoSym, brandLogo, boundsRef, themeVars
  onSymbolChange            // omit => static label, no search
  showChange                // bool
  dayGain                   // null = render <ChartDayGain sym/>; object {abs,pct,up} = render the index variant
  dayGainColors             // {up, down}
  session                   // {mode:'dwm'|'intraday', view, onView, extEnabled, extLabel, extHoursOn, onExtHours}
  showClock                 // bool
  styles
/>
```

- [ ] **Step 1: Rebase**

```bash
git fetch origin && git rebase origin/master
```

- [ ] **Step 2: Create the component**

Create `app/src/components/chart/pane/ChartIdentityRow.jsx`:

```jsx
import SymbolSearch from '../SymbolSearch'
import ChartDayGain from '../../../pages/charts/widgets/ChartDayGain'
import ChartMarketClock from '../../../pages/charts/widgets/ChartMarketClock'

// The chart's identity line: who am I, what did I do today, which session am I
// showing, and what time is it. Presentational — the host resolves every value.
// Omitting `onSymbolChange` renders a STATIC label (contextual surfaces such as
// a trade drawer must not let the user retarget the chart).
export default function ChartIdentityRow({
  searchRef,
  sym,
  displayLabel,
  labelColor = null,
  logoSym = null,
  brandLogo = false,
  boundsRef = null,
  themeVars = undefined,
  onSymbolChange = null,
  showChange = true,
  dayGain = null,
  dayGainColors = {},
  session = null,
  showClock = true,
  styles,
}) {
  return (
    <div className={styles.chartHeaderTop}>
      <div className={styles.symbolSlot}>
        {onSymbolChange ? (
          <SymbolSearch
            ref={searchRef}
            sym={sym}
            onSymbolChange={onSymbolChange}
            hideIcon
            fullLabel
            logoSym={logoSym}
            brandLogo={brandLogo}
            displayLabel={displayLabel}
            labelColor={labelColor}
            boundsRef={boundsRef}
            themeVars={themeVars}
          />
        ) : (
          <span className={styles.symbolStatic} style={labelColor ? { color: labelColor } : undefined}>
            {displayLabel}
          </span>
        )}
      </div>
      {showChange && (dayGain ? (
        <span className={styles.chartDayGain} style={{ color: dayGain.up ? dayGainColors.up : dayGainColors.down }}>
          {dayGain.up ? '+' : ''}{dayGain.abs.toFixed(2)} ({dayGain.up ? '+' : ''}{dayGain.pct.toFixed(2)}%)
        </span>
      ) : (
        <ChartDayGain sym={sym} upOverride={dayGainColors.up || null} downOverride={dayGainColors.down || null} />
      ))}
      <div className={styles.headerTopRight}>
        {session?.mode === 'dwm' && (
          <div className={styles.sessionToggle} role="group" aria-label="Chart session view">
            <button
              type="button"
              className={`${styles.sessionBtn} ${session.view === 'regular' ? styles.sessionBtnActive : ''}`}
              onClick={() => session.onView('regular')}
              title="Regular trading hours only"
            >Regular Hours</button>
            <button
              type="button"
              className={`${styles.sessionBtn} ${session.view === 'extended' ? styles.sessionBtnActive : ''}`}
              onClick={() => { if (session.extEnabled) session.onView('extended') }}
              disabled={!session.extEnabled}
              title={session.extEnabled ? session.extLabel : 'Available during pre-market and post-market'}
            >{session.extLabel}</button>
          </div>
        )}
        {session?.mode === 'intraday' && (
          <div className={styles.sessionToggle} role="group" aria-label="Chart extended hours">
            <button
              type="button"
              className={`${styles.sessionBtn} ${!session.extHoursOn ? styles.sessionBtnActive : ''}`}
              onClick={() => session.onExtHours(false)}
              title="Regular session only (9:30–4:00 ET), overnight gaps"
            >Regular Hours</button>
            <button
              type="button"
              className={`${styles.sessionBtn} ${session.extHoursOn ? styles.sessionBtnActive : ''}`}
              onClick={() => session.onExtHours(true)}
              title="Include pre-market + post-market bars"
            >Extended Hours</button>
          </div>
        )}
        {showClock && <ChartMarketClock />}
      </div>
    </div>
  )
}
```

Add to `app/src/pages/charts/ChartsWorkspace.module.css`, immediately after the `.symbolSlot` rule (the static-label variant has no styling yet — it must match the search label's type so a locked surface looks identical):

```css
/* Static identity label — surfaces that lock the symbol (trade drawer, drill
   modal) render this instead of the SymbolSearch button. Must match
   .symbolSlot's type treatment exactly. */
.symbolStatic {
  font: inherit;
  font-weight: 700;
  color: var(--color-text);
  white-space: nowrap;
}
```

- [ ] **Step 3: Rewire ChartWidget**

Add the import:

```jsx
import ChartIdentityRow from '../../../components/chart/pane/ChartIdentityRow'
```

Replace the entire `<div className={styles.chartHeaderTop}> … </div>` block with:

```jsx
<ChartIdentityRow
  searchRef={searchRef}
  sym={sym}
  displayLabel={headerLabel}
  labelColor={hdrColors.title || null}
  logoSym={themeIdx.isIndex ? null : sym}
  brandLogo={themeIdx.isIndex}
  boundsRef={focusableRef}
  themeVars={menuVars}
  onSymbolChange={handleSymbolChange}
  showChange={hdr.showChange && !(themeIdx.isIndex && !idxGain)}
  dayGain={themeIdx.isIndex ? idxGain : null}
  dayGainColors={{
    up: hdrColors.dayChangeUp || (chartsTheme === 'sunrise' ? '#0a5c22' : '#1ae51a'),
    down: hdrColors.dayChangeDown || (chartsTheme === 'sunrise' ? '#7d1620' : '#ff3b47'),
  }}
  session={isDWMtf
    ? { mode: 'dwm', view: sessionView, onView: setSessionView, extEnabled, extLabel }
    : { mode: 'intraday', extHoursOn, onExtHours: setExtHours }}
  showClock
  styles={styles}
/>
```

⚠️ **Behavior note — the `showChange` expression above is deliberate, do not simplify it to `hdr.showChange`.** In the original, a theme index whose `idxGain` is still `null` renders *nothing* there, while a normal ticker always renders `<ChartDayGain>`. Because `ChartIdentityRow` falls back to `<ChartDayGain sym>` whenever `dayGain` is null, a bare `hdr.showChange` would make an index with no computed gain render a live day-gain fetch for a synthetic `$IDX:` pseudo-ticker. The `&& !(themeIdx.isIndex && !idxGain)` guard is what preserves the original behavior.

- [ ] **Step 4: Run the rail**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/widgets/`
Expected: `Tests 26 passed`, no test file edited.

- [ ] **Step 5: Prove coverage survived**

Mutate `ChartIdentityRow.jsx`: change `{showClock && <ChartMarketClock />}` to `{false && <ChartMarketClock />}`. Re-run — the market-clock test must FAIL. Restore and confirm 26/26.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/chart/pane/ChartIdentityRow.jsx app/src/pages/charts/ChartsWorkspace.module.css app/src/pages/charts/widgets/ChartWidget.jsx
git commit -m "refactor(charts): extract ChartIdentityRow from ChartWidget

Identity + day change + session toggle + clock. Adds a static-label path for
surfaces that lock the symbol. Rail green at 26/26; mutation lethal."
```

---

### Task 4: Extract `ChartTfBar`

**Files:**
- Create: `app/src/components/chart/pane/ChartTfBar.jsx`
- Modify: `app/src/pages/charts/widgets/ChartWidget.jsx` (replace the TF buttons + ⌄ + `TimeframeMenu`)

**Interfaces:**
- Consumes: `ChartMetaRow` (Task 2) — rendered as a child, not imported here.
- Produces:

```
<ChartTfBar
  tf, visibleTfs            // [[code,label], …]
  onTf                      // (code) => void
  menu={{ favorites, customCodes, onToggleFav, onAddCustom, onRemoveCustom, themeVars }}
  styles
>{children}</ChartTfBar>    // children render after the chevron (meta row, right cluster)
```

- [ ] **Step 1: Rebase**

```bash
git fetch origin && git rebase origin/master
```

- [ ] **Step 2: Create the component**

Create `app/src/components/chart/pane/ChartTfBar.jsx`:

```jsx
import { useState } from 'react'
import TimeframeMenu from '../../../pages/charts/widgets/TimeframeMenu'

// Timeframe buttons + the more-timeframes chevron. Owns only the menu's
// open/anchor state; favorites and custom intervals are the host's.
export default function ChartTfBar({ tf, visibleTfs, onTf, menu = {}, styles, children }) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState(null)
  return (
    <div className={styles.tfBar}>
      {visibleTfs.map(([code, label]) => (
        <button
          key={code}
          type="button"
          className={`${styles.tfBtn} ${tf === code ? styles.tfBtnActive : ''}`}
          onClick={() => onTf(code)}
        >{label}</button>
      ))}
      <button
        type="button"
        className={styles.tfBtn}
        title="More timeframes"
        aria-label="More timeframes"
        onClick={(e) => { setAnchor(e.currentTarget.getBoundingClientRect()); setOpen(v => !v) }}
      >⌄</button>
      {open && (
        <TimeframeMenu
          tf={tf}
          onSelect={(code) => { onTf(code); setOpen(false) }}
          favorites={menu.favorites || []}
          onToggleFav={menu.onToggleFav}
          customCodes={menu.customCodes || []}
          onAddCustom={menu.onAddCustom}
          onRemoveCustom={menu.onRemoveCustom}
          anchor={anchor}
          onClose={() => setOpen(false)}
          themeVars={menu.themeVars}
        />
      )}
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Rewire ChartWidget**

Add the import:

```jsx
import ChartTfBar from '../../../components/chart/pane/ChartTfBar'
```

Replace `<div className={styles.tfBar}> … </div>` with `<ChartTfBar …>`, keeping `<ChartMetaRow …/>` and the existing `<div className={styles.tfBarRight}> … </div>` as its children:

```jsx
<ChartTfBar
  tf={tf}
  visibleTfs={visibleTfs}
  onTf={setTf}
  menu={{
    favorites: Array.isArray(hdr.timeframes) ? hdr.timeframes : [],
    customCodes: customTfs,
    onToggleFav: toggleTfFav,
    onAddCustom: addCustomTf,
    onRemoveCustom: removeCustomTf,
    themeVars: menuVars,
  }}
  styles={styles}
>
  <ChartMetaRow … />
  <div className={styles.tfBarRight}>…unchanged…</div>
</ChartTfBar>
```

Then delete the now-unused `tfMenuOpen` / `tfMenuAnchor` state from `ChartWidget.jsx` (the component owns them).

- [ ] **Step 4: Run the rail**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/widgets/`
Expected: `Tests 26 passed`, no test file edited.

- [ ] **Step 5: Prove coverage survived**

Mutate `ChartTfBar.jsx`: change `visibleTfs.map` to `visibleTfs.slice(0, 2).map`. Re-run — the TF-bar render test must FAIL. Restore and confirm 26/26.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/chart/pane/ChartTfBar.jsx app/src/pages/charts/widgets/ChartWidget.jsx
git commit -m "refactor(charts): extract ChartTfBar from ChartWidget

Timeframe buttons + chevron menu, menu state now local to the component.
Rail green at 26/26; mutation lethal."
```

---

### Task 5: Extract `useChartSurfaceSettings`

Lifts settings resolution so a non-workspace surface can get the same behavior by passing `stored=null` (read + write the user's global `chart_settings`).

**Files:**
- Create: `app/src/components/chart/pane/useChartSurfaceSettings.js`
- Create: `app/src/components/chart/pane/useChartSurfaceSettings.test.js`
- Modify: `app/src/pages/charts/widgets/ChartWidget.jsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useChartSurfaceSettings({ stored, onStore, chartsTheme })` → `{ cs, menuVars, write(nextFull), patchHeader(patch) }`.
  - `stored = null` → reads the global `chart_settings` pref; `write` persists there.
  - `stored = <blob>` + `onStore` → reads that blob; `write` calls `onStore(next)` and never touches the global pref.

- [ ] **Step 1: Rebase**

```bash
git fetch origin && git rebase origin/master
```

- [ ] **Step 2: Write the failing test**

Create `app/src/components/chart/pane/useChartSurfaceSettings.test.js`:

```js
import { renderHook, act } from '@testing-library/react'
import { vi } from 'vitest'

const setPref = vi.fn()
vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: { chart_settings: { background: '#111' } }, setPref, loading: false }),
}))

import useChartSurfaceSettings from './useChartSurfaceSettings'

beforeEach(() => setPref.mockClear())

test('with stored=null it reads the global blob', () => {
  const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
  expect(result.current.cs.background).toBe('#111')
})

test('with stored=null a write persists to the global chart_settings pref', () => {
  const { result } = renderHook(() => useChartSurfaceSettings({ stored: null }))
  act(() => { result.current.write({ ...result.current.cs, background: '#222' }) })
  expect(setPref).toHaveBeenCalledWith('chart_settings', expect.objectContaining({ background: '#222' }))
})

test('with a stored blob it reads that blob and NEVER writes the global pref', () => {
  const onStore = vi.fn()
  const { result } = renderHook(() =>
    useChartSurfaceSettings({ stored: { background: '#333' }, onStore }))
  expect(result.current.cs.background).toBe('#333')
  act(() => { result.current.write({ ...result.current.cs, background: '#444' }) })
  expect(onStore).toHaveBeenCalledWith(expect.objectContaining({ background: '#444' }))
  expect(setPref).not.toHaveBeenCalled()
})

// The decisive case: a FRESH workspace widget has no stored blob yet, but must
// still write to its host and never to the global pref. This is the assertion
// that makes the `stored || onStore` guard load-bearing.
test('stored=null WITH onStore routes the write to the host, not the global pref', () => {
  const onStore = vi.fn()
  const { result } = renderHook(() => useChartSurfaceSettings({ stored: null, onStore }))
  act(() => { result.current.write({ ...result.current.cs, background: '#555' }) })
  expect(onStore).toHaveBeenCalledWith(expect.objectContaining({ background: '#555' }))
  expect(setPref).not.toHaveBeenCalled()
})

test('patchHeader merges into header and marks the preset custom', () => {
  const onStore = vi.fn()
  const { result } = renderHook(() =>
    useChartSurfaceSettings({ stored: { background: '#333' }, onStore }))
  act(() => { result.current.patchHeader({ showUctRating: false }) })
  expect(onStore).toHaveBeenCalledWith(expect.objectContaining({
    preset: 'custom',
    header: expect.objectContaining({ showUctRating: false, showMarketCap: true }),
  }))
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd app && npx vitest run --pool=threads src/components/chart/pane/useChartSurfaceSettings.test.js`
Expected: FAIL — `Failed to resolve import "./useChartSurfaceSettings"`.

- [ ] **Step 4: Implement the hook**

Create `app/src/components/chart/pane/useChartSurfaceSettings.js`:

```js
import { useCallback, useMemo } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import { mergeChartSettings } from '../chartDefaults'
import { menuThemeVars } from '../../../utils/dividerColor'

// Resolves the chart settings a surface should render with, and gives it one
// write sink.
//
//   stored = null  -> the user's ONE chart: read + write the global
//                     chart_settings pref. This is what every non-workspace
//                     surface passes, so a popup IS your chart.
//   stored = blob  -> a surface that owns its own settings (a /charts widget or
//                     tab). Writes go to onStore and NEVER to the global pref —
//                     that isolation is load-bearing.
export default function useChartSurfaceSettings({ stored = null, onStore = null, chartsTheme = 'default' } = {}) {
  const { prefs, setPref } = usePreferences()
  const globalCs = useMemo(() => mergeChartSettings(prefs.chart_settings), [prefs.chart_settings])
  const storedCs = useMemo(() => (stored ? mergeChartSettings(stored) : null), [stored])
  const cs = storedCs || globalCs

  const write = useCallback((nextFull) => {
    if (stored || onStore) onStore?.(nextFull)
    else setPref('chart_settings', nextFull)
  }, [stored, onStore, setPref])

  const patchHeader = useCallback((patch) => {
    write({ ...cs, header: { ...cs.header, ...patch }, preset: 'custom' })
  }, [cs, write])

  const menuCanvasColor = chartsTheme === 'sunrise'
    ? '#eaf3fb'
    : (cs.bgMode === 'gradient' ? (cs.bgGradient?.top || cs.background) : cs.background)
  const menuGradient = (chartsTheme !== 'sunrise' && cs.bgMode === 'gradient' && cs.bgGradient)
    ? { top: cs.bgGradient.top, bottom: cs.bgGradient.bottom }
    : null
  const menuVars = useMemo(
    () => menuThemeVars(menuCanvasColor, menuGradient ? { gradient: menuGradient } : undefined) || {},
    [menuCanvasColor, menuGradient?.top, menuGradient?.bottom],
  )

  return { cs, menuVars, write, patchHeader }
}
```

- [ ] **Step 5: Run it and watch it pass**

Run: `cd app && npx vitest run --pool=threads src/components/chart/pane/useChartSurfaceSettings.test.js`
Expected: `Tests 5 passed`.

- [ ] **Step 6: Rewire ChartWidget to use the hook**

In `ChartWidget.jsx`, replace the `globalCs` / `activeStoredCs` / `chartCs` / `writeActiveSettings` / `menuCanvasColor` / `menuGradient` / `menuVars` / `patchHeader` block with:

```jsx
const { cs: chartCs, menuVars, write: writeActiveSettings, patchHeader } = useChartSurfaceSettings({
  stored: activeStoredSettings,
  onStore: (next) => {
    if (isMainTab) onOptsChange?.({ ...(opts || {}), settings: next })
    else if (activeExtra) onOptsChange?.(patchChartTab(opts, activeExtra.id, { settings: next }))
  },
  chartsTheme,
})
```

⚠️ **The workspace must keep writing to `opts`, never the global pref, even on a fresh widget whose `activeStoredSettings` is still `null`.** That is why `write` branches on `stored || onStore` rather than `stored` alone — passing `onStore` is sufficient to opt out of the global write. Keep `usePreferences` imported in `ChartWidget.jsx`: `prefs`/`setPref` are still used for `chart_saved_colors` and `charts_vol_pane_pct`.

- [ ] **Step 7: Run the full rail**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/widgets/ src/components/chart/pane/`
Expected: `Tests 31 passed` (26 + 5), no test file edited.

- [ ] **Step 8: Prove the isolation guard is lethal**

Mutate `useChartSurfaceSettings.js`: change `if (stored || onStore)` to `if (stored)`. Re-run — `stored=null WITH onStore routes the write to the host, not the global pref` must FAIL (a fresh widget would start writing the global blob, silently restyling every other chart). Restore, re-run, confirm all green.

This is the highest-stakes mutation in the plan: without the guard, a brand-new `/charts` widget writes through to the user's global chart the first time any setting is touched.

- [ ] **Step 9: Commit**

```bash
git add app/src/components/chart/pane/useChartSurfaceSettings.js app/src/components/chart/pane/useChartSurfaceSettings.test.js app/src/pages/charts/widgets/ChartWidget.jsx
git commit -m "refactor(charts): extract useChartSurfaceSettings

stored=null reads+writes the global chart_settings (a popup IS your chart);
a surface passing onStore keeps full isolation. Rail green at 31/31."
```

---

### Task 6: Compose `ChartPane` and reduce `ChartWidget` to an adapter

**Files:**
- Create: `app/src/components/chart/pane/ChartPane.jsx`
- Create: `app/src/components/chart/pane/ChartPane.test.jsx`
- Modify: `app/src/pages/charts/widgets/ChartWidget.jsx`

**Interfaces:**
- Consumes: `ChartIdentityRow` (T3), `ChartTfBar` (T4), `ChartMetaRow` (T2), `useChartSurfaceSettings` (T5).
- Produces: `<ChartPane sym tf onSymbolChange onTfChange density stored onStore stockChartProps slots />` — the component every Phase-B surface mounts.

- [ ] **Step 1: Rebase**

```bash
git fetch origin && git rebase origin/master
```

- [ ] **Step 2: Write the failing test**

Create `app/src/components/chart/pane/ChartPane.test.jsx` with the mock surface from Task 1 (paths re-based to `../../../`), plus:

```jsx
test('renders identity, timeframe bar and chart from props alone', () => {
  render(<ChartPane sym="NVDA" tf="D" onSymbolChange={() => {}} onTfChange={() => {}} />)
  expect(screen.getByTestId('chart-sym').textContent).toBe('NVDA')
  expect(screen.getByRole('button', { name: '1D' })).toBeTruthy()
  expect(screen.getByText('Market Cap')).toBeTruthy()
})

test('density="compact" drops the meta row and the session toggle, keeps identity + timeframes', () => {
  render(<ChartPane sym="NVDA" tf="D" density="compact" onTfChange={() => {}} />)
  expect(screen.queryByText('Market Cap')).toBeNull()
  expect(screen.queryByRole('group', { name: 'Chart session view' })).toBeNull()
  expect(screen.getByTestId('sym-label')).toBeTruthy()
  expect(screen.getByRole('button', { name: '1D' })).toBeTruthy()
})

test('omitting onSymbolChange renders a static, non-interactive label', () => {
  render(<ChartPane sym="NVDA" tf="D" onTfChange={() => {}} />)
  expect(screen.getByTestId('sym-label')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /NVDA/ })).toBeNull()
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd app && npx vitest run --pool=threads src/components/chart/pane/ChartPane.test.jsx`
Expected: FAIL — `Failed to resolve import "./ChartPane"`.

- [ ] **Step 4: Implement ChartPane**

Create `app/src/components/chart/pane/ChartPane.jsx` composing T2–T5 plus `StockChart`, `ChartSettingsModal`, the `tabIndex={0}` focus surface and the type-to-search keydown handler — lifted verbatim from `ChartWidget.jsx` (`handleChartClick`, `handleChartKeyDown`, `TICKER_KEY_RE`, `handleSymbolChange`'s rAF refocus). `density === 'compact'` suppresses `<ChartMetaRow>`, the session toggle (`session={null}`) and the clock (`showClock={false}`). Host-specific chrome arrives through `slots.tfBarRight` / `slots.headerRight`.

- [ ] **Step 5: Run it and watch it pass**

Run: `cd app && npx vitest run --pool=threads src/components/chart/pane/ChartPane.test.jsx`
Expected: `Tests 3 passed`.

- [ ] **Step 6: Reduce ChartWidget to an adapter**

`ChartWidget.jsx` renders `<ChartPane>` and supplies only workspace concerns: color-group `sym`, per-tab `tf`, `stored`/`onStore` tab routing, `crosshairBus` wiring, `activeChartRef` hotkey arbitration, and `slots.tfBarRight` = `LeverageInverseControl` + add-tab + gear + `ShareToFloor`, with `ChartTabStrip` above.

- [ ] **Step 7: Run everything**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/ src/components/chart/`
Expected: all green, `Tests 34 passed` in the touched files, **no pre-existing test edited**.

- [ ] **Step 8: Full-suite + bundle check**

```bash
cd app && npx vitest run --pool=threads 2>&1 | tail -8
cd app && npm run build 2>&1 | tail -20
```

Expected: full suite at or above the 4,215-test baseline with 0 failures. Record the entry-chunk gzip size and compare against `origin/master` — `ChartPane` must not enlarge the eager entry chunk (it is imported only by already-lazy surfaces in Phase B).

- [ ] **Step 9: Live-surface verification — the gate the tests cannot be**

Roughly 4,000 green tests missed six contract defects on the Research/Calendar work; component-boundary bugs are invisible to fixtures that assert against themselves. Build and open `/charts` and confirm by eye, against the reference screenshot in the spec: company name + day change, REGULAR HOURS / INCLUDE POST-MARKET toggling, live clock ticking, MARKET CAP / NEXT EARNINGS / UCT RATING populated, all 8 TF buttons + ⌄ menu (favorite/unfavorite, add/remove a custom interval), gear opens settings and a change persists across reload, chart tabs add/close/rename, crosshair still syncs between two chart widgets, type-to-search still opens on a bare letter.

- [ ] **Step 10: Commit**

```bash
git add app/src/components/chart/pane/ChartPane.jsx app/src/components/chart/pane/ChartPane.test.jsx app/src/pages/charts/widgets/ChartWidget.jsx
git commit -m "refactor(charts): ChartPane composes the shell; ChartWidget is now an adapter

/charts renders identically; ChartWidget keeps only workspace concerns
(color groups, crosshair bus, hotkey arbitration, tabs, share). ChartPane is
the component every other chart surface mounts in Phase B."
```

---

## Self-review notes

**Spec coverage.** Spec steps 0–6 map to Tasks 1–6. Spec steps 7–15 (surface adoption) are deliberately a separate plan — Phase A produces working, testable software on its own (`/charts` unchanged, `ChartPane` exists and is tested standalone) and Phase B cannot start until it lands.

**Known carried debt, to close in Phase C.** Extracted components in `components/chart/pane/` import `ChartsWorkspace.module.css` and two components from `pages/charts/widgets/` — a components→pages dependency that points the wrong way. This is deliberate for Phase A: moving the CSS in the same commits as the extraction would make every diff unreviewable and would risk changing hashed class names. Move `ChartDayGain`, `ChartMarketClock`, `TimeframeMenu` and the relevant CSS into `components/chart/pane/` once Phase B has proven the boundary.

**Deliberately not covered by tests.** Crosshair sync and hotkey arbitration have no unit coverage before or after; Task 6 Step 9 verifies them by hand. Adding coverage there is worthwhile but is not a refactor prerequisite.
