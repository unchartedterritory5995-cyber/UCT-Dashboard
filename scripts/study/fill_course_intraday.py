"""Study -- the intraday half of scripts/study/fill_course_charts.py, under the name the 2026-11-15 notes use.

    railway ssh --service web -- /opt/venv/bin/python scripts/study/fill_course_intraday.py [--dry-run]

is `fill_course_charts.py --kind intraday`. Everything lives in fill_course_charts.py (it also fills the index charts).
"""
from __future__ import annotations

import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from scripts.study.fill_course_charts import (  # noqa: E402,F401
    BANK_DIR, as_rows, course_fill_charts, cut, fetch_span, intraday_charts, regular_session,
)
from scripts.study import fill_course_charts as _charts  # noqa: E402


def main(argv=None) -> int:
    return _charts.main(argv, default_kind="intraday")


if __name__ == "__main__":
    sys.exit(main())
