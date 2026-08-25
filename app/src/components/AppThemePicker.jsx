import { useMemo, useState } from 'react'
import { APP_THEMES, APP_THEME_FAMILIES, isUctTheme, uctThemeId, uctThemeValue } from '../styles/appThemes'
import styles from './AppThemePicker.module.css'

// The always-present base themes (not in the catalog — plain data-theme values).
// 'dark' is the default (neutral graphite, tokens.css :root); 'oled' is pure black.
const BASICS = [
  { value: 'dark', label: 'Graphite', desc: 'Default — soft neutral graphite', swatch: '#17181a' },
  { value: 'oled', label: 'OLED Black', desc: 'Pure black for AMOLED', swatch: '#000000' },
  { value: 'light', label: 'Light', desc: 'Clean white', swatch: '#e8eff5' },
]

// Resolve the concrete colors a preview needs. Dark themes carry their own text
// tokens; light themes inherit near-black text from the light base, so fill those
// in. gain/loss are constant per family (green/red never change across themes).
function previewColors(theme) {
  const t = theme.tokens
  const lightFam = theme.family === 'light'
  return {
    bg: t['--bg'],
    surface: t['--bg-surface'],
    elevated: t['--bg-elevated'],
    border: t['--border'],
    text: t['--text'] || (lightFam ? '#1f2328' : '#b6b09d'),
    muted: t['--text-muted'] || (lightFam ? '#57606a' : '#8c8674'),
    bright: t['--text-bright'] || (lightFam ? '#0b0e11' : '#e0dac8'),
    accent: theme.accent,
    gain: lightFam ? '#0a5c22' : '#3cb868',
    loss: lightFam ? '#7d1620' : '#e74c3c',
  }
}

// A tiny mock of the app chrome painted from the theme's own colors — the
// app-theme analog of the chart-theme candlestick preview.
function ThemeMock({ theme }) {
  const c = previewColors(theme)
  return (
    <span className={styles.mock} style={{ background: c.bg, borderColor: c.border }}>
      {/* top bar */}
      <span className={styles.mockTop} style={{ background: c.elevated, borderColor: c.border }}>
        <span className={styles.mockDot} style={{ background: c.accent }} />
        <span className={styles.mockBar} style={{ background: c.bright, width: '34%' }} />
        <span className={styles.mockBar} style={{ background: c.muted, width: '16%', marginLeft: 'auto' }} />
      </span>
      <span className={styles.mockBody}>
        {/* rail */}
        <span className={styles.mockRail} style={{ background: c.surface, borderColor: c.border }}>
          <span className={styles.mockRailDot} style={{ background: c.accent }} />
          <span className={styles.mockRailDot} style={{ background: c.muted }} />
          <span className={styles.mockRailDot} style={{ background: c.muted }} />
        </span>
        {/* card */}
        <span className={styles.mockCard} style={{ background: c.surface, borderColor: c.border }}>
          <span className={styles.mockLine} style={{ background: c.text, width: '70%' }} />
          <span className={styles.mockLine} style={{ background: c.muted, width: '48%' }} />
          <span className={styles.mockChips}>
            <span className={styles.mockPill} style={{ background: c.accent }} />
            <span className={styles.mockNum} style={{ color: c.gain }}>+</span>
            <span className={styles.mockNum} style={{ color: c.loss }}>−</span>
          </span>
        </span>
      </span>
    </span>
  )
}

export default function AppThemePicker({ value, onChange }) {
  const uctActive = isUctTheme(value)
  const [tab, setTab] = useState(uctActive ? 'uct' : 'basics')
  const [family, setFamily] = useState('all')
  const [query, setQuery] = useState('')
  const activeId = uctThemeId(value)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return APP_THEMES.filter(t =>
      (family === 'all' || t.family === family) &&
      (!q || t.name.toLowerCase().includes(q) || t.family.includes(q))
    )
  }, [family, query])

  return (
    <div className={styles.wrap}>
      <div className={styles.tabs} role="tablist">
        <button role="tab" aria-selected={tab === 'basics'}
          className={`${styles.tab} ${tab === 'basics' ? styles.tabOn : ''}`}
          onClick={() => setTab('basics')}>Basics</button>
        <button role="tab" aria-selected={tab === 'uct'}
          className={`${styles.tab} ${tab === 'uct' ? styles.tabOn : ''}`}
          onClick={() => setTab('uct')}>UCT App Themes</button>
      </div>

      {tab === 'basics' ? (
        <div className={styles.basics}>
          {BASICS.map(o => (
            <button key={o.value}
              className={`${styles.baseCard} ${!uctActive && value === o.value ? styles.cardOn : ''}`}
              onClick={() => onChange(o.value)}>
              <span className={styles.swatch} style={{ background: o.swatch }} />
              <span className={styles.baseLabel}>{o.label}</span>
              <span className={styles.baseDesc}>{o.desc}</span>
              {!uctActive && value === o.value && <span className={styles.check}>✓</span>}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className={styles.controls}>
            <div className={styles.pills}>
              <button className={`${styles.pill} ${family === 'all' ? styles.pillOn : ''}`}
                onClick={() => setFamily('all')}>All</button>
              {APP_THEME_FAMILIES.map(f => (
                <button key={f.id}
                  className={`${styles.pill} ${family === f.id ? styles.pillOn : ''}`}
                  onClick={() => setFamily(f.id)}>{f.label}</button>
              ))}
            </div>
            <input className={styles.search} placeholder="Search themes…"
              value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className={styles.grid}>
            {shown.map(theme => {
              const on = activeId === theme.id
              return (
                <button key={theme.id}
                  className={`${styles.themeCard} ${on ? styles.cardOn : ''}`}
                  onClick={() => onChange(uctThemeValue(theme.id))}>
                  <ThemeMock theme={theme} />
                  <span className={styles.themeMeta}>
                    <span className={styles.themeName}>{theme.name}</span>
                    <span className={styles.themeTag}>{on ? '✓ Active' : theme.family}</span>
                  </span>
                </button>
              )
            })}
            {shown.length === 0 && <div className={styles.empty}>No themes match “{query}”.</div>}
          </div>
        </>
      )}
    </div>
  )
}
