import useResearchFlow from '../hooks/useResearchFlow'
import styles from '../ResearchPage.module.css'

// Research "Flow" tab (A13 Wave B). The roadmap's original directive asked for
// a single panel joining thesis + setup + trade + options-flow signal per
// ticker. Investigation found: (1) thesis/notes/theses already have a real,
// dedicated surface ("My Research", TickerResearchWorkspace) and setup
// evidence already has one (the "Technical" tab, TechnicalTab.jsx) — both
// pre-existing; (2) `ResearchPage.jsx` has an explicit, deliberate "MY
// RESEARCH vs MARKET DATA" boundary (checkpoint decision 7/§33, see the
// header comment above the TABS array) that a single merged panel would
// violate; (3) the genuinely MISSING piece is options-flow — this page has
// zero flow surface anywhere. So this tab is the scoped, boundary-respecting
// answer: reuse the existing, partner-owned `GET /api/live/massive/ticker-flow`
// endpoint as-is (zero new backend computation, zero new flow math — the same
// aggregation the Options Flow "Search" tab and the Discord /flow command
// already use), and let "My Research"/"Technical" keep owning thesis/setup as
// they already do. Deterministic only — no AI here.

function fmtMoney(v) {
  if (v == null) return '—'
  const a = Math.abs(v)
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `$${(v / 1e3).toFixed(0)}K`
  return `$${Math.round(v)}`
}
function fmtNum(v) { return v == null ? '—' : Math.round(v).toLocaleString() }
function fmtPct(v) { return v == null ? '—' : `${v > 0 ? '+' : ''}${v}%` }

function contractLabel(c) {
  const cp = (c.cp || '').toUpperCase().startsWith('C') ? 'C' : 'P'
  const strike = c.strike != null ? Number(c.strike).toString() : '—'
  return `${strike}${cp} ${c.exp || '—'}`
}

function DirectionPill({ dir }) {
  const d = (dir || '').toUpperCase()
  const color = d === 'BULL' ? 'var(--ut-green, #4ade80)'
    : d === 'BEAR' ? 'var(--ut-red, #f87171)'
      : 'var(--text-muted)'
  return <span style={{ color, fontWeight: 600 }}>{d || '—'}</span>
}

export default function FlowTab({ sym }) {
  const { data, isLoading } = useResearchFlow(sym, '5')

  const ok = data?.ok !== false
  const net = data?.net || null
  const win = data?.window || null
  const contracts = data?.contracts || []

  return (
    <div className={styles.finWrap}>
      {isLoading && !data && <div className={styles.fnote}>Loading options-flow evidence…</div>}

      {!isLoading && (!ok || !contracts.length) && (
        <div className={styles.fnote} data-testid="flow-empty-state">
          No qualifying options flow on {sym} in the last {win?.days_requested || '5'} trading
          day{(win?.days_requested || '5') === '1' ? '' : 's'}. Sweep/ISO-backed prints only —
          negotiated blocks with no clear aggressor side are excluded.
        </div>
      )}

      {!!net && !!contracts.length && (
        <>
          <section className={styles.card} data-testid="flow-net-summary">
            <div className={styles.ct}>Net Flow</div>
            <div className={styles.kv}>
              <span>Direction</span><b><DirectionPill dir={net.dir} /></b>
            </div>
            <div className={styles.kv}><span>Bull premium</span><b>{fmtMoney(net.bull)}</b></div>
            <div className={styles.kv}><span>Bear premium</span><b>{fmtMoney(net.bear)}</b></div>
            {net.unclassified > 0 && (
              <div className={styles.kv}><span>Unclassified premium</span><b>{fmtMoney(net.unclassified)}</b></div>
            )}
            {data.spot != null && (
              <div className={styles.kv}><span>Spot</span><b>${Number(data.spot).toFixed(2)}</b></div>
            )}
            <div className={styles.muted} style={{ fontSize: 11, marginTop: 6 }}>
              {win?.start && win?.end
                ? `Window: ${win.start} – ${win.end} (${win.active_days} active day${win.active_days === 1 ? '' : 's'})`
                : 'Window: —'}
              {' · '}Sweep/ISO-backed prints only
            </div>
          </section>

          <section className={styles.card} data-testid="flow-contracts">
            <div className={styles.ct}>Top Contracts by Premium</div>
            <div className={styles.gridScroll}>
              <table className={styles.fgrid}>
                <thead>
                  <tr>
                    <th>Contract</th><th>DTE</th><th>Premium</th><th>Volume</th>
                    <th>OI</th><th>V/OI</th><th>Dir</th><th>Perf</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c, i) => (
                    <tr key={`${c.ticker}-${i}`} data-testid="flow-contract-row">
                      <td className={styles.fperiod}>{contractLabel(c)}</td>
                      <td>{c.dte ?? '—'}</td>
                      <td>{fmtMoney(c.premium)}</td>
                      <td>{fmtNum(c.volume)}</td>
                      <td>{fmtNum(c.oi)}</td>
                      <td>{c.voi != null ? `${c.voi}x` : '—'}</td>
                      <td><DirectionPill dir={c.direction} /></td>
                      <td>{fmtPct(c.perf)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.muted} style={{ fontSize: 11, marginTop: 6 }}>
              Source: live options-flow tape (same aggregation as Options Flow → Search)
            </div>
          </section>
        </>
      )}
    </div>
  )
}
