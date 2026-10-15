// app/src/pages/journal-2-0/lib/screenshotTag.js
/**
 * Tier 2 part A, item 10 -- what pressing "Tag NVDA · Daily" does, and the sentence it says. LAZY: the editor
 * page imports this only at the press (`await import`), so opening a note pays for none of it (I5). The chip that
 * is pressed already loaded lib/screenshotLabel, so the import resolves at once.
 *
 * It labels the image (its alt: an editor transaction on the note's own autosave path, R-T2A-8) and, only when the
 * note has no ticker -- saved, or TYPED into the Ticker field and not saved yet (I2) -- asks the page to set it.
 * ⛔ The ticker write itself stays on the page (`setTicker`: `update` + `settleMetadataRevision`, the metadata door
 * onTickerChange uses); this module only decides and words.
 */
import { labelImage } from './screenshotLabel'
import { normalizeNoteTicker } from './noteTicker'

export const LOCKED_SENTENCE = 'This note is locked — unlock it in the Notebook first'

/** `{ message, tone }` for the page's toast. Never throws: anything unexpected is said, and nothing more is done. */
export async function tagScreenshot(press) {
  try {
    return await decide(press)
  } catch {
    return { message: "Couldn't tag the screenshot. Nothing changed.", tone: 'error' }
  }
}

async function decide({ offer, editor, noteId, locked, existingTicker, setTicker }) {
  const words = offer.timeframe ? `${offer.symbol} · ${offer.timeframe.label}` : offer.symbol
  if (locked) return { message: LOCKED_SENTENCE, tone: 'error' }
  if (offer.noteId !== noteId || !offer.alt || !labelImage(editor, offer.url, offer.alt)) {
    return { message: "Couldn't tag the screenshot — it is no longer in this note. Nothing changed.", tone: 'error' }
  }
  if (existingTicker) return { message: `Tagged the screenshot ${words}.`, tone: 'success' }
  // The ticker door's own validator, never a second route around it.
  const { ticker: symbol } = normalizeNoteTicker(offer.symbol)
  try {
    if (!symbol) throw new Error('not a ticker')
    await setTicker(symbol)
    return { message: `Tagged the screenshot ${words} and set this note's ticker to ${symbol}.`, tone: 'success' }
  } catch {
    return { message: `Tagged the screenshot ${words}. Couldn't set the note's ticker; nothing else changed.`, tone: 'error' }
  }
}
