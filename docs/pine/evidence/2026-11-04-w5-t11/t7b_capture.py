"""t7b_capture.py [REF [SOURCE OUT]] : capture a REAL W5-T7b service response for the T11 conformance rail.

Reads W5-T7b's service files READ-ONLY with `git show REF:<path>` into a temp tree (never into the
repo): services/pine_runtime/{auth,job,pool,protocol,sandbox,server}.mjs, its stand-in bundle
services/pine_runtime/test/fixtures/fakeBundle.mjs, and T3's runtime/columnDigest.js (the seal's
codec). It starts T7b's own `createPineRuntimeServer` with T7b's own job pool (`createPool`, one
sandboxed worker) on 127.0.0.1, POSTs the request THIS client builds and signs, and writes the
request sha256 and the exact response bytes to tests/fixtures/pine_runtime/t7b_response.json.
Fixture secret only; loopback only. Run from the repo root."""
import hashlib, json, os, subprocess, sys, tempfile
sys.path.insert(0, os.getcwd())
from api.services import pine_runtime_client as prc

REF = sys.argv[1] if len(sys.argv) > 1 else 'e13d282eae'
# the fake bundle's behaviour: 'warmup:3' reports withheldBars 3 over FINITE bars 0-2 (a stand-in that
# does not curtain, so the client must refuse it); 'echo' reports no warm-up (withheldBars 0).
SOURCE = sys.argv[2] if len(sys.argv) > 2 else 'warmup:3'
OUT = sys.argv[3] if len(sys.argv) > 3 else 'tests/fixtures/pine_runtime/t7b_response.json'
SECRET = 'fixture-secret-not-a-real-key-0123456789abcdef'
T = 1_762_200_000
IDENTITY = {"script_engine": 5, "runtime_language": "pine", "runtime_frontend": 1, "runtime_ir": 1,
            "bundle_sha256": "ab" * 32}
N = 8
BARS = [{"t": 1_700_000_000 + 86_400 * i, "o": 100.0 + i, "h": 102.0 + i, "l": 99.0 + i,
         "c": 100.5 + i * 1.25, "v": 1000.0 + i} for i in range(N)]
DOC = {"id": "u_0123456789ab", "meta": {}, "compute": {"kind": "runtime", "source": SOURCE,
                                                       "outputs": ["value"]}}
JOBS = [{"job": "AAPL|D", "ticker": "AAPL", "exchange": "NASDAQ"}, {"job": "MSFT|D", "ticker": "MSFT", "exchange": "NASDAQ"}]
FILES = ['services/pine_runtime/auth.mjs', 'services/pine_runtime/job.mjs', 'services/pine_runtime/pool.mjs',
         'services/pine_runtime/protocol.mjs', 'services/pine_runtime/sandbox.mjs', 'services/pine_runtime/server.mjs',
         'services/pine_runtime/test/fixtures/fakeBundle.mjs',
         'app/src/components/chart/engine/runtime/columnDigest.js']


def jobs():
    return [prc.Job(job=j["job"], ticker=j["ticker"], exchange=j["exchange"], tf="D", bars=BARS, want=("value",),
                    history_from_listing=True) for j in JOBS]


def main():
    cap = {}

    def tr(url, body, headers, timeout):
        cap['body'], cap['sig'] = body, headers[prc.SIGNATURE_HEADER]
        return 503, b''
    prc.PineRuntimeClient(url='http://127.0.0.1', secret=SECRET, identity=IDENTITY, transport=tr,
                          clock=lambda: T).run(def_id='u_0123456789ab', version=1, doc=DOC, owner_id='owner-1',
                                               profile='alert', jobs=jobs())
    d = tempfile.mkdtemp(prefix='w5t11-t7b-')
    for f in FILES:
        p = os.path.join(d, *f.split('/'))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, 'wb').write(subprocess.check_output(['git', 'show', f'{REF}:{f}']))
    open(os.path.join(d, 'body.bin'), 'wb').write(cap['body'])
    js = os.path.join(d, 'capture.mjs')
    open(js, 'w', encoding='utf-8').write(r"""
import { readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { createPineRuntimeServer, listenDualStack } from './services/pine_runtime/server.mjs'
import { createPool } from './services/pine_runtime/pool.mjs'
import { columnDigest, decodeColumn } from './app/src/components/chart/engine/runtime/columnDigest.js'
const [sig, t, identity] = [process.argv[2], Number(process.argv[3]), JSON.parse(process.argv[4])]
const pool = await createPool({ bundle: new URL('./services/pine_runtime/test/fixtures/fakeBundle.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), workers: 1 })
const door = { identity, codec: { columnDigest, decodeColumn }, tfSet: ['D'], maxBars: 32768 }
const server = createPineRuntimeServer({ secrets: [process.env.W5T11_SECRET], door, runner: pool.run, now: () => t, log: () => {} })
const port = await listenDualStack(server, 0)
const body = readFileSync('body.bin')
const res = await new Promise((done, fail) => {
  const r = request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/run',
    headers: { 'content-type': 'application/json', 'content-length': body.length, 'x-pine-runtime-signature': sig } }, (resp) => {
    const chunks = []; resp.on('data', (c) => chunks.push(c)); resp.on('end', () => done({ status: resp.statusCode, bytes: Buffer.concat(chunks) }))
  })
  r.on('error', fail); r.end(body)
})
writeFileSync('resp.bin', res.bytes)
console.log('status', res.status)
await new Promise((d) => server.close(d)); if (pool.close) await pool.close()
process.exit(res.status === 200 ? 0 : 1)
""")
    r = subprocess.run(['node', 'capture.mjs', cap['sig'], str(T), json.dumps(IDENTITY)], cwd=d,
                       env=dict(os.environ, W5T11_SECRET=SECRET), timeout=120)
    resp = open(os.path.join(d, 'resp.bin'), 'rb').read()
    print('node rc', r.returncode, resp[:300])
    if r.returncode != 0:
        sys.exit(1)
    out = {"_about": f"A real W5-T7b response (git {REF}: server.mjs + pool.mjs + job.mjs over test/fixtures/"
                     "fakeBundle.mjs '{SOURCE}'), captured by docs/pine/evidence/2026-11-04-w5-t11/t7b_capture.py. "
                     "Fixture secret; no licence-held content.",
           "ref": REF, "identity": IDENTITY, "bars": BARS, "doc": DOC, "jobs": JOBS,
           "request_sha256": hashlib.sha256(cap['body']).hexdigest(), "status": 200,
           "response": resp.decode('utf-8')}
    p = OUT
    open(p + '.tmp', 'w', encoding='utf-8', newline='\n').write(json.dumps(out, indent=1, ensure_ascii=True) + '\n')
    os.replace(p + '.tmp', p)
    print('wrote', p)


main()
