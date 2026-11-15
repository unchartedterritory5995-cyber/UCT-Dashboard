/**
 * Calendar widget on the /charts board — look B1 "Simple" (owner 11-14).
 *
 * The day as ONE quiet timeline: the time, a dot (gold = high-impact data), the name and one
 * value per line; finished events fade above a gold Now line (today only); "Show more" opens
 * an event in place (estimate / prior / actual for data, the reporters list for an earnings
 * slot — the same EarningsSection with its sorting, implied move and click-to-chart).
 *
 * The frame's title row carries ‹ date ›; the window-control group carries the filter, the
 * Journal door and ⚙. Everything is driven by CalendarWidget's own state and handlers —
 * this file only lays them out — so off the board the widget is exactly as before.
 */
import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import UIcon from '../../../components/ui/UIcon'
import styles from './CalendarTimeline.module.css'

// "8:30am" / "2:00pm" → minutes since midnight; unknown → end of day.
function toMin(t) {
  const m = /(\d{1,2}):(\d{2})\s*([ap])m/i.exec(t || '')
  if (!m) return 23 * 60 + 58
  let h = Number(m[1]) % 12
  if (m[3].toLowerCase() === 'p') h += 12
  return h * 60 + Number(m[2])
}
function isoUTC(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const fmtDay = (iso) => isoUTC(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const fmtShort = (iso) => isoUTC(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const fmtWd = (iso) => isoUTC(iso).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
const dayNum = (iso) => isoUTC(iso).getUTCDate()
const addDays = (iso, n) => { const d = isoUTC(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
// The Monday of the week holding `iso` (a weekend belongs to the week before it).
const mondayISO = (iso) => { const wd = isoUTC(iso).getUTCDay(); return addDays(iso, wd === 0 ? -6 : 1 - wd) }
function nowET() {
  const s = new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, hour: '2-digit', minute: '2-digit' })
  const [h, m] = s.split(':').map(Number)
  return (h % 24) * 60 + m
}
const clock = (min) => { const h = Math.floor(min / 60), m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')}` }
const IMPACT = ['', 'Low', 'Medium', 'High']
const SHOW_DEFAULT = { econ: true, fed: true, earn: true }
const EMPTY = new Set()

export default function CalendarTimeline({
  rootRef, rootStyle, uctRow, uctCtrls,
  selected, setSelected, todayView, todayET, week, isLoading,
  econItems, econStars, setEconStars, bmo, amc, tbd, imMap, mcapMap,
  onRowSelect, selectedSym, listRef, onListKeyDown, opts, onOptsChange,
  journalDoor, sendDayToJournal, openCaptureMenu, journalToast, captureMenu,
  settingsPanel, settingsOpen, toggleSettings, settingsBtnRef, menuVars, Earnings,
}) {
  // Open events, remembered per day: a new day starts with everything closed.
  const [openState, setOpenState] = useState(() => ({ day: selected, ids: new Set() }))
  const open = openState.day === selected ? openState.ids : EMPTY
  const [menu, setMenu] = useState(null)        // 'filter' | 'journal' | null
  const menuRef = useRef(null)
  // Narrow widget (≤ 360px): the short date, and the Journal door only in the filter menu —
  // so ‹ date › keeps its room beside the window controls.
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const el = rootRef?.current
    const view = el?.ownerDocument?.defaultView
    if (!el || !view?.ResizeObserver) return undefined
    const ro = new view.ResizeObserver(() => setNarrow(el.clientWidth <= 360))
    ro.observe(el)
    return () => ro.disconnect()
  }, [rootRef])
  const show = { ...SHOW_DEFAULT, ...(opts?.calShow || {}) }
  const setShow = (k) => onOptsChange?.({ ...(opts || {}), calShow: { ...show, [k]: !show[k] } })
  const toggle = (id) => setOpenState((prev) => {
    const n = new Set(prev.day === selected ? prev.ids : [])
    if (n.has(id)) n.delete(id); else n.add(id)
    return { day: selected, ids: n }
  })

  // Close a menu on an outside press / Escape (the buttons that open them toggle themselves).
  useEffect(() => {
    if (!menu) return undefined
    const onDown = (e) => { if (!menuRef.current?.contains(e.target) && !e.target.closest?.('[data-cal-menu-btn]')) setMenu(null) }
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null) }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [menu])

  const topSyms = (list) => [...list]
    .sort((a, b) => (mcapMap?.[b.sym] ?? -1) - (mcapMap?.[a.sym] ?? -1))
    .slice(0, 3).map((c) => c.sym).join(' · ')

  const items = (() => {
    const out = []
    for (const e of econItems) {
      if (e.fed ? !show.fed : !show.econ) continue
      out.push({ id: `e|${e.time}|${e.event}`, t: toMin(e.time), time: e.time, kind: e.fed ? 'fed' : 'econ', e })
    }
    if (show.earn) {
      if (bmo.length) out.push({ id: 'bmo', t: 7 * 60, label: 'Pre-mkt', kind: 'earn', list: bmo, icon: 'sun', title: `${bmo.length} ${bmo.length === 1 ? 'company reports' : 'companies report'} before the open` })
      if (amc.length) out.push({ id: 'amc', t: 16 * 60 + 5, label: 'After', kind: 'earn', list: amc, icon: 'moon', title: `${amc.length} ${amc.length === 1 ? 'company reports' : 'companies report'} after the close` })
      if (tbd.length) out.push({ id: 'tbd', t: 23 * 60 + 59, label: 'TBD', kind: 'earn', list: tbd, icon: 'clock', title: `${tbd.length} ${tbd.length === 1 ? 'company reports' : 'companies report'}, time not set` })
    }
    return out.sort((a, b) => a.t - b.t)
  })()

  const live = selected === todayET && [1, 2, 3, 4, 5].includes(isoUTC(selected).getUTCDay())
  const now = live ? nowET() : null
  const isDone = (it) => selected < todayET || (live && it.t <= now)
  const reporting = bmo.length + amc.length + tbd.length

  // ── week strip: the trading days of the selected week ──
  // Day tabs (owner 11-14, option B): Mon–Fri of the selected week, always five tabs (also
  // while a new week loads); week arrows step 7 days and keep the weekday.
  const monday = mondayISO(selected)
  const weekDays = useMemo(() => [0, 1, 2, 3, 4].map((i) => addDays(monday, i)), [monday])
  const thisWeek = monday === mondayISO(todayView)
  const dayCount = (iso) => {
    const d = week?.[iso]
    if (!d) return 0
    const lvl = (imp) => ({ low: 1, medium: 2, high: 3 }[imp] || 2)
    const econ = show.econ ? (d.econ || []).filter((e) => lvl(e.impact) >= econStars).length : 0
    const fed = show.fed ? (d.fed || []).filter((e) => lvl(e.impact) >= econStars).length : 0
    const earn = show.earn ? (d.bmo?.length || 0) + (d.amc?.length || 0) + (d.tbd?.length || 0) : 0
    return { n: econ + fed + earn, high: show.econ && (d.econ || []).some((e) => e.impact === 'high'), earn: earn > 0 }
  }

  const value = (it) => {
    if (it.kind === 'earn') return { text: topSyms(it.list), dim: true }
    if (it.kind === 'fed') return { text: '', dim: true }
    const e = it.e
    if (e.actual != null && e.actual !== '') return { text: e.actual, dim: false }
    if (e.estimate != null && e.estimate !== '') return { text: `est ${e.estimate}`, dim: true }
    return { text: '', dim: true }
  }
  const dot = (it) => {
    if (it.kind === 'earn') return styles.dotEarn
    if (it.kind === 'fed') return it.e.lvl >= 3 ? styles.dotHigh : styles.dotFed
    return it.e.lvl >= 3 ? styles.dotHigh : it.e.lvl === 2 ? styles.dotMed : styles.dotLow
  }

  const detail = (it) => {
    if (it.kind === 'earn') {
      return (
        <div className={styles.det}>
          {createElement(Earnings, { title: 'Reporters', iconName: it.icon, cls: '', items: it.list, imMap, mcapMap, onSelect: onRowSelect, selectedSym })}
        </div>
      )
    }
    const e = it.e
    return (
      <div className={styles.det}>
        {e.fed && e.note && <p className={styles.detP}>{e.note}</p>}
        {!e.fed && (e.estimate != null || e.prior != null || e.actual != null) && (
          <div className={styles.grid3}>
            <div><span>Estimate</span><b>{e.estimate ?? '—'}</b></div>
            <div><span>Prior</span><b>{e.prior ?? '—'}</b></div>
            <div><span>Actual</span><b className={e.actual == null ? styles.mut : ''}>{e.actual ?? (!isDone(it) && e.time ? `At ${e.time}` : '—')}</b></div>
          </div>
        )}
        <div className={styles.detMeta}>{IMPACT[e.lvl] || 'Medium'} impact{e.fed ? ' · Federal Reserve' : ''}</div>
      </div>
    )
  }

  const nowLine = <div className={styles.now} key="now"><span>{clock(now ?? 0)}</span><i /><b>Now</b></div>
  const rows = []
  let nowPlaced = !live
  for (const it of items) {
    if (!nowPlaced && it.t > now) { rows.push(nowLine); nowPlaced = true }
    const isOpen = open.has(it.id)
    const v = value(it)
    const t = it.label || clock(it.t)
    const ampm = it.label ? '' : (it.t >= 12 * 60 ? 'PM' : 'AM')
    rows.push(
      <div key={it.id} className={`${styles.row}${isDone(it) ? ' ' + styles.done : ''}${isOpen ? ' ' + styles.open : ''}`}>
        <span className={styles.time}>{t}<small>{ampm}</small></span>
        <span className={styles.rail}><i className={dot(it)} /></span>
        <div className={styles.main}>
          <div className={styles.head}>
            <span className={styles.name}>
              {it.kind === 'earn' ? it.title : it.e.event}
              {it.kind === 'fed' && <span className={styles.fed}>FED</span>}
            </span>
            {v.text && <span className={`${styles.val}${v.dim ? ' ' + styles.mut : ''}`}>{v.text}</span>}
          </div>
          {isOpen && detail(it)}
          <button type="button" className={styles.more} onClick={() => toggle(it.id)} aria-expanded={isOpen}>
            {isOpen ? 'Show less' : 'Show more'}
            <span className={styles.car}><UIcon name="chevronDown" size={11} gold={false} /></span>
          </button>
        </div>
      </div>,
    )
  }
  if (!nowPlaced) rows.push(nowLine)

  // ── title row: which week (+ a jump back to this week when away from it) ──
  const titleRow = (
    <div className={styles.dnav}>
      <span className={styles.date}>{narrow ? `${fmtShort(monday)}–${dayNum(addDays(monday, 4))}` : `Week of ${fmtShort(monday)}`}{!narrow && thisWeek && <span className={styles.today}>This week</span>}</span>
      {!thisWeek && <button type="button" className={styles.jump} onClick={() => setSelected(todayView)}>This week</button>}
    </div>
  )
  const controls = (
    <>
      <button type="button" data-cal-menu-btn className={`${styles.ic}${menu === 'filter' ? ' ' + styles.icOn : ''}`} onClick={() => setMenu((m) => (m === 'filter' ? null : 'filter'))} title="Filter events" aria-label="Filter events" aria-expanded={menu === 'filter'}><UIcon name="sliders" size={14} gold={false} /></button>
      {journalDoor && !narrow && (
        <button type="button" data-cal-menu-btn className={`${styles.ic} ${styles.icJournal}${menu === 'journal' ? ' ' + styles.icOn : ''}`} onClick={() => setMenu((m) => (m === 'journal' ? null : 'journal'))} title="Send this day to the Journal" aria-label="Send this day to the Journal" aria-expanded={menu === 'journal'}><UIcon name="journal" size={14} gold={false} /></button>
      )}
      <button ref={settingsBtnRef} type="button" className={`${styles.ic}${settingsOpen ? ' ' + styles.icOn : ''}`} data-guide="widget.settings" onClick={toggleSettings} title="Calendar settings" aria-label="Calendar settings"><UIcon name="gear" size={14} gold={false} /></button>
    </>
  )
  const check = (on) => <span className={styles.mck}>{on && <UIcon name="check" size={12} gold={false} />}</span>

  return (
    <div ref={rootRef} className={styles.root} style={rootStyle}>
      {createPortal(titleRow, uctRow)}
      {createPortal(controls, uctCtrls)}
      {settingsPanel}
      {captureMenu}
      {journalToast}

      {menu === 'filter' && (
        <div className={styles.menu} ref={menuRef} role="menu" style={menuVars}>
          <div className={styles.ml}>Economic data</div>
          {[[1, 'All events'], [2, 'Medium & high impact'], [3, 'High impact only']].map(([n, lab]) => (
            <button key={n} type="button" role="menuitemradio" aria-checked={econStars === n} className={styles.mi} onClick={() => setEconStars(n)} data-guide="calendar.stars">{check(econStars === n)}{lab}</button>
          ))}
          <div className={styles.msep} />
          <div className={styles.ml}>Show</div>
          {[['econ', 'Economic data'], ['fed', 'Fed speakers'], ['earn', 'Earnings']].map(([k, lab]) => (
            <button key={k} type="button" role="menuitemcheckbox" aria-checked={show[k]} className={styles.mi} onClick={() => setShow(k)}>{check(show[k])}{lab}</button>
          ))}
          {journalDoor && (
            <>
              <div className={styles.msep} />
              <div className={styles.ml}>Journal</div>
              <button type="button" role="menuitem" className={styles.mi} onClick={() => { setMenu(null); sendDayToJournal() }}><span className={styles.mck}><UIcon name="journal" size={12} gold={false} /></span>Send this day to the Journal</button>
              <button type="button" role="menuitem" className={styles.mi} onClick={(e) => { setMenu(null); openCaptureMenu(e) }}><span className={styles.mck}><UIcon name="chevronRight" size={12} gold={false} /></span>Choose where…</button>
            </>
          )}
        </div>
      )}
      {menu === 'journal' && (
        <div className={styles.menu} ref={menuRef} role="menu" style={menuVars}>
          <button type="button" role="menuitem" className={styles.mi} onClick={() => { setMenu(null); sendDayToJournal() }}><span className={styles.mck}><UIcon name="journal" size={12} gold={false} /></span>Send this day to the Journal<small>last note</small></button>
          <button type="button" role="menuitem" className={styles.mi} onClick={(e) => { setMenu(null); openCaptureMenu(e) }}><span className={styles.mck}><UIcon name="chevronRight" size={12} gold={false} /></span>Choose where…</button>
        </div>
      )}

      <div className={styles.tabs} data-guide="calendar.days">
        <button type="button" className={styles.arr} onClick={() => setSelected(addDays(selected, -7))} aria-label="Previous week" title="Previous week"><UIcon name="chevronLeft" size={13} gold={false} /></button>
        <div className={styles.tabRow} role="tablist" aria-label="Days this week">
          {weekDays.map((iso) => {
            const c = dayCount(iso)
            const isToday = iso === todayET
            return (
              <button key={iso} type="button" role="tab" aria-selected={iso === selected} className={styles.tab} onClick={() => setSelected(iso)}
                title={`${fmtDay(iso)}${c.n ? ` · ${c.n} ${c.n === 1 ? 'event' : 'events'}` : ''}${c.high ? ' · high-impact data' : ''}`}>
                {!narrow && <span className={styles.tabWd}>{fmtWd(iso)}</span>}
                <b className={isToday ? styles.tabToday : ''}>{dayNum(iso)}</b>
                {c.high && <i className={styles.tabDot} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
        <button type="button" className={styles.arr} onClick={() => setSelected(addDays(selected, 7))} aria-label="Next week" title="Next week"><UIcon name="chevronRight" size={13} gold={false} /></button>
      </div>

      <div className={styles.body} ref={listRef} tabIndex={0} onKeyDown={onListKeyDown}>
        {isLoading && !week && <div className={styles.empty}>Loading the calendar…</div>}
        {!isLoading && items.length === 0 && (
          <div className={styles.empty}>
            Nothing scheduled for {fmtDay(selected)}{econStars > 1 && show.econ ? ' at this impact level' : ''}.
          </div>
        )}
        {items.length > 0 && <div className={styles.tl}>{rows}</div>}
      </div>

      <div className={styles.foot}>
        <span className={styles.count}><b>{items.length}</b> {items.length === 1 ? 'event' : 'events'}{reporting > 0 && show.earn ? <> · <b>{reporting}</b> reporting</> : null}</span>
        <span className={styles.sp} />
        <a className={styles.fbtn} href={`/calendar?week=${selected}`} target="_blank" rel="noreferrer"><UIcon name="popOut" size={11} gold={false} /> Full calendar</a>
      </div>
    </div>
  )
}
