"""F3 fix round 1: mutation census of the redesigned §0 checks (and the round-0 set, re-anchored).

Each mutation replaces ONE exact anchor (asserted to occur once), runs the named rail, restores the
captured bytes, and checks the restore TWO ways: the sha256 of the bytes on disk equals the capture, AND
the file's content equals its COMMITTED blob (CR-stripped), because a sha only proves the bytes match what
was captured, never that the capture was the original (CLAUDE.md, the shared-scratchpad race).

Review M-5: round 0's harness ended "NOT ALL RED / NOT CLEAN" because `git status --porcelain` saw the
harness file itself, untracked. This one excludes its own path and its log from the clean check.

    python docs/notebook/evidence/wave10-f3/mutate_f3_r1.py > docs/notebook/evidence/wave10-f3/mutations-f3-r1.log
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.relpath(__file__, os.getcwd()).replace('\\', '/')
OWN = {HERE, HERE.replace('mutate_f3_r1.py', 'mutations-f3-r1.log'), HERE.replace('mutate_f3_r1.py', 'mutations-f3-r1-run1.log')}
T = 'tools/parity_scorecard.py'
SC = 'docs/notebook/parity-scorecard.md'
TF = 'tests/test_parity_scorecard.py'
MUT = [
    ('M1 tag pin always true', T,
     "pinned = bool(sha) and (tip is None or sha.startswith(tip)) and (tip is None or ok('cat-file', '-e', f'{tip}^{{commit}}'))",
     "pinned = bool(sha)", 'test_a_tag_that_does_not_pin_the_recorded_tip_is_refused'),
    ('M2 squash ancestry always true', T, "landed = ok('merge-base', '--is-ancestor', landing, head)", "landed = True",
     'test_a_squash_that_did_not_land_is_refused'),
    ('M3 evidence blob never compared', T, "same = then[0] == 0 and then[1] == here[1]", "same = then[0] == 0",
     'test_evidence_that_changed_since_it_landed_is_refused'),
    ('M4a HEAD-ref reachability skipped', T, "reach = ok('merge-base', '--is-ancestor', sha, head)", "reach = True",
     'test_a_measured_tree_that_is_not_reachable_is_refused'),
    # run 1 named the wrong rail here and this mutation survived it (mutations-f3-r1-run1.log): the planted
    # tree-not-under-its-wave-tag case lives in the I-2 rail, not in the HEAD-ref one.
    ('M4b wave-tag reachability skipped', T, "reach = ok('merge-base', '--is-ancestor', sha, tcommit)", "reach = True",
     'test_a_tree_named_against_a_ref_that_is_not_a_declared_wave_tag_is_refused'),
    ('M5 flag revision not compared', T, "if not written or not (written.startswith(rev_) or rev_.startswith(written)):", "if False:",
     'test_a_flag_record_naming_another_revision_is_refused'),
    ('M6 flag status not compared', T, "                if got != want:\n                    problems.append(f'flag {key}: the record says",
     "                if False:\n                    problems.append(f'flag {key}: the record says",
     'test_a_flag_status_the_ledger_does_not_hold_is_refused'),
    ('M7 step-by-step walks unread', T, "        c = d.get('steps', [])", "        c = []",
     'test_every_cited_file_line_still_holds_its_fragment'),
    ('M8 an unmet clause dropped from the 10/10 list', SC,
     "- #14 Performance at scale: no super-linear curve (NOT MEASURED — QUIET SLOT)", "- #14 Performance at scale: (dropped)",
     'test_what_10_10_still_needs_lists_every_unmet_clause_once_under_one_owner'),
    ('M9 tie never finds a differing file (I-1)', T, "    return changed, changed & differ", "    return changed, set()",
     'test_a_head_its_squash_does_not_carry_is_refused'),
    ('M10 vacuous tie accepted (I-1)', T,
     "            if not changed:\n                problems.append(f'B0 {wave}: the tie is vacuous",
     "            if False:\n                problems.append(f'B0 {wave}: the tie is vacuous",
     'test_a_tie_over_no_changed_file_is_refused_as_vacuous'),
    ('M11 squash discovery skips the tie (I-3)', T, "        if c in touched and not _tie(tip, c)[1]:", "        if c in touched:",
     'test_the_squash_of_a_recorded_head_is_found_in_heads_history'),
    ('M12 undeclared ref accepted (I-2)', T, "        if frm not in tag_ok:", "        if False:",
     'test_a_tree_named_against_a_ref_that_is_not_a_declared_wave_tag_is_refused'),
    ('M13 a wave that did not land still vouches (I-2)', T, "        if not tcommit or not tied:", "        if not tcommit:",
     'test_a_tree_named_against_a_ref_that_is_not_a_declared_wave_tag_is_refused'),
    ('M14 a bare SHA resolves as a tag (I-2)', T, "f'refs/tags/{tag}^{{commit}}'", "f'{tag}^{{commit}}'",
     'test_a_tag_that_does_not_pin_the_recorded_tip_is_refused'),
    ('M15 cited evidence outside §0 passes (M-6)', T, "    return gaps\n", "    return []\n",
     'test_every_cited_evidence_file_and_walked_tree_is_one_the_index_checks'),
]


def committed(path):
    b = subprocess.run(['git', 'cat-file', 'blob', f'HEAD:{path}'], capture_output=True).stdout
    return b.replace(b'\r', b'')


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
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONPYCACHEPREFIX=tempfile.mkdtemp(prefix='f3r1mut_'))
    try:
        open(path, 'wb').write(m.encode('utf-8'))
        r = subprocess.run([sys.executable, '-m', 'pytest', '-q', '-p', 'no:cacheprovider', TF, '-k', test],
                           capture_output=True, text=True, env=env, encoding='utf-8', errors='replace')
    finally:
        open(path, 'wb').write(raw)
    after_raw = open(path, 'rb').read()
    tot = [l for l in r.stdout.splitlines() if ' passed' in l or ' failed' in l or ' error' in l]
    row = {'id': mid, 'rail': test, 'totals': tot[-1] if tot else 'NO TOTALS', 'red': r.returncode != 0 and bool(tot),
           'restored_sha_ok': hashlib.sha256(after_raw).hexdigest() == before,
           'restored_equals_committed_blob': after_raw.replace(b'\r', b'') == committed(path)}
    res.append(row)
    print(json.dumps(row, ensure_ascii=True), flush=True)
st = [l for l in subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout.splitlines()
      if l[3:].strip() not in OWN]
print('git status after (this harness and its log excluded):', repr(st))
ok = all(x['red'] and x['restored_sha_ok'] and x['restored_equals_committed_blob'] for x in res) and not st
print(f'ALL {len(res)} RED, RESTORED, CLEAN' if ok else 'NOT ALL RED / NOT CLEAN')
