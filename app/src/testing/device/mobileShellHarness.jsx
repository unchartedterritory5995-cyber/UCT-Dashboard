/* THE AUTHENTICATED-LOOP SUBSTITUTE — the real phone shell, on real hardware,
 * with no login and no server.
 *
 * ⛔ WHAT THIS IS NOT. It is not an authentication bypass. There is no backend
 * in the picture at all: `fetch` is replaced in-page with canned responses, so
 * nothing here can reach, read or alter any real account or any real data. It
 * is a component harness — the same category as the `vi.mock` every suite in
 * this repo uses — mounted as its own vite entry so a phone can load it.
 *
 * ⭐ WHY IT EXISTS. Real-device validation of the phone shell was the previous
 * sprint's evidence ceiling, blocked by two facts measured on hardware: the
 * BrowserStack account is capped at ONE MINUTE per device, and the device
 * arrives at the dev server as `bs-local.com` — a different host from the
 * sandbox's `127.0.0.1` — so it carries no session and lands on a login form.
 * Entering a password is a prohibited action, and inventing a way past the form
 * would be worse than the gap.
 *
 * So the gap is closed from the other side: mount `MobileChartsApp` ITSELF —
 * the actual shell, its actual sheets, the actual StockChart and drawing
 * overlay — and give it stubbed data instead of a stubbed identity. Everything
 * the login form was blocking (the scale menu, the price-context sheet,
 * Layouts, Drawing boards, the crosshair readout, the drawing bar) is a
 * FRONTEND behaviour and is therefore fully exercisable here.
 *
 * ⛔ WHAT IT STILL CANNOT ANSWER, stated so nobody reads more into a green run:
 * anything that depends on a real server round-trip — that a layout saved on a
 * phone reappears on a desktop, that alerts actually fire, that preferences
 * survive a real session. Those need the logged-in app and remain residual.
 */
import { StrictMode, useCallback, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
// Context only. `useFlagged` (via ChartPane) calls `useAuth`, and the provider
// resolves against the stubbed `/api/auth/me` above — a harness identity that
// authorises nothing, because there is no server to authorise against.
import { AuthProvider } from '../../context/AuthContext'
import { WorkspaceContext } from '../../pages/charts/WorkspaceContext'
import { frozenWorkspaceValue } from '../../pages/journal-2-0/components/notebook/frozenWorkspace'
import MobileChartsApp from '../../pages/charts/mobile/MobileChartsApp'
import bars200 from '../../pages/parityBars/ramp200.json'
import '../../index.css'

// ─── the stubbed data boundary ──────────────────────────────────────────────
//
// ⛔ NO PROXY TO ANY BACKEND. Earlier device work pointed the dev server's
// `/api` at the local sandbox; that is what put a login form in front of the
// phone. Answering in-page removes the backend from the picture entirely, which
// is both the fix and the safety property.
// ⭐ SEEDED, and the reason matters. The phone legend is crosshair-gated with
// `legendMode: 'click'` by default, and driving lightweight-charts' own click
// subscription with synthetic events is unreliable — a device step that hangs
// waiting for a legend tells you nothing about the legend. What the device run
// needs to answer is what the readout CONTAINS on real hardware ($ Vol, Avg ND,
// no overflow), so the mode is seeded to 'always' and the readout is present
// deterministically. The click-to-pin GESTURE is covered by `legendModes.test.jsx`.
const PREFS = {
  chart_settings: JSON.stringify({ header: { legendMode: 'always' } }),
}
const json = (body) => Promise.resolve({
  ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)),
})

window.fetch = (input, init) => {
  const url = String(typeof input === 'string' ? input : (input && input.url) || '')
  const method = ((init && init.method) || 'GET').toUpperCase()

  if (url.includes('/api/bars/')) return json({ bars: bars200.bars })
  if (url.includes('/api/auth/preferences')) {
    if (method === 'POST') {
      try {
        const b = JSON.parse(init.body)
        PREFS[b.key] = b.value
      } catch { /* a malformed body is the caller's bug, not this stub's */ }
      return json({ ok: true })
    }
    return json({ preferences: { ...PREFS } })
  }
  // A harness identity, so plan-gated UI renders its real branch. It authorises
  // nothing: there is no server to authorise against.
  if (url.includes('/api/auth/me')) {
    return json({ user: { id: 1, email: 'device-harness@local', display_name: 'Harness', role: 'admin' }, plan: 'paid' })
  }
  if (url.includes('/api/watchlists')) return json({ watchlists: [] })
  if (url.includes('/api/watchlist-alerts')) return json({ alerts: [] })
  if (url.includes('/api/ticker-search')) return json({ results: [{ ticker: 'NVDA', name: 'NVIDIA Corporation' }] })
  return json({})
}

// ─── the workspace context ──────────────────────────────────────────────────
//
// ⛔ BUILT FROM `frozenWorkspaceValue()`, NOT HAND-ROLLED. The real provider
// carries members `WorkspaceContext`'s own FALLBACK omits, and a member falling
// through to undefined is a silent dead end — the trap that file's header
// documents. Starting from the frozen value inherits its completeness AND its
// by-name drift rail; only the two members that must be LIVE here (a harness
// has to be able to change symbol) are overridden.
function useHarnessWorkspace(sym, setSym) {
  return useMemo(() => ({
    ...frozenWorkspaceValue({ symbol: sym }),
    groupSyms: { A: sym, B: sym, C: sym, D: sym },
    setGroupSym: (_color, next) => setSym(next),
  }), [sym, setSym])
}

// ⛔ THE SETTINGS LIVE ON THE WIDGET, NOT IN `chart_settings`. The global pref is
// only a SEED; the authority for a chart on this surface is
// `charts_workspace_layout → widgets[].opts.settings`. Seeding the pref alone
// left the legend on its default 'click' mode and the readout never appeared —
// the harness looked broken when it was reading the wrong authority.
const CHART_WIDGET = {
  id: 'w-chart',
  type: 'chart',
  color: 'A',
  opts: { tf: 'D', settings: { header: { legendMode: 'always' } } },
}

const LAYOUTS_MINE = [
  { id: 'L1', name: 'Swing board', layout: { widgets: [CHART_WIDGET] } },
  { id: 'L2', name: 'Scalp board', layout: { widgets: [CHART_WIDGET] } },
]
const LAYOUTS_PREBUILT = [
  { id: 'P1', name: 'UCT Default', layout: { widgets: [CHART_WIDGET] }, scope: 'global' },
]

function Harness() {
  const [sym, setSym] = useState('SPY')
  const [widgets, setWidgets] = useState([CHART_WIDGET])
  const workspace = useHarnessWorkspace(sym, setSym)
  const savedRef = useRef([])

  const onOptsChange = useCallback((id, opts) => {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, opts: { ...w.opts, ...opts } } : w)))
  }, [])

  return (
    <WorkspaceContext.Provider value={workspace}>
      <MobileChartsApp
        widgets={widgets}
        onRemove={() => {}}
        onColorChange={() => {}}
        onOptsChange={onOptsChange}
        onAddWidget={(t) => setWidgets((ws) => [...ws, { id: `w-${t}-${ws.length}`, type: t, color: 'A', opts: {} }])}
        layoutsMine={LAYOUTS_MINE}
        layoutsPrebuilt={LAYOUTS_PREBUILT}
        layoutsActive={LAYOUTS_MINE[0]}
        layoutsLoading={false}
        isAdmin
        onApplyLayout={(l) => { savedRef.current.push(['apply', l && l.id]) }}
        onApplyUctDefault={() => { savedRef.current.push(['applyDefault']) }}
        onSaveLayout={() => { savedRef.current.push(['save']) }}
        onSaveLayoutAs={(name, scope) => { savedRef.current.push(['saveAs', name, scope]) }}
        onDeleteLayout={(id) => { savedRef.current.push(['delete', id]) }}
      />
    </WorkspaceContext.Provider>
  )
}

createRoot(document.getElementById('shell')).render(
  <StrictMode>
    {/* MemoryRouter: several chart-surface children reach for router context.
        A memory history keeps the harness self-contained — no URL to get wrong. */}
    <MemoryRouter initialEntries={['/charts']}>
      <AuthProvider>
        <Harness />
      </AuthProvider>
    </MemoryRouter>
  </StrictMode>,
)

// The step script lives in its own module so this file stays "mount the shell"
// and that one stays "drive it".
import('./shellSteps').then((m) => m.start()).catch((err) => {
  const el = document.getElementById('verdicts')
  if (el) el.textContent = 'step script failed to load: ' + ((err && err.message) || err)
})
