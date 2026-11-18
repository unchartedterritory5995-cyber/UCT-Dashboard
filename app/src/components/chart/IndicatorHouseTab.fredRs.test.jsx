// ─── ⭐⭐ FRED RS — Fred6724's RS Rating as a UCT house indicator (2026-11-18, owner) ───
//
// The entry (`house/housePineIndicators.json`) ships the script BYTE FOR BYTE: it is held here to the repo's
// copy (`docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine`) and to the runtime allowlist's sha256, so the
// member's copy is the same script every TradingView parity capture, the run-half evidence and the admission
// are keyed to. Its licence notice (MPL-2.0, © Fred6724) is in the script and goes with every copy.
// Adding it builds the copy through the real Create Indicator builder (`memberPaneDefinition`), stamped and
// validated as a pasted script is, and saves the script beside it.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import PINE from './house/housePineIndicators.json'
import HOUSE from './house/houseIndicators.json'
import * as registry from './engine/nativeRegistry'
import { SCRIPT_ENGINE_VERSION } from './engine/scriptEngineVersion'
import VERSIONS from './house/houseVersions.json'
import IndicatorHouseTab, { buildPineCopy, loadHouseSet, ownScriptCopyId, PINE_PROBE_MAX } from './IndicatorHouseTab'

const REPO = path.resolve(process.cwd(), '..')
const styles = new Proxy({}, { get: (_t, k) => String(k) })
const FRED = PINE.indicators.find((i) => i.slug === 'fred-rs')
const DOCS = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8').replace(/\r\n/g, '\n')
const ALLOW = JSON.parse(fs.readFileSync(path.join(REPO, 'api/data/pine_runtime_allowlist.json'), 'utf8'))
const allowRows = Array.isArray(ALLOW) ? ALLOW : (ALLOW.entries || ALLOW.allow || ALLOW.scripts || [])
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')
const flush = async () => { await act(async () => {}) }

afterEach(() => { cleanup(); registry.clearUserDefinitions(); vi.restoreAllMocks() })

describe('the entry', () => {
  it("is the repo\'s script byte for byte, the sha256 the runtime allowlist admits", () => {
    expect(FRED).toBeTruthy()
    expect(FRED.pine).toBe(DOCS)
    expect(FRED.pineSha256).toBe(sha256(FRED.pine))
    const row = allowRows.find((r) => r && r.slug === 'rs-rating-fred6724')
    expect(row && row.sha256).toBe(sha256(FRED.pine))
  })

  it("keeps Fred6724\'s licence notice in the script, and says whose it is", () => {
    expect(FRED.pine).toContain('This source code is subject to the terms of the Mozilla Public License 2.0')
    expect(FRED.pine).toContain('© Fred6724')
    expect(FRED.attribution).toMatch(/Fred6724/)
    expect(FRED.attribution).toMatch(/Mozilla Public License 2\.0/)
  })

  it('is named "Fred RS", with a one-sentence summary in a member\'s words, and no formula entry shares its name', () => {
    expect(FRED.name).toBe('Fred RS')
    expect(FRED.summary.length).toBeGreaterThan(20)
    expect(FRED.summary.length).toBeLessThanOrEqual(140)
    expect(FRED.summary).not.toMatch(/\b(Valid|Verified|Converted|Supported)\b/)
    expect(HOUSE.indicators.map((i) => i.name)).not.toContain(FRED.name)
    expect(HOUSE.indicators.map((i) => i.slug)).not.toContain(FRED.slug)
  })

  it("houseVersions.json lists it by its SCRIPT: the last version is the script shipped, under the entry's version", () => {
    const list = VERSIONS.pine && VERSIONS.pine[FRED.slug]
    expect(Array.isArray(list) && list.length).toBeTruthy()
    const last = list[list.length - 1]
    expect(last.script).toBe(`sha256:${sha256(FRED.pine)}`)
    expect(last.version).toBe(FRED.version)
    // THE RULE in the script's own terms: one version, one script, never rewritten
    const seen = new Map()
    for (const v of list) {
      expect(Number.isInteger(v.version)).toBe(true)
      if (seen.has(v.version)) expect(v.script).toBe(seen.get(v.version))
      seen.set(v.version, v.script)
      expect(String(v.why || '').length).toBeGreaterThan(5)
    }
    expect(Object.keys(VERSIONS.indicators)).not.toContain(FRED.slug) // patrick-0b's rail owns `indicators`
  })

  it('the tab loads it first, ahead of the formula set', async () => {
    const all = await loadHouseSet()
    expect(all[0].slug).toBe('fred-rs')
    expect(all.length).toBe(PINE.indicators.length + HOUSE.indicators.length)
  })
})

describe('the copy, built by the real Create Indicator builder', () => {
  it('is named Fred RS, stamped with this engine, valid, and saved WITH the script', async () => {
    const built = await buildPineCopy(FRED, 'u_0123456789ab')
    expect(built.error).toBeUndefined()
    const doc = built.doc
    expect(doc.id).toBe('u_0123456789ab')
    expect(doc.meta.name).toBe('Fred RS')
    expect(doc.meta.repaint).toBe('non-repainting')
    expect(doc.compute.kind).toBe('ast')
    expect(doc.meta.engineVersion).toBe(SCRIPT_ENGINE_VERSION)
    expect(built.options).toEqual({ pineSource: FRED.pine })
    const { defs, errors } = registry.validateUserDefinitions([doc])
    expect(errors).toEqual([])
    expect(defs).toHaveLength(1)
  })

  it("Add to chart saves the member\'s copy under a fresh id, with the script, and puts it on the chart", async () => {
    const save = vi.fn(async (def) => ({ ok: true, row: { def_id: def.id } }))
    const onPutOnChart = vi.fn(() => true)
    render(<IndicatorHouseTab styles={styles} load={async () => [FRED]} save={save}
      isOnOffer={() => true} onPutOnChart={onPutOnChart} />)
    await flush()
    expect(screen.getByTestId('house-attribution')).toHaveTextContent('Fred6724')
    await act(async () => { fireEvent.click(screen.getByTestId('house-install')) })
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
    const [doc, defId, telemetry, options] = save.mock.calls[0]
    expect(defId).toBeNull()
    expect(telemetry).toBeNull()
    expect(doc.id).toMatch(/^u_[0-9a-f]{12}$/)
    expect(doc.meta.name).toBe('Fred RS')
    expect(options).toEqual({ pineSource: FRED.pine })
    expect(onPutOnChart).toHaveBeenCalledWith(doc.id)
  })

  it("a member's copy whose stored SCRIPT is this one, byte for byte, is reused: nothing is saved again", async () => {
    const mine = (await buildPineCopy(FRED, 'u_aaaaaaaaaaaa')).doc
    const fetchScript = vi.fn(async (id) => (id === 'u_aaaaaaaaaaaa' ? FRED.pine : null))
    const save = vi.fn(async () => ({ ok: true }))
    const onPutOnChart = vi.fn(() => true)
    render(<IndicatorHouseTab styles={styles} load={async () => [FRED]} save={save} listOwn={() => [mine]}
      fetchScript={fetchScript} isOnOffer={() => true} onPutOnChart={onPutOnChart} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByTestId('house-install')) })
    await flush()
    expect(fetchScript).toHaveBeenCalledWith('u_aaaaaaaaaaaa')
    expect(save).not.toHaveBeenCalled()
    expect(onPutOnChart).toHaveBeenCalledWith('u_aaaaaaaaaaaa')
  })

  it("a copy with the SAME maths but other script bytes is the member's own: adding makes a fresh copy", async () => {
    const mine = (await buildPineCopy(FRED, 'u_aaaaaaaaaaaa')).doc
    const edited = FRED.pine.replace('// RaviYendru thank you for providing the intial script', '// an edited line')
    expect(edited).not.toBe(FRED.pine)
    const save = vi.fn(async (def) => ({ ok: true, row: { def_id: def.id } }))
    render(<IndicatorHouseTab styles={styles} load={async () => [FRED]} save={save} listOwn={() => [mine]}
      fetchScript={async () => edited} isOnOffer={() => true} onPutOnChart={() => true} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByTestId('house-install')) })
    await flush()
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].id).not.toBe('u_aaaaaaaaaaaa')
  })

  it('a store that cannot answer reuses nothing (a second copy is harmless, a wrong one is not)', async () => {
    const mine = (await buildPineCopy(FRED, 'u_aaaaaaaaaaaa')).doc
    expect(await ownScriptCopyId(FRED, mine, [mine], async () => null)).toBeNull()
  })

  it('the cap cuts the WEAKEST guesses: six reads-only candidates listed first never crowd out the true copy', async () => {
    const real = { ...(await buildPineCopy(FRED, 'u_aaaaaaaaaaaa')).doc }
    // six other script documents that read the same symbols (SPX, the seed) but are different scripts
    const readsOnly = Array.from({ length: PINE_PROBE_MAX + 1 }, (_, i) => ({
      ...real, id: `u_${String(i).padStart(12, '0')}`,
      compute: { ...real.compute, fn: `sha256:other${i}`, treesHash: `sha256:othertrees${i}` },
      meta: { ...real.meta, name: `Another SPX script ${i}` },
    }))
    const asked = []
    const fetchScript = async (id) => { asked.push(id); return id === 'u_aaaaaaaaaaaa' ? FRED.pine : 'other script' }
    expect(await ownScriptCopyId(FRED, real, [...readsOnly, real], fetchScript)).toBe('u_aaaaaaaaaaaa')
    expect(asked[0]).toBe('u_aaaaaaaaaaaa') // the same-maths copy is asked about first
  })

  it("one press asks the store about at most PINE_PROBE_MAX of the member's documents, and only script documents", async () => {
    const mine = (await buildPineCopy(FRED, 'u_aaaaaaaaaaaa')).doc
    const many = Array.from({ length: PINE_PROBE_MAX + 4 }, (_, i) => ({ ...mine, id: `u_${String(i).padStart(12, '0')}` }))
    const formulaOnly = { ...mine, id: 'u_ffffffffffff', meta: { ...mine.meta, engineVersion: undefined } }
    const handEdited = { ...mine, id: 'u_eeeeeeeeeeee', meta: { ...mine.meta, scriptEdited: true } }
    const asked = []
    expect(await ownScriptCopyId(FRED, mine, [formulaOnly, handEdited, ...many], async (id) => { asked.push(id); return null })).toBeNull()
    expect(asked.length).toBe(PINE_PROBE_MAX)
    expect(asked).not.toContain('u_ffffffffffff')
    expect(asked).not.toContain('u_eeeeeeeeeeee')
  })

  it('a copy that cannot be prepared says so, saves nothing and can be tried again', async () => {
    const save = vi.fn(async () => ({ ok: true }))
    render(<IndicatorHouseTab styles={styles} load={async () => [FRED]} save={save}
      buildPine={async () => ({ error: 'It could not be prepared just now. Try again.' })} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByTestId('house-install')) })
    await flush()
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByTestId('house-install-error')).toHaveTextContent('could not be prepared')
    expect(screen.getByTestId('house-install')).not.toBeDisabled()
  })
})
