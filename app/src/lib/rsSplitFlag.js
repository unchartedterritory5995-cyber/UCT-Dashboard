/**
 * ⭐ UCT RS split — THE ONE READER of the build flag `VITE_RS_SPLIT_ENABLED`
 * (engineering map §(a) U7, §(e) flag 2). '1' ships the slim UCT RS Line (the
 * MarketSurge look, no presets) and the three new RS definitions; anything else
 * (unset, '', '0', 'true') ships today's UCT Relative Strength. Default OFF means
 * `=== '1'`, fail closed: the convention of every other build flag (`memberPaneGate.js`).
 *
 * ⛔ WHY THIS LIVES OUTSIDE THE CHART ENGINE (U9): `nativeRegistry.js` reads the
 * flag at module load to pick which `rsLine` registers, and re-exports this
 * function. The public glossary page (`pages/RsGlossary.jsx`) must say which RS
 * indicators ship without loading the engine (`RsGlossary.test.jsx` walks its
 * imports and refuses `components/chart/`), so the read sits here, engine-free,
 * and both surfaces answer from the same line. Vite inlines `import.meta.env` at
 * build time, so this is a build-time fact, not a runtime switch.
 */
export function rsSplitEnabled() {
  try {
    return import.meta.env.VITE_RS_SPLIT_ENABLED === '1'
  } catch {
    return false
  }
}
