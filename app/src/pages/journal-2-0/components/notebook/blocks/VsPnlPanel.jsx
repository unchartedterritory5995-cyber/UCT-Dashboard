// The "vs P&L" panel (Notebook widgets phase 2, wave 9, Task 9.15): the ONE comparison body the routine block and the
// tracker block flip to. It replaces the in-block vs P&L sentence Task 9.14 drew in TrackerBlock (ruling W9-R45: one
// authority), and keeps that sentence's refresh rule: a new `refreshKey` reads again, the last comparison stays on
// screen while it does.
//
// What it shows, from the server's answer (Task 9.7, api/services/journal_two/routine_insights.py):
//   * the server's `sentence`, without its trailing caveat;
//   * per group its `text` ("+$95 average (22 days)", or the words that replace a value: "Not enough days yet (3)",
//     "No days with trades yet."), with a "small sample" badge when `sample === 'small'` (5 to 19 days);
//   * for a routine, the win-rate pair ("Win rate on days you finished it: 58% (22 days). Other days: 41% (9 days).");
//   * "A comparison, not proof." as its LAST line, in every state (loading and a failed read included).
// A routine's groups are "On days you finished it" (done) and "Other days" (not done or skipped); a tracker's are its
// value ranges, in the server's bucket order, a range with no days left out (as the server's own sentence does).
// With no days at all only the sentence ("No days with trades yet.") and the caveat are shown.
//
// ⛔ A failed read never renders a number: it says FAILED with a Retry. The Retry is `aria-disabled` while its read is
//    on its way (a guard, never `disabled`), and focus lands on the panel once the comparison is in.
// ⛔ It reads LAZILY: nothing while `hidden`, once when first shown, never again for a hide and show (a block keeps the
//    panel mounted, hidden, after its first flip), and again only for a new `refreshKey` while shown.
// ⛔ It is not a live region (the block owns the ONE live region); it makes no write and calls no `setParams`.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { vsPnl } from '../../../lib/blocks/toolsApi'
import own from './VsPnlPanel.module.css'

export const CAVEAT = 'A comparison, not proof.'
export const FAILED = "Can't load the comparison right now."
export const SMALL_SAMPLE = 'small sample'
/** The flip controls' words (brief 9.15) and the ⋯ menu row that makes the panel a block's first view. */
export const ROUTINE_FLIP = 'P&L on days you finished it'
export const TRACKER_FLIP = 'Compare with P&L'
export const PNL_FIRST = 'Show the P&L comparison first'
const DONE_LABEL = 'On days you finished it'
const OTHER_LABEL = 'Other days'
const PANEL_NAME = 'P&L comparison'

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
/** A group as the server sends it (`{avg, n, sample, text}`), else null. */
const groupOf = (g) => (g && typeof g === 'object' && Number.isInteger(g.n) && g.n >= 0 && typeof g.text === 'string' && g.text
  ? { avg: finite(g.avg) ? g.avg : null, n: g.n, small: g.sample === 'small', text: g.text }
  : null)
/** A sentence part ending in exactly one full stop (the server's `_stop`). */
const stop = (s) => (s.endsWith('.') ? s : `${s}.`)
const daysText = (n) => (n === 1 ? '1 day' : `${n} days`)

/** One side of the win-rate pair: "58% (22 days)", or the server's words when there is no value to show. The percent
 *  is the server's own rounding (half up on the value times 100; the value is never negative). */
function rateSide(g) {
  if (g.avg !== null && g.n > 0) return `${Math.round(g.avg * 100)}% (${daysText(g.n)})`
  return g.text
}
/** The routine's win-rate pair, or null when its groups are not readable. */
export function winRateLine(rate) {
  const done = groupOf(rate?.done)
  const other = groupOf(rate?.other)
  if (!done || !other) return null
  return `Win rate on days you finished it: ${stop(rateSide(done))} ${OTHER_LABEL}: ${stop(rateSide(other))}`
}

/** The server's answer as what the panel draws, or null when it is not a comparison (no sentence: a failure). */
function viewOf(kind, data) {
  if (!data || typeof data !== 'object' || typeof data.sentence !== 'string' || !data.sentence.trim()) return null
  const s = data.sentence.trim()
  const lead = (s.endsWith(CAVEAT) ? s.slice(0, -CAVEAT.length) : s).trim()
  let groups = []
  let rate = null
  let rateSmall = false
  if (kind === 'routine') {
    const done = groupOf(data.done)
    const other = groupOf(data.other)
    if (done && other && (done.n > 0 || other.n > 0)) {
      groups = [{ label: DONE_LABEL, ...done }, { label: OTHER_LABEL, ...other }]
      rate = winRateLine(data.winRate)
      rateSmall = !!rate && [data.winRate.done, data.winRate.other].some((g) => groupOf(g)?.small)
    }
  } else if (Array.isArray(data.buckets)) {
    groups = data.buckets
      .map((b) => (b && typeof b.label === 'string' && b.label ? { label: b.label, ...groupOf(b) } : null))
      .filter((g) => g && typeof g.text === 'string' && g.n > 0)
  }
  return { lead, groups, rate, rateSmall }
}

export default function VsPnlPanel({ kind, id, refreshKey = '', hidden = false }) {
  const key = `${kind}|${id}`
  const want = `${key}|${refreshKey}`
  const [shown, setShown] = useState(null)      // { key, view } | { key, failed: true }: the last answer for this tool
  const [busy, setBusy] = useState(false)
  const [retries, setRetries] = useState(0)
  const asked = useRef(null)                    // the read last sent: `${want}|${retries}`
  const alive = useRef(true)
  const root = useRef(null)
  const focusNext = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const ask = `${want}|${retries}`
  useEffect(() => {
    if (hidden || !id || asked.current === ask) return
    asked.current = ask
    const mine = ask
    setBusy(true)
    vsPnl(kind, id).then((r) => {
      // An answer for an older read (a newer refresh or retry was sent since) is dropped.
      if (!alive.current || asked.current !== mine) return
      setBusy(false)
      const view = r.ok ? viewOf(kind, r.data) : null
      setShown(view ? { key, view } : { key, failed: true })
    })
  }, [hidden, id, kind, key, ask])

  const cur = shown?.key === key ? shown : null
  const retry = useCallback(() => {
    if (busy) return
    focusNext.current = true
    setRetries((n) => n + 1)
  }, [busy])
  // After a Retry, once the comparison is in: the panel itself (the Retry it was on is gone).
  useLayoutEffect(() => {
    if (!focusNext.current || busy || !cur?.view) return
    focusNext.current = false
    root.current?.focus?.()
  }, [busy, cur])

  let body
  if (!cur) {
    body = <p className={own.line} data-pnl-loading="">Loading…</p>
  } else if (cur.failed) {
    body = (
      <div className={own.row}>
        <p className={own.line}>{FAILED}</p>
        <button type="button" data-pnl-retry="" className={`btn btn-ghost ${own.tap}`} aria-disabled={busy || undefined} onClick={retry}>
          Retry
        </button>
      </div>
    )
  } else {
    const { lead, groups, rate, rateSmall } = cur.view
    body = (
      <>
        {lead && <p className={own.line} data-pnl-sentence="">{lead}</p>}
        {groups.length > 0 && (
          <ul className={own.groups}>
            {groups.map((g) => (
              <li key={g.label} className={own.group} data-pnl-group="">
                <span>{`${g.label}: ${g.text}`}</span>
                {g.small && <span className={own.badge} data-pnl-small="">{SMALL_SAMPLE}</span>}
              </li>
            ))}
          </ul>
        )}
        {rate && (
          <div className={own.row} data-win-rate-row="">
            <p className={own.line} data-win-rate="">{rate}</p>
            {rateSmall && <span className={own.badge} data-pnl-small="">{SMALL_SAMPLE}</span>}
          </div>
        )}
      </>
    )
  }
  return (
    <div ref={root} className={own.panel} data-vs-pnl="" role="group" aria-label={PANEL_NAME} tabIndex={-1} hidden={hidden || undefined}>
      {body}
      <p className={own.caveat} data-pnl-caveat="">{CAVEAT}</p>
    </div>
  )
}
