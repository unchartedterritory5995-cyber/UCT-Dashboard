# Build the census input list: [{key, set, sha, text}] into sources.json (local only, never committed).
# Built ONCE from the train head's tree; the same list is measured before and after.
import json, glob, os, hashlib, collections, sys
W = 'C:/Users/Patrick/uct-worktrees/train-1/'
P = 'C:/Users/Patrick/uct-worktrees/_resume-2026-11-01/pine-sample/'
R = 'C:/Users/Patrick/AppData/Local/uct-vendor-batch/runs/'
SKIP_RUNS = ('admit-grade', 'regrade-', 'licence-moved')
out = []; seen = set()
def add(key, st, text):
    h = hashlib.sha256(text.encode('utf8')).hexdigest()[:16]
    if (st, h) in seen: return
    seen.add((st, h)); out.append({'key': key, 'set': st, 'sha': h, 'text': text})
for f in sorted(glob.glob(W + 'corpus/**/*.pine', recursive=True)):
    add(os.path.relpath(f, W).replace(chr(92), '/'), 'corpus', open(f, encoding='utf8').read())
for f in sorted(glob.glob(W + '**/*.pine', recursive=True)):
    ff = f.replace(chr(92), '/')
    if 'node_modules' in ff or '/corpus/' in ff: continue
    add(os.path.relpath(f, W).replace(chr(92), '/'), 'repo', open(f, encoding='utf8').read())
for f in sorted(glob.glob(W + 'tests/fixtures/vendor/**/*.json', recursive=True)):
    try: d = json.load(open(f, encoding='utf8'))
    except Exception: continue
    s = (d.get('source') or {}).get('text') if isinstance(d, dict) else None
    if isinstance(s, str): add(os.path.relpath(f, W).replace(chr(92), '/'), 'vendor', s)
m = json.load(open(P + 'sample_manifest.json', encoding='utf8'))['rows']
for r in m:
    if r['status'] != 'ok': continue
    p = r['path'].replace('<cache>/', P)
    if not os.path.isabs(p) and not p.startswith('C:'): p = W + p
    try: add(r['slug'], 'sample', open(p, encoding='utf8').read())
    except Exception: pass
for f in sorted(glob.glob(R + '*/captures/*.json')):
    run = f.replace(chr(92), '/').split('/runs/')[1].split('/')[0]
    if run.startswith(SKIP_RUNS): continue
    try: d = json.load(open(f, encoding='utf8'))
    except Exception: continue
    s = (d.get('source') or {}).get('text')
    if isinstance(s, str): add(run + '/' + os.path.basename(f), 'held', s)
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sources.json'), 'w', encoding='utf8'))
print(len(out), collections.Counter(x['set'] for x in out))
