"""Lane CX walk: hold ONE local sandbox up (tools/notebook_perf_harness.Sandbox) until a stop
file appears, then stop it the way the launcher handles and print its integrity verdict.

⛔ This process never imports api.* -- only the harness module (stdlib + the launcher path).
"""
import json
import sys
import time
from pathlib import Path

WT = Path(r'C:\Users\Patrick\uct-worktrees\notebook-w10-cx')
sys.path.insert(0, str(WT / 'tools'))
import notebook_perf_harness as h  # noqa: E402

assert not any(m == 'api' or m.startswith('api.') for m in sys.modules), 'driver imported api.*'

SCR = Path(r'C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\441b0c89-c1d8-471c-bd31-2a4fb712ee30\scratchpad')
DATA = str(SCR / 'cx-walk-data')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8547
OUT = SCR / 'cx'
STOP = OUT / 'cx_walk.STOP'
STATUS = OUT / 'cx_walk_status.json'

refused = h.refuse_shared_root(DATA)
if refused:
    sys.exit(f'refused: {refused}')
if h.port_busy(PORT):
    sys.exit(f'port {PORT} busy')
Path(DATA).mkdir(parents=True, exist_ok=True)
STOP.unlink(missing_ok=True)
sb = h.Sandbox(DATA, PORT, OUT / 'cx_walk_sandbox.log')
sb.start()
base = f'http://127.0.0.1:{PORT}'
healthy = sb.wait_healthy(base, 240)
post = sb.wait_checkpoint(h.POST_BOOT, 90) if healthy else False
STATUS.write_text(json.dumps({'base': base, 'healthy': healthy, 'post_boot': post,
                              'pid': sb.proc.pid if sb.proc else None,
                              'integrity_path': sb.integrity_path(),
                              'labels': sb.labels()}, indent=1))
print('healthy', healthy, 'post-boot', post, flush=True)
while sb.alive() and not STOP.exists():
    time.sleep(2)
    try:
        st = json.loads(STATUS.read_text())
        st['labels'] = sb.labels()
        STATUS.write_text(json.dumps(st, indent=1))
    except Exception:  # noqa: BLE001
        pass
how = sb.stop()
integ = h.read_integrity(sb.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
line = h.integrity_line(integ, note=f'stop: {how}')
print(line, flush=True)
(OUT / 'cx_walk_integrity.json').write_text(json.dumps({'stop': how, 'line': line, **integ}, indent=1))
