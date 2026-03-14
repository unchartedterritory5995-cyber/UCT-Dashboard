import useSWR from 'swr'
import styles from './Breadth.module.css'

const fetcher = url => fetch(url).then(r => r.json())

// ── Column definitions ────────────────────────────────────────────────────────
// Each entry: { key, label, group, fmt?, colorFn? }
// colorFn(val) → 'green' | 'red' | 'amber' | ''

const G = {
  REGIME:    'Regime',
  PRIMARY:   'Primary Breadth',
  MA:        'MA Breadth',
  HIGHS:     'Highs / Lows',
  SETUPS:    'Setups',
  VOLUME:    'Volume / A-D',
  SENTIMENT: 'Sentiment',
}

function pctColor(low, mid, high) {
  return v => {
    if (v === null || v === undefined) return ''
    if (v >= high) return 'green'
    if (v <= low)  return 'red'
    if (v >= mid)  return 'amber'
    return ''
  }
}

const COLS = [
  // ── Regime ────────────────────────────────────────────────────────────────
  { key: 'sp500_close',    label: 'S&P 500',    group: G.REGIME, fmt: fmtPrice },
  { key: 'qqq_close',      label: 'QQQ',         group: G.REGIME, fmt: fmtPrice },
  { key: 'vix',            label: 'VIX',          group: G.REGIME, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v > 30 ? 'red' : v > 20 ? 'amber' : 'green' },
  { key: 'spy_above_50sma',  label: 'SPY>50',   group: G.REGIME, fmt: fmtBool,
    colorFn: v => v === 1 ? 'green' : v === 0 ? 'red' : '' },
  { key: 'spy_above_200sma', label: 'SPY>200',  group: G.REGIME, fmt: fmtBool,
    colorFn: v => v === 1 ? 'green' : v === 0 ? 'red' : '' },
  { key: 'qqq_above_50sma',  label: 'QQQ>50',   group: G.REGIME, fmt: fmtBool,
    colorFn: v => v === 1 ? 'green' : v === 0 ? 'red' : '' },
  { key: 'qqq_above_200sma', label: 'QQQ>200',  group: G.REGIME, fmt: fmtBool,
    colorFn: v => v === 1 ? 'green' : v === 0 ? 'red' : '' },
  { key: 'uct_exposure',   label: 'UCT Exp',     group: G.REGIME, fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v >= 70 ? 'green' : v <= 30 ? 'red' : 'amber' },

  // ── Primary Breadth ───────────────────────────────────────────────────────
  { key: 'up_4pct_today',      label: 'Up 4%+',     group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 300 ? 'green' : v < 100 ? 'red' : '' },
  { key: 'down_4pct_today',    label: 'Dn 4%+',     group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 300 ? 'red' : v < 100 ? 'green' : '' },
  { key: 'ratio_5day',         label: '5D Ratio',   group: G.PRIMARY, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 1.2 ? 'green' : v <= 0.8 ? 'red' : '' },
  { key: 'ratio_10day',        label: '10D Ratio',  group: G.PRIMARY, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 1.2 ? 'green' : v <= 0.8 ? 'red' : '' },
  { key: 'up_25pct_quarter',   label: 'Up25%/Qtr',  group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 500 ? 'green' : v < 150 ? 'red' : '' },
  { key: 'down_25pct_quarter', label: 'Dn25%/Qtr',  group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 500 ? 'red' : v < 100 ? 'green' : '' },
  { key: 'up_25pct_month',     label: 'Up25%/Mo',   group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 200 ? 'green' : v < 60 ? 'red' : '' },
  { key: 'down_25pct_month',   label: 'Dn25%/Mo',   group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 200 ? 'red' : v < 60 ? 'green' : '' },
  { key: 'up_50pct_month',     label: 'Up50%/Mo',   group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 50 ? 'green' : '' },
  { key: 'down_50pct_month',   label: 'Dn50%/Mo',   group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 50 ? 'red' : '' },
  { key: 'magna_up',           label: 'MAGNA↑',     group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 800 ? 'green' : v < 250 ? 'red' : '' },
  { key: 'magna_down',         label: 'MAGNA↓',     group: G.PRIMARY,
    colorFn: v => v == null ? '' : v > 800 ? 'red' : v < 150 ? 'green' : '' },
  { key: 'universe_count',     label: 'Universe',   group: G.PRIMARY },

  // ── MA Breadth ────────────────────────────────────────────────────────────
  { key: 'pct_above_5sma',   label: '>5SMA',    group: G.MA, fmt: fmtPct,
    colorFn: pctColor(30, 50, 65) },
  { key: 'pct_above_10sma',  label: '>10SMA',   group: G.MA, fmt: fmtPct,
    colorFn: pctColor(30, 50, 65) },
  { key: 'pct_above_20ema',  label: '>20EMA',   group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_40sma',  label: '>40SMA',   group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_50sma',  label: '>50SMA',   group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_100sma', label: '>100SMA',  group: G.MA, fmt: fmtPct,
    colorFn: pctColor(35, 50, 65) },
  { key: 'pct_above_200sma', label: '>200SMA',  group: G.MA, fmt: fmtPct,
    colorFn: pctColor(30, 45, 60) },

  // ── Highs / Lows ──────────────────────────────────────────────────────────
  { key: 'new_52w_highs',  label: '52W Hi',    group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 150 ? 'green' : v < 20 ? 'red' : '' },
  { key: 'new_52w_lows',   label: '52W Lo',    group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 150 ? 'red' : v < 20 ? 'green' : '' },
  { key: 'new_20d_highs',  label: '20D Hi',    group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 200 ? 'green' : v < 50 ? 'red' : '' },
  { key: 'new_20d_lows',   label: '20D Lo',    group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 200 ? 'red' : v < 50 ? 'green' : '' },
  { key: 'new_ath',        label: 'ATH',       group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 100 ? 'green' : '' },
  { key: 'near_52w_high',  label: 'Near52W',   group: G.HIGHS,
    colorFn: v => v == null ? '' : v > 600 ? 'green' : v < 150 ? 'red' : '' },

  // ── Setups ────────────────────────────────────────────────────────────────
  { key: 'stage2_count', label: 'Stage 2', group: G.SETUPS,
    colorFn: v => v == null ? '' : v > 800 ? 'green' : v < 300 ? 'red' : '' },
  { key: 'stage4_count', label: 'Stage 4', group: G.SETUPS,
    colorFn: v => v == null ? '' : v > 800 ? 'red' : v < 200 ? 'green' : '' },

  // ── Volume / A-D ──────────────────────────────────────────────────────────
  { key: 'adv_decline',   label: 'A-D',        group: G.VOLUME,
    colorFn: v => v == null ? '' : v > 500 ? 'green' : v < -500 ? 'red' : '' },
  { key: 'up_vol_ratio',  label: 'UpVol',      group: G.VOLUME, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v > 2 ? 'green' : v < 0.5 ? 'red' : '' },
  { key: 'mcclellan_osc', label: 'McClellan',  group: G.VOLUME, fmt: v => fmtDec(v, 1),
    colorFn: v => v == null ? '' : v > 0 ? 'green' : 'red' },

  // ── Sentiment ─────────────────────────────────────────────────────────────
  { key: 'cboe_putcall',  label: 'CBOE P/C',   group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v >= 1.0 ? 'green' : v <= 0.7 ? 'red' : '' },
  { key: 'cnn_fear_greed',label: 'CNN F/G',    group: G.SENTIMENT, fmt: v => fmtDec(v, 0),
    colorFn: v => v == null ? '' : v <= 25 ? 'green' : v >= 75 ? 'red' : v <= 40 ? 'amber' : '' },
  { key: 'aaii_bulls',    label: 'AAII Bulls', group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_neutral',  label: 'Neutral',    group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_bears',    label: 'AAII Bears', group: G.SENTIMENT, fmt: v => fmtDec(v, 1) },
  { key: 'aaii_spread',   label: 'Spread',     group: G.SENTIMENT, fmt: v => fmtDec(v, 1),
    colorFn: v => v == null ? '' : v > 10 ? 'green' : v < -10 ? 'red' : '' },
  { key: 'naaim',         label: 'NAAIM',      group: G.SENTIMENT, fmt: v => fmtDec(v, 2),
    colorFn: v => v == null ? '' : v > 80 ? 'amber' : v < 25 ? 'green' : '' },
]

// ── Group spans ────────────────────────────────────────────────────────────
function buildGroupSpans(cols) {
  const spans = []
  let cur = null
  for (const c of cols) {
    if (cur && cur.group === c.group) {
      cur.span++
    } else {
      cur = { group: c.group, span: 1 }
      spans.push(cur)
    }
  }
  return spans
}

const GROUP_SPANS = buildGroupSpans(COLS)

// ── Formatters ─────────────────────────────────────────────────────────────
function fmtDec(v, d = 1) {
  if (v === null || v === undefined) return '—'
  return Number(v).toFixed(d)
}
function fmtPct(v) {
  if (v === null || v === undefined) return '—'
  return Number(v).toFixed(1)
}
function fmtPrice(v) {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })
}
function fmtBool(v) {
  if (v === null || v === undefined) return '—'
  return v === 1 ? '✓' : '✗'
}
function fmtInt(v) {
  if (v === null || v === undefined) return '—'
  return Number(v).toLocaleString('en-US')
}

function fmtCell(col, val) {
  if (col.fmt) return col.fmt(val)
  if (val === null || val === undefined) return '—'
  if (Number.isInteger(val)) return fmtInt(val)
  return String(val)
}

function cellClass(col, val) {
  if (!col.colorFn || val === null || val === undefined) return ''
  const c = col.colorFn(val)
  if (c === 'green') return styles.cellGreen
  if (c === 'red')   return styles.cellRed
  if (c === 'amber') return styles.cellAmber
  return ''
}

const GROUP_HEADER_CLASS = {
  [G.REGIME]:    styles.ghRegime,
  [G.PRIMARY]:   styles.ghPrimary,
  [G.MA]:        styles.ghMA,
  [G.HIGHS]:     styles.ghHighs,
  [G.SETUPS]:    styles.ghSetups,
  [G.VOLUME]:    styles.ghVolume,
  [G.SENTIMENT]: styles.ghSentiment,
}

// ── Component ─────────────────────────────────────────────────────────────
export default function Breadth() {
  const { data, isLoading } = useSWR('/api/breadth-monitor?days=90', fetcher, {
    refreshInterval: 5 * 60 * 1000,
  })

  const rows = data?.rows ?? []

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Breadth Monitor</h1>
        <span className={styles.meta}>
          {rows.length > 0 ? `${rows.length} trading days` : isLoading ? 'Loading…' : 'No data'}
        </span>
      </div>

      {rows.length === 0 && !isLoading && (
        <div className={styles.empty}>
          No data yet. Run <code>python scripts/breadth_collector.py</code> in uct-intelligence to populate.
        </div>
      )}

      {rows.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              {/* Group header row */}
              <tr>
                <th className={`${styles.th} ${styles.dateCol} ${styles.ghDate}`} rowSpan={2}>
                  Date
                </th>
                {GROUP_SPANS.map((gs, i) => (
                  <th
                    key={i}
                    colSpan={gs.span}
                    className={`${styles.th} ${styles.groupHeader} ${GROUP_HEADER_CLASS[gs.group] ?? ''}`}
                  >
                    {gs.group}
                  </th>
                ))}
              </tr>
              {/* Column label row */}
              <tr>
                {COLS.map(col => (
                  <th key={col.key} className={`${styles.th} ${styles.colLabel}`} title={col.key}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={row.date} className={ri % 2 === 0 ? styles.rowEven : styles.rowOdd}>
                  <td className={`${styles.td} ${styles.dateCell}`}>{row.date}</td>
                  {COLS.map(col => {
                    const val = row[col.key]
                    return (
                      <td
                        key={col.key}
                        className={`${styles.td} ${cellClass(col, val)}`}
                      >
                        {fmtCell(col, val)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
