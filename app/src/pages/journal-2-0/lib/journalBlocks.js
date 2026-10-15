// The blocks a journal style can switch on (spec P1.1/P1.2, P2). A block id IS a widget id, except
// `reminder` (Tier 2 part B), which builds an unticked task: a block is a widgetEmbed node with that
// widgetId (docs/notebook/p1-verify-before-building.md §a). P2 adds rows here AND in
// journal_styles.BLOCK_KINDS (with a builder).
// ⛔ ONE FACT IN TWO FILES, pinned by tests/test_journal_styles_store.py through Node (ids, `search`,
// settings keys, options, defaults). Labels and optionLabels are the client's own words. NO IMPORTS.
const YES_NO = Object.freeze({ yes: 'Yes', no: 'No' })
export const BLOCK_KINDS = Object.freeze([
  Object.freeze({
    id: 'chart',
    label: 'Chart of the note’s ticker',
    settings: Object.freeze([
      Object.freeze({ key: 'tf', label: 'Timeframe', options: Object.freeze(['D', 'W', '60', '15', '5']), default: 'D' }),
    ]),
  }),
  Object.freeze({
    id: 'preEntryChecklist',
    label: 'Pre-entry checklist',
    search: '[pre-entry checklist]',
    settings: Object.freeze([
      Object.freeze({ key: 'includeRules', label: 'Include my before-entry rules', options: Object.freeze(['yes', 'no']), default: 'yes', optionLabels: YES_NO }),
      Object.freeze({ key: 'requireAll', label: 'Warn until every item is ticked', options: Object.freeze(['no', 'yes']), default: 'no', optionLabels: YES_NO }),
    ]),
  }),
  Object.freeze({
    id: 'priceStamps',
    label: 'Price stamps',
    search: '[price stamps]',
    settings: Object.freeze([
      Object.freeze({ key: 'on', label: 'Stamp prices as I write', options: Object.freeze(['no', 'yes']), default: 'no', optionLabels: YES_NO }),
    ]),
  }),
  Object.freeze({
    id: 'positionSizing',
    label: 'Position sizing',
    search: '[position sizing]',
    settings: Object.freeze([
      Object.freeze({ key: 'grade', label: 'Setup grade', options: Object.freeze(['A', 'A+', 'B']), default: 'A' }),
    ]),
  }),
  // P2 Tier 1 (part b): six blocks, no settings.
  Object.freeze({
    id: 'myRules',
    label: 'My rules',
    search: '[my rules]',
    // R-PF-B1: the one real setting among part b's blocks.
    settings: Object.freeze([
      Object.freeze({ key: 'which', label: 'Show', options: Object.freeze(['active', 'all']), default: 'active',
        optionLabels: Object.freeze({ active: 'Active rules', all: 'All rules' }) }),
    ]),
  }),
  Object.freeze({ id: 'prepWire', label: 'Morning wire and exposure', search: '[morning wire and exposure]', settings: Object.freeze([]) }),
  Object.freeze({ id: 'prepEarnings', label: 'Earnings for my names', search: '[earnings for my names]', settings: Object.freeze([]) }),
  Object.freeze({ id: 'prepMovers', label: 'My movers', search: '[my movers]', settings: Object.freeze([]) }),
  Object.freeze({ id: 'prepLevels', label: 'Key levels from my plans', search: '[key levels from my plans]', settings: Object.freeze([]) }),
  Object.freeze({ id: 'tradeReview', label: 'Post-trade review', search: '[post-trade review]', settings: Object.freeze([]) }),
  Object.freeze({
    id: 'marketcontext',
    label: 'Market context',
    settings: Object.freeze([
      Object.freeze({ key: 'fields', label: 'Show', options: Object.freeze(['all', 'regime', 'indexes']), default: 'all',
        optionLabels: Object.freeze({ all: 'Everything', regime: 'Regime, exposure and breadth', indexes: 'SPY, QQQ and VIX' }) }),
    ]),
  }),
  // Tier 2 part B: the Reminder, an unticked task "Follow up by <date>" N trading days after the note is
  // made. NOT a widget (no `search`); created once, never re-added by Update layout.
  Object.freeze({
    id: 'reminder',
    label: 'Reminder',
    settings: Object.freeze([
      Object.freeze({ key: 'days', label: 'Follow up after', options: Object.freeze(['1', '2', '3', '5', '10']), default: '5',
        optionLabels: Object.freeze({ 1: '1 trading day', 2: '2 trading days', 3: '3 trading days', 5: '5 trading days', 10: '10 trading days' }) }),
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

/** The node's searchText for a block id (the server builder writes the same line). */
export function blockSearch(id) {
  return BLOCK_KINDS.find((b) => b.id === id)?.search || null
}

/** The word a style setting's option shows in the editor. */
export function optionWord(setting, option) {
  return setting?.optionLabels?.[option] ?? tfWord(option)
}
