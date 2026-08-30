import { describe, it, expect, vi } from 'vitest'
import { render, within } from '@testing-library/react'

// The real scan, wrapped so the "empty window is refused BEFORE it is scanned"
// case can distinguish the reorder it exists to pin. A fixture that cannot tell
// the two orders apart proves nothing (`lesson_a_fixture_that_cannot_distinguish`).
vi.mock('./breadthEvents', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, scanEvents: vi.fn(actual.scanEvents) }
})

import EventLedgerView, { firedAccent } from './EventLedgerView'
import { scanEvents, EVENT_DEFS, EVENT_FAMILIES } from './breadthEvents'
import { optionLabel } from './viewMetricConfig'
import { PALETTES, resolveViewColors } from './breadthViewShared'

const base = { advancing: 2000, declining: 2000, up_vol_ratio: 1.0, mcclellan_osc: 0,
               hvc_52w: 5, atr_ext_7: 5, new_52w_lows: 10, is_ftd: 0 }
const rows = Array.from({ length: 40 }, (_, i) => ({
  ...base, date: `2026-08-${String(40 - i).padStart(2, '0')}`,
  ...(i === 0 ? { up_vol_ratio: 9.5 } : {}),
}))

// Every inline colour the card paints, in one string, however jsdom chose to
// serialise it — so an assertion about "what this card is painted with" cannot
// miss a hex that landed on a nested element instead of the border.
const paintOf = (card) => [card.style.border, ...[...card.querySelectorAll('*')]
  .flatMap(el => [el.style.color, el.style.background, el.style.backgroundColor])]
  .filter(Boolean).join(' ').toLowerCase()

// jsdom re-serialises an inline hex as rgb(); assert against both forms so the
// test pins the COLOUR rather than one engine's spelling of it.
const rgbOf = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`
const paints = (haystack, hex) =>
  haystack.includes(hex.toLowerCase()) || haystack.includes(rgbOf(hex))
const accentFor = (palette) => firedAccent(resolveViewColors(palette))

describe('EventLedgerView', () => {
  it('shows an event that fired today', () => {
    const { getByTestId } = render(<EventLedgerView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('events-card-vol90up').textContent).toMatch(/today/i)
  })

  it('says how far back it looked when an event never fired', () => {
    const { getByTestId } = render(<EventLedgerView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('events-card-ftd').textContent).toMatch(/not in the last 40 sessions/i)
  })

  it('shows the reason an event could not be evaluated', () => {
    const blind = rows.map(r => ({ ...r, advancing: null, declining: null }))
    const { getByTestId } = render(<EventLedgerView rows={blind} rowIdx={0} currentRow={blind[0]}
      onDrill={() => {}} options={{}} />)
    expect(getByTestId('events-card-zweig').textContent).toMatch(/advance\/decline counts cover 0/i)
  })

  // 🔴 A FIRED EVENT IS NOT A BULLISH EVENT. Every fired card used to paint the
  // palette's bull colour, so a *90% DOWN Volume Day* rendered green with a
  // green border. This lens reports that a named thing happened; it does not
  // grade it. The accent is the palette's CAUTION tone — neutral, and still the
  // palette's own, so the Customize control is not decorative.
  it('paints a fired event with a NEUTRAL accent, never the bull or bear colour', () => {
    const down = rows.map((r, i) => ({ ...r, up_vol_ratio: i === 0 ? 0.05 : 1.0 }))
    const { getByTestId } = render(<EventLedgerView rows={down} rowIdx={0} currentRow={down[0]}
      onDrill={() => {}} options={{ palette: 'classic' }} />)
    const card = getByTestId('events-card-vol90dn')
    expect(card.textContent).toMatch(/today/i)

    const painted = paintOf(card)
    for (const dir of ['bull', 'bear']) {
      expect(paints(painted, PALETTES.classic[dir]),
             `the fired card is painted with the ${dir} colour`).toBe(false)
    }
    expect(paints(painted, accentFor('classic')),
           'nothing on the card carries the accent — this fixture proves nothing').toBe(true)
  })

  // ⭐ AND THE OTHER HALF OF THE SAME RULING: neutral must not mean INERT. The
  // first fix hardcoded the UT gold, which left `options.palette` moving nothing
  // in this lens and had to be exempted from the palette rail to keep it green.
  it('moves the accent with the palette — the Customize control is not decorative', () => {
    const down = rows.map((r, i) => ({ ...r, up_vol_ratio: i === 0 ? 0.05 : 1.0 }))
    // Scoped to each render's own container: both renders share one document,
    // so a bare getByTestId finds two cards and throws.
    const draw = (palette) => render(<EventLedgerView rows={down} rowIdx={0} currentRow={down[0]}
      onDrill={() => {}} options={{ palette }} />)
      .container.querySelector('[data-testid="events-card-vol90dn"]')

    const classic = paintOf(draw('classic'))
    const ocean = paintOf(draw('ocean'))
    expect(paints(classic, accentFor('classic')),
           'the fixture fires nothing, so it proves nothing about the accent').toBe(true)
    expect(paints(ocean, accentFor('ocean'))).toBe(true)
    expect(ocean).not.toBe(classic)
  })

  /**
   * ⭐ THE FAMILIES ARE THE LEDGER'S OWN, NOT A COPY OF THEM.
   *
   * `EVENT_DEFS` declares a family per event and `EVENT_FAMILIES` is derived
   * from that; the option schema owns the words. So the expectations below are
   * DERIVED too — a family added tomorrow is covered the day it lands, and a
   * heading that quietly stopped matching the Customize filter's wording fails
   * by name rather than by nobody noticing.
   */
  describe('grouped by family', () => {
    const draw = (options = {}) => render(<EventLedgerView rows={rows} rowIdx={0}
      currentRow={rows[0]} onDrill={() => {}} options={options} />)
    const familiesOnScreen = (container) =>
      [...container.querySelectorAll('[data-testid^="events-family-"]')]
        .map(el => el.getAttribute('data-testid').slice('events-family-'.length))

    it('renders one section per declared family, in the registry’s order', () => {
      const { container } = draw()
      expect(EVENT_FAMILIES.length, 'nothing to group — this rail proves nothing')
        .toBeGreaterThan(1)
      expect(familiesOnScreen(container)).toEqual(EVENT_FAMILIES)
    })

    it('puts every event inside the section its own definition names', () => {
      const { container } = draw()
      for (const d of EVENT_DEFS) {
        const section = container.querySelector(`[data-testid="events-family-${d.family}"]`)
        expect(within(section).getByTestId(`events-card-${d.key}`),
               `"${d.key}" is not under "${d.family}"`).toBeTruthy()
      }
    })

    it('heads each section with the word the Customize filter offers', () => {
      const { container } = draw()
      for (const f of EVENT_FAMILIES) {
        const section = container.querySelector(`[data-testid="events-family-${f}"]`)
        expect(section.textContent).toContain(optionLabel('events', 'families', f))
      }
    })

    it('renders only the chosen family when the filter names one', () => {
      const one = EVENT_FAMILIES[0]
      const { container } = draw({ families: one })
      expect(familiesOnScreen(container)).toEqual([one])
    })
  })

  /**
   * 🔴 THE LEDGER STOPPED A THIRD OF THE WAY DOWN A FULL-HEIGHT PANEL.
   *
   * Same shape as the Heat Ribbon and the Percentile Ladder: the box was
   * `height: 100%` of what the container offered and the CONTENT declined it —
   * ten rows at their own 26px text height, then black. Rows flex now, and the
   * only thing that changes as the room grows is their leading; nothing is
   * stretched, dropped or re-ranked to fill space.
   *
   * ⛔ AND THE SECTION'S GROW FACTOR IS ITS ROW COUNT. A flat `flex: 1` hands a
   * one-event family the same slack as a four-event one, so rows come out
   * different heights per family and the ledger reads as five unrelated blocks
   * instead of one list.
   */
  it('lets its rows share the height, weighted by how many each family holds', () => {
    const { container } = render(<EventLedgerView rows={rows} rowIdx={0} currentRow={rows[0]}
      onDrill={() => {}} options={{}} />)

    const cards = [...container.querySelectorAll('[data-testid^="events-card-"]')]
    expect(cards.length).toBeGreaterThan(1)
    for (const card of cards) {
      expect(Number(card.style.flexGrow)).toBe(1)
      expect(Number.parseFloat(card.style.flexBasis)).toBe(0)
      expect(Number.parseFloat(card.style.maxHeight))
        .toBeGreaterThan(Number.parseFloat(card.style.minHeight))
    }

    const sections = [...container.querySelectorAll('[data-testid^="events-family-"]')]
    expect(sections.length).toBeGreaterThan(1)
    for (const section of sections) {
      const rowsHere = section.querySelectorAll('[data-testid^="events-card-"]').length
      expect(Number(section.style.flexGrow),
             'a section grew by 1 instead of by its row count').toBe(rowsHere)
    }
    // CONTROL: the families do NOT all hold the same number of events, so the
    // assertion above could not have passed on a hard-coded 1.
    const counts = new Set(sections.map(s =>
      s.querySelectorAll('[data-testid^="events-card-"]').length))
    expect(counts.size).toBeGreaterThan(1)
  })

  it('renders nothing for an empty window WITHOUT scanning it first', () => {
    scanEvents.mockClear()
    const { container } = render(<EventLedgerView rows={[]} rowIdx={0} currentRow={null}
      onDrill={() => {}} options={{}} />)
    expect(container.innerHTML).toBe('')
    expect(scanEvents, 'the window was scanned before the guard refused it')
      .not.toHaveBeenCalled()
  })
})
