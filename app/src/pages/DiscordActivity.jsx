import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChartPane from '../components/chart/pane/ChartPane'

// ── /r/activity — the interactive chart INSIDE Discord ──────────────────────
//
// A Discord Activity: Discord loads this route in an iframe through its proxy
// (https://<app id>.discordsays.com/r/activity?instance_id=…&channel_id=…&
// guild_id=…&frame_id=…). It mounts the real ChartPane — pan, zoom, crosshair,
// the timeframe bar, the settings gear — the same component the Charts widget
// and TickerPopup use. Logged out by design (no dashboard cookie survives the
// proxy); bars, ticker search and meta are public endpoints.
//
// Which chart to open: a launch carries NO parameters, so the "Open in Discord"
// button under a chart records a per-channel handoff server-side and this page
// asks for the channel's newest one (GET /api/discord/activity/handoff). No
// handoff → the last symbol this browser used, else SPY.
//
// Outside Discord (no frame_id in the URL) the page renders the same chart, so
// it can be opened in a normal tab — that is how it is tested first. The
// Embedded App SDK handshake (`ready()`) runs only inside the frame; it is
// best-effort and never blocks the chart.

const LAST_SYM_KEY = 'uct.activity.sym'
const DEFAULT_SYM = 'SPY'
const TF_CODES = ['1', '5', '15', '30', '60', 'D', 'W', 'M']

export function launchContext(search) {
  const sp = new URLSearchParams(search || '')
  return {
    inDiscord: sp.has('frame_id'),
    channelId: sp.get('channel_id') || '',
    guildId: sp.get('guild_id') || '',
    instanceId: sp.get('instance_id') || '',
  }
}

function readLastSym() {
  try { return (localStorage.getItem(LAST_SYM_KEY) || '').toUpperCase() || null } catch { return null }
}
function writeLastSym(sym) {
  try { localStorage.setItem(LAST_SYM_KEY, String(sym || '').toUpperCase()) } catch { /* private mode */ }
}

export default function DiscordActivity() {
  const ctx = useMemo(() => launchContext(typeof window !== 'undefined' ? window.location.search : ''), [])
  const [sym, setSym] = useState(() => readLastSym() || DEFAULT_SYM)
  const [tf, setTf] = useState('D')
  const [handoffState, setHandoffState] = useState('pending')   // pending | applied | none
  const sdkRef = useRef(null)

  // The channel's newest handoff wins over the remembered symbol.
  useEffect(() => {
    let alive = true
    if (!ctx.channelId || typeof fetch !== 'function') { setHandoffState('none'); return undefined }
    fetch(`/api/discord/activity/handoff?channel_id=${encodeURIComponent(ctx.channelId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!alive) return
        if (data && data.ticker) {
          setSym(String(data.ticker).toUpperCase())
          if (TF_CODES.includes(String(data.tf))) setTf(String(data.tf))
          setHandoffState('applied')
        } else {
          setHandoffState('none')
        }
      })
      .catch(() => { if (alive) setHandoffState('none') })
    return () => { alive = false }
  }, [ctx.channelId])

  // Tell Discord the frame is up. Only inside the frame, only best-effort.
  useEffect(() => {
    if (!ctx.inDiscord) return undefined
    let cancelled = false
    import('@discord/embedded-app-sdk')
      .then(({ DiscordSDK }) => {
        if (cancelled) return
        const clientId = import.meta.env.VITE_DISCORD_CHART_APP_ID || '1474900505917653142'
        const sdk = new DiscordSDK(clientId)
        sdkRef.current = sdk
        return sdk.ready()
      })
      .then(() => { if (!cancelled) window.__discordActivityReady = true })
      .catch(() => { /* the chart does not depend on the handshake */ })
    return () => { cancelled = true }
  }, [ctx.inDiscord])

  const onSymbolChange = useCallback((next) => {
    const s = String(next || '').trim().toUpperCase()
    if (!s) return
    setSym(s); writeLastSym(s)
  }, [])
  const onTfChange = useCallback((next) => { if (TF_CODES.includes(String(next))) setTf(String(next)) }, [])

  return (
    <div data-testid="discord-activity" data-handoff={handoffState} data-in-discord={ctx.inDiscord ? '1' : '0'}
      style={{ position: 'fixed', inset: 0, background: '#0a0a0a', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChartPane
          sym={sym}
          tf={tf}
          onSymbolChange={onSymbolChange}
          onTfChange={onTfChange}
          stored={null}
          density="full"
          showTfBar
          stockChartProps={{ liveUpdates: false }}
        />
      </div>
    </div>
  )
}
