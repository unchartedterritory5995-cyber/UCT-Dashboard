"""Runs $S/mutate.py UNCHANGED (same apply, same byte-exact restore and assert), with only its
test command swapped from vitest to `node --test` (the W5 service rails are node:test files,
design section 8 step 5), and node's failed-test marks mapped so mutate.py's report names the
killing tests. Usage: python mutate_node.py <mutate.py> <muts.json> <test files...>"""
import runpy, subprocess, sys
mutate_py = sys.argv[1]
_run = subprocess.run
NODE_CROSS = '✖'
VITEST_CROSS = '×'


def run(cmd, **kw):
    assert cmd[:3] == ['node', 'node_modules/vitest/vitest.mjs', 'run'] and cmd[-1] == '--maxWorkers=2', cmd
    p = _run(['node', '--test', '--test-force-exit', '--test-timeout=60000', *cmd[3:-1]], **kw)
    names = []
    for line in p.stdout.splitlines():
        if line.startswith(NODE_CROSS + ' ') and 'failing tests' not in line:
            name = line[2:].rsplit(' (', 1)[0].strip()
            if name not in names:
                names.append(name)
    p.stdout = '\n'.join(VITEST_CROSS + ' ' + n for n in names)  # mutate.py keeps lines with the cross
    p.stderr = ''
    return p


subprocess.run = run
sys.argv = [mutate_py] + sys.argv[2:]
runpy.run_path(mutate_py, run_name='__main__')
