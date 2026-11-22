import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_TIMEOUT_MS, CAP_MS, TICK_MS, WAKE_GAP_MS,
  __resetAppRecoveryForTests, appRecovery, createRecovery, registerRecoveryStream, setRecoveryAuthCheck,
} from './recovery'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); __resetAppRecoveryForTests() })

const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms) }

function rig({ online = true, connected = () => true, auth } = {}) {
  const calls = []
  let isOn = online
  const r = createRecovery({
    recheckAuth: auth || (async () => { calls.push('auth') }),
    reconnectStreams: () => calls.push('reconnect'),
    streamsConnected: connected,
    isOnline: () => isOn,
  })
  return { r, calls, setOnline: (v) => { isOn = v } }
}

describe('createRecovery: the sequence', () => {
  it('re-checks sign-in BEFORE reconnecting the streams, then reports idle once they connect', async () => {
    let up = false
    const states = []
    const { r, calls } = rig({ connected: () => up })
    r.subscribe((s) => states.push(s))
    const done = r.trigger('online')
    await settle(0)
    expect(calls).toEqual(['auth', 'reconnect'])
    expect(r.getState()).toBe('recovering')
    await settle(1000)
    expect(r.getState()).toBe('recovering') // not cleared by a timer while streams are still down
    up = true
    await settle(300)
    await done
    expect(r.getState()).toBe('idle')
    expect(states).toEqual(['recovering', 'idle'])
  })

  it('the streams do not reconnect until the sign-in check has answered', async () => {
    let answer
    const { r, calls } = rig({ auth: () => new Promise((res) => { answer = res }) })
    r.trigger('wake')
    await settle(1000)
    expect(calls).toEqual([])
    answer()
    await settle(0)
    expect(calls).toEqual(['reconnect'])
  })

  it('a sign-in check that never answers is abandoned after AUTH_TIMEOUT_MS', async () => {
    const { r, calls } = rig({ auth: () => new Promise(() => {}) })
    r.trigger('wake')
    await settle(AUTH_TIMEOUT_MS - 1)
    expect(calls).toEqual([])
    await settle(2)
    expect(calls).toEqual(['reconnect'])
  })

  it('a failing sign-in check still lets the streams reconnect', async () => {
    const { r, calls } = rig({ auth: async () => { throw new Error('net') } })
    await r.trigger('online')
    expect(calls).toEqual(['reconnect'])
    expect(r.getState()).toBe('idle')
  })

  it('streams that never connect end the banner at CAP_MS (their own watchdogs carry on)', async () => {
    const { r } = rig({ connected: () => false })
    r.trigger('wake')
    await settle(CAP_MS - 500)
    expect(r.getState()).toBe('recovering')
    await settle(1000)
    expect(r.getState()).toBe('idle')
  })

  it('a second trigger during a run does not start another sequence', async () => {
    let up = false
    const { r, calls } = rig({ connected: () => up })
    r.trigger('online')
    await settle(0)
    r.trigger('wake')
    await settle(0)
    expect(calls).toEqual(['auth', 'reconnect'])
    up = true
    await settle(300)
  })

  it('offline: a trigger while offline parks at offline; going offline mid-run abandons it', async () => {
    const { r, calls, setOnline } = rig({ online: false })
    expect(r.getState()).toBe('offline')
    await r.trigger('wake')
    expect(r.getState()).toBe('offline')
    expect(calls).toEqual([])
    setOnline(true)
    let up = false
    const r2 = createRecovery({ recheckAuth: async () => {}, reconnectStreams: () => {}, streamsConnected: () => up, isOnline: () => true })
    r2.trigger('online')
    await settle(0)
    r2.goOffline()
    up = true
    await settle(500)
    expect(r2.getState()).toBe('offline') // the abandoned run never flips it back to idle
  })
})

describe('install: the triggers', () => {
  function installRig() {
    const { r, calls, setOnline } = rig()
    const uninstall = r.install(window, document)
    return { r, calls, setOnline, uninstall }
  }
  const setVis = (v) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }) }

  it('the online event starts recovery, the offline event parks it', async () => {
    const { r, calls, setOnline, uninstall } = installRig()
    setOnline(false)
    window.dispatchEvent(new Event('offline'))
    expect(r.getState()).toBe('offline')
    setOnline(true)
    window.dispatchEvent(new Event('online'))
    await settle(0)
    expect(calls).toEqual(['auth', 'reconnect'])
    uninstall()
  })

  it('a wake from sleep (a long gap between ticks) starts recovery; an ordinary late tick does not', async () => {
    const { calls, uninstall } = installRig()
    vi.setSystemTime(Date.now() + WAKE_GAP_MS - 10000)
    await settle(TICK_MS)
    expect(calls).toEqual([])
    vi.setSystemTime(Date.now() + WAKE_GAP_MS + 1000)
    await settle(TICK_MS)
    expect(calls).toEqual(['auth', 'reconnect'])
    uninstall()
  })

  it('a page back after a long hidden spell starts recovery; a short one does not', async () => {
    const { calls, uninstall } = installRig()
    setVis('hidden'); document.dispatchEvent(new Event('visibilitychange'))
    vi.setSystemTime(Date.now() + 5000)
    setVis('visible'); document.dispatchEvent(new Event('visibilitychange'))
    await settle(0)
    expect(calls).toEqual([])
    setVis('hidden'); document.dispatchEvent(new Event('visibilitychange'))
    vi.setSystemTime(Date.now() + WAKE_GAP_MS + 1000)
    setVis('visible'); document.dispatchEvent(new Event('visibilitychange'))
    await settle(0)
    expect(calls).toEqual(['auth', 'reconnect'])
    uninstall()
  })

  it('uninstall removes every trigger', async () => {
    const { calls, uninstall } = installRig()
    uninstall()
    window.dispatchEvent(new Event('online'))
    vi.setSystemTime(Date.now() + WAKE_GAP_MS * 2)
    await settle(TICK_MS * 2)
    expect(calls).toEqual([])
  })
})

describe('appRecovery: the app wiring', () => {
  it('uses the registered sign-in check and every registered stream', async () => {
    const calls = []
    setRecoveryAuthCheck(async () => { calls.push('auth') })
    let a = false
    registerRecoveryStream({ name: 'a', reconnectNow: () => calls.push('a'), isConnected: () => a })
    registerRecoveryStream({ name: 'b', reconnectNow: () => calls.push('b'), isConnected: () => true })
    const r = appRecovery()
    r.trigger('online')
    await settle(0)
    expect(calls).toEqual(['auth', 'a', 'b'])
    expect(r.getState()).toBe('recovering')
    a = true
    await settle(300)
    expect(r.getState()).toBe('idle')
  })

  it('with no streams registered there is nothing to wait for', async () => {
    const r = appRecovery()
    await r.trigger('online')
    expect(r.getState()).toBe('idle')
  })

  it('the stream managers register themselves when they load: recovery replaces a live connection', async () => {
    vi.resetModules()
    const opened = []
    globalThis.EventSource = class { constructor(url) { this.url = url; this.closed = false; opened.push(this) } addEventListener() {} close() { this.closed = true } }
    const rec = await import('./recovery')
    const price = await import('./priceStreamManager')
    price.subscribe(['AAPL'], () => {})
    await settle(price.REBUILD_DEBOUNCE_MS + 10)
    expect(opened).toHaveLength(1)
    opened[0].onopen?.()
    rec.appRecovery().trigger('online')
    await settle(0)
    expect(opened[0].closed).toBe(true)
    expect(opened).toHaveLength(2)
    price._resetForTests()
  })

})
