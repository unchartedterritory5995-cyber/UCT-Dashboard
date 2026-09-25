// The Notebook's on-demand views and dialogs load through this ONE helper (wave 7, lane I,
// fix round 1, review M-5). It retries a failed chunk once IN PLACE, and hands a second
// failure to the app's existing stale-chunk recovery, `utils/lazyWithRetry`.
//
// Before lane I3 these views rode inside the Notebook's own chunk and could not fail to load
// on their own. Now a view's first open fetches its chunk, and two different things can make
// that fetch fail:
//   * a network blip: the file is still on the server, and asking again works;
//   * a deploy since this tab loaded: the old hashed file is gone, asking again fails too, and
//     only a fresh index.html (a reload) knows the new name.
// The in-place retry covers the first without costing the member a reload (their chosen view
// and scroll survive). `lazyWithRetry` covers the second exactly as it does for every route in
// App.jsx: one reload per session, and after that the error reaches the boundary instead of
// looping. Words are never at stake either way -- they live in the durable store.
import lazyWithRetry, { isChunkLoadError } from '../../../utils/lazyWithRetry'

export const RETRY_WAIT_MS = 400

export function importWithOneRetry(load, waitMs = RETRY_WAIT_MS) {
  return load().catch((err) => {
    // Only a failed FETCH is worth asking for again. A module that loaded and then threw is a
    // bug, and a second evaluation would throw the same way.
    if (!isChunkLoadError(err)) throw err
    return new Promise((resolve) => setTimeout(resolve, waitMs)).then(() => load())
  })
}

export default function lazyChunk(load, waitMs = RETRY_WAIT_MS) {
  return lazyWithRetry(() => importWithOneRetry(load, waitMs))
}
