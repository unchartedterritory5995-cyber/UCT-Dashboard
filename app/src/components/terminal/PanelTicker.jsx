// UCT Terminal — a ticker that behaves like a terminal name INSIDE a panel and like the app's
// ticker chip everywhere else (wave 3 #3). Pages that are also terminal panels (CATH, FREC, the
// catalyst table, UCT20) show their tickers through `TickerPopup`, whose click opens a chart
// modal. Inside a terminal panel the same click should load the name into the linked panels,
// exactly as typing its row number does, so it renders `PanelSymbol` there instead.
//
// Deliberately NOT in the `components/terminal` barrel: it imports `TickerPopup`, which is heavy,
// and the barrel is imported by every panel. Import it from this path.
import TickerPopup from '../TickerPopup'
import PanelSymbol from './PanelSymbol'
import { usePanelRun } from './terminalPanel'

export default function PanelTicker({ sym, children = null, ...popupProps }) {
  const run = usePanelRun()
  if (run) return <PanelSymbol sym={sym}>{children}</PanelSymbol>
  return <TickerPopup sym={sym} {...popupProps}>{children}</TickerPopup>
}
