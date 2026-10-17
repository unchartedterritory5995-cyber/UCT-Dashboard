/**
 * studyFeedback — the sound + haptics decision for the reveal (spec §13.7 D11).
 *
 * Defaults: haptics on; sound OFF on iOS first run, ON on desktop. ONE toggle,
 * read from the profile (`sound_on`) when the profile carries it, else from
 * localStorage, else the platform default. Haptics fire only on the reveal and
 * on tap-anchor placement; nothing fires on choosing.
 */
import * as haptics from '../../components/mobile/haptics'
import { playStudyTone } from '../../utils/alertSound'

export const SOUND_KEY = 'study.sound'

export function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function feedbackPrefs(profile) {
  let sound
  if (profile && typeof profile.sound_on === 'boolean') sound = profile.sound_on
  else {
    try {
      const stored = window.localStorage?.getItem(SOUND_KEY)
      if (stored === 'on') sound = true
      else if (stored === 'off') sound = false
    } catch { /* private window */ }
  }
  if (sound === undefined) sound = !isIOS()
  const hapticsOn = profile && typeof profile.haptics_on === 'boolean' ? profile.haptics_on : true
  return { sound, haptics: hapticsOn }
}

export function setSoundPref(on) {
  try { window.localStorage?.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* private window */ }
}

/** Fire the reveal's feedback once: success / warn haptic, ding / descending tone. */
export function revealFeedback(correct, prefs) {
  if (prefs?.haptics !== false) {
    if (correct) haptics.success()
    else haptics.warn()
  }
  if (prefs?.sound) playStudyTone(correct ? 'correct' : 'wrong')
}

export function comboFeedback(combo, prefs) {
  if (prefs?.sound && (combo === 5 || combo === 10)) playStudyTone('combo')
}

export function endFeedback(prefs) {
  if (prefs?.sound) playStudyTone('end')
}

export function tapFeedback(prefs) {
  if (prefs?.haptics !== false) haptics.tap()
}
