// A /charts panel's way of saying "my first content is up, the next queued panel may start".
// The workspace's mount queue owns the slot; only the chart panel has a ready signal to give
// (StockChart's first-bars latch, once per mount), so ChartWidget is the only reader. Outside
// the main board this is null and a panel reports to nobody.
import { createContext } from 'react'

export const PanelSlotContext = createContext(null)
