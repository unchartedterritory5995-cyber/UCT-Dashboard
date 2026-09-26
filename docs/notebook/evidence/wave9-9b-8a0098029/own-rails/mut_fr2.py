"""Fix round 2: mutation-prove the PIN of the scorecard's citation rail (controller ruling, 2026-09-26).

The rail checks every citation at the revision the scorecard's header records, never at HEAD. This
harness shows why that matters, without editing any tracked file except the tool under mutation
(bytes saved first, restored and sha256-checked after):

    python mut_fr2.py save        # save tools/parity_scorecard.py's bytes (outside the repo)
    python mut_fr2.py scratch     # a DANGLING scratch commit S = HEAD + one cited line moved down
    python mut_fr2.py direct      # verify at S (the HEAD form after the move) vs at the pinned revision
    python mut_fr2.py Ma          # mutation: verify() reads HEAD again
    python mut_fr2.py Mb          # mutation: verify() reads S (HEAD after an unrelated edit)
    python mut_fr2.py restore     # restore the tool's bytes, check sha256
    python mut_fr2.py guard       # --write refuses a scorecard whose header records a revision its
                                  #   citations are not true at (fix round 1's own file, at 2f24a64fd)

The scratch commit is built from `git show HEAD:<path>` into a temporary index (GIT_INDEX_FILE under
the scratch directory) and `git commit-tree`: no ref, no working-tree file and no shared index is
touched; S is unreachable and exists only in this clone's object store until gc.
"""
import hashlib
import importlib.util
import os
import subprocess
import sys

ROOT = r'C:\Users\Patrick\uct-worktrees\notebook-w9'
TOOL = os.path.join(ROOT, 'tools', 'parity_scorecard.py')
SCRATCH = os.environ.get(
    'W9B_FR2_SCRATCH',
    r'C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\e5af7430-5c97-49c2-9846-4da28941d38c\scratchpad\w9B\fr2')
BAK, SHA, S_TXT = (os.path.join(SCRATCH, n) for n in ('tool.orig.py', 'tool.orig.sha', 'scratch_commit.txt'))
MOVED = 'api/services/journal_two/note_shares.py'   # cited once, at line 64
MOVED_LINE = 64
ANCHOR = ("    if not in_clone(rev):\n"
          "        return Counter(), [f'unverifiable: {rev} not in this clone']\n")


def git(*a, env=None, inp=None):
    r = subprocess.run(['git', '-C', ROOT, *a], capture_output=True, input=inp,
                       env={**os.environ, **(env or {})})
    if r.returncode != 0:
        raise SystemExit(f'git {a[0]} failed: {r.stderr.decode(errors="replace")}')
    return r.stdout


def load_tool():
    sp = importlib.util.spec_from_file_location('parity_scorecard_fr2', TOOL)
    m = importlib.util.module_from_spec(sp)
    sp.loader.exec_module(m)
    return m


def mutate(line):
    t = open(TOOL, 'rb').read().decode('utf-8')
    assert t.count(ANCHOR) == 1, 'anchor not found once'
    new = t.replace(ANCHOR, line + ANCHOR, 1)
    open(TOOL, 'wb').write(new.encode('utf-8'))
    print('mutated:', line.strip(), hashlib.sha256(new.encode('utf-8')).hexdigest())


cmd = sys.argv[1]
if cmd == 'save':
    b = open(TOOL, 'rb').read()
    open(BAK, 'wb').write(b)
    open(SHA, 'w', newline='\n').write(hashlib.sha256(b).hexdigest())
    print('saved', hashlib.sha256(b).hexdigest())
elif cmd == 'restore':
    open(TOOL, 'wb').write(open(BAK, 'rb').read())
    got = hashlib.sha256(open(TOOL, 'rb').read()).hexdigest()
    want = open(SHA).read().strip()
    print('restored', got, 'OK' if got == want else 'MISMATCH')
elif cmd == 'scratch':
    head = git('rev-parse', 'HEAD').decode().strip()
    src = git('show', f'HEAD:{MOVED}')
    lines = src.split(b'\n')
    nl = b'\r\n' if src.count(b'\r\n') else b'\n'
    lines.insert(MOVED_LINE - 1, b'# scratch (fix round 2 pin proof): an unrelated edit that moves the next line down'
                 + (b'\r' if nl == b'\r\n' else b''))
    blob = git('hash-object', '-w', '--stdin', inp=b'\n'.join(lines)).decode().strip()
    idx = {'GIT_INDEX_FILE': os.path.join(SCRATCH, 'scratch.index')}
    git('read-tree', 'HEAD', env=idx)
    git('update-index', '--cacheinfo', f'100644,{blob},{MOVED}', env=idx)
    tree = git('write-tree', env=idx).decode().strip()
    s = git('commit-tree', tree, '-p', head, '-m',
            'scratch: fix round 2 pin proof (dangling, never referenced)').decode().strip()
    open(S_TXT, 'w', newline='\n').write(s)
    changed = git('diff', '--name-only', head, s).decode().split()
    print(f'HEAD {head}\nscratch commit S {s} (parent HEAD; files changed: {changed}; '
          f'{MOVED}:{MOVED_LINE} moved to {MOVED_LINE + 1})')
elif cmd == 'direct':
    s = open(S_TXT).read().strip()
    psc = load_tool()
    text = open(os.path.join(ROOT, psc.SCORECARD), 'rb').read().decode('utf-8')
    pinned = psc.recorded_rev(text)
    for label, rev in (('HEAD form (S = HEAD after the move)', s), ('pinned form', pinned)):
        counts, problems = psc.verify(text, rev=rev)
        print(f'{label}: rev {rev}: {sum(counts.values())} citations checked, {len(problems)} problem(s)')
        for p in problems:
            print('   ', p)
elif cmd == 'Ma':
    mutate("    rev = 'HEAD'  # MUTATION fr2-a: verify() reads HEAD again\n")
elif cmd == 'Mb':
    s = open(S_TXT).read().strip()
    mutate(f"    rev = '{s}'  # MUTATION fr2-b: HEAD after an unrelated edit\n")
elif cmd == 'guard':
    psc = load_tool()
    old = git('show', 'b6ec0dd9a:docs/notebook/parity-scorecard.md').decode('utf-8')
    dst = os.path.join(SCRATCH, 'guard-would-have-written.md')
    if os.path.exists(dst):
        os.remove(dst)
    psc.SCORECARD = dst                      # absolute: os.path.join(ROOT, dst) == dst, never the repo file
    psc.build = lambda pages_dir=None: (old, [], {'demo': 'fix round 1 scorecard, header ' + psc.recorded_rev(old)})
    rc = psc.main(['--write'])
    print('main --write returned', rc, '; wrote a file:', os.path.exists(dst))
else:
    raise SystemExit('unknown command ' + cmd)
