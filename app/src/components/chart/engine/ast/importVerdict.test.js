// I2 Workstream 2 — the four-class import verdict (`importVerdict.js`).
// Real translators throughout: every report below comes from the production
// import door `PineBox.inspectSource`, never from a hand-built shape, except the
// two cases that exist to exercise a code no translator emits today.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { inspectSource } from '../../builder/PineBox.jsx'
import { importOutcome } from './importOutcome.js'
import { detectDialect as pcfDetect } from './pcf.js'
import {
  importVerdict, savedImportVerdict, windowOverPeriodRead, NOTE_REGISTRY,
  THINKSCRIPT_NOTE_CODES, CLASSES, STATE, VERDICT, VERDICT_CONTRACT, DECIDED_DIALECTS,
} from './importVerdict.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const v = (src, dialect) => importVerdict(inspectSource(src, dialect))
const SAME_VALUES = /the values are the same/

describe('the contract shape', () => {
  it('every verdict carries the contract, the dialect and all four classes', () => {
    const r = v('sma(close, 10) > close', 'formula')
    expect(r.contract).toBe(VERDICT_CONTRACT)
    expect(r.dialect).toBe('formula')
    expect(Object.keys(r.classes).sort()).toEqual([...CLASSES].sort())
    for (const k of CLASSES) expect(Object.values(STATE)).toContain(r.classes[k].state)
  })

  it('never throws, on garbage or on a translator that hands back nonsense', () => {
    expect(() => importVerdict(null)).not.toThrow()
    expect(() => importVerdict({ dialect: 'thinkscript', ok: true, outputs: 7, ignored: 'x' })).not.toThrow()
    expect(importVerdict(null).verdict).toBe(VERDICT.UNSUPPORTED)
  })
})

describe('"exact" needs evidence', () => {
  it('the engine’s own formula language is not an import, so EXACT stands', () => {
    const r = v('sma(close, 10) > close', 'formula')
    expect(r.verdict).toBe(VERDICT.EXACT)
  })

  it('a clean TC2000 import is NEVER called exact — no vendor value was ever compared', () => {
    const rep = inspectSource('C > AVGC50', 'pcf')
    expect(rep.ok).toBe(true)
    // the old verdict, for the record: this is the claim I2 withdraws
    expect(importOutcome(rep).verdict).toBe('exact')
    const r = importVerdict(rep)
    expect(r.verdict).toBe(VERDICT.NO_KNOWN_DIFFERENCES)
    expect(r.label).not.toMatch(/exact/i)
    expect(r.reason).toMatch(/not been compared against TC2000/)
    expect(r.classes.values.state).toBe(STATE.SAME)
  })

  it('a clean thinkScript import is NEVER called exact either', () => {
    const r = v('plot x = close > Average(close, 20);', 'thinkscript')
    expect(r.verdict).toBe(VERDICT.NO_KNOWN_DIFFERENCES)
    expect(r.reason).toMatch(/thinkorswim/)
    expect(r.label).not.toMatch(/exact/i)
  })
})

describe('the four classes', () => {
  it('VALUES: a recorded seed difference makes the values class differ', () => {
    const r = v('plot x = ExpAverage(close, 10);', 'thinkscript')
    expect(r.classes.values.state).toBe(STATE.DIFFERS)
    expect(r.verdict).toBe(VERDICT.DISCLOSED)
    expect(r.reason).not.toMatch(SAME_VALUES)
  })

  it('VALUES: the TC2000 XUP boundary is a value difference', () => {
    const r = v('XUP(C, AVGC50)', 'pcf')
    expect(r.classes.values.state).toBe(STATE.DIFFERS)
    expect(r.classes.values.notes.map((n) => n.name)).toContain('XUP / XDOWN')
  })

  it('VISUALS: a colour line is a drawing difference, and only then are the values called the same', () => {
    const r = v('plot x = Average(close, 20);\nx.SetDefaultColor(Color.RED);', 'thinkscript')
    expect(r.classes.visuals.state).toBe(STATE.DIFFERS)
    expect(r.classes.values.state).toBe(STATE.SAME)
    expect(r.classes.behaviour.state).toBe(STATE.SAME)
    expect(r.verdict).toBe(VERDICT.DISCLOSED)
    expect(r.reason).toMatch(SAME_VALUES)
  })

  it('BEHAVIOUR: an Alert line is not a drawing — it is something the study DID', () => {
    const r = v('plot x = close > Average(close, 20);\nAlert(x, "up", Alert.BAR, Sound.Ding);', 'thinkscript')
    expect(r.classes.behaviour.state).toBe(STATE.DIFFERS)
    expect(r.classes.visuals.state).toBe(STATE.SAME)
    expect(r.reason).toMatch(/alerts or signals behave differently/)
  })

  it('INPUTS: a thinkScript input fixed at paste time is an input difference', () => {
    const r = v('input len = 20;\nplot x = Average(close, len);', 'thinkscript')
    expect(r.classes.inputs.state).toBe(STATE.DIFFERS)
    expect(r.classes.inputs.notes[0].note).toMatch(/cannot be changed afterwards/)
  })

  it('MISSING: an output that did not import makes the verdict partial', () => {
    const r = v('def a = Average(close, 20);\nplot P1 = a;\nplot P2 = MACD(12, 26, 9).Value;', 'thinkscript')
    expect(r.verdict).toBe(VERDICT.PARTIAL)
    expect(r.classes.values.state).toBe(STATE.MISSING)
  })
})

describe('unknown notes are treated conservatively', () => {
  // ⭐ A synthetic report, because no translator emits an unregistered code today —
  // the rail below proves that. This is the door a FUTURE code would walk through.
  const base = inspectSource('plot x = close > Average(close, 20);', 'thinkscript')
  const withCode = (code) => ({ ...base, outcome: undefined, ignored: [...base.ignored, { code, message: 'something new', line: 3 }] })

  it('an unregistered code reads "values may differ", is named, and the box never says the values are the same', () => {
    const rep = withCode('thinkscript:note-brand-new')
    // the old reading, for the record: PRESENTATION, i.e. "the values are the same"
    expect(importOutcome(rep).reason).toMatch(SAME_VALUES)
    const r = importVerdict(rep)
    expect(r.unregistered).toEqual(['thinkscript:note-brand-new'])
    expect(r.classes.values.state).toBe(STATE.MAY_DIFFER)
    expect(r.verdict).toBe(VERDICT.DISCLOSED)
    expect(r.reason).toMatch(/values may differ/)
    expect(r.reason).not.toMatch(SAME_VALUES)
  })

  it('a note with no code at all is unregistered too', () => {
    const r = importVerdict(withCode(undefined))
    expect(r.unregistered).toEqual(['(no code)'])
    expect(r.classes.values.state).toBe(STATE.MAY_DIFFER)
  })
})

describe('the registry is closed over what the translators emit', () => {
  it('every note code thinkscript.js declares is registered', () => {
    expect(THINKSCRIPT_NOTE_CODES.length).toBeGreaterThan(0) // non-vacuity
    for (const code of THINKSCRIPT_NOTE_CODES) expect(Object.keys(NOTE_REGISTRY)).toContain(code)
  })

  it('every `thinkscript:note-*` literal in the translator source is registered (source sweep)', () => {
    const src = fs.readFileSync(path.join(here, 'thinkscript.js'), 'utf8')
    const found = new Set(src.match(/'thinkscript:note-[a-z0-9-]+'/g).map((s) => s.slice(1, -1)))
    expect(found.has('thinkscript:note-chrome')).toBe(true) // control: the sweep sees a real one
    for (const code of found) expect(Object.keys(NOTE_REGISTRY)).toContain(code)
  })

  it('the TC2000 reader emits no ignored-line notes, so nothing of it can bypass the registry', () => {
    for (const src of ['C > AVGC50', 'XUP(C, AVGC50)', 'V > AVGV50 * 1.5']) {
      const rep = inspectSource(src, 'pcf')
      expect(rep.ok).toBe(true)
      expect(rep.ignored).toEqual([])
      expect(rep.objects).toBe(null)
    }
  })
})

describe('audit P0-2: a window over a weekly read is not thinkorswim’s value', () => {
  it('Average(close(period = WEEK), 10) is flagged "values may differ", never no-known-differences', () => {
    const rep = inspectSource('plot x = Average(close(period = AggregationPeriod.WEEK), 10);', 'thinkscript')
    expect(rep.ok).toBe(true)
    // ⭐ ORDER-INDEPENDENT with PR #590 (the weekly/monthly lift). Before the lift the
    // tree still has the P2 shape, so this module flags "may differ"; after it the
    // translator's own fold note makes the values class "differs". Either way, it is
    // never "exact", never "no known differences", never "the values are the same".
    const r = importVerdict(rep)
    expect([STATE.MAY_DIFFER, STATE.DIFFERS]).toContain(r.classes.values.state)
    expect(r.verdict).toBe(VERDICT.DISCLOSED)
    expect(r.reason).not.toMatch(SAME_VALUES)
  })

  it('a bare weekly read (audit rows 1, 2, 26) is NOT flagged', () => {
    for (const src of [
      'plot x = close(period = AggregationPeriod.WEEK);',
      'plot x = close / close(period = AggregationPeriod.WEEK);',
    ]) {
      const r = v(src, 'thinkscript')
      expect(r.classes.values.notes.some((n) => /daily bars/.test(n.note))).toBe(false)
    }
  })

  it('the shape predicate, on hand trees', () => {
    const c = { type: 'series', name: 'close' }
    const tf = { type: 'tf', value: 'W', args: [c] }
    expect(windowOverPeriodRead({ type: 'call', name: 'sma', args: [tf, { type: 'num', value: 10 }] })).toBe(true)
    expect(windowOverPeriodRead({ type: 'offset', value: 1, args: [tf] })).toBe(true)
    expect(windowOverPeriodRead({ type: 'op', name: '/', args: [c, tf] })).toBe(false)
    // the LIFTED form: the window is inside the read, so nothing fires
    expect(windowOverPeriodRead({ type: 'tf', value: 'W', args: [{ type: 'call', name: 'sma', args: [c, { type: 'num', value: 10 }] }] })).toBe(false)
  })
})

describe('Pine is passed through unchanged (owned by the Pine workstream)', () => {
  it('the verdict, label and reason equal importOutcome’s, byte for byte', () => {
    const scripts = [
      '//@version=5\nindicator("x")\nplot(ta.sma(close, 20))',
      '//@version=5\nindicator("x")\nplot(ta.ema(close, 20), color = close > open ? color.green : color.red)',
    ]
    for (const s of scripts) {
      const rep = inspectSource(s, 'pine')
      const r = importVerdict(rep)
      const o = importOutcome(rep)
      expect(r.decidedBy).toBe('passthrough')
      expect([r.verdict, r.label, r.reason]).toEqual([o.verdict, o.label, o.reason])
    }
    expect(DECIDED_DIALECTS).not.toContain('pine')
  })
})

describe('read-time verdict for a saved definition — computed, never written', () => {
  const deps = { inspect: inspectSource, detect: pcfDetect }
  const deepFreeze = (o) => { Object.values(o).forEach((x) => x && typeof x === 'object' && deepFreeze(x)); return Object.freeze(o) }

  it('a saved TC2000 definition gets its verdict recomputed from its stored source', () => {
    const def = deepFreeze({ compute: { kind: 'ast', source: 'XUP(C, AVGC50)', ast: { type: 'num', value: 1 } }, meta: {} })
    const before = JSON.stringify(def)
    const r = savedImportVerdict(def, deps)
    expect(r.dialect).toBe('pcf')
    expect(r.classes.values.state).toBe(STATE.DIFFERS)
    expect(JSON.stringify(def)).toBe(before) // nothing written (and frozen besides)
  })

  it('a native formula — including a thinkScript paste, which is saved as native text — makes no import claim', () => {
    const def = deepFreeze({ compute: { kind: 'ast', source: "sma(tf(close, 'W'), 10)" }, meta: {} })
    expect(savedImportVerdict(def, deps)).toBe(null)
  })

  it('a Pine-provenance definition is left to Pine', () => {
    const def = deepFreeze({ compute: { kind: 'ast', source: 'C > AVGC50' }, meta: { importedFrom: { dialect: 'pine' } } })
    expect(savedImportVerdict(def, deps)).toBe(null)
  })

  it('anything malformed answers null, never throws', () => {
    expect(savedImportVerdict(null, deps)).toBe(null)
    expect(savedImportVerdict({}, deps)).toBe(null)
    expect(savedImportVerdict({ compute: { source: 'C > AVGC50' } }, { inspect: () => { throw new Error('x') }, detect: () => 'pcf' })).toBe(null)
  })
})
