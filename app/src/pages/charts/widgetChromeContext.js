import { createContext } from 'react'

// T3 integrated chart header (/charts board only).
//
// A /charts chart widget no longer draws its own header bar: its identity row (logo,
// ticker, day change, session toggle, clock) becomes the widget's title bar and hosts the
// widget chrome — the link-colour dot on the left, the window controls on the right — and
// doubles as the drag handle. WidgetHost provides this context ONLY when it is rendering
// that integrated chart; everywhere else (popups, screener, mobile, floating panels,
// merged boards, multi-tab slots) it is null and the chart renders exactly as before.
//
// Shape: { left: ReactNode, right: ReactNode, dragHandleClass: string }
export const WidgetChromeContext = createContext(null)
