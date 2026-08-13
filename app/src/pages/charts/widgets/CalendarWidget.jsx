/**
 * Calendar widget — one trading day at a time: economic events (+ Fed) and the
 * day's earnings split into Pre-Market (BMO) and After Hours (AMC), with prev/next
 * day navigation. Market-wide (not chart-linked), but clicking an earnings ticker
 * PUBLISHES it to this widget's color group (one-way → the linked chart follows).
 *
 * Appearance (canvas + text color + text size) is a per-widget ⚙ blob persisted like
 * the other widget settings; an uncustomized widget follows the app theme
 * (light → white canvas + dark text, OLED → black canvas + light text).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { useWorkspace } from '../WorkspaceContext'
import { sendCaptureToJournal } from '../../journal-2-0/lib/sendToJournal'
import { useJournalToast, JournalToast } from '../../journal-2-0/lib/useJournalToast'
import usePreferences from '../../../hooks/usePreferences'
import useTickerMeta from '../../../hooks/useTickerMeta'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import CompanyLogo from '../../../components/CompanyLogo'
import NewsSettingsPanel from './NewsSettingsPanel'
// ⭐ THE ONE anchor. This widget's week intent ("the week of the most recent
// session") is DIFFERENT from /calendar's ("the current-or-upcoming week") — on
// a Saturday they are seven days apart — but both are derived from this module,
// as two named intents, rather than hand-rolled here. See the "TWO named
// intents, ONE anchor" block in weekAnchor.js.
// ⛔ Do NOT reintroduce a local Monday/weekend derivation: the AST rail in
// CalendarWidget.weekIntent.test.jsx traces both intents back to an import from
// weekAnchor and fails on anything locally declared.
import { mondayOf, lastSessionDay } from '../../calendar/weekAnchor'
import {
  mergeCalendarWidgetSettings, calendarWidgetStyleVars, calendarDefaultsForTheme,
} from './calendarWidgetSettings'
import styles from './CalendarWidget.module.css'

const fetcher = url => fetch(url).then(r => (r.ok ? r.json() : null))

// ── Pure date helpers (UTC-based math so they're timezone-independent) ──
function isoParts(iso) { const [y, m, d] = iso.split('-').map(Number); return { y, m, d } }
function isoToUTC(iso) { const { y, m, d } = isoParts(iso); return new Date(Date.UTC(y, m - 1, d)) }
function addDaysISO(iso, n) { const dt = isoToUTC(iso); dt.setUTCDate(dt.getUTCDate() + n); return dt.toISOString().slice(0, 10) }
function isoWeekday(iso) { return isoToUTC(iso).getUTCDay() }   // 0=Sun … 6=Sat
// Step ONE trading day in a direction. This is day NAVIGATION, not a week
// derivation — it never answers "which week is this", so it stays local.
function addTradingDay(iso, dir) {
  let next = addDaysISO(iso, dir)
  let wd = isoWeekday(next)
  while (wd === 0 || wd === 6) { next = addDaysISO(next, dir); wd = isoWeekday(next) }
  return next
}
function todayET() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) }
function fmtMain(iso) { return isoToUTC(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) }
function fmtWeekday(iso) { return isoToUTC(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) }

// Parse "8:30am" / "2:00pm" → minutes-since-midnight for sorting; unknowns sink last.
function timeMin(t) {
  if (!t) return 9999
  const m = /(\d{1,2}):(\d{2})\s*([ap])m/i.exec(t)
  if (!m) return 9998
  let h = Number(m[1]) % 12
  if (m[3].toLowerCase() === 'p') h += 12
  return h * 60 + Number(m[2])
}
const IMPACT_LVL = { low: 1, medium: 2, high: 3 }   // star threshold: 1★=all, 2★=med+high, 3★=high
function fmtNum(v, digits = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
// The options-implied earnings move as a plain magnitude → "3.1%" / "12%"
// (1 decimal under 10, else 0), matching the EPS/REV surprise rounding. null when
// there's no implied-move data.
function fmtImPct(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return `${n.toFixed(Math.abs(n) < 10 ? 1 : 0)}%`
}
// Pull a symbol's implied-move % out of the pre-report store map ({ SYM: pct }),
// tolerating class-share dot/hyphen notation (BRK.B vs BRK-B).
function imLookup(imMap, sym) {
  if (!imMap || !sym) return undefined
  return imMap[sym] ?? imMap[sym.replace(/\./g, '-')]
}
// Revenue comes in MILLIONS → "$1.2B" / "$847M" / "$3.8M".
function fmtRev(m) {
  const n = Number(m)
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}B`
  if (n >= 10) return `$${Math.round(n)}M`
  return `$${n.toFixed(1)}M`
}
// A reported metric's % surprise vs its estimate (colored by sign); falls back to the
// raw actual (neutral) when there's no usable estimate base (est missing or 0).
function surpriseCell(act, est, fmtVal) {
  if (act == null) return null
  if (est != null && est !== 0) {
    const pct = ((act - est) / Math.abs(est)) * 100
    return { text: `${pct >= 0 ? '+' : ''}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`, up: pct >= 0 }
  }
  return { text: fmtVal(act), up: null }
}
// A reporter's market cap ($B) from the day-metrics map (the /api/calendar earnings
// entries carry no mc_b), falling back to any mc_b on the entry; missing sinks last.
function mcapOf(mcapMap, c) {
  const v = mcapMap?.[c?.sym]
  if (Number.isFinite(v)) return v
  return Number.isFinite(c?.mc_b) ? c.mc_b : -1
}
const TOP_EARNINGS = 10   // largest 10 by market cap; the rest behind "Show all"
// Sort key for the EPS / REV columns = the % surprise, and ONLY for stocks that have
// actually reported with a usable estimate base. Anything without a real surprise
// (not reported yet, or no estimate to compare against) returns null → sinks to the
// bottom, so an unreported name never floats up next to real surprises.
function surpKey(act, est) {
  if (act != null && est != null && est !== 0) return (act - est) / Math.abs(est)
  return null
}
const epsSurpKey = c => surpKey(c.eps_act, c.eps_est)
const revSurpKey = c => surpKey(c.rev_act, c.rev_est)

// A single earnings row: logo + ticker + (company name) + the EPS · REV columns.
// Reported → EPS% / Rev% surprise (colored up/down); pending → est EPS / est Rev (neutral).
// memo'd + a data-earn-sym hook so keyboard arrow-nav can walk the rendered rows and
// only the selection-changed rows re-render.
const EarnRow = memo(function EarnRow({ c, im, onSelect, selected }) {
  const { name } = useTickerMeta(c.sym)
  const eps = c.eps_act != null
    ? surpriseCell(c.eps_act, c.eps_est, fmtNum)
    : (c.eps_est != null ? { text: fmtNum(c.eps_est), up: null, est: true } : null)
  const rev = c.rev_act != null
    ? surpriseCell(c.rev_act, c.rev_est, fmtRev)
    : (c.rev_est != null ? { text: fmtRev(c.rev_est), up: null, est: true } : null)
  const cls = (cell) => (!cell || cell.est || cell.up == null ? '' : (cell.up ? styles.pos : styles.neg))
  const imText = fmtImPct(im)
  return (
    <div
      className={`${styles.earnRow}${selected ? ' ' + styles.earnRowSelected : ''}`}
      data-earn-sym={c.sym}
      onClick={() => onSelect(c.sym)}
      title={`Show ${c.sym} on the linked chart`}
    >
      <CompanyLogo sym={c.sym} size={16} name={name} round />
      <span className={styles.earnSym}>{c.sym}</span>
      {name && <span className={styles.earnCompany}>({name})</span>}
      <span className={styles.valCols}>
        <span className={styles.imCol} title="Options-implied move">{imText ?? '—'}</span>
        <span className={`${styles.epsCol} ${cls(eps)}`}>{eps?.text ?? '—'}</span>
        <span className={`${styles.revCol} ${cls(rev)}`}>{rev?.text ?? '—'}</span>
      </span>
    </div>
  )
})

// An earnings section: top 10 by market cap (default), a "Show all N" expander, and
// clickable EPS/REV headers to sort by surprise (click again reverses); the title
// re-sorts by market cap. Column labels get "(est)" when the section is all estimates.
function EarningsSection({ title, iconName, cls, items, imMap, mcapMap, onSelect, selectedSym }) {
  const [showAll, setShowAll] = useState(false)
  // Default order: market cap, biggest first. Clicking the section title reverses it.
  const [sort, setSort] = useState({ by: 'mcap', dir: 'desc' })
  // Show "(est)" whenever ANY name in the section is still estimate-only (not yet
  // reported) — a section that's mostly pre-report but has one early actual (e.g. a
  // pre-market list where a single name printed) is still an estimates column. Only
  // a FULLY-reported section drops the tag.
  const est = useMemo(() => items.some(c => c.eps_act == null && c.rev_act == null), [items])
  const sorted = useMemo(() => {
    const arr = [...items]
    if (sort.by === 'mcap') {
      return arr.sort((a, b) => {
        const d = mcapOf(mcapMap, b) - mcapOf(mcapMap, a)
        return sort.dir === 'desc' ? d : -d
      })
    }
    const keyFn = sort.by === 'eps' ? epsSurpKey
      : sort.by === 'im' ? (c => imLookup(imMap, c.sym))
        : revSurpKey
    return arr.sort((a, b) => {
      const ka = keyFn(a), kb = keyFn(b)
      if (ka == null && kb == null) return 0
      if (ka == null) return 1     // no implied move / no surprise → sinks last
      if (kb == null) return -1
      return sort.dir === 'desc' ? kb - ka : ka - kb
    })
  }, [items, sort, imMap, mcapMap])
  const shown = showAll ? sorted : sorted.slice(0, TOP_EARNINGS)
  const clickCol = (col) => setSort(s => (s.by === col ? { by: col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { by: col, dir: 'desc' }))
  const caret = (col) => (sort.by === col ? <span className={styles.sortCaret}>{sort.dir === 'desc' ? '▾' : '▴'}</span> : null)
  const estTag = est ? <span className={styles.estTag}>(est)</span> : null
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionHead} ${cls}`}>
        <button type="button" className={styles.headTitle} onClick={() => clickCol('mcap')} title="Sorted by market cap — click to reverse">
          <span className={styles.headIcon}><UIcon name={iconName} size={13} /></span>
          {title}<span className={styles.titleCount}>({items.length})</span>{caret('mcap')}
        </button>
        <span className={styles.valCols}>
          <button
            type="button"
            className={`${styles.imCol} ${styles.colBtn}${sort.by === 'im' ? ' ' + styles.colActive : ''}`}
            onClick={() => clickCol('im')}
            title="Sort by implied move"
          >Impl.<br />Move{caret('im')}</button>
          <button
            type="button"
            className={`${styles.epsCol} ${styles.colBtn}${sort.by === 'eps' ? ' ' + styles.colActive : ''}`}
            onClick={() => clickCol('eps')}
            title="Sort by EPS surprise"
          >EPS{caret('eps')}{estTag}</button>
          <button
            type="button"
            className={`${styles.revCol} ${styles.colBtn}${sort.by === 'rev' ? ' ' + styles.colActive : ''}`}
            onClick={() => clickCol('rev')}
            title="Sort by revenue surprise"
          >REV{caret('rev')}{estTag}</button>
        </span>
      </div>
      {shown.map(c => <EarnRow key={c.sym} c={c} im={imLookup(imMap, c.sym)} onSelect={onSelect} selected={c.sym === selectedSym} />)}
      {sorted.length > TOP_EARNINGS && (
        <button type="button" className={`${styles.showAll}${showAll ? ' ' + styles.open : ''}`} onClick={() => setShowAll(s => !s)}>
          {showAll ? 'Show less' : `Show all ${sorted.length}`}
          <span className={styles.chev}><UIcon name="chevronRight" size={12} /></span>
        </button>
      )}
    </div>
  )
}

export default function CalendarWidget({ color, opts, onOptsChange, journalDoor = true }) {
  const { setGroupSym } = useWorkspace() || {}
  const goToSym = useCallback((sym) => { if (sym && setGroupSym) setGroupSym(color, sym.toUpperCase()) }, [setGroupSym, color])

  // ── Selection + keyboard nav across the rendered earnings rows ──
  const [selectedSym, setSelectedSym] = useState(null)
  const listRef = useRef(null)
  const selectSym = useCallback((sym, scroll) => {
    if (!sym) return
    setSelectedSym(sym)
    goToSym(sym)
    if (scroll) requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-earn-sym="${sym}"]`)
      el?.scrollIntoView({ block: 'nearest' })
    })
  }, [goToSym])
  // Click → select + publish to the chart, and focus the list so arrows work next.
  const onRowSelect = useCallback((sym) => { selectSym(sym, false); listRef.current?.focus?.() }, [selectSym])
  // ↑/↓ walk the rows in RENDERED order (across both sections, respecting sort/show-all).
  const onListKeyDown = useCallback((e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = Array.from(listRef.current?.querySelectorAll('[data-earn-sym]') || [])
    if (!rows.length) return
    e.preventDefault(); e.stopPropagation()
    const syms = rows.map(r => r.getAttribute('data-earn-sym'))
    let idx = syms.indexOf(selectedSym)
    if (idx < 0) idx = e.key === 'ArrowDown' ? -1 : syms.length
    const next = Math.max(0, Math.min(syms.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))
    selectSym(syms[next], true)
  }, [selectedSym, selectSym])

  // ── Appearance settings (⚙) ──
  const { prefs } = usePreferences()
  const settings = useMemo(
    () => mergeCalendarWidgetSettings(opts?.settings ?? calendarDefaultsForTheme(prefs.theme)),
    [opts?.settings, prefs.theme],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const rootRef = useRef(null)
  const patchSettings = useCallback(
    (patch) => onOptsChange?.({ ...(opts || {}), settings: { ...settings, ...patch } }),
    [opts, settings, onOptsChange],
  )
  const resetSettings = useCallback(() => onOptsChange?.({ ...(opts || {}), settings: null }), [opts, onOptsChange])
  const rootStyle = useMemo(() => calendarWidgetStyleVars(settings), [settings])
  const menuVars = useMemo(() => {
    const canvas = settings.bgMode === 'gradient' ? (settings.bgGradient?.top || settings.bg) : settings.bg
    return menuThemeVars(canvas) || {}
  }, [settings])

  // ── Selected day + navigation. Opens on the current trading day each load (a
  // weekend snaps back to Friday so you see the last session, not an empty day).
  //
  // ⭐ That snap-back is `lastSessionDay`, ONE of the anchor's two named
  // intents — not a weekend branch written here. /calendar asks the anchor its
  // OTHER question (`currentWeekMonday`, which rolls a weekend FORWARD), so the
  // two surfaces show different weeks on a Saturday BY DECLARATION. ──
  const todayView = useMemo(() => lastSessionDay(todayET()), [])
  // Frozen-embed restore seam (journal host): a captured day in opts wins
  // over "today" — /charts never sets opts.date, so workspace behavior is
  // byte-identical. Same idiom as aisearch's initialThread.
  const [selected, setSelected] = useState(() => (
    typeof opts?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : todayView
  ))
  const isToday = selected === todayView
  const [tbdOpen, setTbdOpen] = useState(false)

  // ── Impact star filter (persisted per-widget): 1★ = all, 2★ = medium+high, 3★ = high.
  // Default 3★ (high-impact only) for a new widget; persists once the user changes it. ──
  const econStars = [1, 2, 3].includes(opts?.econStars) ? opts.econStars : 3
  const setEconStars = useCallback((n) => onOptsChange?.({ ...(opts || {}), econStars: n }), [opts, onOptsChange])

  // ── Send this day to the Journal (the non-chart capture door — shares the
  // chart context menu's exact wire: last-active note → inbox fallback).
  // Hidden inside a journal embed (journalDoor={false}) — circular there. ──
  const [journalMsg, setJournalMsg] = useJournalToast()
  const sendDayToJournal = useCallback(async () => {
    setJournalMsg('sending…')
    setJournalMsg(await sendCaptureToJournal('calendar', {
      date: selected, econStars, selectedSym, tbdOpen, settings,
    }, { label: `Calendar ${selected}` }))
  }, [selected, econStars, selectedSym, tbdOpen, settings])

  // ── Data — the whole week for the selected date (same-week nav reuses the cache).
  // full_impact=1 gets ALL econ impacts + an `impact` level for the star filter. ──
  // The week that CONTAINS the selected day — the anchor's `mondayOf`, the same
  // function /calendar normalizes a `?week=` deep link with and the same rule
  // the backend's `_monday_of` applies to the param it receives.
  const weekParam = mondayOf(selected)
  const { data, isLoading } = useSWR(`/api/calendar?week=${weekParam}&full_impact=1`, fetcher, {
    refreshInterval: 300000, dedupingInterval: 60000,
  })
  const day = data?.days?.[selected] || null

  // ── Implied move per earnings ticker for the selected day — the HONEST
  // pre-report move from the nightly snapshot store ({ SYM: pct }). This is right
  // even for names that already reported (whose LIVE options straddle is
  // IV-crushed, so /enrichment reads far too low, e.g. DDOG 3.4% vs the real
  // ~13.7%). Instant indexed read, and has past days too. ──
  const { data: imData } = useSWR(`/api/calendar/implied-moves?date=${selected}`, fetcher, {
    refreshInterval: 300000, dedupingInterval: 60000,
  })
  const imMap = imData && typeof imData === 'object' ? imData : null

  // ── Per-ticker market cap ($B) for the selected day, used ONLY to order the
  // earnings lists (largest first) — the values themselves are never shown. The
  // /api/calendar earnings entries carry no market cap, so this comes from the
  // same day-metrics feed the main /calendar page uses. ──
  const { data: metricsData } = useSWR(`/api/calendar/day-metrics-batch?dates=${selected}`, fetcher, {
    refreshInterval: 300000, dedupingInterval: 60000,
  })
  const mcapMap = useMemo(() => {
    const dayM = metricsData?.[selected]
    if (!dayM || typeof dayM !== 'object') return null
    const out = {}
    for (const [sym, v] of Object.entries(dayM)) {
      if (v && Number.isFinite(v.mc_b)) out[sym] = v.mc_b
    }
    return out
  }, [metricsData, selected])

  const hasAnyEcon = (day?.econ?.length || 0) + (day?.fed?.length || 0) > 0
  const econItems = useMemo(() => {
    if (!day) return []
    const lvl = (imp) => (IMPACT_LVL[imp] || 2)   // unknown (curated far-week) → medium
    const econ = (day.econ || []).map(e => ({ time: e.time, event: e.event, estimate: e.estimate, prior: e.prior, actual: e.actual, fed: false, lvl: lvl(e.impact) }))
    const fed = (day.fed || []).map(e => ({ time: e.time, event: e.event, note: e.note, fed: true, lvl: lvl(e.impact) }))
    return [...econ, ...fed]
      .filter(x => x.lvl >= econStars)
      .sort((a, b) => timeMin(a.time) - timeMin(b.time))
  }, [day, econStars])
  const bmo = day?.bmo || []
  const amc = day?.amc || []
  const tbd = useMemo(() => [...(day?.tbd || [])].sort((a, b) => mcapOf(mcapMap, b) - mcapOf(mcapMap, a)), [day, mcapMap])
  const nothing = !isLoading && day && !hasAnyEcon && bmo.length === 0 && amc.length === 0 && tbd.length === 0

  return (
    <div ref={rootRef} className={styles.root} style={rootStyle}>
      {settingsOpen && (
        <NewsSettingsPanel
          title="Calendar Settings"
          showPerf={false}
          textHint="names & EPS"
          extraSections={[
            { label: 'Symbol', rows: [{ key: 'symbolColor', label: 'Symbol color', hint: 'earnings tickers' }] },
            { label: 'Surprise colors', rows: [
              { key: 'posColor', label: 'Upside surprise', hint: 'beat' },
              { key: 'negColor', label: 'Downside surprise', hint: 'miss' },
            ] },
            { label: 'High impact', rows: [{ key: 'highBoxColor', label: 'Time box', hint: '3★ events' }] },
            { label: 'Text size', rows: [{ key: 'textSize', label: 'Size', type: 'segmented', options: [
              { key: 's', label: 'S' }, { key: 'm', label: 'M' }, { key: 'l', label: 'L' },
            ] }] },
          ]}
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={rootRef.current}
          themeVars={menuVars}
        />
      )}

      {/* Header: ◀ date ▶ + gear (+ a Today jump when off today) */}
      <div className={styles.bar}>
        {!isToday && (
          <button type="button" className={styles.todayBtn} onClick={() => setSelected(todayView)} title="Jump to today">Today</button>
        )}
        <button type="button" className={styles.navBtn} onClick={() => setSelected(addTradingDay(selected, -1))} aria-label="Previous day">‹</button>
        <span className={styles.dateWrap}>
          <span className={styles.dateMain}>{fmtMain(selected)}</span>
          <span className={styles.dateSub}>{isToday ? <span className={styles.todayPill}>Today</span> : fmtWeekday(selected)}</span>
        </span>
        <button type="button" className={styles.navBtn} onClick={() => setSelected(addTradingDay(selected, 1))} aria-label="Next day">›</button>
        {journalDoor && (
          <button
            type="button"
            className={styles.gearBtn}
            style={{ right: 34 }}
            onClick={sendDayToJournal}
            title="Send this day to Journal"
            aria-label="Send this day to Journal"
          ><UIcon name="journal" size={13} /></button>
        )}
        <button
          ref={settingsBtnRef}
          type="button"
          className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="Calendar widget settings"
        ><UIcon name="gear" size={13} /></button>
        <JournalToast msg={journalMsg} style={{ top: 'calc(100% + 4px)' }} />
      </div>

      {/* Body — tabIndex + onKeyDown make it arrow-navigable once a row is clicked. */}
      <div className={styles.list} ref={listRef} tabIndex={0} onKeyDown={onListKeyDown}>
        {isLoading && !day && (
          <div className={styles.loading}><span className={styles.spinner} />Loading calendar…</div>
        )}

        {nothing && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><UIcon name="calendar" size={26} /></span>
            No economic events or earnings for {fmtMain(selected)}.
          </div>
        )}

        {hasAnyEcon && (
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.headIcon}><UIcon name="globe" size={13} /></span>
              Economic Events<span className={styles.titleCount}>({econItems.length})</span>
              <span className={styles.stars}>
                {[1, 2, 3].map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`${styles.starBtn}${n <= econStars ? ' ' + styles.starOn : ''}`}
                    onClick={() => setEconStars(n)}
                    title={n === 1 ? 'All events' : n === 2 ? 'Medium & high impact' : 'High impact only'}
                    aria-label={n === 1 ? 'Show all events' : n === 2 ? 'Show medium and high impact' : 'Show high impact only'}
                  ><UIcon name={n <= econStars ? 'star-fill' : 'star'} size={12} gold={false} /></button>
                ))}
              </span>
            </div>
            {econItems.length === 0
              ? <div className={styles.econEmpty}>No events at this impact level.</div>
              : econItems.map((e, i) => (
                <div key={`${e.time}-${e.event}-${i}`} className={styles.econRow}>
                  <span className={styles.econTime}>
                    {e.lvl >= 3 ? <span className={styles.timeBox}>{e.time || '—'}</span> : (e.time || '—')}
                  </span>
                  <div className={styles.econMain}>
                    <div className={styles.econName}>{e.event}{e.fed && <span className={styles.fedTag}>FED</span>}</div>
                    {!e.fed && (e.estimate != null || e.prior != null) && (
                      <div className={styles.econStats}>
                        {e.estimate != null && <span>est {e.estimate}</span>}
                        {e.prior != null && <span>prior {e.prior}</span>}
                      </div>
                    )}
                  </div>
                  {!e.fed && e.actual != null && <span className={styles.econActual} title="Actual">{e.actual}</span>}
                </div>
              ))}
          </div>
        )}

        {bmo.length > 0 && (
          <EarningsSection title="Pre-Market Earnings" iconName="sun" cls={styles.pre} items={bmo} imMap={imMap} mcapMap={mcapMap} onSelect={onRowSelect} selectedSym={selectedSym} />
        )}

        {amc.length > 0 && (
          <EarningsSection title="After-Hours Earnings" iconName="moon" cls={styles.post} items={amc} imMap={imMap} mcapMap={mcapMap} onSelect={onRowSelect} selectedSym={selectedSym} />
        )}

        {tbd.length > 0 && (
          <div className={styles.section}>
            <button type="button" className={`${styles.tbdToggle}${tbdOpen ? ' ' + styles.open : ''}`} onClick={() => setTbdOpen(o => !o)}>
              Time TBD<span className={styles.count} style={{ marginLeft: 6 }}>{tbd.length}</span>
              <span className={styles.chev}><UIcon name="chevronRight" size={12} /></span>
            </button>
            {tbdOpen && tbd.map(c => <EarnRow key={c.sym} c={c} im={imLookup(imMap, c.sym)} onSelect={onRowSelect} selected={c.sym === selectedSym} />)}
          </div>
        )}
      </div>
    </div>
  )
}
