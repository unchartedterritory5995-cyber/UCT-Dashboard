import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import ThemeTrackerPage from '../../ThemeTrackerPage'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'
import { KIND, channelFor, listRefCtx, usePublish } from '../../../lib/context/contextChannels'
import useListSubscribeEnabled from '../useListSubscribeEnabled'

export default function ThemesWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym, groupTfs, activeWatchlistRef } = useWorkspace()
  const listSubscribeEnabled = useListSubscribeEnabled()
  // Scoped context: routes the wrapped ThemeTrackerPage's useChartsSym calls
  // into THIS widget's color group, not Group A. `tf` is the timeframe the
  // chart in this group is showing — the tracker's own chart panel is hidden
  // when embedded, so this is the only way it can warm the right cache key.
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym: (s) => setGroupSym(color, s),
    tf: groupTfs?.[color],
  }), [groupSyms, groupTfs, color, setGroupSym])

  // Share the SAME active-nav ref the Watchlist widgets use, so clicking into a
  // theme tracker locks arrow-key scanning here (and out of the watchlist) — and
  // vice versa. Stable per-widget key.
  const widgetIdRef = useRef(null)
  if (!widgetIdRef.current) widgetIdRef.current = `th${Math.random().toString(36).slice(2, 9)}`

  // COV-10 follow-up — publish the OPEN taxonomy theme on this colour group's `list-ref`
  // channel, so a same-group Watchlist widget can TRACK or FREEZE its holdings (resolved
  // server-side through theme_db, owner + engine overlay). Publish-only. Dark behind the
  // board's `listSubscribeEnabled`: off => the tracker gets no callback and nothing is
  // published, exactly the pre-COV-10 widget. No open theme (or a custom one) => clear.
  const pubId = useId()
  const listSubOn = listSubscribeEnabled === true
  const themeChannel = listSubOn && color ? channelFor(KIND.LIST_REF, color) : null
  const { publish, clear } = usePublish(themeChannel, `ThemesWidget#${pubId}`)
  const [openTheme, setOpenTheme] = useState(null)
  const onOpenThemeChange = useCallback((t) => setOpenTheme(t), [])
  useEffect(() => {
    if (!themeChannel) return
    if (openTheme?.id) publish(listRefCtx({ source: 'theme', value: openTheme.id, label: openTheme.name || openTheme.id }))
    else clear()
  }, [themeChannel, openTheme, publish, clear])
  useEffect(() => () => { clear() }, [clear])

  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <ThemeTrackerPage embedded activeRef={activeWatchlistRef} widgetKey={widgetIdRef.current}
        opts={opts} onOptsChange={onOptsChange}
        onOpenThemeChange={listSubOn ? onOpenThemeChange : null} />
    </ChartsSymContext.Provider>
  )
}
