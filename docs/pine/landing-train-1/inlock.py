"""TRAIN-1 scratch: run INSIDE the heavy lock. usage: inlock.py OUTDIR SHARDFILE [--mw N] [--env K=V ...]
SHARDFILE: one shard per line: NAME<TAB>space-separated vitest file paths (relative to app/), or
NAME<TAB>!<shell-free argv joined by \x1f> for a raw command run from the repo root.
Each shard is its own process; RAM is measured immediately before each; log -> OUTDIR/NAME.log; rc -> OUTDIR/rc.txt"""
import os, subprocess, sys, time
W = r'C:\Users\Patrick\uct-worktrees\train-1'
APP = os.path.join(W, 'app')
out, shardfile = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
mw_cap = 4
env = dict(os.environ)
i = 0
while i < len(args):
    if args[i] == '--mw': mw_cap = int(args[i + 1]); i += 2
    elif args[i] == '--env': k, v = args[i + 1].split('=', 1); env[k] = v; i += 2
    else: raise SystemExit('bad arg ' + args[i])
os.makedirs(out, exist_ok=True)

def free_gb():
    r = subprocess.run(['powershell', '-NoProfile', '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB'],
                       capture_output=True, text=True)
    return float(r.stdout.strip().replace(',', '.'))

def disk_gb():
    r = subprocess.run(['powershell', '-NoProfile', '-Command', '(Get-PSDrive C).Free/1GB'], capture_output=True, text=True)
    return float(r.stdout.strip().replace(',', '.'))

def gate():
    d = disk_gb()
    if d < 8: print(f'STOP: C: free {d:.1f} GB < 8', flush=True); sys.exit(7)
    for _ in range(60):
        f = free_gb()
        if f >= 6:
            mw = max(1, min(4, int((f - 6) // 1.5)))
            if f < 12: mw = min(mw, 2)
            return f, min(mw, mw_cap)
        time.sleep(60)
    print('STOP: free RAM stayed < 6 GB', flush=True); sys.exit(8)

rcs = []
for line in open(shardfile, encoding='utf-8'):
    line = line.rstrip('\n').rstrip('\r')
    if not line.strip() or line.startswith('#'): continue
    name, spec = line.split('\t', 1)
    senv = dict(env)
    if spec.startswith('ENV:'):
        e, spec = spec[4:].split('\t', 1)
        for kv in e.split(','):
            k, v = kv.split('=', 1); senv[k] = v
    f, mw = gate()
    t0 = time.time()
    log = os.path.join(out, name + '.log')
    if spec.startswith('!@'):
        cmd = spec[2:].split('\x1f'); cwd = APP
    elif spec.startswith('!'):
        cmd = spec[1:].split('\x1f'); cwd = W
    else:
        cmd = ['node', 'node_modules/vitest/vitest.mjs', 'run', *spec.split(), f'--maxWorkers={mw}']; cwd = APP
    with open(log, 'w', encoding='utf-8', errors='replace') as fh:
        rc = subprocess.run(cmd, cwd=cwd, env=senv, stdout=fh, stderr=subprocess.STDOUT).returncode
    rcs.append((name, rc))
    msg = f'{name}\trc={rc}\tfreeGB={f:.1f}\tmw={mw}\t{time.time() - t0:.0f}s'
    print(msg, flush=True)
    with open(os.path.join(out, 'rc.txt'), 'a', encoding='utf-8') as fh: fh.write(msg + '\n')
sys.exit(1 if any(rc for _, rc in rcs) else 0)
