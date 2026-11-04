// CAPABILITY REGRESSION · corpus level (c), slice 2 of lib/finalState.SLICES (see lib/finalState.jsx).
import { vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { registerCatalog } from './lib/registry'
import { finalStateSuite } from './lib/finalState'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
await registerCatalog()
afterEach(() => { vi.restoreAllMocks(); cleanup() })
finalStateSuite(2)
