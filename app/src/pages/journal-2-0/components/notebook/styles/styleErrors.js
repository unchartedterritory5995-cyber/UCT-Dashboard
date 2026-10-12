// What a member reads when a style action fails (Notebook P1, spec section 6): the browser's own
// "Failed to fetch" and a bare "500" are never shown. A sentence the SERVER worded (a 4xx detail) is.
// "Offline" is said ONLY for a genuine network failure: the browser says it is offline, or the error is the
// browser's own fetch failure (Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError ...").
// Any other status-less error is a bug on our side: worded as such, never blamed on the member's wifi.
// ⛔ friendlyError is PURE (it runs during render). Logging a bug is reportError's job, called from the catch
// that caught it (or once from an effect), never from a render.
export const OFFLINE_SENTENCE = "You're offline. Changes to styles need a connection."
export const SERVER_SIDE_SENTENCE = 'Something went wrong on our side. Try again.'

const NETWORK_WORDS = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i

const offlineNow = () => typeof navigator !== 'undefined' && navigator.onLine === false
const isNetworkFailure = (e) => e instanceof TypeError && NETWORK_WORDS.test(String(e?.message || ''))

/** A status-less error that is not the network: a bug in our own code. */
export const isUnexpected = (e) => !offlineNow() && !e?.status && !isNetworkFailure(e)

export function friendlyError(e) {
  if (offlineNow()) return OFFLINE_SENTENCE
  const message = String(e?.message || '').trim()
  if (!e?.status) return isNetworkFailure(e) ? OFFLINE_SENTENCE : SERVER_SIDE_SENTENCE      // lib/journalStyles.call: a network failure has no status
  if (!message || /^\d{3}$/.test(message)) return SERVER_SIDE_SENTENCE                     // a body that was not JSON
  return message
}

/** Log a bug of ours once, where it was caught. */
export function logIfUnexpected(e) {
  if (isUnexpected(e)) console.error('[journal styles]', e)
}

/** The words for a caught error, logging it if it is a bug of ours. */
export function reportError(e) {
  logIfUnexpected(e)
  return friendlyError(e)
}
