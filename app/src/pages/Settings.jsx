import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import usePreferences from '../hooks/usePreferences'
import TileCard from '../components/TileCard'
import ColorPicker from '../components/chart/ColorPicker'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from '../components/chart/chartDefaults'
import useTagColors from '../hooks/useTagColors'
import { ALERT_SOUNDS, previewSound } from '../utils/alertSound'
import VoiceMemoryPanel from '../components/voice/VoiceMemoryPanel'
import VoiceTelemetryPanel from '../components/voice/VoiceTelemetryPanel'
import VoiceSessionsPanel from '../components/voice/VoiceSessionsPanel'
import VoiceDocumentsPanel from '../components/voice/VoiceDocumentsPanel'
import VoiceInsightsPanel from '../components/voice/VoiceInsightsPanel'
import BrokerConnectionsCard from './journal-2-0/components/BrokerConnectionsCard'
import { useVoice } from '../context/VoiceContext'
import { formatETDate } from '../utils/timeAgo'
import UIcon from '../components/ui/UIcon'
import styles from './Settings.module.css'

const TF_OPTIONS = [
  { value: '5', label: '5 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hr' },
  { value: 'D', label: 'Daily' },
  { value: 'W', label: 'Weekly' },
]

const THEME_OPTIONS = [
  { value: 'midnight', label: 'Midnight', desc: 'Deep dark green', swatch: '#0e0f0d' },
  { value: 'oled', label: 'OLED Black', desc: 'Pure black for AMOLED', swatch: '#000000' },
  { value: 'dim', label: 'Dim', desc: 'Softer for daytime', swatch: '#1a1d1a' },
  { value: 'system', label: 'System', desc: 'Match your OS', swatch: null },
]

// ── Helpers ──
function formatDate(dateStr) {
  if (!dateStr) return '—'
  return formatETDate(dateStr) || '—'
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return null
  const diff = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  return diff
}

function memberDuration(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  const now = Date.now()
  const diffMs = now - d.getTime()
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (days < 1) return 'Today'
  if (days < 30) return `${days} day${days !== 1 ? 's' : ''}`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} month${months !== 1 ? 's' : ''}`
  const years = Math.floor(months / 12)
  const rem = months % 12
  return rem > 0 ? `${years}y ${rem}mo` : `${years} year${years !== 1 ? 's' : ''}`
}

// ── Avatar Upload ──
function AvatarUpload({ user }) {
  const fileRef = useRef(null)
  const [avatarUrl, setAvatarUrl] = useState(null)
  const [uploading, setUploading] = useState(false)

  const userId = user?.id
  const initial = (user?.display_name || user?.email || '?')[0].toUpperCase()

  useEffect(() => {
    if (!userId) return
    // Check if avatar exists (non-transparent response)
    fetch(`/api/auth/avatar/${userId}`)
      .then(r => {
        if (r.ok && r.headers.get('content-type')?.includes('webp')) {
          setAvatarUrl(`/api/auth/avatar/${userId}?t=${Date.now()}`)
        }
      })
      .catch(() => {})
  }, [userId])

  async function handleUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/auth/avatar', { method: 'POST', body: fd })
      if (res.ok) {
        setAvatarUrl(`/api/auth/avatar/${userId}?t=${Date.now()}`)
      }
    } catch { /* ignore */ }
    finally { setUploading(false) }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleRemove() {
    await fetch('/api/auth/avatar', { method: 'DELETE' }).catch(() => {})
    setAvatarUrl(null)
  }

  return (
    <div className={styles.avatarSection}>
      <div className={styles.avatarCircle}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className={styles.avatarImg} />
        ) : (
          <span className={styles.avatarInitials}>{initial}</span>
        )}
      </div>
      <div className={styles.avatarActions}>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={handleUpload}
        />
        <button
          className={styles.avatarChangeBtn}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading...' : 'Change Photo'}
        </button>
        {avatarUrl && (
          <button className={styles.avatarRemoveBtn} onClick={handleRemove}>
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

// ── Compass Voice Picker (P3-A unification) ──
// Renders all 8 OpenAI Realtime voices with a Preview button that hits
// /api/voice/tts with a 10-second sample phrase so the user can hear each
// voice before committing.
const COMPASS_VOICES = [
  { id: 'alloy',   label: 'Alloy',   blurb: 'Sharp, neutral, professional.' },
  { id: 'ash',     label: 'Ash',     blurb: 'Calm, firm — head-trader presence.' },
  { id: 'ballad',  label: 'Ballad',  blurb: 'Warm, slightly storyteller.' },
  { id: 'coral',   label: 'Coral',   blurb: 'Conversational, approachable.' },
  { id: 'echo',    label: 'Echo',    blurb: 'Steady, measured cadence.' },
  { id: 'sage',    label: 'Sage',    blurb: 'Soft, thoughtful, deliberate.' },
  { id: 'shimmer', label: 'Shimmer', blurb: 'Bright, supportive, coach-like.' },
  { id: 'verse',   label: 'Verse',   blurb: 'Energetic, news-desk feel.' },
]

const COMPASS_VOICE_SAMPLE =
  "Hey — I'm Compass. Breadth score is sixty-five, regime is amber, " +
  "and you're three trades into the week. Ask me anything."

function CompassVoicePicker({ value, onChange, enabled }) {
  const [previewing, setPreviewing] = useState(null)
  const audioRef = useRef(null)

  const stopPreview = () => {
    try {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.src = ''
      }
    } catch { /* ignore */ }
    setPreviewing(null)
  }

  const preview = async (voiceId) => {
    if (previewing === voiceId) {
      stopPreview()
      return
    }
    stopPreview()
    setPreviewing(voiceId)
    try {
      const r = await fetch('/api/voice/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: COMPASS_VOICE_SAMPLE,
          voice: voiceId,
          speed: 1.0,
        }),
      })
      if (!r.ok) {
        setPreviewing(null)
        return
      }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => setPreviewing(null)
      audio.onerror = () => setPreviewing(null)
      await audio.play()
    } catch {
      setPreviewing(null)
    }
  }

  // Stop on unmount
  useEffect(() => () => stopPreview(), [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      {COMPASS_VOICES.map((v) => {
        const selected = value === v.id
        const isPlaying = previewing === v.id
        return (
          <div
            key={v.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '6px 10px',
              border: `1px solid ${selected ? 'var(--ut-gold, #c9a84c)' : 'var(--border)'}`,
              borderRadius: 4,
              background: selected ? 'rgba(201, 168, 76, 0.08)' : 'transparent',
              cursor: enabled ? 'pointer' : 'not-allowed',
              opacity: enabled ? 1 : 0.5,
            }}
            onClick={() => enabled && onChange(v.id)}
          >
            <input
              type="radio"
              name="compass-voice"
              checked={selected}
              onChange={() => enabled && onChange(v.id)}
              disabled={!enabled}
              onClick={(e) => e.stopPropagation()}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{v.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{v.blurb}</div>
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); preview(v.id) }}
              disabled={!enabled}
              style={{
                padding: '4px 10px', fontSize: 11,
                background: isPlaying ? 'var(--ut-gold, #c9a84c)' : 'transparent',
                color: isPlaying ? '#000' : 'var(--ut-gold, #c9a84c)',
                border: '1px solid var(--ut-gold, #c9a84c)',
                borderRadius: 3, cursor: enabled ? 'pointer' : 'not-allowed',
              }}
              title={isPlaying ? 'Stop preview' : 'Hear this voice'}
            >
              {isPlaying ? '■ Stop' : '▶ Preview'}
            </button>
          </div>
        )
      })}
    </div>
  )
}


// ── Voice Panel ──
function VoicePanel() {
  const [settings, setSettings] = useState(null)
  const [usage, setUsage] = useState(null)
  const [savingMsg, setSavingMsg] = useState('')
  const speedSaveTimerRef = useRef(null)
  const { wakeEnabled, setWakeEnabled } = useVoice()

  useEffect(() => {
    try {
      const persisted = localStorage.getItem('voice.wakeEnabled') === '1'
      if (persisted) setWakeEnabled(true)
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const debouncedSpeedSave = (newSpeed) => {
    if (speedSaveTimerRef.current) {
      clearTimeout(speedSaveTimerRef.current)
    }
    speedSaveTimerRef.current = setTimeout(() => {
      update({ speed: newSpeed })
    }, 400)
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/voice/settings', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
      fetch('/api/voice/usage', { credentials: 'include' }).then(r => r.ok ? r.json() : null),
    ]).then(([s, u]) => {
      if (cancelled) return
      setSettings(s)
      setUsage(u)
    })
    return () => { cancelled = true }
  }, [])

  if (!settings) {
    return <TileCard icon="compass" title="Compass"><div style={{ opacity: 0.7 }}>Compass voice features require a paid plan.</div></TileCard>
  }

  const update = async (patch) => {
    setSavingMsg('Saving…')
    const r = await fetch('/api/voice/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (r.ok) {
      const next = await r.json()
      setSettings(next)
      setSavingMsg('Saved ✓')
      setTimeout(() => setSavingMsg(''), 1500)
    } else {
      setSavingMsg('Save failed')
    }
  }

  // Voice list moved to CompassVoicePicker (P3-A unification).
  const usedSec = usage?.mode_a_seconds ?? 0
  const capSec = usage?.cap_seconds ?? null
  const pct = capSec ? Math.min(100, Math.round((usedSec / capSec) * 100)) : 0

  return (
    <TileCard icon="compass" title="Compass">
      <div className={styles.voiceRow}>
        <label className={styles.voiceLabel}>
          <input
            type="checkbox"
            checked={!!settings.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          {' '}Compass voice + read-aloud enabled
        </label>
      </div>

      <div className={styles.voiceRow}>
        <label className={styles.voiceLabel}>
          <input
            type="checkbox"
            checked={!!wakeEnabled}
            onChange={(e) => {
              setWakeEnabled(e.target.checked)
              try { localStorage.setItem('voice.wakeEnabled', e.target.checked ? '1' : '0') } catch {}
            }}
          />
          {' '}Wake word: say "Jarvis" — hands-free Compass activation
        </label>
      </div>

      <div className={styles.voiceRow}>
        <label className={styles.voiceLabel}>
          <input
            type="checkbox"
            checked={!!settings.proactive_speak}
            onChange={(e) => update({ proactive_speak: e.target.checked })}
          />
          {' '}Compass can speak proactive alerts (regime flips, tilt, intervention rules)
        </label>
      </div>

      <div className={styles.voiceRow}>
        <span className={styles.voiceLabel}>Voice</span>
        <CompassVoicePicker
          value={settings.voice}
          onChange={(v) => update({ voice: v })}
          enabled={!!settings.enabled}
        />
      </div>

      <div className={styles.voiceRow}>
        <span className={styles.voiceLabel}>Speed</span>
        <input
          type="range"
          min="0.5"
          max="2.0"
          step="0.05"
          value={settings.speed}
          onChange={(e) => {
            const newSpeed = parseFloat(e.target.value)
            // Update UI immediately (no PUT) so slider feels responsive
            setSettings((s) => ({ ...s, speed: newSpeed }))
            // Debounce the actual server save
            debouncedSpeedSave(newSpeed)
          }}
        />
        <span className={styles.voiceVal}>{settings.speed.toFixed(2)}×</span>
      </div>

      <div className={styles.voiceRow}>
        <span className={styles.voiceLabel}>This month</span>
        {usage?.uncapped ? (
          <span className={styles.voiceVal}>{Math.round(usedSec / 60)} min · uncapped</span>
        ) : (
          <>
            <div className={styles.voiceMeter}>
              <div className={styles.voiceMeterFill} style={{ width: `${pct}%` }} />
            </div>
            <span className={styles.voiceVal}>
              {Math.round(usedSec / 60)} / {Math.round((capSec || 0) / 60)} min
            </span>
          </>
        )}
      </div>

      <div style={{
        marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)',
      }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: 'var(--ut-gold, #c9a84c)',
          marginBottom: 8,
        }}>
          Ways to talk to Compass
        </div>
        <ul style={{
          margin: 0, padding: 0, listStyle: 'none',
          display: 'flex', flexDirection: 'column', gap: 7,
          fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5,
        }}>
          <li><strong style={{ color: 'var(--text-bright)' }}><UIcon name="mic" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Dictate</strong> — push-to-talk into any journal text field (notes, thesis, recaps). High-accuracy Whisper transcription with auto-cleanup.</li>
          <li><strong style={{ color: 'var(--text-bright)' }}><UIcon name="compass" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Assist / <UIcon name="mic" size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />Talk</strong> — opens a full voice conversation with Compass that already knows the trade, note, or review you're looking at.</li>
          <li><strong style={{ color: 'var(--text-bright)' }}>Floating orb</strong> — bottom-right on every page; tap to speak to Compass from anywhere.</li>
          <li><strong style={{ color: 'var(--text-bright)' }}>Push-to-talk hotkey</strong> — hold the spacebar shortcut for a quick voice question without leaving the keyboard.</li>
          <li><strong style={{ color: 'var(--text-bright)' }}>Wake word</strong> — say "Jarvis" (toggle above) for fully hands-free activation.</li>
          <li><strong style={{ color: 'var(--text-bright)' }}>Read-aloud</strong> — Compass speaks the Morning Wire, UCT 20 picks, post-mortems, and EOD recaps on request.</li>
        </ul>
      </div>

      {savingMsg && <div className={styles.voiceSaveMsg}>{savingMsg}</div>}
    </TileCard>
  )
}

// ── Referral Section ──
// ─── Chart Settings Section ──────────────────────────────────────────────────

const CHART_TYPES = [
  { value: 'candles', label: 'Candles' },
  { value: 'hollow',  label: 'Hollow' },
  { value: 'bars',    label: 'Bars' },
  { value: 'line',    label: 'Line' },
  { value: 'area',    label: 'Area' },
]

const CROSSHAIR_STYLES = [
  { value: 0, label: 'Solid' },
  { value: 2, label: 'Dashed' },
  { value: 3, label: 'Dotted' },
]

const DRAWING_WIDTHS = [1, 2, 3]

function ChartSettingsSection({ prefs, setPref }) {
  const cs = useMemo(() => mergeChartSettings(prefs.chart_settings), [prefs.chart_settings])

  const update = useCallback((path, value) => {
    const next = { ...cs }
    const parts = path.split('.')
    if (parts.length === 3 && parts[0] === 'overlays') {
      const [, idx, field] = parts
      next.overlays = next.overlays.map((o, i) =>
        i === parseInt(idx) ? { ...o, [field]: field === 'period' ? parseInt(value) || o.period : value } : o
      )
    } else if (parts.length === 3) {
      const [section, sub, key] = parts
      next[section] = { ...next[section], [sub]: { ...next[section][sub], [key]: value } }
    } else if (parts.length === 2) {
      const [section, key] = parts
      next[section] = { ...next[section], [key]: value }
    } else {
      next[path] = value
    }
    next.preset = 'custom'
    setPref('chart_settings', JSON.stringify(next))
  }, [cs, setPref])

  const updateOverlay = useCallback((idx, field, value) => {
    const next = { ...cs }
    next.overlays = next.overlays.map((o, i) =>
      i === idx ? { ...o, [field]: field === 'period' ? (parseInt(value) || o.period) : value } : o
    )
    next.preset = 'custom'
    setPref('chart_settings', JSON.stringify(next))
  }, [cs, setPref])

  const applyPreset = useCallback((key) => {
    const preset = PRESETS[key]
    if (preset) setPref('chart_settings', JSON.stringify(preset.settings))
  }, [setPref])

  const resetToDefaults = useCallback(() => {
    if (confirm('Reset all chart settings to defaults?')) {
      setPref('chart_settings', JSON.stringify(CHART_DEFAULTS))
    }
  }, [setPref])

  return (
    <TileCard icon="chart" title="Chart Settings">
      <div className={styles.section}>

        {/* ── Preset Picker ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Preset Theme</span>
          <div className={styles.themeGrid}>
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                className={`${styles.themeCard} ${cs.preset === key ? styles.themeCardActive : ''}`}
                onClick={() => applyPreset(key)}
              >
                <span className={styles.themeSwatch}>
                  <span className={styles.themeSwatchColor} style={{ background: p.swatch }} />
                </span>
                <span className={styles.themeCardLabel}>{p.label}</span>
                <span className={styles.themeCardDesc}>{p.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Chart Type ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Chart Type</span>
          <div className={styles.chartPills}>
            {CHART_TYPES.map(ct => (
              <button
                key={ct.value}
                className={`${styles.chartPill} ${cs.chartType === ct.value ? styles.chartPillActive : ''}`}
                onClick={() => update('chartType', ct.value)}
              >
                {ct.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Candle Colors ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Candle Colors</span>
          <div className={styles.chartRow}>
            <ColorPicker label="Up" value={cs.candles.upColor} onChange={v => {
              const next = { ...cs, candles: { ...cs.candles, upColor: v, upBorder: v, upWick: v }, preset: 'custom' }
              setPref('chart_settings', JSON.stringify(next))
            }} />
            <ColorPicker label="Down" value={cs.candles.downColor} onChange={v => {
              const next = { ...cs, candles: { ...cs.candles, downColor: v, downBorder: v, downWick: v }, preset: 'custom' }
              setPref('chart_settings', JSON.stringify(next))
            }} />
          </div>
        </div>

        {/* ── Background & Grid ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Background & Grid</span>
          <div className={styles.chartRow}>
            <ColorPicker label="Background" value={cs.background} onChange={v => update('background', v)} />
            <ColorPicker label="Text" value={cs.textColor} onChange={v => update('textColor', v)} />
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8 }}>
            <ColorPicker label="Grid" value={cs.grid.color} onChange={v => update('grid.color', v)} />
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.grid.visible} onChange={e => update('grid.visible', e.target.checked)} />
              <span>Show grid</span>
            </label>
          </div>
        </div>

        {/* ── Indicators ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Indicators</span>
          {cs.overlays.map((ov, i) => (
            <div key={i} className={styles.overlayRow}>
              <label className={styles.chartToggle}>
                <input type="checkbox" checked={ov.enabled} onChange={e => updateOverlay(i, 'enabled', e.target.checked)} />
              </label>
              <select
                className={styles.overlaySelect}
                value={ov.type}
                onChange={e => updateOverlay(i, 'type', e.target.value)}
              >
                <option value="SMA">SMA</option>
                <option value="EMA">EMA</option>
              </select>
              <input
                type="number"
                className={styles.overlayPeriod}
                value={ov.period}
                min={1}
                max={500}
                onChange={e => updateOverlay(i, 'period', e.target.value)}
              />
              <ColorPicker value={ov.color} onChange={v => updateOverlay(i, 'color', v)} />
            </div>
          ))}
        </div>

        {/* ── Volume ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Volume</span>
          <div className={styles.chartRow}>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.volume.visible} onChange={e => update('volume.visible', e.target.checked)} />
              <span>Show volume</span>
            </label>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.volume.hvcEnabled} onChange={e => update('volume.hvcEnabled', e.target.checked)} />
              <span>HVC highlight</span>
            </label>
            <label className={styles.chartToggle} title="Show volume in its own pane below price instead of overlaid on the chart">
              <input type="checkbox" checked={!!cs.volume.separatePane} onChange={e => update('volume.separatePane', e.target.checked)} />
              <span>Separate pane</span>
            </label>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8 }}>
            <ColorPicker label="Up vol" value={cs.volume.upColor} onChange={v => update('volume.upColor', v)} />
            <ColorPicker label="Down vol" value={cs.volume.downColor} onChange={v => update('volume.downColor', v)} />
          </div>
        </div>

        {/* ── Crosshair ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Crosshair</span>
          <div className={styles.chartRow}>
            <ColorPicker label="Color" value={cs.crosshair.color} onChange={v => update('crosshair.color', v)} />
            <div className={styles.chartRow} style={{ gap: 6 }}>
              <span className={styles.chartMiniLabel}>Style</span>
              <select
                className={styles.overlaySelect}
                value={cs.crosshair.style}
                onChange={e => update('crosshair.style', parseInt(e.target.value))}
              >
                {CROSSHAIR_STYLES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ── Watermark ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Watermark</span>
          <div className={styles.chartRow}>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.visible} onChange={e => update('watermark.visible', e.target.checked)} />
              <span>Show symbol watermark</span>
            </label>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8, gap: 14, flexWrap: 'wrap' }}>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.lines.ticker} onChange={e => update('watermark.lines.ticker', e.target.checked)} />
              <span>Ticker</span>
            </label>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.lines.company} onChange={e => update('watermark.lines.company', e.target.checked)} />
              <span>Company</span>
            </label>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.lines.sector} onChange={e => update('watermark.lines.sector', e.target.checked)} />
              <span>Sector</span>
            </label>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.lines.industry} onChange={e => update('watermark.lines.industry', e.target.checked)} />
              <span>Industry</span>
            </label>
            <label className={styles.chartToggle}>
              <input type="checkbox" checked={cs.watermark.lines.theme} onChange={e => update('watermark.lines.theme', e.target.checked)} />
              <span>UCT Theme</span>
            </label>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8 }}>
            <ColorPicker label="Color" value={cs.watermark.color} onChange={v => update('watermark.color', v)} />
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8, alignItems: 'center' }}>
            <span className={styles.chartMiniLabel}>Opacity</span>
            <input
              type="range"
              className={styles.opacitySlider}
              min={0}
              max={0.3}
              step={0.01}
              value={cs.watermark.opacity}
              onChange={e => update('watermark.opacity', parseFloat(e.target.value))}
            />
            <span className={styles.chartMiniLabel}>{Math.round(cs.watermark.opacity * 100)}%</span>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8, alignItems: 'center' }}>
            <span className={styles.chartMiniLabel}>Size</span>
            <input
              type="range"
              className={styles.opacitySlider}
              min={0.5}
              max={2}
              step={0.1}
              value={cs.watermark.sizeScale}
              onChange={e => update('watermark.sizeScale', parseFloat(e.target.value))}
            />
            <span className={styles.chartMiniLabel}>{cs.watermark.sizeScale.toFixed(1)}×</span>
          </div>
          <div className={styles.chartRow} style={{ marginTop: 8 }}>
            <button
              type="button"
              className={styles.btn}
              onClick={() => { update('watermark.x', 0.5); update('watermark.y', 0.5) }}
            >
              Reset position to center
            </button>
          </div>
        </div>

        {/* ── Drawing Defaults ── */}
        <div className={styles.chartSubsection}>
          <span className={styles.chartSubLabel}>Drawing Defaults</span>
          <div className={styles.chartRow}>
            <ColorPicker label="Color" value={cs.drawingDefaults.color} onChange={v => update('drawingDefaults.color', v)} />
            <div className={styles.chartRow} style={{ gap: 6 }}>
              <span className={styles.chartMiniLabel}>Width</span>
              <div className={styles.chartPills}>
                {DRAWING_WIDTHS.map(w => (
                  <button
                    key={w}
                    className={`${styles.chartPill} ${cs.drawingDefaults.width === w ? styles.chartPillActive : ''}`}
                    onClick={() => update('drawingDefaults.width', w)}
                    style={{ minWidth: 32 }}
                  >
                    {w}px
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Reset ── */}
        <div className={styles.chartSubsection} style={{ borderTop: '1px solid #2e3127', paddingTop: 12 }}>
          <button className={styles.btnDanger} onClick={resetToDefaults} style={{ fontSize: 11 }}>
            Reset All Chart Settings
          </button>
        </div>

      </div>
    </TileCard>
  )
}

function ReferralSection() {
  const [referral, setReferral] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/auth/my-referral')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setReferral(d) })
      .catch(() => {})
  }, [])

  function handleCopy() {
    if (!referral?.code) return
    navigator.clipboard.writeText(`https://uctintelligence.com/signup?ref=${referral.code}`).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!referral) return null

  return (
    <TileCard icon="link" title="Referral Program">
      <div className={styles.section}>
        <p className={styles.hint} style={{ marginBottom: 12 }}>
          Share your link and earn rewards when friends subscribe.
        </p>
        <div className={styles.referralLinkBox}>
          <span className={styles.referralLink}>
            uctintelligence.com/signup?ref={referral.code}
          </span>
          <button className={styles.copyBtn} onClick={handleCopy}>
            {copied ? <><UIcon name="check" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Copied</> : 'Copy'}
          </button>
        </div>
        <div className={styles.row} style={{ marginTop: 12 }}>
          <span className={styles.rowLabel}>Successful Referrals</span>
          <span className={styles.rowValue}>
            {referral.successful_referrals || 0}
          </span>
        </div>
      </div>
    </TileCard>
  )
}

// ── Active sessions panel ────────────────────────────────────────────────
//
// Lists every valid login (device / browser) for the caller. Highlights the
// current session and offers per-row revoke + a "sign out everywhere else"
// button. This closes the biggest gap in most self-serve account panels:
// "did I actually get logged out on that other laptop?"

function deviceLabelFromUA(ua) {
  const s = (ua || '').toLowerCase()
  const os =
    /windows nt/.test(s) ? 'Windows' :
    /mac os x|macintosh/.test(s) ? 'macOS' :
    /iphone|ipad/.test(s) ? 'iOS' :
    /android/.test(s) ? 'Android' :
    /linux/.test(s) ? 'Linux' : 'Unknown OS'
  const browser =
    /edg\//.test(s) ? 'Edge' :
    /firefox/.test(s) ? 'Firefox' :
    /chrome/.test(s) && !/edg/.test(s) ? 'Chrome' :
    /safari/.test(s) && !/chrome/.test(s) ? 'Safari' : 'Browser'
  return `${browser} on ${os}`
}

function ActiveSessionsPanel() {
  const [sessions, setSessions] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const load = () => {
    fetch('/api/auth/sessions')
      .then(r => r.ok ? r.json() : null)
      .then(d => setSessions(d?.sessions || []))
      .catch(() => setSessions([]))
  }
  useEffect(() => { load() }, [])

  const revokeOne = async (short_id) => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch(`/api/auth/sessions/${short_id}`, { method: 'DELETE' })
      if (r.ok) { setMsg('Session revoked'); load() }
      else setMsg('Could not revoke session')
    } catch { setMsg('Network error') }
    finally { setBusy(false); setTimeout(() => setMsg(''), 2000) }
  }

  const revokeOthers = async () => {
    if (busy) return
    if (!window.confirm('Sign out of every other device? Your current session stays active.')) return
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/auth/sessions/revoke-others', { method: 'POST' })
      if (r.ok) {
        const d = await r.json()
        setMsg(`Signed out ${d.revoked || 0} other session${d.revoked === 1 ? '' : 's'}`)
        load()
      } else setMsg('Could not sign out others')
    } catch { setMsg('Network error') }
    finally { setBusy(false); setTimeout(() => setMsg(''), 2500) }
  }

  if (sessions === null) {
    return <div className={styles.section}><span className={styles.hint}>Loading sessions...</span></div>
  }

  return (
    <div className={styles.section}>
      <p className={styles.hint} style={{ marginTop: 0, marginBottom: 12 }}>
        Every device currently signed in to your account. Revoke anything you don't recognize.
      </p>
      <div className={styles.sessionList}>
        {sessions.map(s => {
          const label = deviceLabelFromUA(s.user_agent)
          return (
            <div key={s.short_id} className={`${styles.sessionRow} ${s.is_current ? styles.sessionRowCurrent : ''}`}>
              <span className={styles.sessionIcon}><UIcon name={s.is_current ? 'check' : 'clock'} size={13} /></span>
              <div className={styles.sessionInfo}>
                <div className={styles.sessionLabel}>
                  {label}
                  {s.is_current && <span className={styles.sessionCurrentPill}>This device</span>}
                </div>
                <div className={styles.sessionMeta}>
                  {s.ip_address && <>IP {s.ip_address} · </>}
                  Last seen {s.last_seen_at ? formatETDate(s.last_seen_at) : 'unknown'}
                </div>
              </div>
              {!s.is_current && (
                <button
                  className={styles.btnMuted}
                  onClick={() => revokeOne(s.short_id)}
                  disabled={busy}
                  aria-label={`Revoke ${label}`}
                >
                  Revoke
                </button>
              )}
            </div>
          )
        })}
      </div>
      {sessions.filter(s => !s.is_current).length > 0 && (
        <button className={styles.btn} onClick={revokeOthers} disabled={busy} style={{ marginTop: 12 }}>
          Sign out of all other devices
        </button>
      )}
      {msg && <div className={styles.success} style={{ marginTop: 8 }}>{msg}</div>}
    </div>
  )
}


// ── Danger Zone ──────────────────────────────────────────────────────────
//
// Two-step confirmation with a typed sentinel + password re-entry. On submit
// we create a paired support ticket + a deletion_requests row; the owner
// processes the actual deletion. Automating the wipe would give any stolen
// cookie the power to nuke an account — the two-step is cheap insurance.

function DangerZonePanel() {
  const [expanded, setExpanded] = useState(false)
  const [password, setPassword] = useState('')
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)

  useEffect(() => {
    fetch('/api/auth/deletion-request')
      .then(r => r.ok ? r.json() : null)
      .then(d => setPending(d))
      .catch(() => {})
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setSubmitting(true); setError('')
    try {
      const r = await fetch('/api/auth/request-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, reason: reason.trim(), confirmation: confirmation.trim() }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => ({}))
        setError(err.detail || 'Could not submit request')
      } else {
        const body = await r.json()
        setPending({ id: body.request_id, ticket_id: body.ticket_id })
        setExpanded(false); setPassword(''); setReason(''); setConfirmation('')
      }
    } catch { setError('Network error') }
    finally { setSubmitting(false) }
  }

  if (pending?.id) {
    return (
      <div className={styles.section}>
        <p className={styles.hint} style={{ marginTop: 0 }}>
          A deletion request is on file. We'll process it shortly and email
          you when it's done. To cancel, reply to the linked support ticket.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.section}>
      <p className={styles.hint} style={{ marginTop: 0, marginBottom: 12 }}>
        Deleting your account removes your journal, watchlists, tickets, and
        broker connections. Subscriptions are cancelled. This can't be undone.
      </p>
      {!expanded ? (
        <button className={styles.btnDanger} onClick={() => setExpanded(true)}>
          Delete my account
        </button>
      ) : (
        <form onSubmit={submit} className={styles.pwForm}>
          <label className={styles.formCheckLabel}>Reason (optional)</label>
          <textarea
            className={styles.input}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Anything we could have done differently?"
            rows={3}
            maxLength={2000}
          />
          <label className={styles.formCheckLabel}>Password</label>
          <input
            type="password"
            className={styles.input}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <label className={styles.formCheckLabel}>
            Type <code>delete my account</code> to confirm
          </label>
          <input
            type="text"
            className={styles.input}
            value={confirmation}
            onChange={e => setConfirmation(e.target.value)}
            required
            autoComplete="off"
          />
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.pwActions}>
            <button
              type="submit"
              className={styles.btnDanger}
              disabled={submitting || confirmation.trim().toLowerCase() !== 'delete my account' || !password}
            >
              {submitting ? 'Submitting...' : 'Submit deletion request'}
            </button>
            <button type="button" className={styles.btnMuted} onClick={() => { setExpanded(false); setError('') }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}


// ── Save toast ───────────────────────────────────────────────────────────
//
// Small floating confirmation that fires when a preference write settles.
// A single hook wraps setPref so every preference control benefits without
// per-control state.

function useSaveToast() {
  const [msg, setMsg] = useState(null)
  const timer = useRef(null)
  const trigger = useCallback((text = 'Saved') => {
    setMsg(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMsg(null), 1800)
  }, [])
  return { msg, trigger }
}

function SaveToast({ msg }) {
  if (!msg) return null
  return (
    <div className={styles.saveToast} role="status" aria-live="polite">
      <UIcon name="check" size={12} />
      {msg}
    </div>
  )
}


// ── Preferences backup (client-side JSON export/import) ────────────────
//
// Exports the caller's preference dict wrapped in a versioned envelope so
// they can back up their theme + chart settings + tag labels + digest prefs
// between accounts (or after re-signup). Import re-POSTs each pref one-by-
// one via the existing single-write endpoint — same server-side validation
// path a manual UI change would take.

const BACKUP_ENVELOPE_TYPE = 'uct-intelligence-preferences'
const BACKUP_ENVELOPE_VERSION = 1

function PreferencesBackupCard() {
  const [exportBusy, setExportBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [confirmData, setConfirmData] = useState(null)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const inputRef = useRef(null)

  const flash = (setter, text, ms = 2500) => {
    setter(text)
    setTimeout(() => setter(''), ms)
  }

  const doExport = async () => {
    setExportBusy(true); setErr('')
    try {
      const r = await fetch('/api/auth/preferences')
      if (!r.ok) { flash(setErr, 'Could not read preferences'); return }
      const prefs = await r.json()
      const envelope = {
        type: BACKUP_ENVELOPE_TYPE,
        version: BACKUP_ENVELOPE_VERSION,
        exported_at: new Date().toISOString(),
        count: Object.keys(prefs || {}).length,
        preferences: prefs || {},
      }
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `uct-preferences-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      flash(setMsg, `Exported ${envelope.count} preference${envelope.count === 1 ? '' : 's'}`)
    } catch { flash(setErr, 'Export failed') }
    finally { setExportBusy(false) }
  }

  const onFilePick = async (e) => {
    setErr(''); setMsg('')
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      if (parsed?.type !== BACKUP_ENVELOPE_TYPE) {
        flash(setErr, "That doesn't look like a UCT preferences backup")
        return
      }
      const prefs = parsed.preferences || {}
      const count = Object.keys(prefs).length
      if (count === 0) { flash(setErr, 'The backup is empty'); return }
      setConfirmData({ prefs, count, exported_at: parsed.exported_at })
    } catch { flash(setErr, 'Could not read the JSON file') }
  }

  const doImport = async () => {
    if (!confirmData) return
    setImportBusy(true); setErr('')
    try {
      // Sequential to keep it easy to reason about — each set_user_preference
      // is a fast write and the total volume is tiny (~20-30 keys). If a key
      // fails the rest still apply.
      let ok = 0, fail = 0
      for (const [key, value] of Object.entries(confirmData.prefs)) {
        try {
          const r = await fetch('/api/auth/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key, value: String(value ?? '') }),
          })
          if (r.ok) ok++
          else fail++
        } catch { fail++ }
      }
      setConfirmData(null)
      flash(setMsg, `Imported ${ok} preference${ok === 1 ? '' : 's'}${fail ? ` · ${fail} failed` : ''}`)
      // Nudge the app to re-read prefs by reloading. This is the same pattern
      // the profile-name save uses.
      setTimeout(() => window.location.reload(), 900)
    } catch { flash(setErr, 'Import failed') }
    finally { setImportBusy(false) }
  }

  return (
    <TileCard icon="download" title="Preferences Backup">
      <div className={styles.section}>
        <p className={styles.hint} style={{ marginTop: 0, marginBottom: 12 }}>
          Take your theme, chart settings, alert tones, digest schedule, and
          tag labels with you. Import restores them on any account.
        </p>
        <div className={styles.prefRow}>
          <div className={styles.prefLabelGroup}>
            <span className={styles.prefLabel}>Export preferences</span>
            <span className={styles.prefDesc}>Downloads a JSON backup of every preference stored on your account.</span>
          </div>
          <button className={styles.btn} onClick={doExport} disabled={exportBusy}>
            {exportBusy ? 'Exporting...' : 'Download JSON'}
          </button>
        </div>
        <div className={styles.prefRow}>
          <div className={styles.prefLabelGroup}>
            <span className={styles.prefLabel}>Import preferences</span>
            <span className={styles.prefDesc}>Restore a previously downloaded backup. This overwrites the matching preferences.</span>
          </div>
          <button className={styles.btn} onClick={() => inputRef.current?.click()} disabled={importBusy}>
            Choose JSON…
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/json,.json"
            onChange={onFilePick}
            style={{ display: 'none' }}
            aria-label="Choose a preferences backup file"
          />
        </div>
        {msg && <div className={styles.success}>{msg}</div>}
        {err && <div className={styles.error}>{err}</div>}
      </div>
      {confirmData && (
        <div
          className={styles.paletteBackdrop}
          onClick={() => setConfirmData(null)}
          role="dialog"
          aria-label="Confirm preferences import"
        >
          <div className={styles.paletteBox} onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div className={styles.paletteInputWrap} style={{ padding: '18px 18px 10px', borderBottom: 'none' }}>
              <UIcon name="warning" size={16} />
              <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Overwrite {confirmData.count} preference{confirmData.count === 1 ? '' : 's'}?</span>
            </div>
            <div style={{ padding: '0 18px 6px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              This will replace your current values for every preference in
              the backup. Preferences NOT in the backup are left untouched.
              {confirmData.exported_at && (
                <div style={{ marginTop: 8, fontSize: 11 }}>
                  Backup was exported on {new Date(confirmData.exported_at).toLocaleString()}.
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, padding: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <button className={styles.btnMuted} onClick={() => setConfirmData(null)} disabled={importBusy}>
                Cancel
              </button>
              <button className={styles.btn} onClick={doImport} disabled={importBusy} style={{ marginLeft: 'auto' }}>
                {importBusy ? 'Importing...' : `Import ${confirmData.count}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </TileCard>
  )
}


// ── Keyboard shortcut cheat-sheet (`?`) ─────────────────────────────────
//
// Opens a compact modal listing every shortcut this page supports. Fires
// on `?` (i.e. Shift+/) when the user isn't in another input, matching
// GitHub / Slack / Notion convention.

const SHORTCUT_ROWS = [
  { keys: ['⌘', 'K'], macAlt: ['Ctrl', 'K'], desc: 'Open the command palette' },
  { keys: ['/'], desc: 'Focus the section search' },
  { keys: ['↑', '↓'], desc: 'Move between palette results' },
  { keys: ['Enter'], desc: 'Jump to the selected result' },
  { keys: ['Esc'], desc: 'Close the palette or an overlay' },
  { keys: ['?'], desc: 'Open this shortcut list' },
]

function ShortcutHelpModal({ onClose }) {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
  return (
    <div className={styles.paletteBackdrop} onClick={onClose} role="dialog" aria-label="Keyboard shortcuts">
      <div className={styles.paletteBox} onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className={styles.paletteInputWrap} style={{ padding: '16px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <UIcon name="gear" size={14} />
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Keyboard shortcuts</span>
          <kbd className={styles.paletteHint}>Esc</kbd>
        </div>
        <div style={{ padding: '4px 10px' }}>
          {SHORTCUT_ROWS.map((row, i) => {
            const keys = !isMac && row.macAlt ? row.macAlt : row.keys
            return (
              <div key={i} className={styles.shortcutRow}>
                <span className={styles.shortcutKeys}>
                  {keys.map((k, j) => (
                    <span key={j} className={styles.shortcutKeyGroup}>
                      <kbd>{k}</kbd>
                      {j < keys.length - 1 && <span className={styles.shortcutPlus}>+</span>}
                    </span>
                  ))}
                </span>
                <span className={styles.shortcutDesc}>{row.desc}</span>
              </div>
            )
          })}
        </div>
        <div className={styles.paletteFooter}>
          <span>Press <kbd className={styles.paletteHint}>?</kbd> anywhere on Settings to open this list.</span>
        </div>
      </div>
    </div>
  )
}


// ── Section registry — the Settings navigation rail ──
const SECTIONS = [
  { id: 'account',     label: 'Account',         icon: 'user',    desc: 'Profile, security & session' },
  { id: 'billing',     label: 'Plan & Billing',  icon: 'dollar',  desc: 'Subscription, invoices & referrals' },
  { id: 'preferences', label: 'Preferences',     icon: 'gear',    desc: 'Theme, alerts, digests & tags' },
  { id: 'charts',      label: 'Charts',          icon: 'chart',   desc: 'Chart appearance & defaults' },
  { id: 'compass',     label: 'Compass & Voice', icon: 'compass', desc: 'AI coach, voice & insights' },
  { id: 'connections', label: 'Connections',     icon: 'link',    desc: 'Brokerage auto-import' },
  { id: 'legal',       label: 'Data & Legal',    icon: 'shield',  desc: 'Your data, privacy & disclaimers' },
]

// Static index behind the settings search box. `keywords` are matched as a
// substring so word prefixes ("pass" → password) hit too.
const SEARCH_INDEX = [
  { card: 'profile',        section: 'account',     title: 'Profile',                    keywords: 'avatar photo email display name full name member since verified' },
  { card: 'security',       section: 'account',     title: 'Security',                   keywords: 'password change security' },
  { card: 'session',        section: 'account',     title: 'Log Out',                    keywords: 'log out logout sign out session' },
  { card: 'activeSessions', section: 'account',     title: 'Active Sessions',            keywords: 'sessions devices browsers logins revoke sign out everywhere lost stolen' },
  { card: 'dangerZone',     section: 'account',     title: 'Delete Account',             keywords: 'delete account danger zone close remove wipe permanent goodbye' },
  { card: 'subscription',   section: 'billing',     title: 'Subscription & Billing',     keywords: 'plan pro upgrade cancel invoice payment card stripe renewal price free' },
  { card: 'referral',       section: 'billing',     title: 'Referral Program',           keywords: 'referral invite share friends rewards link' },
  { card: 'prefs',          section: 'preferences', title: 'Preferences',                keywords: 'theme dark oled dim system default chart timeframe appearance' },
  { card: 'notifications',  section: 'preferences', title: 'Notifications',              keywords: 'alert sound tone browser desktop notification' },
  { card: 'digest',         section: 'preferences', title: 'Watchlist Digest',           keywords: 'email digest daily weekly summary watchlist' },
  { card: 'tags',           section: 'preferences', title: 'Color Tags',                 keywords: 'tag color label ticker right click rename' },
  { card: 'chartSettings',  section: 'charts',      title: 'Chart Settings',             keywords: 'candles hollow bars line area colors indicators sma ema volume hvc crosshair watermark drawing preset background grid reset' },
  { card: 'compassPanel',   section: 'compass',     title: 'Compass',                    keywords: 'voice speed wake word jarvis read aloud proactive dictate talk orb ai coach' },
  { card: 'voiceMemory',    section: 'compass',     title: 'Voice Memory',               keywords: 'memory facts compass remembers' },
  { card: 'voiceTelemetry', section: 'compass',     title: 'Voice Telemetry',            keywords: 'usage minutes latency telemetry stats' },
  { card: 'voiceSessions',  section: 'compass',     title: 'Voice Session History',      keywords: 'transcripts past conversations session history' },
  { card: 'voiceDocs',      section: 'compass',     title: 'Voice Documents',            keywords: 'upload pdf files knowledge documents' },
  { card: 'voiceInsights',  section: 'compass',     title: 'Voice Insights Inbox',       keywords: 'proactive insights inbox compass noticed' },
  { card: 'broker',         section: 'connections', title: 'Brokerage Connections',      keywords: 'broker brokerage connect snaptrade robinhood schwab import trades positions sync auto-import' },
  { card: 'privacy',        section: 'legal',       title: 'Data & Privacy',             keywords: 'export download my data json terms privacy policy' },
  { card: 'prefsBackup',    section: 'legal',       title: 'Preferences Backup',         keywords: 'backup restore prefs preferences export import json theme chart tag' },
  { card: 'disclaimers',    section: 'legal',       title: 'Disclaimers & Attributions', keywords: 'legal advice disclaimer market data tradingview attribution' },
]

// ── Main Settings Page ──
export default function Settings() {
  const { user, plan, subscription, logout, startCheckout, openPortal, refetch } = useAuth()
  const { prefs, setPref: setPrefRaw } = usePreferences()
  const toast = useSaveToast()
  // Wrap setPref so every preference write flashes a small "Saved" toast.
  const setPref = useCallback((key, value) => {
    setPrefRaw(key, value)
    toast.trigger('Saved')
  }, [setPrefRaw, toast])
  const { tagColors, setTagLabel } = useTagColors()
  const navigate = useNavigate()
  const [changingPw, setChangingPw] = useState(false)
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' })
  const [pwMsg, setPwMsg] = useState('')
  const [pwError, setPwError] = useState('')
  const [billingLoading, setBillingLoading] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingFullName, setEditingFullName] = useState(false)
  const [newFullName, setNewFullName] = useState('')
  const [nameMsg, setNameMsg] = useState('')

  // ── Section navigation (?section= deep-linkable, back/forward friendly) ──
  const [searchParams, setSearchParams] = useSearchParams()
  const rawSection = searchParams.get('section')
  const section = SECTIONS.some(s => s.id === rawSection) ? rawSection : 'account'
  const activeSection = SECTIONS.find(s => s.id === section)
  const [query, setQuery] = useState('')
  const [flashCard, setFlashCard] = useState(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const railSearchRef = useRef(null)

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return null
    return SEARCH_INDEX.filter(e =>
      e.title.toLowerCase().includes(q) || e.keywords.includes(q)
    )
  }, [query])

  function goSection(id) {
    if (id !== section) setSearchParams({ section: id })
  }

  function goResult(r) {
    setQuery('')
    setPaletteOpen(false)
    if (r.section !== section) setSearchParams({ section: r.section })
    setFlashCard(r.card)
    // Wait for the target section to render before scrolling to the card
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById(`set-card-${r.card}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }))
    setTimeout(() => setFlashCard(null), 1800)
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  //
  //   ⌘K / Ctrl+K   → open the command palette (works from anywhere on the
  //                    Settings page, not just the rail search)
  //   /              → focus the rail search (GitHub convention; ignored when
  //                    another input already has focus)
  //   ?              → open a cheat-sheet listing every shortcut on this page
  //                    (Slack / Notion / GitHub convention)
  //   Esc            → close whichever overlay is open
  useEffect(() => {
    const inTextControl = () => {
      const el = document.activeElement
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setHelpOpen(false)
        setPaletteOpen(true)
        return
      }
      if (e.key === 'Escape') {
        if (paletteOpen) { e.preventDefault(); setPaletteOpen(false); return }
        if (helpOpen)    { e.preventDefault(); setHelpOpen(false);    return }
      }
      if (e.key === '/' && !inTextControl() && !paletteOpen && !helpOpen) {
        e.preventDefault()
        railSearchRef.current?.focus()
        return
      }
      // `?` is Shift+/ on US layouts. Same guard as `/`.
      if (e.key === '?' && !inTextControl() && !paletteOpen) {
        e.preventDefault()
        setHelpOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, helpOpen])

  const card = (id, node) => (
    <div
      key={id}
      id={`set-card-${id}`}
      className={`${styles.cardAnchor} ${flashCard === id ? styles.cardFlash : ''}`}
    >
      {node}
    </div>
  )

  const renewalDays = daysUntil(subscription?.current_period_end)
  const isComped = subscription?.status === 'comped'
  const isCanceling = subscription?.status === 'canceled' || subscription?.status === 'past_due'

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  async function handleManageBilling() {
    setBillingLoading(true)
    try {
      await openPortal()
    } catch {
      try { await startCheckout() } catch { /* ignore */ }
    } finally {
      setBillingLoading(false)
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setPwMsg('')
    setPwError('')
    if (pwForm.newPw !== pwForm.confirm) {
      setPwError('Passwords do not match')
      return
    }
    if (pwForm.newPw.length < 8) {
      setPwError('Password must be at least 8 characters')
      return
    }
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.newPw }),
      })
      if (!res.ok) {
        const err = await res.json()
        setPwError(err.detail || 'Failed to change password')
        return
      }
      setPwMsg('Password changed successfully')
      setPwForm({ current: '', newPw: '', confirm: '' })
      setChangingPw(false)
    } catch {
      setPwError('Network error')
    }
  }

  async function handleUpdateField(field, value, setEditing) {
    if (!value.trim()) return
    setNameMsg('')
    try {
      const res = await fetch('/api/auth/update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value.trim() }),
      })
      if (res.ok) {
        setNameMsg('Updated')
        setEditing(false)
        refetch()
      }
    } catch { /* ignore */ }
  }

  // ── Card blocks (grouped into the section map below) ──
  const profileCard = (
        <TileCard icon="user" title="Profile">
          <div className={styles.section}>
            <AvatarUpload user={user} />
            <div className={styles.row}>
              <span className={styles.rowLabel}>Email</span>
              <span className={styles.rowValue}>{user?.email || '—'}</span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Full Name</span>
              {!editingFullName ? (
                <span className={styles.rowValue}>
                  {user?.full_name || '—'}
                  <button
                    className={styles.inlineBtn}
                    onClick={() => { setNewFullName(user?.full_name || ''); setEditingFullName(true) }}
                  >
                    Edit
                  </button>
                </span>
              ) : (
                <span className={styles.rowValue}>
                  <input
                    type="text"
                    value={newFullName}
                    onChange={e => setNewFullName(e.target.value)}
                    className={styles.inlineInput}
                    autoFocus
                    placeholder="First Last"
                    onKeyDown={e => { if (e.key === 'Enter') handleUpdateField('full_name', newFullName, setEditingFullName); if (e.key === 'Escape') setEditingFullName(false) }}
                  />
                  <button className={styles.inlineBtn} onClick={() => handleUpdateField('full_name', newFullName, setEditingFullName)}>Save</button>
                  <button className={styles.inlineBtnMuted} onClick={() => setEditingFullName(false)}>Cancel</button>
                </span>
              )}
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Display Name</span>
              {!editingName ? (
                <span className={styles.rowValue}>
                  {user?.display_name || '—'}
                  <button
                    className={styles.inlineBtn}
                    onClick={() => { setNewName(user?.display_name || ''); setEditingName(true) }}
                  >
                    Edit
                  </button>
                </span>
              ) : (
                <span className={styles.rowValue}>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    className={styles.inlineInput}
                    autoFocus
                    placeholder="Your public name"
                    onKeyDown={e => { if (e.key === 'Enter') handleUpdateField('display_name', newName, setEditingName); if (e.key === 'Escape') setEditingName(false) }}
                  />
                  <button className={styles.inlineBtn} onClick={() => handleUpdateField('display_name', newName, setEditingName)}>Save</button>
                  <button className={styles.inlineBtnMuted} onClick={() => setEditingName(false)}>Cancel</button>
                </span>
              )}
            </div>
            {nameMsg && <div className={styles.success}>{nameMsg}</div>}
            <div className={styles.row}>
              <span className={styles.rowLabel}>Email Verified</span>
              <span className={styles.rowValue}>
                {user?.email_verified ? (
                  <span className={styles.verifiedBadge}><UIcon name="check" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Verified</span>
                ) : (
                  <span className={styles.unverifiedBadge}><UIcon name="x" size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Not verified</span>
                )}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Member Since</span>
              <span className={styles.rowValue}>
                {formatDate(user?.created_at)}
              </span>
            </div>
            <div className={styles.row}>
              <span className={styles.rowLabel}>Membership Duration</span>
              <span className={styles.rowValue}>
                {memberDuration(user?.created_at)}
              </span>
            </div>
          </div>
        </TileCard>
  )

  const subscriptionCard = (
        <TileCard icon="dollar" title="Subscription & Billing">
          <div className={styles.section}>
            {plan === 'pro' || isComped ? (
              <>
                <div className={styles.planHeader}>
                  <span className={styles.activeDot} />
                  <span className={styles.planTitle}>
                    {isComped ? 'Pro (Complimentary)' : 'Pro — $20/mo'}
                  </span>
                </div>

                <div className={styles.subDetails}>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Status</span>
                    <span className={styles.rowValue}>
                      <span className={`${styles.statusPill} ${
                        isCanceling ? styles.statusCanceling :
                        isComped ? styles.statusComped :
                        styles.statusActive
                      }`}>
                        {isCanceling ? 'Canceling' : isComped ? 'Comped' : 'Active'}
                      </span>
                    </span>
                  </div>

                  {!isComped && subscription?.current_period_end && (
                    <>
                      <div className={styles.row}>
                        <span className={styles.rowLabel}>
                          {isCanceling ? 'Access Ends' : 'Next Renewal'}
                        </span>
                        <span className={styles.rowValue}>
                          {formatDate(subscription.current_period_end)}
                          {renewalDays != null && renewalDays >= 0 && (
                            <span className={styles.daysTag}>
                              {renewalDays === 0 ? 'Today' : `in ${renewalDays}d`}
                            </span>
                          )}
                        </span>
                      </div>
                      <div className={styles.row}>
                        <span className={styles.rowLabel}>Billing Cycle</span>
                        <span className={styles.rowValue}>Monthly</span>
                      </div>
                    </>
                  )}
                </div>

                {!isComped && (
                  <>
                    <button className={styles.btn} onClick={handleManageBilling} disabled={billingLoading}>
                      {billingLoading ? 'Loading...' : 'Manage Billing'}
                    </button>
                    <p className={styles.hint}>Update payment method, view invoices, or cancel</p>
                  </>
                )}
              </>
            ) : (
              <>
                <div className={styles.planHeader}>
                  <span className={styles.freeDot} />
                  <span className={styles.planTitle}>Free Plan</span>
                </div>
                <p className={styles.hint} style={{ margin: '8px 0 10px' }}>
                  You have Dashboard, Breadth, Charts, Options Flow, Journal &amp; Model Book.
                  Pro unlocks the full intelligence layer:
                </p>
                <ul className={styles.proList}>
                  <li>Morning Wire — daily pre-market brief &amp; top picks</li>
                  <li>Screener &amp; Patterns — the setup scanner + pattern engine</li>
                  <li>UCT 20 leadership, Theme Tracker &amp; Calendar</li>
                  <li>Research dossiers — fundamentals, analyst &amp; ownership depth</li>
                  <li>Compass — AI coaching, voice &amp; pre-trade verdicts</li>
                </ul>
                <button className={styles.btnPro} onClick={() => startCheckout()}>
                  Upgrade to Pro — $20/mo
                </button>
              </>
            )}
          </div>
        </TileCard>
  )

  const securityCard = (
        <TileCard icon="lock" title="Security">
          <div className={styles.section}>
            {!changingPw ? (
              <button className={styles.btn} onClick={() => setChangingPw(true)}>
                Change Password
              </button>
            ) : (
              <form onSubmit={handleChangePassword} className={styles.pwForm}>
                <input
                  type="password"
                  placeholder="Current password"
                  value={pwForm.current}
                  onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                  className={styles.input}
                  required
                />
                <input
                  type="password"
                  placeholder="New password (min 8 chars)"
                  value={pwForm.newPw}
                  onChange={e => setPwForm(f => ({ ...f, newPw: e.target.value }))}
                  className={styles.input}
                  required
                  minLength={8}
                />
                <input
                  type="password"
                  placeholder="Confirm new password"
                  value={pwForm.confirm}
                  onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                  className={styles.input}
                  required
                />
                {pwError && <div className={styles.error}>{pwError}</div>}
                {pwMsg && <div className={styles.success}>{pwMsg}</div>}
                <div className={styles.pwActions}>
                  <button type="submit" className={styles.btn}>Save</button>
                  <button type="button" className={styles.btnMuted} onClick={() => { setChangingPw(false); setPwError('') }}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </TileCard>
  )

  const preferencesCard = (
        <TileCard icon="gear" title="Preferences">
          <div className={styles.section}>
            <div className={styles.prefRow}>
              <div className={styles.prefLabelGroup}>
                <span className={styles.prefLabel}>Default Chart Timeframe</span>
                <span className={styles.prefDesc}>Opens charts in this view by default</span>
              </div>
              <select
                className={styles.prefSelect}
                value={prefs.default_chart_tf}
                onChange={e => setPref('default_chart_tf', e.target.value)}
              >
                {TF_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.prefRow}>
              <div className={styles.prefLabelGroup}>
                <span className={styles.prefLabel}>App Theme</span>
                <span className={styles.prefDesc}>Customize your visual experience</span>
              </div>
              <div className={styles.themeGrid}>
                {THEME_OPTIONS.map(o => (
                  <button
                    key={o.value}
                    className={`${styles.themeCard} ${prefs.theme === o.value ? styles.themeCardActive : ''}`}
                    onClick={() => setPref('theme', o.value)}
                  >
                    <span className={styles.themeSwatch}>
                      {o.swatch ? (
                        <span className={styles.themeSwatchColor} style={{ background: o.swatch }} />
                      ) : (
                        <span className={styles.themeSwatchSystem}>⊘</span>
                      )}
                    </span>
                    <span className={styles.themeCardLabel}>{o.label}</span>
                    <span className={styles.themeCardDesc}>{o.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </TileCard>
  )

  const notificationsCard = (
        <TileCard icon="bell" title="Notifications">
          <div className={styles.section}>
            <div className={styles.prefRow}>
              <div className={styles.prefLabelGroup}>
                <span className={styles.prefLabel}>Alert Sound</span>
                <span className={styles.prefDesc}>Play a sound when new price alerts trigger</span>
              </div>
              <select
                className={styles.select}
                value={prefs.alert_sound || 'on'}
                onChange={e => setPref('alert_sound', e.target.value)}
              >
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </div>
            {prefs.alert_sound !== 'off' && (
              <div className={styles.prefRow}>
                <div className={styles.prefLabelGroup}>
                  <span className={styles.prefLabel}>Sound Type</span>
                  <span className={styles.prefDesc}>Choose your alert tone</span>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <select
                    className={styles.select}
                    value={prefs.alert_sound_type || 'chime'}
                    onChange={e => setPref('alert_sound_type', e.target.value)}
                  >
                    {ALERT_SOUNDS.map(s => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
                  </select>
                  <button
                    className={styles.btn}
                    onClick={() => previewSound(prefs.alert_sound_type || 'chime')}
                    style={{ whiteSpace: 'nowrap' }}
                  >Preview</button>
                </div>
              </div>
            )}
            <div className={styles.prefRow}>
              <div className={styles.prefLabelGroup}>
                <span className={styles.prefLabel}>Browser Notifications</span>
                <span className={styles.prefDesc}>Show desktop notifications when alerts fire (even when tab is in background)</span>
              </div>
              <button
                className={styles.btn}
                onClick={async () => {
                  if (!('Notification' in window)) { alert('Your browser does not support notifications'); return }
                  const perm = await Notification.requestPermission()
                  if (perm === 'granted') alert('Notifications enabled!')
                  else if (perm === 'denied') alert('Notifications blocked. Enable in browser settings.')
                }}
              >
                {typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 'Enabled' : 'Enable'}
              </button>
            </div>
          </div>
        </TileCard>
  )

  const digestCard = (
        <TileCard icon="document" title="Watchlist Digest">
          <div className={styles.section}>
            <div className={styles.prefRow}>
              <div className={styles.prefLabelGroup}>
                <span className={styles.prefLabel}>Email Digest</span>
                <span className={styles.prefDesc}>Receive a performance summary of your watchlists</span>
              </div>
              <select
                className={styles.select}
                value={prefs.watchlist_digest ? JSON.parse(prefs.watchlist_digest || '{}').frequency || 'off' : 'off'}
                onChange={e => {
                  const freq = e.target.value
                  fetch('/api/watchlists/digest-settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ frequency: freq }),
                  })
                  setPref('watchlist_digest', JSON.stringify({ frequency: freq }))
                }}
              >
                <option value="off">Off</option>
                <option value="daily">Daily (5 PM ET)</option>
                <option value="weekly">Weekly (Fri 5 PM ET)</option>
              </select>
            </div>
          </div>
        </TileCard>
  )

  const tagsCard = (
        <TileCard icon="tag" title="Color Tags">
          <div className={styles.section}>
            <span className={styles.prefDesc} style={{ marginBottom: 12, display: 'block' }}>
              Customize tag names. Right-click any ticker to assign a color.
            </span>
            {tagColors.map(tc => (
              <div key={tc.key} className={styles.prefRow}>
                <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: tc.hex, marginRight: 10, flexShrink: 0 }} />
                <input
                  className={styles.tagLabelInput}
                  defaultValue={tc.label}
                  placeholder={tc.label}
                  maxLength={32}
                  onBlur={e => {
                    const val = e.target.value.trim()
                    if (val) setTagLabel(tc.key, val)
                    else e.target.value = tc.label
                  }}
                  onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                />
              </div>
            ))}
          </div>
        </TileCard>
  )

  const privacyCard = (
        <TileCard icon="shield" title="Data & Privacy">
          <div className={styles.section}>
            <div className={styles.prefRow}>
              <div className={styles.prefLabelGroup}>
                <span className={styles.prefLabel}>Export all my data</span>
                <span className={styles.prefDesc}>Download your watchlists, journal, trades, and settings as JSON — your data leaves with you, always. (Screenshot attachments download individually from each trade.)</span>
              </div>
              <button className={styles.btn} onClick={async () => {
                try {
                  const res = await fetch('/api/auth/export-data')
                  if (!res.ok) return
                  const blob = await res.blob()
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `uct-data-${new Date().toISOString().slice(0, 10)}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                } catch { /* ignore */ }
              }}>
                Download
              </button>
            </div>
            <div className={styles.linksRow} style={{ marginTop: 8 }}>
              <a href="/terms" className={styles.footerLink}>Terms of Service</a>
              <span className={styles.linkDivider}>·</span>
              <a href="/privacy" className={styles.footerLink}>Privacy Policy</a>
            </div>
          </div>
        </TileCard>
  )

  // Seed of the future full per-user disclaimer page. Add new
  // <div className={styles.legalBlock}> sections here as legal content grows.
  const disclaimersCard = (
        <TileCard icon="document" title="Disclaimers & Attributions">
          <div className={styles.section}>
            <p className={styles.legalIntro}>
              UCT Intelligence (a product of Uncharted Territory) is a market
              research and education platform. The summary below is a starting
              point — a full, versioned disclaimer page is on the way.
            </p>

            <div className={styles.legalBlock}>
              <p className={styles.legalHeading}>Not Investment Advice</p>
              <p className={styles.legalText}>
                All data, scores, screens, AI commentary (including Compass),
                and tools are provided for informational and educational
                purposes only and do not constitute personalized financial,
                investment, tax, or legal advice. Trading and investing involve
                substantial risk of loss. Past performance is not indicative of
                future results. You are solely responsible for your own
                decisions and should consult a licensed professional before
                acting on anything you see here.
              </p>
            </div>

            <div className={styles.legalBlock}>
              <p className={styles.legalHeading}>Market Data</p>
              <p className={styles.legalText}>
                Quotes, fundamentals, and historical bars are sourced from
                third-party providers and may be delayed, incomplete, or
                inaccurate. Data is not guaranteed and must not be relied upon
                for trade execution or as the sole basis for any decision.
              </p>
            </div>

            <div className={styles.legalBlock}>
              <p className={styles.legalHeading}>Charting & Attributions</p>
              <p className={styles.legalText}>
                Interactive charts are powered by{' '}
                <a
                  href="https://www.tradingview.com/lightweight-charts/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Lightweight Charts™ by TradingView
                </a>
                . Charting technology and related trademarks are the property
                of TradingView, Inc.
              </p>
            </div>

            <div className={styles.linksRow} style={{ marginTop: 14 }}>
              <a href="/terms" className={styles.footerLink}>Terms of Service</a>
              <span className={styles.linkDivider}>·</span>
              <a href="/privacy" className={styles.footerLink}>Privacy Policy</a>
            </div>
          </div>
        </TileCard>
  )

  const sessionCard = (
        <TileCard icon="unlock" title="Session">
          <div className={styles.section}>
            <button className={styles.btnDanger} onClick={handleLogout}>
              Log Out
            </button>
          </div>
        </TileCard>
  )

  const activeSessionsCard = (
    <TileCard icon="clock" title="Active Sessions">
      <ActiveSessionsPanel />
    </TileCard>
  )

  const dangerZoneCard = (
    <TileCard icon="warning" title="Danger Zone">
      <DangerZonePanel />
    </TileCard>
  )

  // ── Section map — which cards render under each rail entry ──
  const sectionCards = {
    account: [
      card('profile', profileCard),
      card('security', securityCard),
      card('activeSessions', activeSessionsCard),
      card('session', sessionCard),
      card('dangerZone', dangerZoneCard),
    ],
    billing: [
      card('subscription', subscriptionCard),
      card('referral', <ReferralSection />),
    ],
    preferences: [
      card('prefs', preferencesCard),
      card('notifications', notificationsCard),
      card('digest', digestCard),
      card('tags', tagsCard),
    ],
    charts: [
      card('chartSettings', <ChartSettingsSection prefs={prefs} setPref={setPref} />),
    ],
    compass: [
      card('compassPanel', <VoicePanel />),
      card('voiceMemory', <TileCard icon="mic" title="Voice Memory"><VoiceMemoryPanel /></TileCard>),
      card('voiceTelemetry', <TileCard icon="chart" title="Voice Telemetry"><VoiceTelemetryPanel /></TileCard>),
      card('voiceSessions', <TileCard icon="clock" title="Voice Session History"><VoiceSessionsPanel /></TileCard>),
      card('voiceDocs', <TileCard icon="document" title="Voice Documents"><VoiceDocumentsPanel /></TileCard>),
      card('voiceInsights', <TileCard icon="sparkle" title="Voice Insights Inbox"><VoiceInsightsPanel /></TileCard>),
    ],
    connections: [
      card('broker', <BrokerConnectionsCard />),
    ],
    legal: [
      card('privacy', privacyCard),
      card('prefsBackup', <PreferencesBackupCard />),
      card('disclaimers', disclaimersCard),
    ],
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Settings</h1>
        <div className={styles.headerRight}>
          <button
            className={styles.kbdBtn}
            onClick={() => setPaletteOpen(true)}
            title="Jump to any setting"
            aria-label="Open command palette"
          >
            <UIcon name="search" size={12} />
            <span>Jump to…</span>
            <kbd className={styles.kbdKey}>⌘K</kbd>
          </button>
          <button
            className={styles.kbdIconBtn}
            onClick={() => setHelpOpen(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Show keyboard shortcuts"
          >
            <kbd className={styles.kbdKey}>?</kbd>
          </button>
          <button className={styles.supportLink} onClick={() => navigate('/support', { state: { from: '/settings' } })}>
            <UIcon name="chat" size={13} />
            Need help? Open Support
          </button>
        </div>
      </div>

      <div className={styles.layout}>
        <nav className={styles.rail} aria-label="Settings sections">
          <div className={styles.railSearchWrap}>
            <input
              ref={railSearchRef}
              className={styles.railSearch}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search settings…  ( / )"
              aria-label="Search settings"
            />
            {results !== null && (
              <div className={styles.searchResults}>
                {results.length === 0 ? (
                  <div className={styles.searchEmpty}>No settings match "{query.trim()}"</div>
                ) : results.map(r => (
                  <button key={r.card} className={styles.searchResult} onClick={() => goResult(r)}>
                    <span className={styles.searchResultTitle}>{r.title}</span>
                    <span className={styles.searchResultSection}>
                      {SECTIONS.find(s => s.id === r.section)?.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={styles.railItems}>
            {SECTIONS.map(s => (
              <button
                key={s.id}
                className={`${styles.railItem} ${s.id === section ? styles.railItemActive : ''}`}
                onClick={() => goSection(s.id)}
                aria-current={s.id === section ? 'page' : undefined}
              >
                <UIcon name={s.icon} size={14} />
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <div className={styles.content}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>
              <UIcon name={activeSection.icon} size={15} />
              {activeSection.label}
            </span>
            <span className={styles.sectionDesc}>{activeSection.desc}</span>
          </div>
          {sectionCards[section]}
        </div>
      </div>

      {paletteOpen && (
        <CommandPalette onClose={() => setPaletteOpen(false)} onPick={goResult} />
      )}
      {helpOpen && <ShortcutHelpModal onClose={() => setHelpOpen(false)} />}
      <SaveToast msg={toast.msg} />
    </div>
  )
}

// ── Command palette (⌘K / Ctrl+K) ──────────────────────────────────────────
//
// A floating overlay that opens above the whole Settings page. Same search
// index as the rail — the difference is muscle memory: `⌘K` from anywhere
// beats hunting for a search box. Arrow keys navigate results; Enter fires;
// Esc closes.
function CommandPalette({ onClose, onPick }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const inputRef = useRef(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s.length === 0) return SEARCH_INDEX
    return SEARCH_INDEX.filter(e =>
      e.title.toLowerCase().includes(s) || e.keywords.includes(s)
    )
  }, [q])

  useEffect(() => { setIdx(0) }, [q])

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx(i => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && results[idx]) {
      e.preventDefault()
      onPick(results[idx])
    }
  }

  return (
    <div className={styles.paletteBackdrop} onClick={onClose}>
      <div className={styles.paletteBox} onClick={e => e.stopPropagation()} role="dialog" aria-label="Jump to setting">
        <div className={styles.paletteInputWrap}>
          <UIcon name="search" size={14} />
          <input
            ref={inputRef}
            className={styles.paletteInput}
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to any setting…"
            aria-label="Jump to any setting"
          />
          <kbd className={styles.paletteHint}>Esc</kbd>
        </div>
        <div className={styles.paletteResults}>
          {results.length === 0 ? (
            <div className={styles.paletteEmpty}>No settings match "{q.trim()}"</div>
          ) : results.map((r, i) => {
            const sec = SECTIONS.find(s => s.id === r.section)
            return (
              <button
                key={r.card}
                className={`${styles.paletteResult} ${i === idx ? styles.paletteResultActive : ''}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => onPick(r)}
              >
                {sec && <UIcon name={sec.icon} size={13} />}
                <span className={styles.paletteResultTitle}>{r.title}</span>
                <span className={styles.paletteResultSection}>{sec?.label}</span>
              </button>
            )
          })}
        </div>
        <div className={styles.paletteFooter}>
          <span><kbd className={styles.paletteHint}>↑</kbd><kbd className={styles.paletteHint}>↓</kbd> navigate</span>
          <span><kbd className={styles.paletteHint}>↵</kbd> jump</span>
          <span><kbd className={styles.paletteHint}>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
