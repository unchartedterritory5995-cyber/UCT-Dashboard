import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createErrorBeacon, buildReport, scrubMessage, scrubStack, scrubUrl, scrubUrlsInText,
  reducePath, takeBatch, TEMPLATES,
  DEDUPE_MS, MAX_PER_PAGE, FLUSH_MS, BEACON_URL, MAX_INPUT, MAX_BATCH_BYTES, BATCH_MAX,
} from './errorBeacon'
import { SHARED_NOTE_ROUTE } from '../pages/journal-2-0/lib/noteShareLink'
import { TRACK_RECORD_ROUTE } from '../pages/journal-2-0/lib/trackRecordLink'
import { SHARED_SCREEN_ROUTE } from '../pages/screener/screenShareLink'
import { SHARED_FORMULA_ROUTE } from '../pages/formulas/formulaShareLink'

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

const sentReports = (f) => f.calls.flatMap((c) => JSON.parse(c.body).reports)

// What a LEAK check reads (S2-2): every string field of every report sent,
// parsed out of the bodies — never the raw body text. The raw body also holds
// `ts`, a wall-clock number whose digits say nothing about a leak: a raw scan
// for '500' failed on ~5% of instants. REPORT_KEYS pins a report's shape, so a
// field added later cannot sit outside the scan — `ts` is the one field left
// out, by name, and it must be a number.
const REPORT_KEYS = ['componentStack', 'kind', 'message', 'name', 'page', 'stack', 'template', 'ts']
function sentStrings(f) {
  const out = []
  for (const c of f.calls) {
    const body = JSON.parse(c.body)
    expect(Object.keys(body)).toEqual(['reports'])
    for (const r of body.reports) {
      expect(Object.keys(r).sort()).toEqual(REPORT_KEYS)
      for (const [k, v] of Object.entries(r)) {
        if (k === 'ts') { expect(typeof v).toBe('number'); continue }
        expect(typeof v).toBe('string')
        out.push(v)
      }
    }
  }
  return out.join('\n')
}
const utf8 = (s) => new TextEncoder().encode(s).length

function beaconWith(opts = {}) {
  const fetchImpl = opts.fetchImpl || fakeFetch()
  let t = 1_000_000
  const clock = { now: () => t, advance: (ms) => { t += ms } }
  const b = createErrorBeacon({ fetchImpl, now: clock.now, win: opts.win, sendBeaconImpl: opts.sendBeaconImpl })
  return { b, fetchImpl, clock }
}

// A report as it would be sent for one error thrown on one page.
function sendOne(err, { pathname = '/journal/notebook', ...extra } = {}) {
  const { b, fetchImpl } = beaconWith({ win: { location: { pathname } } })
  b.report(err, extra)
  b.flush()
  return { text: sentStrings(fetchImpl), report: sentReports(fetchImpl)[0] }
}

// S2-2: every test runs on a clock whose digits hold the planted numbers
// ('128', '500', '132'), so a leak check that reads the report's `ts` fails on
// EVERY run — never on the ~5% of wall-clock instants that happen to contain one.
const HOSTILE_TS = 1_791_285_001_320
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(HOSTILE_TS) })
afterEach(() => { vi.useRealTimers() })

describe('scrub — a token in a URL fragment never leaves the browser', () => {
  it('drops the fragment from the page, the message and every stack frame', () => {
    const err = new Error(`Failed to load https://uctintelligence.com/smoke-login#token=${TOKEN}`)
    err.stack = [
      `Error: Failed to load https://uctintelligence.com/smoke-login#token=${TOKEN}`,
      `    at go (https://uctintelligence.com/assets/app.js?t=${TOKEN}:9:3)`,
      `    at https://uctintelligence.com/smoke-login#token=${TOKEN}:1:1`,
    ].join('\n')
    const { text, report } = sendOne(err, { pathname: '/smoke-login' })
    expect(text).not.toContain(TOKEN)
    expect(report.page).toBe('/smoke-login')                        // a route word survives
    expect(report.stack).toContain('assets/app.js:#:#')              // the frame survives, the query does not
    expect(report.stack.split('\n')).toContain('    at https://uctintelligence.com/smoke-login')
  })

  it('scrubUrl keeps origin + reduced path and a script frame location, nothing else', () => {
    expect(scrubUrl('https://x.test/a/b?q=1#frag')).toBe('https://x.test/a/b')
    expect(scrubUrl(`https://x.test/app.js?v=${TOKEN}:12:34`)).toBe('https://x.test/app.js:12:34')
    // A trailing :n:n after a NON-script path is not a line number: it goes.
    expect(scrubUrl(`https://x.test/login#token=${TOKEN}:12:34`)).toBe('https://x.test/login')
    expect(scrubUrl('data:text/plain;base64,SGVsbG8=')).toBe('data:[removed]')
    expect(scrubUrl('https://x.test/assets/NoteEditorPage-abc.js:1:2')).toBe('https://x.test/assets/NoteEditorPage-abc.js:1:2')
    expect(scrubUrl(`https://user:${TOKEN}@x.test/a`)).toBe('https://x.test/a')
  })

  it('a URL finder that is linear: a 200k-character run costs almost nothing', () => {
    const t0 = performance.now()
    scrubUrlsInText('a'.repeat(200_000))
    scrubUrlsInText('ab:'.repeat(60_000))
    scrubUrlsInText('https://'.repeat(20_000))
    expect(performance.now() - t0).toBeLessThan(100)
  })
})

describe('S2-2 — a leak check reads the report strings, never the raw body', () => {
  it('the pinned clock WOULD trip a raw-body scan, and the string scan leaves `ts` out by name', () => {
    const { b, fetchImpl } = beaconWith()
    const e = new Error('x is not a function'); e.stack = '    at f (https://x.test/a.js:1:1)'
    b.report(e)
    b.flush()
    const [r] = sentReports(fetchImpl)
    expect(r.ts).toBe(HOSTILE_TS)
    const raw = fetchImpl.calls.map((c) => c.body).join('\n')
    for (const planted of ['128', '500', '132']) {
      expect(raw).toContain(planted)                   // the old assertion shape fails on this clock
      expect(sentStrings(fetchImpl)).not.toContain(planted)
    }
  })
})

describe('B-1 — paths are reduced segment by segment; a share token never leaves', () => {
  const ROUTES = [
    // [route constant, a realistic token for it]
    [SHARED_NOTE_ROUTE, 'k9Qz_Xr2-Lm4pT8vWn1Ys6uEa3Bc0Dh5'],   // token_urlsafe(24)
    [TRACK_RECORD_ROUTE, 'Tq7pLm2Xz9Rw4Yb1Kc8Nd3'],            // token_urlsafe(16)
    [SHARED_SCREEN_ROUTE, 'qwertasdfgz'],                      // token_urlsafe(8) that happens to be all lowercase
    [SHARED_FORMULA_ROUTE, 'sh_0123456789abcdef0123456789abcdef'],
  ]

  it('the four routes are read from their constants, not typed (non-vacuity)', () => {
    expect(ROUTES.map(([r]) => r)).toEqual(['/share/n/:token', '/track/:token', '/screener/shared/:token', '/formulas/shared/:token'])
  })

  it.each(ROUTES)('%s — the token is not in the page, the message, the stack or any byte sent', (route, token) => {
    const pathname = route.replace(':token', token)
    const err = new TypeError('x is not a function')
    err.stack = `TypeError: x is not a function\n    at f (https://uctintelligence.com${pathname}:1:2)`
    const { text, report } = sendOne(err, { pathname })
    expect(text).not.toContain(token)
    expect(report.page).toBe(route.replace(':token', ':id'))
    expect(report.stack).toContain(`${route.replace(':token', ':id')}`)
  })

  it('a token shaped exactly like a route word is still redacted in a token route (the forced position)', () => {
    expect(reducePath('/screener/shared/qwertasdfgz')).toBe('/screener/shared/:id')
    expect(reducePath('/track/abcdefghij')).toBe('/track/:id')
    expect(reducePath('/share/n/abcdefgh/extra')).toBe('/share/n/:id/extra')
  })

  it('every segment that is not a lowercase route word becomes :id', () => {
    expect(reducePath('/journal/notebook')).toBe('/journal/notebook')
    expect(reducePath('/smoke-login')).toBe('/smoke-login')
    expect(reducePath('/journal-2-0/report')).toBe('/:id/report')
    expect(reducePath('/notes/12345/edit')).toBe('/notes/:id/edit')
    expect(reducePath('/NVDA')).toBe('/:id')
    expect(reducePath('/a/Buy_NVDA/b')).toBe('/a/:id/b')
  })
})

describe('B-2 — a message survives only as a known engine template', () => {
  const LEAKS = ['NVDA', 'BRK', 'MSFT', 'TSLA', '132', '128', '47.83', '500', 'SECRET', 'secret', 'thesis',
    'Short', 'full size', 'max position', 'pullback', 'earnings', 'swing']

  it.each([
    'Short at the open with full size, max position 500',            // every word is engine vocabulary
    'Could not save note Short at the open with full size',
    'Buy 500 NVDA at 132.50, stop 128.75',
    'Failed to save: NVDA.US swing, BRK.B add, $47.83 entry',
    'MSFT/NVDA rotation into the close',
    'see smoke-login#t=SECRETvalue123 ok',
    'see api/x?q=my+secret+thesis ok',
    NOTE_SENTENCE,
  ])('free text never leaves: %s', (msg) => {
    const err = new Error(msg)
    err.stack = `Error: ${msg}\n    at save (https://uctintelligence.com/assets/editor.js:1:2)`
    const { text, report } = sendOne(err)
    for (const word of LEAKS) expect(text).not.toContain(word)
    expect(report.message).toMatch(/^Error: <unrecognized #[a-p]{8}>$/)
    expect(report.template).toMatch(/^#[a-p]{8}$/)
  })

  it('a sentence built from the templates OWN literal words is still not a template', () => {
    // Tracks the template list: a vocabulary edit changes the words planted here.
    const words = [...new Set(TEMPLATES.flatMap((t) => t.words))]
    expect(words.length).toBeGreaterThan(40)                        // non-vacuity
    for (let seed = 0; seed < 25; seed += 1) {
      const pick = (i) => words[(seed * 7919 + i * 104729) % words.length]
      const sentence = Array.from({ length: 9 }, (_, i) => pick(i)).join(' ') + ' 500 NVDA'
      const r = scrubMessage(sentence, 'Error')
      expect(r.message).toMatch(/^Error: <unrecognized #[a-p]{8}>$/)
    }
  })

  // R1-4: an identifier or chunk slot that is not code REFUSES the template,
  // and the message goes as the hash — it never passes unchanged, and the
  // template's own words do not travel around a blanked slot either.
  it.each([
    'NVDA.US is not defined',
    'BRK.B is not a function',
    'NVDA:132:140 is not defined',
    "Cannot read properties of undefined (reading '132.50')",
    "Cannot read properties of undefined (reading 'NVDA')",
    '$NVDA is not defined',                                      // a cashtag
    '$nvda is not defined',                                      // a cashtag, whatever its case
    'NVDA1 is not defined',                                      // a ticker with trailing digits
    'a[NVDA] is not a function',                                 // brackets
    'a[0].b is not a function',
    'a$b is not defined',                                        // `$` other than leading
    '$47 is not defined',                                        // no letter
    '_1 is not defined',
    'short-at-the-open is not defined',                          // hyphenated words
    'Loading chunk short-at-the-open-with-full-size failed.',    // a chunk "id" of readable words
    'Loading CSS chunk Buy-the-dip-before-earnings failed.',
    'Loading chunk facade failed.',                              // hex letters only, still a word
    'Loading chunk 9f3a failed.',                                // hex-like: not what a bundler sends
  ])('a slot that is not code refuses the template: %s', (input) => {
    const r = scrubMessage(input, 'TypeError')
    expect(r.message).toMatch(/^TypeError: <unrecognized #[a-p]{8}>$/)
    expect(r.template).toMatch(/^#[a-p]{8}$/)
  })

  // Residual (1) in the header, EXACTLY: what an identifier slot can still carry.
  it.each([
    ['Tesla is not defined', 'Tesla is not defined'],
    ["Cannot read properties of undefined (reading 'earnings')", "Cannot read properties of undefined (reading 'earnings')"],
    ['Short_at_the_open is not defined', 'Short_at_the_open is not defined'],
    ['Short.at.the.open is not defined', 'Short.at.the.open is not defined'],
    ['JSON.parse is not a function', 'JSON.parse is not a function'],   // a code acronym is not a ticker
    ['$emitter is not defined', '$emitter is not defined'],             // `$`-led, but not 1-5 letters: not a cashtag
    ['(intermediate value).then is not a function', '(intermediate value).then is not a function'],
    ['x1 is not a function', 'x# is not a function'],                   // a kept part's digits are #
  ])('residual (1) — a single code-shaped word still passes whole: %s', (input, expected) => {
    expect(scrubMessage(input, 'TypeError').message).toBe(expected)
  })

  it('every digit anywhere in the message or the stack is #', () => {
    const err = new RangeError('Position 132 out of range')
    err.stack = 'RangeError: Position 132 out of range\n    at resolve (https://x.test/assets/pm-9f3a.js:1234:56)'
    const { text, report } = sendOne(err)
    expect(report.message).toBe('Position # out of range')
    expect(report.stack).toBe('    at resolve (https://x.test/assets/pm-#f#a.js:#:#)')
    const { ts, ...rest } = report
    expect(typeof ts).toBe('number')
    expect(JSON.stringify(rest)).not.toMatch(/\d/)
    expect(text).not.toContain('132')
  })

  it('a matched template is digit-masked too — an identifier, a host port, an asset hash', () => {
    expect(scrubMessage('x1 is not a function', 'TypeError').message).toBe('x# is not a function')
    expect(scrubMessage('Failed to fetch dynamically imported module: https://x.test:8443/assets/Note-9f3a.js', 'TypeError').message)
      .toBe('Failed to fetch dynamically imported module: https://x.test:#/assets/Note-#f#a.js')
  })

  it('a message line shaped like a frame is not a frame', () => {
    const msg = 'Watchlist\n    at NVDA (https://x.test/a.js:1:2)'
    const err = new Error(msg)
    err.stack = `Error: ${msg}\n    at real (https://x.test/app.js:3:4)`
    const { text, report } = sendOne(err)
    expect(text).not.toContain('NVDA')
    expect(report.stack).toBe('    at real (https://x.test/app.js:#:#)')
  })

  it('…even when the stack header names something else: a line the message holds is never a frame', () => {
    const msg = 'plan\n    at TSLA (https://x.test/a.js:1:2)'
    const err = new Error(msg)
    err.name = 'TypeError'
    err.stack = `CustomThing: ${msg}\n    at real (https://x.test/app.js:3:4)`   // neither header form
    const { text, report } = sendOne(err)
    expect(text).not.toContain('TSLA')
    expect(report.stack).toBe('    at real (https://x.test/app.js:#:#)')
  })

  it('the header is cut BEFORE the cap, so a long message cannot push the real frames out', () => {
    const msg = 'x'.repeat(9000)
    const err = new Error(msg)
    err.stack = `Error: ${msg}\n    at real (https://x.test/app.js:3:4)`
    expect(buildReport(err).stack).toBe('    at real (https://x.test/app.js:#:#)')
  })

  it('a custom error name that carries text is replaced; an engine-shaped name is kept', () => {
    const e1 = new Error('x is not a function'); e1.name = 'Buy NVDA now'
    expect(buildReport(e1).name).toBe('Error')
    const e2 = new Error('x is not a function'); e2.name = 'NVDA'
    expect(buildReport(e2).name).toBe('Error')
    const e3 = new Error('Failed to fetch'); e3.name = 'ChunkLoadError'
    expect(buildReport(e3).name).toBe('ChunkLoadError')
  })

  it('an unrecognized message groups: same text → same id, different text → different id', () => {
    const a = scrubMessage('Could not save note Alpha', 'Error')
    const b = scrubMessage('Could not save note Alpha', 'Error')
    const c = scrubMessage('Could not save note Beta', 'Error')
    expect(a.template).toBe(b.template)
    expect(a.template).not.toBe(c.template)
    // Digits are masked before hashing, so a counter in the text does not split a group.
    expect(scrubMessage('Retry 1 of save', 'Error').template).toBe(scrubMessage('Retry 2 of save', 'Error').template)
  })
})

describe('the templates keep what an engine says', () => {
  it.each([
    ["Cannot read properties of undefined (reading 'foo')", "Cannot read properties of undefined (reading 'foo')"],
    ["Can't find variable: Iterator", "Can't find variable: Iterator"],
    ['Iterator is not defined', 'Iterator is not defined'],
    ['foo.bar is not a function', 'foo.bar is not a function'],
    ['(intermediate value).then is not a function', '(intermediate value).then is not a function'],
    ["undefined is not an object (evaluating 'a.b.c')", "undefined is not an object (evaluating 'a.b.c')"],
    ['Promise.withResolvers is not a function', 'Promise.withResolvers is not a function'],
    ['Minified React error #185; visit https://react.dev/errors/185?args[]=x for the full message or use the non-minified dev environment for full errors and additional helpful warnings.',
      'Minified React error ##; visit https://react.dev/errors/:id for the full message or use the non-minified dev environment for full errors and additional helpful warnings.'],
    ['Failed to fetch dynamically imported module: https://x.test/assets/NoteEditorPage-abc.js',
      'Failed to fetch dynamically imported module: https://x.test/assets/NoteEditorPage-abc.js'],
    ['Loading chunk 123 failed.', 'Loading chunk # failed.'],
    ['Failed to fetch', 'Failed to fetch'],
    ['Load failed', 'Load failed'],
    ['Importing a module script failed.', 'Importing a module script failed.'],
    ['ResizeObserver loop completed with undelivered notifications.', 'ResizeObserver loop completed with undelivered notifications.'],
    ['Maximum call stack size exceeded', 'Maximum call stack size exceeded'],
    ['Unexpected token \'B\', "Buy NVDA at 132" is not valid JSON', "Unexpected token '…', … is not valid JSON"],
    ['Invalid content for node paragraph: <"Buy NVDA">', 'Invalid content for node paragraph: …'],
  ])('%s', (input, expected) => {
    expect(scrubMessage(input, 'TypeError').message).toBe(expected)
  })

  it('an ErrorEvent message ("Uncaught TypeError: …") is matched without its prefix and keeps its name', () => {
    const r = scrubMessage('Uncaught TypeError: x is not a function', 'Error')
    expect(r.message).toBe('x is not a function')
    expect(r.name).toBe('TypeError')
    expect(r.template).toBe('not-a-function')
  })

  it('template ids are words, never digits, and every one is unique', () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z]+(?:-[a-z]+)*$/)
  })
})

describe('scrubStack keeps frames and drops everything else', () => {
  it('handles V8, Safari/Firefox and React component frames', () => {
    const v8 = 'TypeError: secret words here\nat the open buy NVDA\n    at a (https://x.test/a.js:1:2)\n    at <anonymous>'
    expect(scrubStack(v8)).toBe('    at a (https://x.test/a.js:#:#)\n    at <anonymous>')
    expect(scrubStack('\n    at NoteCard (https://x.test/a.js:1:2)\n    at div\nat the open buy NVDA', 4000, { react: true }))
      .toBe('    at NoteCard (https://x.test/a.js:#:#)\n    at div')
    const safari = 'render@https://x.test/index.js:12:34\nglobal code@https://x.test/i.js:1:1\nsome prose line'
    expect(scrubStack(safari)).toBe('render@https://x.test/index.js:#:#\nglobal code@https://x.test/i.js:#:#')
  })

  it('a Node / test-runner frame keeps its shape and its filesystem path is reduced like any path', () => {
    expect(scrubStack('    at f (C:/Users/Patrick/app/src/a.js:1:2)')).toBe('    at f (:id/:id/:id/app/src/a.js:#:#)')
    expect(scrubStack('    at f (C:\\Users\\Patrick\\app\\a.js:1:2)')).toBe('    at f (:id/:id/:id/app/a.js:#:#)')
    expect(scrubStack('    at /srv/share/n/Tok9x:1:2')).toBe('    at /srv/share/n/:id')
  })

  it.each([
    '    at 10:30:45 bought NVDA:1:2',
    'NVDA:132:140',
    '10:30:45',
    '    at NVDA:132:140',
    'Buy NVDA@example',
  ])('a line that only looks like a frame is dropped: %s', (line) => {
    expect(scrubStack(`${line}\n    at real (https://x.test/app.js:3:4)`)).toBe('    at real (https://x.test/app.js:#:#)')
  })
})

describe('B-3 — the scrub is bounded: capped before any pattern runs', () => {
  it('a 50k-character run in every field builds a report in under 100 ms', () => {
    const shapes = [
      'a'.repeat(50_000),
      "Unexpected token '" + 'a'.repeat(50_000),
      'Cannot read properties of undefined (reading \'' + "a'".repeat(25_000),
      'a:'.repeat(25_000),
      '    at ' + 'a'.repeat(50_000),
      'https://'.repeat(6_000),
      'x '.repeat(25_000) + 'is not valid JSON',
    ]
    for (const s of shapes) {
      const err = new Error(s)
      err.stack = s
      const t0 = performance.now()
      buildReport(err, { componentStack: s, loc: { pathname: '/' + 'a/'.repeat(25_000) } })
      expect(performance.now() - t0).toBeLessThan(100)
    }
  })

  it('the matcher never sees past MAX_INPUT: a template tail beyond the cap is not recognised', () => {
    // An {any} slot: it takes input of any length (an identifier slot now
    // refuses a 980-character "identifier" on its own, which would say nothing
    // about the cap).
    expect(scrubMessage('a'.repeat(MAX_INPUT - 20) + ' is not valid JSON', 'SyntaxError').template).toBe('json-not-valid')
    expect(scrubMessage('a'.repeat(MAX_INPUT) + ' is not valid JSON', 'SyntaxError').template).toMatch(/^#[a-p]{8}$/)
  })

  it('an identical error thrown in a loop is built once, not once per throw', () => {
    const { b } = beaconWith()
    for (let i = 0; i < 5; i += 1) {
      const e = new Error('x is not a function'); e.stack = '    at f (https://x.test/a.js:1:1)'
      b.report(e)
    }
    expect(b.state.builds).toBe(1)
  })
})

describe('N-5 — every POST stays under the 64 KiB transport limit', () => {
  function bigError(i) {
    const fn = `render${String.fromCharCode(97 + i)}` + 'Q'.repeat(240)
    const e = new Error('a'.repeat(480) + ' is not defined')
    e.stack = Array.from({ length: 16 }, (_, k) => `    at ${fn}${k} (https://x.test/assets/app.js:1:2)`).join('\n')
    return e
  }

  it('ten near-cap reports are split so that no body passes MAX_BATCH_BYTES', () => {
    const { b, fetchImpl } = beaconWith({ win: { location: { pathname: '/' + 'journal/'.repeat(35) } } })
    const comp = Array.from({ length: 10 }, (_, k) => `    at Component${k}${'Z'.repeat(180)} (https://x.test/a.js:1:2)`).join('\n')
    for (let i = 0; i < BATCH_MAX; i += 1) b.report(bigError(i), { kind: 'boundary', componentStack: comp })
    b.flush()
    const reports = sentReports(fetchImpl)
    expect(reports).toHaveLength(BATCH_MAX)
    const total = fetchImpl.calls.reduce((n, c) => n + utf8(c.body), 0)
    expect(total).toBeGreaterThan(MAX_BATCH_BYTES)               // non-vacuity: one body would not fit
    expect(fetchImpl.calls.length).toBeGreaterThan(1)
    for (const c of fetchImpl.calls) expect(utf8(c.body)).toBeLessThanOrEqual(MAX_BATCH_BYTES)
  })

  it('takeBatch counts BYTES, so multi-byte text is not mistaken for short', () => {
    const r = { kind: 'error', message: 'é'.repeat(4000) }        // 4000 chars, 8000 bytes
    const queue = Array.from({ length: 10 }, () => ({ ...r }))
    const batch = takeBatch(queue)
    expect(utf8(JSON.stringify({ reports: batch }))).toBeLessThanOrEqual(MAX_BATCH_BYTES)
    expect(batch.length).toBeLessThan(10)
    expect(queue.length).toBe(10 - batch.length)
  })

  it('pagehide sendBeacon batches are byte-bounded too', () => {
    const RealBlob = globalThis.Blob
    vi.stubGlobal('Blob', class extends RealBlob {
      constructor(parts, opts) { super(parts, opts); this.parts = parts }
    })
    try {
      const sendBeaconImpl = vi.fn(() => true)
      const { b } = beaconWith({ sendBeaconImpl })
      const comp = Array.from({ length: 10 }, (_, k) => `    at Component${k}${'Z'.repeat(180)} (https://x.test/a.js:1:2)`).join('\n')
      const loc = { pathname: '/' + 'journal/'.repeat(35) }
      // Queued directly: the tenth report() would have flushed by fetch first.
      for (let i = 0; i < BATCH_MAX; i += 1) b.state.queue.push(buildReport(bigError(i), { kind: 'boundary', componentStack: comp, loc }))
      b.flushWithBeacon()
      expect(sendBeaconImpl.mock.calls.length).toBeGreaterThan(1)
      for (const [, blob] of sendBeaconImpl.mock.calls) expect(utf8(blob.parts[0])).toBeLessThanOrEqual(MAX_BATCH_BYTES)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('a note sentence never leaves the browser', () => {
  const distinctive = ['NVDA', 'pullback', 'rising', '20-day', 'earnings', NOTE_SENTENCE]

  it('a sentence the engine quoted back (ProseMirror / JSON.parse shape)', () => {
    const { b, fetchImpl } = beaconWith()
    b.report(new SyntaxError(`Unexpected token 'B', "${NOTE_SENTENCE}" is not valid JSON`))
    b.report(new RangeError(`Invalid content for node paragraph: <"${NOTE_SENTENCE}">`))
    b.flush()
    const text = sentStrings(fetchImpl)
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
    const text = sentStrings(fetchImpl)
    for (const word of distinctive) expect(text).not.toContain(word)
    expect(text).toContain('NoteCard')
  })

  it('page DOM text is never read: a sentence on screen does not appear in the report', () => {
    document.body.innerHTML = `<div class="ProseMirror" contenteditable="true"><p>${NOTE_SENTENCE}</p></div>`
    const { b, fetchImpl } = beaconWith()
    b.report(new TypeError('Cannot read properties of undefined'))
    b.flush()
    expect(sentStrings(fetchImpl)).not.toContain('pullback')
    document.body.innerHTML = ''
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
      const e = new Error('boom'); e.stack = `    at f${String.fromCharCode(97 + (i % 26))}${i > 25 ? 'x' : ''} (https://x.test/a.js:1:1)`
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
    expect(r.stack).toBe('    at https://x.test/assets/a.js:#:#')
    expect(r.name).toBe('TypeError')
    expect(r.message).toBe('x is not a function')
    expect(sentStrings(fetchImpl)).not.toContain(TOKEN)
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
