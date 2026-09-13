// R-05 is closed in EVERY section — one guard over all of them, not one guard per section.
//
// ── WHAT R-05 WAS ──────────────────────────────────────────────────────────────────────────────
// `contracts.js` documented `onScrub(scrub)` while `HubRoot.jsx` called `onScrub(ctx, scrub)`.
// Binding to either one made a section work in the suite and do nothing on the page, or the
// reverse — invisible to BOTH sides' unit tests. Two integrators, arriving from different
// sections, each independently wrote a NORMALISER: a rest-parameter handler that searched its own
// arguments for whichever one carried a numeric `delta`. Those shims were the right call while the
// ambiguity stood.
//
// The Director settled it on `(ctx, scrub)`, and `contractArity.test.js` now DERIVES that shape
// from the runtime call site rather than restating it, so the disagreement cannot return unseen.
//
// ⭐ THE SHIMS CAN RETURN, THOUGH — and a defensive read against a bug that no longer exists is
// itself a defect. It teaches the next reader that the seam is still ambiguous, which is precisely
// what caused two people to build one each. Worse, a section that accepts BOTH shapes cannot fail
// when it is wired the wrong way, so the next severed wire ships green.
//
// ── WHY THIS FILE IS REPO-WIDE, AND WHY IT REPLACED A PER-SECTION COPY ─────────────────────────
// `wireSection.test.jsx` carried this guard for wire alone. Breadth was the last section still
// holding its shim (`scrubPayloadOf`); deleting it would have meant a second copy of the same
// guard, and `lesson_a_guard_repeated_is_a_guard_unproved` is explicit — delete every copy but
// one, because three copies cannot all be mutation-proved and the weakest one sets the real bar.
// So the wire-specific block was removed and this took its place, over every section at once:
// a section added tomorrow is covered the day it lands, and fails BY NAME.
//
// ⚠️ Behaviour still belongs to each section. This file reads SOURCE — it proves no normaliser
// exists. Each section's own suite proves the one-argument call is inert, which is the half that
// source-reading cannot see.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const SECTIONS = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))

const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')

/**
 * Every section file that declares an `onScrub`, with comments stripped.
 *
 * ⛔ COMMENTS FIRST, ALWAYS. These files write prose ABOUT the deleted shim on purpose — the
 * tombstones name `scrubPayloadOf` and `readScrubPayload` in as many words. A raw scan reports
 * every one of them as still carrying the shim, and the rail fails on the documentation that
 * exists to explain why it does not. `contractArity.test.js` learned this the hard way.
 */
const FILES = readdirSync(SECTIONS)
  .filter((f) => /\.js$/.test(f) && !/\.test\.jsx?$/.test(f))
  .map((f) => ({ file: f, code: stripComments(readFileSync(path.join(SECTIONS, f), 'utf8')) }))
  .filter(({ code }) => /\bonScrub\s*[:=]/.test(code))

/** The parameter list of a section's `onScrub`, in either declaration form the repo uses. */
function scrubParams(code) {
  const m = code.match(/\bonScrub\s*:\s*\(([^)]*)\)\s*=>/)
    || code.match(/\bconst\s+onScrub\s*=\s*useCallback\(\s*\(([^)]*)\)\s*=>/)
  if (!m) return null
  // `_ctx` is the unused-parameter convention; it is the same parameter.
  return m[1].split(',').map((p) => p.trim().replace(/^_/, '')).filter(Boolean)
}

/**
 * The shim's SHAPE, not merely its two historical names.
 *
 * ⚰️ THIS LIST USED TO CARRY a broad "rest-parameter handler" matcher, and it was wrong in the way
 * this repo keeps rediscovering: it tested the adjacent thing. A rest parameter is not the defect.
 * A rest parameter ON `onScrub`, used to go hunting through the arguments, is. `screenerSection.js`
 * contains
 *
 *     const createAlert = useCallback((...args) => actionsRef.current.createAlert?.(...args), [])
 *
 * — a plain pass-through forwarder, entirely correct, and the broad pattern failed that whole
 * section on it. A rail that fails on correct code gets weakened or deleted, and then it is not
 * there for the real thing. (Caught by pre-flighting this rail against the real files before
 * calling it done, which is rule 14's habit applied to the rail itself.)
 *
 * ⭐ The rest-parameter half is covered PRECISELY instead, by the parameter-list assertion above:
 * an `onScrub(...args)` yields params `['...args']`, which is not `['ctx', 'scrub']`, and fails by
 * name. So these patterns only have to catch the SNIFFING.
 */
const SHIM_PATTERNS = [
  [/ScrubPayload|scrubPayloadOf/, 'a named payload-sniffing helper'],
  [/for\s*\(\s*const\s+\w+\s+of\s+args\s*\)/, 'a loop searching `args` for the payload'],
  [/\barguments\b/, 'a read of the `arguments` object'],
]

describe('no section normalises its own scrub arguments (R-05 stays closed)', () => {
  it('non-vacuity — the sweep found the real section files, named not counted', () => {
    // A derivation that returns [] passes every `for` below without reading anything.
    const names = FILES.map((f) => f.file).sort()
    for (const required of ['breadthSection.js', 'wireSection.js', 'screenerSection.js']) {
      expect(names, `${required} declares an onScrub but the sweep did not find it — the `
        + 'derivation is broken, not the sections').toContain(required)
    }
    expect(FILES.length).toBeGreaterThan(3)
  })

  it('⛔⛔ every section declares onScrub with TWO parameters, context first', () => {
    const wrong = []
    for (const { file, code } of FILES) {
      const params = scrubParams(code)
      if (!params) { wrong.push(`${file}: onScrub is declared in a shape this rail cannot read`); continue }
      if (params.length !== 2 || params[0] !== 'ctx' || params[1] !== 'scrub') {
        wrong.push(`${file}: (${params.join(', ')})`)
      }
    }
    expect(wrong, 'these sections do not take `(ctx, scrub)`. `HubRoot.jsx` calls '
      + '`onScrub(ctx, scrub)` and `contractArity.test.js` derives that from the call site — a '
      + 'section taking one argument reads the CONTEXT as its scrub payload and silently does the '
      + 'wrong thing on the real page while its own unit tests stay green.')
      .toEqual([])
  })

  it('⛔⛔ no section carries a payload-sniffing shim', () => {
    const found = []
    for (const { file, code } of FILES) {
      for (const [re, what] of SHIM_PATTERNS) {
        if (re.test(code)) found.push(`${file}: ${what}`)
      }
    }
    expect(found, 'a scrub-payload normaliser is back. R-05 is closed — `(ctx, scrub)` is the one '
      + 'shape, derived from the call site by contractArity.test.js.\n'
      + 'A shim here accepts BOTH shapes, which means a section wired the WRONG way can no longer '
      + 'fail — and that is the severed-wire class this whole seam was rebuilt to end.')
      .toEqual([])
  })

  it('⛔ THE CONTROL: the matchers hit BOTH shims as they were actually written', () => {
    // `lesson_gate_that_cannot_fail`. These are the two deleted implementations, verbatim — the
    // wire one and the breadth one, which were written independently and do not look alike.
    const WIRE_SHIM = `
export function readScrubPayload(...args) {
  for (const arg of args) {
    if (arg && typeof arg === 'object' && typeof arg.delta === 'number') return arg
  }
  return null
}
const onScrub = useCallback((...args) => {
  const scrub = readScrubPayload(...args)
}, [scrubTo])
`
    const BREADTH_SHIM = `
export function scrubPayloadOf(args) {
  for (const a of args) {
    if (a && typeof a === 'object' && typeof a.delta === 'number' && Number.isFinite(a.delta)) {
      return a
    }
  }
  return null
}
const config = {
  onScrub: (...args) => {
    const scrub = scrubPayloadOf(args)
  },
}
`
    for (const [name, shim] of [['wire', WIRE_SHIM], ['breadth', BREADTH_SHIM]]) {
      const hits = SHIM_PATTERNS.filter(([re]) => re.test(shim)).map(([, what]) => what)
      expect(hits.length, `the ${name} shim, verbatim, tripped NO matcher — this rail cannot fail `
        + 'and is decoration').toBeGreaterThan(0)
      // And the OTHER half of the shape: its handler took a rest parameter. That half is caught by
      // the parameter assertion rather than by a pattern, so prove that catch here too — otherwise
      // a shim that dropped its named helper would slip through with nothing watching.
      expect(scrubParams(shim), `the ${name} shim's rest-parameter handler read as a valid `
        + '(ctx, scrub) declaration').not.toEqual(['ctx', 'scrub'])
    }

    // The exact false positive that shaped SHIM_PATTERNS: a forwarder is not a shim.
    const FORWARDER = 'const createAlert = useCallback((...args) => ref.current.createAlert?.(...args), [])'
    const forwarderHits = SHIM_PATTERNS.filter(([re]) => re.test(FORWARDER)).map(([, w]) => w)
    expect(forwarderHits, 'a plain argument forwarder trips a shim matcher. screenerSection.js has '
      + 'exactly this line and it is correct — a rail that fails on correct code gets deleted, and '
      + 'then it is not there for the real thing.').toEqual([])

    // And the other direction: the settled shape must NOT trip anything, or the rail is unpassable.
    const SETTLED = `
const onScrub = useCallback((ctx, scrub) => {
  if (!scrub || typeof scrub.delta !== 'number') return
  scrubBy(scrub.delta)
}, [scrubBy])
`
    const falsePositives = SHIM_PATTERNS.filter(([re]) => re.test(SETTLED)).map(([, what]) => what)
    expect(falsePositives, 'the correct, settled handler trips a shim matcher — every section '
      + 'would fail this rail no matter what it does').toEqual([])
  })

  it('⛔ THE CONTROL: a tombstone NAMING the deleted shim does not trip the rail', () => {
    // The sections deliberately document what was removed and why. If comment-stripping ever
    // stopped running first, every one of them would report the shim it explicitly does not have —
    // the rail failing on its own documentation.
    const tombstone = `
// ⚰️ This used to run every argument through a \`scrubPayloadOf(args)\` shim that picked
// whichever one carried a finite numeric \`delta\`, because the typedef and the mounted
// caller disagreed (R-05). They no longer do.
const onScrub = useCallback((ctx, scrub) => { use(scrub) }, [use])
`
    expect(/scrubPayloadOf/.test(tombstone), 'the fixture must name the shim or it shows nothing')
      .toBe(true)
    const code = stripComments(tombstone)
    const hits = SHIM_PATTERNS.filter(([re]) => re.test(code)).map(([, what]) => what)
    expect(hits, 'comment-stripping is not running before the shim scan, so a section is failing '
      + 'this rail for DOCUMENTING the removal').toEqual([])
    expect(scrubParams(code)).toEqual(['ctx', 'scrub'])
  })
})
