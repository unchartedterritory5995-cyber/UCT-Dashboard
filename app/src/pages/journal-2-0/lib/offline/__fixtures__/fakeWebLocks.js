/**
 * A Web Locks stand-in with ONE lock manager and many clients — one client per
 * simulated tab — because the property D3b rests on is cross-tab: a lock one
 * tab holds is visible to `query()` in every other tab of the origin.
 *
 * ⛔ It models what the owner lock and the sync-leader lock actually use, and
 * no more: `request(name, [options,] callback)` with `mode` exclusive/shared,
 * `ifAvailable` and `signal`; a lock is held until the callback's promise
 * settles; requests for one name are granted FIFO; an aborted queued request
 * rejects with an AbortError; and `query()` reports `held` and `pending` with
 * each lock's name, mode and client. Callbacks run in a later microtask, never
 * synchronously, as a browser runs them in a later task.
 */

const abortError = () => {
  const e = new Error('The request was aborted.')
  e.name = 'AbortError'
  return e
}

export function createLockManager() {
  const held = []       // { name, mode, clientId }
  const pending = []    // { name, mode, clientId, callback, resolve, reject }

  const compatible = (name, mode) => {
    const holders = held.filter((l) => l.name === name)
    if (!holders.length) return true
    return mode === 'shared' && holders.every((l) => l.mode === 'shared')
  }

  const grant = (p) => {
    const lock = { name: p.name, mode: p.mode, clientId: p.clientId }
    held.push(lock)
    const done = () => {
      const i = held.indexOf(lock)
      if (i >= 0) held.splice(i, 1)
      pump()
    }
    Promise.resolve()
      .then(() => p.callback({ name: p.name, mode: p.mode }))
      .then((v) => { done(); p.resolve(v) }, (e) => { done(); p.reject(e) })
  }

  const pump = () => {
    for (let i = 0; i < pending.length;) {
      const p = pending[i]
      const earlierForName = pending.slice(0, i).some((q) => q.name === p.name)
      if (!earlierForName && compatible(p.name, p.mode)) {
        pending.splice(i, 1)
        grant(p)
      } else {
        i += 1
      }
    }
  }

  const client = (clientId) => ({
    request(name, optionsOrCallback, maybeCallback) {
      const options = typeof optionsOrCallback === 'function' ? {} : (optionsOrCallback || {})
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
      const mode = options.mode || 'exclusive'
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) { reject(abortError()); return }
        const p = { name, mode, clientId, callback, resolve, reject }
        if (options.ifAvailable) {
          if (compatible(name, mode) && !pending.some((q) => q.name === name)) grant(p)
          else Promise.resolve().then(() => callback(null)).then(resolve, reject)
          return
        }
        pending.push(p)
        options.signal?.addEventListener?.('abort', () => {
          const i = pending.indexOf(p)
          if (i >= 0) { pending.splice(i, 1); reject(abortError()) }
        })
        pump()
      })
    },
    async query() {
      return {
        held: held.map((l) => ({ ...l })),
        pending: pending.map(({ name, mode, clientId: c }) => ({ name, mode, clientId: c })),
      }
    },
  })

  return {
    client,
    /** test-side view: the names currently held / queued */
    heldNames: () => held.map((l) => l.name),
    pendingNames: () => pending.map((p) => p.name),
  }
}
