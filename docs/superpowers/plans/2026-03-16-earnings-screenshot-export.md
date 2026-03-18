# Earnings Screenshot Export Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click PNG export button to the Earnings tile that captures all three sections (BMO, AMC Tonight, AMC Yesterday) as a single screenshot.

**Architecture:** Install `html2canvas`, add an `actions` prop to `TileCard` for header buttons, and wire a camera button in `CatalystFlow` that temporarily expands the scroll container to full height before capturing.

**Tech Stack:** React 19, html2canvas, CSS Modules

---

## File Map

| File | Change |
|------|--------|
| `app/package.json` | Add `html2canvas` dependency |
| `app/src/components/TileCard.jsx` | Add `actions` prop rendered right-aligned in header |
| `app/src/components/TileCard.module.css` | Add `.actions` flex container style |
| `app/src/components/tiles/CatalystFlow.jsx` | Add refs, `captureScreenshot` fn, camera button |
| `app/src/components/tiles/CatalystFlow.module.css` | Add `.exportBtn` style |

---

## Chunk 1: Install dependency and extend TileCard

### Task 1: Install html2canvas

**Files:**
- Modify: `app/package.json`

- [ ] **Step 1: Install the package**

```bash
cd /c/Users/Patrick/uct-dashboard/app && npm install html2canvas
```

Expected: `html2canvas` appears in `package.json` dependencies, no errors.

- [ ] **Step 2: Verify install**

```bash
ls /c/Users/Patrick/uct-dashboard/app/node_modules/html2canvas 2>/dev/null && echo "OK"
```

Expected: `OK`

---

### Task 2: Add `actions` prop to TileCard

**Files:**
- Modify: `app/src/components/TileCard.jsx`
- Modify: `app/src/components/TileCard.module.css`

- [ ] **Step 1: Update TileCard.jsx**

Replace the existing component with:

```jsx
// app/src/components/TileCard.jsx
import { forwardRef } from 'react'
import styles from './TileCard.module.css'

const TileCard = forwardRef(function TileCard({ title, badge, actions, children, className = '' }, ref) {
  return (
    <div ref={ref} className={`${styles.tile} ${className}`}>
      {title && (
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <div className={styles.headerRight}>
            {badge && <span className={styles.badge}>{badge}</span>}
            {actions}
          </div>
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </div>
  )
})

export default TileCard
```

- [ ] **Step 2: Add `.headerRight` style to TileCard.module.css**

Append to the end of the file:

```css
.headerRight {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 3: Verify dashboard still renders**

Start dev server if not running:
```bash
cd /c/Users/Patrick/uct-dashboard/app && npm run dev
```
Open `http://localhost:5173` — all tiles should look identical to before (no visible change yet).

- [ ] **Step 4: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add app/src/components/TileCard.jsx app/src/components/TileCard.module.css app/package.json app/package-lock.json
git commit -m "feat: add actions prop to TileCard + install html2canvas"
```

---

## Chunk 2: Screenshot button in CatalystFlow

### Task 3: Add capture logic and button to CatalystFlow

**Files:**
- Modify: `app/src/components/tiles/CatalystFlow.jsx`
- Modify: `app/src/components/tiles/CatalystFlow.module.css`

- [ ] **Step 1: Add `.exportBtn` style to CatalystFlow.module.css**

Append to end of file:

```css
.exportBtn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 4px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1;
  border-radius: 4px;
  transition: color 0.15s;
}
.exportBtn:hover { color: var(--text-bright); }
.exportBtn:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 2: Update CatalystFlow.jsx**

Full replacement of `CatalystFlow.jsx`:

```jsx
// app/src/components/tiles/CatalystFlow.jsx
import { useState, useRef, useCallback } from 'react'
import useSWR from 'swr'
import TileCard from '../TileCard'
import EarningsModal from './EarningsModal'
import ErrorBoundary from '../ErrorBoundary'
import styles from './CatalystFlow.module.css'

const fetcher = url => fetch(url).then(r => r.json())

function VerdictPill({ verdict }) {
  const v = verdict?.toLowerCase()
  if (v === 'pending') return <span className={`${styles.pill} ${styles.pillPending}`}>PENDING</span>
  if (v === 'beat')    return <span className={`${styles.pill} ${styles.pillBeat}`}>BEAT</span>
  if (v === 'miss')    return <span className={`${styles.pill} ${styles.pillMiss}`}>MISS</span>
  if (v === 'mixed')   return <span className={`${styles.pill} ${styles.pillMixed}`}>MIXED</span>
  return <span className={styles.pillPending}>{verdict ?? '—'}</span>
}

function fmtEps(v) {
  if (v == null) return '—'
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toFixed(2)}`
}

function fmtRev(m) {
  if (m == null) return '—'
  return m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${Math.round(m)}M`
}

function GapCell({ value }) {
  if (value == null) return <span className={styles.muted}>—</span>
  const n = typeof value === 'number' ? value : parseFloat(value)
  if (isNaN(n)) return <span className={styles.muted}>—</span>
  const fmt = n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`
  return <span className={n >= 0 ? styles.pos : styles.neg}>{fmt}</span>
}

function EarningsTable({ rows, label, onSelect, liveGaps }) {
  if (!rows?.length) return null
  return (
    <div className={styles.tableWrap}>
      <div className={styles.tableLabel}>{label}</div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Verdict</th>
            <th>Gap</th>
            <th>EPS Act</th>
            <th>Rev Act</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.sym} className={styles.clickRow} onClick={() => onSelect(row, label)}>
              <td><span className={styles.sym}>{row.sym}</span></td>
              <td><VerdictPill verdict={row.verdict} /></td>
              <td><GapCell value={liveGaps?.[row.sym] ?? row.change_pct} /></td>
              <td>{fmtEps(row.reported_eps)}</td>
              <td>{fmtRev(row.rev_actual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function CatalystFlow({ data: propData }) {
  const { data: fetched } = useSWR(
    propData !== undefined ? null : '/api/earnings',
    fetcher,
    { refreshInterval: 300000 }
  )
  const { data: liveGaps } = useSWR(
    '/api/earnings-gaps',
    fetcher,
    { refreshInterval: 30000 }
  )

  const data = propData !== undefined ? propData : fetched
  const [selected, setSelected] = useState(null)
  const [capturing, setCapturing] = useState(false)
  const tileRef = useRef(null)
  const scrollBodyRef = useRef(null)

  const captureScreenshot = useCallback(async () => {
    if (!tileRef.current || !scrollBodyRef.current || capturing) return
    setCapturing(true)

    const scrollEl = scrollBodyRef.current
    const bodyEl = scrollEl.parentElement   // TileCard's .body div (has overflow:hidden)

    const prevScrollOverflow = scrollEl.style.overflow
    const prevScrollHeight = scrollEl.style.height
    const prevBodyOverflow = bodyEl.style.overflow
    const prevBodyHeight = bodyEl.style.height

    // Expand both containers so all rows are visible before capture
    scrollEl.style.overflow = 'visible'
    scrollEl.style.height = 'auto'
    bodyEl.style.overflow = 'visible'
    bodyEl.style.height = 'auto'

    try {
      const { default: html2canvas } = await import('html2canvas')
      const bgColor = getComputedStyle(tileRef.current).backgroundColor
      const canvas = await html2canvas(tileRef.current, {
        backgroundColor: bgColor || '#0d0d0f',
        scale: 2,
        useCORS: true,
        logging: false,
      })

      const date = new Date().toISOString().slice(0, 10)
      const link = document.createElement('a')
      link.download = `earnings-${date}.png`
      link.href = canvas.toDataURL('image/png')
      link.click()
    } finally {
      scrollEl.style.overflow = prevScrollOverflow
      scrollEl.style.height = prevScrollHeight
      bodyEl.style.overflow = prevBodyOverflow
      bodyEl.style.height = prevBodyHeight
      setCapturing(false)
    }
  }, [capturing])

  const exportBtn = (
    <button
      className={styles.exportBtn}
      onClick={captureScreenshot}
      disabled={capturing}
      title="Export as PNG"
    >
      {capturing ? '…' : '📷'}
    </button>
  )

  if (!data) return <TileCard title="Catalyst Flow"><p className={styles.loading}>Loading…</p></TileCard>

  return (
    <>
      <TileCard ref={tileRef} title="Earnings" actions={exportBtn}>
          <div className={styles.scrollBody} ref={scrollBodyRef}>
            <EarningsTable
              rows={data.bmo}
              label="BEFORE MARKET OPEN"
              onSelect={(row, label) => setSelected({ row, label })}
              liveGaps={liveGaps}
            />
            <EarningsTable
              rows={data.amc_tonight}
              label="AFTER CLOSE · TONIGHT"
              onSelect={(row, label) => setSelected({ row, label })}
              liveGaps={liveGaps}
            />
            <EarningsTable
              rows={data.amc}
              label="AFTER CLOSE · YESTERDAY"
              onSelect={(row, label) => setSelected({ row, label })}
              liveGaps={liveGaps}
            />
            {!data.bmo?.length && !data.amc_tonight?.length && !data.amc?.length && (
              <p className={styles.loading}>No earnings today</p>
            )}
          </div>
        </TileCard>

      {selected && (
        <ErrorBoundary fallback={<div style={{ color: 'var(--text-muted)', fontSize: '11px', fontFamily: 'monospace', padding: '12px' }}>Unable to load — click a ticker to retry.</div>} key={selected.row.sym}>
          <EarningsModal
            row={selected.row}
            label={selected.label}
            onClose={() => setSelected(null)}
          />
        </ErrorBoundary>
      )}
    </>
  )
}
```

- [ ] **Step 3: Verify button appears**

In the browser, the Earnings tile header should now show a 📷 camera icon button on the right side next to the "EARNINGS" title.

- [ ] **Step 4: Test the export**

Click the 📷 button. Expected:
- Button shows `…` briefly while capturing
- Browser downloads `earnings-YYYY-MM-DD.png`
- PNG shows all three sections (BMO + AMC Tonight + AMC Yesterday) with no clipping
- Image is crisp (2× scale)
- Button returns to 📷 after download

- [ ] **Step 5: Commit**

```bash
cd /c/Users/Patrick/uct-dashboard
git add app/src/components/tiles/CatalystFlow.jsx app/src/components/tiles/CatalystFlow.module.css
git commit -m "feat: add one-click PNG export to Earnings tile"
```

---

## Chunk 3: Deploy

### Task 4: Push to Railway

- [ ] **Step 1: Build frontend to verify no errors**

```bash
cd /c/Users/Patrick/uct-dashboard/app && npm run build
```

Expected: build completes with no errors.

- [ ] **Step 2: Push to Railway**

```bash
cd /c/Users/Patrick/uct-dashboard && git push origin main
```

Expected: Railway auto-deploys. Monitor deploy logs at Railway dashboard.
