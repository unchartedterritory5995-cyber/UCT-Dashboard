// ── A SCRIPTED planner-v2 server for panel tests (test-only module) ────────────────────────────────────────
//
// Stands in for POST /api/agent/turn/stream, /turn/step and /turn/resume (STEP-1) over the panelHarness fetch:
// the test gives it a SCRIPT — step events and the final reply, in order — and it plays the server's part:
// one `step` event, then it WAITS for the browser's step_result before the next; a `proposed` result ends the
// stream as the server does ({t:'paused'} + a paused final) until /turn/resume opens a new one; the last item is
// the final reply. Script items may be functions of the turn so far ({ body, results, board }) — a step whose
// target is a ref the browser only has after an earlier step (a chart made by widget.addCharts) is written that
// way. No model, no network: the script IS the model.
//
//   const srv = installStepServer(p, [ { action, target: (c) => c.body.context.charts[0].ref, args, mode }, { reply: 'Done.' } ])
//   … say('…') …  srv.results  srv.bodies  srv.resumes
export function installStepServer(harness, script, { planner = 'v2', board = null } = {}) {
  const prev = globalThis.fetch
  const srv = { bodies: [], results: [], resumes: [], events: [], turnId: 'v2_test1', idx: 0, steps: 0, stream: null, board }
  const enc = new TextEncoder()
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })

  function openStream() {
    let controller
    const body = new ReadableStream({ start(c) { controller = c } })
    srv.stream = {
      emit(ev) { srv.events.push(ev); controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)) },
      close() { try { controller.close() } catch { /* already closed */ } srv.stream = null },
    }
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }

  const ctx = () => ({ body: srv.bodies[srv.bodies.length - 1], results: srv.results, board: srv.board, srv })

  function next() {
    const raw = script[srv.idx++]
    const item = typeof raw === 'function' ? raw(ctx()) : raw
    if (!item) { srv.stream?.close(); return }
    if (item.reply !== undefined) {
      srv.stream.emit({ t: 'final', conversationId: 'ac_1', turnId: 70 + srv.idx, usage: { citations: item.sources || [] },
        envelope: { disposition: 'answer', reply: item.reply, question: null, ops: [], unsupported_category: null, planner: 'v2', steps: [] } })
      srv.stream.close()
      return
    }
    // V2-G2: `{ group: [step, …] }` — ONE plan group (turn_v2._send_group): every step emitted back to back with
    // `group: {id, index, size}`; the server reads all their results before it goes on (or pauses on a card)
    const items = item.group ? item.group.map(x => (typeof x === 'function' ? x(ctx()) : x)) : [item]
    const gid = items.length > 1 ? `g${srv.steps + 1}` : null
    srv.waiting = { left: items.length, proposed: false }
    items.forEach((it, i) => {
      srv.steps += 1
      srv.stream.emit({ t: 'step', turnId: srv.turnId, id: `s${srv.steps}`, round: srv.steps, action: it.action, target: it.target,
        args: it.args || {}, mode: it.mode || 'apply', ...(gid ? { group: { id: gid, index: i, size: items.length } } : {}) })
    })
  }

  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    const body = init.body ? JSON.parse(init.body) : null
    if (u === '/api/agent/config') return json({ stream: false, nl1: false, data: false, scan: false, data_kinds: [], news: false, planner })
    if (u === '/api/agent/turn/stream') {
      srv.bodies.push(body)
      const r = openStream()
      // the first event after the headers are out (the reader must be attached before a close)
      setTimeout(next, 0)
      return r
    }
    if (u === '/api/agent/turn/step') {
      srv.results.push(body)
      const w = srv.waiting || { left: 1, proposed: false }
      w.left -= 1
      w.proposed = w.proposed || body.status === 'proposed'
      if (w.left > 0) return json({ ok: true })              // more results of this plan group to come
      if (w.proposed) {
        srv.stream.emit({ t: 'paused', turnId: srv.turnId, id: body.id })
        srv.stream.emit({ t: 'final', conversationId: 'ac_1', turnId: null, usage: {},
          envelope: { disposition: 'answer', reply: '', question: null, ops: [], unsupported_category: null, planner: 'v2', paused: true } })
        srv.stream.close()
      } else {
        setTimeout(next, 0)
      }
      return json({ ok: true })
    }
    if (u === '/api/agent/turn/resume') {
      srv.resumes.push(body)
      const r = openStream()
      setTimeout(next, 0)
      return r
    }
    return prev(url, init)
  }
  srv.uninstall = () => { globalThis.fetch = prev }
  return srv
}
