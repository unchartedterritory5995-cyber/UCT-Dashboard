// app/src/components/chart/engine/runtime/__tests__/iterStorageCost.measure.test.js
//
// ─── ⭐⭐ WHAT A BAR DIMENSION ON THE ITERATION BUFFERS WOULD COST ───────────
//
// `objects:iterated-tree-not-last-bar` refuses a drawing whose per-row values
// are read on a bar other than the one that wrote them. The refusal's premise
// is a STORAGE FACT, not a translation gap: `vm.js` allocates `iters` once for
// the whole run, `ITER_SLOTS` long, indexed by the loop counter alone. There is
// no bar dimension, so an op reading a per-row value on bar 300 reads whatever
// bar 4,999 left behind.
//
// ⛔⛔ ADDING THAT DIMENSION IS A MEMORY-SCALE DECISION, NOT A LANE FIX, and
// this file exists so the decision is made against numbers rather than against
// the shape of the fix. A chart runs 5,000 bars; `ITER_SLOTS` is 500; and the
// question "how many buffers" has three different answers depending on which
// form is built:
//
//   FULL      every iterated tree gets `bars × ITER_SLOTS` doubles.
//   SPARSE    only the trees READ OFF THE LAST BAR need a bar dimension; a tree
//             read only on the last bar can stay flat, because the last bar IS
//             the bar that wrote it.
//   COMPACT   a bar stores only the slots the loop actually reached, not all
//             500 — measured at run time, so it cannot be estimated here.
//
// ⭐ IT READS `resolveIterTrees`, THE GUARD'S OWN WALK. A second walk over the
// same ops would be a second authority over one value, and the value is "does
// this drawing read rows from the wrong moment" — see `objectLane.js`.
//
// ⛔ IT ASSERTS NO COST. A measure pinned to a number goes red the first time
// the corpus changes. What is asserted is what must be true of any honest run:
// the corpus was found, and the row this file exists for is not empty.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from '../../ast/pine.js'
import { buildObjectLane, resolveIterTrees } from '../objectLane.js'
import { MAX_COLLECTION_CAP as ITER_SLOTS } from '../../ast/objectProgram.js'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'corpus/committed')
const SCRIPTS = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((f) => f.endsWith('.pine')).sort()
  : []

/** The bar counts this engine is actually asked for. ⭐ 5,000 is the ceiling the
 *  chart requests on every timeframe; the smaller ones are here so the shape of
 *  the growth is visible rather than asserted. */
const BAR_COUNTS = [500, 1000, 5000]
const BYTES_PER_SLOT = 8

const MB = (n) => `${(n / (1024 * 1024)).toFixed(1)}MB`

/** Every script's iterated-tree profile.
 *
 *  ⛔ COMPUTED ONCE FOR THE WHOLE FILE, and that is not tidiness: translating
 *  266 scripts takes ~10s on a quiet box and over 20s on a contended one, so
 *  paying for it per case put this file's cases over vitest's default ceiling
 *  under load — measured, as a TIMEOUT that reads exactly like a failure of the
 *  thing being measured. Both cases below also declare a ceiling of their own
 *  rather than inheriting the default: a corpus-wide measure IS slow, and a
 *  timeout dressed as a red is the least informative failure there is. */
let _profile = null
function profile() {
  if (_profile) return _profile
  const rows = []
  for (const name of SCRIPTS) {
    const src = fs.readFileSync(path.join(DIR, name), 'utf8')
    let t
    try {
      t = translatePine(src, {
        tf: 'D',
        newestBarIsForming: false,
        strict: true,
        objects: true,
        objectRawTrees: true,
        objectIterTrees: true,
      })
    } catch { continue }
    const objects = t.objects
    if (!objects || !Array.isArray(objects.ops) || objects.ops.length === 0) continue
    const trees = objects.trees || []
    let r
    try { r = resolveIterTrees(objects, trees) } catch { continue }
    const marked = Object.keys(r.iterated || {}).length
    if (!marked) continue
    const hot = r.iterSpecs.filter((s) => !s.lastBarOnly)
    rows.push({
      name,
      marked,
      orphans: r.orphanTrees.size,
      buffers: r.iterSpecs.length,
      hot: hot.length,
      cold: r.iterSpecs.length - hot.length,
      blocked: !!r.offender,
      unbounded: !!r.unbounded,
    })
  }
  _profile = rows
  return rows
}

describe('⭐⭐ the cost of a bar dimension on the iteration buffers', () => {
  it('⛔ CONTROL — the corpus is actually on disk', () => {
    expect(SCRIPTS.length).toBeGreaterThan(200)
  })

  it('⭐⭐ prints the per-script buffer counts and what each storage form costs', () => {
    const rows = profile()
    // ⛔ An empty result is a failed invocation until proven otherwise — this
    // whole file would print a tidy zero and read as "nothing to pay for".
    expect(rows.length).toBeGreaterThan(0)

    const blocked = rows.filter((r) => r.blocked)
    const lines = [
      '',
      `ITERATION-BUFFER COST  —  ${SCRIPTS.length} scripts, tf=D, `
        + `ITER_SLOTS=${ITER_SLOTS}, ${BYTES_PER_SLOT}B/slot`,
      `scripts declaring at least one iterated tree : ${rows.length}`,
      `…of which blocked on objects:iterated-tree-not-last-bar : ${blocked.length}`,
      '',
      ' marked  orph  bufs   hot  cold  blocked  script',
      ...rows
        .sort((a, b) => b.buffers - a.buffers || a.name.localeCompare(b.name))
        .slice(0, 30)
        .map((r) => `${String(r.marked).padStart(7)}${String(r.orphans).padStart(6)}`
          + `${String(r.buffers).padStart(6)}${String(r.hot).padStart(6)}`
          + `${String(r.cold).padStart(6)}${r.blocked ? '  BLOCKED' : '         '}  ${r.name}`),
      '',
      'THE BLOCKED ROW, AND WHAT EACH FORM WOULD COST IT',
      '   bufs   hot   FULL@5000     SPARSE@5000    script',
    ]
    for (const r of blocked.sort((a, b) => b.buffers - a.buffers)) {
      const full = r.buffers * 5000 * ITER_SLOTS * BYTES_PER_SLOT
      const sparse = r.hot * 5000 * ITER_SLOTS * BYTES_PER_SLOT
      lines.push(`${String(r.buffers).padStart(7)}${String(r.hot).padStart(6)}`
        + `${MB(full).padStart(12)}${MB(sparse).padStart(16)}    ${r.name}`)
    }

    const worst = rows.reduce((a, b) => (b.buffers > a.buffers ? b : a), rows[0])
    const worstHot = blocked.length
      ? blocked.reduce((a, b) => (b.hot > a.hot ? b : a), blocked[0])
      : null
    lines.push('', 'THE CEILING, BY BAR COUNT (the widest script in the corpus)')
    lines.push(`  widest: ${worst.name} — ${worst.buffers} buffers, ${worst.hot} hot`)
    lines.push('   bars      FULL        SPARSE(hot only)')
    for (const bars of BAR_COUNTS) {
      const full = worst.buffers * bars * ITER_SLOTS * BYTES_PER_SLOT
      const sparse = worst.hot * bars * ITER_SLOTS * BYTES_PER_SLOT
      lines.push(`${String(bars).padStart(7)}${MB(full).padStart(12)}${MB(sparse).padStart(18)}`)
    }
    if (worstHot) {
      lines.push('', 'THE WIDEST *HOT* SCRIPT ON THE BLOCKED ROW')
      lines.push(`  ${worstHot.name} — ${worstHot.hot} hot buffers`)
      for (const bars of BAR_COUNTS) {
        const sparse = worstHot.hot * bars * ITER_SLOTS * BYTES_PER_SLOT
        lines.push(`${String(bars).padStart(7)}  SPARSE ${MB(sparse)}`)
      }
    }
    const totalHot = blocked.reduce((n, r) => n + r.hot, 0)
    lines.push('', `hot buffers across the whole blocked row: ${totalHot}`)
    lines.push('')
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))

    // ⛔ THE ROW THIS FILE EXISTS FOR IS NOT EMPTY. If the walk ever stops
    // finding these reads this measure would print an empty table and read as a
    // costing.
    expect(blocked.length).toBeGreaterThan(0)

    // ⛔⛔ AND THE HOT/COLD SPLIT IS REAL, NOT A COLUMN OF ZEROES. Every number
    // in the table above is `hot` × bars × slots, so a `lastBarOnly` that always
    // answered TRUE would print a tidy 0.0MB for the sparse form and read as a
    // costing that had been done. A script blocked on an off-last-bar read has,
    // by definition, at least one buffer whose reader is not last-bar-only.
    for (const r of blocked) {
      expect(r.hot, `${r.name} is blocked on an off-last-bar read and reports `
        + 'ZERO buffers needing a bar dimension').toBeGreaterThan(0)
      expect(r.hot + r.cold).toBe(r.buffers)
    }
  }, 120000)

  it('⭐⭐ prints WHERE each formerly-blocked script stops NOW', () => {
    // ⛔⛔ LIFTING A BLOCKER IS NOT THE SAME AS MOVING THE PRODUCT, AND ONLY
    // THIS SEPARATES THEM. `objects:iterated-tree-not-last-bar` blocked eleven
    // scripts and every one of them was a real drawer, which is what made it
    // the largest genuinely-blocked drawing row. A script that passes it and
    // then dies two gates later has still not drawn anything, and a census line
    // that only reports the row going to zero would read as progress.
    //
    // ⭐ SO THE ANSWER IS PRINTED PER SCRIPT, BY NAME: what each one hits next.
    const rows = profile().filter((r) => r.blocked)
    expect(rows.length).toBeGreaterThan(0)
    const lines = ['', 'THE FORMERLY-BLOCKED ROW — WHERE EACH SCRIPT STOPS NOW', '']
    const by = new Map()
    for (const r of rows) {
      const src = fs.readFileSync(path.join(DIR, r.name), 'utf8')
      let now
      try {
        const built = buildObjectLane(src, { tf: 'D', newestBarIsForming: false })
        now = built.ok
          ? 'DRAWS'
          : `${built.lane}/${(built.refusal && built.refusal.guard) || 'unnamed'}`
      } catch (err) {
        now = `threw/${(err && err.message ? err.message : String(err)).slice(0, 40)}`
      }
      by.set(now, (by.get(now) || 0) + 1)
      lines.push(`  ${now.padEnd(34)}  ${r.name}`)
    }
    lines.push('')
    for (const [k, n] of [...by.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`${String(n).padStart(4)}  ${k}`)
    }
    lines.push('')
    // eslint-disable-next-line no-console
    console.log(lines.join('\n'))
    // ⛔ NOT ONE OF THEM MAY STILL DIE ON THE ROW THIS WAVE REMOVED. That is
    // the only thing asserted here — a count of how many now DRAW would go red
    // every time an unrelated gate moves.
    for (const [k] of by) expect(k).not.toContain('iterated-tree-not-last-bar')
  }, 120000)
})
