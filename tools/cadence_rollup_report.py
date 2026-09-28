"""TERM-015 / FB-OBS-04 — print the daily dead-man roll-up. Runs ON ``web``.

    python tools/cadence_rollup_report.py

Reads the cadence markers on ``web``'s volume (``api/services/cadence_heartbeat``)
and prints ONE roll-up naming every contracted signal that did not report inside
its window. ``terminal-next-monitor`` reaches it through the declared report
surface (``/api/terminal-next/report/cadence``) because a Railway volume mounts to
one service and the monitor cannot read ``/data`` itself.

Exit codes — the monitor's alert decision reads them, never the text:
  0  every contracted signal reported
  1  at least one did not (MISSING or UNREADABLE), or nothing is contracted

⛔ READ-ONLY. It writes no marker, not even its own: the report surface it runs
behind is railed as writing nothing, and the roll-up's own heartbeat is its
post — whose absence is the alarm.
"""
from __future__ import annotations

import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from api.services import cadence_heartbeat as ch  # noqa: E402


def run(*, now=None, base_dir=None, contracts=None, out=None) -> int:
    """Print the roll-up and return the exit code. Every input is injectable."""
    stream = out or sys.stdout
    report = ch.build_rollup(time.time() if now is None else now,
                             base_dir=base_dir, contracts=contracts)
    print(ch.format_rollup(report), file=stream)
    return 1 if (report["missing"] or not report["rows"]) else 0


def main(argv=None) -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
