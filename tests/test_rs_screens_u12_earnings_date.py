"""RS screens unit U12, item W3.2: the earnings tag is counted from today in New York.

``days_to_earnings`` is whole calendar days from the BUILD's date to the next report. On a
Saturday or a Sunday (and Monday before the 03:00 ET build) it is a day or two too many,
so a report on Monday read "Earnings in 3 days" all weekend. The client now counts from
today's date in New York to the row's own ``next_earnings_date``, and falls back to the
stored count only for a row that does not carry the date. The words and the window are
the client's (``rsU12Finishes.test.jsx``); this holds the server's half: both columns
exist, typed as the client reads them, and the list asks for both.
"""
from __future__ import annotations

import re
from pathlib import Path

from api.services.screener import snapshot_db

ROOT = Path(__file__).resolve().parents[1]
RS_ROWS_JS = ROOT / "app" / "src" / "pages" / "screener" / "focus" / "rsRows.js"


def test_the_list_asks_for_the_reports_date_as_well_as_the_stored_count():
    src = RS_ROWS_JS.read_text(encoding="utf-8")
    assert re.search(r"earnings:\s*\['days_to_earnings', 'next_earnings_date'\]", src)
    for col in ("days_to_earnings", "next_earnings_date"):
        assert col in snapshot_db.COLUMNS, col
    assert "next_earnings_date" in snapshot_db._TEXT, "a date, served as YYYY-MM-DD text"
    assert "etCalendarDaysBetween" in src, "counted in New York's calendar, not the browser's"
