// P5: the starter packs' client ("How do you trade?", components/notebook/styles/StarterPackOffer.jsx).
// Imported ONLY by lazy chunks (the offer, KindSection, the Styles manager), never on the Notebook's first open.
//   · PACKS is ⛔ ONE FACT IN TWO FILES with `PACKS` in api/services/journal_two/starter_packs.py:
//     tests/test_starter_packs.py parses the `key`s below and holds them equal to the server's, in order.
//   · The seen state is the preference `notebook_starter_pack`, exactly one of the two blobs the server's
//     named validator accepts (api/routers/auth.py `_validate_starter_pack`): {v:1, state:'installed', pack, at}
//     or {v:1, state:'dismissed', at}. Anything else is refused with one 400, so this file writes no other shape.
//   · The key is a LITERAL at the write, so the client-writer rail (tests/test_preference_key_validation.py)
//     can read which preference this writes.
import { STYLES_URL } from './journalStyles'

export const PACKS = Object.freeze([{key:'swing',label:'Swing'},{key:'day',label:'Day'},{key:'prop',label:'Prop'},{key:'options',label:'Options'},{key:'earnings',label:'Earnings'}])

/** The preference's name, for readers. The write below spells it as a literal on purpose. */
export const STARTER_PACK_PREF = 'notebook_starter_pack'

const PACK_KEYS = new Set(PACKS.map((p) => p.key))

/** POST the install: `{installed: [{styleId, title}], alreadyHad: [title], skipped: [{title, reason}]}`.
 *  A refusal THROWS (an Error with `status`), so the caller can say nothing was changed. */
export async function installStarterPack(pack) {
  const res = await fetch(`${STYLES_URL}/starter-packs/${encodeURIComponent(pack)}`, {
    method: 'POST', credentials: 'include',
  })
  if (!res.ok) {
    let detail = ''
    try { detail = (await res.json())?.detail || '' } catch { /* a body that was not JSON */ }
    const err = new Error(detail || `${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

/** The member's answer, `{state, pack?, at}`, or null while there is none (the offer may then show).
 *  `prefs` values are stored as TEXT; the optimistic cache may already hold the parsed object. */
export function readStarterPackState(prefs) {
  const raw = prefs?.notebook_starter_pack
  if (raw == null || raw === '') return null
  let blob = raw
  if (typeof raw === 'string') {
    try { blob = JSON.parse(raw) } catch { return null }
  }
  if (!blob || typeof blob !== 'object') return null
  if (blob.state === 'dismissed') return { state: 'dismissed', at: blob.at }
  if (blob.state === 'installed' && PACK_KEYS.has(blob.pack)) return { state: 'installed', pack: blob.pack, at: blob.at }
  return null
}

/** Record the answer through the hook's `setPrefMerged` (the sanctioned structured-write path).
 *  `installed` must name its pack; `dismissed` carries none (the server refuses either the other way). */
export function writeStarterPackState(setPrefMerged, { state, pack } = {}) {
  const at = new Date().toISOString()
  let blob
  if (state === 'installed') {
    if (!PACK_KEYS.has(pack)) throw new Error(`writeStarterPackState: unknown pack ${pack}`)
    blob = { v: 1, state: 'installed', pack, at }
  } else if (state === 'dismissed') {
    blob = { v: 1, state: 'dismissed', at }
  } else {
    throw new Error(`writeStarterPackState: unknown state ${state}`)
  }
  return setPrefMerged('notebook_starter_pack', () => blob)
}
