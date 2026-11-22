// app/src/components/chart/builder/windowTitle.js
//
// WHAT THE BUILDER WINDOW IS CALLED, BY WHERE IT OPENS (owner decision 2026-11-17, backlog 49).
//
// One window builds two things. From a chart the member pressed "Create indicator", and the
// window used to answer "New formula": two words for one thing. From the Screener the same
// window builds a scan's formula, and "formula" is the right word there.
//
// So the mount says which (`<BuilderSheet noun="indicator">` on the chart; nothing, meaning
// "formula", everywhere else), and only the title and the footer's start-over button read it.
// Its own small file so a naming rail can import it without loading the whole window.

/** The window's title. `noun` is 'indicator' from a chart; anything else is 'formula'. */
export function windowTitle(noun, editing) {
  if (noun === 'indicator') return editing ? 'Edit indicator' : 'Create indicator'
  return editing ? 'Edit formula' : 'New formula'
}

/** The footer's "start a new one" button while a saved one is open, in the same word. */
export function startOverLabel(noun) {
  return noun === 'indicator' ? 'New indicator' : 'New formula'
}
