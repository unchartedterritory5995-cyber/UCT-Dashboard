import ChallengeSheet from '../../pages/study/challenges/ChallengeSheet'
import SandboxSignIn from '../SandboxSignIn'

/** Round 15: the PRODUCT Blitz, the real component the members get, on the sandbox bank. */
export default function Piece61ChallengeBlitz() {
  return <ChallengeSheet kind="blitz" open onClose={() => {}} signedOut={<SandboxSignIn onDone={() => window.location.reload()} />} />
}
