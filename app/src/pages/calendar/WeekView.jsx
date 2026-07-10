// app/src/pages/calendar/WeekView.jsx
// The ranked logo mosaic — ten-second triage. Load-proportional columns
// (Monday's 2 names never stretch to Thursday's 40), stacked session groups
// (the side-by-side BMO|AMC split that wasted half of every column is dead),
// and every row carries exactly one datum: gold ±move% on featured names,
// dim market cap on the rest. Ordered by personalized importance, mine first.
import { useMemo } from 'react'
import CompanyLogo from '../../components/CompanyLogo'
import UIcon from '../../components/ui/UIcon'
import { applyFilters, sortEntries } from './filterLogic'
import { impEff } from './importance'
import styles from './Calendar.module.css'

const MAX_ROWS_PER_SESSION = 8

function fmtCap(v) {
  if (v == null || v <= 0) return null
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : v >= 1 ? `$${Math.round(v)}B` : `$${Math.round(v * 1000)}M`
}

function WeekRow({ e, isFeatured, onSelect }) {
  const em = e.expected_move?.pct
  // ONE datum per row, labeled by tier: featured → the move the options
  // market prices; default → size. Never a bare zero-data 19px ticker again.
  const datum = isFeatured && em != null
    ? <span className={styles.wDatumEm}>±{em}%</span>
    : e.mc_b != null
      ? <span className={styles.wDatumCap}>{fmtCap(e.mc_b)}</span>
      : em != null
        ? <span className={styles.wDatumEm}>±{em}%</span>
        : null
  return (
    <div className={styles.wrow} onClick={() => onSelect(e, e._timing)}>
      <CompanyLogo sym={e.sym} size={isFeatured ? 24 : 20} tile />
      <span className={`${styles.wSym} ${isFeatured ? styles.wSymFeat : ''} ${e.mine ? styles.gold : ''}`}>
        {e.sym}
        {e.mine && <UIcon name="star-fill" size={9} style={{ marginLeft: 3, verticalAlign: '0px' }} />}
      </span>
      {datum}
    </div>
  )
}

function WeekSessionGroup({ label, icon, hdClass, rows, tiers, onSelect, onMore, moreCount }) {
  // An empty session renders NOTHING — no header, no dash.
  if (!rows.length) return null
  const isFeat = e => tiers && (tiers.mainEvent === e.sym || tiers.featured?.has(e.sym))
  return (
    <div className={styles.wgroup}>
      <div className={`${styles.wgroupHd} ${hdClass}`}>
        <span aria-hidden="true"><UIcon name={icon} size={12} /></span> {label}
        <span className={styles.timedCount}>{rows.length + moreCount}</span>
      </div>
      {rows.map(e => (
        <WeekRow key={`${e.sym}-${e._timing}`} e={e} isFeatured={isFeat(e)} onSelect={onSelect} />
      ))}
      {moreCount > 0 && (
        <button className={styles.wMore} onClick={onMore}>+{moreCount} more</button>
      )}
    </div>
  )
}

// Compact macro strip in the column header — the glance view finally carries
// the day's key economic events.
function WeekMacroChips({ econ = [], fed = [] }) {
  const key = econ.filter(e => e.is_key).slice(0, 2)
  const fedN = fed.length
  if (!key.length && !fedN) return null
  return (
    <div className={styles.wMacro}>
      {key.map((ev, i) => (
        <span key={i} className={styles.wMacroChip} title={`${ev.time || ''} ${ev.event}${ev.estimate ? ` · est ${ev.estimate}` : ''}`}>
          {ev.event.length > 14 ? `${ev.event.slice(0, 13)}…` : ev.event}
        </span>
      ))}
      {fedN > 0 && (
        <span className={styles.wMacroChipFed} title={fed.map(f => `${f.time || ''} ${f.event}`).join('\n')}>
          <UIcon name="mic" size={10} style={{ verticalAlign: '-1px', marginRight: 3 }} />{fedN}
        </span>
      )}
    </div>
  )
}

export default function WeekView({ weekDates, days, filters, onSelect, weekTiers, onOpenDay }) {
  // Load-proportional columns: each day's track grows with its reporter count.
  const counts = useMemo(() => weekDates.map(ds => {
    const d = days[ds]
    if (!d) return 1
    const all = [...(d.bmo || []), ...(d.amc || []), ...(d.tbd || [])]
    return Math.max(applyFilters(all, filters).length, 1)
  }), [weekDates, days, filters])

  const template = counts
    .map(c => `minmax(150px, ${Math.max(Math.sqrt(c), 1).toFixed(2)}fr)`)
    .join(' ')

  return (
    // The fr template rides a CSS VARIABLE, not gridTemplateColumns directly —
    // an inline grid-template-columns beats the 640px media query (specificity),
    // which forced the 5-column desktop template onto phones = horizontal
    // overflow. A custom property lets the phone rule override cleanly.
    <div className={styles.weekgrid} style={{ '--week-cols': template }}>
      {weekDates.map(ds => {
        const day = days[ds]; if (!day) return null
        const tiers = weekTiers?.[ds]
        const impOf = e => impEff(tiers?.impBySym?.get?.(e.sym) ?? 0, e)
        const prep = (list, timing) => {
          let rows = applyFilters((list || []).map(e => ({ ...e, _timing: timing })), filters)
          rows = sortEntries(rows, filters.sort)
          // mine pinned first, then personalized importance
          rows.sort((a, b) => (b.mine === true) - (a.mine === true) || impOf(b) - impOf(a))
          return rows
        }
        const bmo = prep(day.bmo, 'bmo')
        const amc = prep(day.amc, 'amc')
        const tbd = prep(day.tbd, 'tbd')
        const empty = !bmo.length && !amc.length && !tbd.length
        const openDrawer = () => onOpenDay?.(ds)
        return (
          <div key={ds} className={`${styles.wcol} ${day.is_today ? styles.wcolToday : ''}`}>
            <div className={styles.wd}>
              {day.label || ds}
              <span className={styles.wdCount}>{bmo.length + amc.length + tbd.length}</span>
            </div>
            <WeekMacroChips econ={day.econ} fed={day.fed} />
            {empty ? (
              <div className={styles.wempty}>
                <span className={styles.wemptyDot} aria-hidden="true" />
                No earnings
              </div>
            ) : (
              <>
                <WeekSessionGroup label="BMO" icon="sparkle" hdClass={styles.bmoHd}
                  rows={bmo.slice(0, MAX_ROWS_PER_SESSION)} tiers={tiers} onSelect={onSelect}
                  onMore={openDrawer} moreCount={Math.max(bmo.length - MAX_ROWS_PER_SESSION, 0)} />
                <WeekSessionGroup label="AMC" icon="moon" hdClass={styles.amcHd}
                  rows={amc.slice(0, MAX_ROWS_PER_SESSION)} tiers={tiers} onSelect={onSelect}
                  onMore={openDrawer} moreCount={Math.max(amc.length - MAX_ROWS_PER_SESSION, 0)} />
                <WeekSessionGroup label="TIME TBD" icon="clock" hdClass={styles.tbdHd}
                  rows={tbd.slice(0, MAX_ROWS_PER_SESSION)} tiers={tiers} onSelect={onSelect}
                  onMore={openDrawer} moreCount={Math.max(tbd.length - MAX_ROWS_PER_SESSION, 0)} />
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
