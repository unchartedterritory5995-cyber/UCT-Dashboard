// Lane P2: the rebase-safe hooks inside the partner files are still WIRED.
//
//     cd app && npx vitest run src/pages/optionsFlow/p2Hooks.wiring.test.js
//
// The partner rebases `OptionsFlow.jsx` and `DarkPool.jsx` often, sometimes through a web editor
// whose stale-tab saves have reverted shipped work before (see the flowViewPolicy import comment
// in OptionsFlow.jsx). Every lane-P2 behaviour lives in a module; the partner file holds one
// import and one call per site. This rail reads the partner files' CODE (comments stripped) and
// fails by name if a clobber drops a call while leaving the module, and its own tests, green.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../components/chart/engine/__tests__/sourceScan'

const PAGES = path.resolve(__dirname, '..')
const code = (f) => stripComments(fs.readFileSync(path.join(PAGES, f), 'utf8'))

const HOOKS = {
  'OptionsFlow.jsx': [
    ['recent=1: the Search fetch comes from flowRecentWindow', /import\s*\{\s*fetchSearchProduct\s*\}\s*from\s*"\.\/optionsFlow\/flowRecentWindow"/],
    ['recent=1: the window label is mounted with the landed product', /<FlowRecentWindowNote\s+sym=\{selectedTicker\.s\}\s+searchFull=\{searchFull\}\s*\/>/],
    ['EXPORT-FLOW: the Export door is mounted in the Search view', /<FlowExportButton\s+sym=\{selectedTicker\.s\}/],
    ['TERM-033: the ER-badge week read', /weeks\.push\(readErWeek\(/],
    ['TERM-065: top-flow header toggle', /setTfSort\(prev => nextColSort\(prev, h\)\)/],
    ['TERM-065: batch header toggle', /clickPairSort\(batchSort, sk, setBatchSort, setBatchSortDir, tickerAscFirst\)/],
    ['TERM-065: OI tracker header toggle', /setOiSort\(prev => nextTwoLevelSort\(prev, col\)\)/],
    ['TERM-065: tracked-contracts header toggle', /setTrkSort\(prev => nextTwoLevelSort\(prev, col\)\)/],
  ],
  'DarkPool.jsx': [
    ['TERM-033: the mktcap batch read', /readMktcapBatch\(base, batch, mktcapAttemptedRef\.current\)/],
    ['TERM-065: three panels on usePairSort', /usePairSort\(/g, 3],
  ],
}

describe('lane P2 hooks stay wired in the partner files', () => {
  for (const [file, hooks] of Object.entries(HOOKS)) {
    const src = code(file)
    for (const [name, re, count] of hooks) {
      it(`${file}: ${name}`, () => {
        const n = (src.match(re) || []).length
        if (count) expect(n, name).toBe(count)
        else expect(n, name).toBeGreaterThan(0)
      })
    }
  }

  it('the old inline Search import is gone (a second import would bypass the window label)', () => {
    expect(code('OptionsFlow.jsx')).not.toMatch(/from\s*"\.\/optionsFlow\/flowSearchFetch"/)
  })

  it('control: the scan reads code, not comments', () => {
    expect(stripComments('// readErWeek(x)\nconst a = 1').includes('readErWeek')).toBe(false)
  })
})
