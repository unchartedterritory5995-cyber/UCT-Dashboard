# Research Page — Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working, paid-only `/research/:sym` page with a persistent header, a 7-tab shell (Overview live; other tabs are "coming soon" stubs), a paywall teaser for non-paid users, and an "Open full report →" deep-link from the calendar EarningsModal.

**Architecture:** A new lazy-loaded React page `pages/research/ResearchPage.jsx` under the existing `AuthGuard`. AuthGuard lets `/research/*` through (like `/settings`) and the page itself renders a `PaywallTeaser` for non-pro/non-admin users. The Overview tab composes **existing** endpoints client-side via SWR hooks — no new backend in Phase 1 (the `api/routers/research.py` namespace arrives in Phase 2 with Financials). Rating badges render as placeholders now and get real values in Phase 4.

**Tech Stack:** React + React Router (`useParams`, `useNavigate`, `lazy`), SWR (`useMobileSWR`), existing hooks (`useFundamentals`, `useLivePrices`), CSS modules + `tokens.css`/`breakpoints.css`. Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-06-15-research-page-design.md`

**⚠️ Shared working tree:** This repo's working tree is shared with a live parallel session. **Execute this plan in an isolated git worktree** (superpowers:using-git-worktrees) so commits never land on another branch. All commits in this plan assume the worktree is on a dedicated branch (e.g. `feat/research-page`).

---

## File Structure

**Create:**
- `app/src/pages/research/ResearchPage.jsx` — route shell: paywall gate + header + tab bar + active tab
- `app/src/pages/research/ResearchPage.module.css` — all page styles
- `app/src/pages/research/ResearchHeader.jsx` — logo / name / price / earnings / ratings badges / actions
- `app/src/pages/research/RatingBadges.jsx` — badge row (placeholder values in Phase 1)
- `app/src/pages/research/PaywallTeaser.jsx` — blurred-preview upsell for non-paid users
- `app/src/pages/research/tabs/OverviewTab.jsx` — the only live tab in Phase 1
- `app/src/pages/research/tabs/ComingSoonTab.jsx` — stub for the other 6 tabs
- `app/src/pages/research/hooks/useResearchOverview.js` — composes existing endpoints
- `app/src/pages/research/ResearchPage.test.jsx` — render + paywall + tab tests
- `app/src/pages/research/hooks/useResearchOverview.test.js` — hook URL/shape test

**Modify:**
- `app/src/App.jsx` — lazy import + `<Route path="/research/:sym" .../>` inside `<Layout/>`
- `app/src/components/AuthGuard.jsx` — allow `/research` through to the component (gate inside)
- `app/src/components/tiles/EarningsModal.jsx` — `useNavigate` + "Open full report →" / "🔒 Unlock full research" button
- `app/src/components/tiles/EarningsModal.module.css` — button styles

---

## Task 1: AuthGuard lets `/research` through (gate inside the page)

**Files:**
- Modify: `app/src/components/AuthGuard.jsx`

- [ ] **Step 1: Add the allow-through.** In `AuthGuard.jsx`, find the block (around the `'/settings'` allow and the `FREE_PAGES` check):

```jsx
  // Allow settings page always (so they can manage billing / subscribe)
  if (location.pathname === '/settings') {
    return <Outlet />
  }
```

Add immediately AFTER it:

```jsx
  // /research/* is paid-only but renders its OWN paywall teaser (not a hard
  // redirect), so let it through and let the page decide. Do NOT add it to
  // FREE_PAGES — it must not appear as a free nav item.
  if (location.pathname.startsWith('/research')) {
    return <Outlet />
  }
```

- [ ] **Step 2: Build to confirm no syntax break.**

Run: `cd app && npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 3: Commit.**

```bash
git add app/src/components/AuthGuard.jsx
git commit -m "feat(research): let /research through AuthGuard for in-page paywall"
```

---

## Task 2: `useResearchOverview` hook (composes existing endpoints)

**Files:**
- Create: `app/src/pages/research/hooks/useResearchOverview.js`
- Test: `app/src/pages/research/hooks/useResearchOverview.test.js`

- [ ] **Step 1: Write the failing test.**

```js
// app/src/pages/research/hooks/useResearchOverview.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// Mock useMobileSWR to capture the URLs requested and return canned data.
const calls = []
vi.mock('../../../hooks/useMobileSWR', () => ({
  default: (url) => {
    calls.push(url)
    if (url?.includes('/api/ticker-meta/')) return { data: { name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', exchange: 'NASDAQ' } }
    if (url?.includes('/api/fundamentals/')) return { data: { market_cap: '$2.95T', forward_pe: 28.5, beta: 1.22, week52_high: 243, week52_low: 164, div_yield: 0.42 } }
    if (url?.includes('/api/earnings/intel/')) return { data: { consensus: { buy: 37, hold: 8, sell: 1 }, price_target: { targetLow: 230, targetMean: 251, targetHigh: 280 } } }
    return { data: null }
  },
}))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: { AAPL: { price: 256.5, change_pct: 1.8 } } }) }))

import useResearchOverview from './useResearchOverview'

describe('useResearchOverview', () => {
  beforeEach(() => { calls.length = 0 })

  it('requests the three composing endpoints for the symbol', () => {
    renderHook(() => useResearchOverview('aapl'))
    expect(calls.some(u => u === '/api/ticker-meta/AAPL')).toBe(true)
    expect(calls.some(u => u === '/api/fundamentals/AAPL')).toBe(true)
    expect(calls.some(u => u === '/api/earnings/intel/AAPL')).toBe(true)
  })

  it('returns a normalized shape with meta, stats, analyst, live', () => {
    const { result } = renderHook(() => useResearchOverview('AAPL'))
    expect(result.current.meta.name).toBe('Apple Inc.')
    expect(result.current.stats.forward_pe).toBe(28.5)
    expect(result.current.analyst.consensus.buy).toBe(37)
    expect(result.current.live.change_pct).toBe(1.8)
  })
})
```

- [ ] **Step 2: Run it; verify it fails.**

Run: `cd app && npx vitest run src/pages/research/hooks/useResearchOverview.test.js`
Expected: FAIL — cannot find `./useResearchOverview`.

- [ ] **Step 3: Implement the hook.**

```js
// app/src/pages/research/hooks/useResearchOverview.js
import useMobileSWR from '../../../hooks/useMobileSWR'
import useLivePrices from '../../../hooks/useLivePrices'

// Phase 1: compose the Overview tab from existing endpoints. No new backend.
export default function useResearchOverview(rawSym) {
  const sym = (rawSym || '').toUpperCase().trim()

  const { data: meta } = useMobileSWR(sym ? `/api/ticker-meta/${sym}` : null)
  const { data: stats } = useMobileSWR(sym ? `/api/fundamentals/${sym}` : null)
  const { data: analyst } = useMobileSWR(sym ? `/api/earnings/intel/${sym}` : null)
  const { data: ai } = useMobileSWR(sym ? `/api/earnings-analysis/${sym}` : null)
  const { prices } = useLivePrices(sym ? [sym] : [])

  return {
    sym,
    meta: meta || {},
    stats: stats || {},
    analyst: analyst || {},
    ai: ai || {},
    live: (prices && prices[sym]) || {},
  }
}
```

> Note: `useMobileSWR` here is called with a single arg. If the app's `useMobileSWR` signature requires a fetcher, pass the shared one: `const fetcher = u => fetch(u).then(r => r.json())` and call `useMobileSWR(url, fetcher)`. Verify against `app/src/hooks/useMobileSWR.js` during Step 3 and adjust the calls + the test mock to match.

- [ ] **Step 4: Run the test; verify it passes.**

Run: `cd app && npx vitest run src/pages/research/hooks/useResearchOverview.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add app/src/pages/research/hooks/useResearchOverview.js app/src/pages/research/hooks/useResearchOverview.test.js
git commit -m "feat(research): useResearchOverview composing existing endpoints"
```

---

## Task 3: RatingBadges (placeholder values)

**Files:**
- Create: `app/src/pages/research/RatingBadges.jsx`
- Modify: `app/src/pages/research/ResearchPage.module.css` (created in Task 6; if running out of order, create the file first with these classes)

- [ ] **Step 1: Implement the component.**

```jsx
// app/src/pages/research/RatingBadges.jsx
import styles from './ResearchPage.module.css'

// Phase 1: structure only. Real values arrive in Phase 4 (UCT Ratings).
const COMPONENTS = [
  { key: 'composite', label: 'UCT Composite', hero: true },
  { key: 'eps', label: 'EPS' },
  { key: 'rs', label: 'Rel Strength' },
  { key: 'growth', label: 'Growth' },
  { key: 'value', label: 'Value' },
  { key: 'smr', label: 'SMR' },
  { key: 'accdis', label: 'Acc / Dis' },
  { key: 'sponsorship', label: 'Sponsorship' },
]

export default function RatingBadges({ ratings = null }) {
  return (
    <div className={styles.ratings} aria-label="UCT Ratings">
      {COMPONENTS.map(c => {
        const val = ratings?.[c.key]
        return (
          <div key={c.key} className={`${styles.rb} ${c.hero ? styles.rbHero : ''}`}>
            <div className={styles.rbLbl}>{c.label}</div>
            <div className={styles.rbVal}>{val ?? '—'}</div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Commit** (after CSS exists in Task 6; or commit together with Task 6).

```bash
git add app/src/pages/research/RatingBadges.jsx
git commit -m "feat(research): rating badge row (placeholder values)"
```

---

## Task 4: PaywallTeaser

**Files:**
- Create: `app/src/pages/research/PaywallTeaser.jsx`

- [ ] **Step 1: Implement.**

```jsx
// app/src/pages/research/PaywallTeaser.jsx
import { useNavigate } from 'react-router-dom'
import styles from './ResearchPage.module.css'

export default function PaywallTeaser({ sym }) {
  const navigate = useNavigate()
  return (
    <div className={styles.paywall}>
      <div className={styles.paywallGlass}>
        <h2 className={styles.paywallTitle}>Unlock {sym} Research</h2>
        <p className={styles.paywallSub}>
          Full financial statements, forward estimates, proprietary UCT Ratings,
          ownership &amp; short interest, earnings-call transcripts, and more — the
          complete institutional-grade research dossier.
        </p>
        <ul className={styles.paywallList}>
          <li>📊 5-year &amp; 8-quarter growth, margins, balance sheet &amp; cash flow</li>
          <li>🎯 UCT Composite + EPS / Relative Strength / Growth / Value ratings</li>
          <li>🏦 Institutional ownership, insider activity, short interest</li>
          <li>🎙️ AI call recaps + full transcripts with TTS</li>
        </ul>
        <button className={styles.paywallCta} onClick={() => navigate('/settings')}>
          Upgrade to unlock →
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit** (with Task 6 CSS).

```bash
git add app/src/pages/research/PaywallTeaser.jsx
git commit -m "feat(research): paywall teaser for non-paid users"
```

---

## Task 5: ResearchHeader

**Files:**
- Create: `app/src/pages/research/ResearchHeader.jsx`

- [ ] **Step 1: Implement.**

```jsx
// app/src/pages/research/ResearchHeader.jsx
import CompanyLogo from '../../components/CompanyLogo'
import SymbolSearch from '../../components/chart/SymbolSearch'
import RatingBadges from './RatingBadges'
import styles from './ResearchPage.module.css'

function pctClass(v) {
  if (v == null) return ''
  return v >= 0 ? styles.up : styles.down
}

export default function ResearchHeader({ sym, meta, stats, live, onSymbolChange }) {
  const change = live?.change_pct
  return (
    <header className={styles.hdr}>
      <CompanyLogo sym={sym} size={52} />
      <div className={styles.hdrId}>
        <div className={styles.hdrName}>
          {sym}
          <span className={styles.hdrCo}> · {meta?.name || meta?.company || ''}</span>
        </div>
        <div className={styles.hdrSub}>
          {[meta?.exchange, meta?.sector, meta?.industry].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className={styles.hdrPx}>
        {live?.price != null && (
          <div className={styles.hdrPxBig}>
            ${Number(live.price).toFixed(2)}{' '}
            {change != null && (
              <span className={pctClass(change)}>
                {change >= 0 ? '▲' : '▼'}{Math.abs(change).toFixed(2)}%
              </span>
            )}
          </div>
        )}
        <div className={styles.hdrSearch}>
          <SymbolSearch onSymbolChange={onSymbolChange} />
        </div>
      </div>
      <div className={styles.hdrRatings}>
        <RatingBadges ratings={null} />
      </div>
    </header>
  )
}
```

> During implementation, confirm `SymbolSearch`'s prop name for the change callback (`onSymbolChange`) against `app/src/components/chart/SymbolSearch.jsx`. If it differs, adapt.

- [ ] **Step 2: Commit** (with Task 6 CSS).

```bash
git add app/src/pages/research/ResearchHeader.jsx
git commit -m "feat(research): page header with logo/price/search/ratings"
```

---

## Task 6: OverviewTab + ComingSoonTab + page CSS

**Files:**
- Create: `app/src/pages/research/tabs/OverviewTab.jsx`
- Create: `app/src/pages/research/tabs/ComingSoonTab.jsx`
- Create: `app/src/pages/research/ResearchPage.module.css`

- [ ] **Step 1: OverviewTab.**

```jsx
// app/src/pages/research/tabs/OverviewTab.jsx
import styles from '../ResearchPage.module.css'

function Surprise({ v }) {
  if (v == null) return <span className={styles.muted}>—</span>
  const s = String(v)
  const up = s.trim().startsWith('+')
  return <span className={up ? styles.up : styles.down}>{s}</span>
}

export default function OverviewTab({ sym, stats, analyst, ai, row }) {
  const ct = analyst?.consensus || {}
  const pt = analyst?.price_target || {}
  return (
    <div className={styles.grid}>
      <section className={styles.card}>
        <div className={styles.ct}>Latest report</div>
        <table className={styles.tbl}>
          <thead><tr><th>Metric</th><th>Est</th><th>Actual</th><th>Surp</th></tr></thead>
          <tbody>
            <tr>
              <td>EPS</td>
              <td>{row?.eps_estimate ?? '—'}</td>
              <td>{row?.reported_eps ?? '—'}</td>
              <td><Surprise v={row?.surprise_pct} /></td>
            </tr>
            <tr>
              <td>Revenue</td>
              <td>{row?.rev_estimate ?? '—'}</td>
              <td>{row?.rev_actual ?? '—'}</td>
              <td><Surprise v={row?.rev_surprise_pct} /></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className={styles.card}>
        <div className={styles.ct}>Key stats</div>
        <div className={styles.kv}><span>Mkt cap</span><b>{stats?.market_cap ?? '—'}</b></div>
        <div className={styles.kv}><span>Fwd P/E</span><b>{stats?.forward_pe ?? '—'}</b></div>
        <div className={styles.kv}><span>Beta</span><b>{stats?.beta ?? '—'}</b></div>
        <div className={styles.kv}><span>Div yield</span><b>{stats?.div_yield != null ? `${stats.div_yield}%` : '—'}</b></div>
        <div className={styles.kv}><span>52-wk range</span><b>{stats?.week52_low ?? '—'} — {stats?.week52_high ?? '—'}</b></div>
      </section>

      <section className={styles.card}>
        <div className={styles.ct}>Analyst view</div>
        <div className={styles.kv}><span>Consensus</span><b>{ct.buy != null ? `Buy ${ct.buy} · Hold ${ct.hold ?? 0} · Sell ${ct.sell ?? 0}` : '—'}</b></div>
        <div className={styles.kv}><span>Target</span><b>{pt.targetLow ?? '—'} — <span className={styles.gold}>{pt.targetMean ?? '—'}</span> — {pt.targetHigh ?? '—'}</b></div>
      </section>

      <section className={styles.card}>
        <div className={styles.ct}>AI snapshot</div>
        <p className={styles.ai}>
          {ai?.analysis_summary || ai?.preview_text || 'Earnings analysis will appear here once available.'}
        </p>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: ComingSoonTab.**

```jsx
// app/src/pages/research/tabs/ComingSoonTab.jsx
import styles from '../ResearchPage.module.css'

export default function ComingSoonTab({ name }) {
  return (
    <div className={styles.soon}>
      <div className={styles.soonInner}>
        <div className={styles.soonGlyph}>⌁</div>
        <div className={styles.soonTitle}>{name} — coming soon</div>
        <div className={styles.soonSub}>This tab lands in an upcoming phase of the research hub.</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: ResearchPage.module.css** (covers header, badges, tabs, grid, cards, paywall, coming-soon; tokens from `tokens.css`).

```css
/* app/src/pages/research/ResearchPage.module.css */
.page { padding: 18px 22px 26px; height: 100%; overflow-y: auto; box-sizing: border-box; background: var(--bg); color: var(--text); }

/* header */
.hdr { display: flex; align-items: center; gap: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.hdrId { min-width: 0; }
.hdrName { font-size: 18px; font-weight: 800; color: var(--text-heading); }
.hdrCo { color: var(--text); font-weight: 600; font-size: 14px; }
.hdrSub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
.hdrPx { margin-left: auto; text-align: right; }
.hdrPxBig { font-size: 18px; font-weight: 800; color: var(--text-heading); }
.hdrSearch { margin-top: 4px; }
.hdrRatings { flex-basis: 100%; }
.up { color: var(--gain); } .down { color: var(--loss); }
.gold { color: var(--ut-gold); } .muted { color: var(--text-muted); }

/* rating badges */
.ratings { display: flex; gap: 7px; margin-top: 12px; flex-wrap: wrap; }
.rb { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 5px 9px; text-align: center; min-width: 64px; }
.rbHero { background: linear-gradient(135deg, var(--ut-gold-glow), var(--ut-gold-dim)); border-color: var(--ut-gold); }
.rbLbl { font-size: 8px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--text-muted); }
.rbVal { font-size: 16px; font-weight: 800; color: var(--text-bright); }

/* tab bar */
.tabs { display: flex; gap: 5px; margin: 14px 0 12px; flex-wrap: nowrap; overflow-x: auto; }
.tab { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 7px; padding: 6px 12px; font-size: 12px; color: var(--text); cursor: pointer; white-space: nowrap; }
.tabOn { background: var(--ut-gold-dim); border-color: var(--ut-gold); color: var(--ut-gold); font-weight: 700; }

/* overview grid */
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 10px; padding: 11px 12px; }
.ct { font-size: 9px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 8px; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
.tbl th, .tbl td { padding: 3px 4px; text-align: right; }
.tbl th:first-child, .tbl td:first-child { text-align: left; }
.tbl th { color: var(--text-muted); font-size: 9px; text-transform: uppercase; border-bottom: 1px solid var(--border); }
.kv { display: flex; justify-content: space-between; padding: 3px 0; font-size: 12px; }
.kv b { color: var(--text-bright); }
.ai { font-size: 12px; line-height: 1.55; color: var(--text); }

/* coming soon */
.soon { display: flex; align-items: center; justify-content: center; min-height: 280px; }
.soonInner { text-align: center; color: var(--text-muted); }
.soonGlyph { font-size: 34px; color: var(--ut-gold); opacity: 0.6; }
.soonTitle { font-size: 15px; font-weight: 700; color: var(--text-bright); margin-top: 8px; }
.soonSub { font-size: 12px; margin-top: 4px; }

/* paywall */
.paywall { display: flex; align-items: center; justify-content: center; min-height: 60vh; padding: 24px; }
.paywallGlass { max-width: 520px; text-align: center; background: var(--bg-surface); border: 1px solid var(--ut-gold); border-radius: 16px; padding: 28px 26px; box-shadow: var(--shadow-lg); }
.paywallTitle { font-size: 22px; font-weight: 800; color: var(--ut-gold); }
.paywallSub { font-size: 13px; line-height: 1.6; color: var(--text); margin: 10px 0 14px; }
.paywallList { list-style: none; padding: 0; margin: 0 0 18px; text-align: left; display: inline-block; }
.paywallList li { font-size: 12.5px; color: var(--text-bright); padding: 4px 0; }
.paywallCta { background: var(--ut-gold); color: #1a1c17; border: none; border-radius: 9px; padding: 10px 18px; font-size: 14px; font-weight: 800; cursor: pointer; }
.paywallCta:hover { filter: brightness(1.08); }

@media (max-width: 640px) {
  .grid { grid-template-columns: 1fr; }
  .hdrPx { margin-left: 0; text-align: left; flex-basis: 100%; }
}
```

- [ ] **Step 4: Build.**

Run: `cd app && npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit** (badges + paywall + header + tabs + css together).

```bash
git add app/src/pages/research/
git commit -m "feat(research): overview tab, coming-soon stubs, header, badges, paywall CSS"
```

---

## Task 7: ResearchPage shell (paywall gate + tabs + route)

**Files:**
- Create: `app/src/pages/research/ResearchPage.jsx`
- Modify: `app/src/App.jsx`

- [ ] **Step 1: ResearchPage.jsx.**

```jsx
// app/src/pages/research/ResearchPage.jsx
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import useResearchOverview from './hooks/useResearchOverview'
import ResearchHeader from './ResearchHeader'
import OverviewTab from './tabs/OverviewTab'
import ComingSoonTab from './tabs/ComingSoonTab'
import PaywallTeaser from './PaywallTeaser'
import styles from './ResearchPage.module.css'

const TABS = ['Overview', 'Financials', 'Estimates', 'Ratings', 'Ownership', 'Calls & Transcript', 'Filings & Events']

export default function ResearchPage() {
  const { sym: rawSym } = useParams()
  const navigate = useNavigate()
  const { user, plan } = useAuth()
  const [active, setActive] = useState('Overview')
  const data = useResearchOverview(rawSym)
  const sym = data.sym

  const isPaid = plan === 'pro' || user?.role === 'admin'
  if (!isPaid) return <div className={styles.page}><PaywallTeaser sym={sym} /></div>

  return (
    <div className={styles.page}>
      <ResearchHeader
        sym={sym}
        meta={data.meta}
        stats={data.stats}
        live={data.live}
        onSymbolChange={(s) => s && navigate(`/research/${s.toUpperCase()}`)}
      />
      <nav className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t}
            className={`${styles.tab} ${active === t ? styles.tabOn : ''}`}
            onClick={() => setActive(t)}
          >{t}</button>
        ))}
      </nav>
      {active === 'Overview'
        ? <OverviewTab sym={sym} stats={data.stats} analyst={data.analyst} ai={data.ai} row={null} />
        : <ComingSoonTab name={active} />}
    </div>
  )
}
```

> Confirm the auth context import path + the `plan` field name during implementation. `AuthGuard.jsx` already reads `plan` and `user.role` — mirror exactly how it imports/derives them (it uses `useAuth()` from the auth context). If `plan` comes from a different selector, match AuthGuard.

- [ ] **Step 2: Register the route in `App.jsx`.** Add the lazy import near the other `lazy(() => import('./pages/...'))` lines:

```jsx
const ResearchPage = lazy(() => import('./pages/research/ResearchPage'))
```

Add the route INSIDE the `<Route element={<Layout />}>` block (next to `/dashboard`):

```jsx
<Route path="/research/:sym" element={<ResearchPage />} />
```

- [ ] **Step 3: Build.**

Run: `cd app && npm run build`
Expected: `✓ built`.

- [ ] **Step 4: Commit.**

```bash
git add app/src/pages/research/ResearchPage.jsx app/src/App.jsx
git commit -m "feat(research): page shell with paywall gate, tab bar, and /research/:sym route"
```

---

## Task 8: EarningsModal "Open full report" deep-link

**Files:**
- Modify: `app/src/components/tiles/EarningsModal.jsx`
- Modify: `app/src/components/tiles/EarningsModal.module.css`

- [ ] **Step 1: Add imports + hooks.** At the top of `EarningsModal.jsx` add (if not present):

```jsx
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
```

Inside the component body (near the top, with other hooks):

```jsx
  const navigate = useNavigate()
  const { user, plan } = useAuth()
  const isPaid = plan === 'pro' || user?.role === 'admin'
```

- [ ] **Step 2: Add the button.** Find the "View Chart" button area (around line 539). Immediately before/after it, add:

```jsx
  <button
    className={styles.btnReport}
    onClick={() => {
      onClose?.()
      navigate(isPaid ? `/research/${row.sym}` : '/research/' + row.sym)
    }}
  >
    {isPaid ? 'Open full report →' : '🔒 Unlock full research →'}
  </button>
```

> Both branches navigate to `/research/${row.sym}`; the page itself shows the paywall for non-paid users, so the label differs but the destination is the same. (Keep it one navigate call: `navigate(\`/research/${row.sym}\`)`.)

- [ ] **Step 3: Add button CSS** to `EarningsModal.module.css`:

```css
.btnReport {
  padding: 7px 14px;
  background: var(--ut-gold-dim);
  color: var(--ut-gold);
  border: 1px solid var(--ut-gold);
  border-radius: var(--radius-lg);
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.3px;
  transition: background 0.12s;
}
.btnReport:hover { background: var(--ut-gold-glow); }
```

- [ ] **Step 4: Build.**

Run: `cd app && npm run build`
Expected: `✓ built`.

- [ ] **Step 5: Commit.**

```bash
git add app/src/components/tiles/EarningsModal.jsx app/src/components/tiles/EarningsModal.module.css
git commit -m "feat(research): Open full report link from EarningsModal"
```

---

## Task 9: ResearchPage tests

**Files:**
- Create: `app/src/pages/research/ResearchPage.test.jsx`

- [ ] **Step 1: Write the tests.**

```jsx
// app/src/pages/research/ResearchPage.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen } from '../../test-utils'

// Stable overview data for all renders.
vi.mock('./hooks/useResearchOverview', () => ({
  default: () => ({
    sym: 'AAPL',
    meta: { name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', exchange: 'NASDAQ' },
    stats: { market_cap: '$2.95T', forward_pe: 28.5, beta: 1.22, week52_high: 243, week52_low: 164, div_yield: 0.42 },
    analyst: { consensus: { buy: 37, hold: 8, sell: 1 }, price_target: { targetLow: 230, targetMean: 251, targetHigh: 280 } },
    ai: { analysis_summary: 'Strong services-led beat.' },
    live: { price: 256.5, change_pct: 1.8 },
  }),
}))

// Control auth: default paid; override per-test.
const auth = { user: { role: 'user' }, plan: 'pro' }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }))

import ResearchPage from './ResearchPage'

function renderAt(sym = 'AAPL') {
  return renderWithProviders(<ResearchPage />, { route: `/research/${sym}`, path: '/research/:sym' })
}

describe('ResearchPage', () => {
  it('renders the header + Overview for a paid user', () => {
    auth.plan = 'pro'; auth.user = { role: 'user' }
    renderAt()
    expect(screen.getByText(/Apple Inc\./)).toBeInTheDocument()
    expect(screen.getByText(/Key stats/i)).toBeInTheDocument()
  })

  it('shows the 7 tabs and switches to a coming-soon stub', async () => {
    auth.plan = 'pro'
    renderAt()
    const financials = screen.getByRole('button', { name: 'Financials' })
    financials.click()
    expect(await screen.findByText(/coming soon/i)).toBeInTheDocument()
  })

  it('shows the paywall teaser for a non-paid user', () => {
    auth.plan = 'free'; auth.user = { role: 'user' }
    renderAt()
    expect(screen.getByText(/Unlock AAPL Research/i)).toBeInTheDocument()
    expect(screen.queryByText(/Key stats/i)).not.toBeInTheDocument()
  })
})
```

> `renderWithProviders` must support a `route`/`path` option for `useParams`. Check `app/src/test-utils.*`; if its signature differs (e.g. it wraps in a `MemoryRouter` with a `initialEntries` option), adapt the helper call to match. If no route option exists, wrap manually: `renderWithProviders(<MemoryRouter initialEntries={[\`/research/AAPL\`]}><Routes><Route path="/research/:sym" element={<ResearchPage/>}/></Routes></MemoryRouter>)`.

- [ ] **Step 2: Run the tests.**

Run: `cd app && npx vitest run src/pages/research/ResearchPage.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit.**

```bash
git add app/src/pages/research/ResearchPage.test.jsx
git commit -m "test(research): page render, tab switch, and paywall gate"
```

---

## Task 10: Full verification + push

- [ ] **Step 1: Run the research test suite + build.**

Run: `cd app && npx vitest run src/pages/research && npm run build`
Expected: all research tests PASS; `✓ built`.

- [ ] **Step 2: Manual smoke (optional, recommended).** Note for the executor: with a paid/admin account, visit `/research/AAPL` — header renders with logo + live price, Overview shows the four cards, tabs switch to "coming soon", and the calendar EarningsModal's "Open full report →" navigates here. With a free account, the paywall teaser shows.

- [ ] **Step 3: Push the branch.**

```bash
git push -u origin feat/research-page
```

> Do NOT merge to master yet — open for review or merge per the user's preference. Because the working tree is shared, all of the above ran inside the dedicated worktree/branch.

---

## Self-Review Notes (coverage vs spec)

- **§3 Surface/Routing/Access** → Tasks 1, 7 (route + AuthGuard allow-through + in-page paywall). ✅
- **§4 Header** → Task 5 (logo, name, sector, live price, search, ratings row). ✅ (earnings date/countdown + flag/alert actions deferred to a later phase — Phase 1 header is intentionally minimal; note for Phase 4/5.)
- **§5.1 Overview** → Task 6 (latest report, key stats, analyst view, AI snapshot). Mini price chart deferred to polish (reuses StockChart) — acceptable for Phase 1 foundation.
- **§5.2–5.7 other tabs** → Task 6 ComingSoonTab stubs; real tabs are Phases 2–6. ✅
- **Ratings (§7)** → Task 3 placeholders; real engine is Phase 4. ✅
- **Modal deep-link (§1/§3)** → Task 8. ✅
- **Aesthetic (§8)** → Task 6 CSS using app tokens + 640 breakpoint. ✅
- **Testing (§12)** → Tasks 2, 9. ✅

**Known follow-ups to fold into later phases:** earnings-date/countdown + flag/alert in header; mini price chart on Overview; the `api/routers/research.py` backend namespace (Phase 2).
