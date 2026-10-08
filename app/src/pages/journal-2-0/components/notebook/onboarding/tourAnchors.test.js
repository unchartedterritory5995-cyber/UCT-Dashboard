// @vitest-environment node
// Wave 8 seam S8-3 — every tour step's anchor is REALLY in the file the step names.
//
// The tour (lane 8C) points at elements in lane 8A's files — NotebookTab, FolderSidebar,
// NoteEditorPage — through `data-tour="…"` attributes the seam placed on elements that
// already existed. 8A restructures those files this wave (accessibility), and an anchor
// deleted or renamed there fails nowhere else: the tour quietly skips that step and every
// other test stays green. This rail reads each named file's JSX and fails BY NAME.
//
// ⛔ BY AST, never a text grep: a `data-tour="…"` inside a comment is not an anchor, and a
// grep would count it. `acorn` + `acorn-jsx` are what NotebookTab.lazyViews.test.js and
// reachable.test.js already parse the tree with — no new dependency.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'
import { TOUR_STEPS } from './tourSteps'
import { TOUR_REGISTRY } from './tourRegistry'

const JsxParser = Parser.extend(jsx())
const HERE = path.dirname(fileURLToPath(import.meta.url))
const WAVE = path.resolve(HERE, '..', '..', '..') // …/pages/journal-2-0

/** Every `data-tour` attribute value in `src`, in order; a non-literal value is reported
 *  as `<expression>` so it cannot hide from the checks below. */
function tourAnchorsIn(src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
  const out = []
  ;(function visit(n) {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'JSXAttribute' && n.name?.type === 'JSXIdentifier' && n.name.name === 'data-tour') {
      out.push(n.value?.type === 'Literal' && typeof n.value.value === 'string' ? n.value.value : '<expression>')
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v.type === 'string') visit(v)
    }
  })(ast)
  return out
}

const read = (rel) => fs.readFileSync(path.join(WAVE, rel), 'utf8')
const FILES = [...new Set(TOUR_STEPS.map((s) => s.file))]
const FOUND = Object.fromEntries(FILES.map((f) => [f, tourAnchorsIn(read(f))]))
// Wave 14 (W14-B1/B2/B3, reconciled at integration): a registered tour may anchor in the
// base tour's files too (the editor, the sidebar, the notes list, Research Home are where
// most capabilities live). Such an anchor is read by THAT tour, and the registry check below
// holds it to exactly-once by name, so it is not an orphan. The orphan check therefore
// accepts an anchor only when a step of the base tour or of a registered tour names it AND
// names THIS file (B2's per-file form: a name declared for some other file does not excuse a
// stray here). It still refuses one nobody reads, and an expression.
const DECLARED_IN = {}
for (const { steps } of [{ steps: TOUR_STEPS }, ...(await Promise.all(TOUR_REGISTRY.map((t) => t.load())))]) {
  for (const s of steps) (DECLARED_IN[s.file] ||= new Set()).add(s.anchor)
}

describe('the tour step list', () => {
  it('is frozen, non-empty, and every step is exactly {id, anchor, file}', () => {
    expect(Object.isFrozen(TOUR_STEPS)).toBe(true)
    expect(TOUR_STEPS.length, 'non-vacuity: a tour with no steps checks nothing').toBeGreaterThanOrEqual(6)
    for (const s of TOUR_STEPS) {
      expect(Object.isFrozen(s), `${s.id} is not frozen`).toBe(true)
      expect(Object.keys(s).sort()).toEqual(['anchor', 'file', 'id'])
      for (const k of ['id', 'anchor', 'file']) expect(typeof s[k], `${s.id}.${k}`).toBe('string')
    }
  })

  it('ids and anchors are each unique', () => {
    const ids = TOUR_STEPS.map((s) => s.id)
    const anchors = TOUR_STEPS.map((s) => s.anchor)
    expect(new Set(ids).size, `duplicate id in ${ids}`).toBe(ids.length)
    expect(new Set(anchors).size, `duplicate anchor in ${anchors}`).toBe(anchors.length)
  })
})

describe('every step\'s anchor is in its named file (lane 8A cannot delete one silently)', () => {
  it('NON-VACUITY — the parse found anchors in every named file', () => {
    for (const f of FILES) expect(FOUND[f].length, `${f}: no data-tour attribute found at all`).toBeGreaterThan(0)
  })

  it.each(TOUR_STEPS.map((s) => [s.id, s.anchor, s.file]))(
    'step %s: data-tour="%s" appears EXACTLY once in %s',
    (_id, anchor, file) => {
      const n = FOUND[file].filter((a) => a === anchor).length
      expect(n, `${file} carries data-tour="${anchor}" ${n} times — the tour highlights the FIRST match, `
        + 'so zero skips the step and two points at whichever renders first').toBe(1)
    },
  )

  it('every data-tour in those files is a literal AND some step of a registered tour names it IN THAT FILE (no orphan, no expression)', () => {
    const strays = FILES.flatMap((f) => FOUND[f].filter((a) => !DECLARED_IN[f]?.has(a)).map((a) => `${f}: ${a}`))
    expect(strays, `an anchor no step names in its file is an attribute nobody reads; an expression evades this rail: ${strays.join('; ')}`).toEqual([])
  })
})

// ─── Wave 14 (lane W14-0), risk R1 ───────────────────────────────────────────────
//
// "~20 tours is a lot of anchors; one renamed or removed anchor rots a tour
// silently" (plan section 8, R1). The check above is pinned to the base tour's own
// `TOUR_STEPS` -- it protects THAT tour whether or not a registry exists. This
// extends the SAME derive-and-fail-by-name pattern to every entry the registry
// holds, generically, so a tour W14-B adds tomorrow is covered the day it lands,
// with no new test to write for it.
describe('the registry extends this check to EVERY registered tour (risk R1)', () => {
  it('NON-VACUITY — the registry is not empty, and the base tour is in it', () => {
    expect(TOUR_REGISTRY.length).toBeGreaterThan(0)
    expect(TOUR_REGISTRY.some((t) => t.id === 'notebook-basics')).toBe(true)
  })

  it.each(TOUR_REGISTRY.map((t) => [t.id]))(
    'tour %s: every step\'s anchor appears EXACTLY once in its named file',
    async (id) => {
      const entry = TOUR_REGISTRY.find((t) => t.id === id)
      const { steps } = await entry.load()
      expect(Array.isArray(steps) && steps.length, `${id}: load() returned no steps`).toBeGreaterThan(0)
      const files = [...new Set(steps.map((s) => s.file))]
      const found = Object.fromEntries(files.map((f) => [f, tourAnchorsIn(read(f))]))
      for (const s of steps) {
        const n = found[s.file].filter((a) => a === s.anchor).length
        expect(n, `${id} step ${s.id}: data-tour="${s.anchor}" appears ${n} times in ${s.file} — `
          + 'a renamed or removed anchor rots this tour silently without this check').toBe(1)
      }
    },
  )

  it('CONTROL: a registry entry whose step names an anchor that is not there fails by name', async () => {
    const brokenEntry = {
      id: 'w14-0-control-broken',
      load: async () => ({
        steps: [{ id: 'x', anchor: 'this-anchor-does-not-exist', file: 'components/notebook/ResearchHome.jsx' }],
      }),
    }
    const { steps } = await brokenEntry.load()
    const found = tourAnchorsIn(read(steps[0].file))
    expect(found.filter((a) => a === steps[0].anchor).length).toBe(0)
  })
})

describe('CONTROLS — the parser can fail', () => {
  it('sees an anchor it is handed, and ignores one written in a comment', () => {
    const src = [
      'export default function X() {',
      '  // <div data-tour="in-a-comment" />',
      '  return (<div data-tour="real">{/* data-tour="in-jsx-comment" */}<span data-tour={dyn} /></div>)',
      '}',
    ].join('\n')
    expect(tourAnchorsIn(src)).toEqual(['real', '<expression>'])
  })

  it('a file without the attribute yields nothing', () => {
    expect(tourAnchorsIn('export const A = () => <button type="button">Go</button>')).toEqual([])
  })
})
