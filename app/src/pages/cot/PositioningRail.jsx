// app/src/pages/cot/PositioningRail.jsx
//
// The right-hand "Positioning" rail on the COT tab: a table of every trader
// group for ONE report week plus the read of what it means — signals,
// a written weekly read (latest report only; grounded + cached server-side),
// the price check (positioning vs price), precedents (what happened the
// last times this setup showed up), and what to watch.
//
// It tracks the chart's hover through an imperative handle — `setIndex(i)`
// (absolute index into `rows`, null = latest). The parent calls it from a
// Chart.js onHover; state lives HERE so a mousemove re-renders this rail and
// nothing else. The four Chart.js instances in the parent must never re-render
// on hover (see CotData.jsx), which is why this is not a prop.
//
// No lookahead: everything shown for a scrubbed past week is computed from
// history up to that week only (the analog module enforces it for forward
// returns; the index windows end at the week by construction).
import { forwardRef, useImperativeHandle, useState, useMemo } from 'react'
import styles from './PositioningRail.module.css'
import { computeSnapshot, buildRead, GROUPS } from './cotRead'
import { computeAnalogs, HORIZONS } from './cotAnalogs'
import { detectDivergences } from './cotDivergence'
import { useCotNarrative } from './useCotNarrative'
import { narrativeFacts } from './cotFacts'
import { SERIES_COLORS } from './cotPalette'
import { fmtDate, fmtNum, fmtSignedCompact, fmtPct } from './cotFormat'

const TONE_CLASS  = { bull: 'toneBull', bear: 'toneBear', neutral: 'toneNeutral' }
const CHIP_CLASS  = { bull: 'chipBull', bear: 'chipBear', neutral: 'chipNeutral' }
const CHECK_CLASS = { bull: 'checkBull', bear: 'checkBear', caution: 'checkCaution', info: 'checkInfo' }

// "via USO (ETF proxy — roll drag)" → "ETF proxy — roll drag"; "via SPY" → "".
const proxyExtra = proxy => (proxy?.note || '').replace(/^via\s+\S+\s*/, '').replace(/^\(|\)$/g, '').trim()
const signedPct = v => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`)
const shortDate = iso => { const [y, m, d] = iso.split('-'); return `${parseInt(m)}/${parseInt(d)}/${y.slice(2)}` }

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

function Points({ points }) {
  return (
    <ul className={styles.points}>
      {points.map(p => (
        <li key={p.key} className={styles.point}>
          <span
            className={styles.pointDot}
            style={{ background: p.key === 'oi' ? SERIES_COLORS.openInterest : SERIES_COLORS[p.key] }}
          />
          <span>{p.text}</span>
        </li>
      ))}
    </ul>
  )
}

function Precedents({ analogs, proxy, symbol }) {
  if (!analogs) return null
  const { n, episodes, stats, reason, direction } = analogs
  const verb = direction === 'bear' ? 'lower' : direction === 'bull' ? 'higher' : 'up'
  const firstYear = episodes.length ? episodes[0].date.slice(0, 4) : null
  const dates = episodes.slice(-8)

  let empty = null
  if (reason === 'neutral') empty = 'No extreme to compare against — precedents appear once a group reaches the edge of its three-year range.'
  else if (n === 0) empty = 'This is the first time in the available history that both groups have sat where they sit now.'
  else if (reason === 'no-price') empty = `No liquid price proxy for ${symbol}, so only the dates of prior episodes are shown.`
  else if (reason === 'too-few') empty = `Only ${n} prior episode${n === 1 ? '' : 's'} — a pattern, not a sample. Shown for context, not for odds.`

  return (
    <div className={styles.section}>
      <div className={styles.eyebrow}>Precedents</div>
      {firstYear && !empty && (
        <div className={styles.sectionSub}>
          {n} prior episode{n === 1 ? '' : 's'} since {firstYear} · what {proxy?.ticker || 'price'} did next{proxyExtra(proxy) ? ` (${proxyExtra(proxy)})` : ''}
        </div>
      )}
      {empty && <div className={styles.precEmpty}>{empty}</div>}
      {!empty && (
        <div className={styles.precGrid}>
          {HORIZONS.map(h => {
            const s = stats[h] || {}
            const hitCls = s.hitRate == null ? '' : s.hitRate >= 60 ? styles.precHitBull : s.hitRate <= 40 ? styles.precHitBear : ''
            return (
              <div key={h} className={styles.precCell}>
                <div className={styles.precH}>{h} wks</div>
                <div className={`${styles.precHit} ${hitCls}`}>
                  {!s.n ? '—' : s.hits == null ? `${s.n} case${s.n === 1 ? '' : 's'}` : `${verb} ${s.hits} of ${s.n}`}
                </div>
                <div className={styles.precSub}>
                  {s.n ? `med ${signedPct(s.median)} · worst ${signedPct(direction === 'bear' ? s.best : s.worst)}` : 'no data yet'}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {dates.length > 0 && (
        <div className={styles.precDates}>
          {dates.map(e => {
            const v = e.fwd?.[13]
            const cls = v == null ? '' : v > 0 ? styles.precDateUp : v < 0 ? styles.precDateDown : ''
            return (
              <span key={e.idx} className={`${styles.precDate} ${cls}`} title={v == null ? 'no 13-week outcome yet' : `13 wks later: ${signedPct(v)}`}>
                {shortDate(e.date)}{v != null ? ` ${signedPct(v)}` : ''}
              </span>
            )
          })}
          {episodes.length > dates.length && <span className={styles.precDate}>+{episodes.length - dates.length} more</span>}
        </div>
      )}
    </div>
  )
}

const PositioningRail = forwardRef(function PositioningRail(
  { rows, symbol, name, bars = null, priceAligned = null, proxy = null },
  ref,
) {
  const [idx, setIdx] = useState(null)
  useImperativeHandle(ref, () => ({ setIndex: i => setIdx(i) }), [])

  // New rows (a new symbol) → snap back to the latest report. This is React's
  // "adjust state when a prop changes" idiom: the reset happens during render,
  // before children see the stale selection, with no effect and no extra pass.
  const [seenRows, setSeenRows] = useState(rows)
  if (seenRows !== rows) {
    setSeenRows(rows)
    setIdx(null)
  }

  const n = rows?.length || 0
  const absIdx = idx == null || idx >= n ? n - 1 : idx
  const isLatest = n > 0 && absIdx === n - 1

  const snap = useMemo(() => (n ? computeSnapshot(rows, absIdx) : null), [rows, absIdx, n])
  const read = useMemo(() => (snap ? buildRead(snap, { symbol, name }) : null), [snap, symbol, name])

  // Per-week snapshot memo shared by every analog search over the same rows.
  const snapCache = useMemo(() => ({ rows, arr: [] }), [rows]).arr
  const analogs = useMemo(() => {
    if (!snap || !read) return null
    return computeAnalogs(rows, bars || [], absIdx, { direction: read.bias.tone, snapshots: snapCache })
  }, [rows, bars, absIdx, snap, read, snapCache])

  const divergences = useMemo(
    () => (snap && priceAligned ? detectDivergences(rows, priceAligned, absIdx) : []),
    [rows, priceAligned, absIdx, snap],
  )

  // The written read is generated (and cached server-side) for the LATEST
  // report only; scrubbed weeks use the templated read.
  const facts = useMemo(
    () => (snap && read && isLatest ? narrativeFacts({ symbol, name, snap, read, analogs, divergences, proxy }) : null),
    [snap, read, isLatest, symbol, name, analogs, divergences, proxy],
  )
  const narrative = useCotNarrative({ symbol, name, reportDate: snap?.date, facts, enabled: !!facts })

  if (!snap || !read) return null
  const g = snap.groups
  const signals = read.signals || []
  const showNarrative = isLatest && narrative.status === 'ok'
  const narrativeLoading = isLatest && narrative.status === 'loading'

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

      {/* Signals */}
      {signals.length > 0 && (
        <div className={styles.chips} aria-label="Positioning signals">
          {signals.map(s => (
            <span key={s.key} className={`${styles.chip} ${styles[CHIP_CLASS[s.tone]] || ''}`} title={s.text}>
              {s.label}
            </span>
          ))}
        </div>
      )}

      {/* The read */}
      <div className={styles.section}>
        <div className={styles.eyebrow}>{showNarrative || narrativeLoading ? "This week's read" : 'What this means'}</div>
        <div className={styles.headline}>{read.headline}</div>
        {narrativeLoading && (
          <div className={styles.narrativeSkeleton} aria-label="Writing this week's read">
            <span /><span /><span /><span /><span />
          </div>
        )}
        {showNarrative && (
          <>
            <div className={styles.narrative}>
              {narrative.text.split(/\n\s*\n/).map((p, i) => <p key={i}>{p.trim()}</p>)}
            </div>
            <details className={styles.details}>
              <summary>Group by group</summary>
              <Points points={read.points} />
            </details>
          </>
        )}
        {!showNarrative && !narrativeLoading && <Points points={read.points} />}
      </div>

      {/* Price check */}
      {divergences.length > 0 && (
        <div className={styles.section}>
          <div className={styles.eyebrow}>Price check</div>
          {proxy && <div className={styles.sectionSub}>{proxy.note}</div>}
          {divergences.map(d => (
            <div key={d.key} className={styles.checkItem}>
              <span className={`${styles.checkDot} ${styles[CHECK_CLASS[d.tone]] || ''}`} />
              <span>
                <span className={styles.checkLabel}>{d.label}</span>
                {d.text}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Precedents */}
      <Precedents analogs={analogs} proxy={proxy} symbol={symbol} />

      {/* Action */}
      <div className={styles.watch}>
        <div className={styles.watchLabel}>What to watch</div>
        <div className={styles.watchText}>{read.watch}</div>
      </div>

      {read.classNote && <div className={styles.fine}>{read.classNote}</div>}
      {read.caveat && <div className={styles.fine}>{read.caveat}</div>}
      {read.note   && <div className={styles.fine}>{read.note}</div>}

    </aside>
  )
})

export default PositioningRail
