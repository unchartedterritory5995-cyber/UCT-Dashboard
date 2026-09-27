#!/usr/bin/env node
// tools/vendor_harness/verify_capture.mjs
//
// The shell-side half of a vendor-harness capture. Two jobs, no engine:
//
//   node tools/vendor_harness/verify_capture.mjs <capture.json> [...]
//       validate shape + receipt + source sha256; exit 0 only if every file passes
//
//   node tools/vendor_harness/verify_capture.mjs --assemble <chunk-dir> --out <capture.json>
//       read chunk-000.json … (each `__uctVH.chunk(i)`'s result, verbatim),
//       check every chunk's own fnv1a, the chunk count, the assembled text's
//       length AND fnv1a against the page's total, and the capture's receipt —
//       and write the capture ONLY if all of them agree. A mismatch writes
//       NOTHING and says which check failed.
//
// ⛔ The exit code is the verdict. Do not pipe this into anything that swallows
// it (CLAUDE.md, "NEVER VERIFY A RUNNER THROUGH A PIPE"); the last line printed
// is a `VERDICT:` line for the same reason.

import fs from 'node:fs'
import path from 'node:path'
import { fnv1a, validateCapture } from './schema.mjs'

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  console.log('VERDICT: FAIL')
  process.exit(1)
}

function assemble(dir, out) {
  if (!fs.existsSync(dir)) fail(`no such directory ${dir}`)
  const files = fs.readdirSync(dir).filter((f) => /^chunk-\d{3,}\.json$/.test(f)).sort()
  if (!files.length) fail(`no chunk-NNN.json files in ${dir}`)
  const chunks = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  const n = chunks[0].n
  if (chunks.length !== n) fail(`the page staged ${n} chunks and ${chunks.length} are on disk`)
  chunks.forEach((c, i) => {
    if (c.i !== i) fail(`${files[i]} carries index ${c.i}, expected ${i}`)
    if (typeof c.text !== 'string') fail(`${files[i]} has no text`)
    const h = fnv1a(c.text)
    if (h !== c.fnv1a) fail(`${files[i]}: chunk fnv1a ${c.fnv1a} but its text hashes to ${h} — transport damaged this chunk`)
  })
  const text = chunks.map((c) => c.text).join('')
  const total = chunks[0].total
  if (text.length !== total.chars) fail(`assembled ${text.length} chars, the page staged ${total.chars}`)
  if (fnv1a(text) !== total.fnv1a) fail(`assembled text hashes to ${fnv1a(text)}, the page staged ${total.fnv1a}`)
  let capture
  try { capture = JSON.parse(text) } catch (e) { fail(`assembled text is not JSON: ${e.message}`) }
  const v = validateCapture(capture)
  if (!v.ok) fail(`the assembled capture does not validate:\n  - ${v.errors.join('\n  - ')}`)
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(capture, null, 1) + '\n', 'utf8')
  // Read it back and verify the FILE, not the string we meant to write.
  const back = validateCapture(JSON.parse(fs.readFileSync(out, 'utf8')))
  if (!back.ok) fail(`wrote ${out} but it does not verify on read-back: ${back.errors.join('; ')}`)
  console.log(`OK: ${out} — ${capture.bars.count} bars, ${capture.study.plots.length} plots, receipt ${capture.receipt.fnv1a}`)
  console.log('VERDICT: PASS')
}

function verifyFiles(paths) {
  let bad = 0
  for (const p of paths) {
    let c
    try { c = JSON.parse(fs.readFileSync(p, 'utf8')) } catch (e) { console.error(`FAIL ${p}: ${e.message}`); bad += 1; continue }
    const v = validateCapture(c)
    if (v.ok) console.log(`OK   ${p} — ${c.id} · ${c.symbol.pro_name || c.symbol.name} ${c.timeframe} · ${c.bars.count} bars · ${c.study.plots.length} plots`)
    else { bad += 1; console.error(`FAIL ${p}\n  - ${v.errors.join('\n  - ')}`) }
  }
  console.log(`VERDICT: ${bad ? 'FAIL' : 'PASS'} (${paths.length - bad}/${paths.length})`)
  process.exit(bad ? 1 : 0)
}

const args = process.argv.slice(2)
if (args[0] === '--assemble') {
  const dir = args[1]
  const oi = args.indexOf('--out')
  if (!dir || oi < 0 || !args[oi + 1]) fail('usage: --assemble <chunk-dir> --out <capture.json>')
  assemble(dir, args[oi + 1])
} else if (args.length) {
  verifyFiles(args)
} else {
  fail('usage: verify_capture.mjs <capture.json>… | --assemble <chunk-dir> --out <capture.json>')
}
