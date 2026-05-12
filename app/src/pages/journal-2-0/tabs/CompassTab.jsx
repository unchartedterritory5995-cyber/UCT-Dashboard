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
import useJ2EODRecaps from '../hooks/useJ2EODRecaps'
import CompassReview from '../components/CompassReview'
import EODRecap from '../components/EODRecap'
import TraderProfileEditor from '../components/TraderProfileEditor'
import CompassChat from '../components/CompassChat'
import useInterventions from '../hooks/useInterventions'
import InterventionBanner from '../components/InterventionBanner'
import useProfileSuggestions from '../hooks/useProfileSuggestions'
import useCompassOverview from '../hooks/useCompassOverview'
import CompassOverview from '../components/CompassOverview'

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

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

export default function CompassTab() {
  const { accountId } = useJ2SelectedAccount()
  const { interventions, dismiss: dismissIntervention } = useInterventions(accountId)
  const { suggestions: profileSuggestions, dismiss: dismissSuggestion } = useProfileSuggestions(accountId)
  const { settings } = useJ2Settings()
  const { reviews, isLoading, error, generate, regenerate, feedback, forget } = useJ2CoachReviews(accountId)
  const {
    recaps: eodRecaps,
    isLoading: eodLoading,
    generate: generateEod,
    regenerate: regenerateEod,
    feedback: eodFeedback,
    forget: forgetEod,
  } = useJ2EODRecaps(accountId)
  const { profile, save: saveProfile, refresh: refreshProfile } = useJ2TraderProfile(accountId)
  const { overview } = useCompassOverview(accountId)
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

      <CompassOverview overview={overview} />

      <InterventionBanner
        interventions={interventions}
        onDismiss={dismissIntervention}
      />

      {profileSuggestions.length > 0 && (
        <div style={{
          margin: '8px 0', padding: '10px 14px',
          background: 'rgba(201,168,76,0.08)',
          border: '1px solid rgba(201,168,76,0.5)',
          borderRadius: 6,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 10,
        }}>
          <div style={{ fontSize: 12 }}>
            <strong style={{ color: 'var(--ut-gold, #c9a84c)' }}>🧭 Compass wants to refine its understanding of you.</strong>
            <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>
              {profileSuggestions.length} pending suggestion{profileSuggestions.length === 1 ? '' : 's'} from your recent feedback. Start a chat to walk through them.
            </div>
          </div>
          <button
            type="button"
            onClick={() => profileSuggestions.forEach((s) => dismissSuggestion(s.id))}
            style={{
              padding: '4px 12px', fontSize: 11,
              background: 'transparent', color: 'var(--text-muted)',
              border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
            }}
          >Dismiss all</button>
        </div>
      )}

      <CompassChat accountId={accountId} />

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

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, color: 'var(--ut-gold, #c9a84c)', marginBottom: 8 }}>
          Daily Recaps
        </h2>

        {(() => {
          const today = todayISO()
          const haveToday = eodRecaps.some((r) => (r.day || r.metadata?.day) === today)
          if (!haveToday) {
            return (
              <div
                style={{
                  margin: '8px 0',
                  padding: '10px 14px',
                  background: 'rgba(201,168,76,0.06)',
                  border: '1px solid rgba(201,168,76,0.3)',
                  borderRadius: 6,
                  fontSize: 13,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span>No recap yet for today ({today}).</span>
                <button
                  type="button"
                  onClick={async () => {
                    setErrorMsg(null)
                    setGenerating(true)
                    try {
                      const out = await generateEod()
                      if (out?.skipped) {
                        setErrorMsg('No activity today — Compass took the day off.')
                      }
                    } catch (e) {
                      setErrorMsg(String(e.message || e))
                    } finally {
                      setGenerating(false)
                    }
                  }}
                  disabled={generating}
                  style={{
                    padding: '4px 12px', fontSize: 12, fontWeight: 600,
                    background: 'var(--ut-gold, #c9a84c)', color: '#000',
                    border: 'none', borderRadius: 4, cursor: 'pointer',
                  }}
                >
                  {generating ? 'Working…' : "Generate today's recap →"}
                </button>
              </div>
            )
          }
          return null
        })()}

        {eodLoading && eodRecaps.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading recaps…</p>
        )}

        {eodRecaps.slice(0, 7).map((r) => (
          <EODRecap
            key={r.id}
            recap={r}
            onFeedback={(v) => eodFeedback(r.id, v)}
            onRegenerate={async () => {
              try {
                await regenerateEod(r.id)
              } catch (e) {
                setErrorMsg(String(e.message || e))
              }
            }}
            onForget={() => forgetEod(r.id)}
          />
        ))}
      </section>

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
