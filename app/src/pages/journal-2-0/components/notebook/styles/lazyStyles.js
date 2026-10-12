// Notebook P1: the ONLY dynamic import of the journal-styles surfaces (see StyleSurfaces.js). Callers pass the
// name of the piece they want to `lazyChunk` / `lazyView`: loadStyle('KindSection'), 'StyleHost',
// 'SaveStyleDoor'. ⛔ Do not add a second dynamic import of these modules in an eager file: each one costs
// ~265 B on the Notebook's first open (rail: NoteEditorPage.styleChunks.test.js).
//
// The pieces are NAMED exports of one module, and lazyChunk's own in-place retry keeps a retried module only
// if it has a `default`; so this does the retry itself, accepting the module when it holds the piece, and
// hands lazyChunk a `{ default }`. A chunk blip heals in place instead of reloading the page.
import { importWithOneRetry } from '../../../lib/lazyChunk'

const surfaces = () => import('./StyleSurfaces')

export const loadStyle = (name, load = surfaces) =>
  importWithOneRetry(load, 400, (m) => !!m?.[name]).then((m) => ({ default: m[name] }))
