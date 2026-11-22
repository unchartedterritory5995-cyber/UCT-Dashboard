// CAPABILITY REGRESSION · corpus level (c), slice 3 of testing/finalState.SLICES (see testing/finalState.jsx).
import { vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from './testing/registry'
import { finalStateSuite } from './testing/finalState'
import { pinClock } from './testing/clock'

pinClock()                   // one fixed instant (testing/clock.js): the market clock never depends on when CI runs

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })
finalStateSuite(3)
