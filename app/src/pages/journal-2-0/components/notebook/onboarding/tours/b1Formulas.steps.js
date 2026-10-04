// Tour `formulas-rollups` (wave 14, W14-B1). Data only: see ./index.js for the contract.
// Screen: an open note's properties. `properties-add-empty` and `properties-add` are the
// two branches of the one Add property button (a note with no properties, and one with
// some), so exactly one of the first two steps shows. `computed-value` and
// `computed-edit` show once the note has a formula or rollup property.
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })
const PROPS = 'components/notebook/PropertiesSection.jsx'

const INTRO = 'Add property, then choose Formula or Rollup as its type. Both are worked out for you and cannot be typed over.'

export const STEPS = Object.freeze([
  step('add-first', 'properties-add-empty', PROPS),
  step('add', 'properties-add', PROPS),
  step('formula', 'computed-value', PROPS),
  step('edit', 'computed-edit', PROPS),
  step('rollup', 'properties-add', PROPS),
])

export const COPY = Object.freeze({
  'add-first': { title: 'Numbers that work themselves out', body: INTRO },
  add: { title: 'Numbers that work themselves out', body: INTRO },
  formula: {
    title: 'A formula',
    body: "A formula computes a value from this note's number properties, such as risk per share from Entry and Stop. It updates when they change.",
  },
  edit: {
    title: 'See or change the formula',
    body: 'Edit shows the formula. One that would refer back to itself is refused when you save, with the names in the loop.',
  },
  rollup: {
    title: 'A rollup',
    body: 'A rollup counts, sums or averages one property, or finds its min, max or win rate, across linked notes, a saved view, or the trades linked to this note.',
  },
})
