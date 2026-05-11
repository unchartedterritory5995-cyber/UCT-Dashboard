/**
 * Compass tab — top-level J2 surface for Phase G v1.
 *
 * Lists weekly reviews, exposes a Generate CTA when this week's review is
 * missing, renders the Trader Profile editor at the bottom.
 */

import { useState } from 'react'
import bannerStyles from '../components/AlertBanner.module.css'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import useJ2CoachReviews from '../hooks/useJ2CoachReviews'
import useJ2TraderProfile from '../hooks/useJ2TraderProfile'
import useJ2Settings from '../hooks/useJ2Settings'
import CompassReview from '../components/CompassReview'
import TraderProfileEditor from '../components/TraderProfileEditor'

function mostRecentClosedMondayISO() {
  const now = new Date()
  // JS getDay(): 0=Sun..6=Sat. Convert to Mon=0..Sun=6 for math.
  const md = (now.getDay() + 6) % 7
  // If today is Sat (md=5) or Sun (md=6), this week's Fri has closed.
  // If today is Mon-Fri (md=0..4), the prior week's Fri has closed.
  const daysBackToFriday = md >= 5 ? md - 4 : md + 3
  const friday = new Date(now)
  friday.setDate(now.getDate() - daysBackToFriday)
  const monday = new Date(friday)
  monday.setDate(friday.getDate() - 4)
  return monday.toISOString().slice(0, 10)
}

export default function CompassTab() {
  const { accountId } = useJ2SelectedAccount()
  const { settings } = useJ2Settings()
  const { reviews, isLoading, error, generate, regenerate, feedback, forget } = useJ2CoachReviews(accountId)
  const { profile, save: saveProfile, refresh: refreshProfile } = useJ2TraderProfile(accountId)
  const [generating, setGenerating] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  if (!accountId) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        Select a single account to view Compass reviews.
      </div>
    )
  }

  const compassEnabled = settings?.compassEnabled !== false
  if (!compassEnabled) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)' }}>
        <h1 style={{ fontSize: 22, marginBottom: 8 }}>Compass</h1>
        <p style={{ fontSize: 13 }}>
          Compass is disabled for this account. Re-enable it in
          <strong> Settings → COMPASS</strong> to generate new weekly reviews.
        </p>
      </div>
    )
  }

  const expectedWeek = mostRecentClosedMondayISO()
  const haveCurrent = reviews.some((r) => (r.week_start || r.metadata?.week_start) === expectedWeek)

  const onGenerate = async (weekStart) => {
    setErrorMsg(null)
    setGenerating(true)
    try {
      await generate(weekStart)
      await refreshProfile()
    } catch (e) {
      setErrorMsg(String(e.message || e))
    } finally {
      setGenerating(false)
    }
  }

  const onClearProfile = async () => {
    try {
      await saveProfile('')
    } catch (e) {
      setErrorMsg(String(e.message || e))
    }
  }

  return (
    <div style={{ padding: '16px 20px' }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>🧭 Compass</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
        Your trading coach. Generates a weekly review of your closed trades,
        what worked, what didn't, and what to focus on next.
      </p>

      {errorMsg && (
        <div role="alert" className={bannerStyles.alertSm} style={{ margin: '12px 0' }}>
          {errorMsg}
        </div>
      )}

      {!haveCurrent && (
        <div
          className={bannerStyles.info}
          style={{ margin: '16px 0', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <span style={{ fontSize: 13 }}>
            No review yet for the week of <strong>{expectedWeek}</strong>.
          </span>
          <button
            type="button"
            onClick={() => onGenerate(expectedWeek)}
            disabled={generating}
            className={bannerStyles.infoCtaBtn}
          >
            {generating ? 'Compass is reviewing your week…' : 'Generate this week\'s review →'}
          </button>
        </div>
      )}

      {isLoading && reviews.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading reviews…</p>
      )}

      {error && (
        <p role="alert" style={{ color: 'var(--loss, #ef4444)', fontSize: 13 }}>
          Couldn't load reviews: {String(error.message || error)}
        </p>
      )}

      {reviews.map((r) => (
        <CompassReview
          key={r.id}
          review={r}
          onFeedback={(v) => feedback(r.id, v)}
          onRegenerate={async () => {
            try {
              setGenerating(true)
              await regenerate(r.id)
              await refreshProfile()
            } catch (e) {
              setErrorMsg(String(e.message || e))
            } finally {
              setGenerating(false)
            }
          }}
          onForget={() => forget(r.id)}
        />
      ))}

      {!isLoading && reviews.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          No reviews yet. Click "Generate" above to write your first one.
        </p>
      )}

      <TraderProfileEditor
        profile={profile}
        onSave={saveProfile}
        onClear={onClearProfile}
      />
    </div>
  )
}
