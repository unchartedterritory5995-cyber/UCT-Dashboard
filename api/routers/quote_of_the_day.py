"""GET /api/quote-of-the-day — today's quote, the same for every surface.

Public on purpose: it is a quotation, it carries nothing personal, and the
Morning Wire engine fetches it server-to-server (no session) to print the same
line in the Substack letter.

Query:
  date   YYYY-MM-DD (default: today in ET — the wire's calendar)
  label  the exposure tier to select for (default: the latest pushed wire's tier;
         an unknown word means "no regime" and the whole library is the pool)
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from api.services import quote_of_the_day as qotd

router = APIRouter()


@router.get("/api/quote-of-the-day")
def quote_of_the_day(
    date: str | None = Query(None, min_length=10, max_length=10, description="YYYY-MM-DD (ET)"),
    label: str | None = Query(None, max_length=32, description="exposure tier, e.g. Neutral"),
):
    if date:
        try:
            day = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    else:
        day = qotd.today_et()
    tier = qotd.normalize_label(label) if label is not None else qotd.current_label()
    return qotd.pick(day, tier)
