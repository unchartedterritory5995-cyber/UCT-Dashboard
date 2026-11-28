import { createContext, useContext } from 'react'

// "Widgets match the chart" (owner 11-27): what a widget's ⚙ panel needs to show the
// "Match the chart" boxes. WidgetHost provides it for the widget it wraps; null off the
// Charts workspace (no boxes there).
//
// Shape: { type, ownLook: boolean, setOwnLook(bool) }
export const WidgetLookContext = createContext(null)

export function useWidgetLook() {
  return useContext(WidgetLookContext)
}
