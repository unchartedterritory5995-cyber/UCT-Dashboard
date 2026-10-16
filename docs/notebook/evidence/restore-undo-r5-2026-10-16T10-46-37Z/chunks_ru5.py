"""Run named vitest files in chunks; print each chunk's totals lines.
Usage: python chunks_ru5.py <outdir> <label> <chunk-size> <file> [<file> ...]
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

APP = Path(r"C:\Users\Patrick\uct-worktrees\notebook-restore-undo\app")
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def main():
    out, label, size = Path(sys.argv[1]), sys.argv[2], int(sys.argv[3])
    files = sys.argv[4:]
    out.mkdir(parents=True, exist_ok=True)
    npx = shutil.which("npx")
    worst = 0
    for i in range(0, len(files), size):
        chunk = files[i:i + size]
        log = out / f"{label}-{i // size}.log"
        with open(log, "wb") as fh:
            r = subprocess.run([npx, "vitest", "run", *chunk, "--maxWorkers=2"], cwd=str(APP),
                               stdout=fh, stderr=subprocess.STDOUT)
        text = ANSI.sub("", log.read_text(encoding="utf-8", errors="replace"))
        totals = [ln.strip() for ln in text.splitlines() if re.match(r"\s*(Test Files|Tests)\s", ln)]
        fails = sorted({ln.strip() for ln in text.splitlines() if re.match(r"\s*(FAIL|×)\s", ln)})
        print(f"[{label}-{i // size}] exit={r.returncode} files={len(chunk)} :: {' | '.join(totals) or 'NO TOTALS LINE'}")
        for f in fails[:40]:
            print("    ", f[:220])
        worst = max(worst, r.returncode if totals else 99)
    sys.exit(worst)


if __name__ == "__main__":
    main()
