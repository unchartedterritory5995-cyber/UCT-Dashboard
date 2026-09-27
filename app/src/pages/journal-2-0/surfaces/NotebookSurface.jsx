/**
 * Notebook surface — its own top-level Journal route (/journal/notebook).
 * Renders the existing NotebookTab directly; the old Calendar|Notebook segment
 * pill is gone now that Calendar and Notebook are separate primary nav tabs.
 *
 * ⛔⛔ WAVE K's GATE, ON THE ROUTE MEMBERS ACTUALLY USE (wave 10, lane 10C, F-8).
 * `NotebookFlagGate` was mounted only by the legacy v8 `JournalTwoRoot`, so on
 * this v5 route `notebook_config_served` never fired and K-1's precondition — a
 * MEASURED config-served rate — had no numerator and no denominator. The kill
 * switch itself already reached v5 (AuthContext latches the flags in the same
 * synchronous block as `setUser`, and AuthGuard holds the route until
 * /api/auth/me answers), so here the gate is normally already open: it renders
 * NotebookTab on its first render and reports `served: true`. What it adds is
 * the measurement, and §21's guarantee for the case the latch has not landed.
 * Rail: surfaces/NotebookSurface.gate.test.jsx.
 */

import NotebookTab from '../tabs/NotebookTab'
import NotebookFlagGate from '../components/notebook/NotebookFlagGate'

export default function NotebookSurface() {
  return (
    <NotebookFlagGate>
      <NotebookTab />
    </NotebookFlagGate>
  )
}
