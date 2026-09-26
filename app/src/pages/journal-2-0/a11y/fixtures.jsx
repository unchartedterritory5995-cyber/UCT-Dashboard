// app/src/pages/journal-2-0/a11y/fixtures.jsx
//
// Shared render fixtures for the Notebook axe rails (wave 8, lane 8A, A1). One
// fetch router and one provider stack, so every surface is rendered the way the
// app renders it — real children, real SWR hooks — with only the network faked.
//
// ⛔ The router answers every Notebook read with a REALISTIC payload (folders,
// tags, saved views, a note with a table and a callout, a graph, tasks), never
// `{}` for everything: an empty payload renders the empty state, and an axe run
// over an empty state proves nothing about the populated screen a member sees.
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { vi } from 'vitest'
import { AuthContext } from '../../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'

export const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const cell = (t, type = 'tableCell') => ({ type, content: [P(t)] })
const row = (...c) => ({ type: 'tableRow', content: c })

export const STATUS_DEF = {
  id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set',
  options: [
    { id: 'watching', label: 'Watching', color: 'blue' },
    { id: 'active', label: 'Active', color: 'green' },
    { id: 'closed', label: 'Closed', color: 'gray' },
  ],
}
export const REVIEW_DEF = { id: 'builtin:review_date', name: 'Review Date', type: 'date', source: 'user_set' }
export const PROPERTY_DEFS = [STATUS_DEF, REVIEW_DEF]

export const NOTES = [
  {
    id: 'n1', title: 'NVDA thesis', subtitle: 'Data centre cycle', folderId: 'f1', ticker: 'NVDA',
    tags: ['semis', 'thesis'], updatedAt: '2026-09-20T15:00:00Z', createdAt: '2026-09-01T15:00:00Z',
    excerpt: 'Watching the gap.', isFavorite: true,
    propertiesJson: { 'builtin:thesis_status': 'active', 'builtin:review_date': '2026-09-24' },
  },
  {
    id: 'n2', title: 'Weekly plan', subtitle: '', folderId: 'f2', ticker: null,
    tags: ['plan'], updatedAt: '2026-09-19T15:00:00Z', createdAt: '2026-09-02T15:00:00Z',
    excerpt: 'Three names on watch.', isFavorite: false,
    propertiesJson: { 'builtin:thesis_status': 'watching', 'builtin:review_date': '2026-09-26' },
  },
  {
    id: 'n3', title: 'Untriaged idea', subtitle: '', folderId: null, ticker: null,
    tags: [], updatedAt: '2026-09-18T15:00:00Z', createdAt: '2026-09-03T15:00:00Z',
    excerpt: '', isFavorite: false, propertiesJson: {},
  },
]

export const FOLDERS = [
  { id: 'f1', name: 'Theses', parentId: null, sortOrder: 0 },
  { id: 'f2', name: 'Plans', parentId: null, sortOrder: 1 },
  { id: 'f3', name: 'Archive 2025', parentId: 'f2', sortOrder: 0 },
]

export const TAGS = {
  tags: [{ tag: 'semis', count: 1 }, { tag: 'thesis', count: 1 }, { tag: 'plan', count: 1 }],
  tree: [
    { path: 'semis', key: 'semis', own: 1, total: 1 },
    { path: 'thesis', key: 'thesis', own: 1, total: 1 },
    { path: 'plan', key: 'plan', own: 1, total: 1 },
  ],
}

export const SAVED_VIEWS = [
  { id: 'v1', name: 'Active theses', viewType: 'list', spec: { propertyFilter: [{ propertyId: 'builtin:thesis_status', op: 'eq', value: 'active' }] } },
]

export const GRAPH = {
  nodes: [
    { id: 'n1', title: 'NVDA thesis', folderId: 'f1', updatedAt: '2026-09-20T15:00:00Z', degree: 2 },
    { id: 'n2', title: 'Weekly plan', folderId: 'f2', updatedAt: '2026-09-19T15:00:00Z', degree: 1 },
    { id: 'n3', title: 'AMD thesis', folderId: 'f1', updatedAt: '2026-09-18T15:00:00Z', degree: 1 },
    { id: 'n4', title: 'Lonely note', folderId: null, updatedAt: '2026-09-17T15:00:00Z', degree: 0 },
  ],
  edges: [
    { source: 'n1', target: 'n2', weight: 1 },
    { source: 'n1', target: 'n3', weight: 2 },
  ],
  truncated: false,
}

export const TASKS = {
  today: '2026-09-23', truncated: false,
  tasks: [
    { noteId: 'n1', noteTitle: 'NVDA thesis', noteUpdatedAt: '2026-09-22', index: 0, checked: false, text: 'Check the gap fill', due: '2026-09-20', bucket: 'overdue', depth: 0 },
    { noteId: 'n2', noteTitle: 'Weekly plan', noteUpdatedAt: '2026-09-22', index: 1, checked: false, text: 'Size the starter', due: '2026-09-23', bucket: 'today', depth: 0 },
    { noteId: 'n2', noteTitle: 'Weekly plan', noteUpdatedAt: '2026-09-22', index: 2, checked: false, text: 'Read the filing', due: null, bucket: 'none', depth: 0 },
  ],
}
TASKS.count = TASKS.tasks.length

export const NOTE_BODY = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Setup' }] },
    P('Intro line with a [[link]] to follow.'),
    { type: 'table', content: [row(cell('Sym', 'tableHeader'), cell('R', 'tableHeader')), row(cell('NVDA'), cell('2.1'))] },
    { type: 'callout', attrs: { variant: 'note' }, content: [P('Watch the gap.')] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [P('Check the fill')] }] },
  ],
}

export const noteDetail = (over = {}) => ({
  id: 'n1', title: 'NVDA thesis', subtitle: 'Data centre cycle', folderId: 'f1',
  ticker: 'NVDA', tags: ['semis'], heroImageUrl: null, updatedAt: '2026-09-20T15:00:00Z',
  createdAt: '2026-09-01T15:00:00Z', isFavorite: false, isLocked: false,
  propertiesJson: { 'builtin:thesis_status': 'active' },
  bodyJson: NOTE_BODY, ...over,
})

export const VERSIONS = {
  versions: [
    { id: 'v1', createdAt: '2026-09-19T15:00:00Z', title: 'NVDA thesis', words: 42, source: 'autosave' },
    { id: 'v2', createdAt: '2026-09-18T15:00:00Z', title: 'NVDA thesis', words: 30, source: 'autosave' },
  ],
}

/** The default read routes. Each value is a body, or `[status, body]`. The first
 *  key whose regex matches the path (query stripped) wins, so specific routes
 *  come first. Override per test with `installFetch({ '<regex source>': body })`. */
export function defaultRoutes() {
  return [
    [/^\/api\/j2\/notes\/graph$/, GRAPH],
    [/^\/api\/j2\/notes\/tasks$/, TASKS],
    [/^\/api\/j2\/notes\/tags$/, TAGS],
    [/^\/api\/j2\/notes\/folder-counts$/, { counts: { f1: 1, f2: 1, f3: 0 }, unfiled: 1, total: 3 }],
    [/^\/api\/j2\/notes\/favorites$/, { notes: [NOTES[0]] }],
    [/^\/api\/j2\/notes\/recents$/, { notes: [NOTES[1]] }],
    [/^\/api\/j2\/notes\/by-folders$/, { byFolder: { f1: [NOTES[0]], f2: [NOTES[1]], f3: [] } }],
    [/^\/api\/j2\/notes\/sector-theme-facets$/, { sectors: ['Technology'], themes: ['AI'] }],
    [/^\/api\/j2\/notes\/link-targets$/, { targets: { n2: { title: 'Weekly plan', status: 'active' }, n3: { title: 'Untriaged idea', status: 'trashed' } } }],
    [/^\/api\/j2\/notes\/[^/]+\/properties$/, { properties: [
      { ...STATUS_DEF, value: 'active' },
      { ...REVIEW_DEF, value: '2026-09-24' },
      { id: 'p_rel', name: 'Peers', type: 'relation', source: 'user_set', value: ['n2', 'n3'] },
      { id: 'p_conf', name: 'Conviction', type: 'text', source: 'user_set', value: null },
    ] }],
    [/^\/api\/j2\/notes\/switcher$/, { notes: [...NOTES, { id: 'n5', title: 'AMD thesis', updatedAt: '2026-09-15T15:00:00Z' }] }],
    [/^\/api\/j2\/notes\/[^/]+\/versions$/, VERSIONS],
    [/^\/api\/j2\/notes\/[^/]+\/versions\/[^/]+$/, { version: { id: 'v1', createdAt: '2026-09-19T15:00:00Z', title: 'NVDA thesis', bodyJson: NOTE_BODY } }],
    [/^\/api\/j2\/notes\/[^/]+\/backlinks$/, { count: 1, notes: [{ id: 'n2', title: 'Weekly plan', context: 'see the NVDA thesis for sizing', refs: 2 }] }],
    [/^\/api\/j2\/notes\/[^/]+\/related-from$/, { count: 1, notes: [{ id: 'n3', title: 'Untriaged idea', properties: ['Peers'] }] }],
    [/^\/api\/j2\/notes\/[^/]+\/unlinked-mentions$/, {
      count: 1, title: 'NVDA thesis',
      notes: [{ id: 'n3', title: 'Untriaged idea', occurrences: 2, snippet: { before: 'Watching the ', match: 'NVDA thesis', after: ' closely.' } }],
    }],
    [/^\/api\/j2\/notes\/[^/]+\/(documents|excerpts|embeds|attachments|facts|reviews|evidence|evidence-candidates|images)$/, {}],
    [/^\/api\/j2\/notes\/[^/]+$/, { note: noteDetail() }],
    [/^\/api\/j2\/notes$/, { notes: NOTES, total: NOTES.length }],
    [/^\/api\/j2\/note-folders$/, { folders: FOLDERS }],
    [/^\/api\/j2\/saved-views$/, { savedViews: SAVED_VIEWS }],
    [/^\/api\/j2\/property-defs$/, { propertyDefs: PROPERTY_DEFS }],
    [/^\/api\/j2\/note-templates$/, { templates: [{ id: 't1', name: 'Morning prep', createdAt: '2026-09-01T15:00:00Z' }] }],
    [/^\/api\/j2\/notebook\/home$/, { recents: NOTES, favorites: [NOTES[0]] }],
    [/^\/api\/auth\/preferences$/, { preferences: {} }],
  ]
}

/** Install a global fetch that routes by path. Unknown GETs answer `{}` with 200
 *  (a surface's optional side-panel is not what an axe rail is about); every
 *  call is recorded on the returned spy. */
export function installFetch(extra = []) {
  const table = [...extra, ...defaultRoutes()]
  const spy = vi.fn((input) => {
    const url = typeof input === 'string' ? input : input?.url || ''
    const path = url.split('?')[0]
    const hit = table.find(([re]) => re.test(path))
    const val = hit ? hit[1] : {}
    const [status, body] = Array.isArray(val) && typeof val[0] === 'number' ? val : [200, val]
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: () => Promise.resolve(typeof body === 'function' ? body(url) : body),
      text: () => Promise.resolve(JSON.stringify(body)),
      blob: () => Promise.resolve(new Blob([])),
    })
  })
  global.fetch = spy
  return spy
}

export const AUTH = {
  user: { id: 'u1', email: 'member@local.dev', display_name: 'Member', role: 'user' },
  plan: 'pro', isPaid: true, loading: false,
  hubPreviewEnabled: false, researchTechnicalTabEnabled: false, researchFlowTabEnabled: false,
  refetch: () => {}, logout: () => {},
}

/** The three wave-8 payload flags, all on or all off (seam S8-1). */
export function latchWave8Flags(on, extra = {}) {
  __resetNotebookFlags()
  latchNotebookFlags({
    j2_share_links_enabled: on,
    notebook_publish_enabled: on,
    notebook_onboarding_enabled: on,
    ...extra,
  })
}

/** The provider stack the Journal renders the Notebook inside. */
export function Providers({ children, route = '/journal/notebook', auth = AUTH }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </AuthContext.Provider>
    </SWRConfig>
  )
}
