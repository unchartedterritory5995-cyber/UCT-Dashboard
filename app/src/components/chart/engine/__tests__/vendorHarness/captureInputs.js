// app/src/components/chart/engine/__tests__/vendorHarness/captureInputs.js
//
// ─── ⭐⭐ SETTINGS PARITY (2c): A CAPTURE IS GRADED AT THE SETTINGS IT WAS TAKEN AT ─────────
//
// A capture records TradingView's own inputs (`study.inputs`: `in_0`, `in_1`, ... with `value` and
// `defval`). Our side computed every capture at the author's defaults (`computeFor(def, bars,
// undefined, ...)`), which was right only while every capture was taken at the defaults. A capture
// taken with a setting moved is now graded with the same setting moved on our side, or not at all:
//
//   * `in_k` is the k-th `name = input*(…)` binding of the script, in source order (TradingView
//     numbers a script's inputs in the order its calls run; a script whose inputs are not all
//     plain top-level-or-nested bindings cannot be numbered this way, and a capture of it with any
//     setting moved is refused by name);
//   * the binding's Pine name is our instance key: a host input keyed by it, a run half's own
//     setting keyed by it (`runHalfInputs.js`), or a folded length (`param<N>`, by `sourceName`);
//   * the value is converted to our input's type (a host switch is 1 / 0, a colour is `#RRGGBB`).
//
// ⛔ A moved setting our document does not declare, a colour with a transparency, or a count that
// does not line up REFUSES the grade (`{ok: false, why}`): never a capture graded at defaults it was
// not taken at.

import { lexPine, blockStatements, findTop, isPunct, boundName, parseWholeExpression } from '../../ast/pine.js'
import { paramInputKey } from '../../paramInputs.js'
import { hostColourLinks } from '../../runHalfInputs.js'

const IN_ID = /^in_(\d+)$/

/** The script's `name = input*(…)` bindings in source order, or null when an input call is not
 *  such a binding (then TradingView's numbering cannot be read off the source). */
export function pineInputBindings(source) {
  let stmts
  try {
    const lexed = lexPine(String(source || ''))
    stmts = blockStatements(lexed.tokens, lexed.indents, 0)
  } catch {
    return null
  }
  const out = []
  let loose = false
  const isInputName = (v) => v === 'input' || (typeof v === 'string' && v.startsWith('input.'))
  const visit = (list) => {
    for (const st of list || []) {
      const toks = st.header || []
      const calls = toks.filter((t, i) => t && t.kind === 'ident' && isInputName(t.value) && isPunct(toks[i + 1], '(')).length
      if (calls) {
        const eq = findTop(toks, (t) => isPunct(t, '='))
        const nameTok = eq > 0 ? boundName(toks, eq) : null
        let node = null
        try { node = nameTok ? parseWholeExpression(toks.slice(eq + 1)) : null } catch { node = null }
        if (calls === 1 && node && node.type === 'call' && isInputName(node.name)) out.push(String(nameTok.value))
        else loose = true
      }
      if (st.sub && st.sub.length) visit(st.sub)
    }
  }
  visit(stmts)
  return loose ? null : out
}

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase()

/** A TradingView colour (`rgba(r,g,b,a)` / `#RRGGBB` / `#RRGGBBAA`) as our opaque `#RRGGBB`, or null
 *  when it carries a transparency our settings cannot hold. */
export function opaqueHex(v) {
  const s = String(v || '').trim()
  let m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (m) {
    const a = m[4] === undefined ? 1 : Number(m[4])
    return a === 1 ? `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}` : null
  }
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i)
  if (m) return m[2] && m[2].toUpperCase() !== 'FF' ? null : `#${m[1].toUpperCase()}`
  return null
}

/** A TradingView colour as ours: `#RRGGBB` when opaque, `#RRGGBBAA` with the alpha byte (`round(a * 255)`)
 *  when see-through, or null when it is not a colour. The settings form sets a colour AND its opacity, as
 *  TradingView's does (see-through colours, 2026-11-17). */
export function colourHex(v) {
  const s = String(v || '').trim()
  let m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (m) {
    const a = m[4] === undefined ? 1 : Number(m[4])
    const rgb = `#${hex2(+m[1])}${hex2(+m[2])}${hex2(+m[3])}`
    return a >= 1 ? rgb : `${rgb}${hex2(a * 255)}`
  }
  m = s.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i)
  if (m) return m[2] && m[2].toUpperCase() !== 'FF' ? `#${m[1].toUpperCase()}${m[2].toUpperCase()}` : `#${m[1].toUpperCase()}`
  return null
}

const same = (a, b) => {
  if (typeof a === 'string' && typeof b === 'string' && /^(#|rgb)/i.test(a) && /^(#|rgb)/i.test(b)) {
    const x = colourHex(a)
    const y = colourHex(b)
    return x !== null && y !== null ? x === y : a.replace(/\s+/g, '') === b.replace(/\s+/g, '')
  }
  return Object.is(a, b)
}

/**
 * The instance inputs a capture was taken at.
 * @returns {{ok: true, inputs: object|undefined, moved: object}} `inputs` undefined at every
 *   default (our side computes exactly as before); `moved` is `{pineName: TradingView value}`, the
 *   record a capture's evidence carries | `{ok: false, why}`.
 */
export function captureInstanceInputs(capture, def, ranSource = undefined) {
  const list = capture && capture.study && Array.isArray(capture.study.inputs) ? capture.study.inputs : []
  const tv = list.filter((i) => i && typeof i.id === 'string' && IN_ID.test(i.id))
  const movedTv = tv.filter((i) => !same(i.value, i.defval))
  if (!movedTv.length) return { ok: true, inputs: undefined, moved: {} }
  // ⭐ e95 (unit 2) — the script OUR side ran (a hand-added built-in's held published source, `builtinSource.js`),
  // never the capture's batch label, numbers TradingView's inputs
  const source = typeof ranSource === 'string' ? ranSource : (capture && capture.source && capture.source.text)
  const bindings = pineInputBindings(source)
  if (!bindings) return { ok: false, why: 'the script has an input that is not a `name = input(…)` binding, so TradingView\'s numbering cannot be read' }
  let numbered = tv.map((i) => Number(i.id.match(IN_ID)[1]))
  // ⭐ e95 (unit 2) — A DECLARATION THAT TAKES `timeframe =` (`indicator(…, timeframe = "", timeframe_gaps = true)`,
  // TradingView's built-in VWAP) gets TWO more inputs from TradingView, after the script's own: "Timeframe"
  // (`resolution`) and "Wait for timeframe closes" (`bool`), as the VWAP captures record them (in_11, in_12). They are
  // the declaration's, not a binding's: read at their defaults they are dropped; moved, our side cannot set them.
  const tail = tv.slice(bindings.length)
  if (tv.length === bindings.length + 2 && /(^|\n)\s*(indicator|study)\s*\([^\n]*\btimeframe\s*=/.test(String(source || ''))
      && tail[0].type === 'resolution' && tail[1].type === 'bool') {
    const movedTail = tail.filter((i) => !same(i.value, i.defval))
    if (movedTail.length) return { ok: false, why: `"${movedTail[0].name}" (the declaration's timeframe setting) was moved` }
    tv.splice(bindings.length, 2)
    numbered = numbered.slice(0, bindings.length)
  }
  if (bindings.length !== tv.length || numbered.some((k, j) => k !== j)) {
    return { ok: false, why: `the capture records ${tv.length} inputs and the script binds ${bindings.length}` }
  }
  const byKey = new Map((Array.isArray(def && def.inputs) ? def.inputs : []).map((s) => [s && s.key, s]))
  const manifest = def && def.compute && def.compute.paramManifest ? def.compute.paramManifest : {}
  const inputs = {}
  const moved = {}
  for (const i of movedTv) {
    const name = bindings[Number(i.id.match(IN_ID)[1])]
    let spec = byKey.get(name)
    if (!spec) {
      const pid = Object.keys(manifest).find((id) => manifest[id] && manifest[id].sourceName === name)
      spec = pid ? byKey.get(paramInputKey(pid)) : null
    }
    if (!spec) {
      // ⭐ a script colour input a plot draws with is that plot's colour setting (`hostColourLinks`)
      const links = hostColourLinks(def)
      const hostKey = Object.keys(links).find((k) => links[k] === name)
      spec = hostKey ? byKey.get(hostKey) : null
    }
    if (!spec) return { ok: false, why: `"${i.name}" (${name}) was moved and is not a setting of our document` }
    let v = i.value
    if (spec.type === 'color') {
      v = colourHex(v)
      if (v === null) return { ok: false, why: `"${i.name}" (${name}) was moved to a value that is not a colour` }
    } else if (spec.type === 'int' && typeof v === 'boolean') {
      v = v ? 1 : 0
    } else if (spec.type === 'int' || spec.type === 'float') {
      v = Number(v)
      if (!Number.isFinite(v)) return { ok: false, why: `"${i.name}" (${name}) was moved to a value that is not a number` }
    }
    inputs[spec.key] = v
    moved[name] = i.value
  }
  return { ok: true, inputs, moved }
}
