// ── BREADTH PAGE (W2-C1): what the /breadth sheet shows — read only ───────────────────────────────────
//
// The breadth DATA capabilities (capabilities/breadth.js `breadth.show`, breadthHistory.js `breadth.history`)
// read UCT's finalized readings through /api/agent/breadth* and work on every page. On /breadth the page
// host adds what the member is LOOKING AT (tab, window, the top date, the columns) so the Agent can say it
// and aim its readings — nothing on the page is written: views, customize, share and drill stay the
// page's own controls (the walkthrough points at them: W2-C2).
//   breadth.page   a QUERY: what the page shows now

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'

const REF = 'breadthPage'
const TAB_WORD = { breadth: 'the daily breadth sheet', overview: 'the daily overview', heatmap: 'the heat map', charts: 'Data Charts', cot: 'COT data', analogues: 'Analogues' }

function snap(host) {
  const src = host?.breadthPage
  if (!src) return null
  const p = src.snapshot()
  return { ref: REF, label: 'Breadth page', ...p }
}

export const breadthPageKind = {
  name: 'breadthPage',
  source: 'breadthPage',             // fix-nothing-on-workspace: the host source this kind reads (capabilities.noTargetSentence)
  unavailable: "The breadth sheet isn't available on this page — open Breadth to use it.",
  boardScoped: false,
  selfDescribing: true,
  list: (host) => { const s = snap(host); return s ? [s] : [] },
  read: (host, ref) => (ref === REF ? snap(host) : null),
  stateOf: (s) => ({ ...s }),
  patch: () => null,
  commit: async () => false,
  landed: () => true,
  undoPatch: () => null,
  fingerprint: (s) => JSON.stringify([s.tab, s.days, s.topDate]),
}

export function describeBreadthPage(s) {
  if (!s) return 'The Breadth page is not available here.'
  const tab = TAB_WORD[s.tab] || `the ${s.tab} tab`
  if (s.tab !== 'breadth' && s.tab !== 'overview' && s.tab !== 'heatmap') return `You're on ${tab} of the Breadth page.`
  if (s.loading && !s.rowCount) return `You're on ${tab}; it is still loading.`
  const window = s.days ? `the last ${s.days} days` : 'its default window'
  const top = s.topDate ? `, newest session ${s.topDate}` : ''
  const rows = s.rowCount ? ` ${s.rowCount} session row${s.rowCount === 1 ? '' : 's'} are on the sheet` : ''
  const cols = s.columns?.length ? `, columns: ${s.columns.slice(0, 12).join(', ')}${s.columns.length > 12 ? '…' : ''}` : ''
  const live = s.live ? ' Today\'s live (provisional) reading sits above the finalized rows.' : ''
  return `You're on ${tab} showing ${window}${top}.${rows}${cols}.${live} Ask me for a reading ("how is US breadth now?") or its history ("when was it last below 20%?").`
}

let registered = false
export function registerBreadthPageCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(breadthPageKind)
  registerContextProvider({
    key: 'breadthPage',
    build: (host, refFor) => {
      const s = snap(host)
      if (!s) return undefined
      return [{ ref: refFor('breadthPage', REF), label: 'The Breadth page (what the member is looking at; read only)', tab: s.tab, days: s.days, topDate: s.topDate, rows: s.rowCount }]
    },
  })
  registerCapability({
    name: 'breadth.page',
    surfaces: ['breadth'],
    target: 'breadthPage', query: true,
    summary: 'Say what the Breadth PAGE shows now (which tab, how many days, the newest session on the sheet, its columns). Changes nothing. Use it for "what does this page show?", "what am I looking at?". For the readings themselves use breadth.show.',
    hints: 'target = the ref of the Breadth page entry.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    fastWhole: true,
    fast: ({ lower }) => (/^(what does (this|the) (breadth )?page show|what('s| is) (on )?(this|the) (breadth )?page|what am i looking at|what('s| is) this (sheet|table|page))[?.!]?$/.test(lower) ? {} : null),
    answer: (s) => describeBreadthPage(s),
  })
}
