// NO SHEBANG, DELIBERATELY: see build-cot-facts.mjs.
// app/scripts/stash-sourcemaps.mjs — runs right after `vite build` (package.json "build").
//
// vite.config.js builds with `sourcemap: 'hidden'`: every chunk gets a .map file and NO
// sourceMappingURL comment, so the shipped JS is byte-identical to a build without maps and no
// browser ever asks for one. This moves every map out of dist/assets (the public /assets mount)
// into dist/.maps/, which nothing serves publicly. The ONLY door to them is the admin-only
// GET /api/admin/client-errors/sourcemap/{chunk} (api/routers/client_errors.py), which
// tools/resolve_client_error.mjs uses to turn a client error report's kept positions
// (`/assets/<chunk>.js:<line>:<col>`) into source files and lines. Desktop speed plan 9.7.
//
//   node scripts/stash-sourcemaps.mjs                 -> dist
//   node scripts/stash-sourcemaps.mjs --dist <path>
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAPS_DIR = '.maps'

/** Moves <dist>/assets/**.map to <dist>/.maps/<basename>. Returns how many moved. */
export async function stashSourcemaps(dist) {
  const assets = join(dist, 'assets')
  const target = join(dist, MAPS_DIR)
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  let moved = 0
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile() && entry.name.endsWith('.map')) {
        await rename(full, join(target, entry.name))
        moved += 1
      }
    }
  }
  await walk(assets)
  return moved
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--dist')
  const dist = resolve(i > 0 ? process.argv[i + 1] : 'dist')
  const n = await stashSourcemaps(dist)
  console.log(`stash-sourcemaps: moved ${n} source maps out of ${join(dist, 'assets')} into ${join(dist, MAPS_DIR)}`)
}
