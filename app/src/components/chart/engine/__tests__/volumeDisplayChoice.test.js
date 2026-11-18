// app/src/components/chart/engine/__tests__/volumeDisplayChoice.test.js
//
// ─── /charts: Volume's Display in is the MEMBER'S choice (owner 11-16) ──────
//
// `volumePaneByDefault` (the /charts pane look) means "own pane unless the member
// chose Overlay on price". The choice lives in `cs.volume.displayIn`, because
// `separatePane` was inert on /charts and every saved blob says `false` there.
import { describe, it, expect } from 'vitest'
import {
  resolveVolumePresentation, nativeVolumeOwnsPane, volumePaneRequired, volumeDisplayChoice,
  VOLUME_AS_PANE, VOLUME_AS_BAND, VOLUME_ABSENT,
} from '../volumePresentation'
import { mergeChartSettings } from '../../chartDefaults'
import { listIndicators, patchFor } from '../../indicatorRegistry'

const cs = (volume = {}, rest = {}) => mergeChartSettings({ volume, ...rest })
const byDefault = (c, extra = {}) => ({ cs: c, volumePaneByDefault: true, ...extra })

describe('resolveVolumePresentation · volumePaneByDefault', () => {
  it('⭐ unset → own pane, even over the old inert separatePane:false', () => {
    expect(volumeDisplayChoice(cs({ separatePane: false }))).toBe(null)
    expect(resolveVolumePresentation(byDefault(cs({ separatePane: false })))).toBe(VOLUME_AS_PANE)
  })
  it("'price' → a band in the candles' pane; no volume pane exists", () => {
    const c = cs({ displayIn: 'price', separatePane: false })
    expect(resolveVolumePresentation(byDefault(c))).toBe(VOLUME_AS_BAND)
    expect(nativeVolumeOwnsPane(byDefault(c))).toBe(false)
    expect(volumePaneRequired(byDefault(c))).toBe(false)
  })
  it("'pane' → own pane", () => {
    expect(resolveVolumePresentation(byDefault(cs({ displayIn: 'pane' })))).toBe(VOLUME_AS_PANE)
  })
  it('⛔ the FIXING props still win: volumeSeparatePane, blankVolume, a guest, hidden', () => {
    const c = cs({ displayIn: 'price' })
    expect(resolveVolumePresentation(byDefault(c, { volumeSeparatePane: true }))).toBe(VOLUME_AS_PANE)
    expect(resolveVolumePresentation(byDefault(c, { blankVolume: true }))).toBe(VOLUME_AS_PANE)
    expect(resolveVolumePresentation(byDefault(cs({ displayIn: 'price' }, { volumeOverlayIndicators: ['rsi'] })))).toBe(VOLUME_AS_PANE)
    expect(resolveVolumePresentation(byDefault(c, { shown: false }))).toBe(VOLUME_ABSENT)
  })
  it('a host WITHOUT the default is unchanged — separatePane decides, displayIn is not read', () => {
    expect(resolveVolumePresentation({ cs: cs({ displayIn: 'price', separatePane: true }) })).toBe(VOLUME_AS_PANE)
    expect(resolveVolumePresentation({ cs: cs({ displayIn: 'pane', separatePane: false }) })).toBe(VOLUME_AS_BAND)
  })
})

describe('Chart Settings → Indicators → Volume · Separate pane on /charts', () => {
  const volRow = (settings, opts) => listIndicators(settings, opts).find((r) => r.id === 'volume')
  it('⭐ live (not fixed) and showing the member’s choice, ON by default', () => {
    const row = volRow(cs({ separatePane: false }), { volumePaneByDefault: true })
    expect(row.fields.find((f) => f.key === 'separatePane').disabled).toBeUndefined()
    expect(row.values.separatePane).toBe(true)
    expect(volRow(cs({ displayIn: 'price' }), { volumePaneByDefault: true }).values.separatePane).toBe(false)
    // elsewhere the toggle still shows the stored key
    expect(volRow(cs({ separatePane: false }), {}).values.separatePane).toBe(false)
  })
  it('⭐ the toggle writes displayIn beside separatePane', () => {
    const settings = cs({ separatePane: false })
    const row = volRow(settings, { volumePaneByDefault: true })
    expect(patchFor(row, { separatePane: false }, settings).volume).toMatchObject({ separatePane: false, displayIn: 'price' })
    expect(patchFor(row, { separatePane: true }, settings).volume).toMatchObject({ separatePane: true, displayIn: 'pane' })
    expect(patchFor(row, { upColor: '#fff' }, settings).volume.displayIn).toBeUndefined()
  })
})
