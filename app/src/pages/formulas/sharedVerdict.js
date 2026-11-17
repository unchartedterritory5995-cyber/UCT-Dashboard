// app/src/pages/formulas/sharedVerdict.js
//
// THE VERDICT ON A SHARED INDICATOR, AS THE INSTALLER READS IT (Studio lane R4; backlog 43).
//
// The author of a pasted script sees a verdict in their status panel ("Runs fully", "Runs on
// charts, 2 values withheld (not guessed)"). Somebody opening that author's share link, or
// browsing the library, saw none of it. The server now sends the SAVED row's verdict beside the
// document: `headline` (the author's own sentence for that saved version), `engine_version` (the
// engine stamp it was made under) and, optionally, `headline_current` (false when the serving
// engine's stamp is a different one).
//
// ⛔ NOTHING IS COMPUTED HERE. The line is the server's sentence for the saved row the link
// points at; this file only decides how it is said. A verdict worked out in the installer's
// browser would be a second authority over what the author was told.
// ⛔ NO HEADLINE, NO LINE. An indicator built from conditions or by the assistant has no stored
// verdict; it gets no row, no "unknown", no empty space.
// Text, never colour alone: there is no badge and no score.

const text = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')

/**
 * The line for one shared row (`GET /shared/{token}`'s body, the install's row, or a library
 * entry that carries the fields), or null when there is nothing to say.
 * @returns {null | { headline: string, checked: string, earlier: boolean, sentence: string }}
 */
export function sharedVerdict(row) {
  const headline = text(row && row.headline)
  if (!headline) return null
  const engine = text(row.engine_version)
  // only an explicit `false` says the engine has moved on; absent means the server did not say
  const earlier = row.headline_current === false
  const checked = engine
    ? (earlier ? `checked on engine ${engine}, an earlier engine than today's` : `checked on engine ${engine}`)
    : (earlier ? "checked on an earlier engine than today's" : '')
  return { headline, checked, earlier, sentence: checked ? `${headline}, ${checked}.` : `${headline}.` }
}
