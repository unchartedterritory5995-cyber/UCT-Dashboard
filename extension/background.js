/**
 * The service worker. It exists for exactly one reason: `launchWebAuthFlow`
 * opens a separate OS window, and a popup that loses focus is torn down —
 * taking its pending promise with it. The connect flow therefore has to be
 * owned by something that outlives the popup.
 *
 * It does no page access, holds no state of its own, and runs no timers.
 */

import { connect, clearCredential, getCredential } from './lib/auth.js'

const HANDLERS = {
  async CONNECT() {
    return await connect()
  },
  async DISCONNECT() {
    // Local only, and the UI says so. A member who wants the credential dead
    // server-side revokes it in UCT Settings; forgetting it here does not.
    await clearCredential()
    return { ok: true }
  },
  async STATUS() {
    const cred = await getCredential()
    return { connected: !!cred, expiresAt: cred?.expiresAt || null }
  },
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = HANDLERS[msg?.type]
  if (!handler) return false
  handler(msg)
    .then((data) => sendResponse({ ok: true, data }))
    // ⛔ The MESSAGE only. An error object from a fetch can carry a request the
    // Authorization header was on; passing it whole is how a credential ends up
    // in a devtools console.
    .catch((e) => sendResponse({ ok: false, error: e?.message || 'Something went wrong' }))
  return true   // keep the channel open for the async reply
})
