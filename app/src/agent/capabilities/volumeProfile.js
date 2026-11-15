// ── VOLUME PROFILE (Charts execution family, 2026-11-12, owner-approved) ─────────────────────────────────────────────
//
// A chart's Volume Profile overlay — the horizontal volume-by-price bins with the point of control — turned on or off and its
// Bins / Color / Point of control changed, exactly as Chart Settings → Indicators (its row toggle and fields) and the Indicator
// Library (its row) do. Marker: the action id 'volumeProfile.set'.
//
// ⛔ IT IS NOT AN INDICATOR INSTANCE. `volumeProfile` is the one carved-out key (nativeRegistry.CARVED_OUT_INDICATOR_KEYS): a
// 2D canvas overlay with NO definition, so `indicator.add` still refuses it, and nothing here creates a definition or an
// instance. The write is Indicators' own seam, `agentMutations.writeVolumeProfile` → the settings row's `applyRowPatch` on
// `cs.indicators.volumeProfile` (the shape the library's `toggledRow` makes) — never a hand-built settings shape.
//
// State is the chart's settings (the chart kind): ONE onOptsChange through the ChartWidget adapter, read back exactly
// (chartKind.landed), exact Undo of the settings keys it touched (the prior `indicators` block). Bins are the row's own
// 8–50 whole numbers: outside that it asks, never clamps. Colours: hex (a few plain names → hex) or rgb()/rgba(), what the
// canvas paints. A chart with no traded volume (an economic or breadth series) is "not available here": it would draw nothing.
// Targeting is the chart kind's (the clicked chart, a named one, every chart, exceptions), never its own.

import { registerCapability } from '../capabilities'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'
import { isEconomicId } from '../../components/chart/engine/econMark'
import { volumeProfileFields, volumeProfileOf, checkVolumeProfilePatch, writeVolumeProfile, VOLUME_PROFILE_REASONS } from '../../components/chart/builder/agentMutations'
import { normalizeColor, colorName, isBreadthLikeSymbol } from './chart'

export const VOLUME_PROFILE_ACTION = 'volumeProfile.set'
const onCharts = (ctx) => ctx.surface === 'charts'
const chartCommon = { target: 'chart', surfaces: ['charts'], available: onCharts }
const KEYS = ['enabled', 'bins', 'color', 'pocColor']
const BINS = () => volumeProfileFields().find(f => f.key === 'bins')

// ⛔ THE PRODUCT STILL OFFERS THE ROW THERE (AUDIT #1173 ruling 1): Chart Settings → Indicators lists the carved-out row on
// every chart (indicatorRegistry.listAllIndicators → listCarvedOutIndicators, unconditional) and so does the Indicator Library
// (indicatorCatalog.catalogRows = definitions ∪ CARVED_OUT_ROWS, not filtered by symbol). What these charts lack is VOLUME:
// an economic primary's host rows are `{t}` only (engine/economicPrimary.primaryEconomicBars) and a breadth / indicator series
// is a "symbol with no volume" (StockChart `blankVolume`), so drawVolumeProfile draws nothing. So the Agent DECLINES to turn it
// on there and says why — never "not available" — and points at the product's own door.
export const VP_NOT_HERE = (sym) => `I didn’t turn on Volume Profile on ${sym}: it bins traded volume and ${sym} has no volume data, so nothing would draw. It is still in that chart’s Chart Settings → Indicators if you want it on anyway — nothing was changed.`
// relative bins ("more bins", "double the bins", "fewer bins"): the product has no step for "more", so it ASKS for a number
export const VP_RELATIVE_BINS = `How many bins? Volume Profile takes a whole number from 8 to 50 (as in Chart Settings) — say, for example, “set the volume profile bins to 30”. Nothing was changed.`
const ASK_WHAT = 'Turn Volume Profile on or off, or change its bins or colours? Nothing was changed.'
const OFF_WITH_SETTINGS = 'Turning Volume Profile off hides it, so its bins and colours would not show. Turn it off, or change its settings? Nothing was changed.'

/** The patch the member asked for, colours said as names normalised to hex (what the picker stores); null args left out. */
export function vpPatchOf(args = {}) {
  const p = {}
  for (const k of KEYS) {
    const v = args?.[k]
    if (v === null || v === undefined) continue
    p[k] = (k === 'color' || k === 'pocColor') && typeof v === 'string' ? (normalizeColor(v) || v.trim()) : v
  }
  return p
}
const settingWords = (p) => {
  const out = []
  if ('bins' in p) out.push(`${p.bins} bins`)
  if ('color' in p) out.push(`colour ${colorName(p.color)}`)
  if ('pocColor' in p) out.push(`point of control colour ${colorName(p.pocColor)}`)
  return out
}

function checkVp(st, args = {}) {
  const sym = st.symbol || null
  const p = vpPatchOf(args)
  if (!Object.keys(p).length) return ASK_WHAT
  // turning it OFF there is harmless and stays allowed (it may have been switched on by hand)
  if (sym && (isEconomicId(sym) || isBreadthLikeSymbol(sym)) && p.enabled !== false) return VP_NOT_HERE(sym)
  const chk = checkVolumeProfilePatch(p)
  if (!chk.ok) {
    if (chk.key === 'bins') return `Volume Profile’s bins are a whole number from ${BINS().min} to ${BINS().max} (as in Chart Settings) — ${args.bins} isn’t, so nothing was changed. How many bins?`
    if (chk.key === 'color' || chk.key === 'pocColor') return `“${args[chk.key]}” isn’t a colour I can set for Volume Profile’s ${chk.key === 'pocColor' ? 'point of control' : 'bars'} — use a hex value like #2962ff. Nothing was changed.`
    return ASK_WHAT
  }
  const settings = settingWords(chk.patch)
  if (chk.patch.enabled === false && settings.length) return OFF_WITH_SETTINGS
  // the row's fields only show what the chart draws while it is on: a settings change on an OFF profile asks first
  if (!('enabled' in chk.patch) && !volumeProfileOf(st.cs).enabled) {
    return `Volume Profile is off on this chart. Turn it on with ${settings.join(' and ')}? Nothing was changed.`
  }
  return null
}

function describeVp(b, a) {
  const was = volumeProfileOf(b.cs), now = volumeProfileOf(a.cs)
  const diff = {}
  for (const k of ['bins', 'color', 'pocColor']) if (was[k] !== now[k]) diff[k] = now[k]
  const words = settingWords(diff)
  const wasOf = (k) => (k === 'bins' ? was.bins : colorName(was[k]))
  if (!was.enabled && now.enabled) return `Turned on Volume Profile${words.length ? ` with ${words.join(' and ')}` : ''}`
  if (was.enabled && !now.enabled) return 'Turned off Volume Profile (its bins and colours are kept)'
  if (!words.length) return null
  const parts = Object.keys(diff).map((k) => `${settingWords({ [k]: diff[k] })[0]} (was ${wasOf(k)})`)
  return `Set Volume Profile to ${parts.join(' and ')}`
}

function noopVp(st, _a, args = {}) {
  const p = vpPatchOf(args)
  const now = volumeProfileOf(st.cs)
  if (p.enabled === false) return 'Volume Profile is already off on this chart'
  const words = settingWords(Object.fromEntries(Object.keys(p).filter(k => k !== 'enabled').map(k => [k, now[k]])))
  return `Volume Profile is already on on this chart${words.length ? ` with ${words.join(' and ')}` : ''}`
}

// ── the member's own obvious words (no model call). "volume" alone is the Volume PANE (volume.setState) and "vwap" an
// indicator; "VP" counts only beside an on / off verb (the product's own NOT_ADDABLE reads "vp" as Volume Profile) ──
const NAME = '(?:the |my |a )?(?:volume[ -]?profile|vol profile|vpvr|visible range volume profile)(?: overlay| indicator)?'
const NAME_OR_VP = `(?:${NAME}|(?:the |my )?vp)`
const ON = '(?:add|show|turn on|enable|display|put|apply|switch on)'
const OFF = '(?:remove|hide|turn off|disable|delete|switch off)'
const WHERE = '(?: (?:on|to|onto|from|off) (?:the )?chart| from| off)?'
const BINS_WORD = '(?:bins?|rows?|buckets?|levels?)'
// relative bins — "more bins", "fewer volume profile bins", "double the bins", "halve the vpvr rows": ASKED for a number in fixed
// words (never a guessed step), and only when it is the whole message. "Bins" alone is Volume Profile's word (no other UCT control
// has bins); rows / buckets / levels count only beside the profile's own name ("double the rows" is the Multi Chart grid's).
const REL = '(?:more|fewer|less|extra|double|twice|triple|half|halve|increase|decrease|raise|lower|bump|cut|reduce)'
const REL_BINS = new RegExp(`^(?!.*\\d).*\\b${REL}\\b.*\\b(?:bins?|bin count)\\b`)
const REL_ROWS = new RegExp(`^(?!.*\\d)(?=.*\\b(?:volume[ -]?profile|vpvr)\\b).*\\b${REL}\\b.*\\b(?:rows?|buckets?|levels?)\\b`)
function fastRelative(lower, typed) {
  if (/[,;&]|\b(?:and|then)\b/.test(String(typed || lower).toLowerCase())) return null
  return REL_BINS.test(lower) || REL_ROWS.test(lower) ? { __say: VP_RELATIVE_BINS } : null
}
function fastVp(lower) {
  let m = new RegExp(`^${ON} ${NAME_OR_VP}${WHERE}$`).exec(lower)
  if (m) return { enabled: true, bins: null, color: null, pocColor: null }
  m = new RegExp(`^${OFF} ${NAME_OR_VP}${WHERE}$`).exec(lower)
  if (m) return { enabled: false, bins: null, color: null, pocColor: null }
  m = new RegExp(`^${NAME} (on|off)$`).exec(lower)
  if (m) return { enabled: m[1] === 'on', bins: null, color: null, pocColor: null }
  m = new RegExp(`^${ON} ${NAME}${WHERE} (?:with|at|using) (\\d{1,3}) ${BINS_WORD}$`).exec(lower)
  if (m) return { enabled: true, bins: Number(m[1]), color: null, pocColor: null }
  m = new RegExp(`^(?:set|change|make|use|give)(?: the)? ${NAME}(?:'s)? (?:bins?|bin count|number of bins|rows?|buckets?)(?: to| =)? (\\d{1,3})(?: ${BINS_WORD})?$`).exec(lower)
  if (m) return { enabled: null, bins: Number(m[1]), color: null, pocColor: null }
  m = new RegExp(`^(?:set|change|make|use|give)(?: the)? ${NAME}(?: to| use| with)? (\\d{1,3}) ${BINS_WORD}$`).exec(lower)
  if (m) return { enabled: null, bins: Number(m[1]), color: null, pocColor: null }
  return null
}

let registered = false
export function registerVolumeProfileCapabilities() {
  if (registered) return
  registered = true

  registerCapability({
    ...chartCommon,
    name: VOLUME_PROFILE_ACTION,
    summary: 'Turn ONE chart\'s Volume Profile overlay (volume-by-price bins, point of control) on or off, or set its bins / colours, as Chart Settings → Indicators does. Undo restores it exactly.',
    hints: 'target = the chart. Pass only what was asked; null for the rest. enabled true/false; bins 8-50 whole; color / pocColor = hex. Volume Profile / VPVR = this (never indicator.add). Volume pane = volume.setState; VWAP = indicator.add.',
    args: { type: 'object', properties: {
      enabled: { type: ['boolean', 'null'] },
      bins: { type: ['integer', 'null'] },
      color: { type: ['string', 'null'] },
      pocColor: { type: ['string', 'null'] },
    }, required: KEYS, additionalProperties: false },
    fast: ({ lower, typed }) => fastVp(lower) || fastRelative(lower, typed),
    fastWhole: true,
    check: checkVp,
    apply(st, args = {}) {
      const r = writeVolumeProfile(st.cs, vpPatchOf(args), nativeRegistry)
      // the settings row's own commit stamps the preset (ChartSettingsModal setRow: `{...next, preset: 'custom'}`)
      return r.ok ? { ...st, cs: { ...r.cs, preset: 'custom' } } : st
    },
    describe: describeVp,
    noop: noopVp,
  })
}

export { VOLUME_PROFILE_REASONS }
