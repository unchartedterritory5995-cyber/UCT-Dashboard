# Gap Scanner Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Filter the movers sidebar to only show stocks gapping ≥3% and make each ticker clickable with the full 5-tab chart modal.

**Architecture:** Two-file change — backend adds a `abs(change_pct) >= 3.0` filter to `get_movers()`, frontend wraps each ticker in the existing `TickerPopup` component. No new components, no new endpoints.

**Tech Stack:** FastAPI (Python), React 18, CSS Modules, `TickerPopup` (already built), pytest, vitest

---

## Context: Key Files

- `api/services/massive.py` — `get_movers()` at line 105. Currently returns all top movers from Massive with no gap threshold.
- `app/src/components/MoversSidebar.jsx` — renders ripping/drilling lists. Each ticker is a plain `<span>`. Needs `TickerPopup` wrapping.
- `app/src/components/TickerPopup.jsx` — already built. Accepts `sym` prop + optional `children`. Hover = Finviz preview. Click = 5-tab chart modal.
- `tests/test_movers_filter.py` — does not exist yet (create it)
- `app/src/components/MoversSidebar.test.jsx` — exists, needs new test added

---

## Task 1: Add ≥3% Gap Filter to Backend

**Files:**
- Modify: `api/services/massive.py` (lines 105–136, `get_movers()`)
- Create: `tests/test_movers_filter.py`

**Step 1: Write the failing test**

Create `C:\Users\Patrick\uct-dashboard\tests\test_movers_filter.py`:

```python
import pytest
from unittest.mock import patch, MagicMock


def _make_mover(ticker, change_pct):
    return {"ticker": ticker, "change_pct": change_pct}


def test_gap_filter_excludes_sub_3pct():
    """Stocks moving less than 3% in either direction are excluded."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    mock_client = MagicMock()
    mock_client.get_top_movers.side_effect = lambda direction, limit: (
        [
            _make_mover("NVDA", 5.2),
            _make_mover("AAPL", 1.5),   # < 3% — should be excluded
            _make_mover("TSLA", 3.0),
        ] if direction == "gainers" else [
            _make_mover("META", -4.1),
            _make_mover("AMZN", -2.9),  # < 3% — should be excluded
            _make_mover("GOOG", -3.5),
        ]
    )

    with patch("api.services.massive._get_client", return_value=mock_client):
        result = get_movers()

    ripping_syms = [r["sym"] for r in result["ripping"]]
    drilling_syms = [r["sym"] for r in result["drilling"]]

    assert "NVDA" in ripping_syms
    assert "TSLA" in ripping_syms
    assert "AAPL" not in ripping_syms       # 1.5% excluded

    assert "META" in drilling_syms
    assert "GOOG" in drilling_syms
    assert "AMZN" not in drilling_syms      # 2.9% excluded


def test_gap_filter_includes_exactly_3pct():
    """Stocks at exactly 3.0% are included (boundary condition)."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    mock_client = MagicMock()
    mock_client.get_top_movers.side_effect = lambda direction, limit: (
        [_make_mover("TICK", 3.0)] if direction == "gainers" else
        [_make_mover("TOCK", -3.0)]
    )

    with patch("api.services.massive._get_client", return_value=mock_client):
        result = get_movers()

    assert any(r["sym"] == "TICK" for r in result["ripping"])
    assert any(r["sym"] == "TOCK" for r in result["drilling"])


def test_gap_filter_empty_when_nothing_qualifies():
    """Returns empty lists when no stock meets the 3% threshold."""
    from api.services.massive import get_movers
    from api.services.cache import cache
    cache.invalidate("movers")

    mock_client = MagicMock()
    mock_client.get_top_movers.side_effect = lambda direction, limit: (
        [_make_mover("AAPL", 0.5), _make_mover("MSFT", 1.2)]
        if direction == "gainers" else
        [_make_mover("GOOG", -0.3), _make_mover("META", -2.9)]
    )

    with patch("api.services.massive._get_client", return_value=mock_client):
        result = get_movers()

    assert result["ripping"] == []
    assert result["drilling"] == []
```

**Step 2: Run test to verify it fails**

```bash
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/test_movers_filter.py -v
```

Expected: FAIL — filter not yet applied, `AAPL` and `AMZN` appear in results.

**Step 3: Update `get_movers()` in `api/services/massive.py`**

Find `get_movers()` (around line 105). Replace the `_fmt_mover` function and the `data =` block with this (keep everything else — the docstring, cache check, client init):

```python
def _fmt_mover(row: dict) -> dict[str, str] | None:
    pct = float(row.get("change_pct", 0.0))
    if abs(pct) < 3.0:
        return None
    sign = "+" if pct >= 0 else ""
    return {"sym": row.get("ticker", ""), "pct": f"{sign}{pct:.2f}%"}

data = {
    "ripping":  [m for r in gainers_raw if (m := _fmt_mover(r)) is not None],
    "drilling": [m for r in losers_raw  if (m := _fmt_mover(r)) is not None],
}
```

**Step 4: Run tests to verify they pass**

```bash
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/test_movers_filter.py -v
```

Expected: 3 tests PASS.

**Step 5: Run full backend suite**

```bash
python -m pytest tests/ -v 2>&1 | tail -10
```

Expected: all pass.

**Step 6: Commit**

```bash
git add api/services/massive.py tests/test_movers_filter.py
git commit -m "feat: filter movers sidebar to stocks gapping >=3%"
```

---

## Task 2: Wrap Sidebar Tickers with TickerPopup

**Files:**
- Modify: `app/src/components/MoversSidebar.jsx`
- Modify: `app/src/components/MoversSidebar.test.jsx`

**Step 1: Read the current test file**

Read `C:\Users\Patrick\uct-dashboard\app\src\components\MoversSidebar.test.jsx` to see existing tests.

**Step 2: Add a failing test**

Add this test to the end of `MoversSidebar.test.jsx` (keep all existing tests):

```jsx
test('each ticker sym is wrapped in a TickerPopup trigger', () => {
  const mockData = {
    ripping:  [{ sym: 'NVDA', pct: '+5.20%' }, { sym: 'TSLA', pct: '+3.10%' }],
    drilling: [{ sym: 'META', pct: '-4.10%' }],
  }
  render(<MoversSidebar data={mockData} />)
  // TickerPopup renders data-testid="ticker-{sym}" on each trigger span
  expect(screen.getByTestId('ticker-NVDA')).toBeInTheDocument()
  expect(screen.getByTestId('ticker-TSLA')).toBeInTheDocument()
  expect(screen.getByTestId('ticker-META')).toBeInTheDocument()
})
```

Also add the missing imports if not present at the top of the test file:
```jsx
import { render, screen } from '@testing-library/react'
import MoversSidebar from './MoversSidebar'
```

**Step 3: Run to verify new test fails**

```bash
cd C:\Users\Patrick\uct-dashboard\app
npx vitest run src/components/MoversSidebar.test.jsx
```

Expected: existing tests PASS, new test FAILS (`ticker-NVDA` not found).

**Step 4: Update `MoversSidebar.jsx`**

Replace the entire content of `app/src/components/MoversSidebar.jsx`:

```jsx
// app/src/components/MoversSidebar.jsx
import useSWR from 'swr'
import TickerPopup from './TickerPopup'
import styles from './MoversSidebar.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function MoverSection({ label, items, positive }) {
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionLabel} ${positive ? styles.green : styles.red}`}>
        {positive ? '▲' : '▼'} {label}
      </div>
      {items.map(item => (
        <div key={item.sym} className={styles.row}>
          <TickerPopup sym={item.sym}>
            <span className={styles.sym}>{item.sym}</span>
          </TickerPopup>
          <span className={`${styles.pct} ${positive ? styles.green : styles.red}`}>
            {item.pct}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function MoversSidebar({ data: propData }) {
  const { data: fetched } = useSWR(
    propData !== undefined ? null : '/api/movers',
    fetcher,
    { refreshInterval: 30000 }
  )
  const data = propData !== undefined ? propData : fetched

  return (
    <aside className={styles.sidebar}>
      <div className={styles.title}>MOVERS AT THE OPEN</div>
      {!data ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <>
          <MoverSection label="RIPPING" items={data.ripping ?? []} positive />
          <MoverSection label="DRILLING" items={data.drilling ?? []} positive={false} />
        </>
      )}
    </aside>
  )
}
```

**Step 5: Run all sidebar tests**

```bash
cd C:\Users\Patrick\uct-dashboard\app
npx vitest run src/components/MoversSidebar.test.jsx
```

Expected: all tests PASS (existing + new).

**Step 6: Run full frontend suite**

```bash
npx vitest run 2>&1 | tail -8
```

Expected: all pass.

**Step 7: Commit and push**

```bash
cd C:\Users\Patrick\uct-dashboard
git add app/src/components/MoversSidebar.jsx app/src/components/MoversSidebar.test.jsx
git commit -m "feat: movers sidebar tickers open full chart modal via TickerPopup"
git push origin master
```

---

## Verification

After Railway deploys (~3 min):

1. Open `https://web-production-05cb6.up.railway.app`
2. Right sidebar "MOVERS AT THE OPEN" — only stocks ≥3% gap visible
3. Hover any ticker → Finviz daily chart preview appears
4. Click any ticker → 5-tab chart modal opens (Daily/Weekly/5min/30min/1hr)
5. Press Escape or click backdrop → modal closes
