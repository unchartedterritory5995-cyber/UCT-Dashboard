// Ticker-named compound + chart exclusion rail, slice 2 of testing/tickerCompoundExclusionSuite.SLICES (see that file).
import { vi } from 'vitest'
import { registerBuiltins } from './builtins'
import { tickerCompoundExclusionSuite } from './testing/tickerCompoundExclusionSuite'

vi.mock('../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
registerBuiltins()
tickerCompoundExclusionSuite(2)
