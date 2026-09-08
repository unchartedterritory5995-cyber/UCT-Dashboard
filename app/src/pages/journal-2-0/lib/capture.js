// ⛔ THE ONE CLIENT CAPTURE PATH (Wave L Slice 2 §1).
//
//     CAPTURE DOORS MAY CHOOSE DEFAULTS.
//     CAPTURE DOORS MAY NOT OWN CAPTURE SEMANTICS.
//
// Every door — palette, hotkey, note, research workspace, the in-app surfaces,
// and later the extension and mobile share target — builds an intent HERE and
// submits it HERE. `captureConvergence.test.js` walks the source tree and fails
// if any component posts to the capture endpoint on its own, because the moment
// a second caller exists the guarantee is gone: one of them will drift.
//
// ⭐ WHAT THE CLIENT IS NOT AUTHORITATIVE FOR (§2): domain, canonical identity,
// coverage, rights classification, source ownership. Those are DERIVED and
// VALIDATED server-side. The client's job is to say what the member meant, not
// to decide what may be stored.

export const CAPTURE_ENDPOINT = '/api/j2/capture'

export const TIER_REFERENCE = 'reference'
export const TIER_PASSAGE = 'passage'

/** Where a capture is going, and why the door thinks so. `contextLabel` is what
 *  the member is shown, because a fast capture to the WRONG place is not good
 *  capture UX (§3) — a default may be silent to type but never silent on screen. */
export function captureDestination({ noteId, noteTitle, ticker, source }) {
  return {
    noteId: noteId || null,
    contextLabel: ticker ? `${ticker} Research` : (noteTitle || 'Notebook'),
    ticker: ticker || null,
    // Which door produced this. Defaults differ per door; semantics never do.
    source: source || 'unknown',
  }
}

/** The canonical capture intent (§2). Deliberately small: anything derivable
 *  from the URL is derived by the server, so a door cannot get it wrong. */
export function buildCaptureIntent({
  tier, url, title, passage, annotation, destination,
}) {
  const t = passage && passage.trim() ? TIER_PASSAGE : (tier || TIER_REFERENCE)
  return {
    tier: t,
    url: (url || '').trim(),
    title: (title || '').trim(),
    // Source material and member interpretation stay two fields all the way
    // down — the member is shown two controls for the same reason (§12).
    passage: (passage || '').trim(),
    annotation: (annotation || '').trim(),
    noteId: destination?.noteId || null,
    // Sent for telemetry/defaulting only; the server never trusts it for
    // membership, which stays Wave H's union on the destination note.
    ticker: destination?.ticker || null,
  }
}

/** What is missing before this intent can be submitted. Client-side validation
 *  is a COURTESY, never the boundary: the server refuses the same things again. */
export function captureBlockers(intent) {
  const out = []
  if (!intent.url) out.push('a source URL')
  if (!intent.noteId) out.push('a destination')
  if (intent.tier === TIER_PASSAGE && !intent.passage) out.push('the selected passage')
  return out
}

export class CaptureError extends Error {
  constructor(message, { kind = 'error', status = 0 } = {}) {
    super(message)
    this.kind = kind          // 'rights' | 'validation' | 'destination' | 'network' | 'error'
    this.status = status
  }
}

const MESSAGES = {
  rights: "That can't be saved in full — capture the passage you need instead.",
  destination: "That destination isn't available any more.",
  network: "Couldn't reach UCT. Nothing was saved — your text is still here.",
  error: "Couldn't save that capture. Nothing was saved — your text is still here.",
}

/** Submit one intent. Resolves with the server's own answer — including
 *  `deduped`, which is why the UI can say "Already saved" without inventing
 *  duplicate logic of its own (§11). */
export async function submitCapture(intent, { fetchImpl = fetch } = {}) {
  let res
  try {
    res = await fetchImpl(CAPTURE_ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(intent),
    })
  } catch (e) {
    // ⛔ The member's text is never discarded on a failure — the dialog stays
    // open and populated. Losing what someone just wrote is worse than any
    // error message.
    throw new CaptureError(MESSAGES.network, { kind: 'network' })
  }
  if (res.ok) return res.json()

  let detail = ''
  try { detail = (await res.json())?.detail || '' } catch { /* body may not be JSON */ }
  if (res.status === 422) {
    // A rights refusal is EXPLICIT and never dressed up as success (§10).
    throw new CaptureError(detail || MESSAGES.rights, { kind: 'rights', status: 422 })
  }
  if (res.status === 404) throw new CaptureError(MESSAGES.destination, { kind: 'destination', status: 404 })
  if (res.status === 400) throw new CaptureError(detail || MESSAGES.error, { kind: 'validation', status: 400 })
  throw new CaptureError(MESSAGES.error, { kind: 'error', status: res.status })
}

/** The one sentence a member reads after a capture (§9). It answers both
 *  questions — did it save, and where did it go — and distinguishes a new
 *  capture from one the server resolved to an existing row. */
export function captureConfirmation(result, destination) {
  const where = destination?.contextLabel || 'Notebook'
  return result?.deduped ? `Already saved to ${where}` : `Saved to ${where}`
}
