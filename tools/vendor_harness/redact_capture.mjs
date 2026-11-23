#!/usr/bin/env node
// tools/vendor_harness/redact_capture.mjs
//
// ⛔⛔ TRADINGVIEW'S COMPILED SCRIPT NEVER ENTERS THIS PUBLIC REPO (coordinator ruling 2026-11-23). A capture's
// `study.inputs` carries a hidden input `ILScript` whose value is TradingView's encrypted compiled form of the script.
// This tool replaces that value with `REDACTED_COMPILED_SCRIPT`, adds the `redactions` note (`schema.mjs::
// verifyRedactions` reads it), and re-seals the capture. It REFUSES a capture whose own receipt does not verify (it
// never re-seals a body it cannot vouch for), and it checks its own output with the same `verifyRedactions` the
// harness uses before writing.
//
// usage: node tools/vendor_harness/redact_capture.mjs [--check] <capture.json> [...]
//   --check   write nothing; exit 1 when any file still carries the compiled script in the clear
// The file keeps its layout: the indentation it was written with (none / 1 / 2 spaces) and its trailing newline.
import fs from 'node:fs'
import {
  canonicalBody, carriesCompiledScript, compiledScriptInputs, REDACTED_COMPILED_SCRIPT, REDACTION_FIELDS,
  REDACTION_TOOL, sealCapture, verifyReceipt, verifyRedactions,
} from './schema.mjs'

/** The capture with its compiled script redacted and re-sealed, or `{refused}`. Pure: no I/O. */
export function redactCapture(capture, { at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') } = {}) {
  if (!carriesCompiledScript(capture)) return { capture, changed: false }
  const rc = verifyReceipt(capture)
  if (!rc.ok) return { refused: `its own receipt does not verify (${rc.reason}): never re-sealed` }
  const { receipt, redactions: _none, ...body } = JSON.parse(JSON.stringify(capture))
  const originalReceipt = { algo: receipt.algo, chars: receipt.chars, fnv1a: receipt.fnv1a }
  const notes = []
  const secrets = []
  for (const i of compiledScriptInputs(body)) {
    for (const prop of Object.keys(REDACTION_FIELDS)) {
      const v = body.study.inputs[i][prop]
      if (typeof v !== 'string' || v === '' || v === REDACTED_COMPILED_SCRIPT) continue
      notes.push({ field: REDACTION_FIELDS[prop], index: i, replacedWith: REDACTED_COMPILED_SCRIPT,
        originalChars: JSON.stringify(v).length - 2, originalReceipt, by: REDACTION_TOOL, at })
      secrets.push(v)
      body.study.inputs[i][prop] = REDACTED_COMPILED_SCRIPT
    }
  }
  const out = sealCapture({ ...body, redactions: notes })
  const rd = verifyRedactions(out)
  if (!rd.ok) return { refused: `the redacted capture does not verify (${rd.reason})` }
  if (!verifyReceipt(out).ok) return { refused: 'the re-sealed receipt does not verify' }
  const text = canonicalBody(out)
  if (secrets.some((v) => text.includes(v))) return { refused: 'the compiled script survived the redaction (another copy elsewhere in the capture)' }
  return { capture: out, changed: true }
}

function layoutOf(text) {
  const m = text.match(/^\{\r?\n( +)"/)
  return { indent: m ? m[1].length : 0, eol: text.includes('\r\n') ? '\r\n' : '\n', trailing: /\r?\n$/.test(text) }
}

function main(argv) {
  const check = argv.includes('--check')
  const files = argv.filter((a) => a !== '--check')
  let bad = 0; let changed = 0
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    const capture = JSON.parse(text)
    if (check) {
      if (carriesCompiledScript(capture)) { bad += 1; console.log(`CLEAR  ${f}`) }
      continue
    }
    const r = redactCapture(capture)
    if (r.refused) { bad += 1; console.log(`REFUSED ${f}: ${r.refused}`); continue }
    if (!r.changed) continue
    const { indent, eol, trailing } = layoutOf(text)
    let out = indent ? JSON.stringify(r.capture, null, indent) : JSON.stringify(r.capture)
    if (eol === '\r\n') out = out.replace(/\n/g, '\r\n')
    if (trailing) out += eol
    fs.writeFileSync(`${f}.tmp`, out, 'utf8'); fs.renameSync(`${f}.tmp`, f)
    changed += 1
  }
  console.log(check ? `${bad} file(s) carry TradingView's compiled script in the clear` : `redacted ${changed}, refused ${bad}, of ${files.length}`)
  return bad ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('redact_capture.mjs')) {
  process.exitCode = main(process.argv.slice(2))
}
