// Settings → What Create Indicator remembers (owner direction 2026-11-18: "Learn about the
// member and what they want and do"; the engine session's condition: visible, editable, with a
// forget control, and WHERE each memory came from).
//
// When Create Indicator has to ask a member something that changes the maths (which kind of
// moving average, when a cross counts), it remembers the answer in the member's own account and
// uses it next time instead of asking, saying so each time. This card is where the member sees
// those choices, changes one, or forgets it.
//
// The server owns every rule: `GET /api/user-definitions/assistant-memory` lists each question it
// can remember an answer to and this member's answer; `PUT` sets one (only one of that question's
// own choices is accepted); `DELETE` forgets one or everything. Nothing is kept in this browser.
//
// UCT Signature style (docs/uct-signature-style.md): one card of rows with hairlines, label left
// and the house dropdown right, sentence case, no gold of its own (the dropdown's ✓ is the mark).
// A member without Create Indicator gets no answer from the server and this card renders nothing.
import { useCallback, useEffect, useState } from 'react'
import TileCard from '../TileCard'
import ChoiceMenu from '../chart/ChoiceMenu'
import styles from './IndicatorMemoryCard.module.css'

export const MEMORY_URL = '/api/user-definitions/assistant-memory'
/** The dropdown's first option: nothing remembered, so Create Indicator asks. */
export const ASK = '__ask__'
export const ASK_LABEL = 'Ask me each time'

/** "18 Nov" from a stored `YYYY-MM-DD` (built from its parts, so no time zone can move the day). */
export function shortDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''))
  if (!m) return ''
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** Where a remembered choice came from, in the member's words. */
export function cameFrom(remembered) {
  if (!remembered) return 'Not asked yet. It will ask the first time this comes up.'
  const day = shortDay(remembered.last)
  const when = day ? ` on ${day}` : ''
  return remembered.from === 'settings' ? `You set this here${when}.` : `You chose this${when}, when it asked.`
}

/** The dropdown's options for one question: ask each time, its choices, and the member's own
 *  value when it is not one of the usual ones (a length they typed, say 21). */
export function optionsFor(row) {
  const options = [{ value: ASK, label: ASK_LABEL }, ...row.choices.map((c) => ({ value: String(c.value), label: c.label }))]
  const mine = row.remembered
  if (mine && !options.some((o) => o.value === String(mine.value))) options.push({ value: String(mine.value), label: mine.label })
  return options
}

async function call(method, url, body) {
  const r = await fetch(url, {
    method, credentials: 'include', cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

export default function IndicatorMemoryCard() {
  const [data, setData] = useState(null)
  const [gone, setGone] = useState(false)       // no answer from the server: this member has no such card
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let live = true
    call('GET', MEMORY_URL).then((d) => { if (live) setData(d) }).catch(() => { if (live) setGone(true) })
    return () => { live = false }
  }, [])

  const run = useCallback(async (work, done) => {
    setBusy(true)
    setStatus('')
    try {
      setData(await work())
      setStatus(done)
    } catch {
      setStatus('Could not save. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }, [])

  const choose = useCallback((row, picked) => {
    if (picked === ASK) {
      run(() => call('DELETE', `${MEMORY_URL}?question=${encodeURIComponent(row.id)}`), 'Forgotten. It will ask next time.')
      return
    }
    const choice = row.choices.find((c) => String(c.value) === picked)
    if (!choice) return
    run(() => call('PUT', MEMORY_URL, { question: row.id, value: choice.value }), 'Saved.')
  }, [run])

  if (gone || !data || !Array.isArray(data.questions)) return null
  const remembers = data.questions.filter((q) => q.remembered).length

  return (
    <TileCard icon="sparkle" title="What Create Indicator remembers">
      <p className={styles.lede}>
        When Create Indicator has to ask you something that changes the maths, it remembers your answer and
        uses it next time, telling you each time it does. Only you can see these, and you can change or forget any of them.
      </p>
      <div className={styles.card} data-testid="indicator-memory-rows">
        {data.questions.map((row) => (
          <div key={row.id} className={styles.row} data-question={row.id}>
            <div className={styles.text}>
              <span className={styles.label}>{row.title}</span>
              <span className={styles.hint} data-testid={`memory-from-${row.id}`}>
                {row.remembered ? `${row.use} ` : ''}{cameFrom(row.remembered)}
              </span>
              {/* What the member USUALLY uses, read by the server from their own saved indicators
                  (nothing is stored). The server words it; with no habit there is no line. */}
              {typeof row.usual === 'string' && row.usual ? (
                <span className={styles.hint} data-testid={`memory-usual-${row.id}`}>{row.usual}</span>
              ) : null}
            </div>
            <ChoiceMenu
              ariaLabel={row.title}
              value={row.remembered ? String(row.remembered.value) : ASK}
              options={optionsFor(row)}
              onChange={(v) => choose(row, v)}
              disabled={busy}
            />
          </div>
        ))}
      </div>
      <div className={styles.foot}>
        <button
          type="button"
          className={styles.pill}
          disabled={busy || remembers === 0}
          onClick={() => run(() => call('DELETE', MEMORY_URL), 'Everything forgotten.')}
        >
          Forget everything
        </button>
        <span className={styles.status} role="status" aria-live="polite">
          {status || (remembers === 0 ? 'Nothing yet. It remembers the choices you make when it asks.' : '')}
        </span>
      </div>
    </TileCard>
  )
}
