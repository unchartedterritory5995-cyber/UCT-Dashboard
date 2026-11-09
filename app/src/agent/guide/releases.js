// ⭐ A control behind a release switch: the guide reads the SAME accessor the widget renders from, at the moment the walkthrough
// starts. Switch on: the walkthrough runs as designed. Switch off: nothing is rung and the member is told plainly that it isn't
// available yet. Never "pick a scan first" for a button no member can see.
//
// A step carries `release: '<name>'`; each name is one accessor and the sentence that is true while it is off.
import { captureEnabled } from '../../widgets/captureRelease'

export const RELEASES = {
  // widgets/captureRelease.js: Wave R's capture doors (the Scanner's Send to Journal, pages/charts/widgets/ScannerResults.jsx)
  capture: { on: () => captureEnabled(), off: 'Sending a scan to the Journal isn’t available yet. It will show in the Scanner widget once it’s switched on.' },
}

/** → the steps unchanged, or the sentence to say instead when a step's release is off (or can't be read). */
export function releasedOnly(steps) {
  const step = (steps || []).find(s => s && s.release)
  if (!step) return steps
  const r = RELEASES[step.release]
  if (!r) return steps
  let on = false
  try { on = !!r.on() } catch { on = false }
  return on ? steps : (step.releaseOff || r.off)
}
