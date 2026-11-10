// RAIL: guide/words.js `scan` lost its lookbehind piece (iOS 16 floor: agentNoLookbehindStrings.test.js); NOT_AFTER now
// carries "not right after on / off / full", and nothing a caller sees moved. OLD = the scan concept as it was compiled
// before (the lookbehind piece kept verbatim here, a test file is outside the product scans); NEW = conceptsOf today.
// Over every string literal in app/src/agent's test files that says "screen" or "scan", plus phrasings built around the
// veto, both agree on the scan concept, and a "screen…" word the old strip left over is still left over (and only it).
// The walkthrough-level check (no held-out case reaches a different target) is evidence:
// docs/agent/program/evidence/teach-grid-ops/lookbehind/. LOCAL.
import { describe, it, expect } from 'vitest'
import { conceptsOf } from './guide/words'
import { testFileLiterals } from './__fixtures__/noLookbehind/corpus'

// the scan pieces before the change, compiled by words.js's own pieceRe rule (a plain piece is `\b<piece>\w*`)
const OLD_SCAN = new RegExp(['\\bscan\\w*', '\\bscreen(?<!\\b(?:on|off|full)\\s+screen)\\w*'].join('|'), 'i')
// words.js's reading of a phrase before its pieces are matched (lowercase, straight apostrophes; padded)
const norm = (q) => ` ${q.toLowerCase().replace(/[’']/g, "'")} `
const stem = (w) => w.replace(/ies$/, 'y').replace(/([^s])s$/, '$1').replace(/(ing|ed)$/, '').replace(/(.)\1$/, '$1')
// the "screen…" words the OLD strip left over: a vetoed occurrence no later piece takes (image's `screenshot`)
const oldScreenLeft = (q) => [...norm(q).matchAll(/\bscreen\w*/g)]
  .filter((m) => /\b(?:on|off|full)\s+$/.test(norm(q).slice(0, m.index)) && !/^screenshot/.test(m[0])).map((m) => `~${stem(m[0])}`)
const newScreenLeft = (q) => [...conceptsOf(q)].filter((c) => /^~screen/.test(c))

const BUILT = [
  'on screen', 'off screen', 'full screen', 'full  screen', 'full\tscreen', 'fullscreen', 'won screen', 'onscreen',
  'the screener', 'open the screener on screen', 'on screen then the screener', 'full screenshot', 'take a full screenshot',
  'off screens', 'on screening', 'back on screen after maximizing', 'restore it to full screen', 'screen', 'screens',
  'scan on screen', 'on scan', 'full-screen', 'on-screen', 'the screen', 'my screen layout', 'on screen screener',
  'how do I get the grid back on screen', 'how do I go full screen on a chart', 'turn off screen sharing', 'on   screener',
]
const CORPUS = [...new Set([...testFileLiterals().literals.filter((s) => /screen|scan/i.test(s) && s.length < 300), ...BUILT])]

describe('words.js scan: NOT_AFTER hits exactly where the lookbehind did', () => {
  it('the corpus is the rails\' own phrasings, not only the built ones', () => {
    expect(CORPUS.length).toBeGreaterThan(BUILT.length + 50)
  })
  it('the scan concept, old vs new, over the whole corpus', () => {
    const differ = CORPUS.filter((q) => conceptsOf(q).has('scan') !== OLD_SCAN.test(norm(q)))
    expect(differ).toEqual([])
  })
  it('the "screen…" words left over, old vs new', () => {
    const differ = CORPUS.filter((q) => JSON.stringify([...new Set(oldScreenLeft(q))].sort()) !== JSON.stringify(newScreenLeft(q).sort()))
    expect(differ).toEqual([])
  })
  it.each([['on screen', false], ['open the screener', true], ['full screen', false], ['full screenshot', false], ['won screen', true]])('"%s" scan = %s', (q, want) => {
    expect(conceptsOf(q).has('scan')).toBe(want)
  })
})
