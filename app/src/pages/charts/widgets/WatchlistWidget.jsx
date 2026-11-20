import { useMemo, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, lazy } from 'react'
import { AuthContext } from '../../../context/AuthContext'
import Watchlists from '../../Watchlists'
import WatchlistPicker from './WatchlistPicker'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'
import { ALIAS_PREFIX } from '../../watchlist/communityPick'
import { KIND, channelFor, listRefCtx, usePublish, useChannel } from '../../../lib/context/contextChannels'
import { SubscribeOffer, SubscribedList, ScreenSourceOffer, SUBSCRIBABLE_SOURCES } from './ListSubscription'
import useListSubscribeEnabled from '../useListSubscribeEnabled'
import LibraryRail from './LibraryRail'
import { useWatchlistLibrary, countOf, readLastList, rememberList, flaggedPick } from './watchlistLibrary'
import UIcon from '../../../components/ui/UIcon'
import railStyles from './LibraryRail.module.css'
import { useUctControlsSlot } from '../uctHeaderSlot'

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
// Below this width the library rail slides over the list instead of sitting beside it.
const RAIL_SIDE_MIN_W = 520

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
  const { groupSyms, setGroupSym, groupTfs, groupTfSets, activeWatchlistRef } = useWorkspace()
  const listSubscribeEnabled = useListSubscribeEnabled()
  // UCT frame (/charts board): the open list's name gets a ▾ list switcher (owner 11-13, option A).
  const uctFrame = useUctControlsSlot() != null
  const ownerId = useContext(AuthContext)?.user?.id ?? null   // per-account last list (owner 11-15)
  // Library rail (owner 11-13): beside the open list on a wide widget (shown unless the member
  // hid it — opts.libraryRail === false), sliding over the list on a narrow one (closed until
  // asked, and closing again after a pick).
  const [splitEl, setSplitEl] = useState(null)
  const [narrow, setNarrow] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  // Closing plays the opening slide in reverse (owner 11-13), then the rail unmounts.
  const [railClosing, setRailClosing] = useState(false)
  const closeTimerRef = useRef(null)
  useEffect(() => () => clearTimeout(closeTimerRef.current), [])
  useLayoutEffect(() => {
    const view = splitEl?.ownerDocument?.defaultView
    if (!splitEl || !view?.ResizeObserver) return undefined
    const ro = new view.ResizeObserver(() => setNarrow(splitEl.clientWidth < RAIL_SIDE_MIN_W))
    ro.observe(splitEl)
    return () => ro.disconnect()
  }, [splitEl])
  const lib = useWatchlistLibrary('', uctFrame)
  // Stable id so this widget can claim "active" (owns arrow keys + its own scroll).
  const widgetId = useId()
  // Scoped context: routes the wrapped Watchlists' useChartsSym calls
  // into THIS widget's color group, not Group A. setSym is a STABLE callback (not
  // re-created when groupSyms changes) so the memoized watchlist rows' select handler
  // stays stable across selection changes.
  const setSym = useCallback((s) => setGroupSym(color, s), [color, setGroupSym])
  // `tf` = the timeframe this group's chart is on, so the wrapped list warms
  // the cache key that chart actually reads (see ThemeTrackerPage's warmTf note).
  // `tfs` = EVERY linked chart's timeframe (a daily and an hourly chart on one colour), so the list
  // warms each of them (ChartsWorkspace registerGroupTf).
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym,
    tf: groupTfs?.[color],
    tfs: groupTfSets?.[color],
  }), [groupSyms, groupTfs, groupTfSets, color, setSym])

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
  // UCT frame (owner 11-13): a NEW Watchlist widget opens straight onto the member's most recent
  // list (else Flagged) with the library showing Prebuilt — not the blank picker. Never when
  // the member chose to browse (`browse`), when a host placed it (`source`), or while list
  // subscriptions are on (the empty widget is where those are offered).
  // `libraryFresh` marks that auto-open (library shown on Prebuilt, over the list when narrow)
  // until the member picks a list or toggles the library.
  const freshOpen = uctFrame && opts?.libraryFresh === true
  const groupList = useChannel(offerable ? listChannel : null)
  const offered = groupList && SUBSCRIBABLE_SOURCES.includes(groupList.source) ? groupList : null
  // Owner 11-15: on the board a fresh widget ALWAYS opens the library (list subscriptions on or
  // off — live has them on, which used to leave the old picker showing). Only a list another
  // widget in this colour group publishes (`offered`) keeps the empty widget's offer view; the
  // saved-screen offer moved into the library's My Lists tab (mineFooter below).
  useEffect(() => {
    if (!uctFrame || watchKey || opts?.browse || opts?.source || listSub || offered) return
    const last = readLastList(undefined, ownerId)
    // Flagged is always THIS person's (its label carries their name, never a stored one)
    const sel = (!last || last.key === 'flagged') ? flaggedPick(lib.flaggedLabel) : last
    onOptsChange?.({ ...(opts || {}), watchKey: sel.key, watchName: sel.name, watchTab: sel.tab, libraryRail: true, libraryFresh: true })
  }, [uctFrame, watchKey, opts, listSub, offered, lib.flaggedLabel, onOptsChange, ownerId])
  const subscribe = useCallback((sub) => {
    // a subscription replaces the open list (the library's My Lists offer subscribes with one open)
    onOptsChange?.({ ...(opts || {}), listSub: sub, watchKey: null, watchName: null, libraryFresh: null })
  }, [opts, onOptsChange])
  const unsubscribe = useCallback(() => {
    onOptsChange?.({ ...(opts || {}), listSub: null })
  }, [opts, onOptsChange])
  const pick = useCallback((sel) => {
    // Creating a list from a saved look Template seeds the widget's appearance
    // (opts.settings) only — a template never controls the column layout. `watchTab` is
    // the picker tab it came from, so leaving reopens on it + we know if it's prebuilt.
    const next = { ...(opts || {}), watchKey: sel?.key || null, watchName: sel?.name || null, watchTab: sel?.tab || null, browse: null, libraryFresh: null }
    if (sel?.settings) next.settings = sel.settings
    rememberList(sel, undefined, ownerId)
    onOptsChange?.(next)
  }, [opts, onOptsChange, ownerId])
  const exitPick = useCallback(() => {
    // Keep watchTab so the picker reopens on the section the user was in. `browse` marks the
    // trip as intentional, so the widget does not auto-open a list over the picker.
    onOptsChange?.({ ...(opts || {}), watchKey: null, watchName: null, browse: true })
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
        initialCreating={opts?.browse === 'new'}
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
        initialCreating={opts?.browse === 'new'}
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
  // ── Library rail (UCT frame only) ──
  // the saved-screen offer, now the last row of the library's My Lists (owner 11-15)
  const screenOffer = subOn && !opts?.source ? <ScreenSourceOffer onSubscribe={subscribe} /> : null
  const railShown = uctFrame && (narrow ? (overlayOpen || freshOpen || railClosing) : opts?.libraryRail !== false)
  const RAIL_OUT_MS = 170
  const closeOverlay = (after) => {
    if (railClosing) return
    setRailClosing(true)
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => { setRailClosing(false); setOverlayOpen(false); after?.() }, RAIL_OUT_MS)
  }
  const dropLibraryOpenedFlag = () => { if (freshOpen) onOptsChange?.({ ...(opts || {}), libraryFresh: null }) }
  const toggleRail = () => {
    if (narrow) { if (railShown && !railClosing) closeOverlay(dropLibraryOpenedFlag); else if (!railShown) setOverlayOpen(true) }
    else onOptsChange?.({ ...(opts || {}), libraryRail: opts?.libraryRail === false, libraryFresh: null })
  }
  // Narrow: the list switches at once, and the library slides away over it.
  const railPick = (sel) => { if (narrow) closeOverlay(); pick(sel) }
  // The library's tab: Prebuilt for a brand-new widget, then whichever tab the member last used
  // in THIS widget (opts.libraryTab), falling back to the open list's own library.
  const railTab = freshOpen ? 'prebuilt' : (opts?.libraryTab || opts?.watchTab || 'prebuilt')
  // Owner 11-15: on a NARROW widget the just-added library is shown only by `libraryFresh`; a tab click
  // clears that flag, which used to close the library on the very first click. Keep it open instead.
  const setRailTab = (t) => {
    if (t === railTab && !freshOpen) return
    if (narrow && freshOpen) setOverlayOpen(true)
    onOptsChange?.({ ...(opts || {}), libraryTab: t, libraryFresh: null })
  }
  const listCount = (() => {
    if (!uctFrame) return null
    if (watchKey === 'flagged') return lib.flagged?.length ?? null
    const id = /^(?:user|community):(.+)$/.exec(watchKey || '')?.[1]
    const all = [...(Array.isArray(lib.myLists) ? lib.myLists : []), ...lib.community, ...lib.prebuiltGroups.flatMap((g) => g.lists)]
    const hit = all.find((wl) => wl.pickKey === watchKey || String(wl.id) === id)
    return hit ? countOf(hit) : null
  })()
  const railToggle = uctFrame ? (
    <button
      type="button"
      className={`${railStyles.toggle}${railShown ? ' ' + railStyles.toggleOn : ''} charts-no-drag`}
      onClick={toggleRail}
      aria-pressed={railShown}
      aria-label={railShown ? 'Hide the library' : 'Show the library'}
      title={railShown ? 'Hide the library' : 'Show the library — Prebuilt, Community and My Lists'}
      data-guide="watchlist.libraryToggle"
    ><UIcon name="columns" size={15} gold={false} /></button>
  ) : null
  const listView = (
      <Watchlists
        embedded
        pickList={watchKey}
        // Flagged's title is the signed-in person's own label (owner 11-15), never a saved name
        pickName={watchKey === 'flagged' && uctFrame ? lib.flaggedLabel : (opts?.watchName || null)}
        onExitPick={exitPick}
        pickTitleBefore={railToggle}
        pickTitleAfter={uctFrame && listCount != null ? <span className={railStyles.count} data-list-count="">{listCount}</span> : null}
        activeRef={activeWatchlistRef}
        widgetKey={widgetId}
        listView={{ type: 'watchlist', color, key: watchKey }}
        settingsOverride={wlSettingsOverride}
        onSettingsPersist={persistWlSettings}
        defaultColCfg={_prebuiltCfg}
        ephemeralCols={_isPrebuilt}
        sessionMode={opts?.wlSession === 'ext' ? 'ext' : 'rth'}
        onSessionMode={uctFrame ? (m) => onOptsChange?.({ ...(opts || {}), wlSession: m === 'ext' ? 'ext' : undefined }) : null}
      />
  )
  return (
    <ChartsSymContext.Provider value={scopedSymContext}>
      {uctFrame ? (
        <div ref={setSplitEl} className={railStyles.split} data-library-rail={railShown ? (narrow ? 'over' : 'side') : 'off'}>
          {railShown && !narrow && (
            <div className={railStyles.side}>
              <LibraryRail currentKey={watchKey} tab={railTab} onTab={setRailTab} onPick={railPick} mineFooter={screenOffer} />
            </div>
          )}
          <div className={railStyles.pane}>{listView}</div>
          {railShown && narrow && (
            <>
              <button type="button" className={`${railStyles.scrim}${railClosing ? ' ' + railStyles.scrimOut : ''}`} aria-label="Close the library" onClick={() => closeOverlay(dropLibraryOpenedFlag)} />
              <LibraryRail overlay closing={railClosing} currentKey={watchKey} tab={railTab} onTab={setRailTab} onPick={railPick} mineFooter={screenOffer} />
            </>
          )}
        </div>
      ) : listView}
    </ChartsSymContext.Provider>
  )
}
