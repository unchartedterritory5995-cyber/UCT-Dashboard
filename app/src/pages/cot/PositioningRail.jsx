// app/src/pages/cot/PositioningRail.jsx
//
// The right-hand "Positioning" rail on the COT tab: a table of every trader
// group for ONE report week plus the plain-words read of what it means.
//
// It tracks the chart's hover through an imperative handle — `setIndex(i)`
// (absolute index into `rows`, null = latest). The parent calls it from a
// Chart.js onHover; state lives HERE so a mousemove re-renders this rail and
// nothing else. The four Chart.js instances in the parent must never re-render
// on hover (see CotData.jsx), which is why this is not a prop.
import { forwardRef, useImperativeHandle, useState, useEffect, useMemo } from 'react'
import styles from './PositioningRail.module.css'
import { computeSnapshot, buildRead, GROUPS } from './cotRead'
import { SERIES_COLORS } from './cotPalette'
import { fmtDate, fmtNum, fmtSignedCompact, fmtPct } from './cotFormat'

const TONE_CLASS = { bull: 'toneBull', bear: 'toneBear', neutral: 'toneNeutral' }

function Meter({ index, color }) {
  const pct = index == null ? null : Math.max(0, Math.min(100, index))
  return (
    <div className={styles.meterCell}>
      <div className={styles.meterTrack} style={{ '--c': color }} aria-hidden="true">
        {pct != null && (
          <>
            <div className={styles.meterFill} style={{ width: `${pct}%` }} />
            <div className={styles.meterMark} style={{ left: `${pct}%` }} />
          </>
        )}
      </div>
      <span className={styles.meterNum}>{pct == null ? '—' : Math.round(pct)}</span>
    </div>
  )
}

function Row({ color, label, net, wow, pctOi, index }) {
  const dir = wow == null || wow === 0 ? null : wow > 0 ? 'up' : 'down'
  return (
    <div className={styles.row} role="row">
      <div className={styles.cellLabel} role="cell">
        <span className={styles.dot} style={{ background: color }} />
        <span>{label}</span>
      </div>
      <div className={`${styles.cell} ${styles.cellNum}`} role="cell">{fmtNum(net)}</div>
      <div
        className={`${styles.cell} ${styles.cellNum} ${dir === 'up' ? styles.up : dir === 'down' ? styles.down : styles.flat}`}
        role="cell"
      >
        {fmtSignedCompact(wow)}
      </div>
      <div className={`${styles.cell} ${styles.cellNum}`} role="cell">{fmtPct(pctOi)}</div>
      <div className={styles.cell} role="cell"><Meter index={index} color={color} /></div>
    </div>
  )
}

const PositioningRail = forwardRef(function PositioningRail({ rows, symbol, name }, ref) {
  const [idx, setIdx] = useState(null)
  useImperativeHandle(ref, () => ({ setIndex: i => setIdx(i) }), [])

  // New symbol → snap back to the latest report.
  useEffect(() => { setIdx(null) }, [rows])

  const n = rows?.length || 0
  const absIdx = idx == null || idx >= n ? n - 1 : idx
  const snap = useMemo(() => (n ? computeSnapshot(rows, absIdx) : null), [rows, absIdx, n])
  const read = useMemo(() => (snap ? buildRead(snap, { symbol, name }) : null), [snap, symbol, name])

  if (!snap || !read) return null
  const isLatest = absIdx === n - 1
  const g = snap.groups

  return (
    <aside className={styles.rail} aria-label="COT positioning">

      {/* Which week */}
      <div className={styles.head}>
        <div className={styles.eyebrow}>Positioning</div>
        <div className={`${styles.when} ${isLatest ? '' : styles.whenScrub}`}>
          <span className={styles.whenLabel}>{isLatest ? 'Latest report' : 'Week of'}</span>
          <span className={styles.whenDate}>{fmtDate(snap.date)}</span>
        </div>
      </div>

      {/* Verdict tiles */}
      <div className={styles.verdicts}>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Contrarian bias</div>
          <div className={`${styles.tileValue} ${styles[TONE_CLASS[read.bias.tone]]}`}>
            {read.bias.label}
          </div>
          <div className={styles.tileSub}>
            {read.bias.strength ? `${read.bias.strength} signal · 3Y index` : 'no group at an extreme'}
          </div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>Crowding</div>
          <div className={`${styles.tileValue} ${styles[TONE_CLASS[read.crowding.tone]]}`}>
            {read.crowding.label}
          </div>
          <div className={styles.tileSub}>large specs · 3Y index {read.crowding.index}</div>
        </div>
      </div>

      {/* The table */}
      <div className={styles.table} role="table" aria-label="Net positioning by trader group">
        <div className={`${styles.row} ${styles.rowHead}`} role="row">
          <div className={styles.cellLabel} role="columnheader">Group</div>
          <div className={`${styles.cell} ${styles.cellNum}`} role="columnheader">Net</div>
          <div className={`${styles.cell} ${styles.cellNum}`} role="columnheader">WoW</div>
          <div className={`${styles.cell} ${styles.cellNum}`} role="columnheader">% OI</div>
          <div className={styles.cell} role="columnheader" title="Where this week sits inside the group's own 3-year range (0 = max short, 100 = max long)">3Y index</div>
        </div>
        {GROUPS.map(def => (
          <Row
            key={def.key}
            color={SERIES_COLORS[def.key]}
            label={def.short}
            net={g[def.key].net}
            wow={g[def.key].wow}
            pctOi={g[def.key].pctOi}
            index={g[def.key].index}
          />
        ))}
        <Row
          color={SERIES_COLORS.openInterest}
          label="Open Interest"
          net={snap.oi.value}
          wow={snap.oi.wow}
          pctOi={null}
          index={snap.oi.index}
        />
      </div>

      {/* The read */}
      <div className={styles.read}>
        <div className={styles.eyebrow}>What this means</div>
        <div className={styles.headline}>{read.headline}</div>
        <ul className={styles.points}>
          {read.points.map(p => (
            <li key={p.key} className={styles.point}>
              <span
                className={styles.pointDot}
                style={{ background: p.key === 'oi' ? SERIES_COLORS.openInterest : SERIES_COLORS[p.key] }}
              />
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
        <div className={styles.watch}>
          <div className={styles.watchLabel}>What to watch</div>
          <div className={styles.watchText}>{read.watch}</div>
        </div>
        {read.caveat && <div className={styles.fine}>{read.caveat}</div>}
        {read.note   && <div className={styles.fine}>{read.note}</div>}
      </div>

    </aside>
  )
})

export default PositioningRail
