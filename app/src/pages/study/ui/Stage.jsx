// THE STAGE (round 18; round 19 after batch 19; round 20 a full stage; round 21 after batch 21: the start stage 68/100
// "a few more polished improvements on text, font, graphics, and visual", the brief and the Start button Cut, the gems
// Weak). The start and the end of a mode share one shell: a full stage on a dim chart with a gold light from above.
// Also here: the RULES (three tiles in place of the round-20 paragraph), the STAT CARDS (a coloured band with the label
// over the number, in place of the two gems), a run log (one row per chart, with the member's own pick on a miss),
// and confetti for the perfect run. `titleClass` lets a mode set its own title face.
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
          const y = (v) => (100 - v) * 0.52          // the candles live in the stage's top half, behind the title
          return (
            <g key={i} opacity=".55">
              <line x1={cx} x2={cx} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth=".35" />
              <rect x={cx - w * 0.3} width={w * 0.6} y={y(Math.max(b.o, b.c))} height={Math.max(0.4, Math.abs(b.o - b.c) * 0.52)} fill={col} />
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

/** The round-18 gem (kept for any caller; Hard mode uses StatCard since round 21). */
export function Gem({ icon = null, label, value, tone = '', i = 0, testId = null }) {
  return (
    <div className={`${s.gem} ${tone === 'gold' ? s.gold : tone === 'green' ? s.green : ''}`} style={{ '--i': i }}>
      {icon ? <span className={s.gemIcon}><UIcon name={icon} size={20} /></span> : null}
      <small>{label}</small>
      <b data-testid={testId || undefined}>{value}</b>
    </div>
  )
}

/** A STAT CARD: a coloured band carrying the label, the number under it with its icon. Tones: gold, green, flame. */
export function StatCard({ icon = null, label, value, tone = 'gold', i = 0, testId = null }) {
  return (
    <div className={`${s.stat} ${s[`stat_${tone}`] || ''}`} style={{ '--i': i }}>
      <span className={s.statBand}>{label}</span>
      <span className={s.statBody}>
        {icon ? <UIcon name={icon} size={20} gold={false} /> : null}
        <b data-testid={testId || undefined}>{value}</b>
      </span>
    </div>
  )
}

/** THE RULES of a mode: three tiles, an icon, a title and one line each (the round-20 paragraph, Cut in batch 21). */
export function Rules({ items = [] }) {
  if (!items.length) return null
  return (
    <div className={s.rules} role="list">
      {items.map((r, i) => (
        <div key={r.title} className={s.ruleTile} role="listitem" style={{ '--i': i }}>
          <span className={s.ruleIcon}><UIcon name={r.icon} size={18} gold={false} /></span>
          <b>{r.title}</b>
          <span>{r.text}</span>
        </div>
      ))}
    </div>
  )
}

/** One row per chart of the run: number, what fired, ticker, the verdict, and on a miss what the member said. */
export function RunLog({ rows = [] }) {
  if (!rows.length) return null
  return (
    <div className={s.runLog} role="list" aria-label="The run" data-testid="run-log">
      {rows.map((r, i) => (
        <div key={i} className={`${s.runRow} ${r.ok ? s.ok : s.miss}`} role="listitem" style={{ '--i': i }}>
          <small>{i + 1}</small>
          <span className={s.runName}>{r.name}{!r.ok && r.said ? <i className={s.runSaid}>you said {r.said}</i> : null}</span>
          <em>{r.ticker || ''}</em>
          <i className={s.runMark} aria-label={r.ok ? 'named' : 'missed'}>{r.ok ? <UIcon name="check" size={13} gold={false} /> : <UIcon name="x" size={13} gold={false} />}</i>
        </div>
      ))}
    </div>
  )
}

export default function Stage({ legend = false, rays = false, hero = false, full = false, eyebrow = null, title = null, titlePlain = false, titleNote = null, titleClass = null, sub = null, art = null, children = null, actions = null, below = null, testId = null }) {
  const titleNode = title ? (titlePlain
    ? <div className={titleClass || s.heroBigPlain}>{title}{titleNote ? <i>{titleNote}</i> : null}</div>
    : <div className={titleClass || s.heroBig}>{title}</div>) : null
  if (full) {
    return (
      <div className={`${s.kit} ${s.stageFull} ${legend ? s.legend : ''}`} data-testid={testId || undefined}>
        {hero ? <Backdrop n={64} /> : null}
        {rays ? <span className={s.rays} aria-hidden="true" /> : null}
        <div className={s.stageInner}>
          {art ? <div className={s.art}>{art}</div> : null}
          {eyebrow ? <span className={s.eyebrow}>{eyebrow}</span> : null}
          {titleNode}
          {sub ? <p className={s.heroSub}>{sub}</p> : null}
          {children}
          {actions ? <div className={s.actions}>{actions}</div> : null}
          {below ? <div className={s.below}>{below}</div> : null}
        </div>
      </div>
    )
  }
  return (
    <div className={`${s.kit} ${s.stageWrap}`} data-testid={testId || undefined}>
      <div className={`${s.stageCard} ${legend ? s.legend : ''} ${hero ? s.heroCard : ''}`}>
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
