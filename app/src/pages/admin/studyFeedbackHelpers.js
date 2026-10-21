// The feedback panel's URLs and list key (no React), kept out of
// StudyFeedbackPanel.jsx so that file exports a component only.
export const FEEDBACK_URL = '/api/study/admin/feedback'
export const FEEDBACK_HANDLE_URL = '/api/study/admin/feedback/handle'
export const FEEDBACK_EXPORT_URL = '/api/study/admin/feedback/export'

export function feedbackKey(showHandled) {
  return `${FEEDBACK_URL}?unhandled=${showHandled ? 0 : 1}&limit=500`
}
