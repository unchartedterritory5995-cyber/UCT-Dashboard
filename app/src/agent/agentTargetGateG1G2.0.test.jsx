// G1/G2 target gate (AUDIT 11-23), slice 0 of testing/targetGateG1G2Suite.SLICES (see that file).
import { vi } from 'vitest'
import { registerBuiltins } from './builtins'
import { targetGateG1G2Suite } from './testing/targetGateG1G2Suite'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
targetGateG1G2Suite(0)
