// THE LEVEL BAR on every end screen (2026-11-08, the reward system): the member's level, the bar filling from where the
// run began to where it ended, the XP it earned, and a level up called when the run crossed one (level = 1 + xp // 500,
// study_store.XP_PER_LEVEL). Only the server's numbers.
import { useEffect, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { XP_PER_LEVEL, levelOf, tierOf } from '../studyLevels'
import b from './levelBar.module.css'

export default function LevelBar({ before, after, testId = 'level-bar' }) {
  const lvBefore = levelOf(before), lvAfter = levelOf(after)
  const up = lvAfter > lvBefore
  const startPct = up ? 0 : ((before % XP_PER_LEVEL) / XP_PER_LEVEL) * 100
  const endPct = ((after % XP_PER_LEVEL) / XP_PER_LEVEL) * 100
  const [pct, setPct] = useState(startPct)
  useEffect(() => { const t = setTimeout(() => setPct(endPct), 450); return () => clearTimeout(t) }, [endPct])
  return (
    <div className={`${b.wrap} ${up ? b.up : ''}`} data-testid={testId}>
      {up ? <span className={b.banner} data-testid={`${testId}-up`}><UIcon name="star" size={16} gold={false} />Level up · Level {lvAfter} · {tierOf(lvAfter)}</span> : null}
      <div className={b.row}>
        <span className={b.coin} aria-hidden="true">{lvAfter}</span>
        <div className={b.main}>
          <div className={b.track} role="progressbar" aria-valuemin={0} aria-valuemax={XP_PER_LEVEL} aria-valuenow={after % XP_PER_LEVEL} aria-label={`Level ${lvAfter}, ${after % XP_PER_LEVEL} of ${XP_PER_LEVEL} XP`}>
            <div className={b.fill} style={{ width: `${Math.max(2, pct)}%` }}><i /></div>
          </div>
          <span className={b.text}><b>+{Math.max(0, after - before)} XP</b> this run · {XP_PER_LEVEL - (after % XP_PER_LEVEL)} XP to Level {lvAfter + 1}</span>
        </div>
      </div>
    </div>
  )
}
