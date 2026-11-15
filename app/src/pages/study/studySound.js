/**
 * studySound — the ONE device switch for Study's sound and haptics (spec §13.7 D11), shared by the switch and the
 * reveals. Settings → Study ("Sound and haptics") writes it; every reveal, combo and end sound reads it through
 * studyFeedback.feedbackPrefs.
 *
 * Until 2026-11-14 the two sides used different keys: the card wrote `uct.study.sound` ('1'/'0') while the reveals
 * read `study.sound` ('on'/'off'), which nothing wrote. The switch said "Saved." and changed nothing. The key the card
 * already wrote is kept, so every member's saved choice takes effect as it stands. No imports: the Settings page
 * loads this without the drill's sound and haptics code.
 */
export const SOUND_KEY = 'uct.study.sound'

export function isIOS() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

/** The member's saved choice: true, false, or undefined when they never chose (or storage is blocked). */
export function storedSound() {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(SOUND_KEY) : null
    if (raw === '1') return true
    if (raw === '0') return false
  } catch { /* private window */ }
  return undefined
}

/** The switch as it shows: the saved choice, else the device default (off on iOS first run, on elsewhere). */
export function soundOn() {
  const v = storedSound()
  return v === undefined ? !isIOS() : v
}

export function setSoundPref(on) {
  try { window.localStorage?.setItem(SOUND_KEY, on ? '1' : '0') } catch { /* private window */ }
}
