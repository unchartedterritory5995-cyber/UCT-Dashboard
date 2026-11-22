// One result row on the scan board (boardModel.js), in the board's row styles. The same listbox-option contract
// as ResultRow / RsResultRow (id, role, aria-selected, data-index, the click), so selection,
// the arrow keys and the hub cursor work unchanged.
//   line     # · logo · SYMBOL · setup · (mini chart) · RS · % chg · price
//   compact  logo · SYMBOL · % chg · price                       (a watchlist row)
//   cards    a roomy two-line card with a mini chart
//   chips    SYMBOL + % chg, laid in a horizontal strip
import { memo } from 'react'
import Sparkline from '../../../../components/Sparkline'
import CompanyLogo from '../../../../components/CompanyLogo'
import { fmtPrice, fmtChg } from '../rowNumbers'
import focus from '../FocusScreener.module.css'
import s from './Board.module.css'

const chgClass = chg => (chg > 0 ? focus.up : chg < 0 ? focus.down : focus.flat)

export function BoardCols({ mode, hasPlace, logos, spark }) {
  if (mode === 'line') {
    return (
      <div className={`${s.cols} ${s.rLine}`} aria-hidden="true">
        <span className={s.cRadar} />{hasPlace && <span className={s.cPlace} />}{logos && <span className={s.cLogo} />}
        <span className={s.cTicker}>Symbol</span><span className={s.cSetup}>Setup</span>{spark && <span className={s.cSpark} />}
        <span className={s.cRs}>RS</span><span className={s.cChg}>% Chg</span><span className={s.cPrice}>Price</span>
      </div>
    )
  }
  if (mode === 'compact') {
    return (
      <div className={`${s.cols} ${s.rCompact}`} aria-hidden="true">
        <span className={s.cRadar} />{logos && <span className={s.cLogo} />}
        <span className={s.cTickerGrow}>Symbol</span><span className={s.cChg}>% Chg</span><span className={s.cPrice}>Price</span>
      </div>
    )
  }
  return null
}

const BoardRow = memo(function BoardRow({ r, i, sel, price, chg, onRadar, onSelect, hubProps, mode, caption, tag, place, hasPlace, leadValue = null, leadTop = false, spark, logos, showSpark, seen }) {
  const lead = leadValue != null ? { value: leadValue, top: leadTop } : null
  const base = {
    id: `focus-opt-${r.ticker}`, role: 'option', 'aria-selected': sel, 'data-index': i, 'data-testid': `focus-row-${r.ticker}`,
    'data-seen': seen && !sel ? '' : undefined, onClick: () => onSelect(i), ...(hubProps || {}),
  }
  const radar = <span className={`${onRadar ? focus.dotOn : focus.dotOff} ${s.cRadar}`} {...(onRadar ? { 'aria-label': 'On your radar', role: 'img' } : { 'aria-hidden': true })} />
  const logo = logos ? <span className={s.cLogo}><CompanyLogo sym={r.ticker} size={mode === 'cards' ? 26 : 18} round loading="lazy" /></span> : null
  const sparkEl = (w, h) => <span className={s.cSpark} title="Last 3 months, daily closes">{spark && spark.length > 1 && <Sparkline values={spark} width={w} height={h} fill={false} />}</span>
  const short = (caption || '').split(' · ')[0]
  const rs = lead ? <span className={`${s.cRs} ${lead.top ? s.rsTop : ''}`}><span className="sr-only">, RS Rating </span>{lead.value}</span> : <span className={s.cRs} />
  const selCls = sel ? s.rowSel : ''

  if (mode === 'chips') {
    return (
      <div {...base} className={`${s.chip} ${selCls}`}>
        {logo}<span className={s.chipTicker}>{r.ticker}</span><span className={`${s.chipChg} ${chgClass(chg)}`}>{fmtChg(chg)}</span>
      </div>
    )
  }
  if (mode === 'cards') {
    return (
      <div {...base} className={`${s.cardRow} ${selCls}`}>
        <div className={s.cardTop}>
          {logo}
          <span className={s.cardName}><span className={s.cardTicker}>{r.ticker}</span>{r.company && <span className={s.cardCompany}>{r.company}</span>}</span>
          {sparkEl(72, 26)}
          <span className={s.cardNums}><span className={s.cardPrice}>{fmtPrice(price)}</span><span className={chgClass(chg)}>{fmtChg(chg)}</span></span>
        </div>
        <div className={s.cardBottom}>
          <span className={s.cardSetup}>{short || '—'}</span>
          {caption && caption.includes(' · ') && <span className={s.cardGroup}>{caption.split(' · ').slice(1).join(' · ')}</span>}
          <span className={s.cardSpacer} />
          {tag && <span className={s.softTag}>{tag}</span>}
          {lead && <span className={`${s.softTag} ${lead.top ? s.rsTop : ''}`}>RS {lead.value}</span>}
        </div>
      </div>
    )
  }
  if (mode === 'compact') {
    return (
      <div {...base} className={`${s.row} ${s.rCompact} ${selCls}`}>
        {radar}{logo}<span className={s.cTickerGrow}>{r.ticker}</span>
        <span className={`${s.cChg} ${chgClass(chg)}`}>{fmtChg(chg)}</span><span className={s.cPrice}>{fmtPrice(price)}</span>
      </div>
    )
  }
  return (
    <div {...base} className={`${s.row} ${s.rLine} ${selCls}`}>
      {radar}{hasPlace && <span className={s.cPlace}>{place != null ? place.toLocaleString('en-US') : ''}</span>}{logo}
      <span className={s.cTicker}>{r.ticker}</span>
      <span className={s.cSetup} title={caption || undefined}>{short}{tag && <span className={s.softTag}>{tag}</span>}</span>
      {showSpark && sparkEl(48, 16)}
      {rs}<span className={`${s.cChg} ${chgClass(chg)}`}>{fmtChg(chg)}</span><span className={s.cPrice}>{fmtPrice(price)}</span>
    </div>
  )
})
export default BoardRow
