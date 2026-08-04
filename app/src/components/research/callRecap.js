// app/src/components/research/callRecap.js
//
// SHAPE FIX (spec §5.3: "the recapData vs recapData?.recap unwrap divergence is
// fixed at the hook level so both surfaces receive identical shape").
//
// GET /api/earnings/call-recap/{t} returns:
//     { ticker, recap: {headline, sentiment, bullets, quotes, guidance,
//                       qa_highlights}, webcast_url, rating_changes }
// CallRecapSection reads headline/sentiment/bullets/quotes/guidance/
// qa_highlights AND webcast_url AND rating_changes off the SAME object, so the
// correct argument is a FLAT MERGE. Neither shipped call site passes one:
//   components/tiles/EarningsModal.jsx:454 and pages/calendar/MyStocksHub.jsx:244
//     pass the wrapper -> the whole recap BODY renders blank
//   pages/research/tabs/CallsTab.jsx:16 passes `recapData?.recap`
//     -> webcast_url and rating_changes are lost
// P2 fixes the NEW modal; the other two are P3/punch-list, deliberately.

const OUTER = ['webcast_url', 'rating_changes', 'ticker']

export function normalizeCallRecap(payload) {
  if (!payload || typeof payload !== 'object') return null
  const inner = payload.recap && typeof payload.recap === 'object' ? payload.recap : null
  // A wrapper with no body is "no recap yet", not an empty recap.
  if (!inner && !payload.headline && !payload.bullets) return null
  const base = inner || payload
  const out = { ...base }
  for (const k of OUTER) {
    // Never let an outer null clobber an inner value.
    if (out[k] == null && payload[k] != null) out[k] = payload[k]
  }
  return out
}

export default normalizeCallRecap
