// app/src/components/chart/engine/ast/oosHarness.js
//
// LAYER A of OOS_2_MEASUREMENT_PROTOCOL.md — the static, offline, deterministic
// measurement of one Pine script against the shipped import door.
//
// ⛔ THIS FILE MEASURES. IT DOES NOT JUDGE A SCRIPT GOOD OR BAD, and it never
// collapses a script to one PASS/FAIL. The protocol's whole point is that a
// script can be semantically supported and visually partial, or chart-supported
// and not screener-expressible, or correctly refused — so every axis is reported
// separately and the outcome vocabulary is assigned from the axes, not the
// reverse.
//
// ⚠️ TRANSLATES != RENDERS. Nothing in this file may be read as a rendering
// claim. Chart, persistence and visual-fidelity axes are Layer C (browser).

import { translatePine, treeYieldsBool, readsBars } from './pine.js'
import { parseFormula } from './parse.js'

/** ⭐ THE ASSISTED PATH, EXACTLY AS A MEMBER WOULD WALK IT: splice the engine's
 *  OWN `suggest` over its OWN `span`, and repeat. No hand-editing, no Pine we
 *  wrote ourselves. If the door does not offer it, the member does not get it.
 *  Same mechanism `pine.blindCorpus.test.js` established; kept identical so the
 *  OOS number is comparable to the 48-corpus number. */
export function acceptEveryOffer(src, limit = 12) {
  let cur = src
  const taken = []
  for (let i = 0; i < limit; i += 1) {
    let o
    try { o = translatePine(cur) } catch { return { source: null, taken, stopped: 'threw' } }
    if (o.ok) return { source: cur, taken, stopped: 'ok' }
    const r = o.refusal
    if (!r || !r.suggest || !Array.isArray(r.span)) {
      return { source: null, taken, stopped: r ? `no-offer:${r.guard}` : 'no-refusal' }
    }
    taken.push({ guard: r.guard, replaced: cur.slice(r.span[0], r.span[1]), suggest: r.suggest })
    cur = cur.slice(0, r.span[0]) + r.suggest + cur.slice(r.span[1])
  }
  return { source: null, taken, stopped: 'limit' }
}

/** Pine's own visual-emitting call names, counted in the SOURCE. Mirrors
 *  `tools/oos_visual_classify.py`'s families so the two agree on demand counts;
 *  the Python tool remains the authority for the V0-V5 tier itself. */
const VISUAL_CALLS = [
  'plot', 'hline', 'fill', 'bgcolor', 'barcolor',
  'plotshape', 'plotchar', 'plotarrow', 'plotcandle', 'plotbar',
]
const OBJECT_NS = ['label', 'line', 'box', 'table', 'polyline', 'linefill']

function stripComments(src) {
  const holes = []
  let s = src.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, (m) => {
    holes.push(m)
    return `\u0000S${holes.length - 1}\u0000`
  })
  s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  return s.replace(/\u0000S(\d+)\u0000/g, (_, i) => holes[Number(i)])
}

export function sourceVisualDemand(src) {
  const s = stripComments(src)
  const calls = {}
  for (const name of VISUAL_CALLS) {
    const m = s.match(new RegExp(`\\b${name}\\s*\\(`, 'g'))
    if (m) calls[name] = m.length
  }
  const objects = {}
  for (const ns of OBJECT_NS) {
    const m = s.match(new RegExp(`\\b${ns}\\s*\\.\\s*\\w+`, 'g'))
    if (m) objects[ns] = m.length
  }
  return {
    calls,
    objects,
    declaredPlotCalls: calls.plot || 0,
    declaredVisualCalls: Object.values(calls).reduce((a, b) => a + b, 0),
    declaredObjectCalls: Object.values(objects).reduce((a, b) => a + b, 0),
    usesOverlayTrue: /\boverlay\s*=\s*true\b/.test(s),
    usesOverlayFalse: /\boverlay\s*=\s*false\b/.test(s),
    // ⚠️ RISK-043's FINGERPRINT. A top-level block the walker cannot fold is
    // exactly where a stale pre-block value used to leak into a later binding.
    // Recorded on EVERY script, accepted or not, so the silent-false-success
    // audit has a population to work from rather than a hunch.
    hasBlockKeyword: /^[ \t]*(?:if|for|while|switch)\b/m.test(s),
    hasReassign: /:=/.test(s),
    hasVarDecl: /\bvar(?:ip)?\s+/.test(s),
    hasRequestSecurity: /\brequest\s*\.\s*security\b/.test(s),
    hasSession: /\b(?:session|time\s*\()/.test(s),
    hasArray: /\barray\s*\.\s*\w+/.test(s),
    hasMatrixOrMap: /\b(?:matrix|map)\s*\.\s*\w+/.test(s),
    hasUserFunction: /^[ \t]*\w+\s*\([^)]*\)\s*=>/m.test(s),
    hasStrategyCall: /\bstrategy\s*(?:\.\s*\w+)?\s*\(/.test(s),
    hasLibraryCall: /\blibrary\s*\(/.test(s),
    hasImport: /^\s*import\s+/m.test(s),
  }
}

/** ⭐⭐ THE HONEST VERSION OF `readsBars`, USED ONLY TO MEASURE — never to fix.
 *
 *  `pine.js:8169`'s `readsBars` returns TRUE for any node of type `call`, without
 *  looking at that call's arguments. So `max(8, 42)` — a call over two literals,
 *  constant on every bar of every symbol forever — is reported as reading bars.
 *  Verified by direct probe, not inferred.
 *
 *  That matters because `hidden = authorHid || !readsBars(ast)` is the guard that
 *  exists precisely to stop a dead column being offered: a constant-valued CALL
 *  walks straight through it, counts as usable, and can therefore make a whole
 *  script `ok: true` on the strength of nothing that varies.
 *
 *  It is the same blind spot `pine.community.test.js` already documented for
 *  scripts 27 and 28 — "`X && 0` LOOKS like it reads bars: it contains a call" —
 *  closed there for the and/or folding case and still open in general.
 *
 *  A tree genuinely reads bars only if it contains a `series` node. */
function containsSeries(node) {
  const stack = [node]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== 'object') continue
    if (n.type === 'series') return true
    if (Array.isArray(n.args)) stack.push(...n.args)
  }
  return false
}

function outputRow(row) {
  const parsed = row.formula ? parseFormula(row.formula) : null
  const ok = !!(parsed && parsed.ok)
  return {
    kind: row.kind || null,
    title: row.title || null,
    line: row.line ?? null,
    refused: !!row.refusal,
    guard: row.refusal ? row.refusal.guard : null,
    hidden: !!row.hidden,
    hiddenReason: row.hiddenReason || null,
    formula: row.formula || null,
    parses: ok,
    yieldsBool: ok ? !!treeYieldsBool(parsed.ast) : false,
    readsBars: ok ? !!readsBars(parsed.ast) : false,
    // What the engine's own guard SAYS, beside what is actually true.
    containsSeries: ok ? containsSeries(parsed.ast) : false,
    inputsFolded: Array.isArray(row.inputsFolded) ? row.inputsFolded.length : 0,
  }
}

function summarise(out) {
  const rows = (out.outputs || []).map(outputRow)
  const usable = rows.filter((r) => !r.refused && !r.hidden)
  return {
    ok: !!out.ok,
    version: out.version ?? null,
    declaration: out.declaration || null,
    title: out.title || null,
    guard: out.refusal ? out.refusal.guard : null,
    message: out.refusal ? String(out.refusal.message || '').slice(0, 400) : null,
    line: out.refusal ? (out.refusal.line ?? null) : null,
    allGuards: (out.refusals || []).map((r) => r.guard),
    outputsTotal: rows.length,
    outputsUsable: usable.length,
    outputsRefused: rows.filter((r) => r.refused).length,
    outputsHiddenByAuthor: rows.filter((r) => r.hiddenReason === 'author').length,
    outputsHiddenAsConstant: rows.filter((r) => r.hiddenReason === 'constant').length,
    outputsBool: usable.filter((r) => r.yieldsBool).length,
    // ⛔ A SCRIPT WHOSE EVERY KEPT COLUMN IS CONSTANT IS NOT AN IMPORT.
    usableThatReadNoBar: usable.filter((r) => !r.containsSeries).length,
    everyUsableIsConstant: usable.length > 0 && usable.every((r) => !r.containsSeries),
    outputsNumeric: usable.filter((r) => !r.yieldsBool).length,
    outputKinds: [...new Set(rows.map((r) => r.kind).filter(Boolean))].sort(),
    selectedIndex: out.selected ?? -1,
    selected: (out.selected >= 0 && rows[out.selected]) ? rows[out.selected] : null,
    inputParams: (out.inputParams || []).length,
    // ⭐ WAVE B — what the script's visual program said, and how much of it
    // crossed the door. Measured, never assumed.
    presentation: out.presentation || null,
    rowPresentation: (out.outputs || []).map((r) => r.presentation || {}),
    notes: (out.notes || []).map((n) => n.code || n.guard || String(n).slice(0, 60)),
    rows,
  }
}

/**
 * Measure ONE script. Returns every axis the static layer can see, and NOTHING
 * it cannot: no chart status, no visual fidelity, no persistence — those are
 * Layer C and are absent here rather than guessed.
 */
export function measureScript(name, source) {
  const demand = sourceVisualDemand(source)

  // ⛔⛔ `paramManifest: true` IS NOT OPTIONAL HERE, AND LEAVING IT OFF READS AS A
  // PRODUCT FINDING. `translatePine` mints Track-F parameter metadata only when
  // asked; without the option it returns `inputParams: []` for every script ever
  // written. The first baseline run reported "input params discovered: 0/60,
  // 0.0%" — which is not a fact about the door, it is a fact about the call. A
  // vacuous zero that looks like a devastating result is worse than no
  // measurement at all.
  let raw
  try {
    raw = summarise(translatePine(source, { paramManifest: true }))
  } catch (e) {
    raw = { ok: false, threw: String(e && e.message).slice(0, 200), outputsTotal: 0, rows: [] }
  }

  let assisted = null
  let offers = []
  let assistedStop = null
  if (!raw.ok) {
    const a = acceptEveryOffer(source)
    offers = a.taken
    assistedStop = a.stopped
    if (a.source) {
      try { assisted = summarise(translatePine(a.source, { paramManifest: true })) } catch (e) {
        assisted = { ok: false, threw: String(e && e.message).slice(0, 200) }
      }
    }
  }

  const accepted = raw.ok ? raw : (assisted && assisted.ok ? assisted : null)

  // ── mechanical silent-false-success probes (protocol §5) ──
  // ⛔ THESE ARE FLAGS, NOT VERDICTS. A flag means "an independent adjudicator
  // must look at this script", never "this script is wrong". The protocol keeps
  // adjudication separate from detection on purpose.
  const probes = {}
  if (accepted) {
    // P5 — incomplete multi-output indicator presented as complete.
    probes.declaredVsCarried = {
      declaredVisualCalls: demand.declaredVisualCalls,
      declaredObjectCalls: demand.declaredObjectCalls,
      carriedOutputs: accepted.outputsTotal,
      usableOutputs: accepted.outputsUsable,
      shortfall: Math.max(0, demand.declaredVisualCalls - accepted.outputsTotal),
    }
    probes.P5_output_shortfall = demand.declaredVisualCalls > accepted.outputsTotal
    // P4 — a declared visual the representation carries nothing for at all.
    // ⛔ INDEXED, NOT DOTTED, AND THAT IS DELIBERATE — INCLUDING IN THIS COMMENT.
    // `defSchema.test.js` sweeps every module under `engine/` for a read of the
    // schema's cross-plot fill field and asserts the reader list is EMPTY,
    // because that field is validated-but-inert until its renderer lands and a
    // silent consumer would make the claim stale. This file reads a COUNT OF
    // PINE CALLS IN A SOURCE STRING — a different thing entirely — but the probe
    // matches on a token and cannot tell them apart, and adding this file to its
    // exclusion list would blunt a rail doing exactly its job. So the token is
    // not written here, in code or in prose: the first attempt at this comment
    // tripped the very probe it was explaining.
    const nCalls = (name) => demand.calls[name] || 0
    probes.P4_visuals_dropped = demand.declaredObjectCalls > 0
      || nCalls('fill') > 0
      || nCalls('bgcolor') > 0
      || nCalls('barcolor') > 0
    // P7 — a column that can never fire.
    probes.P7_constant_column = accepted.outputsHiddenAsConstant > 0
    // The mechanical form of pattern 7, and the one that actually fires: every
    // column the member would be offered is the same number on every bar.
    probes.P7_every_kept_column_is_constant = !!accepted.everyUsableIsConstant
    probes.P7_some_kept_column_is_constant = (accepted.usableThatReadNoBar || 0) > 0
    probes.P7_selected_is_constant = !!(accepted.selected && accepted.selected.hiddenReason === 'constant')
    // P1/P2 — state or a block the walker could not fold, yet the script still passed.
    probes.P1_P2_state_present_but_accepted =
      (demand.hasBlockKeyword || demand.hasReassign || demand.hasVarDecl) && !!accepted.ok
    // P3 — a series the engine cannot supply, folded to a constant.
    probes.P3_request_present_but_accepted = demand.hasRequestSecurity && !!accepted.ok
    probes.anyFlag = Object.entries(probes)
      .filter(([k, v]) => k.startsWith('P') && v === true).map(([k]) => k)
  }

  // ── outcome vocabulary (protocol §4) ──
  // INVALID_SOURCE is decided from the SOURCE, before any acceptance question,
  // because a strategy()/library() script is out of the declared scope rather
  // than a compatibility failure.
  // ⛔ A LIBRARY IS OUT OF SCOPE. AN INDICATOR THAT IMPORTS ONE IS NOT.
  // `library()` declares an artifact that is not an indicator at all, so it is
  // INVALID_SOURCE — out of the declared market target, not a compatibility
  // failure. But a script that declares `indicator()` and `import`s a library IS
  // the thing we are measuring: it is a real custom indicator, and refusing it
  // because its dependency never arrived is a TRUTHFUL refusal of an incomplete
  // artifact, not a statement that the script was invalid. Filing it under
  // INVALID_SOURCE would quietly move a real capability gap (we do not resolve
  // library imports) out of the compatibility accounting entirely.
  let outcome
  if (demand.hasLibraryCall) outcome = 'INVALID_SOURCE'
  else if (raw.declaration === 'strategy' || (!raw.declaration && demand.hasStrategyCall && !demand.hasImport)) outcome = 'INVALID_SOURCE'
  else if (raw.threw || (assisted && assisted.threw)) outcome = 'UNKNOWN_NEEDS_ADJUDICATION'
  else if (raw.ok) outcome = 'RAW_ACCEPTED'
  else if (assisted && assisted.ok) outcome = 'ASSISTED_ACCEPTED'
  else if (raw.guard) outcome = 'CORRECTLY_REFUSED'
  else outcome = 'UNKNOWN_NEEDS_ADJUDICATION'

  // ⛔ A FLAGGED ACCEPTANCE IS NOT YET A SILENT FALSE SUCCESS, and this function
  // must not promote it to one. Detection is mechanical; reclassification to
  // SILENT_FALSE_SUCCESS happens only after independent adjudication, and is
  // written back into the report by the adjudication step.
  const needsAudit = !!(accepted && probes.anyFlag && probes.anyFlag.length > 0)

  return {
    name,
    outcome,
    needsSilentWrongResultAudit: needsAudit,
    primaryBlocker: raw.ok ? null : (raw.guard || raw.threw || null),
    secondaryBlockers: raw.ok ? [] : (raw.allGuards || []).slice(1),
    assistedStop,
    offersTaken: offers.length,
    offers,
    demand,
    raw,
    assisted,
    probes,
  }
}
