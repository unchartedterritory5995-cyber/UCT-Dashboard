# Breadth Data Charts — C1 "honest states" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Data Charts tab stops telling members things that are not true: a failed load reads as a failure, the chart
picks up the closing row, a stale reading carries its date, the percentile states its basis, the window counts sessions
on Eastern Time, and Stage 2/4 keep their qualifier.

**Architecture:** Two new pure modules (`sessionDates.js` for ET date labels, `chartLoadError.js` for what a failure
says) plus additions to `percentile.js` and `chartMetrics.js` carry the rules and are unit-tested alone.
`BreadthCharts.jsx` and `MetricReadout.jsx` consume them with small changes tested by rendered text. Which session
*should* exist is NOT restated: `utils/marketSession.expectedLatestDailySessionET` (holiday-aware) is the authority
(D-025). Flag-free: every change corrects a defect in the tab members already use.

**Tech Stack:** React 19, SWR 2.4, Vitest 4 + Testing Library (jsdom), CSS modules.

**Spec:** `docs/breadth/01-audit.md` A-01, A-09, A-10 (C), A-12 (C), A-15 (C), A-34 (C), A-35, A-38; copy from
`docs/breadth/02-design.md` §4 (legend chip), §5 (stale), §6 (states) — D-026.

## Global Constraints

- Copy (02-design §6): sentence case, active voice, no apology, one job per sentence; buttons name the action ("Retry", "Sign in", "See plans"), never "Tap".
- A failed load never renders "No data in selected range."; a genuinely empty answer still does (control).
- Session dates are Eastern Time (`America/New_York`).
- Data fetching imports `app/src/utils/jsonFetcher.js`; `STILL_UNCHECKED` in `app/src/utils/jsonFetcher.test.js` shrinks only by deletion.
- No new polling site (`app/src/hooks/pollingSites.rail.test.js` counts `useSWR(…, {refreshInterval})`); revalidation on an event is not polling (D-027).
- Tokens only from `app/src/styles/tokens.css`; a touch target is `min-height: var(--tap-min)` under `@media (max-width: 1024px)` (`styles/tapFloor.test.js`).
- Component tests mirror `App.jsx` `SWR_CONFIG` where it matters (`revalidateOnFocus: false`) and use a fresh cache per render.
- Assert feedback by rendered text. Run tests in their own tool call, before `git commit`. Stage named paths only. Check totals lines.
- Tests run from `app/`: `npx vitest run <paths>`.

---

## File structure

| File | Responsibility |
|---|---|
| Create `app/src/pages/breadth/sessionDates.js` (+ `.test.js`) | `todayET`, `shiftISO`, `shortSessionDate` — date labels only |
| Create `app/src/pages/breadth/chartLoadError.js` (+ `.test.js`) | status → sentence + action; retry policy |
| Modify `app/src/pages/breadth/percentile.js` (+ `.test.js`) | `latestPoint`, `comparableCount` |
| Modify `app/src/pages/breadth/chartMetrics.js` (+ `.test.js`) | Stage labels; `WEEKLY_METRICS`, `staleAllowance` |
| Modify `app/src/pages/breadth/MetricReadout.jsx` (+ `.module.css`, `.test.jsx`) | basis "8th of 62 shown"; stale badge "last Aug 7" |
| Modify `app/src/pages/BreadthCharts.jsx` (+ `.module.css`) | jsonFetcher, load problems, refresh on close/visibility, ET window, "sessions" |
| Create `app/src/pages/BreadthCharts.loadError.test.jsx` | A-01 states, retry policy, controls |
| Create `app/src/pages/BreadthCharts.refresh.test.jsx` | A-09 + A-35 behaviour, controls |
| Modify `app/src/pages/BreadthCharts.test.jsx`, `BreadthCharts.live.test.jsx` | ET fixture dates; readout names carry the basis |
| Modify `app/src/utils/jsonFetcher.test.js` | delete `'pages/BreadthCharts.jsx'` |
| Modify `tools/breadth_charts_rig.py:224` | the rig recognises the new state sentences |

---

### Task 1: `sessionDates.js`

**Interfaces — Produces:** `todayET(now?: Date): 'YYYY-MM-DD'` · `shiftISO(iso, days): 'YYYY-MM-DD'` ·
`shortSessionDate(iso, referenceIso?): 'Aug 7' | 'Aug 7, 2025'`

- [ ] **Step 1: failing test** `app/src/pages/breadth/sessionDates.test.js`

```js
// app/src/pages/breadth/sessionDates.test.js
import { describe, it, expect } from 'vitest'
import { todayET, shiftISO, shortSessionDate } from './sessionDates'

describe('todayET', () => {
  // A-35: the window used the UTC date, so from 8 PM ET "today" was tomorrow.
  it('is the Eastern date in the evening, not the UTC one', () => {
    expect(todayET(new Date('2026-09-14T03:30:00Z'))).toBe('2026-09-13')
  })
  it('turns over at Eastern midnight in winter', () => {
    expect(todayET(new Date('2026-01-15T04:59:00Z'))).toBe('2026-01-14')
    expect(todayET(new Date('2026-01-15T05:00:00Z'))).toBe('2026-01-15')
  })
})

describe('shiftISO', () => {
  it('crosses month, year and leap-year boundaries', () => {
    expect(shiftISO('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftISO('2024-03-01', -1)).toBe('2024-02-29')
    expect(shiftISO('2026-06-15', -90)).toBe('2026-03-17')
    expect(shiftISO('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('shortSessionDate', () => {
  it('omits the year only when it matches the reference', () => {
    expect(shortSessionDate('2026-08-07', '2026-09-11')).toBe('Aug 7')
    expect(shortSessionDate('2025-12-31', '2026-01-02')).toBe('Dec 31, 2025')
    expect(shortSessionDate('2026-08-07')).toBe('Aug 7, 2026')
  })
})
```

- [ ] **Step 2:** `npx vitest run src/pages/breadth/sessionDates.test.js` → FAIL (module missing)
- [ ] **Step 3: implement** `app/src/pages/breadth/sessionDates.js`

```js
/**
 * Calendar dates for the Data Charts window, on the market's clock.
 *
 * ⚰️ THE DEFECT (audit A-35): the window was built from
 * `new Date().toISOString().slice(0, 10)` — the UTC date — so from 8 PM ET every
 * evening "today" was already tomorrow.
 *
 * ⛔ Labels only. Which session SHOULD exist by now is
 * `utils/marketSession.expectedLatestDailySessionET`, the holiday-aware
 * authority; it is deliberately not restated here.
 */
const ET_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `'YYYY-MM-DD'` of `now` in Eastern Time. */
export function todayET(now = new Date()) {
  const p = Object.fromEntries(ET_DATE.formatToParts(now).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** Calendar arithmetic on an ISO date. Zone-free: the date is a label, not an instant. */
export function shiftISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** `'Aug 7'`, with the year when it differs from `referenceIso` or there is no reference. */
export function shortSessionDate(iso, referenceIso = null) {
  const [y, m, d] = iso.split('-').map(Number)
  const base = `${MONTHS[m - 1]} ${d}`
  return referenceIso && Number(referenceIso.slice(0, 4)) === y ? base : `${base}, ${y}`
}
```

- [ ] **Step 4:** same command → PASS (totals line)
- [ ] **Step 5:** commit `app/src/pages/breadth/sessionDates.js app/src/pages/breadth/sessionDates.test.js` — "Breadth charts: session dates on Eastern Time (A-35)"

---

### Task 2: `chartLoadError.js`

**Interfaces — Produces:** `describeLoadError(error) → {kind, title, body, action:{label, href?|retry?}}` ·
`describeRefreshError(error)` (same shape) · `shouldRetryLoad(error) → boolean`

- [ ] **Step 1: failing test** `app/src/pages/breadth/chartLoadError.test.js`

```js
// app/src/pages/breadth/chartLoadError.test.js
import { describe, it, expect } from 'vitest'
import { describeLoadError, describeRefreshError, shouldRetryLoad } from './chartLoadError'

const withStatus = status => Object.assign(new Error(`answered ${status}`), { status })

describe('describeLoadError', () => {
  it('sends an ended session to sign in', () => {
    expect(describeLoadError(withStatus(401))).toEqual({
      kind: 'signin', title: 'Your session has ended.', body: 'Sign in again to load breadth history.',
      action: { label: 'Sign in', href: '/login' },
    })
  })

  it('names the plan on a 402', () => {
    expect(describeLoadError(withStatus(402))).toEqual({
      kind: 'plan', title: 'Data Charts is part of the UCT plan.', body: 'Choose a plan to chart breadth history.',
      action: { label: 'See plans', href: '/pricing' },
    })
  })

  it('calls any other answer a server error, with a retry', () => {
    for (const s of [500, 502, 503, 404, 403]) {
      expect(describeLoadError(withStatus(s))).toEqual({
        kind: 'server', title: "Breadth history didn't load.", body: 'The server returned an error.',
        action: { label: 'Retry', retry: true },
      })
    }
  })

  // An HTML error page parsed as JSON is the server's fault, not the connection's.
  it('does not blame the connection for a body it could not parse', () => {
    expect(describeLoadError(new SyntaxError('Unexpected token <')).kind).toBe('server')
  })

  it('asks about the connection when no answer arrived', () => {
    expect(describeLoadError(new TypeError('Failed to fetch'))).toEqual({
      kind: 'network', title: "Breadth history didn't load.", body: 'Check your connection, then retry.',
      action: { label: 'Retry', retry: true },
    })
  })
})

describe('describeRefreshError', () => {
  it('keeps the chart and says which data it is for a server or network failure', () => {
    for (const e of [withStatus(500), new TypeError('Failed to fetch')]) {
      expect(describeRefreshError(e)).toMatchObject({
        title: "Couldn't refresh breadth history.", body: 'Showing the last loaded data.',
        action: { label: 'Retry', retry: true },
      })
    }
  })

  it('still sends an ended session or a lapsed plan to its door', () => {
    expect(describeRefreshError(withStatus(401)).action.href).toBe('/login')
    expect(describeRefreshError(withStatus(402)).action.href).toBe('/pricing')
  })
})

describe('shouldRetryLoad', () => {
  it('does not repeat what asking again cannot fix', () => {
    expect(shouldRetryLoad(withStatus(401))).toBe(false)
    expect(shouldRetryLoad(withStatus(402))).toBe(false)
  })
  it('retries a server or network failure', () => {
    expect(shouldRetryLoad(withStatus(503))).toBe(true)
    expect(shouldRetryLoad(new TypeError('Failed to fetch'))).toBe(true)
  })
})
```

- [ ] **Step 2:** `npx vitest run src/pages/breadth/chartLoadError.test.js` → FAIL
- [ ] **Step 3: implement** `app/src/pages/breadth/chartLoadError.js`

```js
/**
 * What a member reads when the breadth history call fails.
 *
 * 🔴 THE DEFECT (audit A-01, P0): the tab's own fetcher parsed ANY body as data,
 * so a 401, 402 or 500 answered with JSON rendered "No data in selected range." —
 * a confident claim that the market was quiet. `utils/jsonFetcher` throws on a
 * non-OK answer and carries `status`; this turns the status into a sentence the
 * member can act on. Copy: `docs/breadth/02-design.md` §6.
 */
const SIGN_IN = Object.freeze({ label: 'Sign in', href: '/login' })
const SEE_PLANS = Object.freeze({ label: 'See plans', href: '/pricing' })
const RETRY = Object.freeze({ label: 'Retry', retry: true })

function classify(error) {
  const status = error?.status
  if (status === 401) return 'signin'
  if (status === 402) return 'plan'
  // A status means the server answered; a SyntaxError means it answered with a
  // body that was not JSON. Only no answer at all is the connection.
  if (typeof status === 'number' || error instanceof SyntaxError) return 'server'
  return 'network'
}

export function describeLoadError(error) {
  switch (classify(error)) {
    case 'signin':
      return { kind: 'signin', title: 'Your session has ended.', body: 'Sign in again to load breadth history.', action: { ...SIGN_IN } }
    case 'plan':
      return { kind: 'plan', title: 'Data Charts is part of the UCT plan.', body: 'Choose a plan to chart breadth history.', action: { ...SEE_PLANS } }
    case 'server':
      return { kind: 'server', title: "Breadth history didn't load.", body: 'The server returned an error.', action: { ...RETRY } }
    default:
      return { kind: 'network', title: "Breadth history didn't load.", body: 'Check your connection, then retry.', action: { ...RETRY } }
  }
}

/** A failure while a chart is already on screen: the chart stays and the notice says it is the last loaded data. */
export function describeRefreshError(error) {
  const base = describeLoadError(error)
  if (base.kind === 'signin' || base.kind === 'plan') return base
  return { kind: base.kind, title: "Couldn't refresh breadth history.", body: 'Showing the last loaded data.', action: { ...RETRY } }
}

/** An ended session or a lapsed plan is not fixed by asking again; retrying only repeats the failure. */
export function shouldRetryLoad(error) {
  const kind = classify(error)
  return kind !== 'signin' && kind !== 'plan'
}
```

- [ ] **Step 4:** PASS · **Step 5:** commit both files — "Breadth charts: say what a failed history load means (A-01)"

---

### Task 3: the readout states its basis and dates a stale reading; Stage labels keep the qualifier

**Interfaces — Consumes:** `shortSessionDate` (Task 1). **Produces:** `latestPoint(rows, key) → {value, index, date} | null` ·
`comparableCount(values) → number` · `WEEKLY_METRICS: Set` · `staleAllowance(key) → 1 | 7`

- [ ] **Step 1: failing tests**

`percentile.test.js` — import becomes `import { percentileOf, latestValue, latestPoint, comparableCount } from './percentile'`; append:

```js
describe('latestPoint', () => {
  const rows = [
    { date: '2026-08-06', vix: 15 },
    { date: '2026-08-07', vix: 16 },
    { date: '2026-08-10', vix: null },
  ]
  it('carries the row index and date of the newest numeric reading', () => {
    expect(latestPoint(rows, 'vix')).toEqual({ value: 16, index: 1, date: '2026-08-07' })
  })
  it('returns null when nothing is numeric', () => {
    expect(latestPoint(rows, 'nope')).toBeNull()
    expect(latestPoint([], 'vix')).toBeNull()
  })
})

describe('comparableCount', () => {
  it('counts only the observations a percentile can compare against', () => {
    expect(comparableCount([1, null, 2, undefined, NaN, 'x', 3])).toBe(3)
    expect(comparableCount(undefined)).toBe(0)
  })
})
```

`chartMetrics.test.js` — add `WEEKLY_METRICS, staleAllowance,` to the existing import block; append:

```js
describe('reporting cadence', () => {
  it('lets a weekly survey trail by a week and a daily series by one session', () => {
    expect(staleAllowance('aaii_bulls')).toBe(7)
    expect(staleAllowance('naaim')).toBe(7)
    expect(staleAllowance('cboe_putcall')).toBe(1)
    expect(staleAllowance('breadth_score')).toBe(1)
  })
  it('only names metrics the catalog offers', () => {
    expect([...WEEKLY_METRICS].filter(k => !(k in LABEL_MAP))).toEqual([])
  })
})

describe('labels keep the qualifier the Monitor documents (A-34)', () => {
  it('names Stage 2 and Stage 4 as MA-stack counts, as Breadth.jsx and heatmapMetrics.js do', () => {
    expect(LABEL_MAP.stage2_count).toBe('Stage 2 (MA Stack)')
    expect(LABEL_MAP.stage4_count).toBe('Stage 4 (MA Stack)')
  })
})
```

`MetricReadout.test.jsx` — replace the three tests "shows the label, the latest value, and its percentile in the window",
"computes the percentile from the visible rows only", "spells the row out for a screen reader" with:

```jsx
  it('shows the label, the latest value, and its percentile with its basis', () => {
    setup()
    expect(screen.getByText('VIX')).toBeTruthy()
    expect(screen.getByText('20')).toBeTruthy()
    expect(screen.getByText('75th of 4 shown')).toBeTruthy()
  })

  // The window is the point: a value extreme over a year can be ordinary this
  // month, and the readout must describe what is on screen.
  it('computes the percentile from the visible rows only', () => {
    render(<MetricReadout rows={rows.slice(2)} selected={['vix']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.getByText('50th of 2 shown')).toBeTruthy()
  })

  // The spans sit flush in the DOM, so the computed name would otherwise run
  // together as "VIX2075th of 4 shown".
  it('spells the row out for a screen reader, basis included', () => {
    setup()
    expect(screen.getByRole('button', { name: 'VIX, 20, 75th percentile of 4 readings shown' })).toBeTruthy()
  })
```

and append inside the describe:

```jsx
  // A-10: CBOE put/call stopped reporting and the readout kept showing its last
  // value as current, with nothing to say how old it was.
  it('dates a daily reading that stopped arriving', () => {
    const r = [
      { date: '2026-08-03', cboe_putcall: 0.8 },
      { date: '2026-08-04', cboe_putcall: 0.9 },
      { date: '2026-08-05' },
      { date: '2026-08-06' },
    ]
    render(<MetricReadout rows={r} selected={['cboe_putcall']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.getByText('last Aug 4')).toBeTruthy()
    expect(screen.getByRole('button', { name: /, not reported since Aug 4, / })).toBeTruthy()
  })

  // CONTROL: one session behind is the live row's normal shape, and a weekly
  // survey may trail by a week — so the badge above is a signal, not noise.
  it('does not date a reading that is only its cadence behind', () => {
    const r = [
      { date: '2026-08-03', cboe_putcall: 0.8, aaii_bulls: 40 },
      { date: '2026-08-04', cboe_putcall: 0.85 },
      { date: '2026-08-05', cboe_putcall: 0.9 },
      { date: '2026-08-06' },
    ]
    render(<MetricReadout rows={r} selected={['cboe_putcall', 'aaii_bulls']} hidden={new Set()} onToggle={() => {}} />)
    expect(screen.queryByText(/^last /)).toBeNull()
  })
```

`BreadthCharts.test.jsx` lines 363–367 become:

```jsx
    expect(screen.getByRole('button', { name: '52W Highs (Close), 129, 100th percentile of 30 readings shown' }))
      .toBeInTheDocument()
    // 52W lows cycle 10..16, so the last value sits mid-range, not at an extreme.
    expect(screen.getByRole('button', { name: /^52W Lows \(Close\), 11, \d+\w\w percentile of 30 readings shown$/ }))
      .toBeInTheDocument()
```

- [ ] **Step 2:** `npx vitest run src/pages/breadth/percentile.test.js src/pages/breadth/chartMetrics.test.js src/pages/breadth/MetricReadout.test.jsx` → FAIL
- [ ] **Step 3: implement**

`percentile.js` — append:

```js
/** The newest numeric reading of `key`: its value, row index and date. Null when there is none. */
export function latestPoint(rows, key) {
  for (let i = (rows?.length ?? 0) - 1; i >= 0; i -= 1) {
    if (isNum(rows[i]?.[key])) return { value: rows[i][key], index: i, date: rows[i].date }
  }
  return null
}

/** How many observations a percentile over `values` compares against. */
export function comparableCount(values) {
  return (values ?? []).filter(isNum).length
}
```

`chartMetrics.js` — lines 62–63:

```js
      { key: 'stage2_count',  label: 'Stage 2 (MA Stack)' },
      { key: 'stage4_count',  label: 'Stage 4 (MA Stack)' },
```

after `unitOf`:

```js
// ── Reporting cadence ─────────────────────────────────────────────────────────
// Surveys published once a week — the same set `heatmapMetrics.FFILL_KEYS` may
// carry forward. A reading a few sessions old is the survey's cadence, not a
// stopped feed; everything else prints every session.
export const WEEKLY_METRICS = new Set(['aaii_bulls', 'aaii_neutral', 'aaii_bears', 'aaii_spread', 'naaim'])

/** Sessions a metric's latest reading may trail the newest row before the readout dates it (A-10). */
export function staleAllowance(key) {
  return WEEKLY_METRICS.has(key) ? 7 : 1
}
```

`MetricReadout.jsx` — full file:

```jsx
import { useMemo } from 'react'
import UIcon from '../../components/ui/UIcon'
import { LABEL_MAP, resolveColors, staleAllowance } from './chartMetrics'
import { percentileOf, latestPoint, comparableCount } from './percentile'
import { shortSessionDate } from './sessionDates'
import styles from './MetricReadout.module.css'

const ORDINAL = n => {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const format = v => (v == null ? '—' : v % 1 === 0 ? String(v) : v.toFixed(2))

/**
 * Replaces the ECharts legend: the same swatch and label, plus the latest value
 * and where it sits in the visible window. A line's shape says what happened;
 * the percentile says whether it is unusual, which is the question the chart is
 * being asked.
 *
 * A-12: the percentile names its basis ("8th of 62 shown") — a rank within the
 * window on screen, not within history. A-10: a reading older than its cadence
 * allows carries the date it was last reported and never passes as today's.
 */
export default function MetricReadout({ rows, selected, hidden, onToggle }) {
  const colors = useMemo(() => resolveColors(selected), [selected])

  const items = useMemo(() => {
    const newest = rows.length ? rows[rows.length - 1].date : null
    return selected.map(key => {
      const label = LABEL_MAP[key] ?? key
      const point = latestPoint(rows, key)
      const value = point?.value ?? null
      const values = rows.map(r => r[key])
      const pct = percentileOf(values, value)
      const basis = comparableCount(values)
      const lastReported = point && rows.length - 1 - point.index > staleAllowance(key)
        ? shortSessionDate(point.date, newest)
        : null
      return {
        key, label, value, pct, basis, lastReported,
        // The spans sit flush in the DOM, so the computed accessible name would
        // run together as "52W Highs129100th of 62 shown". Spell it out instead.
        aria: `${label}, ${value == null ? 'no value' : format(value)}` +
              `${lastReported ? `, not reported since ${lastReported}` : ''}, ` +
              `${pct == null ? 'percentile unavailable' : `${ORDINAL(pct)} percentile of ${basis} readings shown`}`,
      }
    })
  }, [rows, selected])

  return (
    <div className={styles.strip}>
      {items.map(item => (
        <button
          key={item.key}
          type="button"
          aria-label={item.aria}
          aria-pressed={!hidden.has(item.key)}
          className={`${styles.item} ${hidden.has(item.key) ? styles.hidden : ''}`}
          onClick={() => onToggle(item.key)}
        >
          <span
            className={styles.swatch}
            data-swatch={colors[item.key]}
            style={{ background: colors[item.key] }}
          />
          <span className={styles.name}>{item.label}</span>
          <span className={styles.value}>{format(item.value)}</span>
          {item.lastReported && (
            <span className={styles.stale}>
              <UIcon name="clock" size={11} gold={false} />last {item.lastReported}
            </span>
          )}
          <span className={styles.pct}>{item.pct == null ? '—' : `${ORDINAL(item.pct)} of ${item.basis} shown`}</span>
        </button>
      ))}
    </div>
  )
}
```

`MetricReadout.module.css` — append:

```css
/* A reading older than its cadence allows (A-10) — warning ink, never the series colour. */
.stale {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--warn);
}
```

- [ ] **Step 4:** `npx vitest run src/pages/breadth/percentile.test.js src/pages/breadth/chartMetrics.test.js src/pages/breadth/MetricReadout.test.jsx src/pages/BreadthCharts.test.jsx` → PASS
- [ ] **Step 5:** commit the eight files — "Breadth charts: the readout states its basis and dates a stale reading; Stage labels keep their qualifier (A-10, A-12, A-34)"

---

### Task 4: `BreadthCharts.jsx` — honest load, refresh after the close, ET window

**Interfaces — Consumes:** `jsonFetcher` (default; throws `Error & {status}`), Task 2's three functions,
`todayET`/`shiftISO` (Task 1), `expectedLatestDailySessionET()` from `../utils/marketSession`,
`useLiveBreadth()` → `{row, clock, meta}` (`meta.superseded` = the collector wrote the day).

- [ ] **Step 1: failing tests**

In `BreadthCharts.test.jsx` and `BreadthCharts.live.test.jsx`, replace `isoDaysAgo` with:

```jsx
import { todayET, shiftISO } from './breadth/sessionDates'

// Session dates are Eastern (A-35). A UTC fixture date is tomorrow after 8 PM ET
// and would fall outside the window the component now builds.
function isoDaysAgo(n) {
  return shiftISO(todayET(), -n)
}
```

Create `app/src/pages/BreadthCharts.loadError.test.jsx`:

```jsx
// app/src/pages/BreadthCharts.loadError.test.jsx
//
// A-01 (P0): a failed history load must say what failed, and must never read as
// a quiet market. Asserted by rendered text.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BreadthCharts from './BreadthCharts'
import { todayET, shiftISO } from './breadth/sessionDates'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

const ROWS = Array.from({ length: 10 }, (_, i) => ({
  date: shiftISO(todayET(), i - 9), breadth_score: 50 + i, pct_above_50sma: 40 + i,
}))

const answer = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body),
})

function stub(history) {
  const calls = { history: 0 }
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const u = String(url)
    if (u.includes('/api/breadth-monitor/live')) return answer(200, { ok: false })
    if (u.includes('/api/breadth-monitor')) { calls.history += 1; return history(calls.history) }
    if (u.includes('/api/auth/preferences')) return answer(200, opts?.method === 'POST' ? { ok: true } : {})
    return answer(200, {})
  }))
  return calls
}

// A fresh cache per render, so one test's error is never another's data, and the
// app's own focus policy (App.jsx SWR_CONFIG) so a focus event is not a fetch.
const renderTab = (swr = {}) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false, ...swr }}>
    <BreadthCharts />
  </SWRConfig>,
)

describe('a failed history load never reads as an empty market', () => {
  it.each([
    [401, 'Your session has ended.', 'Sign in again to load breadth history.', 'Sign in'],
    [402, 'Data Charts is part of the UCT plan.', 'Choose a plan to chart breadth history.', 'See plans'],
    [500, "Breadth history didn't load.", 'The server returned an error.', 'Retry'],
  ])('a %i says what failed and what to do', async (status, title, body, action) => {
    stub(() => answer(status, { detail: 'refused' }))
    renderTab()
    expect(await screen.findByText(title)).toBeInTheDocument()
    expect(screen.getByText(body)).toBeInTheDocument()
    expect(screen.getByText(action)).toBeInTheDocument()
    expect(screen.queryByText('No data in selected range.')).not.toBeInTheDocument()
  })

  it('offers a retry for a network failure that really fetches again', async () => {
    const calls = stub(n => (n === 1 ? Promise.reject(new TypeError('Failed to fetch')) : answer(200, { rows: ROWS })))
    renderTab()
    expect(await screen.findByText('Check your connection, then retry.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('echart')).toBeInTheDocument()
    expect(calls.history).toBe(2)
  })

  it('does not ask again after the session has ended', async () => {
    const calls = stub(() => answer(401, { detail: 'refused' }))
    renderTab({ errorRetryInterval: 10 })
    await screen.findByText('Your session has ended.')
    await new Promise(r => setTimeout(r, 250))
    expect(calls.history).toBe(1)
  })

  // CONTROL: with the same fast retry interval a server error IS retried — so the
  // test above counts a retry that would have happened, not one that could not.
  it('does retry a server error under the same interval', async () => {
    const calls = stub(() => answer(500, { detail: 'boom' }))
    renderTab({ errorRetryInterval: 10 })
    await screen.findByText("Breadth history didn't load.")
    await waitFor(() => expect(calls.history).toBeGreaterThanOrEqual(2))
  })

  // CONTROL: "No data" still exists for a genuinely empty answer — the rail above
  // is not passing because the empty state was deleted.
  it('still says there is no data when the answer is empty', async () => {
    stub(() => answer(200, { rows: [] }))
    renderTab()
    expect(await screen.findByText('No data in selected range.')).toBeInTheDocument()
  })

  it('counts sessions, not days (A-15)', async () => {
    stub(() => answer(200, { rows: ROWS }))
    renderTab()
    expect(await screen.findByText('10 sessions')).toBeInTheDocument()
  })
})
```

Create `app/src/pages/BreadthCharts.refresh.test.jsx`:

```jsx
// app/src/pages/BreadthCharts.refresh.test.jsx
//
// A-09: the history is fetched again when the close is recorded, and when a
// member returns to a tab whose newest session is overdue — never on a timer.
// A-35: the window's edge is the Eastern date and follows the calendar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import BreadthCharts from './BreadthCharts'
import { todayET, shiftISO } from './breadth/sessionDates'

vi.mock('echarts-for-react', () => ({ default: () => <div data-testid="echart" /> }))

const live = vi.hoisted(() => ({ value: { row: null, clock: null, meta: null } }))
vi.mock('../hooks/useLiveBreadth', () => ({ useLiveBreadth: () => live.value }))

const daysAgo = n => shiftISO(todayET(), -n)
const answer = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body),
})

function stub(respond) {
  const calls = { history: 0 }
  vi.stubGlobal('fetch', vi.fn((url, opts) => {
    const u = String(url)
    if (u.includes('/api/breadth-monitor')) { calls.history += 1; return respond(calls.history) }
    if (u.includes('/api/auth/preferences')) return answer(200, opts?.method === 'POST' ? { ok: true } : {})
    return answer(200, {})
  }))
  return calls
}

/** Mounts under one stable SWR config and returns a rerender that re-reads `live.value`. */
function mount() {
  const value = { provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }
  const tree = () => <SWRConfig value={value}><BreadthCharts /></SWRConfig>
  const utils = render(tree())
  return () => utils.rerender(tree())
}

function visibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}
const returnToTab = () => act(() => {
  visibility('hidden'); document.dispatchEvent(new Event('visibilitychange'))
  visibility('visible'); document.dispatchEvent(new Event('visibilitychange'))
})
const settle = () => new Promise(r => setTimeout(r, 150))

const HISTORY = Array.from({ length: 5 }, (_, i) => ({ date: daysAgo(5 - i), breadth_score: 50 + i }))
const PROVISIONAL = { row: { date: daysAgo(0), breadth_score: 70, _live: true }, clock: '2:47 PM', meta: { ok: true, superseded: false } }

beforeEach(() => { live.value = { row: null, clock: null, meta: null }; visibility('visible') })

describe('when the close is recorded', () => {
  it('fetches the history once, when the provisional point is withdrawn as superseded', async () => {
    live.value = PROVISIONAL
    const calls = stub(() => answer(200, { rows: HISTORY }))
    const rerender = mount()
    await waitFor(() => expect(calls.history).toBe(1))

    live.value = { row: null, clock: null, meta: { ok: true, superseded: true } }
    rerender()
    await waitFor(() => expect(calls.history).toBe(2))
    rerender()
    await settle()
    expect(calls.history).toBe(2)
  })

  // CONTROL: after hours there never was a provisional point, so nothing was withdrawn.
  it('does not refetch when there never was a provisional point', async () => {
    live.value = { row: null, clock: null, meta: { ok: true, superseded: true } }
    const calls = stub(() => answer(200, { rows: HISTORY }))
    const rerender = mount()
    await waitFor(() => expect(calls.history).toBe(1))
    rerender(); rerender()
    await settle()
    expect(calls.history).toBe(1)
  })

  // CONTROL: a point withdrawn because the read degraded is not a recorded close.
  it('does not refetch when the provisional point is withdrawn for another reason', async () => {
    live.value = PROVISIONAL
    const calls = stub(() => answer(200, { rows: HISTORY }))
    const rerender = mount()
    await waitFor(() => expect(calls.history).toBe(1))
    live.value = { row: null, clock: null, meta: { ok: true, superseded: false, degraded: true } }
    rerender()
    await settle()
    expect(calls.history).toBe(1)
  })

  it('keeps the chart and says so when that refresh fails', async () => {
    live.value = PROVISIONAL
    stub(n => (n === 1 ? answer(200, { rows: HISTORY }) : answer(500, { detail: 'boom' })))
    const rerender = mount()
    expect(await screen.findByTestId('echart')).toBeInTheDocument()

    live.value = { row: null, clock: null, meta: { ok: true, superseded: true } }
    rerender()
    expect(await screen.findByText("Couldn't refresh breadth history.")).toBeInTheDocument()
    expect(screen.getByText('Showing the last loaded data.')).toBeInTheDocument()
    expect(screen.getByTestId('echart')).toBeInTheDocument()
    expect(screen.queryByText('No data in selected range.')).not.toBeInTheDocument()
  })
})

describe('when a member returns to the tab', () => {
  it('asks again when the newest stored session is overdue — once per ten minutes', async () => {
    const calls = stub(() => answer(200, { rows: [{ date: daysAgo(30), breadth_score: 50 }] }))
    mount()
    await waitFor(() => expect(calls.history).toBe(1))
    returnToTab()
    await waitFor(() => expect(calls.history).toBe(2))
    returnToTab()
    await settle()
    expect(calls.history).toBe(2)
  })

  // CONTROL: history that already reaches today is not asked for again.
  it('does not ask again when the history is current', async () => {
    const calls = stub(() => answer(200, { rows: [{ date: daysAgo(0), breadth_score: 50 }] }))
    mount()
    await waitFor(() => expect(calls.history).toBe(1))
    returnToTab()
    await settle()
    expect(calls.history).toBe(1)
  })
})

describe('the window follows the Eastern calendar (A-35)', () => {
  afterEach(() => { vi.useRealTimers() })

  it('ends on the Eastern date in the evening, not the UTC one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-12T01:30:00Z'))          // Fri 9:30 PM ET
    stub(() => answer(200, { rows: [{ date: '2026-09-11', breadth_score: 50 }] }))
    mount()
    await waitFor(() => expect(screen.getByLabelText('To')).toHaveValue('2026-09-11'))
    expect(screen.getByLabelText('From')).toHaveValue('2026-06-13')
  })

  it('moves the edge to the new day when a tab left open is returned to', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-11T20:00:00Z'))          // Fri 4 PM ET
    stub(() => answer(200, { rows: [{ date: '2026-09-11', breadth_score: 50 }] }))
    mount()
    await waitFor(() => expect(screen.getByLabelText('To')).toHaveValue('2026-09-11'))
    vi.setSystemTime(new Date('2026-09-14T13:00:00Z'))          // Mon 9 AM ET
    returnToTab()
    await waitFor(() => expect(screen.getByLabelText('To')).toHaveValue('2026-09-14'))
  })
})
```

`jsonFetcher.test.js` — delete the line `  'pages/BreadthCharts.jsx',`.

- [ ] **Step 2:** `npx vitest run src/pages/BreadthCharts.loadError.test.jsx src/pages/BreadthCharts.refresh.test.jsx src/utils/jsonFetcher.test.js` → FAIL (states, refresh, ET window; jsonFetcher reports a new offender)

- [ ] **Step 3: implement** `BreadthCharts.jsx`

Imports — remove `ErrorState`; after the `usePreferences` import add:

```jsx
import jsonFetcher from '../utils/jsonFetcher'
import { expectedLatestDailySessionET } from '../utils/marketSession'
```

after the `MetricReadout` import add:

```jsx
import { describeLoadError, describeRefreshError, shouldRetryLoad } from './breadth/chartLoadError'
import { todayET, shiftISO } from './breadth/sessionDates'
```

Delete line 19 (`const fetcher = …`). Replace `offsetDate` (lines 46–50) with:

```jsx
const DEFAULT_WINDOW_DAYS = 90
// A market holiday leaves "overdue" true all day; one ask per ten minutes is enough.
const REVISIT_THROTTLE_MS = 10 * 60 * 1000

/** The failure panel (no chart yet) or the inline notice (a chart is already on screen). A-01. */
function LoadProblem({ error, onRetry, inline = false }) {
  const d = inline ? describeRefreshError(error) : describeLoadError(error)
  return (
    <div className={inline ? styles.refreshNotice : styles.loadProblem} role={inline ? 'status' : 'alert'}>
      <UIcon name="warning" size={inline ? 14 : 20} gold={false} />
      <div className={styles.loadProblemText}>
        <p className={styles.loadProblemTitle}>{d.title}</p>
        <p className={styles.loadProblemBody}>{d.body}</p>
      </div>
      {d.action.retry
        ? <button type="button" className={styles.loadProblemAction} onClick={onRetry}>{d.action.label}</button>
        : <a className={styles.loadProblemAction} href={d.action.href}>{d.action.label}</a>}
    </div>
  )
}
```

Lines 53–59 become:

```jsx
  const { data, isLoading, error, mutate } = useSWR('/api/breadth-monitor?days=365', jsonFetcher, {
    // An ended session or a lapsed plan is not fixed by asking again.
    shouldRetryOnError: shouldRetryLoad,
  })
  const live = useLiveBreadth()
  const { prefs, setPref } = usePreferences()

  const [expanded, setExpanded] = useState({})
  // A-35: the window is built on the Eastern date, re-read when the tab becomes
  // visible so a tab left open overnight follows the calendar. A date the member
  // typed is an override and stays where they put it.
  const [today, setToday] = useState(() => todayET())
  const [fromOverride, setFromOverride] = useState(null)
  const [toOverride, setToOverride] = useState(null)
  const fromDate = fromOverride ?? shiftISO(today, -DEFAULT_WINDOW_DAYS)
  const toDate = toOverride ?? today
```

After the `liveIndex` memo add:

```jsx
  // A-09: the history is fetched once per mount. When the 4:15 PM collector
  // records the day, the live hook withdraws its provisional point as
  // `superseded` — and nothing fetched the row that replaced it, so a tab open
  // across the close ended at yesterday. One revalidation, on that transition
  // only: a point withdrawn because the read degraded is not a recorded close.
  const hadLiveRow = useRef(false)
  useEffect(() => {
    const hasLiveRow = Boolean(live.row)
    if (hadLiveRow.current && !hasLiveRow && live.meta?.superseded) mutate()
    hadLiveRow.current = hasLiveRow
  }, [live.row, live.meta, mutate])

  // Returning to the tab: follow the Eastern calendar, and ask once if the newest
  // stored session is older than the last session that has closed.
  const newestStored = useMemo(
    () => (data?.rows ?? []).reduce((newest, r) => (r.date > newest ? r.date : newest), ''),
    [data],
  )
  const lastRevisit = useRef(0)
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      setToday(todayET())
      const now = Date.now()
      if (newestStored && newestStored < expectedLatestDailySessionET() && now - lastRevisit.current > REVISIT_THROTTLE_MS) {
        lastRevisit.current = now
        mutate()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [newestStored, mutate])
```

In `applyPreset`, the widening block becomes:

```jsx
    if (preset.minWindowDays) {
      const earliest = shiftISO(today, -preset.minWindowDays)
      if (earliest < fromDate) setFromOverride(earliest)
    }
```

Date inputs: `onChange={e => setFromOverride(e.target.value)}` / `onChange={e => setToOverride(e.target.value)}`.

Row count: `<span className={styles.rowCount}>{rows.length} {rows.length === 1 ? 'session' : 'sessions'}</span>`

Chart wrap:

```jsx
        {error && !data && <LoadProblem error={error} onRetry={() => mutate()} />}
        {!error && isLoading && <div className={styles.placeholder}>Loading data…</div>}
        {!error && !isLoading && rows.length === 0 && (
          <div className={styles.placeholder}>No data in selected range.</div>
        )}
        {!isLoading && rows.length > 0 && selected.length === 0 && (
          <div className={styles.placeholder}>Pick a preset above, or check individual metrics.</div>
        )}
        {!isLoading && rows.length > 0 && selected.length > 0 && (
          <>
            {error && <LoadProblem error={error} onRetry={() => mutate()} inline />}
            <MetricReadout … unchanged … />
            <ReactECharts … unchanged … />
          </>
        )}
```

`BreadthCharts.module.css` — before the phone block:

```css
/* ── Load problems (A-01) ──────────────────────────────────────────────────── */
.loadProblem {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 36px 20px;
  color: var(--warn);
}

.loadProblemText { display: flex; flex-direction: column; gap: 2px; }

.loadProblemTitle {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 14px;
  font-weight: 600;
  color: var(--text-heading);
}

.loadProblemBody {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-muted);
}

.loadProblemAction {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
}

.loadProblemAction:hover { border-color: var(--ut-gold); color: var(--text-heading); }

/* A refetch failed with a chart already on screen: the chart stays, this says so. */
.refreshNotice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 10px;
  padding: 10px 16px 0;
  color: var(--warn);
}
.refreshNotice .loadProblemTitle,
.refreshNotice .loadProblemBody { font-size: 12px; }

/* Touch tier — ≤1024, not just phone (styles/tapFloor.test.js). */
@media (max-width: 1024px) {
  .loadProblemAction { min-height: var(--tap-min); }
}
```

`tools/breadth_charts_rig.py:224` — the placeholder regex gains the new states:

```js
    .filter(t => /^(Loading data|No data in selected range|Pick a preset|Couldn['’]t (load|refresh)|Breadth history didn['’]t load|Your session has ended|Data Charts is part of)/.test(t))
```

- [ ] **Step 4: verify** — `npx vitest run src/pages/BreadthCharts.loadError.test.jsx src/pages/BreadthCharts.refresh.test.jsx src/pages/BreadthCharts.test.jsx src/pages/BreadthCharts.live.test.jsx src/pages/breadth src/utils/jsonFetcher.test.js src/styles/tapFloor.test.js src/styles/tokens.reachable.test.js src/hooks/pollingSites.rail.test.js` → PASS (`src/pages/breadth` includes `chartWrapLayout.test.js`), with ONE known exception measured on the untouched
  tree (baseline gate, shard 1): `pollingSites.rail.test.js` is red on master for four files owned elsewhere —
  `components/chart/useBoundDrawingAlerts.js`, `floor2/hooks/useFloor.js`, `hooks/useFilingWatch.js`,
  `hooks/useWatchlistIntelligence.js`. C1 passes that rail when its Received list is exactly those four names, with no
  `BreadthCharts` entry; it does not edit the census, which is not this program's.
  Also run `src/components/screener/reachable.test.js`: red on master for exactly `app/src/lib/context/focusDivergence.js`
  (R-29, another workstream). C1 passes it when that is still the only name — `breadth/sessionDates.js` and
  `breadth/chartLoadError.js` must never appear there.
  Mutation proofs (each reverted by Edit, never `git checkout`):
  1. restore the inline fetcher → the three status cases fail; jsonFetcher names `pages/BreadthCharts.jsx`;
  2. drop `live.meta?.superseded` → "withdrawn for another reason" fails;
  3. drop `hadLiveRow.current &&` → "never was a provisional point" fails;
  4. drop the throttle → "once per ten minutes" fails;
  5. drop `shouldRetryOnError` → "does not ask again after the session has ended" fails;
  6. `todayET()` → `new Date().toISOString().slice(0, 10)` → "ends on the Eastern date" fails;
  7. `staleAllowance` returns 1 → the cadence control fails.
- [ ] **Step 5:** commit the named paths — "Breadth charts: a failed load says so, the chart refreshes after the close, the window is Eastern (A-01, A-09, A-15, A-35)"

---

### Task 5: gate, merge, verify

- [ ] **Step 1:** `python scripts/gate_shards.py --shards 6 --out <scratchpad>/gate-c1` (own call; clean tree) → failure NAMES vs the baseline manifest; 0 new.
- [ ] **Step 2:** `git fetch origin` then `git merge origin/master` (never rebase); re-run Task 4 Step 4's suites if master touched any of these files.
- [ ] **Step 3:** `python tools/flow_worker_watch_coverage.py` → only `app/**`, `docs/**`, `tools/**` (web restart only).
- [ ] **Step 4:** `git diff origin/master --name-only` shows no image, JSON payload or measurement (D-018). Push `feat/breadth-charts:master`; watch `railway deployment list --service web --json` to SUCCESS for the SHA; `/api/health` uptime reset.
- [ ] **Step 5:** member rig, local evidence only: `python tools/breadth_charts_rig.py --widths 1280,390 --conditions-only --conditions error-401,error-402,error-500,error-network --out docs/breadth/screenshots/after-c1 --json docs/breadth/measurements/after-c1.json`.
- [ ] **Step 6:** STATUS entry + member summary:

> **What members will see.** When Data Charts can't load its history it now says why — an ended session, a plan
> requirement, a server error or a lost connection — with the right button, instead of "No data in selected range." A
> chart left open across the close picks up the day's row on its own. A reading that stopped arriving shows when it was
> last reported, each percentile says how many readings it ranks against, the window counts sessions on Eastern Time,
> and Stage 2/4 read "(MA Stack)" as they do on the Monitor.
