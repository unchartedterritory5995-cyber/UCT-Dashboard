// The Settings → Study "Sound and haptics" switch and every Study reveal read ONE key (studySound.js). Until
// 2026-11-14 the card wrote `uct.study.sound` while the reveals read `study.sound`, which nothing wrote: the switch
// said "Saved." and changed nothing. These cases fail on that split.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { feedbackPrefs, SOUND_KEY as REVEAL_KEY } from './studyFeedback'
import { setSoundPref, soundOn, SOUND_KEY } from './studySound'
import { readSoundPref, SOUND_KEY as CARD_KEY } from '../../components/settings/StudySettingsCard'

const ua = (s) => vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(s)
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

afterEach(() => { localStorage.removeItem(SOUND_KEY); vi.restoreAllMocks() })

describe('one switch for Study sound and haptics', () => {
  it('the Settings card and the reveals name the same key', () => {
    expect(CARD_KEY).toBe(SOUND_KEY)
    expect(REVEAL_KEY).toBe(SOUND_KEY)
    expect(readSoundPref).toBe(soundOn)
  })

  it('switched off in Settings, the reveal plays no sound and no haptic', () => {
    ua(DESKTOP)
    setSoundPref(false)
    expect(localStorage.getItem('uct.study.sound')).toBe('0')
    expect(feedbackPrefs(null)).toEqual({ sound: false, haptics: false })
  })

  it('switched on in Settings, the reveal plays sound even on an iPhone', () => {
    ua(IPHONE)
    setSoundPref(true)
    expect(feedbackPrefs(null)).toEqual({ sound: true, haptics: true })
  })

  it('never chosen: sound off on an iPhone, on elsewhere, haptics on (D11)', () => {
    ua(IPHONE)
    expect(feedbackPrefs(null)).toEqual({ sound: false, haptics: true })
    expect(soundOn()).toBe(false)
    vi.restoreAllMocks(); ua(DESKTOP)
    expect(feedbackPrefs(null)).toEqual({ sound: true, haptics: true })
    expect(soundOn()).toBe(true)
  })

  it('a value the profile carries still wins over the device switch', () => {
    setSoundPref(false)
    expect(feedbackPrefs({ sound_on: true, haptics_on: true })).toEqual({ sound: true, haptics: true })
  })
})
