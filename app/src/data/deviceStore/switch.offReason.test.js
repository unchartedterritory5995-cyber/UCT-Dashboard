// @vitest-environment jsdom
// WHY IS THE STORE OFF ON THIS PAGE LOAD (review of #2563, MEDIUM-1 / MEDIUM-2)? switch.deviceStoreOffReason answers it,
// once per page load like deviceStoreEnabled (null exactly when the store is on), and source.js deletes the packs only
// for 'member-off' (the member's own '0') and 'device-purge' (the server's purge), and on 'default-off' only once the
// store has not run here for 30 days. Every state of the key, the default and the two kills, each on its own page load.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const KEY = 'uct.deviceStore'
const clearKills = () => { document.cookie = 'uct_chart_speed=; max-age=0; path=/'; document.cookie = 'uct_device_store=; max-age=0; path=/' }

/** One page load in state {key, defaultOn, speed (the chart-speed kill), device ('0' | 'purge')}: [enabled, reason]. */
async function stateOf({ key = null, defaultOn = false, speed = false, device = null }) {
  clearKills()
  if (key === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, key)
  if (speed) document.cookie = 'uct_chart_speed=0; path=/'
  if (device) document.cookie = `uct_device_store=${device}; path=/`
  vi.resetModules()
  const sw = await import('./switch')
  sw.__setDeviceStoreDefaultForTests(defaultOn)
  return [sw.deviceStoreEnabled(), sw.deviceStoreOffReason()]
}

beforeEach(() => { localStorage.clear(); clearKills() })
afterEach(() => { localStorage.clear(); clearKills() })

describe('deviceStoreOffReason: the state -> on? -> why off', () => {
  it.each([
    ['no key, the default OFF', { defaultOn: false }, [false, 'default-off']],
    ['no key, the default ON', { defaultOn: true }, [true, null]],
    ["'1'", { key: '1' }, [true, null]],
    ["'0'", { key: '0', defaultOn: true }, [false, 'member-off']],
    ["a value that is not a choice ('off')", { key: 'off', defaultOn: true }, [false, 'not-a-choice']],
    ["the chart-speed kill (over '1')", { key: '1', speed: true }, [false, 'chart-speed-kill']],
    ["the device kill =0 (over '1')", { key: '1', device: '0' }, [false, 'device-kill']],
    ["the device PURGE (over '1')", { key: '1', device: 'purge' }, [false, 'device-purge']],
    ["the device PURGE with the chart-speed kill too", { key: '1', speed: true, device: 'purge' }, [false, 'device-purge']],
    ["the member's '0' under the chart-speed kill", { key: '0', speed: true }, [false, 'member-off']],
    ["the member's '0' under the device kill =0", { key: '0', device: '0' }, [false, 'member-off']],
    ['the device kill over the default ON', { defaultOn: true, device: '0' }, [false, 'device-kill']],
  ])('%s', async (_label, state, want) => {
    expect(await stateOf(state)).toEqual(want)
  })

  it('one answer per page load: a key changed later changes nothing until the next load', async () => {
    localStorage.setItem(KEY, '0')
    vi.resetModules()
    const sw = await import('./switch')
    expect(sw.deviceStoreOffReason()).toBe('member-off')
    localStorage.setItem(KEY, 'off')
    expect(sw.deviceStoreOffReason()).toBe('member-off')
    expect(sw.deviceStoreEnabled()).toBe(false)
  })
})
