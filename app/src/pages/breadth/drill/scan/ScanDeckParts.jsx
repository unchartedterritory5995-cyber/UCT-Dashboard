import { useId } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { SCAN_FILTERS, UNCLASSIFIED, fmtPct, fmtCap } from './scanDeckModel'
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

// ── Header ───────────────────────────────────────────────────────────────────
export function ScanHeader({
  label, count, date, live, drillCols, colKey, onPickMetric, onStep, canPrev, canNext,
  ctx, mode, onMode, modes, onClose, children,
}) {
  const metricId = useId()
  return (
    <div className={styles.header}>
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
          <button type="button" className={styles.iconBtn} onClick={() => onStep(-1)} disabled={!canPrev}
            aria-label="Previous session" title="Previous session ( [ )">◀</button>
        )}
        {live ? <span className={styles.live}>LIVE</span> : <span>{date}</span>}
        {onStep && (
          <button type="button" className={styles.iconBtn} onClick={() => onStep(1)} disabled={!canNext}
            aria-label="Next session" title="Next session ( ] )">▶</button>
        )}
      </div>

      <div className={styles.ctx}>
        <div className={styles.stat}>
          <span className={styles.statNum}>{Number.isFinite(count) ? count.toLocaleString() : '—'}</span>
          <span className={styles.statLbl}>{count === 1 ? 'stock' : 'stocks'}</span>
        </div>
        {ctx?.series?.length > 1 && <Spark series={ctx.series} />}
        <div className={styles.stat} title={ctx?.sample ? `Rank of this reading among the last ${ctx.sample} sessions` : undefined}>
          <span className={`${styles.statNum} ${styles.gold}`}>{Number.isFinite(ctx?.pctile) ? ordinal(ctx.pctile) : '—'}</span>
          <span className={styles.statLbl}>percentile · 1y</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statNum}>{Number.isFinite(ctx?.health) ? Math.round(ctx.health) : '—'}</span>
          <span className={styles.statLbl}>health</span>
        </div>
      </div>

      <span className={styles.spacer} />
      {children}
      <div className={styles.seg} role="group" aria-label="Window mode">
        {modes.map(m => (
          <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}>{MODE_LABEL[m]}</button>
        ))}
      </div>
      <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close" title="Close (Esc)">
        <UIcon name="x" size={14} />
      </button>
    </div>
  )
}

function Spark({ series }) {
  const vals = series.filter(Number.isFinite)
  const max = Math.max(1, ...vals)
  const w = 130, h = 30, n = series.length
  const bw = w / n
  return (
    <svg className={styles.spark} width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`Last ${n} sessions of this list's count; the highlighted bar is this session`}>
      {series.map((v, i) => {
        const bh = Number.isFinite(v) ? Math.max(1, (v / max) * (h - 2)) : 0
        return <rect key={i} className={i === n - 1 ? styles.on : undefined} x={i * bw} y={h - bh} width={Math.max(1, bw - 0.8)} height={bh} />
      })}
    </svg>
  )
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

// ── Rail: filters, sector mix, group panel ──────────────────────────────────
export function ScanRail({ deck, mode, total }) {
  const { filters, groups, sectorMix } = deck
  const shown = deck.shownRows.length
  const offered = SCAN_FILTERS.filter(f => filters.available.has(f.key))
  const dimLabel = groups.dim[0].toUpperCase() + groups.dim.slice(1)
  return (
    <div className={styles.rail}>
      {(offered.length > 0 || groups.focus) && (
        <div className={styles.chips} role="group" aria-label="Filters">
          {/* A focused group narrows the list in EVERY mode, so it is shown in
              every mode — never a silent "Showing 6 of 38". */}
          {groups.focus && (
            <button type="button" className={styles.chip} aria-pressed="true"
              aria-label={`Remove ${dimLabel} filter: ${groups.focus}`}
              onClick={() => groups.setFocus(null)}>{dimLabel}: {groups.focus} ✕</button>
          )}
          {offered.map(f => (
            <button key={f.key} type="button" className={styles.chip} aria-pressed={filters.active.has(f.key)}
              title={f.title} onClick={() => filters.toggle(f.key)}>{f.label}</button>
          ))}
          {(filters.active.size > 0 || groups.focus) && (
            <button type="button" className={`${styles.chip} ${styles.chipClear}`}
              onClick={() => { filters.clear(); groups.setFocus(null) }}>Clear</button>
          )}
        </div>
      )}

      {mode !== 'groups' && sectorMix.length > 0 && <SectorMix mix={sectorMix} />}

      {mode === 'groups' && <GroupPanel groups={groups} />}

      {(shown !== total) && (
        <div className={styles.mixLegend}><span>Showing {shown.toLocaleString()} of {total.toLocaleString()}</span></div>
      )}
    </div>
  )
}

function SectorMix({ mix }) {
  const known = mix.filter(g => g.key !== UNCLASSIFIED)
  const top = known[0]
  return (
    <div className={styles.mix}>
      <div className={styles.mixBar} role="img"
        aria-label={`Sector mix: ${mix.slice(0, 4).map(g => `${g.key} ${Math.round(g.share * 100)}%`).join(', ')}`}>
        {mix.map(g => (
          <span key={g.key} title={`${g.key} · ${g.count}`}
            style={{ flex: g.count, background: SECTOR_HUE[g.key] || 'var(--border)' }} />
        ))}
      </div>
      <div className={styles.mixLegend}>
        <span>{top ? `${top.key} ${Math.round(top.share * 100)}%` : 'Sectors loading…'}</span>
        <span>{known.length} sectors</span>
      </div>
    </div>
  )
}

function GroupPanel({ groups }) {
  const max = groups.list[0]?.count || 1
  return (
    <div className={styles.groups}>
      <div className={styles.groupsHead}>
        <span className={styles.label}>Group by</span>
        <div className={styles.seg} role="group" aria-label="Group by">
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

// ── Chart pane frame: toolbar, chart cells, facts, triage ───────────────────
export function ScanStage({
  children, extraCells = [], layout, onLayout, layouts,
  templates, templateId, onTemplate,
  row, facts, alsoLabels, earningsSoon,
  flagged, onFlag, skipped, onSkip, onPrev, onNext, canPrev, canNext,
  reviewed, total, onResetReview,
}) {
  const tplId = useId()
  return (
    <div className={styles.stage}>
      <div className={styles.toolbar}>
        <label className={styles.tbLabel} htmlFor={tplId}>Template
          <select id={tplId} className={styles.select} value={templateId} onChange={e => onTemplate(e.target.value)}>
            {templates.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <div className={`${styles.seg} ${styles.layoutPick}`} role="group" aria-label="Chart layout">
          {layouts.map(l => (
            <button key={l} type="button" aria-pressed={layout === l} onClick={() => onLayout(l)}>{LAYOUT_LABEL[l]}</button>
          ))}
        </div>
      </div>

      <div className={styles.charts} data-layout={layout}>
        <div className={styles.cell}>{children}</div>
        {extraCells.map((c, i) => <div key={i} className={styles.cell}>{c}</div>)}
      </div>

      {row && <Facts row={row} facts={facts} alsoLabels={alsoLabels} earningsSoon={earningsSoon} />}

      <div className={styles.triage}>
        <button type="button" className={styles.tbtn} onClick={onPrev} disabled={!canPrev}><kbd className={styles.kbdHint}>K</kbd>Prev</button>
        <button type="button" className={`${styles.tbtn}${flagged ? ' ' + styles.on : ''}`} onClick={onFlag} disabled={!row}
          aria-pressed={!!flagged}><kbd className={styles.kbdHint}>F</kbd>{flagged ? 'Flagged' : 'Flag'}</button>
        <button type="button" className={`${styles.tbtn}${skipped ? ' ' + styles.on : ''}`} onClick={onSkip} disabled={!row}
          aria-pressed={!!skipped}><kbd className={styles.kbdHint}>X</kbd>{skipped ? 'Skipped' : 'Skip'}</button>
        <span className={styles.spacer} />
        <div className={styles.progress} aria-live="polite">
          <span>
            {reviewed.toLocaleString()} / {total.toLocaleString()} reviewed
            {reviewed > 0 && <> · <button type="button" className={styles.linkBtn} onClick={onResetReview}>reset</button></>}
          </span>
          <span className={styles.progressBar}><i style={{ width: `${total ? (reviewed / total) * 100 : 0}%` }} /></span>
        </div>
        <button type="button" className={`${styles.tbtn} ${styles.primary}`} onClick={onNext} disabled={!canNext}><kbd className={styles.kbdHint}>J</kbd>Next</button>
      </div>
    </div>
  )
}

function Facts({ row, facts, alsoLabels, earningsSoon }) {
  const where = [row.sector, row.industry].filter(Boolean).join(' › ')
  const items = [
    ['Sector › Industry', where || '—', true],
    ['Theme', row.theme || '—', true],
    ['Mcap', fmtCap(row.mcap)],
    ['ADR', Number.isFinite(facts?.adr) ? `${facts.adr.toFixed(1)}%` : '—'],
    ['DCR', Number.isFinite(facts?.dcr) ? `${Math.round(facts.dcr)}%` : '—'],
    ['Gap', Number.isFinite(facts?.gap) ? <span className={facts.gap >= 0 ? styles.up : styles.dn}>{fmtPct(facts.gap)}</span> : '—'],
    ['RVOL', Number.isFinite(row.rvol) ? `${row.rvol}x` : '—'],
    ['UCT Rating', Number.isFinite(row.rating) ? Math.round(row.rating) : '—'],
  ]
  const badges = []
  if (earningsSoon) badges.push(<span key="e" className={`${styles.badge} ${styles.earn}`} title={`Next earnings ${row.nextEarnings}`}>EARNINGS {earningsSoon}</span>)
  if (row.repeat > 0) badges.push(<span key="r" className={`${styles.badge} ${styles.repeat}`} title={`In this list on ${row.repeat} of the previous 5 sessions`}>↻ {row.repeat} of 5</span>)
  if (row.repeat === 0) badges.push(<span key="n" className={styles.badge} title="Not in this list on any of the previous 5 sessions">FIRST APPEARANCE</span>)
  for (const l of alsoLabels.slice(0, 5)) badges.push(<span key={l} className={`${styles.badge} ${styles.also}`} title="Also on this list the same day">{l}</span>)
  return (
    <>
      <div className={styles.facts}>
        {items.map(([l, v, txt]) => (
          <div key={l} className={styles.fact}>
            <span className={styles.factL}>{l}</span>
            <span className={`${styles.factV}${txt ? ' ' + styles.txt : ''}`} title={typeof v === 'string' ? v : undefined}>{v}</span>
          </div>
        ))}
      </div>
      {badges.length > 0 && <div className={styles.badges} style={{ paddingTop: 6 }}>{badges}</div>}
    </>
  )
}
