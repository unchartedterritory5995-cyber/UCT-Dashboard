// ── One renderer for every Agent answer view (see present.js) ─────────────────────────────────
// The smallest presentation that carries the result: a figure, a comparison, a few labelled
// figures, a period, rows, headlines or prose — with the full answer one tap away under "Details".
// Sized by the PANEL (container queries in AgentResult.module.css), never by the window: a narrow
// panel stacks a table into one card per row; nothing scrolls sideways.
import { Link, useInRouterContext } from 'react-router-dom'
import styles from './AgentResult.module.css'

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

/** Rows: a compact table where the panel is wide enough; one stacked card per row where it is not. */
export function Rows({ table, testId = 'agent-result-table' }) {
  const cols = table.columns
  return (
    <div className={`${styles.rows} ${cols.length > 2 ? styles.many : ''}`} data-testid={testId}>
      <table className={styles.table}>
        <thead><tr>{cols.map(c => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
        <tbody>
          {table.rows.map((r, i) => (
            <tr key={i}>{cols.map(c => <td key={c.key} data-label={c.label}>{r[c.key] ?? '—'}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OpenLink({ link }) {
  const inRouter = useInRouterContext()
  return inRouter
    ? <Link className={styles.link} to={link.href} data-testid="agent-open-link">{link.label}</Link>
    : <a className={styles.link} href={link.href} data-testid="agent-open-link">{link.label}</a>
}

function Details({ details, sources }) {
  const has = details && (details.text || details.table || details.items?.length)
  if (!has && !sources?.length) return null
  return (
    <details className={styles.details} data-testid="agent-result-details">
      <summary>Details</summary>
      <div className={styles.detailsBody}>
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

// structured views use the column's width (so their figures sit side by side); a single figure and
// short prose stay as compact as their content
const FULL = new Set(['comparison', 'metrics', 'range', 'table', 'headlines'])

export default function AgentResult({ view }) {
  const body = (() => {
    switch (view.kind) {
      case 'value':
        return (
          <div className={styles.value} data-testid="agent-result-value">
            <div className={styles.figure}>{view.value}</div>
            {view.label && <div className={styles.label}>{view.label}</div>}
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
            <ul className={styles.headlines}>
              {view.headlines.map((h, i) => <li key={i}><span className={styles.headline}>{h.title}</span>{h.meta && <span className={styles.meta}>{h.meta}</span>}</li>)}
            </ul>
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
      <Details details={view.details} sources={view.sources} />
      {view.link && <OpenLink link={view.link} />}
    </div>
  )
}
