import { describe, it, expect } from 'vitest'
import {
  migrateLegacyToInstances,
  legacyInstanceId,
  LEGACY_ID_PREFIX,
  validateInstance,
  normalizeInstances,
} from './instances'
import { getDefinition, listDefinitions } from './nativeRegistry'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from '../chartDefaults'
import { BLOB_FIXTURES } from './__fixtures__'

// A raw (un-merged) legacy blob: exactly the keys a caller wrote, nothing else.
// The migrator must cope with these as well as with fully-merged ones, because
// `user_preferences` holds whatever the client of the day serialised.
const raw = (indicators, rest = {}) => ({ indicators, ...rest })

const ids = (list) => list.map(i => i.instanceId)
const byId = (list, id) => list.find(i => i.instanceId === id)

describe('migrateLegacyToInstances', () => {
  it('emits nothing when every indicator is disabled — the shipped default', () => {
    expect(migrateLegacyToInstances(CHART_DEFAULTS)).toEqual([])
  })

  it('a disabled indicator produces no instance', () => {
    const out = migrateLegacyToInstances(raw({
      rsi: { enabled: false, period: 14, color: '#7b68ee' },
      macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    }))
    expect(ids(out)).toEqual(['legacy:macd'])
  })

  it('RSI enabled with period 7 produces exactly ONE instance carrying period 7', () => {
    const out = migrateLegacyToInstances(raw({ rsi: { enabled: true, period: 7, color: '#7b68ee' } }))
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      instanceId: 'legacy:rsi',
      defId: 'rsi',
      defVersion: getDefinition('rsi').version,
      inputs: { period: 7, color: '#7b68ee' },
      placement: { target: 'pane' },
      hidden: false,
    })
  })

  it('the instanceId is deterministic, prefixed, and derived only from the defId', () => {
    expect(legacyInstanceId('rsi')).toBe(`${LEGACY_ID_PREFIX}rsi`)
    const a = migrateLegacyToInstances(raw({ rsi: { enabled: true, period: 7 } }))
    const b = migrateLegacyToInstances(raw({ rsi: { enabled: true, period: 21 } }))
    expect(ids(a)).toEqual(ids(b))
  })

  it('is IDEMPOTENT — feeding its own output back adds nothing', () => {
    const cs = raw({
      rsi: { enabled: true, period: 7 },
      macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    })
    const once = migrateLegacyToInstances(cs)
    const twice = migrateLegacyToInstances({ ...cs, indicatorInstances: once })
    expect(twice).toEqual(once)
    const thrice = migrateLegacyToInstances({ ...cs, indicatorInstances: twice })
    expect(thrice).toEqual(once)
  })

  it('never CLOBBERS an already-migrated instance the user has since edited', () => {
    const cs = raw({ rsi: { enabled: true, period: 7, color: '#7b68ee' } })
    const edited = migrateLegacyToInstances(cs).map(i => ({ ...i, inputs: { ...i.inputs, period: 50 }, hidden: true }))
    const again = migrateLegacyToInstances({ ...cs, indicatorInstances: edited })
    expect(again).toEqual(edited)
    expect(byId(again, 'legacy:rsi').inputs.period).toBe(50)
  })

  it('carries only DECLARED input keys — a field no definition declares is dropped', () => {
    const out = migrateLegacyToInstances(raw({
      vwap: { enabled: true, color: '#26C6DA', showBands: true, legacyJunk: 1 },
    }))
    expect(out[0].inputs).toEqual({ color: '#26C6DA' })
  })

  it('never carries `enabled` into inputs — existence IS enabled', () => {
    const out = migrateLegacyToInstances(raw({ atr: { enabled: true, period: 14, color: '#FFA726' } }))
    expect(out[0].inputs).not.toHaveProperty('enabled')
  })

  it('DOES NOT fold in overlays — the MA slots keep their positional identity', () => {
    const overlays = CHART_DEFAULTS.overlays.map(o => ({ ...o }))
    const cs = raw({ rsi: { enabled: true, period: 14 } }, { overlays })
    const out = migrateLegacyToInstances(cs)
    expect(ids(out)).toEqual(['legacy:rsi'])
    expect(out.some(i => /ema|sma|overlay/i.test(i.defId))).toBe(false)
    // and the array itself is untouched, element for element
    expect(cs.overlays).toEqual(CHART_DEFAULTS.overlays)
  })

  it('is PURE — it does not mutate the blob it reads', () => {
    const cs = raw(
      { rsi: { enabled: true, period: 7 } },
      { overlays: CHART_DEFAULTS.overlays.map(o => ({ ...o })), indicatorInstances: [] },
    )
    const snapshot = JSON.stringify(cs)
    migrateLegacyToInstances(cs)
    expect(JSON.stringify(cs)).toBe(snapshot)
  })

  it('skips volumeProfile — a canvas overlay with no definition cannot be migrated', () => {
    const out = migrateLegacyToInstances(raw({
      volumeProfile: { enabled: true, bins: 48 },
      rsi: { enabled: true, period: 14 },
    }))
    expect(ids(out)).toEqual(['legacy:rsi'])
  })

  it('placement mirrors the definition target', () => {
    const out = migrateLegacyToInstances(raw({
      rsi: { enabled: true, period: 14 },
      bb: { enabled: true, period: 20, stdDev: 2 },
    }))
    expect(byId(out, 'legacy:rsi').placement).toEqual({ target: 'pane' })
    expect(byId(out, 'legacy:bb').placement).toEqual({ target: 'price' })
  })

  it('volumeOverlayIndicators moves a PANE oscillator onto the volume pane', () => {
    const out = migrateLegacyToInstances(raw(
      { rsi: { enabled: true, period: 14 }, mfi: { enabled: true, period: 14 } },
      { volumeOverlayIndicators: ['mfi'] },
    ))
    expect(byId(out, 'legacy:mfi').placement).toEqual({ target: 'volume' })
    expect(byId(out, 'legacy:rsi').placement).toEqual({ target: 'pane' })
  })

  it('volumeOverlayIndicators never moves a PRICE overlay — the toolbar cannot produce that', () => {
    const out = migrateLegacyToInstances(raw(
      { bb: { enabled: true, period: 20 } },
      { volumeOverlayIndicators: ['bb'] },
    ))
    expect(byId(out, 'legacy:bb').placement).toEqual({ target: 'price' })
  })

  it('orders by REGISTRY order, not by the blob\'s key order', () => {
    const forwards = migrateLegacyToInstances(raw({
      rsi: { enabled: true }, macd: { enabled: true }, obv: { enabled: true },
    }))
    const backwards = migrateLegacyToInstances(raw({
      obv: { enabled: true }, macd: { enabled: true }, rsi: { enabled: true },
    }))
    expect(ids(forwards)).toEqual(['legacy:rsi', 'legacy:macd', 'legacy:obv'])
    expect(ids(backwards)).toEqual(ids(forwards))
  })

  it('tolerates a missing, null or non-object indicators section', () => {
    expect(migrateLegacyToInstances({})).toEqual([])
    expect(migrateLegacyToInstances({ indicators: null })).toEqual([])
    expect(migrateLegacyToInstances({ indicators: 'nope' })).toEqual([])
    expect(migrateLegacyToInstances(null)).toEqual([])
    expect(migrateLegacyToInstances(undefined)).toEqual([])
  })

  it('every instance it emits passes validation', () => {
    const cs = { ...CHART_DEFAULTS, indicators: Object.fromEntries(
      Object.entries(CHART_DEFAULTS.indicators).map(([k, v]) => [k, { ...v, enabled: true }]),
    ) }
    const out = migrateLegacyToInstances(cs)
    // 14 definitions; volumeProfile is the 15th legacy key and has none.
    expect(out).toHaveLength(listDefinitions().length)
    const { kept, dropped } = normalizeInstances(out)
    expect(dropped).toEqual([])
    expect(kept).toHaveLength(out.length)
  })
})

describe('validateInstance', () => {
  const good = () => ({
    instanceId: 'legacy:rsi',
    defId: 'rsi',
    defVersion: 1,
    inputs: { period: 14, color: '#7b68ee' },
    placement: { target: 'pane' },
    hidden: false,
  })

  it('accepts a well-formed instance', () => {
    const r = validateInstance(good())
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })

  it('rejects a missing instanceId', () => {
    const i = good(); delete i.instanceId
    const r = validateInstance(i)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/instanceId/)
  })

  it('rejects a blank instanceId', () => {
    const i = good(); i.instanceId = '   '
    expect(validateInstance(i).ok).toBe(false)
  })

  it('rejects a DUPLICATE instanceId when the caller supplies the seen set', () => {
    const seenIds = new Set(['legacy:rsi'])
    const r = validateInstance(good(), undefined, { seenIds })
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/duplicate/i)
    // …and is silent about duplicates without that context, because one
    // instance on its own cannot know about another.
    expect(validateInstance(good()).ok).toBe(true)
  })

  it('rejects an unknown defId', () => {
    const i = good(); i.defId = 'hologram'
    const r = validateInstance(i)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/hologram/)
  })

  it('rejects an input BELOW the declared min', () => {
    const i = good(); i.inputs.period = 1     // rsi period min is 2
    const r = validateInstance(i)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/min/)
  })

  it('rejects an input ABOVE the declared max', () => {
    const i = good(); i.inputs.period = 5000  // rsi period max is 100
    const r = validateInstance(i)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/max/)
  })

  it('rejects an input of the wrong TYPE — never coerces it', () => {
    const asString = good(); asString.inputs.period = '14'
    expect(validateInstance(asString).ok).toBe(false)

    const asFloat = good(); asFloat.inputs.period = 14.5   // declared int
    expect(validateInstance(asFloat).ok).toBe(false)

    const asNumber = good(); asNumber.inputs.color = 0xff0000
    expect(validateInstance(asNumber).ok).toBe(false)
  })

  it('accepts a float where a float is declared, and rejects a non-finite one', () => {
    const ok = { ...good(), defId: 'bb', instanceId: 'legacy:bb', inputs: { stdDev: 2.5 } }
    expect(validateInstance(ok).ok).toBe(true)
    const nan = { ...ok, inputs: { stdDev: Number.NaN } }
    expect(validateInstance(nan).ok).toBe(false)
  })

  it('rejects an enum value that is not one of the declared options', () => {
    const i = { instanceId: 'legacy:vwap', defId: 'vwap', inputs: { lineStyle: 'squiggly' } }
    const r = validateInstance(i)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/squiggly/)
  })

  it('rejects an input key no definition declares — a silent default is a wrong number', () => {
    const i = good(); i.inputs.perod = 14
    const r = validateInstance(i)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/perod/)
  })

  it('rejects an unknown placement target', () => {
    const i = good(); i.placement = { target: 'orbit' }
    const r = validateInstance(i)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/orbit/)
  })

  it('accepts an instance with no placement and no inputs at all', () => {
    expect(validateInstance({ instanceId: 'x', defId: 'obv' }).ok).toBe(true)
  })

  it('rejects a non-boolean hidden', () => {
    const i = good(); i.hidden = 'yes'
    expect(validateInstance(i).ok).toBe(false)
  })

  it('rejects a non-integer defVersion but TOLERATES a version mismatch', () => {
    const bad = good(); bad.defVersion = 1.5
    expect(validateInstance(bad).ok).toBe(false)

    const newer = good(); newer.defVersion = 99
    expect(validateInstance(newer).ok, 'version is presentation-only; the maths is pinned by compute.rev').toBe(true)
  })

  it('NEVER throws, whatever it is handed', () => {
    for (const junk of [null, undefined, 0, '', 'rsi', [], { inputs: 7 }, { instanceId: {}, defId: [] }]) {
      expect(() => validateInstance(junk)).not.toThrow()
      expect(validateInstance(junk).ok).toBe(false)
    }
  })

  it('accepts a custom registry — the natives are only the default', () => {
    const fake = { schemaVersion: 1, id: 'zzz', version: 3, inputs: [{ key: 'n', type: 'int', default: 5, min: 1, max: 9 }] }
    const reg = (id) => (id === 'zzz' ? fake : null)
    expect(validateInstance({ instanceId: 'a', defId: 'zzz', inputs: { n: 5 } }, reg).ok).toBe(true)
    expect(validateInstance({ instanceId: 'a', defId: 'zzz', inputs: { n: 50 } }, reg).ok).toBe(false)
    expect(validateInstance({ instanceId: 'a', defId: 'rsi' }, reg).ok).toBe(false)
  })
})

describe('normalizeInstances', () => {
  const rsi = { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 } }
  const macd = { instanceId: 'legacy:macd', defId: 'macd', inputs: {} }

  it('keeps the good ones and drops the bad one WITH a reason', () => {
    const { kept, dropped } = normalizeInstances([rsi, { instanceId: 'x', defId: 'hologram' }, macd])
    expect(ids(kept)).toEqual(['legacy:rsi', 'legacy:macd'])
    expect(dropped).toHaveLength(1)
    expect(dropped[0].inst.defId).toBe('hologram')
    expect(dropped[0].reason).toMatch(/hologram/)
    expect(typeof dropped[0].reason).toBe('string')
  })

  it('never drops anything SILENTLY — every drop carries a non-empty reason', () => {
    const junk = [null, 'nope', { defId: 'rsi' }, { instanceId: 'y', defId: 'nope' }, { instanceId: 'z', defId: 'rsi', inputs: { period: -3 } }]
    const { kept, dropped } = normalizeInstances(junk)
    expect(kept).toEqual([])
    expect(dropped).toHaveLength(junk.length)
    for (const d of dropped) expect(d.reason.length).toBeGreaterThan(0)
  })

  it('drops the SECOND of two instances sharing an id — first wins', () => {
    const { kept, dropped } = normalizeInstances([rsi, { ...rsi, inputs: { period: 21 } }])
    expect(kept).toHaveLength(1)
    expect(kept[0].inputs.period).toBe(14)
    expect(dropped).toHaveLength(1)
    expect(dropped[0].reason).toMatch(/duplicate/i)
  })

  it('a nullish list is empty, not an error', () => {
    expect(normalizeInstances(null)).toEqual({ kept: [], dropped: [] })
    expect(normalizeInstances(undefined)).toEqual({ kept: [], dropped: [] })
    expect(normalizeInstances([])).toEqual({ kept: [], dropped: [] })
  })

  it('a NON-array is reported, not shrugged off', () => {
    const { kept, dropped } = normalizeInstances({ instanceId: 'legacy:rsi', defId: 'rsi' })
    expect(kept).toEqual([])
    expect(dropped).toHaveLength(1)
    expect(dropped[0].reason).toMatch(/array/i)
  })

  it('NEVER throws', () => {
    const exploding = { get instanceId() { throw new Error('boom') } }
    expect(() => normalizeInstances([exploding])).not.toThrow()
    const { kept, dropped } = normalizeInstances([exploding])
    expect(kept).toEqual([])
    expect(dropped).toHaveLength(1)
  })
})

// ─── Golden: REAL and reconstructed stored blobs ─────────────────────────────
//
// The expectations are written out in full rather than snapshotted. A snapshot
// records whatever the code did on the day it was written; this records what
// the migration is supposed to produce, so a change in behaviour has to be
// argued for in the diff.

const GOLDEN = {
  'owner-uct-default': [],

  'preset-oled-momentum': [
    { instanceId: 'legacy:rsi', defId: 'rsi', target: 'pane', inputs: { period: 7, color: '#7b68ee' } },
    { instanceId: 'legacy:macd', defId: 'macd', target: 'pane', inputs: { fastPeriod: 8, slowPeriod: 21, signalPeriod: 5, macdColor: '#2196F3', signalColor: '#FF9800' } },
    { instanceId: 'legacy:stoch', defId: 'stoch', target: 'pane', inputs: { kPeriod: 21, dPeriod: 5, kColor: '#FF6B6B', dColor: '#4ECDC4' } },
    { instanceId: 'legacy:mfi', defId: 'mfi', target: 'volume', inputs: { period: 14, color: '#c084fc' } },
  ],

  'preset-tradingview-price-overlays': [
    { instanceId: 'legacy:bb', defId: 'bb', target: 'price', inputs: { period: 50, stdDev: 2.5, color: 'rgba(156,39,176,0.85)' } },
    { instanceId: 'legacy:vwap', defId: 'vwap', target: 'price', inputs: { color: '#ffffff', opacity: 60, lineStyle: 'dashed', lineWidth: 2 } },
    { instanceId: 'legacy:sar', defId: 'sar', target: 'price', inputs: { step: 0.04, maxStep: 0.4, color: '#ffeb3b' } },
    // The three Ichimoku PERIODS are absent: the legacy section never had them
    // (StockChart calls computeIchimoku(bars) with no arguments), so the
    // migration does not invent them — the definition defaults supply them.
    { instanceId: 'legacy:ichimoku', defId: 'ichimoku', target: 'price', inputs: { tenkanColor: '#26C6DA', kijunColor: '#EF5350', spanAColor: 'rgba(76,175,80,0.2)', spanBColor: 'rgba(239,83,80,0.2)', chikouColor: 'rgba(255,235,59,0.7)' } },
    { instanceId: 'legacy:donchian', defId: 'donchian', target: 'price', inputs: { period: 55, color: 'rgba(96,165,250,0.5)' } },
  ],

  'preset-light-pane-stack': [
    { instanceId: 'legacy:atr', defId: 'atr', target: 'volume', inputs: { period: 21, color: '#FFA726' } },
    { instanceId: 'legacy:cci', defId: 'cci', target: 'pane', inputs: { period: 14, color: '#fbbf24' } },
    { instanceId: 'legacy:williamsR', defId: 'williamsR', target: 'pane', inputs: { period: 28, color: '#60a5fa' } },
    { instanceId: 'legacy:adx', defId: 'adx', target: 'pane', inputs: { period: 21, adxColor: '#e5e7eb', plusDIColor: '#22c55e', minusDIColor: '#ef4444' } },
    { instanceId: 'legacy:obv', defId: 'obv', target: 'volume', inputs: { color: '#9ca3af' } },
  ],

  'legacy-partial-v0': [
    // period only — this blob predates the per-indicator colour field.
    { instanceId: 'legacy:rsi', defId: 'rsi', target: 'pane', inputs: { period: 7 } },
    // `showBands` is dropped: no definition declares it, and the shipped
    // renderer ignores it too. volumeProfile is skipped entirely.
    { instanceId: 'legacy:vwap', defId: 'vwap', target: 'price', inputs: { color: '#26C6DA' } },
  ],
}

describe('golden blobs', () => {
  it('the fixture set includes at least one GENUINE stored blob', () => {
    expect(BLOB_FIXTURES.filter(f => f.provenance === 'genuine').length).toBeGreaterThanOrEqual(1)
  })

  it('every fixture has a golden expectation (no blob is carried untested)', () => {
    expect(BLOB_FIXTURES.map(f => f.name).sort()).toEqual(Object.keys(GOLDEN).sort())
  })

  for (const fixture of BLOB_FIXTURES) {
    describe(`${fixture.name} (${fixture.provenance})`, () => {
      it('migrates to exactly the expected instances', () => {
        const out = migrateLegacyToInstances(fixture.cs)
        expect(out.map(i => ({
          instanceId: i.instanceId, defId: i.defId, target: i.placement.target, inputs: i.inputs,
        }))).toEqual(GOLDEN[fixture.name])
      })

      it('every migrated instance survives normalization', () => {
        const { kept, dropped } = normalizeInstances(migrateLegacyToInstances(fixture.cs))
        expect(dropped, JSON.stringify(dropped)).toEqual([])
        expect(kept).toHaveLength(GOLDEN[fixture.name].length)
      })

      it('is idempotent on this blob', () => {
        const once = migrateLegacyToInstances(fixture.cs)
        expect(migrateLegacyToInstances({ ...fixture.cs, indicatorInstances: once })).toEqual(once)
      })

      it('MERGING FIRST changes nothing an indicator says — it only makes defaults explicit', () => {
        const rawOut = migrateLegacyToInstances(fixture.cs)
        const mergedOut = migrateLegacyToInstances(mergeChartSettings(fixture.cs))
        expect(ids(mergedOut)).toEqual(ids(rawOut))
        for (const before of rawOut) {
          const after = byId(mergedOut, before.instanceId)
          for (const [k, v] of Object.entries(before.inputs)) {
            expect(after.inputs[k], `${before.instanceId}.${k}`).toEqual(v)
          }
        }
      })
    })
  }

  it('all four presets migrate to nothing — every preset ships its indicators off', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      expect(migrateLegacyToInstances(preset.settings), name).toEqual([])
      expect(migrateLegacyToInstances(mergeChartSettings(preset.settings)), name).toEqual([])
    }
  })
})
