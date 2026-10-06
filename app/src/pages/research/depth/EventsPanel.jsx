import useSWR from 'swr'
import { depthFetcher, usePendingReask } from './depthFetch'
import styles from './Depth.module.css'
import PendingGaveUp from './PendingGaveUp'
import HighlightThesis from '../../../utils/highlightThesis'
import { memberText } from '../../../lib/presentation/memberCopy'

// FT-064 — EVTS: this ticker's events staged against the nearest earnings print
// (T-n / T / T+n in weekdays). DARK behind EVENTS_TIMELINE_ENABLED.
//
// ⛔ Every event names its source. A source that could not be read says so,
//    so "no events" is never confused with "could not look".
// ⛔ The offset unit is printed: weekdays, holidays not removed.

const KIND = { earnings: 'Earnings', uct_catalyst: 'UCT catalyst', filing: 'Filing', room_spike: 'Room' }

export default function EventsPanel({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error, mutate } = useSWR(s ? `/api/research/events/${encodeURIComponent(s)}` : null,
    depthFetcher, { revalidateOnFocus: false })
  const reask = usePendingReask(data?.sources?.earnings?.state === 'pending', mutate, s)

  let body
  if (error) body = <div className={styles.error} data-testid="events-unavailable">Events are unavailable right now. That is a gap in what we could read, not a finding about {s}.</div>
  else if (!data) body = <div className={styles.note}>Loading events…</div>
  else if (data.paywalled) body = <div className={styles.note}>Events require a paid plan.</div>
  else {
    const errs = Object.entries(data.sources || {}).filter(([, v]) => v.state === 'error')
    const events = [...(data.events || [])].reverse()
    body = (
      <div data-testid="events">
        {data.state !== 'ok' && <p className={styles.note} data-testid="events-unstaged">Not staged against a print: {memberText(data.reason)}.</p>}
        {errs.length > 0 && (
          <p className={styles.error} data-testid="events-source-errors">
            Could not read: {errs.map(([k]) => KIND[k] || k).join(', ')}. Events from those sources are missing, not absent.
          </p>
        )}
        {events.length === 0
          ? <p className={styles.note} data-testid="events-empty">No events on file in the sources read.</p>
          : (
            <div className={styles.scroll}>
              <table className={styles.grid}>
                <thead><tr><th scope="col">Date</th><th scope="col">Stage</th><th scope="col">Event</th><th scope="col">Source</th></tr></thead>
                <tbody>
                  {events.map((e, i) => (
                    <tr key={`${e.date}-${e.kind}-${i}`} data-testid="event-row">
                      <th scope="row">{e.date}</th>
                      <td title={e.print_date ? `${e.print_label} (${e.print_state}) on ${e.print_date}` : undefined}>
                        {e.stage ? `${e.stage} ${e.print_label}` : '—'}
                      </td>
                      <td style={{ whiteSpace: 'normal', textAlign: 'left' }}>
                        <strong>{KIND[e.kind] || e.kind}</strong> <HighlightThesis text={e.title} />{e.detail ? <> — <HighlightThesis text={e.detail} /></> : ''}
                        {e.url ? <> · <a href={e.url} target="_blank" rel="noopener noreferrer">document</a></> : null}
                      </td>
                      <td style={{ whiteSpace: 'normal', textAlign: 'left' }}>{memberText(e.source)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        <p className={styles.muted} data-testid="events-unit">Offsets are counted in {data.offset_unit}.</p>
      </div>
    )
  }
  return (
    <section className={styles.panel} data-testid="events-panel">
      <h3 className={styles.panelTitle}>Events around the print</h3>
      <PendingGaveUp exhausted={reask.exhausted} onRetry={reask.retry} what="The earnings read" />
      {body}
    </section>
  )
}
