/**
 * News — the Trade Exchange breaking-news feed (registry id `tradeExchangeNews`).
 *
 * One shared, seq-ordered feed for every News widget in the browser
 * (lib/tradeExchangeNewsStreamManager.js, reached through panelContract — never a
 * URL here) for the live edge; history one America/New_York calendar day at a
 * time, which the SERVER filters and serves in cursor steps as the reader scrolls
 * (useTradeExchangeNewsDay -> archive.py). Newest on top. Per-widget, persisted
 * in `opts`:
 *   settings    appearance + density / highlight / sound (⚙, tradeExchangeNewsSettings.js)
 *   follow      auto-follow the live edge (default on; Jump to live turns it back on)
 *   linked      only headlines naming this widget's colour-group symbol
 *   watchlistId only headlines naming a symbol on this list (personal or prebuilt)
 *   categories  only these server categories ([] = all); every filter is AND
 *   presets     this widget's saved filter/display presets; presetId the applied one
 *   view        'saved' = the Saved Headlines view (the toolbar's bookmark button);
 *               collection / ticker / sort are that view's filters
 *
 * TWO VIEWS, ONE WIDGET. The feed stays mounted and live behind Saved Headlines (its
 * pane is only hidden), so its scroll position, date, search, filters and follow state
 * are exactly as left, and the stream never stops. Both views use the same row actions:
 * Explain expands inside the row, Bookmark saves/removes (Undo), ⋯ holds Watchlist,
 * Notebook, Collections and Copy.
 *
 * ⛔ Shows only what Trade Exchange sent: the headline text verbatim, UCT's RECEIPT
 * time (labelled), repeat counts, and a `delayed` mark on headlines recovered late.
 * No invented categories, publication times or ticker metadata; ticker links are
 * the server resolver's provisional reading, linked only where the text names them.
 *
 * Theme: canonical per-widget colour customisation — usePlacedTheme for the
 * uncustomised default, the shared NewsSettingsPanel (theme gallery incl. "Apply to
 * all widgets"), and chartThemes._WIDGET_THEME_MAP / widgetChrome for the frame. An
 * app-theme switch never recolours a placed widget (the usePlacedTheme rule).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import useSWR from 'swr'
import { useWorkspace } from '../WorkspaceContext'
import usePreferences from '../../../hooks/usePreferences'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import useRealtimePrices from '../../../hooks/useRealtimePrices'
import { menuThemeVars } from '../../../utils/dividerColor'
import { playAlertSound, previewSound } from '../../../utils/alertSound'
import { declareNeed, DELIVERY } from '../../../lib/panelContract'
import { claimAnnouncement } from '../../../lib/tradeExchangeNewsStreamManager'
import { PICKER_MY_LISTS_URL, PREBUILT_DIRECTORY_URL, usePrebuiltMembership } from '../../watchlist/prebuiltDirectory'
import UIcon from '../../../components/ui/UIcon'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import NewsSettingsPanel from './NewsSettingsPanel'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { ActionsMenu, CalendarPopover, DayBar, DayList, FilterMenu, HealthPopover, Row, TimePopover } from './TradeExchangeNewsParts'
import SavedHeadlines from './TradeExchangeNewsSaved'
import { TXN_SOUND_OPTIONS, txnClampLines, txnSettingsFor, txnWidgetStyleVars } from './tradeExchangeNewsSettings'
import { categoriesLabel, cleanCategories, cleanPresets, coverageNotice, dayLabel, dayRequest, feedHealth, groupRelated,
  liveStatus, presetPatch, presetSnapshot, quoteSymbols, viewHealth, visibleItems } from './tradeExchangeNewsModel'
import useTradeExchangeNewsDay from './useTradeExchangeNewsDay'
import * as library from '../../../lib/tradeExchangeNewsLibrary'
import { sendHeadlineToNotebook } from '../../../lib/tradeExchangeNewsNotebook'
import styles from './TradeExchangeNewsWidget.module.css'

//: New-headline highlight: held for 1.5 s, then a 0.6 s fade (CSS .flash), then removed.
const FLASH_MS = 2100
//: Only news this recent flashes: a reconnect's replayed backlog is not "new".
const FLASH_FRESH_MS = 60_000
const SOUND_GAP_MS = 1500
const SEARCH_DEBOUNCE_MS = 140

const fetchList = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : []))

/** Stable across renders, so useSyncExternalStore never re-subscribes. */
const NEED = declareNeed({ kind: 'trade-exchange-news', delivery: DELIVERY.EVERY_MESSAGE_MATTERS })

const NO_REST = Object.freeze([])
//: Fetch the next step of the day this far (px) before the reader reaches an end.
const NEAR_END_PX = 900

export default function TradeExchangeNewsWidget({ color, opts, onOptsChange, defaultView = 'feed' }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  const linkedSym = groupSyms?.[color] || null
  const feed = useSyncExternalStore(NEED.subscribe, NEED.read)

  // ── settings (per-widget, the News & Catalysts pattern) ──
  const { prefs } = usePreferences()
  const placedTheme = usePlacedTheme()
  const settings = useMemo(() => txnSettingsFor(opts?.settings, placedTheme),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts?.settings, prefs.theme])
  const patchOpts = useCallback((patch) => onOptsChange?.({ ...(opts || {}), ...patch }), [opts, onOptsChange])
  const patchSettings = useCallback((patch) => {
    if (patch.soundKey && patch.soundKey !== settings.soundKey) previewSound(patch.soundKey)
    if (patch.sound === 'on' && settings.sound !== 'on') previewSound(settings.soundKey)
    patchOpts({ settings: { ...settings, ...patch } })
  }, [patchOpts, settings])
  const resetSettings = useCallback(() => patchOpts({ settings: null }), [patchOpts])
  const rootStyle = useMemo(() => txnWidgetStyleVars(settings), [settings])
  const menuVars = useMemo(() => {
    const canvas = settings.bgMode === 'gradient' ? (settings.bgGradient?.top || settings.bg) : settings.bg
    return menuThemeVars(canvas) || {}
  }, [settings])

  const follow = opts?.follow !== false
  // A widget placed as the retired Research Library opens on Saved (WidgetHost's defaultView).
  const view = (opts?.view ?? defaultView) === 'saved' ? 'saved' : 'feed'
  const [savedMounted, setSavedMounted] = useState(view === 'saved')
  useEffect(() => { if (view === 'saved') setSavedMounted(true) }, [view])
  const linked = !!opts?.linked
  const watchlistId = typeof opts?.watchlistId === 'string' ? opts.watchlistId : ''
  const categories = useMemo(() => cleanCategories(opts?.categories), [opts?.categories])
  const presets = useMemo(() => cleanPresets(opts?.presets), [opts?.presets])
  const clampLines = txnClampLines(settings)

  // ── search (debounced, not persisted) ──
  const [queryRaw, setQueryRaw] = useState('')
  const [query, setQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryRaw), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [queryRaw])

  // ── watchlist filter: personal + prebuilt lists, through the canonical readers ──
  const { data: myLists } = useSWR(PICKER_MY_LISTS_URL, fetchList, { revalidateOnFocus: false })
  const { data: prebuilt } = useSWR(PREBUILT_DIRECTORY_URL, fetchList, { revalidateOnFocus: false })
  const membership = usePrebuiltMembership(watchlistId ? [watchlistId] : [])
  const watchSet = useMemo(() => {
    if (!watchlistId) return null
    const items = membership[watchlistId]
    return items ? new Set(items.map((it) => String(it.sym || '').toUpperCase())) : new Set()
  }, [watchlistId, membership])
  const listOptions = useMemo(() => {
    const mine = (Array.isArray(myLists) ? myLists : []).map((l) => ({ value: l.id, label: l.name }))
    const pre = (Array.isArray(prebuilt) ? prebuilt : []).map((l) => ({ value: l.id, label: `UCT · ${l.name}` }))
    const seen = new Set()                      // a list may appear in both sources
    return [{ value: '', label: 'All Lists' }, ...mine, ...pre]
      .filter((o) => !seen.has(o.value) && seen.add(o.value))
  }, [myLists, prebuilt])

  // The live pool's rows passing every filter (newest first): new-headline detection
  // and the live edge of the selected day. The day itself comes from the server.
  const filterArgs = { query, linkedSym: linked ? linkedSym : null, watchSet, categories,
    hidePlaceholders: settings.graphicPlaceholders !== 'show' }
  const shown = useMemo(() => visibleItems(feed.items, filterArgs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.items, query, linked, linkedSym, watchSet, categories, settings.graphicPlaceholders])
  const dayReq = useMemo(() => dayRequest(filterArgs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query, linked, linkedSym, watchSet, categories, settings.graphicPlaceholders])
  const day = useTradeExchangeNewsDay({ feed, matches: shown, request: dayReq, enabled: feed.status !== 'unavailable' })
  const rows = day.rows
  // Grouping runs AFTER the filters, so a group only ever holds headlines the reader
  // asked to see -- and each one keeps its own row, time and links.
  const groups = useMemo(() => (settings.groupRelated === 'on' ? groupRelated(rows)
    : rows.map((it) => ({ key: it.seq, lead: it, rest: NO_REST }))), [rows, settings.groupRelated])
  const hiddenPlaceholders = settings.graphicPlaceholders === 'show' ? 0
    : day.hidden ?? 0

  // ── daily-performance ticker colours: the shared, pooled price stream, for a
  //    BOUNDED set (the newest loaded rows' distinct symbols). The headline never waits. ──
  const quotesUsed = settings.tickerColorMode === 'performance'
  const quoteSyms = useMemo(() => (quotesUsed ? quoteSymbols(rows) : []), [rows, quotesUsed])
  const { prices, staleSymbols } = useRealtimePrices(quoteSyms)

  // ── new-headline highlight + sound (seeded, never flashes history) ──
  const seenRef = useRef(null)
  const newestRef = useRef(0)
  const [flashing, setFlashing] = useState(() => new Set())
  const lastSoundRef = useRef(0)
  useEffect(() => {
    if (feed.status === 'idle' || feed.status === 'connecting') return
    const seen = seenRef.current
    if (seen === null) {                                  // first real list: seed silently
      seenRef.current = new Set(feed.items.map((it) => it.seq))
      newestRef.current = Math.max(0, ...feed.items.map((it) => it.seq))
      return
    }
    // ⭐ New = beyond the newest seq already seen AND received just now. A history
    // page, a filter change, a repeat, or a reconnect's replayed backlog is never
    // "new" -- only a genuinely arriving headline flashes (and only where it is shown).
    const newest = newestRef.current
    const now = Date.now()
    const fresh = shown.filter((it) => !seen.has(it.seq) && it.seq > newest
      && now - (it.received_at_ms || 0) < FLASH_FRESH_MS)
    for (const it of feed.items) seen.add(it.seq)
    newestRef.current = Math.max(newest, ...feed.items.map((it) => it.seq))
    const live = fresh.filter((it) => !it.delayed)
    if (!live.length) return
    if (settings.highlightNew === 'on') {
      setFlashing((prev) => new Set([...prev, ...live.map((it) => it.seq)]))
      const ids = live.map((it) => it.seq)
      setTimeout(() => setFlashing((prev) => {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      }), FLASH_MS)
    }
    if (settings.sound === 'on') {
      const claimed = live.filter((it) => claimAnnouncement(it.seq))
      const now = Date.now()
      if (claimed.length && now - lastSoundRef.current > SOUND_GAP_MS) {
        lastSoundRef.current = now
        playAlertSound(settings.soundKey)
      }
    }
  }, [feed.items, feed.status, shown, settings.highlightNew, settings.sound, settings.soundKey])

  // ── row actions (one menu per widget) and the AI Explanation (one open per widget,
  //    expanded inside its row; the same headline again, ✕ or Esc closes it) ──
  const [actions, setActions] = useState(null)              // { item, anchor, view }
  const onActions = useCallback((item, anchor) => setActions((a) => (a?.item.id === item.id && a.view === 'feed' ? null
    : { item, anchor, view: 'feed' })), [])
  const onSavedActions = useCallback((item, anchor) => setActions((a) => (a?.item.id === item.id && a.view === 'saved' ? null
    : { item, anchor, view: 'saved' })), [])
  const [explain, setExplain] = useState(null)              // { id, view }
  const onExplain = useCallback((item) => setExplain((x) => (x?.id === item.id && x.view === 'feed' ? null : { id: item.id, view: 'feed' })), [])
  const onSavedExplain = useCallback((item) => setExplain((x) => (x?.id === item.id && x.view === 'saved' ? null : { id: item.id, view: 'saved' })), [])
  const closeExplain = useCallback(() => setExplain(null), [])

  // ── auto-follow + Jump to live (newest on top) ──
  const listRef = useRef(null)
  const [atTop, setAtTop] = useState(true)
  const [pending, setPending] = useState(0)
  // While an explanation is open in the feed, arriving headlines never move it: the
  // place is held (and counted on Jump to live) exactly as with auto-follow off.
  const following = follow && atTop && explain?.view !== 'feed'
  const topSeq = rows[0]?.seq || 0
  // A step of NEWER rows loaded above (scrolling up after a time jump) never moves
  // what the reader is looking at; live arrivals follow the auto-follow rule.
  const anchorNext = useRef(false)
  const prevRef = useRef({ topSeq, height: 0, count: rows.length, anchor: null })
  useLayoutEffect(() => {
    const el = listRef.current
    const prev = prevRef.current
    if (el) {
      const height = el.scrollHeight
      // the first row on screen and where it sits: what a prepend must not move
      const rowTop = (seq) => {
        const r = seq && el.querySelector(`[data-seq="${seq}"]`)
        return r ? r.getBoundingClientRect().top - el.getBoundingClientRect().top : null
      }
      if (topSeq && topSeq !== prev.topSeq && prev.height && prev.topSeq) {
        const added = rows.findIndex((it) => it.seq === prev.topSeq)
        if (added > 0 && (anchorNext.current || !following)) {
          // Hold the reader's place: the row that was on top stays exactly where it was
          // (by the row itself -- a block turning into a spacer at the same moment
          // would make a scroll-height difference lie).
          const now = rowTop(prev.topSeq)
          el.scrollTop += now != null && prev.anchor != null ? now - prev.anchor : height - prev.height
          if (!anchorNext.current) setPending((n) => n + added)
        }
        anchorNext.current = false
      }
      prevRef.current = { topSeq, height, count: rows.length, anchor: rowTop(topSeq) }
    }
  }, [topSeq, rows, following])
  // A new date, time or filter starts at its top.
  const viewKey = `${day.dateKey}|${day.at || ''}|${JSON.stringify(dayReq)}`
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
    setAtTop(true)
    setPending(0)
  }, [viewKey])
  // Continuous scrolling: the next step of the day loads before the reader reaches it.
  const nearEnds = useCallback((el) => {
    if (!el) return
    if (day.hasOlder && el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_END_PX) day.loadOlder()
    if (day.hasNewer && el.scrollTop < NEAR_END_PX) { anchorNext.current = true; day.loadNewer() }
  }, [day])
  // ...and keeps loading while what is loaded does not fill the list.
  useEffect(() => { nearEnds(listRef.current) }, [rows.length, day.hasOlder, day.hasNewer, nearEnds])
  const onScroll = useCallback((e) => {
    const top = e.currentTarget.scrollTop < 4
    setAtTop(top)
    if (top) setPending(0)
    nearEnds(e.currentTarget)
  }, [nearEnds])
  const jumpToLive = useCallback(() => {
    if (listRef.current) listRef.current.scrollTop = 0
    setAtTop(true)
    setPending(0)
    if (!follow) patchOpts({ follow: true })
  }, [follow, patchOpts])
  useEffect(() => { setPending(0) }, [query, linked, watchlistId, categories])

  const onSym = useCallback((sym) => setGroupSym?.(color, sym), [color, setGroupSym])

  // ── long headlines + related groups: open/closed per seq, never persisted, and
  //    untouched by arriving headlines (keyed by seq, not by position) ──
  const [expanded, setExpanded] = useState(() => new Set())
  const onToggleExpand = useCallback((seq) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(seq)) next.delete(seq)
    else next.add(seq)
    return next
  }), [])
  const [openGroups, setOpenGroups] = useState(() => new Set())
  const groupKeyOf = useRef(new Map())
  groupKeyOf.current = new Map(groups.map((g) => [g.lead.seq, g.key]))
  const onToggleGroup = useCallback((item) => setOpenGroups((prev) => {
    const key = groupKeyOf.current.get(item.seq) ?? item.seq
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }), [])

  // ⋯ closes on its own result: a Notebook send reports where it went.
  const closeActions = useCallback((result) => {
    setActions(null)
    if (result && typeof result.text === 'string') setToast({ text: result.text, tone: result.ok ? undefined : 'err' })
  }, [])
  // ── bookmarks: save / remove (Undo), shared with every News widget on the page ──
  const lib = useSyncExternalStore(library.subscribe, library.getSnapshot)
  const [toast, setToast] = useState(null)                  // { text, undo?, tone }
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 3500)
    return () => clearTimeout(t)
  }, [toast])
  const onSave = useCallback(async (item) => {
    const r = await library.toggle(item.id)
    if (!r.ok) setToast({ text: r.error, tone: 'err' })
    else if (!r.saved) setToast({ text: 'Bookmark removed', undo: r.removed })
    else setToast({ text: 'Headline saved' })
  }, [])
  const onRemove = useCallback(async (item) => {
    const r = await library.remove(item.id)
    setToast(r.ok ? { text: 'Bookmark removed', undo: r.removed } : { text: r.error, tone: 'err' })
  }, [])
  const undo = useCallback(async () => {
    const removed = toast?.undo
    setToast(null)
    const r = await library.undoRemove(removed)
    if (!r.ok) setToast({ text: r.error || 'Could not restore it. Save it again.', tone: 'err' })
  }, [toast])
  const onCopied = useCallback((ok) => setToast(ok ? { text: 'Headline copied' }
    : { text: 'Copy failed: the browser blocked the clipboard', tone: 'err' }), [])
  const setView = useCallback((v) => {
    setActions(null)
    patchOpts({ view: v === 'saved' ? 'saved' : (defaultView === 'saved' ? 'feed' : null) })
  }, [patchOpts, defaultView])

  // ── filters + presets (this widget's opts only) ──
  const [filterOpen, setFilterOpen] = useState(false)
  const filterRef = useRef(null)
  const closeFilter = useCallback(() => setFilterOpen(false), [])
  const setCategories = useCallback((c) => patchOpts({ categories: c, presetId: null }), [patchOpts])
  const savePreset = useCallback((name) => {
    const id = `p${Date.now().toString(36)}`
    patchOpts({ presets: [...presets, { id, name, ...presetSnapshot(opts, settings, query) }], presetId: id })
  }, [patchOpts, presets, opts, settings, query])
  const applyPreset = useCallback((p) => {
    patchOpts(presetPatch(settings, p))
    setQueryRaw(p.query || '')
    setQuery(p.query || '')
  }, [patchOpts, settings])
  const renamePreset = useCallback((id, name) => patchOpts({ presets: presets.map((p) => (p.id === id ? { ...p, name } : p)) }),
    [patchOpts, presets])
  const deletePreset = useCallback((id) => patchOpts({ presets: presets.filter((p) => p.id !== id),
    presetId: opts?.presetId === id ? null : (opts?.presetId ?? null) }), [patchOpts, presets, opts?.presetId])
  const clearFilters = useCallback(() => {
    patchOpts({ categories: [], linked: false, watchlistId: null, presetId: null })
    setQueryRaw('')
    setQuery('')
  }, [patchOpts])

  // ── the date bar's popovers ──
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [timeOpen, setTimeOpen] = useState(false)
  const calRef = useRef(null)
  const timeRef = useRef(null)
  const closeCalendar = useCallback(() => setCalendarOpen(false), [])
  const closeTime = useCallback(() => setTimeOpen(false), [])

  // ── feed health ──
  const [healthOpen, setHealthOpen] = useState(false)
  const statusRef = useRef(null)
  const closeHealth = useCallback(() => setHealthOpen(false), [])

  // ── chrome ──
  const [settingsOpen, setSettingsOpen] = useState(false)
  const gearRef = useRef(null)
  const rootRef = useRef(null)
  const [, tick] = useState(0)
  useEffect(() => {                         // keep "last headline 2m ago" honest
    const t = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])
  const status = liveStatus(feed)
  const toneCls = status.tone === 'live' ? styles.toneLive : status.tone === 'warn' ? styles.toneWarn : styles.toneOff
  const gap = coverageNotice(feed.coverage)
  const unavailable = feed.status === 'unavailable'
  const loading = (day.loading && !rows.length)
    || ((feed.status === 'connecting' || feed.status === 'idle') && !feed.items.length && day.live && !rows.length)
  const filtered = !!(query || linked || watchlistId || categories.length)
  const now = Date.now()
  const rowProps = { linkedSym, onSym, colorMode: settings.tickerColorMode, prices, staleSymbols, quotesUsed,
    provisional: feed.provisional, clampLines, onToggleExpand, showCategory: settings.showCategory !== 'off', timeOnly: true,
    onToggleGroup, onActions, onExplain, onCloseExplain: closeExplain, onSave }
  const renderRow = (it, extra) => (
    <Row key={it.seq} item={it} {...rowProps} expanded={expanded.has(it.seq)} flashing={flashing.has(it.seq)}
      actionsOpen={actions?.view === 'feed' && actions.item.seq === it.seq}
      explainOpen={explain?.view === 'feed' && explain.id === it.id}
      saved={lib.ids.has(it.id)} {...extra} />
  )
  const renderGroup = (g) => {
    if (!g.rest.length) return renderRow(g.lead)
    const open = openGroups.has(g.key)
    return [
      renderRow(g.lead, { groupCount: g.rest.length, groupOpen: open }),
      ...(open ? g.rest.map((it) => renderRow(it, { related: true })) : []),
    ]
  }

  return (
    <div ref={rootRef} className={`${styles.root} ${settings.density === 'compact' ? styles.compact : styles.comfortable}`} style={rootStyle}>
      {settingsOpen && (
        <NewsSettingsPanel
          title="News Settings"
          widgetType="tradeExchangeNews"
          textHint="headlines"
          showPerf={false}
          extraSections={[
            { label: 'Colors', rows: [
              { key: 'headerColor', label: 'Tickers', hint: 'symbols in headlines' },
              { key: 'upColor', label: 'Live / new', hint: 'status dot & highlight' },
              { key: 'downColor', label: 'Offline / gap', hint: 'warnings' },
            ] },
            { label: 'Display', rows: [
              { key: 'density', label: 'Density', type: 'segmented', options: [
                { key: 'compact', label: 'Compact' }, { key: 'comfortable', label: 'Comfortable' }] },
              { key: 'highlightNew', label: 'Highlight new', type: 'segmented', options: [
                { key: 'on', label: 'On' }, { key: 'off', label: 'Off' }] },
              { key: 'showCategory', label: 'Category', hint: 'under each time', type: 'segmented', options: [
                { key: 'on', label: 'On' }, { key: 'off', label: 'Off' }] },
              { key: 'tickerColorMode', label: 'Ticker color mode', type: 'segmented', options: [
                { key: 'performance', label: 'Daily' }, { key: 'accent', label: 'Accent' }, { key: 'neutral', label: 'Neutral' }] },
              { key: 'graphicPlaceholders', label: 'Graphic-only posts', hint: 'e.g. CRYPTO or "SPY Daily Weekly" with no chart', type: 'segmented', options: [
                { key: 'hide', label: 'Hide' }, { key: 'show', label: 'Show' }] },
              { key: 'longHeadlines', label: 'Long headlines', hint: 'lines before Show more', type: 'segmented', options: [
                { key: '3', label: '3 lines' }, { key: '5', label: '5 lines' }, { key: 'all', label: 'Expanded' }] },
              { key: 'groupRelated', label: 'Group related', hint: 'the same story re-sent', type: 'segmented', options: [
                { key: 'off', label: 'Off' }, { key: 'on', label: 'On' }] },
            ] },
            { label: 'Sound', rows: [
              { key: 'sound', label: 'New headline', hint: 'off by default', type: 'segmented', options: [
                { key: 'off', label: 'Off' }, { key: 'on', label: 'On' }] },
              { key: 'soundKey', label: 'Tone', type: 'segmented',
                options: TXN_SOUND_OPTIONS.map((o) => ({ key: o.key, label: o.label })) },
            ] },
          ]}
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={gearRef.current}
          hostEl={rootRef.current}
          themeVars={menuVars}
        />
      )}
      {actions && (
        <ActionsMenu key={`${actions.view}|${actions.item.id}`} item={actions.item} anchorEl={actions.anchor} hostEl={rootRef.current}
          themeVars={menuVars} onClose={closeActions} onNotebook={sendHeadlineToNotebook} onCopied={onCopied}
          saved={lib.ids.has(actions.item.id)} />
      )}
      {toast && (
        <div className={`${styles.toast}${toast.tone === 'err' ? ' ' + styles.toastErr : ''}`} role="status" style={menuVars}>
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className={styles.toastBtn} onClick={undo}>Undo</button>}
        </div>
      )}
      {filterOpen && (
        <FilterMenu anchorEl={filterRef.current} hostEl={rootRef.current} themeVars={menuVars} onClose={closeFilter}
          linked={linked} linkedSym={linkedSym} onLinked={(on) => patchOpts({ linked: on, presetId: null })}
          categories={categories} onCategories={setCategories} presets={presets} activeId={opts?.presetId || null}
          onApply={applyPreset} onSave={savePreset} onRename={renamePreset} onDelete={deletePreset} />
      )}
      {calendarOpen && (
        <CalendarPopover selected={day.dateKey} meta={day.meta} anchorEl={calRef.current} hostEl={rootRef.current}
          themeVars={menuVars} onPick={day.select} onClose={closeCalendar} />
      )}
      {timeOpen && (
        <TimePopover at={day.at} anchorEl={timeRef.current} hostEl={rootRef.current} themeVars={menuVars}
          onPick={day.jumpTo} onClose={closeTime} live={day.live} onLatest={day.toLatest} />
      )}
      {healthOpen && (
        <HealthPopover lines={[...feedHealth(feed, now), ...viewHealth({ dateLabel: dayLabel(day.dateKey, day.todayKey),
          count: day.total != null ? footerCount(filtered, day.total, day.dayTotal ?? day.total) : null,
          provisional: feed.provisional, hidden: hiddenPlaceholders, showing: settings.graphicPlaceholders === 'show' })]} anchorEl={statusRef.current} hostEl={rootRef.current}
          themeVars={menuVars} onClose={closeHealth} />
      )}

      <div className={styles.bar}>
        <span className={styles.brand}>
          <span className={styles.brandTitle}>UCT News</span>
          <span className={styles.brandSub}>Powered by Trade Exchange</span>
        </span>
        <span className={styles.spacer} />
        {/* Right, in this order: LIVE -> Saved Headlines -> Settings. */}
        <button ref={statusRef} type="button" className={`${styles.status} ${toneCls}`} title={`${status.title} Click for feed health.`}
          aria-live="polite" aria-haspopup="dialog" aria-expanded={healthOpen} onClick={() => setHealthOpen((o) => !o)}>
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.statusText}>{status.label}</span>
        </button>
        <button
          type="button"
          className={`${styles.iconBtn}${view === 'saved' ? ' ' + styles.iconBtnOn : ''}`}
          onClick={() => setView(view === 'saved' ? 'feed' : 'saved')}
          title={view === 'saved' ? 'Back to the News feed' : 'Saved headlines'}
          aria-label={view === 'saved' ? 'Back to the News feed' : 'Show saved headlines'}
          aria-pressed={view === 'saved'}
        ><UIcon name={view === 'saved' ? 'bookmark-fill' : 'bookmark'} size={14} gold={false} /></button>
        <button
          ref={gearRef}
          type="button"
          className={`${styles.iconBtn}${settingsOpen ? ' ' + styles.iconBtnOn : ''}`}
          onClick={() => setSettingsOpen((o) => !o)}
          title="News widget settings"
          aria-label="News widget settings"
        ><UIcon name="gear" size={14} /></button>
      </div>

      {savedMounted && (
        <div className={`${styles.pane}${view !== 'saved' ? ' ' + styles.paneHidden : ''}`} inert={view !== 'saved'}
          aria-hidden={view !== 'saved' || undefined}>
          <SavedHeadlines active={view === 'saved'} opts={opts} patchOpts={patchOpts} linkedSym={linkedSym} onSym={onSym}
            menuVars={menuVars} onRemove={onRemove} onBack={() => setView('feed')}
            explainId={explain?.view === 'saved' ? explain.id : null} onExplain={onSavedExplain} onCloseExplain={closeExplain}
            actionsId={actions?.view === 'saved' ? actions.item.id : null} onActions={onSavedActions} />
        </div>
      )}
      {/* The feed: hidden, never unmounted, while Saved is open -- its scroll, day, search,
          filters and follow state are exactly as the reader left them. */}
      <div className={`${styles.pane}${view === 'saved' ? ' ' + styles.paneHidden : ''}`} inert={view === 'saved'}
        aria-hidden={view === 'saved' || undefined}>
      <div className={styles.searchBar}>
        <span className={styles.searchWrap}>
          <Input
            className={styles.searchInput}
            value={queryRaw}
            onChange={(e) => setQueryRaw(e.target.value)}
            placeholder="Search..."
            aria-label="Search headlines"
            maxLength={80}
          />
          {queryRaw && (
            <button type="button" className={styles.searchClear} onClick={() => setQueryRaw('')} aria-label="Clear search" title="Clear">×</button>
          )}
        </span>
        {/* One Filters button: All / Linked to chart, categories and presets (FilterMenu). */}
        <button
          ref={filterRef}
          type="button"
          className={`${styles.filterBtn}${linked || categories.length ? ' ' + styles.filterBtnOn : ''}`}
          onClick={() => setFilterOpen((o) => !o)}
          title={`News filters: ${linked ? `linked to ${linkedSym || 'the chart'}` : 'all headlines'} · ${categoriesLabel(categories)}`}
          aria-label={`News filters: ${linked ? `linked to ${linkedSym || 'the chart'}` : 'all headlines'}, categories ${categoriesLabel(categories)}`}
          aria-haspopup="dialog"
          aria-expanded={filterOpen}
        >
          <UIcon name="sliders" size={14} gold={false} />
        </button>
        <Select
          className={styles.listSelect}
          value={watchlistId}
          onChange={(e) => patchOpts({ watchlistId: e.target.value || null })}
          aria-label="Filter by watchlist"
          title="Only headlines naming a symbol on this watchlist"
          options={listOptions}
        />
      </div>

      {gap && (
        <div className={styles.notice} title={gap.title}><UIcon name="warning" size={12} /> {gap.text}</div>
      )}
      {feed.truncated && (
        <div className={`${styles.notice} ${styles.noticeInfo}`}>
          Some earlier headlines could not be replayed here; reopen the day to see them all.
        </div>
      )}

      {day.live && !following && pending > 0 && (
        <button type="button" className={styles.jump} onClick={jumpToLive}>
          <UIcon name="play" size={10} /> Jump to live · {pending} new
        </button>
      )}

      <div ref={listRef} className={`${styles.list}${day.loading && rows.length ? ' ' + styles.listBusy : ''}`} onScroll={onScroll}
        aria-busy={day.loading || day.loadingMore || undefined}
        aria-label={`Headlines, ${dayLabel(day.dateKey, day.todayKey)}${day.at ? ` from ${day.at} ET` : ''}`}>
        {unavailable && (
          <div className={styles.empty}>{status.title}</div>
        )}
        {!unavailable && loading && <div className={styles.empty}>Loading headlines…</div>}
        {!unavailable && !loading && feed.status === 'failed' && (
          <div className={styles.empty}>
            The news stream could not be opened.
            <button type="button" className={styles.emptyBtn} onClick={() => NEED.retry()}>Retry</button>
          </div>
        )}
        {!unavailable && day.error && (
          <div className={styles.empty}>
            Headlines for this date could not be loaded.
            <button type="button" className={styles.emptyBtn} onClick={day.retry}>Retry</button>
          </div>
        )}
        {!unavailable && !loading && !rows.length && feed.status !== 'failed' && !day.error && (
          <div className={styles.empty}>
            {filtered ? `No headlines on ${dayLabel(day.dateKey, day.todayKey)} match these filters.`
              : day.isToday ? 'No headlines yet today. New Trade Exchange headlines appear here the moment they arrive.'
                : `No headlines retained for ${dayLabel(day.dateKey, day.todayKey)}.`}
            {filtered && <button type="button" className={styles.emptyBtn} onClick={clearFilters}>Clear filters</button>}
          </div>
        )}
        {day.hasNewer && rows.length > 0 && (
          <div className={styles.dayEdge}>{day.loadingMore ? 'Loading later headlines…' : 'Scroll up for later headlines'}</div>
        )}
        <DayList groups={groups} rootRef={listRef} renderGroup={renderGroup} viewKey={viewKey} />
        {rows.length > 0 && (
          <div className={styles.dayEdge} aria-live="polite">
            {day.hasOlder ? 'Loading earlier headlines…'
              : `Start of ${dayLabel(day.dateKey, day.todayKey)}${day.meta?.first_day === day.dateKey && day.meta?.first_day_partial ? ' (the UCT News archive began here)' : ''}`}
          </div>
        )}
      </div>
      {/* Date and time controls only: the count and the notes live in the LIVE popover. */}
      {!unavailable && (
        <div className={styles.footer}>
          <DayBar day={day} calRef={calRef} timeRef={timeRef} calendarOpen={calendarOpen} timeOpen={timeOpen}
            onCalendar={() => { setTimeOpen(false); setCalendarOpen((o) => !o) }}
            onTime={() => { setCalendarOpen(false); setTimeOpen((o) => !o) }} />
        </div>
      )}
      </div>
    </div>
  )
}

function footerCount(filtered, total, all) {
  const n = filtered ? total : all
  const f = (v) => formatNumber(v, { decimals: 0 })
  return `${filtered ? `${f(n)} of ${f(all)}` : f(n)} headline${n === 1 ? '' : 's'}`
}
