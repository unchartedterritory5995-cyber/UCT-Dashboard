// UCT Terminal — the BOARD MODEL (TERMINAL-NEXT lane T2). Pure; tests in boardModel.test.js.
//
// Two persisted documents, both versioned by TERM-021's `terminal` board
// (`api/services/workspace_doc_store.py::TERMINAL_PREF_KEYS`):
//
//   terminal_layout  the board on screen: panels, the channels they join, density, the
//                    closed-panel undo stack, pop-out state.             (`readLayout`)
//   terminal_boards  the member's library: named boards (`B:<slug>`), per-ticker presets,
//                    favourite functions, keep-the-classic-calendar.     (`readLibrary`)
//
// ⛔ A BLOB THAT CANNOT BE READ IS NOT AN EMPTY ONE (IA §15 rule 4). `readLayout` answers
// `{ layout, status }`; `status` is `absent` (new member: the default board, saves allowed),
// `ok`, `migrated` (a v1 blob read through the shim below), `unreadable` or `newer` (a later
// build's shape). For the last two the hook shows the default board for THIS SESSION and
// never writes it over the stored blob until the member says so.
//
// ⛔ v1 STAYS READABLE (the shim). v1 panels carried a colour letter `group` (A B C D, or N
// for unlinked). v2 panels carry `channel` (a channel id, or null), and every serialised v2
// panel still carries the `group` letter (`channel`, or `N`), so the letter vocabulary is a
// compatibility VIEW of the channel record, never a second authority.
//
// ⭐ CHANNELS (IA §10.1): a channel is a record `{ id, name, color, sym, history }`, so four
// is a convention, not a ceiling. A–D are the /charts colour groups: their security lives in
// `charts_workspace_groups` (one value with /charts and the app focus, owner call
// 2026-08-14), so their record's `sym` is never read. E and later keep `sym` in the record.
// `history` is that channel's entity recents (IA §14.2), bounded.
import { BY_CODE } from './functions'

export const LAYOUT_VERSION = 2
export const LEGACY_LAYOUT_VERSION = 1
export const LIBRARY_VERSION = 1

/** The visible-panel counts a board can show. 3 exists so closing one of four is not a jump. */
export const PANEL_COUNTS = [1, 2, 3, 4]
export const MAX_VISIBLE = 4
/** Panels kept per board (visible + parked). Never fewer than MIN_PANELS, never more than MAX. */
export const MIN_PANELS = 4
export const MAX_PANELS = 8
export const CLOSED_MAX = 10
export const HISTORY_MAX = 10
export const MAX_CHANNELS = 12
export const MAX_BOARDS = 24
export const FAVORITES_MAX = 16
export const DENSITIES = ['comfortable', 'compact', 'dense']
/** The density control's visible words (audit 2026-10-08: the buttons read "Aa / Ab / ab",
 *  which told a sighted member nothing). Each button's accessible name contains its word. */
export const DENSITY_LABELS = { comfortable: 'Comfortable', compact: 'Compact', dense: 'Dense' }

/** The /charts colour groups. Their security is `charts_workspace_groups`'. */
export const COMPAT_CHANNELS = ['A', 'B', 'C', 'D']
/** The /charts colour-group vocabulary (WidgetHeader.jsx `COLORS`); pinned by test. */
export const LINK_GROUPS = ['A', 'B', 'C', 'D', 'N']
/** The /charts group dot colours (PeriodSortPanel.jsx `COLOR_HEX`); pinned by test. */
export const GROUP_DOT = { A: '#c9a84c', B: '#60a5fa', C: '#4ade80', D: '#c084fc', N: '#6b7280' }
/** Colours for channels beyond D, cycled. Data, not a ceiling. */
export const CHANNEL_COLORS = ['#f472b6', '#fb923c', '#2dd4bf', '#facc15', '#a3e635', '#38bdf8', '#e879f9', '#f87171']

/** `B:<slug>` — a named board's address. Same character class as the server's addresses. */
export const BOARD_ADDRESS_RE = /^B:([A-Za-z0-9_-]{1,40})$/i
const CHANNEL_ID_RE = /^[A-Z][A-Z0-9]{0,3}$/
const HEX_RE = /^#[0-9a-f]{6}$/i
const PRESET_ANY = '*'
const SHARE_MAX_CHARS = 6000

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v, max = 64) => (typeof v === 'string' && v ? v.slice(0, max) : null)
const upperSym = (v) => {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return /^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(s) ? s : null
}

export const isCompatChannel = (id) => COMPAT_CHANNELS.includes(id)
/** The identity of a security for de-duplication: the class separator is spelled both ways. */
export const symKey = (s) => String(s || '').toUpperCase().replace(/-/g, '.')

const DEFAULT_PANEL_SPECS = [
  { code: 'CAL', channel: 'A' },
  { code: 'DES', channel: 'A' },
  { code: 'GP', channel: 'A' },
  { code: 'CN', channel: 'B' },
]

export function defaultChannels() {
  return COMPAT_CHANNELS.map((id) => ({ id, name: `Group ${id}`, color: GROUP_DOT[id], sym: null, history: [] }))
}

function makePanel(spec, id) {
  return { id, code: spec.code, channel: spec.channel ?? null, sym: spec.sym ?? null, args: spec.args || [] }
}

export function defaultLayout() {
  return withCompat({
    v: LAYOUT_VERSION,
    count: 1,
    focus: 0,
    density: 'comfortable',
    activeChannel: 'A',
    channels: defaultChannels(),
    panels: DEFAULT_PANEL_SPECS.map((s, i) => makePanel(s, `p${i + 1}`)),
    closed: [],
  })
}

export const DEFAULT_LAYOUT = Object.freeze(defaultLayout())

/** Every panel's `group` letter, derived from its channel: the compatibility view. */
function withCompat(layout) {
  return { ...layout, panels: layout.panels.map((p) => ({ ...p, group: groupLetter(p) })) }
}

/** The colour letter a panel shows to a reader that knows only A–D + N. */
export function groupLetter(panel) {
  const c = panelChannel(panel)
  return c == null ? 'N' : c
}

/** The channel a stored panel joins — v2 `channel`, else the v1 `group` letter. */
export function panelChannel(panel) {
  if (!panel) return null
  if (panel.channel !== undefined) return panel.channel || null
  return panel.group && panel.group !== 'N' ? panel.group : null
}

/** A panel follows its channel's security unless it opted out or its function has no
 *  security variant (CAL, HELP …): those are `linkable:false` by nature (IA §10.2). */
export function isLinkable(panel) {
  if (!panel || panel.linkable === false) return false
  return !!BY_CODE[panel.code]?.ticker
}

let idSeq = 0
export function newPanelId(panels) {
  const taken = new Set((panels || []).map((p) => p.id))
  let id
  do { idSeq += 1; id = `p${Date.now().toString(36)}${idSeq.toString(36)}` } while (taken.has(id))
  return id
}

// ── reading ───────────────────────────────────────────────────────────────────

function normalizeChannels(raw) {
  const out = []
  const seen = new Set()
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!isObj(c) || typeof c.id !== 'string' || !CHANNEL_ID_RE.test(c.id) || seen.has(c.id)) continue
    seen.add(c.id)
    out.push({
      id: c.id,
      name: str(c.name, 24) || `Group ${c.id}`,
      color: HEX_RE.test(c.color || '') ? c.color : (GROUP_DOT[c.id] || CHANNEL_COLORS[out.length % CHANNEL_COLORS.length]),
      sym: isCompatChannel(c.id) ? null : upperSym(c.sym),
      history: (Array.isArray(c.history) ? c.history : []).map(upperSym).filter(Boolean).slice(0, HISTORY_MAX),
    })
  }
  for (const id of COMPAT_CHANNELS.slice().reverse()) {
    if (!seen.has(id)) out.unshift({ id, name: `Group ${id}`, color: GROUP_DOT[id], sym: null, history: [] })
  }
  const compat = out.filter((c) => isCompatChannel(c.id))
  const extra = out.filter((c) => !isCompatChannel(c.id)).slice(0, MAX_CHANNELS - compat.length)
  return [...compat.sort((a, b) => a.id.localeCompare(b.id)), ...extra]
}

function normalizePanel(p, channelIds, usedIds) {
  if (!isObj(p) || typeof p.code !== 'string' || !p.code) return null
  let id = typeof p.id === 'string' && p.id && !usedIds.has(p.id) ? p.id.slice(0, 40) : null
  if (!id) id = newPanelId([...usedIds].map((x) => ({ id: x })))
  usedIds.add(id)
  const ch = panelChannel(p)
  const out = {
    id,
    code: p.code.slice(0, 12).toUpperCase(),
    channel: ch && channelIds.has(ch) ? ch : null,
    sym: upperSym(p.sym),
    args: Array.isArray(p.args) ? p.args.filter((a) => typeof a === 'string').slice(0, 8) : [],
  }
  if (p.linkable === false) out.linkable = false
  if (p.popout === true) out.popout = true
  return out
}

function padPanels(panels, activeChannel, usedIds) {
  const out = panels.slice(0, MAX_PANELS)
  for (let i = out.length; i < MIN_PANELS; i++) {
    const spec = DEFAULT_PANEL_SPECS[i] || DEFAULT_PANEL_SPECS[0]
    const id = newPanelId([...usedIds].map((x) => ({ id: x })))
    usedIds.add(id)
    out.push(makePanel({ ...spec, channel: activeChannel }, id))
  }
  return out
}

/** Coerce a v2-shaped object into a valid layout (never throws). */
export function normalizeLayout(v) {
  if (!isObj(v)) return defaultLayout()
  const channels = normalizeChannels(v.channels)
  const channelIds = new Set(channels.map((c) => c.id))
  const activeChannel = channelIds.has(v.activeChannel) ? v.activeChannel : 'A'
  const usedIds = new Set()
  const panels = padPanels(
    (Array.isArray(v.panels) ? v.panels : []).map((p) => normalizePanel(p, channelIds, usedIds)).filter(Boolean),
    activeChannel, usedIds)
  const count = Number.isInteger(v.count) && v.count >= 1 && v.count <= MAX_VISIBLE ? v.count : 1
  const focus = Number.isInteger(v.focus) && v.focus >= 0 && v.focus < count ? v.focus : 0
  const closed = (Array.isArray(v.closed) ? v.closed : []).map((c) => {
    if (!isObj(c)) return null
    const panel = normalizePanel(c.panel, channelIds, new Set())
    if (!panel) return null
    delete panel.popout
    return { panel, index: Number.isInteger(c.index) && c.index >= 0 ? Math.min(c.index, MAX_VISIBLE - 1) : 0 }
  }).filter(Boolean).slice(0, CLOSED_MAX)
  return withCompat({
    v: LAYOUT_VERSION,
    count,
    focus,
    density: DENSITIES.includes(v.density) ? v.density : 'comfortable',
    activeChannel,
    channels,
    panels,
    closed,
  })
}

/** THE READ-FALLBACK SHIM: a v1 blob (`{v:1, count, focus, panels:[{code, group, sym, args}]}`)
 *  as the v2 board it means. Its four panel slots keep their order; its letters become channels. */
export function migrateV1(v) {
  const panels = (Array.isArray(v.panels) ? v.panels : []).slice(0, MIN_PANELS).map((p, i) => {
    const d = DEFAULT_PANEL_SPECS[i]
    const q = isObj(p) ? p : {}
    const group = LINK_GROUPS.includes(q.group) ? q.group : d.channel
    return {
      id: `p${i + 1}`,
      code: typeof q.code === 'string' && q.code ? q.code : d.code,
      channel: group === 'N' ? null : group,
      sym: q.sym,
      args: q.args,
    }
  })
  const count = [1, 2, 4].includes(v.count) ? v.count : 1
  return normalizeLayout({ v: LAYOUT_VERSION, count, focus: v.focus, panels, channels: [], closed: [] })
}

/** `{ layout, status }` for whatever the preference holds — see the header for `status`. */
export function readLayout(raw) {
  if (raw == null || raw === '') return { layout: defaultLayout(), status: 'absent' }
  let v = raw
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw) } catch { return { layout: defaultLayout(), status: 'unreadable' } }
  }
  if (!isObj(v)) return { layout: defaultLayout(), status: 'unreadable' }
  if (v.v === LAYOUT_VERSION && Array.isArray(v.panels)) return { layout: normalizeLayout(v), status: 'ok' }
  if (v.v === LEGACY_LAYOUT_VERSION && Array.isArray(v.panels)) return { layout: migrateV1(v), status: 'migrated' }
  if (Number.isInteger(v.v) && v.v > LAYOUT_VERSION) return { layout: defaultLayout(), status: 'newer' }
  return { layout: defaultLayout(), status: 'unreadable' }
}

/** True when the stored blob must not be written over without the member's say-so. */
export const isGuardedStatus = (status) => status === 'unreadable' || status === 'newer'

export function serializeLayout(layout) {
  return JSON.stringify(normalizeLayout(layout))
}

// ── the security a panel shows ────────────────────────────────────────────────

/** Every channel's current security: A–D from `charts_workspace_groups`, the rest from the
 *  record. The map `panelSym` reads, so a v1-style `(panel, groups)` caller keeps working. */
export function channelSyms(layout, groups) {
  const out = {}
  for (const c of layout?.channels || defaultChannels()) {
    const s = isCompatChannel(c.id) ? groups?.[c.id] : c.sym
    out[c.id] = typeof s === 'string' && s ? s.toUpperCase() : null
  }
  return out
}

/** The security a panel shows — its channel's, or its own when unlinked or not linkable. */
export function panelSym(panel, syms) {
  if (!panel) return null
  const ch = panelChannel(panel)
  if (ch && panel.linkable !== false) {
    const s = syms?.[ch]
    return typeof s === 'string' && s ? s.toUpperCase() : null
  }
  return panel.sym || null
}

/** The channel a command with no `@channel` lands on: the focused panel's, else the board's. */
export function activeChannelOf(layout) {
  const p = layout.panels[Math.min(layout.focus, layout.count - 1)]
  return panelChannel(p) || layout.activeChannel || 'A'
}

// ── channels ──────────────────────────────────────────────────────────────────

export function nextChannelId(channels) {
  const taken = new Set(channels.map((c) => c.id))
  for (let code = 69; code <= 90; code++) {           // E … Z
    const id = String.fromCharCode(code)
    if (!taken.has(id)) return id
  }
  for (let n = 27; n < 1000; n++) if (!taken.has(`C${n}`)) return `C${n}`
  return null
}

/** Add a channel. `{ layout, id }`; `id` is null at the MAX_CHANNELS bound (said, not silent). */
export function addChannel(layout) {
  if (layout.channels.length >= MAX_CHANNELS) return { layout, id: null }
  const id = nextChannelId(layout.channels)
  if (!id) return { layout, id: null }
  const extra = layout.channels.filter((c) => !isCompatChannel(c.id)).length
  const channel = { id, name: `Group ${id}`, color: CHANNEL_COLORS[extra % CHANNEL_COLORS.length], sym: null, history: [] }
  return { layout: { ...layout, channels: [...layout.channels, channel] }, id }
}

/** Record that `channelId` now shows `sym`: its history, its record (E+ only), and it becomes
 *  the board's active channel. A–D's security itself is written by the caller to
 *  `charts_workspace_groups` (one authority). */
export function applyChannelSym(layout, channelId, sym) {
  const s = upperSym(sym)
  if (!s || !channelId) return layout
  return {
    ...layout,
    activeChannel: channelId,
    channels: layout.channels.map((c) => (c.id !== channelId ? c : {
      ...c,
      sym: isCompatChannel(c.id) ? null : s,
      // BRK.B and BRK-B are one security: the recents list keeps one of them, the newest.
      history: [s, ...c.history.filter((h) => symKey(h) !== symKey(s))].slice(0, HISTORY_MAX),
    })),
  }
}

/** Move panel `i` to `channelId` (null = unlinked). Unlinking keeps the security it showed. */
export function setPanelChannel(layout, i, channelId, syms) {
  const panels = layout.panels.slice()
  const p = panels[i]
  if (!p) return layout
  const shown = panelSym(p, syms)
  const channel = channelId || null
  panels[i] = { ...p, channel, group: channel || 'N', sym: channel ? p.sym : (shown || p.sym) }
  return { ...layout, panels, activeChannel: channelId || layout.activeChannel }
}

// ── the panel lifecycle: close, undo, duplicate, pop-out, count ───────────────

/** Close visible panel `i`. `{ layout, ok, reason? }` — the last visible panel cannot close. */
export function closePanel(layout, i) {
  if (layout.count <= 1) return { layout, ok: false, reason: 'last' }
  if (i < 0 || i >= layout.count) return { layout, ok: false, reason: 'range' }
  const panels = layout.panels.slice()
  const [gone] = panels.splice(i, 1)
  const { popout: _popout, ...kept } = gone
  const count = layout.count - 1
  const usedIds = new Set(panels.map((p) => p.id))
  const padded = padPanels(panels, activeChannelOf(layout), usedIds)
  return {
    ok: true,
    layout: withCompat({
      ...layout,
      count,
      focus: Math.min(i, count - 1),
      panels: padded,
      closed: [{ panel: kept, index: i }, ...layout.closed].slice(0, CLOSED_MAX),
    }),
  }
}

/** Re-open the most recently closed panel where it was. A full board parks its last panel. */
export function undoClose(layout) {
  const [top, ...rest] = layout.closed
  if (!top) return { layout, ok: false }
  const panels = layout.panels.slice()
  const at = Math.min(top.index, layout.count)
  const id = panels.some((p) => p.id === top.panel.id) ? newPanelId(panels) : top.panel.id
  panels.splice(at, 0, { ...top.panel, id })
  const count = Math.min(layout.count + 1, MAX_VISIBLE)
  return {
    ok: true,
    layout: withCompat({ ...layout, count, focus: Math.min(at, count - 1), panels: panels.slice(0, MAX_PANELS), closed: rest }),
  }
}

/** A copy of panel `i` beside it, on the same channel (a late-added panel inherits the
 *  current context). Refused on a full board rather than parking something silently. */
export function duplicatePanel(layout, i) {
  if (layout.count >= MAX_VISIBLE) return { layout, ok: false, reason: 'full' }
  const src = layout.panels[i]
  if (!src) return { layout, ok: false, reason: 'range' }
  const panels = layout.panels.slice()
  const { popout: _popout, ...copy } = src
  panels.splice(i + 1, 0, { ...copy, id: newPanelId(panels), args: [...(src.args || [])] })
  return { ok: true, layout: withCompat({ ...layout, count: layout.count + 1, focus: i + 1, panels: panels.slice(0, MAX_PANELS) }) }
}

/** Where an "Open SYM CODE" link inside a LIST panel (MOST's catalyst story, an RRG row) lands, so
 *  the list it was clicked in stays on screen. `{ layout, index, added }`:
 *   · the next visible panel already shows `code` → reuse it (a second story replaces the first,
 *     it does not stack a third panel);
 *   · the board has room → a fresh panel right after `from`, on `from`'s own channel (an unlinked
 *     list opens an unlinked panel, exactly as opening in place did), focused;
 *   · a full board → the next visible panel (wrapping), whatever it shows.
 *  On a one-panel board with no room nothing else exists, so `index === from` (in place). */
export function panelBeside(layout, from, code = null) {
  const count = layout.count
  const at = Number.isInteger(from) && from >= 0 && from < count ? from : Math.min(layout.focus, count - 1)
  const after = at + 1 < count ? at + 1 : null
  if (after != null && code && layout.panels[after]?.code === code) return { layout, index: after, added: false }
  if (count < MAX_VISIBLE) {
    const panels = layout.panels.slice()
    const src = panels[at]
    panels.splice(at + 1, 0, { id: newPanelId(panels), code: code || 'DES', channel: panelChannel(src), sym: null, args: [] })
    return {
      layout: withCompat({ ...layout, count: count + 1, panels: panels.slice(0, MAX_PANELS) }),
      index: at + 1,
      added: true,
    }
  }
  return { layout, index: (at + 1) % count, added: false }
}

/** The securities this board looked at lately, newest first, one list: the active channel's
 *  history leads, the other channels' histories are interleaved by recency position (a
 *  channel history carries no timestamps, so position is the only order there is). */
export function recentSecurities(layout, n = 8) {
  const active = layout?.activeChannel
  const chans = [...(layout?.channels || [])].sort((a, b) => (b.id === active) - (a.id === active))
  const out = []
  const seen = new Set()
  const depth = Math.max(0, ...chans.map((c) => (c.history || []).length))
  for (let i = 0; i < depth && out.length < n; i += 1) {
    for (const c of chans) {
      const s = c.history?.[i]
      if (!s || seen.has(symKey(s))) continue
      seen.add(symKey(s))
      out.push(upperSym(s))
      if (out.length >= n) break
    }
  }
  return out
}

/** Move visible panel `i` one place left (`d = -1`) or right (`d = 1`); focus follows it.
 *  `{ layout, ok, to? }` — refused at either edge of the visible board, never wrapped (a
 *  wrap would send the first panel to the far end, which reads as a jump, not a move). */
export function movePanel(layout, i, d) {
  const to = i + d
  if (i < 0 || i >= layout.count || to < 0 || to >= layout.count || (d !== 1 && d !== -1)) {
    return { layout, ok: false }
  }
  const panels = layout.panels.slice()
  ;[panels[i], panels[to]] = [panels[to], panels[i]]
  return { ok: true, to, layout: { ...layout, focus: to, panels } }
}

/** Move visible panel `from` to slot `to` (a drag-and-drop or "Move to panel N"): the panel is
 *  taken out and re-inserted, so the ones between shift by one. Focus follows the moved panel.
 *  Parked panels (beyond `count`) never move. Refused when either slot is off the board or the
 *  two are the same. */
export function reorderPanel(layout, from, to) {
  const n = layout.count
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 || from >= n || to >= n || from === to) {
    return { layout, ok: false }
  }
  const visible = layout.panels.slice(0, n)
  const [moved] = visible.splice(from, 1)
  visible.splice(to, 0, moved)
  return { ok: true, to, layout: { ...layout, focus: to, panels: [...visible, ...layout.panels.slice(n)] } }
}

/** The channel a one-key re-link moves panel `i` to: the board's channels in order, then
 *  "not linked" (null), then round again. `undefined` when the panel follows no security. */
export function nextLinkChannel(layout, i) {
  const p = layout.panels[i]
  if (!isLinkable(p)) return undefined
  const ring = [...layout.channels.map((c) => c.id), null]
  const at = ring.indexOf(panelChannel(p))
  return ring[(at + 1) % ring.length]
}

/** Mark panel `i` popped out (IA §15 rule 8: pop-out state is a field of the document). */
export function setPopout(layout, i, on) {
  const panels = layout.panels.slice()
  if (!panels[i]) return layout
  const { popout: _popout, ...rest } = panels[i]
  panels[i] = on ? { ...rest, popout: true } : rest
  return { ...layout, panels }
}

/** Show `n` panels. A panel that becomes visible unlinked and empty joins the active channel. */
export function setCount(layout, n) {
  if (!PANEL_COUNTS.includes(n)) return layout
  const active = activeChannelOf(layout)
  const panels = layout.panels.map((p, i) => (
    i >= layout.count && i < n && !panelChannel(p) && !p.sym ? { ...p, channel: active } : p))
  return withCompat({ ...layout, count: n, focus: Math.min(layout.focus, n - 1), panels })
}

export function setDensity(layout, density) {
  return DENSITIES.includes(density) ? { ...layout, density } : layout
}

// ── pop-out and share encodings (URL-safe base64 of compact JSON) ─────────────

function b64urlEncode(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(token) {
  const b64 = String(token).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4))
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** The URL a popped-out panel opens: the panel and the security it showed, frozen. */
export function popoutHref(panel, sym) {
  return `/terminal?popout=${b64urlEncode(JSON.stringify({ c: panel.code, s: sym || null, a: panel.args || [] }))}`
}

/** A pop-out token back into a stand-alone, unlinked panel — or null for a bad token. */
export function decodePopout(token) {
  try {
    const v = JSON.parse(b64urlDecode(token))
    if (!isObj(v) || typeof v.c !== 'string') return null
    return { id: 'popout', code: v.c.toUpperCase().slice(0, 12), channel: null, sym: upperSym(v.s),
      args: Array.isArray(v.a) ? v.a.filter((a) => typeof a === 'string').slice(0, 8) : [], group: 'N' }
  } catch { return null }
}

/** A board snapshot as a share token: geometry AND content (IA §14.3 "never geometry without
 *  content") — the panels, their channels and every channel's security at the time. */
export function encodeShare(name, layout, syms) {
  const snap = boardSnapshot(layout, syms)
  return b64urlEncode(JSON.stringify({ n: String(name || 'Shared board').slice(0, 60), l: snap }))
}

/** `{ name, layout }` from a share token, or null (bad, oversized, or not a board). */
export function decodeShare(token) {
  if (typeof token !== 'string' || !token || token.length > SHARE_MAX_CHARS) return null
  try {
    const v = JSON.parse(b64urlDecode(token))
    if (!isObj(v) || !isObj(v.l) || !Array.isArray(v.l.panels)) return null
    return { name: str(v.n, 60) || 'Shared board', layout: normalizeSnapshot(v.l) }
  } catch { return null }
}

export function shareHref(token) {
  return `/terminal?board=${token}`
}

// ── the library: named boards, presets, favourites ────────────────────────────

/** A board as it is SAVED: no undo stack, nothing popped out, every channel's security in its
 *  record (A–D included — a board carries its content, not just its geometry). */
export function boardSnapshot(layout, syms) {
  const l = normalizeLayout(layout)
  // `syms` given: the live securities (a board being saved from screen). Not given: the
  // snapshot's own records (a saved board being shared), A–D included.
  const stored = syms ? null : storedSyms(layout)
  return {
    ...l,
    closed: [],
    panels: l.panels.map(({ popout: _p, ...p }) => p),
    channels: l.channels.map((c) => ({ ...c, sym: (syms ? upperSym(syms[c.id]) : stored.get(c.id)) || null })),
  }
}

function storedSyms(raw) {
  return new Map((Array.isArray(raw?.channels) ? raw.channels : []).filter(isObj).map((c) => [c.id, upperSym(c.sym)]))
}

/** A stored snapshot read back: like `normalizeLayout`, but A–D keep their snapshot `sym`. */
function normalizeSnapshot(raw) {
  const l = normalizeLayout(raw)
  const stored = storedSyms(raw)
  return { ...l, channels: l.channels.map((c) => ({ ...c, sym: stored.get(c.id) ?? c.sym ?? null })) }
}

/** Open a saved/shared board: the layout to show, and the A–D securities to write to
 *  `charts_workspace_groups`. `sym` (a per-ticker preset) retargets the board's active channel. */
export function openBoard(snapshot, { sym } = {}) {
  const snap = normalizeSnapshot(snapshot)
  const active = snap.activeChannel
  const compatSyms = {}
  const channels = snap.channels.map((c) => {
    const s = sym && c.id === active ? upperSym(sym) : c.sym
    if (isCompatChannel(c.id)) {
      if (s) compatSyms[c.id] = s
      return { ...c, sym: null }
    }
    return { ...c, sym: s || null }
  })
  return { layout: withCompat({ ...snap, channels, closed: [] }), compatSyms }
}

export function emptyLibrary() {
  return { v: LIBRARY_VERSION, boards: [], presets: {}, favorites: [], keepCalendar: false }
}

export function slugify(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return s || 'board'
}

/** Two board names are one board when they differ only in case, spacing or punctuation. */
function sameBoardName(a, b) {
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return norm(a) === norm(b)
}

function uniqueSlug(slug, boards, exceptId) {
  const taken = new Set(boards.filter((b) => b.id !== exceptId).map((b) => b.slug))
  if (!taken.has(slug)) return slug
  for (let n = 2; n < 1000; n++) {
    const s = `${slug.slice(0, 36)}-${n}`
    if (!taken.has(s)) return s
  }
  return `${slug.slice(0, 30)}-${Date.now().toString(36)}`
}

export function normalizeLibrary(v) {
  if (!isObj(v)) return emptyLibrary()
  const boards = []
  const seenIds = new Set()
  for (const b of Array.isArray(v.boards) ? v.boards : []) {
    if (!isObj(b) || !isObj(b.layout) || typeof b.id !== 'string' || seenIds.has(b.id)) continue
    const name = str(b.name, 60)
    if (!name) continue
    seenIds.add(b.id)
    boards.push({
      id: b.id.slice(0, 40),
      name,
      slug: uniqueSlug(typeof b.slug === 'string' && b.slug ? slugify(b.slug) : slugify(name), boards, b.id),
      layout: normalizeSnapshot(b.layout),
      updatedAt: Number.isFinite(b.updatedAt) ? b.updatedAt : 0,
      openedAt: Number.isFinite(b.openedAt) ? b.openedAt : 0,
    })
    if (boards.length >= MAX_BOARDS) break
  }
  const ids = new Set(boards.map((b) => b.id))
  const presets = {}
  for (const [k, id] of Object.entries(isObj(v.presets) ? v.presets : {})) {
    const key = k === PRESET_ANY ? PRESET_ANY : upperSym(k)
    if (key && ids.has(id)) presets[key] = id
  }
  const favorites = [...new Set((Array.isArray(v.favorites) ? v.favorites : [])
    .filter((c) => typeof c === 'string' && BY_CODE[c.toUpperCase()]).map((c) => c.toUpperCase()))].slice(0, FAVORITES_MAX)
  return { v: LIBRARY_VERSION, boards, presets, favorites, keepCalendar: v.keepCalendar === true }
}

/** `{ library, status }` — `status` as `readLayout`'s (absent · ok · unreadable · newer). */
export function readLibrary(raw) {
  if (raw == null || raw === '') return { library: emptyLibrary(), status: 'absent' }
  let v = raw
  if (typeof raw === 'string') {
    try { v = JSON.parse(raw) } catch { return { library: emptyLibrary(), status: 'unreadable' } }
  }
  if (!isObj(v)) return { library: emptyLibrary(), status: 'unreadable' }
  if (v.v === LIBRARY_VERSION) return { library: normalizeLibrary(v), status: 'ok' }
  if (Number.isInteger(v.v) && v.v > LIBRARY_VERSION) return { library: emptyLibrary(), status: 'newer' }
  return { library: emptyLibrary(), status: 'unreadable' }
}

/** Save the board on screen under `name` (the same name overwrites it). `{ library, board, ok, reason? }`. */
export function saveBoard(library, name, layout, syms, now = Date.now()) {
  const n = String(name || '').trim().slice(0, 60)
  if (!n) return { library, ok: false, reason: 'name' }
  // "The same name": case, spaces and punctuation do not make a new board.
  const existing = library.boards.find((b) => sameBoardName(b.name, n))
  if (!existing && library.boards.length >= MAX_BOARDS) return { library, ok: false, reason: 'full' }
  const id = existing?.id || `b${now.toString(36)}${library.boards.length.toString(36)}`
  const board = {
    id,
    name: n,
    slug: existing?.slug || uniqueSlug(slugify(n), library.boards, id),
    layout: boardSnapshot(layout, syms),
    updatedAt: now,
    openedAt: now,
  }
  const boards = existing ? library.boards.map((b) => (b.id === id ? board : b)) : [...library.boards, board]
  return { library: { ...library, boards }, board, ok: true }
}

export function renameBoard(library, id, name) {
  const n = String(name || '').trim().slice(0, 60)
  if (!n || library.boards.some((b) => b.id !== id && sameBoardName(b.name, n))) return library
  return { ...library, boards: library.boards.map((b) => (b.id === id ? { ...b, name: n, slug: uniqueSlug(slugify(n), library.boards, id) } : b)) }
}

export function deleteBoard(library, id) {
  const presets = Object.fromEntries(Object.entries(library.presets).filter(([, v]) => v !== id))
  return { ...library, boards: library.boards.filter((b) => b.id !== id), presets }
}

/** The ticker presets that open board `id` (what `deleteBoard` drops with it). */
export function presetsOfBoard(library, id) {
  return Object.fromEntries(Object.entries(library.presets || {}).filter(([, v]) => v === id))
}

/** Put a just-deleted board back (the Undo on a delete): at its old place in the list, with the
 *  presets that opened it. Into the CURRENT library, so anything changed since the delete stays.
 *  `{ library, ok, reason? }` — refused when a board with that id or name is back already, or
 *  the library is full. A preset re-pointed at another board since the delete is left alone. */
export function restoreBoard(library, board, presets = {}, index = null) {
  if (!board || typeof board.id !== 'string') return { library, ok: false, reason: 'missing' }
  if (library.boards.some((b) => b.id === board.id || sameBoardName(b.name, board.name))) {
    return { library, ok: false, reason: 'exists' }
  }
  if (library.boards.length >= MAX_BOARDS) return { library, ok: false, reason: 'full' }
  const restored = { ...board, slug: uniqueSlug(board.slug || slugify(board.name), library.boards, board.id) }
  const at = Number.isInteger(index) ? Math.max(0, Math.min(index, library.boards.length)) : library.boards.length
  const boards = [...library.boards.slice(0, at), restored, ...library.boards.slice(at)]
  const back = Object.fromEntries(Object.entries(presets).filter(([k]) => !(k in library.presets)))
  return { library: { ...library, boards, presets: { ...library.presets, ...back } }, ok: true }
}

/** A board by `B:` slug, by bare slug, or by id. */
export function findBoard(library, ref) {
  const m = String(ref || '').trim().match(BOARD_ADDRESS_RE)
  const key = (m ? m[1] : String(ref || '').trim()).toLowerCase()
  if (!key) return null
  return library.boards.find((b) => b.slug === key) || library.boards.find((b) => b.id.toLowerCase() === key) || null
}

export const boardAddress = (board) => `B:${board.slug}`

export function markOpened(library, id, now = Date.now()) {
  return { ...library, boards: library.boards.map((b) => (b.id === id ? { ...b, openedAt: now } : b)) }
}

/** Saved-object recents (IA §14.2): boards, most recently opened first. */
export function recentBoards(library, n = 5) {
  return library.boards.filter((b) => b.openedAt > 0).slice().sort((a, b) => b.openedAt - a.openedAt).slice(0, n)
}

/** Point `sym` (or `*` = any bare ticker) at a board, or clear it with `boardId` null. */
export function setPreset(library, sym, boardId) {
  const key = sym === PRESET_ANY ? PRESET_ANY : upperSym(sym)
  if (!key) return library
  const presets = { ...library.presets }
  if (boardId && library.boards.some((b) => b.id === boardId)) presets[key] = boardId
  else delete presets[key]
  return { ...library, presets }
}

/** The board a bare `sym` opens: its own preset, else the any-ticker one, else null. */
export function presetFor(library, sym) {
  const s = upperSym(sym)
  // BRK.B and BRK-B are one security (round 3): a preset set for one spelling answers the other.
  const key = s && Object.keys(library.presets).find((k) => k !== PRESET_ANY && symKey(k) === symKey(s))
  const id = (key && library.presets[key]) || library.presets[PRESET_ANY]
  return id ? library.boards.find((b) => b.id === id) || null : null
}

export const PRESET_ANY_TICKER = PRESET_ANY

export function toggleFavorite(library, code) {
  const c = String(code || '').toUpperCase()
  if (!BY_CODE[c]) return library
  const has = library.favorites.includes(c)
  return { ...library, favorites: has ? library.favorites.filter((f) => f !== c) : [...library.favorites, c].slice(0, FAVORITES_MAX) }
}

export function setKeepCalendar(library, on) {
  return { ...library, keepCalendar: on === true }
}
