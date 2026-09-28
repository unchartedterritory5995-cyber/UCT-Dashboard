"""F3 mutation harness: each mutation replaces ONE exact anchor (asserted once), runs the named rails,
restores the captured bytes, and checks the restored sha256 equals the capture AND that git sees no change."""
import hashlib, json, os, subprocess, sys, tempfile

T = 'tools/parity_scorecard.py'
SC = 'docs/notebook/parity-scorecard.md'
TF = 'tests/test_parity_scorecard.py'
MUT = [
 ('M1 tag pin always true', T, "pinned = rc == 0 and sha.startswith(tip) and ok('cat-file', '-e', f'{tip}^{{commit}}')", "pinned = True",
  'test_a_tag_that_does_not_pin_the_recorded_tip_is_refused'),
 ('M2 squash ancestry always true', T, "landed = ok('merge-base', '--is-ancestor', landing, head)", "landed = True",
  'test_a_squash_that_did_not_land_is_refused'),
 ('M3 evidence blob never compared', T, "same = then[0] == 0 and then[1] == here[1]", "same = then[0] == 0",
  'test_evidence_that_changed_since_it_landed_is_refused'),
 ('M4 measured tree reachability skipped', T, "reach = ok('merge-base', '--is-ancestor', sha, frm if frm != 'HEAD' else head)", "reach = True",
  'test_a_measured_tree_that_is_not_reachable_is_refused'),
 ('M5 flag revision not compared', T, "if not written or not (written.startswith(rev_) or rev_.startswith(written)):", "if False:",
  'test_a_flag_record_naming_another_revision_is_refused'),
 ('M6 flag status not compared', T, "                if got != want:\n                    problems.append(f'flag {key}: the record says", "                if False:\n                    problems.append(f'flag {key}: the record says",
  'test_a_flag_status_the_ledger_does_not_hold_is_refused'),
 ('M7 step-by-step walks unread', T, "        c = d.get('steps', [])", "        c = []",
  'test_every_cited_file_line_still_holds_its_fragment'),
 ('M8 an unmet clause dropped from the 10/10 list', SC, "- #14 Performance at scale: no super-linear curve (NOT MEASURED — QUIET SLOT)", "- #14 Performance at scale: (dropped)",
  'test_what_10_10_still_needs_lists_every_unmet_clause_once_under_one_owner'),
]
only = set(sys.argv[1:])
res = []
for mid, path, old, new, test in MUT:
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
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONPYCACHEPREFIX=tempfile.mkdtemp(prefix='f3mut_'))
    try:
        open(path, 'wb').write(m.encode('utf-8'))
        r = subprocess.run([sys.executable, '-m', 'pytest', '-q', '-p', 'no:cacheprovider', TF, '-k', test],
                           capture_output=True, text=True, env=env, encoding='utf-8', errors='replace')
    finally:
        open(path, 'wb').write(raw)
    after = hashlib.sha256(open(path, 'rb').read()).hexdigest()
    tot = [l for l in r.stdout.splitlines() if ' passed' in l or ' failed' in l or ' error' in l]
    row = {'id': mid, 'rail': test, 'totals': tot[-1] if tot else 'NO TOTALS', 'red': r.returncode != 0 and bool(tot),
           'restored_sha_ok': after == before}
    res.append(row)
    print(json.dumps(row, ensure_ascii=True))
st = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout.strip()
print('git status after:', repr(st))
print('ALL RED' if all(x['red'] and x['restored_sha_ok'] for x in res) and not st else 'NOT ALL RED / NOT CLEAN')
