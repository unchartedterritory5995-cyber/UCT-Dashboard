// app/src/components/FundamentalSnapshot.jsx
// Glanceable MarketSmith-style "data box" snapshot: UCT Composite + component
// rating boxes, a key-metrics grid, and the Stock Checkup pass/fail list.
// Reusable — used in the TickerPopup Fundamentals tab (free, everywhere) and at
// the top of the research Overview. One request via useFundamentalSnapshot.
import useFundamentalSnapshot from '../hooks/useFundamentalSnapshot'
import UIcon from './ui/UIcon'
import styles from './FundamentalSnapshot.module.css'

function scoreColor(v) {
  if (v == null) return 'var(--text-muted, #8a8f98)'
  if (v >= 80) return '#3cb868'
  if (v >= 60) return '#7fb84e'
  if (v >= 40) return '#c9a84c'
  if (v >= 20) return '#e08a3c'
  return '#e74c3c'
}
function letterColor(l) {
  if (!l) return 'var(--text-muted, #8a8f98)'
  if (l === 'A') return '#3cb868'
  if (l === 'B') return '#7fb84e'
  if (l === 'C') return '#c9a84c'
  if (l === 'D') return '#e08a3c'
  return '#e74c3c'
}
const signColor = (v) => (v == null ? undefined : v > 0 ? '#3cb868' : v < 0 ? '#e74c3c' : undefined)

// formatters
const dash = '—'
const ratio = (v) => (v == null ? dash : Number(v).toFixed(2))
const pct = (v, { signed = false, digits = 1 } = {}) =>
  v == null ? dash : `${signed && v > 0 ? '+' : ''}${Number(v).toFixed(digits)}%`
const de = (v) => (v == null ? dash : `${(Number(v) / 100).toFixed(2)}x`)
const money = (v) => (v == null ? dash : v) // market_cap / fcf arrive pre-formatted ("$3.00T")
const price = (v) => (v == null ? dash : `$${Number(v).toFixed(2)}`)
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : dash)

const NUM_COMPONENTS = [
  ['eps', 'EPS'],
  ['rs', 'Rel Str'],
  ['growth', 'Growth'],
  ['value', 'Value'],
]
const LETTER_COMPONENTS = [
  ['smr', 'SMR'],
  ['accdis', 'Acc/Dis'],
  ['sponsorship', 'Sponsor'],
]

const _MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function earnLabel(iso) {
  // iso = 'YYYY-MM-DD' → "Jul 31 · in 12d" / "today" / "Jul 31"
  const parts = String(iso).split('-')
  if (parts.length !== 3) return null
  const [y, mo, da] = parts.map(Number)
  if (!y || !mo || !da) return null
  const md = `${_MONTHS[mo - 1]} ${da}`
  const target = Date.UTC(y, mo - 1, da)
  const now = new Date()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const days = Math.round((target - today) / 86400000)
  if (days === 0) return `${md} · today`
  if (days > 0 && days <= 45) return `${md} · in ${days}d`
  return md
}

function Cell({ label, value, color }) {
  return (
    <div className={styles.kv}>
      <span className={styles.kvLbl}>{label}</span>
      <b className={styles.kvVal} style={color ? { color } : undefined}>{value}</b>
    </div>
  )
}

export default function FundamentalSnapshot({ sym, enabled = true, showResearchLink = true }) {
  const { data, isLoading } = useFundamentalSnapshot(sym, enabled)

  if (isLoading) {
    return (
      <div className={styles.wrap}>
        <div className={styles.skel} aria-label="Loading fundamentals">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className={styles.skelRow} />)}
        </div>
      </div>
    )
  }

  const d = data || {}
  const m = d.metrics || {}
  const comp = d.components || {}
  const checkup = d.checkup || []
  const hasAny = d.composite != null || Object.values(m).some(v => v != null)

  if (!hasAny) {
    return <div className={styles.wrap}><div className={styles.empty}>No fundamental data available for {sym}.</div></div>
  }

  return (
    <div className={styles.wrap}>
      {/* Header */}
      <div className={styles.head}>
        <div className={styles.headMain}>
          <div className={styles.name}>{d.name || sym}</div>
          {(d.sector || d.industry) && (
            <div className={styles.sub}>{[d.sector, d.industry].filter(Boolean).join(' · ')}</div>
          )}
        </div>
        <div className={styles.headChips}>
          {d.next_earnings && earnLabel(d.next_earnings) && (
            <span className={styles.earnChip} title="Next earnings date"><UIcon name="calendar" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />{earnLabel(d.next_earnings)}</span>
          )}
          {d.basis && (
            <span className={`${styles.basisPill} ${d.basis === 'percentile' ? styles.basisPct : styles.basisAbs}`}
                  title={d.basis === 'percentile'
                    ? `Ratings are percentile ranks vs a ${d.universe_n || '—'}-stock universe`
                    : 'Ratings use absolute threshold bands (universe percentile not yet warmed)'}>
              {d.basis === 'percentile' ? `Percentile · ${d.universe_n || '—'}` : 'Absolute v1'}
            </span>
          )}
        </div>
      </div>

      {/* Ratings row */}
      {(d.composite != null || Object.keys(comp).length > 0) && (
        <div className={styles.ratings}>
          <div className={styles.composite}>
            <div className={styles.compNum} style={{ color: scoreColor(d.composite) }}>{d.composite ?? dash}</div>
            <div className={styles.compLbl}>UCT Composite<span>0–99</span></div>
          </div>
          <div className={styles.boxes}>
            {NUM_COMPONENTS.map(([k, label]) => (
              <div key={k} className={styles.box}>
                <div className={styles.boxLbl}>{label}</div>
                <div className={styles.boxVal} style={{ color: scoreColor(comp[k]) }}>{comp[k] ?? dash}</div>
                <div className={styles.meter}><div className={styles.meterFill} style={{ width: `${comp[k] ?? 0}%`, background: scoreColor(comp[k]) }} /></div>
              </div>
            ))}
            {LETTER_COMPONENTS.map(([k, label]) => (
              <div key={k} className={styles.box}>
                <div className={styles.boxLbl}>{label}</div>
                <div className={styles.boxVal} style={{ color: letterColor(comp[k]) }}>{comp[k] ?? dash}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sector RS — relative strength rank within the GICS sector */}
      {d.group_rs != null && (
        <div className={styles.sectorRs}>
          <span className={styles.sectorRsLbl}>Sector RS</span>
          <span className={styles.sectorRsVal} style={{ color: scoreColor(d.group_rs) }}>{d.group_rs}</span>
          {d.group_sector_n && d.sector && (
            <span className={styles.sectorRsCtx}>vs {d.group_sector_n} {d.sector} peers</span>
          )}
        </div>
      )}

      {/* Data boxes */}
      <div className={styles.grid}>
        <div className={styles.group}>
          <div className={styles.groupLbl}>Valuation</div>
          <Cell label="Mkt Cap" value={money(m.market_cap)} />
          <Cell label="Fwd P/E" value={ratio(m.pe_forward)} />
          <Cell label="Trail P/E" value={ratio(m.pe_trailing)} />
          <Cell label="PEG" value={ratio(m.peg)} />
          <Cell label="P/S" value={ratio(m.ps)} />
          <Cell label="P/B" value={ratio(m.pb)} />
        </div>

        <div className={styles.group}>
          <div className={styles.groupLbl}>Growth &amp; Returns</div>
          <Cell label="Sales gr" value={pct(m.revenue_growth_pct, { signed: true, digits: 0 })} color={signColor(m.revenue_growth_pct)} />
          <Cell label="EPS gr" value={pct(m.earnings_growth_pct, { signed: true, digits: 0 })} color={signColor(m.earnings_growth_pct)} />
          <Cell label="ROE" value={pct(m.roe_pct, { digits: 0 })} color={signColor(m.roe_pct)} />
          <Cell label="Gross mgn" value={pct(m.gross_margin_pct)} />
          <Cell label="Op mgn" value={pct(m.operating_margin_pct)} color={signColor(m.operating_margin_pct)} />
          <Cell label="Net mgn" value={pct(m.profit_margin_pct)} color={signColor(m.profit_margin_pct)} />
        </div>

        <div className={styles.group}>
          <div className={styles.groupLbl}>Balance &amp; Price</div>
          <Cell label="Debt/Eq" value={de(m.debt_to_equity)} />
          <Cell label="Curr ratio" value={ratio(m.current_ratio)} />
          <Cell label="Free CF" value={money(m.free_cash_flow)} />
          <Cell label="Beta" value={ratio(m.beta)} />
          <Cell label="Div yld" value={m.div_yield_pct != null ? pct(m.div_yield_pct, { digits: 2 }) : dash} />
          <Cell label="52wk" value={(m.week52_low != null || m.week52_high != null) ? `${price(m.week52_low)}–${price(m.week52_high)}` : dash} />
        </div>

        {(m.analyst_target_mean != null || m.analyst_recommendation) && (
          <div className={styles.group}>
            <div className={styles.groupLbl}>Analyst</div>
            <Cell label="Target" value={price(m.analyst_target_mean)} color="#c9a84c" />
            <Cell label="Rating" value={cap(m.analyst_recommendation)} />
            <Cell label="# Analysts" value={m.analyst_count ?? dash} />
          </div>
        )}
      </div>

      {/* Stock Checkup */}
      {!!checkup.length && (
        <div className={styles.checkup}>
          <div className={styles.groupLbl}>Stock Checkup</div>
          {checkup.map((c, i) => (
            <div key={`${c.label}-${i}`} className={styles.checkRow}>
              <span className={styles.checkIcon} style={{ color: c.status === 'pass' ? '#3cb868' : c.status === 'fail' ? '#e74c3c' : 'var(--text-muted, #8a8f98)' }}>
                {c.status === 'pass' ? <UIcon name="check" size={13} /> : c.status === 'fail' ? <UIcon name="x" size={13} /> : '–'}
              </span>
              <span className={styles.checkLbl}>{c.label}</span>
              <span className={styles.checkVal}>{c.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className={styles.foot}>
        {d.method && <span className={styles.method}>{d.method}</span>}
        {showResearchLink && sym && (
          <a className={styles.link} href={`/research/${sym}`}>Full research →</a>
        )}
      </div>
    </div>
  )
}
