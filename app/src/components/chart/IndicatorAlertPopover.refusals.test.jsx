// app/src/components/chart/IndicatorAlertPopover.refusals.test.jsx
//
// ═══════════════════════════════════════════════════════════════════════════
// THE `refusals` BLOCK HAS A READER.
// ═══════════════════════════════════════════════════════════════════════════
//
// `GET /api/indicator-alerts/catalog` has carried a `refusals` block since
// `1ba2854e` — each refusing door's own sentence, verbatim, including its
// `[gate:<name>]` suffix, served as a SECOND KEY so a formula can never land in
// neither list. It was mutation-proven on the backend and reached no browser:
// `useIndicatorAlertCatalog`'s fetcher returned `body.catalog`, so `refusals`
// was dropped AT THE HOOK and `IndicatorAlertPopover` never saw it. A correct
// backend, a correct component, and nothing joining them — the ninth instance of
// this project's signature defect in one week, and the eighth of those slipped
// past suites exactly like the popover's own 47 cases.
//
// ⛔ WHICH IS WHY THIS FILE DOES NOT MOCK THE HOOK. `IndicatorAlertPopover
// .test.jsx` replaces `../../hooks/useIndicatorAlerts` wholesale — right for its
// 47 cases about the FORM, and STRUCTURALLY INCAPABLE of observing this defect,
// because a hand-made state object carries whatever the test author put in it
// whether or not the real hook can produce it (`lesson_injected_dependency
// _hides_the_fetch`). What was broken here is the JOIN between two correct ends,
// so the assertion has to span it: real hook, real SWR, `fetch` as the only
// stub, exactly the posture `IndicatorAlertPopover.scope.test.jsx` takes.
//
// Non-vacuity was MEASURED, not asserted: the wire was cut at the fetcher (drop
// `refusals` from the returned body — i.e. restore the shipped line), at the
// hook's return, and at the render, with both ends left correct in every case.
// Every cut turned this file RED. See `.refui_gauntlet_out.txt`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

import IndicatorAlertPopover from './IndicatorAlertPopover'
import { AuthContext } from '../../context/AuthContext'

const LIST = '/api/indicator-alerts'
const CATALOG = '/api/indicator-alerts/catalog'

/** The global groups the endpoint always serves. Present in every fixture below
 *  so the form is in its normal, ready state and the refusals section is never
 *  the only thing on screen. */
const RSI_ONLY = [{
  indicator: 'rsi',
  label: 'RSI',
  conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }],
  default_threshold: 70,
}]

/** A member's own formula the gates ADMITTED — it is offered as an address, the
 *  way `alert_user_series.user_catalog` appends it. The control half of every
 *  assertion below: a "render everything" implementation shows a reason for this
 *  one too, and dies. */
const ACCEPTED_USER_DEF = {
  indicator: 'my_slope',
  label: 'Slope of MA',
  conditions: [{ value: 'above', label: 'Above threshold', needs_threshold: true }],
  default_threshold: null,
}

// ─── THE DOORS' OWN SENTENCES ───────────────────────────────────────────────
//
// Quoted from the shipped gates (`alert_user_series.AdmissionRefused.__init__`
// composes `f"{detail} [gate:{gate}]"`; the fragments are `REFUSAL_FRAGMENTS`),
// deliberately in a shape NO client code could invent — an id in Python `repr`
// quotes, a measured mode, and the `[gate:…]` attribution the exception appends.
// If this component ever re-words, truncates or summarises, the equalities below
// stop holding.

/** `_gate_repaint`, the door a member hits most: the badge is a gate (spec §1.3). */
const REPAINT_REFUSAL =
  "a repainting formula cannot arm an alert: my_ma.line measures 'repaints' [gate:repaint]"

/** `_gate_lane` — a saved document that is not a formula at all. */
const LANE_REFUSAL =
  "'my_native' declares compute.kind 'native' — it is not a formula and cannot "
  + 'be admitted as one [gate:lane]'

/** `indicator_alert_service.NO_PLOT_TO_OFFER` — the ONE sentence that module
 *  writes for itself, for the omission no door refuses. It carries NO `[gate:]`
 *  suffix and its `gate` is `null`, because nothing gated it. */
const NO_PLOT_REFUSAL =
  'my_headless declares no plot, so it has no series address an alert could name'

let calls = []

/** `fetch` is the only stub. Everything above it — SWR, the fetcher, the hook,
 *  the component — is the shipped code. */
function stubFetch(body) {
  calls = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    calls.push({ url: u, method: (init && init.method) || 'GET' })
    if (u.startsWith(CATALOG)) return { ok: true, status: 200, json: async () => body }
    return { ok: true, status: 200, json: async () => ({ alerts: [] }) }
  })
}

function mount(props = {}) {
  return render(
    <AuthContext.Provider value={{ user: { id: 7 }, isPaid: true, loading: false }}>
      {/* A fresh cache per test — SWR would otherwise serve the previous case's
          answer for this key and issue no request at all, which would make every
          assertion here vacuous from the second test onward. */}
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnFocus: false }}>
        <IndicatorAlertPopover sym="AAPL" onClose={() => {}} {...props} />
      </SWRConfig>
    </AuthContext.Provider>,
  )
}

const reasons = () => screen.queryAllByTestId('alert-catalog-refusal-reason')
const rows = () => screen.queryAllByTestId('alert-catalog-refusal')
const optionValues = (name) => [...screen.getByLabelText(name).options].map((o) => o.value)

beforeEach(() => { calls = [] })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete global.fetch })

describe('the served `refusals` block reaches the member', () => {
  it('⭐ THE WIRE — a refused formula\'s OWN sentence reaches the DOM, word for word', async () => {
    stubFetch({
      catalog: RSI_ONLY,
      refusals: [{ id: 'my_ma', label: 'My MA', gate: 'repaint', messages: [REPAINT_REFUSAL] }],
    })
    mount()

    const reason = await screen.findByTestId('alert-catalog-refusal-reason')
    // ⛔ EQUALITY, NOT `toContain`. A client-side paraphrase beside the gate's
    // sentence is a SECOND source of truth for one refusal, and the two rot
    // apart the first time a door is reworded. This repo has already measured
    // what a second vocabulary costs (`williams_r` vs `williamsR`); `918e3c8a`
    // and `afbf0470` both settled on rendering the message unchanged.
    expect(reason.textContent).toBe(REPAINT_REFUSAL)
    // …and the member is told WHICH formula it is about.
    expect(screen.getByTestId('alert-catalog-refusal')).toHaveTextContent('My MA')
    // The whole answer came off the wire — nothing here was computed locally.
    expect(calls.some((c) => c.url === CATALOG)).toBe(true)
  })

  it('⭐ THE `[gate:…]` ATTRIBUTION SURVIVES — it is signal, not noise', async () => {
    // A DELIBERATE DECISION, recorded where it can fail. The suffix is the only
    // thing naming WHICH check refused the formula, and `REFUSAL_FRAGMENTS`'
    // pairwise disjointness is a SAFETY property asserted server-side precisely
    // because two gates once shared a phrase. The backend's own mutation B6
    // killed "the door's `[gate:]` attribution is stripped"; a strip HERE would
    // rebuild that defect one layer up, where no backend test can see it.
    stubFetch({
      catalog: RSI_ONLY,
      refusals: [{ id: 'my_ma', label: 'My MA', gate: 'repaint', messages: [REPAINT_REFUSAL] }],
    })
    mount()

    const reason = await screen.findByTestId('alert-catalog-refusal-reason')
    expect(reason.textContent).toContain('[gate:repaint]')
    // ⛔ …and the door is NOT printed a second time in a second spelling. The
    // row carries it as data for anyone querying the DOM; the member reads it
    // once, inside the sentence the door itself wrote.
    expect(screen.getByTestId('alert-catalog-refusal').getAttribute('data-gate')).toBe('repaint')
    expect(reason.textContent).toBe(REPAINT_REFUSAL)
  })

  it('⭐ EVERY message, not the first — `messages` is a list because a formula can fail twice', async () => {
    stubFetch({
      catalog: RSI_ONLY,
      refusals: [{
        id: 'my_ma', label: 'My MA', gate: 'repaint',
        messages: [REPAINT_REFUSAL, LANE_REFUSAL],
      }],
    })
    mount()

    await waitFor(() => expect(reasons()).toHaveLength(2))
    // The gates short-circuit on the first door TODAY. A surface that rendered
    // `messages[0]` would hide the second reason silently the day they stop —
    // which is the shape the backend chose a list to prevent.
    expect(reasons().map((n) => n.textContent)).toEqual([REPAINT_REFUSAL, LANE_REFUSAL])
  })

  it('⭐ a refusal the service could NOT attribute is still shown, under no door', async () => {
    // `NO_PLOT_TO_OFFER` is the one sentence `indicator_alert_service` writes for
    // itself, for the omission no gate refuses. Dropping a message that carries
    // no `[gate:]` would rebuild the original silence for exactly the formula
    // nobody can find — the case the complement exists to make TOTAL.
    stubFetch({
      catalog: RSI_ONLY,
      refusals: [{ id: 'my_headless', label: 'Headless', gate: null, messages: [NO_PLOT_REFUSAL] }],
    })
    mount()

    const reason = await screen.findByTestId('alert-catalog-refusal-reason')
    expect(reason.textContent).toBe(NO_PLOT_REFUSAL)
    expect(screen.getByTestId('alert-catalog-refusal').hasAttribute('data-gate')).toBe(false)
  })
})

describe('⛔ THE OTHER DIRECTION — an accepted formula is never given a reason', () => {
  it('⛔ CONTROL: nothing refused ⇒ no section, no heading, no warning about nothing', async () => {
    stubFetch({ catalog: [...RSI_ONLY, ACCEPTED_USER_DEF], refusals: [] })
    mount()

    // Wait for the served catalog to actually land, so this is an assertion
    // about a rendered answer and not about a component that has not fetched yet.
    await waitFor(() => expect(optionValues('Indicator')).toEqual(['rsi', 'my_slope']))
    expect(screen.queryByTestId('alert-catalog-refusals')).toBeNull()
    expect(rows()).toHaveLength(0)
    expect(screen.queryByText(/not offered/i)).toBeNull()
  })

  it('⭐⛔ BOTH DIRECTIONS AT ONCE — the admitted formula is offered and unexplained; '
    + 'the refused one is explained and unofferable', async () => {
    // This is the case a "render everything" implementation fails. One member,
    // two saved formulas, one of each verdict, in ONE response.
    stubFetch({
      catalog: [...RSI_ONLY, ACCEPTED_USER_DEF],
      refusals: [{ id: 'my_ma', label: 'My MA', gate: 'repaint', messages: [REPAINT_REFUSAL] }],
    })
    mount()

    await waitFor(() => expect(rows()).toHaveLength(1))
    // Exactly ONE row, and it is the refused one.
    expect(rows()[0].getAttribute('data-def-id')).toBe('my_ma')
    // The ADMITTED formula appears in no refusal row and in no reason.
    const refusalText = screen.getByTestId('alert-catalog-refusals').textContent
    expect(refusalText).not.toContain('my_slope')
    expect(refusalText).not.toContain('Slope of MA')
    // …and it is still offered, which is the whole point of not merging the two
    // lists.
    expect(optionValues('Indicator')).toEqual(['rsi', 'my_slope'])
    // ⛔ THE REFUSED ONE IS NOT AN OPTION. There is no address behind it, so an
    // entry among the offerings would be a control that arms nothing — the
    // reason `refusals` is a second KEY and never a row in `catalog`.
    expect(optionValues('Indicator')).not.toContain('my_ma')
  })

  it('⛔ the section is not an `alert` role — nothing just happened', async () => {
    // `IndicatorAlertPopover.test.jsx` reads `queryByRole('alert')` as "the last
    // submit was refused". Standing state about saved formulas must not answer
    // that question, or an accepted Add Alert would look refused.
    stubFetch({
      catalog: RSI_ONLY,
      refusals: [{ id: 'my_ma', label: 'My MA', gate: 'repaint', messages: [REPAINT_REFUSAL] }],
    })
    mount()

    await screen.findByTestId('alert-catalog-refusal-reason')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('⛔ a server that serves NO `refusals` key at all keeps the picker — and says nothing', async () => {
    // The rolling-deploy direction: this bundle against a server that predates
    // the block. Degrading to yesterday's silence is correct; losing the whole
    // form over a missing explanation is not, and inventing a reason would be
    // worse than either.
    stubFetch({ catalog: RSI_ONLY })
    mount()

    await waitFor(() => expect(optionValues('Indicator')).toEqual(['rsi']))
    expect(screen.queryByTestId('alert-catalog-refusals')).toBeNull()
  })
})
