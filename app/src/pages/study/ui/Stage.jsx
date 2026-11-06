// THE STAGE (round 18; round 19 after batch 19: the start card "still has a very weird look", the end card Weak): the
// start card and the end card of a mode share one shell — a centred card on a dark stage with a gold light from above.
// `hero` lays a backdrop of faint candles behind the start card (a chart, dimmed, is the subject of every mode);
// `legend` brightens the rim and `rays` turn slowly behind a perfect run. Also here: the gems (a number with its
// label), a run log (one row per chart), and confetti for the perfect run.
import UIcon from '../../../components/ui/UIcon'
import s from './study.module.css'

/** A backdrop of faint candles: deterministic (seeded), so a picture of it is the same picture twice. */
export function Backdrop({ n = 44, seed = 7 }) {
  let x = seed
  const rnd = () => { x = (x * 48271) % 2147483647; return x / 2147483647 }
  const bars = []
  let p = 50
  for (let i = 0; i < n; i++) {
    const o = p
    const c = Math.max(12, Math.min(88, o + (rnd() - 0.46) * 9))
    const h = Math.max(o, c) + rnd() * 4
    const l = Math.min(o, c) - rnd() * 4
    bars.push({ o, c, h, l, up: c >= o })
    p = c
  }
  const w = 100 / n
  return (
    <span className={s.backdrop} aria-hidden="true">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        {bars.map((b, i) => {
          const cx = i * w + w / 2
          const col = b.up ? '#2faf68' : '#df4646'
          return (
            <g key={i} opacity=".55">
              <line x1={cx} x2={cx} y1={100 - b.h} y2={100 - b.l} stroke={col} strokeWidth=".35" />
              <rect x={cx - w * 0.3} width={w * 0.6} y={100 - Math.max(b.o, b.c)} height={Math.max(0.6, Math.abs(b.o - b.c))} fill={col} />
            </g>
          )
        })}
      </svg>
    </span>
  )
}

export function Confetti({ n = 90 }) {
  const bits = Array.from({ length: n }, (_, i) => ({ l: (i * 37) % 100, d: (i % 7) * 0.12, c: ['#dcbb5e', '#2faf68', '#ffffff', '#e9cd77'][i % 4], r: 1.6 + (i % 5) * 0.25 }))
  return <div className={s.confetti} aria-hidden="true">{bits.map((b, i) => <i key={i} style={{ left: `${b.l}%`, background: b.c, animationDelay: `${b.d}s`, animationDuration: `${b.r}s` }} />)}</div>
}

export function Gem({ icon = null, label, value, tone = '', i = 0, testId = null }) {
  return (
    <div className={`${s.gem} ${tone === 'gold' ? s.gold : tone === 'green' ? s.green : ''}`} style={{ '--i': i }}>
      {icon ? <span className={s.gemIcon}><UIcon name={icon} size={20} /></span> : null}
      <small>{label}</small>
      <b data-testid={testId || undefined}>{value}</b>
    </div>
  )
}

/** One row per chart of the run: number, setup, ticker, the verdict. */
export function RunLog({ rows = [] }) {
  if (!rows.length) return null
  return (
    <div className={s.runLog} role="list" aria-label="The run" data-testid="run-log">
      {rows.map((r, i) => (
        <div key={i} className={`${s.runRow} ${r.ok ? s.ok : s.miss}`} role="listitem" style={{ '--i': i }}>
          <small>{i + 1}</small>
          <span>{r.name}</span>
          <em>{r.ticker || ''}</em>
          <i aria-label={r.ok ? 'named' : 'missed'}>{r.ok ? <UIcon name="check" size={13} gold={false} /> : <UIcon name="x" size={13} gold={false} />}</i>
        </div>
      ))}
    </div>
  )
}

export default function Stage({ legend = false, rays = false, hero = false, eyebrow = null, title = null, titlePlain = false, titleNote = null, sub = null, art = null, children = null, actions = null, below = null, testId = null }) {
  return (
    <div className={`${s.kit} ${s.stageWrap}`} data-testid={testId || undefined}>
      <div className={`${s.stageCard} ${legend ? s.legend : ''} ${hero ? s.hero : ''}`}>
        {hero ? <Backdrop /> : null}
        {rays ? <span className={s.rays} aria-hidden="true" /> : null}
        {art ? <div className={s.art}>{art}</div> : null}
        {eyebrow ? <span className={s.eyebrow}>{eyebrow}</span> : null}
        {title ? (titlePlain
          ? <div className={s.heroPlain}>{title}{titleNote ? <i>{titleNote}</i> : null}</div>
          : <div className={s.hero}>{title}</div>) : null}
        {sub ? <p className={s.heroSub}>{sub}</p> : null}
        {children}
        {actions ? <div className={s.actions}>{actions}</div> : null}
        {below ? <div className={s.below}>{below}</div> : null}
      </div>
    </div>
  )
}
