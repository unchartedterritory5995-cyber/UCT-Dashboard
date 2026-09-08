/**
 * ⛔ PROTOTYPE GATE — design-study only, not a product feature flag.
 *
 * The three visualization prototypes (Overview Business Trend, Financials
 * Metric Trend, Earnings Reaction) render ONLY when this is on.
 *
 * ON automatically on localhost, so the study can actually be reviewed inside
 * the real authenticated app without hunting for a query string. OFF everywhere
 * else — production is never localhost, so this cannot reach a member. Force it
 * either way with ?proto=1 / ?proto=0, or localStorage `uct.proto`.
 *
 * ⚠️ Read ONCE at module load. A client-side route change will not re-evaluate
 * it; reload the page after changing the override.
 *
 * Delete this file and the four `PROTOTYPES &&` guards when the study is
 * decided — approved prototypes should graduate to real code with real data
 * plumbing, not inherit this switch.
 */
function read() {
  try {
    if (typeof window === 'undefined') return false
    const q = new URLSearchParams(window.location.search).get('proto')
    if (q === '1') return true
    if (q === '0') return false
    const ls = window.localStorage?.getItem('uct.proto')
    if (ls === '1') return true
    if (ls === '0') return false
    const h = window.location.hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'
  } catch {
    return false
  }
}

export const PROTOTYPES = read()
