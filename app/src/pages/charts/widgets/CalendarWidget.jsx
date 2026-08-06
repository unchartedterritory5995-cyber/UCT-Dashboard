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
import { useCallback, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { useWorkspace } from '../WorkspaceContext'
import usePreferences from '../../../hooks/usePreferences'
import useTickerMeta from '../../../hooks/useTickerMeta'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import CompanyLogo from '../../../components/CompanyLogo'
import NewsSettingsPanel from './NewsSettingsPanel'
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
function mondayOfISO(iso) { const wd = isoWeekday(iso); return addDaysISO(iso, wd === 0 ? -6 : 1 - wd) }
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
function fmtNum(v, digits = 2) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
const mcapDesc = (a, b) => (Number.isFinite(b.mc_b) ? b.mc_b : -1) - (Number.isFinite(a.mc_b) ? a.mc_b : -1)
const TOP_EARNINGS = 10   // largest 10 by market cap; the rest behind "Show all"

// A single earnings row: logo + ticker + (company name, dims/hides when narrow) + EPS.
function EarnRow({ c, onPick }) {
  const { name } = useTickerMeta(c.sym)
  // Reported (eps_act) and upcoming (eps_est) render IDENTICALLY — same size/weight —
  // differing only in the "EPS"/"est" label; the value is colored by its sign.
  const reported = c.eps_act != null
  const val = reported ? c.eps_act : (c.eps_est != null ? c.eps_est : null)
  const signCls = val == null ? '' : (val >= 0 ? styles.pos : styles.neg)
  return (
    <div className={styles.earnRow} onClick={() => onPick(c.sym)} title={`Show ${c.sym} on the linked chart`}>
      <CompanyLogo sym={c.sym} size={16} name={name} round />
      <span className={styles.earnSym}>{c.sym}</span>
      {name && <span className={styles.earnCompany}>({name})</span>}
      {val != null && (
        <span className={`${styles.earnMeta} ${signCls}`}>
          <span className={styles.lbl}>{reported ? 'EPS' : 'est'} </span>{fmtNum(val)}
        </span>
      )}
    </div>
  )
}

// An earnings section: the top 10 by market cap, then a "Show all N" expander.
function EarningsSection({ title, iconName, cls, items, onPick }) {
  const [showAll, setShowAll] = useState(false)
  const sorted = useMemo(() => [...items].sort(mcapDesc), [items])
  const shown = showAll ? sorted : sorted.slice(0, TOP_EARNINGS)
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionHead} ${cls}`}>
        <span className={styles.headIcon}><UIcon name={iconName} size={13} /></span>
        {title}<span className={styles.count}>{items.length}</span>
      </div>
      {shown.map(c => <EarnRow key={c.sym} c={c} onPick={onPick} />)}
      {sorted.length > TOP_EARNINGS && (
        <button type="button" className={`${styles.showAll}${showAll ? ' ' + styles.open : ''}`} onClick={() => setShowAll(s => !s)}>
          {showAll ? 'Show less' : `Show all ${sorted.length}`}
          <span className={styles.chev}><UIcon name="chevronRight" size={12} /></span>
        </button>
      )}
    </div>
  )
}

export default function CalendarWidget({ color, opts, onOptsChange }) {
  const { setGroupSym } = useWorkspace() || {}
  const goToSym = useCallback((sym) => { if (sym && setGroupSym) setGroupSym(color, sym.toUpperCase()) }, [setGroupSym, color])

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
  // weekend snaps back to Friday so you see the last session, not an empty day). ──
  const todayView = useMemo(() => {
    const now = todayET()
    const wd = isoWeekday(now)
    return (wd === 0 || wd === 6) ? addTradingDay(now, -1) : now
  }, [])
  const [selected, setSelected] = useState(todayView)
  const isToday = selected === todayView
  const [tbdOpen, setTbdOpen] = useState(false)

  // ── Data — the whole week for the selected date (same-week nav reuses the cache) ──
  const monday = mondayOfISO(selected)
  const { data, isLoading } = useSWR(`/api/calendar?week=${monday}`, fetcher, {
    refreshInterval: 300000, dedupingInterval: 60000,
  })
  const day = data?.days?.[selected] || null

  const econItems = useMemo(() => {
    if (!day) return []
    const econ = (day.econ || []).map(e => ({ time: e.time, event: e.event, estimate: e.estimate, prior: e.prior, actual: e.actual, key: !!e.is_key, fed: false }))
    const fed = (day.fed || []).map(e => ({ time: e.time, event: e.event, note: e.note, key: true, fed: true }))
    return [...econ, ...fed].sort((a, b) => timeMin(a.time) - timeMin(b.time))
  }, [day])
  const bmo = day?.bmo || []
  const amc = day?.amc || []
  const tbd = useMemo(() => [...(day?.tbd || [])].sort(mcapDesc), [day])
  const nothing = !isLoading && day && econItems.length === 0 && bmo.length === 0 && amc.length === 0 && tbd.length === 0

  return (
    <div ref={rootRef} className={styles.root} style={rootStyle}>
      {settingsOpen && (
        <NewsSettingsPanel
          title="Calendar Settings"
          showPerf={false}
          textHint="names & EPS"
          extraSections={[
            { label: 'Symbol', rows: [{ key: 'symbolColor', label: 'Symbol color', hint: 'earnings tickers' }] },
            { label: 'EPS / Estimate', rows: [
              { key: 'posColor', label: 'Positive', hint: 'value ≥ 0' },
              { key: 'negColor', label: 'Negative', hint: 'value < 0' },
            ] },
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
        <button
          ref={settingsBtnRef}
          type="button"
          className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="Calendar widget settings"
        ><UIcon name="gear" size={13} /></button>
      </div>

      {/* Body */}
      <div className={styles.list}>
        {isLoading && !day && (
          <div className={styles.loading}><span className={styles.spinner} />Loading calendar…</div>
        )}

        {nothing && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}><UIcon name="calendar" size={26} /></span>
            No economic events or earnings for {fmtMain(selected)}.
          </div>
        )}

        {econItems.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.headIcon}><UIcon name="globe" size={13} /></span>
              Economic Events<span className={styles.count}>{econItems.length}</span>
            </div>
            {econItems.map((e, i) => (
              <div key={`${e.time}-${e.event}-${i}`} className={`${styles.econRow}${e.key ? ' ' + styles.key : ''}`}>
                <span className={styles.econTime}>{e.time || '—'}</span>
                <div className={styles.econMain}>
                  <div className={styles.econName}>{e.event}{e.fed && <span className={styles.fedTag}>FED</span>}</div>
                  {!e.fed && (e.estimate != null || e.prior != null || e.actual != null) && (
                    <div className={styles.econStats}>
                      {e.actual != null && <span>act <b>{e.actual}</b></span>}
                      {e.estimate != null && <span>est {e.estimate}</span>}
                      {e.prior != null && <span>prior {e.prior}</span>}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {bmo.length > 0 && (
          <EarningsSection title="Pre-Market Earnings" iconName="sun" cls={styles.pre} items={bmo} onPick={goToSym} />
        )}

        {amc.length > 0 && (
          <EarningsSection title="After-Hours Earnings" iconName="moon" cls={styles.post} items={amc} onPick={goToSym} />
        )}

        {tbd.length > 0 && (
          <div className={styles.section}>
            <button type="button" className={`${styles.tbdToggle}${tbdOpen ? ' ' + styles.open : ''}`} onClick={() => setTbdOpen(o => !o)}>
              Time TBD<span className={styles.count} style={{ marginLeft: 6 }}>{tbd.length}</span>
              <span className={styles.chev}><UIcon name="chevronRight" size={12} /></span>
            </button>
            {tbdOpen && tbd.map(c => <EarnRow key={c.sym} c={c} onPick={goToSym} />)}
          </div>
        )}
      </div>
    </div>
  )
}
