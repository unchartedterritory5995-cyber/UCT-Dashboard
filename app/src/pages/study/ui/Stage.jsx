// THE STAGE (round 18): the start card and the end card of a mode share one shell — a centred card on a dark stage with
// a gold light from above; `legend` brightens the rim and `rays` turn slowly behind a perfect run. Owner, batch 18: the
// end card Cut, the start card "can be improved significantly in terms of production and quality". Also here: the
// gems (a number with its label), the "lights out" switches, and confetti for the perfect run.
import UIcon from '../../../components/ui/UIcon'
import s from './study.module.css'

/** What a mode hides, drawn as switches turned OFF. `items`: [{ label, sub }]. */
export function Toggles({ items = [], label = 'Hidden on every chart' }) {
  return (
    <div className={s.toggles} role="list" aria-label={label}>
      {items.map((it) => (
        <div key={it.label} className={s.toggle} role="listitem">
          <span className={s.track} aria-hidden="true"><span className={s.knob} /></span>
          <small>{it.sub || 'Off'}</small>
          <b>{it.label}</b>
        </div>
      ))}
    </div>
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

export default function Stage({ legend = false, rays = false, eyebrow = null, title = null, titlePlain = false, titleNote = null, sub = null, art = null, children = null, actions = null, below = null, testId = null }) {
  return (
    <div className={`${s.kit} ${s.stageWrap}`} data-testid={testId || undefined}>
      <div className={`${s.stageCard} ${legend ? s.legend : ''}`}>
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
