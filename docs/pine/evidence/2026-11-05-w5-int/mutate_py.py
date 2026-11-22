"""Runs $S/mutate.py UNCHANGED (same apply, same byte-exact restore and assert), with only its test
command swapped from vitest to pytest, and pytest's FAILED lines mapped so mutate.py's report names
the killing tests. Usage: python mutate_py.py <mutate.py> <muts.json> <pytest files...>"""
import runpy, subprocess, sys
mutate_py = sys.argv[1]
_run = subprocess.run


def run(cmd, **kw):
    assert cmd[:3] == ['node', 'node_modules/vitest/vitest.mjs', 'run'] and cmd[-1] == '--maxWorkers=2', cmd
    p = _run([sys.executable, '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:warnings', *cmd[3:-1]], **kw)
    names = [ln.split(' - ')[0].replace('FAILED ', '').strip() for ln in p.stdout.splitlines() if ln.startswith(('FAILED', 'ERROR'))]
    p.stdout = '\n'.join('× ' + n for n in names)
    p.stderr = ''
    return p


subprocess.run = run
sys.argv = [mutate_py] + sys.argv[2:]
runpy.run_path(mutate_py, run_name='__main__')
