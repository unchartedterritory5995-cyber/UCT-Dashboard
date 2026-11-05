// UCT Agent AUTOTEST: the REAL-MODEL relay for the local harness. ⛔ PAID when it runs. It cannot be built without a grant
// from realGuard.authorize, which needs the owner's file. The page's ?live=<port> reaches this relay; the relay reaches the
// gate process (tools/agent_autotest_gate.py serve), which holds the eval key, reserves every call in the ledger and settles it.
// The same shape as the scripted relay, so the driver cannot tell them apart. `ask` does nothing: nothing is scripted here.
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { isGranted } from './realGuard.mjs'

const GATE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../tools/agent_autotest_gate.py')

export async function startRealRelay(grant, { publicSha, heldoutSha, spendLog } = {}) {
  if (!isGranted(grant) || grant.target !== 'local') throw new Error('REAL-MODEL: no grant from the authorization file; refused')
  const child = spawn('python', [GATE, 'serve', '--stage', grant.stage, '--public-sha', publicSha, ...(heldoutSha ? ['--heldout-sha', heldoutSha] : []), ...(spendLog ? ['--spend-log', spendLog] : [])], { stdio: ['ignore', 'pipe', 'inherit'] })
  const gatePort = await new Promise((res, rej) => {
    let buf = ''
    child.stdout.on('data', (d) => { buf += d; const m = /READY (\d+)/.exec(buf); if (m) res(Number(m[1])); else if (/refused:/.test(buf)) rej(new Error(buf.trim())) })
    child.on('exit', (c) => rej(new Error(`the gate exited (${c}): ${buf.trim()}`)))
  })
  const R = {
    turns: [], records: [], queue: [], spend: [], envelopes: [], port: 0, stopped: null, ask() {},
    lastEnvelope: (from) => R.envelopes.slice(from).reduce((all, e) => ({ ...(e || {}), ops: [...(all?.ops || []), ...(e?.ops || [])] }), null),
    lastUnreadable: (from) => R.envelopes.slice(from).some(e => e === null),
    turnUsd: (from) => R.spend.slice(from).reduce((n, x) => n + x, 0),
  }
  const forward = async (path, body) => {
    const r = await fetch(`http://127.0.0.1:${gatePort}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: r.status, json: await r.json() }
  }
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
    let raw = ''
    req.on('data', d => { raw += d })
    req.on('end', async () => {
      const path = req.url.split('?')[0]
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch { /* */ }
      const send = (o, s = 200) => { res.writeHead(s, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(o)) }
      if (path === '/api/agent/turn') {
        R.turns.push({ message: body.message, reroute: !!body.reroute, at: Date.now(), capabilities: (body.capabilities || []).map(c => c.name) })
        const { status, json } = await forward('/turn', body).catch((e) => ({ status: 503, json: { detail: String(e), stopped: 'the gate is gone' } }))
        R.envelopes.push(status === 200 ? json.envelope : status === 400 && json.unreadable ? null : { ops: [] })
        R.spend.push(Number(json.usage?.turn_usd || 0))
        if (json.stopped) R.stopped = json.stopped
        send(json, status)
      } else if (path === '/api/agent/record') {
        const { status, json } = await forward('/record', body).catch(() => ({ status: 200, json: {} }))
        R.records.push({ at: Date.now() })
        send(json, status)
      } else send({ detail: 'relay: not served' }, 404)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  R.port = server.address().port
  R.close = () => { server.close(); child.kill() }
  return R
}
