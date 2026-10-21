// The reveal card's words and small pure helpers (no React), kept out of
// RevealCard.jsx so that file exports components only (react-refresh).

/** The six parts of a full lesson, in reading order (docs/study/terms/candle_lessons.json). */
export const LESSON_PART_LABELS = [
  ['shape', 'The shape'],
  ['story', 'The story'],
  ['where', 'Where to look'],
  ['confirm', 'What confirms it'],
  ['cancel', 'What cancels it'],
  ['desk', 'At the desk'],
]

/** What a member can say about an item: the store's words (FEEDBACK_KINDS), in the member's. */
export const FEEDBACK_KINDS = [
  ['wrong_answer', 'Wrong answer'],
  ['bad_chart', 'Chart is bad'],
  ['unclear_question', 'Question unclear'],
  ['unclear_lesson', 'Lesson unclear'],
  ['too_easy', 'Too easy'],
  ['too_hard', 'Too hard'],
  ['great', 'Great example'],
  ['other', 'Other'],
]

/** A reviewer's verdict on the card: approve publishes, reject retires, fix is a note. */
export const VERDICTS = [
  ['approve', 'Approve'],
  ['fix', 'Needs fix'],
  ['reject', 'Reject'],
]

export function feedbackUrl(itemId) {
  return `/api/study/items/${encodeURIComponent(itemId)}/feedback`
}

/** [{key, label, text}] for the parts an item carries, in order; null when it carries none. */
export function lessonParts(reveal) {
  const parts = reveal?.lesson_parts
  if (!parts || typeof parts !== 'object') return null
  const out = LESSON_PART_LABELS
    .filter(([k]) => typeof parts[k] === 'string' && parts[k].trim())
    .map(([k, label]) => ({ key: k, label, text: parts[k].trim() }))
  return out.length ? out : null
}
