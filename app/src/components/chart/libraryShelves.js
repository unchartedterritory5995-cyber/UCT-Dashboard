// app/src/components/chart/libraryShelves.js
//
// THE LISTS OF THE INDICATOR LIBRARY SHEET, AS ONE CHOICE (Studio plan H2; owner decision
// 2026-11-17, mock-up B: "one dropdown").
//
// The library sheet is the indicators surface on a phone and a tablet. It listed everything in
// one column and opened UCT's and Members' indicators as their own views, each with a way back.
// Moving from one list to another meant going back first, and nothing said how much each held.
// The sheet now has ONE control, "Showing", that names every list with its count.
//
// This file is the list of lists and the rule for which row sits on which. Pure: the sheet owns
// the control and the rows.
//
//   all        every indicator the catalogue offers (the sheet's old single column)
//   on         what is on this chart, shown or hidden
//   mine       the member's own indicators
//   house      UCT's indicators (their own list component; counted by it, not here)
//   members    indicators other members published (fetched only when chosen)
//   cat:<name> one catalogue heading, in the catalogue's own order

export const SHELF_ALL = 'all'
export const SHELF_ON = 'on'
export const SHELF_MINE = 'mine'
export const SHELF_HOUSE = 'house'
export const SHELF_MEMBERS = 'members'
const CATEGORY_PREFIX = 'cat:'

/** The shelf of one catalogue heading. */
export const categoryShelf = (category) => `${CATEGORY_PREFIX}${category}`
/** The heading a shelf names, or null when it is not a heading's shelf. */
export const categoryOf = (shelf) => (
  typeof shelf === 'string' && shelf.startsWith(CATEGORY_PREFIX) ? shelf.slice(CATEGORY_PREFIX.length) : null
)
/** The two shelves that are their own list component rather than catalogue rows. */
export const isListShelf = (shelf) => shelf === SHELF_HOUSE || shelf === SHELF_MEMBERS

/** Does catalogue `row` sit on `shelf`? `isOn(row)` answers "is it on this chart". */
export function shelfHolds(shelf, row, isOn) {
  if (!row) return false
  if (shelf === SHELF_ALL) return true
  if (shelf === SHELF_ON) return !!isOn(row)
  if (shelf === SHELF_MINE) return row.userDefined === true
  const category = categoryOf(shelf)
  // a heading's shelf holds the catalogue's own rows; the member's work has its own shelf
  return category !== null && row.category === category && row.userDefined !== true
}

/**
 * The choices, in order. `rows` are the catalogue's rows BEFORE any search (a count is how much
 * the list holds, not how much of it matches what is typed); `categories` are the headings in
 * the catalogue's order.
 * @returns {{value: string, label: string, count: number|null}[]}
 */
export function shelfOptions({ rows = [], categories = [], isOn = () => false } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const count = (shelf) => list.filter((r) => shelfHolds(shelf, r, isOn)).length
  const out = [
    { value: SHELF_ALL, label: 'All indicators', count: list.length },
    { value: SHELF_ON, label: 'On this chart', count: count(SHELF_ON) },
    { value: SHELF_MINE, label: 'Your indicators', count: count(SHELF_MINE) },
    { value: SHELF_HOUSE, label: 'UCT indicators', count: null },
    { value: SHELF_MEMBERS, label: "Members' indicators", count: null },
  ]
  for (const c of Array.isArray(categories) ? categories : []) {
    const n = count(categoryShelf(c))
    // a heading that holds only the member's own rows is the "Your indicators" shelf already
    if (n > 0) out.push({ value: categoryShelf(c), label: c, count: n })
  }
  return out
}

/** What one choice reads in the control: its name and, when it is known here, how many. */
export const optionText = (option) => (
  option.count === null || option.count === undefined ? option.label : `${option.label} (${option.count})`
)

/** A shelf that is not among today's choices (a heading that has gone) falls back to everything. */
export function validShelf(shelf, options) {
  return (Array.isArray(options) && options.some((o) => o.value === shelf)) ? shelf : SHELF_ALL
}

/** The sentence for a shelf that holds nothing, before anything is typed. */
export function emptyShelfText(shelf) {
  if (shelf === SHELF_ON) return 'Nothing is on this chart yet. Choose "All indicators" to add one.'
  if (shelf === SHELF_MINE) return 'You have not made an indicator yet. "Describe an indicator" above is the quickest way to start.'
  return 'Nothing here yet.'
}
