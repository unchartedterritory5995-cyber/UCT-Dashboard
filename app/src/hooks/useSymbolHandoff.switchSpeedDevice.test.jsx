// The switch-speed instrument's "device store on" side (2026-11-23), through the real handoff. The store's switch is
// ONE answer per page load, read when the handoff's module loads (useSymbolHandoff DEVICE), and the handoff hands that
// answer to the instrument: a page with the store on files its switches under store = 1. The store-off side, and
// everything else, is useSymbolHandoff.switchSpeed.test.jsx.
import { render, fireEvent, act } from '@testing-library/react'
import { useLayoutEffect, useState } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../components/chart/barStoreSwitch', () => ({ BARSTORE: true }))
vi.mock('../data/deviceStore/switch', () => ({ deviceStoreEnabled: () => true }))
vi.mock('../data/barStore/prefetch', () => ({
  peekDisplayable: () => true,
  lakePending: () => false,
  deepPending: () => false,
  holdsBars: () => true,
  heldRows: () => 0,
  devicePaints: () => true,
  deviceHold: () => null,
  deviceWarm: () => undefined,
  watch: () => null,
  askForDisplay: () => {},
  prepareForDisplay: () => new Promise(() => {}),
  prepareDailyForDisplay: () => new Promise(() => {}),
  prefetchBarsToIDB: () => {},
}))
vi.mock('../utils/prefetchBars', () => ({ prefetchBarsToIDB: () => {}, prepareForDisplay: () => new Promise(() => {}), prepareDailyForDisplay: () => new Promise(() => {}) }))
vi.mock('../utils/barsMemCache', () => ({ memPeek: () => null }))
vi.mock('../components/chart/engine/serverCompute', () => ({
  columnsReadyFor: () => true, whenColumnsReady: () => Promise.resolve(true), warmColumnsFor: () => {},
}))

import useSymbolHandoff from './useSymbolHandoff'
import { beginGroupSwitch, __resetHandoffGroupsForTests, __resetScopeForTests } from './handoffGroups'
import { recordPaint } from '../components/chart/paintLog'
import { peekSwitchCounts, __resetSwitchSpeedForTests, __setSwitchClockForTests } from '../lib/switchSpeed'

const G = 'charts:A'
let scope
let frames
let clock
let pressAt

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date('2026-11-18T15:00:00Z'))        // a Wednesday, 10:00 in New York
  __resetHandoffGroupsForTests()
  __resetSwitchSpeedForTests()
  scope = { board: 1 }
  frames = []
  clock = 0
  pressAt = null
  __setSwitchClockForTests(() => clock)
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length })
})
afterEach(() => {
  __resetScopeForTests(scope)
  __resetSwitchSpeedForTests()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function Chart({ tf, member, s }) {
  const shown = useSymbolHandoff(s, tf, { group: G, scope, member })
  useLayoutEffect(() => { recordPaint(shown, tf, 100, 'full', member) }, [shown, tf, member])
  return <span data-testid={`chart-${tf}`}>{shown}</span>
}
const MEMBERS = [{ id: 1 }, { id: 2 }]
function Board() {
  const [sym, setSym] = useState('AAA')
  const next = (e) => { pressAt = e.nativeEvent.timeStamp; beginGroupSwitch(scope, G, 'BBB'); setSym('BBB') }
  return (
    <>
      <ul data-testid="list" tabIndex={0} onKeyDown={next} />
      <Chart tf="1" member={MEMBERS[0]} s={sym} />
      <Chart tf="D" member={MEMBERS[1]} s={sym} />
    </>
  )
}

describe('a page with the device store on', () => {
  it('files its switches under store = 1', async () => {
    const view = render(<Board />)
    fireEvent.keyDown(view.getByTestId('list'), { key: 'ArrowDown' })
    expect(view.getByTestId('chart-1').textContent + view.getByTestId('chart-D').textContent).toBe('BBBBBB')
    await act(async () => {})
    clock = pressAt + 20
    frames.splice(0).forEach((cb) => cb(clock))
    //                                  tf 1m, STORE ON, list-key, decision, in the session; 20 ms -> 16-25
    expect(peekSwitchCounts().cells).toEqual([[0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]])
  })
})
