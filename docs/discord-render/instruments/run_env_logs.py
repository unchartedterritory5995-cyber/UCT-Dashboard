"""Driver: one environment-wide search per failure signature, sequential (shared 1,000/h quota),
one output file per filter, every search gated on the same live known-positive control.
Paths are built in Python, never interpolated by a shell."""
import subprocess
import sys
from pathlib import Path

REPO = Path(sys.argv[1]).resolve()
OUT = Path(sys.argv[2]).resolve()
OUT.mkdir(parents=True, exist_ok=True)
SINCE, UNTIL = "2026-08-30T00:00:00Z", "2026-09-13T23:59:59Z"
CONTROL = ('"fetch failed AMD"', "2026-09-11T14:46:00Z")     # known positive: [flow] AMD timeout, 14:45:33Z

FILTERS = [
    ("fetch_failed", '"fetch failed"'),
    ("render_failed", '"render failed"'),
    ("edit_original", '"edit_original HTTP"'),
    ("house_render", '"house render"'),
    ("stand_in", '"stand-in"'),
    ("autocomplete", '"autocomplete failed"'),
    ("job_crashed", '"job crashed" OR "multi job failed" OR "heal crashed"'),
    ("hot_warm", '"hot warm hit"'),
]

summary = []
for name, filt in FILTERS:
    out_file, log_file = OUT / f"{name}.jsonl", OUT / f"{name}.log"
    with open(log_file, "w", encoding="utf-8") as log:
        p = subprocess.run([sys.executable, "tools/railway_env_logs.py", "--filter", filt, "--since", SINCE,
                            "--until", UNTIL, "--out", str(out_file), "--page", "1000", "--sleep-ms", "300",
                            "--control-filter", CONTROL[0], "--control-at", CONTROL[1]],
                           cwd=REPO, stdout=log, stderr=subprocess.STDOUT, env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
    lines = sum(1 for _ in open(out_file, encoding="utf-8")) if out_file.exists() else None
    tail = log_file.read_text(encoding="utf-8").strip().splitlines()[-1:] if log_file.exists() else []
    summary.append((name, p.returncode, lines, tail[0] if tail else ""))
    print(f"{name}: rc={p.returncode} lines={lines} :: {tail[0] if tail else ''}", flush=True)
    if p.returncode == 2:
        print("INCONCLUSIVE control — stopping the remaining filters", flush=True)
        break

sys.exit(0 if all(rc == 0 for _, rc, _, _ in summary) and len(summary) == len(FILTERS) else 1)
