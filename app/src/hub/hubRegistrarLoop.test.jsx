// app/src/hub/hubRegistrarLoop.test.jsx
//
// ⛔⛔ REGISTERING A HUB MODE MUST NEVER RE-RENDER THE REGISTRANT.
//
// On 2026-09-10 the Catalysts controller keyed its config memo on the object `useHubCursor`
// returned — a fresh literal every render — so `useHubMode` re-registered on every render. That
// alone should have been one wasted setState. It was an infinite loop, because `useHubMode` read
// `registerHubMode` off the SAME context the registration writes to: register → context value
// changes → registrant re-renders → new config → register → … A passive-effect loop, which React
// never throws for, at ~4,500 renders a second. React Router's navigation transition never got
// to commit; the URL moved and the screen did not, and the member was held on the one page that
// was looping.
//
// Three properties, each mutation-proved (revert the named line and the case goes red):
//   1. A config that changes identity EVERY render settles. Mutation: point `useHubMode` back at
//      `useHub()` instead of `useHubRegistrar()`.
//   2. `useHubCursor` returns the SAME object across a re-render with the same inputs. Mutation:
//      replace its `useMemo` return with the old object literal.
//   3. The source control for (1): `useHubMode.js` must not read the main hub context.
import { render, cleanup, act, renderHook } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Component } from 'react'
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { HubProvider } from './HubContext'
import useHubMode from './useHubMode'
import useHubCursor, { _reset } from './useHubCursor'
import { modesById } from './registry'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

/** Past this many renders the component is looping, not settling. A settled mount is 1–3. */
const CAP = 50

class Boundary extends Component {
  constructor(p) { super(p); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() { return this.state.error ? <div data-caught={String(this.state.error.message)} /> : this.props.children }
}

/** A render tally the component mutates (not a variable it reassigns — the hooks lint forbids that). */
const tally = { renders: 0 }

/** A registrant whose config is a NEW object on every render — the worst legal caller. */
function FreshConfigEveryRender() {
  // A test tally, deliberately mutated during render — counting renders IS the measurement here.
  // eslint-disable-next-line react-hooks/immutability
  tally.renders += 1
  if (tally.renders > CAP) throw new Error(`render loop: ${tally.renders} renders`)
  useHubMode({ ...modesById.catalysts, onTap: () => {}, readout: () => 'fresh' })
  return null
}

afterEach(() => { cleanup(); _reset() })
beforeEach(() => { tally.renders = 0 })

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
}

describe('registering a hub mode cannot re-render the registrant', () => {
  it('⛔⛔ a config that changes identity every render SETTLES — it does not loop', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <HubProvider>
          <Boundary><FreshConfigEveryRender /></Boundary>
        </HubProvider>
      </MemoryRouter>,
    )
    await settle()
    const boundary = container.querySelector('[data-caught]')
    expect(boundary, boundary?.getAttribute('data-caught') || '').toBeNull()
    expect(tally.renders, 'the registrant re-rendered on its own registration — the 2026-09-10 loop')
      .toBeLessThan(CAP)
    // Non-vacuity: it really mounted and registered at least once.
    expect(tally.renders).toBeGreaterThan(0)
  })

  it('⛔ THE CONTROL: `useHubMode` reads the registrar context, never the main hub context', () => {
    const src = readFileSync(path.join(HERE, 'useHubMode.js'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).toMatch(/useHubRegistrar\(\)/)
    expect(code, 'useHubMode subscribes its caller to the value it writes — a per-render config '
      + 'loops again').not.toMatch(/\buseHub\(\)/)
  })

  it('⛔ the registrar context value is stable: registering does not change what registrants read', () => {
    const src = readFileSync(path.join(HERE, 'HubContext.jsx'), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).toMatch(/HubRegistrarContext\.Provider value=\{registerHubMode\}/)
    expect(code).toMatch(/const registerHubMode = useCallback\(/)
  })
})

describe('useHubCursor returns a stable object', () => {
  it('⛔ same inputs across a re-render ⇒ the SAME return object', () => {
    const rows = [{ ticker: 'NVDA' }, { ticker: 'AMD' }]
    const key = (r) => r.ticker
    const { result, rerender } = renderHook(() => useHubCursor('stable-test', rows, { key }))
    const first = result.current
    rerender()
    expect(result.current, 'a fresh object per render makes the cursor unsafe to put in a dep '
      + 'list — the shape that keyed the Catalysts loop').toBe(first)
    expect(first.count).toBe(2) // non-vacuity: a real cursor over a real list
  })

  it('and a genuine change (the index moved) still produces a new one', () => {
    const rows = [{ ticker: 'NVDA' }, { ticker: 'AMD' }]
    const key = (r) => r.ticker
    const { result } = renderHook(() => useHubCursor('moves-test', rows, { key }))
    const first = result.current
    act(() => { first.next() })
    expect(result.current).not.toBe(first)
    expect(result.current.index).toBe(1)
  })
})
