// app/src/components/chart/engine/ast/__tests__/pineLibraryStoreLoader.js
//
// ⭐ OPT-IN, NODE-ONLY: load a library store directory (the layout
// `api/services/pine_library_store.py` writes — `<root>/<Author>/<Library>/<N>.json`)
// into the client-side registry, for a census measured WITH the real libraries.
//
//   PINE_LIBRARY_STORE=<dir> npx vitest run …census…
//
// ⛔ The store is a SCRATCH directory outside the repository (third-party library
// code is never committed). Unset ⇒ nothing is loaded and the census measures the
// registry as every production process starts it: empty.
import fs from 'node:fs'
import path from 'node:path'

import { registerPineLibrary } from '../pineLibraryStore.js'

export function loadPineLibraryStore(root) {
  const loaded = []
  if (!root || !fs.existsSync(root)) return loaded
  for (const author of fs.readdirSync(root)) {
    const adir = path.join(root, author)
    if (!fs.statSync(adir).isDirectory()) continue
    for (const name of fs.readdirSync(adir)) {
      const ndir = path.join(adir, name)
      if (!fs.statSync(ndir).isDirectory()) continue
      for (const f of fs.readdirSync(ndir)) {
        if (!/^[1-9][0-9]*\.json$/.test(f)) continue
        try {
          const e = registerPineLibrary(JSON.parse(fs.readFileSync(path.join(ndir, f), 'utf8')))
          if (e) loaded.push(e.path)
        } catch { /* an unreadable entry is not loaded */ }
      }
    }
  }
  return loaded.sort()
}

/** Load `PINE_LIBRARY_STORE` when it is set; returns the paths loaded ([] unset). */
export function loadPineLibraryStoreFromEnv() {
  return loadPineLibraryStore(process.env.PINE_LIBRARY_STORE || '')
}
