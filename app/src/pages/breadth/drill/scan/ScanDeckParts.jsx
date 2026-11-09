import { useId } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { SCAN_FILTERS, UNCLASSIFIED, fmtPct, describeReading } from './scanDeckModel'
import styles from './ScanDeck.module.css'

// Sector colours for the mix bar. Fixed hues so a sector reads the same on every
// open; anything unlisted falls back to the neutral border colour.
const SECTOR_HUE = {
  Technology: '#6f9cf0', Healthcare: '#2faf68', Industrials: '#cfa94a', Utilities: '#a98bf0',
  'Basic Materials': '#e3a33b', Financials: '#5cc3c9', 'Financial Services': '#5cc3c9',
  Energy: '#df7a46', 'Consumer Cyclical': '#d46fa8', 'Consumer Defensive': '#9fb86a',
  'Communication Services': '#8ea4c8', 'Real Estate': '#b08968',
}

const MODE_LABEL = { focus: 'Focus', grid: 'Grid', table: 'Table' }
const LAYOUT_LABEL = { 1: '1 chart', dw: 'Daily + Weekly', 4: '4-up' }

// ── Masthead ─────────────────────────────────────────────────────────────────
// One row: WHICH list on WHICH day (the same date box + calendar the chart
// widget uses), then the read on it in plain words, then the view switch.
export function ScanHeader({
  label, count, live, drillCols, colKey, onPickMetric,
  dateNav, ctx, summary, mode, onMode, modes, onClose, children,
}) {
  const metricId = useId()
  const reading = describeReading(ctx)
  return (
    <div className={styles.header}>
      <div className={styles.identity}>
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
        {live && <span className={styles.live}><i />Live</span>}
        {dateNav && <div className={styles.dateWrap}>{dateNav}</div>}
      </div>

      <div className={styles.reading}>
        <div className={styles.readTop}>
          <b className={styles.readCount}>{Number.isFinite(count) ? count.toLocaleString() : '—'}</b>
          <span className={styles.readUnit}>stocks</span>
          {reading && <span className={styles.verdict} data-tone={reading.tone}>{reading.label}</span>}
          {Number.isFinite(ctx?.min) && Number.isFinite(ctx?.max) && ctx.max > ctx.min && <RangeMeter ctx={ctx} />}
        </div>
        <div className={styles.readLine}>
          {reading ? reading.sentence : 'Not enough history to compare this day yet'}
          {Number.isFinite(ctx?.median) && <> · typical day <b>{Math.round(ctx.median).toLocaleString()}</b></>}
        </div>
      </div>

      <div className={styles.stats}>
        <Stat label="Market health" title="The breadth Health score for this session, 0 to 100">
          <b>{Number.isFinite(ctx?.health) ? Math.round(ctx.health) : '—'}</b><small>/100</small>
        </Stat>
        <Stat label="Avg move">
          <b className={summary?.avgPct >= 0 ? styles.up : styles.dn}>{fmtPct(summary?.avgPct)}</b>
        </Stat>
        <Stat label="Leading theme" wide title={summary?.topTheme ? `${summary.topTheme.count} of the ${count} stocks are in ${summary.topTheme.key}` : undefined}>
          <span className={styles.statText}>{summary?.topTheme?.key || '—'}</span>
          {summary?.topTheme && <small>{summary.topTheme.count}</small>}
        </Stat>
      </div>

      <div className={styles.headEnd}>
        {children}
        <div className={styles.views} role="group" aria-label="View">
          {modes.map(m => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => onMode(m)}>
              <ViewIcon mode={m} />{MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close" title="Close">
          <UIcon name="x" size={15} />
        </button>
      </div>
    </div>
  )
}

function Stat({ label, children, title, wide }) {
  return (
    <div className={`${styles.stat}${wide ? ' ' + styles.statWide : ''}`} title={title}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{children}</span>
    </div>
  )
}

// Where today sits between the year's quietest and busiest day, with a tick at
// the typical (median) day. The picture says what the sentence says.
function RangeMeter({ ctx }) {
  const span = ctx.max - ctx.min
  const at = (v) => `${Math.max(0, Math.min(100, ((v - ctx.min) / span) * 100))}%`
  return (
    <div className={styles.meter} role="img"
      title={`Past year: lowest ${ctx.min.toLocaleString()} · typical ${Math.round(ctx.median).toLocaleString()} · highest ${ctx.max.toLocaleString()}`}
      aria-label={`Past year: lowest ${ctx.min}, typical ${Math.round(ctx.median)}, highest ${ctx.max}; this day ${ctx.value}`}>
      <div className={styles.meterTrack}>
        <span className={styles.meterMed} style={{ left: at(ctx.median) }} />
        <span className={styles.meterDot} style={{ left: at(ctx.value) }} />
      </div>
    </div>
  )
}

function ViewIcon({ mode }) {
  const p = { width: 13, height: 13, viewBox: '0 0 14 14', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true }
  if (mode === 'grid') return <svg {...p}><rect x="1.5" y="1.5" width="4.5" height="4.5" rx="1" /><rect x="8" y="1.5" width="4.5" height="4.5" rx="1" /><rect x="1.5" y="8" width="4.5" height="4.5" rx="1" /><rect x="8" y="8" width="4.5" height="4.5" rx="1" /></svg>
  if (mode === 'table') return <svg {...p}><path d="M1.5 3h11M1.5 7h11M1.5 11h11" strokeLinecap="round" /></svg>
  return <svg {...p}><rect x="1.5" y="1.5" width="3.5" height="11" rx="1" /><rect x="6.5" y="1.5" width="6" height="11" rx="1" /></svg>
}

// ── Rail: the list column's toolbar (filters), plus the group board ─────────
export function ScanRail({ deck, total, inline = false }) {
  const { filters, groups, sectorMix } = deck
  const shown = deck.shownRows.length
  const offered = SCAN_FILTERS.filter(f => filters.available.has(f.key))
  const dimLabel = groups.dim[0].toUpperCase() + groups.dim.slice(1)
  const narrowed = filters.active.size > 0 || groups.focus
  const band = (
    <>
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
    </>
  )
  if (inline) return band
  return (
    <div className={styles.rail}>
      <div className={styles.bandRow}>{band}</div>
      {sectorMix.length > 0 && <SectorMix mix={sectorMix} />}
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
      </div>
      <div className={styles.charts} data-layout={layout}>
        <div className={styles.cell}>{children}</div>
        {extraCells.map((c, i) => <div key={i} className={styles.cell}>{c}</div>)}
      </div>
    </div>
  )
}
