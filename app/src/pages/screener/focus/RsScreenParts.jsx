// The small pieces an RS screen adds around its list (unit U5): the header line under the quick
// controls, the first-visit line, and the empty state a starter's `empty` describes. Each is
// rendered by FocusScreener only for a starter that carries `row` (or `empty`); none holds state.
import focus from './FocusScreener.module.css'
import styles from './RsScreens.module.css'

// The contract's first-visit sentence, verbatim (plan v2 section 5).
export const FIRST_VISIT_TEXT = 'The strongest liquid stocks, ranked. The line under each name says whether it is extended or near a buy point. RS is relative strength, not RSI.'

// One line: the list's own new/dropped line, then the rating date, then the sector that
// dominates. A part that has nothing to say is left out with its separator.
// `showNewLine`: the new/dropped line will draw something (it draws nothing for most answers,
// and a separator must not be left hanging in front of the next part).
// `pending`: the rows on view answer the previous screen; the line dims with the list.
// `alerts` (unit U13): the "Tell me what joins and leaves" switch, last on the line, or null.
export function RsHeaderLine({ newLine = null, showNewLine = false, asOf = '', share = '', pending = false, alerts = null }) {
  const parts = [showNewLine ? ['new', newLine] : null, asOf ? ['asof', <span key="asof" data-testid="rs-asof">{asOf}</span>] : null,
    share ? ['share', <span key="share" data-testid="rs-share">{share}</span>] : null, alerts ? ['alerts', alerts] : null].filter(Boolean)
  if (!parts.length) return null
  return (
    <div className={`${styles.head} ${pending ? styles.headPending : ''}`} data-testid="rs-head" data-pending={pending ? '' : undefined}>
      {/* The dot BEFORE a part hangs in the gap to its left (RsScreens.module.css `.headSep`), and
          the inner box clips sideways: a part that wraps to a new line (a phone) starts clean,
          with no stray dot in front of it. */}
      <div className={styles.headIn}>
        {parts.map(([k, node], i) => (
          <span key={k} className={styles.headPart}>
            {i > 0 && <span aria-hidden="true" className={styles.headSep}>·</span>}
            {node}
          </span>
        ))}
      </div>
    </div>
  )
}

// One dismissible line above the list, until the member dismisses it.
export function RsFirstVisit({ onHow, onDismiss }) {
  return (
    <p className={styles.note} role="note" data-testid="rs-first-visit">
      <span className={styles.noteText}>{FIRST_VISIT_TEXT}</span>
      <button type="button" className={`${focus.linkBtn} ${styles.noteLink}`} onClick={onHow}>How it works</button>
      <button type="button" className={`${focus.btn} ${styles.noteBtn}`} onClick={onDismiss}>Got it</button>
    </p>
  )
}

// The market caution line (unit U8): the server's sentence about the market, in the first-visit
// line's own gold-bar style, with one button that hides it for today. Never about a stock.
export function RsMarketLine({ text, state, onHide }) {
  return (
    <p className={styles.note} role="note" aria-label="Market note" data-testid="rs-market" data-state={state}>
      <span className={styles.noteText}>{text}</span>
      <button type="button" className={`${focus.btn} ${styles.noteBtn}`} onClick={onHide}>Hide for today</button>
    </p>
  )
}

// The screen's own words for "nothing today", then its actions as buttons. The first sentence
// is the headline and the rest the body, so the text reads at the size of every other state.
export function RsEmptyState({ text, actions = [], pending = false }) {
  const all = String(text || '').trim()
  const cut = all.search(/[.!?]\s/)
  const head = cut >= 0 ? all.slice(0, cut + 1) : all
  const rest = cut >= 0 ? all.slice(cut + 1).trim() : ''
  return (
    <div className={`${focus.stateBox} ${pending ? focus.stateBusy : ''}`} aria-busy={pending || undefined} data-testid="rs-empty">
      <div role="status" className={styles.status}>
        <p className={focus.stateHead}>{head}</p>
        {rest && <p className={focus.stateBody}>{rest}</p>}
      </div>
      {actions.length > 0 && (
        <div className={focus.stateActions}>
          {actions.map((a, i) => <button key={a.label} type="button" className={i === 0 ? focus.btnPrimary : focus.btn} onClick={a.run}>{a.label}</button>)}
        </div>
      )}
    </div>
  )
}
