// app/src/testing/createIndicator/scriptedConverse.js
//
// ─── A SCRIPTED STAND-IN FOR THE MODEL, AND ONLY THE MODEL ───────────────────
//
// ⛔ TEST / HARNESS ONLY — no product module imports this (railed by
// `createIndicatorHarnessAbsent.test.js`), and `vite build` takes index.html as
// its single input. Phase 2's rule: NO PAID LLM CALLS in tests or proofs.
//
// It replaces exactly ONE thing — the model behind POST /converse — and, like
// the model, it sees only the engine's COMPACT VIEW of the working definition
// (`compactView`: revision, outputs, slot ids). It answers with a real
// `uct.authoring.patch/1` envelope in `/converse`'s response shape. Everything
// after it is the product: `converseTurn` parses the response, Track A's engine
// applies the patch atomically, the readback is computed from the resulting
// definition, the preview is the real registry + binder + chart, and Save is the
// real server save door.

const PATCH = 'uct.authoring.patch/1'
const num = (value) => ({ type: 'num', value })
const close = { type: 'series', name: 'close' }
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })

const envelope = (view, ops, assumptions = []) => ({ contract: PATCH, baseRevision: view.revision || 0, ops, assumptions })
const refuse = (gate, reason) => ({ ok: false, gate, reason })

/**
 * One scripted turn against the compact view.
 * @returns the `/converse` response BODY: `{ok, turn, envelope}` | `{ok:false, gate, reason}`
 */
export function scriptedReply(message, view) {
  const m = String(message || '').toLowerCase()
  const empty = !view || view.empty !== false

  // The owner's table example — honestly unsupported: UCT has no TABLE output type.
  if (/\btable\b/.test(m)) {
    return refuse('unsupported:table',
      "UCT indicators can't draw a table on the chart yet. I can build any of those numbers as a line, or show the latest one in the chart header.")
  }

  // "Add a 20 EMA" / "add a 50 sma" / "ema 20"
  const ma = /(\d+)\s*(?:-?\s*(?:day|bar|period)\s*)?(ema|sma)\b|\b(ema|sma)\s*\(?\s*(\d+)/.exec(m)
  if (ma && empty) {
    const n = Number(ma[1] || ma[4])
    const fn = ma[2] || ma[3]
    const label = `${fn.toUpperCase()} ${n}`
    return { ok: true, turn: 'patch', envelope: envelope(view, [{
      op: 'create', name: label, placement: 'price',
      outputs: [{ key: 'value', tree: call(fn, close, num(n)), label }],
    }]) }
  }

  // "Build an RSI overbought signal" — conventional defaults, disclosed.
  if (/rsi/.test(m) && /overbought/.test(m) && empty) {
    return { ok: true, turn: 'patch', envelope: envelope(view, [{
      op: 'create', name: 'RSI overbought',
      outputs: [{ tree: op('>', call('rsi', close, num(14)), num(70)) }],
    }], [{ slot: 'value#0.1', text: 'standard length' }, { slot: 'value#1', text: 'conventional overbought level' }]) }
  }

  // "Make it 50" / "make the threshold 80"
  const to = /\b(?:make|set|change)\b.*?(\d+(?:\.\d+)?)/.exec(m)
  if (to && !empty) {
    const slots = ((view.definition && view.definition.outputs) || [])
      .flatMap((o) => o.slots || []).filter((s) => s.kind === 'number' && s.role !== 'bars-ago')
    const slot = slots.find((s) => /#1$/.test(s.id)) || slots[0]
    if (!slot) return refuse('scripted:no-slot', "There's no number in this indicator I can change that way.")
    return { ok: true, turn: 'patch', envelope: envelope(view, [{ op: 'set_slot', slot: slot.id, value: Number(to[1]) }]) }
  }

  return refuse('scripted:unknown',
    'I couldn\'t turn that into an indicator. Try describing what it should measure — for example "Add a 20 EMA".')
}

/** A drop-in for `converseTurn` in component tests (same call shape, never throws). */
export async function scriptedConverse({ message, state, gateCtx = {} }) {
  const { compactView } = await import('../../components/chart/builder/authoring')
  const body = scriptedReply(message, compactView(state.working, state, gateCtx))
  return body.ok
    ? { ok: true, turn: body.turn, envelope: body.envelope, notUnderstood: [], unavailable: [] }
    : { ok: false, gate: body.gate, reason: body.reason, notUnderstood: [], unavailable: [] }
}
