/**
 * The extension's half of the Browser Capture credential.
 *
 * WHAT THIS FILE MAY HOLD, stated plainly because it is the security claim:
 * the scoped capture token, and nothing else. Never the UCT session cookie,
 * never an email or password, never a general account token. An extension
 * compromise can steal what is here — the design's promise is the CEILING on
 * what that is worth (authorized external Notebook capture for one member,
 * until expiry or revocation), not that it cannot be stolen.
 *
 * ⛔ chrome.cookies IS NOT USED AND THE PERMISSION IS NOT REQUESTED. Reading
 * `uct_session` would defeat `httpOnly`, whose entire purpose is that no script
 * can read the session, and would hand 30 days of full account authority to
 * extension JavaScript. That option was ruled out; this file is where it would
 * have lived, so it is named here.
 */

import { API_BASE, CLIENT_ID, CONNECT_PATH, ENDPOINTS } from './config.js'

const KEY = 'uct.capture.credential'

/** The stored credential, or null. Never throws — a corrupt store reads as
 *  "not connected", which is the fail-closed direction. */
export async function getCredential() {
  try {
    const bag = await chrome.storage.local.get(KEY)
    const cred = bag?.[KEY]
    if (!cred || typeof cred.token !== 'string') return null
    if (cred.expiresAt && new Date(cred.expiresAt).getTime() <= Date.now()) {
      // Locally expired. Clearing it here is not the security boundary — the
      // server refuses it regardless — it just means the UI says "reconnect"
      // instead of failing a request first.
      await clearCredential()
      return null
    }
    return cred
  } catch {
    return null
  }
}

export async function clearCredential() {
  try { await chrome.storage.local.remove(KEY) } catch { /* nothing to do */ }
}

async function setCredential(cred) {
  await chrome.storage.local.set({ [KEY]: cred })
}

/**
 * The handshake. Opens the first-party UCT authorization page in Chromium's own
 * auth window, where the member's existing session authenticates a top-level
 * navigation, and exchanges the returned single-use code for a scoped token.
 *
 * `interactive: true` is required and deliberate: a credential must never be
 * minted without the member seeing what they are granting.
 */
export async function connect() {
  const redirectUri = chrome.identity.getRedirectURL()
  // `state` is carried through and compared on return. It defends the extension
  // against being handed a code it did not ask for.
  const state = crypto.randomUUID()
  const url = `${API_BASE}${CONNECT_PATH}?redirect_uri=${encodeURIComponent(redirectUri)}` +
              `&state=${encodeURIComponent(state)}&client_id=${encodeURIComponent(CLIENT_ID)}`

  const returned = await chrome.identity.launchWebAuthFlow({ url, interactive: true })
  if (!returned) throw new Error('Connection was cancelled')

  // The code comes back in the FRAGMENT — never a query string, so it is not in
  // any server log or Referer on the way here.
  const hash = returned.includes('#') ? returned.slice(returned.indexOf('#') + 1) : ''
  const parsed = new URLSearchParams(hash)
  if (parsed.get('state') !== state) throw new Error('Connection could not be verified')
  const code = parsed.get('code')
  if (!code) throw new Error('Connection was cancelled')

  const res = await fetch(`${API_BASE}${ENDPOINTS.token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // ⛔ No cookies, ever. This request must be authorized by the code alone; a
    // credentialed mode would be asking the browser for a session this
    // extension has deliberately not been given.
    credentials: 'omit',
    body: JSON.stringify({ code, redirectUri, clientId: CLIENT_ID }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not connect')

  await setCredential({
    token: body.token,
    tokenId: body.tokenId,
    scopes: body.scopes || [],
    expiresAt: body.expiresAt,
  })
  return { scopes: body.scopes || [], expiresAt: body.expiresAt }
}

/** Thrown when the credential is gone. The UI turns this into one button, never
 *  into the words "401" or "Unauthorized" (§17). */
export class ReconnectRequired extends Error {
  constructor(message) {
    super(message || 'Reconnect UCT Browser Capture to continue.')
    this.name = 'ReconnectRequired'
  }
}

/**
 * The ONLY way this extension talks to UCT. Adds the bearer, and turns a dead
 * credential into a typed signal rather than an HTTP status the UI has to
 * interpret.
 */
export async function authorizedFetch(path, init = {}) {
  const cred = await getCredential()
  if (!cred) throw new ReconnectRequired()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'omit',
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${cred.token}`,
    },
  })
  if (res.status === 401) {
    await clearCredential()
    throw new ReconnectRequired()
  }
  return res
}
