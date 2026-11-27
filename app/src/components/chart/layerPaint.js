// app/src/components/chart/layerPaint.js
//
// ⭐ (2026-11-27, review of #2922, F3) A CHART REPORTS WHAT IT COMMITTED. The double buffer (useDoubleBuffer.js) shows a
// hidden pane only when that pane's chart has PROVED it holds the bars the store would give it now. StockChart calls
// the function this context provides after every `updateChart` pass, with `{ sym, tf, ext, bars }`: the symbol, its
// resolved timeframe and session, and the very bars array it handed the library in that pass. No provider (every chart
// outside a double-buffered widget): nothing is called. A leaf: StockChart imports it.
import { createContext } from 'react'

export const LayerPaintContext = createContext(null)
