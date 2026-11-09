import { StartArena, StartBriefing, StartLegendary } from '../../pages/study/ui/StartLooks'
import s from '../../pages/study/ui/study.module.css'

/** Focus round 4 (2026-11-08): the Hard mode start screen, three versions side by side. Start does nothing here. */
const LOOKS = [
  { key: 'arena', name: 'A · Arena', ref: "like a game's level intro (Brawl Stars, Clash Royale): the task drawn as art, the last candle ringed with a question mark, the stakes in one line, a big tactile Start", View: StartArena },
  { key: 'legend', name: 'B · Legendary', ref: "like Duolingo's Legendary challenge: the medal is the hero, one sentence of stakes, the rules as one quiet row, a wide Start and Not now", View: StartLegendary },
  { key: 'brief', name: 'C · Briefing', ref: 'like a mission briefing: the rules as a numbered brief, the run as a fanned deck of eight face-down charts, Deal the charts', View: StartBriefing },
]

export default function Piece69StartFocus() {
  return (
    <div className={s.kit} style={{ minHeight: '100vh', background: 'radial-gradient(1200px 500px at 50% -10%, #1a1608, #070707 60%)', padding: '22px 18px 40px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', color: '#dcbb5e' }}>Focus · the start screen</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>The way into Hard mode, three ways</div>
          <div style={{ fontSize: 13, color: '#a39e94', marginTop: 4 }}>The title, the medal, the rules and Start as one screen. Reload to see each one play in.</div>
        </div>
        {LOOKS.map((look) => { const { key, name, ref } = look; const View = look.View; return (
          <section key={key} data-look={key} style={{ border: '1px solid rgba(220,187,94,.28)', borderRadius: 18, padding: '14px 18px 30px', background: 'radial-gradient(900px 300px at 50% 0%, rgba(40,32,10,.55), rgba(255,255,255,.01))' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 26, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15, color: '#e9cd77' }}>{name}</b>
              <span style={{ fontSize: 12.5, color: '#a39e94' }}>{ref}</span>
            </div>
            <View total={8} ready onStart={() => {}} onBack={() => {}} />
          </section>
        )})}
      </div>
    </div>
  )
}
