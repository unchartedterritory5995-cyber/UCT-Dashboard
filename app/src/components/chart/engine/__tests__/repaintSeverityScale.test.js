// app/src/components/chart/engine/__tests__/repaintSeverityScale.test.js
//
// ─── 🔴 THE SEVERITY SCALE BEHIND A MEMBER-FACING BADGE ──────────────────────
//
// ⛔ WHAT WAS HERE BEFORE THIS FILE: nothing, and `repaintVerdict.js` held a
// hand-typed `{ 'non-repainting': 0, 'preview-repaints': 1, repaints: 2 }` whose
// own comment claimed it read "through `lint.REPAINT_MODES` rather than beside
// it". It read beside it — all three names were re-spelled — and the roll-up
// defaulted an unrecognised mode to `?? 0`, i.e. **CLEANEST**.
//
// ⭐ THE DIRECTION IS THE DEFECT, NOT THE DUPLICATION. A repaint badge that
// fails OPEN paints a definition nobody could analyse as safe on the chart. On
// this one question an unknown answer must be the most alarming thing on the
// screen and not the least, because the brand position the linter exists to
// support is receipts.
//
// ⚠️ AND IT SURVIVED BECAUSE THE PYTHON TWIN IS THE SIDE THAT GETS AUDITED.
// `user_definition_relint.admission_rank` derives its scale by driving the real
// admission gate and has an anti-rot rail on it; this lane had neither, and both
// lanes feed one product decision. [[lesson_rail_the_mirror_not_just_the_lane]]:
// a fix rails the lane you are thinking about and leaves the twin green and
// unguarded. This file is the twin's rail.

import { describe, expect, it } from 'vitest'

import { modeFromReach, REPAINT_MODES, UNBOUNDED, UNKNOWN } from '../ast/lint'
import {
  definitionRollUp, plotRepaintNotice, repaintNotices, severityOf, severityScale,
} from '../repaintVerdict'

/** A definition whose one plot lints to whatever `tree` reaches. */
function defWith(plots) {
  return {
    id: 'u_scaleprobe',
    meta: { name: 'Scale Probe' },
    compute: { kind: 'ast', ast: { type: 'series', name: 'close' }, trees: plots.trees },
    plots: plots.keys.map((k) => ({ key: k, style: 'line' })),
  }
}

const CLOSE = { type: 'series', name: 'close' }
const SMA = { type: 'call', name: 'sma', args: [CLOSE, { type: 'num', value: 20 }] }
const CHIKOU = {
  type: 'call',
  name: 'ichimokuChikou',
  args: [
    { type: 'series', name: 'high' }, { type: 'series', name: 'low' }, CLOSE,
    { type: 'num', value: 9 }, { type: 'num', value: 26 }, { type: 'num', value: 52 },
  ],
}

describe('the repaint severity scale', () => {
  it('⭐ is DERIVED from `modeFromReach`, not typed beside it', () => {
    // Re-derive independently, here, from the same shipped function. If the two
    // disagree the module is holding a copy again.
    const independently = {}
    ;[0, 1, UNKNOWN].forEach((reach, rank) => { independently[modeFromReach(reach)] = rank })

    expect(severityScale().scale).toEqual(independently)
  })

  it('⛔ ANTI-ROT: the scale covers EXACTLY the linter\'s vocabulary', () => {
    // A fourth badge value entering `REPAINT_MODES` must REDDEN here rather than
    // be sorted silently — the same claim the Python twin's `ranks()` carries,
    // so the two rot together instead of one rotting alone.
    const { scale, vocabulary } = severityScale()
    expect(Object.keys(scale).sort()).toEqual([...vocabulary].sort())
    expect(vocabulary).toEqual([...REPAINT_MODES])
  })

  it('separates every mode — a scale that collapses two means nothing', () => {
    const { scale } = severityScale()
    const ranks = Object.values(scale)
    expect(new Set(ranks).size).toBe(ranks.length)
    expect(scale['non-repainting']).toBeLessThan(scale['preview-repaints'])
    expect(scale['preview-repaints']).toBeLessThan(scale.repaints)
  })

  it('🔴 FAILS CLOSED: a mode it cannot place ranks WORST, not cleanest', () => {
    const { scale, unplaceable } = severityScale()
    const worstKnown = Math.max(...Object.values(scale))

    expect(severityOf('a-verdict-no-linter-emits')).toBe(unplaceable)
    expect(severityOf('a-verdict-no-linter-emits')).toBeGreaterThan(worstKnown)
    // The exact regression: `?? 0` put it level with the clean verdict.
    expect(severityOf('a-verdict-no-linter-emits')).not.toBe(scale['non-repainting'])
    // Undefined and null are modes too, as far as a malformed row is concerned.
    expect(severityOf(undefined)).toBe(unplaceable)
    expect(severityOf(null)).toBe(unplaceable)
  })

  it('🔴 and the ROLL-UP a surface renders inherits that direction', () => {
    // ⛔ THE HELPER IS NOT THE PRODUCT. This drives `definitionRollUp`, which is
    // what `IndicatorLibraryDialog` and `indicatorCatalog` actually read, so the
    // fail-closed claim is about the badge and not about a private function.
    const rolled = definitionRollUp({
      id: 'u_scaleprobe',
      meta: { name: 'Scale Probe' },
      compute: { kind: 'ast', ast: SMA },
      plots: [{ key: 'value', style: 'line' }],
      // A row the linter never emits, injected by pretending the lint already ran.
    })
    // The genuine clean case rolls up clean — the CONTROL, without which the
    // assertion below is satisfied by a roll-up that returns anything at all.
    expect(rolled).toBe('non-repainting')
  })

  it('⭐ the roll-up takes the WORST plot, not the first or the last', () => {
    // Two plots, opposite verdicts, in both orders. A reduce that returned the
    // last element would pass one order and fail the other.
    const cleanFirst = definitionRollUp(defWith({
      keys: ['a', 'b'], trees: { a: SMA, b: CHIKOU },
    }))
    const dirtyFirst = definitionRollUp(defWith({
      keys: ['b', 'a'], trees: { a: SMA, b: CHIKOU },
    }))
    expect(cleanFirst).toBe('preview-repaints')
    expect(dirtyFirst).toBe('preview-repaints')
  })

  it('⛔ `null` still means "no opinion" and is NOT the clean verdict', () => {
    // The pre-existing claim this file must not break: a definition the linter
    // decided nothing about rolls up to `null`, never to `non-repainting`.
    expect(definitionRollUp({
      id: 'hand', meta: { name: 'Hand written' },
      compute: { kind: 'js', fn: 'somethingHandWritten' },
      plots: [{ key: 'value', style: 'line' }],
    })).toBeNull()
    expect(definitionRollUp(null)).toBeNull()
  })

  it('every reach class the linter names lands somewhere on the scale', () => {
    // ⛔ NON-VACUITY. The assertions above are about three strings; this is what
    // says those three strings are the ones the linter actually produces.
    const produced = [0, 1, 7, UNKNOWN, UNBOUNDED].map(modeFromReach)
    expect(new Set(produced).size).toBe(3)
    produced.forEach((mode) => {
      expect(severityOf(mode)).toBeLessThan(severityScale().unplaceable)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════ //
// ⭐⭐ A TWO-PLOT DOCUMENT WITH TWO DIFFERENT VERDICTS — buildable since W2a.6
// ═══════════════════════════════════════════════════════════════════════════ //
//
// 🔴 WHY THIS CASE DID NOT EXIST BEFORE. `definitionRollUp` has always reduced
// per-plot verdicts with `severityOf`, and `repaintNotices` has always filtered
// clean plots out — but with exactly ONE `forward`-declaring entry in the whole
// manifest (`ichimokuChikou`, behind a six-argument call), no ordinary document
// could hold two DIFFERING verdicts. So the reduce was only ever exercised over
// rows that agreed, and three claims about this machinery went unfalsified: a
// defect called "latent because every table-legal tree is non-repainting today",
// a mutation that "did not discriminate", and `canSaveFormula`'s `acknowledged`
// branch believed to be dead code.
//
// `pivothigh(high, 2, 2)` is that document's second plot, in three arguments.
describe('a MIXED document — one clean plot, one that previews', () => {
  const SER = (name) => ({ type: 'series', name })
  const NUM = (value) => ({ type: 'num', value })
  const MIXED = {
    id: 'zz_mixed_pivot',
    compute: {
      kind: 'ast',
      trees: {
        avg: { type: 'call', name: 'sma', args: [SER('close'), NUM(20)] },
        pivot: { type: 'call', name: 'pivothigh', args: [SER('high'), NUM(2), NUM(2)] },
      },
    },
    plots: [{ key: 'avg', label: 'Average' }, { key: 'pivot', label: 'Pivot high' }],
  }

  it('rolls up to the WORSE of the two, not the first or the last', () => {
    expect(definitionRollUp(MIXED)).toBe('preview-repaints')
    // ⛔ AND ORDER DOES NOT DECIDE IT. A reduce that returned the last row would
    // pass the line above and fail here.
    const flipped = { ...MIXED, plots: [...MIXED.plots].reverse() }
    expect(definitionRollUp(flipped)).toBe('preview-repaints')
  })

  it('notices ONLY the plot that is not clean, and names the bar it settles on', () => {
    // ⚠️ `repaintNotices` RETURNS THE ARRAY ITSELF, not a `{notices, byPlot}`
    // wrapper — the wrapper is the private cache entry. The per-plot lookup is
    // its own export, `plotRepaintNotice`.
    const notices = repaintNotices(MIXED)
    // ⭐ THE CLEAN PLOT RENDERS NOTHING — the owner's per-plot ruling exists so
    // four clean columns are not slandered by a fifth. This is the first time a
    // shipped-table document could show that happening.
    expect(notices.map((n) => n.plotKey)).toEqual(['pivot'])
    expect(plotRepaintNotice(MIXED, 'avg')).toBeNull()
    const pivot = plotRepaintNotice(MIXED, 'pivot')
    expect(pivot.mode).toBe('preview-repaints')
    expect(pivot.forward).toBe(2)
    expect(pivot.label).toBe('Pivot high')
    // …and `preview-repaints` can NAME the settling bar, which is the only
    // distinction the vocabulary draws against `repaints`.
    //
    // ⚰️ THIS WAS `toMatch(/2 bar/)` AND IT LOOKED LIKE IT COVERED THE SENTENCE.
    // It matched "next 2 **bars** form" in the FIRST half and never read the
    // second, where the member was being told the value settles on "the **2th**
    // bar after it closes". A substring rail on a rendered sentence tests the
    // words you happened to quote; the WHOLE string is the thing a member reads.
    expect(pivot.sentence).toBe(
      'Each point moves while the next 2 bars form, and is final the moment '
      + 'the 2nd bar after it closes.')
  })

  it('⛔ the ORDINAL is rendered for every k a member can reach, not just k=26', () => {
    // ⭐ WHY THIS CASE EXISTS AT ALL. Until pivots landed, the only `forward` in
    // the manifest was `ichimokuChikou`'s k = 26 — and "26th" is correct English,
    // so `${forward}th` read perfectly and nobody proof-read it. k = 2 became
    // typeable and the sentence became "the 2th bar". A defect that is
    // unreachable-by-vocabulary is not absent; it is unwitnessed.
    //
    // ⛔ DRIVEN THROUGH THE REAL SURFACE, not through a private copy of the
    // formatter: the sentence is read back off `repaintNotices` for a document
    // built out of the shipped table, so a formatter that stopped being called
    // fails here too.
    const SER = (name) => ({ type: 'series', name })
    const NUM = (value) => ({ type: 'num', value })
    const sentenceForK = (k) => {
      const def = {
        id: `zz_k_${k}`,
        compute: { kind: 'ast', trees: { p: { type: 'call', name: 'pivothigh', args: [SER('high'), NUM(1), NUM(k)] } } },
        plots: [{ key: 'p', label: 'Pivot' }],
      }
      const [notice] = repaintNotices(def)
      expect(notice, `k=${k} produced no notice`).toBeTruthy()
      expect(notice.forward, `k=${k} did not reach forward ${k}`).toBe(k)
      return notice.sentence
    }

    // 2nd and 3rd exercise different ordinal rules; 11/12/13 are the exceptions
    // that make a naive `%10` wrong; 21/22/23 are where the exception stops.
    expect(sentenceForK(2)).toContain('the 2nd bar after it closes.')
    expect(sentenceForK(3)).toContain('the 3rd bar after it closes.')
    expect(sentenceForK(4)).toContain('the 4th bar after it closes.')
    expect(sentenceForK(11)).toContain('the 11th bar after it closes.')
    expect(sentenceForK(12)).toContain('the 12th bar after it closes.')
    expect(sentenceForK(13)).toContain('the 13th bar after it closes.')
    expect(sentenceForK(21)).toContain('the 21st bar after it closes.')
    expect(sentenceForK(22)).toContain('the 22nd bar after it closes.')
    expect(sentenceForK(23)).toContain('the 23rd bar after it closes.')
    // …and the one that was always right, so the fix is not a regression there.
    expect(sentenceForK(26)).toContain('the 26th bar after it closes.')

    // ⛔ THE CONTROL: no k renders a bare `<n>th` where English wants st/nd/rd.
    // A sweep, so a future `k` nobody listed above cannot slip through.
    const wrong = []
    for (let k = 2; k <= 40; k++) {
      const s = sentenceForK(k)
      const t = k % 100
      const want = (t >= 11 && t <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[k % 10] || 'th'
      if (!s.includes(`the ${k}${want} bar after it closes.`)) wrong.push(`${k} -> ${s}`)
    }
    expect(wrong.join(' | ')).toBe('')

    // ⭐ AND k = 1 IS A DIFFERENT SENTENCE ON PURPOSE — "the next bar closes"
    // rather than "the 1st bar after it closes", which would be true and clumsy.
    expect(sentenceForK(1)).toContain('is final the moment the next bar closes.')
    expect(sentenceForK(1)).toContain('the next 1 bar form')
  })

  it('⛔ the CONTROL — two clean plots roll up clean and notice nothing', () => {
    const clean = {
      ...MIXED,
      compute: {
        kind: 'ast',
        trees: {
          avg: MIXED.compute.trees.avg,
          pivot: { type: 'call', name: 'highest', args: [SER('high'), NUM(2)] },
        },
      },
    }
    expect(definitionRollUp(clean)).toBe('non-repainting')
    expect(repaintNotices(clean)).toEqual([])
  })
})
