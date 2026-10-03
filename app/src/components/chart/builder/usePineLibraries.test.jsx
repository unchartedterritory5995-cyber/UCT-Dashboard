// app/src/components/chart/builder/usePineLibraries.test.jsx
//
// ⭐ L1 — the doors' library fetch: a source that imports nothing makes NO request;
// a source that imports a library fetches it (and what it imports) once, and the
// revision the door's translation depends on moves when it lands.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

import { usePineLibraries } from './usePineLibraries'
import { clearPineLibraries, pineLibraryEntry } from '../engine/ast/pineLibraryStore'

const LIB = {
  path: 'tester/fixturelib/1',
  source: '//@version=5\nlibrary("fixturelib")\nexport one() => 1\n',
  licence: 'MPL-2.0',
  attribution: 'fixturelib (test fixture)',
}

function Probe({ source }) {
  const revision = usePineLibraries(source)
  return <span data-testid="rev">{revision}</span>
}

afterEach(() => {
  clearPineLibraries()
  vi.unstubAllGlobals()
})

describe('usePineLibraries', () => {
  it('a source that imports nothing makes no request', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    render(<Probe source={'//@version=5\nindicator("t")\nplot(close)\n'} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByTestId('rev').textContent).toBe('0')
  })

  it('fetches the imported library into the registry and moves the revision', async () => {
    const fetchSpy = vi.fn(async (url) => (url.endsWith('/tester/fixturelib/1')
      ? { ok: true, json: async () => LIB } : { ok: false }))
    vi.stubGlobal('fetch', fetchSpy)
    render(<Probe source={'//@version=5\nindicator("t")\nimport tester/fixturelib/1 as fx\nplot(fx.one())\n'} />)
    await waitFor(() => expect(screen.getByTestId('rev').textContent).toBe('1'))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/pine/libraries/tester/fixturelib/1')
    expect(pineLibraryEntry('tester/fixturelib/1').licence).toBe('MPL-2.0')
  })
})
