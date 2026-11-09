import '../../styles/tokens.css'
import StudyLanding from '../../pages/study/StudyLanding'

/** Round 14: the PRODUCT landing (Desk -> Courses -> Study) with the decided mark in its hero, rendered from the real
 *  component on fixture progress so the owner sees exactly what ships, without a build. */
const unit = (id, skills) => ({ id, title: `Unit ${id}`, skills })
const curricula = [
  { id: 'method', title: 'The UCT Method', tracks: [
    { id: 'REG', title: 'Regime', units: [unit('R1', ['a']), unit('R2', ['b'])] },
    { id: 'SCN', title: 'Scan', units: [unit('S1', ['c'])] },
    { id: 'SET', title: 'Setup', units: [unit('T1', ['d'])] },
    { id: 'SIZ', title: 'Size', units: [unit('Z1', ['f'])] },
    { id: 'MAN', title: 'Manage', units: [unit('M1', ['g'])] },
    { id: 'REV', title: 'Review', units: [unit('V1', ['j'])] },
    { id: 'CAL', title: 'Calls', units: [unit('C1', ['k'])] },
    { id: 'OVL', title: 'Overlay', units: [unit('O1', ['l'])] },
  ] },
  { id: 'foundations', title: 'UCT Foundations', tracks: [
    { id: 'F1', title: 'Market basics', units: [unit('F1.01', ['h'])] },
    { id: 'F2', title: 'Chart reading', units: [unit('F2.01', ['i'])] },
    { id: 'F2b', title: 'Levels, lines and drawings', units: [unit('F2b.01', ['m'])] },
    { id: 'F3', title: 'Candlesticks', units: [unit('F3.01', ['n'])] },
    { id: 'F4', title: 'Patterns and bases', units: [unit('F4.01', ['o'])] },
    { id: 'F5', title: 'Fundamentals and earnings', units: [] },
    { id: 'F6', title: 'Options', units: [] },
    { id: 'F8', title: 'Psychology and discipline', units: [] },
    { id: 'F9', title: 'Account and risk basics', units: [] },
  ] },
]
const byId = { a: { skill_id: 'a', mastery: 90, reps: 10 }, c: { skill_id: 'c', mastery: 30, reps: 2 }, h: { skill_id: 'h', mastery: 88, reps: 9 } }

export default function Piece60LandingPreview() {
  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 18px' }}>
      <StudyLanding curricula={curricula} byId={byId} badges={[{ badge_id: 'first_set', earned_at: '2026-11-03' }, { badge_id: 'streak_3', earned_at: '2026-11-05' }, { badge_id: 'level_5', earned_at: '2026-11-06' }]}
        profile={{ xp: 3240, streak: 4, streak_best: 9, daily_goal: 50, last_done_day: '2026-11-07' }} today={{ session_id: 's', day_et: '2026-11-08', xp_today: 30, items: Array.from({ length: 10 }, (_, i) => ({ id: `i${i}` })), answered_item_ids: ['i0', 'i1', 'i2'] }}
        onStartToday={() => {}} onOpenChallenge={() => {}} />
    </div>
  )
}
