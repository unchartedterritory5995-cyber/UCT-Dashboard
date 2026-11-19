// Data unit S4-0 (2026-11-19): the chart's half of the Pine data families. The class itself is
// generated from api/services/provider_licensing_class.py and railed against it by
// tests/test_pine_data_catalog.py; these rails hold the chart's decision and its sentences.
import { describe, it, expect } from 'vitest'
import {
  PINE_DATA_CATALOG, dataFamilyOf, dataFamilyRefusal, dataNameRefusal, dataDisclosure,
  DATA_LICENCE_GUARD, DATA_UNKNOWN_GUARD, DATA_FIELD_GUARD,
} from './pineDataCatalog.js'

const clone = () => JSON.parse(JSON.stringify(PINE_DATA_CATALOG))
const FAMILIES = Object.keys(PINE_DATA_CATALOG.families)

describe('pineDataCatalog (S4-0)', () => {
  it('every family carries a generated licence block', () => {
    for (const fam of FAMILIES) {
      const lic = PINE_DATA_CATALOG.families[fam].licence
      expect(lic, fam).toBeTruthy()
      expect(typeof lic.class, fam).toBe('string')
      expect(typeof lic.registerRow, fam).toBe('string')
    }
  })

  it.each(FAMILIES)('%s serves only on A or LA and refuses by name otherwise', (fam) => {
    const c = clone()
    const spec = c.families[fam]
    delete spec.hold
    for (const cls of ['A', 'LA']) {
      spec.licence = { class: cls, registerRow: 'T-TEST' }
      expect(dataFamilyRefusal(fam, c)).toBeNull()
    }
    for (const cls of ['R', 'U', 'X']) {
      spec.licence = { class: cls, registerRow: 'T-TEST' }
      const out = dataFamilyRefusal(fam, c)
      expect(out.guard).toBe(DATA_LICENCE_GUARD)
      expect(out.message).toContain(`licensing class ${cls} `)
      expect(out.message).toContain('licensing register row T-TEST')
      expect(out.message).toContain(spec.label)
      for (const name of spec.pine) expect(out.message).toContain(`\`${name}\``)
    }
  })

  it('a family with no licence block is never served (the chart infers no class)', () => {
    const c = clone()
    delete c.families.financial.licence
    expect(dataFamilyRefusal('financial', c).guard).toBe(DATA_LICENCE_GUARD)
  })

  it('renders the same sentence the server renders (one template, one file)', () => {
    const c = clone()
    c.families.financial.licence = { class: 'R', registerRow: 'T-83' }
    expect(dataFamilyRefusal('financial', c)).toEqual({
      guard: 'data:licence',
      message: 'Not served: `request.financial`. The financial data rests on licensing class R '
        + "(licensing register row T-83), and a member's script reads only data classed A or LA.",
    })
  })

  it('a hold refuses by name once the licence passes', () => {
    const out = dataFamilyRefusal('uct_short_interest')
    expect(out.guard).toBe('data:owner-hold')
    expect(out.message).toContain('`uct.short_interest`, `uct.days_to_cover`')
    expect(out.message).toContain('O7')
  })

  it('unknown names and unserved fields refuse by name', () => {
    expect(dataFamilyRefusal('nope').guard).toBe(DATA_UNKNOWN_GUARD)
    expect(dataFamilyRefusal('toString').guard).toBe(DATA_UNKNOWN_GUARD)
    expect(dataNameRefusal('request.security').guard).toBe(DATA_UNKNOWN_GUARD)
    const field = dataNameRefusal('earnings.standardized')
    expect(field.guard).toBe(DATA_FIELD_GUARD)
    expect(field.message).toContain('`earnings.standardized`')
    expect(dataFamilyOf('UCT:COT:GC')).toBe('uct_cot')
    expect(dataFamilyOf('UCT:UCTA50')).toBe('uct_breadth')
    expect(dataFamilyOf('earnings.actual')).toBe('earnings')
    expect(dataFamilyOf('')).toBeNull()
  })

  it('today, by name: what S4-0 leaves served and refused (the generated blocks as committed)', () => {
    const got = Object.fromEntries(FAMILIES.map((f) => [f, (dataFamilyRefusal(f) || { guard: 'served' }).guard]))
    expect(got).toEqual({
      earnings: 'data:licence', dividends: 'data:licence', splits: 'data:licence', financial: 'served',
      uct_rs_rating: 'data:licence', uct_rs_line: 'data:licence', uct_breadth: 'data:licence',
      uct_cot: 'data:licence', uct_short_interest: 'data:owner-hold', uct_short_volume: 'data:owner-hold',
      uct_sentiment: 'data:licence',
    })
  })

  it('no member-facing sentence names a vendor', () => {
    const names = new Set(PINE_DATA_CATALOG.vendorNames)
    for (const spec of Object.values(PINE_DATA_CATALOG.families)) if (spec.vendor !== 'unregistered') names.add(spec.vendor)
    const pats = [...names].flatMap((n) => [n, n.replace(/_/g, ' ')])
      .map((n) => new RegExp(`(?<![A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i'))
    const texts = []
    for (const [fam, spec] of Object.entries(PINE_DATA_CATALOG.families)) {
      texts.push(dataDisclosure(fam))
      for (const r of Object.values(spec.refusedNames || {})) texts.push(r)
      if (spec.hold) texts.push(spec.hold.reason)
      const c = clone()
      for (const cls of ['R', 'U', 'LA']) {
        c.families[fam].licence = { class: cls, registerRow: 'T-TEST' }
        const out = dataFamilyRefusal(fam, c)
        // the member's own spellings are blanked: `UCT:UCTAAII` is what the member wrote
        if (out) texts.push(out.message.split(spec.pine.join('`, `')).join('NAMES'))
      }
    }
    texts.push(...Object.values(PINE_DATA_CATALOG.sentences))
    const hits = texts.flatMap((t) => pats.filter((p) => p.test(t)).map((p) => `${p} in: ${t}`))
    expect(hits).toEqual([])
  })

  it('values never leave the product by default (owner item O2)', () => {
    expect(PINE_DATA_CATALOG.rules.valuesLeaveProduct).toBe(false)
  })
})
