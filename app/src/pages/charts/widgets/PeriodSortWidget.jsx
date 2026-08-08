// Period-Sort widget — the docked/tabbed form of Custom-Period Sort. Renders the real
// scanner/watchlist table (PeriodSortResults) for the [start, end] range stored in
// opts.{start,end}, so it has every watchlist feature. Standard widget chrome (header,
// drag, color, pop-out, close) comes from WidgetHost/WidgetHeader.
import { useState } from 'react'
import PeriodSortResults from './PeriodSortResults'

const ymdOf = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()

export default function PeriodSortWidget({ color, opts = {}, onOptsChange }) {
  // Default range (last ~30 days) if the widget was added without a selection.
  const [seed] = useState(() => {
    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 30)
    return { start: ymdOf(start), end: ymdOf(end) }
  })
  const start = opts.start || seed.start
  const end = opts.end || seed.end

  const settingsOverride = opts?.settings || null
  const persistSettings = (next) => onOptsChange?.({ ...opts, settings: next })

  return (
    <PeriodSortResults
      start={start}
      end={end}
      color={color}
      settingsOverride={settingsOverride}
      onSettingsPersist={persistSettings}
    />
  )
}
