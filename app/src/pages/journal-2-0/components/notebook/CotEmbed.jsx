import { COT_CAPTURE_GROUPS } from '../../../../widgets/registry'
import { fmtNum, fmtSignedCompact } from '../../../cot/cotFormat'
import { embedAutoCaption } from '../../lib/widgetEmbedCore'
import { etDate, isoDayText } from './captureStamp'
import styles from './InternalCaptureEmbed.module.css'

/**
 * G-040 ruling 2 — the COT capture's journal renderer.
 *
 * ⛔⛔ A FROZEN SNAPSHOT OF ONE MARKET AT ONE REPORT WEEK. IT NEVER RE-FETCHES.
 * The CFTC revises its data, so `/api/cot/{symbol}` can later disagree with the
 * figures the member saw; the note keeps what they saw. Every number below is read
 * from `attrs.params` — net, week-over-week change and 3-year COT Index for each
 * trader group, open interest, and the rail's two verdicts as shown. This file
 * makes NO request; `CotEmbed.test.jsx` proves a live answer is never asked for.
 *
 * ⭐ "Current COT for <market>" is the one way to today's positioning, and it opens
 * the COT tab on that market — a different week, never a refresh of this card.
 */

// The rail's own short labels (pages/cot/cotRead.js GROUPS `short`).
const GROUP_LABEL = { commercials: 'Commercials', largeSpecs: 'Large Specs', smallSpecs: 'Small Specs' }

const indexText = (v) => (Number.isFinite(v) ? String(Math.round(v)) : '—')

/** The COT tab, opened on one market. */
export function cotHref(market) {
  if (typeof market !== 'string' || !/^[A-Za-z0-9]{1,6}$/.test(market)) return null
  return `/breadth?tab=cot&cot=${encodeURIComponent(market)}`
}

export default function CotEmbed({ attrs, height = 320 }) {
  const p = attrs?.params || {}
  const groups = p.groups && typeof p.groups === 'object' ? p.groups : {}
  const oi = p.openInterest && typeof p.openInterest === 'object' ? p.openInterest : null
  const week = isoDayText(p.reportDate)
  const captured = etDate(attrs?.capturedAt)
  const href = cotHref(p.market)

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="cot-embed">
      <div className={styles.root}>
        <div className={styles.head}>
          <span className={styles.title}>{p.marketName ? `${p.marketName} (${p.market})` : p.market}</span>
          <span className={styles.sub}>COT positioning</span>
        </div>
        <p className={styles.stamp} data-testid="cot-embed-week">
          Report week {week || 'unknown'}, captured {captured || 'at an unrecorded time'}
        </p>
        <div className={styles.verdicts}>
          {p.bias?.label && (
            <div className={styles.tile}>
              <div className={styles.tileLabel}>Contrarian bias</div>
              <div className={styles.tileValue} data-testid="cot-embed-bias">{p.bias.label}</div>
              <div className={styles.tileLabel}>
                {p.bias.strength ? `${p.bias.strength} signal · 3Y index` : 'no group at an extreme'}
              </div>
            </div>
          )}
          {p.crowding?.label && (
            <div className={styles.tile}>
              <div className={styles.tileLabel}>Crowding</div>
              <div className={styles.tileValue} data-testid="cot-embed-crowding">{p.crowding.label}</div>
              <div className={styles.tileLabel}>large specs · 3Y index {indexText(p.crowding.index)}</div>
            </div>
          )}
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table} aria-label="Net positioning by trader group, as captured">
            <thead>
              <tr>
                <th scope="col">Group</th>
                <th scope="col">Net</th>
                <th scope="col">WoW</th>
                <th scope="col">3Y index</th>
              </tr>
            </thead>
            <tbody>
              {COT_CAPTURE_GROUPS.map((k) => {
                const g = groups[k] || {}
                return (
                  <tr key={k} data-testid={`cot-embed-${k}`}>
                    <td>{GROUP_LABEL[k]}</td>
                    <td>{fmtNum(g.net) || '—'}</td>
                    <td>{fmtSignedCompact(g.wow)}</td>
                    <td>{indexText(g.index)}</td>
                  </tr>
                )
              })}
              {oi && (
                <tr data-testid="cot-embed-oi">
                  <td>Open Interest</td>
                  <td>{fmtNum(oi.value) || '—'}</td>
                  <td>{fmtSignedCompact(oi.wow)}</td>
                  <td>{indexText(oi.index)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {href && (
          <p className={styles.note}>
            <a className={styles.link} href={href} data-testid="cot-embed-current">Current COT for {p.market}</a>
            {' '}— the latest report, not this week.
          </p>
        )}
      </div>
    </div>
  )
}
