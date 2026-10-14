// B5/N4: the ONE rule for the price and change a member sees for a stock. The list row, the chart
// pane's header and the why strip all read it, so they can never disagree.
//
// A live price comes with its own change. The snapshot's change belongs to the snapshot's close,
// so it is never shown beside a live price (two different moments in one pair); a live price
// without a change shows no change. A stock that did not trade (vol_ratio 0) shows no change.
export function livePriceOf(row, live) {
  const hasLive = Number.isFinite(live?.price)
  const liveChg = Number.isFinite(live?.change_pct) ? live.change_pct : null
  const price = hasLive ? live.price : row?.price
  const chg = row?.vol_ratio === 0 ? null : liveChg ?? (hasLive ? null : row?.chg_pct_1d)
  return { price, chg, live: hasLive }
}
