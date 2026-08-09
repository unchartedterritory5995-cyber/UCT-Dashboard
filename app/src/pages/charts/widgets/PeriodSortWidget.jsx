// Period-Sort widget — the docked/tabbed form of Custom-Period Sort. Renders the real
// scanner/watchlist table (PeriodSortResults) for the [start, end] range stored in
// opts.{start,end}, so it has every watchlist feature. Standard widget chrome (header,
// drag, color, pop-out, close) comes from WidgetHost/WidgetHeader.
import { useState } from 'react'
import PeriodSortResults from './PeriodSortResults'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import { WATCHLIST_SETTINGS_KEY } from '../../watchlist/watchlistSettings'

const ymdOf = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()

export default function PeriodSortWidget({ color, opts = {}, onOptsChange }) {
  // Default range (last ~30 days) if the widget was added without a selection.
  const [seed] = useState(() => {
    const end = new Date(); const start = new Date(); start.setDate(start.getDate() - 30)
    return { start: ymdOf(start), end: ymdOf(end) }
  })
  const start = opts.start || seed.start
  const end = opts.end || seed.end

  // Appearance: the widget's OWN saved settings if it has them, otherwise fall back to the
  // user's global watchlist template (up/down colors, canvas, fonts) so a freshly-docked
  // widget looks like the floating panel. Passing this as settingsOverride (NOT opts.settings)
  // leaves opts.settings empty, so WidgetHost keeps themeFollow ON — the header/border still
  // auto-adjusts to the light/dark theme. Once the user edits THIS widget, it persists to
  // opts.settings and diverges.
  const { prefs } = usePreferences()
  const globalTemplate = parsePref(prefs?.[WATCHLIST_SETTINGS_KEY], null)
  const settingsOverride = opts?.settings || globalTemplate || null
  const persistSettings = (next) => onOptsChange?.({ ...opts, settings: next })

  return (
    <PeriodSortResults
      start={start}
      end={end}
      color={color}
      group={opts.group || null}
      settingsOverride={settingsOverride}
      onSettingsPersist={persistSettings}
    />
  )
}
