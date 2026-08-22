// app/src/pages/InternalsRender.jsx — headless, token-gated Market-Internals export.
//
// Renders the app's REAL breadth visuals for the Morning Wire → Substack newsletter,
// so the internals block can use dashboard widgets instead of (or alongside) the
// matplotlib panel. Variants (?variant=):
//   exposure  — the UCT Exposure Rating tile (MarketBreadth + MA relationship)
//   treemap   — the breadth heatmap (TreemapView)
//   combo     — exposure tile above the treemap
//
// Public route (no AuthGuard). ?token= is checked against VITE_CHART_RENDER_TOKEN and
// forwarded to the API.
//
// ⛔ Reads /api/r/breadth + /api/r/breadth-monitor, NOT the bare paths. Both bare
// endpoints went behind `require_paid` in 9ff74f69 (2026-08-09) and this page renders
// logged-OUT. ⚠️ Note both fetches below fall back to `{}` / `{rows: []}` on a
// non-ok response — that is what turned a 401 into a silently BLANK panel rather than
// an error, for a week. Keep the soft fallback (a half-rendered panel beats none) but
// remember it means THIS PAGE CANNOT REPORT ITS OWN AUTH FAILURE: verify a change
// here by looking at the rendered image, never by the absence of an exception.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import MarketBreadth from '../components/tiles/MarketBreadth'
import TreemapView from './breadth/views/TreemapView'
import { TREEMAP_DEF } from './breadth/heatmapMetrics'
import uctLogo from '../components/intro/assets/compass-mark.png'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''
// Newsletter export: drop treemap tiles that DUPLICATE the live exposure card
// directly above it (score/exposure/index closes). The treemap reads yesterday's
// breadth-collector snapshot, so those tiles can contradict the live card inside
// one image (hero "38" vs tile "43", QQQ 688 vs 691) — the rest of the metrics
// have no live twin and stay. The real /breadth page is untouched.
const NEWSLETTER_DUP_KEYS = new Set(['breadth_score', 'uct_exposure', 'sp500_close', 'qqq_close'])
const VISIBLE_KEYS = new Set(
  (TREEMAP_DEF?.[0]?.items || []).map((i) => i.metricKey).filter((k) => !NEWSLETTER_DUP_KEYS.has(k)),
)

function Panel({ title, w, children, footer }) {
  return (
    <div id="panel-export" style={{ width: w, background: '#0a0a0a', color: '#fff', fontFamily: "'Instrument Sans',-apple-system,'Segoe UI',sans-serif" }}>
      <div style={{ height: 44, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', position: 'relative' }}>
        <span style={{ color: '#e8e8e8', fontWeight: 800, fontSize: 15, letterSpacing: '0.6px' }}>{title}</span>
        <span style={{ position: 'absolute', right: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src={uctLogo} alt="" style={{ height: 18, opacity: 0.95 }} />
          <span style={{ color: '#c9a84c', fontWeight: 700, fontSize: 12, letterSpacing: '0.6px' }}>UCT INTELLIGENCE</span>
        </span>
      </div>
      <div style={{ padding: '16px 18px' }}>{children}</div>
      <div style={{ height: 22, background: '#161616', display: 'flex', alignItems: 'center', padding: '0 18px', color: '#666', fontSize: 10 }}>
        <span>{footer}</span>
        <span style={{ marginLeft: 'auto', color: '#c9a84c' }}>uctintelligence.com</span>
      </div>
    </div>
  )
}

export default function InternalsRender() {
  const [sp] = useSearchParams()
  const token = sp.get('token') || ''
  const variant = (sp.get('variant') || 'exposure').toLowerCase()
  const w = Math.min(1200, Math.max(560, parseInt(sp.get('w') || '860', 10)))
  const [breadth, setBreadth] = useState(null)
  const [row, setRow] = useState(null)
  const [err, setErr] = useState('')

  const needBreadth = variant === 'exposure' || variant === 'combo'
  const needRow = variant === 'treemap' || variant === 'combo'

  useEffect(() => {
    window.__panelReady = false
    if (TOKEN && token !== TOKEN) { setErr('unauthorized'); return }
    const jobs = []
    if (needBreadth) {
      jobs.push(fetch(`/api/r/breadth?token=${encodeURIComponent(token)}`).then((r) => (r.ok ? r.json() : {})).then(setBreadth).catch(() => setBreadth({})))
    } else setBreadth({})
    if (needRow) {
      jobs.push(
        fetch(`/api/r/breadth-monitor?days=10&token=${encodeURIComponent(token)}`)
          .then((r) => (r.ok ? r.json() : { rows: [] }))
          .then((d) => {
            const rows = (d.rows || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
            setRow(rows[rows.length - 1] || null)
          })
          .catch(() => setRow(null)),
      )
    } else setRow(null)
    Promise.allSettled(jobs)
  }, [variant]) // eslint-disable-line react-hooks/exhaustive-deps

  const ready = (!needBreadth || breadth != null) && (!needRow || row !== undefined)
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => { window.__panelReady = true }, 2600) // ECharts + fonts settle
    return () => clearTimeout(t)
  }, [ready])

  if (err) return <div style={{ color: '#e74c3c', padding: 20 }}>{err}</div>
  if (!ready) return <div style={{ color: '#888', padding: 20 }}>Loading…</div>

  const exposureBlock = (
    <div style={{ maxWidth: w - 36 }}>
      <MarketBreadth data={breadth || {}} />
    </div>
  )
  const treemapBlock = (
    <div style={{ width: w - 36, height: 460 }}>
      {row ? (
        <TreemapView currentRow={row} pctileByKey={{}} visibleKeys={VISIBLE_KEYS} options={{ weightBy: 'curated' }} />
      ) : (
        <div style={{ color: '#888', padding: 12 }}>No breadth-monitor data.</div>
      )}
    </div>
  )

  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh' }}>
      {/* Neutralize the app grid/margins so the tile renders full-width in the shot. */}
      <style>{`#panel-export [class*="tileCard" i]{margin:0 !important;width:100% !important}`}</style>
      {variant === 'treemap' && (
        <Panel title="MARKET INTERNALS — BREADTH HEATMAP" w={w} footer="Breadth heatmap">{treemapBlock}</Panel>
      )}
      {variant === 'exposure' && (
        <Panel title="MARKET INTERNALS — UCT EXPOSURE" w={w} footer="UCT Exposure Rating">{exposureBlock}</Panel>
      )}
      {variant === 'combo' && (
        <Panel title="MARKET INTERNALS" w={w} footer="UCT Exposure + breadth heatmap">
          {exposureBlock}
          <div style={{ height: 14 }} />
          {treemapBlock}
        </Panel>
      )}
    </div>
  )
}
