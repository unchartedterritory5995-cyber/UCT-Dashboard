import { useCallback, useState } from 'react'
import { boostParts } from '../importance'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import styles from './CalendarDepth.module.css'

// D-10 (Lane R) — Personalization UC-3: why the calendar is ordered the way it is,
// and a switch to turn the personal part off. DARK behind CALENDAR_ORDER_EXPLAIN_ENABLED.
//
// ⛔ The itemised boost comes from `boostParts`, the SAME function `impEff` adds, so
//    the explanation is the ranking's own working and cannot drift from it.
// ⛔ The switch changes only the personal boost; it is kept in this browser.

const BOOST_OFF_KEY = 'calendar.orderBoostOff'

/** [boostOff, setBoostOff] — per-browser, every storage access guarded. */
export function useBoostOff() {
  const [off, setOff] = useState(() => {
    try { return window.localStorage.getItem(BOOST_OFF_KEY) === '1' } catch { return false }
  })
  const set = useCallback((v) => {
    setOff(v)
    try { window.localStorage.setItem(BOOST_OFF_KEY, v ? '1' : '0') } catch { /* private window: in-memory only */ }
  }, [])
  return [off, set]
}

const SOURCE_LABEL = { positions: 'your positions', watchlist: 'a watchlist', flagged: 'your flagged list', uct20: 'the UCT 20' }

function fmtW(w) { return Number.isInteger(w) ? String(w) : formatNumber(w, { decimals: 1 }) }

export default function OrderExplain({ entries, weightBuckets, boostOff, onBoostOff }) {
  const buckets = weightBuckets || []
  const boosted = []
  const seen = new Set()
  for (const e of entries || []) {
    if (!e?.sym || seen.has(e.sym)) continue
    seen.add(e.sym)
    const b = boostParts(e, buckets)
    if (b.total) boosted.push({ sym: e.sym, ...b })
  }
  boosted.sort((a, b) => b.total - a.total || a.sym.localeCompare(b.sym))

  return (
    <details className={styles.strip} data-testid="order-explain">
      <summary className={styles.summary}>
        <span className={styles.title}>Why this order</span>
        <span className={styles.chip} data-testid="order-explain-state">
          {boostOff ? 'Personal boost is off' : `Personal boost is on · ${boosted.length} name${boosted.length === 1 ? '' : 's'} moved up`}
        </span>
      </summary>
      <ol className={styles.list} data-testid="order-explain-rule">
        <li>1. Your stocks first (names on your lists or in your positions).</li>
        <li>2. Then importance: EarningsWhispers interest (×2.0), market cap (×1.5) and dollar volume (×1.0), each scored against this week&apos;s reporters, plus the options&apos; expected move (×0.75).</li>
        <li>3. Plus a personal boost for each kind of list a name is on{buckets.length ? ': ' + buckets.map(b => `${(b.sources || []).map(s => SOURCE_LABEL[s] || s).join(' or ')} +${fmtW(b.weight || 0)}`).join(', ') : ''}.</li>
        <li>4. Ties: market cap, then dollar volume, then EarningsWhispers interest, then symbol.</li>
      </ol>
      <p className={styles.muted}>This is the default order. Picking another sort uses that sort instead.</p>
      {!buckets.length && !boostOff && (
        <p className={styles.muted} data-testid="order-explain-no-registry">Your lists have not loaded, so no personal boost is being applied.</p>
      )}
      {!boostOff && boosted.length > 0 && (
        <ul className={styles.list} data-testid="order-explain-boosted">
          {boosted.map(b => (
            <li key={b.sym} data-testid="order-explain-boosted-row">
              <strong>{b.sym}</strong> +{fmtW(b.total)}: {b.parts.map(p => `${p.sources.map(s => SOURCE_LABEL[s] || s).join(', ')} +${fmtW(p.weight)}`).join('; ')}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={styles.button} data-testid="order-explain-toggle"
        aria-pressed={boostOff} onClick={() => onBoostOff(!boostOff)}>
        {boostOff ? 'Turn my personal boost back on' : 'Turn my personal boost off'}
      </button>
    </details>
  )
}
