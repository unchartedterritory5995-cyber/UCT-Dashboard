// app/src/components/chart/builder/usePineLibraries.js
//
// ⭐ L1 — fetch the Pine libraries a source imports, from the server's store, into
// the client-side registry (`engine/ast/pineLibraryStore.js`), and say when they
// arrived. The translators are synchronous and read the registry; a door adds the
// returned `revision` to the dependencies of its translation so it re-runs once
// the libraries are in. A source that imports nothing costs nothing: no request,
// and `revision` never moves.
import { useEffect, useState } from 'react'

import { ensurePineLibraries, importPathsOf, pineLibraryEntry } from '../engine/ast/pineLibraryStore'

export function usePineLibraries(source) {
  const [revision, setRevision] = useState(0)
  const paths = importPathsOf(source).join('|')
  useEffect(() => {
    if (!paths) return undefined
    if (paths.split('|').every((p) => pineLibraryEntry(p))) return undefined
    let alive = true
    ensurePineLibraries(source).then(({ loaded }) => {
      if (alive && loaded.length) setRevision((r) => r + 1)
    })
    return () => { alive = false }
    // ⭐ keyed on the import LINES, not the text: typing elsewhere fetches nothing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths])
  return revision
}
