// "Why isn't a stock here?" (RS screens unit U8): a small text button under the list head that
// opens a ticker box. On submit the page asks the server for that ONE row
// (GET /api/screener/row/{ticker}) and checks the open screen's rules against it (whyNot.js),
// then lists each rule with a tick or a cross and the stock's own value.
//
// Rendered by FocusScreener only on a LIST screen (a starter whose `row.list` is true: a list a
// stock qualifies for by passing rules; unit U12). RS exit warnings is not one: a warning is
// something that happened to a stock, so "why is it not here" has no rule to point at. Every
// other screen never mounts it, and nothing here is asked of the server until a member submits
// a ticker.
//
// `steady` (unit U12; rsScreens.steadyOf): the open starter keeps its own list (UCT RS Leaders).
// The membership clause is then left out of the rules, and a stock that passes every rule and is
// not listed is told its rank among the qualifiers and how the list is kept.
//
// Keyboard: Enter submits, Escape closes and hands focus back to the button that opened it.
// The box sits outside the results listbox, so the list's own keys (W, Shift+F, "/") are not
// heard while typing a ticker.
import { useEffect, useId, useRef, useState } from 'react'
import Input from '../../../components/ui/Input'
import { cleanTicker, evaluateRules, whyNotColumns, rankAheadSpec, steadyAheadSpec, rulesWithout, whyNotHeadline, NO_SUCH_STOCK, NOT_A_TICKER, COULD_NOT_CHECK } from './whyNot'
import focus from './FocusScreener.module.css'
import styles from './RsScreens.module.css'

const MARK = { pass: '✓', fail: '✕', unknown: '○' }
const SAID = { pass: 'Passes: ', fail: 'Misses: ', unknown: 'Not checked: ' }

// One row, by ticker. 404: the Screener holds no such stock. Anything else that is not a row
// (a refusal, a dropped connection) is "could not be checked", never a guess.
async function fetchRow(ticker, columns) {
  const r = await fetch(`/api/screener/row/${encodeURIComponent(ticker)}?columns=${encodeURIComponent(columns.join(','))}`)
  if (r.status === 404) return { missing: true }
  if (!r.ok) throw new Error(`row ${r.status}`)
  const body = await r.json()
  if (!body || typeof body.row !== 'object' || !body.row) throw new Error('row shape')
  return { row: body.row, stale: body.stale === true }
}

// How many stocks on the screen rank ahead of this one, or null when that could not be asked.
async function countAhead(spec) {
  if (!spec) return null
  try {
    const r = await fetch('/api/screener/count', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(spec) })
    if (!r.ok) return null
    const n = (await r.json())?.count
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
  } catch { return null }
}

// `screenKey`: the screen on view; a different screen forgets the last answer (it was about
// the other screen's rules). `rows` are the loaded rows, `listRows` the ones on screen (fewer
// while "New only" is on). `onFound(i)` selects row i of `listRows`, which scrolls to it.
export default function WhyNotHere({ screenKey, filters, logic = null, rank = null, filterList = [], metaFilters = [], rows = [], listRows = [], hasMore = false, onFound, steady = null }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  // What was last asked, filed under the screen it was asked of: { key, busy, answer }, where
  // answer is { headline, items } or { message }. Read only while that screen is still on view,
  // so an answer about another screen's rules is never shown under this one.
  const [asked, setAsked] = useState({ key: null, busy: false, answer: null })
  const busy = asked.key === screenKey && asked.busy
  const answer = asked.key === screenKey ? asked.answer : null
  const setAnswer = a => setAsked({ key: screenKey, busy: false, answer: a })
  const inputRef = useRef(null)
  const toggleRef = useRef(null)
  const seq = useRef(0)
  const panelId = useId()
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const close = () => { seq.current += 1; setOpen(false); setAsked(s => ({ ...s, busy: false })); toggleRef.current?.focus() }
  const submit = async e => {
    e.preventDefault()
    const ticker = cleanTicker(text)
    if (!ticker) { setAnswer({ message: NOT_A_TICKER }); return }
    // Already among the rows on screen: nothing to ask. Say so and go to it.
    const shownAt = listRows.findIndex(r => r?.ticker === ticker)
    if (shownAt >= 0) { setAnswer({ headline: whyNotHeadline({ ticker, onList: true }), items: [] }); onFound?.(shownAt); return }
    if (rows.some(r => r?.ticker === ticker)) { setAnswer({ headline: whyNotHeadline({ ticker, hiddenNew: true }), items: [] }); return }
    const mine = ++seq.current
    setAsked({ key: screenKey, busy: true, answer: null })
    try {
      // A list that keeps its own members: its membership clause is the answer, not a rule.
      const memberKey = steady && filters?.[steady.key] ? steady.key : null
      const rules = memberKey ? rulesWithout(filters, memberKey) : filters
      const columns = [...new Set([...whyNotColumns(rules, rank), ...(memberKey ? [memberKey, steady.by] : [])])]
      const got = await fetchRow(ticker, columns)
      if (mine !== seq.current) return
      if (got.missing) { setAnswer({ message: NO_SUCH_STOCK }); return }
      const ev = evaluateRules({ filters: rules, logic, metaFilters, row: got.row })
      const topN = typeof rank?.top_n === 'number' ? rank.top_n : null
      const clean = !ev.failed && !ev.unknown && !got.stale
      // Its place, asked only when that place is what keeps it off the list: its rank among the
      // qualifiers of a list that keeps its own members, or its place in a capped ranking.
      let position = null
      let kept = null
      if (clean && memberKey && got.row[memberKey] !== 1) {
        kept = steady
        const ahead = await countAhead(steadyAheadSpec({ steady, row: got.row }))
        if (mine !== seq.current) return
        position = ahead == null ? null : ahead + 1
      } else if (clean && topN != null) {
        const ahead = await countAhead(rankAheadSpec({ filterList, logic, rank, row: got.row }))
        if (mine !== seq.current) return
        position = ahead == null ? null : ahead + 1
      }
      setAnswer({ headline: whyNotHeadline({ ticker, failed: ev.failed, unknown: ev.unknown, stale: got.stale, position, topN, hasMore, steady: kept }), items: ev.items })
    } catch {
      if (mine === seq.current) setAnswer({ message: COULD_NOT_CHECK })
    }
  }
  const onKeyDown = e => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    close()
  }

  return (
    <div className={styles.whyNot} data-testid="rs-why-not">
      <button ref={toggleRef} type="button" className={`${focus.linkBtn} ${styles.whyNotToggle}`} aria-expanded={open} aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}>Why isn&apos;t a stock here?</button>
      {open && (
        <div id={panelId} className={styles.whyNotPanel} onKeyDown={onKeyDown}>
          <form className={styles.whyNotForm} onSubmit={submit}>
            <Input ref={inputRef} type="text" className={`${focus.dialogInput} ${styles.whyNotInput}`} aria-label="Ticker" placeholder="Ticker" value={text}
              onChange={e => setText(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={13} />
            <button type="submit" className={focus.btn} disabled={busy}>{busy ? 'Checking' : 'Check'}</button>
            <button type="button" className={`${focus.linkBtn} ${styles.whyNotClose}`} onClick={close}>Close</button>
          </form>
          <div role="status" aria-live="polite" className={styles.whyNotAnswer} data-testid="rs-why-not-answer">
            {answer?.message && <p className={styles.whyNotHead}>{answer.message}</p>}
            {answer?.headline && <p className={styles.whyNotHead}>{answer.headline}</p>}
            {answer?.items?.length > 0 && (
              <ul className={styles.whyNotList}>
                {answer.items.map((it, i) => (
                  <li key={i} className={styles.whyNotItem} data-kind={it.kind}>
                    <span aria-hidden="true" className={styles.whyNotMark}>{MARK[it.kind]}</span>
                    <span className="sr-only">{SAID[it.kind]}</span>
                    <span className={styles.whyNotLabel}>{it.label}: <span className={styles.whyNotValue}>{it.value}</span></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
