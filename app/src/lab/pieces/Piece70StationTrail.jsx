import '../../styles/tokens.css'
import SkillTrail from '../../pages/study/SkillTrail'

/** 2026-11-08: the station page (Desk -> Courses -> a station), from the real component on the sandbox's own map. */
export default function Piece70StationTrail() {
  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '18px 14px' }}>
      <SkillTrail curriculumId="method" onBack={() => {}} onStartUnit={() => {}} onTestOut={() => {}} onReplayIntro={() => {}} />
    </div>
  )
}
