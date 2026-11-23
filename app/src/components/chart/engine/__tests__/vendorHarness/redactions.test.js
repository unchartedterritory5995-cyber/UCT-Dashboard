// app/src/components/chart/engine/__tests__/vendorHarness/redactions.test.js
//
// ─── ⛔⛔ TRADINGVIEW'S COMPILED SCRIPT NEVER ENTERS THIS PUBLIC REPO (coordinator ruling 2026-11-23) ───────────────
// A capture's hidden `ILScript` input is TradingView's encrypted compiled form of the script. Committed captures carry it
// REDACTED and re-sealed by `tools/vendor_harness/redact_capture.mjs`, with a `redactions` note
// (`schema.mjs::verifyRedactions`). These rails prove: (1) a redacted capture validates only THROUGH its note; (2) the note
// may name only that field; (3) the note is checked against the original receipt's length, so an edit elsewhere hidden
// inside a re-seal fails; (4) no committed fixture carries the compiled script in the clear; (5) no grade reads it.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { loadCapture } from './harness'

import {
  carriesCompiledScript, REDACTED_COMPILED_SCRIPT, sealCapture, validateCapture, verifyRedactions,
} from '../../../../../../../tools/vendor_harness/schema.mjs'
import { redactCapture } from '../../../../../../../tools/vendor_harness/redact_capture.mjs'
import { nonDefaultInputs } from '../../../../../../../tools/vendor_harness/compare.mjs'

const FIXTURES = path.resolve(process.cwd(), '..', 'tests/fixtures')
const BLOB = 'bmI9Ks46_' + 'A'.repeat(500) + '=='  // a stand-in: never a real compiled script

/** A minimal sealed capture carrying a compiled-script input in the clear. */
function clearCapture() {
  return sealCapture({
    schema: 'x', id: 'redaction-rail', study: { inputs: [
      { id: 'text', name: 'ILScript', type: 'text', defval: '', isHidden: true, value: BLOB },
      { id: 'in_0', name: 'Length', type: 'integer', defval: 14, value: 14 },
    ] },
    plotValues: { fields: ['time', 'plot_0'], rows: [[1, 1.5], [2, 2.25]] },
  })
}
const reseal = (c) => { const { receipt, ...b } = c; return sealCapture(b) }

describe('the redaction note is the only way a re-sealed capture verifies', () => {
  it('a redacted capture verifies, and carries the value nowhere', () => {
    const r = redactCapture(clearCapture(), { at: '2026-11-23T08:00:00Z' })
    expect(r.changed).toBe(true)
    expect(verifyRedactions(r.capture)).toEqual({ ok: true, reason: null })
    expect(JSON.stringify(r.capture)).not.toContain(BLOB)
    expect(r.capture.study.inputs[0].value).toBe(REDACTED_COMPILED_SCRIPT)
    expect(carriesCompiledScript(r.capture)).toBe(false)
    expect(r.capture.redactions[0]).toMatchObject({ field: 'study.inputs[name=ILScript].value', index: 0, originalChars: BLOB.length })
  })

  it('⛔ CONTROL: a capture with the marker and NO note fails (an unexplained re-seal)', () => {
    const r = redactCapture(clearCapture(), { at: '2026-11-23T08:00:00Z' })
    const { redactions, ...noNote } = r.capture
    expect(verifyRedactions(reseal(noNote)).ok).toBe(false)
    expect(verifyRedactions(reseal(noNote)).reason).toMatch(/unexplained re-seal/)
  })

  it('⛔ CONTROL: a note naming any other field fails', () => {
    const r = redactCapture(clearCapture(), { at: '2026-11-23T08:00:00Z' })
    const c = reseal({ ...r.capture, redactions: [{ ...r.capture.redactions[0], field: 'plotValues.rows' }] })
    expect(verifyRedactions(c).reason).toMatch(/no other field may be redacted/)
  })

  it('⛔ CONTROL: an edit elsewhere, hidden inside a re-seal with a valid-looking note, fails on the original length', () => {
    const r = redactCapture(clearCapture(), { at: '2026-11-23T08:00:00Z' })
    const edited = JSON.parse(JSON.stringify(r.capture))
    edited.plotValues.rows[1][1] = 2.5                      // 2.25 -> 2.5: a different value, a different length
    expect(verifyRedactions(reseal(edited)).reason).toMatch(/does not account for the change/)
  })

  it('⛔ CONTROL: a note whose count, tool or original receipt is wrong fails', () => {
    const r = redactCapture(clearCapture(), { at: '2026-11-23T08:00:00Z' })
    const n = r.capture.redactions[0]
    expect(verifyRedactions(reseal({ ...r.capture, redactions: [n, n] })).ok).toBe(false)
    expect(verifyRedactions(reseal({ ...r.capture, redactions: [{ ...n, by: 'by hand' }] })).ok).toBe(false)
    expect(verifyRedactions(reseal({ ...r.capture, redactions: [{ ...n, originalChars: n.originalChars + 1 }] })).ok).toBe(false)
    expect(verifyRedactions(reseal({ ...r.capture, redactions: [{ ...n, originalReceipt: { ...n.originalReceipt, fnv1a: 'x' } }] })).ok).toBe(false)
  })

  it('the compiled script in BOTH value and defval (352 committed captures): both redacted, two notes, verifies', () => {
    const c = clearCapture(); c.study.inputs[0].defval = BLOB
    const r = redactCapture(reseal(c), { at: '2026-11-23T08:00:00Z' })
    expect(r.changed).toBe(true)
    expect(JSON.stringify(r.capture)).not.toContain(BLOB)
    expect(r.capture.redactions.map((n) => n.field)).toEqual(['study.inputs[name=ILScript].value', 'study.inputs[name=ILScript].defval'])
    expect(verifyRedactions(r.capture)).toEqual({ ok: true, reason: null })
    // ⛔ CONTROL: drop the defval note and the capture no longer verifies
    expect(verifyRedactions(reseal({ ...r.capture, redactions: [r.capture.redactions[0]] })).ok).toBe(false)
    expect(carriesCompiledScript({ study: { inputs: [{ name: 'ILScript', value: '', defval: BLOB }] } })).toBe(true)
  })

  it('the tool refuses a capture whose own receipt does not verify, and leaves a clean capture alone', () => {
    const broken = { ...clearCapture() }; broken.receipt = { ...broken.receipt, fnv1a: 1 }
    expect(redactCapture(broken).refused).toMatch(/never re-sealed/)
    const clean = redactCapture(clearCapture(), { at: '2026-11-23T08:00:00Z' }).capture
    expect(redactCapture(clean)).toEqual({ capture: clean, changed: false })
  })

  it('⛔ the FILE boundary: loadCapture refuses a file whose redaction does not verify, and loads one that does', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redact-'))
    const ok = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'vendor/harness/atr-trailing-stoploss-rddt-1d-2026-09-27.json'), 'utf8'))
    expect(ok.redactions, 'this fixture is one of the redacted corpus').toBeTruthy()
    fs.writeFileSync(path.join(dir, 'ok.json'), JSON.stringify(ok, null, 1) + '\n')
    expect(loadCapture(path.join(dir, 'ok.json')).capture).toBeTruthy()
    const { redactions, ...noNote } = ok
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify(reseal(noNote), null, 1) + '\n')
    const bad = loadCapture(path.join(dir, 'bad.json'))
    expect(bad.capture).toBeUndefined()
    expect(bad.reason).toMatch(/^redactions: .*unexplained re-seal/)
    // ⭐ an IN-MEMORY perturbation (a test's own control) is not a file: validateCapture does not hold it to the receipt
    const perturbed = JSON.parse(JSON.stringify(ok)); perturbed.plotValues.rows[0][1] = 12345.678
    expect(validateCapture(reseal(perturbed)).errors.filter((e) => /redactions/.test(e))).toEqual([])
  })

  it('no grade reads the compiled script: it is not a member-visible input', () => {
    const c = clearCapture(); c.study.inputs[0].value = 'changed'
    expect(nonDefaultInputs(c).map((i) => i.name)).not.toContain('ILScript')
  })
})

describe('⛔⛔ no committed fixture carries TradingView\'s compiled script in the clear', () => {
  it('every JSON under tests/fixtures: ILScript redacted (or absent), and every redacted one verifies', () => {
    const clear = []; const bad = []; let redacted = 0
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!e.name.endsWith('.json')) continue
        const text = fs.readFileSync(p, 'utf8')
        if (!text.includes('ILScript')) continue
        let c; try { c = JSON.parse(text) } catch { continue }
        if (carriesCompiledScript(c)) clear.push(path.relative(FIXTURES, p))
        else if (c && c.redactions) { redacted += 1; const v = verifyRedactions(c); if (!v.ok) bad.push(`${path.relative(FIXTURES, p)}: ${v.reason}`) }
      }
    }
    walk(FIXTURES)
    expect(clear, `run: node tools/vendor_harness/redact_capture.mjs <file>\n${clear.slice(0, 20).join('\n')}`).toEqual([])
    expect(bad).toEqual([])
    expect(redacted, 'non-vacuity: the committed corpus carries redacted captures').toBeGreaterThan(900)
  })
})
