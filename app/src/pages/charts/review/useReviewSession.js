import { useCallback, useEffect, useState } from 'react'
import {
  read, publish, position, step, syncToSymbol, withScrollTop, currentSymbol, REVIEW_EVENT,
} from './reviewSession'

/* React binding for the review session.
 *
 * ⛔ ONE STORE, MANY SURFACES. The chart's transport control, the position chip
 * and (later) the list all need the same session, and they do not share a parent
 * worth prop-drilling through. So the store is `sessionStorage` and the change
 * signal is one window event — not a context provider mounted somewhere that
 * half the surfaces are outside of.
 *
 * ⛔ AND THE SYMBOL IS NOT OWNED HERE. The chart's symbol still comes from the
 * color group, exactly as before. This hook only *reacts* to it: when the symbol
 * changes to something inside the session the index follows, and when it changes
 * to something outside, the session EXITS. Making this hook a second writer of
 * the symbol would give the app two opinions about what it is showing.
 */
export default function useReviewSession(symbol) {
  const [session, setSession] = useState(() => read())

  // Cross-surface sync: any publisher updates every consumer.
  useEffect(() => {
    const onChange = (e) => setSession(e?.detail ?? read())
    window.addEventListener(REVIEW_EVENT, onChange)
    return () => window.removeEventListener(REVIEW_EVENT, onChange)
  }, [])

  // Follow the symbol. `syncToSymbol` returns null for a symbol outside the set,
  // which is the EXIT — a stale "12 of 47" must never sit beside an unrelated
  // chart the user opened from search or a deep link.
  useEffect(() => {
    if (!symbol || !session) return
    if (currentSymbol(session) === symbol) return
    const next = syncToSymbol(session, symbol)
    if (next !== session) publish(next)          // null clears it
  }, [symbol, session])

  const go = useCallback((delta) => {
    const cur = read()
    const next = step(cur, delta)
    if (!next) return null                       // ⛔ a boundary: nothing happens
    publish(next)
    return currentSymbol(next)
  }, [])

  const rememberScroll = useCallback((scrollTop) => {
    const cur = read()
    if (cur) publish(withScrollTop(cur, scrollTop))
  }, [])

  return {
    session,
    position: position(session),
    next: () => go(1),
    prev: () => go(-1),
    rememberScroll,
  }
}
