"""F3 fix round 3: mutation census of the merge-aware tie (both directions), --no-renames, the AST rail check,
the constant-reference parser and the widened citation extraction.

Each mutation replaces ONE exact anchor (asserted to occur once), runs the named rails, restores the captured
bytes, and checks the restore TWO ways: the sha256 on disk equals the capture, AND the file's content equals
its COMMITTED blob (CR-stripped) -- a sha only proves the bytes match what was captured. The harness's own path
and its log are excluded from the clean check.

    python docs/notebook/evidence/wave10-f3/mutate_f3_r3.py > docs/notebook/evidence/wave10-f3/mutations-f3-r3.log
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.relpath(__file__, os.getcwd()).replace('\\', '/')
OWN = {HERE, HERE.replace('mutate_f3_r3.py', 'mutations-f3-r3.log'),
       HERE.replace('mutate_f3_r3.py', 'mutations-f3-r3-run1.log')}
T = 'tools/parity_scorecard.py'
J = 'tools/telemetry_rail_asserts.mjs'
TF = 'tests/test_parity_scorecard.py'

MOVED = 'test_a_squash_onto_a_master_that_moved_still_ties_and_is_found'
LATER = 'test_a_squash_of_a_later_head_than_the_tag_is_refused_closed'
OLDHEADS = 'test_a_head_its_squash_does_not_carry_is_refused'
CONFLICT = 'test_a_head_that_conflicts_with_the_squash_parent_is_refused'
RENAME = 'test_a_rename_lists_both_names_so_a_landing_that_kept_the_old_file_is_refused'
VACUOUS = 'test_a_tie_over_no_changed_file_is_refused_as_vacuous'
NOTASSERT = 'test_a_rail_that_does_not_assert_the_event_is_a_gap'
HELPER = 'test_a_rail_that_asserts_the_event_through_a_helper_and_ran_green_counts'
UNPARSE = 'test_an_unparseable_rail_or_an_ast_walk_that_cannot_run_is_never_a_pass'
OUTBOX = 'test_the_outbox_door_is_railed_separately_and_its_loss_is_a_named_gap'
REAL15B = 'test_every_core_action_event_has_a_call_site_rail_that_ran_green'
CONST = 'test_core_action_events_resolves_constant_references_and_refuses_what_it_cannot_read'
PATHS = 'test_every_backticked_evidence_path_in_the_cells_is_extracted'

OLD_TIE_BODY = """    rc, out = git('merge-tree', '--write-tree', '--name-only', '--no-messages', f'{landing}^', tip)
    lines = out.splitlines()
"""
OLD_RULE = """    differ = {x for x in git('diff', '--name-only', tip, landing)[1].splitlines() if x}
    return changed, changed & differ
    rc, out = git('merge-tree', '--write-tree', '--name-only', '--no-messages', f'{landing}^', tip)
    lines = out.splitlines()
"""
KIND_REGEX = ("    return sorted(set(re.findall(r'(?:(?:CODE|RULING|RECORD|MEASURE) `|— report `|— run by (?:9B|F3): `)'"
              "\n                                  r'(docs/notebook/(?:evidence|gate-runs|proof)/[^`]+)`', text)))\n")

MUT = [
    # (id, file, old, new, rails that must go red)
    ('I1a the per-file blob rule is back (too STRICT: the moved-master squash is refused)', T,
     OLD_TIE_BODY, OLD_RULE, [MOVED]),
    ('I1b the tree comparison always passes (too LAX)', T,
     "    if lines[0] == want:\n        return changed, set()\n",
     "    if True:\n        return changed, set()\n", [OLDHEADS, LATER, RENAME]),
    ('I1c a conflicting merge passes', T,
     "        return changed, {f'(conflict) {x}' for x in lines[1:] if x} or {'(conflict)'}\n",
     "        return changed, set()\n", [CONFLICT]),
    # run 1 aimed I1d at `tied = bool(changed) and not bad`; it survived because the refusal is appended by the
    # separate `if not changed:` branch (kept: mutations-f3-r3-run1.log). This is the branch that refuses.
    ('I1d the non-vacuity refusal dropped', T,
     "            if not changed:\n                problems.append(f'B0 {wave}: the tie is vacuous",
     "            if False:\n                problems.append(f'B0 {wave}: the tie is vacuous", [VACUOUS]),
    ('M1 rename detection back on in the tie', T,
     "    changed = {x for x in git('diff', '--no-renames', '--name-only', base, tip)[1].splitlines() if x}\n",
     "    changed = {x for x in git('diff', '--name-only', base, tip)[1].splitlines() if x}\n", [RENAME]),
    ('M2a skipped tests count', J,
     "    if (SKIP_PROPS.has(p)) skipped = true\n", "    if (SKIP_PROPS.has(p)) skipped = false\n", [NOTASSERT]),
    ('M2b any string in the test body counts, expect or not', J,
     "  for (const r of roots) {\n", "  for (const r of [body, ...roots]) {\n", [NOTASSERT]),
    ('M2c no helper hop', J, "const MAX_HOPS = 3\n", "const MAX_HOPS = 0\n", [HELPER, REAL15B]),
    ('M2d the green-in-log check bypassed', T,
     "            green = [t for t in hits if t['titles'] and _ran_green(log_text, f, t['titles'])]\n",
     "            green = hits\n", [HELPER, OUTBOX]),
    ('M2e the outbox door dropped from the rails', T,
     "    'save_success': (f'{_TNB}/NoteEditorPage.telemetry.test.jsx',\n"
     "                     'app/src/pages/journal-2-0/lib/offline/useOutboxDrain.test.jsx'),\n",
     "    'save_success': f'{_TNB}/NoteEditorPage.telemetry.test.jsx',\n", [OUTBOX, REAL15B]),
    ('M2f a parse error reads as no assertion', T,
     "            if info.get('error'):\n", "            if False:\n", [UNPARSE]),
    ('M3a an unreadable element is silently dropped', T,
     "            else:\n                raise ValueError(f'CORE_ACTION_EVENTS[{key!r}]: element",
     "            else:\n                continue\n                raise ValueError(f'CORE_ACTION_EVENTS[{key!r}]: element",
     [CONST]),
    ('M3b constant references not resolved', T,
     "            elif ref and ref.group(1) in consts:\n", "            elif False:\n", [CONST]),
    ('M5a the kind-list regex is back', T,
     "    return sorted(set(_B0_PATH.findall(text)))\n", KIND_REGEX, [PATHS]),
    ('M5b section 0 not excluded', T,
     "    NL = chr(10)\n    start = text.find('## §0')\n",
     "    NL = chr(10)\n    start = -1\n", [PATHS]),
]


def committed(path):
    b = subprocess.run(['git', 'cat-file', 'blob', f'HEAD:{path}'], capture_output=True).stdout
    return b.replace(b'\r', b'')


def run(rails):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONPYCACHEPREFIX=tempfile.mkdtemp(prefix='f3r3mut_'))
    r = subprocess.run([sys.executable, '-m', 'pytest', '-q', '-p', 'no:cacheprovider', TF, '-k', ' or '.join(rails)],
                       capture_output=True, text=True, env=env, encoding='utf-8', errors='replace')
    tot = [l for l in r.stdout.splitlines() if ' passed' in l or ' failed' in l or ' error' in l]
    failed = sorted({l.split('::')[1].split('[')[0].split(' ')[0] for l in r.stdout.splitlines() if l.startswith('FAILED ')})
    return r.returncode, (tot[-1] if tot else 'NO TOTALS'), failed


only = set(sys.argv[1:])
res = []
for mid, path, old, new, rails in MUT:
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
        code, tot, failed = run(rails)
    finally:
        open(path, 'wb').write(raw)
    after_raw = open(path, 'rb').read()
    row = {'id': mid, 'file': path, 'rails': rails, 'totals': tot, 'failed': failed,
           'red': code != 0 and tot != 'NO TOTALS' and all(r in failed for r in rails),
           'restored_sha_ok': hashlib.sha256(after_raw).hexdigest() == before,
           'restored_equals_committed_blob': after_raw.replace(b'\r', b'') == committed(path)}
    res.append(row)
    print(json.dumps(row, ensure_ascii=True), flush=True)
# control: every rail green on the unmutated tree, so a red above is the mutation's
allrails = sorted({r for x in res for r in x['rails']})
code, tot, failed = run(allrails)
print(json.dumps({'control': allrails, 'totals': tot, 'failed': failed, 'green': code == 0 and tot != 'NO TOTALS'},
                 ensure_ascii=True), flush=True)
st = [l for l in subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout.splitlines()
      if l[3:].strip() not in OWN]
print('git status after (this harness and its log excluded):', repr(st))
ok = (all(x['red'] and x['restored_sha_ok'] and x['restored_equals_committed_blob'] for x in res)
      and code == 0 and tot != 'NO TOTALS' and not st)
print(f'ALL {len(res)} RED (every named rail), CONTROL GREEN, RESTORED, CLEAN' if ok else 'NOT ALL RED / NOT CLEAN')
