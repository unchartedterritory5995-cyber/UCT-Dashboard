import CoverageLine from '../../../../components/provenance/CoverageLine'
import { SCREENER_CAPTURE_ROW_CAP } from '../../../../widgets/registry'
import { encodeSpec, SPEC_PARAM } from '../../../screener/shell/specUrl'
import { embedAutoCaption } from '../../lib/widgetEmbedCore'
import { etDateTime } from './captureStamp'
import styles from './InternalCaptureEmbed.module.css'

/**
 * G-040 ruling 1 — the Screener capture's journal renderer.
 *
 * ⛔⛔ A FROZEN SNAPSHOT. IT NEVER RE-RUNS ON OPEN. Everything on this card is
 * read from `attrs.params`, which froze the result set as the member saw it: the
 * screen's name and its criteria as text, the data's own as-of, the columns shown,
 * the first rows (ticker + those columns' values, as displayed) and the total match
 * count. This file makes NO request — `ScreenerEmbed.test.jsx` hands `fetch` a
 * different live answer and proves it is never asked and never shown.
 *
 * ⭐ "Run this scan now" is the ONE way back to live data, and it says what it is:
 * a link that opens the Screener with the captured definition — a NEW run on
 * today's data, labelled as such, never a refresh of this card.
 *
 * ⭐ HONEST EMPTINESS. A screen that matched nothing, or a scan filter whose sweep
 * could not compute some symbols, is carried as captured: the coverage renders
 * through the Screener's OWN `CoverageLine` (evaluated · answered · dropped · not
 * computable), so the words are the ones the member read on the page.
 */

/** The Screener URL that re-runs a captured definition, or null when none was kept. */
export function screenerRunHref(spec) {
  if (!spec || typeof spec !== 'object') return null
  try {
    const enc = encodeSpec(spec)
    return enc ? `/screener?${SPEC_PARAM}=${enc}` : '/screener'
  } catch {
    return null
  }
}

export default function ScreenerEmbed({ attrs, height = 320 }) {
  const p = attrs?.params || {}
  const columns = Array.isArray(p.columns) ? p.columns : []
  const rows = Array.isArray(p.rows) ? p.rows.slice(0, SCREENER_CAPTURE_ROW_CAP) : []
  const total = Number.isFinite(p.total) ? p.total : 0
  const criteria = Array.isArray(p.criteria) ? p.criteria.filter((c) => typeof c === 'string' && c) : []
  const receipts = Array.isArray(p.coverage) ? p.coverage.filter((r) => r && r.coverage) : []
  const captured = etDateTime(attrs?.capturedAt)
  const runHref = screenerRunHref(p.spec)
  const name = p.name || 'Screen'

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="screener-embed">
      <div className={styles.root}>
        <div className={styles.head}>
          <span className={styles.title}>{name}</span>
          <span className={styles.sub} data-testid="screener-embed-total">
            {total.toLocaleString('en-US')} {total === 1 ? 'match' : 'matches'}
          </span>
        </div>
        <p className={styles.stamp} data-testid="screener-embed-asof">
          As of {p.asOf || 'an unrecorded time'}{captured ? ` · captured ${captured}` : ''}
        </p>
        {criteria.length > 0 && (
          <ul className={styles.criteria} aria-label="Screen criteria">
            {criteria.map((c) => <li key={c} className={styles.chip}>{c}</li>)}
          </ul>
        )}
        {receipts.map((r, i) => (
          <section key={`${r.label || 'coverage'}-${i}`} aria-label={`Coverage of ${r.label || 'this screen'}`}>
            {r.label ? <p className={styles.note}>Scan filter: {r.label}</p> : null}
            <CoverageLine coverage={r.coverage} />
          </section>
        ))}
        {rows.length === 0 ? (
          <p className={styles.note} data-testid="screener-embed-empty">
            No stocks matched this screen when it was captured.
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label={`${name} — captured results`}>
              <thead>
                <tr>{columns.map((c) => <th key={c.key} scope="col">{c.label || c.key}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.ticker || i}`} data-testid={`screener-embed-row-${r.ticker}`}>
                    {columns.map((c, j) => (
                      <td key={c.key}>{Array.isArray(r.cells) && r.cells[j] != null ? String(r.cells[j]) : '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > rows.length && rows.length > 0 && (
          <p className={styles.note} data-testid="screener-embed-cut">
            Showing the first {rows.length} of {total.toLocaleString('en-US')} matches, as captured.
          </p>
        )}
        {runHref && (
          <p className={styles.note}>
            <a className={styles.link} href={runHref} data-testid="screener-embed-run">Run this scan now</a>
            {' '}— a new run on today&rsquo;s data, not this snapshot.
          </p>
        )}
      </div>
    </div>
  )
}
