// UCT Agent AUTOTEST: the oracle. Pure. Grades a before/after SNAPSHOT of the real components, never a receipt: a receipt
// is one of the things under test (a success receipt with no state change fails here, as "read-back").
//
// Snapshot: { charts: { <role>: {...} }, widgets: [{id,type}], wl: {name:[syms]}, drawings: {SYM:[...]}, alerts:[...],
//             ialerts:[...], layouts:[names], written:{prefKey:value}, unreadable:[key,...] }
// `unreadable` lists keys this mode cannot read (jsdom has no pixels): a check on one grades n/a, never pass.
import { gradeTarget, targetRecord } from './selectionOracle.mjs'
import { BOARDS } from './boards.mjs'

export const OUTCOMES = ['change', 'read', 'refuse', 'clarify', 'answer', 'walkthrough', 'guarded']
export const OPS = ['eq', 'ne', 'has', 'lacks', 'len', 'lenGte', 're', 'notRe', 'gt', 'lt', 'changed', 'same', 'delta', 'exists']

export function getPath(snap, path) {
  const [head, ...rest] = String(path).split('.')
  const root = snap.charts && head in snap.charts ? snap.charts[head] : snap[head]
  let v = root
  for (const k of rest) { if (v == null) return undefined; v = k === 'length' && Array.isArray(v) ? v.length : v[k] }
  return v
}
const leaf = (path) => String(path).split('.').filter(k => k !== 'length').at(-1)
const str = (x) => (typeof x === 'string' ? x : JSON.stringify(x))

export function checkOne([path, op, want], before, after) {
  const un = after.unreadable || []
  if (un.includes(leaf(path)) || un.includes(String(path).split('.')[0])) return { name: `${path} ${op}`, na: true, why: 'not readable in this mode' }
  const got = getPath(after, path), was = getPath(before, path)
  let pass
  switch (op) {
    case 'eq': pass = str(got) === str(want); break
    case 'ne': pass = str(got) !== str(want); break
    case 'has': pass = Array.isArray(got) ? got.some(x => str(x) === str(want)) : str(got ?? '').includes(str(want)); break
    case 'lacks': pass = Array.isArray(got) ? !got.some(x => str(x) === str(want)) : !str(got ?? '').includes(str(want)); break
    case 'len': pass = (got?.length ?? -1) === want; break
    case 'lenGte': pass = (got?.length ?? -1) >= want; break
    case 're': pass = new RegExp(want, 'i').test(str(got ?? '')); break
    case 'notRe': pass = !new RegExp(want, 'i').test(str(got ?? '')); break
    case 'gt': pass = Number(got) > want; break
    case 'lt': pass = Number(got) < want; break
    case 'changed': pass = str(got) !== str(was); break
    case 'same': pass = str(got) === str(was); break
    case 'delta': pass = (Array.isArray(got) ? got.length : Number(got)) - (Array.isArray(was) ? was.length : Number(was)) === want; break
    case 'exists': pass = got !== undefined && got !== null; break
    default: throw new Error(`unknown oracle op ${op}`)
  }
  return { name: `${path} ${op}${want === undefined ? '' : ` ${str(want)}`}`, pass, detail: pass ? undefined : `got ${str(got)?.slice(0, 200)}${op === 'changed' || op === 'same' || op === 'delta' ? ` was ${str(was)?.slice(0, 120)}` : ''}` }
}

// A chart's fingerprint. Only what the mode can read takes part.
const CHART_KEYS = ['sym', 'tf', 'scale', 'session', 'volume', 'chips', 'type', 'panes', 'settingsHash', 'pixels']
export const chartPrint = (c, un = []) => JSON.stringify(CHART_KEYS.filter(k => !un.includes(k)).map(k => c?.[k]))
export function worldPrint(s) {
  const un = s.unreadable || []
  return JSON.stringify({
    charts: Object.fromEntries(Object.entries(s.charts || {}).map(([k, c]) => [k, chartPrint(c, un)])),
    widgets: (s.widgets || []).map(w => `${w.id}@${w.x},${w.y},${w.w},${w.h}`).sort(),
    wl: s.wl,
    drawings: Object.fromEntries(Object.entries(s.drawings || {}).map(([k, d]) => [k, d.length])),
    alerts: (s.alerts || []).length, ialerts: (s.ialerts || []).length, layouts: s.layouts,
  })
}
// `pixels` shift with the view (a timeframe round trip reopens a few bars off, for a person too), so Undo compares state
const stateOnly = (s) => worldPrint({ ...s, unreadable: [...(s.unreadable || []), 'pixels'] })

/**
 * Grade one request. `ev`: { before, after, turns: [{ say, newReceipt, receiptText, card, modelCalls, last, envelope }],
 * undo: { after } | null, guide: guideEvidence | null, errors: [] }. → { pass, graded, na, checks }
 */
export function grade(request, ev) {
  const o = request.oracle
  const C = []
  const push = (name, pass, detail, tag) => C.push({ name, pass: !!pass, detail: pass ? undefined : detail, tag })
  // a target case clicks between its first snapshot and its last sentence, so its board starts at that sentence
  const before = o.target && ev.beforeLast ? ev.beforeLast : ev.before
  const { after } = ev
  const last = ev.turns.at(-1) || {}
  const anyReceipt = ev.turns.some(t => t.newReceipt)
  const saidAll = ev.turns.map(t => t.last || '').join(' // ')
  const stateChecks = (tag) => { for (const e of o.expect || []) C.push({ ...checkOne(e, before, after), tag }) }

  if (o.outcome === 'change') {
    stateChecks('state')
    if (o.receipt !== false) push('a receipt reports the change', anyReceipt, `no receipt; said: ${saidAll.slice(0, 200)}`, 'receipt')
    // a success receipt, a state check that failed and a board that did not move: the words outran the world
    if (anyReceipt && ev.turns.length === 1 && C.some(c => c.tag === 'state' && c.pass === false) && worldPrint(before) === worldPrint(after)) push('the receipt is backed by a real change', false, 'a receipt, and nothing changed on the board', 'readback')
    if (o.only) {
      const un = after.unreadable || []
      for (const [role, c] of Object.entries(after.charts || {})) {
        if (o.only.includes(role)) continue
        push(`${role} untouched`, chartPrint(c, un) === chartPrint(before.charts[role], un), `was ${chartPrint(before.charts[role], un).slice(0, 160)} now ${chartPrint(c, un).slice(0, 160)}`, 'target')
      }
    }
    if (o.confirm) push('it asked before changing anything', ev.turns.some(t => t.card), 'no card', 'confirm')
    if (o.confirm) push('nothing moved before Apply', ev.turns.every(t => !t.card || t.heldUntilApply !== false), 'the board moved before Apply', 'confirm')
  } else if (o.outcome === 'walkthrough') {
    const g = ev.guide
    push('a walkthrough started', !!g?.started, g?.why || 'no card on screen', 'guide')
    for (const s of g?.steps || []) {
      if (s.ringOk !== undefined) push(`step ${s.index + 1}: the ring sits on the real control (${s.target})`, s.ringOk, s.ringDetail, 'guide')
      push(`step ${s.index + 1}: the instruction matches`, s.textOk, s.text, 'guide')
      if (s.acted !== undefined) push(`step ${s.index + 1}: the real control took the click`, s.acted, s.actDetail, 'guide')
    }
    if (g?.started && g.finished !== undefined) push('the walkthrough ran to its end', g.finished, g.stoppedAt, 'guide')
    if (g?.started && g.clean !== undefined) push('nothing on screen after it ended', g.clean, g.leftovers, 'guide')
    stateChecks('guide')
    if (!o.expect) push('showing it changed nothing', stateOnly(before) === stateOnly(after), 'the board changed', 'guide')
  } else if (o.outcome === 'guarded') {
    // a deliberately wrong plan: the target checks below are the whole of the grade
  } else {
    // read / refuse / clarify / answer: the board stays exactly as it was
    push('nothing changed', worldPrint(before) === worldPrint(after), `${worldPrint(before).slice(0, 200)} -> ${worldPrint(after).slice(0, 200)}`, 'unchanged')
    // a target case grades its LAST sentence (the earlier ones only build the conversation, and may well have their own receipts)
    const receiptHere = o.target ? !!last.newReceipt : anyReceipt
    if (o.outcome === 'refuse' || o.outcome === 'clarify') push('no success receipt', !receiptHere, last.receiptText, 'receipt')
    if (o.outcome === 'clarify') push('it asked', /\?|which/i.test(saidAll), saidAll.slice(0, 200), 'clarify')
    stateChecks('state')
  }
  if (o.target) {
    const roles = BOARDS[request.board]?.roles || {}
    const asked = /\?|which|check this first/i.test(saidAll) || ev.turns.some(t => t.card)
    ev.target = targetRecord(o.target, ev, roles, chartPrint)
    C.push(...gradeTarget(o.target, ev.target, { roles, before, asked }))
  }
  // after the definitions pre-warm (prewarm.mjs, #948): its one burst is graded, and a chart the request did not touch must not
  // repaint at all. Untouched = every chart outside `only` for a change; every chart for a read, refusal, question or answer
  if (ev.prewarm) {
    push('the one-off definitions redraw stayed within its bound (prewarm.mjs)', ev.prewarm.ok, ev.prewarm.detail, 'prewarm')
    const roles = BOARDS[request.board]?.roles || {}
    const untouched = o.outcome === 'change' ? (o.only ? Object.keys(roles).filter(r => !o.only.includes(r)) : []) : ['read', 'refuse', 'clarify', 'answer'].includes(o.outcome) ? Object.keys(roles) : []
    for (const role of untouched) {
      const layers = ev.repaints?.[roles[role].id]
      if (!layers) continue
      push(`${role} did not repaint`, layers.every(n => n === 0), `clears per layer: ${layers.join(',')}`, 'repaint')
    }
  }
  if (o.says) push(`it says /${o.says}/`, new RegExp(o.says, 'i').test(saidAll), saidAll.slice(0, 240), 'says')
  if (o.saysNot) push(`it does not say /${o.saysNot}/`, !new RegExp(o.saysNot, 'i').test(saidAll), saidAll.slice(0, 240), 'says')
  for (const e of o.persist || []) { const r = checkOne(e, before, after); C.push({ ...r, name: `persisted: ${r.name}`, tag: 'persist' }) }
  if (o.undo && o.outcome === 'change') {
    if (!ev.undo) push('Undo ran', false, 'no undo evidence', 'undo')
    else push('one undo restores the board', stateOnly(before) === stateOnly(ev.undo.after), `${stateOnly(before).slice(0, 220)} -> ${stateOnly(ev.undo.after).slice(0, 220)}`, 'undo')
  }
  if (o.noModel && ev.turns.some(t => t.modelCalls > 0)) push('answered without a model call', false, 'a model call was made', 'path')
  if (ev.errors?.length) push('no console errors', false, ev.errors.slice(0, 3).join(' | '), 'console')
  const graded = C.filter(c => !c.na)
  return { pass: graded.length > 0 && graded.every(c => c.pass), graded: graded.length, na: C.length - graded.length, checks: C }
}
