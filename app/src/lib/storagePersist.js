// app/src/lib/storagePersist.js — navigator.storage.persist(), asked AT MOST ONCE PER BROWSER PROFILE (review of #2537,
// L5).
//
// Two callers want the origin's storage kept under disk pressure: the bars pack (lib/barsPackClient, IndexedDB) and the
// on-device bar store (data/deviceStore/client, OPFS). Chrome and Edge decide silently; FIREFOX ASKS THE MEMBER (a
// permission prompt). The bars pack asked on every run that ingested (each new pack version, several a day) and the
// device client on every page load while not persisted, so a member who refused or dismissed the prompt could be
// asked again and again. Now ONE marker for the app, in localStorage: once this browser was asked, whatever the answer
// (granted, refused, dismissed, or the call threw), it is never asked again; already persistent, it is never asked.
// Without localStorage (blocked) the marker lives for the page load.
//
// Loaded lazily (a dynamic import from the bars pack's run, a static one from the device client's chunk): nothing here
// is in first-open bytes.

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
