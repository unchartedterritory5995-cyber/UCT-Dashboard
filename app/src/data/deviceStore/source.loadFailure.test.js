// @vitest-environment node
// THE CLIENT CHUNK THAT DOES NOT LOAD (TERM-033, lib/swallowedFetch.census.test.js). source.js imports the device client
// lazily, on the first device read. When that import fails (offline, a deploy that removed the chunk, a blocked
// worker URL) the store has nothing to answer with: every read answers null and the chart asks the server, as it does
// with the store off. That is a MISS, never an error, and it is COUNTED (`deviceClientLoadFailures`), so a page whose
// store never loaded says so instead of reading like a store that holds nothing.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./client', () => { throw new Error('the client chunk is gone') })

describe('a device client that cannot load', () => {
  it('answers null to every read and peek (the chart asks the server), and the failure is counted once', async () => {
    const src = await import('./source')
    expect(src.deviceClientLoadFailures()).toBe(0)
    const ds = src.deviceSource({ enabled: () => true })
    expect(ds).not.toBeNull()
    expect(await ds.read('AAPL', 'D')).toBeNull()
    expect(src.deviceClientLoadFailures()).toBe(1)
    expect(ds.peek('AAPL', 'D')).toBeNull()
    expect(await ds.read('MSFT', '5', { urgent: true })).toBeNull()
    expect(await ds.why('AAPL', 'D')).toBe('no-client')
    expect(src.deviceClientLoadFailures()).toBe(1)                      // one lazy load per page, not one per read
  })
})
