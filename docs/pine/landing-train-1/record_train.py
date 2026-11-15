"""Landing train 1: re-record tests/fixtures/pine_runtime/service_smoke.json against a LOCAL pine-runtime service.

Same procedure as 8517f89c07 (engine 50): Node 20.20.2 with the Dockerfile's permission flags, a
throwaway secret held only in this process's memory (never written, never printed), the service's
env = only allowlisted names (PATH, PORT, PINE_RUNTIME_SERVICE_SECRET). --record, then a plain smoke.
Stops at the first failure and says why. Run under the heavy lock.
"""
import os
import secrets
import subprocess
import sys
import threading
import time

REPO = r'C:\Users\Patrick\uct-worktrees\train-1'
APP = os.path.join(REPO, 'app')
NODE20 = os.environ.get('REC_NODE') or r'C:\Users\Patrick\uct-worktrees\_resume-2026-11-01\dsk\tools\node-v20.20.2-win-x64\node.exe'
PERM_FLAG = os.environ.get('REC_PERM_FLAG') or '--experimental-permission'
PASS_PATH = os.environ.get('REC_PASS_PATH', '1') == '1'
PORT = '18456'


def step(title):
    print(f'== {title}', flush=True)


def main():
    step('node ' + subprocess.run([NODE20, '--version'], capture_output=True, text=True).stdout.strip())
    step('build bundle (scripts/build-pine-runtime.mjs)')
    b = subprocess.run([NODE20, 'scripts/build-pine-runtime.mjs'], cwd=APP, capture_output=True, text=True,
                       encoding='utf-8', errors='replace')
    print((b.stdout + b.stderr)[-800:], flush=True)
    if b.returncode != 0:
        print('STOP: bundle build failed', flush=True)
        return 1

    secret = secrets.token_hex(32)
    env = {'PORT': PORT, 'PINE_RUNTIME_SERVICE_SECRET': secret}
    if PASS_PATH:
        env['PATH'] = os.environ.get('PATH', '')
    for name in [n for n in os.environ.get('REC_WIN_NAMES', '').split(',') if n]:
        env[name] = os.environ.get(name) or os.environ.get(name.capitalize()) or r'C:\Windows'
    cmd = [NODE20, PERM_FLAG, f'--allow-fs-read={REPO}', '--allow-worker',
           '--disallow-code-generation-from-strings', os.path.join(REPO, 'services', 'pine_runtime', 'server.mjs')]
    step('boot service (env names: ' + ', '.join(sorted(env)) + ')')
    svc = subprocess.Popen(cmd, cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                           encoding='utf-8', errors='replace')
    lines, booted = [], threading.Event()

    def pump():
        for line in svc.stdout:
            line = line.rstrip()
            if secret in line:
                line = line.replace(secret, '<secret>')
            lines.append(line)
            print('  svc| ' + line, flush=True)
            if '[pine-runtime] boot engine=' in line:
                booted.set()
    threading.Thread(target=pump, daemon=True).start()
    t0 = time.time()
    while not booted.is_set() and svc.poll() is None and time.time() - t0 < 180:
        time.sleep(0.5)
    if not booted.is_set():
        print(f'STOP: service did not boot (exit={svc.poll()})', flush=True)
        if svc.poll() is None:
            svc.kill()
        return 1
    time.sleep(2)  # the canary's first run

    code = 1
    try:
        senv = dict(os.environ, PINE_RUNTIME_SERVICE_SECRET=secret)
        base = f'http://127.0.0.1:{PORT}'
        for label, extra in (('record', ['--record']), ('plain smoke', [])):
            step(label)
            r = subprocess.run([sys.executable, 'tools/pine_runtime_service_smoke.py', '--base', base, *extra],
                               cwd=REPO, env=senv, capture_output=True, text=True, encoding='utf-8', errors='replace')
            print((r.stdout + r.stderr).replace(secret, '<secret>')[-2500:], flush=True)
            print(f'{label} exit={r.returncode}', flush=True)
            if r.returncode != 0:
                print(f'STOP: {label} did not PASS', flush=True)
                return 1
        code = 0
    finally:
        step('stop service')
        svc.terminate()
        try:
            svc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            svc.kill()
        print(f'service exit={svc.poll()}', flush=True)
    return code


if __name__ == '__main__':
    sys.exit(main())
