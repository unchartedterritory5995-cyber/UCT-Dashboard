// The screen-feedback door's words and URL (no React), kept out of
// ScreenFeedback.jsx so that file exports a component only (react-refresh).

export const SCREEN_FEEDBACK_URL = '/api/study/admin/screen-feedback'

/** What a note on a whole screen is about: the store's words (SCREEN_KINDS), in the owner's own. */
export const SCREEN_KINDS = [
  ['layout', 'Layout'],
  ['visuals', 'Visuals'],
  ['effects', 'Effects'],
  ['interaction', 'How it works'],
  ['learning', 'Teaching'],
  ['broken', 'Broken'],
  ['great', 'Great'],
  ['other', 'Other'],
]

/** The Study screens (the store's SCREENS), as the owner sees them. */
export const SCREEN_LABELS = {
  landing: 'Courses landing',
  trail: 'Skill trail',
  question: 'Question',
  reveal: 'Answer reveal',
  end: 'End of the set',
  practise: 'Practise sheet',
  lessons: 'Lesson reading view',
  review: 'Review screen',
  gallery: 'Example gallery',
}

export function screenLabel(screen) {
  return SCREEN_LABELS[screen] || screen
}

/** The drill's screen: the end card, the reveal (or a failed post), else the question. */
export function drillScreen({ finished, phase }) {
  if (finished) return 'end'
  if (phase === 'reveal' || phase === 'failed') return 'reveal'
  return 'question'
}
