// ── SETTINGS capabilities: a few of the member's own low-risk preferences ──────────
//
// Exactly the values the Settings page offers, written through the SAME writer it uses
// (usePreferences.setPref → POST /api/auth/preferences), which resolves true only once the
// server has accepted the write. Nothing else is reachable: no raw key, no free value.
//   theme             the whole app's colours (Settings → Preferences → App theme)
//   default_chart_tf  the timeframe a new chart opens on (Settings → Charts)
//   alert_sound(_type) the alert chime (Settings → Preferences → Alerts)
// Each change has an exact Undo (the previous value), refused if the setting was
// changed again since. ⛔ Not here: account, email, password, billing, security,
// notification routing (it can silence every alert), digests (they send email).

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { APP_THEMES, isUctTheme, uctThemeId, uctThemeValue } from '../../styles/appThemes'
import { ALERT_SOUNDS } from '../../utils/alertSound'

// The base themes AppThemePicker offers (plain data-theme values) + the UCT catalog.
const BASE_THEMES = [{ value: 'dark', label: 'Graphite (default dark)' }, { value: 'oled', label: 'OLED Black' }, { value: 'light', label: 'Light' }]
const THEME_IDS = [...BASE_THEMES.map(t => t.value), ...APP_THEMES.map(t => t.id).filter(id => !['dark', 'oled', 'light'].includes(id))]
const themeValue = (id) => (BASE_THEMES.some(t => t.value === id) ? id : uctThemeValue(id))
export function themeLabel(v) {
  const base = BASE_THEMES.find(t => t.value === v)
  if (base) return base.label
  const t = isUctTheme(v) ? APP_THEMES.find(x => x.id === uctThemeId(v)) : null
  return t ? `${t.name} (${t.family})` : String(v || 'default')
}
// Settings → Charts "Default chart timeframe" (pages/Settings.jsx TF_OPTIONS).
const TF = [{ value: '5', label: '5 min' }, { value: '30', label: '30 min' }, { value: '60', label: '1 hr' }, { value: 'D', label: 'Daily' }, { value: 'W', label: 'Weekly' }]
const tfLabel = (v) => TF.find(t => t.value === String(v))?.label || String(v)
const soundLabel = (k) => ALERT_SOUNDS.find(s => s.key === k)?.label || k

const KEYS = ['theme', 'default_chart_tf', 'alert_sound', 'alert_sound_type']
const DEFAULTS = { theme: 'dark', default_chart_tf: 'D', alert_sound: 'on', alert_sound_type: 'chime' }
function snap(host) {
  const p = host?.prefs?.read?.() || {}
  const v = Object.fromEntries(KEYS.map(k => [k, p[k] == null || p[k] === '' ? DEFAULTS[k] : String(p[k])]))
  return { ref: 'settings', label: 'Your settings', values: v }
}
const sigOf = (values, keys) => JSON.stringify(keys.map(k => values[k]))

export const settingsKind = {
  name: 'settings',
  boardScoped: false,
  selfDescribing: true,
  list: (host) => (host?.prefs ? [snap(host)] : []),
  read: (host, ref) => (ref === 'settings' && host?.prefs ? snap(host) : null),
  stateOf: (s) => ({ values: { ...s.values } }),
  patch(before, after) {
    const set = Object.fromEntries(KEYS.filter(k => after.values[k] !== before.values[k]).map(k => [k, after.values[k]]))
    return Object.keys(set).length ? { set, from: Object.fromEntries(Object.keys(set).map(k => [k, before.values[k]])) } : null
  },
  async commit(host, ref, patch) {
    const done = []
    for (const [k, v] of Object.entries(patch.set)) {
      // setPref resolves true only after the server accepted it (false: refused / not saved).
      const ok = await host.prefs.write(k, v)
      if (!ok) {
        // Put back what this step already saved, then say it plainly.
        for (const d of done) { try { await host.prefs.write(d, patch.from[d]) } catch { /* reported below */ } }
        throw new Error('the server did not confirm the change, so it is not saved')
      }
      done.push(k)
    }
    return true
  },
  landed: (s, patch) => !!s && Object.entries(patch.set).every(([k, v]) => s.values[k] === v),
  undoPatch: (item) => (item.patch?.set ? { set: item.patch.from, from: item.patch.set } : null),
  fingerprint: (s) => sigOf(s.values, KEYS),
  // Undo needs only the settings THIS change touched to be as it left them.
  fingerprintFor: (host, s, item) => sigOf(s.values, Object.keys(item.patch?.set || {})),
}

let registered = false
export function registerSettingsCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(settingsKind)
  registerContextProvider({
    key: 'settings',
    build: (host, refFor) => (host?.prefs ? [{
      ref: refFor('settings', 'settings'), label: 'Your app settings',
      appTheme: themeLabel(snap(host).values.theme), defaultChartTimeframe: tfLabel(snap(host).values.default_chart_tf),
      alertSound: snap(host).values.alert_sound === 'off' ? 'off' : soundLabel(snap(host).values.alert_sound_type),
    }] : undefined),
  })

  registerCapability({
    name: 'settings.show',
    surfaces: ['charts'],
    target: 'settings', query: true,
    summary: 'Say what the member\'s app settings are now (app theme, default chart timeframe, alert sound). Use this (disposition apply) for "show my settings".',
    hints: 'target = the ref of the settings entry.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fastWhole: true,
    fast: ({ lower }) => (/^(show|what are|list)( me)? my (app )?settings[?.!]?$/.test(lower) ? {} : null),
    answer(s) {
      if (!s) return 'Settings are not available here.'
      const v = s.values
      return {
        text: [`App theme: ${themeLabel(v.theme)}`, `Default chart timeframe: ${tfLabel(v.default_chart_tf)}`,
          `Alert sound: ${v.alert_sound === 'off' ? 'off' : `on (${soundLabel(v.alert_sound_type)})`}`].join('\n'),
        link: { href: '/settings?section=preferences', label: 'Open Settings' },
      }
    },
  })

  registerCapability({
    name: 'settings.setAppTheme',
    surfaces: ['charts'],
    target: 'settings',
    summary: 'Change the WHOLE APP\'s colour theme (sidebar, panels, pages) — e.g. "switch to dark mode / light mode". Not a chart\'s colours: for one chart use chart.applyTheme.',
    hints: `target = the ref of the settings entry. theme: dark = Graphite (the default dark), oled = OLED Black, light = Light; or one of UCT's themes: ${APP_THEMES.map(t => `${t.id} (${t.name}, ${t.family})`).join(', ')}. "Dark mode" = dark; "light mode" = light.`,
    args: { type: 'object', properties: { theme: { type: 'string', enum: THEME_IDS } }, required: ['theme'], additionalProperties: false },
    check: (st, { theme }) => (THEME_IDS.includes(theme) ? null : `“${theme}” isn't one of UCT's app themes.`),
    apply: (st, { theme }) => ({ ...st, values: { ...st.values, theme: themeValue(theme) } }),
    noop: (st) => `Your app theme is already ${themeLabel(st.values.theme)}`,
    describe: (b, a) => (a.values.theme !== b.values.theme ? `App theme: ${themeLabel(b.values.theme)} → ${themeLabel(a.values.theme)}` : null),
  })

  registerCapability({
    name: 'settings.setDefaultTimeframe',
    surfaces: ['charts'],
    target: 'settings',
    summary: 'Change the timeframe NEW charts open on by default (Settings → Charts). Charts already on the board keep theirs — for one of those use chart.setTimeframe.',
    hints: 'target = the ref of the settings entry. timeframe: 5 | 30 | 60 (minutes), D (daily), W (weekly) — the only choices Settings offers.',
    args: { type: 'object', properties: { timeframe: { type: 'string', enum: TF.map(t => t.value) } }, required: ['timeframe'], additionalProperties: false },
    check: (st, { timeframe }) => (TF.some(t => t.value === timeframe) ? null : `The default chart timeframe can be ${TF.map(t => t.label).join(', ')}.`),
    apply: (st, { timeframe }) => ({ ...st, values: { ...st.values, default_chart_tf: timeframe } }),
    noop: (st) => `New charts already open on ${tfLabel(st.values.default_chart_tf)}`,
    describe: (b, a) => (a.values.default_chart_tf !== b.values.default_chart_tf ? `Default chart timeframe: ${tfLabel(b.values.default_chart_tf)} → ${tfLabel(a.values.default_chart_tf)} (new charts)` : null),
  })

  registerCapability({
    name: 'settings.setAlertSound',
    surfaces: ['charts'],
    target: 'settings',
    summary: 'Turn the in-app alert sound on or off, and/or pick which sound plays (Settings → Preferences → Alerts). Does not change whether alerts are delivered.',
    hints: `target = the ref of the settings entry. enabled: true | false | null (keep); sound: ${ALERT_SOUNDS.map(s => `${s.key} (${s.label})`).join(', ')}, or null (keep).`,
    args: {
      type: 'object',
      properties: { enabled: { type: ['boolean', 'null'] }, sound: { type: ['string', 'null'], enum: [...ALERT_SOUNDS.map(s => s.key), null] } },
      required: ['enabled', 'sound'], additionalProperties: false,
    },
    check: (st, { enabled, sound }) => {
      if (enabled == null && sound == null) return 'Say whether to turn the alert sound on or off, or which sound to use.'
      if (sound != null && !ALERT_SOUNDS.some(s => s.key === sound)) return `“${sound}” isn't one of the alert sounds.`
      return null
    },
    apply: (st, { enabled, sound }) => ({
      ...st,
      values: { ...st.values, ...(enabled != null ? { alert_sound: enabled ? 'on' : 'off' } : {}), ...(sound ? { alert_sound_type: sound, ...(enabled == null ? { alert_sound: 'on' } : {}) } : {}) },
    }),
    noop: () => 'The alert sound is already set that way',
    describe(b, a) {
      const out = []
      if (a.values.alert_sound !== b.values.alert_sound) out.push(`Alert sound ${a.values.alert_sound === 'off' ? 'off' : 'on'}`)
      if (a.values.alert_sound_type !== b.values.alert_sound_type) out.push(`alert sound: ${soundLabel(b.values.alert_sound_type)} → ${soundLabel(a.values.alert_sound_type)}`)
      return out.length ? out.join(' · ') : null
    },
  })
}
