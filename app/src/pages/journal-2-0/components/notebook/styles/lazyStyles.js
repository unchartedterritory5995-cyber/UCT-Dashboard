// Notebook P1: the ONLY dynamic import of the journal-styles surfaces (see StyleSurfaces.js). Callers pass the
// name of the piece they want to `lazyChunk` / `lazyView`: loadStyle('KindSection'), 'StyleHost',
// 'SaveStyleDoor'. ⛔ Do not add a second dynamic import of these modules in an eager file: each one costs
// ~265 B on the Notebook's first open (rail: NoteEditorPage.styleChunks.test.js).
// The retry lazyChunk makes for a failed chunk fetch re-imports the module under a new name and cannot pick
// the piece out of it, so a failed fetch here falls to lazyChunk's page-reload path -- the same place a
// stale chunk after a deploy ends up.
export const loadStyle = (name) => import('./StyleSurfaces').then((m) => ({ default: m[name] }))
