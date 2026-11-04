import ChallengeSheet from '../../pages/study/challenges/ChallengeSheet'
import SandboxSignIn from '../SandboxSignIn'

/** Round 15: the PRODUCT Boss, the real component the members get, on the sandbox bank. */
export default function Piece62ChallengeBoss() {
  return <ChallengeSheet kind="boss" open onClose={() => {}} signedOut={<SandboxSignIn onDone={() => window.location.reload()} />} />
}
