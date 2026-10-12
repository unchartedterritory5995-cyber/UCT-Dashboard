// The regime's DISPLAY word for each regime id (R-M2-1 e): the option labels of the board property
// builtin:regime_at_write in api/services/journal_two/note_properties.py, so a note's blocks and its
// board column say the same word. Railed against the live BUILTIN_PROPERTY_DEFS by
// tests/test_house_sizing_table.py (parsed from this file, comments stripped).
// ⛔ houseSizing.json's regimeWords (GREEN / YELLOW / ...) are the sizing TABLE's keys, matched against
// the engine's _SIZING_TABLE; they decide a size and are never shown. These words are what is shown.
// ⛔ ONE map: the market context model (marketContextModel.js, lane B Task 9) takes its REGIME_WORDS from
// here when it merges, rather than restating it.
export const REGIME_WORDS = Object.freeze({ green: 'Green', amber: 'Yellow', orange: 'Orange', red: 'Red' })

/** The display word for a regime id, by OWN key only ('constructor' is not a regime), else null. */
export const regimeWord = (id) => (typeof id === 'string' && Object.hasOwn(REGIME_WORDS, id) ? REGIME_WORDS[id] : null)
