// The rule edit door (Notebook P2b Task 8, over part b Task 3's route; spec §P2 item 2). It writes
// RULES, never a note: lib/blocks/blockDoors.test.js names this file in WRITE_EXCEPTIONS with that
// reason, matched on this call's literal method and URL template.
// A rule's version line is the version and the ET day its WORDS last changed (the server's
// `changedAt` is the current version's day, never a before-entry toggle's, R-PF-N4).
const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })

/** Ruling R-M1-1: the route answers 404 for a dismissed rule (and for one that is not the member's,
 *  which a member's own list never holds). Said in words, never as a status code. */
export const DISMISSED_SENTENCE = 'This rule was dismissed. Restore it to edit it.'
const FAILED_SENTENCE = 'The rule could not be saved. Nothing changed.'
const OFFLINE_SENTENCE = 'You are offline. The rule was not saved.'

export function versionLine(rule) {
  const v = Number(rule?.version) || 1
  const at = rule?.changedAt ? new Date(rule.changedAt) : null
  const day = at && !Number.isNaN(at.getTime()) ? DAY.format(at) : ''
  return day ? `v${v} · ${v > 1 ? 'changed' : 'made'} ${day}` : `v${v}`
}

/** @returns {Promise<{ok: true, rule: object} | {ok: false, error: string, dismissed?: true}>} */
export async function editRule(ruleId, patch) {
  try {
    const res = await fetch(`/api/j2/trader-blocks/rules/${encodeURIComponent(ruleId)}`, {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 404) return { ok: false, error: DISMISSED_SENTENCE, dismissed: true }
    if (!res.ok) return { ok: false, error: typeof data?.detail === 'string' ? data.detail : FAILED_SENTENCE }
    return { ok: true, rule: data }
  } catch {
    return { ok: false, error: OFFLINE_SENTENCE }
  }
}
