/**
 * Wave 13 lane 13E-2 — the Entry-context card on a position's and a trade's detail page: the
 * market as it stood at the fill, frozen once by `api/services/journal_two/entry_context.py`
 * (lane 13E-1). This component only reads and words it; every number, source and as-of is the
 * server's (contract: `docs/notebook/wave13-13e1.md`).
 *
 * `kind` is `'position' | 'trade'`; `id` is that item's own id. The backend resolves BOTH to the
 * same (symbol, entry day) key, so passing the trade's id after a position closes reads the
 * SAME frozen row the position page showed — nothing here re-derives that: the card stays after
 * the trade closes because the key does.
 *
 * ⛔ A past day (or a carried-in broker holding with no entry day) answers `status !== 'captured'`
 * and this renders the server's OWN sentence for it — never field rows, never a fabricated value.
 * Dark behind `notebook_entry_context_enabled`; a free plan's 402 renders nothing (same as off).
 */
import { useId } from 'react'
import { useEntryContextFor, useEntryContextMeta } from '../hooks/useEntryContext'
import WhyPrompt from './WhyPrompt'
import styles from './EntryContextCard.module.css'

const REGIME_DOT = {
  green: styles.dotGreen, amber: styles.dotAmber, orange: styles.dotOrange, red: styles.dotRed,
}

function capitalize(s) {
  const t = String(s || '')
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t
}

function humanizeScan(name) {
  return String(name || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** One field row. Missing is rendered as a muted "Not available" with the server's own missing
 *  reason as the title — never a guessed or blank-defaulted value. */
function FieldRow({ fieldKey, label, field, format, missingReasons }) {
  if (!field) return null
  const asOf = field.asOf ? String(field.asOf).slice(0, 10) : null
  return (
    <div className={styles.row} data-field={fieldKey}>
      <span className={styles.label}>{label}</span>
      {field.missing ? (
        <span className={styles.valueMuted} title={missingReasons?.[field.missing] || field.missing}>
          Not available
        </span>
      ) : (
        <span className={styles.value}>{format(field)}</span>
      )}
      {!field.missing && asOf && <span className={styles.asOf}>as of {asOf}</span>}
    </div>
  )
}

export default function EntryContextCard({ kind, id }) {
  const { meta } = useEntryContextMeta()
  const { enabled, status, context, reason, error, isLoading, paidOut, retry } =
    useEntryContextFor(kind, id)
  const titleId = useId()     // one per card: a position page shows a card per lot

  if (!enabled || paidOut) return null

  if (isLoading && !context) {
    return (
      <section className={styles.card} aria-labelledby={titleId} data-testid="entry-context-loading">
        <h2 id={titleId} className={styles.title}>Market context at the fill</h2>
        <p className={styles.muted}>Reading the market context…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className={styles.card} aria-labelledby={titleId}>
        <h2 id={titleId} className={styles.title}>Market context at the fill</h2>
        <p className={styles.muted} role="alert">
          Couldn’t load the market context.{' '}
          <button type="button" className={styles.linkBtn} onClick={retry}>Try again</button>
        </p>
      </section>
    )
  }

  // ⛔ A past day, or a carried-in holding with no entry day, is NEVER reconstructed: the
  // server's own sentence is the whole body, and the fields grid below is unreachable from here.
  if (status !== 'captured' || !context) {
    return (
      <SettledCard testId="entry-context-not-captured" titleId={titleId}>
        <h2 id={titleId} className={styles.title}>Market context at the fill</h2>
        <p className={styles.muted}>{reason || 'No market context was captured for this entry.'}</p>
      </SettledCard>
    )
  }

  const f = context.fields || {}
  const missingReasons = meta?.missingReasons || {}

  return (
    <SettledCard testId="entry-context-card" titleId={titleId}>
      <h2 id={titleId} className={styles.title}>
        Market context at the fill
        {context.capturedLate && (
          <span
            className={styles.lateBadge}
            data-testid="entry-context-late"
            title={`Captured ${context.captureDay}, after the entry`}
          >
            captured late
          </span>
        )}
      </h2>
      <div className={styles.grid} data-tour="entry-context-fields">
        <FieldRow fieldKey="regime" label="Regime" field={f.regime} missingReasons={missingReasons}
          format={(field) => (
            <>
              <span className={`${styles.dot} ${REGIME_DOT[field.value] || ''}`} aria-hidden="true" />
              {capitalize(field.value)}
            </>
          )} />
        <FieldRow fieldKey="exposure" label="Exposure" field={f.exposure} missingReasons={missingReasons}
          format={(field) => `${Math.round(field.value)} / 150`} />
        <FieldRow fieldKey="breadth_pct_above_50" label="% above the 50-day" field={f.breadth_pct_above_50}
          missingReasons={missingReasons} format={(field) => `${Number(field.value).toFixed(1)}%`} />
        <FieldRow fieldKey="rs_rank" label="RS rank" field={f.rs_rank} missingReasons={missingReasons}
          format={(field) => `${field.value}`} />
        <FieldRow fieldKey="days_to_earnings" label="Days to earnings" field={f.days_to_earnings}
          missingReasons={missingReasons}
          format={(field) => (field.value === 0 ? 'Reports today' : `${field.value} day${field.value === 1 ? '' : 's'}`)} />
        <FieldRow fieldKey="uct_scans" label="UCT scans" field={f.uct_scans} missingReasons={missingReasons}
          format={(field) => ((field.value || []).length ? field.value.map(humanizeScan).join(', ') : 'None')} />
      </div>
      <WhyPrompt
        symbol={context.symbol}
        entryDay={context.entryDay}
        why={context.why}
        whyMaxChars={meta?.whyMaxChars}
        onSaved={() => retry()}
      />
    </SettledCard>
  )
}

/** The card's frame once the read has settled, captured or not. It carries the
 *  entry-context walkthrough's first anchor in BOTH states (W14-Q2, measured in a browser):
 *  on the captured card only, the tour never opened for a member whose newest trade has no
 *  saved context -- every past-day entry -- and closed quietly. Its first step's sentence is
 *  true of either card; the steps after it skip on the not-captured one. */
function SettledCard({ testId, titleId, children }) {
  return (
    <section className={styles.card} aria-labelledby={titleId} data-testid={testId} data-tour="entry-context-card">
      {children}
    </section>
  )
}
