import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import UIcon from '../../../../components/ui/UIcon'
import LoadFailed from '../LoadFailed'
import {
  PASSED_URL, passedSetupsEnabled, fetchPassedSetups, addPassedSetup, removePassedSetup,
  SOURCE_TEXT, HORIZON_TEXT, outcomeText, fmtDay,
} from '../../lib/researchCapture'
import styles from './PassedSetups.module.css'

/** Today's date in New York, 'YYYY-MM-DD' -- the day the server dates a pass by. */
function etToday() {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

function Outcome({ o }) {
  const has = typeof o.pct === 'number'
  const tone = !has ? styles.gap : o.pct > 0 ? styles.up : o.pct < 0 ? styles.down : ''
  return (
    <div className={styles.cell} data-outcome={o.key} data-missing={o.missing || undefined}>
      <span className={styles.cellLabel}>{HORIZON_TEXT[o.key] || o.key}</span>
      <span className={`${styles.cellValue} ${tone}`}>{outcomeText(o)}</span>
    </div>
  )
}

/**
 * Wave 13 lane 13G-1 -- "Passed setups" on Research Home.
 *
 * Names the member saved (a scanner or Screener capture in a note, a name added to their own
 * watchlist, or one added here) and did NOT trade, with what happened next: +1, +5, +10 and +20
 * sessions and the best move within 20, scored by the server from the stored daily bars. A cell
 * with no bar says why (the server's label), never a number. A name traded within 10 sessions
 * leaves the list; the count is shown, so nothing disappears silently.
 *
 * Renders nothing, and fetches nothing, while `notebook_passed_setups_enabled` is off.
 */
export default function PassedSetups() {
  const enabled = passedSetupsEnabled()
  const { data, error, isLoading, mutate } = useSWR(
    enabled ? PASSED_URL : null, () => fetchPassedSetups(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  // The list is a plain read; the server refreshes scores AFTER answering and says so
  // (`refreshQueued`). One follow-up read picks the fresher list up. The server queues at
  // most one refresh per member per interval, so the follow-up never asks for another.
  const refreshQueued = data?.refreshQueued === true
  useEffect(() => {
    if (!refreshQueued) return undefined
    const t = setTimeout(() => { mutate() }, 2500)
    return () => clearTimeout(t)
  }, [refreshQueued, mutate])
  const [symbol, setSymbol] = useState('')
  const [savedOn, setSavedOn] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  // FIN-A11Y (review R4, M-5): Add and Remove were silent, and Remove took the focused
  // button away. `notice` fills a status line that is always mounted; after a remove, focus
  // goes to the row that took the removed one's place (else the row before, else the field).
  const [notice, setNotice] = useState('')
  const listRef = useRef(null)
  const tickerRef = useRef(null)
  const focusRowRef = useRef(null) // index of the removed row, until the list re-renders
  const rowCount = Array.isArray(data?.items) ? data.items.length : 0
  useEffect(() => {
    const at = focusRowRef.current
    if (at == null) return
    focusRowRef.current = null
    const buttons = [...(listRef.current?.querySelectorAll('[data-passed-remove]') || [])]
    const target = buttons[Math.min(at, buttons.length - 1)] || tickerRef.current
    target?.focus()
  }, [rowCount])

  if (!enabled) return null

  const add = async (e) => {
    e.preventDefault()
    const sym = symbol.trim().toUpperCase().replace(/^\$/, '')
    if (!sym || busy) return
    setBusy(true)
    setMessage('')
    try {
      await addPassedSetup({ symbol: sym, savedOn: savedOn || undefined })
      setSymbol('')
      await mutate()
      setNotice(`Added ${sym} to passed setups.`)
    } catch (err) {
      setMessage(err?.message || `Couldn't add ${sym}. Nothing was saved — try again.`)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item) => {
    setMessage('')
    const at = (Array.isArray(data?.items) ? data.items : []).findIndex((i) => i.id === item.id)
    try {
      await removePassedSetup(item.id)
      focusRowRef.current = at < 0 ? 0 : at
      await mutate()
      setNotice(`Removed ${item.symbol} from passed setups.`)
    } catch (err) {
      setMessage(err?.message || `Couldn't remove ${item.symbol}. Try again.`)
    }
  }

  const items = Array.isArray(data?.items) ? data.items : []
  const traded = data?.tradedCount || 0

  return (
    <section className={styles.section} aria-labelledby="passed-setups-title" data-passed-setups="">
      <div className={styles.header}>
        <h3 id="passed-setups-title" className={styles.title}>Passed setups</h3>
        <span className={styles.scope}>
          Names you saved from a scan or a watchlist and did not trade — what happened next
        </span>
      </div>

      <form className={styles.addRow} onSubmit={add} aria-label="Add a passed setup" data-tour="passed-add">
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Ticker</span>
          <input ref={tickerRef} className={styles.input} value={symbol} onChange={(e) => setSymbol(e.target.value)}
            placeholder="NVDA" autoComplete="off" aria-label="Ticker you passed on" />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Passed on</span>
          <input className={styles.input} type="date" value={savedOn} max={etToday()}
            onChange={(e) => setSavedOn(e.target.value)} aria-label="Day you passed on it" />
        </label>
        <button type="submit" className={`${styles.action} ${styles.primary}`} disabled={busy || !symbol.trim()}>
          <UIcon name="plus" size={13} gold={false} /> {busy ? 'Adding…' : 'Add'}
        </button>
      </form>

      {error && <LoadFailed compact what="your passed setups" error={error} onRetry={() => mutate()} />}
      {!error && isLoading && <p className={styles.quiet} role="status">Scoring your passed setups…</p>}
      {!error && data && items.length === 0 && (
        <p className={styles.quiet}>
          Nothing here yet. Names you save from a scanner or add to a watchlist show up here, scored on
          what they did next — or add one above.
        </p>
      )}

      {items.length > 0 && (
        <ul ref={listRef} className={styles.list} aria-label="Passed setups" data-tour="passed-list">
          {items.map((item) => (
            <li key={item.id} className={styles.row} data-passed-symbol={item.symbol} data-status={item.status}>
              <div className={styles.main}>
                <Link className={styles.symbol}
                  to={`/journal/notebook/research/${encodeURIComponent(item.symbol)}`}
                  aria-label={`${item.symbol} research`}>
                  ${item.symbol}
                </Link>
                <span className={styles.chip}>{SOURCE_TEXT[item.source] || item.source}</span>
                <span className={styles.when}>
                  Saved {fmtDay(item.savedDay)}
                  {item.baseDate ? ` · from the ${fmtDay(item.baseDate)} close` : ''}
                </span>
                <button type="button" className={styles.remove} onClick={() => remove(item)}
                  aria-label={`Remove ${item.symbol} from passed setups`} data-passed-remove="">
                  <UIcon name="x" size={12} gold={false} />
                </button>
              </div>
              {item.noBarsLabel ? (
                <p className={styles.quiet} data-no-bars="">{item.noBarsLabel}.</p>
              ) : (
                <div className={styles.cells} data-tour="passed-outcomes">
                  {item.outcomes.map((o) => <Outcome key={o.key} o={o} />)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {traded > 0 && (
        <p className={styles.note} role="note">
          {traded} name{traded === 1 ? '' : 's'} you traded within {data?.tradedWithin ?? 10} sessions of
          saving {traded === 1 ? 'is' : 'are'} not listed.
        </p>
      )}
      {message && <p className={styles.error} role="alert">{message}</p>}
      <p className={`${styles.quiet} ${styles.notice}`} role="status" data-passed-status="">{notice}</p>
    </section>
  )
}
