"""9B sandbox driver: boot the census-pinned launcher from the EXPORT of the tip, keep it up until
a stop file appears, then stop it gracefully (CTRL_BREAK to its own process group) and print the
integrity verdict. Reuses the export's own tools/notebook_perf_harness.Sandbox (the SIGBREAK shim,
the integrity reader), so nothing here re-implements the launcher's safety.

python sandbox_driver.py <export_dir> <data_dir> <port> <stop_file>
"""
import os, sys, time
from pathlib import Path

exp, data_dir, port, stop_file = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
sys.path.insert(0, os.path.join(exp, 'tools'))
import notebook_perf_harness as h  # noqa: E402  (the export's copy: REPO = the export root)

GATES = {  # production's ARMED Notebook gates (docs/feature_flags.json on master be9ca78b6)
    'J2_SHARE_LINKS_ENABLED': '1', 'NOTEBOOK_PUBLISH_ENABLED': '1', 'NOTEBOOK_ONBOARDING_ENABLED': '1',
    'NOTEBOOK_ASK_INSERT_ON': '1', 'NOTEBOOK_WRITING_HELP_ENABLED': '1', 'COMPASS_NOTES_TOOL_ENABLED': '1',
    'ANTHROPIC_API_KEY': '', 'OPENAI_API_KEY': '',
}
os.environ.update(GATES)
print('REPO (export):', h.REPO, flush=True)
print('BOOT_SCRIPT:', h.BOOT_SCRIPT, flush=True)
print('gates set in the sandbox environment:', {k: v for k, v in GATES.items()}, flush=True)
log = Path(exp).parent / f'launcher-{port}.log'
sb = h.Sandbox(data_dir, port, log)
sb.start()
base = f'http://127.0.0.1:{port}'
print('healthy:', sb.wait_healthy(base, 240), flush=True)
print('integrity log:', sb.integrity_path(), flush=True)
print('+15s checkpoint:', sb.wait_checkpoint(h.POST_BOOT, 90), flush=True)
print('labels so far:', sb.labels(), flush=True)
print('READY', flush=True)
while not os.path.exists(stop_file) and sb.alive():
    time.sleep(2)
print('stop requested' if os.path.exists(stop_file) else 'sandbox exited on its own', flush=True)
how = sb.stop()
print('stop:', how, flush=True)
integ = h.read_integrity(sb.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
print(h.integrity_line(integ), flush=True)
print('labels:', sb.labels(), flush=True)
