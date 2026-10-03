"""TERM-014: print the web pod's RSS slope from the retained series.

    python tools/rss_slope_report.py [--db PATH] [--json]

Exit 0 read (a slope, or INSUFFICIENT samples, which is not a fault) · 3 an OBS-4
ceiling is crossed (RSS > 3,500 MB or threads > 200: PAGE) · 125 UNREADABLE (no
store, or it cannot be opened). ⛔ Unreadable is never reported as a flat slope.

Run on web through `/api/terminal-next/report/memory-slope`; the
terminal-next-monitor's `memory` job posts it. All arithmetic is
`api.services.rss_series.slope` — this file only formats and exits.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services import rss_series  # noqa: E402

EXIT_PAGE = 3
EXIT_UNREADABLE = 125


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=None)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    try:
        samples = rss_series.read_samples(a.db)
    except Exception as e:                                   # noqa: BLE001
        print(f"UNREADABLE: {type(e).__name__}: {e}")
        return EXIT_UNREADABLE
    r = rss_series.slope(samples)
    print(json.dumps(r, indent=1, default=str) if a.json else rss_series.report_text(r))
    return EXIT_PAGE if r["page"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
