"""W9-T6 r2 resolver mutants: copy aside, ONE replacement (must match once), run the resolver rails,
restore, assert bytes. Never git checkout."""
import hashlib, json, os, shutil, subprocess, sys

REPO = r'C:/Users/Patrick/uct-worktrees/pine-dsk-w9t6'
F = 'tools/vendor_harness/evidence_engine.py'
PY = f'cd {REPO} && python -m pytest tests/test_broker_pins_resolve.py -q -x -p no:cacheprovider'
OUT = sys.argv[1]

MUTS = [
    ('control-comment', F, 'SETTINGS_REFUSED = "MATCH-WITHOUT-SETTINGS-READBACK"\n', 'SETTINGS_REFUSED = "MATCH-WITHOUT-SETTINGS-READBACK"  # control\n'),
    ('precondition off', F, '                if not settings_readback_ok(r, sources.get(r.get("sourceSha256")), table):', '                if False:'),
    ('only Q-S1-core rows checked (r1 scope)', F, '            if v == "MATCH" and cid in pinned_ids:', '            if v == "MATCH" and r.get("queueTargetId") == "Q-S1-core":'),
    ('expected = defaults always (declaration ignored)', F, '        if param and param in args:\n            lit', '        if False and param in args:\n            lit'),
    ('non-literal declaration served as default', F, '            if lit is None:\n                return None\n            out[key] = lit', '            if lit is None:\n                lit = default\n            out[key] = lit'),
    ('unknown source passes', F, '    expected = expected_settings(source, table) if source is not None else None\n    if expected is None:\n        return False', '    expected = expected_settings(source, table) if source is not None else dict(SETTINGS_DEFAULTS)\n    if expected is None:\n        return False'),
    ('a missing property passes', F, '        if p is None or "value" not in p or not _same(p["value"], want):', '        if p is not None and ("value" not in p or not _same(p["value"], want)):'),
    ('one checked setting dropped', F, '    "calc_on_order_fills": False,            # (W9-P1b / W9-P2 move it)\n', ''),
    ('comments not skipped', F, '        if text.startswith("//", k):\n            nl = text.find', '        if False:\n            nl = text.find'),
]


def sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


results = []
for name, rel, old, new in MUTS:
    path = os.path.join(REPO, rel)
    bak = path + '.mutbak'
    before = sha(path)
    shutil.copyfile(path, bak)
    try:
        src = open(path, encoding='utf-8', newline='').read()
        n = src.count(old)
        if n != 1:
            results.append({'mutant': name, 'verdict': f'BADMATCH ({n})'})
            print(results[-1], flush=True)
            continue
        open(path, 'w', encoding='utf-8', newline='').write(src.replace(old, new))
        r = subprocess.run(['bash', '-lc', PY], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
        results.append({'mutant': name, 'file': rel, 'verdict': 'KILLED' if r.returncode != 0 else 'SURVIVED'})
    finally:
        shutil.copyfile(bak, path)
        os.remove(bak)
        assert sha(path) == before, f'{name}: restore mismatch'
    print(results[-1], flush=True)
json.dump(results, open(OUT, 'w'), indent=1)
