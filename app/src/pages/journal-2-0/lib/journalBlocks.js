// The blocks a journal style can switch on (spec P1.1/P1.2). A block id IS a widget id: a block
// is a widgetEmbed node with that widgetId (docs/notebook/p1-verify-before-building.md §a). P1 can
// build one block, the chart; P2 adds rows here AND in journal_styles.BLOCK_KINDS (with a builder).
// ⛔ ONE FACT IN TWO FILES, pinned by tests/test_journal_styles_store.py through Node. NO IMPORTS.
export const BLOCK_KINDS = Object.freeze([
  Object.freeze({
    id: 'chart',
    label: 'Chart of the note’s ticker',
    settings: Object.freeze([
      Object.freeze({ key: 'tf', label: 'Timeframe', options: Object.freeze(['D', 'W', '60', '15', '5']), default: 'D' }),
    ]),
  }),
])

const TF_WORDS = { D: 'Daily', W: 'Weekly', 60: '1 hour', 15: '15 minutes', 5: '5 minutes' }
export const tfWord = (tf) => TF_WORDS[tf] || String(tf)

/** A block's member-facing name; an id this bundle does not know reads as a newer-version block. */
export function blockLabel(id) {
  const k = BLOCK_KINDS.find((b) => b.id === id)
  return k ? k.label : `A block from a newer version (${id})`
}
