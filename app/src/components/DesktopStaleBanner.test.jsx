import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import DesktopStaleBanner from './DesktopStaleBanner'
import { CAP_MS, TICK_MS, WAKE_GAP_MS, createRecovery } from '../lib/recovery'

// The banner shows lib/recovery.js's state. These drive a real recovery instance, installed on the
// real window, with the streams' connected state in the test's hands.
let online
let streamsUp
let recovery
let uninstall

function setOnline(value) {
  online = value
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
}
async function fire(name) { await act(async () => { window.dispatchEvent(new Event(name)); await vi.advanceTimersByTimeAsync(0) }) }
async function advance(ms) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
/** Sleep: the wall clock jumps and the tick then fires once, late. */
async function sleepFor(ms) {
  await act(async () => {
    vi.setSystemTime(Date.now() + ms)
    await vi.advanceTimersByTimeAsync(TICK_MS)
  })
}
const banner = () => screen.queryByRole('status')

function mount() {
  recovery = createRecovery({ recheckAuth: async () => {}, reconnectStreams: () => {}, streamsConnected: () => streamsUp, isOnline: () => online })
  uninstall = recovery.install(window, document)
  return render(<DesktopStaleBanner recovery={recovery} />)
}

beforeEach(() => {
  vi.useFakeTimers()
  setOnline(true)
  streamsUp = true
})
afterEach(() => {
  cleanup()
  uninstall?.()
  vi.useRealTimers()
  delete navigator.onLine
})

describe('DesktopStaleBanner', () => {
  it('shows nothing while online and awake', async () => {
    mount()
    expect(banner()).toBeNull()
    await advance(TICK_MS * 20)
    expect(banner()).toBeNull()
  })

  it('starts offline when the machine is offline at launch, and stays up while it is', async () => {
    setOnline(false)
    mount()
    expect(banner()).toHaveTextContent(/offline/i)
    await advance(CAP_MS * 3)
    expect(banner()).toHaveTextContent(/offline/i)
  })

  it('offline, then back online: "Reconnecting" stays up until the streams are connected, then clears', async () => {
    mount()
    setOnline(false)
    await fire('offline')
    expect(banner()).toHaveTextContent(/offline/i)
    setOnline(true)
    streamsUp = false
    await fire('online')
    expect(banner()).toHaveTextContent(/moment behind/i)
    await advance(5000)
    expect(banner()).toHaveTextContent(/moment behind/i) // no blind timer clears it
    streamsUp = true
    await advance(300)
    expect(banner()).toBeNull()
  })

  it('after the PC wakes from sleep it shows "Reconnecting", then clears once connected', async () => {
    streamsUp = false
    mount()
    await sleepFor(WAKE_GAP_MS + 1000)
    expect(banner()).toHaveTextContent(/moment behind/i)
    streamsUp = true
    await advance(300)
    expect(banner()).toBeNull()
  })

  it('an ordinary late tick is not a wake from sleep', async () => {
    mount()
    await sleepFor(WAKE_GAP_MS - 10000)
    expect(banner()).toBeNull()
  })

  it('a wake while offline keeps the offline message', async () => {
    setOnline(false)
    mount()
    await sleepFor(WAKE_GAP_MS + 1000)
    expect(banner()).toHaveTextContent(/offline/i)
  })

  it('going offline during the catch-up keeps offline up', async () => {
    streamsUp = false
    mount()
    await fire('online')
    expect(banner()).toHaveTextContent(/moment behind/i)
    setOnline(false)
    await fire('offline')
    streamsUp = true
    await advance(CAP_MS)
    expect(banner()).toHaveTextContent(/offline/i)
  })

  it('streams that never connect still clear the banner at the cap', async () => {
    streamsUp = false
    mount()
    await fire('online')
    await advance(CAP_MS + 500)
    expect(banner()).toBeNull()
  })
})
