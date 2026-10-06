import { useState } from 'react'
import useDarkSection from './useDarkSection'
import { volPts } from './optionsFormat'
import styles from './optionsAnalytics.module.css'

// FT-018 (lane/o-options-remainders) under Research > Options:
//   RrBfTable   25-delta / 10-delta risk reversal and butterfly per tenor  (OPTIONS_VOL_RR_BF_ENABLED)
//   Surface3D   the vol surface's strike x expiry grid as a 3D mesh         (OPTIONS_VOL_SURFACE_3D_ENABLED)
// (api/services/options_analytics/vol_skew.py)
//
// ⛔ Each is its OWN dark surface; a 404 or 402 renders nothing.
// ⛔ A value the quotes do not reach is a dash with its reason, never extrapolated.
// ⛔ The 3D view is plain SVG (no new dependency): a fixed axonometric projection, painter-sorted.
//    A blank grid cell stays a hole in the mesh, never interpolated.

const enc = encodeURIComponent
const vp = (v) => volPts(v)
const signed = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${volPts(v, 2)}`)

export function RrBfTable({ sym }) {
  const { data, hidden, failed } = useDarkSection(sym ? `/api/options/vol/${enc(sym)}/rr-bf` : null)
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.tenors))) return null
  return (
    <section className={styles.panel} data-testid="rr-bf">
      <div className={styles.head}>
        <span className={styles.title}>Risk reversal and butterfly by tenor</span>
        <span className={styles.badge}>computed</span>
      </div>
      {failed ? <p className={styles.note}>The RR/BF table is unavailable right now.</p> : (
        <>
          <div className={styles.scroll}>
            <table className={styles.table} data-testid="rr-bf-table">
              <thead>
                <tr><th>Expiry</th><th>DTE</th><th>ATM IV</th><th>25Δ RR</th><th>25Δ BF</th><th>10Δ RR</th><th>10Δ BF</th></tr>
              </thead>
              <tbody>
                {data.tenors.map((t) => (
                  <tr key={t.expiration}>
                    <th>{t.expiration}</th><td>{t.dte}</td><td>{vp(t.atm_iv)}</td>
                    <td title={t.reason_25d || undefined}>{signed(t.rr_25d)}</td><td title={t.reason_25d || undefined}>{signed(t.bf_25d)}</td>
                    <td title={t.reason_10d || undefined}>{signed(t.rr_10d)}</td><td title={t.reason_10d || undefined}>{signed(t.bf_10d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.tenors.filter((t) => t.reason_25d || t.reason_10d).map((t) => (
            <p key={`why-${t.expiration}`} className={styles.muted} data-testid="rr-bf-reason">
              {t.expiration}: {[t.reason_25d && `25Δ: ${t.reason_25d}`, t.reason_10d && `10Δ: ${t.reason_10d}`].filter(Boolean).join(' · ')}
            </p>
          ))}
          <p className={styles.muted}>Vol points (IV x 100). {data.method} {data.strikes_note} {data.iv_source_text}</p>
        </>
      )}
    </section>
  )
}

const W = 640
const H = 340
const VIEWS = [['front', 'Front'], ['side', 'Side'], ['top', 'High']]
const ANGLES = { front: [-0.6, 0.35], side: [-1.1, 0.35], top: [-0.6, 0.7] }

/** Project the grid: returns {quads:[{d, iv}], zMin, zMax} or null when fewer than 2x2 points. */
export function meshQuads(strikes, exps, z, view = 'front') {
  if (!strikes?.length || !exps?.length || strikes.length < 2 || exps.length < 2) return null
  const flat = z.flat().filter((v) => v != null)
  if (flat.length < 4) return null
  const zMin = Math.min(...flat)
  const zMax = Math.max(...flat)
  const [yaw, pitch] = ANGLES[view] || ANGLES.front
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const P = (i, j, v) => {
    const x = i / (strikes.length - 1) - 0.5
    const y = j / (exps.length - 1) - 0.5
    const h = zMax === zMin ? 0 : (v - zMin) / (zMax - zMin)
    const rx = x * cy - y * sy
    const ry = x * sy + y * cy
    return [W / 2 + rx * W * 0.62, H * 0.62 + ry * H * 0.5 * pitch * 2 - h * H * 0.45, ry]
  }
  const quads = []
  for (let i = 0; i < strikes.length - 1; i += 1) {
    for (let j = 0; j < exps.length - 1; j += 1) {
      const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => [a, b, z[a]?.[b]])
      if (c.some(([, , v]) => v == null)) continue
      const pts = c.map(([a, b, v]) => P(a, b, v))
      quads.push({
        d: `M${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')} Z`,
        iv: c.reduce((s, [, , v]) => s + v, 0) / 4,
        depth: pts.reduce((s, p) => s + p[2], 0) / 4,
      })
    }
  }
  quads.sort((a, b) => a.depth - b.depth)
  return { quads, zMin, zMax }
}

export function Surface3D({ sym }) {
  const { data, hidden, failed } = useDarkSection(sym ? `/api/options/vol/${enc(sym)}/surface-3d` : null)
  const [view, setView] = useState('front')
  if (hidden || (!data && !failed) || (data && !Array.isArray(data.z))) return null
  const m = data ? meshQuads(data.strikes, data.expirations, data.z, view) : null
  return (
    <section className={styles.panel} data-testid="surface-3d">
      <div className={styles.head}>
        <span className={styles.title}>Volatility surface, 3D</span>
        <span className={styles.badge}>vendor IV</span>
        <span className={styles.seg} role="group" aria-label="Surface angle">
          {VIEWS.map(([k, l]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{l}</button>)}
        </span>
      </div>
      {failed ? <p className={styles.note}>The 3D surface is unavailable right now.</p> : (
        <>
          {m ? (
            <svg className={styles.chart} viewBox={`0 0 ${W} ${H}`} role="img" data-testid="surface-3d-mesh"
              aria-label={`Implied volatility from ${vp(m.zMin)} to ${vp(m.zMax)} across ${data.strikes.length} strikes and ${data.expirations.length} expirations`}>
              {m.quads.map((q, k) => {
                const t = m.zMax === m.zMin ? 0.5 : (q.iv - m.zMin) / (m.zMax - m.zMin)
                return <path key={k} d={q.d} className={styles.mesh}
                  style={{ fill: `color-mix(in srgb, var(--loss) ${Math.round(t * 100)}%, var(--gain))`, fillOpacity: 0.75 }} />
              })}
            </svg>
          ) : <p className={styles.note}>Too few quoted cells to draw a surface.</p>}
          <p className={styles.facts} data-testid="surface-3d-facts">
            IV {vp(m?.zMin)} (green) to {vp(m?.zMax)} (red) · {data.cells_filled} of {data.cells_total} cells quoted
            {' '}· strikes {data.strikes[0]}–{data.strikes[data.strikes.length - 1]} · {data.expirations.length} expirations
          </p>
          <p className={styles.muted}>{data.note} {data.side_rule} {data.iv_source_text}</p>
        </>
      )}
    </section>
  )
}

export default function VolSkewPanels({ sym }) {
  return <><RrBfTable sym={sym} /><Surface3D sym={sym} /></>
}
