/**
 * studyFeedback — the sound + haptics decision for the reveal (spec §13.7 D11).
 *
 * Defaults: haptics on; sound OFF on iOS first run, ON on desktop. ONE toggle,
 * read from the profile (`sound_on`) when the profile carries it, else from
 * the device switch (studySound.js, set in Settings → Study), else the platform
 * default. Haptics fire only on the reveal and on tap-anchor placement; nothing
 * fires on choosing.
 */
import * as haptics from '../../components/mobile/haptics'
import { playStudyTone } from '../../utils/alertSound'
import { isIOS, setSoundPref, SOUND_KEY, storedSound } from './studySound'

export { isIOS, setSoundPref, SOUND_KEY }

export function feedbackPrefs(profile) {
  const stored = storedSound()
  let sound = profile && typeof profile.sound_on === 'boolean' ? profile.sound_on : stored
  if (sound === undefined) sound = !isIOS()
  // the switch is "Sound and haptics": switched off, both stop; otherwise haptics stay on (D11)
  const hapticsOn = profile && typeof profile.haptics_on === 'boolean' ? profile.haptics_on : stored !== false
  return { sound, haptics: hapticsOn }
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
