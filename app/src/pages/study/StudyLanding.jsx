// Study — the landing hero (docs/study/landing_redesign.md, owner 2026-10-20:
// "cool and fun, not lame"). The trail is drawn as a CANDLE CHART of the
// member's own progress: one candle per station of The UCT Method, body
// height = share of units mastered, the recommended station carrying the
// compass marker and "you are here" (the review screen's marker, reused).
// Under it: the stations deck, the Foundations deck and the badges shelf.
//
// Pure props, no fetch: CoursesSection hands over the map, the skill rows,
// today's payload, the profile and the badges, plus the two callbacks the
// trail already honours (open a unit, open a curriculum). Gold means
// mastery or the one primary action, nothing else; tokens only; every
// motion is off under prefers-reduced-motion (CSS).
import UIcon from '../../components/ui/UIcon'
import ProgressRing from './ProgressRing'
import { trackSummary, recommendUnit, RUNGS } from './studyMap'
import {
  candles, METHOD_ID, FOUNDATIONS_ID, TAGLINE,
  CHART_W as W, CHART_H as H, CHART_BASE as BASE, CHART_TOP as TOP, CHART_PAD_X as PAD_X,
} from './studyLandingChart'
import s from './StudyLanding.module.css'

function TrailChart({ tracks, byId, recommendedTrackId, onOpenTrack }) {
  const cs = candles(tracks, byId, recommendedTrackId)
  const path = cs.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${(c.wickTop - 8).toFixed(1)}`).join(' ')
  const rec = cs.find((c) => c.recommended) || null
  return (
    <figure className={s.chart} aria-label="Your trail, drawn as a chart">
      <svg viewBox={`0 0 ${W} ${H}`} className={s.svg} role="img" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="study-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--ut-gold-bright)" />
            <stop offset="1" stopColor="var(--ut-gold)" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const y = BASE - f * (BASE - TOP)
          return <line key={f} x1={PAD_X - 20} x2={W - PAD_X + 20} y1={y} y2={y} className={s.grid} />
        })}
        <line x1={PAD_X - 20} x2={W - PAD_X + 20} y1={BASE} y2={BASE} className={s.floor} />
        <path d={path} className={s.trail} />
        {cs.map((c) => (
          <g key={c.id} className={`${s.candle} ${s[c.state]}`}>
            <line x1={c.x} x2={c.x} y1={c.wickTop} y2={c.bottom + 6} className={s.wick} />
            <rect x={c.x - 12} y={c.top} width={24} height={Math.max(2, c.bottom - c.top)} rx={2} className={s.body} />
            <text x={c.x} y={BASE + 22} textAnchor="middle" className={s.label}>{c.title}</text>
          </g>
        ))}
        {rec && (
          /* the attribute transform places it; the CSS float animates an INNER
             group, so the two transforms never fight */
          <g transform={`translate(${rec.x.toFixed(1)} ${(rec.wickTop - 30).toFixed(1)})`}>
            <g className={s.marker}>
              <text x="0" y="-6" textAnchor="middle" className={s.markerText}>you are here</text>
              <path d="M -6 2 L 6 2 L 0 12 Z" className={s.markerArrow} />
            </g>
          </g>
        )}
        <text x={W - PAD_X + 24} y={TOP + 4} textAnchor="end" className={s.axis}>mastered</text>
        <text x={W - PAD_X + 24} y={BASE + 4} textAnchor="end" className={s.axis}>start</text>
      </svg>
      <figcaption className={s.sr}>
        {cs.map((c) => `${c.title}: ${c.mastered} of ${c.units} mastered${c.recommended ? ', you are here' : ''}`).join('. ')}
      </figcaption>
      <ul className={s.hotspots} aria-label="Stations on the chart">
        {cs.map((c) => (
          <li key={c.id} style={{ left: `${(c.x / W) * 100}%` }}>
            <button type="button" className={s.hotspot} onClick={() => onOpenTrack?.(c.id)} aria-label={`Open ${c.title}`} />
          </li>
        ))}
      </ul>
    </figure>
  )
}

function StationTile({ track, byId, recommended, onOpen }) {
  const sum = trackSummary(track, byId)
  const share = sum.units ? sum.mastered / sum.units : 0
  const rungs = sum.units ? (sum.mastered === sum.units ? RUNGS : Math.min(RUNGS - 1, Math.floor(share * RUNGS))) : 0
  return (
    <li className={s.tileItem}>
      <button
        type="button"
        className={`${s.tile} ${recommended ? s.tileRec : ''} ${share >= 1 ? s.tileDone : ''}`}
        onClick={onOpen}
        aria-label={`${track.title}, ${sum.mastered} of ${sum.units} mastered${recommended ? ', recommended' : ''}`}
      >
        <ProgressRing size={40} done={rungs} label="">
          {share >= 1 ? <UIcon name="star" size={16} /> : recommended ? <UIcon name="compass" size={18} /> : <span className={s.tileNum}>{sum.mastered}</span>}
        </ProgressRing>
        <span className={s.tileText}>
          <span className={s.tileTitle}>{track.title}</span>
          <span className={s.tileMeta}>{sum.units ? `${sum.mastered} of ${sum.units} mastered` : 'coming soon'}</span>
        </span>
        {recommended && <span className={s.tileTag}>next</span>}
      </button>
    </li>
  )
}

function firstUnitId(track) {
  return track?.units?.[0]?.id || null
}

export default function StudyLanding({ curricula = [], byId = {}, badges = [], onOpenUnit, onOpenTrail }) {
  const method = curricula.find((c) => c.id === METHOD_ID) || null
  const foundations = curricula.find((c) => c.id === FOUNDATIONS_ID) || null
  const rec = method ? recommendUnit(method, byId) : null
  const recTrackId = rec?.track?.id || method?.tracks?.[0]?.id || null

  const openTrack = (curriculum, trackId) => {
    const track = curriculum?.tracks?.find((t) => t.id === trackId)
    const unit = firstUnitId(track)
    if (unit) onOpenUnit?.(unit, curriculum.id)
    else onOpenTrail?.(curriculum.id)
  }

  const earned = Array.isArray(badges) ? badges : []

  return (
    <section className={s.landing} aria-label="Your trail">
      <div className={s.hero}>
        <div className={s.heroText}>
          <span className={s.eyebrow}>
            <UIcon name="compass" size={14} />
            Study
          </span>
          <h2 className={s.headline}>Your trail is a chart.</h2>
          <p className={s.tagline}>{TAGLINE}</p>
        </div>
        {method ? (
          <TrailChart
            tracks={method.tracks || []}
            byId={byId}
            recommendedTrackId={recTrackId}
            onOpenTrack={(id) => openTrack(method, id)}
          />
        ) : (
          <div className={s.chartSkeleton} aria-hidden="true" />
        )}
      </div>

      {method && (
        <div className={s.deck}>
          <div className={s.deckHead}>
            <h3 className={s.deckTitle}>The stations</h3>
            <span className={s.deckSub}>Six stations, one trade. The chart above is this list.</span>
          </div>
          <ul className={s.tiles} aria-label="The UCT Method stations">
            {(method.tracks || []).map((t) => (
              <StationTile key={t.id} track={t} byId={byId} recommended={t.id === recTrackId} onOpen={() => openTrack(method, t.id)} />
            ))}
          </ul>
        </div>
      )}

      {foundations && (
        <div className={s.deck}>
          <div className={s.deckHead}>
            <h3 className={s.deckTitle}>Foundations</h3>
            <span className={s.deckSub}>Everything a trader should know before the method. Any order.</span>
          </div>
          <ul className={`${s.tiles} ${s.strip}`} aria-label="Foundations tracks">
            {(foundations.tracks || []).map((t) => (
              <StationTile key={t.id} track={t} byId={byId} recommended={false} onOpen={() => openTrack(foundations, t.id)} />
            ))}
          </ul>
        </div>
      )}

      <div className={s.shelf} aria-label="Badges">
        <span className={s.shelfTitle}>
          <UIcon name="star" size={14} />
          Badges
        </span>
        {earned.length ? (
          <ul className={s.badges}>
            {earned.map((b) => (
              <li key={b.badge_id} className={s.badge} title={b.earned_at ? `Earned ${String(b.earned_at).slice(0, 10)}` : undefined}>
                <span className={s.badgeIcon}><UIcon name="star" size={18} /></span>
                <span className={s.badgeName}>{String(b.badge_id).replace(/[_-]+/g, ' ')}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={s.shelfEmpty}>Your first badge comes with your first set.</p>
        )}
      </div>
    </section>
  )
}
