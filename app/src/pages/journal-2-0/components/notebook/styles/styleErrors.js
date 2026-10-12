// What a member reads when a style action fails (Notebook P1, spec section 6): the browser's own
// "Failed to fetch" and a bare "500" are never shown. A sentence the SERVER worded (a 4xx detail) is.
export const OFFLINE_SENTENCE = "You're offline. Changes to styles need a connection."
export const SERVER_SIDE_SENTENCE = 'Something went wrong on our side. Try again.'

const NETWORK_WORDS = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i

export function friendlyError(e) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return OFFLINE_SENTENCE
  const message = String(e?.message || '').trim()
  if (!e?.status) {                                      // lib/journalStyles.call: a network failure has no status
    return e instanceof TypeError || NETWORK_WORDS.test(message) ? OFFLINE_SENTENCE : SERVER_SIDE_SENTENCE
  }
  if (!message || /^\d{3}$/.test(message)) return SERVER_SIDE_SENTENCE      // a body that was not JSON
  return message
}
