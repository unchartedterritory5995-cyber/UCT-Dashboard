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

from api.services import bars_rail_monitor  # noqa: E402
from api.services import cadence_heartbeat as ch  # noqa: E402


def run(*, now=None, base_dir=None, contracts=None, out=None, rail_dir=None) -> int:
    """Print the roll-up and return the exit code. Every input is injectable.

    ⭐ TERM-013 — the push-rail DIGEST (S2) rides inside this ONE message rather than
    becoming a post of its own. ⛔ It never moves the exit code: a drop is a digest,
    not an alert, and the exit is the cadence contracts' verdict alone (the reader's
    own absence is already its `bars-stream-rail` contract row).
    """
    stream = out or sys.stdout
    ts = time.time() if now is None else now
    report = ch.build_rollup(ts, base_dir=base_dir, contracts=contracts)
    print(ch.format_rollup(report), file=stream)
    print(bars_rail_monitor.format_digest(ts, base_dir=rail_dir), file=stream)
    return 1 if (report["missing"] or not report["rows"]) else 0


def main(argv=None) -> int:
    return run()


if __name__ == "__main__":
    raise SystemExit(main())
