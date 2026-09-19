// app/src/components/chart/engine/__tests__/volumeNumericPane.test.js
//
// ─── ⭐⭐ ITEM 10 (M1): VOLUME'S NUMERIC PLOTS AS A PANE, BEHIND A GATE ──────
//
// Today a definition the user has overlaid onto the volume pane lands on that
// pane's SHARED LEFT AXIS, autoscaled by everything else overlaid there — so a
// numeric read has no ladder of its own. With the gate on it gets a REAL PANE
// and its own right-hand scale.
//
// ⛔⛔ THE FIRST TEST IS THE ONE THAT MATTERS. A gate that ships off must be
// INVISIBLE, and "invisible" is not a feeling — it is that `resolvePlacement`
// answers byte-for-byte what it answered before the gate existed. That is the
// member-visible assertion; everything else here is about the ON path.
//
// ⚰️ AND THE SPEC IS INCOMPLETE, ON PURPOSE-ISH. The owner's §6 message was
// truncated mid-sentence at "Feature fl…" and the tail never arrived. The gate
// NAME is therefore an assumption; it is declared in
// `docs/frontend_feature_flags.json`, recorded in SESSION-STATE under "Decisions
// taken autonomously", and read in exactly ONE place so a rename is one line.

import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { resolvePlacement, volumeNumericPaneEnabled } from '../placement'
import { __setPaneModeForTest } from '../paneLayout'

const HERE = path.dirname(url.fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..', '..', '..', '..')
const PLACEMENT_SRC = path.resolve(HERE, '..', 'placement.js')
const LEDGER = path.join(REPO, 'docs', 'frontend_feature_flags.json')

/** ⛔ THE GATE NAME IS READ OFF THE SOURCE, NEVER TYPED HERE. A name typed in a
 *  test is the artifact that goes stale first, and a rail whose subject is stale
 *  reads as coverage — this repo's most repeated defect. */
const GATE_NAME = (() => {
  const src = fs.readFileSync(PLACEMENT_SRC, 'utf8')
  const m = /import\.meta\.env\.(VITE_[A-Z0-9_]+)/.exec(src)
  return m ? m[1] : null
})()

const DEF = Object.freeze({
  id: 'uct_volume_numeric',
  placement: Object.freeze({ target: 'volume', scale: Object.freeze({ min: 0, max: 100 }) }),
})

/** The ctx that puts this definition on the volume pane's left axis today. */
const overlayCtx = () => ({
  volSeparatePane: true,
  volOverlaySet: new Set([DEF.id]),
  VOL_PANE_INDEX: 1,
  paneLayout: { panes: [{ key: DEF.id, index: 3, height: 90 }] },
})

const setGate = (v) => { vi.stubEnv(GATE_NAME, v) }

afterEach(() => {
  vi.unstubAllEnvs()
  __setPaneModeForTest(null)
})

describe('⛔⛔ GATE OFF — the member sees exactly what they saw before', () => {
  it('the gate reads OFF when nothing sets it', () => {
    expect(GATE_NAME, 'no VITE_ gate found in placement.js').toBeTruthy()
    expect(volumeNumericPaneEnabled()).toBe(false)
  })

  it('and OFF for every value that is not exactly "1"', () => {
    // ⛔ `=== '1'` is the whole default-off guarantee. A truthiness test would
    // make "0" and "false" turn the feature ON, which is how a dark gate ships lit.
    for (const v of ['0', '', 'false', 'true', 'yes', 'on', '2', ' 1']) {
      setGate(v)
      expect(volumeNumericPaneEnabled(), `${JSON.stringify(v)} must not arm the gate`)
        .toBe(false)
    }
  })

  it('⭐⭐ THE MEMBER-VISIBLE ASSERTION — the overlay answer is unchanged', () => {
    const got = resolvePlacement({}, DEF, overlayCtx())
    expect(got).toEqual({
      paneIndex: 1,
      scaleId: 'left',
      scaleOptions: {
        borderVisible: false,
        visible: true,
        autoScale: true,
        scaleMargins: { top: 0.12, bottom: 0.04 },
      },
      autoscale: 'default',
    })
  })

  it('⛔ and it is still the shared LEFT axis, which is the thing item 10 changes', () => {
    const got = resolvePlacement({}, DEF, overlayCtx())
    expect(got.scaleId).toBe('left')
    expect(got.paneIndex).toBe(1)          // the VOLUME pane, not its own
  })
})

describe('⭐ GATE ON — the numeric plots get their own pane', () => {
  it('skips the overlay and lands on a real pane with its own right scale', () => {
    setGate('1')
    __setPaneModeForTest('panes')
    const got = resolvePlacement({}, DEF, overlayCtx())

    expect(got, 'the layout gave it pane 3, so it must bind').toBeTruthy()
    expect(got.paneIndex).toBe(3)          // its OWN pane, not the volume pane
    expect(got.scaleId).toBe('right')      // its own ladder
    // the definition's fixed range rides through, which is what makes the
    // ladder readable rather than autoscaled against its neighbours
    expect(got.scaleOptions.autoScale).toBe(false)
    expect(got.scaleOptions.minimum).toBe(0)
    expect(got.scaleOptions.maximum).toBe(100)
  })

  it('⛔ FAILS CLOSED when the layout gave it no pane', () => {
    // A definition that is on but has no pane must bind NOTHING rather than land
    // in pane 0 on a zero-margin scale and paint over the candles.
    setGate('1')
    __setPaneModeForTest('panes')
    const ctx = { ...overlayCtx(), paneLayout: { panes: [] } }
    expect(resolvePlacement({}, DEF, ctx)).toBeNull()
  })

  it('⭐ THE CONTROL — on and off give DIFFERENT answers on one input', () => {
    // Without this, both tests above could be passing on the same code path and
    // the gate would be doing nothing at all.
    __setPaneModeForTest('panes')
    const ctx = overlayCtx()
    const off = resolvePlacement({}, DEF, ctx)
    setGate('1')
    const on = resolvePlacement({}, DEF, ctx)
    expect(off).not.toEqual(on)
    expect(off.scaleId).toBe('left')
    expect(on.scaleId).toBe('right')
  })

  it('⚠️ a definition NOT overlaid onto volume is untouched either way', () => {
    // The gate sits on ONE branch. A plain pane oscillator must resolve the same
    // with the gate on as with it off — otherwise the blast radius is the whole
    // chart rather than the one behaviour item 10 names.
    __setPaneModeForTest('panes')
    const plain = { ...DEF, placement: { target: 'pane', scale: { min: 0, max: 100 } } }
    const ctx = { ...overlayCtx(), volOverlaySet: new Set() }
    const off = resolvePlacement({}, plain, ctx)
    setGate('1')
    const on = resolvePlacement({}, plain, ctx)
    expect(on).toEqual(off)
    expect(on.paneIndex).toBe(3)
  })
})

describe('⛔ THE GATE IS DECLARED', () => {
  const ledger = () => JSON.parse(fs.readFileSync(LEDGER, 'utf8'))

  it('has an entry, with a status and a reason', () => {
    const e = ledger().flags[GATE_NAME]
    expect(e, `${GATE_NAME} is not declared in docs/frontend_feature_flags.json`).toBeTruthy()
    expect(['armed', 'dark', 'pending']).toContain(e.status)
    expect((e.note || '').trim().length, 'a bare status is the ambiguity a ledger removes')
      .toBeGreaterThanOrEqual(20)
    if (e.status === 'pending') expect(e.since).toBeTruthy()
  })

  it('⭐ and the declaration names the file that actually reads it', () => {
    // A ledger that describes a gate nobody reads is fiction — the backend rail
    // has a whole test for that shape. This is its frontend half.
    const e = ledger().flags[GATE_NAME]
    expect(Array.isArray(e.readBy) && e.readBy.length).toBeTruthy()
    for (const where of e.readBy) {
      const file = path.join(REPO, where.split('::')[0])
      expect(fs.existsSync(file), `${where} does not exist`).toBe(true)
      expect(fs.readFileSync(file, 'utf8')).toContain(GATE_NAME)
    }
  })

  it('⛔ THE R6 CONTROL — the ledger check can FAIL', () => {
    // Without this, a lookup that returned something for every name would pass
    // the tests above and declare nothing.
    expect(ledger().flags.VITE_A_GATE_NOBODY_DECLARED).toBeUndefined()
  })
})
