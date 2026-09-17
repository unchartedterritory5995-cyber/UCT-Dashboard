// app/src/components/chart/barInfoFields.test.js
//
// ─── LEGEND V2 §10/§12 — WHICH FIELDS THE BAR INFO STRIP PRINTS ─────────────
//
// The resolver, its default, and the two backward-compatibility questions the
// brief asks by name: an old `legendLayout: 'vertical'` and an old
// `legendLayout: 'horizontal'` must both open safely, and the new field set must
// survive the canonical settings round-trip.
//
// ⛔ THE DEFAULT IS ASSERTED TO BE *ABSENT FROM THE MERGED BLOB*, not merely
// correct. That is the whole lesson `legendStamp.test.js` was written for: a
// default declared in `CHART_DEFAULTS` is spread into every merged blob, the
// merged blob is what every settings write persists, and the default then becomes
// a stored user choice that no later default can outrank. Measured in production
// on 2026-08-16 with `legendMode`; this key must not repeat it.
import { describe, it, expect } from 'vitest'
import {
  BAR_INFO_FIELDS, BAR_INFO_FIELD_IDS, DEFAULT_BAR_INFO_FIELDS,
  explicitBarInfoFields, barInfoFieldsOf, barInfoShows, withBarInfoField,
} from './barInfoFields'
import { mergeChartSettings, CHART_DEFAULTS } from './chartDefaults'

const withHeader = (header) => ({ header })

describe('the catalogue', () => {
  it('is the seven readings of a candle, in reading order', () => {
    expect(BAR_INFO_FIELD_IDS).toEqual(
      ['date', 'open', 'high', 'low', 'close', 'change', 'changePct'])
  })

  it('⛔ VOLUME IS NOT A BAR-INFO FIELD — it is a plot, and plots live in the stack', () => {
    // §2/§4. Volume has a colour, a pane, a visibility and a popover; the strip is
    // a readout of the instrument and carries none of those. A `volume` entry here
    // would be the old legend creeping back in one field at a time.
    expect(BAR_INFO_FIELD_IDS).not.toContain('volume')
    expect(BAR_INFO_FIELDS.some((f) => /vol/i.test(f.label))).toBe(false)
  })

  it('every field carries a settings label, and O/H/L/C carry a strip key', () => {
    for (const f of BAR_INFO_FIELDS) expect(f.label.length).toBeGreaterThan(0)
    const keyed = BAR_INFO_FIELDS.filter((f) => f.short)
    expect(keyed.map((f) => f.short)).toEqual(['O', 'H', 'L', 'C'])
  })
})

describe('the resolver', () => {
  it('a chart that has never chosen prints all seven', () => {
    expect(barInfoFieldsOf(undefined)).toEqual(DEFAULT_BAR_INFO_FIELDS)
    expect(barInfoFieldsOf({})).toEqual(DEFAULT_BAR_INFO_FIELDS)
    expect(barInfoFieldsOf(withHeader({}))).toEqual(DEFAULT_BAR_INFO_FIELDS)
    expect(explicitBarInfoFields(withHeader({}))).toBeUndefined()
  })

  it('an explicit set is honoured', () => {
    const cs = withHeader({ barInfo: ['open', 'high', 'low', 'close'] })
    expect(barInfoFieldsOf(cs)).toEqual(['open', 'high', 'low', 'close'])
    expect(barInfoShows(cs, 'date')).toBe(false)
    expect(barInfoShows(cs, 'close')).toBe(true)
  })

  it('⭐ AN EMPTY ARRAY IS A REAL CHOICE, not "unset"', () => {
    // The member turned every field off. Testing truthiness of the length instead
    // of `Array.isArray` would silently hand them all seven back.
    expect(barInfoFieldsOf(withHeader({ barInfo: [] }))).toEqual([])
    expect(explicitBarInfoFields(withHeader({ barInfo: [] }))).toEqual([])
  })

  it('⛔ THE STORED VALUE IS A SET — the strip is always printed in canonical order', () => {
    // A blob cannot re-order the strip into `C H O L`. Order is a design decision;
    // an array that carried it would make it a stored one.
    expect(barInfoFieldsOf(withHeader({ barInfo: ['changePct', 'close', 'date'] })))
      .toEqual(['date', 'close', 'changePct'])
  })

  it('unknown and duplicate ids degrade rather than blanking the strip', () => {
    expect(barInfoFieldsOf(withHeader({ barInfo: ['close', 'close', 'vwap', 42, null] })))
      .toEqual(['close'])
  })

  it('a malformed value is not a choice — it falls through to the default', () => {
    for (const bad of ['close', 42, null, {}, true]) {
      expect(explicitBarInfoFields(withHeader({ barInfo: bad })), String(bad)).toBeUndefined()
      expect(barInfoFieldsOf(withHeader({ barInfo: bad }))).toEqual(DEFAULT_BAR_INFO_FIELDS)
    }
  })
})

describe('the writer', () => {
  it('turning one field off leaves the other six, in order', () => {
    expect(withBarInfoField(withHeader({}), 'date', false))
      .toEqual(['open', 'high', 'low', 'close', 'change', 'changePct'])
  })

  it('turning one back on restores it to its own place, not to the end', () => {
    const off = withHeader({ barInfo: withBarInfoField(withHeader({}), 'date', false) })
    expect(withBarInfoField(off, 'date', true)).toEqual(DEFAULT_BAR_INFO_FIELDS)
  })

  it('the brief’s two worked examples', () => {
    // §10: "Member disables Date + Net Change" and "Member disables Percent Change".
    let cs = withHeader({ barInfo: withBarInfoField(withHeader({}), 'date', false) })
    cs = withHeader({ barInfo: withBarInfoField(cs, 'change', false) })
    expect(barInfoFieldsOf(cs)).toEqual(['open', 'high', 'low', 'close', 'changePct'])

    expect(withBarInfoField(withHeader({}), 'changePct', false))
      .toEqual(['date', 'open', 'high', 'low', 'close', 'change'])
  })

  it('an id that is not a field writes nothing', () => {
    expect(withBarInfoField(withHeader({}), 'volume', true)).toEqual(DEFAULT_BAR_INFO_FIELDS)
  })
})

describe('§12 — persistence, through the ONE canonical path', () => {
  it('⛔ THE DEFAULT IS NEVER STAMPED INTO A STORED BLOB', () => {
    // Same rail as `legendStamp.test.js`. If `barInfo` appeared here, the default
    // would be recorded as the member's own choice on their next settings write
    // and could never be changed again for anyone who had saved.
    expect(CHART_DEFAULTS.header).not.toHaveProperty('barInfo')
    expect(mergeChartSettings(JSON.stringify({})).header).not.toHaveProperty('barInfo')
    expect(mergeChartSettings(null).header).not.toHaveProperty('barInfo')
  })

  it('an explicit set survives save → reopen', () => {
    const chosen = ['open', 'close', 'changePct']
    const saved = JSON.stringify({ header: { barInfo: chosen } })
    const reopened = mergeChartSettings(saved)
    expect(reopened.header.barInfo).toEqual(chosen)
    expect(barInfoFieldsOf(reopened)).toEqual(chosen)
    // …and a second round-trip is a fixed point, not a slow drift.
    expect(mergeChartSettings(JSON.stringify(reopened)).header.barInfo).toEqual(chosen)
  })

  it('an empty set survives the round-trip as an empty set', () => {
    expect(mergeChartSettings(JSON.stringify({ header: { barInfo: [] } })).header.barInfo)
      .toEqual([])
  })

  it('the merge SANITISES a re-ordered stored array', () => {
    expect(mergeChartSettings(JSON.stringify({ header: { barInfo: ['close', 'date'] } }))
      .header.barInfo).toEqual(['date', 'close'])
  })
})

describe('⚰ §12 — the retired Vertical/Horizontal layout key', () => {
  it('⛔ `legendLayout` IS STILL DECLARED, AND THAT IS THE SAFE ANSWER', () => {
    // Deleting the declaration was tried and reverted. `CHART_DEFAULTS` is spread
    // into the merge and the merge output is what every settings write persists,
    // so removing the line drops a key from EVERY chart's next save — caught by
    // two hash rails (`alertSets` / `perInstanceDoor`), whose measured delta was
    // this one key and nothing else. §12: deprecate, do not migrate.
    expect(CHART_DEFAULTS.header).toHaveProperty('legendLayout')
    expect(mergeChartSettings(JSON.stringify({})).header.legendLayout).toBe('vertical')
  })

  it('⭐ …and it is INERT — no reader consults it', () => {
    // The rail that makes "dead data" a fact rather than a claim lives in
    // `legendV2.test.jsx` (it reads StockChart.jsx and the settings modal with
    // comments stripped). Here: whatever it says, the strip is unaffected.
    for (const v of ['vertical', 'horizontal', 'nonsense', undefined]) {
      expect(barInfoFieldsOf(mergeChartSettings(JSON.stringify({ header: { legendLayout: v } }))))
        .toEqual(DEFAULT_BAR_INFO_FIELDS)
    }
  })

  it('an old `vertical` blob opens on the one layout, with every field', () => {
    const cs = mergeChartSettings(JSON.stringify({ header: { legendLayout: 'vertical' } }))
    expect(barInfoFieldsOf(cs)).toEqual(DEFAULT_BAR_INFO_FIELDS)
  })

  it('an old `horizontal` blob opens the same way — nothing is migrated', () => {
    // ⭐ THE BACKWARD-COMPATIBLE READER STRATEGY THE BRIEF ASKED FOR: the stored
    // value rides through untouched and nothing reads it. A migration that
    // rewrote every saved chart to delete one ignored key would be all of the
    // risk and none of the benefit.
    const cs = mergeChartSettings(JSON.stringify({ header: { legendLayout: 'horizontal' } }))
    expect(barInfoFieldsOf(cs)).toEqual(DEFAULT_BAR_INFO_FIELDS)
    expect(cs.header.legendLayout).toBe('horizontal')
  })

  it('an old blob that ALSO carries a field set keeps the field set', () => {
    const cs = mergeChartSettings(JSON.stringify({
      header: { legendLayout: 'horizontal', barInfo: ['close'] },
    }))
    expect(barInfoFieldsOf(cs)).toEqual(['close'])
  })
})
