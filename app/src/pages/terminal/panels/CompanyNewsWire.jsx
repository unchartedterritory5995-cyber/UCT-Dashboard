// CN: the news wire's headlines for the stock, as their OWN labelled block above CN's own list.
//
// CN's list is FMP company news and press releases; this block is UCT News (powered by Trade
// Exchange). They are two sources and stay two lists: this block has its own heading, each of
// its rows carries the "UCT News" source label, and CN's rows keep their publisher labels. The
// two are never merged or re-ordered into one list.
//
// Loaded lazily by the CN tab (pages/research/tabs/NewsTab.jsx) and only inside a Terminal
// panel, so the research page downloads none of it. One numbered row opens the full history
// (`NVDA UCN`) beside CN: its number is typed on the command line (`usePanelRows`), and the
// same row is a button (`PanelCommand`).
import PanelCommand from '../../../components/terminal/PanelCommand'
import { usePanelRows } from '../../../components/terminal/terminalPanel'
import StockWire from './StockWire'
import useStockWire from './useStockWire'
import { WIRE_ROWS, wireStockCommand } from './wireInPanelsModel'
import css from './wireInPanels.module.css'

export default function CompanyNewsWire({ sym, cardClassName = '', titleClassName = '' }) {
  const wire = useStockWire(sym, WIRE_ROWS.CN)
  const cmd = wire.phase === 'off' || wire.phase === 'idle' ? '' : wireStockCommand(wire.sym)
  usePanelRows(cmd ? [cmd] : [])
  if (wire.phase === 'idle') return null
  return (
    <section className={cardClassName} data-testid="news-wire">
      <div className={titleClassName} data-testid="news-wire-title">News wire</div>
      <StockWire sym={wire.sym} wire={wire} testId="news-wire-body">
        {cmd ? (
          <p className={css.more} data-testid="news-wire-more">
            <span className={css.num} aria-hidden="true">1</span>
            <PanelCommand cmd={cmd} label={`Open the full news wire history for ${wire.sym}`}>{cmd}</PanelCommand>
            <span className={css.moreWords}>the full news wire history for {wire.sym}, live</span>
          </p>
        ) : null}
      </StockWire>
    </section>
  )
}
