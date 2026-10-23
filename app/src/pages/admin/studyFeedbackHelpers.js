// The feedback panel's URLs and list key (no React), kept out of
// StudyFeedbackPanel.jsx so that file exports a component only.
export const FEEDBACK_URL = '/api/study/admin/feedback'
export const FEEDBACK_HANDLE_URL = '/api/study/admin/feedback/handle'
export const FEEDBACK_EXPORT_URL = '/api/study/admin/feedback/export'

/** Which notes the list shows: every note, item notes only, or notes on whole screens. */
export const FEEDBACK_SCOPES = [
  ['all', 'Everything'],
  ['items', 'On questions'],
  ['screens', 'On screens'],
]

export function feedbackKey(showHandled, scope = 'all') {
  const screen = scope === 'screens' ? '&screen=any' : scope === 'items' ? '&screen=none' : ''
  return `${FEEDBACK_URL}?unhandled=${showHandled ? 0 : 1}&limit=500${screen}`
}
