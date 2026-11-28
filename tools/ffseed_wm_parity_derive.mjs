// tools/ffseed_wm_parity_derive.mjs — the DEVICE's W / M from D, run by tools/ffseed_wm_parity.py.
//
//   node tools/ffseed_wm_parity_derive.mjs <in.json> <out.json>
//
// in.json  {nowMs, symbols: {SYM: {t: [...unix s], o, h, l, c, v}}}   (whole D columns, as a full-depth device copy)
// out.json {SYM: {W: {t, o, h, l, c, v, forming} | {why}, M: ...}}
//
// It imports the SHIPPED module, unchanged (app/src/data/deviceStore/resample.js `deriveServed`, over
// utils/resampleBars), through the resolve hook headless_work_hooks.mjs registers (vite resolves extensionless relative
// imports; bare node does not). Pure: no network, no store.
import { register } from 'node:module'
import { readFile, writeFile } from 'node:fs/promises'

register('./headless_work_hooks.mjs', import.meta.url)

const { deriveServed } = await import('../app/src/data/deviceStore/resample.js')

const [, , inPath, outPath] = process.argv
const input = JSON.parse(await readFile(inPath, 'utf8'))
const out = {}
for (const [sym, d] of Object.entries(input.symbols)) {
  const cols = { whole: true, through: input.nowMs / 1000 }
  for (const k of ['t', 'o', 'h', 'l', 'c', 'v']) cols[k] = Float64Array.from(d[k])
  out[sym] = {}
  for (const tf of ['W', 'M']) {
    const r = deriveServed(cols, tf, input.nowMs)
    out[sym][tf] = r.cols
      ? { ...Object.fromEntries(['t', 'o', 'h', 'l', 'c', 'v'].map((k) => [k, Array.from(r.cols[k])])), forming: r.cols.forming ?? null }
      : { why: r.why }
  }
}
await writeFile(outPath, JSON.stringify(out))
