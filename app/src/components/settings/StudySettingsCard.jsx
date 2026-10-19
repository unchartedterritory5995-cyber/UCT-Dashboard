// Settings → Study (spec 2026-10-17 §1.10, §13.7 D11/D14): the daily goal
// (silent default 50 — the chooser lives HERE and nowhere on the panel), the
// reminder time and its switch, one sound-and-haptics toggle, the
// leaderboard "Hide me", and the journal-autopsy opt-in.
//
// Every server-side value writes `PUT /api/study/profile` with only the key
// that changed (study_profile is the store — T19: NO setPref key is added
// here). Sound/haptics is a DEVICE preference (D11: haptics on, sound off
// on iOS first run, on on desktop), so it lives in localStorage, not the
// profile. Feedback is rendered TEXT ("Saved." / "Could not save") — never
// a state the member cannot see.
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import TileCard from '../TileCard'
import Checkbox from '../ui/Checkbox'
import Input from '../ui/Input'
import Select from '../ui/Select'
import styles from '../../pages/Settings.module.css'
import { useStudyProfile, putStudyProfile } from '../../pages/study/useStudy'

export const GOALS = [20, 50, 100]
export const DEFAULT_GOAL = 50
export const DEFAULT_REMINDER = '07:00'
export const SOUND_KEY = 'uct.study.sound'
export const REMINDER_COPY = "Today's Study is ready — 10 questions, about 4 minutes."

const isIOS = () =>
  typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent || '')

export function readSoundPref() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(SOUND_KEY) : null
    if (raw === '1') return true
    if (raw === '0') return false
  } catch { /* storage blocked — fall through to the device default */ }
  return !isIOS()
}

function writeSoundPref(on) {
  try { localStorage.setItem(SOUND_KEY, on ? '1' : '0') } catch { /* storage blocked */ }
}

export default function StudySettingsCard() {
  const { studyEnabled } = useAuth() || {}
  const { data, mutate } = useStudyProfile(studyEnabled !== false)
  const profile = data?.profile || null
  const [status, setStatus] = useState('')
  const [sound, setSound] = useState(readSoundPref)
  useEffect(() => { setStatus('') }, [profile?.updated_at])

  if (studyEnabled === false) return null

  const save = async (patch) => {
    setStatus('')
    try {
      const res = await putStudyProfile(patch)
      await mutate?.(res?.profile ? { ...(data || {}), profile: res.profile } : undefined, { revalidate: false })
      setStatus('Saved.')
    } catch {
      setStatus('Could not save — try again.')
    }
  }

  const goal = Number(profile?.daily_goal) || DEFAULT_GOAL
  const reminderOn = !!profile?.reminder_on
  const reminderTime = profile?.reminder_time || DEFAULT_REMINDER

  return (
    <TileCard icon="book" title="Study">
      {data === undefined && <div className={styles.prefDesc}>Loading your Study settings…</div>}
      {data === null && <div className={styles.prefDesc}>Study is not available on this account yet.</div>}
      {profile && (
        <div className={styles.section}>
          <div className={styles.prefRow}>
            <div className={styles.prefLabelGroup}>
              <label className={styles.prefLabel} htmlFor="study-daily-goal">Daily goal</label>
              <span className={styles.prefDesc}>XP a day. Today's Study alone covers the default.</span>
            </div>
            <Select
              id="study-daily-goal"
              className={styles.select}
              value={String(GOALS.includes(goal) ? goal : DEFAULT_GOAL)}
              onChange={(e) => save({ daily_goal: Number(e.target.value) })}
            >
              {GOALS.map((g) => <option key={g} value={String(g)}>{g} XP</option>)}
            </Select>
          </div>

          <div className={styles.prefRow}>
            <div className={styles.prefLabelGroup}>
              <label className={styles.prefLabel} htmlFor="study-reminder-on">Daily reminder</label>
              <span className={styles.prefDesc}>One a day, at your time: "{REMINDER_COPY}"</span>
            </div>
            <Checkbox
              id="study-reminder-on"
              checked={reminderOn}
              onChange={(e) => save({ reminder_on: e.target.checked, reminder_time: reminderTime })}
            />
          </div>

          <div className={styles.prefRow}>
            <div className={styles.prefLabelGroup}>
              <label className={styles.prefLabel} htmlFor="study-reminder-time">Reminder time</label>
              <span className={styles.prefDesc}>Eastern time.</span>
            </div>
            <Input
              id="study-reminder-time"
              type="time"
              value={reminderTime}
              disabled={!reminderOn}
              onChange={(e) => e.target.value && save({ reminder_time: e.target.value })}
            />
          </div>

          <div className={styles.prefRow}>
            <div className={styles.prefLabelGroup}>
              <label className={styles.prefLabel} htmlFor="study-sound">Sound and haptics</label>
              <span className={styles.prefDesc}>A tone on the reveal, a tap when you place a level. This device only.</span>
            </div>
            <Checkbox
              id="study-sound"
              checked={sound}
              onChange={(e) => { writeSoundPref(e.target.checked); setSound(e.target.checked); setStatus('Saved.') }}
            />
          </div>

          <div className={styles.prefRow}>
            <div className={styles.prefLabelGroup}>
              <label className={styles.prefLabel} htmlFor="study-hide-me">Hide me on the weekly board</label>
              <span className={styles.prefDesc}>You still earn XP; your name just stays off "This week at the Desk".</span>
            </div>
            <Checkbox
              id="study-hide-me"
              checked={!!profile.leaderboard_optout}
              onChange={(e) => save({ leaderboard_optout: e.target.checked })}
            />
          </div>

          <div className={styles.prefRow}>
            <div className={styles.prefLabelGroup}>
              <label className={styles.prefLabel} htmlFor="study-autopsy">Use my journal in Study</label>
              <span className={styles.prefDesc}>Lets Study build autopsy questions from your own closed trades.</span>
            </div>
            <Checkbox
              id="study-autopsy"
              checked={!!profile.journal_autopsy_optin}
              onChange={(e) => save({ journal_autopsy_optin: e.target.checked })}
            />
          </div>

          <div className={styles.prefDesc} role="status" aria-live="polite">{status}</div>
        </div>
      )}
    </TileCard>
  )
}
