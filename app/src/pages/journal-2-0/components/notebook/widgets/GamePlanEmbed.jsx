// Wave 10 (Task 10.15): Pre-market game plan -- the morning wire, my names reporting, my open risk
// (shelf_compose.my_game_plan). Three parts that fail ALONE: each part is its own section with its own sentences, so a
// wire that could not be read never hides the names reporting or the open risk.
import { DedicatedShell, Lines, dedicatedStyles as d } from './DedicatedParts'

export const KIND = 'myGamePlan'
/** [payload key, heading]: labels only, every sentence under them is the part's own. */
export const GAME_PLAN_PARTS = [['wire', 'Morning wire'], ['reporting', 'Names reporting'], ['risk', 'Open risk']]

export default function GamePlanEmbed({ attrs, height = 360, editable = false, onUpdateParams, uid }) {
  const p = attrs?.params || {}
  return (
    <DedicatedShell kind={KIND} attrs={attrs} height={height} editable={editable} onUpdateParams={onUpdateParams}
      uid={uid} testId="game-plan-embed">
      {GAME_PLAN_PARTS.map(([key, heading]) => {
        const part = p[key] && typeof p[key] === 'object' ? p[key] : null
        if (!part) return null
        return (
          <section key={key} className={d.section} data-part={key} aria-label={heading}>
            <h3 className={d.heading}>{heading}</h3>
            <Lines lines={part.lines} />
          </section>
        )
      })}
    </DedicatedShell>
  )
}
