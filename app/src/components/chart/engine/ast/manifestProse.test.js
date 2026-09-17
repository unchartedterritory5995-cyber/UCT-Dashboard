// app/src/components/chart/engine/ast/manifestProse.test.js

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { stripProse, KEEP, STRUCTURAL , DROP } from './manifestProse.js'
import TABLE from './closedTable.json'

const ROOT = path.resolve(process.cwd(), '..')

/** The manifest's own directory — every file here can see the table by import. */
const AST_DIR = path.join('components', 'chart', 'engine', 'ast')

/** Every non-test source file in BOTH lanes **that can see the manifest**. */
function sources() {
  const out = []
  for (const base of ['app/src', 'api']) {
    const stack = [path.join(ROOT, base)]
    while (stack.length) {
      const dir = stack.pop()
      let entries = []
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { continue }
      for (const e of entries) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { stack.push(p); continue }
        if (!/\.(js|jsx|py)$/.test(e.name)) continue
        // ⛔⛔ BOTH PYTEST CONVENTIONS, AND THE PREFIX ONE IS THE ONE THIS REPO
        // ACTUALLY USES. This excluded `*.test.*` and `*_test.py` only, so the
        // SEVENTEEN `test_*.py` modules that live inside `api/` beside the code
        // they test were being read as product source. One of them
        // (`api/services/test_fmp_client.py`) patches `fc._session` — a
        // `requests.Session` attribute with nothing to do with this manifest —
        // and the regex below matched it, so the rail reported `_session` as a
        // manifest key the product READS and would be stripped.
        // ⚠️ IT FAILED IN BOTH DIRECTIONS AT ONCE, which is why it is worth the
        // comment: the same false hit would also let a KEEP entry be justified
        // by nothing but a test file, and "the keep list has no passengers"
        // would agree. A false read admits prose to the bundle AND excuses it.
        // ⚰️ Surfaced by the 688-commit master merge on 2026-09-09: the file is
        // master's, the rail is this branch's, and neither side was wrong on its
        // own — which is the whole argument for merging weekly instead of once.
        if (e.name.includes('.test.')) continue
        if (/^test_.*\.py$/.test(e.name) || e.name.endsWith('_test.py')) continue
        if (e.name === 'manifestProse.js') continue
        let text = ''
        try { text = fs.readFileSync(p, 'utf8') } catch (err) { continue }
        // ⛔⛔ AND THE SAME CLASS CAME BACK, IN NON-TEST CODE. The exclusions above
        // were written for `test_fmp_client.py`'s `fc._session`, and they fixed
        // THAT FILE rather than the defect: a bare key name matched anywhere in
        // two whole trees. The 223-commit merge of 2026-09-17 produced
        // `api/services/breadth_combined_pass.py`'s `out.get("_session")` and
        // `breadth_wick_recon.py`'s `out["_session"]` — ordinary product code in
        // ANOTHER workstream, using a generic dict key that happens to spell a
        // manifest key. Same false read, same both-directions failure, and the
        // previous fix could not see it because it keyed on the FILENAME.
        //
        // ⭐ SO THE TEST IS NOW "COULD THIS FILE SEE THE MANIFEST AT ALL?" — a
        // file that never names `closedTable` and does not live in the manifest's
        // own directory cannot be reading its keys, whatever its dicts are called.
        // ⚠️ DELIBERATELY INCLUSIVE, AND ON THE RAW TEXT: a file that only
        // mentions the manifest in a comment still qualifies, because the
        // dangerous direction is EXCLUDING a real reader (a key gets stripped
        // that the product reads). The access match below stays strict and still
        // runs on comment-free text.
        if (!p.includes(AST_DIR) && !/closedTable/.test(text)) continue
        out.push(text)
      }
    }
  }
  return out
}

/** ⛔ COMMENTS STRIPPED FIRST, AND THAT IS THE WHOLE DIFFICULTY. These keys are
 *  NAMED in prose constantly — `_functions_cumulative` is cited in a dozen
 *  comments across both lanes — so a bare substring search reports every one of
 *  them as "used" and the strip becomes a no-op that looks like it works.
 *
 *  ⛔⛔ AND A COMMENT IS NOT THE ONLY PLACE PROSE LIVES. This stripped `//`, `/* *\/`
 *  and `#` lines only, so a PYTHON DOCSTRING was read as code — and
 *  `api/services/user_definitions.py` has a docstring containing the text
 *  `` `_requirement_tags._` ``, which satisfied the access pattern for the key `_`
 *  and made the manifest's own 1,176-character header look like runtime data.
 *  ⭐ The line it matched is explaining a rail that AST-walks docstrings, and the
 *  `_` it names is a NESTED key inside `_requirement_tags`, not the top-level
 *  header at all — so the citation was wrong twice over and still read as proof.
 *
 *  ⚠️ INTERPOLATIONS ARE KEPT. A template literal's `${…}` holds real expressions,
 *  so `` `${TABLE._folds.note}` `` is an access and must survive the strip; only the
 *  prose BETWEEN the interpolations goes. Stripping the whole literal would be the
 *  dangerous direction — excluding a real reader, which ships a key the product
 *  reads as `undefined` in a browser.
 *
 *  ⭐ MEASURED BEFORE IT WAS APPLIED, because that is the only way to know a strip
 *  is not hiding a reader: over the 57 files this scan admits, adding docstrings
 *  and literals changes the accessed set by exactly ONE key — `_` leaves it, and
 *  nothing enters. Every other key keeps a justification in real code. */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*#.*$/gm, '')
    .replace(/"""[\s\S]*?"""/g, '')
    .replace(/'''[\s\S]*?'''/g, '')
    .replace(/`([^`]*)`/g, (_m, inner) => (inner.match(/\$\{[^}]*\}/g) || []).join(' '))
}

/** Which `_` keys does the running product READ, as data? */
function accessedKeys() {
  const bodies = sources().map(withoutComments)
  const found = new Set()
  for (const key of Object.keys(TABLE).filter((k) => k.startsWith('_'))) {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\.\\s*${esc}\\b|\\[\\s*['"]${esc}['"]\\s*\\]|get\\(\\s*['"]${esc}['"]`)
    if (bodies.some((b) => re.test(b))) found.add(key)
  }
  return found
}

describe('the strip is safe, and the rail derives what safe means', () => {
  it('⛔⛔ NON-VACUITY — the scan still reaches readers OUTSIDE the manifest\'s directory', () => {
    // ⛔ THE NARROWING'S OWN CONTROL, AND THE FIRST VERSION OF IT COULD NOT FAIL.
    // It asserted `_input_windows`, `_bind_time_constants` and `_benchmarks_scannable`
    // stayed ACCESSED — all true, and all useless here, because every one of those
    // is ALSO read from inside `AST_DIR` (parse.js, vocabulary.js). Deleting the
    // `closedTable` clause entirely left the control green. A fixture that cannot
    // distinguish is not a rail, and only the mutation proof said so.
    //
    // ⭐ `_tables_fit` IS THE KEY THAT DISCRIMINATES, and measurement — not
    // intuition — picked it: it is the ONLY manifest key whose sole reader lives
    // outside the manifest's own directory. `objectTableDom.js:248` reads
    // `CLOSED_TABLE._tables_fit.floorPx` and sits in `engine/`, not `engine/ast/`,
    // so it is reached ONLY by the `closedTable` clause. Over-tighten the scan and
    // this key alone goes quiet — which would strip the note a member reads when a
    // table was scaled to fit a phone, silently, since the call site has a `|| ''`
    // fallback. Same failure shape as `_folds`: no wrong number, no crash, the
    // member simply never told.
    const accessed = accessedKeys()
    expect(accessed.has('_tables_fit'),
      'the scan no longer reaches app/src/components/chart/engine/objectTableDom.js — '
      + 'a real reader outside the manifest directory has been excluded, so the key it '
      + 'reads would be stripped from the bundle').toBe(true)

    // …and the Python lane is genuinely in the scan, quoted by its ACCESS rather
    // than by a file name — the citation rule this rail exists to enforce.
    const bodies = sources().map(withoutComments)
    expect(bodies.some((b) => /\(TABLE\.get\("_input_windows"\)/.test(b)),
      'no scanned body contains the Python lane\'s own access to `_input_windows` — '
      + 'api/services/ast_table.py and ast_lint.py have fallen out of the scan').toBe(true)

    // …and the scan is not empty for some unrelated reason.
    expect(sources().length, 'the scan found no files at all').toBeGreaterThan(5)
  })

  it('⛔ CONTROL — a key name used by ANOTHER workstream is not a manifest read', () => {
    // ⚰️ TWICE NOW. `test_fmp_client.py`'s `fc._session` (688-commit merge,
    // 2026-09-09) and then `breadth_combined_pass.py`'s `out.get("_session")`
    // (223-commit merge, 2026-09-17) — both ordinary code elsewhere in the repo
    // whose dict key happens to spell a manifest key. Neither is a manifest read.
    const accessed = accessedKeys()
    expect(accessed.has('_session'),
      '`_session` is being read as a manifest key again — check whether the hit is '
      + 'real or another workstream\'s identically-named field').toBe(false)
  })

  it('⛔⛔ every key the product READS survives the strip', () => {
    // ⭐ THE LOAD-BEARING ONE. A build step that dropped a key the code reads
    // would fail in a browser, at runtime, as `undefined` rather than a refusal —
    // the single worst way for this to go wrong. So the keep list is checked
    // against a walk of the real source, not against memory.
    const accessed = accessedKeys()
    expect(accessed.size, 'the walk found no property access at all — it is broken')
      .toBeGreaterThan(0)
    const missing = [...accessed].filter((k) => !KEEP.includes(k))
    expect(missing, `these manifest keys are READ but would be stripped:\n${missing.join('\n')}`)
      .toEqual([])
  })

  it('⛔⛔ every `_` key is CLASSIFIED — an unknown one fails the BUILD', () => {
    // ⛔ THE DESIGN CHANGE OF 2026-09-09. The strip used to drop anything not in
    // KEEP, so a new key the product READS shipped as `undefined` in a browser —
    // three times, each caught by the rail below AFTER the fact. An allowlist
    // that silently discards is how a whole capability ships missing.
    const underscore = Object.keys(TABLE).filter((k) => k.startsWith('_'))
    expect(underscore.length, 'no `_` keys at all — the probe is broken')
      .toBeGreaterThan(0)
    const unclassified = underscore.filter((k) => !KEEP.includes(k) && !DROP.includes(k))
    expect(unclassified, 'these manifest keys are neither KEEP nor DROP, so the '
      + 'build will refuse them:\n' + unclassified.join('\n')).toEqual([])
  })

  it('⛔ KEEP and DROP are DISJOINT — a key cannot be both data and prose', () => {
    const both = KEEP.filter((k) => DROP.includes(k))
    expect(both, `classified twice: ${both.join(', ')}`).toEqual([])
  })

  it('⭐ and the strip really THROWS on an unregistered key — the positive control', () => {
    // ⛔ WITHOUT THIS, `stripProse` could have kept its old silent-drop behaviour
    // and the two assertions above would still pass: they check the LISTS, not
    // what the function does with a key that is on neither.
    expect(() => stripProse({ functions: {}, _a_key_nobody_registered: 'prose' }))
      .toThrow(/_a_key_nobody_registered/)
    // …and it names what to do about it, or the author has to go read this file
    expect(() => stripProse({ functions: {}, _a_key_nobody_registered: 'prose' }))
      .toThrow(/KEEP|DROP/)
  })

  it('⛔ the keep list has no passengers — every entry is really read', () => {
    // ⚰️ THE OTHER DIRECTION, and it is what stops `KEEP` becoming a place to file
    // anything somebody was unsure about, which would quietly return the 68KB.
    const accessed = accessedKeys()
    const passengers = KEEP.filter((k) => !accessed.has(k))
    expect(passengers, `kept but never read — remove or justify:\n${passengers.join('\n')}`)
      .toEqual([])
  })

  it('⭐ the strip actually saves something worth doing', () => {
    const { dropped, savedBytes } = stripProse(TABLE)
    expect(dropped.length).toBeGreaterThan(20)
    expect(savedBytes).toBeGreaterThan(50 * 1024)
  })

  it('⛔ the grammar itself is untouched — this may only ever remove prose', () => {
    // ⭐ THE NON-NEGOTIABLE. Everything a formula is made of must survive byte for
    // byte, or the engine in the browser is a different engine from the one on the
    // server and the two-lane conformance guarantee is void.
    const { table } = stripProse(TABLE)
    for (const section of STRUCTURAL) {
      if (TABLE[section] === undefined) continue
      expect(table[section], `${section} was stripped`).toEqual(TABLE[section])
    }
    // and per-entry sentences ride along inside those sections
    expect(table.functions.rsi.sentence).toBe(TABLE.functions.rsi.sentence)
  })

  it('⛔ nothing that survives begins with `_` unless it was kept deliberately', () => {
    const { table } = stripProse(TABLE)
    const survivors = Object.keys(table).filter((k) => k.startsWith('_'))
    expect(survivors.sort()).toEqual([...KEEP].sort())
  })

  it('⛔ it is a pure function — the original document is not mutated', () => {
    const before = JSON.stringify(TABLE)
    stripProse(TABLE)
    expect(JSON.stringify(TABLE)).toBe(before)
  })
})
