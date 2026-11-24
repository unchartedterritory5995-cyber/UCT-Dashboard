// app/src/components/chart/engine/__tests__/vendorHarness/builtinSource.test.js
//
// ⭐⭐ e95 (unit 2, ruling F1) — a hand-added built-in is graded on its published source, held locally at the census
// population's pin, never committed; a row graded on it is stamped `sourceHeld` and named "source-held" where the
// source is not held. Also: TradingView numbers a declaration's `timeframe =` pair after the script's own inputs.
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { builtinStudyOf, heldBuiltinSourceOf, builtinSourceStorePins, __setBuiltinPinsForTests, BUILTIN_SOURCE_ENV } from './builtinSource.js'
import { sourceHeldOf, heldReading, heldHolds, heldPinsOf } from './storeHeld.js'
import { captureInstanceInputs } from './captureInputs.js'

const TEXT = '//@version=6\nindicator("test built-in")\nplot(close)\n'
const SHA = crypto.createHash('sha256').update(Buffer.from(TEXT, 'utf8')).digest('hex')
const LABEL = 'TradingView built-in STD;Test added from the Indicators dialog, not Pine.'
const cap = (text = LABEL, id = 'Script$STD;Test@tv-scripting') => ({ study: { id }, source: { text } })
let dir = null

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e95-builtin-'))
  process.env[BUILTIN_SOURCE_ENV] = dir
  __setBuiltinPinsForTests({ 'STD;Test': SHA })
})
afterEach(() => {
  delete process.env[BUILTIN_SOURCE_ENV]
  __setBuiltinPinsForTests(null)
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('a hand-added built-in is run on its held published source', () => {
  it('names the built-in only when the capture holds no Pine', () => {
    expect(builtinStudyOf(cap())).toBe('STD;Test')
    expect(builtinStudyOf(cap(TEXT))).toBeNull()                     // a pasted script grades on its own text
    expect(builtinStudyOf(cap(LABEL, 'Script$PUB;abc@tv-scripting'))).toBeNull()
  })
  it('the held file at the pin is the source; no file, or other bytes, is not', () => {
    expect(heldBuiltinSourceOf(cap())).toMatchObject({ id: 'STD;Test', sha256: SHA, why: expect.stringMatching(/no held source/) })
    fs.writeFileSync(path.join(dir, 'STD;Test.pine'), `${TEXT}// edited\n`)
    expect(heldBuiltinSourceOf(cap())).toMatchObject({ why: expect.stringMatching(/not the pinned source/) })
    expect(builtinSourceStorePins()).toEqual([])
    fs.writeFileSync(path.join(dir, 'STD;Test.pine'), TEXT)
    expect(heldBuiltinSourceOf(cap())).toMatchObject({ id: 'STD;Test', sha256: SHA, text: TEXT })
    expect(builtinSourceStorePins()).toEqual([{ id: 'STD;Test', sha256: SHA }])
  })
  it('the row is stamped whether or not this run holds the source, and is named "source-held" where it does not', () => {
    const pins = sourceHeldOf(cap())
    expect(pins).toEqual([`source/STD;Test@${SHA}`])
    expect(heldHolds(pins)).toBe(false)
    expect(heldReading(pins)).toBe(`source-held: source/STD;Test@${SHA}`)
    expect(heldPinsOf({ sourceHeld: pins })).toEqual(pins)
    fs.writeFileSync(path.join(dir, 'STD;Test.pine'), TEXT)
    expect(heldHolds(pins)).toBe(true)
  })
})

describe('a declaration\'s timeframe= pair is TradingView\'s two trailing inputs', () => {
  const SRC = '//@version=6\nindicator("t", timeframe = "", timeframe_gaps = true)\nlen = input.int(14, "Length")\nplot(ta.sma(close, len))\n'
  const DEF = { inputs: [{ key: 'len', type: 'int' }] }
  const study = (tfValue = '') => ({ study: { id: 'x', inputs: [
    { id: 'in_0', name: 'Length', type: 'integer', defval: 14, value: 20 },
    { id: 'in_1', name: 'Timeframe', type: 'resolution', defval: '', value: tfValue },
    { id: 'in_2', name: 'Wait for timeframe closes', type: 'bool', defval: true, value: true },
  ] }, source: { text: SRC } })
  it('at their defaults they are dropped, and the script\'s own setting is read', () => {
    expect(captureInstanceInputs(study(), DEF)).toMatchObject({ ok: true, inputs: { len: 20 } })
  })
  it('⛔ moved, our side cannot set them: refused by name', () => {
    expect(captureInstanceInputs(study('60'), DEF)).toMatchObject({ ok: false, why: expect.stringMatching(/declaration's timeframe setting/) })
  })
  it('⛔ without `timeframe =` in the declaration the counts still disagree (a control)', () => {
    const c = study()
    c.source.text = SRC.replace(', timeframe = "", timeframe_gaps = true', '')
    expect(captureInstanceInputs(c, DEF)).toMatchObject({ ok: false, why: expect.stringMatching(/records 3 inputs and the script binds 1/) })
  })
  it('the settings are numbered on the source our side RAN, not the capture\'s label', () => {
    const c = study()
    c.source.text = LABEL
    expect(captureInstanceInputs(c, DEF).ok).toBe(false)
    expect(captureInstanceInputs(c, DEF, SRC)).toMatchObject({ ok: true, inputs: { len: 20 } })
  })
})
