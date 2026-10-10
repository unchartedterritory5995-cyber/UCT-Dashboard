// app/src/pages/journal-2-0/lib/noteTicker.js
//
// The note header's Ticker field, checked BEFORE it is sent.
//
// ⚰️ Found by the press-every-control crawl (2026-10-09): typing "crawl test 42" into the field
// and leaving it sent the text as-is; the server refused it (400 "ticker has invalid characters"),
// the refusal escaped as an uncaught page error, the field kept the bad text, and the note kept
// its old ticker -- two different answers on one screen and no word to the member.
//
// The rule is the SERVER's (`api/services/journal_two/notes.py` `_validate_ticker`:
// strip, upper-case, at most MAX_TICKER_LENGTH, letters/digits/dot/dash). noteTicker.test.js
// reads both from that file, so this cannot drift from it. One kindness the server does not
// do: a leading "$" (how traders write a symbol) is dropped.
export const NOTE_TICKER_MAX = 16
export const NOTE_TICKER_PATTERN = /^[A-Z0-9.-]+$/

/** `{ ticker }` (a string, or null for "no ticker") or `{ error }` (a sentence for the member). */
export function normalizeNoteTicker(raw) {
  const t = String(raw ?? '').trim().replace(/^\$+/, '').trim().toUpperCase()
  if (!t) return { ticker: null }
  if (t.length > NOTE_TICKER_MAX) {
    return { error: `“${t}” is too long for a ticker (${NOTE_TICKER_MAX} characters at most). Nothing changed.` }
  }
  if (!NOTE_TICKER_PATTERN.test(t)) {
    return { error: `“${String(raw).trim()}” isn't a ticker symbol. Use one symbol, like NVDA or BRK.B. Nothing changed.` }
  }
  return { ticker: t }
}
