"""F3 fix round 2: mutation census of the new ask_used rail (vitest) and the 15b derivation (pytest).

Each mutation replaces ONE exact anchor (asserted to occur once), runs the named rail, restores the
captured bytes, and checks the restore TWO ways: the sha256 on disk equals the capture, AND the file's
content equals its COMMITTED blob (CR-stripped) -- a sha only proves the bytes match what was captured.
The harness's own path and its logs are excluded from the clean check (review M-5).

    python docs/notebook/evidence/wave10-f3/mutate_f3_r2.py > docs/notebook/evidence/wave10-f3/mutations-f3-r2.log
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.relpath(__file__, os.getcwd()).replace('\\', '/')
OWN = {HERE, HERE.replace('mutate_f3_r2.py', 'mutations-f3-r2.log')}
T = 'tools/parity_scorecard.py'
TF = 'tests/test_parity_scorecard.py'
ASK = 'app/src/pages/journal-2-0/components/notebook/AskPanel.jsx'
ASK_RAIL = 'src/pages/journal-2-0/components/notebook/AskPanel.telemetry.test.jsx'
FIRE = "        trackNotebookEvent(NOTEBOOK_EVENTS.ASK_USED, { scope, inserted: false, ms: Date.now() - askStartedAt })\n"
MUT = [
    # (id, file, old, new, runner, rail)
    ('M1 the answered-ask fire removed (AskPanel.jsx:235)', ASK, FIRE, "        void askStartedAt\n", 'vitest', ASK_RAIL),
    ('M2 the answered-ask fire doubled', ASK, FIRE, FIRE + FIRE, 'vitest', ASK_RAIL),
    ('M3 the insert fire removed (AskPanel.jsx:292)', ASK,
     "    trackNotebookEvent(NOTEBOOK_EVENTS.ASK_USED, {\n      scope, inserted: true,",
     "    void ({\n      scope, inserted: true,", 'vitest', ASK_RAIL),
    ('M4 ask_used fired before the failure check', ASK, "      if (failed) return\n",
     "      trackNotebookEvent(NOTEBOOK_EVENTS.ASK_USED, { scope })\n      if (failed) return\n", 'vitest', ASK_RAIL),
    ('M5 a rail that never names its event passes', T,
     """        elif f"'{ev}'" not in body and f'"{ev}"' not in body:""", "        elif False:",
     'pytest', 'test_a_core_action_event_that_is_not_railed_is_a_named_gap'),
    ('M6 a rail that did not run green passes', T,
     "        elif ('✓ ' + f.replace('app/', '', 1)) not in log_text:", "        elif False:",
     'pytest', 'test_a_core_action_event_that_is_not_railed_is_a_named_gap'),
    ('M7 no events read passes', T, "    if not events:\n        return ['CORE_ACTION_EVENTS:",
     "    if False:\n        return ['CORE_ACTION_EVENTS:", 'pytest',
     'test_a_core_action_event_that_is_not_railed_is_a_named_gap'),
    ('M8 ask_used dropped from the named rails', T,
     "    'ask_used': f'{_TNB}/AskPanel.telemetry.test.jsx',\n", "", 'pytest',
     'test_every_core_action_event_has_a_call_site_rail_that_ran_green'),
    ('M9 an unnamed event is not a gap', T, "            gaps.append(f'{ev}: no call-site rail is named for it')\n            continue\n",
     "            continue\n", 'pytest', 'test_a_core_action_event_that_is_not_railed_is_a_named_gap'),
]


def committed(path):
    b = subprocess.run(['git', 'cat-file', 'blob', f'HEAD:{path}'], capture_output=True).stdout
    return b.replace(b'\r', b'')


def run(runner, rail):
    if runner == 'pytest':
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONPYCACHEPREFIX=tempfile.mkdtemp(prefix='f3r2mut_'))
        r = subprocess.run([sys.executable, '-m', 'pytest', '-q', '-p', 'no:cacheprovider', TF, '-k', rail],
                           capture_output=True, text=True, env=env, encoding='utf-8', errors='replace')
        tot = [l for l in r.stdout.splitlines() if ' passed' in l or ' failed' in l or ' error' in l]
        return r.returncode, (tot[-1] if tot else 'NO TOTALS')
    npx = shutil.which('npx')
    env = dict(os.environ, NO_COLOR='1', FORCE_COLOR='0')
    r = subprocess.run([npx, 'vitest', 'run', rail], cwd='app', capture_output=True, text=True, env=env,
                       encoding='utf-8', errors='replace')
    tot = [' '.join(l.split()) for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith('Tests ')]
    return r.returncode, (tot[-1] if tot else 'NO TOTALS')


only = set(sys.argv[1:])
res = []
for mid, path, old, new, runner, rail in MUT:
    if only and mid.split()[0] not in only:
        continue
    raw = open(path, 'rb').read()
    crlf = b'\r\n' in raw
    s = raw.decode('utf-8').replace('\r\n', '\n')
    assert s.count(old) == 1, (mid, s.count(old))
    m = s.replace(old, new)
    if crlf:
        m = m.replace('\n', '\r\n')
    before = hashlib.sha256(raw).hexdigest()
    try:
        open(path, 'wb').write(m.encode('utf-8'))
        code, tot = run(runner, rail)
    finally:
        open(path, 'wb').write(raw)
    after_raw = open(path, 'rb').read()
    row = {'id': mid, 'runner': runner, 'rail': rail, 'totals': tot, 'red': code != 0 and tot != 'NO TOTALS',
           'restored_sha_ok': hashlib.sha256(after_raw).hexdigest() == before,
           'restored_equals_committed_blob': after_raw.replace(b'\r', b'') == committed(path)}
    res.append(row)
    print(json.dumps(row, ensure_ascii=True), flush=True)
# control: every rail green on the unmutated tree, so a red above is the mutation's
for runner, rail in sorted({(r['runner'], r['rail']) for r in res}):
    code, tot = run(runner, rail)
    print(json.dumps({'control': rail, 'totals': tot, 'green': code == 0 and tot != 'NO TOTALS'}, ensure_ascii=True), flush=True)
    res.append({'red': True, 'restored_sha_ok': True, 'restored_equals_committed_blob': True, 'control_green': code == 0})
st = [l for l in subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout.splitlines()
      if l[3:].strip() not in OWN]
print('git status after (this harness and its log excluded):', repr(st))
muts = [x for x in res if 'id' in x]
ok = (all(x['red'] and x['restored_sha_ok'] and x['restored_equals_committed_blob'] for x in muts)
      and all(x.get('control_green', True) for x in res) and not st)
print(f'ALL {len(muts)} RED, CONTROLS GREEN, RESTORED, CLEAN' if ok else 'NOT ALL RED / NOT CLEAN')
