import useSWR from 'swr'
import { depthFetcher, usePendingReask } from './depthFetch'
import styles from './Depth.module.css'
import { useDepthChrome, DepthLoading, DepthBadRequest } from './depthChrome'
import PendingGaveUp from './PendingGaveUp'
import HighlightThesis from '../../../utils/highlightThesis'
import { memberText, memberSentence } from '../../../lib/presentation/memberCopy'
import { usePanelFreshness } from '../../../components/terminal/terminalPanel'

// FT-064 — EVTS: this ticker's events staged against the nearest earnings print
// (T-n / T / T+n in weekdays). DARK behind EVENTS_TIMELINE_ENABLED.
//
// ⛔ Every event names its source. A source that could not be read says so,
//    so "no events" is never confused with "could not look".
// ⛔ The offset unit is printed: weekdays, holidays not removed.

const KIND = { earnings: 'Earnings', uct_catalyst: 'UCT catalyst', filing: 'Filing', room_spike: 'Room' }

export default function EventsPanel({ sym }) {
  const chrome = useDepthChrome()
  const s = (sym || '').toUpperCase().trim()
  const { data, error, mutate } = useSWR(s ? `/api/research/events/${encodeURIComponent(s)}` : null,
    depthFetcher, { revalidateOnFocus: false })
  // tq-panels: any source still being read (not only earnings) re-asks, and is named.
  const pendingKinds = Object.entries(data?.sources || {}).filter(([, v]) => v?.state === 'pending').map(([k]) => KIND[k] || k)
  const reask = usePendingReask(pendingKinds.length > 0, mutate, s)
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header when it is the
  // whole panel (a DPTH stack names "several" itself); a no-op outside the terminal.
  // Events come from several feeds and each row names its own, so the header says exactly that.
  usePanelFreshness(chrome.alone && data && !data.paywalled && !data.badRequest && !error ? { source: 'several feeds; each row names its own' } : null)

  let body
  if (error) body = <div className={styles.error} data-testid="events-unavailable">Events are unavailable right now. That is a gap in what we could read, not a finding about {s}.{' '}<button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button></div>
  else if (!data) body = <DepthLoading inPanel={chrome.inPanel} label="Loading events" />
  else if (data.paywalled) body = <div className={styles.note}>Events require a paid plan.</div>
  else if (data.badRequest) body = <DepthBadRequest sentence={memberSentence(data.badRequest)} />
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
        {pendingKinds.length > 0 && (
          <p className={styles.note} data-testid="events-pending">
            Still reading: {pendingKinds.join(', ')}. Events from {pendingKinds.length > 1 ? 'those sources' : 'that source'} appear when the read finishes.
          </p>
        )}
        {events.length === 0
          ? <p className={styles.note} data-testid="events-empty">
            {/* tq-panels: "No events on file" while a source is still pending was a claim
                about sources not yet read. */}
            {pendingKinds.length > 0
              ? `No events on file yet — ${pendingKinds.join(', ')} ${pendingKinds.length > 1 ? 'are' : 'is'} still being read.`
              : 'No events on file in the sources read.'}
          </p>
          : (
            <div className={styles.scroll}>
              <table className={styles.grid} aria-label="Events around the print">
                <thead><tr><th scope="col">Date</th><th scope="col">Stage</th><th scope="col">Event</th><th scope="col">Source</th></tr></thead>
                <tbody>
                  {events.map((e, i) => (
                    <tr key={`${e.date}-${e.kind}-${i}`} data-testid="event-row">
                      <th scope="row">{e.date}</th>
                      <td title={e.print_date ? `${e.print_label} (${e.print_state}) on ${e.print_date}` : undefined}>
                        {e.stage ? `${e.stage} ${e.print_label}` : '—'}
                      </td>
                      <td className={styles.text}>
                        <strong>{KIND[e.kind] || e.kind}</strong> <HighlightThesis text={e.title} />{e.detail ? <> — <HighlightThesis text={e.detail} /></> : ''}
                        {e.url ? <> · <a href={e.url} target="_blank" rel="noopener noreferrer">document</a></> : null}
                      </td>
                      <td className={styles.text}>{memberText(e.source)}</td>
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
    <section className={chrome.panelClass} data-testid="events-panel">
      {chrome.showTitle && <h3 className={styles.panelTitle}>Events around the print</h3>}
      {/* Names what is still pending: it is not always the earnings read (audit 2026-10-08). */}
      <PendingGaveUp exhausted={reask.exhausted} onRetry={reask.retry} what={pendingKinds.length ? `The ${pendingKinds.join(', ')} read` : 'The events read'} />
      {body}
    </section>
  )
}
