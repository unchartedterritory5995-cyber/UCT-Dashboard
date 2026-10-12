// The regime's DISPLAY word for each regime id (R-M2-1 e): the option labels of the board property
// builtin:regime_at_write in api/services/journal_two/note_properties.py, so a note's blocks and its
// board column say the same word. Railed against the live BUILTIN_PROPERTY_DEFS by
// tests/test_journal_two_properties_router.py (parsed from this file, comments stripped).
// ⛔ houseSizing.json's regimeWords (GREEN / YELLOW / ...) are the sizing TABLE's keys, matched against
// the engine's _SIZING_TABLE; they decide a size and are never shown. These words are what is shown.
// ⛔ ONE map: the market context model (charts/widgets/marketContextModel.js, Task 9) re-exports it from
// here and the position sizing block reads it here. The import in that model carries the .js extension so
// Node can load the model directly; keep this file free of imports for the same reason.
export const REGIME_WORDS = Object.freeze({ green: 'Green', amber: 'Yellow', orange: 'Orange', red: 'Red' })

/** The display word for a regime id, by OWN key only ('constructor' is not a regime), else null. */
export const regimeWord = (id) => (typeof id === 'string' && Object.hasOwn(REGIME_WORDS, id) ? REGIME_WORDS[id] : null)
