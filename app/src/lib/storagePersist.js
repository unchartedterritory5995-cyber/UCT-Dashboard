// app/src/lib/storagePersist.js — navigator.storage.persist(), asked AT MOST ONCE PER BROWSER PROFILE (review of #2537,
// L5).
//
// Chrome and Edge decide silently; FIREFOX ASKS THE MEMBER (a permission prompt). The on-device bar store's client
// (data/deviceStore/client) asked on every page load while the origin was not persistent, so a member who refused or
// dismissed the prompt was asked again on each load. Now a marker in localStorage: once this browser was asked,
// whatever the answer (granted, refused, dismissed, or the call threw), it is never asked again; already persistent, it
// is never asked. Without localStorage (blocked) the marker lives for the page load.
//
// ⚠️ NOT YET SHARED WITH THE BARS PACK. lib/barsPackClient.js `_run` still asks on every run that ingests a new pack
// version (the review assumed it asked once; it does not). It runs for every member, store or not, in the entry chunk
// (the Notebook's first-open bytes), so moving it onto this marker is its own change, measured on a build.
//
// Loaded only by the device client's lazy chunk: nothing here is in first-open bytes.

export const PERSIST_ASKED_KEY = 'uct.storage.persistAsked'

let _askedHere = false

function _askedBefore() {
  if (_askedHere) return true
  try { return localStorage.getItem(PERSIST_ASKED_KEY) === '1' } catch { return false }
}

function _markAsked() {
  _askedHere = true
  try { localStorage.setItem(PERSIST_ASKED_KEY, '1') } catch { /* storage blocked: this page load only */ }
}

function _navStorage() {
  try { return (typeof navigator !== 'undefined' && navigator.storage) || null } catch { return null }
}

/**
 * Ask for persistent storage unless this browser is persistent already or was asked before. Never throws.
 * Resolves {asked, persisted, granted, error}: `asked` true only when THIS call asked.
 */
export async function askPersistOnce({ storage = _navStorage() } = {}) {
  const out = { asked: false, persisted: null, granted: null, error: null }
  try {
    if (!storage) return out
    const already = typeof storage.persisted === 'function' ? await storage.persisted() : null
    out.persisted = already === true
    if (already === true || typeof storage.persist !== 'function') return out
    // checked and marked in one synchronous step: two callers racing here ask once
    if (_askedBefore()) return out
    _markAsked()
    out.asked = true
    const granted = await storage.persist()
    out.granted = granted === true
    if (granted === true) out.persisted = true
  } catch (e) {
    out.error = String(e?.message || e).slice(0, 120)
  }
  return out
}
