// app/src/pages/cot/cotFactsEntry.js
//
// Node CLI entry for the COT positioning analytics — plain ESM, no React, no
// DOM, no `window`. scripts/build-cot-facts.mjs bundles it into
// dist/cot-facts.cjs so the Python backend can run the SAME composition the
// browser runs (cotCompose.js) — one authority, no Python port.
//
//   node cot-facts.cjs proxies              → {"ES":{"ticker":"SPY","note":"via SPY"},...}
//                                             one entry per PRICE_PROXY symbol
//   node cot-facts.cjs proxies ES,VI,ZZZ    → the listed symbols only; unknown → null
//   node cot-facts.cjs facts < payload.json → {"report_date","facts","read"}
//       stdin:  {"symbol","name","rows":[...],"bars":[...]|null}
//       read:   {"headline","bias":{"label","strength","tone"},
//                "crowding":{"label","index"},"watch"}
//
// Output is compact JSON plus one newline. On failure (unknown command,
// invalid JSON, empty rows) a message goes to stderr, the exit code is 2 and
// NOTHING is written to stdout.
//
// This file runs under Node only (src/ lints with browser globals, hence the
// declaration); __COT_FACTS_CLI__ is the bundler's sentinel, see below.
/* global process, Buffer, __COT_FACTS_CLI__ */
import { PRICE_PROXY, proxyFor } from './cotProxies'
import { composeWeek } from './cotCompose'

export const USAGE = [
  'usage:',
  '  cot-facts proxies [SYM1,SYM2,...]   price proxies as JSON (default: every mapped symbol)',
  '  cot-facts facts < payload.json      latest-week facts for {symbol,name,rows,bars}',
].join('\n')

/** `{ SYM: {ticker, note} | null }` for each symbol in `list`. */
export function resolveProxies(list) {
  const out = {}
  for (const sym of list) out[sym] = proxyFor(sym)
  return out
}

/** Validate the `facts` payload and compose the latest week. Throws on a bad shape. */
export function factsForPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('stdin JSON must be an object {symbol, name, rows, bars}')
  }
  const { symbol, name, rows, bars } = payload
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('rows is empty — nothing to compute')
  }
  if (bars != null && !Array.isArray(bars)) {
    throw new Error('bars must be an array of weekly bars or null')
  }
  const { read, facts } = composeWeek(rows, rows.length - 1, {
    symbol, name, bars: bars || null, proxy: proxyFor(symbol),
  })
  return {
    report_date: facts.report_date,
    facts,
    read: {
      headline: read.headline,
      bias:     { label: read.bias.label, strength: read.bias.strength, tone: read.bias.tone },
      crowding: { label: read.crowding.label, index: read.crowding.index },
      watch:    read.watch,
    },
  }
}

/** Drain a readable stream to a UTF-8 string — every chunk before any parsing. */
export async function readAll(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Run the CLI. Resolves to the exit code; writes only through `io`.
 * @param {string[]} argv            arguments after the script name
 * @param {{stdin, stdout, stderr}} [io]
 */
export async function main(argv, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const [cmd, arg] = argv
  const fail = (msg, usage = false) => {
    stderr.write(`cot-facts: ${msg}\n${usage ? USAGE + '\n' : ''}`)
    return 2
  }
  const emit = obj => { stdout.write(JSON.stringify(obj) + '\n') }

  try {
    if (cmd === 'proxies') {
      const list = arg
        ? arg.split(',').map(s => s.trim()).filter(Boolean)
        : Object.keys(PRICE_PROXY)
      emit(resolveProxies(list))
      return 0
    }
    if (cmd === 'facts') {
      if (stdin.isTTY) return fail('facts reads its payload from stdin — pipe the JSON in')
      const text = await readAll(stdin)
      let payload
      try { payload = JSON.parse(text) }
      catch (e) { return fail(`stdin is not valid JSON: ${e.message}`) }
      emit(factsForPayload(payload))
      return 0
    }
    return fail(cmd ? `unknown command "${cmd}"` : 'missing command', true)
  } catch (e) {
    return fail(e && e.message ? e.message : String(e))
  }
}

// The bundler stamps __COT_FACTS_CLI__ = true (see scripts/build-cot-facts.mjs)
// so the built script runs the CLI; a plain import of this module (vitest,
// anything in the app) leaves the sentinel undefined and runs nothing.
if (typeof __COT_FACTS_CLI__ !== 'undefined' && __COT_FACTS_CLI__) {
  main(process.argv.slice(2)).then(
    code => { process.exitCode = code },
    err  => { process.stderr.write(`cot-facts: ${(err && err.stack) || err}\n`); process.exitCode = 2 },
  )
}
