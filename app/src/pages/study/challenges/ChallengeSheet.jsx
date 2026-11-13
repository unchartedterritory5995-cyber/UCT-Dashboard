// THE CHALLENGES (the owner's delegation, 2026-11-03): the scored workbench modes in the product, each a fullscreen
// Sheet beside the drill player. Opened from the Study landing's Challenges deck (?study=challenge&challenge=kind).
import { lazy, Suspense } from 'react'
import Sheet from '../../../components/mobile/Sheet'
import UIcon from '../../../components/ui/UIcon'
import d5 from '../../../lab/duo.module.css'
import styles from '../DrillPlayer.module.css'
import BlitzChallenge from './BlitzChallenge'
import BossChallenge from './BossChallenge'
import HardChallenge from './HardChallenge'
import DrawItChallenge from './DrawItChallenge'
import SpotSetupChallenge from './SpotSetupChallenge'
import { ALIASES, CHALLENGES, GAME_LIST } from './registry'

const BODIES = {
  blitz: BlitzChallenge, boss: BossChallenge, spot: SpotSetupChallenge, hard: HardChallenge, draw: DrawItChallenge,
  ...Object.fromEntries(GAME_LIST.map((g) => [g.kind, lazy(g.load)])),
}

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
          <Suspense fallback={<p className={styles.loading} role="status">Loading the game.</p>}>
            <Body profile={profile} onClose={onClose} signedOut={signedOut} {...(fetcher ? { fetcher } : {})} />
          </Suspense>
        </div>
      </div>
    </Sheet>
  )
}
