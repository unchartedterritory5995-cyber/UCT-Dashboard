import { useEffect, useState } from 'react'
import { HudJourney, HudRoute, HudScoreboard } from '../../pages/study/ui/HudLooks'
import s from '../../pages/study/ui/study.module.css'

/** Focus round 1 (2026-11-08): the Hard mode status line, three versions side by side, playing a run of eight charts
 *  (gold = named, red = missed), with today's line on top for reference. `?still=1` holds one moment for pictures. */
const PATTERN = [true, true, false, true, true, true, false, true]
const TOTAL = PATTERN.length

function useRun(still) {
  const [t, setT] = useState(still ? 7 : 0)   // two ticks per chart: asking, then answered
  useEffect(() => {
    if (still) return undefined
    const id = setInterval(() => setT((x) => (x + 1) % (TOTAL * 2 + 3)), 1500)
    return () => clearInterval(id)
  }, [still])
  const tt = Math.min(t, TOTAL * 2 - 1)
  const step = Math.floor(tt / 2)
  const answered = tt % 2 === 1
  return { step, live: !answered, results: PATTERN.slice(0, answered ? step + 1 : step) }
}

const LOOKS = [
  { key: 'journey', name: 'A · Journey', ref: "like Duolingo's lesson bar: a thick glossy bar our mark rides, a streak flame", View: HudJourney },
  { key: 'scoreboard', name: 'B · Scoreboard', ref: 'like a game HUD (Chess.com Puzzle Rush): a candle per chart, a big gold score', View: HudScoreboard },
  { key: 'route', name: 'C · Route', ref: "like our intro's map: a route of waypoints, our compass travelling it", View: HudRoute },
]

export default function Piece66StatusLineFocus() {
  const still = new URLSearchParams(window.location.search).get('still') === '1'
  const run = useRun(still)
  return (
    <div className={s.kit} style={{ minHeight: '100vh', background: 'radial-gradient(1200px 500px at 50% -10%, #1a1608, #070707 60%)', padding: '22px 18px 40px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', color: '#dcbb5e' }}>Focus · the status line</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>Three versions, playing a run of eight charts</div>
          <div style={{ fontSize: 13, color: '#a39e94', marginTop: 4 }}>Gold is a chart you named, red a miss. Pick the one to build on, or name an app that does it better.</div>
        </div>
        {LOOKS.map((look) => { const { key, name, ref } = look; const View = look.View; return (
          <section key={key} data-look={key} style={{ border: `1px solid ${key === 'today' ? '#2a2c31' : 'rgba(220,187,94,.28)'}`, borderRadius: 18, padding: '14px 16px 18px', background: 'linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.008))', opacity: key === 'today' ? 0.75 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15, color: key === 'today' ? '#a39e94' : '#e9cd77' }}>{name}</b>
              <span style={{ fontSize: 12.5, color: '#a39e94' }}>{ref}</span>
            </div>
            <View mode="hard" step={run.step} total={TOTAL} results={run.results} live={run.live} stepTestId={null} />
          </section>
        )})}
      </div>
    </div>
  )
}
