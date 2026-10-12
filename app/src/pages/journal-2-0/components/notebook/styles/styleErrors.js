// What a member reads when a style action fails (Notebook P1, spec section 6): the browser's own
// "Failed to fetch" and a bare "500" are never shown. A sentence the SERVER worded (a 4xx detail) is.
// "Offline" is said ONLY for a genuine network failure: the browser says it is offline, or the error is the
// browser's own fetch failure (Chrome "Failed to fetch", Safari "Load failed", Firefox "NetworkError ...").
// Any other status-less error is a bug on our side: it is logged and worded as such, never blamed on the member's wifi.
export const OFFLINE_SENTENCE = "You're offline. Changes to styles need a connection."
export const SERVER_SIDE_SENTENCE = 'Something went wrong on our side. Try again.'

const NETWORK_WORDS = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i

export function friendlyError(e) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE_SENTENCE
  const message = String(e?.message || '').trim()
  if (!e?.status) {                                      // lib/journalStyles.call: a network failure has no status
    if (e instanceof TypeError && NETWORK_WORDS.test(message)) return OFFLINE_SENTENCE
    console.error('[journal styles]', e)
    return SERVER_SIDE_SENTENCE
  }
  if (!message || /^\d{3}$/.test(message)) return SERVER_SIDE_SENTENCE      // a body that was not JSON
  return message
}
