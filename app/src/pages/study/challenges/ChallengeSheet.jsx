// THE CHALLENGES (the owner's delegation, 2026-11-03): the scored workbench modes in the product, each a fullscreen
// Sheet beside the drill player. Opened from the Study landing's Challenges deck (?study=challenge&challenge=kind).
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import d5 from '../../../lab/duo.module.css'
import styles from '../DrillPlayer.module.css'
import BlitzChallenge from './BlitzChallenge'
import BossChallenge from './BossChallenge'
import KickerChallenge from './KickerChallenge'

export const CHALLENGES = [
  { kind: 'blitz', title: 'Blitz', sub: 'Sixty seconds, no hearts, a quick read on every chart.', icon: 'bolt' },
  { kind: 'boss', title: 'Boss', sub: 'Ten charts, one heart. Miss once and it ends.', icon: 'star' },
  { kind: 'kicker', title: 'Spot the Kicker', sub: 'Three gold candles. One is the real thing.', icon: 'eye' },
]
export const CHALLENGE_KINDS = new Set(CHALLENGES.map((c) => c.kind))

const BODIES = { blitz: BlitzChallenge, boss: BossChallenge, kicker: KickerChallenge }

export default function ChallengeSheet({ kind, open = true, onClose, profile = null, fetcher }) {
  const meta = CHALLENGES.find((c) => c.kind === kind) || CHALLENGES[0]
  const Body = BODIES[meta.kind]
  return (
    <Sheet open={open} onClose={onClose} variant="fullscreen" dismissOnBackdrop={false} ariaLabel={meta.title} className={styles.panel} bodyClassName={styles.sheetBody}>
      <div className={styles.top}>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <UIcon name="x" size={18} gold={false} />
        </button>
        <span className={styles.comboGhost} aria-hidden="true" />
      </div>
      <div className={styles.scroll} data-testid={`challenge-${meta.kind}`}>
        <div className={d5.lesson}>
          <Body profile={profile} onClose={onClose} {...(fetcher ? { fetcher } : {})} />
        </div>
      </div>
    </Sheet>
  )
}
