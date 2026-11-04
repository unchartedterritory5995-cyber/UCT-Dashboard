import ChallengeSheet from '../../pages/study/challenges/ChallengeSheet'
import SandboxSignIn from '../SandboxSignIn'

/** Round 15: the PRODUCT Spot the Kicker, the real component the members get, on the sandbox bank. */
export default function Piece63ChallengeKicker() {
  return <ChallengeSheet kind="kicker" open onClose={() => {}} signedOut={<SandboxSignIn onDone={() => window.location.reload()} />} />
}
