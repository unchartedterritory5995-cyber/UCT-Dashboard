import { useId } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { SCAN_FILTERS, UNCLASSIFIED, fmtPct } from './scanDeckModel'
import styles from './ScanDeck.module.css'

// Sector colours for the mix bar. Fixed hues so a sector reads the same on every
// open; anything unlisted falls back to the neutral border colour.
const SECTOR_HUE = {
  Technology: '#6f9cf0', Healthcare: '#2faf68', Industrials: '#cfa94a', Utilities: '#a98bf0',
  'Basic Materials': '#e3a33b', Financials: '#5cc3c9', 'Financial Services': '#5cc3c9',
  Energy: '#df7a46', 'Consumer Cyclical': '#d46fa8', 'Consumer Defensive': '#9fb86a',
  'Communication Services': '#8ea4c8', 'Real Estate': '#b08968',
}

const MODE_LABEL = { scan: 'Scan', groups: 'Groups', table: 'Table' }
const LAYOUT_LABEL = { 1: '1 chart', dw: 'Daily + Weekly', 4: '4-up' }
const KEYS_HINT = 'J / K  next / previous stock\nF  flag\nX  skip\n[ / ]  previous / next session'

function fmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  if (!m) return iso || '—'
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

// One cell of the masthead: a label line and a value line, the same two
// baselines in every cell so the whole strip reads as one row of figures.
function Kpi({ label, children, title, wide }) {
  return (
    <div className={`${styles.kpi}${wide ? ' ' + styles.kpiWide : ''}`} title={title}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{children}</span>
    </div>
  )
}

// ── Masthead ─────────────────────────────────────────────────────────────────
// Which list, which session, and the read on it — count, how unusual that count
// is, market health, the average move and where the names cluster.
export function ScanHeader({
  label, count, date, live, drillCols, colKey, onPickMetric, onStep, canPrev, canNext,
  ctx, summary, mode, onMode, modes, onClose, children,
}) {
  const metricId = useId()
  const series = ctx?.series || []
  const prev = series.length > 1 ? series[series.length - 2] : null
  const cur = series.length ? series[series.length - 1] : null
  const delta = Number.isFinite(cur) && Number.isFinite(prev) ? cur - prev : null
  return (
    <div className={styles.header}>
      <div className={styles.identity}>
        <span className={styles.kpiLabel}>Breadth list</span>
        <div className={styles.identityRow}>
          {drillCols?.length > 1 && onPickMetric ? (
            <>
              <label htmlFor={metricId} className="sr-only">Breadth list</label>
              <select id={metricId} className={styles.metric} value={colKey || ''} onChange={e => onPickMetric(e.target.value)}>
                {drillCols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </>
          ) : (
            <span className={styles.metric}>{label}</span>
          )}
          <div className={styles.dateNav}>
            {onStep && (
              <button type="button" className={styles.dateBtn} onClick={() => onStep(-1)} disabled={!canPrev}
                aria-label="Previous session" title="Previous session ( [ )"><UIcon name="chevronLeft" size={13} /></button>
            )}
            {live
              ? <span className={styles.live}><i />Live</span>
              : <span className={styles.dateText}>{fmtDate(date)}</span>}
            {onStep && (
              <button type="button" className={styles.dateBtn} onClick={() => onStep(1)} disabled={!canNext}
                aria-label="Next session" title="Next session ( ] )"><UIcon name="chevronRight" size={13} /></button>
            )}
          </div>
        </div>
      </div>

      <div className={styles.kpis}>
        <Kpi label="Stocks" title={Number.isFinite(delta) ? `${delta >= 0 ? '+' : ''}${delta} vs the previous session` : undefined}>
          <b>{Number.isFinite(count) ? count.toLocaleString() : '—'}</b>
          {Number.isFinite(delta) && delta !== 0 && (
            <small className={delta > 0 ? styles.up : styles.dn}>{delta > 0 ? '▲' : '▼'}{Math.abs(delta)}</small>
          )}
        </Kpi>
        <Kpi label={series.length > 1 ? `Last ${series.length} sessions` : 'History'} wide
          title={ctx?.sample ? `This count ranks in the ${ordinal(ctx.pctile)} percentile of the last ${ctx.sample} sessions` : undefined}>
          {series.length > 1 && <Spark series={series} />}
          <b className={styles.gold}>{Number.isFinite(ctx?.pctile) ? ordinal(ctx.pctile) : '—'}</b>
          <small>pctile</small>
        </Kpi>
        <Kpi label="Health">
          <b>{Number.isFinite(ctx?.health) ? Math.round(ctx.health) : '—'}</b>
          <small>/ 100</small>
        </Kpi>
        <Kpi label="Avg move">
          <b className={summary?.avgPct >= 0 ? styles.up : styles.dn}>{fmtPct(summary?.avgPct)}</b>
        </Kpi>
        <Kpi label="Top sector" wide title={summary?.topSector ? `${summary.topSector.key}: ${summary.topSector.count} stocks` : undefined}>
          <span className={styles.kpiText}>{summary?.topSector?.key || '—'}</span>
          {summary?.topSector && <small>{Math.round(summary.topSector.share * 100)}%</small>}
        </Kpi>
        <Kpi label="Top theme" wide title={summary?.topTheme ? `${summary.topTheme.key}: ${summary.topTheme.count} stocks` : undefined}>
          <span className={styles.kpiText}>{summary?.topTheme?.key || '—'}</span>
          {summary?.topTheme && <small>{summary.topTheme.count}</small>}
        </Kpi>
      </div>

      <div className={styles.headEnd}>
        {children}
        <div className={styles.seg} role="group" aria-label="Window mode">
          {modes.map(m => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}>{MODE_LABEL[m]}</button>
          ))}
        </div>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close" title="Close (Esc)">
          <UIcon name="x" size={15} />
        </button>
      </div>
    </div>
  )
}

function Spark({ series }) {
  const vals = series.filter(Number.isFinite)
  const max = Math.max(1, ...vals)
  const w = 96, h = 22, n = series.length
  const bw = w / n
  return (
    <svg className={styles.spark} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`Last ${n} sessions of this list's count; the highlighted bar is this session`}>
      {series.map((v, i) => {
        const bh = Number.isFinite(v) ? Math.max(1, (v / max) * h) : 0
        return <rect key={i} className={i === n - 1 ? styles.on : undefined} x={i * bw} y={h - bh} width={Math.max(0.8, bw - 0.6)} height={bh} />
      })}
    </svg>
  )
}

// ── Rail: the list column's toolbar (filters), plus the group board ─────────
export function ScanRail({ deck, mode, total }) {
  const { filters, groups, sectorMix } = deck
  const shown = deck.shownRows.length
  const offered = SCAN_FILTERS.filter(f => filters.available.has(f.key))
  const dimLabel = groups.dim[0].toUpperCase() + groups.dim.slice(1)
  const narrowed = filters.active.size > 0 || groups.focus
  return (
    <div className={styles.rail}>
      <div className={styles.bandRow}>
        <div className={styles.chips} role="group" aria-label="Filters">
          {/* A focused group narrows the list in EVERY mode, so it is shown in
              every mode — never a silent "Showing 6 of 38". */}
          {groups.focus && (
            <button type="button" className={styles.chip} aria-pressed="true"
              aria-label={`Remove ${dimLabel} filter: ${groups.focus}`}
              onClick={() => groups.setFocus(null)}>{groups.focus} <span aria-hidden="true">✕</span></button>
          )}
          {offered.map(f => (
            <button key={f.key} type="button" className={styles.chip} aria-pressed={filters.active.has(f.key)}
              title={f.title} onClick={() => filters.toggle(f.key)}>{f.label}</button>
          ))}
        </div>
        <span className={styles.bandCount}>
          {narrowed
            ? <><b>{shown.toLocaleString()}</b> / {total.toLocaleString()} · <button type="button" className={styles.linkBtn}
              onClick={() => { filters.clear(); groups.setFocus(null) }}>clear</button></>
            : <><b>{total.toLocaleString()}</b> shown</>}
        </span>
      </div>
      {sectorMix.length > 0 && <SectorMix mix={sectorMix} />}
      {mode === 'groups' && <GroupPanel groups={groups} />}
    </div>
  )
}

function SectorMix({ mix }) {
  return (
    <div className={styles.mixBar} role="img"
      aria-label={`Sector mix: ${mix.slice(0, 4).map(g => `${g.key} ${Math.round(g.share * 100)}%`).join(', ')}`}>
      {mix.map(g => (
        <span key={g.key} title={`${g.key} · ${g.count} (${Math.round(g.share * 100)}%)`}
          style={{ flex: g.count, background: g.key === UNCLASSIFIED ? 'var(--border)' : (SECTOR_HUE[g.key] || 'var(--text-muted)') }} />
      ))}
    </div>
  )
}

function GroupPanel({ groups }) {
  const max = groups.list[0]?.count || 1
  return (
    <div className={styles.groups}>
      <div className={styles.groupsHead}>
        <span className={styles.kpiLabel}>Group by</span>
        <div className={`${styles.seg} ${styles.segSm}`} role="group" aria-label="Group by">
          {['sector', 'industry', 'theme'].map(d => (
            <button key={d} type="button" aria-pressed={groups.dim === d} onClick={() => groups.setDim(d)}>
              {d[0].toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.groupList} role="group" aria-label={`${groups.dim} groups`}>
        {groups.list.map(g => (
          <button key={g.key} type="button" className={styles.groupRow} aria-pressed={groups.focus === g.key}
            onClick={() => groups.setFocus(groups.focus === g.key ? null : g.key)}
            title={`${g.key}: ${g.count} stocks, ${Math.round(g.share * 100)}% of the list`}>
            <span className={styles.groupName}>{g.key}</span>
            <span className={styles.groupBar}><i style={{ width: `${(g.count / max) * 100}%` }} /></span>
            <span className={styles.groupNum}>{g.count}</span>
            <span className={`${styles.groupNum} ${g.avgPct >= 0 ? styles.up : styles.dn}`}>{fmtPct(g.avgPct)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Chart column: its toolbar (template, layout) over the chart cells ───────
// The toolbar is the same height as the list column's filter row, so the two
// read as one band across the window.
export function ScanStage({ children, extraCells = [], layout, onLayout, layouts, templates, templateId, onTemplate }) {
  const tplId = useId()
  return (
    <div className={styles.stage}>
      <div className={styles.bandRow}>
        <label className={styles.tbLabel} htmlFor={tplId}>Template</label>
        <select id={tplId} className={styles.select} value={templateId} onChange={e => onTemplate(e.target.value)}>
          {templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <span className={styles.tbSep} aria-hidden="true" />
        <div className={`${styles.seg} ${styles.segSm} ${styles.layoutPick}`} role="group" aria-label="Chart layout">
          {layouts.map(l => (
            <button key={l} type="button" aria-pressed={layout === l} onClick={() => onLayout(l)}>{LAYOUT_LABEL[l]}</button>
          ))}
        </div>
        <span className={styles.spacer} />
        <span className={styles.keysHint} title={KEYS_HINT} aria-label={`Keyboard: ${KEYS_HINT.replace(/\n/g, ', ')}`}>
          <kbd>J</kbd><kbd>K</kbd> next · <kbd>F</kbd> flag · <kbd>X</kbd> skip
        </span>
      </div>
      <div className={styles.charts} data-layout={layout}>
        <div className={styles.cell}>{children}</div>
        {extraCells.map((c, i) => <div key={i} className={styles.cell}>{c}</div>)}
      </div>
    </div>
  )
}
