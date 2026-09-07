/**
 * ⛔ PROTOTYPE GATE — design-study only, not a product feature flag.
 *
 * The three visualization prototypes (Overview Business Trend, Financials
 * Metric Trend, Earnings Reaction) render ONLY when this is on. It is off for
 * every user by default and there is no UI that turns it on: you opt in with
 * `?proto=1` on the URL, or `localStorage.setItem('uct.proto','1')` in a dev
 * console. Nothing ships enabled.
 *
 * Delete this file and the four `PROTOTYPES &&` guards when the study is
 * decided — whichever prototypes are approved should graduate to real code
 * with real data plumbing, not inherit this switch.
 */
function read() {
  try {
    if (typeof window === 'undefined') return false
    if (new URLSearchParams(window.location.search).has('proto')) return true
    return window.localStorage?.getItem('uct.proto') === '1'
  } catch {
    return false
  }
}

export const PROTOTYPES = read()
