// NO SHEBANG, DELIBERATELY: see build-cot-facts.mjs.
//
// app/scripts/precompress-assets.mjs
//
// Writes <file>.br and <file>.gz beside every hashed JS and CSS file in dist/assets.
// api/services/static_assets.py picks one by Accept-Encoding at request time; that
// file's docstring says why compression happens here and not at runtime.
//
//   node scripts/precompress-assets.mjs                 -> dist/assets
//   node scripts/precompress-assets.mjs --dist <path>   -> <path>/assets
//
// Wired into `npm run build` LAST: vite empties dist/ first, so the order is
// load-bearing. Node's own zlib does both codings, so this adds no dependency.
//
// A file that cannot be compressed is reported and skipped, never a failed build:
// the server falls back to the plain file, which is always correct. The sidecars are
// not in Vite's manifest and the plain files are untouched, so
// tools/notebook_perf_budgets.py measures exactly what it measured before.
import { availableParallelism } from 'node:os'

// libuv reads this once, at the first threadpool job. Nothing has run one yet.
const WORKERS = Math.min(Math.max(availableParallelism(), 1), 8)
process.env.UV_THREADPOOL_SIZE = String(WORKERS)

const { constants, brotliCompress, gzip } = await import('node:zlib')
const { promisify } = await import('node:util')
const { readdir, readFile, rename, rm, writeFile } = await import('node:fs/promises')
const { dirname, extname, join, resolve } = await import('node:path')
const { fileURLToPath } = await import('node:url')

const brotli = promisify(brotliCompress)
const gz = promisify(gzip)
const ELIGIBLE = new Set(['.js', '.css'])
const DEFAULT_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

async function listEligible(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...await listEligible(full))
    else if (entry.isFile() && ELIGIBLE.has(extname(entry.name))) found.push(full)
  }
  return found
}

function encoders(plain) {
  return {
    '.br': () => brotli(plain, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_SIZE_HINT]: plain.length,
      },
    }),
    '.gz': () => gz(plain, { level: constants.Z_BEST_COMPRESSION }),
  }
}

/** Write one sidecar, or remove a stale one when compressing does not help. */
async function writeSidecar(file, suffix, encode, plainSize) {
  const sidecar = file + suffix
  const encoded = await encode()
  if (encoded.length >= plainSize) {
    await rm(sidecar, { force: true })
    return 0
  }
  const temp = `${sidecar}.${process.pid}.tmp`
  await writeFile(temp, encoded)
  await rename(temp, sidecar)
  return encoded.length
}

async function compressOne(file, totals) {
  const plain = await readFile(file)
  totals.plain += plain.length
  await Promise.all(Object.entries(encoders(plain)).map(async ([suffix, encode]) => {
    // Awaited first: `totals[x] += await y` reads totals[x] BEFORE the await and
    // loses every update made by the other files in flight.
    const written = await writeSidecar(file, suffix, encode, plain.length)
    totals[suffix] += written || plain.length
  }))
}

async function main(argv) {
  const at = argv.indexOf('--dist')
  const dist = at >= 0 ? resolve(argv[at + 1]) : DEFAULT_DIST
  const started = Date.now()
  const files = await listEligible(join(dist, 'assets'))
  const totals = { plain: 0, '.br': 0, '.gz': 0 }
  const failed = []
  let next = 0
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    while (next < files.length) {
      const file = files[next++]
      try {
        await compressOne(file, totals)
      } catch (err) {
        failed.push(file)
        console.error(`[precompress] ${file}: ${err.message}`)
      }
    }
  }))
  const mb = (n) => (n / 1048576).toFixed(1)
  console.log(
    `[precompress] ${files.length} files, ${mb(totals.plain)} MB plain, ` +
    `${mb(totals['.br'])} MB br, ${mb(totals['.gz'])} MB gzip, ` +
    `${((Date.now() - started) / 1000).toFixed(1)}s, ${failed.length} failed`,
  )
}

await main(process.argv.slice(2))
