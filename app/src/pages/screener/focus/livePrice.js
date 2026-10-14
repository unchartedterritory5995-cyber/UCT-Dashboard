// B5/N4: the ONE rule for the price and change a member sees for a stock. The list row, the chart
// pane's header and the why strip all read it, so they can never disagree.
//
// Price and change are ONE pair from ONE moment. With a live price, both are live (a live price
// without a change shows no change). Without one, both are the snapshot's: a live change that
// arrived without a price is never paired with the snapshot price. A stock that did not trade
// (vol_ratio 0) shows no change.
export function livePriceOf(row, live) {
  const hasLive = Number.isFinite(live?.price)
  const liveChg = Number.isFinite(live?.change_pct) ? live.change_pct : null
  const price = hasLive ? live.price : row?.price
  const chg = row?.vol_ratio === 0 ? null : hasLive ? liveChg : row?.chg_pct_1d
  return { price, chg, live: hasLive }
}
