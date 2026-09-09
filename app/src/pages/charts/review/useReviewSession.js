import { useCallback, useEffect, useState } from 'react'
import {
  read, publish, position, step, syncToSymbol, currentSymbol, REVIEW_EVENT,
  neighbours, adopt,
} from './reviewSession'
import { prefetchBars } from '../../../utils/prefetchBars'

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
export default function useReviewSession(symbol, { tf = 'D' } = {}) {
  const [raw, setRaw] = useState(() => read())

  /* ⛔ A SESSION NO CHART HAS ADOPTED IS NOT REPORTED AS A SESSION.
   *
   * An entry made from another page (a scan's "Review charts") is published
   * before this shell resolves its symbol, so for one beat the chart shows the
   * member's saved ticker instead. Reporting the session during that beat would
   * put "1 / 20" beside a symbol that is not in the review — and every consumer
   * here reads `session`, so gating it once, here, covers the control, the
   * position chip and the return-to-list door together. */
  const session = raw && raw.pending ? null : raw

  // Cross-surface sync: any publisher updates every consumer.
  useEffect(() => {
    const onChange = (e) => setRaw(e?.detail ?? read())
    window.addEventListener(REVIEW_EVENT, onChange)
    return () => window.removeEventListener(REVIEW_EVENT, onChange)
  }, [])

  // Follow the symbol. `syncToSymbol` returns null for a symbol outside the set,
  // which is the EXIT — a stale "12 of 47" must never sit beside an unrelated
  // chart the user opened from search or a deep link.
  useEffect(() => {
    if (!symbol || !raw) return
    if (raw.pending) {
      // THE HANDOFF. The chart has not caught up yet, so a foreign symbol says
      // nothing about the review and must not end it (see `adopt`'s header —
      // without this the entry destroys itself before the deep link lands).
      // The session's OWN symbol arriving is the adoption, and the only thing
      // that ends the silence.
      if (currentSymbol(raw) === symbol) publish(adopt(raw))
      return
    }
    if (currentSymbol(raw) === symbol) return
    const next = syncToSymbol(raw, symbol)
    if (next !== raw) publish(next)              // null clears it
  }, [symbol, raw])

  /* PREFETCH the neighbours the user is about to reach.
   *
   * ⛔ NEXT 2 AND PREVIOUS 1 — not the list. The shared `_idbQueue` is capped at
   * three concurrent fetches, so warming a fifty-symbol watchlist would occupy
   * that cap for minutes and STARVE THE CHART THE USER IS LOOKING AT. The whole
   * point is that the next tap feels instant; a prefetch that delays the current
   * symbol has made the product slower while appearing busy.
   *
   * ⛔ AND IT IS NEVER `priority`. The visible chart's own fetch must win every
   * time; these ride behind it. Reviewers move forward far more than back, which
   * is why the window is asymmetric rather than a tidy ±2.
   */
  useEffect(() => {
    // ⭐ `raw`, NOT `session` — warming runs DURING the handoff on purpose. The
    // navigation to the chart shell is exactly the dead time the prefetch was
    // built to use, and a warm queue is invisible either way.
    if (!raw || !raw.symbols) return
    const want = neighbours(raw)
    if (!want.length) return
    // The queue supersedes naturally: a later call enqueues the new neighbours,
    // and anything already in flight is a bounded, cheap request either way.
    try { prefetchBars(want, tf) } catch { /* warming is never load-bearing */ }
  }, [raw, tf])

  const go = useCallback((delta) => {
    const cur = read()
    const next = step(cur, delta)
    if (!next) return null                       // ⛔ a boundary: nothing happens
    publish(next)
    return currentSymbol(next)
  }, [])

  /* JUMP — the feed's door into the same model the transport uses.
   *
   * ⛔ NOT A NEW PRIMITIVE. Moving to index N is moving to the symbol AT index
   * N, which is exactly `syncToSymbol` — the function that already records the
   * visit and already refuses a symbol outside the set. An `at(index)` beside
   * it would be a second way to be "at" a symbol, and the two would disagree
   * the first time one of them learned something the other did not.
   *
   * Returns the symbol so the caller can point the chart at it; null when the
   * index names nothing. */
  const goTo = useCallback((index) => {
    const cur = read()
    if (!cur || !Array.isArray(cur.symbols)) return null
    const sym = cur.symbols[index]
    if (!sym) return null
    const next = syncToSymbol(cur, sym)
    if (!next) return null
    if (next !== cur) publish(next)
    return sym
  }, [])

  return {
    session,
    position: position(session),
    next: () => go(1),
    prev: () => go(-1),
    goTo,
  }
}
