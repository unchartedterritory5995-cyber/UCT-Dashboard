import { EndReport, EndStatement, EndTrophy } from '../../pages/study/ui/EndLooks'
import s from '../../pages/study/ui/study.module.css'

/** Focus round 3 (2026-11-08): the end screen, three versions side by side, on a SAMPLE run. The setups and tickers are
 *  the owner's own batch-22 run (the bank's real charts); which ones count as named is made up for the sample.
 *  `?run=mid` (5 of 8, the default) | `tough` (1 of 8) | `perfect` (8 of 8). */
const CHARTS = [
  ['Bear gap', 'DUOL'], ['Bear gap', 'THO'], ['Oops Reversal', 'VG'], ['Kicker', 'GOOGL'],
  ['Oops Reversal', 'ELF'], ['Gap Support', 'KKR'], ['High Volume Edge', 'COMP'], ['Nothing fired', ''],
]
const RUNS = {
  mid: { ok: [true, false, true, true, false, true, true, false], said: ['', 'Nothing fired', '', '', 'Kicker', '', '', 'Bear gap'] },
  tough: { ok: [false, false, true, false, false, false, false, false], said: ['Kicker', 'Nothing fired', '', 'Nothing fired', 'Nothing fired', 'Nothing fired', 'Nothing fired', 'Kicker'] },
  perfect: { ok: Array(8).fill(true), said: Array(8).fill('') },
}

const LOOKS = [
  { key: 'trophy', name: 'A · Trophy', ref: "like Apple Fitness awards and Duolingo's league trophies: the run strikes a coin, bronze, silver or gold, the Legendary medal at 8 for 8; the next tier named", View: EndTrophy },
  { key: 'report', name: 'B · Report card', ref: "like Chess.com's Game Review: accuracy as a dial, every setup scored, the weakest one named with a way to practise it, the run as a timeline", View: EndReport },
  { key: 'statement', name: 'C · Statement', ref: "like a broker's daily statement: the result as a P&L line, a step curve of charts named, a blotter of every chart", View: EndStatement },
]

export default function Piece68EndFocus() {
  const key = new URLSearchParams(window.location.search).get('run') || 'mid'
  const run = RUNS[key] || RUNS.mid
  const log = CHARTS.map(([name, ticker], i) => ({ name, ticker, ok: run.ok[i], said: run.ok[i] ? null : run.said[i] }))
  const right = run.ok.filter(Boolean).length
  const props = { right, total: 8, xp: right * 8, log, results: run.ok, date: 'Nov 8, 2026', onAgain: () => {}, onBack: () => {}, onPractise: () => {} }
  return (
    <div className={s.kit} style={{ minHeight: '100vh', background: 'radial-gradient(1200px 500px at 50% -10%, #1a1608, #070707 60%)', padding: '22px 18px 40px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase', color: '#dcbb5e' }}>Focus · the end screen</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>The end of a run, three ways</div>
          <div style={{ fontSize: 13, color: '#a39e94', marginTop: 4 }}>A sample run of {right} of 8. Other runs: {['mid', 'tough', 'perfect'].map((k, i) => <span key={k}>{i ? ' · ' : ''}<a href={`?piece=68&run=${k}`} style={{ color: k === key ? '#e9cd77' : '#a39e94' }}>{k === 'mid' ? '5 of 8' : k === 'tough' ? '1 of 8' : '8 of 8'}</a></span>)}</div>
        </div>
        {LOOKS.map((look) => { const { key: k, name, ref } = look; const View = look.View; return (
          <section key={k} data-look={k} style={{ border: '1px solid rgba(220,187,94,.28)', borderRadius: 18, padding: '14px 18px 22px', background: 'linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.008))' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
              <b style={{ fontSize: 15, color: '#e9cd77' }}>{name}</b>
              <span style={{ fontSize: 12.5, color: '#a39e94' }}>{ref}</span>
            </div>
            <View {...props} />
          </section>
        )})}
      </div>
    </div>
  )
}
