/**
 * News — the Trade Exchange breaking-news feed (registry id `tradeExchangeNews`).
 *
 * One shared, seq-ordered feed for every News widget in the browser
 * (lib/tradeExchangeNewsStreamManager.js, reached through panelContract — never a
 * URL here). Newest on top. Per-widget, persisted in `opts`:
 *   settings    appearance + density / highlight / sound (⚙, tradeExchangeNewsSettings.js)
 *   follow      auto-follow the live edge (default on)
 *   linked      only headlines naming this widget's colour-group symbol
 *   watchlistId only headlines naming a symbol on this list (personal or prebuilt)
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
import { menuThemeVars } from '../../../utils/dividerColor'
import { playAlertSound, previewSound } from '../../../utils/alertSound'
import { declareNeed, DELIVERY } from '../../../lib/panelContract'
import { claimAnnouncement, loadOlder } from '../../../lib/tradeExchangeNewsStreamManager'
import { PICKER_MY_LISTS_URL, PREBUILT_DIRECTORY_URL, usePrebuiltMembership } from '../../watchlist/prebuiltDirectory'
import UIcon from '../../../components/ui/UIcon'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'
import NewsSettingsPanel from './NewsSettingsPanel'
import TradeExchangeNewsAlerts from './TradeExchangeNewsAlerts'
import { TXN_SOUND_OPTIONS, txnSettingsFor, txnWidgetStyleVars } from './tradeExchangeNewsSettings'
import { categoryTitle, coverageNotice, fmtReceived, fmtReceivedFull, liveStatus, tokenize, visibleItems } from './tradeExchangeNewsModel'
import styles from './TradeExchangeNewsWidget.module.css'

const FLASH_MS = 950
const SOUND_GAP_MS = 1500
const SEARCH_DEBOUNCE_MS = 140

const fetchList = (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : []))

/** Stable across renders, so useSyncExternalStore never re-subscribes. */
const NEED = declareNeed({ kind: 'trade-exchange-news', delivery: DELIVERY.EVERY_MESSAGE_MATTERS })

function Headline({ item, linkedSym, onSym, provisional }) {
  const parts = useMemo(() => tokenize(item.content, item.tickers), [item.content, item.tickers])
  return (
    <span className={styles.headline}>
      {parts.map((p, i) => (p.sym ? (
        <button
          key={i}
          type="button"
          className={`${styles.sym}${p.sym === linkedSym ? ' ' + styles.symLinked : ''}`}
          onClick={() => onSym(p.sym)}
          title={`Open ${p.sym} on this widget's linked charts${provisional ? ' · ticker detected automatically (provisional)' : ''}`}
        >{p.text}</button>
      ) : <span key={i}>{p.text}</span>))}
    </span>
  )
}

export default function TradeExchangeNewsWidget({ color, opts, onOptsChange }) {
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
  const linked = !!opts?.linked
  const watchlistId = typeof opts?.watchlistId === 'string' ? opts.watchlistId : ''

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
    return [{ value: '', label: 'All lists' }, ...mine, ...pre]
      .filter((o) => !seen.has(o.value) && seen.add(o.value))
  }, [myLists, prebuilt])

  const shown = useMemo(
    () => visibleItems(feed.items, { query, linkedSym: linked ? linkedSym : null, watchSet }),
    [feed.items, query, linked, linkedSym, watchSet],
  )

  // ── new-headline highlight + sound (seeded, never flashes history) ──
  const seenRef = useRef(null)
  const [flashing, setFlashing] = useState(() => new Set())
  const lastSoundRef = useRef(0)
  useEffect(() => {
    if (feed.status === 'idle' || feed.status === 'connecting') return
    const seen = seenRef.current
    if (seen === null) {                                  // first real list: seed silently
      seenRef.current = new Set(feed.items.map((it) => it.seq))
      return
    }
    const fresh = shown.filter((it) => !seen.has(it.seq))
    for (const it of feed.items) seen.add(it.seq)
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

  // ── auto-follow + Jump to live (newest on top) ──
  const listRef = useRef(null)
  const [atTop, setAtTop] = useState(true)
  const [pending, setPending] = useState(0)
  const following = follow && atTop
  const topSeq = shown[0]?.seq || 0
  const prevRef = useRef({ topSeq, height: 0, count: shown.length })
  useLayoutEffect(() => {
    const el = listRef.current
    const prev = prevRef.current
    if (el) {
      const height = el.scrollHeight
      if (topSeq !== prev.topSeq && prev.height) {
        const added = shown.findIndex((it) => it.seq === prev.topSeq)
        if (!following && added > 0) {
          // Hold the reader's place: push the scroll down by what was prepended.
          el.scrollTop += height - prev.height
          setPending((n) => n + added)
        }
      }
      prevRef.current = { topSeq, height, count: shown.length }
    }
  }, [topSeq, shown, following])
  const onScroll = useCallback((e) => {
    const top = e.currentTarget.scrollTop < 4
    setAtTop(top)
    if (top) setPending(0)
  }, [])
  const jumpToLive = useCallback(() => {
    if (listRef.current) listRef.current.scrollTop = 0
    setAtTop(true)
    setPending(0)
    if (!follow) patchOpts({ follow: true })
  }, [follow, patchOpts])
  useEffect(() => { setPending(0) }, [query, linked, watchlistId])

  const onSym = useCallback((sym) => setGroupSym?.(color, sym), [color, setGroupSym])

  // ── chrome ──
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [alertsOpen, setAlertsOpen] = useState(false)
  const gearRef = useRef(null)
  const bellRef = useRef(null)
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
  const loading = (feed.status === 'connecting' || feed.status === 'idle') && !feed.items.length
  const filtered = !!(query || linked || watchlistId)

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
      {alertsOpen && (
        <TradeExchangeNewsAlerts onClose={() => setAlertsOpen(false)} anchorEl={bellRef.current} themeVars={menuVars} />
      )}

      <div className={styles.bar}>
        <span className={`${styles.status} ${toneCls}`} title={status.title} aria-live="polite">
          <span className={styles.dot} aria-hidden="true" />
          <span className={styles.statusText}>{status.label}</span>
        </span>
        <span className={styles.spacer} />
        <button
          type="button"
          className={`${styles.iconBtn}${follow ? ' ' + styles.iconBtnOn : ''}`}
          onClick={() => patchOpts({ follow: !follow })}
          title={follow ? 'Auto-follow is on: new headlines appear at the top. Click to hold your place.' : 'Auto-follow is off: your place is held. Click to follow the live edge.'}
          aria-label={follow ? 'Turn auto-follow off' : 'Turn auto-follow on'}
        ><UIcon name={follow ? 'pause' : 'play'} size={13} /></button>
        <button
          ref={bellRef}
          type="button"
          className={`${styles.iconBtn}${alertsOpen ? ' ' + styles.iconBtnOn : ''}`}
          onClick={() => setAlertsOpen((o) => !o)}
          title="News alerts"
          aria-label="News alerts"
        ><UIcon name="bell" size={14} /></button>
        <button
          ref={gearRef}
          type="button"
          className={`${styles.iconBtn}${settingsOpen ? ' ' + styles.iconBtnOn : ''}`}
          onClick={() => setSettingsOpen((o) => !o)}
          title="News widget settings"
          aria-label="News widget settings"
        ><UIcon name="gear" size={14} /></button>
      </div>

      <div className={styles.searchBar}>
        <span className={styles.searchWrap}>
          <Input
            className={styles.searchInput}
            value={queryRaw}
            onChange={(e) => setQueryRaw(e.target.value)}
            placeholder="Search"
            aria-label="Search headlines"
            maxLength={80}
          />
          {queryRaw && (
            <button type="button" className={styles.searchClear} onClick={() => setQueryRaw('')} aria-label="Clear search" title="Clear">×</button>
          )}
        </span>
        <button
          type="button"
          className={`${styles.filterBtn}${linked ? ' ' + styles.filterBtnOn : ''}`}
          onClick={() => patchOpts({ linked: !linked })}
          title={linked ? `Showing only headlines naming ${linkedSym || "this widget's linked symbol"}` : "Show only headlines naming this widget's linked symbol"}
          aria-label={linked ? 'Show all tickers' : 'Show only the linked symbol'}
        >
          <UIcon name="link" size={11} />
          <span className={styles.filterLabel}>{linked && linkedSym ? linkedSym : 'Linked'}</span>
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
          Some older headlines have aged out of the history window.
        </div>
      )}

      {!following && pending > 0 && (
        <button type="button" className={styles.jump} onClick={jumpToLive}>
          <UIcon name="play" size={10} /> Jump to live · {pending} new
        </button>
      )}

      <div ref={listRef} className={styles.list} onScroll={onScroll}>
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
        {!unavailable && !loading && !shown.length && feed.status !== 'failed' && (
          <div className={styles.empty}>
            {filtered ? 'No headlines match these filters.' : 'No headlines yet. New Trade Exchange headlines appear here the moment they arrive.'}
          </div>
        )}
        {shown.map((it) => {
          const selected = !!(linkedSym && (it.tickers || []).includes(linkedSym))
          return (
            <div key={it.seq} className={`${styles.row}${selected ? ' ' + styles.rowSelected : ''}`} data-seq={it.seq}>
              {flashing.has(it.seq) && <span className={styles.flash} aria-hidden="true" />}
              <span className={styles.when}>
                <span className={styles.time} title={`Received by UCT ${fmtReceivedFull(it.received_at_ms)} · Trade Exchange does not send a publication time`}>
                  {fmtReceived(it.received_at_ms)}
                </span>
                {settings.showCategory !== 'off' && it.category && (
                  <span className={styles.category} title={categoryTitle(it)}>{it.category}</span>
                )}
              </span>
              <Headline item={it} linkedSym={linkedSym} onSym={onSym} provisional={feed.provisional} />
              <span className={styles.badges}>
                {it.repeat_count > 0 && (
                  <span className={styles.badge} title={`Received ${it.repeat_count + 1} times within a minute (a resend or a repeat publication)`}>×{it.repeat_count + 1}</span>
                )}
                {it.delayed && (
                  <span className={`${styles.badge} ${styles.badgeDelayed}`} title="Reached UCT late — recovered after an interruption">delayed</span>
                )}
              </span>
            </div>
          )
        })}
        {feed.hasOlder && shown.length > 0 && (
          <button type="button" className={styles.more} onClick={() => loadOlder()} disabled={feed.loadingOlder}>
            {feed.loadingOlder ? 'Loading…' : 'Load older headlines'}
          </button>
        )}
      </div>
      <div className={styles.footer}>
        <span className={styles.footerCount}>
          {filtered ? `${shown.length} of ${feed.items.length}` : feed.items.length} headline{(filtered ? shown.length : feed.items.length) === 1 ? '' : 's'}
        </span>
        <span className={styles.footerNote} title="Times are when UCT received each headline (Trade Exchange sends no publication time). Tickers are detected automatically.">
          · received times ET{feed.provisional ? ' · tickers provisional' : ''}
        </span>
      </div>
    </div>
  )
}
