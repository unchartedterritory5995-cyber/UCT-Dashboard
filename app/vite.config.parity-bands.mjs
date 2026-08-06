/** SIDE A of the Flip-C parity gate: this tree, built with PANE_MODE = 'bands'.
 *
 * ⛔ THROWAWAY. Delete after the builds — it is not part of the app.
 *
 * WHY IT IS NOT AN EDIT. Side A is "the shipping tree with the one constant
 * flipped back", and the honest way to get that is to change nothing on disk:
 * `core.autocrlf=true` on this repo means `git checkout -- <file>` does NOT
 * restore bytes (it rewrote 4,037 line endings in the case file once), so every
 * "restored byte-for-byte" claim after a temporary source edit is a claim about
 * whichever convention happened to be on disk. Substituting at TRANSFORM time
 * leaves `app/src` untouched and emits exactly the bundle an edit would have.
 *
 * ⛔ AND THE SUBSTITUTION ASSERTS IT APPLIED, TWICE — a silent no-op here builds
 * side A as a second copy of side B, and the gate then reports 0 changed pixels
 * on all 46 cases and reads as a pass. `transform` refuses a `paneLayout.js`
 * without the needle; `closeBundle` refuses a build where it ran anything other
 * than exactly once.
 *
 *   cd app && npx vite build --config vite.config.parity-bands.mjs
 */
import base from './vite.config.js'

const NEEDLE = "export const PANE_MODE = 'panes'"
const REPLACEMENT = "export const PANE_MODE = 'bands'"

let applied = 0

function paneModeBands() {
  return {
    name: 'uct-parity-pane-mode-bands',
    enforce: 'pre',
    transform(code, id) {
      const p = id.replace(/\\/g, '/').split('?')[0]
      if (!p.endsWith('/components/chart/engine/paneLayout.js')) return null
      if (!code.includes(NEEDLE)) {
        this.error(
          `parity side A: ${p} does not contain ${JSON.stringify(NEEDLE)} — the ` +
          'needle is stale, and a stale needle silently builds side A as a copy of side B')
      }
      applied += 1
      return { code: code.replace(NEEDLE, REPLACEMENT), map: null }
    },
    closeBundle() {
      if (applied !== 1) {
        throw new Error(
          `parity side A: substitution applied ${applied} times, expected exactly 1`)
      }
    },
  }
}

export default {
  ...base,
  plugins: [paneModeBands(), ...base.plugins],
  build: { ...base.build, outDir: '../.parity-dist-a', emptyOutDir: true },
}
