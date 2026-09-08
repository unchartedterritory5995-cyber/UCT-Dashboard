import { describe, it, expect } from 'vitest'
import {
  importerKeyFor,
  routeHrefFrom,
  createRoutePrefetcher,
  attachRoutePrefetch,
} from './routePrefetch'

// A stand-in for App.jsx's `pageImporters`: path -> dynamic import thunk.
function makeImporters(paths = ['/dashboard', '/options-flow', '/calendar', '/calendar/mystocks']) {
  const calls = []
  const m = new Map()
  for (const p of paths) m.set(p, () => { calls.push(p); return Promise.resolve({}) })
  return { importers: m, calls }
}

function anchorFor(html) {
  document.body.innerHTML = html
  return document.body.querySelector('a')
}

// The event shape the delegated document listener actually receives: the target
// is whatever was hovered, which is usually a child of the <a>, not the <a>.
function intentEventOn(el) {
  return { target: el }
}

describe('importerKeyFor', () => {
  it('matches an exact route', () => {
    const { importers } = makeImporters()
    expect(importerKeyFor(importers, '/options-flow')).toBe('/options-flow')
  })

  it('gives the LONGEST registered prefix, not the first that matches', () => {
    const { importers } = makeImporters()
    // /calendar also matches; MyStocksHub is the page actually rendered here.
    expect(importerKeyFor(importers, '/calendar/mystocks')).toBe('/calendar/mystocks')
  })

  it('matches a deeper path against its registered parent', () => {
    const { importers } = makeImporters()
    expect(importerKeyFor(importers, '/calendar/2026-09-07')).toBe('/calendar')
  })

  it('does NOT match a route that is merely a string prefix', () => {
    const { importers } = makeImporters(['/desk'])
    // /desktop is a different route; only a full segment boundary counts.
    expect(importerKeyFor(importers, '/desktop')).toBe(null)
  })

  it('returns null for an unregistered path', () => {
    const { importers } = makeImporters()
    expect(importerKeyFor(importers, '/nowhere')).toBe(null)
  })
})

describe('routeHrefFrom', () => {
  it('takes an in-app absolute path', () => {
    expect(routeHrefFrom(anchorFor('<a href="/options-flow">Flow</a>'))).toBe('/options-flow')
  })

  it('strips query and hash so they cannot fragment the dedupe key', () => {
    expect(routeHrefFrom(anchorFor('<a href="/options-flow?tab=gex#top">F</a>'))).toBe('/options-flow')
  })

  it('refuses an external URL', () => {
    expect(routeHrefFrom(anchorFor('<a href="https://example.com/options-flow">x</a>'))).toBe(null)
  })

  it('refuses a protocol-relative URL, which is also external', () => {
    expect(routeHrefFrom(anchorFor('<a href="//evil.test/options-flow">x</a>'))).toBe(null)
  })

  it('refuses a link that opens in another tab', () => {
    expect(routeHrefFrom(anchorFor('<a href="/options-flow" target="_blank">x</a>'))).toBe(null)
  })

  it('accepts an explicit target="_self"', () => {
    expect(routeHrefFrom(anchorFor('<a href="/options-flow" target="_self">x</a>'))).toBe('/options-flow')
  })

  it('refuses a bare anchor with no href', () => {
    document.body.innerHTML = '<a>no href</a>'
    expect(routeHrefFrom(document.body.querySelector('a'))).toBe(null)
  })
})

describe('createRoutePrefetcher', () => {
  it('warms the chunk for a link the member is aiming at', () => {
    const { importers, calls } = makeImporters()
    const { handleIntent } = createRoutePrefetcher(importers)
    const a = anchorFor('<a href="/options-flow"><span>Options Flow</span></a>')
    handleIntent(intentEventOn(a.querySelector('span')))
    expect(calls).toEqual(['/options-flow'])
  })

  it('warms each route only once, however many times it is hovered', () => {
    const { importers, calls } = makeImporters()
    const { handleIntent } = createRoutePrefetcher(importers)
    const a = anchorFor('<a href="/options-flow">F</a>')
    for (let i = 0; i < 5; i++) handleIntent(intentEventOn(a))
    expect(calls).toEqual(['/options-flow'])
  })

  it('warms nothing when the pointer is not over a link', () => {
    const { importers, calls } = makeImporters()
    const { handleIntent } = createRoutePrefetcher(importers)
    document.body.innerHTML = '<div><span>just text</span></div>'
    handleIntent(intentEventOn(document.body.querySelector('span')))
    expect(calls).toEqual([])
  })

  it('survives an event with no usable target', () => {
    const { importers, calls } = makeImporters()
    const { handleIntent } = createRoutePrefetcher(importers)
    expect(() => handleIntent({ target: null })).not.toThrow()
    expect(() => handleIntent({})).not.toThrow()
    expect(calls).toEqual([])
  })

  it('spends nothing on a metered (save-data) connection', () => {
    const { importers, calls } = makeImporters()
    const { handleIntent } = createRoutePrefetcher(importers, {
      getConnection: () => ({ saveData: true, effectiveType: '4g' }),
    })
    handleIntent(intentEventOn(anchorFor('<a href="/options-flow">F</a>')))
    expect(calls).toEqual([])
  })

  it('spends nothing on a 2g connection', () => {
    const { importers, calls } = makeImporters()
    const { handleIntent } = createRoutePrefetcher(importers, {
      getConnection: () => ({ saveData: false, effectiveType: 'slow-2g' }),
    })
    handleIntent(intentEventOn(anchorFor('<a href="/options-flow">F</a>')))
    expect(calls).toEqual([])
  })

  it('still warms on 4g', () => {
    const { importers, calls } = makeImporters()
    const { handleIntent } = createRoutePrefetcher(importers, {
      getConnection: () => ({ saveData: false, effectiveType: '4g' }),
    })
    handleIntent(intentEventOn(anchorFor('<a href="/options-flow">F</a>')))
    expect(calls).toEqual(['/options-flow'])
  })

  it('lets a FAILED warm be retried instead of poisoning the route forever', async () => {
    let n = 0
    const importers = new Map([['/options-flow', () => { n++; return Promise.reject(new Error('offline')) }]])
    const { prefetch } = createRoutePrefetcher(importers)
    prefetch('/options-flow')
    await Promise.resolve()
    await Promise.resolve()
    prefetch('/options-flow')
    expect(n).toBe(2)
  })

  it('never throws when an importer throws synchronously', () => {
    const importers = new Map([['/options-flow', () => { throw new Error('boom') }]])
    const { prefetch } = createRoutePrefetcher(importers)
    expect(() => prefetch('/options-flow')).not.toThrow()
  })
})

describe('attachRoutePrefetch', () => {
  // A controllable clock, so the dwell gate is tested by its RULE and not by
  // sleeping (a real timer would make this a flaky race).
  function fakeClock() {
    const timers = new Map()
    let next = 1
    return {
      setTimer: (fn) => { timers.set(next, fn); return next++ },
      clearTimer: (id) => { timers.delete(id) },
      tick: () => { const fns = [...timers.values()]; timers.clear(); for (const f of fns) f() },
      pendingCount: () => timers.size,
    }
  }

  function fire(el, type) {
    el.dispatchEvent(new Event(type, { bubbles: true }))
  }

  // The rail that matters: if the listeners stop being attached, the full-page
  // "Loading page" splash comes back on every section switch and this fails.
  it('warms on a real pointerover once the pointer has DWELLED', () => {
    const { importers, calls } = makeImporters()
    const clock = fakeClock()
    const p = createRoutePrefetcher(importers, clock)
    const detach = attachRoutePrefetch(document, p)
    const a = anchorFor('<a href="/options-flow"><span>Options Flow</span></a>')
    fire(a.querySelector('span'), 'pointerover')
    expect(calls).toEqual([])      // nothing yet — dwell not elapsed
    clock.tick()
    detach()
    expect(calls).toEqual(['/options-flow'])
  })

  it('warms NOTHING when the pointer only sweeps across links on its way past', () => {
    const { importers, calls } = makeImporters()
    const clock = fakeClock()
    const p = createRoutePrefetcher(importers, clock)
    const detach = attachRoutePrefetch(document, p)
    document.body.innerHTML =
      '<nav><a href="/dashboard">D</a><a href="/options-flow">F</a><a href="/calendar">C</a></nav>'
    // Enter and leave each link without settling on any of them.
    for (const a of document.querySelectorAll('a')) {
      fire(a, 'pointerover')
      fire(a, 'pointerout')
    }
    clock.tick()
    detach()
    expect(calls).toEqual([])
    expect(clock.pendingCount()).toBe(0)
  })

  it('warms only the link the sweep actually SETTLES on', () => {
    const { importers, calls } = makeImporters()
    const clock = fakeClock()
    const p = createRoutePrefetcher(importers, clock)
    const detach = attachRoutePrefetch(document, p)
    document.body.innerHTML =
      '<nav><a href="/dashboard">D</a><a href="/calendar">C</a><a href="/options-flow">F</a></nav>'
    const [d, c, f] = document.querySelectorAll('a')
    fire(d, 'pointerover'); fire(d, 'pointerout')
    fire(c, 'pointerover'); fire(c, 'pointerout')
    fire(f, 'pointerover')               // settles here
    clock.tick()
    detach()
    expect(calls).toEqual(['/options-flow'])
  })

  it.each(['focusin', 'touchstart'])('warms IMMEDIATELY on %s, with no dwell', (type) => {
    const { importers, calls } = makeImporters()
    const clock = fakeClock()
    const p = createRoutePrefetcher(importers, clock)
    const detach = attachRoutePrefetch(document, p)
    const a = anchorFor('<a href="/options-flow"><span>Options Flow</span></a>')
    fire(a.querySelector('span'), type)
    detach()
    expect(calls).toEqual(['/options-flow'])   // keyboard/touch are already deliberate
  })

  it('stops warming once detached', () => {
    const { importers, calls } = makeImporters()
    const clock = fakeClock()
    const p = createRoutePrefetcher(importers, clock)
    const detach = attachRoutePrefetch(document, p)
    detach()
    const a = anchorFor('<a href="/dashboard">D</a>')
    fire(a, 'pointerover')
    clock.tick()
    expect(calls).toEqual([])
  })

  it('is a no-op given no document (SSR / worker)', () => {
    const { importers } = makeImporters()
    const p = createRoutePrefetcher(importers)
    expect(() => attachRoutePrefetch(null, p)()).not.toThrow()
  })
})
