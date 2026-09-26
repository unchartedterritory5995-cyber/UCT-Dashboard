"""Mutation harness for the scorecard rails: save bytes, break one thing, or restore + verify sha256.

    python mut_sc.py save
    python mut_sc.py M3|M4|M5|M6
    python mut_sc.py restore
"""
import hashlib, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
P = r'C:\Users\Patrick\uct-worktrees\notebook-w9\docs\notebook\parity-scorecard.md'
BAK = os.path.join(HERE, 'scorecard.orig.md')
SHA = os.path.join(HERE, 'scorecard.orig.sha')
cmd = sys.argv[1]
if cmd == 'save':
    b = open(P, 'rb').read()
    open(BAK, 'wb').write(b)
    open(SHA, 'w').write(hashlib.sha256(b).hexdigest())
    print('saved', hashlib.sha256(b).hexdigest())
elif cmd == 'restore':
    open(P, 'wb').write(open(BAK, 'rb').read())
    got = hashlib.sha256(open(P, 'rb').read()).hexdigest()
    want = open(SHA).read().strip()
    print('restored', got, 'OK' if got == want else 'MISMATCH')
else:
    t = open(P, 'rb').read().decode('utf-8')
    lines = t.split('\n')
    if cmd == 'M3':    # remove a row
        i = next(i for i, l in enumerate(lines) if l.startswith('| G-050 |'))
        del lines[i]
    elif cmd == 'M4':  # invent a verdict
        i = next(i for i, l in enumerate(lines) if l.startswith('| G-010 |'))
        lines[i] = lines[i].replace('| PARITY |', '| SUPERIOR |', 1)
    elif cmd == 'M5':  # cite a path that does not exist
        i = next(i for i, l in enumerate(lines) if l.startswith('| G-001 |'))
        lines[i] = lines[i].replace('`api/services/journal_two/notes.py`:3531', '`api/services/journal_two/notes_gone.py`:3531', 1)
    elif cmd == 'M6':  # a PARITY verdict whose competitor citation is removed
        i = next(i for i, l in enumerate(lines) if l.startswith('| G-010 |'))
        a, sep, rest = lines[i].partition(' · E: ')
        head, _, _ = a.partition('N: ')
        lines[i] = head + 'N: not verified — mutation' + sep + rest
    elif cmd == 'M7':  # a standard renamed
        i = next(i for i, l in enumerate(lines) if l.startswith('| 1 | Features |'))
        lines[i] = lines[i].replace('| 1 | Features |', '| 1 | Feature set |', 1)
    elif cmd == 'M8':  # the headline claims a standard at bar that is not
        i = next(i for i, l in enumerate(lines) if 'of 16 standards at bar.**' in l)
        lines[i] = lines[i].replace('**0 of 16', '**1 of 16', 1)
    elif cmd == 'M9':  # a citations-index row dropped
        i = next(i for i, l in enumerate(lines) if l.startswith('| 1 | https://'))
        del lines[i]
    new ='\n'.join(lines)
    assert new != t, 'the mutation changed nothing'
    open(P, 'wb').write(new.encode('utf-8'))
    print('mutated', cmd, hashlib.sha256(new.encode('utf-8')).hexdigest())
