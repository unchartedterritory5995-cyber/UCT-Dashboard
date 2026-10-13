// ── One renderer for every Agent answer view (see present.js) ─────────────────────────────────
// The smallest presentation that carries the result: a figure, a comparison, a few labelled
// figures, a period, rows, headlines or prose — with the full answer one tap away under "Details".
// Sized by the PANEL (container queries in AgentResult.module.css), never by the window: a narrow
// panel stacks a table into one card per row; nothing scrolls sideways.
import { useState } from 'react'
import { Link, useInRouterContext } from 'react-router-dom'
import styles from './AgentResult.module.css'
import { chartTarget } from './present'

function Prose({ text }) {
  return String(text || '').split(/\n{2,}/).map((p, i) => (
    <p key={i} className={styles.prose}>{p.split('\n').map((l, j) => (j ? [<br key={j} />, l] : l))}</p>
  ))
}

function Pairs({ items, variant }) {
  return (
    <dl className={`${styles.pairs} ${variant ? styles[variant] : ''}`}>
      {items.map((it, i) => (
        <div key={i} className={`${styles.pair} ${it.tone === 'up' ? styles.up : it.tone === 'down' ? styles.down : ''}`}>
          <dt>{it.label}</dt>
          <dd>{it.value}{it.note && <span className={styles.pairNote}>{it.note}</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

//: A result's rows show as a PREVIEW (no scroll box inside the transcript); "Show all" opens the rest
//: in place, and the answer's link (e.g. "Open in Screener") carries the full result.
export const ROWS_PREVIEW = 8

/** Rows: a compact table where the panel is wide enough; one stacked card per row where it is not. */
export function Rows({ table, testId = 'agent-result-table', preview = ROWS_PREVIEW }) {
  const [all, setAll] = useState(false)
  const cols = table.columns
  const cut = !all && preview && table.rows.length > preview + 2
  const rows = cut ? table.rows.slice(0, preview) : table.rows
  return (
    <div className={`${styles.rows} ${cols.length > 2 ? styles.many : ''}`} data-testid={testId}>
      <table className={styles.table}>
        <thead><tr>{cols.map(c => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map(c => <td key={c.key} data-label={c.label}>{r[c.key] ?? '—'}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {cut && (
        <button type="button" className={styles.more} onClick={() => setAll(true)} data-testid="agent-rows-more">
          Show all {table.rows.length} rows
        </button>
      )}
    </div>
  )
}

function Headlines({ items }) {
  return (
    <ul className={styles.headlines}>
      {items.map((h, i) => <li key={i}><span className={styles.headline}>{h.title}</span>{h.meta && <span className={styles.meta}>{h.meta}</span>}</li>)}
    </ul>
  )
}

function OpenLink({ link }) {
  const inRouter = useInRouterContext()
  return inRouter
    ? <Link className={styles.link} to={link.href} data-testid="agent-open-link">{link.label}</Link>
    : <a className={styles.link} href={link.href} data-testid="agent-open-link">{link.label}</a>
}

function Details({ details, sources }) {
  const has = details && (details.text || details.table || details.items?.length || details.headlines?.length)
  if (!has && !sources?.length) return null
  return (
    <details className={styles.details} data-testid="agent-result-details">
      <summary>{details?.headlines?.length ? `${details.headlines.length} more headline${details.headlines.length === 1 ? '' : 's'} · details` : 'Details'}</summary>
      <div className={styles.detailsBody}>
        {details?.headlines?.length > 0 && <Headlines items={details.headlines} />}
        {details?.items?.length > 0 && <Pairs items={details.items} variant="dense" />}
        {details?.text && <Prose text={details.text} />}
        {details?.table && <Rows table={details.table} testId="agent-details-table" />}
        {details?.trimmed && <p className={styles.muted}>Some details were too long to keep with this conversation.</p>}
        {sources?.length > 0 && (
          <div className={styles.sources}>
            {sources.map((s, i) => (
              <a key={i} href={s} target="_blank" rel="noreferrer noopener">{(() => { try { return new URL(s).hostname.replace(/^www\./, '') } catch { return 'source' } })()}</a>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}

/** OPEN CHART: shown only when the card carries a valid target AND the panel can open charts. */
function OpenChart({ target, onOpen, disabled }) {
  // "Opening…" while THIS card's click runs (the panel's busy state disables every card's button)
  const [opening, setOpening] = useState(false)
  const click = () => {
    setOpening(true)
    Promise.resolve().then(() => onOpen(target)).finally(() => setOpening(false))
  }
  return (
    <button type="button" className={styles.chartAction} onClick={click} disabled={disabled || opening}
      aria-busy={opening || undefined} data-testid="agent-open-chart" aria-label={`Open chart: ${target.label}`}
      title={`Show ${target.label} on a chart`}>
      <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
        <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.5 10.5l2.2-2.6 1.9 1.5 2.9-3.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {opening ? 'Opening…' : 'Open chart'}
    </button>
  )
}

// the metric views (one figure, figures side by side, a period): their footer — Details and Open chart —
// sits under a hairline divider; other views (prose, tables, headlines) keep their own layout
const METRIC = new Set(['value', 'comparison', 'metrics', 'range'])

// structured views use the column's width (so their figures sit side by side); a single figure and
// short prose stay as compact as their content
const FULL = new Set(['comparison', 'metrics', 'range', 'table', 'headlines'])

export default function AgentResult({ view, onOpenChart = null, busy = false }) {
  const body = (() => {
    switch (view.kind) {
      case 'value':
        return (
          <div className={styles.value} data-testid="agent-result-value">
            {view.label && <div className={styles.label}>{view.label}</div>}
            <div className={styles.figure}>{view.value}</div>
            {view.note && <div className={styles.note}>{view.note}</div>}
          </div>
        )
      case 'comparison':
        return <>{view.title && <div className={styles.title}>{view.title}</div>}<Pairs items={view.items} variant="compare" />{view.note && <div className={styles.note}>{view.note}</div>}</>
      case 'metrics':
      case 'range':
        return <>{view.title && <div className={styles.title}>{view.title}</div>}<Pairs items={view.items} />{view.note && <div className={styles.note}>{view.note}</div>}</>
      case 'table':
        return <>{view.text && <Prose text={view.text} />}{view.table && <Rows table={view.table} />}</>
      case 'headlines':
        return (
          <>
            {view.title && <div className={styles.title}>{view.title}</div>}
            <Headlines items={view.headlines} />
          </>
        )
      default:
        return <Prose text={view.text} />
    }
  })()
  const extraText = view.text && !['text', 'error', 'table'].includes(view.kind)
  return (
    <div className={`${styles.result} ${view.kind === 'error' ? styles.error : ''} ${FULL.has(view.kind) ? styles.full : ''}`} data-testid="agent-result" data-kind={view.kind}>
      {body}
      {extraText && <Prose text={view.text} />}
      {view.source && <div className={styles.source}>{view.source}</div>}
      {view.trimmed && <p className={styles.muted}>Showing the first rows that were kept with this conversation.</p>}
      {(() => {
        const target = onOpenChart && view.kind !== 'error' ? chartTarget(view.chart) : null
        const details = <Details details={view.details} sources={view.sources} />
        const hasDetails = !!(view.details && (view.details.text || view.details.table || view.details.items?.length || view.details.headlines?.length)) || view.sources?.length > 0
        if (!target && !(METRIC.has(view.kind) && hasDetails)) return details
        return (
          <div className={styles.foot} data-testid="agent-result-foot">
            {hasDetails ? details : <span />}
            {target && <OpenChart target={target} onOpen={onOpenChart} disabled={busy} />}
          </div>
        )
      })()}
      {view.link && <OpenLink link={view.link} />}
    </div>
  )
}
