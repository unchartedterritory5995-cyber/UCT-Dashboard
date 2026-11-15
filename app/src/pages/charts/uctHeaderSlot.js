import { createContext, useContext, useLayoutEffect } from 'react'

// UCT frame (owner 11-13): two places in the frame's title row a widget can draw into.
//  · row      — its top row (tabs, New) beside the icon when the widget is wide enough: the
//               chart's one-row header. null when narrow → render the row where it was.
//  · controls — the start of the window-control group, for its settings gear (gear · + ·
//               float · pop out · close, as on the chart). null outside the UCT frame.
// Widgets portal into these (createPortal), so their React tree, handlers and state stay put.
export const UctHeaderSlotContext = createContext({ row: null, controls: null, claim: null })
// `key` names WHICH row this is (the list picker's tabs vs an open list's name): the frame
// remembers the width each one needs, so switching views re-checks the fit for that view.
export function useUctHeaderSlot(key = 'row') {
  const ctx = useContext(UctHeaderSlotContext)
  const claim = ctx.claim
  useLayoutEffect(() => { claim?.(key) }, [claim, key])
  return ctx.row
}
export const useUctControlsSlot = () => useContext(UctHeaderSlotContext).controls
// true when the title row handed out is the TABBED slot's own row under the header (owner 11-14):
// the tab already names the widget, so a widget may skip a plain title there.
export const useUctRowIsSub = () => !!useContext(UctHeaderSlotContext).rowIsSub
// The title row at ANY width (the widget fits its row itself, e.g. the Theme Tracker folds
// some periods into a ▾ when narrow). null outside the UCT frame.
export function useUctHeaderSlotAlways(key = 'row') {
  const ctx = useContext(UctHeaderSlotContext)
  const claim = ctx.claim
  useLayoutEffect(() => { claim?.(key) }, [claim, key])
  return ctx.rowAlways ?? null
}

// Below this width the title row keeps just the icon + window controls (two rows).
export const UCT_ONE_ROW_MIN_W = 240

// Widgets whose header shows the icon alone, no name (owner 11-13: the Watchlist's star says
// it; Scanner shares its header). The name stays in the DOM for screen readers.
// Theme Tracker too (owner 11-13: its periods take the title row).
// Notebook too (owner 11-14: its title row says "Notebook", or the open note's path).
export const UCT_ICON_ONLY_TITLE = Object.freeze(['watchlist', 'scanner', 'themes', 'tradeExchangeNews', 'notebook', 'calendar'])
