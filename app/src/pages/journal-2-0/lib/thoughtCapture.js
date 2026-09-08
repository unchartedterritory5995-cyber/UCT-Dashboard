// ⛔ THE MEMBER-AUTHORED CAPTURE KIND (Wave L §1C).
//
// A thought has NO external source, NO external provenance and NO web rights
// tier. It is the member's own writing, so it goes through the canonical
// member-authored Notebook path — `createNoteViaApi` → POST /api/j2/notes —
// and NOT through /api/j2/capture.
//
// ⛔ What this module must never do, each of which was explicitly ruled out:
//   · manufacture a URL so a thought can ride the web path
//   · pass a nullable URL into web capture
//   · store the member's words as a source `passage`
// A thought stored as source material is a lie about who said it, and the
// provenance line this wave spent Slices 0–1b establishing is exactly the thing
// that would break.
//
// Membership is Wave H's existing union: a thought captured in NVDA's research
// is a note carrying `ticker: 'NVDA'`, which is why it appears in NVDA Research
// without a second membership system.
import { createNoteViaApi } from './noteCreation'

/** First line becomes the title, so a thought is findable without asking the
 *  member to name it. Bounded so a pasted paragraph cannot become a title. */
export function thoughtTitle(text) {
  const first = String(text || '').trim().split('\n').find((l) => l.trim()) || ''
  const clean = first.trim()
  if (clean.length <= 80) return clean
  const cut = clean.slice(0, 80)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`
}

/** The thought as a TipTap document — the same body shape every other
 *  member-authored note uses, so it opens, edits, exports and indexes like one.
 *  It IS one. */
export function thoughtBody(text) {
  const paragraphs = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  return {
    type: 'doc',
    content: (paragraphs.length ? paragraphs : ['']).map((p) => ({
      type: 'paragraph',
      ...(p ? { content: [{ type: 'text', text: p }] } : {}),
    })),
  }
}

export function thoughtBlockers({ text, destination }) {
  const out = []
  if (!String(text || '').trim()) out.push('something to save')
  // ⭐ NO URL REQUIREMENT. That was the measured defect: a member-authored
  // thought was impossible because the web-shaped dialog demanded a source.
  if (!destination) out.push('a destination')
  return out
}

export class ThoughtCaptureError extends Error {
  constructor(message, kind = 'error') {
    super(message)
    this.kind = kind
  }
}

/**
 * Save one thought. Returns the created note plus the fields the shared shell
 * needs for its confirmation, in the same shape the web path returns so the
 * shell can stay one component without either kind pretending to be the other.
 */
export async function submitThought({ text, destination }, { create = createNoteViaApi } = {}) {
  const body = String(text || '').trim()
  if (!body) throw new ThoughtCaptureError('There is nothing to save yet.', 'validation')
  try {
    const note = await create({
      title: thoughtTitle(body),
      bodyJson: thoughtBody(body),
      ...(destination?.ticker ? { ticker: destination.ticker } : {}),
      ...(destination?.folderId ? { folderId: destination.folderId } : {}),
    })
    return { kind: 'thought', noteId: note?.id || null, title: note?.title || '', deduped: false }
  } catch (e) {
    // ⛔ A thought must NEVER see a web-rights error (§14) — there is no rights
    // question here. Anything that fails is a plain save failure, and the
    // member's words stay on screen.
    throw new ThoughtCaptureError(
      "Couldn't save that. Nothing was lost — your text is still here.", 'error')
  }
}

/** A cheap, conservative "does this look like a link?" used ONLY to OFFER an
 *  explicit switch to source capture (§10). It never switches anything by
 *  itself: silently reinterpreting a member's typing as source material is the
 *  precise failure the provenance line exists to prevent. */
export function looksLikeUrl(text) {
  const t = String(text || '').trim()
  if (!t || /\s/.test(t)) return false
  return /^https?:\/\/\S+$/i.test(t)
}
