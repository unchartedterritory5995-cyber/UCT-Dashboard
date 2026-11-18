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
import IndicatorHouseTab, { buildPineCopy, loadHouseSet, ownCopyId } from './IndicatorHouseTab'

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
  it('is the repo\'s script byte for byte, the sha256 the runtime allowlist admits', () => {
    expect(FRED).toBeTruthy()
    expect(FRED.pine).toBe(DOCS)
    expect(FRED.pineSha256).toBe(sha256(FRED.pine))
    const row = allowRows.find((r) => r && r.slug === 'rs-rating-fred6724')
    expect(row && row.sha256).toBe(sha256(FRED.pine))
  })

  it('keeps Fred6724\'s licence notice in the script, and says whose it is', () => {
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

  it('Add to chart saves the member\'s copy under a fresh id, with the script, and puts it on the chart', async () => {
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

  it('a member who already holds an unchanged copy gets that copy: nothing is saved again', async () => {
    const mine = { ...(await buildPineCopy(FRED, 'u_aaaaaaaaaaaa')).doc }
    expect(ownCopyId({ definition: (await buildPineCopy(FRED, 'u_bbbbbbbbbbbb')).doc }, [mine])).toBe('u_aaaaaaaaaaaa')
    const save = vi.fn(async () => ({ ok: true }))
    const onPutOnChart = vi.fn(() => true)
    render(<IndicatorHouseTab styles={styles} load={async () => [FRED]} save={save} listOwn={() => [mine]}
      isOnOffer={() => true} onPutOnChart={onPutOnChart} />)
    await flush()
    await act(async () => { fireEvent.click(screen.getByTestId('house-install')) })
    await flush()
    expect(save).not.toHaveBeenCalled()
    expect(onPutOnChart).toHaveBeenCalledWith('u_aaaaaaaaaaaa')
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
