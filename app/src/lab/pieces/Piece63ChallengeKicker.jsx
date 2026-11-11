import ChallengeSheet from '../../pages/study/challenges/ChallengeSheet'
import SandboxSignIn from '../SandboxSignIn'

/** Round 15: the PRODUCT Spot the Setup (Spot the Kicker until 2026-11-08), the real component the members get, on the sandbox bank. */
export default function Piece63ChallengeKicker() {
  return <ChallengeSheet kind="spot" open onClose={() => {}} signedOut={<SandboxSignIn onDone={() => window.location.reload()} />} />
}
