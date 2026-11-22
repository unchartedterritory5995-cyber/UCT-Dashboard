// app/src/components/chart/builder/studio/sendConversation.js
//
// ⭐ L8 (Studio plan, section 7): what "Send this conversation to UCT" sends, as a pure function,
// kept apart from the dialog so the dock can ask `hasSomethingToSend` without loading it.

/** How many transcript entries a report carries (the most recent ones). */
export const REPORT_TURNS_MAX = 40

/**
 * The document a conversation report carries, as the server accepts it
 * (`indicator_support.CONVERSE_FIELDS`): the transcript, the indicator, its read-back, the chart.
 * Questions are kept as the lines the member saw.
 */
export function conversationReport({ transcript = [], working = null, readbackLines = [], sym = null, tf = null } = {}) {
  const turns = (Array.isArray(transcript) ? transcript : []).slice(-REPORT_TURNS_MAX).map((t) => (
    t && t.role === 'member'
      ? { role: 'member', text: String(t.text || '') }
      : {
        role: 'uct',
        kind: t && typeof t.kind === 'string' ? t.kind : null,
        lines: [
          ...(t && Array.isArray(t.lines) ? t.lines : []),
          ...(t && Array.isArray(t.questions) ? t.questions.map((q) => (q && q.text) || '') : []),
        ].map((l) => String(l)).filter(Boolean),
      }
  )).filter((t) => (t.role === 'member' ? t.text.trim() : t.lines.length))
  return JSON.stringify({
    transcript: turns,
    definition: working || null,
    readback: (Array.isArray(readbackLines) ? readbackLines : []).map(String),
    chart: { sym: sym || null, tf: tf || null },
  })
}

/** Does this conversation have anything of the member's in it to send? */
export function hasSomethingToSend(transcript) {
  return Array.isArray(transcript) && transcript.some((t) => t && t.role === 'member' && String(t.text || '').trim())
}
