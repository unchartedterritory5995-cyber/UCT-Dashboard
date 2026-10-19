// app/src/pages/journal-2-0/a11y/starterPackOffer.a11y.test.jsx
//
// Notebook P5 Task 10: "How do you trade?", the starter pack offer (components/notebook/styles/
// StarterPackOffer.jsx, outside the derived population, so it is an OUTSIDE_POPULATION_SURFACES entry in
// notebookSurfaces.js, held to this file by the coverage rail in planGrading.a11y.test.jsx), through 8A's axe
// harness with the starter-packs and journal-styles switches on. Each recipe proves its state rendered before
// axe runs, so an empty render cannot pass as a clean one:
//   * starter-pack-offer            -- the card: its heading, its line, the five packs and Not now;
//   * starter-pack-offer-added      -- after choosing Swing: the "Added: ..." answer in the live region, Done;
//   * starter-pack-offer-failed     -- a failed install: the one-sentence alert, nothing added;
//   * starter-pack-offer-offline    -- offline: the packs disabled and the line that says why;
//   * starter-pack-offer-in-manager -- the offer at the top of the Styles manager for a member with no styles;
//   * starter-pack-offer-one-per-page -- the empty notebook's page with the Styles manager open over it (its
//     inline kind section and the manager both hold the card; the New note sheet's pair is the unit rail's,
//     StarterPackOffer.test.jsx 11, since the page unmounts the inline picker under the sheet): one "How do
//     you trade?" region, and axe's
//     `landmark-unique` (best-practice, so the WCAG tag set never runs it) run by name, with a known-bad control
//     proving it reports two same-named regions (ruling P5-T10-R2).
// The server answers are the recorded contract fixtures (`__fixtures__/contract`).
import { describe, beforeEach, vi, expect, it } from 'vitest'
import axe from 'axe-core'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { Providers, installFetch } from './fixtures'
import { axeSurface } from './surface'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { contractBody } from '../__fixtures__/contract'
import { PACKS } from '../lib/starterPacks'
import StarterPackOffer, { OFFER_TITLE, OFFER_LINE, OFFER_FAILED } from '../components/notebook/styles/StarterPackOffer'
import StylesManager from '../components/notebook/styles/StylesManager'
import KindSection from '../components/notebook/styles/KindSection'

vi.mock('../../../hooks/usePreferences', () => ({
  default: () => ({ prefs: {}, setPref: () => {}, setPrefMerged: async () => ({ ok: true }), loading: false, readFailed: false }),
}))

const EMPTY = contractBody('journal-styles.list.empty')
const INSTALLED = contractBody('journal-styles.starter-pack.install')
const INSTALL = /^\/api\/j2\/journal-styles\/starter-packs\/[a-z]+$/
const ROUTES = (install = INSTALLED) => [
  [INSTALL, install],
  [/^\/api\/j2\/journal-styles$/, EMPTY],
  [/mapping-offer$/, { offer: null }],
]

/** The card is on screen with every pack and its Not now: the non-vacuity floor for each recipe. */
async function cardShown() {
  const card = await screen.findByRole('region', { name: OFFER_TITLE })
  within(card).getByText(OFFER_LINE)
  for (const p of PACKS) within(card).getByRole('button', { name: p.label })
  expect(PACKS).toHaveLength(5)
  return card
}

describe('starter pack offer (P5)', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_starter_packs_enabled: true })
    Element.prototype.scrollIntoView = vi.fn()
  })

  axeSurface('starter-pack-offer', async () => {
    installFetch(ROUTES())
    render(<Providers><StarterPackOffer onClose={() => {}} /></Providers>)
    const card = await cardShown()
    within(card).getByRole('button', { name: 'Not now' })
  })

  axeSurface('starter-pack-offer-added', async () => {
    installFetch(ROUTES())
    render(<Providers><StarterPackOffer onClose={() => {}} /></Providers>)
    const card = await cardShown()
    fireEvent.click(within(card).getByRole('button', { name: 'Swing' }))
    const added = await within(card).findByText(/^Added: /)
    expect(within(card).getByRole('status').contains(added)).toBe(true)
    for (const i of INSTALLED.installed) expect(added.textContent).toContain(i.title)
    within(card).getByRole('button', { name: 'Done' })
  })

  axeSurface('starter-pack-offer-failed', async () => {
    installFetch(ROUTES([500, { detail: 'boom' }]))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<Providers><StarterPackOffer onClose={() => {}} /></Providers>)
    const card = await cardShown()
    fireEvent.click(within(card).getByRole('button', { name: 'Day' }))
    expect((await within(card).findByRole('alert')).textContent).toBe(OFFER_FAILED)
    expect(within(card).queryByText(/^Added: /)).toBeNull()
  })

  axeSurface('starter-pack-offer-offline', async () => {
    installFetch(ROUTES())
    render(<Providers><StarterPackOffer onClose={() => {}} offline /></Providers>)
    const card = await cardShown()
    for (const p of PACKS) expect(within(card).getByRole('button', { name: p.label }).disabled).toBe(true)
    within(card).getByText("You're offline. Adding a pack needs a connection.")
  })

  axeSurface('starter-pack-offer-in-manager', async () => {
    installFetch(ROUTES())
    render(<Providers><StylesManager open onClose={() => {}} /></Providers>)
    await screen.findByRole('heading', { name: 'Journal styles' })
    await cardShown()
  })
})

// axe's landmark-unique, by name: two regions with one role and one name are a duplicate landmark.
const landmarkUnique = (root) => axe.run(root, { runOnly: { type: 'rule', values: ['landmark-unique'] }, resultTypes: ['violations'] })

describe('one How do you trade? per page (P5-T10-R2)', () => {
  beforeEach(() => {
    __resetNotebookFlags()
    latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_starter_packs_enabled: true })
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('control: two cards on one page ARE a landmark-unique violation (the check below can fail)', async () => {
    installFetch(ROUTES())
    const { container } = render(<Providers><StarterPackOffer onClose={() => {}} /><StarterPackOffer onClose={() => {}} /></Providers>)
    expect(await screen.findAllByRole('region', { name: OFFER_TITLE })).toHaveLength(2)
    const out = await landmarkUnique(container)
    expect(out.violations.map((v) => v.id)).toContain('landmark-unique')
  })

  axeSurface('starter-pack-offer-one-per-page', async () => {
    installFetch(ROUTES())
    const { container } = render(
      <Providers>
        <KindSection onCreate={() => {}} />
        <StylesManager open onClose={() => {}} />
      </Providers>,
    )
    await screen.findByRole('heading', { name: 'Journal styles' })
    const card = await cardShown()
    expect(screen.getByRole('dialog', { name: 'Journal styles' }).contains(card)).toBe(true)
    expect(screen.getAllByRole('group', { name: 'Start from a kind of note' })).toHaveLength(1)
    expect(screen.getAllByRole('region', { name: OFFER_TITLE })).toHaveLength(1)
    expect((await landmarkUnique(container)).violations).toEqual([])
  })
})
