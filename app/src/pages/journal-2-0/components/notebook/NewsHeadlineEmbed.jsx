import { embedAutoCaption } from '../../lib/widgetEmbedCore'
import { etDateTime } from './captureStamp'
import styles from './InternalCaptureEmbed.module.css'

/**
 * UCT News V2 -- a Trade Exchange headline sent to the Notebook from UCT News
 * ("Send to Notebook", lib/tradeExchangeNewsNotebook.js).
 *
 * ⛔ A FROZEN REFERENCE. Everything here is read from `attrs.params`: the headline exactly as
 * Trade Exchange sent it, UCT's RECEIPT time (Trade Exchange sends no publication time, so
 * it is labelled as receipt), the source, the tickers UCT linked, and the headline's
 * permanent archive id (`eventId`, the R2 journal key every UCT News headline is kept
 * under). This file makes no request. The member's own research goes in the note around
 * it -- charts, longer notes -- with the Notebook's own tools.
 */
export default function NewsHeadlineEmbed({ attrs, height = 150 }) {
  const p = attrs?.params || {}
  const tickers = Array.isArray(p.tickers) ? p.tickers.filter((t) => typeof t === 'string' && t) : []
  const received = Number.isFinite(p.receivedAtMs) ? etDateTime(new Date(p.receivedAtMs).toISOString()) : null
  const captured = etDateTime(attrs?.capturedAt)
  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="news-headline-embed">
      <div className={styles.root}>
        <div className={styles.head}>
          <span className={styles.title}>UCT News</span>
          <span className={styles.sub}>{p.source || 'Trade Exchange'}</span>
        </div>
        <p className={styles.stamp} data-testid="news-headline-embed-received">
          Received by UCT {received || 'at an unrecorded time'}{captured ? ` · sent to Notebook ${captured}` : ''}
        </p>
        <p className={styles.headline} data-testid="news-headline-embed-text">{p.content || ''}</p>
        {tickers.length > 0 && (
          <ul className={styles.criteria} aria-label="Tickers">
            {tickers.map((t) => <li key={t} className={styles.chip}>{t}</li>)}
          </ul>
        )}
        <p className={styles.note} data-testid="news-headline-embed-ref">
          Archived permanently in UCT News · ref {p.eventId || 'unknown'}
        </p>
      </div>
    </div>
  )
}
