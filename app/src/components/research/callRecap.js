// app/src/components/research/callRecap.js
//
// The SINGLE authority on the shape of a call-recap payload.
//
// GET /api/earnings/call-recap/{t} returns:
//     { ticker, recap: {headline, sentiment, bullets, quotes, guidance,
//                       qa_highlights}, webcast_url, rating_changes }
// while consumers read headline/sentiment/bullets/… AND webcast_url AND
// rating_changes off ONE object, so the correct argument is a FLAT MERGE.
//
// It also reconciles the field shapes, because the producer and the consumers
// disagreed about three of them and each disagreement was a live defect:
//
//  * QUOTES. call_recap.py's prompt asks for `{topic, quote}`; CallRecapSection
//    read `{speaker, text}`. So `q.text` was undefined and every quote rendered
//    as empty quotation marks — and the search filter did
//    `(q.text || q).toLowerCase()`, which on an object throws
//    "q.toLowerCase is not a function". Typing in the search box while a recap
//    had quotes took the section down.
//  * SENTIMENT. The service emits positive|negative|mixed|neutral; the
//    component tested for 'bullish'/'bearish', so every recap rendered
//    neutral-styled. The test fixture used 'bullish' — a value production never
//    produces — so the suite was green over a dead branch.
//  * BULLETS / Q&A. Both were filtered with `.toLowerCase()` on the raw item,
//    so the same crash waits behind any future object-shaped element.
//
// Normalising once, here, is what keeps the four surfaces that render a recap
// from disagreeing about it.

const OUTER = ['webcast_url', 'rating_changes', 'ticker']

const clean = v => (typeof v === 'string' ? v.trim() : '')

// The producer's vocabulary is the canonical one; the older bullish/bearish
// labels map onto it so a payload from either era styles correctly.
const SENTIMENT_ALIASES = {
  bullish: 'positive',
  bearish: 'negative',
  positive: 'positive',
  negative: 'negative',
  mixed: 'mixed',
  neutral: 'neutral',
}

export function normalizeSentiment(value) {
  const key = clean(value).toLowerCase()
  return SENTIMENT_ALIASES[key] || (key ? 'neutral' : null)
}

// Guidance arrives EITHER as an enum from the service (raised|cut|maintained|
// none) or as prose. The two want different treatments and rendering both was
// how the same word appeared twice — once as a chip, once as a one-word
// "GUIDANCE" paragraph.
const GUIDANCE_ENUM = new Set(['raised', 'cut', 'maintained', 'lowered', 'none'])

export function guidanceKind(value) {
  const v = clean(value).toLowerCase()
  if (!v || v === 'none') return null
  return GUIDANCE_ENUM.has(v) ? 'enum' : 'prose'
}

/** Any quote shape the producer has used → {speaker, role, topic, text}. */
export function normalizeQuote(q) {
  if (typeof q === 'string') return { speaker: '', role: '', topic: '', text: clean(q) }
  if (!q || typeof q !== 'object') return null
  const text = clean(q.text) || clean(q.quote)
  if (!text) return null
  return {
    speaker: clean(q.speaker),
    role: clean(q.role) || clean(q.title),
    topic: clean(q.topic),
    text,
  }
}

/** Strings, or objects carrying one — always out as a plain string. */
const normalizeLine = item => {
  if (typeof item === 'string') return item.trim()
  if (item && typeof item === 'object') {
    return clean(item.text) || clean(item.takeaway) || clean(item.question)
  }
  return ''
}

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

  out.sentiment = normalizeSentiment(out.sentiment)
  out.bullets = (Array.isArray(out.bullets) ? out.bullets : []).map(normalizeLine).filter(Boolean)
  out.qa_highlights = (Array.isArray(out.qa_highlights) ? out.qa_highlights : [])
    .map(normalizeLine).filter(Boolean)
  out.quotes = (Array.isArray(out.quotes) ? out.quotes : [])
    .map(normalizeQuote).filter(Boolean)

  return out
}

export default normalizeCallRecap
