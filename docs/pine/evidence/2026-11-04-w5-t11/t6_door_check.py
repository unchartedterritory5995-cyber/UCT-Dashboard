"""t6_door_check.py : one-off proof that a request built by pine_runtime_client passes W5-T6's REAL
door (services/pine_runtime/{auth,protocol}.mjs at origin/feat/pine-w5-t6-supervisor 94b46f55b1):
signature verified, closed schema parsed, doc and bars hashes recomputed equal, and a moved engine
refused 409. T6 is not merged into this branch's base, so its files are read with `git show` into
a temp dir (never copied into the repo). Fixture secret only; no network. Run from the repo root."""
import os, subprocess, sys, tempfile
sys.path.insert(0, os.getcwd())
from api.services import pine_runtime_client as prc
from tests.fakes.pine_runtime_fake import FIXTURE_IDENTITY, bars_fixture

REF = sys.argv[1] if len(sys.argv) > 1 else '94b46f55b1'
SECRET = 'fixture-secret-0123456789abcdef0123456789'
cap = {}


def tr(url, body, headers, timeout):
    cap['body'], cap['sig'] = body, headers[prc.SIGNATURE_HEADER]
    return 503, b''


c = prc.PineRuntimeClient(url='http://x', secret=SECRET, identity=FIXTURE_IDENTITY, transport=tr, clock=lambda: 1762200000)
doc = {"id": "u_0123456789ab", "compute": {"kind": "runtime", "source": "//@version=6\nindicator('\u00e9')\nplot(close)",
                                          "outputs": ["value"]}, "meta": {"n": 1.5}}
c.run(def_id='u_0123456789ab', version=3, doc=doc, owner_id='u', profile='alert',
      jobs=[prc.Job(job='AAPL|D', ticker='AAPL', exchange='NASDAQ', tf='D', bars=bars_fixture(7), want=('value',),
                    runtime_inputs={'len': 14, 'src': 'close', 'on': True})])
d = tempfile.mkdtemp(prefix='t6door-')
for f in ('protocol.mjs', 'auth.mjs'):
    open(os.path.join(d, f), 'wb').write(subprocess.check_output(['git', 'show', f'{REF}:services/pine_runtime/{f}']))
open(os.path.join(d, 'body.bin'), 'wb').write(cap['body'])
open(os.path.join(d, 'sig.txt'), 'w').write(cap['sig'])
js = r"""
const fs=require('fs');
Promise.all([import('./protocol.mjs'),import('./auth.mjs')]).then(([p,a])=>{
const body=fs.readFileSync('body.bin'); const sig=fs.readFileSync('sig.txt','utf8');
const parsed=a.parseSignatureHeader(sig, 1762200000);
const ok=a.verifyBody(['%s'], parsed, body);
const id={script_engine:4,runtime_language:'pine',runtime_frontend:1,runtime_ir:1,bundle_sha256:'ab'.repeat(32)};
const r=p.parseRunRequest(body,{identity:id,tfSet:['D','60'],maxBars:32768});
const r2=p.parseRunRequest(body,{identity:{...id,script_engine:5},tfSet:['D'],maxBars:32768});
console.log('signature verified:', ok, '| parse ok:', r.ok, r.ok ? 'n='+r.request.jobs[0].bars.n : JSON.stringify(r), '| moved engine:', r2.status, r2.guard);
process.exit(ok && r.ok && r2.status===409 ? 0 : 1);
})""" % SECRET
sys.exit(subprocess.run(['node', '-e', js], cwd=d).returncode)
