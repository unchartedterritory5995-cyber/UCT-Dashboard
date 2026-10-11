// lib/notices.js -- what Research Home's Notices box shows (spec P0.4). Pure: the box fetches,
// this decides. Sources are the bell rows the Notebook writes and the resurfacing insights.
//
// The shapes below were CAPTURED from the real routes (lib/__fixtures__/notices.json,
// _provenance), not assumed:
//   * GET /api/alerts answers a BARE LIST (AlertBell.jsx reads Array.isArray(alerts)), so there
//     is no `{alerts: [...]}` branch here.
//   * Both notebook alert rows carry the same string in `type` and in `data.source`
//     (alerts.add_alert is handed the source as its alert_type), so this matches `type` only.
//   * GET /api/voice/insights answers {insights: [...]}, every kind and dismissed ones included;
//     a resurfacing row gains `link` (note_levels.links_for_insights) only while its flag is on.
const REMINDER = 'notebook_task_reminder'
const FILL = 'notebook_entry_context_new_fill'
const RESURFACE = new Set(['note_level_touch', 'note_big_move', 'note_date_due'])
const NOTE_LINK = '/journal/notebook?note='

const list = (v) => (Array.isArray(v) ? v : [])

export function toNotices(alertsBody, insightsBody) {
  const out = []
  for (const a of list(alertsBody)) {
    if (!a || a.read) continue
    if (a.type === REMINDER) {
      out.push({ key: `a:${a.id}`, id: a.id, kind: 'reminder', title: a.title || 'Tasks due',
        line: a.message || '', href: a.data?.research_url || '/journal/notebook?view=tasks', source: 'alert' })
    } else if (a.type === FILL) {
      out.push({ key: `a:${a.id}`, id: a.id, kind: 'fill', title: a.title || 'New fill captured',
        line: a.message || '', href: a.data?.research_url || '/journal?j2tab=positions', source: 'alert' })
    }
  }
  for (const i of list(insightsBody?.insights)) {
    if (!i || i.dismissed_at || !RESURFACE.has(i.kind)) continue
    // The door only follows a link into the member's own Notebook (VoiceInsightsPanel does the same).
    const href = typeof i.link === 'string' && i.link.startsWith(NOTE_LINK) ? i.link : null
    out.push({ key: `i:${i.id}`, id: i.id, kind: 'resurface', title: i.headline || 'A note came back up',
      line: i.body || '', href, source: 'insight' })
  }
  return out
}
