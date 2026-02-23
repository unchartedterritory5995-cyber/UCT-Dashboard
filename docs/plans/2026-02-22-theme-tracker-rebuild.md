# Theme Tracker Rebuild Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the Theme Tracker tile to show expandable ETF rows with stock chip holdings, and upgrade TickerPopup to a full 5-tab chart modal (Daily/Weekly via Finviz, 1hr/30min/5min via TradingView).

**Architecture:** Three-layer change — (1) backend passes holdings through the API, (2) TickerPopup gets upgraded to full chart modal with tabs, (3) ThemeTracker grows expandable rows that render stock chips wired to the upgraded modal.

**Tech Stack:** React 18, CSS Modules, Finviz chart images (static URL, no API key), TradingView widget iframe (free embed, no API key), FastAPI backend, pytest, vitest

---

## Context: Key Files

- `app/src/components/tiles/ThemeTracker.jsx` — current tile (no holdings, no expand)
- `app/src/components/tiles/ThemeTracker.module.css` — current styles
- `app/src/components/tiles/ThemeTracker.test.jsx` — 3 existing tests (need update)
- `app/src/components/TickerPopup.jsx` — exists: hover preview + basic modal (Finviz daily only)
- `app/src/components/TickerPopup.module.css` — exists (need to extend for tabs)
- `app/src/components/TickerPopup.test.jsx` — exists (need to extend)
- `api/services/engine.py` — `_normalize_themes()` at line ~158 strips holdings (needs fix)

## Chart URLs

- **Finviz Daily:** `https://finviz.com/chart.ashx?t={sym}&ty=c&ta=1&p=d&s=l`
- **Finviz Weekly:** `https://finviz.com/chart.ashx?t={sym}&ty=c&ta=1&p=w&s=l`
- **TradingView iframe:** `https://www.tradingview.com/widgetembed/?symbol={sym}&interval={interval}&theme=dark&style=1&locale=en&hide_top_toolbar=0&hideideas=1`
  - 5min → interval=5, 30min → interval=30, 1hr → interval=60

---

## Task 1: Pass Holdings Through the API

**Files:**
- Modify: `api/services/engine.py` (~line 158–195, `_normalize_themes()`)
- Create: `tests/test_themes_holdings.py`

**Step 1: Write the failing test**

Create `C:\Users\Patrick\uct-dashboard\tests\test_themes_holdings.py`:

```python
import pytest
from api.services.engine import _normalize_themes

RAW_THEMES = {
    "SIL": {
        "name": "Silver Miners",
        "ticker": "SIL",
        "etf_name": "Global X Silver Miners ETF",
        "1W": 11.47,
        "1M": 8.2,
        "3M": 15.3,
        "holdings": [
            {"sym": "CDE", "name": "Coeur Mining", "pct": 8.5},
            {"sym": "HL", "name": "Hecla Mining", "pct": 7.2},
            {"sym": "BVN", "name": "Buenaventura", "pct": 6.1},
        ],
        "intl_holdings": [
            {"sym": "FRES.L", "name": "Fresnillo", "pct": 5.5},
            {"sym": "MAG.TO", "name": "MAG Silver", "pct": 4.2},
        ],
    },
    "XLK": {
        "name": "Technology",
        "ticker": "XLK",
        "etf_name": "SPDR Technology Select Sector ETF",
        "1W": -2.3,
        "1M": 1.5,
        "3M": 8.0,
        "holdings": [
            {"sym": "AAPL", "name": "Apple", "pct": 22.0},
        ],
        "intl_holdings": [],
    },
}


def test_holdings_included_in_leaders():
    result = _normalize_themes(RAW_THEMES, "1W")
    sil = next(t for t in result["leaders"] if t["ticker"] == "SIL")
    assert "holdings" in sil
    assert sil["holdings"] == ["CDE", "HL", "BVN"]


def test_intl_count_included():
    result = _normalize_themes(RAW_THEMES, "1W")
    sil = next(t for t in result["leaders"] if t["ticker"] == "SIL")
    assert sil["intl_count"] == 2


def test_etf_name_included():
    result = _normalize_themes(RAW_THEMES, "1W")
    sil = next(t for t in result["leaders"] if t["ticker"] == "SIL")
    assert sil["etf_name"] == "Global X Silver Miners ETF"


def test_holdings_included_in_laggards():
    result = _normalize_themes(RAW_THEMES, "1W")
    xlk = next(t for t in result["laggards"] if t["ticker"] == "XLK")
    assert xlk["holdings"] == ["AAPL"]
    assert xlk["intl_count"] == 0


def test_missing_holdings_returns_empty_list():
    raw = {"ETF": {"name": "Test", "ticker": "ETF", "1W": 1.0}}
    result = _normalize_themes(raw, "1W")
    assert result["leaders"][0]["holdings"] == []
    assert result["leaders"][0]["intl_count"] == 0
```

**Step 2: Run test to verify it fails**

```bash
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/test_themes_holdings.py -v
```
Expected: FAIL — `holdings` key missing from result

**Step 3: Update `_normalize_themes()` in engine.py**

Find `_normalize_themes()` (around line 158). Replace the entire function with:

```python
def _normalize_themes(raw, period: str = "1W") -> dict:
    """
    fetch_theme_tracker() returns a dict keyed by ETF ticker.
    Each value has: name, ticker, etf_name, 1W, 1M, 3M, holdings, intl_holdings.

    Returns ALL themes sorted by selected period with holdings included.
    """
    if not isinstance(raw, dict) or not raw:
        return {"leaders": [], "laggards": [], "period": period}

    items = []
    for ticker, data in raw.items():
        if not isinstance(data, dict):
            continue
        pct_val = data.get(period, 0) or 0
        pct_str = f"{pct_val:+.2f}%" if isinstance(pct_val, (int, float)) else str(pct_val)
        bar = min(100, max(0, abs(pct_val) * 8)) if isinstance(pct_val, (int, float)) else 50

        raw_holdings = data.get("holdings", [])
        holdings = [
            h["sym"] for h in raw_holdings
            if isinstance(h, dict) and h.get("sym")
        ]

        raw_intl = data.get("intl_holdings", [])
        intl_count = len(raw_intl) if isinstance(raw_intl, list) else 0

        items.append({
            "name": data.get("name", ticker),
            "ticker": ticker,
            "etf_name": data.get("etf_name", ""),
            "pct": pct_str,
            "pct_val": pct_val,
            "bar": round(bar),
            "holdings": holdings,
            "intl_count": intl_count,
        })

    items.sort(key=lambda x: x["pct_val"], reverse=True)

    def clean(item):
        return {
            "name": item["name"],
            "ticker": item["ticker"],
            "etf_name": item["etf_name"],
            "pct": item["pct"],
            "bar": item["bar"],
            "holdings": item["holdings"],
            "intl_count": item["intl_count"],
        }

    leaders  = [clean(i) for i in items if i["pct_val"] >= 0]
    laggards = [clean(i) for i in reversed(items) if i["pct_val"] < 0]

    return {"leaders": leaders, "laggards": laggards, "period": period}
```

**Step 4: Run tests to verify they pass**

```bash
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/test_themes_holdings.py -v
```
Expected: 5 tests PASS

**Step 5: Run full backend suite**

```bash
python -m pytest tests/ -v 2>&1 | tail -10
```
Expected: all pass

**Step 6: Commit**

```bash
git add api/services/engine.py tests/test_themes_holdings.py
git commit -m "feat: include holdings and etf_name in themes API response"
```

---

## Task 2: Upgrade TickerPopup to Full Chart Modal

**Files:**
- Modify: `app/src/components/TickerPopup.jsx`
- Modify: `app/src/components/TickerPopup.module.css`
- Modify: `app/src/components/TickerPopup.test.jsx`

**Step 1: Write the failing tests**

Read `app/src/components/TickerPopup.test.jsx` first, then add these tests to it:

```jsx
// Add to existing test file — keep all existing tests, add below:

test('modal shows tab buttons for all timeframes', async () => {
  const user = userEvent.setup()
  render(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  expect(screen.getByRole('button', { name: '5min' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '30min' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '1hr' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Daily' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Weekly' })).toBeInTheDocument()
})

test('modal shows finviz chart by default (Daily tab)', async () => {
  const user = userEvent.setup()
  render(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  const img = screen.getByAltText(/NVDA Daily chart/)
  expect(img).toBeInTheDocument()
  expect(img.src).toContain('finviz.com')
  expect(img.src).toContain('p=d')
})

test('modal shows TradingView iframe when 5min tab clicked', async () => {
  const user = userEvent.setup()
  render(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  await user.click(screen.getByRole('button', { name: '5min' }))
  const frame = screen.getByTitle(/NVDA 5min/)
  expect(frame).toBeInTheDocument()
  expect(frame.src).toContain('tradingview.com')
})

test('modal has open in finviz and tradingview links', async () => {
  const user = userEvent.setup()
  render(<TickerPopup sym="NVDA" />)
  await user.click(screen.getByTestId('ticker-NVDA'))
  expect(screen.getByText(/Open in FinViz/)).toBeInTheDocument()
  expect(screen.getByText(/Open in TradingView/)).toBeInTheDocument()
})
```

**Step 2: Run to verify new tests fail**

```bash
cd C:\Users\Patrick\uct-dashboard\app
npx vitest run src/components/TickerPopup.test.jsx
```
Expected: existing tests PASS, new 4 tests FAIL

**Step 3: Rewrite TickerPopup.jsx**

Replace the entire content of `app/src/components/TickerPopup.jsx`:

```jsx
// app/src/components/TickerPopup.jsx
import { useState } from 'react'
import styles from './TickerPopup.module.css'

const TABS = ['5min', '30min', '1hr', 'Daily', 'Weekly']
const TV_INTERVALS = { '5min': '5', '30min': '30', '1hr': '60' }
const FV_PERIODS   = { 'Daily': 'd', 'Weekly': 'w' }

const finvizChart = (sym, period) =>
  `https://finviz.com/chart.ashx?t=${sym}&ty=c&ta=1&p=${period}&s=l`

const tvUrl = (sym, interval) =>
  `https://www.tradingview.com/widgetembed/?symbol=${sym}&interval=${interval}&theme=dark&style=1&locale=en&hide_top_toolbar=0&hideideas=1`

export default function TickerPopup({ sym, children }) {
  const [hovered, setHovered] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [tab, setTab] = useState('Daily')

  return (
    <>
      <span
        className={styles.trigger}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => { setModalOpen(true); setTab('Daily') }}
        role="button"
        aria-label={`View chart for ${sym}`}
        data-testid={`ticker-${sym}`}
      >
        {children ?? sym}
        {hovered && (
          <div className={styles.popup}>
            <img
              src={finvizChart(sym, 'd')}
              alt={`${sym} preview`}
              className={styles.popupChart}
            />
          </div>
        )}
      </span>

      {modalOpen && (
        <div
          className={styles.overlay}
          onClick={() => setModalOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`${sym} chart`}
          data-testid="chart-modal"
        >
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <span className={styles.modalSym}>{sym}</span>
              <button
                className={styles.closeBtn}
                onClick={() => setModalOpen(false)}
                aria-label="Close chart"
              >
                × close
              </button>
            </div>

            <div className={styles.modalTabs}>
              {TABS.map(t => (
                <button
                  key={t}
                  className={`${styles.modalTab} ${tab === t ? styles.modalTabActive : ''}`}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            <div className={styles.chartArea}>
              {FV_PERIODS[tab] ? (
                <img
                  src={finvizChart(sym, FV_PERIODS[tab])}
                  alt={`${sym} ${tab} chart`}
                  className={styles.modalChart}
                />
              ) : (
                <iframe
                  src={tvUrl(sym, TV_INTERVALS[tab])}
                  title={`${sym} ${tab}`}
                  className={styles.tvFrame}
                  frameBorder="0"
                  allowTransparency="true"
                  scrolling="no"
                />
              )}
            </div>

            <div className={styles.modalFooter}>
              <a
                href={`https://finviz.com/quote.ashx?t=${sym}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.footerLink}
              >
                Open in FinViz →
              </a>
              <a
                href={`https://www.tradingview.com/chart/?symbol=${sym}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.footerLink}
              >
                Open in TradingView →
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

**Step 4: Update TickerPopup.module.css**

Read the current `app/src/components/TickerPopup.module.css` first, then ADD these classes at the end (keep all existing ones):

```css
/* Chart modal tabs */
.modalTabs {
  display: flex;
  gap: 6px;
  padding: 12px 16px 0;
}
.modalTab {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 1px;
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.modalTab:hover { color: var(--text-bright); border-color: var(--border-accent); }
.modalTabActive { color: var(--ut-green-bright) !important; border-color: var(--ut-green-bright) !important; }

/* Chart area */
.chartArea {
  padding: 12px 16px;
  min-height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.modalChart {
  width: 100%;
  max-width: 760px;
  border-radius: 4px;
  display: block;
}
.tvFrame {
  width: 100%;
  height: 400px;
  border: none;
  border-radius: 4px;
}

/* Footer links */
.modalFooter {
  display: flex;
  gap: 24px;
  padding: 8px 16px 14px;
  justify-content: center;
  border-top: 1px solid var(--border);
}
.footerLink {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 11px;
  color: var(--text-muted);
  text-decoration: none;
  transition: color 0.15s;
}
.footerLink:hover { color: var(--ut-green-bright); }
```

**Step 5: Run tests to verify they pass**

```bash
cd C:\Users\Patrick\uct-dashboard\app
npx vitest run src/components/TickerPopup.test.jsx
```
Expected: all tests PASS (existing + 4 new)

**Step 6: Commit**

```bash
cd C:\Users\Patrick\uct-dashboard
git add app/src/components/TickerPopup.jsx app/src/components/TickerPopup.module.css app/src/components/TickerPopup.test.jsx
git commit -m "feat: upgrade TickerPopup to full chart modal — 5 tabs, TradingView iframe, dual links"
```

---

## Task 3: Rebuild ThemeTracker with Expandable Rows

**Files:**
- Modify: `app/src/components/tiles/ThemeTracker.jsx`
- Modify: `app/src/components/tiles/ThemeTracker.module.css`
- Modify: `app/src/components/tiles/ThemeTracker.test.jsx`

**Step 1: Update the test first**

Replace `app/src/components/tiles/ThemeTracker.test.jsx` with:

```jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: vi.fn(() => ({ data: undefined }))
}))

import ThemeTracker from './ThemeTracker'

const mockData = {
  leaders: [
    {
      name: 'Silver Miners', ticker: 'SIL', etf_name: 'Global X Silver Miners ETF',
      pct: '+11.47%', bar: 85, holdings: ['CDE', 'HL', 'BVN'], intl_count: 6,
    },
    {
      name: 'Junior Gold Miners', ticker: 'GDXJ', etf_name: 'VanEck Junior Gold Miners ETF',
      pct: '+9.82%', bar: 73, holdings: ['GDX', 'EGO', 'HL'], intl_count: 7,
    },
  ],
  laggards: [
    {
      name: 'Bitcoin Miners', ticker: 'WGMI', etf_name: 'Valkyrie Bitcoin Miners ETF',
      pct: '-3.13%', bar: 25, holdings: ['MARA', 'RIOT'], intl_count: 0,
    },
  ],
  period: '1W'
}

test('renders leaders and laggards', () => {
  render(<ThemeTracker data={mockData} />)
  expect(screen.getByText('Silver Miners')).toBeInTheDocument()
  expect(screen.getByText('Bitcoin Miners')).toBeInTheDocument()
  expect(screen.getByText('+11.47%')).toBeInTheDocument()
  expect(screen.getByText('-3.13%')).toBeInTheDocument()
})

test('renders period tab buttons', () => {
  render(<ThemeTracker data={mockData} />)
  expect(screen.getByRole('button', { name: '1W' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '1M' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '3M' })).toBeInTheDocument()
})

test('renders loading when no data', () => {
  render(<ThemeTracker data={null} />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
})

test('clicking theme row expands to show stock chips', async () => {
  const user = userEvent.setup()
  render(<ThemeTracker data={mockData} />)
  await user.click(screen.getByText('Silver Miners'))
  expect(screen.getByText('CDE')).toBeInTheDocument()
  expect(screen.getByText('HL')).toBeInTheDocument()
  expect(screen.getByText('BVN')).toBeInTheDocument()
})

test('shows intl badge when intl_count > 0', async () => {
  const user = userEvent.setup()
  render(<ThemeTracker data={mockData} />)
  await user.click(screen.getByText('Silver Miners'))
  expect(screen.getByText(/\+6 intl/)).toBeInTheDocument()
})

test('no intl badge when intl_count is 0', async () => {
  const user = userEvent.setup()
  render(<ThemeTracker data={mockData} />)
  await user.click(screen.getByText('Bitcoin Miners'))
  expect(screen.queryByText(/intl/)).not.toBeInTheDocument()
})
```

**Step 2: Run to verify new tests fail**

```bash
cd C:\Users\Patrick\uct-dashboard\app
npx vitest run src/components/tiles/ThemeTracker.test.jsx
```
Expected: first 3 tests PASS, last 3 FAIL (no expand yet)

**Step 3: Rewrite ThemeTracker.jsx**

Replace entire content of `app/src/components/tiles/ThemeTracker.jsx`:

```jsx
// app/src/components/tiles/ThemeTracker.jsx
import { useState } from 'react'
import useSWR from 'swr'
import TileCard from '../TileCard'
import TickerPopup from '../TickerPopup'
import styles from './ThemeTracker.module.css'

const fetcher = (url) => fetch(url).then(r => r.json())
const PERIODS = ['1W', '1M', '3M']

function ThemeRow({ name, ticker, etf_name, pct, bar, holdings, intl_count, positive }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={styles.themeBlock}>
      <div
        className={`${styles.row} ${styles.rowClickable}`}
        onClick={() => setExpanded(e => !e)}
      >
        <span className={styles.name}>{name}</span>
        <div className={styles.barWrap}>
          <div
            className={`${styles.bar} ${positive ? styles.barGain : styles.barLoss}`}
            style={{ width: `${Math.min(100, bar)}%` }}
          />
        </div>
        <span className={`${styles.pct} ${positive ? styles.pos : styles.neg}`}>{pct}</span>
        <span className={styles.caret}>{expanded ? '▾' : '•'}</span>
      </div>

      {expanded && (
        <div className={styles.expanded}>
          <div className={styles.etfLabel}>
            <span className={styles.etfTicker}>{ticker}</span>
            <span className={styles.etfName}>{etf_name}</span>
          </div>
          <div className={styles.chips}>
            {holdings.map(sym => (
              <TickerPopup key={sym} sym={sym}>
                <span className={styles.chip}>{sym}</span>
              </TickerPopup>
            ))}
            {intl_count > 0 && (
              <span className={styles.intlBadge}>🌐 +{intl_count} intl</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ThemeTracker({ data: propData }) {
  const [period, setPeriod] = useState('1W')
  const { data: fetched } = useSWR(
    propData !== undefined ? null : `/api/themes?period=${period}`,
    fetcher
  )
  const data = propData !== undefined ? propData : fetched

  return (
    <TileCard title="Theme Tracker" badge={period}>
      <div className={styles.tabs}>
        {PERIODS.map(p => (
          <button
            key={p}
            className={`${styles.tab} ${period === p ? styles.tabActive : ''}`}
            onClick={() => setPeriod(p)}
          >
            {p}
          </button>
        ))}
      </div>

      {!data ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <div className={styles.cols}>
          <div className={styles.col}>
            <div className={styles.colHd} style={{ color: 'var(--gain)' }}>
              ▲ LEADERS ({(data.leaders ?? []).length})
            </div>
            <div className={styles.scroll}>
              {(data.leaders ?? []).map(item => (
                <ThemeRow key={item.ticker} {...item} positive />
              ))}
            </div>
          </div>
          <div className={styles.col}>
            <div className={styles.colHd} style={{ color: 'var(--loss)' }}>
              ▼ LAGGARDS ({(data.laggards ?? []).length})
            </div>
            <div className={styles.scroll}>
              {(data.laggards ?? []).map(item => (
                <ThemeRow key={item.ticker} {...item} positive={false} />
              ))}
            </div>
          </div>
        </div>
      )}
    </TileCard>
  )
}
```

**Step 4: Add new CSS classes to ThemeTracker.module.css**

Read the current file first, then ADD these classes at the end (keep all existing):

```css
/* Expandable row */
.themeBlock { border-bottom: 1px solid var(--border); }
.themeBlock:last-child { border-bottom: none; }
.row { border-bottom: none; }
.rowClickable { cursor: pointer; user-select: none; }
.rowClickable:hover .name { color: var(--ut-green-bright); }
.caret { font-size: 10px; color: var(--text-muted); flex-shrink: 0; padding-left: 4px; }

/* Expanded holdings */
.expanded { padding: 6px 0 10px; }
.etfLabel {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}
.etfTicker {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  color: var(--ut-green-bright);
}
.etfName {
  font-family: 'Instrument Sans', sans-serif;
  font-size: 10px;
  color: var(--text-muted);
}

/* Stock chips */
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.chip {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  font-weight: 600;
  padding: 3px 7px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--text-bright);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  white-space: nowrap;
  display: inline-block;
}
.chip:hover { border-color: var(--ut-green-bright); color: var(--ut-green-bright); }

/* International badge */
.intlBadge {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 9px;
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 7px;
  align-self: center;
}
```

**Step 5: Run all tests**

```bash
cd C:\Users\Patrick\uct-dashboard\app
npx vitest run src/components/tiles/ThemeTracker.test.jsx
```
Expected: all 6 tests PASS

**Step 6: Run full frontend suite**

```bash
npx vitest run 2>&1 | tail -8
```
Expected: all pass

**Step 7: Run full backend suite**

```bash
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/ -v 2>&1 | tail -10
```
Expected: all pass

**Step 8: Commit and push**

```bash
cd C:\Users\Patrick\uct-dashboard
git add app/src/components/tiles/ThemeTracker.jsx \
        app/src/components/tiles/ThemeTracker.module.css \
        app/src/components/tiles/ThemeTracker.test.jsx
git commit -m "feat: Theme Tracker expandable rows with stock chips and chart modal"
git push origin master
```

---

## Verification

After Railway deploys (~3 min):

1. Open `https://web-production-05cb6.up.railway.app` → Dashboard tab
2. Find the Theme Tracker tile → click any theme name → should expand showing ETF ticker + stock chips
3. Click any stock chip → modal opens with 5 tabs
4. Click `Daily` → Finviz daily chart image loads
5. Click `Weekly` → Finviz weekly chart loads
6. Click `5min` → TradingView iframe loads with candlestick chart
7. Verify `Open in FinViz →` and `Open in TradingView →` links at bottom
8. Click overlay background → modal closes
