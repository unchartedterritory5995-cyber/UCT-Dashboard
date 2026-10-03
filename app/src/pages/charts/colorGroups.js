// COV-10 remainder — /charts colour groups beyond the four A-D.
//
// ONE authority for which colour groups exist and what a stored colour means.
// Before this, `['A','B','C','D','N']` was retyped in WidgetHeader, PeriodSortPanel,
// EtfHoldingsPanel and ChartWidget's tab cycle.
//
// Dark behind CHARTS_EXTRA_GROUPS_ENABLED (auth key `charts_extra_groups_enabled`,
// read by useExtraGroupsEnabled). The group KEY was already open-ended — groupSyms
// spreads whatever is stored, and a list-ref channel id is `list-ref:<colour>` — so
// a fifth group needs no new state, only a cycle that offers it and a dot that
// shows it.
//
// ⛔ OFF, THE BOARD IS BYTE-IDENTICAL: the cycle is A B C D N, exactly as before.
// ⛔ A STORED E-H WHILE OFF IS NEVER REMAPPED OR DROPPED. The layout keeps the
//    colour; the widget behaves as NOT LINKED (its own per-widget key, like N), and
//    its dot says so in words. Before this module such a widget silently became a
//    fifth, unnamed, uncoloured group (groupSyms['E']), which was neither honest nor
//    the member's choice. Switching the flag back on restores the group untouched.

export const BASE_GROUPS = Object.freeze(['A', 'B', 'C', 'D'])
export const EXTRA_GROUPS = Object.freeze(['E', 'F', 'G', 'H'])
export const NOT_LINKED = 'N'

// Dot colours for the inline-styled dots (tab strip, Period-Sort / ETF-holdings panels).
// A-D and N are the values those three files each typed before; the header dot uses
// the matching .colorDot* classes in ChartsWorkspace.module.css.
export const GROUP_HEX = Object.freeze({
  A: '#c9a84c', B: '#60a5fa', C: '#4ade80', D: '#c084fc',
  E: '#f87171', F: '#2dd4bf', G: '#fb923c', H: '#f472b6',
  N: '#6b7280',
})

export function isExtraGroup(c) {
  return EXTRA_GROUPS.includes(c)
}

/** The linkable groups a member may pick, in cycle order (N excluded). */
export function linkGroups(extraOn) {
  return extraOn === true ? [...BASE_GROUPS, ...EXTRA_GROUPS] : [...BASE_GROUPS]
}

/** The dot's click cycle: the linkable groups, then N (not linked). */
export function groupCycle(extraOn) {
  return [...linkGroups(extraOn), NOT_LINKED]
}

/** Next colour in a cycle. A colour not in the cycle (e.g. a stored E while off)
 *  advances to the first entry, so a click always lands on a real choice. */
export function nextInCycle(color, cycle) {
  const i = cycle.indexOf(color)
  return cycle[(i + 1) % cycle.length]
}

export function nextGroup(color, extraOn, { includeNone = true } = {}) {
  return nextInCycle(color, includeNone ? groupCycle(extraOn) : linkGroups(extraOn))
}

/** What a STORED colour means right now. An extra group while the flag is off reads
 *  as not linked; everything else is itself. Never rewrites what is stored. */
export function effectiveGroup(color, extraOn) {
  if (isExtraGroup(color) && extraOn !== true) return NOT_LINKED
  return color
}

/** True when a stored colour is an extra group that the flag is currently hiding. */
export function isSuspendedGroup(color, extraOn) {
  return isExtraGroup(color) && extraOn !== true
}
