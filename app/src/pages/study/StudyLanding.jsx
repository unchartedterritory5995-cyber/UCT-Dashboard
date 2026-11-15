// THE STUDY HOME (rebuilt 2026-11-08 on the owner's notes: "nah this is too confusing think we can check out a ton of
// apps LIKE DUOL LINGO!!!!" · "make it more of OUR BRAND and our layout and increase the quality of the production by 3X.
// Also I want to improve the reward system and scoring of the app a lot more" · "Combo of all of it i think but
// progressing sensibly" · "Use some creativity"). A game's home on the arena look:
//
//   the player hero   your level struck in gold, its tier, the XP still to go to the next level, the streak and the total
//                     XP as crests, and today's lesson as the one big button
//   the course path   the stations of the UCT Method as coins on a winding gold road, the logo standing on the one
//                     you are on; Foundations as a short side road
//   the games         Blitz, Boss, Spot the Setup and Hard mode as cards with their own plates (Blitz shows your best)
//   the trophy shelf  every badge earned, as a crest
//
// Pure props, no fetch: CoursesSection hands over the map, the skill rows, the profile, today's set and the badges, plus
// the callbacks (open a unit, open a curriculum, start today, open a challenge). Every number is the member's own (level
// = 1 + xp / 500, study_store.XP_PER_LEVEL); nothing is invented. Motion is calm and off under prefers-reduced-motion.
import UIcon from '../../components/ui/UIcon'
import StudyMark from '../../components/study/StudyMark'
import StudyButton from './ui/StudyButton'
import { CHALLENGES } from './challenges/registry'
import { BLITZ_BEST_KEY } from './challenges/challengeBank'
import { trackSummary, recommendUnit } from './studyMap'
import { METHOD_ID, FOUNDATIONS_ID } from './studyLandingChart'
import { XP_PER_LEVEL, levelOf, tierOf } from './studyLevels'
import { TROPHIES } from './studyBadges'
import { weekDots, WEEKDAY_LETTERS } from './studyMap'
import brandMarkUrl from '../../components/intro/assets/compass-mark.webp'
import s from './StudyLanding.module.css'


const STATION_ICON = { REG: 'compass', SCN: 'eye', SET: 'star', ENT: 'play', SIZ: 'shield', MAN: 'flame', REV: 'refresh', CAL: 'bolt', OVL: 'info' }
const PLATE = { blitz: 'Blitz', boss: 'Boss', spot: 'Spot', hard: 'Hard', draw: 'Draw' }
const ACCENT = { blitz: 'amber', boss: 'red', spot: 'gold', hard: 'red', draw: 'green' }

function readBlitzBest() { try { return Number(localStorage.getItem(BLITZ_BEST_KEY)) || 0 } catch { return 0 } }

function PlayerHero({ profile, today, onStartToday }) {
  const xp = Math.max(0, Number(profile?.xp) || 0)
  const level = levelOf(xp)
  const into = xp % XP_PER_LEVEL
  const pct = (into / XP_PER_LEVEL) * 100
  const streak = Math.max(0, Number(profile?.streak) || 0)
  const best = Math.max(streak, Number(profile?.streak_best) || 0)
  const total = Array.isArray(today?.items) ? today.items.length : 0
  const done = Array.isArray(today?.answered_item_ids) ? Math.min(total, today.answered_item_ids.length) : 0
  const finished = total > 0 && (today?.finished_at || done >= total)
  const label = !total ? "Today's lesson" : finished ? 'Practise more' : done ? `Continue · ${total - done} left` : "Start today's lesson"
  return (
    <div className={s.hero} data-testid="study-hero">
      <div className={s.heroMark}>
        <i className={s.heroGlow} aria-hidden="true" />
        <StudyMark size={120} className={s.mark} />
        <i className={s.heroPedestal} aria-hidden="true" />
      </div>
      <div className={s.heroMain}>
        <span className={s.eyebrow}><i />UCT Study<i /></span>
        <div className={s.levelRow}>
          <h2 className={s.level} data-text={`Level ${level}`}>Level {level}</h2>
          <span className={`${s.tier} ${s['tier' + tierOf(level)]}`} data-testid="study-tier">{tierOf(level)}</span>
        </div>
        <div className={s.xpBar} role="progressbar" aria-valuemin={0} aria-valuemax={XP_PER_LEVEL} aria-valuenow={into} aria-label={`${into} of ${XP_PER_LEVEL} XP to level ${level + 1}`}>
          <div className={s.xpFill} style={{ width: `${Math.max(3, pct)}%` }}><i /></div>
        </div>
        <span className={s.xpText}><b>{XP_PER_LEVEL - into} XP</b> to Level {level + 1}</span>
        {onStartToday ? (
          <div className={s.heroCta}>
            <StudyButton kind="primary" size="xl" arrow wide onClick={onStartToday} testId="study-start-today">{label}</StudyButton>
            {total ? <span className={s.todayDots} aria-label={`${done} of ${total} done today`}>{Array.from({ length: total }, (_, i) => <i key={i} className={i < done ? s.dotOn : ''} />)}</span> : null}
          </div>
        ) : null}
      </div>
      <TodayRing profile={profile} today={today} />
      <div className={s.heroStats}>
        <span className={`${s.crest} ${streak ? s.crestHot : ''}`} data-testid="study-streak"><i className={s.crestIcon}><UIcon name="flame" size={15} gold={false} /></i><b>{streak}</b><small>day streak</small><em>best {best}</em></span>
        <span className={s.crest} data-testid="study-xp"><i className={s.crestIcon}><UIcon name="star" size={15} gold={false} /></i><b>{xp.toLocaleString()}</b><small>total XP</small><em>Level {level}</em></span>
      </div>
    </div>
  )
}

/** Today, in the hero: the XP earned today against the member's daily goal as a ring, and this week's study days. */
function TodayRing({ profile, today }) {
  const goal = Math.max(1, Number(profile?.daily_goal) || 50)
  const xpToday = Math.max(0, Number(today?.xp_today) || 0)
  const pct = Math.min(1, xpToday / goal)
  const R = 46, C = 2 * Math.PI * R
  const dots = weekDots(today?.day_et, profile?.last_done_day, profile?.streak)
  return (
    <div className={s.today} data-testid="study-today">
      <div className={s.goal} aria-label={`${xpToday} of ${goal} XP today`}>
        <svg viewBox="0 0 112 112" aria-hidden="true">
          <circle cx="56" cy="56" r={R} className={s.goalBed} />
          <circle cx="56" cy="56" r={R} className={`${s.goalFill} ${pct >= 1 ? s.goalMet : ''}`} strokeDasharray={`${(C * pct).toFixed(1)} ${C.toFixed(1)}`} />
        </svg>
        <span className={s.goalText}><b>{xpToday}</b><small>of {goal} XP</small></span>
      </div>
      <span className={s.todayLabel}>{pct >= 1 ? 'Daily goal met' : 'Daily goal'}</span>
      <span className={s.week} aria-label="This week">
        {dots.map((on, i) => <i key={i} className={on ? s.weekOn : ''}><b>{WEEKDAY_LETTERS[i]}</b></i>)}
      </span>
    </div>
  )
}

/** The course path: each station a coin on a winding road, the recommended one carrying the logo. */
function CoursePath({ tracks, byId, recommendedTrackId, onOpenTrack, label, small = false }) {
  const swing = small ? [0, 64, 0, -64] : [0, 92, 132, 92, 0, -92, -132, -92]
  const rowH = small ? 168 : 196
  const W = 560
  const nodes = tracks.map((t, i) => {
    const sum = trackSummary(t, byId)
    const share = sum.units ? sum.mastered / sum.units : 0
    return { t, sum, share, x: W / 2 + swing[i % swing.length], y: (small ? 64 : 92) + i * rowH, rec: t.id === recommendedTrackId, done: sum.units > 0 && share >= 1 }
  })
  const H = nodes.length ? nodes[nodes.length - 1].y + 96 : 0
  const road = nodes.map((n, i) => {
    if (i === 0) return `M ${n.x} ${n.y}`
    const p = nodes[i - 1]
    const my = (p.y + n.y) / 2
    return `C ${p.x} ${my} ${n.x} ${my} ${n.x} ${n.y}`
  }).join(' ')
  const recIndex = nodes.findIndex((n) => n.rec)
  const walked = recIndex > 0 ? nodes.slice(0, recIndex + 1) : []
  const walkedRoad = walked.map((n, i) => {
    if (i === 0) return `M ${n.x} ${n.y}`
    const p = walked[i - 1]
    const my = (p.y + n.y) / 2
    return `C ${p.x} ${my} ${n.x} ${my} ${n.x} ${n.y}`
  }).join(' ')
  return (
    <div className={`${s.path} ${small ? s.pathSmall : ''}`} style={{ '--h': `${H}px` }} aria-label={label} role="list">
      <svg className={s.road} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d={road} className={s.roadBed} />
        <path d={road} className={s.roadLine} />
        {walkedRoad ? <path d={walkedRoad} className={s.roadWalked} /> : null}
      </svg>
      {nodes.map((n, i) => {
        const R = small ? 34 : 42, C = 2 * Math.PI * (R + 6)
        const state = n.done ? s.nodeDone : n.rec ? s.nodeNow : n.sum.mastered ? s.nodeSome : s.nodeTodo
        return (
          <div key={n.t.id} role="listitem" className={s.nodeWrap} style={{ left: `${(n.x / W) * 100}%`, top: `${n.y}px`, '--i': i }}>
            {n.rec ? <span className={s.nowPill}>{n.sum.mastered ? 'Continue' : 'Start here'}</span> : null}
            <button type="button" className={`${s.node} ${state}`} onClick={() => onOpenTrack?.(n.t.id)} data-testid={`station-${n.t.id}`}
              aria-label={`${n.t.title}, ${n.sum.mastered} of ${n.sum.units} mastered${n.rec ? ', recommended' : ''}`}>
              <svg className={s.ring} viewBox={`0 0 ${2 * (R + 10)} ${2 * (R + 10)}`} aria-hidden="true">
                <circle cx={R + 10} cy={R + 10} r={R + 6} className={s.ringBed} />
                <circle cx={R + 10} cy={R + 10} r={R + 6} className={s.ringFill} strokeDasharray={`${(C * n.share).toFixed(1)} ${C.toFixed(1)}`} />
              </svg>
              <span className={s.coin}>
                {n.done ? <UIcon name="check" size={small ? 26 : 32} gold={false} /> : <UIcon name={STATION_ICON[n.t.id] || 'compass'} size={small ? 24 : 30} gold={false} />}
              </span>
              {n.rec ? <img className={s.rider} src={brandMarkUrl} alt="" /> : null}
            </button>
            <span className={s.nodeLabel}><b>{n.t.title}</b><small>{n.sum.units ? `${n.sum.mastered} of ${n.sum.units} mastered` : 'coming soon'}</small></span>
          </div>
        )
      })}
    </div>
  )
}

/** Foundations: a grid of coins (fifteen tracks would make a road a mile long); a track with no lessons yet is locked. */
/** Over the road (Duolingo's unit banner): the station the member is on, how far through it, and one Continue. */
function StationBanner({ method, rec, byId, onContinue }) {
  const tracks = method.tracks || []
  const idx = Math.max(0, tracks.findIndex((t) => t.id === rec.track.id))
  const sum = trackSummary(rec.track, byId)
  return (
    <div className={s.banner} data-testid="station-banner">
      <span className={s.bannerIcon}><UIcon name={STATION_ICON[rec.track.id] || 'compass'} size={26} gold={false} /></span>
      <div className={s.bannerText}>
        <span className={s.bannerEyebrow}>Station {idx + 1} of {tracks.length}</span>
        <b>{rec.track.title}</b>
        <small>{sum.mastered} of {sum.units} lessons mastered{rec.unit?.title ? <> · next: {rec.unit.title}</> : null}</small>
      </div>
      <div className={s.bannerGo}><StudyButton kind="primary" size="xl" arrow onClick={onContinue} testId="station-continue">{sum.mastered ? 'Continue' : 'Start'}</StudyButton></div>
    </div>
  )
}

function CoinGrid({ tracks, byId, onOpenTrack, label }) {
  return (
    <ul className={s.coinGrid} aria-label={label}>
      {tracks.map((t, i) => {
        const sum = trackSummary(t, byId)
        const soon = !sum.units
        const done = sum.units > 0 && sum.mastered >= sum.units
        return (
          <li key={t.id} style={{ '--i': i }} className={s.coinItem}>
            <button type="button" className={`${s.gridCoin} ${done ? s.nodeDone : soon ? s.gridSoon : sum.mastered ? s.nodeSome : s.nodeTodo}`} onClick={() => onOpenTrack?.(t.id)}
              aria-label={`${t.title}, ${sum.mastered} of ${sum.units} mastered`} data-testid={`foundation-${t.id}`}>
              <span className={s.coin}><UIcon name={done ? 'check' : soon ? 'lock' : 'star'} size={20} gold={false} /></span>
            </button>
            <span className={s.gridLabel}><b>{t.title}</b><small>{soon ? 'coming soon' : `${sum.mastered} of ${sum.units}`}</small></span>
          </li>
        )
      })}
    </ul>
  )
}

/** `group`: 'chart' (the chart challenges) or 'skill' (the games that drill orders, sizing, options, risk and words,
 *  docs/study/GAMES.md); a game declares its own plate and accent in its GAME meta, the first five use the maps above. */
function GameCards({ onOpenChallenge, group = 'chart', label = 'Challenges' }) {
  const blitzBest = readBlitzBest()
  const games = CHALLENGES.filter((c) => (c.group || 'chart') === group)
  if (!games.length) return null
  return (
    <ul className={s.games} aria-label={label}>
      {games.map((c, i) => (
        <li key={c.kind} className={s.gameItem} style={{ '--i': i }}>
          <button type="button" className={`${s.game} ${s['acc_' + (c.accent || ACCENT[c.kind] || 'gold')]}`} onClick={() => onOpenChallenge(c.kind)} aria-label={`${c.title}: ${c.sub}`} data-testid={`game-${c.kind}`}>
            <span className={s.gamePlate}>{c.plate || PLATE[c.kind] || c.title}</span>
            <span className={s.gameIcon}><UIcon name={c.icon} size={26} gold={false} /></span>
            <span className={s.gameText}>
              <b>{c.title}</b>
              <small>{c.sub}</small>
              {c.kind === 'blitz' && blitzBest ? <em>Your best {blitzBest} points</em> : null}
            </span>
            <span className={s.gameGo}><UIcon name="chevronRight" size={18} gold={false} /></span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function TrophyShelf({ badges }) {
  const earned = new Map(badges.map((b) => [b.badge_id, b]))
  const known = new Set(TROPHIES.map((t) => t.id))
  const extra = badges.filter((b) => !known.has(b.badge_id)).map((b) => ({ id: b.badge_id, name: String(b.badge_id).replace(/[_-]+/g, ' '), how: '', icon: 'star' }))
  const all = [...TROPHIES, ...extra]
  const n = all.filter((t) => earned.has(t.id)).length
  return (
    <div className={s.shelf} aria-label="Badges">
      <span className={s.shelfTitle}><UIcon name="star" size={14} />Trophies<em>{n} of {all.length}</em></span>
      <ul className={s.badges}>
        {all.map((t, i) => {
          const got = earned.get(t.id)
          return (
            <li key={t.id} className={`${s.badge} ${got ? '' : s.badgeLocked}`} style={{ '--i': i }}
              title={got ? (got.earned_at ? `Earned ${String(got.earned_at).slice(0, 10)}` : 'Earned') : t.how} data-testid={`trophy-${t.id}`} data-earned={got ? '1' : '0'}>
              <span className={s.badgeCoin}><UIcon name={got ? t.icon : 'lock'} size={18} gold={false} /></span>
              <span className={s.badgeName}>{t.name}</span>
              {got ? null : <span className={s.badgeHow}>{t.how}</span>}
            </li>
          )
        })}
      </ul>
      {n ? null : <p className={s.shelfEmpty}>Your first trophy comes with your first set.</p>}
      <i className={s.shelfLight} aria-hidden="true" />
    </div>
  )
}

export default function StudyLanding({ curricula = [], byId = {}, badges = [], profile = null, today = null, onOpenUnit, onOpenTrail, onOpenChallenge, onStartToday = null }) {
  const method = curricula.find((c) => c.id === METHOD_ID) || null
  const foundations = curricula.find((c) => c.id === FOUNDATIONS_ID) || null
  const rec = method ? recommendUnit(method, byId) : null
  const recTrackId = rec?.track?.id || method?.tracks?.[0]?.id || null

  const openTrack = (curriculum, trackId) => {
    const track = curriculum?.tracks?.find((t) => t.id === trackId)
    const unit = track?.units?.[0]?.id || null
    if (unit) onOpenUnit?.(unit, curriculum.id)
    else onOpenTrail?.(curriculum.id)
  }
  const earned = Array.isArray(badges) ? badges : []

  return (
    <section className={s.landing} aria-label="Your trail">
      <PlayerHero profile={profile} today={today} onStartToday={onStartToday} />
      <div className={s.board}>
        <div className={s.main}>
          <div className={s.deckHead}>
            <h3 className={s.deckTitle}>The UCT Method</h3>
            <span className={s.deckSub}>{(method?.tracks || []).length} stations, one trade. Work down the road; every station opens its lessons.</span>
          </div>
          {method && rec?.track ? (
            <StationBanner method={method} rec={rec} byId={byId} onContinue={() => openTrack(method, rec.track.id)} />
          ) : null}
          {method ? (
            <CoursePath tracks={method.tracks || []} byId={byId} recommendedTrackId={recTrackId} onOpenTrack={(id) => openTrack(method, id)} label="The UCT Method stations" />
          ) : <div className={s.pathSkeleton} aria-hidden="true" />}
        </div>
        <aside className={s.side}>
          {onOpenChallenge ? (
            <div className={s.sideBlock}>
              <div className={s.deckHead}>
                <h3 className={s.deckTitle}>Games</h3>
                <span className={s.deckSub}>Real charts from the UCT bank. Every answer counts toward your XP.</span>
              </div>
              <GameCards onOpenChallenge={onOpenChallenge} />
            </div>
          ) : null}
          {onOpenChallenge && CHALLENGES.some((c) => c.group === 'skill') ? (
            <div className={s.sideBlock}>
              <div className={s.deckHead}>
                <h3 className={s.deckTitle}>Skill games</h3>
                <span className={s.deckSub}>Orders, sizing, options, earnings, risk and discipline, worked out on the spot. Every run earns XP.</span>
              </div>
              <GameCards onOpenChallenge={onOpenChallenge} group="skill" label="Skill games" />
            </div>
          ) : null}
          {foundations ? (
            <div className={s.sideBlock}>
              <div className={s.deckHead}>
                <h3 className={s.deckTitle}>Foundations</h3>
                <span className={s.deckSub}>What a trader should know before the method. Any order.</span>
              </div>
              <CoinGrid tracks={foundations.tracks || []} byId={byId} onOpenTrack={(id) => openTrack(foundations, id)} label="Foundations tracks" />
            </div>
          ) : null}
          <TrophyShelf badges={earned} />
        </aside>
      </div>
    </section>
  )
}
