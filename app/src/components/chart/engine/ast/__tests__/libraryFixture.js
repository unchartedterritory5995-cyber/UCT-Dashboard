// app/src/components/chart/engine/ast/__tests__/libraryFixture.js
//
// ⭐ U15 — A TEST'S OWN LIBRARY ENTRY, SERVABLE. Since U15 a library is compiled only with
// the sha256 of its own source (`pineLibraryStore.js::libraryEntryProblem`), exactly as the
// server's store serves it. Fixture libraries are written from scratch for each rail (never
// third-party code); this stamps the sha their source really has, so a rail exercises the
// same rule a member's chart does.
import { sha256Hex } from '../parse.js'

/** `entry` with `sha256` = the sha256 of its `source` (UTF-8). */
export function fixtureLibrary(entry) {
  return { ...entry, sha256: sha256Hex(entry.source) }
}

/** A map `{path: entry}` with every entry stamped. */
export function fixtureLibraries(map) {
  return Object.fromEntries(Object.entries(map).map(([k, e]) => [k, fixtureLibrary(e)]))
}
