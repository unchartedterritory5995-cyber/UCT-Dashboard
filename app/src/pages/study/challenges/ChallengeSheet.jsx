// THE CHALLENGES (the owner's delegation, 2026-11-03): the scored workbench modes in the product, each a fullscreen
// Sheet beside the drill player. Opened from the Study landing's Challenges deck (?study=challenge&challenge=kind).
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import d5 from '../../../lab/duo.module.css'
import styles from '../DrillPlayer.module.css'
import BlitzChallenge from './BlitzChallenge'
import BossChallenge from './BossChallenge'
import HardChallenge from './HardChallenge'
import DrawItChallenge from './DrawItChallenge'
import SpotSetupChallenge from './SpotSetupChallenge'

export const CHALLENGES = [
  { kind: 'blitz', title: 'Blitz', sub: 'Sixty seconds, no hearts, a quick read on every chart.', icon: 'bolt' },
  { kind: 'boss', title: 'Boss', sub: 'Ten charts, one heart. Miss once and it ends.', icon: 'star' },
  // the owner, 2026-11-08: "SPOT THE KICKER SHOULD be SPOT THE SETUP" (every setup, not only the Kicker)
  { kind: 'spot', title: 'Spot the Setup', sub: 'A few gold candles look alike. One is the real setup.', icon: 'eye' },
  // round 19 (owner, batch 19): only the ticker is hidden; the member's own averages and volume stay on the chart
  { kind: 'hard', title: 'Hard mode', sub: 'No ticker, on your own chart. Name what fired on the last candle, or say nothing did.', icon: 'eyeOff' },
  // the owner's draw game, in the product (2026-11-08): place the entry and the stop, scored against the setup's own plan
  { kind: 'draw', title: 'Draw it', sub: 'Place the entry and the stop on a real setup. The plan shows where they go.', icon: 'play' },
]
// 'kicker' stays a door: a saved ?challenge=kicker link opens Spot the Setup
const ALIASES = { kicker: 'spot' }
export const CHALLENGE_KINDS = new Set([...CHALLENGES.map((c) => c.kind), ...Object.keys(ALIASES)])

const BODIES = { blitz: BlitzChallenge, boss: BossChallenge, spot: SpotSetupChallenge, hard: HardChallenge, draw: DrawItChallenge }

export default function ChallengeSheet({ kind, open = true, onClose, profile = null, fetcher, signedOut = null }) {
  const meta = CHALLENGES.find((c) => c.kind === (ALIASES[kind] || kind)) || CHALLENGES[0]
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
          <Body profile={profile} onClose={onClose} signedOut={signedOut} {...(fetcher ? { fetcher } : {})} />
        </div>
      </div>
    </Sheet>
  )
}
