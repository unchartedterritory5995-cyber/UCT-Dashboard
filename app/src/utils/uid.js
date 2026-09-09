/* An id generator that survives an INSECURE ORIGIN.
 *
 * ⛔ THE TRAP, MEASURED. `crypto.randomUUID()` is a SECURE-CONTEXT-ONLY API. On
 * `https://uctintelligence.com` it exists, so production is unaffected — but on
 * any plain-HTTP origin the property is simply UNDEFINED and calling it throws
 * `TypeError: crypto.randomUUID is not a function`. That covers every way this
 * app is opened on a real phone during development: `vite --host` on a LAN IP,
 * an IP-based staging host, and BrowserStack's `bs-local.com` tunnel. Read off
 * `http://bs-local.com:8093` on 2026-09-08: `isSecureContext:false`,
 * `typeof crypto.randomUUID === 'undefined'`, `crypto.getRandomValues` present.
 *
 * ⛔ AND IT FAILED SILENTLY, which is why it survived. The throw happens inside a
 * React event handler, so React reports it out-of-band and the gesture simply
 * does nothing: on a real iPhone, "New board" did not add a board and a drawn
 * trendline did not appear, with no error on screen. A device run reads that as
 * a broken FEATURE. It is a broken TRANSPORT.
 *
 * ⭐ WHY A SHARED HELPER RATHER THAN A FOURTH INLINE GUARD. Three call sites had
 * already grown their own ad-hoc fallback (`AiSearchWidget`, `NewsWidget`,
 * `landingTrack`) — three people hit this and each patched only what they were
 * looking at, which is precisely how the chart's own call sites were left bare.
 * One helper retires the recurrence.
 *
 * `getRandomValues` is NOT secure-context-gated, so the fallback keeps real
 * entropy and the RFC-4122 v4 shape; ids stay interchangeable with the ones
 * `randomUUID` produced, including any already persisted.
 */
const HEX = []
for (let i = 0; i < 256; i++) HEX.push((i + 0x100).toString(16).slice(1))

export function uid() {
  const c = typeof crypto !== 'undefined' ? crypto : null
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const b = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(b)
  } else {
    // Last resort only — no `crypto` at all. Not for anything security-bearing,
    // and nothing here is: these ids address local drawings and boards.
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  }
  b[6] = (b[6] & 0x0f) | 0x40   // version 4
  b[8] = (b[8] & 0x3f) | 0x80   // variant 10x
  return (
    HEX[b[0]] + HEX[b[1]] + HEX[b[2]] + HEX[b[3]] + '-'
    + HEX[b[4]] + HEX[b[5]] + '-'
    + HEX[b[6]] + HEX[b[7]] + '-'
    + HEX[b[8]] + HEX[b[9]] + '-'
    + HEX[b[10]] + HEX[b[11]] + HEX[b[12]] + HEX[b[13]] + HEX[b[14]] + HEX[b[15]]
  )
}

export default uid
