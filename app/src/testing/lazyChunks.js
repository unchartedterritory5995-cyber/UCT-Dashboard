// app/src/testing/lazyChunks.js
//
// ─── THE HEAVY LAZY CHUNKS A TEST WAITS ON, LOADED BEFORE IT WAITS ─────────────────────────
//
// ⛔ THE CLASS (2026-11-20). A product module loaded lazily (`lazy(() => import(...))`, or an
// `await import(...)` inside a door) is, in this runner, its whole import graph being transformed on first
// use: the census (every product dynamic import timed per test, across app/src on GitHub's runners) measured
// these at 1-30 s. A test's `findBy*` / `waitFor` waits 4 s (`src/test-setup.js::asyncUtilTimeout`, which a
// test's own timeout does not raise), so a test whose first wait sits behind one of these RACES a module load,
// and on a saturated runner it loses, for a reason that is not the thing it tests. Measured: with only these
// loads made 6 s slower, 25 tests in 13 files went red, and every one of those passes with its chunks loaded
// here first. (#2114 and #2132 fixed the first two by hand; this is the class.)
//
// ⭐ `preloadLazyChunks(...names)` at module or describe scope loads the named modules once, in `beforeAll`,
// with their own allowance. The waits in the tests then measure the feature, not the loading of its code.
// ⛔ ONE AUTHORITY PER CHUNK: each entry names the file that loads it lazily and the EXACT specifier it uses;
// `lazyChunks.test.js` holds every entry to its importer's source, so a chunk that moves or is renamed fails
// there, by name, instead of bringing the race back.
import { beforeAll } from 'vitest'

/** name -> { importer (src-relative), spec (as written in the importer), load } */
export const LAZY_CHUNKS = Object.freeze({
  builderSheet: { importer: 'components/chart/ChartToolbar.jsx', spec: './builder/BuilderSheet',
    load: () => import('../components/chart/builder/BuilderSheet') },
  // (engine 94, #2367: Indicator House's copy builds through the member door's worker service, so the tab loads
  // memberDoorAsync lazily, and memberPaneDefinition loads with it)
  memberDoorAsync: { importer: 'components/chart/IndicatorHouseTab.jsx', spec: './builder/memberPane/memberDoorAsync',
    load: () => import('../components/chart/builder/memberPane/memberDoorAsync') },
  tradeChartPane: { importer: 'pages/journal-2-0/components/trade/TradeDetailPage.jsx', spec: '../../../../components/chart/pane/ChartPane',
    load: () => import('../components/chart/pane/ChartPane') },
  ownChartSettings: { importer: 'pages/journal-2-0/lib/widgetEmbedCore.js', spec: '../../../components/chart/pane/ownChartSettings',
    load: () => import('../components/chart/pane/ownChartSettings') },
  capturedSourceSheet: { importer: 'pages/journal-2-0/components/notebook/NoteEditorPage.jsx', spec: './CapturedSourceSheet',
    load: () => import('../pages/journal-2-0/components/notebook/CapturedSourceSheet') },
  documentPreviewSheet: { importer: 'pages/journal-2-0/components/notebook/NoteEditorPage.jsx', spec: './DocumentPreviewSheet',
    load: () => import('../pages/journal-2-0/components/notebook/DocumentPreviewSheet') },
  tableToolbar: { importer: 'pages/journal-2-0/components/notebook/EditorToolSlots.jsx', spec: './TableToolbar',
    load: () => import('../pages/journal-2-0/components/notebook/TableToolbar') },
  tiptap: { importer: 'pages/journal-2-0/lib/notebookSchema.js', spec: './tiptap',
    load: () => import('../pages/journal-2-0/lib/tiptap') },
  styleSurfaces: { importer: 'pages/journal-2-0/components/notebook/styles/lazyStyles.js', spec: './StyleSurfaces',
    load: () => import('../pages/journal-2-0/components/notebook/styles/StyleSurfaces') },
  noteBatch: { importer: 'pages/journal-2-0/tabs/NotebookTab.jsx', spec: '../lib/noteBatch',
    load: () => import('../pages/journal-2-0/lib/noteBatch') },
  savedViewsMenuGroup: { importer: 'pages/journal-2-0/tabs/NotebookTab.jsx', spec: '../components/notebook/SavedViewsMenuGroup',
    load: () => import('../pages/journal-2-0/components/notebook/SavedViewsMenuGroup') },
  noteConnectorsTrustStrip: { importer: 'pages/journal-2-0/tabs/NotebookTab.jsx', spec: '../components/connectors/NoteConnectorsTrustStrip',
    load: () => import('../pages/journal-2-0/components/connectors/NoteConnectorsTrustStrip') },
  noteBoardView: { importer: 'pages/journal-2-0/tabs/NotebookTab.jsx', spec: '../components/notebook/NoteBoardView',
    load: () => import('../pages/journal-2-0/components/notebook/NoteBoardView') },
  notebookAiPanel: { importer: 'pages/journal-2-0/components/notebook/NotebookAiPanelSlot.jsx', spec: './NotebookAiPanel',
    load: () => import('../pages/journal-2-0/components/notebook/NotebookAiPanel') },
})

/** The chunks the note editor's first render can wait on. */
export const NOTE_EDITOR_CHUNKS = Object.freeze(['ownChartSettings', 'capturedSourceSheet', 'documentPreviewSheet', 'tableToolbar', 'tiptap'])
/** The chunks the Notebook tab's list, bulk bar and views can wait on. */
export const NOTEBOOK_TAB_CHUNKS = Object.freeze(['noteBatch', 'savedViewsMenuGroup', 'noteConnectorsTrustStrip', 'noteBoardView', 'notebookAiPanel'])

/** The allowance for loading them: generous, because it is the module graph's cold transform on a busy runner,
 *  and it is paid once per file, never by a test's own wait. */
export const LAZY_CHUNK_ALLOWANCE_MS = 300_000

/** Load the named chunks once, before any test in this scope waits on them. */
export function preloadLazyChunks(...names) {
  const flat = names.flat()
  for (const n of flat) if (!LAZY_CHUNKS[n]) throw new Error(`preloadLazyChunks: no lazy chunk named ${n}`)
  beforeAll(async () => { await Promise.all(flat.map((n) => LAZY_CHUNKS[n].load())) }, LAZY_CHUNK_ALLOWANCE_MS)
}
