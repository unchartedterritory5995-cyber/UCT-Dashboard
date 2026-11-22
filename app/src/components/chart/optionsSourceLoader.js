/**
 * ⭐ THE LOADER FOR A SERVER-OWNED LIST OF CHOICES (2026-11-12).
 *
 * The fetch half of `engine/optionsSources.js`, kept OUT of the engine because
 * the engine is in the Pine runtime closure, which admits no network call and no
 * wall clock (`tools/pine_runtime_closure.mjs`). It loads a source once per page,
 * shares the one request between every asker, records the answer (or the
 * failure) through `_recordOptionsSource`, and retries a failure only after
 * {@link RETRY_AFTER_MS} or when forced (the chooser's "Try again").
 */
import { OPTIONS_SOURCES, isOptionsSource, cleanOptions, peekOptionsSource, _recordOptionsSource } from './engine/optionsSources'

/** After a failed load, the next ask retries no sooner than this. */
export const RETRY_AFTER_MS = 15000

/**
 * Load a source once (shared). Never throws: the promise resolves to the
 * options, `[]` on a failure, and the source's state says which.
 *
 * @param {string} name a key of `OPTIONS_SOURCES`
 * @param {{force?: boolean, fetchImpl?: Function, now?: () => number}} [opts]
 */
export function loadOptionsSource(name, { force = false, fetchImpl, now = () => Date.now() } = {}) {
  if (!isOptionsSource(name)) return Promise.resolve([])
  const cur = peekOptionsSource(name)
  if (cur.status === 'ready') return Promise.resolve(cur.options)
  if (cur.status === 'loading' && cur.promise) return cur.promise
  if (cur.status === 'error' && !force && now() - cur.at < RETRY_AFTER_MS) return Promise.resolve([])
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null)
  if (!doFetch) return Promise.resolve([])
  const promise = Promise.resolve()
    // the server lane's own fetch shape (`serverCompute._defaultFetch`)
    .then(() => doFetch(OPTIONS_SOURCES[name].url, { credentials: 'include' }))
    .then((r) => {
      if (!r || !r.ok) throw new Error(`HTTP ${r ? r.status : '?'}`)
      return r.json()
    })
    .then((body) => {
      const options = cleanOptions(body)
      _recordOptionsSource(name, { status: 'ready', options, at: now() })
      return options
    })
    .catch(() => {
      _recordOptionsSource(name, { status: 'error', options: [], at: now() })
      return []
    })
  _recordOptionsSource(name, { status: 'loading', options: [], at: now(), promise })
  return promise
}
