// app/src/components/chart/builder/statusHeadlineRecord.js
//
// WHEN THE AUTHOR'S STATUS SENTENCE GOES ON RECORD (Studio lane R4).
//
// The author of a pasted script reads a verdict in the builder's status panel ("Runs fully",
// "Runs on charts, 2 values withheld (not guessed)"). The server can show that sentence to people
// the script is shared with, but it does not compute it: the panel runs in the author's browser.
// So the browser puts it on record (`POST /{id}/status-headline`), for the version the sentence is
// about and no other.
//
// This file is the decision, kept out of the window so it can be read and tested whole:
//
//   · only while the status panel is on (the sentence is the panel's; where the panel is off the
//     author was shown none, so none is recorded);
//   · only for a version that was actually stored (an id the store minted, a whole version);
//   · ⛔ only when the sentence was computed on EXACTLY the text that was saved. A sentence about
//     an earlier buffer, recorded against a later save, would tell a stranger something the author
//     was never told about that version;
//   · never a blank sentence.

const STORED_ID = /^u_[0-9a-f]{12}$/

/**
 * What to record, or null when nothing should be.
 * @param {object} p
 * @param {boolean} p.enabled          the status panel's own gate
 * @param {string} p.defId             the saved definition
 * @param {number} p.version           the version the save returned (or the one opened)
 * @param {string} p.savedText         the script that version holds
 * @param {{headline: string, source: string}|null} p.said  the panel's sentence and the text it is about
 * @param {number} p.engine            the script engine this browser runs
 * @returns {null | { defId: string, version: number, engine: number, headline: string }}
 */
export function headlineToRecord({ enabled, defId, version, savedText, said, engine } = {}) {
  if (enabled !== true) return null
  if (typeof defId !== 'string' || !STORED_ID.test(defId)) return null
  if (!Number.isInteger(version) || version < 1) return null
  if (!Number.isInteger(engine) || engine < 1) return null
  if (!said || typeof said.headline !== 'string' || typeof said.source !== 'string') return null
  if (typeof savedText !== 'string' || !savedText.trim() || said.source !== savedText) return null
  const headline = said.headline.trim()
  if (!headline) return null
  return { defId, version, engine, headline }
}

/** One record per version and sentence in a window: a second identical one is not sent. */
export const headlineKey = (send) => `${send.defId}@${send.version}:${send.engine}:${send.headline}`
