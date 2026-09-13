/**
 * ⛔⛔ THE G0 TRACE RAIL — exposure, capacity, and the absence of a sink.
 *
 * ⭐ THIS FILE IS AN EXTENSION OF `exposureGate.test.js`, NOT AN EDIT TO IT. That file carries a
 * standing instruction that it may never be edited without a hard stop (H11), on the grounds that
 * the only way it goes red is if the answer to "who sees this feature" has changed. Adding two more
 * facts to it would have put this branch's diff inside that file for a reason unrelated to who sees
 * the hub — so the facts live here, in that file's shape and idiom, and the four original facts are
 * untouched. Read the two files together.
 *
 * FACTS 5-8, in the same source-assertion style and for the same reason (each pins the LITERAL, so
 * a change cannot be made and the test "fixed" to match without the diff showing this file):
 *   5. The gesture trace is OFF by default.
 *   6. It is ADMIN-ONLY at the one authority — `useHubSettings`, not the Settings card's rendering.
 *   7. The instrumentation is applied ONLY under that flag: with it off, `useJoystick` hands back
 *      the raw handlers, so there is no trace branch inside the pointer path to mis-execute.
 *   8. NOTHING IN THE TRACE PATH TALKS TO A NETWORK. Master spec §8's "no analytics" holds: the
 *      buffer's only exit is the clipboard.
 *
 * Plus the capacity behaviour, which is a plain unit test of the ring itself.
 */
import { describe, it as vitestIt, expect, beforeEach, afterAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  GESTURE_TRACE_CAP,
  clearGestureTrace,
  gestureTracePayload,
  readGestureTrace,
  recordGestureEvent,
} from './gestureTrace.js'
import { FLICK_MS } from './constants.js'

// ⛔ `vitest -t` is a REGEX: a filter matching nothing exits 0 and reads as a PASS. House idiom.
let defined = 0
let executed = 0
function it(name, fn) {
  defined += 1
  return vitestIt(name, (...a) => { executed += 1; return fn(...a) })
}
afterAll(() => {
  expect(executed).toBeGreaterThan(0)
  expect(executed).toBe(defined)
})

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..')
const read = (p) => readFileSync(p, 'utf8')

const FILES = {
  settings: path.join(HERE, 'useHubSettings.js'),
  engine: path.join(HERE, 'useJoystick.js'),
  buffer: path.join(HERE, 'gestureTrace.js'),
  card: path.join(APP, 'pages/settings/JoystickSettingsCard.jsx'),
}

/**
 * ⛔ CODE, NEVER PROSE. Every file below EXPLAINS in its comments that it must not POST, fetch or
 * beacon — so a raw-text scan for those words would match the very sentences promising they are
 * absent and report the feature as present. Six separate instances of that defect were logged in
 * this repo in one day; `contractArity.test.js` shipped one.
 */
const stripComments = (t) => t
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

beforeEach(() => { clearGestureTrace() })

describe('⛔ NON-VACUITY — the files exist and are being read', () => {
  it('every file this rail asserts over is present and non-trivial', () => {
    for (const [label, p] of Object.entries(FILES)) {
      expect(existsSync(p), `${label} (${p}) is missing — every assertion below passes vacuously`)
        .toBe(true)
      expect(read(p).length, `${label} read as near-empty`).toBeGreaterThan(500)
    }
  })

  it('CONTROL: stripComments removes a comment and keeps the code beside it', () => {
    // Needles built by concatenation so this control cannot match its own source text.
    const marker = `fetch` + `(`
    const src = `// a comment mentioning ${marker}\nconst x = 1\n/* ${marker} */\nconst y = ${marker}'u')\n`
    const out = stripComments(src)
    expect(out, 'the comment survived stripping — the sweep below would read prose as code')
      .not.toMatch(/a comment mentioning/)
    expect(out, 'stripComments ate the real call too — the sweep would see nothing anywhere')
      .toContain(marker)
  })
})

describe('⛔ FACT 5 — the gesture trace is OFF by default', () => {
  it('HUB_SETTINGS_DEFAULTS declares traceGestures: false', () => {
    expect(
      stripComments(read(FILES.settings)),
      'the G0 trace default changed. A diagnostic that is on because nobody chose records every '
      + "member's pointer stream and nobody asked for it.",
    ).toContain('traceGestures: false')
  })
})

describe('⛔ FACT 6 — admin-only at the ONE authority, not merely hidden', () => {
  it('useHubSettings resolves traceGestures against isAdmin', () => {
    expect(
      stripComments(read(FILES.settings)),
      'the admin resolution is gone. `POST /api/auth/preferences` validates nothing, so without '
      + 'this a member can switch their own trace on by writing the key directly.',
    ).toContain('isAdmin && explicitTrace === true')
  })

  it('the Settings card renders the trace section only for an admin', () => {
    const src = stripComments(read(FILES.card))
    expect(src, 'the trace section lost its admin gate').toContain('{isAdmin && (')
    expect(src, 'the trace section is not inside the admin-gated block any more')
      .toMatch(/\{isAdmin && \([\s\S]*data-testid="joystick-trace-toggle"/)
  })
})

describe('⛔ FACT 7 — with the toggle off, the pointer path is the uninstrumented one', () => {
  const engine = () => stripComments(read(FILES.engine))

  it('the flag is read once, from settings, exactly like every other engine setting', () => {
    expect(engine(), 'useJoystick no longer reads the trace flag off settings')
      .toContain('const traceOn = settings.traceGestures === true')
  })

  it('the wrapper is applied ONLY under the flag — otherwise the raw handlers are returned', () => {
    expect(
      engine(),
      'the instrumented handler set is no longer conditional. Wrapping unconditionally puts a trace '
      + 'branch inside every pointer event of every member, which is the one thing this design '
      + 'exists to avoid.',
    ).toMatch(/handlers: traceOn\s*\?\s*withTrace\(\)\s*:\s*\{ onPointerDown, onPointerMove, onPointerUp, onPointerCancel \}/)
  })

  /**
   * ⛔⛔ THE "NO SECOND AUTHORITY" ASSERTION, STRUCTURALLY.
   *
   * Every decision word belongs to the branch that took it. The trace wrapper serialises what the
   * handler returned and owns no vocabulary of its own — so it CANNOT author a verdict, whatever it
   * is later handed. A trace that re-derived one would agree with the engine right up until the
   * moment they disagreed, which is the only moment anyone would read it.
   */
  it('⛔⛔ the trace wrapper contains NO decision vocabulary — every word comes from the FSM', () => {
    const src = engine()
    const MARKER = 'const traceStamps'
    const at = src.indexOf(MARKER)
    expect(at, `${MARKER} not found — this split is measuring nothing`).toBeGreaterThan(-1)
    const fsm = src.slice(0, at)
    const wrapper = src.slice(at)

    const VOCAB = ['flick-fire', 'flick-open', 'flick-none-', 'press-', 'scrub-commit', 'tap-pending', 'double-tap', 'cancel']
    // ⚠️ THE NEEDLE IS "A QUOTE FOLLOWED BY THE WORD", not the bare word. A bare `cancel` matches
    // the DOM event type `'pointercancel'`, which the wrapper legitimately passes as a row's
    // `type` — so a substring scan would report the wrapper as authoring a verdict when it is only
    // naming an event. The quote anchors it to a literal the code is ASSIGNING as a decision.
    const literalOf = (w) => new RegExp(`['"\`]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    for (const word of VOCAB) {
      // CONTROL first: the needle is real and the split found the FSM.
      expect(fsm, `"${word}" is not a decision the gesture engine produces — this needle is stale`)
        .toMatch(literalOf(word))
      expect(
        wrapper,
        `"${word}" appears as a literal in the trace wrapper. The wrapper must record the decision `
        + 'the handler RETURNED, never name one itself — the moment it can author a verdict it is a '
        + 'second authority over the gesture engine.',
      ).not.toMatch(literalOf(word))
    }
  })
})

describe('⛔⛔ FACT 8 — no sink. The buffer never reaches a network', () => {
  // Needles are concatenated so this file's own source can never satisfy a scan of itself, and are
  // matched against COMMENT-STRIPPED code only.
  const BANNED = [
    ['fetch', 'fetch' + '('],
    ['XMLHttpRequest', 'XML' + 'HttpRequest'],
    ['sendBeacon', 'send' + 'Beacon'],
    ['WebSocket', 'Web' + 'Socket'],
    ['EventSource', 'Event' + 'Source'],
    ['an /api/ URL', '/api' + '/'],
  ]

  it('CONTROL: the sweep finds a real call when one is there', () => {
    const planted = stripComments(`const go = () => ${'fetch' + '('}'/api' + '/x')\n`)
    const hits = BANNED.filter(([, needle]) => planted.includes(needle)).map(([label]) => label)
    expect(hits, 'the sweep cannot see a network call it was handed — it proves nothing below')
      .toContain('fetch')
  })

  // ⚠️ A plain loop, not `it.each` — the `-t` guard at the top of this file wraps `it` in a local
  // function, and a wrapper has no `.each`. One `it()` per file keeps attribution: when this goes
  // red it must name WHICH file grew a sink.
  for (const [name, key] of [
    ['gestureTrace.js', 'buffer'],
    ['useJoystick.js', 'engine'],
    ['JoystickSettingsCard.jsx', 'card'],
  ]) {
    it(`${name} performs no network call of its own`, () => {
      const src = stripComments(read(FILES[key]))
      for (const [label, needle] of BANNED) {
        expect(
          src,
          `${name} contains ${label}. Master spec §8: the trace is a LOCAL export the owner pastes `
          + 'back by hand. Adding a sink turns a diagnostic into telemetry nobody consented to.',
        ).not.toContain(needle)
      }
    })
  }

  it('the only export path in the card is the clipboard', () => {
    const src = stripComments(read(FILES.card))
    expect(src, 'the Copy button no longer writes to the clipboard').toContain('navigator.clipboard.writeText')
  })
})

describe('the ring — capacity, and window bounds that make its size readable', () => {
  const row = (n) => ({ type: 'pointermove', clientX: n, decision: null })

  it('⛔ THE CAP IS 500 — the literal, not whatever the module happens to declare', () => {
    // ⚰️ Every other assertion in this block imports `GESTURE_TRACE_CAP` and compares the ring
    // against it, which proves the ring HONOURS its cap and says nothing about what the cap IS.
    // Raising it to 5,000 left all of them green — caught by running that exact mutation. The
    // number is a product decision ("the last 500 pointer events"), so it is pinned as a literal.
    expect(GESTURE_TRACE_CAP, 'the ring size changed. It bounds an in-memory buffer fed by a '
      + 'pointer stream on a phone, and every other check here moves with it.').toBe(500)
  })

  it('CONTROL: a fresh buffer is empty, and one record is one row', () => {
    expect(readGestureTrace().kept).toBe(0)
    expect(readGestureTrace().rows).toEqual([])
    recordGestureEvent(row(1))
    const t = readGestureTrace()
    expect(t.kept).toBe(1)
    expect(t.recorded).toBe(1)
    expect(t.rows[0].seq).toBe(1)
    expect(t.rows[0].clientX).toBe(1)
  })

  it(`⛔ the ring caps at ${GESTURE_TRACE_CAP} and DROPS THE OLDEST`, () => {
    const over = GESTURE_TRACE_CAP + 100
    for (let i = 1; i <= over; i += 1) recordGestureEvent(row(i))
    const t = readGestureTrace()

    expect(t.kept, 'the ring grew past its cap — an unbounded buffer on a pointer stream').toBe(GESTURE_TRACE_CAP)
    expect(t.rows.length).toBe(GESTURE_TRACE_CAP)
    expect(t.recorded, 'the total count stopped counting').toBe(over)
    expect(t.dropped, 'the buffer lost rows and did not say so').toBe(100)

    // Oldest-first ordering, and the window bounds name exactly which events survived.
    expect(t.rows[0].seq).toBe(101)
    expect(t.rows[0].clientX).toBe(101)
    expect(t.rows[GESTURE_TRACE_CAP - 1].seq).toBe(over)
    expect(t.rows[GESTURE_TRACE_CAP - 1].clientX).toBe(over)
    expect(t.firstSeq).toBe(101)
    expect(t.lastSeq).toBe(over)
  })

  it('⛔ a SATURATED buffer cannot read as "that is everything that happened"', () => {
    // `lesson_a_saturated_instrument_reports_zero`: 500 rows and 5,000 events look identical
    // unless the window says otherwise, and the operator reading a pasted trace has no other way
    // to tell. The payload carries the bounds beside the rows, not instead of them.
    for (let i = 0; i < GESTURE_TRACE_CAP * 2; i += 1) recordGestureEvent(row(i))
    const payload = gestureTracePayload()
    expect(payload.window.dropped).toBe(GESTURE_TRACE_CAP)
    expect(payload.window.recorded).toBe(GESTURE_TRACE_CAP * 2)
    expect(payload.window.kept).toBe(GESTURE_TRACE_CAP)
    expect(payload.rows.length).toBe(GESTURE_TRACE_CAP)
  })

  it('clear() starts a fresh capture — the SE run cannot bleed into the 15 Pro run', () => {
    recordGestureEvent(row(1))
    expect(readGestureTrace().kept).toBe(1)
    clearGestureTrace()
    const t = readGestureTrace()
    expect(t.kept).toBe(0)
    expect(t.recorded).toBe(0)
    expect(t.firstSeq).toBeNull()
    expect(t.lastSeq).toBeNull()
  })

  it('the payload carries the thresholds the engine compared against, READ from constants.js', () => {
    recordGestureEvent(row(1))
    const payload = gestureTracePayload()
    expect(payload.trace).toBe('uct-joystick-g0')
    expect(
      payload.constants.FLICK_MS,
      'the payload hard-codes a threshold instead of reading it — a pasted trace whose flickMs '
      + 'disagrees with the build that produced it is unreadable',
    ).toBe(FLICK_MS)
    expect(payload.device).toBeTruthy()
    expect(Object.keys(payload.device)).toContain('userAgent')
  })
})
