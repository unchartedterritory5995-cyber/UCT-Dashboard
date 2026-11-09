import ChallengeSheet from '../../pages/study/challenges/ChallengeSheet'
import SandboxSignIn from '../SandboxSignIn'

/** Batch 18: the PRODUCT Hard mode (plan piece 43), the real component the members get, on the sandbox bank. */
export default function Piece65ChallengeHard() {
  return <ChallengeSheet kind="hard" open onClose={() => {}} signedOut={<SandboxSignIn onDone={() => window.location.reload()} />} />
}
