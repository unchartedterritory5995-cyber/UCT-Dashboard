import { useMemo, useCallback, useEffect, useId, lazy } from 'react'
import Watchlists from '../../Watchlists'
import WatchlistPicker from './WatchlistPicker'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'
import { ALIAS_PREFIX } from '../../watchlist/communityPick'
import { KIND, channelFor, listRefCtx, usePublish, useChannel } from '../../../lib/context/contextChannels'
import { SubscribeOffer, SubscribedList, ScreenSourceOffer, SUBSCRIBABLE_SOURCES } from './ListSubscription'

// Default column layout for a prebuilt (curated UCT) list. Prebuilt lists ALWAYS open in
// their default columns and NEVER persist edits (ephemeralCols) — a curated list is a fixed
// view, so any in-session column change is discarded when you leave and reopen it. Per-list
// overrides here; everything else falls back to PREBUILT_COL_FALLBACK.
const PREBUILT_COL_DEFAULTS = {}
const PREBUILT_COL_FALLBACK = { order: ['flag', 'sym', 'chg', 'price', 'dolvol'] }

// AD-HOC SOURCES. A watchlist widget normally scopes to a SAVED list (`opts.watchKey`).
// A host can instead hand it membership it computed itself — today that is the breadth
// drill, whose list is one cell of the breadth monitor and exists only while the modal
// is open. Lazy so the /charts bundle never pulls breadth code unless such a widget is
// actually mounted (WidgetHost already provides the Suspense boundary).
//
// ⛔ `opts` carries only the SOURCE TAG. The symbols and their per-row meta ride a
// context, because opts is persisted into a layout blob and a 134-row payload has no
// business there.
// COV-10 — the picker sits under the subscribe offer in a column; the picker keeps the rest.
const OFFER_WRAP = { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }
const OFFER_BODY = { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }

const SOURCE_WIDGETS = {
  breadthDrill: lazy(() => import('../../breadth/drill/BreadthDrillList')),
}

/**
 * TERM-079 — the list this widget shows, as a `list-ref` in the universe vocabulary the
 * Market Map resolves (`/api/scatter/data?source=&value=`), or null when that endpoint
 * cannot resolve it. ⛔ null is published as a CLEAR, never as a guess: a follower left
 * on a stale list would plot the wrong universe with a confident label.
 *   'flagged'            → flagged
 *   'user:<id>'          → watchlist <id>   (the member's own list)
 *   'community:<id>'     → watchlist <id>   (a public list; the endpoint admits is_public)
 *   'tag:<color>'        → tag <color>
 *   'community:alias:…'  → null (resolved client-side to the newest issue; no stable id)
 */
export function watchKeyToListRef(watchKey, watchName) {
  if (typeof watchKey !== 'string' || !watchKey) return null
  const label = watchName || null
  if (watchKey === 'flagged') return listRefCtx({ source: 'flagged', value: '', label })
  if (watchKey.startsWith(ALIAS_PREFIX)) return null
  const m = /^(user|community|tag):(.+)$/.exec(watchKey)
  if (!m) return null
  return listRefCtx({ source: m[1] === 'tag' ? 'tag' : 'watchlist', value: m[2], label })
}

export default function WatchlistWidget({ color, opts, onOptsChange }) {
  const { groupSyms, setGroupSym, groupTfs, activeWatchlistRef, listSubscribeEnabled } = useWorkspace()
  // Stable id so this widget can claim "active" (owns arrow keys + its own scroll).
  const widgetId = useId()
  // Scoped context: routes the wrapped Watchlists' useChartsSym calls
  // into THIS widget's color group, not Group A. setSym is a STABLE callback (not
  // re-created when groupSyms changes) so the memoized watchlist rows' select handler
  // stays stable across selection changes.
  const setSym = useCallback((s) => setGroupSym(color, s), [color, setGroupSym])
  // `tf` = the timeframe this group's chart is on, so the wrapped list warms
  // the cache key that chart actually reads (see ThemeTrackerPage's warmTf note).
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym,
    tf: groupTfs?.[color],
  }), [groupSyms, groupTfs, color, setSym])

  const watchKey = opts?.watchKey || null

  // TERM-079 — publish the list this widget shows on its colour group's `list-ref`
  // channel, so a following Market Map in the same group plots it. Publish-only: this
  // widget reads no channel, so a publish anywhere never re-renders it. An ad-hoc
  // source (breadth drill) has no saved list and publishes nothing.
  const listChannel = color ? channelFor(KIND.LIST_REF, color) : null
  const { publish: publishList, clear: clearList } = usePublish(listChannel, `WatchlistWidget#${widgetId}`)
  const listRef = useMemo(
    () => (opts?.source ? null : watchKeyToListRef(watchKey, opts?.watchName)),
    [opts?.source, watchKey, opts?.watchName],
  )
  useEffect(() => {
    if (!listChannel) return   // no colour group (a host that places it bare) — nothing to link
    if (listRef) publishList(listRef)
    else clearList()
  }, [listChannel, listRef, publishList, clearList])
  // On unmount (or a colour change, which re-keys clearList) give the channel up —
  // clear() is a no-op if another panel has published since.
  useEffect(() => () => { clearList() }, [clearList])

  // COV-10 — SUBSCRIBE to a list this colour group publishes that this widget cannot
  // pick itself (a Scanner widget's scan, a Themes widget's open theme, or one of the
  // member's saved screens offered right here), as a FROZEN copy or a TRACKING list,
  // chosen at import. Dark behind the board's `listSubscribeEnabled`: off => `listSub`
  // is ignored and the channel is never read, so the widget is exactly what it was.
  // The channel is read ONLY while the picker is showing (nothing chosen yet), so a
  // publish anywhere never re-renders a widget that already shows a list.
  const subOn = listSubscribeEnabled === true
  const listSub = subOn && opts?.listSub && typeof opts.listSub === 'object' ? opts.listSub : null
  const offerable = subOn && !!listChannel && !watchKey && !listSub && !opts?.source
  const groupList = useChannel(offerable ? listChannel : null)
  const offered = groupList && SUBSCRIBABLE_SOURCES.includes(groupList.source) ? groupList : null
  const subscribe = useCallback((sub) => {
    onOptsChange?.({ ...(opts || {}), listSub: sub })
  }, [opts, onOptsChange])
  const unsubscribe = useCallback(() => {
    onOptsChange?.({ ...(opts || {}), listSub: null })
  }, [opts, onOptsChange])
  const pick = useCallback((sel) => {
    // Creating a list from a saved look Template seeds the widget's appearance
    // (opts.settings) only — a template never controls the column layout. `watchTab` is
    // the picker tab it came from, so leaving reopens on it + we know if it's prebuilt.
    const next = { ...(opts || {}), watchKey: sel?.key || null, watchName: sel?.name || null, watchTab: sel?.tab || null }
    if (sel?.settings) next.settings = sel.settings
    onOptsChange?.(next)
  }, [opts, onOptsChange])
  const exitPick = useCallback(() => {
    // Keep watchTab so the picker reopens on the section the user was in.
    onOptsChange?.({ ...(opts || {}), watchKey: null, watchName: null })
  }, [opts, onOptsChange])

  // Per-widget appearance settings: this widget's own blob (null = inherit the
  // global default until edited). Persisting writes it into THIS widget's opts,
  // so changing one watchlist's canvas/colors never touches another.
  const wlSettingsOverride = opts?.settings || null
  const persistWlSettings = useCallback((next) => {
    onOptsChange?.({ ...(opts || {}), settings: next })
  }, [opts, onOptsChange])

  // An ad-hoc source wins over both the picker and a saved list: this widget was
  // placed BY a host that owns its membership, so there is nothing to pick.
  const SourceList = SOURCE_WIDGETS[opts?.source]
  if (SourceList) {
    return (
      <SourceList
        color={color}
        settingsOverride={wlSettingsOverride}
        onSettingsPersist={persistWlSettings}
      />
    )
  }

  // No list chosen yet (freshly added) → show the picker menu instead of the
  // full list view. Once a list is picked, the widget scopes to that single list.
  if (listSub && !watchKey) {
    return (
      <SubscribedList
        sub={listSub}
        activeRef={activeWatchlistRef}
        widgetKey={widgetId}
        scopedSymContext={scopedSymContext}
        settingsOverride={wlSettingsOverride}
        onSettingsPersist={persistWlSettings}
        onExit={unsubscribe}
      />
    )
  }

  // COV-10 follow-up: a saved screen is a list source no widget on the board publishes, so
  // the empty widget offers it itself (collapsed to one button; nothing is read until asked).
  const screenOfferable = subOn && !watchKey && !listSub && !opts?.source
  if (!watchKey && (offered || screenOfferable)) {
    return (
      <div style={OFFER_WRAP}>
        {offered && (
          <SubscribeOffer key={`${offered.source}:${offered.value}`} color={color} offered={offered} onSubscribe={subscribe} />
        )}
        {screenOfferable && <ScreenSourceOffer onSubscribe={subscribe} />}
        <div style={OFFER_BODY}>
          <WatchlistPicker
            onPick={pick}
            settingsOverride={wlSettingsOverride}
            onSettingsPersist={persistWlSettings}
            initialTab={opts?.watchTab || null}
          />
        </div>
      </div>
    )
  }

  if (!watchKey) {
    return (
      <WatchlistPicker
        onPick={pick}
        settingsOverride={wlSettingsOverride}
        onSettingsPersist={persistWlSettings}
        initialTab={opts?.watchTab || null}
      />
    )
  }

  // A PREBUILT list (picked from the Prebuilt tab) always opens in its default columns and
  // discards any in-session column edits (ephemeralCols). My Lists / community persist as
  // normal (ephemeralCols=false, global column storage).
  const _isPrebuilt = opts?.watchTab === 'prebuilt'
  const _prebuiltCfg = _isPrebuilt
    ? (PREBUILT_COL_DEFAULTS[opts?.watchName || ''] || PREBUILT_COL_FALLBACK)
    : null
  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      <Watchlists
        embedded
        pickList={watchKey}
        pickName={opts?.watchName || null}
        onExitPick={exitPick}
        activeRef={activeWatchlistRef}
        widgetKey={widgetId}
        settingsOverride={wlSettingsOverride}
        onSettingsPersist={persistWlSettings}
        defaultColCfg={_prebuiltCfg}
        ephemeralCols={_isPrebuilt}
      />
    </ChartsSymContext.Provider>
  )
}
