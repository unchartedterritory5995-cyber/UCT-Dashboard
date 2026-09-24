import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createErrorBeacon, buildReport, messageSkeleton, scrubStack, scrubUrl,
  DEDUPE_MS, MAX_PER_PAGE, FLUSH_MS, BEACON_URL,
} from './errorBeacon'

// The two planted secrets. Neither may appear in ANY byte the beacon sends.
const TOKEN = 'tok_7f3a9c1e5b2d4f60'
const NOTE_SENTENCE = 'Buy NVDA on the pullback to the rising 20-day line before earnings'

function fakeFetch(response = { ok: true, enabled: true }) {
  const calls = []
  const f = vi.fn((url, init) => {
    calls.push({ url, init, body: init?.body })
    return Promise.resolve({ json: () => Promise.resolve(response) })
  })
  f.calls = calls
  return f
}

const sentText = (f) => f.calls.map((c) => c.body).join('\n')
const sentReports = (f) => f.calls.flatMap((c) => JSON.parse(c.body).reports)

function beaconWith(opts = {}) {
  const fetchImpl = opts.fetchImpl || fakeFetch()
  let t = 1_000_000
  const clock = { now: () => t, advance: (ms) => { t += ms } }
  const b = createErrorBeacon({ fetchImpl, now: clock.now, win: opts.win, sendBeaconImpl: opts.sendBeaconImpl })
  return { b, fetchImpl, clock }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('scrub — a token in a URL fragment never leaves the browser', () => {
  it('drops the fragment from the page, the message and every stack frame', () => {
    window.history.pushState({}, '', `/smoke-login?next=/journal#token=${TOKEN}`)
    const { b, fetchImpl } = beaconWith()
    const err = new Error(`Failed to load https://uctintelligence.com/smoke-login#token=${TOKEN}`)
    err.stack = [
      `Error: Failed to load https://uctintelligence.com/smoke-login#token=${TOKEN}`,
      `    at go (https://uctintelligence.com/assets/app.js?t=${TOKEN}:9:3)`,
      `    at https://uctintelligence.com/smoke-login#token=${TOKEN}:1:1`,
    ].join('\n')
    b.report(err)
    b.flush()
    const text = sentText(fetchImpl)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(text).not.toContain(TOKEN)
    const [r] = sentReports(fetchImpl)
    expect(r.page).toBe('/smoke-login')                          // pathname only
    expect(r.stack).toContain('assets/app.js:9:3')               // the frame survives, the query does not
    window.history.pushState({}, '', '/')
  })

  it('removes a bare fragment and credential-shaped values from the message', () => {
    const { b, fetchImpl } = beaconWith()
    b.report(new Error(`hash was #access_token=${TOKEN} and key=${TOKEN}`))
    b.flush()
    expect(sentText(fetchImpl)).not.toContain(TOKEN)
  })

  it('scrubUrl keeps origin + path and a script frame location, nothing else', () => {
    expect(scrubUrl(`https://x.test/a/b?q=1#frag`)).toBe('https://x.test/a/b')
    expect(scrubUrl(`https://x.test/app.js?v=${TOKEN}:12:34`)).toBe('https://x.test/app.js:12:34')
    // A trailing :n:n after a NON-script path is not a line number: it goes.
    expect(scrubUrl(`https://x.test/login#token=${TOKEN}:12:34`)).toBe('https://x.test/login')
    expect(scrubUrl('data:text/plain;base64,SGVsbG8=')).toBe('data:[removed]')
  })
})

describe('scrub — a note sentence in an error message never leaves the browser', () => {
  const distinctive = ['NVDA', 'pullback', 'rising', '20-day', 'earnings', NOTE_SENTENCE]

  it('an unquoted sentence thrown as the message (the careless `throw new Error(title)`)', () => {
    const { b, fetchImpl } = beaconWith()
    const err = new Error(NOTE_SENTENCE)
    err.stack = `Error: ${NOTE_SENTENCE}\n    at save (https://uctintelligence.com/assets/editor.js:1:2)`
    b.report(err)
    b.flush()
    const text = sentText(fetchImpl)
    for (const word of distinctive) expect(text).not.toContain(word)
    // The V8 header line repeats the message; frames-only drops it entirely.
    expect(sentReports(fetchImpl)[0].stack).toBe('    at save (https://uctintelligence.com/assets/editor.js:1:2)')
  })

  it('a sentence the engine quoted back (ProseMirror / JSON.parse shape)', () => {
    const { b, fetchImpl } = beaconWith()
    b.report(new SyntaxError(`Unexpected token 'B', "${NOTE_SENTENCE}" is not valid JSON`))
    b.report(new RangeError(`Invalid content for node paragraph: <"${NOTE_SENTENCE}">`))
    b.flush()
    const text = sentText(fetchImpl)
    for (const word of distinctive) expect(text).not.toContain(word)
  })

  it('a sentence as an unhandled rejection reason, and in a component stack', () => {
    const { b, fetchImpl } = beaconWith()
    b.report(NOTE_SENTENCE, { kind: 'unhandledrejection' })
    b.report(new Error('boom'), {
      kind: 'boundary',
      componentStack: `\n    at NoteCard (https://x.test/a.js:1:2)\n${NOTE_SENTENCE}\n    at div`,
    })
    b.flush()
    const text = sentText(fetchImpl)
    for (const word of distinctive) expect(text).not.toContain(word)
    expect(text).toContain('NoteCard')
  })

  it('page DOM text is never read: a sentence on screen does not appear in the report', () => {
    document.body.innerHTML = `<div class="ProseMirror" contenteditable="true"><p>${NOTE_SENTENCE}</p></div>`
    const { b, fetchImpl } = beaconWith()
    b.report(new TypeError('Cannot read properties of undefined'))
    b.flush()
    expect(sentText(fetchImpl)).not.toContain('pullback')
    document.body.innerHTML = ''
  })
})

describe('the message skeleton keeps what an engine says', () => {
  it.each([
    ["Cannot read properties of undefined (reading 'foo')", 'Cannot read properties of undefined (reading "…")'],
    ["Can't find variable: Iterator", "Can't find variable: Iterator"],
    ['Iterator is not defined', 'Iterator is not defined'],
    ['foo.bar is not a function', 'foo.bar is not a function'],
    ["undefined is not an object (evaluating 'a.b.c')", "undefined is not an object (evaluating 'a.b.c')"],
    ['Minified React error #185; visit https://react.dev/errors/185?args[]=x for the full message',
      'Minified React error #185; visit https://react.dev/errors/185 for the full message'],
    ['Failed to fetch dynamically imported module: https://x.test/assets/NoteEditorPage-abc.js',
      'Failed to fetch dynamically imported module: https://x.test/assets/NoteEditorPage-abc.js'],
  ])('%s', (input, expected) => {
    expect(messageSkeleton(input)).toBe(expected)
  })

  it('collapses a run of hidden words into one marker', () => {
    expect(messageSkeleton('Sold AMD into strength, then bought back lower')).toBe('… into …, then …')
  })
})

describe('scrubStack keeps frames and drops everything else', () => {
  it('handles V8, Safari/Firefox and React component frames', () => {
    // A multi-line message whose second line happens to begin with "at " is
    // still the MESSAGE, not a frame: it has no frame's shape.
    const v8 = 'TypeError: secret words here\nat the open buy NVDA\n    at a (https://x.test/a.js:1:2)\n    at <anonymous>'
    expect(scrubStack(v8)).toBe('    at a (https://x.test/a.js:1:2)\n    at <anonymous>')
    expect(scrubStack('\n    at NoteCard (https://x.test/a.js:1:2)\n    at div\nat the open buy NVDA', 4000, { react: true }))
      .toBe('    at NoteCard (https://x.test/a.js:1:2)\n    at div')
    const safari = 'render@https://x.test/index.js:12:34\nglobal code@https://x.test/i.js:1:1\nsome prose line'
    expect(scrubStack(safari)).toBe('render@https://x.test/index.js:12:34\nglobal code@https://x.test/i.js:1:1')
  })
})

describe('dedupe and the per-page cap', () => {
  it('an identical stack is sent once per 60 s, then again', () => {
    const { b, fetchImpl, clock } = beaconWith()
    const make = () => { const e = new Error('x is not a function'); e.stack = '    at f (https://x.test/a.js:1:1)'; return e }
    expect(b.report(make())).not.toBeNull()
    clock.advance(DEDUPE_MS - 1)
    expect(b.report(make())).toBeNull()
    clock.advance(2)
    expect(b.report(make())).not.toBeNull()
    b.flush()
    expect(sentReports(fetchImpl)).toHaveLength(2)
  })

  it('a different stack is not a duplicate', () => {
    const { b } = beaconWith()
    const e1 = new Error('a'); e1.stack = '    at f (https://x.test/a.js:1:1)'
    const e2 = new Error('a'); e2.stack = '    at g (https://x.test/a.js:2:1)'
    expect(b.report(e1)).not.toBeNull()
    expect(b.report(e2)).not.toBeNull()
  })

  it('at most 20 reports per page load', () => {
    const { b, fetchImpl } = beaconWith()
    for (let i = 0; i < MAX_PER_PAGE + 7; i += 1) {
      const e = new Error('boom'); e.stack = `    at f${i} (https://x.test/a.js:${i + 1}:1)`
      b.report(e)
    }
    b.flush()
    expect(sentReports(fetchImpl)).toHaveLength(MAX_PER_PAGE)
    expect(b.state.sent).toBe(MAX_PER_PAGE)
  })
})

describe('delivery', () => {
  it('batches for FLUSH_MS, then posts once to the beacon URL', async () => {
    const { b, fetchImpl } = beaconWith()
    const e1 = new Error('one'); e1.stack = '    at a (https://x.test/a.js:1:1)'
    const e2 = new Error('two'); e2.stack = '    at b (https://x.test/a.js:2:1)'
    b.report(e1); b.report(e2)
    expect(fetchImpl).not.toHaveBeenCalled()
    vi.advanceTimersByTime(FLUSH_MS)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [{ url, init }] = fetchImpl.calls
    expect(url).toBe(BEACON_URL)
    expect(init.keepalive).toBe(true)
    expect(JSON.parse(init.body).reports).toHaveLength(2)
  })

  it('the kill switch answer latches the page off', async () => {
    const fetchImpl = fakeFetch({ ok: true, enabled: false })
    const { b } = beaconWith({ fetchImpl })
    const e = new Error('first'); e.stack = '    at a (https://x.test/a.js:1:1)'
    b.report(e); b.flush()
    await vi.runAllTimersAsync()
    expect(b.state.disabled).toBe(true)
    const e2 = new Error('second'); e2.stack = '    at b (https://x.test/a.js:2:1)'
    expect(b.report(e2)).toBeNull()
    b.flush()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('pagehide sends what is queued with sendBeacon, not fetch', () => {
    // Keep the Blob's parts readable without an async reader (fake timers).
    const RealBlob = globalThis.Blob
    vi.stubGlobal('Blob', class extends RealBlob {
      constructor(parts, opts) { super(parts, opts); this.parts = parts }
    })
    try {
      const sendBeaconImpl = vi.fn(() => true)
      const { b, fetchImpl } = beaconWith({ sendBeaconImpl, win: window })
      const uninstall = b.install()
      const e = new Error('Failed to fetch'); e.stack = '    at a (https://x.test/a.js:1:1)'
      b.report(e)
      window.dispatchEvent(new Event('pagehide'))
      expect(sendBeaconImpl).toHaveBeenCalledTimes(1)
      const [url, blob] = sendBeaconImpl.mock.calls[0]
      expect(url).toBe(BEACON_URL)
      expect(blob.type).toBe('application/json')
      expect(JSON.parse(blob.parts[0]).reports[0].message).toBe('Failed to fetch')
      vi.advanceTimersByTime(FLUSH_MS * 2)
      expect(fetchImpl).not.toHaveBeenCalled()
      uninstall()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('if sendBeacon refuses, the batch still goes by fetch', () => {
    const { b, fetchImpl } = beaconWith({ sendBeaconImpl: () => false, win: window })
    const uninstall = b.install()
    const e = new Error('x'); e.stack = '    at a (https://x.test/a.js:1:1)'
    b.report(e)
    window.dispatchEvent(new Event('pagehide'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    uninstall()
  })

  it('never throws into the caller, whatever the transport does', () => {
    const { b } = beaconWith({ fetchImpl: () => { throw new Error('network down') } })
    const e = new Error('x'); e.stack = '    at a (https://x.test/a.js:1:1)'
    expect(() => { b.report(e); b.flush() }).not.toThrow()
    expect(() => b.report(Symbol('odd'))).not.toThrow()
  })
})

describe('install — the page-level sources', () => {
  it('reports window errors and unhandled rejections, and uninstalls cleanly', () => {
    const { b, fetchImpl } = beaconWith({ win: window })
    const uninstall = b.install()
    const err = new Error('from onerror'); err.stack = '    at h (https://x.test/a.js:3:1)'
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'from onerror' }))
    const rej = new Event('unhandledrejection')
    rej.reason = new Error('rejected promise')
    window.dispatchEvent(rej)
    b.flush()
    const kinds = sentReports(fetchImpl).map((r) => r.kind)
    expect(kinds).toEqual(['error', 'unhandledrejection'])
    uninstall()
    // message-only: an ErrorEvent carrying an Error with no listener left is
    // reported by the test runner itself as an uncaught exception.
    window.dispatchEvent(new ErrorEvent('error', { message: 'after uninstall' }))
    b.flush()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('an ErrorEvent without an Error object still reports its location, scrubbed', () => {
    const { b, fetchImpl } = beaconWith({ win: window })
    const uninstall = b.install()
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'Uncaught TypeError: x is not a function',
      filename: `https://x.test/assets/a.js?t=${TOKEN}`, lineno: 7, colno: 9,
    }))
    b.flush()
    const [r] = sentReports(fetchImpl)
    expect(r.stack).toBe('    at https://x.test/assets/a.js:7:9')
    expect(sentText(fetchImpl)).not.toContain(TOKEN)
    uninstall()
  })
})

describe('buildReport', () => {
  it('caps and names what was thrown', () => {
    const r = buildReport(new TypeError('x'.repeat(5000)), { loc: { pathname: '/journal/notebook' } })
    expect(r.name).toBe('TypeError')
    expect(r.message.length).toBeLessThanOrEqual(500)
    expect(r.page).toBe('/journal/notebook')
  })
})
