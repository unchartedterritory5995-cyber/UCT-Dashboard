import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import useSWR from 'swr'
import UIcon from '../../../../components/ui/UIcon'
import LoadFailed from '../LoadFailed'
import {
  SOON_URL, earningsPrepEnabled, fetchReportingSoon, createEarningsPrepNote, fmtShortDay,
  sourceLabel, timingLabel,
} from '../../lib/earningsPrep'
import { NOTEBOOK_PREP_HASH } from '../../lib/notebookDoors'
import styles from './ReportingSoon.module.css'

function whenText(item) {
  const day = item.daysAway === 0 ? 'Today' : item.daysAway === 1 ? 'Tomorrow' : fmtShortDay(item.date)
  const t = timingLabel(item.timing)
  return t ? `${day}, ${t}` : `${day}, time not announced yet`
}

/**
 * Wave 13 lane 13C, phase 1 -- "Reporting soon" on Research Home.
 *
 * The member's OWN names (watchlists, flagged, open positions) that report in the next seven
 * days, each with one click to draft a prep note. ⛔ Nothing is drafted or created until that
 * click (decision R5): this component only READS the list, and only while
 * `notebook_earnings_prep_enabled` is latched on -- off, it renders nothing and fetches nothing.
 *
 * A name already prepped in the last three weeks offers Open instead of a second draft.
 */
export default function ReportingSoon({ onOpenNote }) {
  const enabled = earningsPrepEnabled()
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? SOON_URL : null, () => fetchReportingSoon(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  const [busy, setBusy] = useState(null)
  const [message, setMessage] = useState('')

  // Lane KEYS3 (Q15): the command palette's "Earnings prep" arrives with `#prep`. Once the
  // list has loaded, focus goes to the first name's prep button (it sat behind "Ask Notebook"
  // and the name's research link); in a week with no names, to this box's heading, where the
  // reason is read. Once per arrival (`location.key`), a frame after the palette has closed.
  const location = useLocation()
  const sectionRef = useRef(null)
  const answeredRef = useRef(null)
  const loaded = Boolean(data) && !error
  useEffect(() => {
    if (!enabled || !loaded) return undefined
    if (location.hash !== NOTEBOOK_PREP_HASH || answeredRef.current === location.key) return undefined
    answeredRef.current = location.key
    const raf = requestAnimationFrame(() => {
      const root = sectionRef.current
      const target = root?.querySelector('ul button') || root?.querySelector('h3')
      target?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [enabled, loaded, location.hash, location.key])

  if (!enabled) return null

  const create = async (symbol) => {
    if (busy) return
    setBusy(symbol)
    setMessage('')
    try {
      const note = await createEarningsPrepNote({ symbol })
      mutate()
      onOpenNote?.(note)
    } catch (e) {
      console.error('[earnings-prep] create failed', e)
      setMessage(e?.status === 429 && e.message
        ? e.message
        : `Couldn't draft the ${symbol} prep note. Nothing was saved — try again.`)
    } finally {
      setBusy(null)
    }
  }

  const items = Array.isArray(data?.items) ? data.items : []
  const days = data?.windowDays ?? 7

  return (
    // W14-Q2: the earnings-prep walkthrough's first anchor is the box itself, not the list.
    // On the list, the tour never opened for a member with no name reporting this week (the
    // common case, and every new member's): it waited on Home and closed with nothing shown.
    <section className={styles.section} aria-labelledby="reporting-soon-title" data-reporting-soon=""
      data-tour="reporting-soon-list" ref={sectionRef}>
      <div className={styles.header}>
        <h3 id="reporting-soon-title" className={styles.title} tabIndex={-1}>Reporting soon</h3>
        <span className={styles.scope}>Your watchlist, flagged and open-position names, next {days} days</span>
      </div>
      {error && (
        <LoadFailed compact what="the earnings calendar for your names" error={error} onRetry={() => mutate()} />
      )}
      {!error && isLoading && <p className={styles.quiet} role="status">Checking the calendar…</p>}
      {!error && data && items.length === 0 && (
        <p className={styles.quiet}>
          None of your watchlist, flagged or open-position names report in the next {days} days.
          A prep note is one click here once one does.
        </p>
      )}
      {!error && data?.partial && (
        <p className={styles.note} role="note">
          Some calendar days could not be read just now, so a name may be missing from this list.
        </p>
      )}
      {items.length > 0 && (
        <ul className={styles.list} aria-label="Names reporting soon">
          {items.map((item) => (
            <li key={item.symbol} className={styles.row}>
              <span className={styles.main}>
                <Link className={styles.symbol} to={`/journal/notebook/research/${encodeURIComponent(item.symbol)}`}
                  aria-label={`${item.symbol} research`}>
                  ${item.symbol}
                </Link>
                <span className={styles.when} data-tour="reporting-soon-when">{whenText(item)}</span>
                <span className={styles.chips} data-tour="reporting-soon-sources">
                  {(item.sources || []).map((s) => <span key={s} className={styles.chip}>{sourceLabel(s)}</span>)}
                </span>
              </span>
              {item.prepNote ? (
                <button type="button" className={styles.action}
                  onClick={() => onOpenNote?.({ id: item.prepNote.id })}
                  aria-label={`Open the ${item.symbol} prep note`}>
                  <UIcon name="book" size={13} gold={false} /> Open prep note
                </button>
              ) : (
                <button type="button" className={`${styles.action} ${styles.primary}`}
                  onClick={() => create(item.symbol)} disabled={!!busy} data-tour="reporting-soon-prep"
                  aria-label={`Create prep note for ${item.symbol}`}>
                  <UIcon name="plus" size={13} gold={false} />
                  {busy === item.symbol ? ' Drafting…' : ' Create prep note'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {message && <p className={styles.error} role="alert">{message}</p>}
    </section>
  )
}
