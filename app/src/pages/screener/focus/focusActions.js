// focusActions.js — the Focus layout's doors onto things it does not own:
// the member-interest dot, the Save menu's four outcomes, and the pool options
// for the drawer's universe pill. Every server door is asked before its item is
// offered (spec §8.1: an unavailable outcome is omitted, never shown-then-failing).
import { useEffect, useMemo, useState } from 'react'
import { useMemberInterestSurface, useMemberInterest, followedAmong } from '../../../lib/memberInterest'
import { promoteAvailable, promoteScreen } from '../shell/promoteApi'
import { saveForkOffer, saveFork } from '../shell/saveForkApi'

const EMPTY = new Set()

/** Tickers among `rows` the member already follows. Off (empty) unless the
 *  screener's member-interest surface flag is on, the gate ScannerShell reads. */
export function useRadar(rows) {
  const on = useMemberInterestSurface('member_interest_screener_enabled')
  const interest = useMemberInterest(on)
  return useMemo(() => {
    if (!on || !interest?.entities) return EMPTY
    return new Set(followedAmong(interest.entities, rows.map(r => r.ticker)).map(x => x.sym))
  }, [on, interest, rows])
}

/** The drawer's pool options: the member's own lists, exactly as the screener
 *  meta offers them on the reserved `list` filter (UniverseBar reads the same).
 *  No extra request, and the values are the selectors the server resolves. */
export function poolOptions(meta) {
  const def = (meta?.filters || []).find(f => f.key === 'list')
  return (def?.presets || [])
    .filter(p => p && p.value != null && !Array.isArray(p.value))
    // The server's label carries a member count, "Semis (12)"; the pool pill names the list
    // only, as UniverseBar's labelName does.
    .map(p => ({ value: p.value, label: String(p.label || 'Watchlist').replace(/\s*\(\d[\d,]*\)\s*$/, '') }))
}

/** Which server-decided Save doors are open. `promote` = POST /to-watchlist
 *  answers (SCREENER_PROMOTE_ENABLED); `alert` = the save fork offers
 *  standing_alert AND says it is available. A 404 (door dark), a refusal, or a
 *  choice marked unavailable all read as closed. */
export function useSaveDoors() {
  const [doors, setDoors] = useState({ promote: false, alert: false })
  useEffect(() => {
    let live = true
    Promise.all([promoteAvailable(), saveForkOffer()]).then(([p, offer]) => {
      if (!live) return
      const alert = (Array.isArray(offer?.choices) ? offer.choices : []).find(c => c?.id === 'standing_alert')
      setDoors({ promote: !!p, alert: alert?.available === true })
    })
    return () => { live = false }
  }, [])
  return doors
}

async function sendJson(url, method, body) {
  let r
  try {
    r = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    return { ok: false, error: 'The server could not be reached.' }
  }
  let json = null
  try { json = await r.json() } catch { /* empty body */ }
  if (!r.ok) {
    const detail = typeof json?.detail === 'string' && json.detail.trim() ? json.detail.trim() : ''
    return { ok: false, error: detail || `The server refused (${r.status}).` }
  }
  return { ok: true, json }
}

// useSavedScreens.create/update discard the response, so a refusal and the new
// screen's id are both lost. These answer {ok, screen|error}; the caller refreshes.
export async function createScreen(name, spec) {
  const out = await sendJson('/api/screener/saved-screens', 'POST', { name, spec, is_public: false })
  return out.ok ? { ok: true, screen: out.json } : { ok: false, error: `Could not save the screen. ${out.error}` }
}
export async function updateScreen(id, fields) {
  const out = await sendJson(`/api/screener/saved-screens/${encodeURIComponent(id)}`, 'PUT', fields)
  return out.ok ? { ok: true, screen: out.json } : { ok: false, error: `Could not update the screen. ${out.error}` }
}

/** Save today's matches as a new, frozen watchlist. Returns the toast line. */
export async function saveFrozenList(spec, name) {
  try {
    const out = await promoteScreen({ spec, name })
    return out?.truncated
      ? `Saved "${name}" with the first ${Number(out.taken).toLocaleString('en-US')} of ${Number(out.matched).toLocaleString('en-US')} matches`
      : `Saved "${name}" with ${Number(out?.added || 0).toLocaleString('en-US')} names`
  } catch (e) {
    return e?.message || 'Could not save the list.'
  }
}

/** Save the screen and a standing alert on it, through the save fork. */
export async function saveStandingAlert(spec, name) {
  try {
    await saveFork({ choice: 'standing_alert', name, spec })
    return `Saved "${name}". You'll be told overnight when names enter or leave it.`
  } catch (e) {
    return e?.message || 'Could not set the alert.'
  }
}

/** Freeze the result set into the Notebook through the same chokepoint
 *  SaveToNotebookButton uses (imported on press, as it does). */
export async function saveToNotebook(capture) {
  if (!capture) return 'Nothing to save yet.'
  try {
    const { sendCaptureToJournal } = await import('../../journal-2-0/lib/sendToJournal')
    return await sendCaptureToJournal('screener', capture, { label: 'Screener results' })
  } catch {
    return 'Capture failed. Try again.'
  }
}
