"""W5-T7b: runs $S/mutate.py UNCHANGED (same apply, byte-exact restore and assert) with its test
command swapped from vitest to pytest, so the END-TO-END rail (T11's client against the real
service) is shown to kill the headline mutations. pytest's FAILED lines are mapped to mutate.py's
cross mark. Needs PINE_RUNTIME_T11_CLIENT (see the rail's docstring); a run that SKIPS would
survive every mutation, so the control must survive and the others must be killed.
Usage: python mutate_pytest.py <mutate.py> <muts.json> <pytest files...>"""
import runpy, subprocess, sys
mutate_py = sys.argv[1]
_run = subprocess.run


def run(cmd, **kw):
    assert cmd[:3] == ['node', 'node_modules/vitest/vitest.mjs', 'run'] and cmd[-1] == '--maxWorkers=2', cmd
    p = _run([sys.executable, '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '-p', 'no:warnings', *cmd[3:-1]], **kw)
    names = [l.split(' ', 1)[1].split(' - ')[0] for l in p.stdout.splitlines() if l.startswith('FAILED ') or l.startswith('ERROR ')]
    skipped = 'skipped' in p.stdout
    p.stdout = '\n'.join('\u00d7 ' + n for n in names) + ('\n\u00d7 SKIPPED-RUN-IS-NOT-A-KILL' if skipped and not names else '')
    p.stderr = ''
    return p


subprocess.run = run
sys.argv = [mutate_py] + sys.argv[2:]
runpy.run_path(mutate_py, run_name='__main__')
