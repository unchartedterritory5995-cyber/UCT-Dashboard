/**
 * New Highs / New Lows widget — the first "Situational Awareness" tool on /charts.
 *
 * A live twin-panel scanner (New Highs left, New Lows right) inspired by Trade
 * Ideas' new-HOD/LOD stream, but rebuilt in the UCT skin: dark card, dim-tinted
 * count histograms, gold accents, our greens/reds — NOT a visual clone.
 *
 * Each side is a rolling event log (newest on top): every time a cap-universe name
 * prints a fresh high-of-day (or low-of-day), a row lands with the symbol's RUNNING
 * COUNT of how many times it's done so today. A high count = relentless one-
 * directional momentum, so the same symbol stacks as its count climbs. The count
 * bar behind each row scales to the busiest name on that side.
 *
 * Data: GET /api/nhnl/live (the nhnl_live accumulator; RTH only for now — pre/post
 * is Phase 3). Polls ~3s during market hours. Clicking a row routes the ticker into
 * this widget's color group so a paired chart follows (same seam as the other
 * panel widgets). Filters (min price / min count) persist per-widget through opts.
 */
import { useCallback, useMemo } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import { useWorkspace } from '../WorkspaceContext'
import styles from './NewHighsLowsWidget.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

// Event ts (ISO, ET offset) → "1:26:04 PM" market-clock time.
function fmtTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', second: '2-digit', timeZone: 'America/New_York',
    })
  } catch { return '' }
}

function fmtPrice(p) {
  const n = Number(p)
  if (!Number.isFinite(n)) return '—'
  return n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                   : n.toFixed(2)
}

const SESSION_LABEL = {
  regular: 'LIVE',
  pre_market: 'PRE-MARKET',
  post_market: 'CLOSED',
}

// One side (highs OR lows) — a scrollable event log with a count histogram.
function Side({ title, tone, events, onPick }) {
  // Scale the count bars to the busiest name on THIS side, so a quiet side isn't
  // all full bars and a wild side still fits.
  const maxCount = useMemo(
    () => events.reduce((m, e) => Math.max(m, e.count || 0), 0) || 1,
    [events],
  )
  return (
    <div className={`${styles.side} ${styles[tone]}`}>
      <div className={styles.sideHead}>
        <span className={styles.sideTitle}>{title}</span>
        <span className={styles.sideCount}>{events.length}</span>
      </div>
      <div className={styles.rows} role="list">
        {events.map((e, i) => (
          <button
            type="button"
            role="listitem"
            key={`${e.sym}-${e.ts}-${i}`}
            className={styles.row}
            onClick={() => onPick(e.sym)}
            title={`${e.sym} — new ${tone === 'up' ? 'high' : 'low'} #${e.count} at ${fmtTime(e.ts)}`}
          >
            <span
              className={styles.bar}
              style={{ width: `${Math.max(4, (e.count / maxCount) * 100)}%` }}
              aria-hidden="true"
            />
            <span className={styles.arrow}>{tone === 'up' ? '▲' : '▼'}</span>
            <span className={styles.sym}>{e.sym}</span>
            <span className={styles.price}>{fmtPrice(e.price)}</span>
            <span className={styles.time}>{fmtTime(e.ts)}</span>
            <span className={styles.count}>{e.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function NewHighsLowsWidget({ color, opts, onOptsChange }) {
  const { setGroupSym } = useWorkspace() || {}
  const minPrice = Number(opts?.minPrice) || 0
  const minCount = Math.max(1, Number(opts?.minCount) || 1)

  const onPick = useCallback((sym) => {
    if (color && sym) setGroupSym?.(color, sym)
  }, [color, setGroupSym])

  const patch = useCallback((next) => onOptsChange?.({ ...opts, ...next }), [opts, onOptsChange])

  const url = `/api/nhnl/live?limit=150&min_price=${minPrice}&min_count=${minCount}`
  const { data } = useMobileSWR(url, fetcher, {
    refreshInterval: 3000,       // feel live; server accumulates every few seconds
    dedupingInterval: 2000,
    marketHoursOnly: true,       // 10x-slow the poll when the market is closed
    revalidateOnFocus: false,
  })

  const highs = data?.highs || []
  const lows = data?.lows || []
  const session = data?.session || 'regular'
  const isRegular = session === 'regular'
  const stamp = SESSION_LABEL[session] || ''

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={`${styles.live} ${isRegular ? styles.liveOn : ''}`}>
          <span className={styles.dot} aria-hidden="true" />{stamp}
        </span>
        {data?.asof && <span className={styles.asof}>{fmtTime(data.asof)} ET</span>}
        <span className={styles.spacer} />
        <label className={styles.filter}>
          <span className={styles.filterLbl}>$≥</span>
          <input
            type="number" min="0" step="1" inputMode="decimal"
            className={styles.filterInput}
            value={opts?.minPrice ?? ''}
            placeholder="0"
            onChange={(e) => patch({ minPrice: e.target.value === '' ? 0 : Number(e.target.value) })}
            aria-label="Minimum price"
          />
        </label>
        <label className={styles.filter}>
          <span className={styles.filterLbl}>#≥</span>
          <input
            type="number" min="1" step="1" inputMode="numeric"
            className={styles.filterInput}
            value={opts?.minCount ?? ''}
            placeholder="1"
            onChange={(e) => patch({ minCount: e.target.value === '' ? 1 : Number(e.target.value) })}
            aria-label="Minimum count"
          />
        </label>
      </div>

      {!isRegular ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Intraday scan runs during market hours</div>
          <div className={styles.emptySub}>
            New-high / new-low tracking is live 9:30–4:00 ET. Pre &amp; post-market coming soon.
          </div>
        </div>
      ) : (
        <div className={styles.panels}>
          <Side title="NEW HIGHS" tone="up" events={highs} onPick={onPick} />
          <Side title="NEW LOWS" tone="down" events={lows} onPick={onPick} />
        </div>
      )}
    </div>
  )
}
