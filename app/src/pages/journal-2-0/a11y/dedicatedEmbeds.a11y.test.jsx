// app/src/pages/journal-2-0/a11y/dedicatedEmbeds.a11y.test.jsx
//
// Wave 10 Task 10.15 (R-46): the seven ready-made ("dedicated") widget embeds, each drawn from a REAL payload of be's
// own builders (widgets/__fixtures__/dedicatedPayloads.json) and each proven rendered before axe runs, so an empty
// widget cannot pass. One named recipe per embed (OUTSIDE_POPULATION_SURFACES in notebookSurfaces.js names them: the
// widgets/ folder is outside the derived population), then one recipe per kind and state from the table below:
// brand-new member, normal, past the limit, a part gap, a capped list, and every chart in "Show as table".
import { fireEvent, render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { axeSurface } from './surface'
import TiltCheckEmbed from '../components/notebook/widgets/TiltCheckEmbed'
import RevengeCleanEmbed from '../components/notebook/widgets/RevengeCleanEmbed'
import PlanVsActualEmbed from '../components/notebook/widgets/PlanVsActualEmbed'
import RiskLeftTodayEmbed from '../components/notebook/widgets/RiskLeftTodayEmbed'
import PropFirmEmbed from '../components/notebook/widgets/PropFirmEmbed'
import GamePlanEmbed from '../components/notebook/widgets/GamePlanEmbed'
import AlertsFiredEmbed from '../components/notebook/widgets/AlertsFiredEmbed'
import FIX from '../components/notebook/widgets/__fixtures__/dedicatedPayloads.json'

const EMBEDS = {
  myTiltCheck: TiltCheckEmbed,
  myRevengeClean: RevengeCleanEmbed,
  myPlanVsActual: PlanVsActualEmbed,
  myRiskLeftToday: RiskLeftTodayEmbed,
  myPropFirm: PropFirmEmbed,
  myGamePlan: GamePlanEmbed,
  myAlertsFired: AlertsFiredEmbed,
}

/** Draw a fixture as an editable placed widget (See it now and the share switch present), proving it rendered. */
function draw(name, { table = false } = {}) {
  const f = FIX[name]
  const Embed = EMBEDS[f.kind]
  const { container } = render(
    <Embed attrs={{ widgetId: f.kind, params: f.payload }} editable onUpdateParams={vi.fn(() => true)} />,
  )
  const first = (f.payload.lines || [])[0]
    || f.payload.wire?.lines?.[0]
    || f.payload.accounts?.[0]?.lines?.[0]
  if (first) expect(screen.getAllByText(first).length).toBeGreaterThan(0)
  if (table) {
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    expect(container.querySelector('table')).not.toBeNull()
  }
  return { root: container }
}

// [recipe id, fixture, show the table]
const STATES = [
  ['dedicated-tilt-new', 'tilt_new', false],
  ['dedicated-tilt-big', 'tilt_big', false],
  ['dedicated-tilt-capped', 'tilt_capped', false],
  ['dedicated-tilt-dates-only', 'tilt_dates_only', false],
  ['dedicated-tilt-table', 'tilt_normal', true],
  ['dedicated-revenge-new', 'revenge_new', false],
  ['dedicated-revenge-every-day', 'revenge_every_day', false],
  ['dedicated-revenge-dates-only', 'revenge_dates_only', false],
  ['dedicated-revenge-capped', 'revenge_capped', false],
  ['dedicated-revenge-not-read', 'revenge_not_read', false],
  ['dedicated-revenge-table', 'revenge_capped', true],
  ['dedicated-pva-new', 'pva_new', false],
  ['dedicated-pva-unlinked', 'pva_unlinked', false],
  ['dedicated-pva-no-stop', 'pva_no_stop', false],
  ['dedicated-pva-no-target', 'pva_no_target', false],
  ['dedicated-risk-new', 'risk_new', false],
  ['dedicated-risk-past', 'risk_past', false],
  ['dedicated-risk-unlinked', 'risk_unlinked', false],
  ['dedicated-risk-capped', 'risk_capped', false],
  ['dedicated-risk-none-used', 'risk_none_used', false],
  ['dedicated-risk-table', 'risk_past', true],
  ['dedicated-prop-new', 'prop_new', false],
  ['dedicated-prop-new-limits', 'prop_new_limits', false],
  ['dedicated-prop-past', 'prop_past', false],
  ['dedicated-prop-foreign-account', 'prop_foreign_account', false],
  ['dedicated-prop-clipped', 'prop_clipped', false],
  ['dedicated-prop-table', 'prop_past', true],
  ['dedicated-game-new', 'game_new', false],
  ['dedicated-game-wire-gap', 'game_wire_gap', false],
  ['dedicated-game-reporting-gap', 'game_reporting_gap', false],
  ['dedicated-game-capped', 'game_capped', false],
  ['dedicated-alerts-new', 'alerts_new', false],
  ['dedicated-alerts-capped', 'alerts_capped', false],
  ['dedicated-alerts-one-log-gap', 'alerts_one_log_gap', false],
  // Fix round 1 (review M-12, I-1, I-3): the states round 0 had no fixture for.
  ['dedicated-revenge-mixed', 'revenge_mixed', false],
  ['dedicated-revenge-every-day-dates-only', 'revenge_every_day_dates_only', false],
  ['dedicated-revenge-mixed-table', 'revenge_mixed', true],
  ['dedicated-revenge-new-table', 'revenge_new', true],
  ['dedicated-tilt-zero', 'tilt_zero', false],
  ['dedicated-tilt-zero-table', 'tilt_zero', true],
  ['dedicated-risk-no-size', 'risk_no_size', false],
  ['dedicated-risk-mixed', 'risk_mixed', false],
  ['dedicated-risk-mixed-table', 'risk_mixed', true],
  ['dedicated-risk-unread', 'risk_unread', false],
  ['dedicated-prop-excluded', 'prop_excluded', false],
  ['dedicated-prop-no-limits', 'prop_no_limits', false],
  ['dedicated-game-risk-gap', 'game_risk_gap', false],
  ['dedicated-alerts-both-gap', 'alerts_both_gap', false],
]

describe('wave 10 Task 10.15 surfaces (the dedicated widget embeds)', () => {
  axeSurface('dedicated-tilt-check', async () => draw('tilt_normal'))
  axeSurface('dedicated-revenge-clean', async () => draw('revenge_normal'))
  axeSurface('dedicated-plan-vs-actual', async () => draw('pva_normal'))
  axeSurface('dedicated-risk-left-today', async () => draw('risk_normal'))
  axeSurface('dedicated-prop-firm', async () => draw('prop_normal'))
  axeSurface('dedicated-game-plan', async () => draw('game_normal'))
  axeSurface('dedicated-alerts-fired', async () => draw('alerts_normal'))

  for (const [id, name, table] of STATES) {
    axeSurface(id, async () => draw(name, { table }))
  }
})
