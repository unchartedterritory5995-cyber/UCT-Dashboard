// The review hub's URL, words and small pure helpers (no React), kept out of
// StudyHubPanel.jsx so that file exports a component only.

export const HUB_URL = '/api/study/admin/hub'

/** The owner's verdict on a LESSON (study_store.LESSON_VERDICTS). */
export const LESSON_VERDICTS = [
  ['approve', 'Approve lesson'],
  ['fix', 'Needs fix'],
]

export const LESSON_FILTERS = [
  ['all', 'All lessons'],
  ['todo', 'Not reviewed yet'],
  ['approve', 'Approved'],
  ['fix', 'Needs fix'],
  ['thin', 'Under 3 live examples'],
]

/** Live / waiting / cut counts in the owner's words; zeros are left out. */
export function countsLine(counts) {
  const c = counts || {}
  const parts = []
  if (c.approved) parts.push(`${c.approved} live`)
  if (c.draft) parts.push(`${c.draft} waiting`)
  if (c.rejected) parts.push(`${c.rejected} rejected`)
  if (c.retired) parts.push(`${c.retired} retired`)
  return parts.length ? parts.join(' · ') : 'nothing yet'
}

/** Share of a section that members get, 0-100 (rejected and retired left out of the base). */
export function livePct(counts) {
  const c = counts || {}
  const base = (Number(c.approved) || 0) + (Number(c.draft) || 0)
  return base ? Math.round((100 * (Number(c.approved) || 0)) / base) : 0
}

export function liveExamples(lesson) {
  return Number(lesson?.charts?.approved) || 0
}

/** The lessons a filter and a search keep, in the hub's order. */
export function filterLessons(lessons, { filter = 'all', q = '' } = {}) {
  const needle = q.trim().toLowerCase()
  return (Array.isArray(lessons) ? lessons : []).filter((l) => {
    if (needle && !`${l.label} ${l.key}`.toLowerCase().includes(needle)) return false
    const v = l.verdict?.verdict || null
    if (filter === 'todo') return !v
    if (filter === 'approve' || filter === 'fix') return v === filter
    if (filter === 'thin') return liveExamples(l) < 3
    return true
  })
}

/** The screen note that carries a verdict on one lesson. */
export function lessonVerdictBody(lesson, verdict, text) {
  return {
    screen: 'lessons',
    kind: verdict === 'approve' ? 'great' : 'learning',
    verdict,
    text: (text || '').trim() || null,
    context: { lesson_key: lesson.key, label: lesson.label },
  }
}

export function verdictWord(lesson) {
  const v = lesson?.verdict?.verdict
  if (v === 'approve') return 'Approved'
  if (v === 'fix') return 'Needs fix'
  return 'Not reviewed'
}
