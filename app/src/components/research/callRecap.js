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
    // Server-computed from where the text actually sits in the transcript —
    // never taken from the model, so it can be trusted as a jump target.
    segment: Number.isInteger(q.segment) ? q.segment : null,
  }
}

/** A Q&A exchange. `quote` is the only field the server could verify against
 *  the transcript; `question`/`takeaway` are the model's own prose and are
 *  labelled as such in the UI. Legacy string items become a bare takeaway. */
export function normalizeQA(item) {
  if (typeof item === 'string') {
    return item.trim() ? { analyst: '', firm: '', question: '', takeaway: item.trim(), quote: '' } : null
  }
  if (!item || typeof item !== 'object') return null
  const takeaway = clean(item.takeaway) || clean(item.answer)
  const quote = clean(item.quote)
  if (!takeaway && !quote) return null
  return {
    analyst: clean(item.analyst), firm: clean(item.firm),
    question: clean(item.question), takeaway, quote,
    speaker: clean(item.speaker),
    segment: Number.isInteger(item.segment) ? item.segment : null,
  }
}

/** A forward-looking statement: the model's reading plus the verbatim words it
 *  rests on. `segment` is server-computed, so it is trustworthy or absent. */
export function normalizeForward(item) {
  if (!item || typeof item !== 'object') return null
  const quote = clean(item.quote)
  if (!quote) return null
  return {
    topic: clean(item.topic), horizon: clean(item.horizon) || 'unspecified',
    detail: clean(item.detail), quote, speaker: clean(item.speaker),
    segment: Number.isInteger(item.segment) ? item.segment : null,
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
    .map(normalizeQA).filter(Boolean)
  out.quotes = (Array.isArray(out.quotes) ? out.quotes : [])
    .map(normalizeQuote).filter(Boolean)
  out.forward_looking = (Array.isArray(out.forward_looking) ? out.forward_looking : [])
    .map(normalizeForward).filter(Boolean)
  out.guidance_detail = clean(out.guidance_detail)
  out.speakers = (out.speakers && typeof out.speakers === 'object') ? out.speakers : {}

  return out
}

export default normalizeCallRecap
